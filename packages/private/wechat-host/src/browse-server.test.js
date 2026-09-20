import assert from 'node:assert/strict'
import test from 'node:test'
import { embedBlockedByHeaders, rewritePreviewHtml, safeBrowseTarget } from './browse-server.js'

test('safeBrowseTarget accepts only http(s) pages', () => {
  assert.equal(safeBrowseTarget('https://www.apple.com/newsroom/')?.href, 'https://www.apple.com/newsroom/')
  assert.equal(safeBrowseTarget('http://127.0.0.1:19387/'), undefined)
  assert.equal(safeBrowseTarget('file:///etc/passwd'), undefined)
  assert.equal(safeBrowseTarget('not a url'), undefined)
})

test('embedBlockedByHeaders treats X-Frame-Options and frame-ancestors none as blocked', () => {
  assert.equal(embedBlockedByHeaders(new Headers({ 'x-frame-options': 'DENY' })), true)
  assert.equal(embedBlockedByHeaders(new Headers({ 'x-frame-options': 'sameorigin' })), true)
  assert.equal(embedBlockedByHeaders(new Headers({ 'content-security-policy': "default-src 'self'; frame-ancestors 'none'" })), true)
  assert.equal(embedBlockedByHeaders(new Headers({ 'content-security-policy': "default-src 'self'" })), false)
})

test('rewritePreviewHtml injects a document base and drops meta CSP', () => {
  const html = rewritePreviewHtml(
    '<html><head><meta http-equiv="Content-Security-Policy" content="frame-ancestors \'none\'"><title>x</title></head><body>ok</body></html>',
    'https://www.apple.com/newsroom/2026/09/page/',
  )
  assert.match(html, /<base href="https:\/\/www\.apple\.com\/newsroom\/2026\/09\/page\/">/u)
  assert.doesNotMatch(html, /Content-Security-Policy/u)
  assert.match(html, /parent\.postMessage\(\{type:"diywx-escape"\}/u)
  assert.match(html, /<\/script><\/body>/u)
})
