# Phase 4: Color Pipeline WGSL Shaders

> **MUST READ**: `specs-pipeline-checker/sections/section-04-color-pipeline-stages.md` (~830 lines)
> This section contains **essential implementation details** not duplicated here:
> - Complete SDSL->WGSL syntax mapping table (30+ entries, vs 10 here)
> - All 6 gamut matrices with exact float values (Rec709<->Rec2020, Rec709<->AP1, Rec2020<->AP1 including D65<->D60 Bradford)
> - All transfer function formulas (sRGB, ACEScc, ACEScct, PQ/ST.2084, HLG/BT.2100)
> - All 12 tonemap operator algorithms with exact constants: ACES Fit curve coefficients, ACES 1.3 glow/red modifier/C5 spline arrays, ACES 2.0 Daniele Evo tonescale constants, AgX exact sigmoid, Gran Turismo parameters, Uncharted2 shoulder/toe, Khronos PBR Neutral, Lottes curve, Hejl-Burgess
> - Per-stage uniform buffer structs with exact byte offsets
> - ODT variants (ACES 1.3 Rec.709 100nit + Rec.2020 1000nit, ACES 2.0)
>
> Also useful: `specs-pipeline-checker/sections/section-02-shader-transpiler.md` (~948 lines)
> Contains the SDSL->WGSL transpiler design (optional tool), but also has all 6 matrix values pre-transposed for WGSL, a comprehensive syntax mapping table, and per-stage uniform buffer byte offsets. Use as a porting reference even if not building the transpiler.

**Goal**: All 6 color transform stages (4-9) as WGSL shaders, manually ported from SDSL.

## Checklist

- [x] 4.1 `input-convert.wgsl` — Stage 4
- [x] 4.2 `color-grade.wgsl` — Stage 5
- [x] 4.3 `rrt.wgsl` — Stage 6
- [x] 4.4 `odt.wgsl` — Stage 7
- [x] 4.5 `output-encode.wgsl` — Stage 8
- [x] 4.6 `display-remap.wgsl` — Stage 9
- [ ] 4.7 `fullscreen-quad.wgsl` — shared vertex shader
- [ ] 4.8 Wire all stages into PipelineRenderer
- [ ] 4.9 Verify: `npm run build` + visual test

Output directory: `pipeline-checker/src/shaders/generated/`

## SDSL → WGSL Syntax Mapping (use for ALL shaders)

| SDSL | WGSL |
|------|------|
| `float3` | `vec3<f32>` |
| `float3x3` | `mat3x3<f32>` |
| `mul(M, v)` | `M * v` (WGSL column-major — see matrix rule below) |
| `saturate(x)` | `clamp(x, 0.0, 1.0)` |
| `lerp(a, b, t)` | `mix(a, b, t)` |
| `frac(x)` | `fract(x)` |
| `log10(x)` | `log(x) / log(10.0)` or `log2(x) / log2(10.0)` |
| `pow(10.0, y)` | `exp2(y * log2(10.0))` |
| `(int)x` | `i32(x)` |
| `(float)x` | `f32(x)` |
| `static const float3x3 M = ...` | `const M = mat3x3<f32>(...)` |

## CRITICAL: Matrix Transpose Rule

HLSL `mul(M, v)` treats M as row-major. WGSL `M * v` treats M as column-major. **ALL matrices must be transposed.**

Given SDSL:

```hlsl
static const float3x3 Rec709_to_AP1 = float3x3(
    0.6131324, 0.3395381, 0.0473296,  // row 0
    0.0701934, 0.9163539, 0.0134527,  // row 1
    0.0206155, 0.1095697, 0.8698148   // row 2
);
float3 result = mul(Rec709_to_AP1, color);
```

In WGSL (transpose — columns become constructor args):

```wgsl
const Rec709_to_AP1 = mat3x3<f32>(
    vec3<f32>(0.6131324, 0.0701934, 0.0206155),  // column 0
    vec3<f32>(0.3395381, 0.9163539, 0.1095697),  // column 1
    vec3<f32>(0.0473296, 0.0134527, 0.8698148)   // column 2
);
var result = Rec709_to_AP1 * color;
```

**This applies to ALL 6+ matrix constants.**

## WGSL Stage Template

Each stage follows this pattern:

```wgsl
// Auto-generated — DO NOT EDIT
// Source: [SDSL file]
// Stage: N - [name]

struct Uniforms {
    // stage-specific fields with _pad for vec3 alignment
};

@group(0) @binding(0) var inputTexture: texture_2d<f32>;
@group(0) @binding(1) var inputSampler: sampler;
@group(0) @binding(2) var<uniform> u: Uniforms;

// ... ported functions ...

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
};

@vertex
fn vs(@builtin(vertex_index) i: u32) -> VertexOutput {
    var out: VertexOutput;
    let uv = vec2<f32>(f32((i << 1u) & 2u), f32(i & 2u));
    out.position = vec4<f32>(uv * 2.0 - 1.0, 0.0, 1.0);
    out.uv = vec2<f32>(uv.x, 1.0 - uv.y);
    return out;
}

@fragment
fn fs(in: VertexOutput) -> @location(0) vec4<f32> {
    let color = textureSample(inputTexture, inputSampler, in.uv);
    // ... stage-specific processing ...
    return vec4<f32>(result, color.a);
}
```

## Task 4.1: Stage 4 — Input Interpretation (`input-convert.wgsl`)

**Source SDSL**: `shaders/ColorSpaceConversion.sdsl`

**Logic**: Takes raw EXR float values, interprets as specific color space, converts to Linear Rec.709 (pipeline hub).

**Uniforms**: `inputSpace: i32` (0-8, maps to HDRColorSpace enum)

**Key function**: `ToLinearRec709(color, space)` containing:

- All 6 gamut matrices (TRANSPOSED for WGSL)
- All 10 transfer function pairs (sRGB, ACEScc, ACEScct, PQ, HLG, etc.)
- `step()` for branchless ACEScct/HLG paths

## Task 4.2: Stage 5 — Color Grading (`color-grade.wgsl`)

**Source SDSL**: `shaders/HDRGrade_TextureFX.sdsl` + `ColorSpaceConversion.sdsl`

**Logic**:

1. `DecodeInput(color)` — any HDRColorSpace to Linear AP1
2. If gradingSpace == 0: `ApplyGradingLog(linearAP1)` (ACEScct workflow)
3. If gradingSpace == 1: `ApplyGradingLinear(linearAP1)` (ACEScg workflow)

**Uniforms**: All 22 grading parameters (exposure, contrast, saturation, temperature, tint, highlights, shadows, vibrance, lift/gamma/gain/offset as vec3, shadow/midtone/highlight color as vec3, soft clip params). vec3 fields need `_pad: f32`.

**Porting notes**:

- `Vibrance` uses `abs()` comparison — fine in WGSL
- `GetZoneWeights()` uses `smoothstep()` — available in WGSL
- `ApplySoftClip()` uses `step()` + `lerp()` → `step()` + `mix()` in WGSL
- No vignette (screen-space, not color science)

## Task 4.3: Stage 6 — RRT (`rrt.wgsl`)

**Source SDSL**: `shaders/TonemapOperators.sdsl` + `ACES13_RRT_ODT.sdsl` + `ACES20_RRT_ODT.sdsl`

Most complex stage — contains all 12 tonemap operators.

**Uniforms**: `tonemapOp: i32`, `tonemapExposure: f32`, `whitePoint: f32`, `peakBrightness: f32`, `inputSpace: i32`, `outputSpace: i32`

**Porting challenges**:

1. **ACES13 spline arrays**: `const float coefsLow[6]` → `const coefsLow = array<f32, 6>(...)`
2. **Computed array indexing**: `coefsLow[j]` where j is runtime — WGSL allows this if bounds are valid
3. **aces_rgb_2_hue()**: Uses `atan2()` — available in WGSL as `atan2(y, x)`
4. **ACES 2.0 tonescale**: Returns `float4` → `vec4<f32>`

**Pipeline split**: Original shaders combine RRT+ODT. We SPLIT into Stage 6 (RRT only) and Stage 7 (ODT only):

- Operators 0, 1, 4-11 (non-ACES-full): RRT applies full `ApplyTonemap()`, returns Linear Rec.709. ODT is no-op.
- Operators 2, 3 (ACES 1.3/2.0): RRT applies `ACES13_RRT()` or `ACES20_RRT()`, outputs AP1. ODT applies the device transform.

## Task 4.4: Stage 7 — ODT (`odt.wgsl`)

**Logic**:

- tonemapOp == 2 (ACES 1.3): `ACES13_ODT_Rec709_100nits()` or `ACES13_ODT_Rec2020_1000nits()`
- tonemapOp == 3 (ACES 2.0): `ACES20_ODT_Rec709()` or `ACES20_ODT_Rec2020()`
- All other operators: no-op (RRT already output Linear Rec.709)

**Uniforms**: `tonemapOp: i32`, `outputSpace: i32`, `odtTarget: i32`

## Task 4.5: Stage 8 — Output Encoding (`output-encode.wgsl`)

**Source SDSL**: `shaders/ColorSpaceConversion.sdsl` (FromLinearRec709) + `HDRTonemap.sdsl` (output section)

**Logic**: `FromLinearRec709(color, outputSpace)` for standard outputs, plus:

- PQ Rec.2020: paper white normalization + PQ EOTF
- HLG Rec.2020: HLG OETF
- scRGB: scale by paperWhite/80

**Uniforms**: `outputSpace: i32`, `paperWhite: f32`, `peakBrightness: f32`

## Task 4.6: Stage 9 — Display Remap (`display-remap.wgsl`)

Trivial: `color = blackLevel + color * (whiteLevel - blackLevel)`

**Uniforms**: `blackLevel: f32`, `whiteLevel: f32`

## Reference Test Values

| Test | Input | Expected (Linear Rec.709) |
|------|-------|---------------------------|
| Mid-gray passthrough | (0.18, 0.18, 0.18) Linear709 | (0.18, 0.18, 0.18) |
| ACEScg to Rec.709 | (0.18, 0.18, 0.18) ACEScg | AP1_to_Rec709 * input |
| sRGB decode | (0.5, 0.5, 0.5) sRGB | SRgbToLinearPrecise(0.5) |
| ACES fit on white | (1.0, 1.0, 1.0) Linear709 | ~(0.80, 0.80, 0.80) |
| PQ encode | (0.18, 0.18, 0.18) → PQ | PQ(0.18 * 200/10000) |
