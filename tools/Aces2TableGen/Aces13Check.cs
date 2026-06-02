// ============================================================================
// Aces13Check — CPU mirror of shaders/ACES13_RRT_ODT.sdsl, to numerically
// verify ACES 1.3 (RRT + Rec.709 100-nit ODT) against the known aces-dev
// reference (mid-gray 0.18 ACEScg -> ~0.091 display-linear).
// Matrices/constants copied from ColorSpaceConversion.sdsl + ACES13_RRT_ODT.sdsl.
// ============================================================================

using System;

namespace Aces2TableGen
{
    static class Aces13Check
    {
        static readonly M3 AP1_to_AP0 = new M3(
            0.6954522414, 0.1406786965, 0.1638690622,
            0.0447945634, 0.8596711185, 0.0955343182,
            -0.0055258826, 0.0040252103, 1.0015006723);
        static readonly M3 AP0_to_AP1 = new M3(
            1.4514393161, -0.2365107469, -0.2149285693,
            -0.0765537734, 1.1762296998, -0.0996759264,
            0.0083161484, -0.0060324498, 0.9977163014);
        static readonly M3 AP1_to_XYZ = new M3(
            0.6624541811, 0.1340042065, 0.1561876870,
            0.2722287168, 0.6740817658, 0.0536895174,
            -0.0055746495, 0.0040607335, 1.0103391003);
        static readonly M3 XYZ_to_AP1 = new M3(
            1.6410233797, -0.3248032942, -0.2364246952,
            -0.6636628587, 1.6153315917, 0.0167563477,
            0.0117218943, -0.0082844420, 0.9883948585);
        static readonly M3 SPLINE_M = new M3(0.5, -1.0, 0.5, -1.0, 1.0, 0.0, 0.5, 0.5, 0.0);
        static readonly M3 AP1_to_Rec709 = new M3(
            1.7048586, -0.6217160, -0.0831426,
            -0.1300768, 1.1407357, -0.0106589,
            -0.0239640, -0.1289755, 1.1529395);
        static readonly M3 RRT_SAT = new M3(
            0.9708890, 0.0269633, 0.00214758,
            0.0108892, 0.9869630, 0.00214758,
            0.0108892, 0.0269633, 0.96214800);
        static readonly M3 ODT_SAT = new M3(
            0.949056, 0.0471857, 0.00375827,
            0.019056, 0.9771860, 0.00375827,
            0.019056, 0.0471857, 0.93375800);

        const double RRT_GLOW_GAIN = 0.05, RRT_GLOW_MID = 0.08;
        const double RRT_RED_SCALE = 0.82, RRT_RED_PIVOT = 0.03, RRT_RED_HUE = 0.0, RRT_RED_WIDTH = 135.0;
        const double CINEMA_WHITE = 48.0, CINEMA_BLACK = 0.02, DIM_SURROUND_GAMMA = 0.9811;

        static double Sat(V3 rgb)
        {
            double mi = Math.Min(Math.Min(rgb.X, rgb.Y), rgb.Z);
            double ma = Math.Max(Math.Max(rgb.X, rgb.Y), rgb.Z);
            return (Math.Max(ma, 1e-4) - Math.Max(mi, 1e-4)) / Math.Max(ma, 1e-2);
        }
        static double Yc(V3 rgb)
        {
            double k = Math.Max(rgb.Z * (rgb.Z - rgb.Y) + rgb.Y * (rgb.Y - rgb.X) + rgb.X * (rgb.X - rgb.Z), 0.0);
            return (rgb.Z + rgb.Y + rgb.X + 1.75 * Math.Sqrt(k)) / 3.0;
        }
        static double Hue(V3 rgb)
        {
            double h;
            if (rgb.X == rgb.Y && rgb.Y == rgb.Z) h = 0.0;
            else h = (180.0 / Math.PI) * Math.Atan2(Math.Sqrt(3.0) * (rgb.Y - rgb.Z), 2.0 * rgb.X - rgb.Y - rgb.Z);
            if (h < 0) h += 360.0;
            return h;
        }
        static double CenterHue(double hue, double center)
        {
            double h = hue - center;
            if (h < -180) h += 360; else if (h > 180) h -= 360;
            return h;
        }
        static double Sigmoid(double x)
        {
            double t = Math.Max(1.0 - Math.Abs(x / 2.0), 0.0);
            return (1.0 + Math.Sign(x) * (1.0 - t * t)) / 2.0;
        }
        static double GlowFwd(double ycIn, double gain, double mid)
        {
            if (ycIn <= 2.0 / 3.0 * mid) return gain;
            else if (ycIn >= 2.0 * mid) return 0.0;
            else return gain * (mid / ycIn - 0.5);
        }
        // aces-dev cubic_basis_shaper (RRT red-modifier hue weight). Cubic B-spline
        // basis over [-w/2, w/2]; peaks at 1.0 at center. Replaces the smoothstep^2
        // approximation for OCIO faithfulness.
        static double CubicBasisShaper(double x, double w)
        {
            double[] k = { -w / 2.0, -w / 4.0, 0.0, w / 4.0, w / 2.0 };
            double y = 0.0;
            if (x > k[0] && x < k[4])
            {
                double kc = (x - k[0]) * 4.0 / w;
                int j = (int)kc; double t = kc - j;
                double m0 = t * t * t, m1 = t * t, m2 = t, m3 = 1.0;
                if (j <= 0) y = m0 * (1.0 / 6.0);
                else if (j == 1) y = m0 * (-3.0 / 6.0) + m1 * (3.0 / 6.0) + m2 * (3.0 / 6.0) + m3 * (1.0 / 6.0);
                else if (j == 2) y = m0 * (3.0 / 6.0) + m1 * (-6.0 / 6.0) + m3 * (4.0 / 6.0);
                else if (j == 3) y = m0 * (-1.0 / 6.0) + m1 * (3.0 / 6.0) + m2 * (-3.0 / 6.0) + m3 * (1.0 / 6.0);
            }
            return y * 3.0 / 2.0;
        }
        static double SplineC5(double x)
        {
            double[] cl = { -4.0, -4.0, -3.1573765773, -0.4852499958, 1.8477324706, 1.8477324706 };
            double[] ch = { -0.7185482425, 2.0810307172, 3.6681241237, 4.0, 4.0, 4.0 };
            double logMinX = Math.Log10(0.18 * Math.Pow(2.0, -15.0));
            double logMidX = Math.Log10(0.18);
            double logMaxX = Math.Log10(0.18 * Math.Pow(2.0, 18.0));
            double logx = Math.Log10(Math.Max(x, 1e-10));
            double logy;
            if (logx <= logMinX) logy = Math.Log10(0.0001);
            else if (logx < logMidX)
            {
                double kc = 3.0 * (logx - logMinX) / (logMidX - logMinX);
                int j = (int)kc; double t = kc - j;
                V3 cf = new V3(cl[j], cl[j + 1], cl[j + 2]);
                logy = Dot(new V3(t * t, t, 1.0), M3.Mul(SPLINE_M, cf));
            }
            else if (logx < logMaxX)
            {
                double kc = 3.0 * (logx - logMidX) / (logMaxX - logMidX);
                int j = (int)kc; double t = kc - j;
                V3 cf = new V3(ch[j], ch[j + 1], ch[j + 2]);
                logy = Dot(new V3(t * t, t, 1.0), M3.Mul(SPLINE_M, cf));
            }
            else logy = Math.Log10(10000.0);
            return Math.Pow(10.0, logy);
        }
        static double SplineC9_48(double x)
        {
            double[] cl = { -1.6989700043, -1.6989700043, -1.4779000000, -1.2291000000, -0.8648000000, -0.4480000000, 0.0051800000, 0.4511080334, 0.9113744414, 0.9113744414 };
            double[] ch = { 0.5154386965, 0.8470437783, 1.1358000000, 1.3802000000, 1.5197000000, 1.5985000000, 1.6467000000, 1.6746091357, 1.6878733390, 1.6878733390 };
            double logMinX = Math.Log10(SplineC5(0.18 * Math.Pow(2.0, -6.5)));
            double logMidX = Math.Log10(SplineC5(0.18));
            double logMaxX = Math.Log10(SplineC5(0.18 * Math.Pow(2.0, 6.5)));
            double logMinY = Math.Log10(0.02), logMaxY = Math.Log10(48.0);
            double logx = Math.Log10(Math.Max(x, 1e-4));
            double logy;
            if (logx <= logMinX) logy = logMinY;
            else if (logx < logMidX)
            {
                double kc = 7.0 * (logx - logMinX) / (logMidX - logMinX);
                int j = (int)kc; double t = kc - j;
                V3 cf = new V3(cl[j], cl[j + 1], cl[j + 2]);
                logy = Dot(new V3(t * t, t, 1.0), M3.Mul(SPLINE_M, cf));
            }
            else if (logx < logMaxX)
            {
                double kc = 7.0 * (logx - logMidX) / (logMaxX - logMidX);
                int j = (int)kc; double t = kc - j;
                V3 cf = new V3(ch[j], ch[j + 1], ch[j + 2]);
                logy = Dot(new V3(t * t, t, 1.0), M3.Mul(SPLINE_M, cf));
            }
            else logy = logx * 0.04 + (logMaxY - 0.04 * logMaxX);
            return Math.Pow(10.0, logy);
        }
        static double Dot(V3 a, V3 b) => a.X * b.X + a.Y * b.Y + a.Z * b.Z;

        static V3 RRT(V3 acescg)
        {
            V3 aces = M3.Mul(AP1_to_AP0, acescg);
            double sat = Sat(aces);
            double ycIn = Yc(aces);
            double s = Sigmoid((sat - 0.4) / 0.2);
            double addedGlow = 1.0 + GlowFwd(ycIn, RRT_GLOW_GAIN * s, RRT_GLOW_MID);
            aces = aces * addedGlow;
            double hue = Hue(aces);
            double ch = CenterHue(hue, RRT_RED_HUE);
            double hw = CubicBasisShaper(ch, RRT_RED_WIDTH);
            aces.X = aces.X + hw * sat * (RRT_RED_PIVOT - aces.X) * (1.0 - RRT_RED_SCALE);
            V3 amax = new V3(Math.Max(aces.X, 0), Math.Max(aces.Y, 0), Math.Max(aces.Z, 0));
            V3 rgbPre = M3.Mul(AP0_to_AP1, amax);
            rgbPre = new V3(Math.Max(rgbPre.X, 0), Math.Max(rgbPre.Y, 0), Math.Max(rgbPre.Z, 0));
            rgbPre = M3.Mul(RRT_SAT, rgbPre);
            return new V3(SplineC5(rgbPre.X), SplineC5(rgbPre.Y), SplineC5(rgbPre.Z));
        }
        static V3 DimSurround(V3 linearCV)
        {
            V3 XYZ = M3.Mul(AP1_to_XYZ, linearCV);
            double div = Math.Max(XYZ.X + XYZ.Y + XYZ.Z, 1e-4);
            double x = XYZ.X / div, y = XYZ.Y / div, Y = XYZ.Y;
            Y = Math.Pow(Math.Max(Y, 0.0), DIM_SURROUND_GAMMA);
            double m = Y / Math.Max(y, 1e-4);
            V3 XYZ2 = new V3(x * m, Y, (1.0 - x - y) * m);
            return M3.Mul(XYZ_to_AP1, XYZ2);
        }
        static V3 ODT_Rec709(V3 rrt)
        {
            V3 rgbPost = new V3(SplineC9_48(rrt.X), SplineC9_48(rrt.Y), SplineC9_48(rrt.Z));
            V3 linearCV = new V3((rgbPost.X - CINEMA_BLACK) / (CINEMA_WHITE - CINEMA_BLACK),
                                 (rgbPost.Y - CINEMA_BLACK) / (CINEMA_WHITE - CINEMA_BLACK),
                                 (rgbPost.Z - CINEMA_BLACK) / (CINEMA_WHITE - CINEMA_BLACK));
            linearCV = DimSurround(linearCV);
            linearCV = M3.Mul(ODT_SAT, linearCV);
            V3 r = M3.Mul(AP1_to_Rec709, linearCV);
            return new V3(Math.Max(0, Math.Min(1, r.X)), Math.Max(0, Math.Min(1, r.Y)), Math.Max(0, Math.Min(1, r.Z)));
        }
        public static V3 Forward(V3 acescg) => ODT_Rec709(RRT(acescg));

        public static void Run()
        {
            Console.WriteLine("=== ACES 1.3 (RRT + Rec.709 100-nit ODT) CPU mirror ===");
            Console.WriteLine("Reference: ACES 1.0 Rec.709 maps mid-gray 0.18 -> ~0.0911 display-linear");
            foreach (double g in new double[] { 0.0, 0.001, 0.018, 0.05, 0.18, 0.5, 1.0, 4.0, 16.0 })
            {
                V3 o = Forward(new V3(g, g, g));
                Console.WriteLine($"gray {g,7:F3} -> ({o.X:F5},{o.Y:F5},{o.Z:F5})");
            }
            V3 mg = Forward(new V3(0.18, 0.18, 0.18));
            Console.WriteLine($"MID-GRAY 0.18 -> {mg.X:F5}  (expect ~0.091; sRGB-encoded ~{Math.Pow(mg.X, 1.0/2.4):F3})");
            foreach (var v in new V3[] { new V3(1, 0, 0), new V3(0.5, 0.02, 0.02), new V3(0, 1, 0), new V3(0, 0, 1) })
            {
                V3 o = Forward(v);
                Console.WriteLine($"sat ({v.X:F2},{v.Y:F2},{v.Z:F2}) -> ({o.X:F4},{o.Y:F4},{o.Z:F4})");
            }
        }
    }
}
