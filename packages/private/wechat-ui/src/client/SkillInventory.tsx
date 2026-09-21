import { useEffect, useMemo, useState } from 'react'
import { Icon } from './icons.tsx'
import { insertSkillCommand } from './skillInstall.ts'
import type { SkillInstallResultView, SkillInventoryEntryView } from './types.ts'

interface SkillInventoryProps {
  cwd?: string
  sessionId?: string
  load: (cwd?: string, sessionId?: string) => Promise<readonly SkillInventoryEntryView[]>
  install?: (source: string) => Promise<SkillInstallResultView>
  onClose: () => void
}

const GROUP_ORDER = ['本机通用', '当前工作区', '内置', '运行时', '自定义目录', '其他'] as const

function groupOf(skill: SkillInventoryEntryView): string {
  return skill.sourceLabel === '' ? '其他' : skill.sourceLabel
}

export function SkillInventory({ cwd, sessionId, load, install, onClose }: SkillInventoryProps) {
  const [skills, setSkills] = useState<readonly SkillInventoryEntryView[]>([])
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [installing, setInstalling] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const refresh = async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try { setSkills(await load(cwd, sessionId)) }
    catch (reason) { setError(reason instanceof Error ? reason.message : '技能清单读取失败') }
    finally { setLoading(false) }
  }
  useEffect(() => { void refresh() }, [load, cwd, sessionId])

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    const matched = keyword === ''
      ? skills
      : skills.filter(skill => `${skill.name} ${skill.description} ${skill.whenToUse ?? ''} ${skill.sourceLabel}`.toLowerCase().includes(keyword))
    const groups = new Map<string, SkillInventoryEntryView[]>()
    for (const skill of matched) {
      const label = groupOf(skill)
      const bucket = groups.get(label) ?? []
      bucket.push(skill)
      groups.set(label, bucket)
    }
    return GROUP_ORDER.flatMap(label => {
      const items = groups.get(label)
      return items === undefined ? [] : [[label, items] as const]
    })
  }, [skills, query])

  const addSkill = async (): Promise<void> => {
    if (install === undefined || draft.trim() === '' || installing) return
    setInstalling(true)
    setError(null)
    setNotice(null)
    try {
      const installed = await install(draft.trim())
      setDraft('')
      setNotice(installed.created ? `已安装 ${installed.name}` : `已更新 ${installed.name}`)
      await refresh()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '技能安装失败')
    } finally {
      setInstalling(false)
    }
  }

  return (
    <div className="diywx-modal-backdrop diywx-skill-inventory-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="diywx-skill-inventory" role="dialog" aria-modal="true" aria-label="技能清单">
        <header>
          <span>
            <Icon name="skill" size={22} />
            <span>
              <strong>技能清单</strong>
              <small>技能是给 Agent 的说明书，不是插件。插件改程序；技能改做法。</small>
            </span>
          </span>
          <div>
            <button type="button" onClick={() => { void refresh() }}>刷新</button>
            <button type="button" aria-label="关闭技能清单" onClick={onClose}>×</button>
          </div>
        </header>
        <p className="diywx-skill-inventory-lead">
          装好后，直接用中文说需求，或输入 <code>/技能名</code>。把技能页上的安装提示发给任意会话，产品会写到本机 <code>~/.agents/skills</code>，不会执行 install.sh。
        </p>
        {install !== undefined && (
          <form
            className="diywx-skill-add"
            onSubmit={(event) => { event.preventDefault(); void addSkill() }}
          >
            <Icon name="spark" size={16} />
            <input
              value={draft}
              onChange={(event) => { setDraft(event.target.value) }}
              placeholder="粘贴技能链接或 SKILL.md，例如 https://aihot.news/aihot-skill/README.md"
              aria-label="技能安装来源"
            />
            <button type="submit" disabled={installing || draft.trim() === ''}>{installing ? '安装中…' : '安装'}</button>
          </form>
        )}
        <div className="diywx-skill-search"><Icon name="search" size={18} /><input value={query} onChange={(event) => { setQuery(event.target.value) }} placeholder="搜索技能名称或用途" /></div>
        {notice !== null && <div className="diywx-skill-notice" role="status">{notice}</div>}
        <div className="diywx-skill-scroll">
          {loading && <div className="diywx-skill-empty">正在读取已安装的技能…</div>}
          {error !== null && <div className="diywx-skill-error" role="alert">{error}</div>}
          {!loading && error === null && skills.length === 0 && (
            <div className="diywx-skill-empty">
              还没有技能。把 AIHOT 这类页面上的安装提示发给当前会话，或点上方粘贴链接。装好后会出现在这里，并带一段用途说明。
            </div>
          )}
          {!loading && error === null && filtered.map(([label, items]) => (
            <section key={label} className="diywx-skill-section">
              <div className="diywx-skill-section-title">
                <strong>{label}</strong>
                <span>{items.length} 个</span>
              </div>
              <div className="diywx-skill-grid">
                {items.map(skill => (
                  <article key={`${skill.source}:${skill.name}`}>
                    <div className="diywx-skill-card-head">
                      <span>{skill.name}</span>
                      <em>{skill.userInvocable ? `/${skill.name}` : '仅模型'}</em>
                    </div>
                    <p>{skill.description}</p>
                    {skill.whenToUse !== undefined && skill.whenToUse !== '' && <small>{skill.whenToUse}</small>}
                    <footer>
                      <button
                        type="button"
                        disabled={!skill.userInvocable}
                        onClick={() => { insertSkillCommand(skill.name); onClose() }}
                      >写入对话</button>
                      {skill.path !== undefined && <code title={skill.path}>{skill.path}</code>}
                    </footer>
                  </article>
                ))}
              </div>
            </section>
          ))}
          {!loading && error === null && skills.length > 0 && filtered.length === 0 && (
            <div className="diywx-skill-empty">没有找到匹配的技能</div>
          )}
        </div>
      </section>
    </div>
  )
}
