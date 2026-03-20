using System.Text.Json;
using VL.Lib.Basics.Resources;
using Path = VL.Lib.IO.Path;

namespace VL.OCIO;

/// <summary>
/// File-backed key/value store for color grading settings.
/// One JSON file holds settings for every sequence/clip key.
///
/// Key switching is a PURE IN-MEMORY operation — zero disk I/O, zero allocations
/// for existing keys. Designed for hard real-time environments (render cluster).
///
/// Disk writes happen ONLY when web UI edits settings (autoSave=true) or on
/// explicit bank management operations.
///
/// All management (copy between keys, snapshots, friendly names, reset) is done
/// via the web UI's Bank panel — not via vvvv pins.
/// </summary>
[ProcessNode]
public class SettingsBank : IDisposable
{
    private const string Tag = "SettingsBank";

    private SettingsBankFile _data = new();
    private Path _cachedPath;
    private string _cachedPathStr = "";
    private string _currentKey = "";

    // Cached output JSON for current key (rebuilt only when dirty)
    private string _cachedOutputJson = "";
    private bool _outputJsonDirty = true;

    // Cached key list (rebuilt only on structural changes)
    private string[]? _cachedAllKeys;

    // Runtime-only thumbnails per key (not persisted in bank file)
    // Format: base64-encoded JPEG data URL, e.g. "data:image/jpeg;base64,..."
    // Recommended: 128x72 JPEG for fast transfer
    private readonly Dictionary<string, string> _thumbnails = new();

    // Flags set from service/WebSocket thread, consumed in Update()
    // volatile ensures visibility across threads without locks on single bool
    private volatile bool _settingsChangedFlag;

    // Cached for access from service thread (set in Update)
    private volatile bool _autoSave = true;

    private readonly IResourceHandle<ColorGradingService> _serviceHandle;
    private ColorGradingService? _service;
    private readonly ServiceUiHelper _uiHelper;
    private string _lastError = "";

    public SettingsBank(NodeContext nodeContext)
    {
        var provider = ResourceProvider.NewPooledPerApp(
            () => new ColorGradingService(nodeContext.AppHost),
            delayDisposalInMilliseconds: 2000);
        _serviceHandle = provider.GetHandle();
        _service = _serviceHandle.Resource;
        _uiHelper = new ServiceUiHelper(_service);
        _service.RegisterSettingsBank(this);
    }

    /// <summary>
    /// File-backed per-key settings management for multi-sequence workflows.
    /// Key switching is a pure in-memory operation — safe at render-cluster frame rates.
    /// Can be used standalone or alongside ColorGradingInstance nodes.
    /// </summary>
    /// <param name="currentSettingsJson">Active settings for the current key as JSON (for network distribution)</param>
    /// <param name="applySettings">True for one frame when the current key's settings change (wire to ColorGradingInstance.ApplySettings)</param>
    /// <param name="allKeys">All known keys in the bank</param>
    /// <param name="uiUrl">URL to reach the color grading web UI</param>
    /// <param name="clientCount">Number of connected web UI clients</param>
    /// <param name="error">Last error, empty when ok</param>
    /// <param name="filePath">Path to the settings bank JSON file (loaded once, never touched at runtime)</param>
    /// <param name="currentKey">Active sequence/clip key — switching is pure in-memory, zero disk I/O</param>
    /// <param name="autoSave">When true, saves the file after every web UI edit or bank management operation</param>
    /// <param name="thumbnailDataUrl">Base64 JPEG data URL for the current key's thumbnail (e.g. "data:image/jpeg;base64,..."). Recommended 192x108. Runtime-only, not saved to file.</param>
    /// <param name="setThumbnail">When true, assigns thumbnailDataUrl to the current key. Use a bang so stale data from the previous key doesn't overwrite the new key on switch.</param>
    /// <param name="autoOpenBrowser">Automatically open the web UI in the default browser</param>
    /// <param name="publishToNetwork">Make the grading UI accessible on the local network (requires one-time admin permission)</param>
    public void Update(
        out string currentSettingsJson,
        out bool applySettings,
        out IReadOnlyList<string> allKeys,
        out string uiUrl,
        out int clientCount,
        out string error,
        Path filePath = default,
        string currentKey = "",
        bool autoSave = true,
        string thumbnailDataUrl = "",
        bool setThumbnail = false,
        bool autoOpenBrowser = true,
        bool publishToNetwork = false)
    {
        bool keyJustChanged = false;

        // Cache autoSave for the service thread
        _autoSave = autoSave;

        // --- File path changed: reload from disk (the ONLY disk read path) ---
        if (filePath != _cachedPath)
        {
            _cachedPath = filePath;
            _cachedPathStr = filePath != default ? filePath.ToString() : "";
            _lastError = "";

            if (!string.IsNullOrEmpty(_cachedPathStr))
            {
                var loaded = SettingsBankFile.LoadFromPath(_cachedPathStr);
                if (loaded != null)
                {
                    _data = loaded;
                }
                else if (File.Exists(_cachedPathStr))
                {
                    // File exists but couldn't be parsed
                    _lastError = $"Failed to parse bank file: {_cachedPathStr}";
                    _data = new SettingsBankFile();
                }
                else
                {
                    // File doesn't exist yet — create it with default empty bank
                    _data = new SettingsBankFile();
                    _data.SaveToPath(_cachedPathStr);
                }
            }
            else
            {
                _data = new SettingsBankFile();
            }

            _cachedAllKeys = null;
            _outputJsonDirty = true;
        }

        // --- Current key changed: pure in-memory lookup/create ---
        if (currentKey != _currentKey)
        {
            _currentKey = currentKey;
            keyJustChanged = true;
            _outputJsonDirty = true;

            if (!string.IsNullOrEmpty(currentKey) && !_data.Entries.ContainsKey(currentKey))
            {
                _data.Entries[currentKey] = new SettingsBankEntry();
                _cachedAllKeys = null;
                if (_autoSave) SaveToDisk();
            }

            // Notify UI of key switch
            _ = _service?.BroadcastBankStateAsync();
        }

        // --- Update thumbnail for current key (only on explicit trigger) ---
        if (setThumbnail && !string.IsNullOrEmpty(currentKey) && !string.IsNullOrEmpty(thumbnailDataUrl))
        {
            // Auto-prepend data URL prefix if user provides raw base64
            var thumb = thumbnailDataUrl.StartsWith("data:") ? thumbnailDataUrl : "data:image/jpeg;base64," + thumbnailDataUrl;
            if (!_thumbnails.TryGetValue(currentKey, out var existing) || existing != thumb)
            {
                _thumbnails[currentKey] = thumb;
                _ = _service?.BroadcastBankStateAsync();
            }
        }

        // --- Rebuild output JSON if dirty ---
        if (_outputJsonDirty)
        {
            _cachedOutputJson = BuildOutputJson();
            _outputJsonDirty = false;
        }

        // --- Consume one-frame flags ---
        bool settingsChanged = _settingsChangedFlag;
        _settingsChangedFlag = false;

        // --- UI connectivity (shared with ColorGradingInstance) ---
        _uiHelper.Update(autoOpenBrowser, publishToNetwork);

        // --- Output ---
        currentSettingsJson = _cachedOutputJson;
        applySettings = settingsChanged || keyJustChanged;
        allKeys = GetAllKeys();
        uiUrl = _uiHelper.UiUrl;
        clientCount = _uiHelper.ClientCount;
        error = _lastError;
    }

    private string BuildOutputJson()
    {
        if (string.IsNullOrEmpty(_currentKey))
            return "";

        if (_data.Entries.TryGetValue(_currentKey, out var entry))
            return entry.Settings.ToJson();

        return new ProjectSettings().ToJson();
    }

    private IReadOnlyList<string> GetAllKeys()
    {
        if (_cachedAllKeys == null)
        {
            _cachedAllKeys = new string[_data.Entries.Count];
            var i = 0;
            foreach (var k in _data.Entries.Keys)
                _cachedAllKeys[i++] = k;
        }
        return _cachedAllKeys;
    }

    // ─── Methods called by ColorGradingService (from WebSocket/service thread) ───

    /// <summary>
    /// Called by the service after any web UI settings update.
    /// Persists the new settings under the current key.
    /// </summary>
    internal void OnSettingsUpdated(ColorCorrectionSettings cc, TonemapSettings tm)
    {
        if (string.IsNullOrEmpty(_currentKey)) return;

        EnsureEntry(_currentKey);
        _data.Entries[_currentKey].Settings.ColorCorrection = ProjectSettings.CloneColorCorrection(cc);
        _data.Entries[_currentKey].Settings.Tonemap = ProjectSettings.CloneTonemap(tm);
        _outputJsonDirty = true;
        _settingsChangedFlag = true;

        if (_autoSave)
            SaveToDisk();

        _ = _service?.BroadcastBankStateAsync();
    }

    /// <summary>
    /// Routes bank management WebSocket messages from the service.
    /// </summary>
    internal void HandleBankMessage(string messageType, JsonElement data)
    {
        try
        {
            switch (messageType)
            {
                case "bankCopyFrom":
                {
                    var sourceKey = data.GetProperty("sourceKey").GetString() ?? "";
                    if (string.IsNullOrEmpty(sourceKey) || sourceKey == _currentKey) return;
                    if (!_data.Entries.TryGetValue(sourceKey, out var source)) return;
                    EnsureEntry(_currentKey);
                    _data.Entries[_currentKey].Settings = source.Settings.Clone();
                    _outputJsonDirty = true;
                    _settingsChangedFlag = true;
                    if (_autoSave) SaveToDisk();
                    _ = _service?.BroadcastBankStateAsync();
                    break;
                }
                case "bankSaveSnapshot":
                {
                    var name = data.GetProperty("name").GetString() ?? "";
                    if (string.IsNullOrEmpty(name) || string.IsNullOrEmpty(_currentKey)) return;
                    EnsureEntry(_currentKey);
                    _data.Entries[_currentKey].Snapshots[name] = _data.Entries[_currentKey].Settings.Clone();
                    if (_autoSave) SaveToDisk();
                    _ = _service?.BroadcastBankStateAsync();
                    break;
                }
                case "bankLoadSnapshot":
                {
                    var name = data.GetProperty("name").GetString() ?? "";
                    if (string.IsNullOrEmpty(name) || string.IsNullOrEmpty(_currentKey)) return;
                    if (!_data.Entries.TryGetValue(_currentKey, out var entry)) return;
                    if (!entry.Snapshots.TryGetValue(name, out var snap)) return;
                    entry.Settings = snap.Clone();
                    _outputJsonDirty = true;
                    _settingsChangedFlag = true;
                    if (_autoSave) SaveToDisk();
                    _ = _service?.BroadcastBankStateAsync();
                    break;
                }
                case "bankDeleteSnapshot":
                {
                    var name = data.GetProperty("name").GetString() ?? "";
                    if (string.IsNullOrEmpty(name) || string.IsNullOrEmpty(_currentKey)) return;
                    if (!_data.Entries.TryGetValue(_currentKey, out var entry)) return;
                    entry.Snapshots.Remove(name);
                    if (_autoSave) SaveToDisk();
                    _ = _service?.BroadcastBankStateAsync();
                    break;
                }
                case "bankReset":
                {
                    if (string.IsNullOrEmpty(_currentKey)) return;
                    EnsureEntry(_currentKey);
                    var entry = _data.Entries[_currentKey];
                    // Save current state as backup before resetting
                    entry.Snapshots["_preresetbackup"] = entry.Settings.Clone();
                    entry.Settings = new ProjectSettings();
                    _outputJsonDirty = true;
                    _settingsChangedFlag = true;
                    if (_autoSave) SaveToDisk();
                    _ = _service?.BroadcastBankStateAsync();
                    break;
                }
                case "bankSetFriendlyName":
                {
                    var key = data.GetProperty("key").GetString() ?? "";
                    var name = data.GetProperty("name").GetString() ?? "";
                    if (string.IsNullOrEmpty(key) || !_data.Entries.ContainsKey(key)) return;
                    _data.Entries[key].FriendlyName = string.IsNullOrEmpty(name) ? null : name;
                    if (_autoSave) SaveToDisk();
                    _ = _service?.BroadcastBankStateAsync();
                    break;
                }
                case "bankSave":
                {
                    SaveToDisk();
                    break;
                }
            }
        }
        catch (Exception ex)
        {
            GradeLog.Error(Tag, $"Bank message error ({messageType}): {ex.Message}");
        }
    }

    /// <summary>
    /// Returns the current bank state as JSON for the web UI.
    /// </summary>
    internal string GetBankStateJson()
    {
        var snapshots = new List<string>();
        if (!string.IsNullOrEmpty(_currentKey) && _data.Entries.TryGetValue(_currentKey, out var entry))
        {
            foreach (var k in entry.Snapshots.Keys)
                snapshots.Add(k);
        }

        var friendlyNames = new Dictionary<string, string?>();
        var thumbnails = new Dictionary<string, string?>();
        foreach (var kvp in _data.Entries)
        {
            friendlyNames[kvp.Key] = kvp.Value.FriendlyName;
            thumbnails[kvp.Key] = _thumbnails.TryGetValue(kvp.Key, out var thumb) ? thumb : null;
        }

        var msg = new
        {
            type = "bankState",
            hasBank = true,
            currentKey = _currentKey,
            allKeys = GetAllKeys(),
            friendlyNames,
            thumbnails,
            currentSnapshots = snapshots
        };

        return System.Text.Json.JsonSerializer.Serialize(msg, SettingsBankFile.JsonOptions);
    }

    /// <summary>Explicit save to disk (for bankSave message or when autoSave=false).</summary>
    internal void SaveToDisk()
    {
        if (string.IsNullOrEmpty(_cachedPathStr)) return;
        _data.SaveToPath(_cachedPathStr);
    }

    private void EnsureEntry(string key)
    {
        if (!_data.Entries.ContainsKey(key))
        {
            _data.Entries[key] = new SettingsBankEntry();
            _cachedAllKeys = null;
        }
    }

    public void Dispose()
    {
        _service?.UnregisterSettingsBank();
        _serviceHandle.Dispose();
    }
}
