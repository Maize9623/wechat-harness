import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { AvatarView } from './types.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** Session-aware conversation body owned by the WeChat-style overlay. */
    'diy.wechat.chat': {
      kind: 'single'
      scope: 'session-maybe'
      owner: {
        avatar: AvatarView
        userAvatar: AvatarView
        subtitle?: string
        workspaceLabel?: string
        onSubtitleChange: (subtitle: string) => void
        onAvatarPreview: () => void
      }
    }
  }
}

export {}
