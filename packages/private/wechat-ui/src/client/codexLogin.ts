import type { ModelChannelPromptView } from './types.ts'

const DEVICE_CODE = 'device_code'

/**
 * Pick the official Codex device-code method so the settings card can skip the
 * browser-vs-headless question and go straight to the verification code.
 * @param prompt - authorization prompt from the host.
 */
export function autoCodexPromptAnswer(
  prompt: Pick<ModelChannelPromptView, 'kind' | 'options'> | undefined,
): string | undefined {
  if (prompt?.kind !== 'select') return undefined
  return prompt.options?.find(option => option.id === DEVICE_CODE)?.id
}

/**
 * The leftover “按提示填写” field is only for unexpected login questions.
 * Device-code login is answered by the host, so a signed-in card must not show it.
 * @param channel - Codex status from `/api/diy-model-access`.
 */
export function shouldShowCodexTextPrompt(channel: {
  inFlight?: boolean
  prompt?: Pick<ModelChannelPromptView, 'kind' | 'message' | 'options'>
} | undefined): boolean {
  if (channel?.inFlight !== true || channel.prompt === undefined) return false
  if (autoCodexPromptAnswer(channel.prompt) !== undefined) return false
  if ((channel.prompt.options?.length ?? 0) > 0) return false
  return (channel.prompt.message ?? '').trim() !== ''
}
