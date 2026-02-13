using System.Text;
using OCIOSharpCLI;

namespace VL.OCIO;

/// <summary>
/// Per-app singleton managing OCIO config lifecycle.
/// Holds active config, handles switching, file loading with dedup, config list.
/// </summary>
public class OCIOConfigService : IDisposable
{
    private OCIOConfig _activeConfig;
    private string _activeConfigName;
    private readonly Dictionary<string, string> _loadedFilePaths = new(); // name → normalized path
    private bool _initialized;

    public OCIOConfig ActiveConfig => _activeConfig;
    public string ActiveConfigName => _activeConfigName;

    public static OCIOConfigService GetOrCreate(AppHost appHost)
    {
        var existing = appHost.Services.GetService(typeof(OCIOConfigService)) as OCIOConfigService;
        if (existing != null)
            return existing;

        var service = new OCIOConfigService();
        appHost.Services.RegisterService(service);
        return service;
    }

    /// <summary>
    /// Loads the default config if nothing has been loaded yet.
    /// Called lazily by nodes — NOT during assembly scan (where AppHost.Current isn't set).
    /// </summary>
    public void EnsureDefaultLoaded()
    {
        if (!_initialized)
            SwitchConfig("ACES 2.0 CG");
    }

    /// <summary>
    /// Switch to a config by its enum name. Returns error message or null on success.
    /// </summary>
    public string SwitchConfig(string configName)
    {
        if (_initialized && configName == _activeConfigName)
            return null;

        var enumDef = OCIOConfigEnumDefinition.Instance;
        var entries = enumDef.GetAllEntries();

        if (!entries.TryGetValue(configName, out var tagObj) || tagObj is not OCIOConfigTag tag)
            return $"Config not found: {configName}";

        try
        {
            _activeConfig = new OCIOConfig();

            if (tag.IsBuiltin)
                _activeConfig.LoadBuiltinConfig(tag.BuiltinUri);
            else
                _activeConfig.LoadConfig(tag.FilePath);

            _activeConfigName = configName;
            _initialized = true;
            OCIOConfigUtils.RefreshEnumsFrom(_activeConfig);
            return null;
        }
        catch (Exception e)
        {
            return e.Message;
        }
    }

    /// <summary>
    /// Load a config from file and add it to the config enum.
    /// Returns assigned display name (may have #N suffix) or null on error.
    /// </summary>
    public string LoadConfigFromFile(string filePath, out string error)
    {
        if (string.IsNullOrWhiteSpace(filePath))
        {
            error = "Empty file path";
            return null;
        }

        var normalizedPath = Path.GetFullPath(filePath);

        // Dedup: same path already loaded → return existing name
        foreach (var kvp in _loadedFilePaths)
        {
            if (string.Equals(kvp.Value, normalizedPath, StringComparison.OrdinalIgnoreCase))
            {
                error = null;
                return kvp.Key;
            }
        }

        // Derive display name from filename
        var baseName = Path.GetFileNameWithoutExtension(filePath);
        var enumDef = OCIOConfigEnumDefinition.Instance;
        var name = baseName;

        // Handle name collisions with #N suffix
        int counter = 1;
        while (enumDef.HasEntry(name))
        {
            name = $"{baseName} #{counter}";
            counter++;
        }

        // Validate: try loading the config
        try
        {
            var testConfig = new OCIOConfig();
            testConfig.LoadConfig(normalizedPath);
        }
        catch (Exception e)
        {
            error = $"Failed to load config: {e.Message}";
            return null;
        }

        // Add to enum and tracking
        var tag = new OCIOConfigTag
        {
            IsBuiltin = false,
            FilePath = normalizedPath,
            Source = normalizedPath
        };

        enumDef.AddEntry(name, tag);
        _loadedFilePaths[name] = normalizedPath;

        error = null;
        return name;
    }

    /// <summary>
    /// Formatted list of all configs with sources. Active config marked with *.
    /// </summary>
    public string GetConfigList()
    {
        var enumDef = OCIOConfigEnumDefinition.Instance;
        var entries = enumDef.GetAllEntries();
        var sb = new StringBuilder();

        foreach (var kvp in entries)
        {
            if (kvp.Value is OCIOConfigTag tag)
            {
                var marker = kvp.Key == _activeConfigName ? "* " : "  ";
                sb.AppendLine($"{marker}{kvp.Key}: {tag.Source}");
            }
        }

        return sb.ToString().TrimEnd();
    }

    public void Dispose()
    {
        _activeConfig = null;
        _loadedFilePaths.Clear();
    }
}
