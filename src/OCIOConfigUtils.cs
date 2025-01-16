using OCIOSharpCLI;

namespace VL.OCIO;
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

        var displays = config.GetDisplays();

        // Create the color space enum
        var def = OCIODisplayColorSpaceEnumDefinition.Instance;

        if (def.Entries.Count > 0)
        {
            var entryDict = def.GetInternalEntries();

            var tag = entryDict.Values.FirstOrDefault() as Tuple<OCIOConfig, string>;

            if (tag != null)
            {
                try
                {
                    tag.Item1.Dispose();
                }
                catch (Exception)
                {
                    // ignored
                }
            }

            def.ClearEntries();
        }

        // Add the display color spaces to the enum
        foreach (var display in displays)
        {
            foreach (var view in display.Views)
            {
                var tag = new Tuple<OCIOConfig, string>(config, display.Name);
                def.AddEntry(view, tag);
            }
        }

        var spaces = config.GetColorSpaces();

        var spacesDef = OCIOColorSpaceEnumDefinition.Instance;

        foreach (var space in spaces)
        {
            spacesDef.AddEntry(space, config);
        }
    }

    public static GPUResources GetGPUResources(OCIOColorSpaceEnum inputColorSpace, OCIODisplayColorSpaceEnum ocioColorSpaceEnum, string inputColorspace)
    {
        var tag = ocioColorSpaceEnum.Tag as Tuple<OCIOConfig, string>;
        var config = tag.Item1;
        var display = tag.Item2;
        var view = ocioColorSpaceEnum.Value;

        config.CreateProcessor(inputColorSpace?.Value ?? "scene_linear", display, view);

        return new GPUResources
        {
            Shader = config.GetHLSLShader(),
            Uniforms = config.GetUniforms(),
            Textures = config.GetTextures(),
            Textures3D = config.Get3DTextures()
        };
    }
}
