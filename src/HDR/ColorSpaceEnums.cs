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
/// Tonemapping operator selection.
/// ACES 1.3/2.0 use full RRT+ODT (output-space-dependent).
/// All other operators work in Linear Rec.709 (pipeline converts automatically).
/// </summary>
public enum TonemapOperator
{
    /// <summary>No tonemapping (passthrough)</summary>
    None = 0,
    /// <summary>ACES (Fit) - Stephen Hill RRT+ODT approximation</summary>
    ACES = 1,
    /// <summary>ACES 1.3 - Full RRT + ODT (segmented spline tone curves)</summary>
    ACES13 = 2,
    /// <summary>ACES 2.0 - Daniele Evo tonescale (simplified, no Hellwig CAM)</summary>
    ACES20 = 3,
    /// <summary>AgX - Troy Sobotka, exact analytical curve (Blender default)</summary>
    AgX = 4,
    /// <summary>Gran Turismo V1 / Uchimura (HDR-aware parametric curve)</summary>
    GranTurismo = 5,
    /// <summary>Uncharted 2 / Hable filmic curve (game industry)</summary>
    Uncharted2 = 6,
    /// <summary>Khronos PBR Neutral (e-commerce, product visualization)</summary>
    KhronosPBRNeutral = 7,
    /// <summary>Lottes - luma-based (Epic Games, The Witness)</summary>
    Lottes = 8,
    /// <summary>Reinhard simple</summary>
    Reinhard = 9,
    /// <summary>Reinhard Extended with white point</summary>
    ReinhardExtended = 10,
    /// <summary>Hejl-Burgess fast approximation</summary>
    HejlBurgess = 11
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
