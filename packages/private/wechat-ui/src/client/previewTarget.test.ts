import assert from 'node:assert/strict'
import test from 'node:test'
import { htmlPathCandidates, LOCAL_HTML_TOKEN, localHtmlPath, previewTargetOf, resolveListedHtml } from './previewTarget.ts'

test('previewTargetOf keeps public pages on the browser preview', () => {
  assert.deepEqual(previewTargetOf('https://thepaper.cn/newsDetail_forward_1'), {
    kind: 'browser',
    url: 'https://thepaper.cn/newsDetail_forward_1',
  })
  assert.deepEqual(previewTargetOf('www.example.test/page'), {
    kind: 'browser',
    url: 'https://www.example.test/page',
  })
})

test('previewTargetOf opens local HTML in the visualization preview', () => {
  assert.deepEqual(previewTargetOf('holiday-calendar.html'), { kind: 'html', path: 'holiday-calendar.html' })
  assert.deepEqual(previewTargetOf('./pages/酒历.html'), { kind: 'html', path: './pages/酒历.html' })
  assert.deepEqual(previewTargetOf('「调休日历.html」'), { kind: 'html', path: '调休日历.html' })
  assert.deepEqual(previewTargetOf('/Users/gene/Desktop/调休日历.html', '调休日历.html'), {
    kind: 'html',
    path: '调休日历.html',
  })
  assert.deepEqual(previewTargetOf('file:///Users/gene/work/holiday-calendar.html'), {
    kind: 'html',
    path: 'holiday-calendar.html',
  })
})

test('LOCAL_HTML_TOKEN keeps the filename when CJK prose wraps it', () => {
  const match = '实际就是桌面那份「调休日历.html」'.match(new RegExp(LOCAL_HTML_TOKEN, 'u'))
  assert.equal(match?.[0], '调休日历.html')
})

test('localHtmlPath rejects prose glued onto a filename', () => {
  assert.equal(localHtmlPath('notes.md'), undefined)
  assert.equal(localHtmlPath('javascript:alert(1)'), undefined)
  assert.equal(localHtmlPath('https://example.test/index.html'), undefined)
  assert.equal(localHtmlPath('桌面那份「调休日历.html'), undefined)
  assert.equal(localHtmlPath('就是桌面那份「调休日历.html」'), undefined)
})

test('resolveListedHtml uses the only workspace HTML when names differ', () => {
  assert.deepEqual(htmlPathCandidates('/Users/gene/Desktop/调休日历.html'), ['调休日历.html'])
  assert.equal(resolveListedHtml('调休日历.html', ['holiday-calendar.html']), 'holiday-calendar.html')
  assert.equal(resolveListedHtml('holiday-calendar.html', ['holiday-calendar.html', 'notes.html']), 'holiday-calendar.html')
  assert.equal(resolveListedHtml('missing.html', ['a.html', 'b.html']), undefined)
})
