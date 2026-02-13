using Stride.Core.Mathematics;

namespace VL.OCIO;

/// <summary>
/// Settings for ACEScc color correction shader
/// All values map directly to shader parameters
/// </summary>
public class ColorCorrectionSettings
{
    // Basic adjustments
    public float Exposure { get; set; } = 0f;
    public float Contrast { get; set; } = 1f;
    public float Saturation { get; set; } = 1f;

    // White balance
    public float Temperature { get; set; } = 0f;
    public float Tint { get; set; } = 0f;

    // Lift/Gamma/Gain (color wheels) - stored as RGB vectors
    public Vector3Json Lift { get; set; } = new(0f, 0f, 0f);
    public Vector3Json Gamma { get; set; } = new(1f, 1f, 1f);
    public Vector3Json Gain { get; set; } = new(1f, 1f, 1f);
    public Vector3Json Offset { get; set; } = new(0f, 0f, 0f);

    // Color wheels (shadow/mid/highlight tinting)
    public Vector3Json ShadowColor { get; set; } = new(0f, 0f, 0f);
    public Vector3Json MidtoneColor { get; set; } = new(0f, 0f, 0f);
    public Vector3Json HighlightColor { get; set; } = new(0f, 0f, 0f);

    // Soft clipping
    public float HighlightSoftClip { get; set; } = 0f;
    public float ShadowSoftClip { get; set; } = 0f;
    public float HighlightKnee { get; set; } = 1f;
    public float ShadowKnee { get; set; } = 0.1f;

    // Color space for this shader stage
    public HDRColorSpace InputSpace { get; set; } = HDRColorSpace.Linear_Rec709;
    public HDRColorSpace OutputSpace { get; set; } = HDRColorSpace.Linear_Rec709;

    /// <summary>
    /// Reset all values to defaults
    /// </summary>
    public void Reset()
    {
        Exposure = 0f;
        Contrast = 1f;
        Saturation = 1f;
        Temperature = 0f;
        Tint = 0f;
        Lift = new(0f, 0f, 0f);
        Gamma = new(1f, 1f, 1f);
        Gain = new(1f, 1f, 1f);
        Offset = new(0f, 0f, 0f);
        ShadowColor = new(0f, 0f, 0f);
        MidtoneColor = new(0f, 0f, 0f);
        HighlightColor = new(0f, 0f, 0f);
        HighlightSoftClip = 0f;
        ShadowSoftClip = 0f;
        HighlightKnee = 1f;
        ShadowKnee = 0.1f;
        InputSpace = HDRColorSpace.Linear_Rec709;
        OutputSpace = HDRColorSpace.Linear_Rec709;
    }

    /// <summary>
    /// Split settings into individual out parameters matching shader input order.
    /// Use directly with VVVV nodes for HDRGrade_TextureFX.
    /// </summary>
    public void Split(
        out HDRColorSpace inputSpace,
        out HDRColorSpace outputSpace,
        out float exposure,
        out float contrast,
        out float saturation,
        out float temperature,
        out float tint,
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
        out float shadowKnee)
    {
        inputSpace = InputSpace;
        outputSpace = OutputSpace;
        exposure = Exposure;
        contrast = Contrast;
        saturation = Saturation;
        temperature = Temperature;
        tint = Tint;
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
    }
}

/// <summary>
/// JSON-serializable Vector3 (Stride Vector3 doesn't serialize well)
/// </summary>
public class Vector3Json
{
    public float X { get; set; }
    public float Y { get; set; }
    public float Z { get; set; }

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
