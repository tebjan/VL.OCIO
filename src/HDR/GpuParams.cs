#pragma warning disable CS1591
using System.Runtime.InteropServices;
using Stride.Core.Mathematics;

namespace VL.OCIO;

[StructLayout(LayoutKind.Sequential)]
public struct ColorCorrectionGpuParams
{
    public HDRColorSpace InputSpace;
    public GradingSpace GradingSpace;
    public float Exposure;
    public float Contrast;
    public float Saturation;
    public float Temperature;
    public float Tint;
    public float Highlights;
    public float Shadows;
    public float Vibrance;
    public Vector3 Lift;
    public Vector3 Gamma;
    public Vector3 Gain;
    public Vector3 Offset;
    public Vector3 ShadowColor;
    public Vector3 MidtoneColor;
    public Vector3 HighlightColor;
    public float HighlightSoftClip;
    public float ShadowSoftClip;
    public float HighlightKnee;
    public float ShadowKnee;
    public float VignetteStrength;
    public float VignetteRadius;
    public float VignetteSoftness;
}

[StructLayout(LayoutKind.Sequential)]
public struct TonemapGpuParams
{
    public HDRColorSpace OutputSpace;
    public TonemapOperator Tonemap;
    public float Exposure;
    public float WhitePoint;
    public float PaperWhite;
    public float PeakBrightness;
    public float BlackLevel;
    public float WhiteLevel;
}
#pragma warning restore CS1591
