using Path = VL.Lib.IO.Path;

namespace VL.OCIO;

/// <summary>
/// Load an OCIO config from file. Each instance loads one config.
/// Use multiple instances to load multiple configs into the dropdown.
/// </summary>
[ProcessNode]
public class OCIOConfigLoader : IDisposable
{
    private readonly OCIOConfigService _service;
    private Path _cachedPath;
    private string _loadedName;
    private int _lastConfigVersion = -1;

    public OCIOConfigLoader(NodeContext nodeContext)
    {
        _service = OCIOConfigService.GetOrCreate(nodeContext.AppHost);
    }

    public void Update(
        out string name,
        out string error,
        Path configPath = default)
    {
        error = null;

        // No path provided
        if (configPath == default)
        {
            name = _loadedName;
            return;
        }

        // Path unchanged — check version or retry, no ToString allocation
        if (configPath == _cachedPath)
        {
            // Previous load failed → retry
            if (_loadedName == null)
            {
                _loadedName = _service.LoadConfigFromFile(configPath.ToString(), out error);
                _lastConfigVersion = _service.ConfigVersion;
                name = _loadedName;
                return;
            }

            // Config version changed → re-ensure our entry is still registered
            var currentVersion = _service.ConfigVersion;
            if (currentVersion != _lastConfigVersion)
            {
                _lastConfigVersion = currentVersion;
                _loadedName = _service.LoadConfigFromFile(configPath.ToString(), out error);
            }

            name = _loadedName;
            return;
        }

        // Path changed → load new config
        _cachedPath = configPath;
        _loadedName = _service.LoadConfigFromFile(configPath.ToString(), out error);
        _lastConfigVersion = _service.ConfigVersion;
        name = _loadedName;
    }

    public void Dispose() { }
}
