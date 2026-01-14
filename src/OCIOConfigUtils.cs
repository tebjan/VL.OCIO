using OCIOSharpCLI;

namespace VL.OCIO;

public enum TargetKind
{
    ColorSpace,
    DisplayView
}

public sealed class OCIOTargetTag
{
    public OCIOConfig Config;
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
}

public static class OCIOConfigUtils
{
    public static void LoadOCIOConfig(string configPath)
    {
        var config = new OCIOConfig();
        config.LoadConfig(configPath);

        var inputDef = OCIOColorSpaceEnumDefinition.Instance;
        inputDef.ClearEntries();

        // Get all concrete color spaces
        var allSpaces = config.GetColorSpaces();
        var spaceSet = new HashSet<string>(allSpaces); // fast lookup

        foreach (var space in allSpaces)
            inputDef.AddEntry(space, config);

        // Add role resolutions (only if they resolve to concrete color spaces not yet added)
        foreach (var role in config.GetRoles())
        {
            var resolved = config.GetRoleColorSpace(role);
            if (!string.IsNullOrWhiteSpace(resolved) && spaceSet.Add(resolved))
            {
                inputDef.AddEntry(resolved, config);
            }
        }

        var outputDef = OCIODisplayColorSpaceEnumDefinition.Instance;
        outputDef.ClearEntries();

        // Add all concrete color spaces as possible targets
        foreach (var space in spaceSet)
        {
            outputDef.AddEntry(space, new OCIOTargetTag
            {
                Config = config,
                Kind = TargetKind.ColorSpace,
                ColorSpace = space
            });
        }

        // Add display/view combinations as display targets
        foreach (var display in config.GetDisplays())
        {
            foreach (var view in display.Views)
            {
                var label = $"{display.Name} – {view}";
                outputDef.AddEntry(label, new OCIOTargetTag
                {
                    Config = config,
                    Kind = TargetKind.DisplayView,
                    Display = display.Name,
                    View = view
                });
            }
        }
    }

    public static GPUResources GetGPUResources(
    OCIOColorSpaceEnum inputColorSpace,
    OCIODisplayColorSpaceEnum ocioColorSpaceEnum,
    bool inverse)
    {
        var srcName = inputColorSpace?.Value;
        var tag = ocioColorSpaceEnum?.Tag as OCIOTargetTag;
        if (string.IsNullOrWhiteSpace(srcName) || tag?.Config == null)
            return null;

        if (tag.Kind == TargetKind.ColorSpace)
        {
            tag.Config.CreateProcessor(srcName, tag.ColorSpace, inverse);
        }
        else
        {
            tag.Config.CreateProcessor(srcName, tag.Display, tag.View, inverse);
        }

        return new GPUResources
        {
            Shader = tag.Config.GetHLSLShader(),
            Uniforms = tag.Config.GetUniforms(),
            Textures = tag.Config.GetTextures(),
            Textures3D = tag.Config.Get3DTextures()
        };
    }
}
