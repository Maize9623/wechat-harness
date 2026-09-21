import type { ModelOptionView } from './types.ts'

export type ModelChannelId = 'deepseek' | 'codex' | 'other'

const CHANNEL_ORDER: readonly ModelChannelId[] = ['deepseek', 'codex', 'other']

const CHANNEL_LABEL: Readonly<Record<ModelChannelId, string>> = {
  deepseek: 'DeepSeek API',
  codex: 'ChatGPT Codex 订阅',
  other: '其他通道',
}

/**
 * Group a picker row onto the DeepSeek API or ChatGPT Codex channel.
 * @param option - model directory row.
 */
export function modelChannelOf(option: Pick<ModelOptionView, 'provider' | 'providerName'>): ModelChannelId {
  const hay = `${option.provider} ${option.providerName}`.toLowerCase()
  if (hay.includes('codex') || hay.includes('chatgpt')) return 'codex'
  if (hay.includes('deepseek')) return 'deepseek'
  return 'other'
}

/**
 * Label shown above one channel in the model switcher.
 * @param channel - grouped channel id.
 */
export function modelChannelLabel(channel: ModelChannelId): string {
  return CHANNEL_LABEL[channel]
}

const CAPABILITY_BAND = {
  astra: 1_000,
  sol: 900,
  terra: 800,
  standard: 700,
  luna: 500,
  mini: 400,
  nano: 300,
  spark: 200,
} as const

function gptVersionParts(hay: string): readonly [number, number] {
  const dotted = /(\d+)\.(\d+)/.exec(hay)
  if (dotted !== null) return [Number(dotted[1]), Number(dotted[2])]
  const whole = /\bgpt[-\s]?(\d+)\b/u.exec(hay)
  if (whole !== null) return [Number(whole[1]), 0]
  return [0, 0]
}

function capabilityBand(hay: string): number {
  if (/\bastra\b/u.test(hay) || /\bgpt[-\s]?6[-\s]?pro\b/u.test(hay)) return CAPABILITY_BAND.astra
  if (/\bsol\b/u.test(hay)) return CAPABILITY_BAND.sol
  if (/\bterra\b/u.test(hay)) return CAPABILITY_BAND.terra
  if (/\bluna\b/u.test(hay)) return CAPABILITY_BAND.luna
  if (/\bmini\b/u.test(hay)) return CAPABILITY_BAND.mini
  if (/\bnano\b/u.test(hay)) return CAPABILITY_BAND.nano
  if (/\bspark\b/u.test(hay)) return CAPABILITY_BAND.spark
  return CAPABILITY_BAND.standard
}

function codexCapabilityRank(option: Pick<ModelOptionView, 'key' | 'model' | 'name'>): number {
  const hay = `${option.name} ${option.model} ${option.key}`.toLowerCase()
  const [major, minor] = gptVersionParts(hay)
  return capabilityBand(hay) * 1_000 + major * 10 + minor
}

function orderChannelModels(channel: ModelChannelId, items: readonly ModelOptionView[]): readonly ModelOptionView[] {
  if (channel !== 'codex') return items
  return items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const delta = codexCapabilityRank(right.item) - codexCapabilityRank(left.item)
      return delta === 0 ? left.index - right.index : delta
    })
    .map(entry => entry.item)
}

/**
 * Keep DeepSeek first, then Codex, then anything else.
 * Codex rows list stronger capability first: GPT-6 Astra, then Sol, Terra / previous flagships, then Luna, mini, Spark.
 * @param models - session model directory rows.
 */
export function groupModelsByChannel(models: readonly ModelOptionView[]): ReadonlyArray<readonly [ModelChannelId, readonly ModelOptionView[]]> {
  return CHANNEL_ORDER.flatMap((channel) => {
    const items = orderChannelModels(channel, models.filter(option => modelChannelOf(option) === channel))
    return items.length === 0 ? [] : [[channel, items] as const]
  })
}

export const COLLAPSED_MODEL_CHANNEL_STORAGE_KEY = 'dsh-diy-lab.collapsed-model-channels.v1'

const CHANNEL_IDS = new Set<ModelChannelId>(CHANNEL_ORDER)

/**
 * Parse the persisted collapsed-channel list. Missing or invalid storage means every channel is open.
 * @param raw - `localStorage` JSON value, or `null` when the key is absent.
 */
export function collapsedModelChannelsOf(raw: unknown): ModelChannelId[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((item): item is ModelChannelId => typeof item === 'string' && CHANNEL_IDS.has(item as ModelChannelId))
}

/**
 * Read which model-menu channels are collapsed.
 * @returns Channel ids whose model rows stay hidden.
 */
export function readCollapsedModelChannels(): ModelChannelId[] {
  try {
    const stored = globalThis.localStorage?.getItem(COLLAPSED_MODEL_CHANNEL_STORAGE_KEY)
    return collapsedModelChannelsOf(stored === null || stored === undefined ? null : JSON.parse(stored) as unknown)
  } catch {
    return []
  }
}

/**
 * Persist the collapsed model-menu channels.
 * @param items - Channel ids whose model rows stay hidden.
 */
export function writeCollapsedModelChannels(items: readonly ModelChannelId[]): void {
  try {
    globalThis.localStorage?.setItem(COLLAPSED_MODEL_CHANNEL_STORAGE_KEY, JSON.stringify([...items]))
  } catch {
    /* keep the in-memory list */
  }
}

/**
 * Flip one channel between open and collapsed, then persist.
 * @param channel - DeepSeek, Codex, or other.
 * @param collapsed - Current collapsed ids.
 * @returns the next collapsed list.
 */
export function toggleCollapsedModelChannel(
  channel: ModelChannelId,
  collapsed: readonly ModelChannelId[] = readCollapsedModelChannels(),
): ModelChannelId[] {
  const next = collapsed.includes(channel)
    ? collapsed.filter(item => item !== channel)
    : [...collapsed, channel]
  writeCollapsedModelChannels(next)
  return next
}
