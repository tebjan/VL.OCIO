using System.ComponentModel;

namespace VL.OCIO;

/// <summary>
/// Utility functions for converting between JSON strings and settings structs.
/// These are pure functions (no state) — they appear as simple nodes in vvvv.
/// Use to manually manage settings outside the web UI workflow.
/// </summary>
public static class SettingsJsonUtils
{
    /// <summary>
    /// Parse a ProjectSettings JSON string into ColorCorrection and Tonemap settings.
    /// Returns defaults and valid=false if the JSON is empty or invalid.
    /// </summary>
    public static (ColorCorrectionSettings colorCorrection, TonemapSettings tonemap, bool valid)
        JsonToSettings(string json)
    {
        if (string.IsNullOrWhiteSpace(json))
            return (new ColorCorrectionSettings(), new TonemapSettings(), false);

        var ps = ProjectSettings.FromJson(json);
        if (ps == null)
            return (new ColorCorrectionSettings(), new TonemapSettings(), false);

        return (ps.ColorCorrection, ps.Tonemap, true);
    }

    /// <summary>
    /// Serialize ColorCorrection and Tonemap settings to a ProjectSettings JSON string.
    /// The resulting string can be passed over the network to a render cluster
    /// or fed back into a ColorGradingInstance via its settingsJson pin.
    /// </summary>
    public static string SettingsToJson(
        ColorCorrectionSettings colorCorrection,
        TonemapSettings tonemap)
    {
        var ps = new ProjectSettings
        {
            ColorCorrection = colorCorrection,
            Tonemap = tonemap
        };
        return ps.ToJson();
    }

    /// <summary>
    /// Compute resize + crop parameters to fit any texture into a 256x144 thumbnail (16:9, cover mode).
    /// First resize uniformly so the shorter axis fits, then center-crop the excess.
    /// </summary>
    /// <param name="resizeSize">Size to resize to before cropping</param>
    /// <param name="cropOffset">Top-left offset for the center crop</param>
    /// <param name="cropSize">Final crop size (equals targetSize)</param>
    /// <param name="sourceSize">Source texture size in pixels</param>
    /// <param name="targetSize">Desired thumbnail size (default 256x144)</param>
    public static void ThumbnailFit(
        out Int2 resizeSize,
        out Int2 cropOffset,
        out Int2 cropSize,
        [DefaultValue(typeof(Int2), "1920,1080")] Int2 sourceSize = default,
        [DefaultValue(typeof(Int2), "256,144")] Int2 targetSize = default)
    {
        if (targetSize.X <= 0 || targetSize.Y <= 0)
            targetSize = new Int2(256, 144);

        if (sourceSize.X <= 0 || sourceSize.Y <= 0)
        {
            resizeSize = targetSize;
            cropOffset = Int2.Zero;
            cropSize = targetSize;
            return;
        }

        // Scale so the shorter axis matches the target (cover mode)
        float scaleX = (float)targetSize.X / sourceSize.X;
        float scaleY = (float)targetSize.Y / sourceSize.Y;
        float scale = Math.Max(scaleX, scaleY);

        resizeSize = new Int2(
            (int)Math.Ceiling(sourceSize.X * scale),
            (int)Math.Ceiling(sourceSize.Y * scale));

        // Center crop the excess
        cropOffset = new Int2(
            (resizeSize.X - targetSize.X) / 2,
            (resizeSize.Y - targetSize.Y) / 2);

        cropSize = targetSize;
    }

    /// <summary>
    /// Set the thumbnail image for a key in the bank.
    /// Null-safe — does nothing if bank is null.
    /// </summary>
    public static void SetThumbnail(
        SettingsBank? bank = null,
        string key = "",
        string thumbnail = "",
        bool set = false)
    {
        if (!set) return;
        bank?.SetThumbnail(string.IsNullOrEmpty(key) ? "Default" : key, thumbnail);
    }

    /// <summary>
    /// Null-safe settings retrieval from a SettingsBank.
    /// Returns empty JSON and found=false if the bank is null or the key is empty.
    /// Safe to call every frame even before the bank is initialized.
    /// </summary>
    /// <param name="settingsJson">Settings JSON for the key, or empty string</param>
    /// <param name="found">True if the key existed (false if just created or bank is null)</param>
    /// <param name="bank">The SettingsBank instance (nullable — returns defaults when null)</param>
    /// <param name="key">The key to look up</param>
    public static void GetSettings(
        out string settingsJson,
        out bool found,
        SettingsBank? bank = null,
        string key = "")
    {
        if (bank == null)
        {
            settingsJson = "";
            found = false;
            return;
        }

        bank.GetSettings(out settingsJson, out found, key);
    }
}
