// The esbuild build (interactive-renderer/build.mjs) bundles CSS imports
// directly; this ambient declaration only satisfies `tsc --noEmit` type
// checking for those imports, which are otherwise only understood by
// esbuild/webpack-style bundlers, not plain TypeScript.
declare module "*.css" {
  const content: void;
  export default content;
}
