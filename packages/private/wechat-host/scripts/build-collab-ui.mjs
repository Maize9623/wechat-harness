/** Bundle the current WeChat shell into the 3191 public entry. */
import { existsSync } from 'node:fs'
import { rename, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'tsdown'

const root = fileURLToPath(new URL('..', import.meta.url))
const publicDir = join(root, 'src/collab/public')
const wechatCss = join(root, '../wechat-ui/src/client/wechat-ui.css')
const standaloneCss = join(root, 'src/collab/standalone.css')
const reactRoot = [
  join(root, 'node_modules/react'),
  join(root, '../../../node_modules/.pnpm/react@18.3.1/node_modules/react'),
].find(existsSync)
const reactDomRoot = [
  join(root, 'node_modules/react-dom'),
  join(root, '../../../node_modules/.pnpm/react-dom@18.3.1_react@18.3.1/node_modules/react-dom'),
].find(existsSync)
if (reactRoot === undefined || reactDomRoot === undefined) {
  throw new Error('collab-ui bundle: React 18 is not installed')
}

await build({
  config: false,
  cwd: root,
  entry: { 'collab-ui': join(root, 'src/collab/client.tsx') },
  outDir: publicDir,
  format: ['esm'],
  platform: 'browser',
  target: 'es2022',
  dts: false,
  clean: false,
  sourcemap: false,
  minify: true,
  define: { 'process.env.NODE_ENV': '"production"' },
  fixedExtension: true,
  alias: {
    react: join(reactRoot, 'index.js'),
    'react/jsx-runtime': join(reactRoot, 'jsx-runtime.js'),
    'react/jsx-dev-runtime': join(reactRoot, 'jsx-dev-runtime.js'),
    'react-dom': join(reactDomRoot, 'index.js'),
    'react-dom/client': join(reactDomRoot, 'client.js'),
  },
  inputOptions: {
    transform: {
      jsx: {
        runtime: 'automatic',
        importSource: 'react',
        development: false,
      },
    },
  },
  deps: {
    alwaysBundle: ['react', 'react-dom', 'react-dom/client', /^@ainfinity\//u, /^@deepseek-ai\//u],
  },
})

const bundled = join(publicDir, 'collab-ui.mjs')
try {
  await rename(bundled, join(publicDir, 'collab-ui.js'))
} catch (error) {
  if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error
}

await writeFile(
  join(publicDir, 'collab-ui.css'),
  `${await readFile(wechatCss, 'utf8')}\n${await readFile(standaloneCss, 'utf8')}\n`,
)
