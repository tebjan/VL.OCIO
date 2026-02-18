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
    private int _lastConfigVersion = -1;
    private bool _deferSwitch = true;

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

        // First frame: skip switch — let all OCIOConfigLoaders register their configs
        if (_deferSwitch)
        {
            _deferSwitch = false;
            _cachedConfigList = _service.GetConfigList();
            loadedConfigs = _cachedConfigList;
            return;
        }

        var selectedName = config?.Value;
        if (selectedName != null && selectedName != _cachedSelection)
        {
            var switchError = _service.SwitchConfig(selectedName);
            if (switchError == null)
                _cachedSelection = selectedName;
            else
                error = switchError;
        }

        // Refresh list whenever config version changes (loader added/removed configs)
        var currentVersion = _service.ConfigVersion;
        if (currentVersion != _lastConfigVersion)
        {
            _lastConfigVersion = currentVersion;
            _cachedConfigList = _service.GetConfigList();
        }

        _cachedConfigList ??= _service.GetConfigList();
        loadedConfigs = _cachedConfigList;
    }

    public void Dispose() { }
}
