/**
 * Vite's `?raw` suffix inlines a file's contents as a string. The Worker
 * tsconfig deliberately excludes Node types, so tests that need to read a
 * project file use this instead of `node:fs`.
 */
declare module '*?raw' {
  const content: string;
  export default content;
}
