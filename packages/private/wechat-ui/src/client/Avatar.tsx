import { useRef, type CSSProperties } from 'react'
import { Icon, WhaleMark } from './icons.tsx'
import type { AvatarGlyph, AvatarView } from './types.ts'

export const AVATAR_COLORS = ['#2f6bff', '#7958d8', '#0e9f8a', '#e66a3c', '#d14c7b', '#3b7c96'] as const
export const AVATAR_GLYPHS: readonly AvatarGlyph[] = ['whale', 'code', 'spark', 'folder', 'robot']

export function defaultAvatar(id: string): AvatarView {
  let hash = 0
  for (const char of id) hash = ((hash * 31) + char.charCodeAt(0)) | 0
  const positive = Math.abs(hash)
  return {
    color: AVATAR_COLORS[positive % AVATAR_COLORS.length] ?? AVATAR_COLORS[0],
    glyph: AVATAR_GLYPHS[positive % AVATAR_GLYPHS.length] ?? 'whale',
  }
}

export function AvatarBadge({ avatar, size = 42, className = '' }: {
  avatar: AvatarView
  size?: number
  className?: string
}) {
  const style = { '--diywx-avatar-size': `${size}px`, '--diywx-avatar-color': avatar.color } as CSSProperties
  const groupMembers = avatar.glyph === 'group' ? (avatar.members ?? []).slice(0, 9) : []
  const groupColumns = groupMembers.length <= 1 ? 1 : groupMembers.length <= 4 ? 2 : 3
  const groupGap = size >= 40 ? 2 : 1
  const groupCell = Math.max(5, Math.floor((size - 4 - groupGap * (groupColumns - 1)) / groupColumns))
  return (
    <span className={`diywx-avatar ${className}`} style={style} data-glyph={avatar.glyph} aria-hidden="true">
      {avatar.glyph === 'group'
        ? <span className="diywx-group-avatar-grid" data-count={groupMembers.length} style={{ gridTemplateColumns: `repeat(${groupColumns}, ${groupCell}px)`, gap: groupGap }}>
          {groupMembers.map((member, index) => <AvatarBadge key={index} avatar={member} size={groupCell} />)}
        </span>
        : avatar.glyph === 'image'
          ? avatar.image !== undefined
            ? <img src={avatar.image} alt="" />
            : <Icon name="robot" size={Math.round(size * .52)} />
          : avatar.glyph === 'whale'
            ? <WhaleMark size={Math.round(size * .62)} />
            : <Icon name={avatar.glyph} size={Math.round(size * .52)} />}
    </span>
  )
}

export function AvatarEditor({ avatar, title, heading = 'DIY 会话头像', imageHint = '图片仅保存在这个浏览器中，建议小于 1.5 MB。', profile, onChange, onClose }: {
  avatar: AvatarView
  title: string
  heading?: string
  imageHint?: string
  profile?: {
    name: string
    signature: string
    onChange: (profile: { name: string; signature: string }) => void
  }
  onChange: (avatar: AvatarView) => void
  onClose: () => void
}) {
  const fileRef = useRef<HTMLInputElement | null>(null)

  const upload = (file: File | undefined): void => {
    if (file === undefined) return
    if (!file.type.startsWith('image/') || file.size > 1_500_000) return
    const reader = new FileReader()
    reader.addEventListener('load', () => {
      if (typeof reader.result !== 'string') return
      const source = reader.result
      const image = new Image()
      image.addEventListener('load', () => {
        const edge = 256
        const canvas = document.createElement('canvas')
        canvas.width = edge
        canvas.height = edge
        const context = canvas.getContext('2d')
        if (context === null) {
          onChange({ color: avatar.color, glyph: 'image', image: source })
          return
        }
        const side = Math.min(image.naturalWidth, image.naturalHeight)
        const sourceX = Math.max(0, (image.naturalWidth - side) / 2)
        const sourceY = Math.max(0, (image.naturalHeight - side) / 2)
        context.drawImage(image, sourceX, sourceY, side, side, 0, 0, edge, edge)
        onChange({ color: avatar.color, glyph: 'image', image: canvas.toDataURL('image/webp', 0.86) })
      })
      image.addEventListener('error', () => { onChange({ color: avatar.color, glyph: 'image', image: source }) })
      image.src = source
    })
    reader.readAsDataURL(file)
  }

  return (
    <div className="diywx-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="diywx-avatar-editor" role="dialog" aria-modal="true" aria-label={`编辑 ${title} 的头像`} onMouseDown={(event) => { event.stopPropagation() }}>
        <div className="diywx-avatar-editor-head">
          <AvatarBadge avatar={avatar} size={62} />
          <div>
            <strong>{heading}</strong>
            <span>{title}</span>
          </div>
          <button className="diywx-icon-button diywx-close-button" type="button" onClick={onClose} aria-label="关闭头像编辑器">×</button>
        </div>
        {profile !== undefined && (
          <div className="diywx-profile-fields">
            <label>
              <span>昵称</span>
              <input
                value={profile.name}
                maxLength={28}
                placeholder="给自己起个名字"
                onChange={(event) => { profile.onChange({ ...profile, name: event.target.value }) }}
              />
            </label>
            <label>
              <span>个性签名</span>
              <input
                value={profile.signature}
                maxLength={64}
                placeholder="写一句属于你的签名"
                onChange={(event) => { profile.onChange({ ...profile, signature: event.target.value }) }}
              />
            </label>
          </div>
        )}
        <div className="diywx-editor-label">选择图案</div>
        <div className="diywx-avatar-options">
          {AVATAR_GLYPHS.map(glyph => (
            <button
              key={glyph}
              type="button"
              className="diywx-avatar-option"
              data-selected={avatar.glyph === glyph || undefined}
              onClick={() => { onChange({ color: avatar.color, glyph }) }}
              aria-label={`选择 ${glyph} 图案`}
            >
              <AvatarBadge avatar={{ color: avatar.color, glyph }} size={42} />
              {avatar.glyph === glyph && <Icon name="check" size={15} />}
            </button>
          ))}
        </div>
        <div className="diywx-editor-label">选择颜色</div>
        <div className="diywx-color-options">
          {AVATAR_COLORS.map(color => (
            <button
              key={color}
              type="button"
              className="diywx-color-option"
              style={{ background: color }}
              data-selected={avatar.color === color || undefined}
              onClick={() => { onChange({ ...avatar, color }) }}
              aria-label={`选择颜色 ${color}`}
            />
          ))}
        </div>
        <button className="diywx-upload-button" type="button" onClick={() => { fileRef.current?.click() }}>
          上传自己的图片
        </button>
        <input
          ref={fileRef}
          className="diywx-file-input"
          type="file"
          accept="image/*"
          onChange={(event) => { upload(event.currentTarget.files?.[0]) }}
        />
        <p className="diywx-editor-hint">{imageHint}</p>
      </section>
    </div>
  )
}

export function AvatarPreview({ avatar, title, onEdit, onClose }: {
  avatar: AvatarView
  title: string
  onEdit: () => void
  onClose: () => void
}) {
  return (
    <div className="diywx-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="diywx-avatar-preview" role="dialog" aria-modal="true" aria-label={`${title} 的头像大图`} onMouseDown={(event) => { event.stopPropagation() }}>
        <button className="diywx-icon-button diywx-close-button" type="button" onClick={onClose} aria-label="关闭头像大图">×</button>
        <AvatarBadge avatar={avatar} size={190} />
        <strong>{title}</strong>
        <button className="diywx-upload-button" type="button" onClick={onEdit}><Icon name="edit" size={15} />DIY 这个头像</button>
      </section>
    </div>
  )
}
