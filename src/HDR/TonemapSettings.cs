using System.Text.Json.Serialization;
using Stride.Graphics;

namespace VL.OCIO;

/// <summary>
/// Settings for HDR tonemapping shader.
/// Use Split() to extract individual values for vvvv shader pins.
/// </summary>
public class TonemapSettings
{
    [JsonInclude] internal HDRColorSpace OutputSpace { get; set; } = HDRColorSpace.Linear_Rec709;
    [JsonInclude] internal TonemapOperator Tonemap { get; set; } = TonemapOperator.None;
    [JsonInclude] internal float Exposure { get; set; } = 0f;
    [JsonInclude] internal float WhitePoint { get; set; } = 4f;
    [JsonInclude] internal float PaperWhite { get; set; } = 200f;
    [JsonInclude] internal float PeakBrightness { get; set; } = 1000f;
    [JsonInclude] internal float BlackLevel { get; set; } = 0f;
    [JsonInclude] internal float WhiteLevel { get; set; } = 1f;

    /// <summary>
    /// Split settings into individual out parameters matching shader input order.
    /// Outputs render format (RTV — how GPU writes) and view format (SRV — how downstream shaders sample).
    /// For sRGB output: render = UNorm (raw write), view = UNorm_SRgb (sampler decodes to linear).
    /// Wire a non-None PixelFormat into formatOverride to force both formats manually.
    /// </summary>
    public void Split(
        out HDRColorSpace outputSpace,
        out TonemapOperator tonemap,
        out float exposure,
        out float whitePoint,
        out float paperWhite,
        out float peakBrightness,
        out float blackLevel,
        out float whiteLevel,
        out PixelFormat viewFormat,
        out PixelFormat renderFormat,
        PixelFormat formatOverride = PixelFormat.None)
    {
        outputSpace = OutputSpace;
        tonemap = Tonemap;
        exposure = Exposure;
        whitePoint = WhitePoint;
        paperWhite = PaperWhite;
        peakBrightness = PeakBrightness;
        blackLevel = BlackLevel;
        whiteLevel = WhiteLevel;

        if (formatOverride != PixelFormat.None)
        {
            renderFormat = formatOverride;
            viewFormat = formatOverride;

            // Prevent double-gamma: if user chose an sRGB format but the shader
            // already outputs sRGB values, strip sRGB from render format so hardware
            // doesn't re-encode on write
            if (formatOverride.IsSRgb() && OutputSpace == HDRColorSpace.sRGB)
                renderFormat = formatOverride.ToNonSRgb();
        }
        else
        {
            (renderFormat, viewFormat) = DeduceFormats(OutputSpace);
        }
    }

    /// <summary>
    /// Split for the combined HDRGrade_Tonemap shader.
    /// Outputs outputExposure (not exposure) to match the renamed shader pin
    /// that avoids conflict with HDRGrade's Exposure pin.
    /// </summary>
    public void SplitCombined(
        out HDRColorSpace outputSpace,
        out TonemapOperator tonemap,
        out float outputExposure,
        out float whitePoint,
        out float paperWhite,
        out float peakBrightness,
        out float blackLevel,
        out float whiteLevel,
        out PixelFormat viewFormat,
        out PixelFormat renderFormat,
        PixelFormat formatOverride = PixelFormat.None)
    {
        outputSpace = OutputSpace;
        tonemap = Tonemap;
        outputExposure = Exposure;
        whitePoint = WhitePoint;
        paperWhite = PaperWhite;
        peakBrightness = PeakBrightness;
        blackLevel = BlackLevel;
        whiteLevel = WhiteLevel;

        if (formatOverride != PixelFormat.None)
        {
            renderFormat = formatOverride;
            viewFormat = formatOverride;

            if (formatOverride.IsSRgb() && OutputSpace == HDRColorSpace.sRGB)
                renderFormat = formatOverride.ToNonSRgb();
        }
        else
        {
            (renderFormat, viewFormat) = DeduceFormats(OutputSpace);
        }
    }

    /// <summary>
    /// Deduce optimal render (RTV) and view (SRV) formats from the output color space.
    /// sRGB: shader writes gamma values → UNorm RTV (raw write), UNorm_SRgb SRV (sampler decodes to linear).
    /// All others: render = None (inherit input texture format), view = float16.
    /// </summary>
    private static (PixelFormat render, PixelFormat view) DeduceFormats(HDRColorSpace outputSpace)
    {
        return outputSpace switch
        {
            // sRGB: shader outputs gamma values → store raw, SRV decodes to linear
            HDRColorSpace.sRGB => (
                PixelFormat.R8G8B8A8_UNorm,         // RTV: no hw conversion on write
                PixelFormat.R8G8B8A8_UNorm_SRgb),   // SRV: hardware sRGB→linear on Sample

            // Everything else: passthrough render format, float16 view for precision
            _ => (
                PixelFormat.None,                    // RTV: inherit from input texture
                PixelFormat.R16G16B16A16_Float)      // SRV: float16 for downstream sampling
        };
    }
}
