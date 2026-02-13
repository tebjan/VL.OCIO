using System;
using VL.Core;
using VL.Lib.Basics.Imaging;
using VL.OCIO;
using OCIOSharpCLI;

namespace VL.OCIO
{
    /// <summary>
    /// CPU-based OCIO Display/View transform with Look support.
    /// Primary use: Reference comparison to validate GPU display/view transforms.
    /// </summary>
    [ProcessNode]
    public class OCIODisplayViewTransformCPU : IDisposable
    {
        private readonly NodeContext _nodeContext;

        // Cached state
        private OCIOConfig _cachedConfig;
        private string _cachedInputCS;
        private string _cachedDisplay;
        private string _cachedView;
        private string _cachedLook;
        private bool _cachedInverse;
        private IImage _cachedOutputImage;
        private float[] _cachedWorkBuffer;

        public OCIODisplayViewTransformCPU(NodeContext nodeContext)
        {
            _nodeContext = nodeContext;
        }

        /// <summary>
        /// Apply OCIO Display/View transform with Look on CPU.
        /// </summary>
        public void Update(
            // OUT parameters first
            out IImage output,
            out bool success,
            out string errorMessage,

            // VALUE inputs with defaults
            IImage input = null,
            OCIOColorSpaceEnum inputColorSpace = null,
            OCIODisplayViewEnum displayView = null,
            OCIOLookEnum look = null,
            bool inverse = false)
        {
            // Fast path validation
            if (input == null)
            {
                output = _cachedOutputImage ?? ImageExtensions.Default;
                success = false;
                errorMessage = "No input image provided";
                return;
            }

            var config = OCIOConfigUtils.ActiveConfig;
            var inputTag = inputColorSpace?.Tag as OCIOInputTag;
            var outputTag = displayView?.Tag as OCIOTargetTag;

            if (config == null || inputTag == null || outputTag == null)
            {
                output = _cachedOutputImage ?? input;
                success = false;
                errorMessage = "Invalid colorspace or display/view selected";
                return;
            }

            try
            {
                var inputCS = inputTag.ColorSpace;
                var display = outputTag.Display;
                var view = outputTag.View;
                var lookName = (look?.Value == "None" || string.IsNullOrWhiteSpace(look?.Value))
                    ? null : look?.Value;
                var info = input.Info;

                // Validate input format (must be R32G32B32A32F for OCIO CPU processing)
                if (info.Format != PixelFormat.R32G32B32A32F)
                {
                    output = _cachedOutputImage ?? input;
                    success = false;
                    errorMessage = $"Input must be R32G32B32A32F format (got {info.Format})";
                    return;
                }

                // Change detection
                bool needsUpdate = _cachedConfig != config ||
                                 _cachedInputCS != inputCS ||
                                 _cachedDisplay != display ||
                                 _cachedView != view ||
                                 _cachedLook != lookName ||
                                 _cachedInverse != inverse;

                if (needsUpdate)
                {
                    config.CreateDisplayViewProcessor(inputCS, display, view, lookName, inverse);
                    _cachedConfig = config;
                    _cachedInputCS = inputCS;
                    _cachedDisplay = display;
                    _cachedView = view;
                    _cachedLook = lookName;
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
