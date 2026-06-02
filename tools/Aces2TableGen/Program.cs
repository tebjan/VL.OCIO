// ============================================================================
// Aces2TableGen — faithful CPU port of OCIO v2.5 ACES 2.0 Output Transform
// (Hellwig 2022 CAM "JMh" DRT). Generates the per-hue cusp + reach tables and
// the baked CAM/tonescale/compression parameters for a fixed case
// (input = ACEScg/AP1, limit = Rec.709, peak = 100 nits = SDR), then emits them
// as SDSL `static const` arrays for baking into ACES20_RRT_ODT.sdsl.
//
// Source of truth: src/OCIOSharp/OpenColorIO/src/OpenColorIO/ops/fixedfunction/
//   ACES2/{Common.h,Transform.cpp}, FixedFunctionOpCPU.cpp, FixedFunctionOpGPU.cpp
// See docs/ACES2-OCIO-Reference.md for the extracted algorithm.
//
// Simplification vs OCIO: the per-hue cusp lookup uses a UNIFORM 1-degree table
// (cusp computed at integer hues 0..359) instead of OCIO's corner-aligned
// non-uniform hue table. At 1-degree resolution the difference is negligible and
// both reach + cusp tables then share the same trivial uniform indexing in the
// shader (i0=floor(h)%360, lerp to (i0+1)%360).
// ============================================================================

using System;
using System.Globalization;
using System.Text;

namespace Aces2TableGen
{
    // ---- small math types ---------------------------------------------------
    struct V3
    {
        public double X, Y, Z;
        public V3(double x, double y, double z) { X = x; Y = y; Z = z; }
        public double this[int i] => i == 0 ? X : (i == 1 ? Y : Z);
        public static V3 operator *(V3 a, double s) => new V3(a.X * s, a.Y * s, a.Z * s);
    }

    // Row-major 3x3. Mul(M,v) = M*v  (result[i] = dot(row_i, v)) == OCIO mult_f3_f33(v,M).
    struct M3
    {
        public double M00, M01, M02, M10, M11, M12, M20, M21, M22;
        public M3(double a, double b, double c, double d, double e, double f, double g, double h, double i)
        { M00 = a; M01 = b; M02 = c; M10 = d; M11 = e; M12 = f; M20 = g; M21 = h; M22 = i; }

        public static V3 Mul(M3 m, V3 v) => new V3(
            m.M00 * v.X + m.M01 * v.Y + m.M02 * v.Z,
            m.M10 * v.X + m.M11 * v.Y + m.M12 * v.Z,
            m.M20 * v.X + m.M21 * v.Y + m.M22 * v.Z);

        public static M3 Mul(M3 a, M3 b) => new M3(
            a.M00 * b.M00 + a.M01 * b.M10 + a.M02 * b.M20,
            a.M00 * b.M01 + a.M01 * b.M11 + a.M02 * b.M21,
            a.M00 * b.M02 + a.M01 * b.M12 + a.M02 * b.M22,
            a.M10 * b.M00 + a.M11 * b.M10 + a.M12 * b.M20,
            a.M10 * b.M01 + a.M11 * b.M11 + a.M12 * b.M21,
            a.M10 * b.M02 + a.M11 * b.M12 + a.M12 * b.M22,
            a.M20 * b.M00 + a.M21 * b.M10 + a.M22 * b.M20,
            a.M20 * b.M01 + a.M21 * b.M11 + a.M22 * b.M21,
            a.M20 * b.M02 + a.M21 * b.M12 + a.M22 * b.M22);

        public static M3 Diag(V3 d) => new M3(d.X, 0, 0, 0, d.Y, 0, 0, 0, d.Z);

        public M3 Inverse()
        {
            double a = M00, b = M01, c = M02, d = M10, e = M11, f = M12, g = M20, h = M21, i = M22;
            double A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
            double det = a * A + b * B + c * C;
            double inv = 1.0 / det;
            return new M3(
                A * inv, -(b * i - c * h) * inv, (b * f - c * e) * inv,
                B * inv, (a * i - c * g) * inv, -(a * f - c * d) * inv,
                C * inv, -(a * h - b * g) * inv, (a * e - b * d) * inv);
        }
    }

    static class Program
    {
        // ---- constants (ACES2/Common.h) -----------------------------------
        const double reference_luminance = 100.0;
        const double L_A = 100.0;
        const double Y_b = 20.0;
        static readonly double[] surround = { 0.9, 0.59, 0.9 }; // F, c, N_c
        const double J_scale = 100.0;
        const double cam_nl_offset = 0.2713 * 100.0; // 27.13
        const double cam_nl_scale = 4.0 * 100.0;     // 400

        const double chroma_compress = 2.4;
        const double chroma_compress_fact = 3.3;
        const double chroma_expand = 1.3;
        const double chroma_expand_fact = 0.69;
        const double chroma_expand_thr = 0.5;

        const double smooth_cusps = 0.12;
        const double smooth_m = 0.27;
        const double cusp_mid_blend = 1.3;
        const double focus_gain_blend = 0.3;
        const double focus_distance = 1.35;
        const double focus_distance_scaling = 1.75;
        const double compression_threshold = 0.75;

        const double gammaMinimum = 0.0, gammaMaximum = 5.0, gammaSearchStep = 0.4, gammaAccuracy = 1e-5;

        const int NHUE = 360; // uniform 1-degree table

        // ---- primaries (chromaticities) -----------------------------------
        // {Rx,Ry, Gx,Gy, Bx,By, Wx,Wy}
        static readonly double[] AP1 = { 0.713, 0.293, 0.165, 0.830, 0.128, 0.044, 0.32168, 0.33767 };
        static readonly double[] REC709 = { 0.64, 0.33, 0.30, 0.60, 0.15, 0.06, 0.3127, 0.3290 };
        static readonly double[] CAM16 = { 0.8336, 0.1735, 2.3854, -1.4659, 0.087, -0.125, 0.333, 0.333 };

        // RGB->XYZ (Lindbloom) using the primaries' own white, no chromatic adaptation.
        static M3 RGBtoXYZ(double[] p)
        {
            double xr = p[0], yr = p[1], xg = p[2], yg = p[3], xb = p[4], yb = p[5], xw = p[6], yw = p[7];
            double Xr = xr / yr, Yr = 1.0, Zr = (1 - xr - yr) / yr;
            double Xg = xg / yg, Yg = 1.0, Zg = (1 - xg - yg) / yg;
            double Xb = xb / yb, Yb2 = 1.0, Zb = (1 - xb - yb) / yb;
            double Xw = xw / yw, Yw = 1.0, Zw = (1 - xw - yw) / yw;
            M3 prim = new M3(Xr, Xg, Xb, Yr, Yg, Yb2, Zr, Zg, Zb);
            V3 S = M3.Mul(prim.Inverse(), new V3(Xw, Yw, Zw));
            return new M3(
                S.X * Xr, S.Y * Xg, S.Z * Xb,
                S.X * Yr, S.Y * Yg, S.Z * Yb2,
                S.X * Zr, S.Y * Zg, S.Z * Zb);
        }
        static M3 XYZtoRGB(double[] p) => RGBtoXYZ(p).Inverse();
        static M3 RGBtoRGB(double[] src, double[] dst) => M3.Mul(XYZtoRGB(dst), RGBtoXYZ(src));

        // ---- JMhParams (ACES2/Transform.cpp:470) --------------------------
        class JMhParams
        {
            public M3 RGB_to_CAM16_c, CAM16_c_to_RGB, cone_to_Aab, Aab_to_cone;
            public double F_L_n, cz, inv_cz, A_w_J, inv_A_w_J;
        }

        static double ModelGamma() => surround[1] * (1.48 + Math.Sqrt(Y_b / reference_luminance));

        // signed post-adaptation cone response compression
        static double PaccrcFwdAbs(double x) { double t = Math.Pow(x, 0.42); return t / (cam_nl_offset + t); }
        static double PaccrcInvAbs(double x) { double a = Math.Min(x, 0.99); double t = cam_nl_offset * a / (1.0 - a); return Math.Pow(t, 1.0 / 0.42); }
        static double PaccrcFwd(double v) => v < 0 ? -PaccrcFwdAbs(-v) : PaccrcFwdAbs(v);
        static double PaccrcInv(double v) => v < 0 ? -PaccrcInvAbs(-v) : PaccrcInvAbs(v);

        static JMhParams InitJMh(double[] prims)
        {
            var p = new JMhParams();
            M3 MATRIX_16 = XYZtoRGB(CAM16);
            M3 RGB_to_XYZ = RGBtoXYZ(prims);
            V3 XYZ_w = M3.Mul(RGB_to_XYZ, new V3(reference_luminance, reference_luminance, reference_luminance));
            double Y_W = XYZ_w.Y;
            V3 RGB_w = M3.Mul(MATRIX_16, XYZ_w);

            double K = 1.0 / (5.0 * L_A + 1.0);
            double K4 = K * K * K * K;
            double F_L = 0.2 * K4 * (5.0 * L_A) + 0.1 * Math.Pow(1.0 - K4, 2.0) * Math.Pow(5.0 * L_A, 1.0 / 3.0);
            p.F_L_n = F_L / reference_luminance;
            p.cz = ModelGamma();
            p.inv_cz = 1.0 / p.cz;

            V3 D_RGB = new V3(p.F_L_n * Y_W / RGB_w.X, p.F_L_n * Y_W / RGB_w.Y, p.F_L_n * Y_W / RGB_w.Z);
            V3 RGB_WC = new V3(D_RGB.X * RGB_w.X, D_RGB.Y * RGB_w.Y, D_RGB.Z * RGB_w.Z);
            V3 RGB_AW = new V3(PaccrcFwd(RGB_WC.X), PaccrcFwd(RGB_WC.Y), PaccrcFwd(RGB_WC.Z));

            // base_cone_response_to_Aab
            M3 baseM = new M3(
                2.0, 1.0, 1.0 / 20.0,
                1.0, -12.0 / 11.0, 1.0 / 11.0,
                1.0 / 9.0, 1.0 / 9.0, -2.0 / 9.0);
            M3 cone = M3.Mul(M3.Diag(new V3(cam_nl_scale, cam_nl_scale, cam_nl_scale)), baseM); // 400*base

            double A_w = cone.M00 * RGB_AW.X + cone.M01 * RGB_AW.Y + cone.M02 * RGB_AW.Z;
            p.A_w_J = PaccrcFwdAbs(F_L); // raw F_L
            p.inv_A_w_J = 1.0 / p.A_w_J;

            M3 RGB_to_CAM16 = M3.Mul(RGBtoRGB(prims, CAM16), M3.Diag(new V3(reference_luminance, reference_luminance, reference_luminance)));
            p.RGB_to_CAM16_c = M3.Mul(M3.Diag(D_RGB), RGB_to_CAM16);
            p.CAM16_c_to_RGB = p.RGB_to_CAM16_c.Inverse();

            double ncf = 43.0 * surround[2];
            p.cone_to_Aab = new M3(
                cone.M00 / A_w, cone.M01 / A_w, cone.M02 / A_w,
                cone.M10 * ncf, cone.M11 * ncf, cone.M12 * ncf,
                cone.M20 * ncf, cone.M21 * ncf, cone.M22 * ncf);
            p.Aab_to_cone = p.cone_to_Aab.Inverse();
            return p;
        }

        // ---- RGB <-> JMh ---------------------------------------------------
        static V3 RGB_to_Aab(V3 rgb, JMhParams p)
        {
            V3 m = M3.Mul(p.RGB_to_CAM16_c, rgb);
            V3 a = new V3(PaccrcFwd(m.X), PaccrcFwd(m.Y), PaccrcFwd(m.Z));
            return M3.Mul(p.cone_to_Aab, a);
        }
        static V3 Aab_to_JMh(V3 Aab, JMhParams p)
        {
            if (Aab.X <= 0.0) return new V3(0, 0, 0);
            double J = J_scale * Math.Pow(Aab.X, p.cz);
            double M = Math.Sqrt(Aab.Y * Aab.Y + Aab.Z * Aab.Z);
            double h = Math.Atan2(Aab.Z, Aab.Y) * (180.0 / Math.PI);
            h -= Math.Floor(h / 360.0) * 360.0;
            if (h < 0) h += 360.0;
            return new V3(J, M, h);
        }
        static V3 RGB_to_JMh(V3 rgb, JMhParams p) => Aab_to_JMh(RGB_to_Aab(rgb, p), p);

        static V3 JMh_to_Aab(V3 jmh, double cos_hr, double sin_hr, JMhParams p)
        {
            double A = Math.Pow(jmh.X * (1.0 / J_scale), p.inv_cz);
            return new V3(A, jmh.Y * cos_hr, jmh.Y * sin_hr);
        }
        static V3 Aab_to_RGB(V3 Aab, JMhParams p)
        {
            V3 r = M3.Mul(p.Aab_to_cone, Aab);
            V3 m = new V3(PaccrcInv(r.X), PaccrcInv(r.Y), PaccrcInv(r.Z));
            return M3.Mul(p.CAM16_c_to_RGB, m);
        }
        static V3 JMh_to_RGB(V3 jmh, JMhParams p)
        {
            double hr = jmh.Z * (Math.PI / 180.0);
            return Aab_to_RGB(JMh_to_Aab(jmh, Math.Cos(hr), Math.Sin(hr), p), p);
        }

        // achromatic helpers
        static double A_to_Y(double A, JMhParams p) => PaccrcInv(p.A_w_J * A) / p.F_L_n;
        static double Y_to_J_signed(double Y, JMhParams p)
        {
            double a = Math.Abs(Y);
            double Ra = PaccrcFwd(a * p.F_L_n);
            double j = J_scale * Math.Pow(Ra * p.inv_A_w_J, p.cz);
            return Y < 0 ? -j : j;
        }

        // ---- ToneScale (Transform.cpp:1266) -------------------------------
        class ToneScale
        {
            public double n, n_r, g, t_1, c_t, s_2, u_2, m_2, forward_limit, inverse_limit, log_peak;
        }
        static ToneScale InitToneScale(double peak)
        {
            var t = new ToneScale();
            double n = peak, n_r = 100.0, g = 1.15, c = 0.18, c_d = 10.013, w_g = 0.14, t_1 = 0.04;
            double r_hit_min = 128.0, r_hit_max = 896.0;
            double r_hit = r_hit_min + (r_hit_max - r_hit_min) * (Math.Log(n / n_r) / Math.Log(10000.0 / 100.0));
            double m_0 = n / n_r;
            double m_1 = 0.5 * (m_0 + Math.Sqrt(m_0 * (m_0 + 4.0 * t_1)));
            double u = Math.Pow((r_hit / m_1) / ((r_hit / m_1) + 1.0), g);
            double m = m_1 / u;
            double w_i = Math.Log(n / 100.0) / Math.Log(2.0);
            double c_t = c_d / n_r * (1.0 + w_i * w_g);
            double g_ip = 0.5 * (c_t + Math.Sqrt(c_t * (c_t + 4.0 * t_1)));
            double g_ipp2 = -(m_1 * Math.Pow(g_ip / m, 1.0 / g)) / (Math.Pow(g_ip / m, 1.0 / g) - 1.0);
            double w_2 = c / g_ipp2;
            double s_2 = w_2 * m_1 * reference_luminance;
            double u_2 = Math.Pow((r_hit / m_1) / ((r_hit / m_1) + w_2), g);
            double m_2 = m_1 / u_2;
            t.n = n; t.n_r = n_r; t.g = g; t.t_1 = t_1; t.c_t = c_t; t.s_2 = s_2; t.u_2 = u_2; t.m_2 = m_2;
            t.inverse_limit = n / (u_2 * n_r);
            t.forward_limit = 8.0 * r_hit;
            t.log_peak = Math.Log10(n / n_r);
            return t;
        }
        static double AcesToneScaleFwd(double Y_in, ToneScale t)
        {
            double f = t.m_2 * Math.Pow(Y_in / (Y_in + t.s_2), t.g);
            return Math.Max(0.0, f * f / (f + t.t_1)) * t.n_r;
        }
        static double ToneScale_A_to_J_fwd(double A, JMhParams p, ToneScale t)
        {
            double Y_in = A_to_Y(A, p);
            double Y_out = AcesToneScaleFwd(Y_in, t);
            double j = Y_to_J_signed(Y_out, p);
            return A < 0 ? -Math.Abs(j) : Math.Abs(j); // copysign(_Y_to_J(Yt), A)
        }

        // ---- Chroma compression (Transform.cpp:283) -----------------------
        class ChromaParams { public double sat, sat_thr, compr, ccs; }
        static ChromaParams InitChroma(double peak, ToneScale t)
        {
            var c = new ChromaParams();
            c.compr = chroma_compress + (chroma_compress * chroma_compress_fact) * t.log_peak;
            c.sat = Math.Max(0.2, chroma_expand - (chroma_expand * chroma_expand_fact) * t.log_peak);
            c.sat_thr = chroma_expand_thr / t.n;
            c.ccs = Math.Pow(0.03379 * peak, 0.30596) - 0.45135;
            return c;
        }
        static double ChromaCompressNorm(double cos1, double sin1, double ccs)
        {
            double c2 = 2 * cos1 * cos1 - 1, s2 = 2 * cos1 * sin1;
            double c3 = 4 * cos1 * cos1 * cos1 - 3 * cos1, s3 = 3 * sin1 - 4 * sin1 * sin1 * sin1;
            double M = 11.34072 * cos1 + 16.46899 * c2 + 7.88380 * c3
                     + 14.66441 * sin1 - 6.37224 * s2 + 9.19364 * s3 + 77.12896;
            return M * ccs;
        }
        static double ToeFwd(double x, double limit, double k1i, double k2i)
        {
            if (x > limit) return x;
            double k2 = Math.Max(k2i, 1e-3);
            double k1 = Math.Sqrt(k1i * k1i + k2 * k2);
            double k3 = (limit + k1) / (limit + k2);
            double mb = k3 * x - k1;
            return 0.5 * (mb + Math.Sqrt(mb * mb + 4.0 * k2 * k3 * x));
        }
        static V3 ChromaCompressFwd(V3 jmh, double J_ts, double Mnorm, double limit_J_max, double model_gamma_inv, double reachMaxM, ChromaParams c)
        {
            double J = jmh.X, M = jmh.Y, h = jmh.Z;
            double M_cp = M;
            if (M != 0.0)
            {
                double nJ = J_ts / limit_J_max;
                double snJ = Math.Max(0.0, 1.0 - nJ);
                double limit = Math.Pow(nJ, model_gamma_inv) * reachMaxM / Mnorm;
                M_cp = M * Math.Pow(J_ts / J, model_gamma_inv);
                M_cp = M_cp / Mnorm;
                M_cp = limit - ToeFwd(limit - M_cp, limit - 1e-3, snJ * c.sat, Math.Sqrt(nJ * nJ + c.sat_thr));
                M_cp = ToeFwd(M_cp, limit, nJ * c.compr, snJ);
                M_cp = M_cp * Mnorm;
            }
            return new V3(J_ts, M_cp, h);
        }

        // ---- Shared compression params ------------------------------------
        class Shared { public double limit_J_max, model_gamma_inv; public double[] reach_m_table; }
        static double[] MakeReachTable(JMhParams reachP, double limit_J_max)
        {
            double[] tbl = new double[NHUE];
            for (int i = 0; i < NHUE; i++)
            {
                double hue = i;
                double low = 0, high = 50; bool outside = false; const double search_max = 1300;
                while (!outside && high < search_max)
                {
                    V3 rgb = JMh_to_RGB(new V3(limit_J_max, high, hue), reachP);
                    outside = rgb.X < 0 || rgb.Y < 0 || rgb.Z < 0;
                    if (!outside) { low = high; high += 50; }
                }
                while (high - low > 1e-2)
                {
                    double mid = (high + low) / 2;
                    V3 rgb = JMh_to_RGB(new V3(limit_J_max, mid, hue), reachP);
                    if (rgb.X < 0 || rgb.Y < 0 || rgb.Z < 0) high = mid; else low = mid;
                }
                tbl[i] = high;
            }
            return tbl;
        }
        static double ReachFromTable(double[] tbl, double h)
        {
            double hh = h - Math.Floor(h / 360.0) * 360.0;
            int i0 = (int)Math.Floor(hh) % NHUE; if (i0 < 0) i0 += NHUE;
            int i1 = (i0 + 1) % NHUE;
            double t = hh - Math.Floor(hh);
            return tbl[i0] + (tbl[i1] - tbl[i0]) * t;
        }

        // ---- Gamut compression --------------------------------------------
        class GamutParams
        {
            public double mid_J, focus_dist, lower_hull_gamma_inv;
            public double[] cuspJ, cuspM, gammaTopInv; // per integer hue
        }

        static double GetFocusGain(double J, double thr, double limit_J_max, double focus_dist)
        {
            double gain = limit_J_max * focus_dist;
            if (J > thr)
            {
                double ga = Math.Log10((limit_J_max - thr) / Math.Max(1e-4, limit_J_max - J));
                gain *= (ga * ga + 1.0);
            }
            return gain;
        }
        static double SolveJIntersect(double J, double M, double focusJ, double maxJ, double sg)
        {
            double Ms = M / sg; double a = Ms / focusJ;
            if (J < focusJ) { double b = 1 - Ms, c = -J; return -2 * c / (b + Math.Sqrt(b * b - 4 * a * c)); }
            else { double b = -(1 + Ms + maxJ * a), c = maxJ * Ms + J; return -2 * c / (b - Math.Sqrt(b * b - 4 * a * c)); }
        }
        static double CompressionSlope(double iJ, double focusJ, double maxJ, double sg)
        {
            double dir = iJ < focusJ ? iJ : (maxJ - iJ);
            return dir * (iJ - focusJ) / (focusJ * sg);
        }
        static double EstimateBoundaryM(double Jaxis, double slope, double inv_gamma, double Jmax, double Mmax, double Jref)
        {
            double nJ = Jaxis / Jref;
            double shifted = Jref * Math.Pow(nJ, inv_gamma);
            return shifted * Mmax / (Jmax - slope * Mmax);
        }
        static double SminScaled(double a, double b, double refM)
        {
            double s = smooth_cusps * refM;
            double hh = Math.Max(s - Math.Abs(a - b), 0.0) / s;
            return Math.Min(a, b) - hh * hh * hh * s * (1.0 / 6.0);
        }
        static double FindGamutBoundaryM(double cuspJ, double cuspM, double Jmax, double gTopInv, double gBotInv, double iJsrc, double slope, double iJcusp)
        {
            double Mlo = EstimateBoundaryM(iJsrc, slope, gBotInv, cuspJ, cuspM, iJcusp);
            double Mhi = EstimateBoundaryM(Jmax - iJsrc, -slope, gTopInv, Jmax - cuspJ, cuspM, Jmax - iJcusp);
            return SminScaled(Mlo, Mhi, cuspM);
        }
        static double Lerp(double a, double b, double z) => (b - a) * z + a;
        static double ComputeFocusJ(double cuspJ, double mid_J, double limit_J_max)
            => Lerp(cuspJ, mid_J, Math.Min(1.0, cusp_mid_blend - cuspJ / limit_J_max));

        // build display cusp at integer hues by walking RGB cube saturated edges
        static void BuildCuspTable(JMhParams limitP, double peak, GamutParams g)
        {
            double scale = peak / 100.0;
            // 6 saturated corners in hue order R,Y,G,C,B,M
            V3[] cornersRGB = {
                new V3(1,0,0), new V3(1,1,0), new V3(0,1,0),
                new V3(0,1,1), new V3(0,0,1), new V3(1,0,1)
            };
            int n = cornersRGB.Length;
            var cJMh = new V3[n];
            for (int i = 0; i < n; i++) cJMh[i] = RGB_to_JMh(cornersRGB[i] * scale, limitP);

            g.cuspJ = new double[NHUE];
            g.cuspM = new double[NHUE];
            for (int hh = 0; hh < NHUE; hh++)
            {
                double targetHue = hh;
                // find bracketing corner edge (cyclic) by hue
                int lo = -1;
                for (int i = 0; i < n; i++)
                {
                    double h0 = cJMh[i].Z;
                    double h1 = cJMh[(i + 1) % n].Z;
                    // unwrap h1 to be >= h0
                    double h1u = h1; if (h1u < h0) h1u += 360.0;
                    double th = targetHue; if (th < h0) th += 360.0;
                    if (th >= h0 && th <= h1u) { lo = i; break; }
                }
                if (lo < 0) lo = 0;
                int hi = (lo + 1) % n;
                // bisect t along RGB edge until hue matches
                V3 rgbLo = cornersRGB[lo] * scale, rgbHi = cornersRGB[hi] * scale;
                double tLo = 0, tHi = 1;
                V3 cusp = cJMh[lo];
                for (int it = 0; it < 60; it++)
                {
                    double tm = 0.5 * (tLo + tHi);
                    V3 rgb = new V3(Lerp(rgbLo.X, rgbHi.X, tm), Lerp(rgbLo.Y, rgbHi.Y, tm), Lerp(rgbLo.Z, rgbHi.Z, tm));
                    V3 jmh = RGB_to_JMh(rgb, limitP);
                    double dh = jmh.Z - targetHue;
                    // wrap difference to [-180,180]
                    if (dh > 180) dh -= 360; if (dh < -180) dh += 360;
                    cusp = jmh;
                    // hue increases with t along the edge (R->Y etc.); adjust
                    double hStart = cJMh[lo].Z, hEnd = cJMh[hi].Z; double hEndU = hEnd; if (hEndU < hStart) hEndU += 360;
                    bool increasing = hEndU >= hStart;
                    if (Math.Abs(dh) < 1e-5) break;
                    if (increasing) { if (dh < 0) tLo = tm; else tHi = tm; }
                    else { if (dh > 0) tLo = tm; else tHi = tm; }
                }
                g.cuspJ[hh] = cusp.X;
                g.cuspM[hh] = cusp.Y * (1.0 + smooth_m * smooth_cusps);
            }
        }

        // make_upper_hull_gamma: per hue find smallest gamma s.t. all 5 test points outside hull; store 1/gamma
        static void MakeUpperHullGamma(JMhParams limitP, double peak, GamutParams g, double limit_J_max)
        {
            double scale = peak / 100.0;
            g.gammaTopInv = new double[NHUE];
            double[] testPos = { 0.01, 0.1, 0.5, 0.8, 0.99 };

            for (int hh = 0; hh < NHUE; hh++)
            {
                double hue = hh;
                double cuspJ = g.cuspJ[hh], cuspM = g.cuspM[hh];
                double focusJ = ComputeFocusJ(cuspJ, g.mid_J, limit_J_max);
                double analytical_threshold = Lerp(cuspJ, limit_J_max, focus_gain_blend);

                // precompute test data
                int nt = testPos.Length;
                double[] iJsrc = new double[nt], slope = new double[nt], iJcusp = new double[nt];
                for (int k = 0; k < nt; k++)
                {
                    double testJ = Lerp(cuspJ, limit_J_max, testPos[k]);
                    double sg = GetFocusGain(testJ, analytical_threshold, limit_J_max, g.focus_dist);
                    iJsrc[k] = SolveJIntersect(testJ, cuspM, focusJ, limit_J_max, sg);
                    slope[k] = CompressionSlope(iJsrc[k], focusJ, limit_J_max, sg);
                    iJcusp[k] = SolveJIntersect(cuspJ, cuspM, focusJ, limit_J_max, sg);
                }

                System.Func<double, bool> fits = (gamma) =>
                {
                    double gTopInv = 1.0 / gamma;
                    for (int k = 0; k < nt; k++)
                    {
                        double approxM = FindGamutBoundaryM(cuspJ, cuspM, limit_J_max, gTopInv, g.lower_hull_gamma_inv, iJsrc[k], slope[k], iJcusp[k]);
                        double approxJ = iJsrc[k] + slope[k] * approxM;
                        V3 rgb = JMh_to_RGB(new V3(approxJ, approxM, hue), limitP);
                        bool outside = rgb.X > scale || rgb.Y > scale || rgb.Z > scale;
                        if (!outside) return false;
                    }
                    return true;
                };

                // expand then bisect for smallest gamma in [min,max] (fits==true for large gamma)
                double low = gammaMinimum, high = gammaMinimum + gammaSearchStep;
                bool found = false;
                while (high <= gammaMaximum)
                {
                    if (fits(high)) { found = true; break; }
                    low = high; high += gammaSearchStep;
                }
                if (!found) { g.gammaTopInv[hh] = 1.0 / gammaMaximum; continue; }
                while (high - low > gammaAccuracy)
                {
                    double mid = 0.5 * (low + high);
                    if (fits(mid)) high = mid; else low = mid;
                }
                g.gammaTopInv[hh] = 1.0 / high;
            }
        }

        static GamutParams InitGamut(JMhParams inP, JMhParams limitP, double peak, ToneScale t, Shared s)
        {
            var g = new GamutParams();
            g.mid_J = Y_to_J_signed(t.c_t * reference_luminance, inP);
            g.focus_dist = focus_distance + focus_distance * focus_distance_scaling * t.log_peak;
            g.lower_hull_gamma_inv = 1.0 / (1.14 + 0.07 * t.log_peak);
            BuildCuspTable(limitP, peak, g);
            MakeUpperHullGamma(limitP, peak, g, s.limit_J_max);
            return g;
        }

        static V3 CuspAt(GamutParams g, double h, out double gTopInv)
        {
            double hh = h - Math.Floor(h / 360.0) * 360.0;
            int i0 = (int)Math.Floor(hh) % NHUE; if (i0 < 0) i0 += NHUE;
            int i1 = (i0 + 1) % NHUE;
            double t = hh - Math.Floor(hh);
            double cj = Lerp(g.cuspJ[i0], g.cuspJ[i1], t);
            double cm = Lerp(g.cuspM[i0], g.cuspM[i1], t);
            gTopInv = Lerp(g.gammaTopInv[i0], g.gammaTopInv[i1], t);
            return new V3(cj, cm, h);
        }

        static double RemapMFwd(double M, double gB, double rB)
        {
            double ratio = gB / rB;
            double prop = Math.Max(ratio, compression_threshold);
            double thr = prop * gB;
            if (M <= thr || prop >= 1.0) return M;
            double mo = M - thr, go = gB - thr, ro = rB - thr;
            double scl = ro / ((ro / go) - 1.0);
            double nd = mo / scl;
            return thr + scl * nd / (1.0 + nd);
        }

        static V3 GamutCompressFwd(V3 jmh, GamutParams g, Shared s)
        {
            double J = jmh.X, M = jmh.Y, h = jmh.Z;
            if (J <= 0) return new V3(0, 0, h);
            if (M <= 0 || J > s.limit_J_max) return new V3(J, 0, h);

            double gTopInv;
            V3 cusp = CuspAt(g, h, out gTopInv);
            double cuspJ = cusp.X, cuspM = cusp.Y;
            double focusJ = ComputeFocusJ(cuspJ, g.mid_J, s.limit_J_max);
            double analytical_threshold = Lerp(cuspJ, s.limit_J_max, focus_gain_blend);

            double sg = GetFocusGain(J, analytical_threshold, s.limit_J_max, g.focus_dist);
            double iJsrc = SolveJIntersect(J, M, focusJ, s.limit_J_max, sg);
            double slope = CompressionSlope(iJsrc, focusJ, s.limit_J_max, sg);
            double iJcusp = SolveJIntersect(cuspJ, cuspM, focusJ, s.limit_J_max, sg);
            double gB = FindGamutBoundaryM(cuspJ, cuspM, s.limit_J_max, gTopInv, g.lower_hull_gamma_inv, iJsrc, slope, iJcusp);
            if (gB <= 0) return new V3(J, 0, h);
            double rB = EstimateBoundaryM(iJsrc, slope, s.model_gamma_inv, s.limit_J_max, ReachFromTable(s.reach_m_table, h), s.limit_J_max);
            double Mr = RemapMFwd(M, gB, rB);
            return new V3(iJsrc + Mr * slope, Mr, h);
        }

        // ---- full forward output transform --------------------------------
        class Drt { public JMhParams inP, outP, reachP; public ToneScale t; public Shared s; public ChromaParams c; public GamutParams g; public double peak; }

        static Drt BuildDrt(double[] inPrims, double[] limitPrims, double peak)
        {
            var d = new Drt();
            d.peak = peak;
            d.inP = InitJMh(inPrims);
            d.outP = InitJMh(limitPrims);
            d.reachP = InitJMh(AP1);
            d.t = InitToneScale(peak);
            d.s = new Shared();
            d.s.limit_J_max = Y_to_J_signed(peak, d.inP);
            d.s.model_gamma_inv = 1.0 / ModelGamma();
            d.s.reach_m_table = MakeReachTable(d.reachP, d.s.limit_J_max);
            d.c = InitChroma(peak, d.t);
            d.g = InitGamut(d.inP, d.outP, peak, d.t, d.s);
            return d;
        }

        static V3 Forward(V3 rgbIn, Drt d)
        {
            V3 Aab = RGB_to_Aab(rgbIn, d.inP);
            V3 jmh = Aab_to_JMh(Aab, d.inP);
            double hr = jmh.Z * (Math.PI / 180.0);
            double cos1 = Math.Cos(hr), sin1 = Math.Sin(hr);
            double reachMaxM = ReachFromTable(d.s.reach_m_table, jmh.Z);
            double Mnorm = ChromaCompressNorm(cos1, sin1, d.c.ccs);
            double J_ts = ToneScale_A_to_J_fwd(Aab.X, d.inP, d.t);
            V3 cc = ChromaCompressFwd(jmh, J_ts, Mnorm, d.s.limit_J_max, d.s.model_gamma_inv, reachMaxM, d.c);
            V3 gc = GamutCompressFwd(cc, d.g, d.s);
            V3 AabOut = JMh_to_Aab(gc, cos1, sin1, d.outP);
            return Aab_to_RGB(AabOut, d.outP);
        }

        // ---- self tests ----------------------------------------------------
        static void SelfTest(Drt d)
        {
            Console.WriteLine("=== SELF TESTS ===");
            var p = d.inP;
            int fails = 0;
            // CAM round-trip
            V3[] tv = { new V3(0.18,0.18,0.18), new V3(0.5,0.2,0.1), new V3(0.05,0.3,0.6), new V3(1.0,0.8,0.2) };
            foreach (var v in tv)
            {
                V3 jmh = RGB_to_JMh(v, p);
                V3 rt = JMh_to_RGB(jmh, p);
                double err = Math.Abs(rt.X - v.X) + Math.Abs(rt.Y - v.Y) + Math.Abs(rt.Z - v.Z);
                bool ok = err < 1e-4;
                if (!ok) fails++;
                Console.WriteLine($"CAM roundtrip ({v.X:F3},{v.Y:F3},{v.Z:F3}) -> ({rt.X:F5},{rt.Y:F5},{rt.Z:F5}) err={err:E2} {(ok ? "OK" : "FAIL")}  JMh=({jmh.X:F2},{jmh.Y:F2},{jmh.Z:F1})");
            }
            // neutral -> M ~ 0
            {
                V3 jmh = RGB_to_JMh(new V3(0.18, 0.18, 0.18), p);
                bool ok = jmh.Y < 0.5;
                if (!ok) fails++;
                Console.WriteLine($"neutral M={jmh.Y:F4} {(ok ? "OK" : "FAIL")}");
            }
            // limit_J_max == 100 for peak 100
            Console.WriteLine($"limit_J_max={d.s.limit_J_max:F4} (expect ~100)  cz={p.cz:F5} A_w_J={p.A_w_J:F6}");
            // tonescale monotonic + mid-gray
            {
                double prev = -1; bool mono = true;
                for (double y = 0.001; y < 50; y *= 1.5) { double yt = AcesToneScaleFwd(y, d.t); if (yt < prev) mono = false; prev = yt; }
                Console.WriteLine($"tonescale monotonic={mono} {(mono ? "OK" : "FAIL")}");
                if (!mono) fails++;
            }
            // full forward: mid gray + sweep
            Console.WriteLine("--- forward (ACEScg in -> Rec.709 display-linear out) ---");
            foreach (double gray in new double[] { 0.0, 0.001, 0.018, 0.18, 0.5, 1.0, 4.0, 16.0 })
            {
                V3 outc = Forward(new V3(gray, gray, gray), d);
                Console.WriteLine($"gray {gray,7:F3} -> ({outc.X:F5},{outc.Y:F5},{outc.Z:F5})");
            }
            // mid-gray neutrality + plausibility
            {
                V3 o = Forward(new V3(0.18, 0.18, 0.18), d);
                bool neutral = Math.Abs(o.X - o.Y) < 1e-3 && Math.Abs(o.Y - o.Z) < 1e-3;
                bool plausible = o.X > 0.03 && o.X < 0.25;
                Console.WriteLine($"mid-gray out={o.X:F5} neutral={neutral} plausible={plausible} {(neutral && plausible ? "OK" : "CHECK")}");
                if (!neutral) fails++;
            }
            // saturated colors stay in [0,1]-ish after gamut compress (display-linear, may slightly exceed due to no final clamp)
            foreach (var v in new V3[] { new V3(1, 0, 0), new V3(0, 1, 0), new V3(0, 0, 1), new V3(3, 0, 0) })
            {
                V3 o = Forward(v, d);
                Console.WriteLine($"sat ({v.X:F1},{v.Y:F1},{v.Z:F1}) -> ({o.X:F4},{o.Y:F4},{o.Z:F4})");
            }
            Console.WriteLine(fails == 0 ? "=== ALL CORE TESTS OK ===" : $"=== {fails} FAILURES ===");
        }

        // ---- SDSL emission -------------------------------------------------
        static string F(double v)
        {
            // Fixed-point, never scientific notation (SDSL/HLSL literal-safe), ~15 decimals.
            string s = v.ToString("0.0###############", CultureInfo.InvariantCulture);
            return s + "f";
        }
        static void EmitSdsl(Drt d, string path)
        {
            var sb = new StringBuilder();
            var p = d.inP; var o = d.outP;
            sb.AppendLine("// AUTO-GENERATED by tools/Aces2TableGen — DO NOT EDIT BY HAND.");
            sb.AppendLine("// ACES 2.0 Output Transform baked params + tables.");
            sb.AppendLine("// Case: input=ACEScg(AP1), limit=Rec.709, peak=100 nits (SDR).");
            sb.AppendLine("// Hue tables are uniform 1-degree (index = hue in degrees).");
            sb.AppendLine();
            sb.AppendLine("shader ACES20_Tables : ColorSpaceConversion");
            sb.AppendLine("{");
            // matrices
            EmitMat(sb, "ACES2_RGB_to_CAM16_c", p.RGB_to_CAM16_c);
            EmitMat(sb, "ACES2_CAM16_c_to_RGB", p.CAM16_c_to_RGB);
            EmitMat(sb, "ACES2_cone_to_Aab_in", p.cone_to_Aab);
            EmitMat(sb, "ACES2_Aab_to_cone_in", p.Aab_to_cone);
            EmitMat(sb, "ACES2_RGB_to_CAM16_c_out", o.RGB_to_CAM16_c);
            EmitMat(sb, "ACES2_CAM16_c_to_RGB_out", o.CAM16_c_to_RGB);
            EmitMat(sb, "ACES2_cone_to_Aab_out", o.cone_to_Aab);
            EmitMat(sb, "ACES2_Aab_to_cone_out", o.Aab_to_cone);
            sb.AppendLine();
            // scalars
            sb.AppendLine($"static const float ACES2_in_cz = {F(p.cz)};");
            sb.AppendLine($"static const float ACES2_in_inv_cz = {F(p.inv_cz)};");
            sb.AppendLine($"static const float ACES2_in_F_L_n = {F(p.F_L_n)};");
            sb.AppendLine($"static const float ACES2_in_A_w_J = {F(p.A_w_J)};");
            sb.AppendLine($"static const float ACES2_in_inv_A_w_J = {F(p.inv_A_w_J)};");
            sb.AppendLine($"static const float ACES2_out_inv_cz = {F(o.inv_cz)};");
            sb.AppendLine($"static const float ACES2_limit_J_max = {F(d.s.limit_J_max)};");
            sb.AppendLine($"static const float ACES2_model_gamma_inv = {F(d.s.model_gamma_inv)};");
            sb.AppendLine($"static const float ACES2_ts_m_2 = {F(d.t.m_2)};");
            sb.AppendLine($"static const float ACES2_ts_s_2 = {F(d.t.s_2)};");
            sb.AppendLine($"static const float ACES2_ts_g = {F(d.t.g)};");
            sb.AppendLine($"static const float ACES2_ts_t_1 = {F(d.t.t_1)};");
            sb.AppendLine($"static const float ACES2_ts_n_r = {F(d.t.n_r)};");
            sb.AppendLine($"static const float ACES2_cc_sat = {F(d.c.sat)};");
            sb.AppendLine($"static const float ACES2_cc_sat_thr = {F(d.c.sat_thr)};");
            sb.AppendLine($"static const float ACES2_cc_compr = {F(d.c.compr)};");
            sb.AppendLine($"static const float ACES2_cc_scale = {F(d.c.ccs)};");
            sb.AppendLine($"static const float ACES2_g_mid_J = {F(d.g.mid_J)};");
            sb.AppendLine($"static const float ACES2_g_focus_dist = {F(d.g.focus_dist)};");
            sb.AppendLine($"static const float ACES2_g_lower_hull_gamma_inv = {F(d.g.lower_hull_gamma_inv)};");
            sb.AppendLine();
            // tables
            EmitArr(sb, "ACES2_reachM", d.s.reach_m_table);
            EmitArr(sb, "ACES2_cuspJ", d.g.cuspJ);
            EmitArr(sb, "ACES2_cuspM", d.g.cuspM);
            EmitArr(sb, "ACES2_gammaTopInv", d.g.gammaTopInv);
            sb.AppendLine();
            // Uniform 1-degree table lookups (hue in degrees).
            sb.AppendLine("    float ACES2_SampleReach(float h)");
            sb.AppendLine("    {");
            sb.AppendLine("        float hh = h - floor(h / 360.0) * 360.0;");
            sb.AppendLine("        int i0 = (int)floor(hh);");
            sb.AppendLine("        int i1 = (i0 + 1) % 360;");
            sb.AppendLine("        float t = hh - floor(hh);");
            sb.AppendLine("        return lerp(ACES2_reachM[i0], ACES2_reachM[i1], t);");
            sb.AppendLine("    }");
            sb.AppendLine();
            sb.AppendLine("    // Returns (cuspJ, cuspM, gammaTopInv) interpolated for hue h.");
            sb.AppendLine("    float3 ACES2_SampleCusp(float h)");
            sb.AppendLine("    {");
            sb.AppendLine("        float hh = h - floor(h / 360.0) * 360.0;");
            sb.AppendLine("        int i0 = (int)floor(hh);");
            sb.AppendLine("        int i1 = (i0 + 1) % 360;");
            sb.AppendLine("        float t = hh - floor(hh);");
            sb.AppendLine("        float cj = lerp(ACES2_cuspJ[i0], ACES2_cuspJ[i1], t);");
            sb.AppendLine("        float cm = lerp(ACES2_cuspM[i0], ACES2_cuspM[i1], t);");
            sb.AppendLine("        float gt = lerp(ACES2_gammaTopInv[i0], ACES2_gammaTopInv[i1], t);");
            sb.AppendLine("        return float3(cj, cm, gt);");
            sb.AppendLine("    }");
            sb.AppendLine("};");
            System.IO.File.WriteAllText(path, sb.ToString());
            Console.WriteLine($"Wrote SDSL include: {path} ({sb.Length} bytes)");
        }
        static void EmitMat(StringBuilder sb, string name, M3 m)
        {
            sb.AppendLine($"static const float3x3 {name} = float3x3(");
            sb.AppendLine($"    {F(m.M00)}, {F(m.M01)}, {F(m.M02)},");
            sb.AppendLine($"    {F(m.M10)}, {F(m.M11)}, {F(m.M12)},");
            sb.AppendLine($"    {F(m.M20)}, {F(m.M21)}, {F(m.M22)});");
        }
        static void EmitArr(StringBuilder sb, string name, double[] arr)
        {
            sb.AppendLine($"static const float {name}[{arr.Length}] = {{");
            for (int i = 0; i < arr.Length; i += 8)
            {
                sb.Append("    ");
                for (int j = i; j < Math.Min(i + 8, arr.Length); j++) sb.Append(F(arr[j]) + (j < arr.Length - 1 ? ", " : ""));
                sb.AppendLine();
            }
            sb.AppendLine("};");
        }

        static void Main(string[] args)
        {
            Aces13Check.Run();
            Console.WriteLine();
            Console.WriteLine("Building ACES 2.0 DRT (input=AP1, limit=Rec.709, peak=100)...");
            var d = BuildDrt(AP1, REC709, 100.0);
            SelfTest(d);
            string outPath = args.Length > 0 ? args[0] : "ACES20_tables.sdsl.inc";
            EmitSdsl(d, outPath);
        }
    }
}
