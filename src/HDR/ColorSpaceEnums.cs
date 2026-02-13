namespace VL.OCIO;

/// <summary>
/// Unified color space enum for HDR pipeline
/// Covers all input/output/working spaces
/// </summary>
public enum HDRColorSpace
{
    /// <summary>Linear Rec.709/sRGB primaries - VVVV default</summary>
    Linear_Rec709 = 0,
    /// <summary>Linear Rec.2020 primaries - HDR wide gamut</summary>
    Linear_Rec2020 = 1,
    /// <summary>ACEScg - Linear AP1 primaries (ACES working space)</summary>
    ACEScg = 2,
    /// <summary>ACEScc - Log AP1 (color grading)</summary>
    ACEScc = 3,
    /// <summary>ACEScct - Log AP1 with toe (color grading)</summary>
    ACEScct = 4,
    /// <summary>sRGB - Gamma encoded Rec.709</summary>
    sRGB = 5,
    /// <summary>PQ (ST.2084) Rec.2020 - HDR10 output</summary>
    PQ_Rec2020 = 6,
    /// <summary>HLG (BT.2100) Rec.2020 - Broadcast HDR</summary>
    HLG_Rec2020 = 7,
    /// <summary>scRGB - Linear extended (Windows HDR)</summary>
    scRGB = 8
}

/// <summary>
/// Display output formats - what DirectX/Stride can output to displays
/// </summary>
public enum DisplayFormat
{
    /// <summary>sRGB - Standard SDR output</summary>
    sRGB = 0,
    /// <summary>Linear Rec.709 - scRGB HDR (Windows HDR)</summary>
    Linear_Rec709 = 1,
    /// <summary>PQ Rec.2020 - HDR10 output</summary>
    PQ_Rec2020 = 2
}

/// <summary>
/// Tonemapping operator selection
/// </summary>
public enum TonemapOperator
{
    /// <summary>No tonemapping (passthrough)</summary>
    None = 0,
    /// <summary>ACES RRT+ODT approximation</summary>
    ACES = 1,
    /// <summary>Simple Reinhard</summary>
    Reinhard = 2,
    /// <summary>Extended Reinhard with white point</summary>
    ReinhardExtended = 3
}

/// <summary>
/// Debug visualization modes
/// </summary>
public enum DebugMode
{
    /// <summary>Normal processing</summary>
    Off = 0,
    /// <summary>Show raw input</summary>
    RawInput = 1,
    /// <summary>Visualize ACEScc values directly</summary>
    ACESccVisualize = 2,
    /// <summary>Threshold test: R>0.3, G>0.4, B>0.5</summary>
    ThresholdTest = 3
}

/// <summary>
/// Input/Output color spaces for HDRGrade shader
/// </summary>
public enum IOColorSpace
{
    /// <summary>ACEScg (AP1 linear) - VFX working space, zero conversion</summary>
    ACEScg = 0,
    /// <summary>Linear Rec.709 - sRGB primaries, linear (game engines)</summary>
    Linear709 = 1,
    /// <summary>sRGB - Rec.709 with gamma encoding (web/monitors)</summary>
    sRGB = 2,
    /// <summary>ACEScct - AP1 log encoding (graded footage)</summary>
    ACEScct = 3
}

/// <summary>
/// Internal grading space (where color math happens)
/// </summary>
public enum GradingSpace
{
    /// <summary>Log (ACEScct) - colorist workflow, perceptually uniform (DaVinci style)</summary>
    Log = 0,
    /// <summary>Linear (ACEScg) - VFX workflow, physically accurate (Nuke style)</summary>
    Linear = 1
}
