import PyOpenColorIO as ocio, numpy as np, json
cfg = ocio.Config.CreateFromBuiltinConfig('cg-config-v4.0.0_aces-v2.0_ocio-v2.5')
dt = ocio.DisplayViewTransform(src='ACEScg', display='sRGB - Display', view='ACES 2.0 - SDR 100 nits (Rec.709)')
cpu = cfg.getProcessor(dt).getDefaultCPUProcessor()
def srgb_inv(v):
    v=np.asarray(v,dtype=float); return np.where(v<=0.04045, v/12.92, ((v+0.055)/1.055)**2.4)
tests = {
 "gray0.18":[0.18,0.18,0.18], "gray0.5":[0.5,0.5,0.5],
 "red_sat":[0.7,0.05,0.05], "green_sat":[0.05,0.6,0.05], "blue_sat":[0.05,0.05,0.6],
 "red_prim":[1.0,0.0,0.0], "green_prim":[0.0,1.0,0.0], "blue_prim":[0.0,0.0,1.0],
 "yellow":[0.6,0.5,0.05], "cyan":[0.05,0.5,0.5], "magenta":[0.5,0.05,0.5],
 "skin":[0.35,0.20,0.13], "orange":[0.8,0.3,0.05], "deep_red":[0.4,0.02,0.02],
}
out={}
for n,rgb in tests.items():
    enc = cpu.applyRGB(list(map(float,rgb)))      # sRGB-encoded (RETURN value!)
    lin = srgb_inv(np.array(enc)).tolist()
    out[n]={"in":rgb,"ocio_lin":[round(x,5) for x in lin]}
json.dump({"tests":tests,"ocio":out}, open('parity_ref.json','w'), indent=0)
for n,v in out.items(): print(f"{n:11s} in={str(v['in']):24s} OCIO_lin={v['ocio_lin']}")
