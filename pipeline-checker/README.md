# Pipeline Checker

A single-file WebGPU application for visualizing and comparing HDR/SDR color pipelines stage by stage. Drop in an EXR, DDS, or standard image and inspect how each processing step transforms the data — from source color space through BC texture compression, color grading, tonemapping, and final display output.

## Features

- **9-stage pipeline filmstrip** with live thumbnails and per-stage color space labels
- **BC texture compression** (BC1–BC7, BC6H HDR) with real-time encode/decode via compute shaders
- **Delta error view** with perceptual weighting for fair compression quality assessment
- **Color grading** in log (ACEScct) or linear (ACEScg) working space — exposure, contrast, saturation, lift/gamma/gain, color wheels
- **12 tonemap operators** including ACES 1.3, ACES 2.0, AgX, Gran Turismo, PBR Neutral
- **Split RRT/ODT** pipeline for ACES workflows
- **Multi-pipeline comparison** — drop multiple files, Tab to cycle, colored wireframe overlays
- **2D and 3D preview** — pan/zoom image view or heightmap visualization of pixel values
- **Gamut volume cones** between stages showing data range expansion/compression
- **9 input color spaces**: Linear Rec.709, Linear Rec.2020, ACEScg, ACEScc, ACEScct, sRGB, PQ, HLG, scRGB
- **Single HTML output** — Vite builds everything into one `index.html` for easy distribution

## Pipeline Stages

| # | Stage | Type | Purpose |
|---|---|---|---|
| 0 | Source | — | Raw input texture in declared color space |
| 1 | BC Compress | Compute | Async BC encode (BC1–BC7, BC6H) with optional sRGB-to-linear pre-pass |
| 2 | BC Decompress | Fragment | GPU hardware BC decompression + delta error visualization |
| 3 | Color Grade | Fragment | Input decode, grading in ACEScct/ACEScg, ASC-CDL controls |
| 4 | RRT | Fragment | Reference Rendering Transform (ACES 1.3/2.0 or generic tonemaps) |
| 5 | ODT | Fragment | Output Device Transform (Rec.709/Rec.2020 target) |
| 6 | Output Encode | Fragment | Transfer function encode (sRGB, PQ, HLG, etc.) |
| 7 | Display Remap | Fragment | Paper white / peak brightness / black level scaling |
| 8 | Final Display | — | sRGB backbuffer simulation (auto-applies gamma for linear outputs) |

Stages 1–7 can be toggled on/off via filmstrip checkboxes. BC Compress and BC Decompress are linked — toggling one toggles both. Disabled stages pass through the previous stage's output unchanged.

## Usage

```bash
cd pipeline-checker
npm install
npm run dev       # development server
npm run build     # production build → dist/index.html
```

Drop an EXR, DDS, PNG, or JPEG onto the viewport. Use the controls panel on the right to adjust settings. Click filmstrip cards to inspect individual stages.

## BC Compression Modes

### Input Color Space Dropdown

The **Input Color Space** dropdown declares how the source texture's values should be interpreted. It controls:

- The `DecodeInput()` function in the Color Grade shader (stage 3) — converts from declared space to the Linear Rec.709 hub
- Whether BC6H triggers automatic sRGB-to-linear conversion
- The delta view's perceptual mode (`isLinear` flag)
- Filmstrip color space labels

### BC Format Comparison

| | BC1–BC5 | BC7 | BC6H |
|---|---|---|---|
| Data type | 8-bit unorm | 8-bit unorm | 16-bit float (HDR) |
| Typical use | LDR textures | LDR textures, high quality | HDR environment maps, EXR data |
| Stores | Whatever values come in | Whatever values come in | Linear HDR values |
| Auto pre-convert | Never | Never | Only when input = sRGB |

### Per-Input-Space / BC Format Matrix

| Input Space | BC7 pre-convert | BC7 pipeline after | BC6H pre-convert | BC6H pipeline after | Effective input to Grade | Delta isLinear |
|---|---|---|---|---|---|---|
| Linear Rec.709 (0) | none | Lin 709 | none | Lin 709 | Lin 709 (0) | true |
| Linear Rec.2020 (1) | none | Lin 2020 | none | Lin 2020 | Lin 2020 (1) | true |
| ACEScg (2) | none | ACEScg | none | ACEScg | ACEScg (2) | true |
| ACEScc (3) | none | ACEScc | none | ACEScc | ACEScc (3) | false |
| ACEScct (4) | none | ACEScct | none | ACEScct | ACEScct (4) | false |
| **sRGB (5)** | **none** | **sRGB** | **sRGB to Linear** | **Lin 709** | **Lin 709 (0)** | **true** |
| PQ Rec.2020 (6) | none | PQ 2020 | none | PQ 2020 | PQ 2020 (6) | false |
| HLG Rec.2020 (7) | none | HLG 2020 | none | HLG 2020 | HLG 2020 (7) | false |
| scRGB (8) | none | scRGB | none | scRGB | scRGB (8) | true |

### sRGB + BC6H Special Case

BC6H stores linear HDR data. When the input is sRGB, the pipeline automatically converts sRGB to linear before compression:

```
Source (sRGB) --> [GPU: sRGB to Linear pass] --> BC6H encode (linear float) --> BC6H decode --> Lin 709
                                                                                                 |
                                                         Color Grade receives inputSpace = 0 (Lin 709)
                                                         Filmstrip stages 1-2 show "Lin 709"
                                                         Stage 2 thumbnail applies sRGB for display
```

### Filmstrip sRGB Display Rules

| Stage | Thumbnail shows | sRGB applied when |
|---|---|---|
| 0 (Source) | Raw input texture | Never if input is sRGB; vvvv viewer toggle otherwise |
| 1 (BC Compress) | Raw input (passthrough) | Never if input is sRGB; vvvv viewer toggle otherwise |
| 2 (BC Decompress) | Decompressed texture | Auto: if stage color space is linear (BC6H+sRGB = yes); vvvv viewer toggle otherwise |
| 3-7 (Color pipeline) | Stage output | vvvv viewer toggle |
| 8 (Final Display) | Final output | Auto: if previous stage output is linear |

### Delta View Perceptual Mode

The delta (error) visualization automatically adapts based on the effective input color space after BC stages:

- **Linear/HDR inputs** (isLinear = true): Applies Reinhard tonemap + sRGB gamma to both original and decompressed before computing the difference. This gives perceptually fair error weighting where dark-area errors are properly visible and HDR hot spots are tamed.
- **Already perceptual inputs** (isLinear = false): Raw absolute difference, since transfer functions like sRGB gamma, ACEScc/cct log, PQ, and HLG already provide perceptual compression.

### Dependencies on Input Color Space

| Affected system | How |
|---|---|
| Color Grade shader `DecodeInput()` | Selects transfer function to decode input to Linear Rec.709 hub |
| BC6H auto-linearization | Triggers sRGB-to-Linear GPU pass when input = sRGB |
| Effective input space uniform | Overridden to 0 (Lin 709) when BC6H + sRGB active |
| Delta view perceptual mode | isLinear: true for indices {0, 1, 2, 8}, false for {3, 4, 5, 6, 7} -- after BC6H+sRGB, effective space = 0 so isLinear = true |
| Filmstrip color space labels | Stages 1-2 show effective space; stage 0 always shows raw input |
| BC compress cache key | Includes inputColorSpace to re-encode when space changes |
