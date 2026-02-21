# Phase 11: Test Verification Framework

**Goal**: Python + Node.js test harness that AI agents can run to verify each pipeline component. Provides deterministic pass/fail signals for the Ralph loop.

## Checklist

- [x] 11.1 Test directory scaffolding
- [x] 11.2 `reference-values.json` — golden reference data
- [x] 11.3 `verify.py` — main verification runner
- [x] 11.4 Per-stage Python math verification
- [x] 11.5 Verify: `python test/verify.py` exits 0

## Task 11.1: Test directory scaffolding

```
pipeline-checker/test/
  fixtures/
    reference-values.json         # Known pixel values + expected stage outputs
  verify.py                       # Main verification runner
  requirements.txt                # numpy
```

## Task 11.2: reference-values.json

Structure:

```json
{
  "testPoints": {
    "midgray":     { "R": 0.18, "G": 0.18, "B": 0.18, "A": 1.0 },
    "white":       { "R": 1.0,  "G": 1.0,  "B": 1.0,  "A": 1.0 },
    "bright_hdr":  { "R": 5.0,  "G": 3.0,  "B": 1.0,  "A": 1.0 },
    "near_black":  { "R": 0.01, "G": 0.005, "B": 0.008, "A": 1.0 }
  },
  "stageExpected": {
    "stage4_inputConvert": {
      "settings": { "inputSpace": 2 },
      "description": "ACEScg -> Linear Rec.709 via AP1_to_Rec709 matrix",
      "tolerance": 0.0001,
      "results": { }
    },
    "stage5_colorGrade_defaults": {
      "settings": { "gradingSpace": 0, "exposure": 0, "contrast": 1, "saturation": 1 },
      "description": "Default grading (passthrough)",
      "tolerance": 0.001,
      "results": { }
    },
    "stage6_rrt_acesFit": {
      "settings": { "tonemapOp": 1 },
      "description": "ACES Fit tonemap",
      "tolerance": 0.01,
      "results": { }
    },
    "stage8_outputEncode_srgb": {
      "settings": { "outputSpace": 5 },
      "description": "Linear Rec.709 -> sRGB",
      "tolerance": 0.001,
      "results": { }
    },
    "stage9_displayRemap": {
      "settings": { "blackLevel": 0.05, "whiteLevel": 0.95 },
      "description": "Black/white remap",
      "tolerance": 0.0001,
      "results": { }
    }
  }
}
```

`"results"` objects populated by Python math reimplementation of each stage.

## Task 11.3: verify.py

```bash
# Verify all stages:
python test/verify.py

# Verify specific stage:
python test/verify.py --stage 4

# Verbose with deltas:
python test/verify.py --verbose
```

**Exit codes**: 0 = all pass, 1 = failures. This is the key Ralph loop integration — agent can only mark shader stories as passing if this returns 0.

**Implementation**: Python reimplementation of key transforms:

- Stage 4: AP1_to_Rec709 matrix multiplication (numpy)
- Stage 5: exposure = color * 2^exposure
- Stage 6: Reinhard = color / (1 + color), ACES fit curve
- Stage 8: sRGB = linear_to_srgb(color)
- Stage 9: remap = black + color * (white - black)

## Verification coverage per story

| Story tasks | Verification | What it tests |
|-------------|-------------|---------------|
| Phase 1 | `npm run build` | Project compiles |
| Phase 3 | `npm run build` | Pipeline types correct |
| Phase 4.1 | `verify.py --stage 4` | Color space matrix math |
| Phase 4.2 | `verify.py --stage 5` | Grading math |
| Phase 4.3 | `verify.py --stage 6` | Tonemap math |
| Phase 4.5 | `verify.py --stage 8` | Output encoding |
| Phase 4.6 | `verify.py --stage 9` | Display remap |
| Phases 5-10 | `npm run build` | Components compile |
