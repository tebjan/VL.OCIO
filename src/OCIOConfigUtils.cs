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

        // Add the color spaces to the enum
        foreach (var display in displays)
        {
            foreach (var view in display.Views)
            {
                var tag = new Tuple<OCIOConfig, string>(config, display.Name);
                def.AddEntry(view, tag);
            }
        }
    }

    public static GPUResources GetGPUResources(OCIODisplayColorSpaceEnum ocioColorSpaceEnum, string inputColorspace)
    {
        var tag = ocioColorSpaceEnum.Tag as Tuple<OCIOConfig, string>;
        var config = tag.Item1;
        var display = tag.Item2;
        var view = ocioColorSpaceEnum.Value;

        config.CreateProcessor("scene_linear", display, view);

        return new GPUResources
        {
            Shader = config.GetHLSLShader(),
            Uniforms = config.GetUniforms(),
            Textures = config.GetTextures(),
            Textures3D = config.Get3DTextures()
        };
    }
}
