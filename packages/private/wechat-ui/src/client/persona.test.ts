import assert from 'node:assert/strict'
import test from 'node:test'
import { visibleUserText } from './persona.ts'

test('visibleUserText returns the typed line after the user-message marker', () => {
  assert.equal(visibleUserText('<<<DSH_DIY_USER_MESSAGE>>>\n测试'), '测试')
  assert.equal(
    visibleUserText('<<<DSH_DIY_GLOBAL_RESPONSE_RULES>>>\n界面语言强制规则\n<<<END_DSH_DIY_GLOBAL_RESPONSE_RULES>>>\n<<<DSH_DIY_USER_MESSAGE>>>\nwechat harness测试'),
    'wechat harness测试',
  )
})

test('visibleUserText strips a clipped DIY wrapper that lost its end marker', () => {
  assert.equal(visibleUserText('<<<DSH_DIY_GLOBAL_RESPONSE_RULES>>>界面语言强制规则——$'), '')
  assert.equal(visibleUserText('普通一句话'), '普通一句话')
})

test('visibleUserText hides scheduled wake prompts', () => {
  assert.equal(visibleUserText('<<<DSH_DIY_SCHEDULED_WAKE>>>\n到点了'), '')
})
