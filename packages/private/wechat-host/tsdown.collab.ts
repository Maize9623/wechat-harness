import { defineConfig } from 'tsdown'

/** Standalone 3191 bundle; keep public HTML and static names. */
export default defineConfig({
  entry: { 'collab-ui': 'src/collab/client.tsx' },
  outDir: 'src/collab/public',
  format: ['esm'],
  platform: 'browser',
  target: 'es2022',
  dts: false,
  clean: false,
  sourcemap: false,
  minify: false,
  fixedExtension: true,
})
