# Implementation Plan — BC Compression Maximum Quality

Reference: `.ralph/specs/spec.md` (project overview), `.ralph/specs/phase-12-bc-all-modes.md` (this milestone's detail)

Goal: Implement ALL BC6H (14 modes) and BC7 (8 modes) compression modes for maximum quality encoding. The existing shaders implement Mode 11 + Mode 10 (BC6H) and Mode 6 + Mode 1 (BC7). This milestone adds every remaining mode with proper quality tiering.

Reference HLSL shaders: `docs/ref_bc6h_encode.hlsl`, `docs/ref_bc7_encode.hlsl`

---

## Wave 1: BC6H Transformed Mode Infrastructure

> BC6H Modes 0-9 use delta-encoded (transformed) endpoints. This wave builds the
> infrastructure and implements the highest-impact transformed modes.

### Phase 12A: BC6H Delta Encoding Infrastructure + Mode 1
- [ ] 12A.1 Add `finish_unquantize()` and `start_unquantize()` functions matching DirectX reference
- [ ] 12A.2 Add `signExtend()` helper for transformed mode delta decoding
- [ ] 12A.3 Implement Mode 1 encoder: 2-subset, transformed, (7,6,6) bits, 3-bit indices, 32 partitions
- [ ] 12A.4 Wire Mode 1 into quality dispatch: quality >= 1 tries Mode 1 alongside Mode 10
- [ ] 12A.5 Verify: `cd pipeline-checker && npm run build` passes

### Phase 12B: BC6H Remaining Transformed Modes (0, 2-9)
- [ ] 12B.1 Implement Mode 0: 2-subset, transformed, (10,5,5) bits — highest single-channel precision
- [ ] 12B.2 Implement Modes 2-4: asymmetric R-heavy (11,5,4), (11,4,5), (11,4,4) — for bright red/green/blue content
- [ ] 12B.3 Implement Mode 5: 2-subset, transformed, (9,5,5) bits
- [ ] 12B.4 Implement Modes 6-8: balanced (8,6,5), (8,5,6), (8,5,5) bits
- [ ] 12B.5 Implement Mode 9: 2-subset, untransformed, (6,6,6) bits — like Mode 10 but lower precision
- [ ] 12B.6 Wire all modes into quality dispatch: quality >= 2 tries all 14 modes
- [ ] 12B.7 Verify: `cd pipeline-checker && npm run build` passes

### Phase 12C: BC6H Modes 12-13 + Bit Packing
- [ ] 12C.1 Implement Mode 12: 2-subset, transformed, (11,11,10) bits — maximum precision 2-subset mode
- [ ] 12C.2 Implement Mode 13: 2-subset, transformed, (11,10,11) bits — maximum precision variant
- [ ] 12C.3 Each mode's `block_package` bit layout must match DirectX reference exactly (scattered bits)
- [ ] 12C.4 Verify: `cd pipeline-checker && npm run build` passes

---

## Wave 2: BC7 Multi-Subset Modes

> BC7 has 3 multi-subset RGB-only modes (0, 2, 3) and Mode 7. These give better quality
> for opaque content with color variation across the block.

### Phase 12D: BC7 Mode 3 (2-subset, 7-bit RGB + shared P-bit)
- [ ] 12D.1 Implement Mode 3 encoder: 2-subset, 7-bit RGB + shared P-bit = effective 8-bit, 2-bit indices, 64 partitions
- [ ] 12D.2 Mode 3 bit layout: mode(4) + partition(6) + R0-R3(28) + G0-G3(28) + B0-B3(28) + P0-P1(2) + indices(30)
- [ ] 12D.3 Wire into quality dispatch: quality >= 1 tries Mode 3 alongside Mode 1
- [ ] 12D.4 Verify: `cd pipeline-checker && npm run build` passes

### Phase 12E: BC7 Modes 0 + 2 (3-subset modes)
- [ ] 12E.1 Add 3-subset partition tables: `candidateSectionBit3[64]` with 3-valued partition (2 bits per pixel = 32 bits per pattern) and `candidateFixUpIndex1DOrdered3[64][2]` (two fix-up indices per partition)
- [ ] 12E.2 Add 2-bit interpolation weights: `aWeight2 = [0, 21, 43, 64]` and `aStep0[64]` lookup
- [ ] 12E.3 Implement Mode 0 encoder: 3-subset, 4-bit RGB + per-endpoint P-bit = effective 5-bit, 3-bit indices, 16 partitions
- [ ] 12E.4 Implement Mode 2 encoder: 3-subset, 5-bit RGB, no P-bit, 2-bit indices, 64 partitions
- [ ] 12E.5 Wire into quality dispatch: quality >= 2 tries Modes 0, 2
- [ ] 12E.6 Verify: `cd pipeline-checker && npm run build` passes

### Phase 12F: BC7 Mode 7 (2-subset, 5-bit RGBA + P-bit)
- [ ] 12F.1 Implement Mode 7 encoder: 2-subset, 5-bit RGBA + shared P-bit = effective 6-bit, 2-bit indices, 64 partitions
- [ ] 12F.2 Mode 7 bit layout: mode(8) + partition(6) + R0-R3(20) + G0-G3(20) + B0-B3(20) + A0-A3(20) + P0-P1(2) + indices(30)
- [ ] 12F.3 Wire into quality dispatch: quality >= 2 tries Mode 7
- [ ] 12F.4 Verify: `cd pipeline-checker && npm run build` passes

---

## Wave 3: BC7 Alpha-Specialized Modes

> Modes 4 and 5 are unique: they handle alpha separately with rotation bits
> and index selector bits for flexible RGB/A quality tradeoff.

### Phase 12G: BC7 Modes 4 + 5 (rotation + index selector)
- [ ] 12G.1 Implement 2-bit rotation logic: swap channels (none, R↔A, G↔A, B↔A) before encoding
- [ ] 12G.2 Implement Mode 5 encoder: 1-subset, 7-bit RGB + 8-bit alpha, 2-bit indices for both, rotation
- [ ] 12G.3 Implement Mode 4 encoder: 1-subset, 5-bit RGB + 6-bit alpha, 2/3-bit split indices, rotation + index selector bit
- [ ] 12G.4 For each mode, try all 4 rotation values and pick lowest error
- [ ] 12G.5 Wire into quality dispatch: quality >= 1 tries Mode 5, quality >= 2 adds Mode 4
- [ ] 12G.6 Verify: `cd pipeline-checker && npm run build` passes

---

## Wave 4: Quality Tiering + Endpoint Refinement

> Final polish: proper quality tiers and endpoint refinement for maximum PSNR.

### Phase 12H: Quality Tier Restructure
- [ ] 12H.1 Restructure quality levels in both shaders:
  - fast (0): BC6H Mode 11 only / BC7 Mode 6 only
  - normal (1): BC6H Modes 11, 10, 1 / BC7 Modes 6, 1, 3, 5
  - high (2): BC6H all 14 modes / BC7 all 8 modes
- [ ] 12H.2 Add early-exit heuristic: skip remaining modes if current error < threshold (e.g., < 1.0 per pixel)
- [ ] 12H.3 Verify: `cd pipeline-checker && npm run build` passes
- [ ] 12H.4 Verify: switching quality in UI produces visible improvement at each tier

### Phase 12I: Endpoint Refinement
- [ ] 12I.1 Add endpoint refinement loop for BC6H: after best mode found, try adjusting each endpoint component by 1 quant step in both directions, keep if error decreases
- [ ] 12I.2 Add endpoint refinement loop for BC7: same approach for the winning mode
- [ ] 12I.3 Add bad quantization detection for BC6H transformed modes: if delta overflows precision, penalize that mode
- [ ] 12I.4 Verify: `cd pipeline-checker && npm run build` passes

### Phase 12J: Final Build + Verification
- [ ] 12J.1 Build production: `cd pipeline-checker && npm run build`
- [ ] 12J.2 Verify: all three quality levels (fast/normal/high) produce visibly different results
- [ ] 12J.3 Verify: no regressions in existing pipeline stages

---

## Notes

- ONE task per loop iteration. Focus on the first unchecked `[ ]` item.
- Reference HLSL: `docs/ref_bc6h_encode.hlsl` and `docs/ref_bc7_encode.hlsl` contain the bit packing for every mode.
- The phase detail file `.ralph/specs/phase-12-bc-all-modes.md` has mode tables, bit layouts, and implementation guidance.
- ALL bit packing must match the BC6H/BC7 spec exactly — hardware decoders expect specific bit positions.
- Transformed modes (BC6H 0-9, 12-13) use delta encoding: endpoint[1] stored as signed delta from endpoint[0].
- After EVERY task: run `cd pipeline-checker && npm run build` to catch regressions.
- Do NOT change the BCEncoder class API or format handler interface — only modify WGSL shaders and handler `createPipeline()` if needed.
