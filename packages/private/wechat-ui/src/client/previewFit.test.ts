import assert from 'node:assert/strict'
import test from 'node:test'
import { fitPreviewScale, PREVIEW_PAGE_HEIGHT, PREVIEW_PAGE_WIDTH } from './previewFit.ts'

test('fitPreviewScale letterboxes a desktop page without stretching', () => {
  assert.equal(fitPreviewScale(720, 450), 0.5)
  assert.equal(fitPreviewScale(720, 900), 0.5)
  assert.equal(fitPreviewScale(1440, 300), 300 / PREVIEW_PAGE_HEIGHT)
  assert.equal(fitPreviewScale(0, 400), 0.1)
  assert.ok(fitPreviewScale(420, 171) * PREVIEW_PAGE_WIDTH <= 420 + 1e-6)
  assert.ok(fitPreviewScale(420, 171) * PREVIEW_PAGE_HEIGHT <= 171 + 1e-6)
})
