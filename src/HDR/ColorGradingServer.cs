using System.Collections.Concurrent;
using System.Collections.Immutable;
using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Windows.Forms;
using VL.Core;
using VL.Lang.PublicAPI;
using VL.Model;

// Robust WebSocket server for color grading UI
// - Handles client disconnections gracefully
// - Supports ping/pong heartbeat
// - Auto-reconnect friendly (clients can reconnect any time)
// - Thread-safe state management
// - Port availability checking
// - Graceful shutdown with cleanup

namespace VL.OCIO;

/// <summary>
/// WebSocket server for color grading UI communication.
/// Runs as a VVVV ProcessNode, outputs settings for shaders.
/// Paths are resolved relative to the document/exe location automatically.
/// </summary>
[ProcessNode]
public class ColorGradingServer : IDisposable
{
    // Server state
    private HttpListener? _listener;
    private CancellationTokenSource? _cts;
    private Task? _serverTask;
    private readonly ConcurrentDictionary<Guid, WebSocket> _clients = new();

    // Multi-instance registry
    private readonly ConcurrentDictionary<string, RegisteredInstance> _instances = new();
    private string _selectedInstanceId = "";
    private readonly object _instancesLock = new();

    // Settings with thread-safe access (legacy single-instance mode fallback)
    private ProjectSettings _settings = new();
    private readonly object _settingsLock = new();

    // Base path for resolving relative paths (set from NodeContext)
    private string _basePath = "";

    // Cached input parameters (to detect changes)
    private string _cachedPresetsPath = "";
    private string _cachedUiPath = "";
    private bool _cachedEnabled;

    // Actual port assigned by OS (starts at 9999, increments if busy)
    private int _actualPort;

    // Resolved absolute paths (computed from relative inputs)
    private string _resolvedPresetsPath = "";
    private string _resolvedUiPath = "";
    private bool _pathsInitialized;

    // Cached output values (avoid allocations per frame)
    private ColorCorrectionSettings _cachedColorCorrection;
    private TonemapSettings _cachedTonemap;
    private string _cachedInputFilePath = "";
    private string _cachedPresetName = "Default";
    private bool _outputsDirty = true;

    // Error tracking for debugging
    private string _lastError = "";
    private DateTime _lastErrorTime = DateTime.MinValue;

    // Auto-save debounce
    private CancellationTokenSource? _autoSaveCts;
    private readonly object _autoSaveLock = new();
    private const int AutoSaveDelayMs = 2000; // 2 second debounce

    // Auto-open browser tracking
    private bool _browserOpenRequested;
    private bool _cachedAutoOpenBrowser = true; // Default matches parameter default
    private DateTime _serverStartTime = DateTime.MinValue;
    private const int BrowserOpenDelayMs = 3000; // Wait 3 seconds for existing clients to connect

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) }
    };

    /// <summary>
    /// Represents a registered color grading instance with its state and node reference.
    /// </summary>
    public class RegisteredInstance
    {
        public string InstanceId { get; set; } = "";
        public ImmutableStack<UniqueId> NodeStack { get; set; } = ImmutableStack<UniqueId>.Empty;
        public bool IsExported { get; set; }
        public ColorGradingInstance? InstanceNode { get; set; }
        public ColorCorrectionSettings ColorCorrection { get; set; } = new();
        public TonemapSettings Tonemap { get; set; } = new();
        public string InputFilePath { get; set; } = "";
        public bool IsActive => InstanceNode != null;
    }

    public ColorGradingServer(NodeContext nodeContext)
    {
        _cachedColorCorrection = new ColorCorrectionSettings();
        _cachedTonemap = new TonemapSettings();

        // Get base path from document location or exe location
        _basePath = GetBasePath(nodeContext);

        // Register for process exit to ensure cleanup even on force close
        AppDomain.CurrentDomain.ProcessExit += OnProcessExit;
    }

    private void OnProcessExit(object? sender, EventArgs e)
    {
        // Force synchronous cleanup on process exit
        ForceCleanup();
    }

    /// <summary>
    /// Forcefully cleanup all resources synchronously (for process exit)
    /// </summary>
    private void ForceCleanup()
    {
        try
        {
            // Cancel all operations immediately
            _cts?.Cancel();

            // Force close all WebSocket clients without waiting
            foreach (var kvp in _clients)
            {
                try { kvp.Value.Abort(); } catch { }
                try { kvp.Value.Dispose(); } catch { }
            }
            _clients.Clear();

            // Stop listener immediately
            if (_listener != null)
            {
                try { _listener.Stop(); } catch { }
                try { _listener.Close(); } catch { }
                _listener = null;
            }

            // Delete discovery file
            DeleteDiscoveryFile();

            // Dispose cancellation token
            try { _cts?.Dispose(); } catch { }
            _cts = null;
        }
        catch { }
    }

    private static string GetBasePath(NodeContext nodeContext)
    {
        // Try to get document path from NodeContext (works in editor)
        try
        {
            var appHost = nodeContext.AppHost;

            // Check if we're exported (standalone exe)
            if (appHost.IsExported)
            {
                var exeDir = Path.GetDirectoryName(System.Reflection.Assembly.GetEntryAssembly()?.Location);
                Console.WriteLine($"[ColorGradingServer] Running as exported app, using: {exeDir}");
                return exeDir ?? Environment.CurrentDirectory;
            }

            // In editor: use AppHost.GetDocumentPath() with UniqueId from the context stack
            // The stack contains UniqueIds where each has a DocumentId (the .vl file identifier)
            foreach (var uniqueId in nodeContext.Path.Stack)
            {
                if (uniqueId.IsDefault)
                    continue;

                // Get the actual file path for this document ID
                var docPath = appHost.GetDocumentPath(uniqueId);
                Console.WriteLine($"[ColorGradingServer] Checking UniqueId {uniqueId.DocumentId}: {docPath}");

                if (!string.IsNullOrEmpty(docPath) && File.Exists(docPath))
                {
                    var directory = Path.GetDirectoryName(docPath);
                    Console.WriteLine($"[ColorGradingServer] Found document path: {docPath}");
                    Console.WriteLine($"[ColorGradingServer] Base path: {directory}");
                    return directory ?? "";
                }
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[ColorGradingServer] Error getting document path: {ex.Message}");
        }

        // Fall back to exe location (works in exported app)
        var exePath = System.Reflection.Assembly.GetEntryAssembly()?.Location;
        if (!string.IsNullOrEmpty(exePath))
        {
            Console.WriteLine($"[ColorGradingServer] Falling back to exe location: {Path.GetDirectoryName(exePath)}");
            return Path.GetDirectoryName(exePath) ?? "";
        }

        // Last resort: current directory
        Console.WriteLine($"[ColorGradingServer] Using current directory: {Environment.CurrentDirectory}");
        return Environment.CurrentDirectory;
    }

    private string ResolvePath(string relativePath)
    {
        if (string.IsNullOrEmpty(relativePath))
            return "";

        // If already absolute, use as-is
        if (Path.IsPathRooted(relativePath))
            return relativePath;

        // Resolve relative to base path
        return Path.GetFullPath(Path.Combine(_basePath, relativePath));
    }

    /// <summary>
    /// Update method called every frame by VVVV.
    /// Optimized to minimize work when inputs haven't changed.
    /// </summary>
    public void Update(
        out ColorCorrectionSettings colorCorrection,
        out TonemapSettings tonemap,
        out string inputFilePath,
        out string presetName,
        out bool isRunning,
        out int clientCount,
        out int actualPort,
        out bool uiOpen,
        out string lastError,
        string presetsPath = "presets",
        string uiPath = "ui/dist",
        bool enabled = true,
        bool autoOpenBrowser = true)
    {
        // Resolve paths relative to document/exe on first run or when changed
        bool inputsChanged = presetsPath != _cachedPresetsPath ||
                            uiPath != _cachedUiPath ||
                            enabled != _cachedEnabled ||
                            !_pathsInitialized;

        if (inputsChanged)
        {
            _cachedPresetsPath = presetsPath ?? "presets";
            _cachedUiPath = uiPath ?? "ui/dist";
            _cachedEnabled = enabled;

            // Resolve relative paths to absolute
            _resolvedPresetsPath = ResolvePath(_cachedPresetsPath);
            _resolvedUiPath = ResolvePath(_cachedUiPath);
            _pathsInitialized = true;

            // Create presets folder if it doesn't exist
            if (!string.IsNullOrEmpty(_resolvedPresetsPath) && !Directory.Exists(_resolvedPresetsPath))
            {
                try { Directory.CreateDirectory(_resolvedPresetsPath); }
                catch { }
            }

            // Handle server start/stop
            if (enabled && _listener == null)
            {
                StartServer();
                // Reset browser open flag and record start time
                _browserOpenRequested = false;
                _serverStartTime = DateTime.Now;
                Console.WriteLine($"[ColorGradingServer] Server started, browser will open after {BrowserOpenDelayMs}ms if no clients connect");
            }
            else if (!enabled && _listener != null)
            {
                StopServer();
            }
        }

        // Handle auto-open browser toggle (if user toggles the parameter)
        if (autoOpenBrowser && !_cachedAutoOpenBrowser)
        {
            // Toggled from false to true - reset so it can open
            _browserOpenRequested = false;
            _serverStartTime = DateTime.Now;
            Console.WriteLine($"[ColorGradingServer] autoOpenBrowser toggled ON, will open after delay");
        }
        _cachedAutoOpenBrowser = autoOpenBrowser;

        // Auto-open browser if enabled, server running, and not already opened this session
        // Wait a short delay after server start to check if existing clients reconnect
        bool serverRunning = _listener?.IsListening ?? false;
        bool hasStartTime = _serverStartTime != DateTime.MinValue;

        if (autoOpenBrowser && !_browserOpenRequested && serverRunning && hasStartTime)
        {
            var elapsed = (DateTime.Now - _serverStartTime).TotalMilliseconds;
            if (elapsed >= BrowserOpenDelayMs)
            {
                // Only open if no clients connected after waiting
                if (_clients.Count == 0)
                {
                    Console.WriteLine($"[ColorGradingServer] No clients after {elapsed:F0}ms, opening browser...");
                    OpenBrowser();
                }
                else
                {
                    Console.WriteLine($"[ColorGradingServer] UI already connected ({_clients.Count} clients), skipping browser open");
                }
                _browserOpenRequested = true;
            }
        }
        else if (autoOpenBrowser && !_browserOpenRequested && !serverRunning)
        {
            // Debug: why isn't server running?
            Console.WriteLine($"[ColorGradingServer] Waiting for server to start (listener={_listener != null})");
        }

        // Only update outputs if settings changed (set by WebSocket handlers)
        if (_outputsDirty)
        {
            lock (_settingsLock)
            {
                _cachedColorCorrection = _settings.ColorCorrection;
                _cachedTonemap = _settings.Tonemap;
                _cachedInputFilePath = _settings.InputFilePath;
                _cachedPresetName = _settings.PresetName;
                _outputsDirty = false;
            }
        }

        // Return cached values (no allocations)
        colorCorrection = _cachedColorCorrection;
        tonemap = _cachedTonemap;
        inputFilePath = _cachedInputFilePath;
        presetName = _cachedPresetName;

        // These are cheap to compute
        isRunning = _listener?.IsListening ?? false;
        clientCount = _clients.Count;
        actualPort = _actualPort;
        uiOpen = _clients.Count > 0; // UI is open if at least one WebSocket client is connected
        lastError = _lastError;
    }

    private void StartServer()
    {
        const int preferredPort = 9999;

        try
        {
            // Find an available port starting from the preferred port
            _actualPort = FindAvailablePort(preferredPort);
            if (_actualPort == 0)
            {
                _lastError = "Could not find any available port";
                _lastErrorTime = DateTime.Now;
                Console.WriteLine($"[ColorGradingServer] {_lastError}");
                return;
            }

            _cts = new CancellationTokenSource();
            _listener = new HttpListener();
            _listener.Prefixes.Add($"http://127.0.0.1:{_actualPort}/");
            _listener.Start();

            _lastError = ""; // Clear error on success
            _serverTask = Task.Run(() => AcceptConnectionsAsync(_cts.Token));

            Console.WriteLine($"[ColorGradingServer] Started on http://127.0.0.1:{_actualPort}/");
            Console.WriteLine($"[ColorGradingServer] Base path: {_basePath}");
            Console.WriteLine($"[ColorGradingServer] UI path: {_resolvedUiPath}");

            // Write discovery file so UI can find us
            WriteDiscoveryFile();

            // Load last session state, or default preset if no session exists
            if (!LoadLastSession())
            {
                LoadPreset("default");
            }
        }
        catch (HttpListenerException ex)
        {
            _lastError = $"Failed to start server: {ex.Message} (Error {ex.ErrorCode})";
            _lastErrorTime = DateTime.Now;
            Console.WriteLine($"[ColorGradingServer] {_lastError}");
            StopServer();
        }
        catch (Exception ex)
        {
            _lastError = $"Failed to start server: {ex.Message}";
            _lastErrorTime = DateTime.Now;
            Console.WriteLine($"[ColorGradingServer] {_lastError}");
            StopServer();
        }
    }

    /// <summary>
    /// Find an available port, starting from preferredPort and trying up to 100 ports
    /// </summary>
    private static int FindAvailablePort(int preferredPort)
    {
        for (int port = preferredPort; port < preferredPort + 100; port++)
        {
            if (IsPortAvailable(port))
            {
                return port;
            }
        }
        return 0; // No port found
    }

    /// <summary>
    /// Check if a port is available for binding
    /// </summary>
    private static bool IsPortAvailable(int port)
    {
        try
        {
            // Try to bind briefly - most reliable check
            using var testSocket = new Socket(AddressFamily.InterNetwork, SocketType.Stream, ProtocolType.Tcp);
            testSocket.Bind(new IPEndPoint(IPAddress.Loopback, port));
            return true;
        }
        catch (SocketException)
        {
            return false;
        }
        catch
        {
            return false;
        }
    }

    /// <summary>
    /// Write discovery.json file so UI can find the server port
    /// </summary>
    private void WriteDiscoveryFile()
    {
        try
        {
            if (string.IsNullOrEmpty(_resolvedUiPath))
                return;

            var discoveryPath = Path.Combine(_resolvedUiPath, "discovery.json");
            var discovery = new
            {
                port = _actualPort,
                url = $"ws://127.0.0.1:{_actualPort}",
                httpUrl = $"http://127.0.0.1:{_actualPort}",
                timestamp = DateTime.Now.ToString("O")
            };

            var json = JsonSerializer.Serialize(discovery, new JsonSerializerOptions { WriteIndented = true });
            File.WriteAllText(discoveryPath, json);

            Console.WriteLine($"[ColorGradingServer] Discovery file written to {discoveryPath}");
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[ColorGradingServer] Failed to write discovery file: {ex.Message}");
        }
    }

    /// <summary>
    /// Open the UI in the default browser
    /// </summary>
    private void OpenBrowser()
    {
        try
        {
            // First try to open via HTTP server
            var httpUrl = $"http://127.0.0.1:{_actualPort}/";

            // Check if index.html exists for the server to serve
            var indexPath = Path.Combine(_resolvedUiPath, "index.html");
            if (!string.IsNullOrEmpty(_resolvedUiPath) && File.Exists(indexPath))
            {
                Console.WriteLine($"[ColorGradingServer] Opening browser: {httpUrl}");
                var psi = new ProcessStartInfo
                {
                    FileName = httpUrl,
                    UseShellExecute = true
                };
                Process.Start(psi);
            }
            else
            {
                // Fallback: open the HTML file directly if server path isn't working
                Console.WriteLine($"[ColorGradingServer] Index not found at {indexPath}, trying file:// protocol");

                // Try common relative paths
                var possiblePaths = new[]
                {
                    Path.Combine(_basePath, "ui", "dist", "index.html"),
                    Path.Combine(_basePath, "ui/dist", "index.html"),
                    indexPath
                };

                foreach (var path in possiblePaths)
                {
                    if (File.Exists(path))
                    {
                        Console.WriteLine($"[ColorGradingServer] Opening file: {path}");
                        var psi = new ProcessStartInfo
                        {
                            FileName = path,
                            UseShellExecute = true
                        };
                        Process.Start(psi);
                        return;
                    }
                }

                Console.WriteLine($"[ColorGradingServer] Could not find index.html. Tried: {string.Join(", ", possiblePaths)}");
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[ColorGradingServer] Failed to open browser: {ex.Message}");
        }
    }

    /// <summary>
    /// Delete discovery file on shutdown
    /// </summary>
    private void DeleteDiscoveryFile()
    {
        try
        {
            if (string.IsNullOrEmpty(_resolvedUiPath))
                return;

            var discoveryPath = Path.Combine(_resolvedUiPath, "discovery.json");
            if (File.Exists(discoveryPath))
            {
                File.Delete(discoveryPath);
                Console.WriteLine($"[ColorGradingServer] Discovery file deleted");
            }
        }
        catch { }
    }

    #region Instance Management

    /// <summary>
    /// Register a ColorGradingInstance with this server.
    /// Called by ColorGradingInstance.Update() when server reference is set.
    /// </summary>
    public void RegisterInstance(
        string instanceId,
        ImmutableStack<UniqueId> nodeStack,
        bool isExported,
        ColorGradingInstance instanceNode,
        ColorCorrectionSettings colorCorrection,
        TonemapSettings tonemap,
        string inputFilePath)
    {
        lock (_instancesLock)
        {
            var instance = new RegisteredInstance
            {
                InstanceId = instanceId,
                NodeStack = nodeStack,
                IsExported = isExported,
                InstanceNode = instanceNode,
                ColorCorrection = colorCorrection,
                Tonemap = tonemap,
                InputFilePath = inputFilePath
            };

            _instances[instanceId] = instance;

            // Load from JSON if exported and file exists
            if (isExported)
            {
                var loaded = LoadInstanceFromJson(instanceId);
                if (loaded != null)
                {
                    instance.ColorCorrection = loaded.ColorCorrection;
                    instance.Tonemap = loaded.Tonemap;
                    instance.InputFilePath = loaded.InputFilePath;
                    instanceNode.SetRuntimeState(loaded.ColorCorrection, loaded.Tonemap, loaded.InputFilePath);
                    Console.WriteLine($"[ColorGradingServer] Loaded instance '{instanceId}' state from JSON");
                }
            }

            // Auto-select first instance if none selected
            if (string.IsNullOrEmpty(_selectedInstanceId))
            {
                _selectedInstanceId = instanceId;
            }

            Console.WriteLine($"[ColorGradingServer] Registered instance '{instanceId}' (total: {_instances.Count})");
        }

        // Broadcast updated instance list to all clients
        _ = BroadcastInstanceList();
        _ = BroadcastState();
    }

    /// <summary>
    /// Unregister a ColorGradingInstance from this server.
    /// Called when instance is disposed or server reference is changed.
    /// </summary>
    public void UnregisterInstance(string instanceId)
    {
        lock (_instancesLock)
        {
            if (_instances.TryRemove(instanceId, out _))
            {
                Console.WriteLine($"[ColorGradingServer] Unregistered instance '{instanceId}' (remaining: {_instances.Count})");

                // If we removed the selected instance, select another
                if (_selectedInstanceId == instanceId)
                {
                    _selectedInstanceId = _instances.Keys.FirstOrDefault() ?? "";
                }
            }
        }

        // Broadcast updated instance list
        _ = BroadcastInstanceList();
    }

    /// <summary>
    /// Update the default values for an instance (when Create pins change).
    /// Called by ColorGradingInstance.Update() every frame.
    /// </summary>
    public void UpdateInstanceDefaults(
        string instanceId,
        ColorCorrectionSettings colorCorrection,
        TonemapSettings tonemap,
        string inputFilePath)
    {
        lock (_instancesLock)
        {
            if (_instances.TryGetValue(instanceId, out var instance))
            {
                // Only update if not in exported mode with runtime state
                // In exported mode, runtime state takes precedence
                if (!instance.IsExported || instance.InstanceNode == null)
                {
                    instance.ColorCorrection = colorCorrection;
                    instance.Tonemap = tonemap;
                    instance.InputFilePath = inputFilePath;
                }
            }
        }
    }

    /// <summary>
    /// Get all registered instance IDs and display names.
    /// </summary>
    public List<(string Id, string DisplayName, bool IsActive)> GetInstanceList()
    {
        lock (_instancesLock)
        {
            return _instances.Values
                .Select(i => (Id: i.InstanceId, DisplayName: i.InstanceId, IsActive: i.IsActive))
                .OrderBy(x => x.Id)
                .ToList();
        }
    }

    /// <summary>
    /// Get the state of a specific instance.
    /// </summary>
    public RegisteredInstance? GetInstance(string instanceId)
    {
        lock (_instancesLock)
        {
            return _instances.TryGetValue(instanceId, out var instance) ? instance : null;
        }
    }

    /// <summary>
    /// Save instance state to JSON file (for exported mode persistence).
    /// </summary>
    private void SaveInstanceToJson(string instanceId, ColorCorrectionSettings cc, TonemapSettings tm, string inputFilePath)
    {
        if (string.IsNullOrEmpty(_resolvedPresetsPath))
            return;

        try
        {
            var instancesDir = Path.Combine(_resolvedPresetsPath, "instances");
            if (!Directory.Exists(instancesDir))
                Directory.CreateDirectory(instancesDir);

            var filePath = Path.Combine(instancesDir, $"{instanceId}.json");
            var state = new ProjectSettings
            {
                ColorCorrection = cc,
                Tonemap = tm,
                InputFilePath = inputFilePath,
                PresetName = instanceId
            };

            state.SaveToFile(filePath);
            Console.WriteLine($"[ColorGradingServer] Saved instance '{instanceId}' to {filePath}");
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[ColorGradingServer] Failed to save instance '{instanceId}': {ex.Message}");
        }
    }

    /// <summary>
    /// Load instance state from JSON file (for exported mode startup).
    /// </summary>
    private ProjectSettings? LoadInstanceFromJson(string instanceId)
    {
        if (string.IsNullOrEmpty(_resolvedPresetsPath))
            return null;

        try
        {
            var filePath = Path.Combine(_resolvedPresetsPath, "instances", $"{instanceId}.json");
            if (!File.Exists(filePath))
                return null;

            return ProjectSettings.LoadFromFile(filePath);
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[ColorGradingServer] Failed to load instance '{instanceId}': {ex.Message}");
            return null;
        }
    }

    /// <summary>
    /// Apply state changes to an instance using the appropriate persistence mechanism.
    /// Editor mode: SetPinValue for native VVVV integration
    /// Exported mode: JSON file + runtime state
    /// </summary>
    private void ApplyInstanceState(
        string instanceId,
        string section,
        ColorCorrectionSettings? cc,
        TonemapSettings? tm,
        string? inputFilePath)
    {
        lock (_instancesLock)
        {
            if (!_instances.TryGetValue(instanceId, out var instance))
                return;

            // Update the registered state
            if (cc != null) instance.ColorCorrection = cc;
            if (tm != null) instance.Tonemap = tm;
            if (inputFilePath != null) instance.InputFilePath = inputFilePath;

            if (instance.IsExported)
            {
                // EXPORTED MODE: Update runtime state + save to JSON
                instance.InstanceNode?.SetRuntimeState(
                    cc ?? instance.ColorCorrection,
                    tm ?? instance.Tonemap,
                    inputFilePath ?? instance.InputFilePath);

                SaveInstanceToJson(instanceId, instance.ColorCorrection, instance.Tonemap, instance.InputFilePath);
            }
            else
            {
                // EDITOR MODE: Use SetPinValue for native VVVV integration
                var session = IDevSession.Current;
                if (session != null && !instance.NodeStack.IsEmpty)
                {
                    try
                    {
                        if (section == "colorCorrection" && cc != null)
                        {
                            session.CurrentSolution
                                .SetPinValue(instance.NodeStack, "Color Correction", cc)
                                .Confirm(VL.Model.SolutionUpdateKind.DontCompile);
                        }
                        else if (section == "tonemap" && tm != null)
                        {
                            session.CurrentSolution
                                .SetPinValue(instance.NodeStack, "Tonemap", tm)
                                .Confirm(VL.Model.SolutionUpdateKind.DontCompile);
                        }
                        else if (section == "inputFilePath" && inputFilePath != null)
                        {
                            session.CurrentSolution
                                .SetPinValue(instance.NodeStack, "Input File Path", inputFilePath)
                                .Confirm(VL.Model.SolutionUpdateKind.DontCompile);
                        }
                    }
                    catch (Exception ex)
                    {
                        Console.WriteLine($"[ColorGradingServer] SetPinValue failed for '{instanceId}': {ex.Message}");
                    }
                }
            }
        }
    }

    /// <summary>
    /// Broadcast instance list to all connected clients.
    /// </summary>
    private async Task BroadcastInstanceList()
    {
        var instances = GetInstanceList();
        var msg = new
        {
            type = "instancesChanged",
            instances = instances.Select(i => new
            {
                id = i.Id,
                displayName = i.DisplayName,
                isActive = i.IsActive
            }).ToArray(),
            selectedInstanceId = _selectedInstanceId
        };

        var json = JsonSerializer.Serialize(msg, JsonOptions);
        var bytes = Encoding.UTF8.GetBytes(json);

        foreach (var client in _clients.Values)
        {
            if (client.State == WebSocketState.Open)
            {
                try
                {
                    using var sendCts = new CancellationTokenSource(TimeSpan.FromSeconds(5));
                    await client.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, sendCts.Token);
                }
                catch { /* Client will be cleaned up */ }
            }
        }
    }

    #endregion

    private void StopServer()
    {
        Console.WriteLine("[ColorGradingServer] Stopping server...");

        // Save current state for next session
        SaveLastSession();

        // Delete discovery file first so UI knows we're gone
        DeleteDiscoveryFile();

        // Cancel all operations first
        try { _cts?.Cancel(); } catch { }

        // Stop the HTTP listener first to unblock GetContextAsync
        if (_listener != null)
        {
            try { _listener.Stop(); } catch { }
            try { _listener.Close(); } catch { }
            _listener = null;
        }

        // Abort all WebSocket clients (faster than graceful close)
        foreach (var kvp in _clients)
        {
            try
            {
                kvp.Value.Abort();
                kvp.Value.Dispose();
            }
            catch { }
        }
        _clients.Clear();

        // Wait briefly for server task to complete
        if (_serverTask != null)
        {
            try { _serverTask.Wait(500); } catch { }
            _serverTask = null;
        }

        // Dispose the cancellation token source
        try { _cts?.Dispose(); } catch { }
        _cts = null;

        Console.WriteLine("[ColorGradingServer] Server stopped.");
    }

    private async Task AcceptConnectionsAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested && _listener != null)
        {
            try
            {
                // HttpListener.GetContextAsync doesn't support CancellationToken directly
                // We use a workaround by stopping the listener when cancelled
                var contextTask = _listener.GetContextAsync();

                // Wait for either context or cancellation
                var completedTask = await Task.WhenAny(contextTask, Task.Delay(-1, ct));

                if (ct.IsCancellationRequested)
                    break;

                var context = await contextTask;

                if (context.Request.IsWebSocketRequest)
                {
                    _ = HandleWebSocketAsync(context, ct);
                }
                else
                {
                    HandleHttpRequest(context);
                }
            }
            catch (HttpListenerException) when (ct.IsCancellationRequested)
            {
                break;
            }
            catch (ObjectDisposedException) when (ct.IsCancellationRequested)
            {
                break;
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (Exception ex)
            {
                if (!ct.IsCancellationRequested)
                    Console.WriteLine($"[ColorGradingServer] Accept error: {ex.Message}");
            }
        }
    }

    private void HandleHttpRequest(HttpListenerContext context)
    {
        var request = context.Request;
        var response = context.Response;

        try
        {
            var path = request.Url?.LocalPath ?? "/";

            if (path == "/")
            {
                path = "/index.html";
            }

            if (!string.IsNullOrEmpty(_resolvedUiPath))
            {
                var filePath = Path.Combine(_resolvedUiPath, path.TrimStart('/'));
                if (File.Exists(filePath))
                {
                    var content = File.ReadAllBytes(filePath);
                    response.ContentType = GetMimeType(filePath);
                    response.ContentLength64 = content.Length;
                    response.OutputStream.Write(content, 0, content.Length);
                    response.Close();
                    return;
                }
                else
                {
                    Console.WriteLine($"[ColorGradingServer] 404: File not found: {filePath}");
                }
            }
            else
            {
                Console.WriteLine($"[ColorGradingServer] 404: UI path not resolved (empty)");
            }

            response.StatusCode = 404;
            response.Close();
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[ColorGradingServer] HTTP error: {ex.Message}");
            response.StatusCode = 500;
            response.Close();
        }
    }

    private static string GetMimeType(string path)
    {
        var ext = Path.GetExtension(path).ToLowerInvariant();
        return ext switch
        {
            ".html" => "text/html",
            ".css" => "text/css",
            ".js" => "application/javascript",
            ".json" => "application/json",
            ".png" => "image/png",
            ".jpg" or ".jpeg" => "image/jpeg",
            ".svg" => "image/svg+xml",
            ".woff" => "font/woff",
            ".woff2" => "font/woff2",
            _ => "application/octet-stream"
        };
    }

    private async Task HandleWebSocketAsync(HttpListenerContext context, CancellationToken ct)
    {
        WebSocket? ws = null;
        var clientId = Guid.NewGuid();

        try
        {
            var wsContext = await context.AcceptWebSocketAsync(null);
            ws = wsContext.WebSocket;
            _clients[clientId] = ws;

            // Send initial state immediately
            await SendStateToClient(ws);
            await SendPresetList(ws);

            // Send instance list if we have registered instances
            if (_instances.Count > 0)
            {
                await BroadcastInstanceList();
            }

            var buffer = new byte[8192]; // Larger buffer for safety
            var messageBuilder = new StringBuilder();

            while (ws.State == WebSocketState.Open && !ct.IsCancellationRequested)
            {
                try
                {
                    // Use timeout for receive to detect dead connections
                    using var receiveCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
                    receiveCts.CancelAfter(TimeSpan.FromSeconds(30)); // 30 second timeout

                    var result = await ws.ReceiveAsync(new ArraySegment<byte>(buffer), receiveCts.Token);

                    if (result.MessageType == WebSocketMessageType.Close)
                    {
                        break;
                    }

                    if (result.MessageType == WebSocketMessageType.Text)
                    {
                        messageBuilder.Append(Encoding.UTF8.GetString(buffer, 0, result.Count));

                        // Handle fragmented messages
                        if (result.EndOfMessage)
                        {
                            var message = messageBuilder.ToString();
                            messageBuilder.Clear();
                            await HandleMessage(message, ws);
                        }
                    }
                }
                catch (OperationCanceledException) when (!ct.IsCancellationRequested)
                {
                    // Receive timeout - connection might be dead, but don't close yet
                    // The ping/pong mechanism will detect if it's truly dead
                    continue;
                }
            }
        }
        catch (WebSocketException ex)
        {
            // Log but don't rethrow - client just disconnected
            Console.WriteLine($"[ColorGradingServer] Client {clientId} WebSocket error: {ex.WebSocketErrorCode}");
        }
        catch (OperationCanceledException) { }
        catch (Exception ex)
        {
            Console.WriteLine($"[ColorGradingServer] Client {clientId} unexpected error: {ex.Message}");
        }
        finally
        {
            _clients.TryRemove(clientId, out _);
            await CloseWebSocketSafely(ws);
        }
    }

    private static async Task CloseWebSocketSafely(WebSocket? ws)
    {
        if (ws == null) return;

        try
        {
            if (ws.State == WebSocketState.Open || ws.State == WebSocketState.CloseReceived)
            {
                using var closeCts = new CancellationTokenSource(TimeSpan.FromSeconds(2));
                await ws.CloseAsync(WebSocketCloseStatus.NormalClosure, "Closing", closeCts.Token);
            }
        }
        catch
        {
            // Ignore close errors
        }
        finally
        {
            try { ws.Dispose(); } catch { }
        }
    }

    private async Task HandleMessage(string message, WebSocket sender)
    {
        try
        {
            using var doc = JsonDocument.Parse(message);
            var root = doc.RootElement;
            var type = root.GetProperty("type").GetString();

            // Extract instanceId if present (for multi-instance routing)
            string? instanceId = null;
            if (root.TryGetProperty("instanceId", out var idElement))
            {
                instanceId = idElement.GetString();
            }

            switch (type)
            {
                case "update":
                    HandleUpdate(root, instanceId);
                    await BroadcastState(sender);
                    break;

                case "selectInstance":
                    if (!string.IsNullOrEmpty(instanceId))
                    {
                        _selectedInstanceId = instanceId;
                        await BroadcastState();
                    }
                    break;

                case "loadPreset":
                    var presetName = root.GetProperty("name").GetString();
                    if (!string.IsNullOrEmpty(presetName))
                    {
                        LoadPreset(presetName, instanceId);
                        await BroadcastState();
                    }
                    break;

                case "savePreset":
                    var saveName = root.GetProperty("name").GetString();
                    if (!string.IsNullOrEmpty(saveName))
                    {
                        SavePreset(saveName, instanceId);
                        await SendPresetList(sender);
                    }
                    break;

                case "listPresets":
                    await SendPresetList(sender);
                    break;

                case "setInputFile":
                    var filePath = root.GetProperty("path").GetString();
                    HandleSetInputFile(filePath ?? "", instanceId);
                    await BroadcastState();
                    break;

                case "browseFile":
                    // Open native file dialog on the server (same machine)
                    var selectedPath = await Task.Run(() => OpenFileDialogSync());
                    if (!string.IsNullOrEmpty(selectedPath))
                    {
                        HandleSetInputFile(selectedPath, instanceId);
                        await BroadcastState();
                    }
                    break;

                case "getState":
                    await SendStateToClient(sender);
                    break;

                case "reset":
                    HandleReset(instanceId);
                    await BroadcastState();
                    break;

                case "ping":
                    // Respond with pong for heartbeat
                    await SendPong(sender);
                    break;
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[ColorGradingServer] Message error: {ex.Message}");
        }
    }

    /// <summary>
    /// Handle setInputFile for a specific instance or legacy single-instance mode.
    /// </summary>
    private void HandleSetInputFile(string filePath, string? instanceId)
    {
        if (!string.IsNullOrEmpty(instanceId) && _instances.ContainsKey(instanceId))
        {
            // Multi-instance mode
            ApplyInstanceState(instanceId, "inputFilePath", null, null, filePath);
        }
        else
        {
            // Legacy single-instance mode
            lock (_settingsLock)
            {
                _settings.InputFilePath = filePath;
                _outputsDirty = true;
            }
        }
    }

    /// <summary>
    /// Handle reset for a specific instance or legacy single-instance mode.
    /// </summary>
    private void HandleReset(string? instanceId)
    {
        if (!string.IsNullOrEmpty(instanceId) && _instances.TryGetValue(instanceId, out var instance))
        {
            // Multi-instance mode: reset to default values
            var defaultCC = new ColorCorrectionSettings();
            var defaultTM = new TonemapSettings();
            ApplyInstanceState(instanceId, "colorCorrection", defaultCC, null, null);
            ApplyInstanceState(instanceId, "tonemap", null, defaultTM, null);
        }
        else
        {
            // Legacy single-instance mode
            lock (_settingsLock)
            {
                _settings.Reset();
                _outputsDirty = true;
            }
        }
    }

    private static async Task SendPong(WebSocket client)
    {
        if (client.State != WebSocketState.Open) return;

        try
        {
            var json = "{\"type\":\"pong\"}";
            var bytes = Encoding.UTF8.GetBytes(json);
            await client.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, CancellationToken.None);
        }
        catch
        {
            // Client disconnected, will be cleaned up
        }
    }

    /// <summary>
    /// Opens a native Windows file dialog to select a DDS file.
    /// Must run on STA thread for Windows Forms dialogs.
    /// </summary>
    private static string? OpenFileDialogSync()
    {
        string? result = null;

        // OpenFileDialog requires STA thread
        var thread = new Thread(() =>
        {
            using var dialog = new OpenFileDialog
            {
                Title = "Select DDS Texture",
                Filter = "DDS Files (*.dds)|*.dds|All Files (*.*)|*.*",
                FilterIndex = 1,
                CheckFileExists = true,
                CheckPathExists = true
            };

            if (dialog.ShowDialog() == DialogResult.OK)
            {
                result = dialog.FileName;
            }
        });

        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();
        thread.Join();

        return result;
    }

    private void HandleUpdate(JsonElement root, string? instanceId)
    {
        var section = root.GetProperty("section").GetString();
        var paramsElement = root.GetProperty("params");

        // Check if we should route to a specific instance
        if (!string.IsNullOrEmpty(instanceId) && _instances.TryGetValue(instanceId, out var instance))
        {
            // Multi-instance mode: route update to specific instance
            if (section == "colorCorrection")
            {
                var cc = MergeColorCorrection(instance.ColorCorrection, paramsElement);
                ApplyInstanceState(instanceId, "colorCorrection", cc, null, null);
            }
            else if (section == "tonemap")
            {
                var tm = MergeTonemap(instance.Tonemap, paramsElement);
                ApplyInstanceState(instanceId, "tonemap", null, tm, null);
            }
        }
        else
        {
            // Legacy single-instance mode
            lock (_settingsLock)
            {
                if (section == "colorCorrection")
                {
                    UpdateColorCorrection(paramsElement);
                }
                else if (section == "tonemap")
                {
                    UpdateTonemap(paramsElement);
                }
                _outputsDirty = true;
            }
        }

        // Trigger auto-save with debounce
        ScheduleAutoSave();
    }

    /// <summary>
    /// Merge partial color correction update into existing settings.
    /// Returns a new settings object with the merged values.
    /// </summary>
    private ColorCorrectionSettings MergeColorCorrection(ColorCorrectionSettings current, JsonElement p)
    {
        var cc = new ColorCorrectionSettings
        {
            Exposure = current.Exposure,
            Contrast = current.Contrast,
            Saturation = current.Saturation,
            Temperature = current.Temperature,
            Tint = current.Tint,
            Lift = current.Lift,
            Gamma = current.Gamma,
            Gain = current.Gain,
            Offset = current.Offset,
            ShadowColor = current.ShadowColor,
            MidtoneColor = current.MidtoneColor,
            HighlightColor = current.HighlightColor,
            HighlightSoftClip = current.HighlightSoftClip,
            ShadowSoftClip = current.ShadowSoftClip,
            HighlightKnee = current.HighlightKnee,
            ShadowKnee = current.ShadowKnee,
            InputSpace = current.InputSpace,
            OutputSpace = current.OutputSpace
        };

        if (p.TryGetProperty("exposure", out var exp)) cc.Exposure = exp.GetSingle();
        if (p.TryGetProperty("contrast", out var con)) cc.Contrast = con.GetSingle();
        if (p.TryGetProperty("saturation", out var sat)) cc.Saturation = sat.GetSingle();
        if (p.TryGetProperty("temperature", out var temp)) cc.Temperature = temp.GetSingle();
        if (p.TryGetProperty("tint", out var tint)) cc.Tint = tint.GetSingle();

        if (p.TryGetProperty("lift", out var lift)) cc.Lift = ParseVector3(lift);
        if (p.TryGetProperty("gamma", out var gamma)) cc.Gamma = ParseVector3(gamma);
        if (p.TryGetProperty("gain", out var gain)) cc.Gain = ParseVector3(gain);
        if (p.TryGetProperty("offset", out var offset)) cc.Offset = ParseVector3(offset);

        if (p.TryGetProperty("shadowColor", out var shadow)) cc.ShadowColor = ParseVector3(shadow);
        if (p.TryGetProperty("midtoneColor", out var mid)) cc.MidtoneColor = ParseVector3(mid);
        if (p.TryGetProperty("highlightColor", out var high)) cc.HighlightColor = ParseVector3(high);

        if (p.TryGetProperty("highlightSoftClip", out var hsc)) cc.HighlightSoftClip = hsc.GetSingle();
        if (p.TryGetProperty("shadowSoftClip", out var ssc)) cc.ShadowSoftClip = ssc.GetSingle();
        if (p.TryGetProperty("highlightKnee", out var hk)) cc.HighlightKnee = hk.GetSingle();
        if (p.TryGetProperty("shadowKnee", out var sk)) cc.ShadowKnee = sk.GetSingle();

        if (p.TryGetProperty("inputSpace", out var inSpace)) cc.InputSpace = Enum.Parse<HDRColorSpace>(inSpace.GetString() ?? "Linear_Rec709", true);
        if (p.TryGetProperty("outputSpace", out var outSpace)) cc.OutputSpace = Enum.Parse<HDRColorSpace>(outSpace.GetString() ?? "Linear_Rec709", true);

        return cc;
    }

    /// <summary>
    /// Merge partial tonemap update into existing settings.
    /// Returns a new settings object with the merged values.
    /// </summary>
    private TonemapSettings MergeTonemap(TonemapSettings current, JsonElement p)
    {
        var tm = new TonemapSettings
        {
            InputSpace = current.InputSpace,
            OutputSpace = current.OutputSpace,
            Tonemap = current.Tonemap,
            Exposure = current.Exposure,
            WhitePoint = current.WhitePoint,
            PaperWhite = current.PaperWhite,
            PeakBrightness = current.PeakBrightness
        };

        if (p.TryGetProperty("inputSpace", out var inSpace)) tm.InputSpace = Enum.Parse<HDRColorSpace>(inSpace.GetString() ?? "Linear_Rec709", true);
        if (p.TryGetProperty("outputSpace", out var outSpace)) tm.OutputSpace = Enum.Parse<HDRColorSpace>(outSpace.GetString() ?? "sRGB", true);
        if (p.TryGetProperty("tonemap", out var op)) tm.Tonemap = Enum.Parse<TonemapOperator>(op.GetString() ?? "ACES", true);
        if (p.TryGetProperty("exposure", out var exp)) tm.Exposure = exp.GetSingle();
        if (p.TryGetProperty("whitePoint", out var wp)) tm.WhitePoint = wp.GetSingle();
        if (p.TryGetProperty("paperWhite", out var pw)) tm.PaperWhite = pw.GetSingle();
        if (p.TryGetProperty("peakBrightness", out var pb)) tm.PeakBrightness = pb.GetSingle();

        return tm;
    }

    private void UpdateColorCorrection(JsonElement p)
    {
        var cc = _settings.ColorCorrection;

        if (p.TryGetProperty("exposure", out var exp)) cc.Exposure = exp.GetSingle();
        if (p.TryGetProperty("contrast", out var con)) cc.Contrast = con.GetSingle();
        if (p.TryGetProperty("saturation", out var sat)) cc.Saturation = sat.GetSingle();
        if (p.TryGetProperty("temperature", out var temp)) cc.Temperature = temp.GetSingle();
        if (p.TryGetProperty("tint", out var tint)) cc.Tint = tint.GetSingle();

        if (p.TryGetProperty("lift", out var lift)) cc.Lift = ParseVector3(lift);
        if (p.TryGetProperty("gamma", out var gamma)) cc.Gamma = ParseVector3(gamma);
        if (p.TryGetProperty("gain", out var gain)) cc.Gain = ParseVector3(gain);
        if (p.TryGetProperty("offset", out var offset)) cc.Offset = ParseVector3(offset);

        if (p.TryGetProperty("shadowColor", out var shadow)) cc.ShadowColor = ParseVector3(shadow);
        if (p.TryGetProperty("midtoneColor", out var mid)) cc.MidtoneColor = ParseVector3(mid);
        if (p.TryGetProperty("highlightColor", out var high)) cc.HighlightColor = ParseVector3(high);

        if (p.TryGetProperty("highlightSoftClip", out var hsc)) cc.HighlightSoftClip = hsc.GetSingle();
        if (p.TryGetProperty("shadowSoftClip", out var ssc)) cc.ShadowSoftClip = ssc.GetSingle();
        if (p.TryGetProperty("highlightKnee", out var hk)) cc.HighlightKnee = hk.GetSingle();
        if (p.TryGetProperty("shadowKnee", out var sk)) cc.ShadowKnee = sk.GetSingle();

        if (p.TryGetProperty("inputSpace", out var inSpace)) cc.InputSpace = Enum.Parse<HDRColorSpace>(inSpace.GetString() ?? "Linear_Rec709", true);
        if (p.TryGetProperty("outputSpace", out var outSpace)) cc.OutputSpace = Enum.Parse<HDRColorSpace>(outSpace.GetString() ?? "Linear_Rec709", true);
    }

    private void UpdateTonemap(JsonElement p)
    {
        var tm = _settings.Tonemap;

        if (p.TryGetProperty("inputSpace", out var inSpace)) tm.InputSpace = Enum.Parse<HDRColorSpace>(inSpace.GetString() ?? "Linear_Rec709", true);
        if (p.TryGetProperty("outputSpace", out var outSpace)) tm.OutputSpace = Enum.Parse<HDRColorSpace>(outSpace.GetString() ?? "sRGB", true);
        if (p.TryGetProperty("tonemap", out var op)) tm.Tonemap = Enum.Parse<TonemapOperator>(op.GetString() ?? "ACES", true);
        if (p.TryGetProperty("exposure", out var exp)) tm.Exposure = exp.GetSingle();
        if (p.TryGetProperty("whitePoint", out var wp)) tm.WhitePoint = wp.GetSingle();
        if (p.TryGetProperty("paperWhite", out var pw)) tm.PaperWhite = pw.GetSingle();
        if (p.TryGetProperty("peakBrightness", out var pb)) tm.PeakBrightness = pb.GetSingle();
    }

    private static Vector3Json ParseVector3(JsonElement e)
    {
        return new Vector3Json(
            e.TryGetProperty("x", out var x) ? x.GetSingle() : 0f,
            e.TryGetProperty("y", out var y) ? y.GetSingle() : 0f,
            e.TryGetProperty("z", out var z) ? z.GetSingle() : 0f
        );
    }

    private async Task SendStateToClient(WebSocket client)
    {
        if (client.State != WebSocketState.Open) return;

        try
        {
            object msg;

            // Check if we have registered instances
            if (_instances.Count > 0)
            {
                // Multi-instance mode: send all instance states
                var instancesDict = new Dictionary<string, object>();
                lock (_instancesLock)
                {
                    foreach (var kvp in _instances)
                    {
                        instancesDict[kvp.Key] = new
                        {
                            colorCorrection = kvp.Value.ColorCorrection,
                            tonemap = kvp.Value.Tonemap,
                            inputFilePath = kvp.Value.InputFilePath,
                            presetName = kvp.Key // Use instance ID as preset name
                        };
                    }
                }

                msg = new
                {
                    type = "state",
                    selectedInstanceId = _selectedInstanceId,
                    instances = instancesDict,
                    // Also include legacy data field for backward compatibility
                    data = instancesDict.TryGetValue(_selectedInstanceId, out var selected)
                        ? selected
                        : (instancesDict.Count > 0 ? instancesDict.Values.First() : null)
                };
            }
            else
            {
                // Legacy single-instance mode
                ProjectSettings snapshot;
                lock (_settingsLock)
                {
                    snapshot = _settings.Clone();
                }

                msg = new
                {
                    type = "state",
                    data = snapshot
                };
            }

            var json = JsonSerializer.Serialize(msg, JsonOptions);
            var bytes = Encoding.UTF8.GetBytes(json);

            using var sendCts = new CancellationTokenSource(TimeSpan.FromSeconds(5));
            await client.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, sendCts.Token);
        }
        catch
        {
            // Send failed - client will be cleaned up
        }
    }

    private async Task BroadcastState(WebSocket? exclude = null)
    {
        foreach (var client in _clients.Values)
        {
            if (client != exclude && client.State == WebSocketState.Open)
            {
                await SendStateToClient(client);
            }
        }
    }

    private async Task SendPresetList(WebSocket client)
    {
        if (client.State != WebSocketState.Open) return;

        try
        {
            var presets = GetPresetList();
            var msg = new { type = "presets", list = presets };
            var json = JsonSerializer.Serialize(msg, JsonOptions);
            var bytes = Encoding.UTF8.GetBytes(json);

            using var sendCts = new CancellationTokenSource(TimeSpan.FromSeconds(5));
            await client.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, sendCts.Token);
        }
        catch
        {
            // Send failed - client will be cleaned up
        }
    }

    private string[] GetPresetList()
    {
        if (string.IsNullOrEmpty(_resolvedPresetsPath) || !Directory.Exists(_resolvedPresetsPath))
            return Array.Empty<string>();

        return Directory.GetFiles(_resolvedPresetsPath, "*.json")
            .Select(f => Path.GetFileNameWithoutExtension(f))
            .OrderBy(n => n)
            .ToArray();
    }

    private void LoadPreset(string name, string? instanceId = null)
    {
        if (string.IsNullOrEmpty(_resolvedPresetsPath))
            return;

        var filePath = Path.Combine(_resolvedPresetsPath, $"{name}.json");
        var loaded = ProjectSettings.LoadFromFile(filePath);

        if (loaded != null)
        {
            if (!string.IsNullOrEmpty(instanceId) && _instances.ContainsKey(instanceId))
            {
                // Multi-instance mode: apply preset to specific instance
                ApplyInstanceState(instanceId, "colorCorrection", loaded.ColorCorrection, null, null);
                ApplyInstanceState(instanceId, "tonemap", null, loaded.Tonemap, null);
                ApplyInstanceState(instanceId, "inputFilePath", null, null, loaded.InputFilePath);
                Console.WriteLine($"[ColorGradingServer] Loaded preset '{name}' to instance '{instanceId}'");
            }
            else
            {
                // Legacy single-instance mode
                lock (_settingsLock)
                {
                    _settings = loaded;
                    _settings.PresetName = name;
                    _outputsDirty = true;
                }
                Console.WriteLine($"[ColorGradingServer] Loaded preset: {name}");
            }
        }
    }

    /// <summary>
    /// Load the last session state from _lastsession.json
    /// </summary>
    private bool LoadLastSession()
    {
        if (string.IsNullOrEmpty(_resolvedPresetsPath))
            return false;

        var sessionPath = Path.Combine(_resolvedPresetsPath, "_lastsession.json");
        var loaded = ProjectSettings.LoadFromFile(sessionPath);

        if (loaded != null)
        {
            lock (_settingsLock)
            {
                _settings = loaded;
                _outputsDirty = true;
            }
            Console.WriteLine($"[ColorGradingServer] Restored last session");
            return true;
        }
        return false;
    }

    /// <summary>
    /// Save the current state to _lastsession.json for next startup
    /// </summary>
    private void SaveLastSession()
    {
        if (string.IsNullOrEmpty(_resolvedPresetsPath))
            return;

        try
        {
            var sessionPath = Path.Combine(_resolvedPresetsPath, "_lastsession.json");
            lock (_settingsLock)
            {
                _settings.SaveToFile(sessionPath);
            }
            Console.WriteLine($"[ColorGradingServer] Saved session state");
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[ColorGradingServer] Failed to save session: {ex.Message}");
        }
    }

    /// <summary>
    /// Schedule auto-save with debounce - resets timer on each call
    /// </summary>
    private void ScheduleAutoSave()
    {
        lock (_autoSaveLock)
        {
            // Cancel any pending auto-save
            _autoSaveCts?.Cancel();
            _autoSaveCts?.Dispose();
            _autoSaveCts = new CancellationTokenSource();

            var token = _autoSaveCts.Token;

            // Schedule save after delay
            Task.Run(async () =>
            {
                try
                {
                    await Task.Delay(AutoSaveDelayMs, token);
                    if (!token.IsCancellationRequested)
                    {
                        SaveLastSession();
                    }
                }
                catch (OperationCanceledException)
                {
                    // Debounce - new change came in, ignore
                }
            }, token);
        }
    }

    private void SavePreset(string name, string? instanceId = null)
    {
        if (string.IsNullOrEmpty(_resolvedPresetsPath))
            return;

        if (!string.IsNullOrEmpty(instanceId) && _instances.TryGetValue(instanceId, out var instance))
        {
            // Multi-instance mode: save preset from specific instance
            var settings = new ProjectSettings
            {
                ColorCorrection = instance.ColorCorrection,
                Tonemap = instance.Tonemap,
                InputFilePath = instance.InputFilePath,
                PresetName = name
            };

            var filePath = Path.Combine(_resolvedPresetsPath, $"{name}.json");
            settings.SaveToFile(filePath);
            Console.WriteLine($"[ColorGradingServer] Saved preset '{name}' from instance '{instanceId}'");
        }
        else
        {
            // Legacy single-instance mode
            lock (_settingsLock)
            {
                _settings.PresetName = name;
                var filePath = Path.Combine(_resolvedPresetsPath, $"{name}.json");
                _settings.SaveToFile(filePath);
            }
        }
    }

    /// <summary>
    /// Cleanup resources when node is disposed
    /// </summary>
    public void Dispose()
    {
        // Unregister process exit handler
        AppDomain.CurrentDomain.ProcessExit -= OnProcessExit;

        StopServer();
        GC.SuppressFinalize(this);
    }

    /// <summary>
    /// Destructor to ensure cleanup
    /// </summary>
    ~ColorGradingServer()
    {
        ForceCleanup();
    }
}
