/**
 * Async single-pixel readback from any stage's render target.
 *
 * Used by the hover readout (Phase 8) to display RGBA values.
 * Creates a staging buffer per read (256 bytes minimum for alignment).
 * Throttling to ~30 Hz is handled by the caller (requestAnimationFrame).
 */
export class PixelReadback {
  private device: GPUDevice;
  private pending: boolean = false;

  constructor(device: GPUDevice) {
    this.device = device;
  }

  /**
   * Read a single pixel's RGBA float32 values from a texture.
   * Returns null if a previous read is still pending (debounce).
   *
   * @param texture - The stage render target to read from
   * @param x - Pixel X coordinate
   * @param y - Pixel Y coordinate
   * @returns Float32Array [R, G, B, A] or null if throttled
   */
  async readPixel(
    texture: GPUTexture,
    x: number,
    y: number
  ): Promise<Float32Array | null> {
    if (this.pending) return null;
    this.pending = true;

    try {
      // 256 bytes minimum — WebGPU bytesPerRow alignment for copyTextureToBuffer
      const bytesPerRow = 256;
      const buffer = this.device.createBuffer({
        size: bytesPerRow,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        label: 'Pixel Readback Staging',
      });

      const encoder = this.device.createCommandEncoder();
      encoder.copyTextureToBuffer(
        { texture, origin: { x, y, z: 0 } },
        { buffer, bytesPerRow },
        { width: 1, height: 1 }
      );
      this.device.queue.submit([encoder.finish()]);

      await buffer.mapAsync(GPUMapMode.READ);
      const pixel = new Float32Array(4);
      if (texture.format === 'rgba16float') {
        const dv = new DataView(buffer.getMappedRange(0, 8));
        for (let i = 0; i < 4; i++) pixel[i] = dv.getFloat16(i * 2, true);
      } else {
        const mapped = new Float32Array(buffer.getMappedRange(0, 16));
        pixel.set(mapped);
      }
      buffer.unmap();
      buffer.destroy();

      return pixel; // [R, G, B, A]
    } finally {
      this.pending = false;
    }
  }
}
