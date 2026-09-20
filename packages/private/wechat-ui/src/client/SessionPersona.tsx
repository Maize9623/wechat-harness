import { useEffect, useRef, useState, type DragEvent } from 'react'
import { fileDataTransfer, installDocumentFileDrop } from './dropFiles.ts'
import { Icon } from './icons.tsx'
import { importPersonaDocument, type ImportedPersona, type SessionPersona } from './persona.ts'

const MAX_IMPORT_BYTES = 512 * 1024

function isSupportedPersonaFile(file: File): boolean {
  return /\.(?:md|markdown|txt)$/iu.test(file.name)
}

function importedFields(value: ImportedPersona): string[] {
  return [
    value.name === undefined ? '' : '角色名称',
    value.goal === undefined ? '' : '长期目标',
    value.prompt === undefined ? '' : '通用提示词',
    value.skills === undefined ? '' : 'Skill 与工作规则',
    value.memory === undefined ? '' : '长期记忆',
  ].filter(Boolean)
}

const TEMPLATES: Array<{ id: string; label: string; value: Partial<SessionPersona> }> = [
  {
    id: 'assistant',
    label: 'AI 助理',
    value: {
      name: '我的 AI 助理',
      goal: '帮助我规划、执行并复盘日常工作；信息不足时先追问，不猜测关键条件。',
      prompt: '优先使用清晰、自然的中文。先给结论，再给必要步骤。主动识别下一步，但涉及外部影响或不可逆操作时先确认。',
    },
  },
  {
    id: 'product',
    label: '产品搭档',
    value: {
      name: '产品搭档',
      goal: '把模糊想法转成可验证的产品方案，并持续记录用户反馈、假设与决策。',
      prompt: '从普通用户视角检查体验。提出方案时包含目标、关键流程、边界、风险和验收标准。',
    },
  },
  {
    id: 'developer',
    label: '开发搭档',
    value: {
      name: '开发搭档',
      goal: '在当前工作区安全、可验证地完成开发任务。',
      prompt: '先理解现有代码和约束，再做最小可靠改动。完成后运行与风险相称的检查，并明确说明未验证部分。',
      skills: '涉及代码审查时使用已安装的审查 Skill；涉及界面时做真实页面验收；不要把本会话设定应用到其他会话。',
    },
  },
  {
    id: 'research',
    label: '研究助理',
    value: {
      name: '研究助理',
      goal: '建立可追溯的研究记录，区分事实、推断与待验证假设。',
      prompt: '需要实时或精确来源时先检索。引用尽量使用一手来源，并在结论旁标注依据。',
    },
  },
]

export function SessionPersonaDialog({ sessionTitle, value, onSave, onClose }: {
  sessionTitle: string
  value: SessionPersona
  onSave: (value: SessionPersona) => void
  onClose: () => void
}) {
  const [draft, setDraft] = useState(value)
  const [dragging, setDragging] = useState(false)
  const [importNotice, setImportNotice] = useState('')
  const [importError, setImportError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const patch = (value: Partial<SessionPersona>): void => { setDraft(current => ({ ...current, ...value })) }
  const importFile = async (file: File | undefined): Promise<void> => {
    setImportNotice('')
    setImportError('')
    if (file === undefined) return
    if (!isSupportedPersonaFile(file)) {
      setImportError('暂时只支持 .md、.markdown、.txt，以及名为 SKILL.md 的文字文件。')
      return
    }
    if (file.size > MAX_IMPORT_BYTES) {
      setImportError('文件不能超过 512 KB。请删去无关内容后再导入。')
      return
    }
    try {
      const imported = importPersonaDocument(file.name, await file.text())
      const fields = importedFields(imported)
      if (fields.length === 0) {
        setImportError('没有识别到可应用的人格、规则或记忆内容。')
        return
      }
      setDraft(current => ({ ...current, ...imported, enabled: true }))
      setImportNotice(`已从“${file.name}”识别：${fields.join('、')}。请检查后点击“保存并应用”。`)
    } catch {
      setImportError('读取文件失败，请确认它是 UTF-8 编码的文字文件后重试。')
    }
  }
  const onDrop = (event: DragEvent<HTMLElement>): void => {
    const data = fileDataTransfer(event)
    if (data === null) return
    event.preventDefault()
    setDragging(false)
    void importFile(data.files.item(0) ?? undefined)
  }
  useEffect(() => installDocumentFileDrop((files) => {
    setDragging(false)
    void importFile(files[0])
  }), [])
  return (
    <div
      className="diywx-modal-backdrop"
      role="presentation"
      onMouseDown={onClose}
      onDragOver={(event) => {
        const data = fileDataTransfer(event)
        if (data === null) return
        event.preventDefault()
        data.dropEffect = 'copy'
        setDragging(true)
      }}
      onDrop={onDrop}
    >
      <section
        className="diywx-persona-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="会话专属提示词与记忆"
        onMouseDown={(event) => { event.stopPropagation() }}
        onDragOver={(event) => {
          const data = fileDataTransfer(event)
          if (data === null) return
          event.preventDefault()
          data.dropEffect = 'copy'
          setDragging(true)
        }}
        onDrop={onDrop}
      >
        <header>
          <div>
            <span className="diywx-persona-mark"><Icon name="spark" size={18} /></span>
            <div><strong>会话人格与记忆</strong><small>仅应用于“{sessionTitle}”</small></div>
          </div>
          <button className="diywx-icon-button" type="button" aria-label="关闭" onClick={onClose}>×</button>
        </header>
        <div className="diywx-persona-scroll">
          <section className="diywx-persona-enable">
            <div><strong>启用会话专属设定</strong><small>关闭后保留内容，但发送消息时不再注入。</small></div>
            <label className="diywx-switch"><input type="checkbox" checked={draft.enabled} onChange={(event) => { patch({ enabled: event.target.checked }) }} /><span /></label>
          </section>
          <div className="diywx-persona-modes" role="group" aria-label="记忆模式">
            <button type="button" data-active={draft.mode === 'standard' || undefined} onClick={() => { patch({ mode: 'standard' }) }}><strong>普通模式</strong><small>固定提示词与规则</small></button>
            <button type="button" data-active={draft.mode === 'growth' || undefined} onClick={() => { patch({ mode: 'growth' }) }}><strong>顶级模式</strong><small>提示词 + 长期记忆 + 成长足迹</small></button>
          </div>
          <div className="diywx-persona-templates">
            <span>快速模板</span>
            <div>{TEMPLATES.map(template => <button key={template.id} type="button" onClick={() => { patch(template.value) }}>{template.label}</button>)}</div>
          </div>
          <section
            className="diywx-persona-import"
            data-dragging={dragging || undefined}
            onDragEnter={(event) => { event.preventDefault(); setDragging(true) }}
            onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; setDragging(true) }}
            onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false) }}
            onDrop={onDrop}
          >
            <span className="diywx-persona-import-mark"><Icon name="file" size={19} /></span>
            <div>
              <strong>导入会话设定</strong>
              <small>拖入人设 Markdown、TXT 或 SKILL.md，自动识别后填入下方字段。</small>
              {importNotice !== '' && <em data-kind="success">{importNotice}</em>}
              {importError !== '' && <em data-kind="error">{importError}</em>}
            </div>
            <button type="button" onClick={() => { inputRef.current?.click() }}>选择文件</button>
            <input
              ref={inputRef}
              type="file"
              accept=".md,.markdown,.txt,text/plain,text/markdown"
              onChange={(event) => {
                void importFile(event.target.files?.item(0) ?? undefined)
                event.target.value = ''
              }}
            />
          </section>
          <div className="diywx-persona-fields">
            <label><span>角色名称</span><input value={draft.name} maxLength={40} placeholder="例如：大白的 AI 助理" onChange={(event) => { patch({ name: event.target.value }) }} /></label>
            <label><span>长期目标</span><textarea value={draft.goal} rows={3} placeholder="它长期要帮你达成什么？" onChange={(event) => { patch({ goal: event.target.value }) }} /></label>
            <label><span>通用提示词</span><textarea value={draft.prompt} rows={5} placeholder="语气、工作方式、追问习惯、输出格式、边界……" onChange={(event) => { patch({ prompt: event.target.value }) }} /></label>
            <label><span>Skill 与工作规则</span><textarea value={draft.skills} rows={4} placeholder="写下允许或优先使用的 Skill，以及什么时候调用它们。每行一条更清楚。" onChange={(event) => { patch({ skills: event.target.value }) }} /></label>
            {draft.mode === 'growth' && (
              <>
                <label><span>长期记忆</span><textarea value={draft.memory} rows={5} placeholder="稳定偏好、背景、重要决策与长期约定。你可以随时修改。" onChange={(event) => { patch({ memory: event.target.value }) }} /></label>
                <section className="diywx-persona-growth">
                  <div>
                    <div><strong>自动成长足迹</strong><small>仅在这个会话中记录最近 20 条用户意图，注入最近 6 条。</small></div>
                    <label className="diywx-switch"><input type="checkbox" checked={draft.autoGrow} onChange={(event) => { patch({ autoGrow: event.target.checked }) }} /><span /></label>
                  </div>
                  <div className="diywx-growth-summary"><span>已积累 {draft.growth.length} 条</span><button type="button" disabled={draft.growth.length === 0} onClick={() => { patch({ growth: [] }) }}>清空成长足迹</button></div>
                </section>
              </>
            )}
          </div>
          <p className="diywx-persona-privacy">设定按会话 ID 保存在当前浏览器。导入文件只会在浏览器内按文字读取，不会安装 Skill、执行脚本或修改 ~/.dsh；注入内容不会显示在聊天气泡中，也不会自动应用到其他会话。</p>
        </div>
        <footer>
          <button type="button" onClick={onClose}>取消</button>
          <button className="diywx-persona-save" type="button" onClick={() => { onSave(draft); onClose() }}>保存并应用</button>
        </footer>
      </section>
    </div>
  )
}
