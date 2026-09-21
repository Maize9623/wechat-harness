import assert from 'node:assert/strict'
import test from 'node:test'
import {
  insertSkillInstallTeach,
  mergeSkillInventory,
  skillInstallSourceOf,
  skillInstallTeachBlock,
  skillSourceFromPath,
  skillSourceLabel,
  skillViewFromSessionEntry,
} from './skillInstall.ts'

test('skillInstallSourceOf accepts AIHOT prompts and SKILL.md, not casual mentions', () => {
  assert.equal(
    skillInstallSourceOf('请安装 AIHOT Skill：https://aihot.news/aihot-skill/README.md\n装完告诉我是否需要开启新会话。') !== undefined,
    true,
  )
  assert.equal(skillInstallSourceOf('https://aihot.news/aihot-skill/SKILL.md') !== undefined, true)
  assert.equal(skillInstallSourceOf('---\nname: demo-skill\ndescription: 演示\n---\n# Hi\n') !== undefined, true)
  assert.equal(skillInstallSourceOf('帮我写一个 skill，用来整理会议纪要'), undefined)
  assert.equal(skillInstallSourceOf('这个插件怎么装？https://example.com/plugin'), undefined)
})

test('skillInstallTeachBlock tells the model the skill is already on disk', () => {
  const block = skillInstallTeachBlock({
    name: 'aihot',
    description: '查询资讯',
    path: '/Users/me/.agents/skills/aihot/SKILL.md',
    files: ['SKILL.md'],
    created: true,
  })
  assert.match(block, /<<<DSH_DIY_SKILL_INSTALL>>>/)
  assert.match(block, /\/aihot/)
  assert.match(block, /不要再执行 install\.sh/)
  assert.match(block, /不是插件/)
})

test('insertSkillInstallTeach keeps the typed line after the user-message marker', () => {
  const wrapped = insertSkillInstallTeach(
    '<<<DSH_DIY_GLOBAL_RESPONSE_RULES>>>\n中文\n<<<END_DSH_DIY_GLOBAL_RESPONSE_RULES>>>\n<<<DSH_DIY_USER_MESSAGE>>>\n请安装这个技能',
    {
      name: 'aihot',
      description: '查询资讯',
      path: '/tmp/aihot/SKILL.md',
      files: ['SKILL.md'],
      created: true,
    },
  )
  assert.match(wrapped, /<<<DSH_DIY_SKILL_INSTALL>>>/)
  assert.ok(wrapped.indexOf('<<<DSH_DIY_SKILL_INSTALL>>>') < wrapped.indexOf('<<<DSH_DIY_USER_MESSAGE>>>'))
  assert.ok(wrapped.endsWith('请安装这个技能'))
})

test('skillSourceLabel distinguishes user skills from bundled skills', () => {
  assert.equal(skillSourceLabel('user-agents'), '本机通用')
  assert.equal(skillSourceLabel('bundled'), '内置')
  assert.equal(skillSourceLabel('project-dsh'), '当前工作区')
})

test('skillSourceFromPath classifies home skills separately from project skills', () => {
  assert.equal(skillSourceFromPath('/Users/gene/.agents/skills/aihot/SKILL.md'), 'user-agents')
  assert.equal(skillSourceFromPath('/Users/gene/Desktop/app/.agents/skills/local-note/SKILL.md'), 'project-agents')
  assert.equal(skillSourceFromPath('/tmp/runtime/office-skills/office-docx/SKILL.md'), 'bundled')
})

test('mergeSkillInventory keeps session home skills in front of bundled office skills', () => {
  const aihot = skillViewFromSessionEntry({
    name: 'aihot',
    description: '查询资讯',
    path: '/Users/gene/.agents/skills/aihot/SKILL.md',
    modelInvocable: true,
  })
  const office = {
    name: 'office-docx',
    description: 'Word',
    source: 'bundled',
    sourceLabel: '内置',
    modelInvocable: true,
    userInvocable: true,
  }
  const merged = mergeSkillInventory([aihot], [office, { ...aihot, description: 'host copy' }])
  assert.deepEqual(merged.map(skill => [skill.name, skill.sourceLabel, skill.description]), [
    ['aihot', '本机通用', '查询资讯'],
    ['office-docx', '内置', 'Word'],
  ])
})
