using System.Text.Json.Serialization;
using Stride.Graphics;

namespace VL.OCIO;

/// <summary>
/// Settings for HDR tonemapping shader.
/// Use Split() to extract individual values for vvvv shader pins.
/// </summary>
public class TonemapSettings
{
    [JsonInclude] internal HDRColorSpace InputSpace { get; set; } = HDRColorSpace.Linear_Rec709;
    [JsonInclude] internal HDRColorSpace OutputSpace { get; set; } = HDRColorSpace.sRGB;
    [JsonInclude] internal TonemapOperator Tonemap { get; set; } = TonemapOperator.ACES;
    [JsonInclude] internal float Exposure { get; set; } = 0f;
    [JsonInclude] internal float WhitePoint { get; set; } = 4f;
    [JsonInclude] internal float PaperWhite { get; set; } = 200f;
    [JsonInclude] internal float PeakBrightness { get; set; } = 1000f;

    /// <summary>
    /// Split settings into individual out parameters matching shader input order.
    /// Outputs a Stride PixelFormat for the render target (default: R8G8B8A8_UNorm_SRgb).
    /// Wire a non-None PixelFormat into renderFormatOverride to use a custom format instead.
    /// </summary>
    public void Split(
        out HDRColorSpace inputSpace,
        out HDRColorSpace outputSpace,
        out TonemapOperator tonemap,
        out float paperWhite,
        out float peakBrightness,
        out float exposure,
        out float whitePoint,
        out PixelFormat renderFormat,
        PixelFormat renderFormatOverride = PixelFormat.None)
    {
        inputSpace = InputSpace;
        outputSpace = OutputSpace;
        tonemap = Tonemap;
        paperWhite = PaperWhite;
        peakBrightness = PeakBrightness;
        exposure = Exposure;
        whitePoint = WhitePoint;
        renderFormat = renderFormatOverride != PixelFormat.None
            ? renderFormatOverride
            : PixelFormat.R8G8B8A8_UNorm_SRgb;
    }

    /// <summary>
    /// Get the DisplayFormat for vvvv render pipeline configuration.
    /// Maps OutputSpace to the corresponding display format for swapchain setup.
    /// </summary>
    public DisplayFormat GetDisplayFormat()
    {
        return OutputSpace switch
        {
            HDRColorSpace.sRGB => DisplayFormat.sRGB,
            HDRColorSpace.Linear_Rec709 => DisplayFormat.Linear_Rec709,
            HDRColorSpace.scRGB => DisplayFormat.Linear_Rec709,
            HDRColorSpace.PQ_Rec2020 => DisplayFormat.PQ_Rec2020,
            _ => DisplayFormat.sRGB
        };
    }
}
