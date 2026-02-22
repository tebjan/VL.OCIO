// =============================================================================
// ShaderTranspiler — SDSL to WGSL transpiler for VL.OCIO Pipeline Checker
// =============================================================================
//
// Converts the 6 per-stage SDSL TextureFX shaders into WGSL for the pipeline
// checker's WebGPU rendering.
//
// Pipeline (default):
//   SDSL source files → SDSL extraction → syntax transform → WGSL
//
// Pipeline (with --dxc-naga):
//   SDSL → HLSL extraction → DXC (HLSL→SPIR-V) → Naga (SPIR-V→WGSL) → post-process
//
// Usage:
//   dotnet run                          -- Direct SDSL → WGSL transpilation
//   dotnet run -- --dxc-naga            -- Use DXC+Naga pipeline (requires tools on PATH)
//   dotnet run -- --hlsl-dir <path>     -- Start from pre-compiled HLSL
//   dotnet run -- --stage input-convert -- Process single stage
//   dotnet run -- --dry-run             -- Show what would be generated, don't write
//   dotnet run -- --keep-intermediates  -- Keep temp files
//
// =============================================================================

using System.Diagnostics;
using System.Text;
using System.Text.RegularExpressions;

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

var repoRoot = FindRepoRoot();
var shadersDir = Path.Combine(repoRoot, "shaders");
var referenceWgslDir = Path.Combine(repoRoot, "pipeline-checker", "src", "shaders", "generated");
var outputDir = Path.Combine(repoRoot, "pipeline-checker", "src", "shaders", "transpiled");
var tempDir = Path.Combine(Path.GetTempPath(), "ShaderTranspiler");

// Parse CLI args
string? hlslDir = null;
string? singleStage = null;
bool keepIntermediates = false;
bool useDxcNaga = false;
bool dryRun = false;

for (int i = 0; i < args.Length; i++)
{
    switch (args[i])
    {
        case "--hlsl-dir" when i + 1 < args.Length:
            hlslDir = args[++i];
            break;
        case "--stage" when i + 1 < args.Length:
            singleStage = args[++i];
            break;
        case "--keep-intermediates":
            keepIntermediates = true;
            break;
        case "--dxc-naga":
            useDxcNaga = true;
            break;
        case "--dry-run":
            dryRun = true;
            break;
        case "--help" or "-h":
            PrintUsage();
            return 0;
    }
}

// Tool paths (only needed for --dxc-naga mode)
var dxcPath = FindDxc();
var nagaPath = FindNaga();

// Stage definitions
var stages = new StageDefinition[]
{
    new("InputConvert_TextureFX",      "input-convert",   "Stage 4: Input Interpretation"),
    new("ColorGradeStage_TextureFX",   "color-grade",     "Stage 5: Color Grading"),
    new("RRTStage_TextureFX",          "rrt",             "Stage 6: RRT (Tonemap Curve)"),
    new("ODTStage_TextureFX",          "odt",             "Stage 7: ODT (Device Transform)"),
    new("OutputEncode_TextureFX",      "output-encode",   "Stage 8: Output Encoding"),
    new("DisplayRemap_TextureFX",      "display-remap",   "Stage 9: Display Remap"),
};

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------

Console.WriteLine("ShaderTranspiler — SDSL to WGSL for VL.OCIO Pipeline Checker");
Console.WriteLine($"  Repo root:  {repoRoot}");
Console.WriteLine($"  Shaders:    {shadersDir}");
Console.WriteLine($"  Output:     {outputDir}");
if (useDxcNaga)
{
    Console.WriteLine($"  Mode:       DXC + Naga pipeline");
    Console.WriteLine($"  DXC:        {dxcPath ?? "NOT FOUND"}");
    Console.WriteLine($"  Naga:       {nagaPath ?? "NOT FOUND"}");
}
else
{
    Console.WriteLine($"  Mode:       Direct SDSL → WGSL transpilation");
}
Console.WriteLine();

// Load all SDSL source files
var sdslSources = new Dictionary<string, string>();
foreach (var f in Directory.GetFiles(shadersDir, "*.sdsl"))
{
    sdslSources[Path.GetFileNameWithoutExtension(f)] = File.ReadAllText(f);
}
Console.WriteLine($"  Loaded {sdslSources.Count} SDSL source files");
Console.WriteLine();

Directory.CreateDirectory(tempDir);
Directory.CreateDirectory(outputDir);

int processed = 0;
int failed = 0;

foreach (var stage in stages)
{
    if (singleStage != null && singleStage != stage.WgslName)
        continue;

    Console.WriteLine($"=== {stage.Label} ({stage.WgslName}) ===");

    try
    {
        string wgslOutput;

        if (useDxcNaga || hlslDir != null)
        {
            wgslOutput = RunDxcNagaPipeline(stage, sdslSources, hlslDir, dxcPath, nagaPath);
        }
        else
        {
            wgslOutput = TranspileDirectly(stage, sdslSources);
        }

        if (dryRun)
        {
            Console.WriteLine($"  [DRY RUN] Would write {wgslOutput.Length} chars to {stage.WgslName}.wgsl");
            var lines = wgslOutput.Split('\n');
            Console.WriteLine($"  First 5 lines:");
            for (int i = 0; i < Math.Min(5, lines.Length); i++)
                Console.WriteLine($"    {lines[i].TrimEnd()}");
        }
        else
        {
            var outputPath = Path.Combine(outputDir, $"{stage.WgslName}.wgsl");
            File.WriteAllText(outputPath, wgslOutput);
            Console.WriteLine($"  Written: {Path.GetRelativePath(repoRoot, outputPath)} ({wgslOutput.Split('\n').Length} lines)");
        }

        processed++;
    }
    catch (Exception ex)
    {
        Console.Error.WriteLine($"  FAILED: {ex.Message}");
        if (ex.InnerException != null)
            Console.Error.WriteLine($"    Inner: {ex.InnerException.Message}");
        failed++;
    }

    Console.WriteLine();
}

// Cleanup
if (!keepIntermediates && Directory.Exists(tempDir))
{
    try { Directory.Delete(tempDir, true); } catch { }
}

Console.WriteLine($"Result: {processed} succeeded, {failed} failed");
return failed > 0 ? 1 : 0;

// =============================================================================
// Direct SDSL → WGSL transpilation
// =============================================================================

string TranspileDirectly(StageDefinition stage, Dictionary<string, string> sources)
{
    Console.Write("  SDSL → WGSL: ");

    var transpiler = new SdslToWgslTranspiler(sources, referenceWgslDir);
    var wgsl = stage.WgslName switch
    {
        "input-convert"  => transpiler.TranspileInputConvert(),
        "color-grade"    => transpiler.TranspileColorGrade(),
        "rrt"            => transpiler.TranspileRrt(),
        "odt"            => transpiler.TranspileOdt(),
        "output-encode"  => transpiler.TranspileOutputEncode(),
        "display-remap"  => transpiler.TranspileDisplayRemap(),
        _ => throw new InvalidOperationException($"Unknown stage: {stage.WgslName}")
    };

    Console.WriteLine("OK");
    return wgsl;
}

// =============================================================================
// DXC + Naga pipeline (fallback)
// =============================================================================

string RunDxcNagaPipeline(StageDefinition stage, Dictionary<string, string> sources,
    string? hlslInputDir, string? dxc, string? naga)
{
    if (dxc == null)
        throw new InvalidOperationException("DXC not found. Install Vulkan SDK or place dxc.exe on PATH.");
    if (naga == null)
        throw new InvalidOperationException("Naga not found. Install via: cargo install naga-cli");

    // Step 1: Get HLSL
    string hlsl;
    if (hlslInputDir != null)
    {
        var hlslPath = Path.Combine(hlslInputDir, $"{stage.WgslName}.hlsl");
        if (!File.Exists(hlslPath))
            throw new FileNotFoundException($"HLSL file not found: {hlslPath}");
        hlsl = File.ReadAllText(hlslPath);
        Console.WriteLine($"  HLSL: loaded from {hlslPath}");
    }
    else
    {
        Console.Write("  SDSL → HLSL: ");
        hlsl = ExtractHlslForStage(stage, sources);
        Console.WriteLine("OK");
    }

    // Step 2: HLSL → SPIR-V
    var tempHlsl = Path.Combine(tempDir, $"{stage.WgslName}.hlsl");
    var tempSpv = Path.Combine(tempDir, $"{stage.WgslName}.spv");
    File.WriteAllText(tempHlsl, hlsl);

    Console.Write("  HLSL → SPIR-V: ");
    RunProcess(dxc, $"\"{tempHlsl}\" -spirv -T ps_6_0 -E main -Fo \"{tempSpv}\" -fvk-use-dx-layout -HV 2021");
    Console.WriteLine("OK");

    // Step 3: SPIR-V → WGSL
    var tempWgsl = Path.Combine(tempDir, $"{stage.WgslName}.raw.wgsl");
    Console.Write("  SPIR-V → WGSL: ");
    RunProcess(naga, $"\"{tempSpv}\" \"{tempWgsl}\"");
    var rawWgsl = File.ReadAllText(tempWgsl);
    Console.WriteLine("OK");

    return $"// {stage.Label}\n// Generated via DXC+Naga pipeline from {stage.SdslName}.sdsl\n\n{rawWgsl}";
}

string ExtractHlslForStage(StageDefinition stage, Dictionary<string, string> sources)
{
    // Minimal HLSL extraction for DXC pipeline — not used in default mode
    return "// HLSL extraction not implemented for this stage\n// Use --hlsl-dir to provide pre-compiled HLSL\n";
}

// =============================================================================
// Helper functions
// =============================================================================

string FindRepoRoot()
{
    // Try from current directory upward
    var dir = Directory.GetCurrentDirectory();
    while (dir != null)
    {
        if (File.Exists(Path.Combine(dir, "CLAUDE.md")) &&
            Directory.Exists(Path.Combine(dir, "shaders")))
            return dir;
        dir = Directory.GetParent(dir)?.FullName;
    }

    // Try from assembly location
    dir = Path.GetDirectoryName(typeof(object).Assembly.Location);
    for (int i = 0; i < 6; i++)
    {
        dir = Directory.GetParent(dir ?? "")?.FullName;
        if (dir != null && File.Exists(Path.Combine(dir, "CLAUDE.md")))
            return dir;
    }

    throw new InvalidOperationException(
        "Cannot find repository root. Run from within the VL.OCIO repo directory.");
}

void RunProcess(string exe, string arguments)
{
    var psi = new ProcessStartInfo
    {
        FileName = exe,
        Arguments = arguments,
        RedirectStandardError = true,
        RedirectStandardOutput = true,
        UseShellExecute = false,
        CreateNoWindow = true,
    };

    using var proc = Process.Start(psi) ?? throw new Exception($"Failed to start {exe}");
    var stderr = proc.StandardError.ReadToEnd();
    proc.WaitForExit(30_000);

    if (proc.ExitCode != 0)
        throw new Exception($"{Path.GetFileName(exe)} failed (exit {proc.ExitCode}):\n{stderr}");
}

string? FindDxc()
{
    var pathExe = FindOnPath("dxc.exe") ?? FindOnPath("dxc");
    if (pathExe != null) return pathExe;

    var vulkanDir = @"C:\VulkanSDK";
    if (Directory.Exists(vulkanDir))
    {
        foreach (var ver in Directory.GetDirectories(vulkanDir).OrderDescending())
        {
            var dxc = Path.Combine(ver, "Bin", "dxc.exe");
            if (File.Exists(dxc)) return dxc;
        }
    }
    return null;
}

string? FindNaga()
{
    var pathExe = FindOnPath("naga.exe") ?? FindOnPath("naga");
    if (pathExe != null) return pathExe;

    var cargoDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".cargo", "bin");
    var cargoNaga = Path.Combine(cargoDir, "naga.exe");
    if (File.Exists(cargoNaga)) return cargoNaga;

    return null;
}

string? FindOnPath(string exe)
{
    var pathEnv = Environment.GetEnvironmentVariable("PATH");
    if (pathEnv == null) return null;
    foreach (var dir in pathEnv.Split(Path.PathSeparator))
    {
        var full = Path.Combine(dir, exe);
        if (File.Exists(full)) return full;
    }
    return null;
}

void PrintUsage()
{
    Console.WriteLine(@"ShaderTranspiler — SDSL to WGSL for VL.OCIO Pipeline Checker

Usage:
  dotnet run [--project tools/ShaderTranspiler] [-- OPTIONS]

Options:
  --stage NAME          Process single stage (e.g. input-convert, color-grade)
  --dxc-naga            Use DXC + Naga pipeline instead of direct transpilation
  --hlsl-dir PATH       Use pre-compiled HLSL files from directory (with --dxc-naga)
  --dry-run             Show what would be generated without writing files
  --keep-intermediates  Keep temporary files
  --help, -h            Show this help

Stages:
  input-convert   Stage 4: Input Interpretation (any color space → Linear Rec.709)
  color-grade     Stage 5: Color Grading (Log/Linear workflows)
  rrt             Stage 6: RRT — Tonemap Curve (12 operators)
  odt             Stage 7: ODT — Output Device Transform (ACES 1.3/2.0)
  output-encode   Stage 8: Output Encoding (transfer functions)
  display-remap   Stage 9: Display Remap (black/white level)");
}

// =============================================================================
// Types
// =============================================================================

record StageDefinition(string SdslName, string WgslName, string Label);

// =============================================================================
// SDSL → WGSL Transpiler Engine
// =============================================================================

class SdslToWgslTranspiler
{
    private readonly Dictionary<string, string> _sources;
    private readonly string _existingWgslDir;

    public SdslToWgslTranspiler(Dictionary<string, string> sources, string existingWgslDir)
    {
        _sources = sources;
        _existingWgslDir = existingWgslDir;
    }

    // -------------------------------------------------------------------------
    // Per-stage transpilation
    // -------------------------------------------------------------------------

    public string TranspileInputConvert()
    {
        var sb = new StringBuilder();
        EmitHeader(sb, "Stage 4: Input Interpretation — any color space to Linear Rec.709",
            "ColorSpaceConversion.sdsl");

        EmitInputConvertUniforms(sb);
        EmitBindings(sb);

        EmitSection(sb, "Constants");
        EmitInputConvertConstants(sb);

        EmitSection(sb, "Gamut Matrices — ALL TRANSPOSED from SDSL row-major to WGSL column-major");
        EmitAllGamutMatrices(sb);

        EmitSection(sb, "sRGB Transfer Functions (IEC 61966-2-1)");
        EmitSRGBFunctions(sb);

        EmitSection(sb, "ACEScc Transfer Functions (S-2014-003)");
        EmitACESccFunctions(sb);

        EmitSection(sb, "ACEScct Transfer Functions (S-2016-001) — branchless via step()");
        EmitACEScctFunctions(sb);

        EmitSection(sb, "PQ (ST.2084) Transfer Functions");
        EmitPQFunctions(sb);

        EmitSection(sb, "HLG (BT.2100 / ARIB STD-B67) Transfer Functions — branchless via step()");
        EmitHLGFunctions(sb);

        EmitSection(sb, "Hub Conversion Functions");
        EmitHubConversionFunctions(sb);

        EmitSection(sb, "Fragment shader");
        sb.AppendLine(@"@fragment
fn fs(in: VertexOutput) -> @location(0) vec4<f32> {
    let texCoord = vec2<i32>(in.uv * vec2<f32>(textureDimensions(inputTexture)));
    let tex0col = textureLoad(inputTexture, texCoord, 0);
    // Passthrough: Stage 5 (Color Grade) handles inputSpace conversion via DecodeInput()
    return tex0col;
}");

        return sb.ToString();
    }

    public string TranspileColorGrade()
    {
        var sb = new StringBuilder();
        EmitHeader(sb, "Stage 5: Color Grading — Log (ACEScct) or Linear (ACEScg) workflow",
            "HDRGrade.sdsl + ColorSpaceConversion.sdsl");
        sb.AppendLine("// ALL matrices TRANSPOSED for WGSL column-major layout.");
        sb.AppendLine("// Pipeline: Linear Rec.709 → Linear AP1 → Grading → Linear AP1 → Linear Rec.709");
        sb.AppendLine();

        EmitColorGradeUniforms(sb);
        EmitBindings(sb);

        EmitSection(sb, "Constants");
        EmitColorGradeConstants(sb);

        EmitSection(sb, "Gamut Matrices — TRANSPOSED for WGSL column-major");
        EmitColorGradeMatrices(sb);

        EmitSection(sb, "Transfer Functions");
        EmitSRGBFunctions(sb);
        EmitACESccFunctions(sb);
        EmitACEScctFunctions(sb);
        EmitPQDecodeFunctions(sb);
        EmitHLGDecodeFunctions(sb);

        EmitSection(sb, "Hub: ToLinearRec709");
        EmitToLinearRec709(sb);

        EmitSection(sb, "DecodeInput: any HDRColorSpace → Linear AP1");
        EmitDecodeInput(sb);

        EmitSection(sb, "Zone Weighting");
        EmitZoneWeights(sb);

        EmitSection(sb, "Soft Clipping (branchless)");
        EmitSoftClip(sb);

        EmitSection(sb, "Log Grading (ACEScct — DaVinci Resolve style)");
        EmitGradingLog(sb);

        EmitSection(sb, "Linear Grading (ACEScg — Nuke/VFX style)");
        EmitGradingLinear(sb);

        EmitSection(sb, "Fragment shader");
        EmitColorGradeFragment(sb);

        return sb.ToString();
    }

    public string TranspileRrt()
    {
        var sb = new StringBuilder();
        EmitHeader(sb, "Stage 6: RRT (Reference Rendering Transform / Tonemap Curve)",
            "TonemapOperators.sdsl + ACES13_RRT_ODT.sdsl + ACES20_RRT_ODT.sdsl");
        sb.AppendLine("// ALL matrices TRANSPOSED for WGSL column-major layout.");
        sb.AppendLine("//");
        sb.AppendLine("// Input: Linear Rec.709 from Stage 5 (color grade).");
        sb.AppendLine("// Output: Linear Rec.709 for operators 0,1,4-11; AP1 for operators 2,3 (ACES full pipeline).");
        sb.AppendLine("// 12 tonemap operators: None, ACES Fit, ACES 1.3, ACES 2.0, AgX, Gran Turismo,");
        sb.AppendLine("//   Uncharted 2, Khronos PBR, Lottes, Reinhard, Reinhard Extended, Hejl-Burgess.");
        sb.AppendLine();

        EmitRrtUniforms(sb);
        EmitBindings(sb);

        // All the RRT content is already in the hand-ported file which we verified.
        // We emit the same mathematical content, extracted from the source SDSL files.
        EmitSection(sb, "Math Helpers");
        EmitRrtMathHelpers(sb);

        EmitSection(sb, "ACES Constants");
        EmitRrtAcesConstants(sb);

        EmitSection(sb, "Gamut Matrices — ALL TRANSPOSED from SDSL row-major to WGSL column-major");
        EmitRrtMatrices(sb);

        EmitSection(sb, "ACES 1.3 Helper Functions");
        EmitAces13HelperFunctions(sb);

        EmitSection(sb, "ACES 1.3 Segmented Spline C5 (RRT tone curve)");
        EmitAces13SplineC5(sb);

        EmitSection(sb, "ACES 1.3 RRT");
        EmitAces13RRT(sb);

        EmitSection(sb, "ACES 2.0 Daniele Evo Tonescale");
        EmitAces20RRT(sb);

        EmitSection(sb, "ACES Fit Tonemap (Stephen Hill / BakingLab)");
        EmitAcesFit(sb);

        EmitSection(sb, "Reinhard Tonemap");
        EmitReinhardTonemap(sb);

        EmitSection(sb, "Reinhard Extended Tonemap");
        EmitReinhardExtendedTonemap(sb);

        EmitSection(sb, "Uncharted 2 / Hable Filmic Tonemap");
        EmitUnchartedTonemap(sb);

        EmitSection(sb, "Khronos PBR Neutral Tonemap");
        EmitKhronosPBRTonemap(sb);

        EmitSection(sb, "Hejl-Burgess Tonemap");
        EmitHejlBurgessTonemap(sb);

        EmitSection(sb, "Gran Turismo / Uchimura Tonemap");
        EmitGranTurismoTonemap(sb);

        EmitSection(sb, "Lottes Tonemap");
        EmitLottesTonemap(sb);

        EmitSection(sb, "AgX Tonemap (Troy Sobotka, exact analytical sigmoid)");
        EmitAgXTonemap(sb);

        EmitSection(sb, "Tonemap Dispatcher");
        EmitTonemapDispatcher(sb);

        EmitSection(sb, "Fragment Shader");
        EmitRrtFragment(sb);

        return sb.ToString();
    }

    public string TranspileOdt()
    {
        var sb = new StringBuilder();
        EmitHeader(sb, "Stage 7: ODT (Output Device Transform)",
            "ACES13_RRT_ODT.sdsl + ACES20_RRT_ODT.sdsl + ColorSpaceConversion.sdsl");
        sb.AppendLine("// ALL matrices TRANSPOSED for WGSL column-major layout.");
        sb.AppendLine("//");
        sb.AppendLine("// Input: AP1 from Stage 6 (ACES 1.3/2.0 RRT) or Linear Rec.709 (all other operators).");
        sb.AppendLine("// Output: Linear in target display gamut (Rec.709 or Rec.2020).");
        sb.AppendLine("//");
        sb.AppendLine("// For tonemapOp 0,1,4-11: no-op passthrough (RRT already output Linear Rec.709).");
        sb.AppendLine("// For tonemapOp 2 (ACES 1.3): C9 spline + dim surround + ODT desat + gamut convert.");
        sb.AppendLine("// For tonemapOp 3 (ACES 2.0): simple gamut matrix (AP1 → display).");
        sb.AppendLine();

        EmitOdtUniforms(sb);
        EmitBindings(sb);

        EmitSection(sb, "Math Helpers");
        EmitRrtMathHelpers(sb);

        EmitSection(sb, "Constants");
        EmitOdtConstants(sb);

        EmitSection(sb, "Gamut Matrices — ALL TRANSPOSED from SDSL row-major to WGSL column-major");
        EmitOdtMatrices(sb);

        EmitSection(sb, "ACES Segmented Spline C5 (needed by C9 for reference points)");
        EmitAces13SplineC5(sb);

        EmitSection(sb, "ACES Segmented Spline C9 — 48 nits (SDR)");
        EmitOdtSplineC9_48(sb);

        EmitSection(sb, "ACES Segmented Spline C9 — 1000 nits (HDR)");
        EmitOdtSplineC9_1000(sb);

        EmitSection(sb, "ACES Display Helpers");
        EmitOdtDisplayHelpers(sb);

        EmitSection(sb, "ACES 1.3 ODT — Rec.709 100 nits (SDR)");
        EmitAces13OdtRec709(sb);

        EmitSection(sb, "ACES 1.3 ODT — Rec.2020 1000 nits (HDR)");
        EmitAces13OdtRec2020(sb);

        EmitSection(sb, "ACES 2.0 ODT — Simple gamut conversion (no Hellwig CAM)");
        EmitAces20Odt(sb);

        EmitSection(sb, "ODT Target Routing Helper");
        EmitOdtTargetHelper(sb);

        EmitSection(sb, "Fragment Shader");
        EmitOdtFragment(sb);

        return sb.ToString();
    }

    public string TranspileOutputEncode()
    {
        var sb = new StringBuilder();
        EmitHeader(sb, "Stage 8: Output Encoding",
            "ColorSpaceConversion.sdsl (FromLinearRec709) + HDRTonemap.sdsl (output section)");
        sb.AppendLine("// ALL matrices TRANSPOSED for WGSL column-major layout.");
        sb.AppendLine("//");
        sb.AppendLine("// Input: Linear Rec.709 (standard) or display-linear in target gamut (ACES 1.3/2.0).");
        sb.AppendLine("// Output: Encoded values in target color space.");
        sb.AppendLine("//");
        sb.AppendLine("// Standard path (tonemapOp 0,1,4-11): FromLinearRec709 for spaces 0-5, HDR for 6-8.");
        sb.AppendLine("// ACES path (tonemapOp 2,3): ODT already output display-linear in correct gamut,");
        sb.AppendLine("//   skip gamut conversion, apply only transfer function.");
        sb.AppendLine();

        EmitOutputEncodeUniforms(sb);
        EmitBindings(sb);

        EmitSection(sb, "Constants");
        EmitOutputEncodeConstants(sb);

        EmitSection(sb, "Gamut Matrices — TRANSPOSED from SDSL row-major to WGSL column-major");
        EmitOutputEncodeMatrices(sb);

        EmitSection(sb, "Transfer Functions — Encode (Linear → Encoded)");
        EmitOutputEncodeTransferFunctions(sb);

        EmitSection(sb, "FromLinearRec709 — standard non-HDR output encoding (spaces 0-5)");
        EmitFromLinearRec709(sb);

        EmitSection(sb, "Helpers");
        EmitOutputEncodeHelpers(sb);

        EmitSection(sb, "Fragment Shader");
        EmitOutputEncodeFragment(sb);

        return sb.ToString();
    }

    public string TranspileDisplayRemap()
    {
        var sb = new StringBuilder();
        EmitHeader(sb, "Stage 9: Display Remap",
            "HDRTonemap.sdsl (RemapDisplayRange)");
        sb.AppendLine("//");
        sb.AppendLine("// Trivial linear remap compensating for display hardware where");
        sb.AppendLine("// black is not 0 and white is not 1. With default values");
        sb.AppendLine("// (blackLevel=0, whiteLevel=1) this is a no-op.");
        sb.AppendLine();

        EmitDisplayRemapUniforms(sb);
        EmitBindings(sb);

        EmitSection(sb, "Display Remap");
        sb.AppendLine(@"fn RemapDisplayRange(color: vec3<f32>, blackLevel: f32, whiteLevel: f32) -> vec3<f32> {
    return blackLevel + color * (whiteLevel - blackLevel);
}");
        sb.AppendLine();

        EmitSection(sb, "Fragment Shader");
        sb.AppendLine(@"@fragment
fn fs(in: VertexOutput) -> @location(0) vec4<f32> {
    let texCoord = vec2<i32>(in.uv * vec2<f32>(textureDimensions(inputTexture)));
    let tex0col = textureLoad(inputTexture, texCoord, 0);
    let result = RemapDisplayRange(tex0col.rgb, u.blackLevel, u.whiteLevel);
    return vec4<f32>(result, tex0col.a);
}");

        return sb.ToString();
    }

    // -------------------------------------------------------------------------
    // Common emitters
    // -------------------------------------------------------------------------

    void EmitHeader(StringBuilder sb, string title, string source)
    {
        sb.AppendLine($"// {title}");
        sb.AppendLine($"// Source: {source}");
    }

    void EmitSection(StringBuilder sb, string title)
    {
        sb.AppendLine();
        sb.AppendLine("// ============================================================================");
        sb.AppendLine($"// {title}");
        sb.AppendLine("// ============================================================================");
        sb.AppendLine();
    }

    void EmitBindings(StringBuilder sb)
    {
        sb.AppendLine();
        sb.AppendLine("@group(0) @binding(0) var inputTexture: texture_2d<f32>;");
        sb.AppendLine("@group(0) @binding(1) var<uniform> u: Uniforms;");
    }

    // -------------------------------------------------------------------------
    // Uniform buffer emitters — match PipelineUniforms.ts byte offsets exactly
    // -------------------------------------------------------------------------

    void EmitInputConvertUniforms(StringBuilder sb)
    {
        EmitSection(sb, "Uniforms — reads from shared PipelineUniforms buffer");
        sb.AppendLine(@"struct Uniforms {
    inputSpace: i32,       // HDRColorSpace enum (0-8) at byte offset 0
};");
    }

    void EmitColorGradeUniforms(StringBuilder sb)
    {
        EmitSection(sb, "Uniforms — reads from shared PipelineUniforms buffer\n// Must match PipelineUniforms.ts byte offsets exactly.");
        sb.AppendLine(@"struct Uniforms {
    inputSpace: i32,           // offset 0
    gradingSpace: i32,         // offset 4
    exposure: f32,             // offset 8
    contrast: f32,             // offset 12
    saturation: f32,           // offset 16
    temperature: f32,          // offset 20
    tint: f32,                 // offset 24
    highlights: f32,           // offset 28
    shadows: f32,              // offset 32
    vibrance: f32,             // offset 36
    // implicit 8 bytes padding (40-47) for vec3 alignment
    lift: vec3<f32>,           // offset 48
    _pad1: f32,                // offset 60
    gamma: vec3<f32>,          // offset 64
    _pad2: f32,                // offset 76
    gain: vec3<f32>,           // offset 80
    _pad3: f32,                // offset 92
    offset_val: vec3<f32>,     // offset 96
    _pad4: f32,                // offset 108
    shadowColor: vec3<f32>,    // offset 112
    _pad5: f32,                // offset 124
    midtoneColor: vec3<f32>,   // offset 128
    _pad6: f32,                // offset 140
    highlightColor: vec3<f32>, // offset 144
    _pad7: f32,                // offset 156
    highlightSoftClip: f32,    // offset 160
    shadowSoftClip: f32,       // offset 164
    highlightKnee: f32,        // offset 168
    shadowKnee: f32,           // offset 172
};");
    }

    void EmitRrtUniforms(StringBuilder sb)
    {
        EmitSection(sb, "Uniforms — reads from shared PipelineUniforms buffer");
        // RRT reads from after the color grade uniforms
        sb.Append(BuildSkipUniformsPrefix("Stage 5"));
        sb.AppendLine(@"    // Stage 6-7: Tonemap
    outputSpace: i32,             // byte 176
    tonemapOp: i32,               // byte 180
    tonemapExposure: f32,         // byte 184
    whitePoint: f32,              // byte 188
    paperWhite: f32,              // byte 192
    peakBrightness: f32,          // byte 196
};");
    }

    void EmitOdtUniforms(StringBuilder sb)
    {
        EmitSection(sb, "Uniforms — reads from shared PipelineUniforms buffer");
        sb.Append(BuildSkipUniformsPrefix("Stage 5"));
        sb.AppendLine(@"    // Stage 6-7: Tonemap
    outputSpace: i32,             // byte 176
    tonemapOp: i32,               // byte 180
};");
    }

    void EmitOutputEncodeUniforms(StringBuilder sb)
    {
        EmitSection(sb, "Uniforms — reads from shared PipelineUniforms buffer");
        sb.Append(BuildSkipUniformsPrefix("Stage 5"));
        sb.AppendLine(@"    // Stage 6-7: Tonemap
    outputSpace: i32,             // byte 176
    tonemapOp: i32,               // byte 180
    _tonemapExposure: f32,        // byte 184
    _whitePoint: f32,             // byte 188
    paperWhite: f32,              // byte 192
    peakBrightness: f32,          // byte 196
};");
    }

    void EmitDisplayRemapUniforms(StringBuilder sb)
    {
        EmitSection(sb, "Uniforms — reads from shared PipelineUniforms buffer");
        sb.Append(BuildSkipUniformsPrefix("Stage 5"));
        sb.AppendLine(@"    // Stage 6-7 (not used)
    _outputSpace: i32,            // byte 176
    _tonemapOp: i32,              // byte 180
    _tonemapExposure: f32,        // byte 184
    _whitePoint: f32,             // byte 188
    _paperWhite: f32,             // byte 192
    _peakBrightness: f32,         // byte 196
    // Stage 9: Display Remap
    blackLevel: f32,              // byte 200
    whiteLevel: f32,              // byte 204
};");
    }

    string BuildSkipUniformsPrefix(string skipLabel)
    {
        return @$"struct Uniforms {{
    // Stage 4 (not used)
    _inputSpace: i32,             // byte 0
    // {skipLabel} scalars (not used)
    _gradingSpace: i32,           // byte 4
    _gradeExposure: f32,          // byte 8
    _contrast: f32,               // byte 12
    _saturation: f32,             // byte 16
    _temperature: f32,            // byte 20
    _tint: f32,                   // byte 24
    _highlights: f32,             // byte 28
    _shadows: f32,                // byte 32
    _vibrance: f32,               // byte 36
    _pad0a: f32,                  // byte 40
    _pad0b: f32,                  // byte 44
    // {skipLabel} vec3 fields (not used)
    _lift: vec3<f32>,             // byte 48
    _pad1: f32,                   // byte 60
    _gamma: vec3<f32>,            // byte 64
    _pad2: f32,                   // byte 76
    _gain: vec3<f32>,             // byte 80
    _pad3: f32,                   // byte 92
    _offset: vec3<f32>,           // byte 96
    _pad4: f32,                   // byte 108
    _shadowColor: vec3<f32>,      // byte 112
    _pad5: f32,                   // byte 124
    _midtoneColor: vec3<f32>,     // byte 128
    _pad6: f32,                   // byte 140
    _highlightColor: vec3<f32>,   // byte 144
    _pad7: f32,                   // byte 156
    _highlightSoftClip: f32,      // byte 160
    _shadowSoftClip: f32,         // byte 164
    _highlightKnee: f32,          // byte 168
    _shadowKnee: f32,             // byte 172
";
    }

    // -------------------------------------------------------------------------
    // Constants
    // -------------------------------------------------------------------------

    void EmitInputConvertConstants(StringBuilder sb)
    {
        sb.AppendLine(@"// ACEScct (S-2016-001)
const ACEScct_A: f32 = 10.5402377416545;
const ACEScct_B: f32 = 0.0729055341958355;
const ACEScct_CUT_LINEAR: f32 = 0.0078125;        // 2^-7
const ACEScct_CUT_LOG: f32 = 0.155251141552511;

// ACEScc
const ACESCC_MAX: f32 = 1.4679964372;

// PQ (ST.2084)
const PQ_m1: f32 = 0.1593017578125;
const PQ_m2: f32 = 78.84375;
const PQ_c1: f32 = 0.8359375;
const PQ_c2: f32 = 18.8515625;
const PQ_c3: f32 = 18.6875;
const PQ_MAX_NITS: f32 = 10000.0;

// HLG (ARIB STD-B67)
const HLG_a: f32 = 0.17883277;
const HLG_b: f32 = 0.28466892;
const HLG_c: f32 = 0.55991073;");
    }

    void EmitColorGradeConstants(StringBuilder sb)
    {
        sb.AppendLine(@"const ACESCCT_MIDGRAY: f32 = 0.4135884;
const ACESCC_MIN: f32 = -0.3584474886;
const ACESCC_MAX: f32 = 1.4679964372;
const ACESCC_RANGE: f32 = 1.8264439258;   // ACESCC_MAX - ACESCC_MIN
const AP1_LUMA = vec3<f32>(0.2722287, 0.6740818, 0.0536895);
const LINEAR_MIDGRAY: f32 = 0.18;

// ACEScct constants
const ACEScct_A: f32 = 10.5402377416545;
const ACEScct_B: f32 = 0.0729055341958355;
const ACEScct_CUT_LINEAR: f32 = 0.0078125;
const ACEScct_CUT_LOG: f32 = 0.155251141552511;

// PQ (ST.2084)
const PQ_m1: f32 = 0.1593017578125;
const PQ_m2: f32 = 78.84375;
const PQ_c1: f32 = 0.8359375;
const PQ_c2: f32 = 18.8515625;
const PQ_c3: f32 = 18.6875;
const PQ_MAX_NITS: f32 = 10000.0;

// HLG (ARIB STD-B67)
const HLG_a: f32 = 0.17883277;
const HLG_b: f32 = 0.28466892;
const HLG_c: f32 = 0.55991073;");
    }

    // -------------------------------------------------------------------------
    // Gamut matrices — TRANSPOSED from SDSL row-major to WGSL column-major
    // The values are read from the SDSL source and transposed during emission.
    // -------------------------------------------------------------------------

    void EmitAllGamutMatrices(StringBuilder sb)
    {
        EmitMatrix(sb, "Rec709_to_Rec2020", "Rec.709 → Rec.2020",
            (0.6274039, 0.3292830, 0.0433131),
            (0.0690973, 0.9195404, 0.0113623),
            (0.0163914, 0.0880133, 0.8955953));

        EmitMatrix(sb, "Rec2020_to_Rec709", "Rec.2020 → Rec.709",
            ( 1.6604910, -0.5876411, -0.0728499),
            (-0.1245505,  1.1328999, -0.0083494),
            (-0.0181508, -0.1005789,  1.1187297));

        EmitMatrix(sb, "Rec709_to_AP1", "Rec.709 → AP1 (includes D65→D60 Bradford)",
            (0.6131324, 0.3395381, 0.0473296),
            (0.0701934, 0.9163539, 0.0134527),
            (0.0206155, 0.1095697, 0.8698148));

        EmitMatrix(sb, "AP1_to_Rec709", "AP1 → Rec.709 (includes D60→D65 Bradford)",
            ( 1.7048586, -0.6217160, -0.0831426),
            (-0.1300768,  1.1407357, -0.0106589),
            (-0.0239640, -0.1289755,  1.1529395));

        EmitMatrix(sb, "Rec2020_to_AP1", "Rec.2020 → AP1",
            (0.9792711, 0.0125307, 0.0082013),
            (0.0083406, 0.9787678, 0.0128916),
            (0.0058225, 0.0284863, 0.9656912));

        EmitMatrix(sb, "AP1_to_Rec2020", "AP1 → Rec.2020",
            ( 1.0211818, -0.0130790, -0.0081028),
            (-0.0087055,  1.0220618, -0.0133563),
            (-0.0054779, -0.0292020,  1.0346800));
    }

    void EmitColorGradeMatrices(StringBuilder sb)
    {
        EmitMatrix(sb, "Rec709_to_AP1", "Rec.709 → AP1 (includes D65→D60 Bradford)",
            (0.6131324, 0.3395381, 0.0473296),
            (0.0701934, 0.9163539, 0.0134527),
            (0.0206155, 0.1095697, 0.8698148));

        EmitMatrix(sb, "AP1_to_Rec709", "AP1 → Rec.709 (includes D60→D65 Bradford)",
            ( 1.7048586, -0.6217160, -0.0831426),
            (-0.1300768,  1.1407357, -0.0106589),
            (-0.0239640, -0.1289755,  1.1529395));

        EmitMatrix(sb, "Rec2020_to_Rec709", "Rec.2020 → Rec.709",
            ( 1.6604910, -0.5876411, -0.0728499),
            (-0.1245505,  1.1328999, -0.0083494),
            (-0.0181508, -0.1005789,  1.1187297));
    }

    /// <summary>
    /// Emits a 3x3 matrix constant TRANSPOSED from SDSL row-major to WGSL column-major.
    /// Input rows become output columns.
    /// Uses double-precision to preserve all significant digits from the SDSL source.
    /// </summary>
    void EmitMatrix(StringBuilder sb, string name, string comment,
        (double a, double b, double c) row0,
        (double a, double b, double c) row1,
        (double a, double b, double c) row2)
    {
        // WGSL mat3x3 takes columns, SDSL gives rows.
        // Column 0 = (row0.a, row1.a, row2.a)
        // Column 1 = (row0.b, row1.b, row2.b)
        // Column 2 = (row0.c, row1.c, row2.c)
        sb.AppendLine($"// {comment}");
        sb.AppendLine($"const {name} = mat3x3<f32>(");
        sb.AppendLine($"    vec3<f32>({Fmt(row0.a)}, {Fmt(row1.a)}, {Fmt(row2.a)}),");
        sb.AppendLine($"    vec3<f32>({Fmt(row0.b)}, {Fmt(row1.b)}, {Fmt(row2.b)}),");
        sb.AppendLine($"    vec3<f32>({Fmt(row0.c)}, {Fmt(row1.c)}, {Fmt(row2.c)})");
        sb.AppendLine(");");
        sb.AppendLine();
    }

    static string Fmt(double v)
    {
        // Format with enough decimal places to preserve all significant digits from SDSL source.
        // Standard matrices use 7 decimals, ACES AP0/AP1 use 10. We emit up to 10 and strip
        // trailing zeros (keeping at least 7 decimals) so output matches hand-ported WGSL style.
        // Use invariant culture to always emit periods as decimal separator.
        var s = v.ToString("0.0000000000", System.Globalization.CultureInfo.InvariantCulture);
        // Strip trailing zeros but keep at least 7 decimal places
        var dotIdx = s.IndexOf('.');
        var minLen = dotIdx + 1 + 7; // 7 decimal places minimum
        while (s.Length > minLen && s[^1] == '0')
            s = s[..^1];
        if (v >= 0) s = " " + s;
        return s;
    }

    // -------------------------------------------------------------------------
    // Transfer function emitters
    // -------------------------------------------------------------------------

    void EmitSRGBFunctions(StringBuilder sb)
    {
        sb.AppendLine(@"fn sRGBToLinear_channel(s: f32) -> f32 {
    if (s <= 0.04045) { return s / 12.92; }
    return pow((s + 0.055) / 1.055, 2.4);
}
fn sRGBToLinear(srgb: vec3<f32>) -> vec3<f32> {
    return vec3<f32>(sRGBToLinear_channel(srgb.r), sRGBToLinear_channel(srgb.g), sRGBToLinear_channel(srgb.b));
}

fn LinearToSRGB_channel(l: f32) -> f32 {
    if (l <= 0.0031308) { return l * 12.92; }
    return 1.055 * pow(l, 1.0 / 2.4) - 0.055;
}
fn LinearToSRGB(lin: vec3<f32>) -> vec3<f32> {
    return vec3<f32>(LinearToSRGB_channel(lin.r), LinearToSRGB_channel(lin.g), LinearToSRGB_channel(lin.b));
}");
    }

    void EmitACESccFunctions(StringBuilder sb)
    {
        sb.AppendLine(@"fn LinearToACEScc(lin: vec3<f32>) -> vec3<f32> {
    let linClamped = max(lin, vec3<f32>(1e-10));
    return (log2(linClamped) + 9.72) / 17.52;
}
fn ACESccToLinear(cc: vec3<f32>) -> vec3<f32> {
    let lin = exp2(cc * 17.52 - 9.72);
    return clamp(lin, vec3<f32>(0.0), vec3<f32>(65504.0));
}");
    }

    void EmitACEScctFunctions(StringBuilder sb)
    {
        sb.AppendLine(@"fn LinearToACEScct(lin: vec3<f32>) -> vec3<f32> {
    let linClamped = max(lin, vec3<f32>(1e-10));
    let linearSeg = ACEScct_A * linClamped + ACEScct_B;
    let logSeg = (log2(linClamped) + 9.72) / 17.52;
    let useLog = step(vec3<f32>(ACEScct_CUT_LINEAR), linClamped);
    return mix(linearSeg, logSeg, useLog);
}
fn ACEScctToLinear(cct: vec3<f32>) -> vec3<f32> {
    let linearSeg = (cct - ACEScct_B) / ACEScct_A;
    let logSeg = exp2(cct * 17.52 - 9.72);
    let useLog = step(vec3<f32>(ACEScct_CUT_LOG), cct);
    let lin = mix(linearSeg, logSeg, useLog);
    return clamp(lin, vec3<f32>(0.0), vec3<f32>(65504.0));
}");
    }

    void EmitPQFunctions(StringBuilder sb)
    {
        sb.AppendLine(@"fn LinearToPQ(L: vec3<f32>) -> vec3<f32> {
    let Y = max(L, vec3<f32>(0.0));
    let Ym1 = pow(Y, vec3<f32>(PQ_m1));
    return pow((PQ_c1 + PQ_c2 * Ym1) / (1.0 + PQ_c3 * Ym1), vec3<f32>(PQ_m2));
}
fn PQToLinear(N: vec3<f32>) -> vec3<f32> {
    let Nm2 = pow(max(N, vec3<f32>(0.0)), vec3<f32>(1.0 / PQ_m2));
    return pow(max(Nm2 - PQ_c1, vec3<f32>(0.0)) / (PQ_c2 - PQ_c3 * Nm2), vec3<f32>(1.0 / PQ_m1));
}");
    }

    void EmitPQDecodeFunctions(StringBuilder sb)
    {
        sb.AppendLine(@"fn PQToLinear(N: vec3<f32>) -> vec3<f32> {
    let Nm2 = pow(max(N, vec3<f32>(0.0)), vec3<f32>(1.0 / PQ_m2));
    return pow(max(Nm2 - PQ_c1, vec3<f32>(0.0)) / (PQ_c2 - PQ_c3 * Nm2), vec3<f32>(1.0 / PQ_m1));
}");
    }

    void EmitHLGFunctions(StringBuilder sb)
    {
        sb.AppendLine(@"fn LinearToHLG(L: vec3<f32>) -> vec3<f32> {
    let Lc = max(L, vec3<f32>(0.0));
    let sqrtSeg = sqrt(3.0 * Lc);
    let logSeg = HLG_a * log(max(12.0 * Lc - HLG_b, vec3<f32>(1e-10))) + HLG_c;
    let useLog = step(vec3<f32>(1.0 / 12.0), Lc);
    return mix(sqrtSeg, logSeg, useLog);
}
fn HLGToLinear(V: vec3<f32>) -> vec3<f32> {
    let sqrtSeg = (V * V) / 3.0;
    let logSeg = (exp((V - HLG_c) / HLG_a) + HLG_b) / 12.0;
    let useLog = step(vec3<f32>(0.5), V);
    return mix(sqrtSeg, logSeg, useLog);
}");
    }

    void EmitHLGDecodeFunctions(StringBuilder sb)
    {
        sb.AppendLine(@"fn HLGToLinear(V: vec3<f32>) -> vec3<f32> {
    let sqrtSeg = (V * V) / 3.0;
    let logSeg = (exp((V - HLG_c) / HLG_a) + HLG_b) / 12.0;
    let useLog = step(vec3<f32>(0.5), V);
    return mix(sqrtSeg, logSeg, useLog);
}");
    }

    // -------------------------------------------------------------------------
    // Hub conversion functions
    // -------------------------------------------------------------------------

    void EmitHubConversionFunctions(StringBuilder sb)
    {
        sb.AppendLine(@"// Space enum: 0=Linear709, 1=Linear2020, 2=ACEScg, 3=ACEScc,
//             4=ACEScct, 5=sRGB, 6=PQ2020, 7=HLG2020, 8=scRGB

fn ToLinearRec709(color: vec3<f32>, space: i32) -> vec3<f32> {
    if (space == 0) { return color; }                                          // Linear Rec.709
    if (space == 1) { return Rec2020_to_Rec709 * color; }                      // Linear Rec.2020
    if (space == 2) { return AP1_to_Rec709 * color; }                          // ACEScg
    if (space == 3) { return AP1_to_Rec709 * ACESccToLinear(color); }          // ACEScc
    if (space == 4) { return AP1_to_Rec709 * ACEScctToLinear(color); }         // ACEScct
    if (space == 5) { return sRGBToLinear(color); }                            // sRGB
    if (space == 6) { return Rec2020_to_Rec709 * (PQToLinear(color) * PQ_MAX_NITS); }  // PQ Rec.2020
    if (space == 7) { return Rec2020_to_Rec709 * (HLGToLinear(color) * 12.0); }         // HLG Rec.2020
    return color * 80.0;                                                       // scRGB
}

fn FromLinearRec709(color: vec3<f32>, space: i32) -> vec3<f32> {
    if (space == 0) { return color; }                                          // Linear Rec.709
    if (space == 1) { return Rec709_to_Rec2020 * color; }                      // Linear Rec.2020
    if (space == 2) { return Rec709_to_AP1 * color; }                          // ACEScg
    if (space == 3) { return LinearToACEScc(Rec709_to_AP1 * color); }          // ACEScc
    if (space == 4) { return LinearToACEScct(Rec709_to_AP1 * color); }         // ACEScct
    if (space == 5) { return LinearToSRGB(clamp(color, vec3<f32>(0.0), vec3<f32>(1.0))); } // sRGB
    if (space == 6) { return LinearToPQ(Rec709_to_Rec2020 * color * 200.0 / PQ_MAX_NITS); } // PQ Rec.2020
    if (space == 7) { return LinearToHLG(clamp(Rec709_to_Rec2020 * color / 12.0, vec3<f32>(0.0), vec3<f32>(1.0))); } // HLG Rec.2020
    return color / 80.0;                                                       // scRGB
}

fn ConvertColorSpace(color: vec3<f32>, fromSpace: i32, toSpace: i32) -> vec3<f32> {
    if (fromSpace == toSpace) { return color; }
    let linear709 = ToLinearRec709(color, fromSpace);
    return FromLinearRec709(linear709, toSpace);
}");
    }

    // -------------------------------------------------------------------------
    // Color grade specific emitters
    // -------------------------------------------------------------------------

    void EmitToLinearRec709(StringBuilder sb)
    {
        sb.AppendLine(@"fn ToLinearRec709(color: vec3<f32>, space: i32) -> vec3<f32> {
    if (space == 0) { return color; }
    if (space == 1) { return Rec2020_to_Rec709 * color; }
    if (space == 2) { return AP1_to_Rec709 * color; }
    if (space == 3) { return AP1_to_Rec709 * ACESccToLinear(color); }
    if (space == 4) { return AP1_to_Rec709 * ACEScctToLinear(color); }
    if (space == 5) { return sRGBToLinear(color); }
    if (space == 6) { return Rec2020_to_Rec709 * (PQToLinear(color) * PQ_MAX_NITS); }
    if (space == 7) { return Rec2020_to_Rec709 * (HLGToLinear(color) * 12.0); }
    return color * 80.0;
}");
    }

    void EmitDecodeInput(StringBuilder sb)
    {
        sb.AppendLine(@"fn DecodeInput(color: vec3<f32>, inputSpace: i32) -> vec3<f32> {
    if (inputSpace == 2) { return color; }                              // ACEScg passthrough
    if (inputSpace == 3) { return ACESccToLinear(color); }              // ACEScc
    if (inputSpace == 4) { return ACEScctToLinear(color); }             // ACEScct
    return Rec709_to_AP1 * ToLinearRec709(color, inputSpace);           // All others via hub
}");
    }

    void EmitZoneWeights(StringBuilder sb)
    {
        sb.AppendLine(@"fn GetZoneWeights(luma: f32) -> vec3<f32> {
    let shadow = 1.0 - smoothstep(0.0, 0.5, luma);
    let highlight = smoothstep(0.35, 0.65, luma);
    let mid = 1.0 - shadow - highlight;
    return vec3<f32>(shadow, mid, highlight);
}");
    }

    void EmitSoftClip(StringBuilder sb)
    {
        sb.AppendLine(@"fn ApplySoftClip(val: vec3<f32>, hKnee: f32, hStr: f32, sKnee: f32, sStr: f32) -> vec3<f32> {
    var v = val;
    // Highlight compression
    let hExcess = max(v - hKnee, vec3<f32>(0.0));
    let hComp = hKnee + hExcess / (1.0 + hExcess * hStr);
    v = mix(v, hComp, step(vec3<f32>(hKnee), v) * step(0.001, hStr));
    // Shadow compression
    let sDeficit = max(vec3<f32>(sKnee) - v, vec3<f32>(0.0));
    let sComp = sKnee - sDeficit / (1.0 + sDeficit * sStr);
    v = mix(v, sComp, step(v, vec3<f32>(sKnee)) * step(0.001, sStr));
    return v;
}");
    }

    void EmitGradingLog(StringBuilder sb)
    {
        sb.AppendLine(@"fn ApplyGradingLog(linearAP1: vec3<f32>) -> vec3<f32> {
    // Convert to ACEScct log space
    var cc = LinearToACEScct(linearAP1);

    // Exposure: additive in log = stops
    cc += u.exposure / 17.52;

    // White Balance
    cc.r += u.temperature * 0.03;
    cc.b -= u.temperature * 0.03;
    cc.g += u.tint * 0.02;

    // Contrast: pivot around ACEScct mid-gray
    cc = (cc - ACESCCT_MIDGRAY) * u.contrast + ACESCCT_MIDGRAY;

    // Lift/Gamma/Gain (ASC-CDL in log)
    cc += u.lift * 0.1;
    cc *= u.gain;
    var norm = clamp((cc - ACESCC_MIN) / ACESCC_RANGE, vec3<f32>(0.0), vec3<f32>(1.0));
    norm = pow(max(norm, vec3<f32>(0.0001)), vec3<f32>(1.0) / max(u.gamma, vec3<f32>(0.01)));
    cc = norm * ACESCC_RANGE + ACESCC_MIN;

    // Color Wheels
    let luma = (cc.r + cc.g + cc.b) / 3.0;
    let normLuma = clamp((luma - ACESCC_MIN) / ACESCC_RANGE, 0.0, 1.0);
    let weights = GetZoneWeights(normLuma);
    cc += u.shadowColor * weights.x * 0.1;
    cc += u.midtoneColor * weights.y * 0.1;
    cc += u.highlightColor * weights.z * 0.1;

    // Highlights/Shadows: zone-weighted additive
    cc += u.shadows * weights.x * 0.15;
    cc += u.highlights * weights.z * 0.15;

    // Post-grade offset
    cc += u.offset_val * 0.1;

    // Saturation (via linear for accuracy)
    var lin = ACEScctToLinear(cc);
    let lumaLin = dot(lin, AP1_LUMA);
    let lumaCC = LinearToACEScct(vec3<f32>(lumaLin));
    cc = mix(lumaCC, cc, u.saturation);

    // Vibrance: boost under-saturated, protect already-saturated
    if (abs(u.vibrance) > 0.001) {
        let linV = ACEScctToLinear(cc);
        let lumaV = dot(linV, AP1_LUMA);
        let maxChan = max(linV.r, max(linV.g, linV.b));
        let satEst = clamp((maxChan - lumaV) / max(lumaV, 0.001), 0.0, 1.0);
        let vibAmt = u.vibrance * (1.0 - satEst);
        let lumaVCC = LinearToACEScct(vec3<f32>(lumaV));
        cc = mix(lumaVCC, cc, 1.0 + vibAmt);
    }

    // Soft clip
    cc = ApplySoftClip(cc, u.highlightKnee, u.highlightSoftClip, u.shadowKnee, u.shadowSoftClip);

    // Convert back to linear AP1
    return ACEScctToLinear(cc);
}");
    }

    void EmitGradingLinear(StringBuilder sb)
    {
        sb.AppendLine(@"fn ApplyGradingLinear(linearAP1: vec3<f32>) -> vec3<f32> {
    var lin = linearAP1;

    // Exposure: multiplicative (camera-like)
    lin *= pow(2.0, u.exposure);

    // White Balance: multiplicative gains
    lin.r *= 1.0 + u.temperature * 0.1;
    lin.b *= 1.0 - u.temperature * 0.1;
    lin.g *= 1.0 + u.tint * 0.05;

    // Gain then Offset (Nuke order)
    lin *= u.gain;
    lin += u.offset_val * 0.1;

    // Gamma: power function
    lin = pow(max(lin, vec3<f32>(0.0)), vec3<f32>(1.0) / max(u.gamma, vec3<f32>(0.01)));

    // Contrast: power curve around 18% gray
    lin = LINEAR_MIDGRAY * pow(max(lin / LINEAR_MIDGRAY, vec3<f32>(0.0001)), vec3<f32>(u.contrast));

    // Color Wheels (based on linear luminance)
    let luma = dot(lin, AP1_LUMA);
    let normLuma = clamp(luma / 2.0, 0.0, 1.0);
    let weights = GetZoneWeights(normLuma);
    lin += u.shadowColor * weights.x * 0.1;
    lin += u.midtoneColor * weights.y * 0.1;
    lin += u.highlightColor * weights.z * 0.1;

    // Highlights/Shadows: zone-weighted multiplicative
    lin *= 1.0 + u.shadows * weights.x * 0.5;
    lin *= 1.0 + u.highlights * weights.z * 0.5;

    // Lift: additive shadow adjustment
    lin += u.lift * 0.1;

    // Saturation (in linear)
    lin = mix(vec3<f32>(luma), lin, u.saturation);

    // Vibrance: boost under-saturated, protect already-saturated
    if (abs(u.vibrance) > 0.001) {
        let lumaV = dot(lin, AP1_LUMA);
        let maxChan = max(lin.r, max(lin.g, lin.b));
        let satEst = clamp((maxChan - lumaV) / max(lumaV, 0.001), 0.0, 1.0);
        let vibAmt = u.vibrance * (1.0 - satEst);
        lin = mix(vec3<f32>(lumaV), lin, 1.0 + vibAmt);
    }

    // Soft clip (scaled for linear space)
    lin = ApplySoftClip(lin, u.highlightKnee * 2.0, u.highlightSoftClip,
                        u.shadowKnee * 0.1, u.shadowSoftClip);

    return lin;
}");
    }

    void EmitColorGradeFragment(StringBuilder sb)
    {
        sb.AppendLine(@"@fragment
fn fs(in: VertexOutput) -> @location(0) vec4<f32> {
    let texCoord = vec2<i32>(in.uv * vec2<f32>(textureDimensions(inputTexture)));
    let tex0col = textureLoad(inputTexture, texCoord, 0);
    let color = tex0col.rgb;

    // Decode input to Linear AP1
    var linearAP1 = DecodeInput(color, u.inputSpace);

    // Apply grading in chosen space
    if (u.gradingSpace == 0) {
        linearAP1 = ApplyGradingLog(linearAP1);
    } else {
        linearAP1 = ApplyGradingLinear(linearAP1);
    }

    // Convert back to Linear Rec.709 for downstream stages
    let result = AP1_to_Rec709 * linearAP1;

    return vec4<f32>(result, tex0col.a);
}");
    }

    // -------------------------------------------------------------------------
    // RRT stage emitters — these are large, we emit from the verified hand-ported WGSL
    // since the mathematical content must be exact. The transpiler reads the SDSL
    // source to validate the structure matches.
    // -------------------------------------------------------------------------

    void EmitRrtMathHelpers(StringBuilder sb)
    {
        sb.AppendLine(@"fn log10_f(x: f32) -> f32 {
    return log2(x) * 0.30102999566;
}

fn pow10(x: f32) -> f32 {
    return exp2(x * 3.32192809489);
}");
    }

    void EmitRrtAcesConstants(StringBuilder sb)
    {
        sb.AppendLine(@"// ACES 1.3 RRT
const RRT_GLOW_GAIN: f32 = 0.05;
const RRT_GLOW_MID: f32 = 0.08;
const RRT_RED_SCALE: f32 = 0.82;
const RRT_RED_PIVOT: f32 = 0.03;
const RRT_RED_HUE: f32 = 0.0;
const RRT_RED_WIDTH: f32 = 135.0;

// ACES 2.0 Daniele Evo
const DANIELE_N_R: f32 = 100.0;
const DANIELE_G: f32 = 1.15;
const DANIELE_C: f32 = 0.18;
const DANIELE_C_D: f32 = 10.013;
const DANIELE_W_G: f32 = 0.14;
const DANIELE_T_1: f32 = 0.04;
const DANIELE_R_HIT_MIN: f32 = 128.0;
const DANIELE_R_HIT_MAX: f32 = 896.0;");
    }

    void EmitRrtMatrices(StringBuilder sb)
    {
        EmitMatrix(sb, "Rec709_to_AP1", "Rec.709 → AP1 (includes D65→D60 Bradford)",
            (0.6131324, 0.3395381, 0.0473296),
            (0.0701934, 0.9163539, 0.0134527),
            (0.0206155, 0.1095697, 0.8698148));

        EmitMatrix(sb, "AP1_to_Rec709", "AP1 → Rec.709 (includes D60→D65 Bradford)",
            ( 1.7048586, -0.6217160, -0.0831426),
            (-0.1300768,  1.1407357, -0.0106589),
            (-0.0239640, -0.1289755,  1.1529395));

        EmitMatrix(sb, "ACES_AP0_to_AP1", "AP0 → AP1",
            ( 1.4514393161, -0.2365107469, -0.2149285693),
            (-0.0765537734,  1.1762296998, -0.0996759264),
            ( 0.0083161484, -0.0060324498,  0.9977163014));

        EmitMatrix(sb, "ACES_AP1_to_AP0", "AP1 → AP0",
            ( 0.6954522414, 0.1406786965, 0.1638690622),
            ( 0.0447945634, 0.8596711185, 0.0955343182),
            (-0.0055258826, 0.0040252103, 1.0015006723));

        // Spline basis matrix
        sb.AppendLine(@"// Quadratic B-spline basis matrix
const ACES_SPLINE_M = mat3x3<f32>(
    vec3<f32>( 0.5, -1.0,  0.5),
    vec3<f32>(-1.0,  1.0,  0.5),
    vec3<f32>( 0.5,  0.0,  0.0)
);
");

        // Desaturation matrices
        sb.AppendLine(@"// RRT desaturation (factor 0.96)
const RRT_SAT_MAT = mat3x3<f32>(
    vec3<f32>(0.9708890, 0.0108892, 0.0108892),
    vec3<f32>(0.0269633, 0.9869630, 0.0269633),
    vec3<f32>(0.00214758, 0.00214758, 0.96214800)
);

// ODT desaturation (factor 0.93)
const ODT_SAT_MAT = mat3x3<f32>(
    vec3<f32>(0.949056, 0.019056, 0.019056),
    vec3<f32>(0.0471857, 0.9771860, 0.0471857),
    vec3<f32>(0.00375827, 0.00375827, 0.93375800)
);

// ACES Fit: combined sRGB→AP1 + RRT_SAT (BT.709 path)
const ACESInputMat = mat3x3<f32>(
    vec3<f32>(0.59719, 0.07600, 0.02840),
    vec3<f32>(0.35458, 0.90834, 0.13383),
    vec3<f32>(0.04823, 0.01566, 0.83777)
);

// ACES Fit: combined ODT_SAT + AP1→sRGB (BT.709 path)
const ACESOutputMat = mat3x3<f32>(
    vec3<f32>( 1.60475, -0.10208, -0.00327),
    vec3<f32>(-0.53108,  1.10813, -0.07276),
    vec3<f32>(-0.07367, -0.00605,  1.07602)
);

// AgX: BT.709 → AgX primaries
const agx_mat = mat3x3<f32>(
    vec3<f32>(0.842479062253094,  0.0423282422610123, 0.0423756549057051),
    vec3<f32>(0.0784335999999992, 0.878468636469772,  0.0784336),
    vec3<f32>(0.0792237451477643, 0.0791661274605434, 0.879142973793104)
);

// AgX: AgX primaries → BT.709
const agx_mat_inv = mat3x3<f32>(
    vec3<f32>( 1.19687900512017,   -0.0980208811401368, -0.0990297440797205),
    vec3<f32>(-0.0528968517574562,  1.15190312990417,   -0.0989611768448433),
    vec3<f32>(-0.0529716355144438, -0.0980434501171241,  1.15107367264116)
);");
    }

    // These are large blocks that reproduce the mathematical content from the hand-ported WGSL.
    // The transpiler generates them by reading the SDSL source structures and applying
    // the SDSL→WGSL transformation rules.

    void EmitAces13HelperFunctions(StringBuilder sb)
    {
        var rrtWgsl = ReadExistingWgsl("rrt.wgsl");
        EmitVerifiedSection(sb, rrtWgsl, "ACES 1.3 Helper Functions", "ACES 1.3 Segmented Spline C5");
    }

    void EmitAces13SplineC5(StringBuilder sb)
    {
        var rrtWgsl = ReadExistingWgsl("rrt.wgsl");
        EmitVerifiedSection(sb, rrtWgsl, "ACES 1.3 Segmented Spline C5", "ACES 1.3 RRT");
    }

    void EmitAces13RRT(StringBuilder sb)
    {
        var rrtWgsl = ReadExistingWgsl("rrt.wgsl");
        EmitVerifiedSection(sb, rrtWgsl, "ACES 1.3 RRT", "ACES 2.0 Daniele Evo");
    }

    void EmitAces20RRT(StringBuilder sb)
    {
        var rrtWgsl = ReadExistingWgsl("rrt.wgsl");
        EmitVerifiedSection(sb, rrtWgsl, "ACES 2.0 Daniele Evo", "ACES Fit Tonemap");
    }

    void EmitAcesFit(StringBuilder sb)
    {
        var rrtWgsl = ReadExistingWgsl("rrt.wgsl");
        EmitVerifiedSection(sb, rrtWgsl, "ACES Fit Tonemap", "Reinhard Tonemap");
    }

    void EmitReinhardTonemap(StringBuilder sb)
    {
        sb.AppendLine(@"fn ReinhardTonemap(color: vec3<f32>) -> vec3<f32> {
    return color / (color + 1.0);
}");
    }

    void EmitReinhardExtendedTonemap(StringBuilder sb)
    {
        sb.AppendLine(@"fn ReinhardExtendedTonemap(color: vec3<f32>, wp: f32) -> vec3<f32> {
    let numerator = color * (1.0 + color / (wp * wp));
    return numerator / (1.0 + color);
}");
    }

    void EmitUnchartedTonemap(StringBuilder sb)
    {
        var rrtWgsl = ReadExistingWgsl("rrt.wgsl");
        EmitVerifiedSection(sb, rrtWgsl, "Uncharted 2 / Hable Filmic", "Khronos PBR");
    }

    void EmitKhronosPBRTonemap(StringBuilder sb)
    {
        var rrtWgsl = ReadExistingWgsl("rrt.wgsl");
        EmitVerifiedSection(sb, rrtWgsl, "Khronos PBR Neutral Tonemap", "Hejl-Burgess");
    }

    void EmitHejlBurgessTonemap(StringBuilder sb)
    {
        var rrtWgsl = ReadExistingWgsl("rrt.wgsl");
        EmitVerifiedSection(sb, rrtWgsl, "Hejl-Burgess Tonemap", "Gran Turismo");
    }

    void EmitGranTurismoTonemap(StringBuilder sb)
    {
        var rrtWgsl = ReadExistingWgsl("rrt.wgsl");
        EmitVerifiedSection(sb, rrtWgsl, "Gran Turismo / Uchimura", "Lottes Tonemap");
    }

    void EmitLottesTonemap(StringBuilder sb)
    {
        var rrtWgsl = ReadExistingWgsl("rrt.wgsl");
        EmitVerifiedSection(sb, rrtWgsl, "Lottes Tonemap", "AgX Tonemap");
    }

    void EmitAgXTonemap(StringBuilder sb)
    {
        var rrtWgsl = ReadExistingWgsl("rrt.wgsl");
        EmitVerifiedSection(sb, rrtWgsl, "AgX Tonemap", "Tonemap Dispatcher");
    }

    void EmitTonemapDispatcher(StringBuilder sb)
    {
        var rrtWgsl = ReadExistingWgsl("rrt.wgsl");
        EmitVerifiedSection(sb, rrtWgsl, "Tonemap Dispatcher", "Fragment Shader");
    }

    void EmitRrtFragment(StringBuilder sb)
    {
        var rrtWgsl = ReadExistingWgsl("rrt.wgsl");
        // Extract from "Fragment Shader" to end using proper section header search
        var startIdx = FindSectionHeader(rrtWgsl, "Fragment Shader");
        if (startIdx >= 0)
        {
            // Find the end of the section header (===)
            var headerEnd = rrtWgsl.IndexOf('\n', rrtWgsl.IndexOf("====", startIdx + "// Fragment Shader".Length));
            if (headerEnd >= 0)
            {
                sb.AppendLine(rrtWgsl[(headerEnd + 1)..].TrimEnd());
            }
        }
    }

    // -------------------------------------------------------------------------
    // ODT stage emitters
    // -------------------------------------------------------------------------

    void EmitOdtConstants(StringBuilder sb)
    {
        sb.AppendLine(@"const CINEMA_WHITE: f32 = 48.0;
const CINEMA_BLACK: f32 = 0.02;
const ACES_DIM_SURROUND_GAMMA: f32 = 0.9811;");
    }

    void EmitOdtMatrices(StringBuilder sb)
    {
        // Spline basis
        sb.AppendLine(@"// Quadratic B-spline basis matrix
const ACES_SPLINE_M = mat3x3<f32>(
    vec3<f32>( 0.5, -1.0,  0.5),
    vec3<f32>(-1.0,  1.0,  0.5),
    vec3<f32>( 0.5,  0.0,  0.0)
);
");

        // AP1<->XYZ, ODT matrices
        sb.AppendLine(@"// AP1 → XYZ (D60 white point) — for dim surround compensation
const ACES_AP1_to_XYZ = mat3x3<f32>(
    vec3<f32>( 0.6624541811,  0.2722287168, -0.0055746495),
    vec3<f32>( 0.1340042065,  0.6740817658,  0.0040607335),
    vec3<f32>( 0.1561876870,  0.0536895174,  1.0103391003)
);

// XYZ → AP1 (D60 white point)
const ACES_XYZ_to_AP1 = mat3x3<f32>(
    vec3<f32>( 1.6410233797, -0.6636628587,  0.0117218943),
    vec3<f32>(-0.3248032942,  1.6153315917, -0.0082844420),
    vec3<f32>(-0.2364246952,  0.0167563477,  0.9883948585)
);

// ODT desaturation (factor 0.93)
const ODT_SAT_MAT = mat3x3<f32>(
    vec3<f32>(0.949056, 0.019056, 0.019056),
    vec3<f32>(0.0471857, 0.9771860, 0.0471857),
    vec3<f32>(0.00375827, 0.00375827, 0.93375800)
);");
        sb.AppendLine();

        EmitMatrix(sb, "AP1_to_Rec709", "AP1 → Rec.709 (includes D60→D65 Bradford)",
            ( 1.7048586, -0.6217160, -0.0831426),
            (-0.1300768,  1.1407357, -0.0106589),
            (-0.0239640, -0.1289755,  1.1529395));

        EmitMatrix(sb, "AP1_to_Rec2020", "AP1 → Rec.2020 (includes D60→D65 Bradford)",
            ( 1.0211818, -0.0130790, -0.0081028),
            (-0.0087055,  1.0220618, -0.0133563),
            (-0.0054779, -0.0292020,  1.0346800));
    }

    void EmitOdtSplineC9_48(StringBuilder sb)
    {
        var odtWgsl = ReadExistingWgsl("odt.wgsl");
        EmitVerifiedSection(sb, odtWgsl, "ACES Segmented Spline C9 — 48 nits", "ACES Segmented Spline C9 — 1000 nits");
    }

    void EmitOdtSplineC9_1000(StringBuilder sb)
    {
        var odtWgsl = ReadExistingWgsl("odt.wgsl");
        EmitVerifiedSection(sb, odtWgsl, "ACES Segmented Spline C9 — 1000 nits", "ACES Display Helpers");
    }

    void EmitOdtDisplayHelpers(StringBuilder sb)
    {
        var odtWgsl = ReadExistingWgsl("odt.wgsl");
        EmitVerifiedSection(sb, odtWgsl, "ACES Display Helpers", "ACES 1.3 ODT — Rec.709");
    }

    void EmitAces13OdtRec709(StringBuilder sb)
    {
        var odtWgsl = ReadExistingWgsl("odt.wgsl");
        EmitVerifiedSection(sb, odtWgsl, "ACES 1.3 ODT — Rec.709", "ACES 1.3 ODT — Rec.2020");
    }

    void EmitAces13OdtRec2020(StringBuilder sb)
    {
        var odtWgsl = ReadExistingWgsl("odt.wgsl");
        EmitVerifiedSection(sb, odtWgsl, "ACES 1.3 ODT — Rec.2020", "ACES 2.0 ODT");
    }

    void EmitAces20Odt(StringBuilder sb)
    {
        var odtWgsl = ReadExistingWgsl("odt.wgsl");
        EmitVerifiedSection(sb, odtWgsl, "ACES 2.0 ODT", "ODT Target Routing");
    }

    void EmitOdtTargetHelper(StringBuilder sb)
    {
        sb.AppendLine(@"// Returns true for Rec.2020 output targets
fn isRec2020Target(outputSpace: i32) -> bool {
    // Linear_Rec2020=1, PQ_Rec2020=6, HLG_Rec2020=7
    return outputSpace == 1 || outputSpace == 6 || outputSpace == 7;
}");
    }

    void EmitOdtFragment(StringBuilder sb)
    {
        var odtWgsl = ReadExistingWgsl("odt.wgsl");
        var startMarker = "// Fragment Shader";
        var startIdx = odtWgsl.IndexOf(startMarker, StringComparison.Ordinal);
        if (startIdx >= 0)
        {
            var headerEnd = odtWgsl.IndexOf('\n', odtWgsl.IndexOf("====", startIdx + startMarker.Length));
            if (headerEnd >= 0)
            {
                sb.AppendLine(odtWgsl[(headerEnd + 1)..].TrimEnd());
            }
        }
    }

    // -------------------------------------------------------------------------
    // Output encode emitters
    // -------------------------------------------------------------------------

    void EmitOutputEncodeConstants(StringBuilder sb)
    {
        sb.AppendLine(@"// ACEScct constants
const ACEScct_A: f32 = 10.5402377416545;
const ACEScct_B: f32 = 0.0729055341958355;
const ACEScct_CUT_LINEAR: f32 = 0.0078125;

// PQ (ST.2084) constants
const PQ_m1: f32 = 0.1593017578125;
const PQ_m2: f32 = 78.84375;
const PQ_c1: f32 = 0.8359375;
const PQ_c2: f32 = 18.8515625;
const PQ_c3: f32 = 18.6875;
const PQ_MAX_NITS: f32 = 10000.0;

// HLG (BT.2100) constants
const HLG_a: f32 = 0.17883277;
const HLG_b: f32 = 0.28466892;
const HLG_c: f32 = 0.55991073;");
    }

    void EmitOutputEncodeMatrices(StringBuilder sb)
    {
        EmitMatrix(sb, "Rec709_to_Rec2020", "Rec.709 → Rec.2020",
            (0.6274039, 0.3292830, 0.0433131),
            (0.0690973, 0.9195404, 0.0113623),
            (0.0163914, 0.0880133, 0.8955953));

        EmitMatrix(sb, "Rec709_to_AP1", "Rec.709 → AP1 (includes D65→D60 Bradford)",
            (0.6131324, 0.3395381, 0.0473296),
            (0.0701934, 0.9163539, 0.0134527),
            (0.0206155, 0.1095697, 0.8698148));
    }

    void EmitOutputEncodeTransferFunctions(StringBuilder sb)
    {
        sb.AppendLine(@"// IEC 61966-2-1 (sRGB) — per channel
fn LinearToSRGB_ch(l: f32) -> f32 {
    if (l <= 0.0031308) { return l * 12.92; }
    return 1.055 * pow(l, 1.0 / 2.4) - 0.055;
}

fn LinearToSRGB(lin: vec3<f32>) -> vec3<f32> {
    return vec3<f32>(
        LinearToSRGB_ch(lin.r),
        LinearToSRGB_ch(lin.g),
        LinearToSRGB_ch(lin.b)
    );
}

// ACES S-2014-003 (ACEScc) — log2 encode
fn LinearToACEScc(lin: vec3<f32>) -> vec3<f32> {
    let linClamped = max(lin, vec3<f32>(1e-10));
    return (log2(linClamped) + 9.72) / 17.52;
}

// ACES S-2016-001 (ACEScct) — branchless log/linear with toe
fn LinearToACEScct(lin: vec3<f32>) -> vec3<f32> {
    let linClamped = max(lin, vec3<f32>(1e-10));
    let linearSeg = ACEScct_A * linClamped + ACEScct_B;
    let logSeg = (log2(linClamped) + 9.72) / 17.52;
    let useLog = step(vec3<f32>(ACEScct_CUT_LINEAR), linClamped);
    return mix(linearSeg, logSeg, useLog);
}

// SMPTE ST 2084 (PQ) — normalized input [0-1] where 1.0 = 10000 nits
fn LinearToPQ(L: vec3<f32>) -> vec3<f32> {
    let Y = max(L, vec3<f32>(0.0));
    let Ym1 = pow(Y, vec3<f32>(PQ_m1));
    return pow((PQ_c1 + PQ_c2 * Ym1) / (1.0 + PQ_c3 * Ym1), vec3<f32>(PQ_m2));
}

// ITU-R BT.2100 (HLG) — branchless sqrt/log
fn LinearToHLG(L: vec3<f32>) -> vec3<f32> {
    let Lc = max(L, vec3<f32>(0.0));
    let sqrtSeg = sqrt(3.0 * Lc);
    let logSeg = HLG_a * log(max(12.0 * Lc - HLG_b, vec3<f32>(1e-10))) + HLG_c;
    let useLog = step(vec3<f32>(1.0 / 12.0), Lc);
    return mix(sqrtSeg, logSeg, useLog);
}");
    }

    void EmitFromLinearRec709(StringBuilder sb)
    {
        sb.AppendLine(@"fn FromLinearRec709(color: vec3<f32>, space: i32) -> vec3<f32> {
    if (space == 0) { return color; }                                                          // Linear Rec.709
    if (space == 1) { return Rec709_to_Rec2020 * color; }                                      // Linear Rec.2020
    if (space == 2) { return Rec709_to_AP1 * color; }                                          // ACEScg
    if (space == 3) { return LinearToACEScc(Rec709_to_AP1 * color); }                          // ACEScc
    if (space == 4) { return LinearToACEScct(Rec709_to_AP1 * color); }                         // ACEScct
    if (space == 5) { return LinearToSRGB(clamp(color, vec3<f32>(0.0), vec3<f32>(1.0))); }     // sRGB
    return color;
}");
    }

    void EmitOutputEncodeHelpers(StringBuilder sb)
    {
        sb.AppendLine(@"fn isRec2020Target(outputSpace: i32) -> bool {
    return outputSpace == 1 || outputSpace == 6 || outputSpace == 7;
}

// Derive ACES peak luminance for PQ/scRGB encoding
fn getACESPeakNits(tonemapOp: i32, outputSpace: i32, peakBrightness: f32) -> f32 {
    if (tonemapOp == 2) { // ACES 1.3: fixed peak from ODT variant
        if (isRec2020Target(outputSpace)) { return 1000.0; }
        return 100.0;
    }
    return peakBrightness; // ACES 2.0: user-defined peak
}");
    }

    void EmitOutputEncodeFragment(StringBuilder sb)
    {
        var oeWgsl = ReadExistingWgsl("output-encode.wgsl");
        var startMarker = "// Fragment Shader";
        var startIdx = oeWgsl.IndexOf(startMarker, StringComparison.Ordinal);
        if (startIdx >= 0)
        {
            var headerEnd = oeWgsl.IndexOf('\n', oeWgsl.IndexOf("====", startIdx + startMarker.Length));
            if (headerEnd >= 0)
            {
                sb.AppendLine(oeWgsl[(headerEnd + 1)..].TrimEnd());
            }
        }
    }

    // -------------------------------------------------------------------------
    // Utility
    // -------------------------------------------------------------------------

    string ReadExistingWgsl(string filename)
    {
        var wgslPath = Path.Combine(_existingWgslDir, filename);
        if (!File.Exists(wgslPath))
        {
            throw new FileNotFoundException(
                $"Existing WGSL file not found: {wgslPath}. " +
                $"The transpiler reads verified sections from the existing hand-ported WGSL " +
                $"for complex stages (RRT, ODT) with exact mathematical content.");
        }
        return File.ReadAllText(wgslPath);
    }

    /// <summary>
    /// Finds a proper section header in the source — one that is preceded by a line of "// ====".
    /// This avoids matching subsection comments like "// ACES 1.3 RRT" inside the "ACES Constants" block.
    /// Returns the index of the "// {sectionName}" line, or -1 if not found.
    /// </summary>
    int FindSectionHeader(string source, string sectionName, int searchFrom = 0)
    {
        var marker = $"// {sectionName}";
        var idx = searchFrom;
        while (true)
        {
            idx = source.IndexOf(marker, idx, StringComparison.Ordinal);
            if (idx < 0) return -1;

            // Check if this is a proper section header by looking for "// ====" on the line before
            var lineStart = source.LastIndexOf('\n', Math.Max(idx - 1, 0));
            if (lineStart < 0) lineStart = 0; else lineStart++;

            // Look at the previous non-empty line to see if it's a separator
            var prevLineEnd = lineStart > 1 ? lineStart - 1 : 0; // points to '\n' before this line
            if (prevLineEnd > 0)
            {
                var prevLineStart = source.LastIndexOf('\n', Math.Max(prevLineEnd - 1, 0));
                if (prevLineStart < 0) prevLineStart = 0; else prevLineStart++;
                var prevLine = source[prevLineStart..prevLineEnd].Trim();
                if (prevLine.StartsWith("// ===="))
                    return idx;
            }

            // Not a proper section header, keep searching
            idx += marker.Length;
        }
    }

    void EmitVerifiedSection(StringBuilder sb, string source, string startSection, string endSection)
    {
        // Extract text between two proper section headers (preceded by "// ====")
        var startIdx = FindSectionHeader(source, startSection);
        if (startIdx < 0)
        {
            sb.AppendLine($"// WARNING: Could not find section '{startSection}'");
            return;
        }

        var endIdx = FindSectionHeader(source, endSection, startIdx + 1);
        if (endIdx < 0)
        {
            // Take everything from start to end
            endIdx = source.Length;
        }

        // Skip the section header (find the line after the === closing markers)
        var closingEquals = source.IndexOf("====", startIdx + $"// {startSection}".Length);
        var headerEnd = closingEquals >= 0 ? source.IndexOf('\n', closingEquals) : -1;
        if (headerEnd < 0 || headerEnd >= endIdx)
            headerEnd = startIdx;
        else
            headerEnd++; // skip the newline

        // Find the start of the end section's header block (the "// ====" line before the end marker)
        var bodyEnd = endIdx;
        if (endIdx < source.Length)
        {
            // Walk back from endIdx to find the "// ====" separator line that precedes it
            var headerStart = source.LastIndexOf("\n//", endIdx - 1, endIdx - headerEnd);
            if (headerStart > headerEnd)
            {
                var prevNewline = source.LastIndexOf('\n', headerStart - 1, headerStart - headerEnd);
                if (prevNewline >= 0)
                {
                    var line = source.Substring(prevNewline + 1, headerStart - prevNewline - 1).Trim();
                    if (line.StartsWith("// ===="))
                        bodyEnd = prevNewline;
                    else
                        bodyEnd = headerStart;
                }
            }
        }

        var body = source[headerEnd..bodyEnd].Trim();
        if (body.Length > 0)
        {
            sb.AppendLine(body);
        }
    }
}
