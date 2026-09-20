import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  dockPersistentAppToAdd,
  dockPersistentAppUpdates,
  dockTileIsDevelopmentElectron,
  launcherHasElectronFramework,
  retargetDockPersistentApps,
  syncDevelopmentLauncherApp,
  writeDevelopmentLauncherScript,
} from '../scripts/brand-development-electron.ts'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('writeDevelopmentLauncherScript', () => {
  it('writes a Dock script that starts Electron with the development app path', () => {
    const root = mkdtempSync(join(tmpdir(), 'wechat-harness-script-'))
    dirs.push(root)
    const appRoot = join(root, 'WeChat Harness.app')
    mkdirSync(join(appRoot, 'Contents', 'MacOS'), { recursive: true })
    mkdirSync(join(appRoot, 'Contents', 'Resources', 'app'), { recursive: true })
    writeFileSync(join(appRoot, 'Contents', 'MacOS', 'Electron'), 'binary')
    writeFileSync(join(appRoot, 'Contents', 'Resources', 'app', 'main.cjs'), 'stale')
    const script = writeDevelopmentLauncherScript(appRoot, {
      appRoot: '/repo/apps/desktop',
      home: '/repo/home',
      userData: '/repo/user-data',
    })
    const text = readFileSync(script, 'utf8')
    const config = JSON.parse(readFileSync(join(appRoot, 'Contents', 'Resources', 'wechat-harness-dev.json'), 'utf8')) as {
      appRoot: string
      home: string
    }
    expect(text).toContain('#!/bin/sh')
    expect(text).toContain(JSON.stringify(join(appRoot, 'Contents', 'MacOS', 'Electron')))
    expect(text).toContain('"/repo/apps/desktop"')
    expect(text).not.toContain('default_app')
    expect(config).toEqual({
      appRoot: '/repo/apps/desktop',
      home: '/repo/home',
      userData: '/repo/user-data',
    })
    expect(() => readFileSync(join(appRoot, 'Contents', 'Resources', 'app', 'main.cjs'))).toThrow()
  })
})

describe('retargetDockPersistentApps', () => {
  it('replaces the shared Electron tile and leaves other apps alone', () => {
    const apps = [
      { 'tile-data': { 'bundle-identifier': 'com.tencent.xinWeChat', 'file-label': '微信' } },
      {
        'tile-data': {
          'bundle-identifier': 'com.github.Electron',
          'file-label': 'WeChat Harness',
          'file-data': { _CFURLString: 'file:///tmp/electron/dist/WeChat%20Harness.app/', _CFURLStringType: 15 },
          book: 1,
        },
      },
    ]
    expect(dockTileIsDevelopmentElectron(apps[1]?.['tile-data'])).toBe(true)
    expect(dockTileIsDevelopmentElectron({
      'bundle-identifier': 'com.github.Electron',
      'file-label': 'Electrotron',
    })).toBe(true)
    expect(dockTileIsDevelopmentElectron({
      'bundle-identifier': 'com.tencent.xinWeChat',
      'file-label': '微信',
    })).toBe(false)
    expect(retargetDockPersistentApps(apps, 'file:///Users/gene/Applications/WeChat%20Harness.app/')).toBe(true)
    expect(apps[0]?.['tile-data']?.['bundle-identifier']).toBe('com.tencent.xinWeChat')
    expect(apps[1]?.['tile-data']).toMatchObject({
      'bundle-identifier': 'ai.ainfinity.wechat-harness',
      'file-label': 'WeChat Harness',
      'file-data': { _CFURLString: 'file:///Users/gene/Applications/WeChat%20Harness.app/', _CFURLStringType: 15 },
    })
    expect(apps[1]?.['tile-data']?.book).toBeUndefined()
    expect(dockPersistentAppUpdates(apps, 'file:///Users/gene/Applications/WeChat%20Harness.app/')).toEqual({
      1: {
        'bundle-identifier': 'ai.ainfinity.wechat-harness',
        'file-label': 'WeChat Harness',
        'file-data': { _CFURLString: 'file:///Users/gene/Applications/WeChat%20Harness.app/', _CFURLStringType: 15 },
      },
    })
    expect(dockPersistentAppToAdd(apps, 'file:///Users/gene/Applications/WeChat%20Harness.app/')).toBeUndefined()
    expect(dockPersistentAppToAdd(
      [{ 'tile-data': { 'bundle-identifier': 'com.tencent.xinWeChat', 'file-label': '微信' } }],
      'file:///Users/gene/Applications/WeChat%20Harness.app/',
    )).toEqual({
      'bundle-identifier': 'ai.ainfinity.wechat-harness',
      'file-label': 'WeChat Harness',
      'file-data': { _CFURLString: 'file:///Users/gene/Applications/WeChat%20Harness.app/', _CFURLStringType: 15 },
      'file-type': 41,
    })
  })
})

describe('syncDevelopmentLauncherApp', () => {
  it('copies Electron.app into a real product bundle', () => {
    const root = mkdtempSync(join(tmpdir(), 'wechat-harness-launcher-'))
    dirs.push(root)
    const sourceApp = join(root, 'Electron.app')
    mkdirSync(join(sourceApp, 'Contents', 'MacOS'), { recursive: true })
    mkdirSync(join(sourceApp, 'Contents', 'Resources'), { recursive: true })
    mkdirSync(join(sourceApp, 'Contents', 'Frameworks', 'Electron Framework.framework'), { recursive: true })
    writeFileSync(join(sourceApp, 'Contents', 'MacOS', 'Electron'), 'binary')
    writeFileSync(join(sourceApp, 'Contents', 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
	<key>CFBundleExecutable</key><string>Electron</string>
	<key>CFBundleIdentifier</key><string>com.github.Electron</string>
</dict></plist>
`)
    const launcher = join(root, 'WeChat Harness.app')
    syncDevelopmentLauncherApp(sourceApp, launcher)
    expect(launcherHasElectronFramework(launcher)).toBe(true)
    expect(readFileSync(join(launcher, 'Contents', 'MacOS', 'Electron'), 'utf8')).toBe('binary')
  })
})
