export type LocalUiMode = 'wechat' | 'native'

export const LOCAL_UI_MODE_STORAGE_KEY = 'dsh-diy-lab.ui-mode.v1'

export function readLocalUiMode(): LocalUiMode {
  return localStorage.getItem(LOCAL_UI_MODE_STORAGE_KEY) === 'native' ? 'native' : 'wechat'
}

function transitionLabel(mode: LocalUiMode): { title: string; hint: string } {
  return mode === 'native'
    ? { title: '正在切换到原生 DSH UI', hint: '会话、工作区和聊天记录保持不变' }
    : { title: '正在切换到微信式 UI', hint: '正在重新挂载熟悉的会话界面' }
}

export function switchLocalUiMode(mode: LocalUiMode): void {
  if (readLocalUiMode() === mode) return
  const previous = document.querySelector('[data-diywx-ui-transition]')
  if (previous !== null) return

  const copy = transitionLabel(mode)
  const screen = document.createElement('div')
  screen.dataset.diywxUiTransition = mode
  screen.className = 'diywx-ui-transition'
  screen.setAttribute('role', 'status')
  screen.setAttribute('aria-live', 'assertive')

  const mark = document.createElement('div')
  mark.className = 'diywx-ui-transition-mark'
  mark.append(document.createElement('i'), document.createElement('i'))
  const title = document.createElement('strong')
  title.textContent = copy.title
  const hint = document.createElement('span')
  hint.textContent = copy.hint
  const dots = document.createElement('div')
  dots.className = 'diywx-ui-transition-dots'
  dots.append(document.createElement('i'), document.createElement('i'), document.createElement('i'))
  screen.append(mark, title, hint, dots)
  document.body.append(screen)
  requestAnimationFrame(() => { screen.classList.add('is-visible') })

  localStorage.setItem(LOCAL_UI_MODE_STORAGE_KEY, mode)
  window.setTimeout(() => { window.location.reload() }, 620)
}
