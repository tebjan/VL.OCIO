/**
 * Generate a procedural 1024×512 HDR test chart for compression quality evaluation.
 *
 * Left half (x 0–511, y 0–511):
 *   Full 512×512 hue × HDR brightness sweep (Y = hue, X = 0→10 brightness).
 *
 * Right half (x 512–1023):
 *   Upper-right (y 0–255) — technical test zones:
 *     x 512–767, y 0–127:   Grayscale ramp (SDR 0→1 top, HDR 0→10 bottom)
 *     x 512–767, y 128–255: Sharp geometric edges (concentric rings + diagonal stripes)
 *     x 768–1023, y 0–255:  High-frequency patterns (8 × 32px bands)
 *   Lower-right (y 256–511) — color palette: 16 cols × 4 rows = 64 swatches (32×64 each).
 *     Each swatch has a smooth background gradient and a Phong-shaded sphere
 *     rendered in the swatch colour, showing diffuse + specular lighting.
 *     Row 0: vivid hues    Row 1: earth/skin    Row 2: pastels    Row 3: darks + 4 HDR
 */
export function generateSampleImage(): { data: Float32Array; width: number; height: number } {
  const width = 1024;
  const height = 512;
  const data = new Float32Array(width * height * 4);

  const setPixel = (x: number, y: number, r: number, g: number, b: number) => {
    const idx = (y * width + x) * 4;
    data[idx + 0] = r;
    data[idx + 1] = g;
    data[idx + 2] = b;
    data[idx + 3] = 1.0;
  };

  // ── Left half: Hue × HDR Brightness Sweep (512×512) ─────────────────────────
  for (let y = 0; y < 512; y++) {
    const hue = y / 512;
    for (let x = 0; x < 512; x++) {
      const brightness = (x / 511) * 10.0;
      const [r, g, b] = hslToLinear(hue, 0.8, 0.5);
      setPixel(x, y, r * brightness, g * brightness, b * brightness);
    }
  }

  // ── Upper-right: Technical Zones ─────────────────────────────────────────────

  // Grayscale ramp (x 512–767, y 0–127): top 64 rows SDR 0→1, bottom 64 rows HDR 0→10
  for (let y = 0; y < 128; y++) {
    const isHDR = y >= 64;
    for (let x = 0; x < 256; x++) {
      const gray = isHDR ? (x / 255) * 10.0 : x / 255;
      setPixel(512 + x, y, gray, gray, gray);
    }
  }

  // Sharp geometric edges (x 512–767, y 128–255): concentric rings + diagonals
  {
    const cx = 128, cy = 64, rw = 6;
    for (let ly = 0; ly < 128; ly++) {
      for (let lx = 0; lx < 256; lx++) {
        const dist = Math.sqrt((lx - cx) ** 2 + (ly - cy) ** 2);
        const ring = Math.floor(dist / rw);
        let r: number, g: number, b: number;
        if (dist <= 60) {
          const v = ring % 2 === 0 ? 1.0 : 0.0;
          r = v; g = v; b = v;
        } else {
          const stripe = Math.floor((lx + ly) / rw) % 2 === 0;
          r = stripe ? 1.0 : 0.0;
          g = stripe ? 0.6 : 0.4;
          b = stripe ? 0.0 : 0.8;
        }
        setPixel(512 + lx, 128 + ly, r, g, b);
      }
    }
  }

  // High-frequency patterns (x 768–1023, y 0–255): 8 bands of 32px
  for (let ly = 0; ly < 256; ly++) {
    for (let lx = 0; lx < 256; lx++) {
      const band = Math.floor(lx / 32);
      let gray: number;
      switch (band) {
        case 0:  gray = (lx + ly) % 2 === 0 ? 1 : 0; break;                                        // 1px checker
        case 1:  gray = (Math.floor(lx/2)  + Math.floor(ly/2))  % 2 === 0 ? 1 : 0; break;         // 2px checker
        case 2:  gray = (Math.floor(lx/4)  + Math.floor(ly/4))  % 2 === 0 ? 1 : 0; break;         // 4px checker
        case 3:  gray = (Math.floor(lx/8)  + Math.floor(ly/8))  % 2 === 0 ? 1 : 0; break;         // 8px checker
        case 4:  gray = (Math.floor(lx/16) + Math.floor(ly/16)) % 2 === 0 ? 1 : 0; break;         // 16px checker
        case 5:  gray = (Math.floor(lx/32) + Math.floor(ly/32)) % 2 === 0 ? 1 : 0; break;         // 32px checker
        case 6:  gray = Math.floor(ly / 2) % 2 === 0 ? 1 : 0; break;                              // 2px horiz stripes
        default: gray = Math.floor(lx / 2) % 2 === 0 ? 1 : 0; break;                              // 2px vert stripes
      }
      setPixel(768 + lx, ly, gray, gray, gray);
    }
  }

  // ── Lower-right: Color Palette with Shaded Spheres ───────────────────────────
  // 16 cols × 4 rows = 64 swatches, each 32×64 px (x 512–1023, y 256–511).
  // [h, s, l] HSL; null = HDR flat swatch.

  const palRows: ([number, number, number] | null)[][] = [
    // Row 0 — vivid saturated hues across the full spectrum
    [
      [0.00, 0.90, 0.42],  // crimson
      [0.03, 0.90, 0.50],  // red
      [0.06, 0.92, 0.50],  // red-orange
      [0.08, 0.90, 0.50],  // orange
      [0.11, 0.88, 0.48],  // amber
      [0.15, 0.88, 0.48],  // golden yellow
      [0.19, 0.80, 0.44],  // yellow-green
      [0.28, 0.78, 0.38],  // spring green
      [0.35, 0.78, 0.35],  // green
      [0.43, 0.75, 0.36],  // green-teal
      [0.50, 0.82, 0.40],  // teal
      [0.55, 0.88, 0.45],  // cyan
      [0.60, 0.85, 0.45],  // cerulean
      [0.65, 0.88, 0.48],  // blue
      [0.73, 0.82, 0.42],  // indigo
      [0.80, 0.82, 0.45],  // violet
    ],
    // Row 1 — earth, natural, skin tones
    [
      [0.00, 0.75, 0.18],  // dark wine
      [0.02, 0.65, 0.32],  // dark brick
      [0.05, 0.62, 0.42],  // burnt sienna
      [0.07, 0.58, 0.52],  // terracotta
      [0.07, 0.50, 0.62],  // skin (fair)
      [0.07, 0.48, 0.52],  // skin (light)
      [0.07, 0.44, 0.42],  // skin (medium)
      [0.06, 0.38, 0.30],  // skin (tan)
      [0.06, 0.35, 0.22],  // skin (dark)
      [0.08, 0.40, 0.18],  // dark walnut
      [0.10, 0.35, 0.25],  // warm brown
      [0.18, 0.32, 0.30],  // olive/khaki
      [0.28, 0.28, 0.32],  // sage
      [0.38, 0.25, 0.30],  // dark forest
      [0.55, 0.22, 0.35],  // dusty slate
      [0.62, 0.28, 0.40],  // cool steel
    ],
    // Row 2 — pastels + muted mid-tones
    [
      [0.00, 0.80, 0.80],  // baby rose
      [0.05, 0.78, 0.80],  // peach
      [0.10, 0.78, 0.82],  // pale lemon
      [0.20, 0.68, 0.78],  // pale lime
      [0.35, 0.65, 0.76],  // mint
      [0.48, 0.70, 0.78],  // pale teal
      [0.55, 0.72, 0.80],  // powder blue
      [0.62, 0.72, 0.78],  // periwinkle
      [0.70, 0.65, 0.78],  // lavender
      [0.78, 0.65, 0.78],  // lilac
      [0.87, 0.68, 0.78],  // orchid
      [0.93, 0.72, 0.76],  // flamingo
      [0.00, 0.00, 0.92],  // off-white warm
      [0.58, 0.08, 0.92],  // off-white cool
      [0.00, 0.00, 0.78],  // light gray
      [0.00, 0.00, 0.62],  // mid-light gray
    ],
    // Row 3 — deep/dark rich + neutrals + 4 HDR swatches (cols 12–15)
    [
      [0.00, 0.82, 0.22],  // deep red
      [0.08, 0.80, 0.22],  // deep orange
      [0.28, 0.72, 0.20],  // deep green
      [0.58, 0.78, 0.20],  // deep teal
      [0.65, 0.82, 0.20],  // deep blue
      [0.75, 0.72, 0.20],  // deep purple
      [0.88, 0.80, 0.22],  // deep magenta
      [0.00, 0.00, 0.08],  // near-black
      [0.00, 0.00, 0.20],  // very dark gray
      [0.00, 0.00, 0.40],  // dark gray
      [0.00, 0.00, 0.60],  // mid gray
      [0.00, 0.00, 0.80],  // light gray
      null,                 // HDR neutral 2×
      null,                 // HDR neutral 5×
      null,                 // HDR warm specular [8,5,1]
      null,                 // HDR cool specular [2,4,8]
    ],
  ];

  const hdrColors: [number, number, number][] = [
    [2.0, 2.0, 2.0],
    [5.0, 5.0, 5.0],
    [8.0, 5.0, 1.0],
    [2.0, 4.0, 8.0],
  ];

  // Diamond gem: L1-masked hemisphere normals.
  // Shape is a rotated square; normals follow a bowl profile (max at centre,
  // tilting outward toward edges) — gives a smooth shading gradient and a
  // visible specular glint without a circular silhouette.
  const gemShading = (
    lx: number, ly: number, cx: number, cy: number, r: number,
  ): { diffuse: number; spec: number } | null => {
    const dx = lx - cx, dy = ly - cy;
    const u = (Math.abs(dx) + Math.abs(dy)) / r;  // L1 distance, 0=centre 1=edge
    if (u >= 1) return null;
    // Bowl profile z = sqrt(1-u²) → slope c = u / sqrt(1-u²)
    const c = u / Math.sqrt(1 - u * u + 1e-9);
    const nx_raw = (dx === 0 ? 0 : Math.sign(dx)) * c / r;
    const ny_raw = (dy === 0 ? 0 : Math.sign(dy)) * c / r;
    const nLen = Math.sqrt(nx_raw * nx_raw + ny_raw * ny_raw + 1);
    const nx = nx_raw / nLen, ny = ny_raw / nLen, nz = 1 / nLen;
    // Light direction (normalized)
    const lLen = Math.sqrt(0.5 * 0.5 + 0.6 * 0.6 + 0.8 * 0.8);
    const lnx = -0.5 / lLen, lny = -0.6 / lLen, lnz = 0.8 / lLen;
    // Wrap diffuse: softer shadow falloff
    const wrap = 0.25;
    const diffuse = Math.max(0, (nx * lnx + ny * lny + nz * lnz + wrap) / (1 + wrap));
    // Hemisphere ambient: slightly brighter toward viewer
    const skyAmbient = 0.18 + 0.10 * nz;
    // Blinn-Phong specular: H = normalize(L + V), V = (0,0,1)
    const hrx = lnx, hry = lny, hrz = lnz + 1;
    const hLen = Math.sqrt(hrx * hrx + hry * hry + hrz * hrz);
    const spec = Math.pow(Math.max(0, (nx * hrx + ny * hry + nz * hrz) / hLen), 32);
    return { diffuse: diffuse * (1 - skyAmbient) + skyAmbient, spec };
  };

  const SW = 32, SH = 64;
  const GR = 12;                           // gem half-size (L1 radius)
  const gemCX = SW / 2, gemCY = SH / 2;   // centred in swatch

  let hdrIdx = 0;
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 16; col++) {
      const swatch = palRows[row][col];
      const x0 = 512 + col * SW;
      const y0 = 256 + row * SH;

      if (swatch === null) {
        const hdrC = hdrColors[hdrIdx++];
        for (let sy = 0; sy < SH; sy++) {
          for (let sx = 0; sx < SW; sx++) {
            const sh = gemShading(sx, sy, gemCX, gemCY, GR);
            let r: number, g: number, b: number;
            if (sh) {
              r = hdrC[0] * sh.diffuse + sh.spec * hdrC[0] * 0.3;
              g = hdrC[1] * sh.diffuse + sh.spec * hdrC[1] * 0.3;
              b = hdrC[2] * sh.diffuse + sh.spec * hdrC[2] * 0.3;
            } else {
              r = hdrC[0] * 0.08; g = hdrC[1] * 0.08; b = hdrC[2] * 0.08;
            }
            setPixel(x0 + sx, y0 + sy, r, g, b);
          }
        }
      } else {
        const [h, s, l] = swatch;
        const [br, bg, bb] = hslToLinear(h, s, l);
        for (let sy = 0; sy < SH; sy++) {
          for (let sx = 0; sx < SW; sx++) {
            const sh = gemShading(sx, sy, gemCX, gemCY, GR);
            let r: number, g: number, b: number;
            if (sh) {
              r = br * sh.diffuse + sh.spec * 0.7;
              g = bg * sh.diffuse + sh.spec * 0.7;
              b = bb * sh.diffuse + sh.spec * 0.7;
            } else {
              const lBg = Math.max(0.02, Math.min(0.96, l - 0.20 + 0.40 * (sy / (SH - 1))));
              const sBg = s * (0.15 + 0.85 * (sx / (SW - 1)));
              [r, g, b] = hslToLinear(h, sBg, lBg);
            }
            setPixel(x0 + sx, y0 + sy, r, g, b);
          }
        }
      }
    }
  }

  return { data, width, height };
}

export function hslToLinear(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h * 6) % 2) - 1));
  const m = l - c / 2;

  let r = 0, g = 0, b = 0;
  const sector = Math.floor(h * 6) % 6;
  if      (sector === 0) { r = c; g = x; b = 0; }
  else if (sector === 1) { r = x; g = c; b = 0; }
  else if (sector === 2) { r = 0; g = c; b = x; }
  else if (sector === 3) { r = 0; g = x; b = c; }
  else if (sector === 4) { r = x; g = 0; b = c; }
  else                   { r = c; g = 0; b = x; }

  const toLinear = (v: number) => Math.pow(Math.max(v + m, 0), 2.2);
  return [toLinear(r), toLinear(g), toLinear(b)];
}
