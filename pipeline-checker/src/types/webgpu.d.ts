/**
 * Augment the Navigator interface to include the WebGPU API.
 *
 * The @webgpu/types package provides most type definitions, but
 * some environments may not include navigator.gpu. This ensures
 * TypeScript recognizes navigator.gpu without errors.
 */
/// <reference types="@webgpu/types" />

export {};
