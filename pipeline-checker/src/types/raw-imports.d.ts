/**
 * Type declarations for Vite raw string imports.
 * Allows importing .wgsl shader files as strings via the ?raw suffix.
 *
 * Usage:
 *   import shaderCode from './path/to/shader.wgsl?raw';
 *   // shaderCode is typed as `string`
 */
declare module '*.wgsl?raw' {
  const content: string;
  export default content;
}

/**
 * Type declarations for Vite asset imports.
 * Allows importing binary files as asset URLs.
 */
declare module '*.exr' {
  const src: string;
  export default src;
}
