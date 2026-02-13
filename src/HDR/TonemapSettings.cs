namespace VL.OCIO;

/// <summary>
/// Settings for HDR tonemapping shader
/// </summary>
public class TonemapSettings
{
    // Color space configuration
    public HDRColorSpace InputSpace { get; set; } = HDRColorSpace.Linear_Rec709;

    /// <summary>
    /// Output color space for shader (matches ColorSpace enum in shader)
    /// </summary>
    public HDRColorSpace OutputSpace { get; set; } = HDRColorSpace.sRGB;

    // Tonemapping operator
    public TonemapOperator Tonemap { get; set; } = TonemapOperator.ACES;

    // Exposure (pre-tonemap)
    public float Exposure { get; set; } = 0f;

    // Reinhard Extended white point
    public float WhitePoint { get; set; } = 4f;

    // HDR output parameters
    /// <summary>
    /// Paper white level in nits (cd/m²)
    /// SDR: 80-100 nits, HDR: 200-400 nits typical
    /// </summary>
    public float PaperWhite { get; set; } = 200f;

    /// <summary>
    /// Peak brightness in nits for HDR output
    /// Common values: 400, 600, 1000, 2000, 4000, 10000
    /// </summary>
    public float PeakBrightness { get; set; } = 1000f;

    /// <summary>
    /// Reset all values to defaults
    /// </summary>
    public void Reset()
    {
        InputSpace = HDRColorSpace.Linear_Rec709;
        OutputSpace = HDRColorSpace.sRGB;
        Tonemap = TonemapOperator.ACES;
        Exposure = 0f;
        WhitePoint = 4f;
        PaperWhite = 200f;
        PeakBrightness = 1000f;
    }

    /// <summary>
    /// Split settings into individual out parameters matching shader input order.
    /// Use directly with VVVV nodes for HDRTonemap_TextureFX.
    /// </summary>
    public void Split(
        out HDRColorSpace inputSpace,
        out HDRColorSpace outputSpace,
        out TonemapOperator tonemap,
        out float paperWhite,
        out float peakBrightness,
        out float exposure,
        out float whitePoint)
    {
        inputSpace = InputSpace;
        outputSpace = OutputSpace;
        tonemap = Tonemap;
        paperWhite = PaperWhite;
        peakBrightness = PeakBrightness;
        exposure = Exposure;
        whitePoint = WhitePoint;
    }

    /// <summary>
    /// Get the DisplayFormat for VVVV render pipeline configuration.
    /// Maps ColorSpace to the corresponding display format for swapchain setup.
    /// </summary>
    public DisplayFormat GetDisplayFormat()
    {
        return OutputSpace switch
        {
            HDRColorSpace.sRGB => DisplayFormat.sRGB,
            HDRColorSpace.Linear_Rec709 => DisplayFormat.Linear_Rec709,  // scRGB HDR
            HDRColorSpace.scRGB => DisplayFormat.Linear_Rec709,          // scRGB HDR
            HDRColorSpace.PQ_Rec2020 => DisplayFormat.PQ_Rec2020,        // HDR10
            _ => DisplayFormat.sRGB  // Default to SDR for other spaces
        };
    }
}
