// ACES 2.0 Hellwig 2022 CAM DRT helpers (WGSL).
// Faithful transcription of the verified C#/SDSL (mid-gray 0.18 -> 0.10).
// Depends on the baked data above (matrices, scalars, tables, ACES2_SampleReach/Cusp).
// select(false_val, true_val, cond) => true_val when cond.

fn ACES2_pf(v: f32) -> f32 { let a = abs(v); let t = pow(a, 0.42); let r = t / (27.13 + t); return select(r, -r, v < 0.0); }
fn ACES2_pi(v: f32) -> f32 { let a = min(abs(v), 0.99); let t = 27.13 * a / (1.0 - a); let r = pow(t, 1.0 / 0.42); return select(r, -r, v < 0.0); }
fn ACES2_pf3(v: vec3<f32>) -> vec3<f32> { return vec3<f32>(ACES2_pf(v.x), ACES2_pf(v.y), ACES2_pf(v.z)); }
fn ACES2_pi3(v: vec3<f32>) -> vec3<f32> { return vec3<f32>(ACES2_pi(v.x), ACES2_pi(v.y), ACES2_pi(v.z)); }

fn ACES2_A_to_Y(A: f32) -> f32 { return ACES2_pi(ACES2_in_A_w_J * A) / ACES2_in_F_L_n; }
fn ACES2_Y_to_J(Y: f32) -> f32 { let a = abs(Y); let Ra = ACES2_pf(a * ACES2_in_F_L_n); let j = 100.0 * pow(Ra * ACES2_in_inv_A_w_J, ACES2_in_cz); return select(j, -j, Y < 0.0); }
fn ACES2_tsAJ(A: f32) -> f32 { let Yin = ACES2_A_to_Y(A); let f = ACES2_ts_m_2 * pow(Yin / (Yin + ACES2_ts_s_2), ACES2_ts_g); let Yts = max(0.0, f * f / (f + ACES2_ts_t_1)) * ACES2_ts_n_r; let j = ACES2_Y_to_J(Yts); return select(j, -j, A < 0.0); }

fn ACES2_cNorm(c: f32, s: f32) -> f32 {
    let c2 = 2.0 * c * c - 1.0; let s2 = 2.0 * c * s;
    let c3 = 4.0 * c * c * c - 3.0 * c; let s3 = 3.0 * s - 4.0 * s * s * s;
    let M = 11.34072 * c + 16.46899 * c2 + 7.88380 * c3 + 14.66441 * s - 6.37224 * s2 + 9.19364 * s3 + 77.12896;
    return M * ACES2_cc_scale;
}
fn ACES2_toe(x: f32, l: f32, k1i: f32, k2i: f32) -> f32 {
    if (x > l) { return x; }
    let k2 = max(k2i, 0.001); let k1 = sqrt(k1i * k1i + k2 * k2); let k3 = (l + k1) / (l + k2);
    let mb = k3 * x - k1; return 0.5 * (mb + sqrt(mb * mb + 4.0 * k2 * k3 * x));
}
fn ACES2_cc(J: f32, M: f32, Jts: f32, Mn: f32, rM: f32) -> f32 {
    if (M == 0.0) { return 0.0; }
    let nJ = Jts / ACES2_limit_J_max; let snJ = max(0.0, 1.0 - nJ);
    let lim = pow(nJ, ACES2_model_gamma_inv) * rM / Mn;
    var m = M * pow(Jts / J, ACES2_model_gamma_inv) / Mn;
    m = lim - ACES2_toe(lim - m, lim - 0.001, snJ * ACES2_cc_sat, sqrt(nJ * nJ + ACES2_cc_sat_thr));
    m = ACES2_toe(m, lim, nJ * ACES2_cc_compr, snJ);
    return m * Mn;
}

fn ACES2_fg(J: f32, thr: f32) -> f32 {
    var g = ACES2_limit_J_max * ACES2_g_focus_dist;
    if (J > thr) { let ga = log((ACES2_limit_J_max - thr) / max(1e-4, ACES2_limit_J_max - J)) / log(10.0); g = g * (ga * ga + 1.0); }
    return g;
}
fn ACES2_sJ(J: f32, M: f32, fJ: f32, sg: f32) -> f32 {
    let Ms = M / sg; let a = Ms / fJ;
    if (J < fJ) { let b = 1.0 - Ms; let c = -J; return -2.0 * c / (b + sqrt(b * b - 4.0 * a * c)); }
    let b = -(1.0 + Ms + ACES2_limit_J_max * a); let c = ACES2_limit_J_max * Ms + J; return -2.0 * c / (b - sqrt(b * b - 4.0 * a * c));
}
fn ACES2_slp(iJ: f32, fJ: f32, sg: f32) -> f32 { var d = iJ; if (iJ >= fJ) { d = ACES2_limit_J_max - iJ; } return d * (iJ - fJ) / (fJ * sg); }
fn ACES2_eb(Ja: f32, sl: f32, iG: f32, Jx: f32, Mx: f32, Jr: f32) -> f32 { let nJ = Ja / Jr; let sh = Jr * pow(nJ, iG); return sh * Mx / (Jx - sl * Mx); }
fn ACES2_smin(a: f32, b: f32, r: f32) -> f32 { let s = 0.12 * r; let h = max(s - abs(a - b), 0.0) / s; return min(a, b) - h * h * h * s / 6.0; }
fn ACES2_fGB(cJ: f32, cM: f32, gT: f32, gB: f32, iJs: f32, sl: f32, iJc: f32) -> f32 {
    let Mlo = ACES2_eb(iJs, sl, gB, cJ, cM, iJc);
    let Mhi = ACES2_eb(ACES2_limit_J_max - iJs, -sl, gT, ACES2_limit_J_max - cJ, cM, ACES2_limit_J_max - iJc);
    return ACES2_smin(Mlo, Mhi, cM);
}
fn ACES2_fJfn(cJ: f32) -> f32 { return mix(cJ, ACES2_g_mid_J, min(1.0, 1.3 - cJ / ACES2_limit_J_max)); }
fn ACES2_rm(M: f32, gB: f32, rB: f32) -> f32 {
    let ra = gB / rB; let p = max(ra, 0.75); let thr = p * gB;
    if (M <= thr || p >= 1.0) { return M; }
    let mo = M - thr; let go = gB - thr; let ro = rB - thr;
    let sc = ro / ((ro / go) - 1.0); let nd = mo / sc; return thr + sc * nd / (1.0 + nd);
}
fn ACES2_gc(J: f32, M: f32, h: f32, rM: f32) -> vec2<f32> {
    if (J <= 0.0) { return vec2<f32>(0.0, 0.0); }
    if (M <= 0.0 || J > ACES2_limit_J_max) { return vec2<f32>(J, 0.0); }
    let cu = ACES2_SampleCusp(h);
    let cJ = cu.x; let cM = cu.y; let gT = cu.z;
    let fJ = ACES2_fJfn(cJ);
    let thr = mix(cJ, ACES2_limit_J_max, 0.3);
    let sg = ACES2_fg(J, thr);
    let iJs = ACES2_sJ(J, M, fJ, sg);
    let sl = ACES2_slp(iJs, fJ, sg);
    let iJc = ACES2_sJ(cJ, cM, fJ, sg);
    let gB = ACES2_fGB(cJ, cM, gT, ACES2_g_lower_hull_gamma_inv, iJs, sl, iJc);
    if (gB <= 0.0) { return vec2<f32>(J, 0.0); }
    let rB = ACES2_eb(iJs, sl, ACES2_model_gamma_inv, ACES2_limit_J_max, rM, ACES2_limit_J_max);
    let Mr = ACES2_rm(M, gB, rB);
    return vec2<f32>(iJs + Mr * sl, Mr);
}

// Full ACES 2.0 SDR DRT: exposed ACEScg(AP1) -> display-linear Rec.709 (1.0 = 100 nit).
fn ACES2_DRT_from_AP1_Rec709(acescg: vec3<f32>) -> vec3<f32> {
    let cam = ACES2_RGB_to_CAM16_c * acescg;
    let ra = ACES2_pf3(cam);
    let Aab = ACES2_cone_to_Aab_in * ra;
    var J = 0.0; var M = 0.0; var h = 0.0;
    if (Aab.x > 0.0) {
        J = 100.0 * pow(Aab.x, ACES2_in_cz);
        M = sqrt(Aab.y * Aab.y + Aab.z * Aab.z);
        h = atan2(Aab.z, Aab.y) * 57.2957795130823;
        h = h - floor(h / 360.0) * 360.0;
    }
    let hr = h * 0.0174532925199433;
    let c1 = cos(hr); let s1 = sin(hr);
    let rM = ACES2_SampleReach(h);
    let Mn = ACES2_cNorm(c1, s1);
    let Jts = ACES2_tsAJ(Aab.x);
    let Mcc = ACES2_cc(J, M, Jts, Mn, rM);
    let g = ACES2_gc(Jts, Mcc, h, rM);
    let Ao = pow(g.x * 0.01, ACES2_out_inv_cz);
    let AabOut = vec3<f32>(Ao, g.y * c1, g.y * s1);
    let rgb_a = ACES2_Aab_to_cone_out * AabOut;
    let rgb_m = ACES2_pi3(rgb_a);
    let rgb = ACES2_CAM16_c_to_RGB_out * rgb_m;
    return clamp(rgb, vec3<f32>(0.0), vec3<f32>(1.0));
}
