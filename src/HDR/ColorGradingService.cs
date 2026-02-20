using System.Collections.Concurrent;
using System.Collections.Immutable;
using System.Diagnostics;
using System.Net;
using System.Net.Security;
using System.Net.Sockets;
using System.Net.WebSockets;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
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
    private const string Tag = "ColorGradingService";

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

    // Resolved absolute presets path: ocio_presets/ next to the entry point document
    private readonly string _resolvedPresetsPath;

    // Actual port assigned by OS
    private int _actualPort;
    private bool _networkEnabled;
    private int _localhostPort;
    private string? _lanIp;

    // Per-app sub-path: "grade/{machine}/{app}" — unique identity on the network
    private readonly string _appHostName;
    private string _machineName = "";
    private string _appSlug = "";
    private string _appSubPath = "";

    // Directory page at /grade/ (first app to start claims this)
    private bool _ownsDirectory;
    private HttpListener? _directoryListener;

    // mDNS discovery for zero-config network access
    private MdnsDiscovery? _mdns;

    // HTTPS redirect listener (handles browser HTTPS-First upgrades)
    private TcpListener? _httpsRedirect;
    private Task? _httpsRedirectTask;

    // Cached URL for the UI (computed once at startup)
    private string _uiUrl = "";

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
        Converters = { new JsonStringEnumConverter() }
    };

    /// <summary>
    /// Public read-only properties for diagnostic outputs on ColorGradingInstance.
    /// </summary>
    public int ActualPort => _actualPort;
    public int ClientCount => _clients.Count;
    public bool IsRunning => _listener?.IsListening ?? false;
    public string LastError => _lastError;
    public string UiUrl => _uiUrl;

    /// <summary>
    /// Represents a registered color grading instance with its state and node reference.
    /// </summary>
    public class RegisteredInstance
    {
        public string InstanceId { get; set; } = "";       // Stable ID (deterministic hash of path stack)
        public string DisplayName { get; set; } = "";      // Friendly name for UI display
        public ImmutableStack<UniqueId> NodeStack { get; set; } = ImmutableStack<UniqueId>.Empty;
        public ImmutableStack<UniqueId> ParentStack { get; set; } = ImmutableStack<UniqueId>.Empty;
        public string PinKey { get; set; } = "";           // Groups instances sharing the same physical pin
        public bool IsExported { get; set; }
        public ColorGradingInstance? InstanceNode { get; set; }
        public ColorCorrectionSettings ColorCorrection { get; set; } = new();
        public TonemapSettings Tonemap { get; set; } = new();
        public string InputFilePath { get; set; } = "";
        public string ActivePresetName { get; set; } = "";  // Last loaded/saved preset name
        public bool IsPresetDirty { get; set; }              // Values modified since last load/save
        public bool IsActive => InstanceNode != null;
    }

    internal ColorGradingService(AppHost appHost)
    {
        _basePath = appHost.AppBasePath;
        _appHostName = appHost.AppName ?? "app";
        _resolvedPresetsPath = Path.GetFullPath(Path.Combine(_basePath, "ocio_presets"));

        // Create presets folder if it doesn't exist
        if (!Directory.Exists(_resolvedPresetsPath))
        {
            try { Directory.CreateDirectory(_resolvedPresetsPath); }
            catch { }
        }

        // Register for process exit to ensure cleanup even on force close
        AppDomain.CurrentDomain.ProcessExit += OnProcessExit;

        GradeLog.Info(Tag, $"Created (base: {_basePath})");
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
            try { _mdns?.Dispose(); } catch { }
            _mdns = null;
            StopHttpsRedirect();

            // Stop directory listener
            try { _directoryListener?.Stop(); } catch { }
            try { _directoryListener?.Close(); } catch { }
            _directoryListener = null;
            _ownsDirectory = false;

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

    // Base URL path — all apps share port 80 under /grade/{machine}/{app}/
    private const string BaseUrlPath = "grade";
    private const int Port = 80;

    private void StartServer()
    {
        try
        {
            _cts = new CancellationTokenSource();
            _networkEnabled = false;

            // Bind localhost-only (no UAC / URL ACL needed)
            BindLocalhostPrefix();

            _lastError = "";
            _serverTask = Task.Run(() => AcceptConnectionsAsync(_listener!, _cts.Token));

            // Cache URL (localhost only for now)
            _lanIp = GetLanIPAddress();
            UpdateCachedUrl();
            _serverInfo = new
            {
                hostname = System.Net.Dns.GetHostName(),
                ip = _lanIp ?? "127.0.0.1",
                port = _actualPort,
                path = _appSubPath,
                networkEnabled = false,
                mdnsUrl = (string?)null,
                isHub = false,
                appName = _appHostName
            };

            GradeLog.Info(Tag, $"{_uiUrl} (localhost only)");

            // Browser auto-open is triggered by ColorGradingInstance via RequestBrowserOpen()
            _browserOpenRequested = false;
        }
        catch (Exception ex)
        {
            _lastError = $"Failed to start server: {ex.Message}";
            GradeLog.Error(Tag, _lastError);
            StopServer();
        }
    }

    /// <summary>
    /// Upgrade the server from localhost-only to all-interfaces (LAN accessible).
    /// Requests URL ACL via UAC if needed (one-time admin prompt).
    /// Starts mDNS discovery, claims the directory page, starts HTTPS redirect.
    /// Safe to call multiple times — only the first call triggers the upgrade.
    /// </summary>
    public bool EnableNetworkAccess()
    {
        if (_networkEnabled) return true;
        if (!_serverStarted || _cts == null) return false;

        // Compute the new network URL and redirect connected clients before swapping listeners.
        // This lets the browser navigate to the LAN URL seamlessly.
        _lanIp ??= GetLanIPAddress();
        if (_lanIp != null)
        {
            var newUrl = $"http://{_lanIp}/{_appSubPath}/";
            BroadcastRedirect(newUrl);
        }

        // Stop current localhost listener — network listener will cover all interfaces
        var oldPort = _actualPort;
        try { _listener?.Stop(); } catch { }
        try { _listener?.Close(); } catch { }
        _listener = null;
        // Accept loop will exit because the listener was stopped

        // Bind network prefix on port 80
        var networkPrefix = $"http://+:{Port}/{_appSubPath}/";
        try
        {
            _listener = new HttpListener();
            _listener.Prefixes.Add(networkPrefix);
            _listener.Start();
        }
        catch (HttpListenerException ex) when (ex.ErrorCode == 5) // ACCESS_DENIED
        {
            _listener?.Close();
            _listener = null;

            GradeLog.Info(Tag, "Requesting network access (one-time setup)...");
            if (!TrySetUrlAcl())
            {
                GradeLog.Warn(Tag, "Network access declined. Staying localhost.");
                RebindLocalhost();
                return false;
            }

            // ACL set, retry
            try
            {
                _listener = new HttpListener();
                _listener.Prefixes.Add(networkPrefix);
                _listener.Start();
            }
            catch (Exception retryEx)
            {
                _listener?.Close();
                _listener = null;
                GradeLog.Error(Tag, $"Failed to bind after ACL: {retryEx.Message}");
                RebindLocalhost();
                return false;
            }
        }
        catch (Exception ex)
        {
            _listener?.Close();
            _listener = null;
            GradeLog.Error(Tag, $"Failed to enable network: {ex.Message}");
            RebindLocalhost();
            return false;
        }

        _networkEnabled = true;
        _actualPort = Port;

        // Ensure firewall rule exists (URL ACL may already have been set in a prior session)
        EnsureFirewallRule();

        // Restart accept loop with new listener
        _serverTask = Task.Run(() => AcceptConnectionsAsync(_listener!, _cts.Token));

        // mDNS discovery
        _lanIp ??= GetLanIPAddress();
        try
        {
            _mdns = new MdnsDiscovery();
            _mdns.Start((ushort)Port, _lanIp, _appSubPath, _appHostName);
        }
        catch (Exception ex)
        {
            GradeLog.Warn(Tag, $"mDNS unavailable: {ex.Message}");
            _mdns = null;
        }

        // Claim directory page at /grade/
        TryClaimDirectory();

        // HTTPS redirect on port 443
        if (Port != 443)
        {
            try { StartHttpsRedirect(); }
            catch (Exception ex) { GradeLog.Warn(Tag, $"HTTPS redirect unavailable: {ex.Message}"); }
        }

        // Update URL and server info
        UpdateCachedUrl();
        var hostname = System.Net.Dns.GetHostName();
        _serverInfo = new
        {
            hostname,
            ip = _lanIp ?? "127.0.0.1",
            port = Port,
            path = _appSubPath,
            networkEnabled = true,
            mdnsUrl = _mdns?.HubUrl != null ? $"{_mdns.HubUrl}{_appSubPath}/" : null,
            isHub = _mdns?.IsLeader ?? false,
            appName = _appHostName
        };

        GradeLog.Info(Tag, $"Network enabled: {_uiUrl}");
        if (_ownsDirectory)
            GradeLog.Info(Tag, $"Directory: http://{(_lanIp ?? "127.0.0.1")}/{BaseUrlPath}/");

        // Notify connected clients of the upgraded server info
        _ = BroadcastState();

        return true;
    }

    /// <summary>
    /// Downgrade the server from all-interfaces back to localhost-only.
    /// Stops mDNS, HTTPS redirect, directory listener, and rebinds to localhost.
    /// The browser tab on http://localhost/... keeps working across the switch.
    /// Safe to call when already in localhost mode (no-op).
    /// </summary>
    public void DisableNetworkAccess()
    {
        if (!_networkEnabled) return;

        // Redirect connected clients to localhost URL before stopping the network listener
        var portSuffix = _localhostPort == 80 ? "" : $":{_localhostPort}";
        var newUrl = $"http://localhost{portSuffix}/{_appSubPath}/";
        BroadcastRedirect(newUrl);

        // Stop mDNS discovery
        try { _mdns?.Dispose(); } catch { }
        _mdns = null;

        // Stop HTTPS redirect
        StopHttpsRedirect();

        // Stop directory listener
        try { _directoryListener?.Stop(); } catch { }
        try { _directoryListener?.Close(); } catch { }
        _directoryListener = null;
        _ownsDirectory = false;

        // Stop network listener
        try { _listener?.Stop(); } catch { }
        try { _listener?.Close(); } catch { }
        _listener = null;

        _networkEnabled = false;

        // Rebind localhost — existing browser tabs on localhost URL reconnect automatically
        RebindLocalhost();
        UpdateCachedUrl();

        _serverInfo = new
        {
            hostname = System.Net.Dns.GetHostName(),
            ip = _lanIp ?? "127.0.0.1",
            port = _actualPort,
            path = _appSubPath,
            networkEnabled = false,
            mdnsUrl = (string?)null,
            isHub = false,
            appName = _appHostName
        };

        GradeLog.Info(Tag, $"Network disabled, reverted to {_uiUrl}");

        // Notify reconnected clients of the downgraded server info
        _ = BroadcastState();
    }

    /// <summary>
    /// Rebind the localhost listener (after network upgrade failure or disable).
    /// </summary>
    private void RebindLocalhost()
    {
        try
        {
            var prefix = $"http://localhost:{_localhostPort}/{_appSubPath}/";
            _listener = new HttpListener();
            _listener.Prefixes.Add(prefix);
            _listener.Start();
            _actualPort = _localhostPort;
            _serverTask = Task.Run(() => AcceptConnectionsAsync(_listener!, _cts!.Token));
            GradeLog.Info(Tag, $"Reverted to localhost on port {_localhostPort}");
        }
        catch (Exception ex)
        {
            GradeLog.Error(Tag, $"Failed to rebind localhost: {ex.Message}");
            _lastError = $"Failed to rebind: {ex.Message}";
        }
    }

    /// <summary>
    /// Sanitize a string for use in a URL path segment.
    /// Lowercase, spaces/underscores → hyphens, strip non-alphanumeric.
    /// </summary>
    private static string Slugify(string input)
    {
        if (string.IsNullOrWhiteSpace(input)) return "app";
        var sb = new StringBuilder(input.Length);
        foreach (char c in input.ToLowerInvariant())
        {
            if (char.IsLetterOrDigit(c)) sb.Append(c);
            else if (c == ' ' || c == '_' || c == '-') sb.Append('-');
        }
        var result = sb.ToString();
        while (result.Contains("--")) result = result.Replace("--", "-");
        result = result.Trim('-');
        return string.IsNullOrEmpty(result) ? "app" : result;
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

    /// <summary>
    /// Bind a localhost-only HTTP prefix.
    /// Uses "localhost" hostname which has a built-in HTTP.sys reservation on modern Windows
    /// (no URL ACL / UAC required, even on port 80).
    /// Path: /grade/{machine}/{app}/ — auto-suffixes with -2, -3... if prefix is already taken.
    /// </summary>
    private void BindLocalhostPrefix()
    {
        _machineName = System.Net.Dns.GetHostName().ToLowerInvariant();
        string baseSlug = Slugify(_appHostName);

        // "localhost" has a built-in HTTP.sys reservation — port 80 works without ACL.
        // Fall back to high ports only if port 80 is genuinely unavailable (another process).
        int[] portsToTry = { Port, 9000, 9001, 9002, 9003, 9004, 9005 };

        foreach (int port in portsToTry)
        {
            int suffix = 1;
            while (suffix <= 20)
            {
                _appSlug = suffix == 1 ? baseSlug : $"{baseSlug}-{suffix}";
                _appSubPath = $"{BaseUrlPath}/{_machineName}/{_appSlug}";
                var prefix = $"http://localhost:{port}/{_appSubPath}/";

                var listener = new HttpListener();
                listener.Prefixes.Add(prefix);
                try
                {
                    listener.Start();
                    _listener = listener;
                    _actualPort = port;
                    _localhostPort = port;
                    return;
                }
                catch (HttpListenerException ex) when (ex.ErrorCode == 183) // PREFIX_ALREADY_EXISTS
                {
                    listener.Close();
                    suffix++;
                }
                catch (HttpListenerException)
                {
                    // Port genuinely in use — try next port
                    listener.Close();
                    break;
                }
            }
        }
        throw new InvalidOperationException($"Could not bind localhost prefix for /{BaseUrlPath}/{_machineName}/{baseSlug}/");
    }

    private void UpdateCachedUrl()
    {
        if (_actualPort == 0) { _uiUrl = ""; return; }

        if (_networkEnabled && _lanIp != null)
        {
            // Network mode: LAN-accessible URL on port 80
            _uiUrl = $"http://{_lanIp}/{_appSubPath}/";
        }
        else
        {
            // Localhost mode — use "localhost" (matches the HttpListener prefix)
            var portSuffix = _actualPort == 80 ? "" : $":{_actualPort}";
            _uiUrl = $"http://localhost{portSuffix}/{_appSubPath}/";
        }
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

    /// <summary>
    /// Try to set a URL ACL and firewall rule via a single UAC-elevated command.
    /// Sets ACL for /grade/ which covers all sub-paths (/grade/{machine}/{app}/).
    /// Adds a Windows Firewall inbound rule for port 80 (required for remote access).
    /// Shows the standard Windows admin consent popup. One-time, persists across reboots.
    /// </summary>
    private static bool TrySetUrlAcl()
    {
        try
        {
            var user = $"{Environment.UserDomainName}\\{Environment.UserName}";
            // ACL for the base path covers all sub-paths — single UAC prompt
            var aclUrl = $"http://+:{Port}/{BaseUrlPath}/";
            // Combine URL ACL + firewall rule in one elevated cmd invocation.
            // Delete existing firewall rule first (ignore error if not found), then add fresh.
            var commands = $"netsh http add urlacl url={aclUrl} user={user} & " +
                           $"netsh advfirewall firewall delete rule name=\"HDR Color Grading\" >nul 2>&1 & " +
                           $"netsh advfirewall firewall add rule name=\"HDR Color Grading\" dir=in action=allow protocol=TCP localport={Port}";
            var proc = Process.Start(new ProcessStartInfo
            {
                FileName = "cmd.exe",
                Arguments = $"/c {commands}",
                Verb = "runas",
                UseShellExecute = true,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden
            });
            proc?.WaitForExit(10_000);
            return proc?.ExitCode == 0;
        }
        catch
        {
            // User declined UAC or cmd not found
            return false;
        }
    }

    /// <summary>
    /// Ensure Windows Firewall allows inbound TCP on our port.
    /// Queries the rule without elevation; only prompts UAC if it's missing.
    /// </summary>
    private static void EnsureFirewallRule()
    {
        try
        {
            // Check if rule already exists (no elevation needed)
            var check = Process.Start(new ProcessStartInfo
            {
                FileName = "netsh",
                Arguments = "advfirewall firewall show rule name=\"HDR Color Grading\"",
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true
            });
            check?.WaitForExit(5_000);
            if (check?.ExitCode == 0)
                return; // Rule already exists

            // Rule missing — add it via elevated command
            GradeLog.Info(Tag, "Adding firewall rule for network access...");
            var add = Process.Start(new ProcessStartInfo
            {
                FileName = "cmd.exe",
                Arguments = $"/c netsh advfirewall firewall add rule name=\"HDR Color Grading\" dir=in action=allow protocol=TCP localport={Port}",
                Verb = "runas",
                UseShellExecute = true,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden
            });
            add?.WaitForExit(10_000);
        }
        catch (Exception ex)
        {
            GradeLog.Warn(Tag, $"Firewall rule check failed: {ex.Message}");
        }
    }

    /// <summary>
    /// Try to claim the directory page at /grade/ (first app on this machine wins).
    /// Uses a separate HttpListener — HTTP.sys routes by longest-prefix-match,
    /// so app-specific prefixes always take priority over the catch-all directory.
    /// </summary>
    private void TryClaimDirectory()
    {
        _ownsDirectory = false;
        try
        {
            _directoryListener = new HttpListener();
            _directoryListener.Prefixes.Add($"http://+:{Port}/{BaseUrlPath}/");
            _directoryListener.Start();
            _ownsDirectory = true;
            _ = Task.Run(() => AcceptDirectoryConnectionsAsync(_directoryListener, _cts!.Token));
            GradeLog.Info(Tag, $"Claimed directory page at /{BaseUrlPath}/");
        }
        catch (HttpListenerException)
        {
            // Another app already owns the directory prefix — that's fine
            _directoryListener?.Close();
            _directoryListener = null;
        }
    }

    private async Task AcceptDirectoryConnectionsAsync(HttpListener listener, CancellationToken ct)
    {
        while (!ct.IsCancellationRequested && listener.IsListening)
        {
            try
            {
                var context = await listener.GetContextAsync();
                HandleDirectoryRequest(context);
            }
            catch (HttpListenerException) { break; } // Listener stopped (restart or dispose)
            catch (ObjectDisposedException) { break; }
            catch (OperationCanceledException) { break; }
            catch (Exception ex)
            {
                if (!ct.IsCancellationRequested && listener.IsListening)
                    GradeLog.Error(Tag, $"Directory accept error: {ex.Message}");
            }
        }
    }

    private void HandleDirectoryRequest(HttpListenerContext context)
    {
        var response = context.Response;
        try
        {
            var html = GenerateDirectoryHtml();
            var bytes = Encoding.UTF8.GetBytes(html);
            response.ContentType = "text/html; charset=utf-8";
            response.ContentLength64 = bytes.Length;
            response.OutputStream.Write(bytes, 0, bytes.Length);
            response.Close();
        }
        catch
        {
            try { response.StatusCode = 500; response.Close(); } catch { }
        }
    }

    private string GenerateDirectoryHtml()
    {
        var sb = new StringBuilder(4096);
        sb.Append(@"<!DOCTYPE html>
<html lang=""en"">
<head>
<meta charset=""UTF-8"">
<meta name=""viewport"" content=""width=device-width, initial-scale=1.0"">
<meta http-equiv=""refresh"" content=""10"">
<title>HDR Color Grading</title>
<link rel=""preconnect"" href=""https://fonts.googleapis.com"">
<link rel=""preconnect"" href=""https://fonts.gstatic.com"" crossorigin>
<link href=""https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap"" rel=""stylesheet"">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0a0a0b;color:#e4e4e7;font-family:Inter,-apple-system,sans-serif;padding:40px 20px}
.container{max-width:560px;margin:0 auto}
h1{font-size:1.5rem;font-weight:600;margin-bottom:6px}
.subtitle{color:#71717a;font-size:.875rem;margin-bottom:32px}
h2{font-size:.625rem;font-weight:600;text-transform:uppercase;letter-spacing:.1em;color:#52525b;margin-bottom:12px;margin-top:24px}
.card{display:flex;justify-content:space-between;align-items:center;background:#18181b;border:1px solid #27272a;border-radius:8px;padding:14px 16px;margin-bottom:6px;text-decoration:none;color:inherit;transition:border-color .15s}
.card:hover{border-color:#3f3f46}
.name{font-size:.875rem;font-weight:500}
.sub{font-size:.75rem;color:#52525b;margin-top:2px}
.arrow{color:#52525b;font-size:1.1rem}
.dot{display:inline-block;width:6px;height:6px;border-radius:50%;margin-right:8px;vertical-align:middle}
.local{background:#34d399}
.remote{background:#71717a}
.empty{color:#3f3f46;font-size:.8rem;padding:16px 0}
</style>
</head>
<body>
<div class=""container"">
<h1>HDR Color Grading</h1>
<p class=""subtitle"">Select an app to open its grading UI.</p>");

        // --- This Machine ---
        sb.Append("<h2>This Machine</h2>");
        var selfUrl = $"/{_appSubPath}/";
        sb.Append($@"<a href=""{selfUrl}"" class=""card""><div><span class=""dot local""></span><span class=""name"">{HtmlEncode(_appHostName)}</span><div class=""sub"">/{_appSubPath}/</div></div><span class=""arrow"">&rarr;</span></a>");

        // Other local apps discovered via mDNS (same IP = same machine)
        if (_mdns != null)
        {
            foreach (var server in _mdns.KnownServers)
            {
                if (server.Ip == _lanIp && server.Path != _appSubPath && !string.IsNullOrEmpty(server.Path))
                {
                    var url = $"/{server.Path}/";
                    var name = !string.IsNullOrEmpty(server.AppName) ? server.AppName : server.Hostname;
                    sb.Append($@"<a href=""{url}"" class=""card""><div><span class=""dot local""></span><span class=""name"">{HtmlEncode(name)}</span><div class=""sub"">/{server.Path}/</div></div><span class=""arrow"">&rarr;</span></a>");
                }
            }
        }

        // --- Remote Machines ---
        if (_mdns != null)
        {
            bool hasRemote = false;
            foreach (var server in _mdns.KnownServers)
            {
                if (server.Ip != _lanIp && !string.IsNullOrEmpty(server.Path))
                {
                    if (!hasRemote)
                    {
                        sb.Append("<h2>Network</h2>");
                        hasRemote = true;
                    }
                    var portSuffix = server.Port == 80 ? "" : $":{server.Port}";
                    var url = $"http://{server.Ip}{portSuffix}/{server.Path}/";
                    var name = !string.IsNullOrEmpty(server.AppName) ? server.AppName : server.Hostname;
                    var instances = server.InstanceCount > 0
                        ? $" &middot; {server.InstanceCount} instance{(server.InstanceCount != 1 ? "s" : "")}"
                        : "";
                    sb.Append($@"<a href=""{url}"" class=""card""><div><span class=""dot remote""></span><span class=""name"">{HtmlEncode(name)}</span><div class=""sub"">{server.Hostname} ({server.Ip}){instances}</div></div><span class=""arrow"">&rarr;</span></a>");
                }
            }
        }

        sb.Append("</div></body></html>");
        return sb.ToString();
    }

    private static string HtmlEncode(string s)
    {
        return s.Replace("&", "&amp;").Replace("<", "&lt;").Replace(">", "&gt;").Replace("\"", "&quot;");
    }

    /// <summary>
    /// Start a TLS listener on port 443 that redirects browsers to our HTTP port.
    /// Handles Chrome/Android HTTPS-First mode: browser tries https:// first,
    /// gets a valid TLS handshake + HTTP 301 redirect to http://, and loads the page.
    /// </summary>
    private void StartHttpsRedirect()
    {
        if (!IsPortAvailable(443)) return;

        // Generate a self-signed cert in memory (no disk, no install)
        using var key = RSA.Create(2048);
        var req = new CertificateRequest("CN=hdr.local", key, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        req.CertificateExtensions.Add(new X509BasicConstraintsExtension(false, false, 0, false));
        // SAN: cover both mDNS name and any IP
        var sanBuilder = new SubjectAlternativeNameBuilder();
        sanBuilder.AddDnsName("hdr.local");
        sanBuilder.AddDnsName("*");
        if (_lanIp != null && IPAddress.TryParse(_lanIp, out var ip))
            sanBuilder.AddIpAddress(ip);
        sanBuilder.AddIpAddress(IPAddress.Loopback);
        req.CertificateExtensions.Add(sanBuilder.Build());
        var cert = req.CreateSelfSigned(DateTimeOffset.UtcNow, DateTimeOffset.UtcNow.AddYears(5));
        // Export and re-import to make private key available for SslStream on Windows
        var pfxBytes = cert.Export(X509ContentType.Pfx);
        var serverCert = new X509Certificate2(pfxBytes, (string?)null, X509KeyStorageFlags.MachineKeySet);

        _httpsRedirect = new TcpListener(IPAddress.Any, 443);
        _httpsRedirect.Start();

        var ct = _cts!.Token;
        _httpsRedirectTask = Task.Run(async () =>
        {
            while (!ct.IsCancellationRequested)
            {
                TcpClient? client = null;
                try
                {
                    client = await _httpsRedirect.AcceptTcpClientAsync(ct);
                    // Fire and forget — each redirect is fast
                    _ = HandleHttpsRedirectAsync(client, serverCert, ct);
                }
                catch (OperationCanceledException) { break; }
                catch { client?.Dispose(); }
            }
        }, ct);

        GradeLog.Info(Tag, "HTTPS redirect active on :443");
    }

    private async Task HandleHttpsRedirectAsync(TcpClient client, X509Certificate2 cert, CancellationToken ct)
    {
        try
        {
            using (client)
            {
                client.ReceiveTimeout = 5000;
                client.SendTimeout = 5000;

                await using var sslStream = new SslStream(client.GetStream(), false);
                await sslStream.AuthenticateAsServerAsync(cert, false, false);

                // Read enough of the HTTP request to get Host header (we don't need the full request)
                var buffer = new byte[4096];
                var read = await sslStream.ReadAsync(buffer, ct);

                // Send 301 redirect to HTTP version
                var httpUrl = UiUrl;
                var response = $"HTTP/1.1 301 Moved Permanently\r\nLocation: {httpUrl}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n";
                await sslStream.WriteAsync(Encoding.ASCII.GetBytes(response), ct);
            }
        }
        catch { /* client disconnected, timeout, etc. */ }
    }

    private void StopHttpsRedirect()
    {
        try { _httpsRedirect?.Stop(); } catch { }
        _httpsRedirect = null;
        _httpsRedirectTask = null;
    }

    private void OpenBrowser()
    {
        try
        {
            var httpUrl = UiUrl;
            GradeLog.Debug(Tag, $"Opening browser: {httpUrl}");
            Process.Start(new ProcessStartInfo { FileName = httpUrl, UseShellExecute = true });
        }
        catch (Exception ex)
        {
            GradeLog.Warn(Tag, $"Failed to open browser: {ex.Message}");
        }
    }

    /// <summary>
    /// Request a browser open with a short delay.
    /// Called by ColorGradingInstance when autoOpenBrowser is true.
    /// Safe to call multiple times — only the first call triggers.
    /// </summary>
    public void RequestBrowserOpen()
    {
        if (_browserOpenRequested || !_serverStarted || _actualPort == 0)
            return;

        _browserOpenRequested = true;
        var token = _cts?.Token ?? CancellationToken.None;
        _ = Task.Run(async () =>
        {
            try
            {
                // Wait for existing tabs to reconnect.
                // Must exceed browser's max reconnect interval (5s) plus margin
                // for background-tab timer throttling and visibility-triggered reconnect.
                await Task.Delay(8000, token);
                if (!token.IsCancellationRequested && ClientCount == 0)
                {
                    GradeLog.Debug(Tag, "No connected clients, opening browser...");
                    OpenBrowser();
                }
                else if (ClientCount > 0)
                {
                    GradeLog.Debug(Tag, $"Skipping browser open — {ClientCount} client(s) already connected");
                }
            }
            catch (OperationCanceledException) { }
        }, token);
    }

    #region Instance Management

    /// <summary>
    /// Register a ColorGradingInstance with this service.
    /// Starts the server lazily on first call.
    /// Uses a stable ID (deterministic hash) as key; displayName is for UI only.
    /// </summary>
    public void RegisterInstance(
        string stableId,
        string displayName,
        ImmutableStack<UniqueId> nodeStack,
        bool isExported,
        ColorGradingInstance instanceNode,
        ColorCorrectionSettings colorCorrection,
        TonemapSettings tonemap,
        string inputFilePath,
        string activePresetName = "")
    {
        EnsureServerStarted();

        // Compute parent stack and pin key for dictionary-based persistence
        var parentStack = nodeStack.IsEmpty ? nodeStack : nodeStack.Pop();
        var pinKey = StackToKey(parentStack);

        lock (_instancesLock)
        {
            // Deduplicate display names: append #N if another instance already uses this name
            string uniqueDisplayName = displayName;
            int counter = 2;
            while (DisplayNameTaken(uniqueDisplayName, stableId))
            {
                uniqueDisplayName = $"{displayName} #{counter}";
                counter++;
            }

            // CRITICAL: Deep copy settings to prevent shared references!
            var instance = new RegisteredInstance
            {
                InstanceId = stableId,
                DisplayName = uniqueDisplayName,
                NodeStack = nodeStack,
                ParentStack = parentStack,
                PinKey = pinKey,
                IsExported = isExported,
                InstanceNode = instanceNode,
                ColorCorrection = ProjectSettings.CloneColorCorrection(colorCorrection),
                Tonemap = ProjectSettings.CloneTonemap(tonemap),
                InputFilePath = inputFilePath,
                ActivePresetName = activePresetName ?? ""
            };

            _instances[stableId] = instance;

            // Load from JSON if exported and file exists
            if (isExported)
            {
                var loaded = LoadInstanceFromJson(stableId);
                if (loaded != null)
                {
                    instance.ColorCorrection = loaded.ColorCorrection;
                    instance.Tonemap = loaded.Tonemap;
                    instance.InputFilePath = loaded.InputFilePath;
                    instanceNode.SetRuntimeState(loaded.ColorCorrection, loaded.Tonemap, loaded.InputFilePath);
                }
            }

            // Auto-select first instance if none selected
            if (string.IsNullOrEmpty(_selectedInstanceId))
            {
                _selectedInstanceId = stableId;
            }

            GradeLog.Debug(Tag, $"Registered '{uniqueDisplayName}' ({stableId}) pinKey={pinKey} (total: {_instances.Count})");
        }

        _ = BroadcastInstanceList();
        _ = BroadcastState();
    }

    /// <summary>
    /// Unregister a ColorGradingInstance from this service.
    /// </summary>
    public void UnregisterInstance(string instanceGuid)
    {
        lock (_instancesLock)
        {
            if (_instances.TryRemove(instanceGuid, out var removed))
            {
                GradeLog.Debug(Tag, $"Unregistered '{removed.DisplayName}' ({instanceGuid}) (remaining: {_instances.Count})");

                // If we removed the selected instance, select another
                if (_selectedInstanceId == instanceGuid)
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
    /// Update the display name of an instance (when custom ID changes).
    /// Deduplicates display names by appending #N if needed.
    /// </summary>
    public void UpdateInstanceDisplayName(string instanceGuid, string displayName)
    {
        lock (_instancesLock)
        {
            if (_instances.TryGetValue(instanceGuid, out var instance))
            {
                string uniqueName = displayName;
                int counter = 2;
                while (DisplayNameTaken(uniqueName, instanceGuid))
                {
                    uniqueName = $"{displayName} #{counter}";
                    counter++;
                }
                instance.DisplayName = uniqueName;
            }
        }

        _ = BroadcastInstanceList();
    }

    /// <summary>
    /// Check if a display name is already used by another instance (caller must hold _instancesLock).
    /// </summary>
    private bool DisplayNameTaken(string name, string excludeGuid)
    {
        foreach (var kvp in _instances)
        {
            if (kvp.Key != excludeGuid && kvp.Value.DisplayName == name)
                return true;
        }
        return false;
    }

    /// <summary>
    /// Convert an ImmutableStack of UniqueIds to a stable string key for grouping.
    /// Instances sharing the same parent stack key share the same physical pin.
    /// </summary>
    private static string StackToKey(ImmutableStack<UniqueId> stack)
    {
        var sb = new StringBuilder();
        foreach (var id in stack)
        {
            if (sb.Length > 0) sb.Append('/');
            sb.Append(id.ToString());
        }
        return sb.ToString();
    }

    /// <summary>
    /// Natural sort comparison: "Test #2" before "Test #16", not after "Test #19".
    /// Compares strings character by character, treating consecutive digit sequences as numbers.
    /// </summary>
    private static int NaturalCompare(string a, string b)
    {
        int ia = 0, ib = 0;
        while (ia < a.Length && ib < b.Length)
        {
            if (char.IsDigit(a[ia]) && char.IsDigit(b[ib]))
            {
                // Extract and compare number sequences
                int numStartA = ia, numStartB = ib;
                while (ia < a.Length && char.IsDigit(a[ia])) ia++;
                while (ib < b.Length && char.IsDigit(b[ib])) ib++;
                var numA = long.Parse(a.AsSpan(numStartA, ia - numStartA));
                var numB = long.Parse(b.AsSpan(numStartB, ib - numStartB));
                if (numA != numB) return numA.CompareTo(numB);
            }
            else
            {
                if (a[ia] != b[ib]) return a[ia].CompareTo(b[ib]);
                ia++;
                ib++;
            }
        }
        return a.Length.CompareTo(b.Length);
    }

    /// <summary>
    /// Update the default values for an instance (when Create pins change).
    /// CRITICAL: Create DEEP COPIES to prevent instances from sharing object references!
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
                    // CRITICAL: Deep copy to prevent shared references between instances!
                    instance.ColorCorrection = ProjectSettings.CloneColorCorrection(colorCorrection);
                    instance.Tonemap = ProjectSettings.CloneTonemap(tonemap);
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
            GradeLog.Error(Tag, $"Failed to save instance '{instanceId}': {ex.Message}");
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
            GradeLog.Error(Tag, $"Failed to load instance '{instanceId}': {ex.Message}");
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

            // CRITICAL: Deep copy to prevent shared references!
            if (cc != null) instance.ColorCorrection = ProjectSettings.CloneColorCorrection(cc);
            if (tm != null) instance.Tonemap = ProjectSettings.CloneTonemap(tm);
            if (inputFilePath != null) instance.InputFilePath = inputFilePath;

            // Always set runtime state for immediate output (constructor pins don't update mid-session)
            instance.InstanceNode?.SetRuntimeState(
                cc ?? instance.ColorCorrection,
                tm ?? instance.Tonemap,
                inputFilePath ?? instance.InputFilePath);

            if (instance.IsExported)
            {
                SaveInstanceToJson(instanceId, instance.ColorCorrection, instance.Tonemap, instance.InputFilePath);
            }
            else
            {
                // Also persist to the Create pin for document save / undo support
                PersistInstanceToPin(instance);
            }
        }
    }

    /// <summary>
    /// Apply a complete ProjectSettings to an instance from external JSON input.
    /// Used by ColorGradingInstance for manual JSON I/O pins.
    /// Atomic: deep copies all fields, sets runtime state, and persists in a single operation.
    /// </summary>
    internal void ApplySettingsFromJson(string instanceId, ProjectSettings settings)
    {
        lock (_instancesLock)
        {
            if (!_instances.TryGetValue(instanceId, out var instance))
                return;

            // Deep copy all fields at once
            instance.ColorCorrection = ProjectSettings.CloneColorCorrection(settings.ColorCorrection);
            instance.Tonemap = ProjectSettings.CloneTonemap(settings.Tonemap);
            if (!string.IsNullOrEmpty(settings.InputFilePath))
                instance.InputFilePath = settings.InputFilePath;

            // Single runtime state update with complete data
            instance.InstanceNode?.SetRuntimeState(
                instance.ColorCorrection,
                instance.Tonemap,
                instance.InputFilePath);

            // Single persist
            if (instance.IsExported)
            {
                SaveInstanceToJson(instanceId, instance.ColorCorrection, instance.Tonemap, instance.InputFilePath);
            }
            else
            {
                PersistInstanceToPin(instance);
            }
        }

        // Broadcast to web UI clients so they see the change
        _ = BroadcastState();
    }

    /// <summary>
    /// Persist instance state to the "Settings" Create pin on the parent node via SetPinValue.
    /// Writes a dictionary of ALL instances sharing the same physical pin (same PinKey),
    /// keyed by stable instance ID. This supports multiple runtime instances from a looped node.
    /// </summary>
    private void PersistInstanceToPin(RegisteredInstance instance)
    {
        var session = IDevSession.Current;
        if (session == null || instance.ParentStack.IsEmpty)
            return;

        try
        {
            // Collect ALL instances that share this physical pin (same PinKey = same parent node)
            var dict = new Dictionary<string, ProjectSettings>();
            lock (_instancesLock)
            {
                foreach (var kvp in _instances)
                {
                    if (kvp.Value.PinKey == instance.PinKey)
                    {
                        dict[kvp.Key] = new ProjectSettings
                        {
                            ColorCorrection = kvp.Value.ColorCorrection,
                            Tonemap = kvp.Value.Tonemap,
                            InputFilePath = kvp.Value.InputFilePath,
                            PresetName = kvp.Value.ActivePresetName
                        };
                    }
                }
            }

            var json = JsonSerializer.Serialize(dict, PinJsonOptions);

            // Pin name is "Settings" (capital S)
            session.CurrentSolution
                .SetPinValue(instance.ParentStack, "Settings", json)
                .Confirm(SolutionUpdateKind.DontCompile);
        }
        catch (Exception ex)
        {
            GradeLog.Error(Tag, $"SetPinValue failed for '{instance.InstanceId}': {ex.Message}");
        }
    }

    /// <summary>
    /// JSON options for pin persistence (indented for readability in the document).
    /// </summary>
    private static readonly JsonSerializerOptions PinJsonOptions = new()
    {
        WriteIndented = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        Converters = { new JsonStringEnumConverter() }
    };

    /// <summary>
    /// Broadcast instance list to all connected clients (no LINQ).
    /// </summary>
    private async Task BroadcastInstanceList()
    {
        // Build instance list without LINQ
        List<(string Guid, string DisplayName, bool IsActive)> list;
        lock (_instancesLock)
        {
            list = new List<(string, string, bool)>(_instances.Count);
            foreach (var kvp in _instances)
            {
                list.Add((kvp.Key, kvp.Value.DisplayName, kvp.Value.IsActive));
            }
        }
        list.Sort((a, b) => NaturalCompare(a.DisplayName, b.DisplayName));

        // Build array for serialization
        var instanceArray = new object[list.Count];
        for (int i = 0; i < list.Count; i++)
        {
            instanceArray[i] = new
            {
                id = list[i].Guid,
                displayName = list[i].DisplayName,
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

    /// <summary>
    /// Send instance list to a specific client (no LINQ).
    /// </summary>
    private async Task SendInstanceListToClient(WebSocket client)
    {
        if (client.State != WebSocketState.Open)
            return;

        // Build instance list without LINQ
        List<(string Guid, string DisplayName, bool IsActive)> list;
        lock (_instancesLock)
        {
            list = new List<(string, string, bool)>(_instances.Count);
            foreach (var kvp in _instances)
            {
                list.Add((kvp.Key, kvp.Value.DisplayName, kvp.Value.IsActive));
            }
        }
        list.Sort((a, b) => NaturalCompare(a.DisplayName, b.DisplayName));

        // Build array for serialization
        var instanceArray = new object[list.Count];
        for (int i = 0; i < list.Count; i++)
        {
            instanceArray[i] = new
            {
                id = list[i].Guid,
                displayName = list[i].DisplayName,
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

        try
        {
            using var sendCts = new CancellationTokenSource(TimeSpan.FromSeconds(5));
            await client.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, sendCts.Token);
        }
        catch { }
    }

    #endregion

    #region Server Lifecycle

    private void StopServer()
    {
        GradeLog.Info(Tag, "Stopping server...");

        // Stop mDNS first (sends goodbye announcements)
        try { _mdns?.Dispose(); } catch { }
        _mdns = null;

        // Stop HTTPS redirect and directory listeners
        StopHttpsRedirect();
        try { _directoryListener?.Stop(); } catch { }
        try { _directoryListener?.Close(); } catch { }
        _directoryListener = null;
        _ownsDirectory = false;

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

        GradeLog.Info(Tag, "Server stopped.");
    }

    #endregion

    #region HTTP + WebSocket

    private async Task AcceptConnectionsAsync(HttpListener listener, CancellationToken ct)
    {
        while (!ct.IsCancellationRequested && listener.IsListening)
        {
            try
            {
                var contextTask = listener.GetContextAsync();
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
            catch (HttpListenerException) { break; } // Listener stopped (restart or dispose)
            catch (ObjectDisposedException) { break; } // Listener swapped or disposed
            catch (OperationCanceledException) { break; }
            catch (Exception ex)
            {
                if (!ct.IsCancellationRequested && listener.IsListening)
                    GradeLog.Error(Tag, $"Accept error: {ex.Message}");
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
            // Strip the app sub-path prefix (e.g. /grade/machine/app/assets/index.js → /assets/index.js)
            var prefixWithSlash = $"/{_appSubPath}";
            if (path.StartsWith(prefixWithSlash, StringComparison.OrdinalIgnoreCase))
                path = path.Substring(prefixWithSlash.Length);
            if (path == "/" || path == "") path = "/index.html";

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
            GradeLog.Error(Tag, $"HTTP error: {ex.Message}");
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

            // Send instance list to newly connected client only (not broadcast)
            if (_instances.Count > 0)
            {
                await SendInstanceListToClient(ws);
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
        catch (WebSocketException ex) when (ex.WebSocketErrorCode == System.Net.WebSockets.WebSocketError.Success)
        {
            // Normal close — not an error
        }
        catch (WebSocketException ex)
        {
            GradeLog.Warn(Tag, $"Client {clientId} WebSocket error: {ex.WebSocketErrorCode}");
        }
        catch (OperationCanceledException) { }
        catch (Exception ex)
        {
            GradeLog.Error(Tag, $"Client {clientId} unexpected error: {ex.Message}");
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
                        await BroadcastPresetList();
                        await BroadcastState();
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
            GradeLog.Error(Tag, $"Message error: {ex.Message}");
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

        // Mark dirty if a preset is active (values now differ from preset)
        if (!string.IsNullOrEmpty(instance.ActivePresetName))
            instance.IsPresetDirty = true;
    }

    private void HandleReset(string? instanceId)
    {
        if (string.IsNullOrEmpty(instanceId) || !_instances.TryGetValue(instanceId, out var inst))
            return;

        var defaultCC = new ColorCorrectionSettings();
        var defaultTM = new TonemapSettings();
        ApplyInstanceState(instanceId, "colorCorrection", defaultCC, null, null);
        ApplyInstanceState(instanceId, "tonemap", null, defaultTM, null);
        inst.ActivePresetName = "";
    }

    #endregion

    #region Merge Helpers

    private static ColorCorrectionSettings MergeColorCorrection(ColorCorrectionSettings current, JsonElement p)
    {
        var cc = new ColorCorrectionSettings
        {
            InputSpace = current.InputSpace,
            GradingSpace = current.GradingSpace,
            Exposure = current.Exposure,
            Contrast = current.Contrast,
            Saturation = current.Saturation,
            Temperature = current.Temperature,
            Tint = current.Tint,
            Highlights = current.Highlights,
            Shadows = current.Shadows,
            Vibrance = current.Vibrance,
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
            VignetteStrength = current.VignetteStrength,
            VignetteRadius = current.VignetteRadius,
            VignetteSoftness = current.VignetteSoftness
        };

        if (p.TryGetProperty("inputSpace", out var inSpace)) cc.InputSpace = Enum.Parse<HDRColorSpace>(inSpace.GetString() ?? "Linear_Rec709", true);
        if (p.TryGetProperty("gradingSpace", out var gs)) cc.GradingSpace = Enum.Parse<GradingSpace>(gs.GetString() ?? "Log", true);

        if (p.TryGetProperty("exposure", out var exp)) cc.Exposure = exp.GetSingle();
        if (p.TryGetProperty("contrast", out var con)) cc.Contrast = con.GetSingle();
        if (p.TryGetProperty("saturation", out var sat)) cc.Saturation = sat.GetSingle();
        if (p.TryGetProperty("temperature", out var temp)) cc.Temperature = temp.GetSingle();
        if (p.TryGetProperty("tint", out var tint)) cc.Tint = tint.GetSingle();

        if (p.TryGetProperty("highlights", out var hl)) cc.Highlights = hl.GetSingle();
        if (p.TryGetProperty("shadows", out var sh)) cc.Shadows = sh.GetSingle();
        if (p.TryGetProperty("vibrance", out var vib)) cc.Vibrance = vib.GetSingle();

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

        if (p.TryGetProperty("vignetteStrength", out var vs)) cc.VignetteStrength = vs.GetSingle();
        if (p.TryGetProperty("vignetteRadius", out var vr)) cc.VignetteRadius = vr.GetSingle();
        if (p.TryGetProperty("vignetteSoftness", out var vso)) cc.VignetteSoftness = vso.GetSingle();

        return cc;
    }

    private static TonemapSettings MergeTonemap(TonemapSettings current, JsonElement p)
    {
        var tm = new TonemapSettings
        {
            OutputSpace = current.OutputSpace,
            Tonemap = current.Tonemap,
            Exposure = current.Exposure,
            WhitePoint = current.WhitePoint,
            PaperWhite = current.PaperWhite,
            PeakBrightness = current.PeakBrightness,
            BlackLevel = current.BlackLevel,
            WhiteLevel = current.WhiteLevel
        };

        if (p.TryGetProperty("outputSpace", out var outSpace)) tm.OutputSpace = Enum.Parse<HDRColorSpace>(outSpace.GetString() ?? "sRGB", true);
        if (p.TryGetProperty("tonemap", out var op)) tm.Tonemap = Enum.Parse<TonemapOperator>(op.GetString() ?? "ACES", true);
        if (p.TryGetProperty("exposure", out var exp)) tm.Exposure = exp.GetSingle();
        if (p.TryGetProperty("whitePoint", out var wp)) tm.WhitePoint = wp.GetSingle();
        if (p.TryGetProperty("paperWhite", out var pw)) tm.PaperWhite = pw.GetSingle();
        if (p.TryGetProperty("peakBrightness", out var pb)) tm.PeakBrightness = pb.GetSingle();
        if (p.TryGetProperty("blackLevel", out var bl)) tm.BlackLevel = bl.GetSingle();
        if (p.TryGetProperty("whiteLevel", out var wl)) tm.WhiteLevel = wl.GetSingle();

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
                    var instance = kvp.Value;

                    instancesDict[kvp.Key] = new
                    {
                        colorCorrection = instance.ColorCorrection,
                        tonemap = instance.Tonemap,
                        inputFilePath = instance.InputFilePath,
                        presetName = instance.ActivePresetName,
                        isPresetDirty = instance.IsPresetDirty
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

            // Update mDNS instance count
            _mdns?.UpdateInstanceCount(instancesDict.Count);

            var msg = new
            {
                type = "state",
                selectedInstanceId = _selectedInstanceId,
                instances = instancesDict,
                data = selectedData,
                serverInfo = _serverInfo,
                knownServers = _mdns?.KnownServers
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

    /// <summary>
    /// Send a redirect message to all connected clients, telling them to navigate to a new URL.
    /// Blocks until all messages are sent (synchronous wait) so the caller can safely
    /// stop the current listener immediately after.
    /// </summary>
    private void BroadcastRedirect(string newUrl)
    {
        if (_clients.IsEmpty) return;

        GradeLog.Info(Tag, $"Redirecting {_clients.Count} client(s) to {newUrl}");

        var json = JsonSerializer.Serialize(new { type = "redirect", url = newUrl }, JsonOptions);
        var bytes = Encoding.UTF8.GetBytes(json);

        var tasks = new List<Task>();
        foreach (var client in _clients.Values)
        {
            if (client.State == WebSocketState.Open)
            {
                tasks.Add(Task.Run(async () =>
                {
                    try
                    {
                        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(2));
                        await client.SendAsync(new ArraySegment<byte>(bytes),
                            WebSocketMessageType.Text, true, cts.Token);
                    }
                    catch { }
                }));
            }
        }

        // Wait for all sends to complete (with overall timeout)
        if (tasks.Count > 0)
            Task.WaitAll(tasks.ToArray(), TimeSpan.FromSeconds(3));
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

    private async Task BroadcastPresetList()
    {
        foreach (var client in _clients.Values)
        {
            if (client.State == WebSocketState.Open)
                await SendPresetList(client);
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

        if (loaded != null && !string.IsNullOrEmpty(instanceId) && _instances.TryGetValue(instanceId, out var inst))
        {
            ApplyInstanceState(instanceId, "colorCorrection", loaded.ColorCorrection, null, null);
            ApplyInstanceState(instanceId, "tonemap", null, loaded.Tonemap, null);
            ApplyInstanceState(instanceId, "inputFilePath", null, null, loaded.InputFilePath);
            inst.ActivePresetName = name;
            inst.IsPresetDirty = false;
            GradeLog.Debug(Tag, $"Loaded preset '{name}' to instance '{instanceId}'");
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
            instance.ActivePresetName = name;
            instance.IsPresetDirty = false;
            GradeLog.Debug(Tag, $"Saved preset '{name}' from instance '{instanceId}'");
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
