/** Host plugin: WeChat Desktop file/service/schedule routes plus the 3191 group-chat sidecar. */

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { CollaborationServer } from './collab/server.js'
import { DiyFileServer } from './file-server.js'
import { ConversationScheduler } from './scheduler.js'
import { DiyServiceServer, DshServiceManager } from './services.js'
import { registerDiyUsageRoute } from './usage-server.js'
import { registerDiyModelAccessRoute } from './model-access-server.js'
import { registerDiyCollabEntryRoute } from './collab-entry-server.js'
import { browseRoutes } from './browse-server.js'

export const name = 'wechat-host'
export const inject = ['webServer', 'credentials', 'connection']

function harnessRpc(baseUrl) {
  return {
    sessions: {
      async prompt(request) {
        const payload = request.payload ?? request
        const response = await fetch(`${baseUrl}/api/session.prompt`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            type: 'client-request',
            rpcId: request.rpcId ?? `wechat-schedule-${Date.now()}`,
            method: 'session.prompt',
            payload,
          }),
        })
        return await response.json()
      },
    },
  }
}

function registerRoutes(ctx, routes) {
  for (const route of routes) {
    ctx.effect(() => ctx.webServer.register(route), `wechat-host: ${route.path}`)
  }
}

/**
 * Mount WeChat host routes on the official Desktop web server and start the
 * isolated group-chat sidecar on 3191. Never binds 3080 or 3091.
 */
export function apply(ctx, config = {}) {
  const home = resolveDshHome()
  const filesDir = join(home, 'wechat-files')
  const scheduleDir = join(home, 'wechat-schedules')
  const collabDir = join(home, 'wechat-collab')
  const sandboxDir = join(collabDir, 'sandbox')
  mkdirSync(filesDir, { recursive: true, mode: 0o700 })
  mkdirSync(scheduleDir, { recursive: true, mode: 0o700 })
  mkdirSync(sandboxDir, { recursive: true, mode: 0o700 })

  const harnessUrl = String(config.harnessUrl ?? 'http://127.0.0.1:19387')
  const manager = new DshServiceManager(ctx)
  registerRoutes(ctx, new DiyServiceServer(manager, ctx).routes())
  registerRoutes(ctx, new DiyFileServer(filesDir, ctx).routes())
  registerDiyUsageRoute(ctx)
  registerDiyModelAccessRoute(ctx)
  registerRoutes(ctx, browseRoutes(ctx))

  const scheduler = new ConversationScheduler(harnessRpc(harnessUrl), scheduleDir, console, ctx)
  scheduler.start()
  registerRoutes(ctx, scheduler.routes())
  ctx.effect(() => () => { scheduler.stop() }, 'wechat-host: scheduler')

  const collab = new CollaborationServer({
    host: config.collabHost ?? '0.0.0.0',
    port: Number(config.collabPort ?? 3191),
    harnessUrl,
    dataDir: collabDir,
    allowHarnessExecution: config.allowHarnessExecution !== false,
    allowedWorkspaces: [{ id: 'default', path: sandboxDir, label: '默认协作空间' }],
  }, console, manager)

  registerDiyCollabEntryRoute(ctx, () => collab.entryView())

  ctx.effect(() => {
    void collab.start().catch(cause => {
      console.warn('[wechat-host] 群聊入口未启动（本机聊天仍可用）', cause)
    })
    return () => { void collab.stop() }
  }, 'wechat-host: collab')
}
