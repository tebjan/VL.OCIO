# Lessons

## 2026-06-02 — Tonemapping / ACES 2.0

- **Don't trust a subagent's "fix" recommendation over reference correctness.**
  The first exploration agent proposed adding a "linear passthrough below 1.0" to
  ALL tonemap operators. That would *break* ACES — ACES tone curves are deliberately
  full-range S-curves. Always cross-check proposed fixes against the actual spec.

- **The designer's mental model can be wrong while the bug report is right.**
  Cosku expected "tonemappers only affect values above 1" and "1.3 and 2.0 should
  look the same." Both are misconceptions (tone curves are full-range; 1.3 and 2.0
  are different math by design). But the underlying complaints (2.0 too bright, red
  blacks) were real. Separate the symptom from the proposed explanation.

- **"Industry standard" + "they already have the source" → look in the repo first.**
  OCIO v2.5 is vendored at `src/OCIOSharp/OpenColorIO/`. Its ACES 2.0 reference
  implementation (`ops/fixedfunction/ACES2/Transform.cpp`, `FixedFunctionOpGPU.cpp`)
  is the authoritative blueprint — analytic CAM math + precomputed per-hue cusp/reach
  tables. There is NO trustworthy standalone GLSL/HLSL port online; the official
  refs are CTL/DCTL/Blink/NumPy.

- **Verify color-science ports numerically before shipping.** The ACES 2.0 C#
  port was validated with: CAM round-trip (~1e-16), neutral→M=0, limit_J_max=100,
  and the canonical **mid-gray 0.18 → 0.10 display-linear**. That last value is the
  gold-standard sanity check for any ACES SDR output transform.

- **SDSL gotcha to watch:** root-scope `static const float X[360]` arrays with
  dynamic indexing are NOT used elsewhere in this repo — only local const arrays
  inside functions (spline coefs). Their shader-scope support must be confirmed in
  vvvv at runtime; could not be validated headlessly.

- **Clarify genuinely-ambiguous directives, decide the rest.** User said both
  "don't integrate OCIO" and "do it the way OCIO does it" — a real fork worth one
  question (chose: bake static SDR tables, no .vl wiring). But for conventional
  defaults, just pick and state it.
