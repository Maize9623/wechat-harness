/** Composer toolbar buttons the user can show or hide from Settings. */
export const COMPOSER_FEATURE_ITEMS = [
  { id: 'image', label: '上传图片' },
  { id: 'file', label: '上传文件' },
  { id: 'branch', label: 'Git 分支' },
  { id: 'command', label: '会话命令' },
  { id: 'access', label: '批准模式' },
  { id: 'model', label: '模型切换' },
] as const

export type ComposerFeatureId = typeof COMPOSER_FEATURE_ITEMS[number]['id']

/** Slash commands stay off until the user opts in. */
export const DEFAULT_HIDDEN_COMPOSER_FEATURES: readonly ComposerFeatureId[] = ['command']

export const HIDDEN_COMPOSER_STORAGE_KEY = 'dsh-diy-lab.hidden-composer-tools.v1'
export const COMPOSER_VISIBILITY_EVENT = 'diywx-composer-visibility'

/**
 * Resolve the hidden composer-tool list from parsed storage.
 * A missing or invalid value uses the default; an explicit empty array means show every tool.
 * @param raw - `localStorage` JSON value, or `null` when the key is absent.
 * @returns Tool ids that the composer must hide.
 */
export function hiddenComposerFeaturesOf(raw: unknown): string[] {
  if (raw === null || raw === undefined) return [...DEFAULT_HIDDEN_COMPOSER_FEATURES]
  if (!Array.isArray(raw)) return [...DEFAULT_HIDDEN_COMPOSER_FEATURES]
  return raw.filter(item => typeof item === 'string')
}

/**
 * Read hidden composer tools from `localStorage`.
 * @returns Tool ids that the composer must hide.
 */
export function readHiddenComposerFeatures(): string[] {
  try {
    const stored = globalThis.localStorage?.getItem(HIDDEN_COMPOSER_STORAGE_KEY)
    return hiddenComposerFeaturesOf(stored === null || stored === undefined ? null : JSON.parse(stored) as unknown)
  } catch {
    return [...DEFAULT_HIDDEN_COMPOSER_FEATURES]
  }
}

/**
 * Persist hidden composer tools and notify open conversations.
 * @param items - Tool ids to hide. `[]` shows every tool, including slash commands.
 */
export function writeHiddenComposerFeatures(items: readonly string[]): void {
  const next = [...items]
  try { globalThis.localStorage?.setItem(HIDDEN_COMPOSER_STORAGE_KEY, JSON.stringify(next)) } catch { /* keep the in-memory list */ }
  if (typeof globalThis.dispatchEvent === 'function' && typeof globalThis.CustomEvent === 'function') {
    globalThis.dispatchEvent(new CustomEvent(COMPOSER_VISIBILITY_EVENT, { detail: next }))
  }
}

/**
 * @param id - Composer tool id.
 * @param hidden - Hidden ids from storage or a live settings event.
 * @returns Whether the composer should render this tool.
 */
export function isComposerFeatureVisible(id: string, hidden: readonly string[] = readHiddenComposerFeatures()): boolean {
  return !hidden.includes(id)
}
