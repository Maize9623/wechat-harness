import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { decodeUploadedFiles, extractUploadedFile, FILE_BODY_LIMIT } from './file-attachments.js'
import { connectionRejection } from './http-trust.js'

const API_PREFIX = '/api/diy-files'

function json(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(value))
}

async function readJson(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk)
    size += buffer.length
    if (size > FILE_BODY_LIMIT) throw new Error('请求内容过大')
    chunks.push(buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function contentDisposition(name) {
  return `attachment; filename*=UTF-8''${encodeURIComponent(name)}`
}

export class DiyFileServer {
  constructor(dataDir, ctx) {
    this.dataDir = dataDir
    this.ctx = ctx
    mkdirSync(this.dataDir, { recursive: true, mode: 0o700 })
  }

  routes() {
    return [{
      kind: 'prefix', path: API_PREFIX,
      handler: async (req, res) => {
        const rejection = connectionRejection(this.ctx, req)
        if (rejection !== undefined) return json(res, rejection, { ok: false, error: rejection === 401 ? 'unauthorized' : 'forbidden' })
        const url = new URL(req.url ?? '', `http://${req.headers.host ?? '127.0.0.1'}`)
        if (req.method === 'POST' && url.pathname === API_PREFIX) {
          try {
            const files = decodeUploadedFiles((await readJson(req)).files).map(file => {
              const id = `file_${randomUUID().replaceAll('-', '')}`
              const extracted = extractUploadedFile(file)
              const metadata = {
                id, name: file.name, mediaType: file.mediaType, size: file.bytes.length,
                extractedCharacters: extracted.text.length, truncated: extracted.truncated,
              }
              writeFileSync(join(this.dataDir, `${id}.bin`), file.bytes, { mode: 0o600 })
              writeFileSync(join(this.dataDir, `${id}.txt`), extracted.text, { mode: 0o600 })
              writeFileSync(join(this.dataDir, `${id}.json`), JSON.stringify(metadata), { mode: 0o600 })
              return { ...metadata, extractedText: extracted.text }
            })
            return json(res, 200, { ok: true, files })
          } catch (cause) {
            return json(res, 400, { ok: false, error: cause instanceof Error ? cause.message : '文件读取失败' })
          }
        }
        const match = /^\/api\/diy-files\/(file_[a-f0-9]{32})$/u.exec(url.pathname)
        if (req.method === 'GET' && match) {
          const id = match[1]
          const metaPath = join(this.dataDir, `${id}.json`)
          const filePath = join(this.dataDir, `${id}.bin`)
          if (!existsSync(metaPath) || !existsSync(filePath)) return json(res, 404, { ok: false, error: '附件不存在' })
          const metadata = JSON.parse(readFileSync(metaPath, 'utf8'))
          const bytes = readFileSync(filePath)
          res.writeHead(200, {
            'content-type': metadata.mediaType || 'application/octet-stream',
            'content-length': bytes.length,
            'content-disposition': contentDisposition(metadata.name || '附件'),
            'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff',
          })
          res.end(bytes)
          return
        }
        json(res, 404, { ok: false, error: '接口不存在' })
      },
    }]
  }
}
