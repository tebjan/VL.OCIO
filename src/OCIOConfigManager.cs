namespace VL.OCIO;

/// <summary>
/// Central OCIO config switcher. Select active config from the dropdown.
/// Outputs list of all available configs with their sources.
/// </summary>
[ProcessNode]
public class OCIOConfigManager : IDisposable
{
    private readonly OCIOConfigService _service;
    private string _cachedSelection;
    private string _cachedConfigList;

    public OCIOConfigManager(NodeContext nodeContext)
    {
        _service = OCIOConfigService.GetOrCreate(nodeContext.AppHost);
    }

    public void Update(
        out string loadedConfigs,
        out string error,
        OCIOConfigEnum config = null)
    {
        error = null;

        var selectedName = config?.Value;
        if (selectedName != null && selectedName != _cachedSelection)
        {
            _cachedSelection = selectedName;
            error = _service.SwitchConfig(selectedName);
            _cachedConfigList = _service.GetConfigList();
        }

        _cachedConfigList ??= _service.GetConfigList();
        loadedConfigs = _cachedConfigList;
    }

    public void Dispose() { }
}
