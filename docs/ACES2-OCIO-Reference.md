# ACES 2.0 Output Transform — OCIO-Faithful Port Reference

Source of truth: OCIO v2.5 in this repo at
`src/OCIOSharp/OpenColorIO/src/OpenColorIO/ops/fixedfunction/`:
- `ACES2/Common.h` — constants + struct layout + table sizing
- `ACES2/Transform.cpp` — the math + table generation (`init_*`, `make_*`)
- `FixedFunctionOpCPU.cpp` — `Renderer_ACES_OutputTransform20` (pipeline order)
- `FixedFunctionOpGPU.cpp` — the emitted GLSL/HLSL (closest to our SDSL target)

OCIO's ACES 2.0 = **Hellwig 2022 CAM "JMh" DRT**: a mix of **analytic math**
(CAM fwd/inv, tonescale, chroma + gamut compression) and **3 precomputed
per-hue tables** ("LUTs"). The tables require iterative RGB gamut-boundary
solves — **no closed form** — so they are generated CPU-side (C#) and uploaded
to the shader as textures + a const hue array.

## Forward pipeline (Renderer_ACES_OutputTransform20::fwd)

Input is scene-linear RGB (OCIO uses AP0; our grade tool feeds **ACEScg/AP1**,
so build the input JMhParams for **AP1** primaries — equivalent).

```
RGB(in prims) -> Aab (RGB_to_Aab, m_pIn)
Aab           -> JMh (Aab_to_JMh, m_pIn)
rp            = resolve per-hue {limit_J_max, model_gamma_inv, reachMaxM}   // reach table
cos_hr1,sin_hr1 = cos/sin(radians(JMh.h))
Mnorm         = chroma_compress_norm(cos_hr1, sin_hr1, chroma_compress_scale)
J_ts          = tonescale_A_to_J_fwd(Aab[0], m_pIn, t)        // tonescale on A, not J
JMh_cc        = chroma_compress_fwd(JMh, J_ts, Mnorm, rp, c)  // {J_ts, M_cp, h}
JMh_gc        = gamut_compress_fwd(JMh_cc, rp, g)             // cusp table
Aab_out       = JMh_to_Aab(JMh_gc, cos_hr1, sin_hr1, m_pOut)  // reuse input cos/sin; output prims
RGB(out prims)= Aab_to_RGB(Aab_out, m_pOut)
```
Hue is in **degrees** throughout, 1°/table entry. Output is **display-linear**
in the limiting/display gamut (then our HDRTonemap OETF stage encodes it).

## Constants (Common.h)
```
PI=3.14159265358979  hue_limit=360
reference_luminance=100  L_A=100  Y_b=20  surround={0.9,0.59,0.9}(F,c,N_c)
J_scale=100  cam_nl_offset=0.2713*100=27.13  cam_nl_scale=4*100=400
chroma_compress=2.4  chroma_compress_fact=3.3  chroma_expand=1.3
chroma_expand_fact=0.69  chroma_expand_thr=0.5
smooth_cusps=0.12  smooth_m=0.27  cusp_mid_blend=1.3  focus_gain_blend=0.3
focus_distance=1.35  focus_distance_scaling=1.75  compression_threshold=0.75
CAM16 primaries: R(0.8336,0.1735) G(2.3854,-1.4659) B(0.087,-0.125) W(0.333,0.333)
Table: nominal=360, total=363, base_index=1, lower_wrap=0, upper_wrap=361, upper extra=362
Table gen: gammaMin=0 gammaMax=5 gammaStep=0.4 gammaAccuracy=1e-5
  cuspCornerCount=6 reach_cusp_tol=1e-3 display_cusp_tol=1e-7
```
Matrix convention: `mult_f3_f33(v,M)` = row-major `M·v` (f3 dotted vs rows).
`copysign(x,0)=+x` (C++; OCIO keeps this, differs from CTL).
`lerpf(a,b,z)=(b-a)*z+a`.

## init_JMhParams(prims)  (Transform.cpp:470)
```
MATRIX_16   = XYZtoRGB(CAM16 prims)            // XYZ(illuminant E) -> CAM16 RGB
RGB_to_XYZ  = RGBtoXYZ(prims)                  // to XYZ(E), NO chromatic adapt
XYZ_w       = (100,100,100)·RGB_to_XYZ ; Y_W=XYZ_w[1] ; RGB_w = XYZ_w·MATRIX_16
K=1/(5*L_A+1)=1/501 ; K4=K^4
F_L   = 0.2*K4*(5*L_A) + 0.1*(1-K4)^2 * (5*L_A)^(1/3)
F_L_n = F_L/100
cz    = surround[1]*(1.48+sqrt(Y_b/100)) = 0.59*(1.48+sqrt(0.2))   // model_gamma()
inv_cz= 1/cz
D_RGB = { F_L_n*Y_W/RGB_w[i] }                 // adaptation (with F_L_n folded in)
RGB_WC= D_RGB[i]*RGB_w[i] ; RGB_AW=paccrc_fwd(RGB_WC[i])
cone_response_to_Aab(base, scaled): row0 of base scaled by 400, then:
  base = [ 2, 1, 1/20 ; 1, -12/11, 1/11 ; 1/9, 1/9, -2/9 ]
  A_w  = (400*base row0)·RGB_AW
MATRIX_RGB_to_CAM16   = RGBtoRGB(prims,CAM16) * 100
MATRIX_RGB_to_CAM16_c = diag(D_RGB) * MATRIX_RGB_to_CAM16
MATRIX_CAM16_c_to_RGB = inverse(MATRIX_RGB_to_CAM16_c)
MATRIX_cone_response_to_Aab = [ (400*base row0)/A_w ;
                                400*base row1 * 43*N_c ; 400*base row2 * 43*N_c ]  // N_c=0.9 -> 38.7
MATRIX_Aab_to_cone_response = inverse(MATRIX_cone_response_to_Aab)
A_w_J     = paccrc_fwd_scalar(F_L)             // uses RAW F_L
inv_A_w_J = 1/A_w_J
```
Post-adaptation nonlinearity (per channel, signed = copysign(f(|v|),v)):
```
paccrc_fwd(Rc>=0): t=pow(Rc,0.42); return t/(27.13+t)
paccrc_inv(Ra):    a=min(Ra,0.99); t=27.13*a/(1-a); return pow(t,1/0.42)
```

## RGB<->JMh (Transform.cpp:137)
```
RGB_to_Aab(RGB,p): m=RGB·M_RGB_to_CAM16_c; a=paccrc_fwd(m); return a·M_cone_response_to_Aab // {A,a,b}
Aab_to_JMh(Aab,p): if Aab[0]<=0 ->{0,0,0}; J=100*pow(Aab[0],cz); M=hypot(a,b);
                   h=degrees(atan2(b,a)) wrapped[0,360)
JMh_to_Aab(JMh,cos,sin,p): A=pow(J/100,inv_cz); a=M*cos; b=M*sin
Aab_to_RGB(Aab,p): r=Aab·M_Aab_to_cone_response; m=paccrc_inv(r); return m·M_CAM16_c_to_RGB
// achromatic Y shortcuts:
_A_to_Y(A,p)=paccrc_inv_scalar(A_w_J*A)/F_L_n ; _Y_to_J(Y,p): Ra=paccrc_fwd_scalar(Y*F_L_n); return 100*pow(Ra*inv_A_w_J,cz)
Y_to_J(Y,p)=copysign(_Y_to_J(|Y|),Y)
```

## Tonescale (Transform.cpp:1266 init, 335 apply)
```
init(n=peak): n_r=100 g=1.15 c=0.18 c_d=10.013 w_g=0.14 t_1=0.04 r_hit_min=128 r_hit_max=896
 r_hit=128+(896-128)*(ln(n/100)/ln(100))
 m_0=n/100 ; m_1=0.5*(m_0+sqrt(m_0*(m_0+4*t_1)))
 u=pow((r_hit/m_1)/((r_hit/m_1)+1),g) ; m=m_1/u
 w_i=log2(n/100) ; c_t=c_d/100*(1+w_i*w_g)
 g_ip=0.5*(c_t+sqrt(c_t*(c_t+4*t_1)))
 g_ipp2= -(m_1*pow(g_ip/m,1/g))/(pow(g_ip/m,1/g)-1) ; w_2=c/g_ipp2
 s_2=w_2*m_1*100 ; u_2=pow((r_hit/m_1)/((r_hit/m_1)+w_2),g) ; m_2=m_1/u_2
 forward_limit=8*r_hit ; log_peak=log10(n/100)
fwd aces_tonescale(Y_in): f=m_2*pow(Y_in/(Y_in+s_2),g); Y_ts=max(0,f*f/(f+t_1))*n_r
tonescale_A_to_J_fwd(A,p,t): Y=_A_to_Y(A,p); Yt=aces_tonescale(Y); return copysign(_Y_to_J(Yt,p), A)
```

## Chroma compression (Transform.cpp:283, init 1340)
```
init(peak,t): compr=2.4+(2.4*3.3)*log_peak ; sat=max(0.2,1.3-(1.3*0.69)*log_peak)
              sat_thr=0.5/peak ; chroma_compress_scale=pow(0.03379*peak,0.30596)-0.45135
chroma_compress_norm(cos,sin,ccs):  // Fourier M-normalisation
  c2=2c²-1; s2=2cs; c3=4c³-3c; s3=3s-4s³
  M = 11.34072*c +16.46899*c2 +7.88380*c3 +14.66441*s -6.37224*s2 +9.19364*s3 +77.12896
  return M*ccs
toe_fwd(x,limit,k1i,k2i): if x>limit ->x; k2=max(k2i,1e-3); k1=sqrt(k1i²+k2²); k3=(limit+k1)/(limit+k2)
  mb=k3*x-k1; return 0.5*(mb+sqrt(mb²+4*k2*k3*x))
chroma_compress_fwd(JMh,J_ts,Mnorm,rp,c): J=JMh.J M=JMh.M; if M==0 ->{J_ts,M,h}
  nJ=J_ts/limit_J_max ; snJ=max(0,1-nJ)
  limit=pow(nJ,model_gamma_inv)*reachMaxM/Mnorm
  M=M*pow(J_ts/J,model_gamma_inv)/Mnorm
  M=limit - toe_fwd(limit-M, limit-1e-3, snJ*sat, sqrt(nJ²+sat_thr))
  M=toe_fwd(M, limit, nJ*compr, snJ)
  return {J_ts, M*Mnorm, h}
```

## Gamut compression (Transform.cpp:912, init 1384)
```
init(peak,inJMh,limJMh,t,sh,reach):
  mid_J=Y_to_J(c_t*100, inJMh) ; focus_dist=1.35+1.35*1.75*log_peak
  lower_hull_gamma_inv=1/(1.14+0.07*log_peak)
  gamut_cusp_table = make_uniform_hue_gamut_table(reach,limJMh,peak,t.forward_limit,sh,hue_table)
  hue_linearity_search_range = determine_hue_linearity_search_range(gamut_cusp_table)
  make_upper_hull_gamma(...)  // overwrites cusp[i][2] = 1/topGamma
init_SharedCompressionParams: limit_J_max=Y_to_J(peak,inJMh); model_gamma_inv=1/model_gamma()
  reach_m_table = make_reach_m_table(reachAP1Params, limit_J_max)
per-hue resolve (init_HueDependantGamutParams):
  i_hi=lookup_hue_interval(h,hue_table,range); t=(h-hue[i_hi-1])/(hue[i_hi]-hue[i_hi-1])
  cusp=lerp(cuspTbl[i_hi-1],cuspTbl[i_hi],t)  -> JMcusp={cusp0,cusp1}, gamma_top_inv=cusp2
  focusJ=lerpf(JMcusp.J, mid_J, min(1, 1.3 - JMcusp.J/limit_J_max))
  analytical_threshold=lerpf(JMcusp.J, limit_J_max, 0.3)
get_focus_gain(J,thr,limJmax,fdist): gain=limJmax*fdist; if J>thr:
  ga=log10((limJmax-thr)/max(1e-4,limJmax-J)); gain*= (ga*ga+1); return gain
solve_J_intersect(J,M,focusJ,maxJ,sg): Ms=M/sg; a=Ms/focusJ;
  if J<focusJ: b=1-Ms; c=-J; return -2c/(b+sqrt(b²-4ac))
  else:        b=-(1+Ms+maxJ*a); c=maxJ*Ms+J; return -2c/(b-sqrt(b²-4ac))
compute_compression_vector_slope(iJ,focusJ,limJmax,sg):
  dir=(iJ<focusJ)?iJ:(limJmax-iJ); return dir*(iJ-focusJ)/(focusJ*sg)
estimate_line_and_boundary_intersection_M(Jaxis,slope,inv_gamma,Jmax,Mmax,Jref):
  nJ=Jaxis/Jref; shifted=Jref*pow(nJ,inv_gamma); return shifted*Mmax/(Jmax-slope*Mmax)
find_gamut_boundary_intersection(JMcusp,Jmax,gTopInv,gBotInv,iJsrc,slope,iJcusp):
  Mlo=estimate(...,iJsrc,slope,gBotInv,JMcusp.J,JMcusp.M,iJcusp)
  Mhi=estimate(Jmax-iJsrc,-slope,gTopInv,Jmax-JMcusp.J,JMcusp.M,Jmax-iJcusp)
  return smin_scaled(Mlo,Mhi,JMcusp.M)   // s=0.12*ref; h=max(s-|a-b|,0)/s; min(a,b)-h³*s/6
remap_M_fwd(M,gB,rB): ratio=gB/rB; prop=max(ratio,0.75); thr=prop*gB
  if M<=thr || prop>=1 ->M; mo=M-thr; go=gB-thr; ro=rB-thr
  scale=ro/((ro/go)-1); nd=mo/scale; return thr + scale*nd/(1+nd)
compressGamut(JMh,Jx,sr,p,hdp):
  sg=get_focus_gain(Jx,hdp.analytical_threshold,limit_J_max,focus_dist)
  iJsrc=solve_J_intersect(J,M,focusJ,limit_J_max,sg)
  slope=compute_compression_vector_slope(iJsrc,focusJ,limit_J_max,sg)
  iJcusp=solve_J_intersect(JMcusp.J,JMcusp.M,focusJ,limit_J_max,sg)
  gB=find_gamut_boundary_intersection(JMcusp,limit_J_max,gamma_top_inv,gamma_bottom_inv,iJsrc,slope,iJcusp)
  if gB<=0 ->{J,0,h}
  rB=estimate_line_and_boundary_intersection_M(iJsrc,slope,model_gamma_inv,limit_J_max,reachMaxM,limit_J_max)
  Mr=remap_M_fwd(M,gB,rB); return {iJsrc+Mr*slope, Mr, h}
gamut_compress_fwd(JMh,sr,p): if J<=0->{0,0,h}; if M<=0||J>limit_J_max->{J,0,h}
  hdp=resolve(h); return compressGamut(JMh, J, sr, p, hdp)
```

## Tables (generated in C#, uploaded as textures + hue const array)
- **reach_m_table** Table1D[363]: per hue i in 0..359 (hue=i): bisect max M at
  `JMh_to_RGB({limit_J_max, M, hue}, reachAP1Params)` where any channel first goes <0
  (expand by 50 to ≤1300, then bisect to 1e-2). Wrap: [0]=last_nominal, [361]=first, [362]=first+1.
  Render lookup is **uniform** 1°: `reach_m_from_table(h)`= lerp(t[(uint)h+1], t[(uint)h+2], frac(h)).
- **hue_table** Table1D[363]: NON-uniform hue breakpoints placed so the 8 cube/reach
  corners land exactly (built from sorted unique corner hues). Wrap entries ±360.
- **gamut_cusp_table** Table3D[363] = {cuspJ, cuspM*(1+0.27*0.12), gamma_top_inv}:
  cusp found per hue by bracketing the corner segment then binary-search lerp of RGB
  corners until `RGB_to_JMh(...).h==hue` (tol 1e-7). Then `make_upper_hull_gamma`
  replaces channel[2] with 1/gamma found by expand+bisect over [0,5] using 5 test
  J positions {0.01,0.1,0.5,0.8,0.99} and `outside_hull(RGB, peak/100)`.
  Render lookup: binary search hue_table (search_range padding {min(0,δ), max(1,δ)+1}),
  then lerp cusp rows by `(h-hue[i_hi-1])/(hue[i_hi]-hue[i_hi-1])`.

## Per-case baking
Build once per (peakLuminance, inputPrims=AP1, limitPrims). Cases needed by grade tool:
- SDR: limitPrims = Rec.709, peak = 100
- HDR Rec.2020: limitPrims = Rec.2020, peak = peakBrightness (regenerate on change)
All `init_*` scalars/matrices are baked floats; tables are the 3 textures + hue array.

## Verification
- Numeric: compare C# `RGB_to_JMh`/`tonescale`/full-fwd against OCIO CPU for a grid of
  ACEScg test values (mid-gray 0.18, primaries, near-black, >1 highlights). Build a small
  C# harness; cross-check a few values by hand from the formulas above.
- pipeline-checker WGSL stages mirror the SDSL; compare against reference-values.json.
- Designer test: export PNG vs live vvvv on same display; check mid-gray + saturated colors.
