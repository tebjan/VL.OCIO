using System.Text.Json;
using System.Text.Json.Serialization;

namespace VL.OCIO;

/// <summary>
/// Complete project settings including color correction and tonemap
/// </summary>
public class ProjectSettings
{
    /// <summary>
    /// Input file path (DDS texture, etc.)
    /// </summary>
    public string InputFilePath { get; set; } = "";

    /// <summary>
    /// Color correction settings (ACEScc shader)
    /// </summary>
    public ColorCorrectionSettings ColorCorrection { get; set; } = new();

    /// <summary>
    /// Tonemap settings
    /// </summary>
    public TonemapSettings Tonemap { get; set; } = new();

    /// <summary>
    /// Current preset name
    /// </summary>
    public string PresetName { get; set; } = "Default";

    /// <summary>
    /// JSON serialization options for consistent formatting
    /// </summary>
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) }
    };

    /// <summary>
    /// Serialize to JSON string
    /// </summary>
    public string ToJson() => JsonSerializer.Serialize(this, JsonOptions);

    /// <summary>
    /// Deserialize from JSON string
    /// </summary>
    public static ProjectSettings? FromJson(string json)
    {
        try
        {
            return JsonSerializer.Deserialize<ProjectSettings>(json, JsonOptions);
        }
        catch
        {
            return null;
        }
    }

    /// <summary>
    /// Save to file
    /// </summary>
    public bool SaveToFile(string filePath)
    {
        try
        {
            var dir = Path.GetDirectoryName(filePath);
            if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir))
            {
                Directory.CreateDirectory(dir);
            }
            File.WriteAllText(filePath, ToJson());
            return true;
        }
        catch
        {
            return false;
        }
    }

    /// <summary>
    /// Load from file
    /// </summary>
    public static ProjectSettings? LoadFromFile(string filePath)
    {
        try
        {
            if (!File.Exists(filePath))
                return null;
            var json = File.ReadAllText(filePath);
            return FromJson(json);
        }
        catch
        {
            return null;
        }
    }

    /// <summary>
    /// Reset all settings to defaults
    /// </summary>
    public void Reset()
    {
        InputFilePath = "";
        ColorCorrection = new ColorCorrectionSettings();
        Tonemap = new TonemapSettings();
        PresetName = "Default";
    }

    /// <summary>
    /// Create a deep copy
    /// </summary>
    public ProjectSettings Clone()
    {
        var json = ToJson();
        return FromJson(json) ?? new ProjectSettings();
    }
}
