import { expect, it } from 'vitest'
import { isGroupChatWindowNavigation, isGroupChatWindowUrl } from '../src/group-chat-window.ts'

it('admits the loopback group-chat entry and first-run setup token', () => {
  expect(isGroupChatWindowUrl('http://127.0.0.1:3191/')).toBe(true)
  expect(isGroupChatWindowUrl('http://localhost:3191/?setup=abc_def-1')).toBe(true)
  expect(isGroupChatWindowUrl('http://127.0.0.1:3191/?session=room_1')).toBe(true)
  expect(isGroupChatWindowNavigation('http://127.0.0.1:3191/login')).toBe(true)
})

it('rejects public pages, LAN copies, and extra query keys', () => {
  expect(isGroupChatWindowUrl('https://example.com/')).toBe(false)
  expect(isGroupChatWindowUrl('http://192.168.1.8:3191/')).toBe(false)
  expect(isGroupChatWindowUrl('http://127.0.0.1:19387/')).toBe(false)
  expect(isGroupChatWindowUrl('http://127.0.0.1:3191/admin')).toBe(false)
  expect(isGroupChatWindowUrl('http://127.0.0.1:3191/?setup=abc&next=/')).toBe(false)
  expect(isGroupChatWindowUrl('http://127.0.0.1:3191/?setup=../etc')).toBe(false)
})
