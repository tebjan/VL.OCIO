# Tonemapping Fixes — Grade Tool (2026-06-02)

Designer (Cosku) reported: ACES 2.0 too bright + crushed darks, ACES 1.3 darks
clamped, Reinhard Extended red blacks, "None" not working. Goal: industry-standard
ACES, fix the others. Decision: fix the math in the shaders (no runtime OCIO),
and for ACES 2.0 replicate OCIO's own approach (LUTs + math), baking static SDR
(100-nit) tables into the shader.

## Done
- [x] **Fix 1 — ACES 2.0 "too bright"** (`shaders/HDRTonemap.sdsl`): SDR targets
      (Linear Rec.709 / sRGB) now render the ACES 2.0 output transform at the
      100-nit reference instead of leaking the 1000-nit `peakBrightness`.
      `peakBrightness` is used only for HDR targets (Rec.2020/PQ/HLG/scRGB).
- [x] **Fix 4 — Reinhard Extended red blacks** (`shaders/TonemapOperators.sdsl`):
      clamp the per-channel operator domain to `max(color,0)` (these display
      curves are undefined for negatives; a negative AP1 channel blew up the
      `(1+color)` denominator and the AP1→709 matrix flipped it to positive red).
- [x] **Fix 5 — "None" + HDR encoding** (`shaders/HDRGrade_Tonemap_TextureFX.sdsl`
      `EncodeOutput`): apply PaperWhite/Peak + the tonemap-stage Exposure
      consistently with the tone-mapped path, instead of `FromLinearRec709`'s
      hardcoded PQ=200/HLG÷12/scRGB÷80 scaling.
- [x] **Fix 3 — ACES 1.3 audit** (`shaders/ACES13_RRT_ODT.sdsl`): verified a
      faithful aces-dev port (RRT C5, 48-nit C9 ODT, glow/red-mod, dim-surround,
      `Y_2_linCV`). Contrasty/crushed shadows are authentic ACES 1.x — no bug.
      Tell designers 1.3 and 2.0 are different by design (1.3 contrasty, 2.0 soft).
- [x] **Fix 2 — Real ACES 2.0 CAM DRT (SDR)**:
      - `tools/Aces2TableGen/` — faithful C# port of OCIO v2.5's ACES 2.0
        (Hellwig 2022 CAM JMh DRT). Generates per-hue cusp + reach tables and all
        baked CAM/tonescale/compression params for input=ACEScg(AP1),
        limit=Rec.709, peak=100. Self-tests PASS: CAM round-trip err ~1e-16,
        **mid-gray 0.18 → 0.10 display-linear** (canonical ACES result),
        neutral M=0, limit_J_max=100, tonescale monotonic.
      - `shaders/ACES20_Tables.sdsl` (generated) — baked params + 360-entry tables
        + `ACES2_SampleReach` / `ACES2_SampleCusp` uniform 1° lookups.
      - `shaders/ACES20_RRT_ODT.sdsl` (rewritten) — analytic CAM DRT
        (`ACES2_DRT_Rec709_SDR`) mirroring the verified C#; old per-channel
        Daniele kept as HDR/non-100 fallback. Public API unchanged so
        `HDRTonemap.sdsl` routing (Fix 1) drives the new DRT for SDR.
- [x] **Fix 6 — PaperWhite/PeakBrightness UI**: defaults (200/1000) already
      consistent across `ui/src/types/settings.ts`, C#, presets; slider
      visibility correctly gates on HDR-encoded outputs. The SDR-vs-HDR semantic
      bug was shader-side (Fix 1). No new settings/enums/params added → no UI
      parity change required.

## Verification status
- C# (`VL.OCIO.csproj`) builds clean (0 errors).
- `Aces2TableGen` self-tests pass (algorithm verified).
- `ShaderTranspiler --dry-run`: 6/6 stages OK (parsed the rewritten ODT).
- **PENDING (needs running vvvv — cannot do headlessly):**
  1. Confirm `shaders/ACES20_Tables.sdsl` compiles — it is the ONLY shader using
     root-scope `static const float X[360]` arrays with dynamic indexing. This is
     the #1 risk; if SDSL rejects it, reduce array size or restructure the lookup.
  2. Visually confirm ACES 2.0 SDR: mid-gray 18% ACEScg should read ~0.10
     display-linear (≈sRGB 0.349); compare against Nuke/Resolve ACES 2.0 Rec.709.
  3. Confirm Reinhard Extended lowest-blacks no longer red; "None" HDR levels OK.

## Reference
- `docs/ACES2-OCIO-Reference.md` — full extracted OCIO ACES 2.0 algorithm.

## Update 2 (2026-06-02 afternoon)
- ACES 1.3 verified numerically faithful (mid-gray 0.18 -> 0.104; authentic hard
  highlight shoulder). Fixed the one real OCIO deviation: RRT red modifier now uses
  the exact aces-dev `cubic_basis_shaper` instead of a `smoothstep^2` approximation
  (shaders/ACES13_RRT_ODT.sdsl + tools/Aces2TableGen/Aces13Check.cs).
- Interpolation parity: OCIO samples the reach/cusp tables with INTERP_NEAREST + a
  manual linear lerp in-shader. Our uniform 1-degree table + manual lerp matches that
  interpolation method. Faithful.
- ACES 2.0 HDR: SDR (100 nit Rec.709) is fully baked + faithful. HDR is still the
  per-channel Daniele approximation because the tonescale/cusp tables depend on the
  (user-variable) peak luminance and cannot be fully baked. Baking discrete HDR peaks
  (e.g. 1000 nit Rec.2020) is possible via the generator if a fixed HDR target is fixed.
- PIPESCOPE (pipeline-checker) NOT updated this push. Its ACES 2.0 is still the
  per-channel approximation. Reason: the WGSL cannot be verified headlessly (parity
  harness has a path mismatch; verify-pipeline.mjs needs a real browser; vite build
  does not validate WGSL), and the full CAM DRT is ~600 lines across 3 WGSL stages.
  Shipping unverifiable WGSL into the designers' checker risks breaking it.
  PLAN to finish pipescope parity (do with `node test/verify-pipeline.mjs` in-browser):
    1. Generate WGSL tables (extend tools/Aces2TableGen with a WGSL emitter; var<private>
       array<f32,360> + ACES2_SampleReach/Cusp).
    2. Put the CAM DRT (helpers + ACES2_DRT_Rec709_SDR) in the ODT stage WGSL; for
       ACES 2.0 SDR, RRT outputs exposed AP1, ODT runs the DRT -> Rec.709 display-linear,
       output-encode applies the OETF (mirrors how ACES 1.3 flows through ODT).
    3. Also port the ACES 1.3 cubic_basis_shaper + Reinhard Extended max(0) guard to WGSL.
    4. Rebuild pipeline-checker/dist and commit to trigger the deploy workflow.
