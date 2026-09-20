import { useRef, useState } from 'react'
import { AVATAR_COLORS, AVATAR_GLYPHS, AvatarBadge } from './Avatar.tsx'
import { Icon } from './icons.tsx'
import type { AvatarView, NewSessionDraft, WorkspaceGroupView } from './types.ts'

const DEFAULT_AVATAR: AvatarView = { color: '#2f6bff', glyph: 'whale' }

export function NewSessionDialog({ workspaces, onCreate, onClose, multiplayerEnabled = false }: {
  workspaces: readonly WorkspaceGroupView[]
  onCreate: (draft: NewSessionDraft) => Promise<void>
  onClose: () => void
  multiplayerEnabled?: boolean
}) {
  const [visibility, setVisibility] = useState<'private' | 'shared'>('private')
  const [workspaceId, setWorkspaceId] = useState('')
  const [title, setTitle] = useState('')
  const [subtitle, setSubtitle] = useState('')
  const [avatar, setAvatar] = useState<AvatarView>(DEFAULT_AVATAR)
  const [avatarTouched, setAvatarTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [brief, setBrief] = useState('')
  const [passwordProtected, setPasswordProtected] = useState(false)
  const [roomPassword, setRoomPassword] = useState('')
  const [approvalMode, setApprovalMode] = useState<'unanimous' | 'admin' | 'auto'>('unanimous')
  const [quietSeconds, setQuietSeconds] = useState(30)
  const [agentEnabled, setAgentEnabled] = useState(true)
  const fileRef = useRef<HTMLInputElement | null>(null)

  const changeAvatar = (value: AvatarView): void => {
    setAvatar(value)
    setAvatarTouched(true)
    setError(null)
  }

  const upload = (file: File | undefined): void => {
    if (file === undefined) return
    if (!file.type.startsWith('image/')) {
      setError('请选择图片文件')
      return
    }
    if (file.size > 1_500_000) {
      setError('头像图片请小于 1.5 MB')
      return
    }
    const reader = new FileReader()
    reader.addEventListener('load', () => {
      if (typeof reader.result === 'string') changeAvatar({ color: avatar.color, glyph: 'image', image: reader.result })
    })
    reader.readAsDataURL(file)
  }

  const submit = async (): Promise<void> => {
    if (visibility === 'shared' && passwordProtected && roomPassword.trim() === '') {
      setError('启用进群密码后，请填写密码')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onCreate({
        ...(workspaceId === '' ? {} : { workspaceId }),
        ...(title.trim() === '' ? {} : { title: title.trim() }),
        ...(subtitle.trim() === '' ? {} : { subtitle: subtitle.trim() }),
        ...(avatarTouched ? { avatar } : {}),
        ...(multiplayerEnabled ? { visibility } : {}),
        ...(visibility === 'shared' && brief.trim() !== '' ? { brief: brief.trim() } : {}),
        ...(visibility === 'shared' ? { passwordProtected } : {}),
        ...(visibility === 'shared' && passwordProtected ? { roomPassword } : {}),
        ...(visibility === 'shared' ? { approvalMode, quietSeconds, agentEnabled } : {}),
      })
    } catch (reason) {
      setBusy(false)
      setError(reason instanceof Error ? reason.message : '新会话创建失败，请重试')
    }
  }

  return (
    <div className="diywx-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose() }}>
      <section className="diywx-new-session-dialog" role="dialog" aria-modal="true" aria-label="创建新会话">
        <header>
          <span className="diywx-new-session-heading"><span><Icon name="plus" size={20} /></span><span><strong>创建新会话</strong><small>先选归属，也可以全部留空直接开始</small></span></span>
          <button type="button" aria-label="关闭创建新会话" disabled={busy} onClick={onClose}>×</button>
        </header>

        <div className="diywx-new-session-body">
          {multiplayerEnabled && (
            <section className="diywx-new-session-section">
              <div className="diywx-new-session-label"><strong>会话方式</strong><small>界面保持一致，只改变谁能看到和参与</small></div>
              <div className="diywx-new-session-kind" role="radiogroup" aria-label="选择单人或多人会话">
                <button type="button" role="radio" aria-checked={visibility === 'private'} data-selected={visibility === 'private' || undefined} onClick={() => { setVisibility('private') }}>
                  <Icon name="chat" size={18} /><span><strong>单人会话</strong><small>仅自己可见，使用私人数据</small></span>
                </button>
                <button type="button" role="radio" aria-checked={visibility === 'shared'} data-selected={visibility === 'shared' || undefined} onClick={() => { setVisibility('shared') }}>
                  <Icon name="plus" size={18} /><span><strong>多人会话</strong><small>创建后生成邀请链接</small></span>
                </button>
              </div>
            </section>
          )}
          <section className="diywx-new-session-section">
            <div className="diywx-new-session-label"><strong>放在哪里</strong><small>默认创建为无工作区会话</small></div>
            <div className="diywx-new-workspace-grid" role="radiogroup" aria-label="选择会话工作区">
              <button type="button" role="radio" aria-checked={workspaceId === ''} data-selected={workspaceId === '' || undefined} onClick={() => { setWorkspaceId('') }}>
                <span><Icon name="chat" size={17} /></span><strong>无工作区</strong><small>显示在工作区分组下方</small>
              </button>
              {workspaces.map(workspace => (
                <button key={workspace.id} type="button" role="radio" aria-checked={workspaceId === workspace.id} data-selected={workspaceId === workspace.id || undefined} onClick={() => { setWorkspaceId(workspace.id) }}>
                  <span><Icon name="folder" size={17} /></span><strong>{workspace.title}</strong><small title={workspace.path}>{workspace.path}</small>
                </button>
              ))}
            </div>
          </section>

          <section className="diywx-new-session-section diywx-new-session-profile">
            <div className="diywx-new-session-label"><strong>会话资料</strong><small>留空会在第一条消息后自动生成</small></div>
            <div className="diywx-new-avatar-row">
              <AvatarBadge avatar={avatar} size={58} />
              <div className="diywx-new-avatar-controls">
                <div className="diywx-new-avatar-glyphs" aria-label="选择会话头像图案">
                  {AVATAR_GLYPHS.map(glyph => (
                    <button key={glyph} type="button" data-selected={avatarTouched && avatar.glyph === glyph || undefined} aria-label={`选择 ${glyph} 头像`} onClick={() => { changeAvatar({ color: avatar.color, glyph }) }}>
                      <AvatarBadge avatar={{ color: avatar.color, glyph }} size={30} />
                    </button>
                  ))}
                </div>
                <div className="diywx-new-avatar-colors" aria-label="选择会话头像颜色">
                  {AVATAR_COLORS.map(color => <button key={color} type="button" style={{ background: color }} data-selected={avatarTouched && avatar.color === color || undefined} aria-label={`选择颜色 ${color}`} onClick={() => { changeAvatar({ ...avatar, color }) }} />)}
                  <button className="diywx-new-avatar-upload" type="button" onClick={() => { fileRef.current?.click() }}><Icon name="image" size={14} />上传</button>
                  <input ref={fileRef} className="diywx-file-input" type="file" accept="image/*" onChange={(event) => { upload(event.currentTarget.files?.[0]) }} />
                </div>
              </div>
            </div>
            <div className="diywx-new-session-fields">
              <label><span>主标题</span><input value={title} maxLength={40} placeholder="留空，按第一条消息生成" onChange={(event) => { setTitle(event.target.value) }} /></label>
              <label><span>副标题</span><input value={subtitle} maxLength={70} placeholder="留空，按第一条消息生成" onChange={(event) => { setSubtitle(event.target.value) }} /></label>
            </div>
          </section>
          {multiplayerEnabled && visibility === 'shared' && (
            <section className="diywx-new-session-section diywx-new-session-collaboration">
              <div className="diywx-new-session-label"><strong>多人协作规则</strong><small>这些设置以后可以由群主修改</small></div>
              <label><span>群聊说明</span><input value={brief} maxLength={200} placeholder="例如：共同完成产品官网，也可以只是一起聊天" onChange={(event) => { setBrief(event.target.value) }} /></label>
              <label className="diywx-new-session-switch"><input type="checkbox" checked={passwordProtected} onChange={(event) => { setPasswordProtected(event.target.checked); if (!event.target.checked) setRoomPassword(''); setError(null) }} /><span><strong>启用进群密码</strong><small>默认关闭；邀请链接本身仍受次数和有效期限制</small></span></label>
              {passwordProtected && <label><span>进群密码</span><input type="password" value={roomPassword} maxLength={64} autoComplete="new-password" placeholder="输入后才会启用密码保护" onChange={(event) => { setRoomPassword(event.target.value); setError(null) }} /></label>}
              <div className="diywx-new-session-collab-row">
                <label><span>AI 执行确认</span><select value={approvalMode} onChange={(event) => { setApprovalMode(event.target.value as typeof approvalMode) }}><option value="unanimous">有执行权成员全员确认</option><option value="admin">群主或管理员确认</option><option value="auto">无冲突时自动执行</option></select></label>
                <label><span>静默等待（秒）</span><input type="number" min={5} max={120} value={quietSeconds} onChange={(event) => { setQuietSeconds(Number(event.target.value)) }} /></label>
              </div>
              <label className="diywx-new-session-switch"><input type="checkbox" checked={agentEnabled} onChange={(event) => { setAgentEnabled(event.target.checked) }} /><span><strong>创建后开启 Agent</strong><small>多人消息会先汇总、检查冲突，再按上方规则执行</small></span></label>
            </section>
          )}
        </div>

        {error !== null && <p className="diywx-new-session-error" role="alert">{error}</p>}
        <footer>
          <button type="button" disabled={busy} onClick={onClose}>取消</button>
          <button className="diywx-new-session-submit" type="button" disabled={busy} onClick={() => { void submit() }}>{busy ? '正在创建…' : '创建并进入'}</button>
        </footer>
      </section>
    </div>
  )
}
