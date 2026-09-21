import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_HIDDEN_COMPOSER_FEATURES,
  hiddenComposerFeaturesOf,
  isComposerFeatureVisible,
  readHiddenComposerFeatures,
  writeHiddenComposerFeatures,
} from './composerVisibility.ts'

test('missing storage hides slash commands by default', () => {
  assert.deepEqual(hiddenComposerFeaturesOf(null), [...DEFAULT_HIDDEN_COMPOSER_FEATURES])
  assert.equal(isComposerFeatureVisible('command', hiddenComposerFeaturesOf(null)), false)
  assert.equal(isComposerFeatureVisible('access', hiddenComposerFeaturesOf(null)), true)
  assert.equal(isComposerFeatureVisible('model', hiddenComposerFeaturesOf(null)), true)
})

test('an explicit empty list shows every composer tool', () => {
  assert.deepEqual(hiddenComposerFeaturesOf([]), [])
  assert.equal(isComposerFeatureVisible('command', []), true)
})

test('invalid storage falls back to the default hidden list', () => {
  assert.deepEqual(hiddenComposerFeaturesOf({}), [...DEFAULT_HIDDEN_COMPOSER_FEATURES])
  assert.deepEqual(hiddenComposerFeaturesOf(['access', 12, 'command']), ['access', 'command'])
})

test('read and write persist the hidden list through localStorage', () => {
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
    assert.deepEqual(readHiddenComposerFeatures(), [...DEFAULT_HIDDEN_COMPOSER_FEATURES])
    writeHiddenComposerFeatures([])
    assert.deepEqual(readHiddenComposerFeatures(), [])
    writeHiddenComposerFeatures(['command', 'branch'])
    assert.deepEqual(readHiddenComposerFeatures(), ['command', 'branch'])
  } finally {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: previousStorage })
  }
})
