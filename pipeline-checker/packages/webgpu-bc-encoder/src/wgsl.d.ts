/** Type declaration for WGSL shader imports via Vite ?raw suffix */
declare module '*.wgsl?raw' {
  const source: string;
  export default source;
}
