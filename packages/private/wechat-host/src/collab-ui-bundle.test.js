import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const publicDir = fileURLToPath(new URL('./collab/public/', import.meta.url))

test('3191 public shell includes the current WeChat titlebar and session resizer', () => {
  const js = readFileSync(join(publicDir, 'collab-ui.js'), 'utf8')
  const css = readFileSync(join(publicDir, 'collab-ui.css'), 'utf8')
  assert.match(js, /diywx-rail-titlebar/u)
  assert.match(js, /diywx-session-panel-resizer/u)
  assert.doesNotMatch(js, /from ["']react-dom\/client["']/u)
  assert.doesNotMatch(js, /react\.transitional\.element/u)
  assert.match(css, /\.diywx-rail-titlebar[\s\S]*-webkit-app-region:\s*drag/u)
})
