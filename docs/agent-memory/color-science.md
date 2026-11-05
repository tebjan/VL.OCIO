# Color science and shader knowledge

## OCIO GPU resources

Extracted from OCIO: uniforms, 1D/2D textures, 3D textures and the HLSL shader text. Not extracted: dynamic properties (exposure, contrast, gamma) and the uniform buffer size. A Texture1D needs a SamplerState with the correct interpolation mode. `static const` arrays are embedded in the shader code, not exposed as resources. `GPUResources` carries Shader, Uniforms, Textures and Textures3D from OCIO to VL. The config is a mutable `ConfigRcPtr` so that synthetic linear displays can be added; `AddLinearDisplaysInternal()` runs in both `LoadConfig()` and `LoadBuiltinConfig()`. Dynamic enums use `DynamicEnumBase<T, TDef>` with a `Subject<object>` for observable updates.

## SDSL rules in this repo

- `const` is fine inside functions, not at shader root or class scope; root scope uses `static const` (for example the matrices in `ColorSpaceConversion.sdsl`).
- `bool` is valid. Initialize local variables on declaration.
- Root-scope `static const float[360]` arrays with dynamic indexing (the baked ACES 2.0 cusp and reach tables in `ACES20_Tables.sdsl`) are used by only that shader; check their behavior in vvvv when touching them. Shaders compile only inside vvvv, so a clean C# build says nothing about shader errors.

## Tonemap operators and their native input space

- ACES Hill: AP1 native (the input matrix is split into RRT_SAT for AP1 input and a combined one for BT.709). RRT_SAT factor 0.96, ODT_SAT factor 0.93 (from the ACES reference).
- AgX and Khronos PBR: BT.709 only (AgX inset matrix and Khronos thresholds are tuned for Rec.709).
- Lottes: BT.709 luma coefficients; AP1 luma is {0.2722, 0.6741, 0.0537}.
- GT, Uncharted2, Reinhard, ReinhardExt, HejlBurgess: any linear space (per channel).

## Linear display strategy

Synthetic displays are matrix-only (XYZ D65 to target primaries, no gamma): Linear Rec.709, Rec.2020, P3-D65, AdobeRGB. Views are copied from all existing displays, not only the default, for HDR coverage. AP1 and AP0 displays would need a D65 to D60 chromatic adaptation, which is not implemented.

## ACES 2.0

- Real ACES 2.0 is a hand port of OCIO v2.5's Hellwig-CAM JMh display rendering transform. The vendored OCIO source is under `src/OCIOSharp/OpenColorIO/src/OpenColorIO/ops/fixedfunction/ACES2/`; the algorithm is written up in `docs/ACES2-OCIO-Reference.md`.
- `tools/Aces2TableGen/` generates `shaders/ACES20_Tables.sdsl` (baked parameters and 360-entry cusp and reach tables, uniform 1 degree lookups). Re-run it to regenerate for other peak luminances. `shaders/ACES20_RRT_ODT.sdsl` holds the full CAM DRT for SDR Rec.709 at 100 nits and keeps a per-channel approximation as fallback for HDR and other peaks.
- Decision: bake static tables into the shader, no runtime OCIO and no GPU plumbing in the .vl.
- Sanity checks for any ACES SDR output transform: mid-gray 0.18 maps to about 0.10 display-linear, the CAM round trip is accurate to about 1e-16, neutral input gives colorfulness M of 0.
- ACES 1.3 and 2.0 are different math by design; do not make them match. ACES tone curves are full-range S-curves, so "linear passthrough below 1.0" is wrong for them. The ACES 1.3 red modifier uses the exact aces-dev `cubic_basis_shaper`.
- The SDR path uses 100 nits; `peakBrightness` applies only to HDR targets (Rec.2020, PQ, HLG, scRGB). Reinhard Extended clamps the per-channel domain to `max(color, 0)` because negative AP1 values blow up the denominator and flip red after AP1 to 709. The "None" tonemap applies PaperWhite, Peak and exposure in `HDRGrade_Tonemap_TextureFX.sdsl::EncodeOutput`.

## Working lessons from this area

- Check a subagent's proposed fix against the spec before applying it.
- Separate a user's symptom from their explanation: the complaint can be right while the mental model is wrong.
- When a reference implementation is needed, look in the repo first: OCIO is vendored and its ACES 2.0 code is the authoritative blueprint. No trustworthy standalone GLSL or HLSL port exists; official references are CTL, DCTL, Blink and NumPy.
- Verify color-science ports numerically before shipping (the checks above).
