using Stride.Engine;
using Stride.Rendering.Materials;
using Stride.Shaders;
using Stride.Shaders.Compiler;
using Stride.Shaders.Parser;
using System.Reflection;
using VL.Stride.Shaders.ShaderFX;

namespace VL.OCIO;

public class OCIOShader : IComputeValue<Vector4>
{
    public string Name { get; set; }

    public string SourceCode { get; set; }

    public bool HasChanged => false;

    public OCIOShader(Game game, string name, string sourceCode)
    {
        Name = name;
        SourceCode = sourceCode;
    }

    public ShaderSource GenerateShaderSource(ShaderGeneratorContext context, MaterialComputeColorKeys baseKeys)
    {
        var result = new ShaderClassString(Name, SourceCode);
        return result;
    }

    public IEnumerable<IComputeNode> GetChildren(object context = null)
    {
        return Enumerable.Empty<IComputeNode>();
    }
} 

public static class RenderingUtils
{
    public static void AddShaderSource(Game game, string name, string sourceCode)
    {
        try
        {
            var sourcePath = "shaders\\" + name + ".sdsl";

            if (game == null) return;

            var effectSystem = game.EffectSystem;
            var compiler = effectSystem.Compiler as EffectCompiler;
            if (compiler is null && effectSystem.Compiler is EffectCompilerCache effectCompilerCache)
                compiler = typeof(EffectCompilerChain)
                    .GetProperty("Compiler", BindingFlags.Instance | BindingFlags.NonPublic)
                    ?.GetValue(effectCompilerCache) as EffectCompiler;

            if (compiler == null) return;

            var getParserMethod =
                typeof(EffectCompiler).GetMethod("GetMixinParser", BindingFlags.Instance | BindingFlags.NonPublic);
            if (getParserMethod == null) return;
            if (!(getParserMethod.Invoke(compiler, null) is ShaderMixinParser parser)) return;

            var sourceManager = parser.SourceManager;
            sourceManager.AddShaderSource(name, sourceCode, sourcePath);
        }
        catch (Exception)
        {
            // ignored
        }
    }
}
