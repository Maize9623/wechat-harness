import assert from 'node:assert/strict'
import test from 'node:test'
import { loadWorkspaceHtml } from './workspaceHtml.ts'

test('loadWorkspaceHtml reads the chat filename when it exists', async () => {
  const html = await loadWorkspaceHtml('holiday-calendar.html', {
    read: async path => path === 'holiday-calendar.html' ? '<html></html>' : undefined,
    listNames: async () => ['holiday-calendar.html'],
  })
  assert.equal(html, '<html></html>')
})

test('loadWorkspaceHtml opens the only workspace HTML when the chat name differs', async () => {
  const html = await loadWorkspaceHtml('调休日历.html', {
    read: async path => path === 'holiday-calendar.html' ? '<title>调休日历</title>' : undefined,
    listNames: async () => ['holiday-calendar.html', 'notes.md'],
  })
  assert.equal(html, '<title>调休日历</title>')
})

test('loadWorkspaceHtml ignores an outside Desktop path and uses the workspace file', async () => {
  const html = await loadWorkspaceHtml('/Users/gene/Desktop/调休日历.html', {
    read: async path => path === 'holiday-calendar.html' ? '<p>ok</p>' : undefined,
    listNames: async () => ['holiday-calendar.html'],
  })
  assert.equal(html, '<p>ok</p>')
})

test('loadWorkspaceHtml names the workspace files when several HTML files exist', async () => {
  await assert.rejects(
    () => loadWorkspaceHtml('桌面那份「调休日历.html', {
      read: async () => undefined,
      listNames: async () => ['a.html', 'b.html'],
    }),
    /可预览：a\.html、b\.html/u,
  )
})
