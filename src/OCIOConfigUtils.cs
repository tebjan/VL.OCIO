using OCIOSharpCLI;

namespace VL.OCIO;

public enum TargetKind
{
    ColorSpace,
    DisplayView
}

/// <summary>
/// Tag for input color space enum entries.
/// </summary>
public sealed class OCIOInputTag
{
    public string ColorSpace;
}

/// <summary>
/// Tag for output/display color space enum entries.
/// </summary>
public sealed class OCIOTargetTag
{
    public TargetKind Kind;
    public string ColorSpace;
    public string Display;
    public string View;
}

public class GPUResources
{
    public string Shader;
    public UniformInfo[] Uniforms;
    public TextureInfo[] Textures;
    public Texture3DInfo[] Textures3D;

    public static GPUResources Passthrough => new GPUResources
    {
        Shader = @"
float4 OCIODisplay(float4 inPixel)
{
    return inPixel;
}
",
        Uniforms = Array.Empty<UniformInfo>(),
        Textures = Array.Empty<TextureInfo>(),
        Textures3D = Array.Empty<Texture3DInfo>()
    };
}

public static class OCIOConfigUtils
{
    /// <summary>
    /// CG config - lean, VFX/games focused (27 colorspaces).
    /// </summary>
    public const string CGConfig = "ocio://cg-config-v4.0.0_aces-v2.0_ocio-v2.5";

    /// <summary>
    /// Studio config - comprehensive with camera formats (57 colorspaces).
    /// </summary>
    public const string StudioConfig = "ocio://studio-config-v4.0.0_aces-v2.0_ocio-v2.5";

    private static bool _initialized;

    /// <summary>
    /// The currently active config. Updated by RefreshEnumsFrom().
    /// All GPU resource methods use this — never stored in tags (avoids stale references).
    /// </summary>
    public static OCIOConfig ActiveConfig { get; private set; }

    /// <summary>
    /// Ensures a default config is loaded and enums are populated.
    /// Uses direct static init — no AppHost required.
    /// The OCIOConfigService (via ProcessNodes) can switch configs later.
    /// </summary>
    private static void EnsureInitialized()
    {
        if (_initialized) return;

        var config = new OCIOConfig();
        config.LoadBuiltinConfig(CGConfig);
        RefreshEnumsFrom(config);
        _initialized = true;
    }

    /// <summary>
    /// Refresh all dynamic enums from a config. Called by OCIOConfigService on switch.
    /// Builds all entries locally, then swaps each enum dict in one shot (3 triggers total).
    /// </summary>
    public static void RefreshEnumsFrom(OCIOConfig config)
    {
        ActiveConfig = config;

        if (config == null)
        {
            OCIOColorSpaceEnumDefinition.Instance.SetEntries(new Dictionary<string, object>());
            OCIODisplayViewEnumDefinition.Instance.SetEntries(new Dictionary<string, object>());
            OCIOLookEnumDefinition.Instance.SetEntries(new Dictionary<string, object>());
            return;
        }

        // Build color space entries
        var colorSpaceEntries = new Dictionary<string, object>();
        var allSpaces = config.GetColorSpaces();
        var spaceSet = new HashSet<string>(allSpaces);

        foreach (var space in allSpaces)
        {
            colorSpaceEntries[space] = new OCIOInputTag { ColorSpace = space };
        }

        foreach (var role in config.GetRoles())
        {
            var resolved = config.GetRoleColorSpace(role);
            if (!string.IsNullOrWhiteSpace(resolved) && spaceSet.Add(resolved))
            {
                colorSpaceEntries[resolved] = new OCIOInputTag { ColorSpace = resolved };
            }
        }

        // Build display/view entries
        var displayViewEntries = new Dictionary<string, object>();
        foreach (var display in config.GetDisplays())
        {
            foreach (var view in display.Views)
            {
                var label = $"{display.Name}/{view}";
                displayViewEntries[label] = new OCIOTargetTag
                {
                    Kind = TargetKind.DisplayView,
                    Display = display.Name,
                    View = view
                };
            }
        }

        // Build look entries
        var lookEntries = new Dictionary<string, object>();
        lookEntries["None"] = null;
        try
        {
            foreach (var look in config.GetLooks())
                lookEntries[look] = null;
        }
        catch { }

        // Swap all at once — 3 triggers total
        OCIOColorSpaceEnumDefinition.Instance.SetEntries(colorSpaceEntries);
        OCIODisplayViewEnumDefinition.Instance.SetEntries(displayViewEntries);
        OCIOLookEnumDefinition.Instance.SetEntries(lookEntries);
    }

    /// <summary>
    /// Get list of available built-in config names.
    /// </summary>
    public static string[] GetBuiltinConfigNames()
    {
        return OCIOConfig.GetBuiltinConfigNames();
    }

    /// <summary>
    /// Get GPU resources for ColorSpace to ColorSpace transform.
    /// </summary>
    public static GPUResources GetGPUResources(
        OCIOColorSpaceEnum inputColorSpace,
        OCIOColorSpaceEnum outputColorSpace,
        bool inverse)
    {
        EnsureInitialized();

        var config = ActiveConfig;
        var inputTag = inputColorSpace?.Tag as OCIOInputTag;
        var outputTag = outputColorSpace?.Tag as OCIOInputTag;

        if (config == null || inputTag == null || outputTag == null)
            return null;

        config.CreateProcessor(inputTag.ColorSpace, outputTag.ColorSpace, inverse);

        return new GPUResources
        {
            Shader = config.GetHLSLShader(),
            Uniforms = config.GetUniforms(),
            Textures = config.GetTextures(),
            Textures3D = config.Get3DTextures()
        };
    }

    /// <summary>
    /// Get GPU resources for ColorSpace to Display/View transform.
    /// </summary>
    public static GPUResources GetGPUResources(
        OCIOColorSpaceEnum inputColorSpace,
        OCIODisplayViewEnum displayView,
        bool inverse)
    {
        EnsureInitialized();

        var config = ActiveConfig;
        var inputTag = inputColorSpace?.Tag as OCIOInputTag;
        var outputTag = displayView?.Tag as OCIOTargetTag;

        if (config == null || inputTag == null || outputTag == null)
            return null;

        config.CreateProcessor(inputTag.ColorSpace, outputTag.Display, outputTag.View, inverse);

        return new GPUResources
        {
            Shader = config.GetHLSLShader(),
            Uniforms = config.GetUniforms(),
            Textures = config.GetTextures(),
            Textures3D = config.Get3DTextures()
        };
    }

    /// <summary>
    /// DisplayViewTransform with optional Look: input → look → view → display (single shader).
    /// </summary>
    public static GPUResources GetDisplayViewTransformResources(
        OCIOColorSpaceEnum src,
        OCIODisplayViewEnum displayView,
        OCIOLookEnum look,
        bool inverse)
    {
        EnsureInitialized();

        var config = ActiveConfig;
        var inputTag = src?.Tag as OCIOInputTag;
        var outputTag = displayView?.Tag as OCIOTargetTag;
        var lookName = look?.Value;

        if (config == null || inputTag == null || outputTag == null)
            return GPUResources.Passthrough;

        var effectiveLook = (lookName == "None" || string.IsNullOrWhiteSpace(lookName))
            ? null : lookName;

        try
        {
            config.CreateDisplayViewProcessor(
                inputTag.ColorSpace, outputTag.Display, outputTag.View, effectiveLook, inverse);

            return new GPUResources
            {
                Shader = config.GetHLSLShader(),
                Uniforms = config.GetUniforms(),
                Textures = config.GetTextures(),
                Textures3D = config.Get3DTextures()
            };
        }
        catch { return GPUResources.Passthrough; }
    }
}
