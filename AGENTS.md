# VL.OCIO

OpenColorIO integration for vvvv/Stride: GPU and CPU color transforms, HDR color grading and a WebSocket-driven React web UI for real-time parameter control. Architecture, transform chains, shaders and workflows are in [docs/architecture.md](docs/architecture.md).

## Code style

- Use `using` directives. Never write fully qualified type names inline (`[DefaultValue(...)]`, not `[System.ComponentModel.DefaultValue(...)]`).
- Keep code clean and readable.
- No em-dashes in code comments, XML docs, plans or prose; use hyphens, commas or separate sentences.
- vvvv pin help text (XML `<param>` and `<summary>`) is terse: one or two short sentences per pin that still say how the mechanism works.

## Versioning

When making a new package without being told otherwise, bump only the patch number (1.6.0 to 1.6.1). Bump minor or major only when the owner says so. NuGet versions are immutable once published.

## Matrix Precision

Always use OCIO's exact matrix values from `ColorMatrixHelpers.cpp::build_conversion_matrix_from_XYZ_D65()`.

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
2. No "Node" suffix in class name
3. Constructor: `public MyNode(NodeContext nodeContext)`
4. Update method: `public void Update(out ..., params ...)`
5. **out parameters FIRST**, value inputs with defaults AFTER
6. XML comments (shown as Info in vvvv)
7. **Zero allocations in the Update loop** - cache everything
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

## Web UI parity

Every feature that adds or changes enums, settings or parameters in the C# backend or the SDSL shaders is also implemented in the web UI (`ui/src/types/settings.ts` for types and labels, components for new controls). Rebuild the web UI afterwards: `cd ui && npm run build`.

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

## Project knowledge

- [docs/architecture.md](docs/architecture.md): project structure, core components, transform chains, linear display workflow, HDR grading workflow.
- [docs/agent-memory/color-science.md](docs/agent-memory/color-science.md): tonemap input spaces, linear display strategy, SDSL rules, the ACES 2.0 port and what was learned.
- [docs/ACES2-OCIO-Reference.md](docs/ACES2-OCIO-Reference.md): the full ACES 2.0 algorithm as extracted from OCIO.
- [docs/HDR-Color-Pipeline-Overview.md](docs/HDR-Color-Pipeline-Overview.md): HDR pipeline overview.
- `tasks/todo.md` and `tasks/lessons.md`: plan and lessons.
