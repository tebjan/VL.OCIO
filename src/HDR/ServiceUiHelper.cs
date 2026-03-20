namespace VL.OCIO;

/// <summary>
/// Shared UI connectivity logic for nodes that expose the web UI.
/// Handles browser auto-open, network publish toggle, URL and client count outputs.
/// Used by both ColorGradingInstance and SettingsBank to guarantee identical behavior.
/// </summary>
internal class ServiceUiHelper
{
    private readonly ColorGradingService _service;
    private bool _lastPublishToNetwork;

    public ServiceUiHelper(ColorGradingService service)
    {
        _service = service;
    }

    public string UiUrl => _service.UiUrl;
    public int ClientCount => _service.ClientCount;

    /// <summary>
    /// Call once per frame from Update(). Handles network toggle edge detection
    /// and browser auto-open request (service guards against repeat opens internally).
    /// </summary>
    /// <param name="autoOpenBrowser">Request browser open (safe to call every frame)</param>
    /// <param name="publishToNetwork">Toggle LAN accessibility with edge detection</param>
    public void Update(bool autoOpenBrowser, bool publishToNetwork = false)
    {
        // Network toggle with edge detection
        if (publishToNetwork && !_lastPublishToNetwork)
            _service.EnableNetworkAccess();
        else if (!publishToNetwork && _lastPublishToNetwork)
            _service.DisableNetworkAccess();
        _lastPublishToNetwork = publishToNetwork;

        // Browser auto-open (service guards against repeat opens via _browserOpenRequested flag)
        if (autoOpenBrowser)
            _service.RequestBrowserOpen();
    }
}
