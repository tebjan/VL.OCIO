/*
using System;
using VL.Core;
using VL.Lib.Basics.Imaging;
using VL.OCIO;
using OCIOSharpCLI;

namespace VL.OCIO
{
    /// <summary>
    /// CPU-based OCIO color transform (Colorspace to Colorspace).
    /// Primary use: Reference comparison to validate GPU shader nodes.
    /// </summary>
    [ProcessNode]
    public class OCIOTransformCPU : IDisposable
    {
        private readonly NodeContext _nodeContext;

        // Cached state to avoid per-frame work
        private OCIOConfig _cachedConfig;
        private string _cachedInputCS;
        private string _cachedOutputCS;
        private bool _cachedInverse;
        private IImage _cachedOutputImage;
        private float[] _cachedWorkBuffer;

        public OCIOTransformCPU(NodeContext nodeContext)
        {
            _nodeContext = nodeContext;
        }

        /// <summary>
        /// Apply OCIO color transform on CPU (Colorspace to Colorspace).
        /// </summary>
        /// <param name="output">Transformed image (owned, R32G32B32A32F format)</param>
        /// <param name="success">True if transform succeeded</param>
        /// <param name="errorMessage">Error description if success=false</param>
        /// <param name="input">Source image (any format, will convert to R32G32B32A32F if needed)</param>
        /// <param name="inputColorSpace">Source colorspace (e.g., ACEScg)</param>
        /// <param name="outputColorSpace">Target colorspace (e.g., Linear Rec.709)</param>
        /// <param name="inverse">Reverse the transform direction</param>
        public void Update(
            // OUT parameters first
            out IImage output,
            out bool success,
            out string errorMessage,

            // VALUE inputs with defaults
            IImage input = null,
            OCIOColorSpaceEnum inputColorSpace = null,
            OCIOColorSpaceEnum outputColorSpace = null,
            bool inverse = false)
        {
            // Fast path: early validation (no allocations)
            if (input == null)
            {
                output = _cachedOutputImage ?? ImageExtensions.Default;
                success = false;
                errorMessage = "No input image provided";
                return;
            }

            var config = OCIOConfigUtils.ActiveConfig;
            var inputTag = inputColorSpace?.Tag as OCIOInputTag;
            var outputTag = outputColorSpace?.Tag as OCIOInputTag;

            if (config == null || inputTag == null || outputTag == null)
            {
                output = _cachedOutputImage ?? input;
                success = false;
                errorMessage = "Invalid color spaces selected";
                return;
            }

            try
            {
                var inputCS = inputTag.ColorSpace;
                var outputCS = outputTag.ColorSpace;
                var info = input.Info;

                // Validate input format (must be R32G32B32A32F for OCIO CPU processing)
                if (info.Format != PixelFormat.R32G32B32A32F)
                {
                    output = _cachedOutputImage ?? input;
                    success = false;
                    errorMessage = $"Input must be R32G32B32A32F format (got {info.Format})";
                    return;
                }

                // Change detection: only create processor if params changed
                bool needsUpdate = _cachedConfig != config ||
                                 _cachedInputCS != inputCS ||
                                 _cachedOutputCS != outputCS ||
                                 _cachedInverse != inverse;

                if (needsUpdate)
                {
                    config.CreateProcessor(inputCS, outputCS, inverse);
                    _cachedConfig = config;
                    _cachedInputCS = inputCS;
                    _cachedOutputCS = outputCS;
                    _cachedInverse = inverse;
                }

                // Allocate output image if size/format changed (owned)
                if (_cachedOutputImage == null || !_cachedOutputImage.Info.Equals(info))
                {
                    _cachedOutputImage = input.CloneEmpty();
                }

                // Allocate work buffer if size changed
                int pixelCount = info.Width * info.Height * 4; // RGBA = 4 floats
                if (_cachedWorkBuffer == null || _cachedWorkBuffer.Length != pixelCount)
                {
                    _cachedWorkBuffer = new float[pixelCount];
                }

                // Copy input pixels to work buffer
                unsafe
                {
                    using (var srcData = input.GetData())
                    using (var srcHandle = srcData.Bytes.Pin())
                    {
                        fixed (byte* pSrc = srcData.Bytes.Span)
                        {
                            var srcFloats = (float*)pSrc;
                            for (int i = 0; i < pixelCount; i++)
                            {
                                _cachedWorkBuffer[i] = srcFloats[i];
                            }
                        }
                    }
                }

                // Apply CPU transform (C++/CLI call, modifies buffer in-place)
                config.ApplyCPUTransform(_cachedWorkBuffer, info.Width, info.Height);

                // Write transformed data to output image
                unsafe
                {
                    using (var dstData = _cachedOutputImage.GetData())
                    using (var dstHandle = dstData.Bytes.Pin())
                    {
                        fixed (byte* pDst = dstData.Bytes.Span)
                        {
                            var dstFloats = (float*)pDst;
                            for (int i = 0; i < pixelCount; i++)
                            {
                                dstFloats[i] = _cachedWorkBuffer[i];
                            }
                        }
                    }
                }

                // Output owned result (no allocation)
                output = _cachedOutputImage;
                success = true;
                errorMessage = "";
            }
            catch (Exception ex)
            {
                output = _cachedOutputImage ?? input;
                success = false;
                errorMessage = $"Transform failed: {ex.Message}";
            }
        }

        public void Dispose()
        {
            _cachedConfig = null;
            _cachedOutputImage = null;
            _cachedWorkBuffer = null;
        }
    }
}
*/
