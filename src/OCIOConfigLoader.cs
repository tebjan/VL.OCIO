namespace VL.OCIO;

/// <summary>
/// Load an OCIO config from file. Each instance loads one config.
/// Use multiple instances to load multiple configs into the dropdown.
/// </summary>
[ProcessNode]
public class OCIOConfigLoader : IDisposable
{
    private readonly OCIOConfigService _service;
    private string _cachedPath;
    private string _loadedName;
    private int _lastConfigVersion = -1;

    public OCIOConfigLoader(NodeContext nodeContext)
    {
        _service = OCIOConfigService.GetOrCreate(nodeContext.AppHost);
    }

    public void Update(
        out string name,
        out string error,
        string configPath = null)
    {
        error = null;

        if (string.IsNullOrWhiteSpace(configPath))
        {
            name = _loadedName;
            return;
        }

        // Path changed → load new config
        if (configPath != _cachedPath)
        {
            _cachedPath = configPath;
            _loadedName = _service.LoadConfigFromFile(configPath, out error);
            _lastConfigVersion = _service.ConfigVersion;
            name = _loadedName;
            return;
        }

        // Previous load failed → retry
        if (_loadedName == null)
        {
            _loadedName = _service.LoadConfigFromFile(configPath, out error);
            _lastConfigVersion = _service.ConfigVersion;
            name = _loadedName;
            return;
        }

        // Config version changed → re-ensure our entry is still registered
        var currentVersion = _service.ConfigVersion;
        if (currentVersion != _lastConfigVersion)
        {
            _lastConfigVersion = currentVersion;
            // LoadConfigFromFile handles dedup + re-adds enum entry if missing
            _loadedName = _service.LoadConfigFromFile(_cachedPath, out error);
        }

        name = _loadedName;
    }

    public void Dispose() { }
}
