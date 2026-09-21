import assert from 'node:assert/strict'
import test from 'node:test'
import { formatRemaining, formatResetAt, formatResets } from './usageFormat.ts'

test('formatResetAt keeps the year only when it differs from now', () => {
  const now = Date.parse('2026-09-21T04:00:00+08:00')
  assert.match(formatResetAt(Date.parse('2026-09-27T08:29:00+08:00'), now), /9\/27/)
  assert.match(formatResetAt(Date.parse('2026-09-27T08:29:00+08:00'), now), /刷新/)
  assert.match(formatResetAt(Date.parse('2027-01-02T08:00:00+08:00'), now), /2027/)
  assert.equal(formatResetAt(undefined), '重置时间未知')
})

test('formatRemaining and formatResets keep empty resets off the card', () => {
  assert.equal(formatRemaining(77), '剩余 77%')
  assert.equal(formatRemaining(undefined), '剩余未知')
  assert.equal(formatResets(0), '可用重置 0 次')
  assert.equal(formatResets(undefined), undefined)
})
