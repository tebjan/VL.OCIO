using System.Collections.Concurrent;
using System.Net;
using System.Net.Sockets;
using Makaretu.Dns;

namespace VL.OCIO;

/// <summary>
/// Discovered color grading server on the network.
/// </summary>
public record DiscoveredServer(
    string Hostname,
    string Ip,
    int Port,
    bool IsLeader,
    int InstanceCount,
    DateTime LastSeen,
    string Path,
    string AppName);

/// <summary>
/// mDNS-based zero-config discovery for ColorGradingService.
/// Registers the server on the local network, elects a leader that owns
/// the "hdr.local" hostname, and discovers peer servers.
/// </summary>
public class MdnsDiscovery : IDisposable
{
    private const string Tag = "MdnsDiscovery";
    private const string ServiceType = "_colorgrading._tcp";
    private const string LeaderInstanceName = "hdr";
    private const string LeaderHostName = "hdr.local";

    private MulticastService? _mdns;
    private ServiceDiscovery? _sd;
    private ServiceProfile? _ownProfile;
    private ServiceProfile? _leaderProfile;
    private readonly ConcurrentDictionary<string, DiscoveredServer> _knownServers = new();
    private readonly object _lock = new();
    private bool _started;
    private bool _disposed;

    private ushort _port;
    private string _hostname = "";
    private string _lanIp = "";
    private string _appSubPath = "";
    private string _appName = "";

    /// <summary>True if this server owns the "hdr.local" hostname.</summary>
    public bool IsLeader { get; private set; }

    /// <summary>All discovered servers on the network (including self).</summary>
    public DiscoveredServer[] KnownServers
    {
        get
        {
            // Prune stale entries (not seen in 60s)
            var cutoff = DateTime.UtcNow.AddSeconds(-60);
            foreach (var kvp in _knownServers)
            {
                if (kvp.Value.LastSeen < cutoff)
                    _knownServers.TryRemove(kvp.Key, out _);
            }

            var servers = _knownServers.Values.ToArray();
            Array.Sort(servers, (a, b) => string.Compare(a.Hostname, b.Hostname, StringComparison.OrdinalIgnoreCase));
            return servers;
        }
    }

    /// <summary>The hub URL for the leader, e.g. "http://hdr.local/" or with port.</summary>
    public string HubUrl
    {
        get
        {
            if (_port == 80)
                return $"http://{LeaderHostName}/";
            return $"http://{LeaderHostName}:{_port}/";
        }
    }

    /// <summary>
    /// Start mDNS registration and leader election.
    /// Call after the HTTP server is bound and the port is known.
    /// </summary>
    public void Start(ushort port, string? lanIp = null, string? appSubPath = null, string? appName = null)
    {
        lock (_lock)
        {
            if (_started || _disposed) return;
            _started = true;
        }

        _port = port;
        _hostname = Dns.GetHostName();
        _lanIp = lanIp ?? GetLanIPAddress() ?? "127.0.0.1";
        _appSubPath = appSubPath ?? "";
        _appName = appName ?? "";

        try
        {
            _mdns = new MulticastService();
            _sd = new ServiceDiscovery(_mdns);

            // Listen for peers
            _sd.ServiceInstanceDiscovered += OnServiceInstanceDiscovered;
            _sd.ServiceInstanceShutdown += OnServiceInstanceShutdown;

            // When a network interface comes up, query for peers
            _mdns.NetworkInterfaceDiscovered += (s, e) =>
            {
                try { _sd?.QueryServiceInstances(ServiceType); }
                catch { }
            };

            // Listen for detailed answers (SRV + TXT records)
            _mdns.AnswerReceived += OnAnswerReceived;

            _mdns.Start();

            // Register own service (always, regardless of leader status)
            RegisterOwnService();

            // Try to claim leader name
            TryClaimLeadership();

            // Add self to known servers (keyed by hostname:path for multi-app support)
            var selfKey = string.IsNullOrEmpty(_appSubPath) ? _hostname : $"{_hostname}:{_appSubPath}";
            _knownServers[selfKey] = new DiscoveredServer(
                _hostname, _lanIp, _port, IsLeader, 0, DateTime.UtcNow, _appSubPath, _appName);

            GradeLog.Info(Tag, $"Started (leader={IsLeader}, hostname={_hostname})");
            if (IsLeader)
                GradeLog.Info(Tag, $"Hub: {HubUrl}");
        }
        catch (Exception ex)
        {
            GradeLog.Warn(Tag, $"Failed to start (mDNS unavailable, using IP): {ex.Message}");
            // Server continues without mDNS — IP-based access still works
        }
    }

    private void RegisterOwnService()
    {
        if (_sd == null || _mdns == null) return;

        // Use hostname-appslug as instance name to avoid mDNS collisions between apps on same machine
        var instanceName = string.IsNullOrEmpty(_appName)
            ? _hostname
            : $"{_hostname}-{Slugify(_appName)}";

        _ownProfile = new ServiceProfile(instanceName, ServiceType, _port);
        _ownProfile.AddProperty("ip", _lanIp);
        _ownProfile.AddProperty("port", _port.ToString());
        _ownProfile.AddProperty("path", _appSubPath);
        _ownProfile.AddProperty("appname", _appName);

        try
        {
            _sd.Advertise(_ownProfile);
            _sd.Announce(_ownProfile);
        }
        catch (Exception ex)
        {
            GradeLog.Warn(Tag, $"Failed to register service: {ex.Message}");
        }
    }

    private static string Slugify(string input)
    {
        if (string.IsNullOrWhiteSpace(input)) return "app";
        var sb = new System.Text.StringBuilder(input.Length);
        foreach (char c in input.ToLowerInvariant())
        {
            if (char.IsLetterOrDigit(c)) sb.Append(c);
            else if (c == ' ' || c == '_' || c == '-') sb.Append('-');
        }
        var result = sb.ToString().Trim('-');
        return string.IsNullOrEmpty(result) ? "app" : result;
    }

    private void TryClaimLeadership()
    {
        if (_sd == null || _mdns == null) return;

        try
        {
            var profile = new ServiceProfile(LeaderInstanceName, ServiceType, _port);

            // Override hostname to our desired .local name
            profile.HostName = LeaderHostName;

            // Clear auto-generated address records and add our IP
            profile.Resources.RemoveAll(r => r is AddressRecord);
            var aRecord = new ARecord
            {
                Name = LeaderHostName,
                Address = IPAddress.Parse(_lanIp),
                TTL = TimeSpan.FromMinutes(2)
            };
            profile.Resources.Add(aRecord);

            // Update SRV record target
            foreach (var srv in profile.Resources.OfType<SRVRecord>())
            {
                srv.Target = new DomainName(LeaderHostName);
            }

            bool conflict = _sd.Probe(profile);
            if (!conflict)
            {
                _sd.Advertise(profile);
                _sd.Announce(profile);
                _leaderProfile = profile;
                IsLeader = true;
            }
            else
            {
                GradeLog.Info(Tag, "Another leader exists, running as follower");
                IsLeader = false;
            }
        }
        catch (Exception ex)
        {
            GradeLog.Warn(Tag, $"Leader election failed: {ex.Message}");
            IsLeader = false;
        }
    }

    private void OnServiceInstanceDiscovered(object? sender, ServiceInstanceDiscoveryEventArgs e)
    {
        try
        {
            var name = e.ServiceInstanceName.ToString();
            if (!name.Contains(ServiceType)) return;

            // Query for SRV + TXT details
            _mdns?.SendQuery(e.ServiceInstanceName, type: DnsType.SRV);
            _mdns?.SendQuery(e.ServiceInstanceName, type: DnsType.TXT);
        }
        catch { }
    }

    private void OnServiceInstanceShutdown(object? sender, ServiceInstanceShutdownEventArgs e)
    {
        try
        {
            var name = e.ServiceInstanceName.ToString();

            // If the leader service shut down, try to claim leadership
            if (name.Contains(LeaderInstanceName) && !IsLeader)
            {
                GradeLog.Info(Tag, "Leader departed, attempting to claim leadership...");
                // Random jitter to avoid simultaneous probe storms
                var jitter = Random.Shared.Next(100, 600);
                Task.Delay(jitter).ContinueWith(_ =>
                {
                    if (!_disposed && !IsLeader)
                    {
                        TryClaimLeadership();
                        if (IsLeader)
                        {
                            GradeLog.Info(Tag, $"Claimed leadership! Hub: {HubUrl}");
                            // Update self in known servers
                            var selfKey = string.IsNullOrEmpty(_appSubPath) ? _hostname : $"{_hostname}:{_appSubPath}";
                            _knownServers[selfKey] = _knownServers.TryGetValue(selfKey, out var self)
                                ? self with { IsLeader = true, LastSeen = DateTime.UtcNow }
                                : new DiscoveredServer(_hostname, _lanIp, _port, true, 0, DateTime.UtcNow, _appSubPath, _appName);
                        }
                    }
                });
            }

            // Remove the departed server from known list
            // Extract instance name from service instance name (format: "hostname-app._colorgrading._tcp.local")
            var parts = name.Split('.');
            if (parts.Length > 0)
            {
                var instancePart = parts[0];
                // Try removing by instance name prefix match (hostname or hostname-appslug)
                foreach (var key in _knownServers.Keys)
                {
                    if (key == instancePart || key.StartsWith(instancePart + ":"))
                    {
                        _knownServers.TryRemove(key, out _);
                        break;
                    }
                }
            }
        }
        catch { }
    }

    private void OnAnswerReceived(object? sender, MessageEventArgs e)
    {
        try
        {
            string? peerHostname = null;
            string? peerIp = null;
            int peerPort = 0;
            bool peerIsLeader = false;
            string peerPath = "";
            string peerAppName = "";

            // Extract info from SRV records
            foreach (var srv in e.Message.Answers.OfType<SRVRecord>())
            {
                if (!srv.Name.ToString().Contains(ServiceType)) continue;

                // Extract instance name from SRV record name
                var srvName = srv.Name.ToString();
                var instancePart = srvName.Split('.')[0];

                if (instancePart == LeaderInstanceName)
                {
                    peerIsLeader = true;
                    // Query for the actual server's address
                    _mdns?.SendQuery(srv.Target, type: DnsType.A);
                    continue;
                }

                peerHostname = instancePart;
                peerPort = srv.Port;

                // Resolve hostname to IP
                _mdns?.SendQuery(srv.Target, type: DnsType.A);
            }

            // Extract IP from address records
            foreach (var addr in e.Message.Answers.OfType<AddressRecord>())
            {
                if (addr.Address.AddressFamily == AddressFamily.InterNetwork)
                {
                    peerIp = addr.Address.ToString();
                }
            }

            // Extract info from TXT records
            foreach (var txt in e.Message.Answers.OfType<TXTRecord>())
            {
                if (!txt.Name.ToString().Contains(ServiceType)) continue;

                foreach (var s in txt.Strings)
                {
                    if (s.StartsWith("ip="))
                        peerIp ??= s.Substring(3);
                    else if (s.StartsWith("port=") && int.TryParse(s.Substring(5), out var p))
                        peerPort = p;
                    else if (s.StartsWith("path="))
                        peerPath = s.Substring(5);
                    else if (s.StartsWith("appname="))
                        peerAppName = s.Substring(8);
                }

                // Get hostname from TXT record name
                var txtName = txt.Name.ToString();
                var txtParts = txtName.Split('.');
                if (txtParts.Length > 0 && txtParts[0] != LeaderInstanceName)
                    peerHostname ??= txtParts[0];
            }

            // Update known servers if we have enough info
            if (peerHostname != null && peerIp != null && peerPort > 0)
            {
                // Extract actual hostname from instance name (hostname-appslug → hostname)
                var actualHostname = peerHostname;
                var dashIdx = peerHostname.IndexOf('-');
                if (dashIdx > 0 && !string.IsNullOrEmpty(peerPath))
                    actualHostname = peerHostname.Substring(0, dashIdx);

                // Skip self
                var selfKey = string.IsNullOrEmpty(_appSubPath) ? _hostname : $"{_hostname}:{_appSubPath}";
                var peerKey = string.IsNullOrEmpty(peerPath) ? actualHostname : $"{actualHostname}:{peerPath}";
                if (peerKey == selfKey) return;

                _knownServers[peerKey] = new DiscoveredServer(
                    actualHostname, peerIp, peerPort, peerIsLeader, 0, DateTime.UtcNow, peerPath, peerAppName);
            }
        }
        catch { }
    }

    /// <summary>
    /// Update the instance count for this server (called when instances change).
    /// </summary>
    public void UpdateInstanceCount(int count)
    {
        var selfKey = string.IsNullOrEmpty(_appSubPath) ? _hostname : $"{_hostname}:{_appSubPath}";
        if (_knownServers.TryGetValue(selfKey, out var self))
        {
            _knownServers[selfKey] = self with { InstanceCount = count, LastSeen = DateTime.UtcNow };
        }
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;

        try
        {
            if (_leaderProfile != null)
            {
                try { _sd?.Unadvertise(_leaderProfile); } catch { }
            }
            if (_ownProfile != null)
            {
                try { _sd?.Unadvertise(_ownProfile); } catch { }
            }
            try { _sd?.Dispose(); } catch { }
            try { _mdns?.Stop(); } catch { }
        }
        catch { }

        GradeLog.Info(Tag, "Stopped");
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
}
