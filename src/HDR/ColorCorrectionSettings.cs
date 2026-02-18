using System.Text.Json.Serialization;
using Stride.Core.Mathematics;

namespace VL.OCIO;

/// <summary>
/// Settings for HDR color correction shader.
/// All values map directly to shader parameters.
/// Use Split() to extract individual values for vvvv shader pins.
/// </summary>
public class ColorCorrectionSettings
{
    // Color space for this shader stage
    [JsonInclude] internal HDRColorSpace InputSpace { get; set; } = HDRColorSpace.Linear_Rec709;
    [JsonInclude] internal GradingSpace GradingSpace { get; set; } = GradingSpace.Log;

    // Basic adjustments
    [JsonInclude] internal float Exposure { get; set; } = 0f;
    [JsonInclude] internal float Contrast { get; set; } = 1f;
    [JsonInclude] internal float Saturation { get; set; } = 1f;

    // White balance
    [JsonInclude] internal float Temperature { get; set; } = 0f;
    [JsonInclude] internal float Tint { get; set; } = 0f;

    // Tonal range (Lightroom-style)
    [JsonInclude] internal float Highlights { get; set; } = 0f;
    [JsonInclude] internal float Shadows { get; set; } = 0f;

    // Smart saturation
    [JsonInclude] internal float Vibrance { get; set; } = 0f;

    // Lift/Gamma/Gain (ASC-CDL style) - stored as RGB vectors
    [JsonInclude] internal Vector3Json Lift { get; set; } = new(0f, 0f, 0f);
    [JsonInclude] internal Vector3Json Gamma { get; set; } = new(1f, 1f, 1f);
    [JsonInclude] internal Vector3Json Gain { get; set; } = new(1f, 1f, 1f);
    [JsonInclude] internal Vector3Json Offset { get; set; } = new(0f, 0f, 0f);

    // Color wheels (shadow/mid/highlight tinting)
    [JsonInclude] internal Vector3Json ShadowColor { get; set; } = new(0f, 0f, 0f);
    [JsonInclude] internal Vector3Json MidtoneColor { get; set; } = new(0f, 0f, 0f);
    [JsonInclude] internal Vector3Json HighlightColor { get; set; } = new(0f, 0f, 0f);

    // Soft clipping
    [JsonInclude] internal float HighlightSoftClip { get; set; } = 0f;
    [JsonInclude] internal float ShadowSoftClip { get; set; } = 0f;
    [JsonInclude] internal float HighlightKnee { get; set; } = 1f;
    [JsonInclude] internal float ShadowKnee { get; set; } = 0.1f;

    // Vignette
    [JsonInclude] internal float VignetteStrength { get; set; } = 0f;
    [JsonInclude] internal float VignetteRadius { get; set; } = 0.7f;
    [JsonInclude] internal float VignetteSoftness { get; set; } = 0.3f;

    /// <summary>
    /// Split settings into individual out parameters matching shader input order.
    /// Use directly with vvvv nodes for HDRGrade_TextureFX or HDRGrade_Tonemap_TextureFX.
    /// </summary>
    public void Split(
        out HDRColorSpace inputSpace,
        out GradingSpace gradingSpace,
        out float exposure,
        out float contrast,
        out float saturation,
        out float temperature,
        out float tint,
        out float highlights,
        out float shadows,
        out float vibrance,
        out Vector3 lift,
        out Vector3 gamma,
        out Vector3 gain,
        out Vector3 offset,
        out Vector3 shadowColor,
        out Vector3 midtoneColor,
        out Vector3 highlightColor,
        out float highlightSoftClip,
        out float shadowSoftClip,
        out float highlightKnee,
        out float shadowKnee,
        out float vignetteStrength,
        out float vignetteRadius,
        out float vignetteSoftness)
    {
        inputSpace = InputSpace;
        gradingSpace = GradingSpace;
        exposure = Exposure;
        contrast = Contrast;
        saturation = Saturation;
        temperature = Temperature;
        tint = Tint;
        highlights = Highlights;
        shadows = Shadows;
        vibrance = Vibrance;
        lift = Lift.ToVector3();
        gamma = Gamma.ToVector3();
        gain = Gain.ToVector3();
        offset = Offset.ToVector3();
        shadowColor = ShadowColor.ToVector3();
        midtoneColor = MidtoneColor.ToVector3();
        highlightColor = HighlightColor.ToVector3();
        highlightSoftClip = HighlightSoftClip;
        shadowSoftClip = ShadowSoftClip;
        highlightKnee = HighlightKnee;
        shadowKnee = ShadowKnee;
        vignetteStrength = VignetteStrength;
        vignetteRadius = VignetteRadius;
        vignetteSoftness = VignetteSoftness;
    }
}

/// <summary>
/// JSON-serializable Vector3 (Stride Vector3 doesn't serialize well).
/// Internal properties — not exposed to vvvv node graph.
/// </summary>
public class Vector3Json
{
    [JsonInclude] internal float X { get; set; }
    [JsonInclude] internal float Y { get; set; }
    [JsonInclude] internal float Z { get; set; }

    public Vector3Json() { }

    public Vector3Json(float x, float y, float z)
    {
        X = x;
        Y = y;
        Z = z;
    }

    /// <summary>
    /// Convert to Stride Vector3
    /// </summary>
    public Vector3 ToVector3() => new(X, Y, Z);

    /// <summary>
    /// Create from Stride Vector3
    /// </summary>
    public static Vector3Json FromVector3(Vector3 v) => new(v.X, v.Y, v.Z);
}
