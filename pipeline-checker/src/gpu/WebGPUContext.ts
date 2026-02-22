/** WebGPU device initialization and canvas configuration. */

export interface GPUContext {
  adapter: GPUAdapter;
  device: GPUDevice;
  format: GPUTextureFormat;
  canvasContext: GPUCanvasContext;
  hasBC: boolean;
}

/**
 * Initialize WebGPU: request adapter + device, configure canvas, detect BC support.
 * Throws if WebGPU is unavailable or no adapter is found.
 */
export async function initWebGPU(canvas: HTMLCanvasElement): Promise<GPUContext> {
  if (!navigator.gpu) {
    throw new Error('WebGPU not supported. Use Chrome 113+ or Edge 113+.');
  }

  const adapter = await navigator.gpu.requestAdapter({
    powerPreference: 'high-performance',
  });
  if (!adapter) {
    throw new Error('No WebGPU adapter found.');
  }

  const hasBC = adapter.features.has('texture-compression-bc');
  const requiredFeatures: GPUFeatureName[] = [];
  if (hasBC) {
    requiredFeatures.push('texture-compression-bc');
  }

  const device = await adapter.requestDevice({
    requiredFeatures,
    requiredLimits: {
      maxStorageBufferBindingSize: 256 * 1024 * 1024,
      maxBufferSize: 256 * 1024 * 1024,
    },
  });

  device.lost.then((info) => {
    console.error(`WebGPU device lost: ${info.message}`);
    if (info.reason !== 'destroyed') {
      console.error('Unexpected device loss — reload the page.');
    }
  });

  // Catch any uncaptured WebGPU validation errors and log prominently
  device.addEventListener('uncapturederror', (event) => {
    console.error(
      `%c[WebGPU] Uncaptured error: ${(event as GPUUncapturedErrorEvent).error.message}`,
      'color: red; font-weight: bold; font-size: 14px;',
    );
  });

  const format = navigator.gpu.getPreferredCanvasFormat();
  const canvasContext = canvas.getContext('webgpu') as GPUCanvasContext;
  canvasContext.configure({
    device,
    format,
    alphaMode: 'premultiplied',
  });

  return { adapter, device, format, canvasContext, hasBC };
}
