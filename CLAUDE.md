# VL.OCIO Architecture

OpenColorIO integration for vvvv/Stride with GPU and CPU color transforms, HDR color grading, and a WebSocket-driven web UI for real-time parameter control.

## Project Structure

```
VL.OCIO/
├── src/
│   ├── OCIOSharp/                     # C++ OCIO library + C++/CLI wrapper
│   │   ├── OCIOSharpCLI/
│   │   │   └── OCIOConfig.h           # Main C++/CLI wrapper
│   │   └── OpenColorIO/               # OCIO v2.5 source (submodule)
│   ├── OCIOColorSpacesDynamicEnum.cs  # Dynamic enum definitions (CS, DisplayView, Look, Config)
│   ├── OCIOConfigUtils.cs             # C# utility layer (GPU resources, enum refresh)
│   ├── OCIOConfigService.cs           # Per-app singleton managing config lifecycle
│   ├── OCIOConfigLoader.cs            # ProcessNode: load OCIO config from file
│   ├── OCIOConfigManager.cs           # ProcessNode: switch active config via dropdown
│   ├── OCIOTransformCPU.cs            # CPU colorspace transform node
│   ├── OCIODisplayViewTransformCPU.cs # CPU display/view transform node
│   └── HDR/                           # HDR color grading system
│       ├── ColorSpaceEnums.cs         # HDRColorSpace, DisplayFormat, TonemapOperator, IOColorSpace, GradingSpace, DebugMode
│       ├── ColorCorrectionSettings.cs # Color correction parameters (exposure, contrast, LGG, color wheels)
│       ├── TonemapSettings.cs         # Tonemap parameters (operator, paper white, peak brightness)
│       ├── ProjectSettings.cs         # Combined settings with JSON serialization + presets
│       ├── ColorGradingServer.cs      # WebSocket server ProcessNode for web UI communication
│       └── ColorGradingInstance.cs    # Per-instance color grading state (multi-instance support)
├── shaders/
│   ├── OCIOBase.sdsl                  # Stride shader base (abstract OCIODisplay)
│   ├── OCIOTransform_TextureFX.sdsl   # GPU transform shader host (OCIO LUTs)
│   ├── ColorSpaceConversion.sdsl      # Matrix-based conversions (all HDR color spaces)
│   ├── HDRGrade_TextureFX.sdsl        # GPU color grading (log/linear workflows)
│   └── HDRTonemap_TextureFX.sdsl      # GPU tonemapping + HDR output transforms
├── ui/                                # React/Vite web UI for color grading
│   ├── src/
│   │   ├── App.tsx                    # Main app with color grading controls
│   │   ├── hooks/useWebSocket.ts      # WebSocket connection to ColorGradingServer
│   │   ├── types/settings.ts          # TypeScript settings types (mirrors C#)
│   │   └── components/               # UI components (ColorWheel, Slider, PresetManager, etc.)
│   ├── vite.config.ts
│   ├── tailwind.config.js
│   └── package.json
├── presets/                           # JSON preset files for color grading
│   └── default.json
├── VL.OCIO.vl                         # vvvv node definitions
└── CLAUDE.md                          # This file
```

## Core Components

### 1. C++/CLI Wrapper (`OCIOConfig.h`)

**Purpose:** Bridge between OCIO C++ API and .NET/C#

**Key Methods:**
- `LoadConfig(path)` / `LoadBuiltinConfig(name)` - Load OCIO configs
- `GetColorSpaces()`, `GetDisplays()`, `GetLooks()`, `GetRoles()` - Query config
- `CreateProcessor(...)` - Create transform processor (3 overloads)
  - ColorSpace → ColorSpace
  - Input → Display/View
  - Input → Look → Display/View (GroupTransform via `CreateDisplayViewProcessor`)
- `GetHLSLShader()`, `GetUniforms()`, `GetTextures()`, `Get3DTextures()` - GPU resources
- `ApplyCPUTransform(...)`, `ApplyCPUTransformSeparate(...)`, `ApplyCPUTransformPixel(...)` - CPU pixel processing

**Synthetic Linear Displays:**
- Adds 4 linear displays: Linear Rec.709, Rec.2020, P3-D65, AdobeRGB
- Matrix-only transform (XYZ D65 → target primaries, no gamma)
- Uses OCIO's exact matrices from `ColorMatrixHelpers.cpp`
- Copies ALL views from ALL existing displays (HDR + SDR coverage)

### 2. Config Management System

**OCIOConfigService** (`OCIOConfigService.cs`):
- Per-app singleton via `AppHost.Services.RegisterService()`
- Holds the active `OCIOConfig` and manages switching between configs
- Supports both builtin OCIO configs and file-loaded configs
- `SwitchConfig(name)` - Switch active config, refreshes all enums
- `LoadConfigFromFile(path)` - Load custom config, deduplicates by path, handles name collisions with `#N` suffix
- `EnsureDefaultLoaded()` - Lazy init with "ACES 2.0 CG" default

**OCIOConfigLoader** (`OCIOConfigLoader.cs`):
- ProcessNode that loads an OCIO config from a file path
- Multiple instances can load multiple configs into the dropdown
- Change-detected: only reloads when path changes

**OCIOConfigManager** (`OCIOConfigManager.cs`):
- ProcessNode to switch active config via `OCIOConfigEnum` dropdown
- Outputs formatted list of all available configs with sources

**OCIOConfigUtils** (`OCIOConfigUtils.cs`):
- Static utility layer, holds `ActiveConfig` reference
- `RefreshEnumsFrom(config)` - Rebuilds all dynamic enums from config (3 triggers total)
- `GetGPUResources(...)` - 3 overloads for CS→CS, CS→Display/View, CS→Look→Display/View
- `EnsureInitialized()` - Lazy static init, loads CG config if nothing loaded yet

### 3. Dynamic Enums (`OCIOColorSpacesDynamicEnum.cs`)

**Pattern:** `DynamicEnumBase<T, TDef>` + `DynamicEnumDefinitionBase`

**Enums:**
- `OCIOColorSpaceEnum` - All colorspaces (scene + display) + roles
- `OCIODisplayViewEnum` - Display/View pairs (format: "DisplayName/ViewName")
- `OCIOLookEnum` - Looks (LMTs) + "None"
- `OCIOConfigEnum` - Available configs (builtins + file-loaded), default "ACES 2.0 CG"

**Builtin Configs (in OCIOConfigEnumDefinition):**
- ACES 2.0 CG (`cg-config-v4.0.0_aces-v2.0_ocio-v2.5`)
- ACES 2.0 Studio (`studio-config-v4.0.0_aces-v2.0_ocio-v2.5`)
- ACES 1.3 CG (`cg-config-v2.2.0_aces-v1.3_ocio-v2.4`)
- ACES 1.3 Studio (`studio-config-v2.2.0_aces-v1.3_ocio-v2.4`)

**Tags:**
- `OCIOInputTag` - Carries `ColorSpace` name
- `OCIOTargetTag` - Carries `Kind` + `Display` + `View` names
- `OCIOConfigTag` - Carries `IsBuiltin`, `BuiltinUri`, `FilePath`, `Source`

**Updates:** Triggered via `SetEntries()` which calls `trigger.OnNext("")`

### 4. CPU Transform Nodes

**OCIOTransformCPU:**
- ColorSpace → ColorSpace transform on CPU
- Input/Output: IImage (R32G32B32A32F format)
- Caches processor + output image + work buffer (zero allocations after warmup)

**OCIODisplayViewTransformCPU:**
- Display/View + Look transform on CPU
- Input/Output: IImage (R32G32B32A32F format)
- Same caching strategy as OCIOTransformCPU

**Performance:**
- Change detection: only recreate processor on param change
- Image ownership: CloneEmpty() creates owned output images
- Buffer reuse: float[] work buffer reused per frame
- Two memory copies: IImage → float[] → IImage (required by OCIO CPU API)
- No LINQ, no allocations in hot path after warmup

### 5. HDR Color Grading System

**Architecture:**
```
ColorGradingServer (WebSocket) ←→ Web UI (React/Vite)
        ↕
ColorGradingInstance (per-instance state)
        ↕
HDRGrade_TextureFX (GPU grading shader)
        ↕
HDRTonemap_TextureFX (GPU tonemap shader)
```

**ColorGradingServer** (`src/HDR/ColorGradingServer.cs`):
- WebSocket server ProcessNode (default port 9999, auto-increments if busy)
- Serves the web UI via HTTP (static files from `ui/dist`)
- Writes `discovery.json` for UI auto-connect
- Auto-opens browser after 3-second delay if no clients connect
- Multi-instance support: routes settings to specific `ColorGradingInstance` nodes
- Preset system: save/load JSON presets to `presets/` directory
- Session persistence: auto-saves to `_lastsession.json` with 2-second debounce
- Dual persistence: Editor mode uses `SetPinValue` (native vvvv undo), Exported mode uses JSON files
- Ping/pong heartbeat for connection health
- Native file browse dialog (Windows Forms OpenFileDialog on STA thread)

**ColorGradingInstance** (`src/HDR/ColorGradingInstance.cs`):
- ProcessNode representing a single grading instance
- Registers with a `ColorGradingServer` for web UI control
- Auto-generates instance ID from node path, or accepts custom ID
- Dual state model: Editor mode uses Create pin defaults, Exported mode uses runtime overrides
- Outputs effective settings (runtime override or Create pin defaults)

**Settings Classes:**
- `ColorCorrectionSettings` - Exposure, contrast, saturation, white balance, lift/gamma/gain/offset, color wheels (shadow/midtone/highlight), soft clipping. Has `Split()` method for vvvv pin mapping.
- `TonemapSettings` - Input/output color space, tonemap operator (None/ACES/Reinhard/ReinhardExtended), paper white, peak brightness. Has `Split()` and `GetDisplayFormat()`.
- `ProjectSettings` - Combined container with JSON serialization (`SaveToFile`/`LoadFromFile`/`Clone`)
- `Vector3Json` - JSON-serializable Vector3 wrapper (Stride Vector3 doesn't serialize well)

**Color Space Enums** (`src/HDR/ColorSpaceEnums.cs`):
- `HDRColorSpace` - 9 values: Linear_Rec709, Linear_Rec2020, ACEScg, ACEScc, ACEScct, sRGB, PQ_Rec2020, HLG_Rec2020, scRGB
- `DisplayFormat` - 3 values: sRGB, Linear_Rec709, PQ_Rec2020
- `TonemapOperator` - 4 values: None, ACES, Reinhard, ReinhardExtended
- `IOColorSpace` - 4 values: ACEScg, Linear709, sRGB, ACEScct (for HDRGrade shader)
- `GradingSpace` - 2 values: Log (ACEScct), Linear (ACEScg)
- `DebugMode` - 4 values: Off, RawInput, ACESccVisualize, ThresholdTest

### 6. Stride Shaders

**OCIOBase.sdsl:**
```hlsl
abstract shader OCIOBase : ShaderBase
{
    abstract float4 OCIODisplay(float4 inPixel);
};
```

**OCIOTransform_TextureFX.sdsl:**
- Hosts OCIO-generated LUT sampling code via composition
- Samples input texture and calls `Display.OCIODisplay(tex0col)`

**ColorSpaceConversion.sdsl:**
- Base shader with all color space conversion functions
- Gamut matrices: Rec.709↔Rec.2020, Rec.709↔AP1, Rec.2020↔AP1 (with D65↔D60 Bradford adaptation)
- Transfer functions: sRGB (via Stride ColorUtility), ACEScc, ACEScct, PQ/ST.2084, HLG/BT.2100
- Hub architecture: `ToLinearRec709()` / `FromLinearRec709()` / `ConvertColorSpace()` for any-to-any conversion

**HDRGrade_TextureFX.sdsl:**
- Professional color grading with transparent 3-parameter pipeline: InputSpace → Linear AP1 → GradingSpace → Linear AP1 → OutputSpace
- Two grading workflows:
  - Log (ACEScct): Colorist workflow (DaVinci Resolve style) - additive exposure, contrast around mid-gray
  - Linear (ACEScg): VFX compositing workflow (Nuke style) - multiplicative exposure, power contrast
- ASC-CDL style controls: Lift/Gamma/Gain/Offset
- Color wheels with zone weighting (shadow/midtone/highlight)
- Branchless soft clipping
- Uses `[EnumType("VL.OCIO.HDRColorSpace, VL.OCIO")]` for C# enum binding (all 9 color spaces)
- I/O conversion: direct paths for AP1 variants (ACEScg/ACEScc/ACEScct), hub through Linear709 for all others

**HDRTonemap_TextureFX.sdsl:**
- Final pipeline stage: tonemapping + HDR output transforms
- Tonemap operators: None, ACES (Stephen Hill fit with AP1 gamut mapping), Reinhard, Reinhard Extended
- HDR output: PQ/Rec.2020 (HDR10), HLG/Rec.2020, scRGB with paper white + peak brightness scaling
- Pipeline: Input → Linear Rec.709 → Exposure → Tonemap → HDR scaling → Output space

### 7. Web UI (`ui/`)

**Tech Stack:** React, TypeScript, Vite, Tailwind CSS

**Components:**
- `App.tsx` - Main app with all grading controls
- `useWebSocket.ts` - WebSocket hook with auto-reconnect, ping/pong heartbeat
- `ColorWheel.tsx` - Color wheel for Lift/Gamma/Gain and Shadow/Mid/Highlight tinting
- `LiftGammaGain.tsx` - Combined LGG control
- `Slider.tsx` - Parameter slider with range and step
- `Select.tsx` - Dropdown selector
- `PresetManager.tsx` - Save/load presets
- `InstanceSelector.tsx` - Multi-instance selector
- `Section.tsx` - Collapsible UI section

**Communication:**
- WebSocket messages: `update`, `loadPreset`, `savePreset`, `setInputFile`, `browseFile`, `reset`, `selectInstance`, `getState`, `ping`
- Server responses: `state`, `presets`, `instancesChanged`, `pong`
- Settings types mirror C# classes (defined in `types/settings.ts`)

## OCIO Transform Chains

### 1. ColorSpace → ColorSpace (No Tone Mapping)

**Use Case:** EXR interchange, preserve scene-referred data

**Chain:**
```
Input CS → Scene Reference → Output CS
```

**GPU:** `GetGPUResources(inputCS, outputCS, inverse)`
**CPU:** `OCIOTransformCPU` node

### 2. Input → Display/View (Standard OCIO)

**Use Case:** Real-time display with tone mapping

**Chain:**
```
Input CS → Scene Reference → View Transform (tone map) → Display CS (gamma)
```

**GPU:** `GetGPUResources(inputCS, displayView, inverse)`
**CPU:** Use `OCIODisplayViewTransformCPU` with `look="None"`

### 3. Input → Look → Display/View (DJV-Style)

**Use Case:** Creative grading + tone mapping + gamma

**Chain:**
```
Input CS → [Look] → View Transform → Display CS
```

**GPU:** `GetDisplayViewTransformResources(inputCS, displayView, look, inverse)`
**CPU:** `OCIODisplayViewTransformCPU` node

**Note:** GroupTransform chains Look + DisplayViewTransform → single shader

## Linear Display Workflow

**Problem:** DX11 sRGB backbuffer applies gamma automatically. Standard "sRGB - Display" would double-apply gamma.

**Solution:** Synthetic linear displays output linear Rec.709 values. DX11 sRGB backbuffer applies gamma once.

**Pipeline:**
```
OCIO: Input → View Transform → XYZ D65 → Linear Rec.709 (matrix only)
DX11: Linear Rec.709 → sRGB backbuffer (hardware gamma) → Display
```

**Available Linear Displays:**
- Linear Rec.709 - Display
- Linear Rec.2020 - Display
- Linear P3-D65 - Display
- Linear AdobeRGB - Display

Each has ALL views from ALL existing displays (Raw, ACES 2.0 SDR/HDR, Un-tone-mapped, Video colorimetric).

## HDR Color Grading Workflow

**Pipeline:**
```
Input Texture → HDRGrade_TextureFX (color correction in ACEScct/ACEScg)
             → HDRTonemap_TextureFX (tonemap + output transform)
             → Display
```

**Web UI Control Flow:**
```
Web UI (browser) ←WebSocket→ ColorGradingServer ←Update→ ColorGradingInstance
                                                           ↓
                                                  outColorCorrection → HDRGrade shader
                                                  outTonemap → HDRTonemap shader
```

**Persistence Modes:**
- **Editor mode:** `IDevSession.SetPinValue()` updates Create pin defaults → native vvvv undo/redo, document save
- **Exported mode:** JSON files in `presets/instances/` + runtime state override on `ColorGradingInstance`

## Matrix Precision

**Critical:** Always use OCIO's exact matrix values from `ColorMatrixHelpers.cpp::build_conversion_matrix_from_XYZ_D65()`.

**Example (XYZ D65 → Rec.709):**
```cpp
const double rec709[16] = {
     3.240969941905, -1.537383177570, -0.498610760293, 0,
    -0.969243636281,  1.875967501508,  0.041555057407, 0,
     0.055630079697, -0.203976958889,  1.056971514243, 0,
     0, 0, 0, 1
};
```

Wrong matrices (even 0.016% off) cause subtle saturation shifts.

## vvvv Integration Rules

**ProcessNode Requirements:**
1. `[ProcessNode]` attribute on class
2. NO "Node" suffix in class name
3. Constructor: `public MyNode(NodeContext nodeContext)`
4. Update method: `public void Update(out ..., params ...)`
5. **out parameters FIRST**, value inputs with defaults AFTER
6. XML comments (shown as Info in vvvv)
7. **ZERO allocations in Update loop** - cache everything
8. **No LINQ in hot paths**
9. **Change detection** - only do work when params change
10. Always output latest data (cached)

**Example:**
```csharp
[ProcessNode]
public class MyTransform : IDisposable
{
    public MyTransform(NodeContext nodeContext) { }

    public void Update(
        out float result,  // OUT first
        out string error,
        float input = 0)   // VALUE inputs with defaults
    {
        result = CachedProcess(input);
        error = null;
    }

    public void Dispose() { }
}
```

**Enum Binding in Shaders:**
```hlsl
[EnumType("VL.OCIO.HDRColorSpace, VL.OCIO")]
int InputSpace = 0;
```

## Common Workflows

### Real-Time GPU Display (OCIO)
```
Input: ACEScg EXR
Display: Linear Rec.709 - Display / ACES 2.0 - SDR 100 nits (Rec.709)
Look: None
→ Stride renders to sRGB backbuffer → Display
```

### HDR Color Grading (Web UI)
```
Input: Linear Rec.709 texture
Grade: HDRGrade_TextureFX (ACEScct log workflow, controlled via web UI)
Output: HDRTonemap_TextureFX (ACES tonemap → sRGB or PQ/HDR10)
→ ColorGradingServer manages presets + multi-instance state
```

### Offline File Delivery
```
Input: ACEScg EXR
Display: sRGB - Display / ACES 2.0 - SDR 100 nits (Rec.709)
Look: None
CPU Node: OCIODisplayViewTransformCPU
→ Save to PNG/JPEG (baked tone mapping + gamma)
```

### Creative Grading
```
Input: ACEScg EXR
Display: Linear Rec.709 - Display / ACES 2.0 - SDR 100 nits (Rec.709)
Look: ACES 1.3 Reference Gamut Compression
→ Compresses out-of-gamut camera colors → tone map → display
```

## Build Order

1. Build `OCIOSharpCLI` (C++/CLI, VS manually) → `OCIOSharpCLI.dll` + `OpenColorIO_2_5.dll`
2. Build `VL.OCIO` (C#, .NET 8) → `VL.OCIO.dll` (to `lib/`)
3. vvvv auto-discovers ProcessNode classes and methods
4. (Optional) Build web UI: `cd ui && npm install && npm run build` → `ui/dist/`

## Debugging

**Check Config Loaded:**
```csharp
if (OCIOConfigUtils.ActiveConfig == null) return;
```

**Validate Enum Tags:**
```csharp
var inputTag = inputColorSpace?.Tag as OCIOInputTag;
var outputTag = displayView?.Tag as OCIOTargetTag;
```

**Test CPU Transform:**
```csharp
float[] testPixel = { 0.5f, 0.5f, 0.5f, 1.0f };
config.ApplyCPUTransformPixel(testPixel);
// testPixel now transformed
```

**ColorGradingServer Debug:**
- Console.WriteLine logs prefixed with `[ColorGradingServer]`
- `lastError` output pin on the node
- Check `discovery.json` in UI dist folder for port info

## Important Implementation Rules

- **Web UI parity:** Every new feature that adds or changes enums, settings, or parameters in the C# backend or SDSL shaders MUST also be implemented in the web UI (`ui/src/types/settings.ts` for types/labels, components for any new controls). Always rebuild the web UI (`cd ui && npm run build`) after changes.

## References

- [OCIO v2.5 Docs](https://opencolorio.readthedocs.io/)
- [ACES 2.0 Spec](https://github.com/ampas/aces-dev)
- [Stride Shader System](https://doc.stride3d.net/latest/en/manual/graphics/effects-and-shaders/)
- [vvvv ProcessNode Guide](https://thegraybook.vvvv.org/reference/extending/writing-nodes.html)
- [SMPTE ST 2084:2014](https://en.wikipedia.org/wiki/Perceptual_quantizer) (PQ transfer function)
- [ITU-R BT.2100](https://www.itu.int/rec/R-REC-BT.2100) (HLG/HDR Television)
- [ASC CDL](https://en.wikipedia.org/wiki/ASC_CDL) (Color Decision List)
