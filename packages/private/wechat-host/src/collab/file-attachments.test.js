import assert from 'node:assert/strict'
import test from 'node:test'
import { decodeUploadedFiles, extractUploadedFile, fileMetadataFromPrompt, filePromptContext } from '../file-attachments.js'

test('plain-text attachments are extracted for the model without embedding binary data in metadata', () => {
  const [file] = decodeUploadedFiles([{ name: '需求.md', mediaType: 'text/markdown', data: Buffer.from('# 斗地主\n支持三人联机。').toString('base64') }])
  const extracted = extractUploadedFile(file)
  const stored = { id: 'file_0123456789abcdef0123456789abcdef', name: file.name, mediaType: file.mediaType, size: file.bytes.length, extractedCharacters: extracted.text.length, truncated: extracted.truncated, extractedText: extracted.text }
  const prompt = filePromptContext([stored])
  const metadata = fileMetadataFromPrompt(prompt)

  assert.match(prompt, /支持三人联机/u)
  assert.equal(metadata[0].name, '需求.md')
  assert.equal(prompt.includes(file.bytes.toString('base64')), false)
})

test('credential-like attachments are rejected before storage', () => {
  assert.throws(() => decodeUploadedFiles([{ name: '.env.production', mediaType: 'text/plain', data: Buffer.from('API_KEY=secret').toString('base64') }]), /保护隐私/u)
  assert.throws(() => decodeUploadedFiles([{ name: 'private-key.pem', mediaType: 'text/plain', data: Buffer.from('secret').toString('base64') }]), /保护隐私/u)
})
