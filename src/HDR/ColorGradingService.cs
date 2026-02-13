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

namespace VL.OCIO;

/// <summary>
/// Per-app singleton service for the color grading web UI.
/// Manages the WebSocket server, HTTP file serving, instance registry, and presets.
/// Acquired via GetOrCreate(AppHost) — users never see this; they only place ColorGradingInstance nodes.
/// </summary>
public class ColorGradingService : IDisposable
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

    // Base path for resolving relative paths (set from AppHost)
    private readonly string _basePath;

    // Resolved absolute presets path (fixed at construction)
    private readonly string _resolvedPresetsPath;

    // Actual port assigned by OS (starts at 9999, increments if busy)
    private int _actualPort;

    // Error tracking for debugging
    private string _lastError = "";

    // Auto-open browser tracking
    private bool _browserOpenRequested;
    private bool _serverStarted;

    // Cached server info for broadcasting to clients (so they know the network URL)
    private object? _serverInfo;

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) }
    };

    /// <summary>
    /// Public read-only properties for diagnostic outputs on ColorGradingInstance.
    /// </summary>
    public int ActualPort => _actualPort;
    public int ClientCount => _clients.Count;
    public bool IsRunning => _listener?.IsListening ?? false;
    public string LastError => _lastError;

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

    /// <summary>
    /// Get or create the singleton ColorGradingService for this app.
    /// </summary>
    public static ColorGradingService GetOrCreate(AppHost appHost)
    {
        var existing = appHost.Services.GetService(typeof(ColorGradingService)) as ColorGradingService;
        if (existing != null)
            return existing;

        var service = new ColorGradingService(appHost);
        appHost.Services.RegisterService(service);
        return service;
    }

    private ColorGradingService(AppHost appHost)
    {
        _basePath = appHost.AppBasePath;
        _resolvedPresetsPath = Path.GetFullPath(Path.Combine(_basePath, "presets"));

        // Create presets folder if it doesn't exist
        if (!Directory.Exists(_resolvedPresetsPath))
        {
            try { Directory.CreateDirectory(_resolvedPresetsPath); }
            catch { }
        }

        // Register for process exit to ensure cleanup even on force close
        AppDomain.CurrentDomain.ProcessExit += OnProcessExit;

        Console.WriteLine($"[ColorGradingService] Created (base: {_basePath})");
    }

    private void OnProcessExit(object? sender, EventArgs e)
    {
        ForceCleanup();
    }

    /// <summary>
    /// Forcefully cleanup all resources synchronously (for process exit).
    /// </summary>
    private void ForceCleanup()
    {
        try
        {
            _cts?.Cancel();

            foreach (var kvp in _clients)
            {
                try { kvp.Value.Abort(); } catch { }
                try { kvp.Value.Dispose(); } catch { }
            }
            _clients.Clear();

            if (_listener != null)
            {
                try { _listener.Stop(); } catch { }
                try { _listener.Close(); } catch { }
                _listener = null;
            }

            try { _cts?.Dispose(); } catch { }
            _cts = null;
        }
        catch { }
    }

    /// <summary>
    /// Start the server lazily on first instance registration.
    /// </summary>
    private void EnsureServerStarted()
    {
        if (_serverStarted) return;
        _serverStarted = true;
        StartServer();
    }

    private void StartServer()
    {
        const int preferredPort = 9999;
        const int browserOpenDelayMs = 3000;

        try
        {
            _actualPort = FindAvailablePort(preferredPort);
            if (_actualPort == 0)
            {
                _lastError = "Could not find any available port";
                Console.WriteLine($"[ColorGradingService] {_lastError}");
                return;
            }

            _cts = new CancellationTokenSource();
            _listener = new HttpListener();

            // Try to bind on all interfaces first (requires URL ACL or admin on Windows).
            bool boundToAll = false;
            try
            {
                _listener.Prefixes.Add($"http://+:{_actualPort}/");
                _listener.Start();
                boundToAll = true;
            }
            catch (HttpListenerException)
            {
                _listener.Close();
                _listener = new HttpListener();
                _listener.Prefixes.Add($"http://127.0.0.1:{_actualPort}/");
                _listener.Start();
            }

            _lastError = "";
            _serverTask = Task.Run(() => AcceptConnectionsAsync(_cts.Token));

            // Print access URLs
            var hostname = System.Net.Dns.GetHostName();
            var lanIp = GetLanIPAddress();

            if (boundToAll)
            {
                Console.WriteLine($"[ColorGradingService] Started on port {_actualPort} (all interfaces)");
                Console.WriteLine($"[ColorGradingService]   Local:   http://127.0.0.1:{_actualPort}/");
                Console.WriteLine($"[ColorGradingService]   Network: http://{hostname}:{_actualPort}/");
                if (lanIp != null)
                    Console.WriteLine($"[ColorGradingService]   Network: http://{lanIp}:{_actualPort}/");
            }
            else
            {
                Console.WriteLine($"[ColorGradingService] Started on http://127.0.0.1:{_actualPort}/ (localhost only)");
                Console.WriteLine($"[ColorGradingService]   To enable network access, run once as admin:");
                Console.WriteLine($"[ColorGradingService]     netsh http add urlacl url=http://+:{_actualPort}/ user={Environment.UserDomainName}\\{Environment.UserName}");
            }

            // Cache server info for broadcasting to UI clients
            _serverInfo = new
            {
                hostname,
                ip = lanIp ?? "127.0.0.1",
                port = _actualPort,
                networkEnabled = boundToAll
            };

            // Auto-open browser after a delay (in background, non-blocking)
            _browserOpenRequested = false;
            var token = _cts.Token;
            _ = Task.Run(async () =>
            {
                try
                {
                    await Task.Delay(browserOpenDelayMs, token);
                    if (!token.IsCancellationRequested && !_browserOpenRequested && _clients.Count == 0)
                    {
                        Console.WriteLine($"[ColorGradingService] No clients after {browserOpenDelayMs}ms, opening browser...");
                        _browserOpenRequested = true;
                        OpenBrowser();
                    }
                    else if (_clients.Count > 0)
                    {
                        Console.WriteLine($"[ColorGradingService] UI already connected ({_clients.Count} clients), skipping browser open");
                        _browserOpenRequested = true;
                    }
                }
                catch (OperationCanceledException) { }
            }, token);
        }
        catch (HttpListenerException ex)
        {
            _lastError = $"Failed to start server: {ex.Message} (Error {ex.ErrorCode})";
            Console.WriteLine($"[ColorGradingService] {_lastError}");
            StopServer();
        }
        catch (Exception ex)
        {
            _lastError = $"Failed to start server: {ex.Message}";
            Console.WriteLine($"[ColorGradingService] {_lastError}");
            StopServer();
        }
    }

    private static string? GetLanIPAddress()
    {
        try
        {
            foreach (var iface in System.Net.NetworkInformation.NetworkInterface.GetAllNetworkInterfaces())
            {
                if (iface.OperationalStatus != System.Net.NetworkInformation.OperationalStatus.Up)
                    continue;
                if (iface.NetworkInterfaceType == System.Net.NetworkInformation.NetworkInterfaceType.Loopback)
                    continue;

                foreach (var addr in iface.GetIPProperties().UnicastAddresses)
                {
                    if (addr.Address.AddressFamily == AddressFamily.InterNetwork)
                        return addr.Address.ToString();
                }
            }
        }
        catch { }
        return null;
    }

    private static int FindAvailablePort(int preferredPort)
    {
        for (int port = preferredPort; port < preferredPort + 100; port++)
        {
            if (IsPortAvailable(port))
                return port;
        }
        return 0;
    }

    private static bool IsPortAvailable(int port)
    {
        try
        {
            using var testSocket = new Socket(AddressFamily.InterNetwork, SocketType.Stream, ProtocolType.Tcp);
            testSocket.Bind(new IPEndPoint(IPAddress.Any, port));
            return true;
        }
        catch
        {
            return false;
        }
    }

    private void OpenBrowser()
    {
        try
        {
            var httpUrl = $"http://127.0.0.1:{_actualPort}/";
            Console.WriteLine($"[ColorGradingService] Opening browser: {httpUrl}");
            Process.Start(new ProcessStartInfo { FileName = httpUrl, UseShellExecute = true });
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[ColorGradingService] Failed to open browser: {ex.Message}");
        }
    }

    #region Instance Management

    /// <summary>
    /// Register a ColorGradingInstance with this service.
    /// Starts the server lazily on first call.
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
        EnsureServerStarted();

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
                    Console.WriteLine($"[ColorGradingService] Loaded instance '{instanceId}' state from JSON");
                }
            }

            // Auto-select first instance if none selected
            if (string.IsNullOrEmpty(_selectedInstanceId))
            {
                _selectedInstanceId = instanceId;
            }

            Console.WriteLine($"[ColorGradingService] Registered instance '{instanceId}' (total: {_instances.Count})");
        }

        _ = BroadcastInstanceList();
        _ = BroadcastState();
    }

    /// <summary>
    /// Unregister a ColorGradingInstance from this service.
    /// </summary>
    public void UnregisterInstance(string instanceId)
    {
        lock (_instancesLock)
        {
            if (_instances.TryRemove(instanceId, out _))
            {
                Console.WriteLine($"[ColorGradingService] Unregistered instance '{instanceId}' (remaining: {_instances.Count})");

                // If we removed the selected instance, select another
                if (_selectedInstanceId == instanceId)
                {
                    _selectedInstanceId = "";
                    foreach (var key in _instances.Keys)
                    {
                        _selectedInstanceId = key;
                        break;
                    }
                }
            }
        }

        _ = BroadcastInstanceList();
    }

    /// <summary>
    /// Update the default values for an instance (when Create pins change).
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
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[ColorGradingService] Failed to save instance '{instanceId}': {ex.Message}");
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
            Console.WriteLine($"[ColorGradingService] Failed to load instance '{instanceId}': {ex.Message}");
            return null;
        }
    }

    /// <summary>
    /// Apply state changes to an instance using the appropriate persistence mechanism.
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

            if (cc != null) instance.ColorCorrection = cc;
            if (tm != null) instance.Tonemap = tm;
            if (inputFilePath != null) instance.InputFilePath = inputFilePath;

            if (instance.IsExported)
            {
                instance.InstanceNode?.SetRuntimeState(
                    cc ?? instance.ColorCorrection,
                    tm ?? instance.Tonemap,
                    inputFilePath ?? instance.InputFilePath);

                SaveInstanceToJson(instanceId, instance.ColorCorrection, instance.Tonemap, instance.InputFilePath);
            }
            else
            {
                PersistInstanceToPin(instance);
            }
        }
    }

    /// <summary>
    /// Persist instance state to the "Settings Json" Create pin via SetPinValue.
    /// </summary>
    private void PersistInstanceToPin(RegisteredInstance instance)
    {
        var session = IDevSession.Current;
        if (session == null || instance.NodeStack.IsEmpty)
            return;

        try
        {
            var settings = new ProjectSettings
            {
                ColorCorrection = instance.ColorCorrection,
                Tonemap = instance.Tonemap,
                InputFilePath = instance.InputFilePath
            };

            var json = settings.ToJson();
            session.CurrentSolution
                .SetPinValue(instance.NodeStack, "Settings Json", json)
                .Confirm(SolutionUpdateKind.DontCompile);
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[ColorGradingService] SetPinValue failed for '{instance.InstanceId}': {ex.Message}");
        }
    }

    /// <summary>
    /// Broadcast instance list to all connected clients (no LINQ).
    /// </summary>
    private async Task BroadcastInstanceList()
    {
        // Build instance list without LINQ
        List<(string Id, bool IsActive)> list;
        lock (_instancesLock)
        {
            list = new List<(string, bool)>(_instances.Count);
            foreach (var kvp in _instances)
            {
                list.Add((kvp.Key, kvp.Value.IsActive));
            }
        }
        list.Sort((a, b) => string.Compare(a.Id, b.Id, StringComparison.Ordinal));

        // Build array for serialization
        var instanceArray = new object[list.Count];
        for (int i = 0; i < list.Count; i++)
        {
            instanceArray[i] = new
            {
                id = list[i].Id,
                displayName = list[i].Id,
                isActive = list[i].IsActive
            };
        }

        var msg = new
        {
            type = "instancesChanged",
            instances = instanceArray,
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
                catch { }
            }
        }
    }

    #endregion

    #region Server Lifecycle

    private void StopServer()
    {
        Console.WriteLine("[ColorGradingService] Stopping server...");

        try { _cts?.Cancel(); } catch { }

        if (_listener != null)
        {
            try { _listener.Stop(); } catch { }
            try { _listener.Close(); } catch { }
            _listener = null;
        }

        foreach (var kvp in _clients)
        {
            try { kvp.Value.Abort(); kvp.Value.Dispose(); } catch { }
        }
        _clients.Clear();

        if (_serverTask != null)
        {
            try { _serverTask.Wait(500); } catch { }
            _serverTask = null;
        }

        try { _cts?.Dispose(); } catch { }
        _cts = null;

        Console.WriteLine("[ColorGradingService] Server stopped.");
    }

    #endregion

    #region HTTP + WebSocket

    private async Task AcceptConnectionsAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested && _listener != null)
        {
            try
            {
                var contextTask = _listener.GetContextAsync();
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
            catch (HttpListenerException) when (ct.IsCancellationRequested) { break; }
            catch (ObjectDisposedException) when (ct.IsCancellationRequested) { break; }
            catch (OperationCanceledException) { break; }
            catch (Exception ex)
            {
                if (!ct.IsCancellationRequested)
                    Console.WriteLine($"[ColorGradingService] Accept error: {ex.Message}");
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
            if (path == "/") path = "/index.html";

            var content = GetEmbeddedFile(path.TrimStart('/'));
            if (content != null)
            {
                response.ContentType = GetMimeType(path);
                response.ContentLength64 = content.Length;
                response.OutputStream.Write(content, 0, content.Length);
                response.Close();
                return;
            }

            response.StatusCode = 404;
            response.Close();
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[ColorGradingService] HTTP error: {ex.Message}");
            response.StatusCode = 500;
            response.Close();
        }
    }

    private static byte[]? GetEmbeddedFile(string relativePath)
    {
        var assembly = typeof(ColorGradingService).Assembly;
        var resourceName = "VL.OCIO.ui_dist." + relativePath.Replace('/', '.').Replace('\\', '.');
        using var stream = assembly.GetManifestResourceStream(resourceName);
        if (stream == null) return null;
        var bytes = new byte[stream.Length];
        stream.ReadExactly(bytes);
        return bytes;
    }

    private static string GetMimeType(string path)
    {
        var ext = Path.GetExtension(path).ToLowerInvariant();
        return ext switch
        {
            ".html" => "text/html; charset=utf-8",
            ".css" => "text/css; charset=utf-8",
            ".js" => "application/javascript; charset=utf-8",
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

            await SendStateToClient(ws);
            await SendPresetList(ws);

            if (_instances.Count > 0)
            {
                await BroadcastInstanceList();
            }

            var buffer = new byte[8192];
            var messageBuilder = new StringBuilder();

            while (ws.State == WebSocketState.Open && !ct.IsCancellationRequested)
            {
                try
                {
                    using var receiveCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
                    receiveCts.CancelAfter(TimeSpan.FromSeconds(30));

                    var result = await ws.ReceiveAsync(new ArraySegment<byte>(buffer), receiveCts.Token);

                    if (result.MessageType == WebSocketMessageType.Close)
                        break;

                    if (result.MessageType == WebSocketMessageType.Text)
                    {
                        messageBuilder.Append(Encoding.UTF8.GetString(buffer, 0, result.Count));

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
                    continue;
                }
            }
        }
        catch (WebSocketException ex)
        {
            Console.WriteLine($"[ColorGradingService] Client {clientId} WebSocket error: {ex.WebSocketErrorCode}");
        }
        catch (OperationCanceledException) { }
        catch (Exception ex)
        {
            Console.WriteLine($"[ColorGradingService] Client {clientId} unexpected error: {ex.Message}");
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
        catch { }
        finally
        {
            try { ws.Dispose(); } catch { }
        }
    }

    #endregion

    #region Message Handling

    private async Task HandleMessage(string message, WebSocket sender)
    {
        try
        {
            using var doc = JsonDocument.Parse(message);
            var root = doc.RootElement;
            var type = root.GetProperty("type").GetString();

            // Extract instanceId if present; fall back to selected, then first available
            string? instanceId = null;
            if (root.TryGetProperty("instanceId", out var idElement))
            {
                instanceId = idElement.GetString();
            }
            if (string.IsNullOrEmpty(instanceId))
            {
                instanceId = _selectedInstanceId;
            }
            if (string.IsNullOrEmpty(instanceId))
            {
                // Pick first available instance
                foreach (var key in _instances.Keys)
                {
                    instanceId = key;
                    break;
                }
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
                    if (!string.IsNullOrEmpty(instanceId))
                        ApplyInstanceState(instanceId, "inputFilePath", null, null, filePath ?? "");
                    await BroadcastState();
                    break;

                case "browseFile":
                    var selectedPath = await Task.Run(() => OpenFileDialogSync());
                    if (!string.IsNullOrEmpty(selectedPath) && !string.IsNullOrEmpty(instanceId))
                    {
                        ApplyInstanceState(instanceId, "inputFilePath", null, null, selectedPath);
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
                    await SendPong(sender);
                    break;
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[ColorGradingService] Message error: {ex.Message}");
        }
    }

    private void HandleUpdate(JsonElement root, string? instanceId)
    {
        var section = root.GetProperty("section").GetString();
        var paramsElement = root.GetProperty("params");

        if (string.IsNullOrEmpty(instanceId) || !_instances.TryGetValue(instanceId, out var instance))
            return;

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

    private void HandleReset(string? instanceId)
    {
        if (string.IsNullOrEmpty(instanceId) || !_instances.ContainsKey(instanceId))
            return;

        var defaultCC = new ColorCorrectionSettings();
        var defaultTM = new TonemapSettings();
        ApplyInstanceState(instanceId, "colorCorrection", defaultCC, null, null);
        ApplyInstanceState(instanceId, "tonemap", null, defaultTM, null);
    }

    #endregion

    #region Merge Helpers

    private static ColorCorrectionSettings MergeColorCorrection(ColorCorrectionSettings current, JsonElement p)
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

    private static TonemapSettings MergeTonemap(TonemapSettings current, JsonElement p)
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

    private static Vector3Json ParseVector3(JsonElement e)
    {
        return new Vector3Json(
            e.TryGetProperty("x", out var x) ? x.GetSingle() : 0f,
            e.TryGetProperty("y", out var y) ? y.GetSingle() : 0f,
            e.TryGetProperty("z", out var z) ? z.GetSingle() : 0f
        );
    }

    #endregion

    #region State Broadcasting

    private async Task SendStateToClient(WebSocket client)
    {
        if (client.State != WebSocketState.Open) return;

        try
        {
            // Always multi-instance mode (no legacy fallback)
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
                        presetName = kvp.Key
                    };
                }
            }

            // Get data for selected instance (no LINQ)
            object? selectedData = null;
            if (instancesDict.TryGetValue(_selectedInstanceId, out var sel))
            {
                selectedData = sel;
            }
            else
            {
                foreach (var val in instancesDict.Values)
                {
                    selectedData = val;
                    break;
                }
            }

            var msg = new
            {
                type = "state",
                selectedInstanceId = _selectedInstanceId,
                instances = instancesDict,
                data = selectedData,
                serverInfo = _serverInfo
            };

            var json = JsonSerializer.Serialize(msg, JsonOptions);
            var bytes = Encoding.UTF8.GetBytes(json);

            using var sendCts = new CancellationTokenSource(TimeSpan.FromSeconds(5));
            await client.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, sendCts.Token);
        }
        catch { }
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

    private static async Task SendPong(WebSocket client)
    {
        if (client.State != WebSocketState.Open) return;

        try
        {
            var json = "{\"type\":\"pong\"}";
            var bytes = Encoding.UTF8.GetBytes(json);
            await client.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, CancellationToken.None);
        }
        catch { }
    }

    #endregion

    #region Presets

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
        catch { }
    }

    /// <summary>
    /// Get sorted preset list (no LINQ).
    /// </summary>
    private string[] GetPresetList()
    {
        if (string.IsNullOrEmpty(_resolvedPresetsPath) || !Directory.Exists(_resolvedPresetsPath))
            return Array.Empty<string>();

        var files = Directory.GetFiles(_resolvedPresetsPath, "*.json");
        var names = new string[files.Length];
        for (int i = 0; i < files.Length; i++)
        {
            names[i] = Path.GetFileNameWithoutExtension(files[i]);
        }
        Array.Sort(names, StringComparer.Ordinal);
        return names;
    }

    private void LoadPreset(string name, string? instanceId)
    {
        if (string.IsNullOrEmpty(_resolvedPresetsPath))
            return;

        var filePath = Path.Combine(_resolvedPresetsPath, $"{name}.json");
        var loaded = ProjectSettings.LoadFromFile(filePath);

        if (loaded != null && !string.IsNullOrEmpty(instanceId) && _instances.ContainsKey(instanceId))
        {
            ApplyInstanceState(instanceId, "colorCorrection", loaded.ColorCorrection, null, null);
            ApplyInstanceState(instanceId, "tonemap", null, loaded.Tonemap, null);
            ApplyInstanceState(instanceId, "inputFilePath", null, null, loaded.InputFilePath);
            Console.WriteLine($"[ColorGradingService] Loaded preset '{name}' to instance '{instanceId}'");
        }
    }

    private void SavePreset(string name, string? instanceId)
    {
        if (string.IsNullOrEmpty(_resolvedPresetsPath))
            return;

        if (!string.IsNullOrEmpty(instanceId) && _instances.TryGetValue(instanceId, out var instance))
        {
            var settings = new ProjectSettings
            {
                ColorCorrection = instance.ColorCorrection,
                Tonemap = instance.Tonemap,
                InputFilePath = instance.InputFilePath,
                PresetName = name
            };

            var filePath = Path.Combine(_resolvedPresetsPath, $"{name}.json");
            settings.SaveToFile(filePath);
            Console.WriteLine($"[ColorGradingService] Saved preset '{name}' from instance '{instanceId}'");
        }
    }

    /// <summary>
    /// Opens a native Windows file dialog to select a DDS file.
    /// Must run on STA thread for Windows Forms dialogs.
    /// </summary>
    private static string? OpenFileDialogSync()
    {
        string? result = null;

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

    #endregion

    public void Dispose()
    {
        AppDomain.CurrentDomain.ProcessExit -= OnProcessExit;
        StopServer();
        GC.SuppressFinalize(this);
    }

    ~ColorGradingService()
    {
        ForceCleanup();
    }
}
