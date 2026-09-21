import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { installSkillFromSource, listInstalledSkills, parseSkillMarkdown, registerDiySkillRoute, skillSourceCandidates } from './skill-server.js'

const SAMPLE = `---
name: aihot
description: 查询 AIHOT 的中文 AI 资讯。
whenToUse: 用户问今天的 AI 新闻时
---

# AIHOT

见 [API 参考](references/api.md)。
`

function fakeCtx(skills) {
  let registered
  return {
    get: (name) => name === 'skills' ? skills : undefined,
    connection: {
      fetch: {
        register(route) {
          registered = route
          return () => {}
        },
      },
    },
    registered: () => registered,
  }
}

test('parseSkillMarkdown requires kebab-case name and a description', () => {
  assert.equal(parseSkillMarkdown('# no frontmatter'), undefined)
  assert.equal(parseSkillMarkdown('---\nname: Not Valid\ndescription: x\n---\n'), undefined)
  assert.deepEqual(parseSkillMarkdown(SAMPLE), {
    name: 'aihot',
    description: '查询 AIHOT 的中文 AI 资讯。',
    whenToUse: '用户问今天的 AI 新闻时',
    markdown: SAMPLE,
  })
})

test('GET lists registry skills with Chinese source labels', async () => {
  const empty = await mkdtemp(join(tmpdir(), 'dsh-skill-empty-'))
  const ctx = fakeCtx({
    list: async () => [{
      name: 'office-docx',
      description: 'Word',
      source: 'bundled',
      invocation: { modelInvocable: true, userInvocable: true },
      path: '/tmp/office-docx/SKILL.md',
    }],
  })
  try {
    registerDiySkillRoute(ctx, { userAgentsRoot: empty, userDshRoot: empty })
    const response = await ctx.registered().fetch(new Request('http://127.0.0.1/api/diy-skills?cwd=/tmp/project'))
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), {
      ok: true,
      skills: [{
        name: 'office-docx',
        description: 'Word',
        source: 'bundled',
        sourceLabel: '内置',
        path: '/tmp/office-docx/SKILL.md',
        modelInvocable: true,
        userInvocable: true,
      }],
    })
  } finally {
    await rm(empty, { recursive: true, force: true })
  }
})

test('listInstalledSkills unions on-disk user skills with the host registry', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-skill-merge-'))
  const empty = await mkdtemp(join(tmpdir(), 'dsh-skill-dsh-'))
  const project = await mkdtemp(join(tmpdir(), 'dsh-skill-project-'))
  try {
    await mkdir(join(root, 'aihot'), { recursive: true })
    await writeFile(join(root, 'aihot', 'SKILL.md'), SAMPLE)
    await mkdir(join(project, '.agents', 'skills', 'local-note'), { recursive: true })
    await writeFile(join(project, '.agents', 'skills', 'local-note', 'SKILL.md'), `---
name: local-note
description: 当前工作区笔记技能。
---

# local-note
`)
    const listed = await listInstalledSkills({
      cwd: project,
      userAgentsRoot: root,
      userDshRoot: empty,
      skills: {
        list: async () => [{
          name: 'office-xlsx',
          description: 'Excel',
          source: 'bundled',
          invocation: { modelInvocable: true, userInvocable: true },
          path: '/tmp/office-xlsx/SKILL.md',
        }],
      },
    })
    assert.deepEqual(listed.map(skill => [skill.name, skill.sourceLabel]), [
      ['local-note', '当前工作区'],
      ['aihot', '本机通用'],
      ['office-xlsx', '内置'],
    ])
    assert.match(listed.find(skill => skill.name === 'aihot')?.description ?? '', /AIHOT/u)
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(empty, { recursive: true, force: true })
    await rm(project, { recursive: true, force: true })
  }
})

test('POST installs from pasted SKILL.md and from a README URL without running scripts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-skill-install-'))
  const files = new Map([
    ['https://aihot.news/aihot-skill/README.md', '# readme\n'],
    ['https://aihot.news/aihot-skill/SKILL.md', SAMPLE],
    ['https://aihot.news/aihot-skill/references/api.md', '# api\n'],
    ['https://aihot.news/aihot-skill/install.sh', '#!/bin/sh\necho pwned\n'],
  ])
  const fetchImpl = async (url) => {
    const body = files.get(url)
    if (body === undefined) return new Response('missing', { status: 404 })
    return new Response(body, { headers: { 'content-type': 'text/markdown' } })
  }
  try {
    const fromMarkdown = await installSkillFromSource(SAMPLE, { fetch: fetchImpl, root })
    assert.equal(fromMarkdown.name, 'aihot')
    assert.equal(fromMarkdown.created, true)
    assert.equal(parseSkillMarkdown(await readFile(join(root, 'aihot', 'SKILL.md'), 'utf8'))?.name, 'aihot')

    const fromUrl = await installSkillFromSource(
      '请安装 AIHOT Skill：https://aihot.news/aihot-skill/README.md\n装完告诉我是否需要开启新会话。',
      { fetch: fetchImpl, root },
    )
    assert.equal(fromUrl.created, false)
    assert.deepEqual(fromUrl.files.includes('references/api.md'), true)
    assert.equal(fromUrl.files.includes('install.sh'), false)
    await assert.rejects(readFile(join(root, 'aihot', 'install.sh')), /ENOENT/)
    assert.equal(await readFile(join(root, 'aihot', 'references', 'api.md'), 'utf8'), '# api\n')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('POST rejects empty source and file URLs', async () => {
  const ctx = fakeCtx()
  registerDiySkillRoute(ctx, { fetch: async () => new Response('no', { status: 404 }) })
  const empty = await ctx.registered().fetch(new Request('http://127.0.0.1/api/diy-skills', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ source: '   ' }),
  }))
  assert.equal(empty.status, 400)
  const fileUrl = await ctx.registered().fetch(new Request('http://127.0.0.1/api/diy-skills', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ source: 'file:///etc/passwd' }),
  }))
  assert.equal(fileUrl.status, 400)
  assert.match((await fileUrl.json()).error, /http\(s\)|技能链接|SKILL\.md/u)
})

test('listInstalledSkills falls back to an empty disk scan when the registry is absent', async () => {
  const empty = await mkdtemp(join(tmpdir(), 'dsh-skill-absent-'))
  try {
    const listed = await listInstalledSkills({ userAgentsRoot: empty, userDshRoot: empty })
    assert.deepEqual(listed, [])
  } finally {
    await rm(empty, { recursive: true, force: true })
  }
})

test('README skill prompts resolve SKILL.md without inventing README.md/SKILL.md', () => {
  const candidates = skillSourceCandidates('https://aihot.news/aihot-skill/README.md')
  assert.deepEqual(candidates.includes('https://aihot.news/aihot-skill/SKILL.md'), true)
  assert.deepEqual(candidates.includes('https://aihot.news/aihot-skill/README.md'), true)
  assert.equal(candidates.some(url => url.includes('README.md/SKILL.md')), false)
})

test('install writes --actor and does not treat a later 404 as the only error', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-skill-actor-'))
  const fetchImpl = async (url) => {
    if (url === 'https://aihot.news/aihot-skill/SKILL.md') {
      return new Response(SAMPLE, { headers: { 'content-type': 'text/markdown' } })
    }
    return new Response('missing', { status: 404 })
  }
  try {
    const installed = await installSkillFromSource(
      '请安装 AIHOT Skill：https://aihot.news/aihot-skill/README.md\n安装器支持时请追加：--actor 8500da60b0-e47a-45e7-9a10-3b205f09fba2',
      { fetch: fetchImpl, root },
    )
    assert.equal(installed.name, 'aihot')
    assert.equal(await readFile(join(root, 'aihot', '.aihot-actor-id'), 'utf8'), '8500da60b0-e47a-45e7-9a10-3b205f09fba2\n')
    await assert.rejects(
      installSkillFromSource('https://example.com/missing/README.md', { fetch: fetchImpl, root }),
      /读不到技能文件|也可以把 SKILL\.md/u,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
