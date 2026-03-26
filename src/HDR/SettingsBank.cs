using System.Text.Json;
using VL.Lib.Basics.Resources;
using Timer = System.Threading.Timer;
using Path = VL.Lib.IO.Path;

namespace VL.OCIO;

/// <summary>
/// File-backed key/value store for color grading settings.
/// One JSON file holds settings for every key (sequence, channel, etc.).
///
/// All key access goes through the GetSettings() instance method — each channel/shader
/// calls GetSettings with its own key. Missing keys are auto-created with defaults.
///
/// The "editing key" (which key the web UI controls) is set by clicking a key
/// in the Bank panel. It defaults to the first key retrieved via GetSettings().
///
/// Per-key undo/redo is session-scoped (in-memory only, not saved to disk).
/// Rapid edits are debounced into single undo entries (800ms grouping).
///
/// Thread safety: _lock guards all _data.Entries access. Both the vvvv frame thread
/// (Update/GetSettings) and the WebSocket thread (OnSettingsUpdated/HandleBankMessage)
/// share access to the entries dictionary.
/// </summary>
[ProcessNode(HasStateOutput = true)]
public class SettingsBank : IDisposable
{
    private const string Tag = "SettingsBank";
    private const string DefaultKey = "Default";
    private const int UndoDebounceMs = 800;

    // Thread safety: protects _data.Entries, _cachedAllKeys, _undoStacks, _redoStacks, _thumbnails
    private readonly object _lock = new();

    private SettingsBankFile _data = new();
    private Path _cachedPath;
    private string _cachedPathStr = "";

    // Cached key list (rebuilt only on structural changes)
    private string[]? _cachedAllKeys;

    // Editing key — set by web UI click, defaults to first GetSettings() call
    private volatile string? _editingKey;

    // Multi-channel active key tracking (frame-based)
    // Written only on vvvv thread (Update), read snapshot taken under lock in GetBankStateJson
    private HashSet<string> _activeKeys = new();
    private string[] _activeKeysSnapshot = Array.Empty<string>();

    // Per-key undo/redo (session-scoped, not persisted to disk)
    private readonly Dictionary<string, List<ProjectSettings>> _undoStacks = new();
    private readonly Dictionary<string, List<ProjectSettings>> _redoStacks = new();
    private volatile bool _inUndoEditSession;
    private Timer? _undoDebounceTimer;

    // Runtime-only thumbnails per key (fallback to persisted Thumbnail on entry)
    private readonly Dictionary<string, string> _thumbnails = new();

    // Flags set from service/WebSocket thread, consumed in Update()
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

        _undoDebounceTimer = new Timer(_ =>
        {
            _inUndoEditSession = false;
        }, null, Timeout.Infinite, Timeout.Infinite);
    }

    // ─── Update (called every frame by vvvv) ───────────────────────────────

    /// <summary>
    /// Main frame update. Manages file loading, active key tracking, and UI connectivity.
    /// Use GetSettings() to retrieve settings for each channel/key.
    /// </summary>
    public void Update(
        out IReadOnlyList<string> allKeys,
        out string uiUrl,
        out int clientCount,
        out string error,
        Path filePath = default,
        bool autoSave = true,
        bool autoOpenBrowser = true,
        bool publishToNetwork = false)
    {
        // --- Swap active keys and snapshot for WebSocket thread ---
        var prevSnapshot = _activeKeysSnapshot;
        _activeKeysSnapshot = _activeKeys.Count > 0 ? _activeKeys.ToArray() : Array.Empty<string>();
        _activeKeys = new HashSet<string>();
        bool activeKeysChanged = !_activeKeysSnapshot.SequenceEqual(prevSnapshot);

        // Cache autoSave for the service thread
        _autoSave = autoSave;

        // --- File path changed: reload from disk (the ONLY disk read path) ---
        if (filePath != _cachedPath)
        {
            _cachedPath = filePath;
            _cachedPathStr = filePath != default ? filePath.ToString() : "";
            _lastError = "";

            lock (_lock)
            {
                if (!string.IsNullOrEmpty(_cachedPathStr))
                {
                    var loaded = SettingsBankFile.LoadFromPath(_cachedPathStr);
                    if (loaded != null)
                    {
                        _data = loaded;
                    }
                    else if (File.Exists(_cachedPathStr))
                    {
                        _lastError = $"Failed to parse bank file: {_cachedPathStr}";
                        _data = new SettingsBankFile();
                    }
                    else
                    {
                        _data = new SettingsBankFile();
                        _data.SaveToPath(_cachedPathStr);
                    }
                }
                else
                {
                    _data = new SettingsBankFile();
                }

                // Ensure "Default" entry always exists
                if (!_data.Entries.ContainsKey(DefaultKey))
                    _data.Entries[DefaultKey] = new SettingsBankEntry();

                _cachedAllKeys = null;
                _editingKey = DefaultKey;
                _undoStacks.Clear();
                _redoStacks.Clear();
            }
        }

        // --- Consume one-frame flags ---
        _settingsChangedFlag = false;

        // --- UI connectivity (shared with ColorGradingInstance) ---
        _uiHelper.Update(autoOpenBrowser, publishToNetwork);

        // --- Broadcast if active keys changed ---
        if (activeKeysChanged)
            _ = _service?.BroadcastBankStateAsync();

        // --- Output ---
        lock (_lock)
        {
            allKeys = GetAllKeysLocked();
        }
        uiUrl = _uiHelper.UiUrl;
        clientCount = _uiHelper.ClientCount;
        error = _lastError;
    }

    // ─── GetSettings (called via static util SettingsJsonUtils.GetSettings) ─

    /// <summary>
    /// Retrieve settings JSON for any key. Registers the key as "active" this frame.
    /// Missing keys are auto-created with default settings.
    /// </summary>
    internal void GetSettings(
        out string settingsJson,
        out bool found,
        string key = "")
    {
        if (string.IsNullOrEmpty(key))
            key = DefaultKey;

        _activeKeys.Add(key);

        lock (_lock)
        {
            if (!_data.Entries.TryGetValue(key, out var entry))
            {
                entry = new SettingsBankEntry();
                _data.Entries[key] = entry;
                _cachedAllKeys = null;
                if (_autoSave) SaveToDiskLocked();
                _ = _service?.BroadcastBankStateAsync();
                found = false;
            }
            else
            {
                found = true;
            }

            settingsJson = entry.Settings.ToJson();
        }

        // First GetSettings call sets the default editing key
        if (_editingKey == null)
            _editingKey = key;
    }

    /// <summary>Set the thumbnail for a specific key. Called via static util.</summary>
    internal void SetThumbnail(string key, string thumbnail)
    {
        if (string.IsNullOrEmpty(key) || string.IsNullOrEmpty(thumbnail)) return;
        var thumb = thumbnail.StartsWith("data:") ? thumbnail : "data:image/jpeg;base64," + thumbnail;

        lock (_lock)
        {
            if (_thumbnails.TryGetValue(key, out var existing) && existing == thumb) return;
            _thumbnails[key] = thumb;
            if (_data.Entries.TryGetValue(key, out var entry))
            {
                entry.Thumbnail = thumb;
                if (_autoSave) SaveToDiskLocked();
            }
        }
        _ = _service?.BroadcastBankStateAsync();
    }

    // ─── Helpers ────────────────────────────────────────────────────────────

    // Must be called under _lock
    private IReadOnlyList<string> GetAllKeysLocked()
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

    private string EffectiveEditingKey => _editingKey ?? "";

    // ─── Methods called by ColorGradingService (WebSocket/service thread) ──

    /// <summary>
    /// Called by the service after any web UI settings update.
    /// Persists the new settings under the editing key.
    /// </summary>
    internal void OnSettingsUpdated(ColorCorrectionSettings cc, TonemapSettings tm)
    {
        var key = EffectiveEditingKey;
        GradeLog.Debug(Tag, $"OnSettingsUpdated: key='{key}' autoSave={_autoSave} path='{_cachedPathStr}' lift=({cc.Lift.X:F3},{cc.Lift.Y:F3},{cc.Lift.Z:F3})");
        if (string.IsNullOrEmpty(key)) return;

        lock (_lock)
        {
            if (!_data.Entries.TryGetValue(key, out var entry)) return;

            // Undo: snapshot before first edit in a session
            if (!_inUndoEditSession)
            {
                PushUndoLocked(key, entry.Settings.Clone());
                ClearRedoLocked(key);
                _inUndoEditSession = true;
            }

            entry.Settings.ColorCorrection = ProjectSettings.CloneColorCorrection(cc);
            entry.Settings.Tonemap = ProjectSettings.CloneTonemap(tm);
            _settingsChangedFlag = true;

            // Reset debounce timer
            _undoDebounceTimer?.Change(UndoDebounceMs, Timeout.Infinite);

            if (_autoSave) SaveToDiskLocked();
        }
        _ = _service?.BroadcastBankStateAsync();
    }

    /// <summary>
    /// Handle a UI update directly when no ColorGradingInstance exists.
    /// Merges partial CC/TM params into the editing key's settings.
    /// Uses the same merge helpers as the service (exposed as internal static).
    /// </summary>
    internal void HandleDirectUpdate(string? section, JsonElement paramsElement)
    {
        var key = EffectiveEditingKey;
        if (string.IsNullOrEmpty(key)) return;

        lock (_lock)
        {
            if (!_data.Entries.TryGetValue(key, out var entry)) return;

            if (section == "colorCorrection")
            {
                // Undo: snapshot before first edit in a session
                if (!_inUndoEditSession)
                {
                    PushUndoLocked(key, entry.Settings.Clone());
                    ClearRedoLocked(key);
                    _inUndoEditSession = true;
                }

                entry.Settings.ColorCorrection = ColorGradingService.MergeColorCorrection(
                    entry.Settings.ColorCorrection, paramsElement);
                _settingsChangedFlag = true;
                _undoDebounceTimer?.Change(UndoDebounceMs, Timeout.Infinite);
            }
            else if (section == "tonemap")
            {
                if (!_inUndoEditSession)
                {
                    PushUndoLocked(key, entry.Settings.Clone());
                    ClearRedoLocked(key);
                    _inUndoEditSession = true;
                }

                entry.Settings.Tonemap = ColorGradingService.MergeTonemap(
                    entry.Settings.Tonemap, paramsElement);
                _settingsChangedFlag = true;
                _undoDebounceTimer?.Change(UndoDebounceMs, Timeout.Infinite);
            }

            if (_autoSave) SaveToDiskLocked();
        }
        _ = _service?.BroadcastBankStateAsync();
    }

    /// <summary>Routes bank management WebSocket messages from the service.</summary>
    internal void HandleBankMessage(string messageType, JsonElement data)
    {
        try
        {
            var editKey = EffectiveEditingKey;

            lock (_lock)
            {
                switch (messageType)
                {
                    case "bankCopyFrom":
                    {
                        var sourceKey = data.GetProperty("sourceKey").GetString() ?? "";
                        if (string.IsNullOrEmpty(sourceKey) || sourceKey == editKey) return;
                        if (!_data.Entries.TryGetValue(sourceKey, out var source)) return;
                        EnsureEntryLocked(editKey);
                        var target = _data.Entries[editKey];
                        // Push undo before overwriting
                        PushUndoLocked(editKey, target.Settings.Clone());
                        ClearRedoLocked(editKey);
                        target.Settings = source.Settings.Clone();
                        _settingsChangedFlag = true;
                        if (_autoSave) SaveToDiskLocked();
                        break;
                    }
                    case "bankSaveSnapshot":
                    {
                        var name = data.GetProperty("name").GetString() ?? "";
                        if (string.IsNullOrEmpty(name) || string.IsNullOrEmpty(editKey)) return;
                        EnsureEntryLocked(editKey);
                        _data.Entries[editKey].Snapshots[name] = _data.Entries[editKey].Settings.Clone();
                        if (_autoSave) SaveToDiskLocked();
                        break;
                    }
                    case "bankLoadSnapshot":
                    {
                        var name = data.GetProperty("name").GetString() ?? "";
                        if (string.IsNullOrEmpty(name) || string.IsNullOrEmpty(editKey)) return;
                        if (!_data.Entries.TryGetValue(editKey, out var entry)) return;
                        if (!entry.Snapshots.TryGetValue(name, out var snap)) return;
                        PushUndoLocked(editKey, entry.Settings.Clone());
                        ClearRedoLocked(editKey);
                        entry.Settings = snap.Clone();
                        _settingsChangedFlag = true;
                        if (_autoSave) SaveToDiskLocked();
                        break;
                    }
                    case "bankDeleteSnapshot":
                    {
                        var name = data.GetProperty("name").GetString() ?? "";
                        if (string.IsNullOrEmpty(name) || string.IsNullOrEmpty(editKey)) return;
                        if (!_data.Entries.TryGetValue(editKey, out var entry)) return;
                        entry.Snapshots.Remove(name);
                        if (_autoSave) SaveToDiskLocked();
                        break;
                    }
                    case "bankReset":
                    {
                        if (string.IsNullOrEmpty(editKey)) return;
                        EnsureEntryLocked(editKey);
                        var entry = _data.Entries[editKey];
                        PushUndoLocked(editKey, entry.Settings.Clone());
                        ClearRedoLocked(editKey);
                        entry.Snapshots["_preresetbackup"] = entry.Settings.Clone();
                        entry.Settings = new ProjectSettings();
                        _settingsChangedFlag = true;
                        if (_autoSave) SaveToDiskLocked();
                        break;
                    }
                    case "bankSetFriendlyName":
                    {
                        var key = data.GetProperty("key").GetString() ?? "";
                        var name = data.GetProperty("name").GetString() ?? "";
                        if (string.IsNullOrEmpty(key) || !_data.Entries.ContainsKey(key)) return;
                        _data.Entries[key].FriendlyName = string.IsNullOrEmpty(name) ? null : name;
                        if (_autoSave) SaveToDiskLocked();
                        break;
                    }
                    case "bankSelectEditingKey":
                    {
                        var key = data.GetProperty("key").GetString() ?? "";
                        if (!string.IsNullOrEmpty(key) && _data.Entries.TryGetValue(key, out var selEntry))
                        {
                            _editingKey = key;
                            // Push key's settings through the instance path (same as instance switch)
                            // so all UI components update via the proven state→instanceStates flow
                            _service?.ApplyBankKeyToInstance(selEntry.Settings);
                        }
                        break;
                    }
                    case "bankUndo":
                        HandleUndoLocked();
                        break;
                    case "bankRedo":
                        HandleRedoLocked();
                        break;
                    case "bankSave":
                        SaveToDiskLocked();
                        break;
                }
            }

            // Broadcast outside lock
            _ = _service?.BroadcastBankStateAsync();
        }
        catch (Exception ex)
        {
            GradeLog.Error(Tag, $"Bank message error ({messageType}): {ex.Message}");
        }
    }

    // ─── Undo / Redo (must be called under _lock) ───────────────────────────

    private void PushUndoLocked(string key, ProjectSettings state)
    {
        if (!_undoStacks.TryGetValue(key, out var stack))
        {
            stack = new List<ProjectSettings>();
            _undoStacks[key] = stack;
        }
        stack.Add(state);
    }

    private void ClearRedoLocked(string key)
    {
        if (_redoStacks.TryGetValue(key, out var stack))
            stack.Clear();
    }

    private void HandleUndoLocked()
    {
        var key = EffectiveEditingKey;
        if (string.IsNullOrEmpty(key)) return;
        if (!_undoStacks.TryGetValue(key, out var undoStack) || undoStack.Count == 0) return;
        if (!_data.Entries.TryGetValue(key, out var entry)) return;

        if (!_redoStacks.TryGetValue(key, out var redoStack))
        {
            redoStack = new List<ProjectSettings>();
            _redoStacks[key] = redoStack;
        }
        redoStack.Add(entry.Settings.Clone());

        var undoState = undoStack[^1];
        undoStack.RemoveAt(undoStack.Count - 1);
        entry.Settings = undoState;

        _settingsChangedFlag = true;
        if (_autoSave) SaveToDiskLocked();
    }

    private void HandleRedoLocked()
    {
        var key = EffectiveEditingKey;
        if (string.IsNullOrEmpty(key)) return;
        if (!_redoStacks.TryGetValue(key, out var redoStack) || redoStack.Count == 0) return;
        if (!_data.Entries.TryGetValue(key, out var entry)) return;

        PushUndoLocked(key, entry.Settings.Clone());

        var redoState = redoStack[^1];
        redoStack.RemoveAt(redoStack.Count - 1);
        entry.Settings = redoState;

        _settingsChangedFlag = true;
        if (_autoSave) SaveToDiskLocked();
    }

    // ─── Bank State JSON (for web UI) ───────────────────────────────────────

    /// <summary>Returns the current bank state as JSON for the web UI.</summary>
    internal string GetBankStateJson()
    {
        var editKey = EffectiveEditingKey;
        // Snapshot active keys (written on vvvv thread, read here on WebSocket thread)
        var activeSnapshot = _activeKeysSnapshot;

        lock (_lock)
        {
            var snapshots = new List<string>();
            if (!string.IsNullOrEmpty(editKey) && _data.Entries.TryGetValue(editKey, out var editEntry))
            {
                foreach (var k in editEntry.Snapshots.Keys)
                    snapshots.Add(k);
            }

            var friendlyNames = new Dictionary<string, string?>();
            var thumbnails = new Dictionary<string, string?>();
            var keySettings = new Dictionary<string, ProjectSettings>();
            foreach (var kvp in _data.Entries)
            {
                friendlyNames[kvp.Key] = kvp.Value.FriendlyName;
                thumbnails[kvp.Key] = _thumbnails.TryGetValue(kvp.Key, out var thumb) ? thumb : kvp.Value.Thumbnail;
                keySettings[kvp.Key] = kvp.Value.Settings;
            }

            var undoCount = 0;
            var redoCount = 0;
            if (!string.IsNullOrEmpty(editKey))
            {
                if (_undoStacks.TryGetValue(editKey, out var us)) undoCount = us.Count;
                if (_redoStacks.TryGetValue(editKey, out var rs)) redoCount = rs.Count;
            }

            var msg = new
            {
                type = "bankState",
                hasBank = true,
                editingKey = editKey,
                activeKeys = activeSnapshot,
                allKeys = GetAllKeysLocked(),
                friendlyNames,
                thumbnails,
                keySettings,
                currentSnapshots = snapshots,
                undoCount,
                redoCount
            };

            return JsonSerializer.Serialize(msg, SettingsBankFile.JsonOptions);
        }
    }

    // ─── Disk I/O (must be called under _lock) ──────────────────────────────

    private void SaveToDiskLocked()
    {
        if (string.IsNullOrEmpty(_cachedPathStr)) return;
        _data.SaveToPath(_cachedPathStr);
    }

    internal void SaveToDisk()
    {
        lock (_lock) { SaveToDiskLocked(); }
    }

    private void EnsureEntryLocked(string key)
    {
        if (!_data.Entries.ContainsKey(key))
        {
            _data.Entries[key] = new SettingsBankEntry();
            _cachedAllKeys = null;
        }
    }

    /// <inheritdoc/>
    public void Dispose()
    {
        _undoDebounceTimer?.Dispose();
        _service?.UnregisterSettingsBank();
        _serviceHandle.Dispose();
    }
}
