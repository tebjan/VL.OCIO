using System.Text.Json;
using System.Text.Json.Serialization;

namespace VL.OCIO;

/// <summary>
/// One entry in the SettingsBank: active settings + named snapshots for a single key.
/// </summary>
public class SettingsBankEntry
{
    /// <summary>
    /// Optional human-readable label shown in the web UI instead of the raw key.
    /// Purely cosmetic — the key string is always the functional identifier.
    /// Null or empty means show the raw key.
    /// </summary>
    public string? FriendlyName { get; set; }

    /// <summary>Active settings for this key.</summary>
    public ProjectSettings Settings { get; set; } = new();

    /// <summary>Named snapshots (save points) for this key.</summary>
    public Dictionary<string, ProjectSettings> Snapshots { get; set; } = new();
}

/// <summary>
/// The full SettingsBank file: version + dictionary of entries keyed by sequence key.
/// Serialized as a single JSON file on disk.
/// </summary>
public class SettingsBankFile
{
    /// <summary>File format version for future migration.</summary>
    public int Version { get; set; } = 1;

    /// <summary>All entries keyed by sequence/clip key.</summary>
    public Dictionary<string, SettingsBankEntry> Entries { get; set; } = new();

    internal static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        Converters = { new JsonStringEnumConverter() }
    };

    /// <summary>Serialize to JSON string.</summary>
    public string ToJson() => JsonSerializer.Serialize(this, JsonOptions);

    /// <summary>Deserialize from JSON string. Returns null on failure.</summary>
    public static SettingsBankFile? FromJson(string json)
    {
        try { return JsonSerializer.Deserialize<SettingsBankFile>(json, JsonOptions); }
        catch { return null; }
    }

    /// <summary>Load from file path. Returns null if missing or corrupt.</summary>
    public static SettingsBankFile? LoadFromPath(string filePath)
    {
        try
        {
            if (!File.Exists(filePath)) return null;
            return FromJson(File.ReadAllText(filePath));
        }
        catch { return null; }
    }

    /// <summary>
    /// Atomic save: write to a temp file then rename over the target.
    /// This prevents partial writes from corrupting the file.
    /// </summary>
    public bool SaveToPath(string filePath)
    {
        try
        {
            var dir = Path.GetDirectoryName(filePath);
            if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir))
                Directory.CreateDirectory(dir);

            var tmp = filePath + ".tmp";
            File.WriteAllText(tmp, ToJson());
            File.Move(tmp, filePath, overwrite: true);
            return true;
        }
        catch { return false; }
    }
}
