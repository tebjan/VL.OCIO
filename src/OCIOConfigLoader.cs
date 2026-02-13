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

    public OCIOConfigLoader(NodeContext nodeContext)
    {
        _service = OCIOConfigService.GetOrCreate(nodeContext.AppHost);
    }

    public void Update(
        out string name,
        out string error,
        string configPath = null)
    {
        if (string.IsNullOrWhiteSpace(configPath) || configPath == _cachedPath)
        {
            name = _loadedName;
            error = null;
            return;
        }

        _cachedPath = configPath;
        _loadedName = _service.LoadConfigFromFile(configPath, out error);
        name = _loadedName;
    }

    public void Dispose() { }
}
