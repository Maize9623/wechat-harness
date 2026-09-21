import assert from 'node:assert/strict'
import test from 'node:test'
import { autoCodexPromptAnswer, shouldShowCodexTextPrompt } from './codexLogin.ts'
import {
  collapsedModelChannelsOf,
  groupModelsByChannel,
  modelChannelLabel,
  modelChannelOf,
  readCollapsedModelChannels,
  toggleCollapsedModelChannel,
} from './modelChannels.ts'

test('modelChannelOf puts DeepSeek and Codex on separate channels', () => {
  assert.equal(modelChannelOf({ provider: 'deepseek-official', providerName: 'DeepSeek' }), 'deepseek')
  assert.equal(modelChannelOf({ provider: 'openai-codex', providerName: 'ChatGPT Codex' }), 'codex')
  assert.equal(modelChannelOf({ provider: 'openai', providerName: 'OpenAI' }), 'other')
})

test('groupModelsByChannel keeps DeepSeek first and hides empty groups', () => {
  const grouped = groupModelsByChannel([
    { key: 'codex/gpt-5', provider: 'openai-codex', providerName: 'ChatGPT Codex', model: 'gpt-5', name: 'GPT-5' },
    { key: 'deepseek/flash', provider: 'deepseek-official', providerName: 'DeepSeek', model: 'deepseek-chat', name: 'Flash' },
    { key: 'other/local', provider: 'ollama', providerName: 'Ollama', model: 'local', name: 'Local' },
  ])
  assert.deepEqual(grouped.map(([channel, items]) => [channel, items.map(item => item.key)]), [
    ['deepseek', ['deepseek/flash']],
    ['codex', ['codex/gpt-5']],
    ['other', ['other/local']],
  ])
  assert.equal(modelChannelLabel('codex'), 'ChatGPT Codex 订阅')
  assert.equal(groupModelsByChannel([
    { key: 'deepseek/pro', provider: 'deepseek-official', providerName: 'DeepSeek', model: 'deepseek-reasoner', name: 'Pro' },
  ]).map(([channel]) => channel).join(), 'deepseek')
})

test('groupModelsByChannel lists Codex models by capability, not version', () => {
  const grouped = groupModelsByChannel([
    { key: 'codex/6-astra', provider: 'openai-codex', providerName: 'ChatGPT Codex', model: 'gpt-6-astra', name: 'GPT-6 Astra' },
    { key: 'codex/5.3', provider: 'openai-codex', providerName: 'ChatGPT Codex', model: 'gpt-5.3-codex-spark', name: 'GPT-5.3 Codex Spark' },
    { key: 'codex/5.4', provider: 'openai-codex', providerName: 'ChatGPT Codex', model: 'gpt-5.4', name: 'GPT-5.4' },
    { key: 'codex/5.4-mini', provider: 'openai-codex', providerName: 'ChatGPT Codex', model: 'gpt-5.4-mini', name: 'GPT-5.4 mini' },
    { key: 'codex/5.5', provider: 'openai-codex', providerName: 'ChatGPT Codex', model: 'gpt-5.5', name: 'GPT-5.5' },
    { key: 'codex/5.6-terra', provider: 'openai-codex', providerName: 'ChatGPT Codex', model: 'gpt-5.6-terra', name: 'GPT-5.6 Terra' },
    { key: 'codex/5.6-luna', provider: 'openai-codex', providerName: 'ChatGPT Codex', model: 'gpt-5.6-luna', name: 'GPT-5.6 Luna' },
    { key: 'codex/5.6-sol', provider: 'openai-codex', providerName: 'ChatGPT Codex', model: 'gpt-5.6-sol', name: 'GPT-5.6 Sol' },
  ])
  assert.deepEqual(grouped[0]?.[1].map(item => item.name), [
    'GPT-6 Astra',
    'GPT-5.6 Sol',
    'GPT-5.6 Terra',
    'GPT-5.5',
    'GPT-5.4',
    'GPT-5.6 Luna',
    'GPT-5.4 mini',
    'GPT-5.3 Codex Spark',
  ])
})

test('collapsed model channels default open and persist a DeepSeek or Codex toggle', () => {
  assert.deepEqual(collapsedModelChannelsOf(null), [])
  assert.deepEqual(collapsedModelChannelsOf(['codex', 'nope', 3, 'deepseek']), ['codex', 'deepseek'])
  const memory = new Map<string, string>()
  const previousStorage = globalThis.localStorage
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => { memory.set(key, value) },
    },
  })
  try {
    assert.deepEqual(readCollapsedModelChannels(), [])
    assert.deepEqual(toggleCollapsedModelChannel('codex', []), ['codex'])
    assert.deepEqual(readCollapsedModelChannels(), ['codex'])
    assert.deepEqual(toggleCollapsedModelChannel('deepseek', ['codex']), ['codex', 'deepseek'])
    assert.deepEqual(toggleCollapsedModelChannel('codex', ['codex', 'deepseek']), ['deepseek'])
  } finally {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: previousStorage })
  }
})

test('autoCodexPromptAnswer picks device_code and ignores other questions', () => {
  assert.equal(autoCodexPromptAnswer({
    kind: 'select',
    options: [
      { id: 'browser', label: 'Browser login (default)' },
      { id: 'device_code', label: 'Device code login (headless)' },
    ],
  }), 'device_code')
  assert.equal(autoCodexPromptAnswer({
    kind: 'select',
    options: [{ id: 'a', label: 'Work' }],
  }), undefined)
  assert.equal(autoCodexPromptAnswer({ kind: 'text' }), undefined)
})

test('shouldShowCodexTextPrompt hides the leftover fill field after login', () => {
  assert.equal(shouldShowCodexTextPrompt({
    inFlight: false,
    prompt: { kind: 'text', message: '按提示填写' },
  }), false)
  assert.equal(shouldShowCodexTextPrompt({ inFlight: false }), false)
  assert.equal(shouldShowCodexTextPrompt({
    inFlight: true,
    prompt: { kind: 'select', options: [{ id: 'device_code', label: 'Device code' }] },
  }), false)
  assert.equal(shouldShowCodexTextPrompt({
    inFlight: true,
    prompt: { kind: 'text', message: '确认账号邮箱' },
  }), true)
})
