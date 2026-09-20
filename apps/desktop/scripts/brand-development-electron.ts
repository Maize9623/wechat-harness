/** Clone development Electron into a real WeChat Harness.app so Dock keeps that identity. */

import {
  chmodSync,
  closeSync,
  copyFileSync,
  existsSync,
  openSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readSync,
  realpathSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'

const PRODUCT_NAME = 'WeChat Harness'
const PRODUCT_BUNDLE_ID = 'ai.ainfinity.wechat-harness'
const ICON_FILE = 'wechat-harness'
const USER_LAUNCHER_EXECUTABLE = 'WeChatHarness'
const STOCK_BUNDLE_ID = 'com.github.Electron'
const LSREGISTER = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister'
const SOURCE_STAMP = 'wechat-harness-source.json'

/** Paths the Dock-launched stub uses to reopen the same development Desktop. */
export interface DevelopmentElectronBrand {
  readonly appRoot: string
  readonly home: string
  readonly userData: string
}

function bundleRoot(electronExecutable: string): string | undefined {
  const appRoot = electronExecutable.replace(/\/Contents\/MacOS\/[^/]+$/u, '')
  return appRoot.endsWith('.app') && existsSync(join(appRoot, 'Contents', 'Info.plist')) ? appRoot : undefined
}

function writeBundleName(appRoot: string): void {
  const plist = join(appRoot, 'Contents', 'Info.plist')
  execFileSync('plutil', ['-replace', 'CFBundleName', '-string', PRODUCT_NAME, plist])
  execFileSync('plutil', ['-replace', 'CFBundleDisplayName', '-string', PRODUCT_NAME, plist])
  execFileSync('plutil', ['-replace', 'CFBundleIdentifier', '-string', PRODUCT_BUNDLE_ID, plist])
  execFileSync('plutil', ['-replace', 'CFBundleExecutable', '-string', USER_LAUNCHER_EXECUTABLE, plist])
}

interface DockFileData {
  _CFURLString?: string
  _CFURLStringType?: number
}

interface DockTileData {
  'bundle-identifier'?: string
  'file-label'?: string
  'file-data'?: DockFileData
  'file-type'?: number
  book?: unknown
  'file-mod-date'?: unknown
  'parent-mod-date'?: unknown
}

interface DockPersistentApp {
  'tile-data'?: DockTileData
}

/**
 * True when a Dock tile is the development Electron stand-in, including the
 * shared `com.github.Electron` id that also matches other local Electron apps.
 * @param tile - One `persistent-apps` tile-data object.
 */
export function dockTileIsDevelopmentElectron(tile: DockTileData | undefined): boolean {
  if (tile === undefined) return false
  const identifier = tile['bundle-identifier'] ?? ''
  const label = tile['file-label'] ?? ''
  const fileUrl = tile['file-data']?._CFURLString ?? ''
  return identifier === PRODUCT_BUNDLE_ID
    || label === PRODUCT_NAME
    || label === 'WechatHarness'
    || label === 'Electrotron'
    || fileUrl.includes('WeChat%20Harness.app')
    || fileUrl.includes('electron/dist/Electron.app')
    || identifier === STOCK_BUNDLE_ID && (label === 'Electron' || fileUrl.includes('electron/dist'))
}

/**
 * Point a Dock tile at the user Applications launcher.
 * @param fileUrl - `file://` URL of `~/Applications/WeChat Harness.app`.
 */
export function dockLauncherTileData(fileUrl: string): DockTileData {
  return {
    'bundle-identifier': PRODUCT_BUNDLE_ID,
    'file-label': PRODUCT_NAME,
    'file-data': { _CFURLString: fileUrl, _CFURLStringType: 15 },
  }
}

/**
 * Replace colliding Electron Dock tiles with the stable launcher.
 * @param persistentApps - `persistent-apps` array from the Dock plist.
 * @param fileUrl - `file://` URL of the user Applications launcher.
 * @returns whether any tile changed.
 */
export function retargetDockPersistentApps(persistentApps: DockPersistentApp[], fileUrl: string): boolean {
  let changed = false
  for (const item of persistentApps) {
    if (!dockTileIsDevelopmentElectron(item['tile-data'])) continue
    item['tile-data'] = { ...item['tile-data'], ...dockLauncherTileData(fileUrl) }
    delete item['tile-data'].book
    delete item['tile-data']['file-mod-date']
    delete item['tile-data']['parent-mod-date']
    changed = true
  }
  return changed
}

/**
 * Keep a WeChat Harness Dock tile when quit removed the running Electron icon.
 * @param persistentApps - `persistent-apps` array from the Dock plist.
 * @param fileUrl - `file://` URL of the user Applications launcher.
 * @returns tile fields to append, or undefined when a tile already exists.
 */
export function dockPersistentAppToAdd(
  persistentApps: DockPersistentApp[],
  fileUrl: string,
): DockTileData | undefined {
  if (persistentApps.some(item => dockTileIsDevelopmentElectron(item['tile-data']))) return undefined
  return { ...dockLauncherTileData(fileUrl), 'file-type': 41 }
}

function launcherFileUrl(appRoot: string): string {
  const url = pathToFileURL(appRoot).href
  return url.endsWith('/') ? url : `${url}/`
}

/**
 * True when `appRoot` is a copied Electron bundle rather than a thin wrapper.
 * @param appRoot - Candidate `.app` directory.
 */
export function launcherHasElectronFramework(appRoot: string): boolean {
  return existsSync(join(appRoot, 'Contents', 'Frameworks', 'Electron Framework.framework'))
}

function readSourceStamp(launcher: string): string | undefined {
  const stamp = join(launcher, 'Contents', 'Resources', SOURCE_STAMP)
  if (!existsSync(stamp)) return undefined
  try {
    const parsed = JSON.parse(readFileSync(stamp, 'utf8')) as { source?: string }
    return typeof parsed.source === 'string' ? parsed.source : undefined
  } catch (stampError) {
    void stampError
    return undefined
  }
}

function copyAppBundle(source: string, launcher: string): void {
  mkdirSync(dirname(launcher), { recursive: true })
  try {
    execFileSync('cp', ['-cR', source, launcher])
  } catch (cloneError) {
    void cloneError
    execFileSync('cp', ['-R', source, launcher])
  }
}

function fileStartsWithShebang(path: string): boolean {
  const fd = openSync(path, 'r')
  try {
    const head = Buffer.alloc(2)
    return readSync(fd, head, 0, 2, 0) === 2 && head.toString('utf8') === '#!'
  } finally {
    closeSync(fd)
  }
}

function restoreElectronBinaryName(appRoot: string): void {
  const macos = join(appRoot, 'Contents', 'MacOS')
  const electron = join(macos, 'Electron')
  const renamed = join(macos, USER_LAUNCHER_EXECUTABLE)
  if (existsSync(electron) || !existsSync(renamed) || fileStartsWithShebang(renamed)) return
  renameSync(renamed, electron)
}

/**
 * Copy `Electron.app` to a real product-named bundle. A symlink still resolves
 * to `Electron.app`, so Dock shows Electron after quit.
 * @param sourceApp - Stock `Electron.app`.
 * @param launcher - Destination `WeChat Harness.app`.
 * @returns `launcher`.
 */
export function syncDevelopmentLauncherApp(sourceApp: string, launcher: string): string {
  const source = realpathSync(sourceApp)
  if (existsSync(launcher)) {
    if (lstatSync(launcher).isSymbolicLink()) unlinkSync(launcher)
    else if (!launcherHasElectronFramework(launcher) || readSourceStamp(launcher) !== source) {
      rmSync(launcher, { recursive: true, force: true })
    } else {
      restoreElectronBinaryName(launcher)
      if (!existsSync(join(launcher, 'Contents', 'MacOS', 'Electron'))) {
        rmSync(launcher, { recursive: true, force: true })
      }
    }
  }
  if (!existsSync(launcher)) copyAppBundle(source, launcher)
  writeFileSync(join(launcher, 'Contents', 'Resources', SOURCE_STAMP), `${JSON.stringify({ source })}\n`)
  return launcher
}

function restoreStockElectronIdentity(appRoot: string): void {
  const plist = join(appRoot, 'Contents', 'Info.plist')
  execFileSync('plutil', ['-replace', 'CFBundleName', '-string', 'Electron', plist])
  execFileSync('plutil', ['-replace', 'CFBundleDisplayName', '-string', 'Electron', plist])
  execFileSync('plutil', ['-replace', 'CFBundleIdentifier', '-string', STOCK_BUNDLE_ID, plist])
  execFileSync('plutil', ['-replace', 'CFBundleExecutable', '-string', 'Electron', plist])
  const resources = join(appRoot, 'Contents', 'Resources')
  if (existsSync(join(resources, 'electron.icns'))) {
    execFileSync('plutil', ['-replace', 'CFBundleIconFile', '-string', 'electron', plist])
  }
  rmSync(join(resources, 'app'), { recursive: true, force: true })
  rmSync(join(resources, `${ICON_FILE}.icns`), { force: true })
}

function registerLauncher(launcher: string, unregister: readonly string[]): void {
  for (const app of unregister) {
    try {
      execFileSync(LSREGISTER, ['-u', app])
    } catch (unregisterError) {
      void unregisterError
    }
  }
  try {
    execFileSync(LSREGISTER, ['-f', launcher])
  } catch (launchServicesError) {
    void launchServicesError
  }
}

const READ_DOCK_PERSISTENT_APPS = `
import json, plistlib, sys
with open(sys.argv[1], "rb") as handle:
    dock = plistlib.load(handle)
out = []
for item in dock.get("persistent-apps") or []:
    tile = item.get("tile-data") or {}
    file_data = tile.get("file-data") or {}
    out.append({
        "tile-data": {
            "bundle-identifier": tile.get("bundle-identifier"),
            "file-label": tile.get("file-label"),
            "file-data": {
                "_CFURLString": file_data.get("_CFURLString"),
                "_CFURLStringType": file_data.get("_CFURLStringType"),
            },
        }
    })
print(json.dumps(out))
`

const WRITE_DOCK_PERSISTENT_APPS = `
import json, plistlib, sys
path = sys.argv[1]
updates = json.loads(sys.argv[2])
with open(path, "rb") as handle:
    dock = plistlib.load(handle)
apps = dock.get("persistent-apps") or []
changed = False
for index_text, tile in updates.items():
    index = int(index_text)
    if index < 0 or index >= len(apps):
        continue
    data = apps[index].setdefault("tile-data", {})
    data["bundle-identifier"] = tile["bundle-identifier"]
    data["file-label"] = tile["file-label"]
    data["file-data"] = tile["file-data"]
    data.pop("book", None)
    data.pop("file-mod-date", None)
    data.pop("parent-mod-date", None)
    changed = True
append = json.loads(sys.argv[3]) if len(sys.argv) > 3 else None
if append is not None:
    apps.append({"tile-type": "file-tile", "tile-data": append})
    changed = True
if not changed:
    sys.exit(2)
with open(path, "wb") as handle:
    plistlib.dump(dock, handle, fmt=plistlib.FMT_BINARY)
`

/**
 * Map colliding Dock tiles to the stable launcher fields.
 * @param persistentApps - `persistent-apps` array from the Dock plist.
 * @param fileUrl - `file://` URL of the user Applications launcher.
 * @returns index-to-tile map for the plist writer.
 */
export function dockPersistentAppUpdates(
  persistentApps: DockPersistentApp[],
  fileUrl: string,
): Record<string, DockTileData> {
  const updates: Record<string, DockTileData> = {}
  persistentApps.forEach((item, index) => {
    if (!dockTileIsDevelopmentElectron(item['tile-data'])) return
    updates[String(index)] = dockLauncherTileData(fileUrl)
  })
  return updates
}

function retargetUserDock(launcherApp: string): void {
  const dockPlist = join(homedir(), 'Library/Preferences/com.apple.dock.plist')
  if (!existsSync(dockPlist)) return
  let listed: DockPersistentApp[]
  try {
    listed = JSON.parse(execFileSync('/usr/bin/python3', ['-c', READ_DOCK_PERSISTENT_APPS, dockPlist], {
      encoding: 'utf8',
    })) as DockPersistentApp[]
  } catch (readError) {
    void readError
    return
  }
  const fileUrl = launcherFileUrl(launcherApp)
  const updates = dockPersistentAppUpdates(listed, fileUrl)
  const append = dockPersistentAppToAdd(listed, fileUrl)
  if (Object.keys(updates).length === 0 && append === undefined) return
  try {
    const args = ['-c', WRITE_DOCK_PERSISTENT_APPS, dockPlist, JSON.stringify(updates)]
    if (append !== undefined) args.push(JSON.stringify(append))
    execFileSync('/usr/bin/python3', args)
    execFileSync('killall', ['Dock'])
  } catch (writeError) {
    void writeError
  }
}

/**
 * Write a Dock executable that starts the cloned Electron in development mode.
 * A `Resources/app` folder would make Electron treat the copy as packaged.
 * @param appRoot - Product-named `.app` bundle.
 * @param brand - last successful development launch paths.
 * @returns Absolute launcher script path.
 */
export function writeDevelopmentLauncherScript(appRoot: string, brand: DevelopmentElectronBrand): string {
  const macos = join(appRoot, 'Contents', 'MacOS')
  const resources = join(appRoot, 'Contents', 'Resources')
  restoreElectronBinaryName(appRoot)
  const electron = join(macos, 'Electron')
  const script = join(macos, USER_LAUNCHER_EXECUTABLE)
  writeFileSync(script, `#!/bin/sh
export DSH_HOME=${JSON.stringify(brand.home)}
export DSH_DESKTOP_OPEN_DEVTOOLS="\${DSH_DESKTOP_OPEN_DEVTOOLS:-0}"
exec ${JSON.stringify(electron)} "$@" --user-data-dir=${JSON.stringify(brand.userData)} ${JSON.stringify(brand.appRoot)}
`)
  chmodSync(script, 0o755)
  writeFileSync(join(resources, 'wechat-harness-dev.json'), `${JSON.stringify({
    appRoot: brand.appRoot,
    home: brand.home,
    userData: brand.userData,
  }, undefined, 2)}\n`)
  rmSync(join(resources, 'app'), { recursive: true, force: true })
  return script
}

function firstPng(directory: string): string | undefined {
  return readdirSync(directory).find(name => name.toLowerCase().endsWith('.png'))
}

/**
 * Rasterize the original blue bubble so Dock and `setIcon` share one artwork file.
 * @param desktopResources - `apps/desktop/resources`.
 * @returns absolute PNG path, or undefined when conversion is unavailable.
 */
export function ensureProductIconPng(desktopResources: string): string | undefined {
  const png = join(desktopResources, 'icon.png')
  if (existsSync(png)) return png
  const svg = join(desktopResources, 'icon.svg')
  if (!existsSync(svg)) return undefined
  const work = join(tmpdir(), 'wechat-harness-icon-png')
  mkdirSync(work, { recursive: true })
  try {
    execFileSync('qlmanage', ['-t', '-s', '1024', '-o', work, svg], { stdio: 'ignore' })
  } catch (qlError) {
    void qlError
    return undefined
  }
  const generatedName = firstPng(work)
  if (generatedName === undefined) return undefined
  const generated = join(work, generatedName)
  try {
    execFileSync('sips', ['-s', 'format', 'png', generated, '--out', png], { stdio: 'ignore' })
  } catch (sipsError) {
    void sipsError
    return existsSync(generated) ? generated : undefined
  }
  return existsSync(png) ? png : generated
}

/**
 * Install the original blue bubble as the development app icon without renaming helpers.
 * @param appRoot - real `Electron.app` bundle.
 * @param artworkPng - 1024px product PNG.
 */
export function stampProductIcon(appRoot: string, artworkPng: string): void {
  const resources = join(appRoot, 'Contents', 'Resources')
  const work = join(tmpdir(), 'wechat-harness-iconset')
  const iconset = join(work, `${ICON_FILE}.iconset`)
  rmSync(work, { recursive: true, force: true })
  mkdirSync(iconset, { recursive: true })
  const sizes = [
    [16, 'icon_16x16.png'],
    [32, 'icon_16x16@2x.png'],
    [32, 'icon_32x32.png'],
    [64, 'icon_32x32@2x.png'],
    [128, 'icon_128x128.png'],
    [256, 'icon_128x128@2x.png'],
    [256, 'icon_256x256.png'],
    [512, 'icon_512x512@2x.png'],
    [512, 'icon_512x512.png'],
    [1024, 'icon_512x512@2x.png'],
  ] as const
  for (const [size, name] of sizes) {
    execFileSync('sips', ['-z', String(size), String(size), artworkPng, '--out', join(iconset, name)], { stdio: 'ignore' })
  }
  const icns = join(resources, `${ICON_FILE}.icns`)
  execFileSync('iconutil', ['-c', 'icns', iconset, '-o', icns], { stdio: 'ignore' })
  execFileSync('plutil', ['-replace', 'CFBundleIconFile', '-string', ICON_FILE, join(appRoot, 'Contents', 'Info.plist')])
}

/**
 * Clone `Electron.app` into `~/Applications/WeChat Harness.app` and launch that
 * copy. The npm `Electron.app` stays in place for `electron/path.txt`.
 * @param electronExecutable - Absolute `Electron` binary inside Electron.app.
 * @param brand - development paths written into the Dock relaunch stub.
 * @returns Executable path inside the user Applications copy.
 */
export function brandDevelopmentElectronApp(
  electronExecutable: string,
  brand?: DevelopmentElectronBrand,
): string {
  if (process.platform !== 'darwin') return electronExecutable
  const currentApp = bundleRoot(electronExecutable)
  if (currentApp === undefined) return electronExecutable
  const dist = dirname(realpathSync(currentApp))
  const sourceApp = existsSync(join(dist, 'Electron.app', 'Contents', 'Info.plist'))
    ? join(dist, 'Electron.app')
    : realpathSync(currentApp)
  const distBranded = join(dist, `${PRODUCT_NAME}.app`)
  restoreStockElectronIdentity(sourceApp)
  if (existsSync(distBranded) && lstatSync(distBranded).isSymbolicLink()) unlinkSync(distBranded)
  const launcher = join(homedir(), 'Applications', `${PRODUCT_NAME}.app`)
  syncDevelopmentLauncherApp(sourceApp, launcher)
  writeBundleName(launcher)
  const executable = brand === undefined
    ? join(launcher, 'Contents', 'MacOS', 'Electron')
    : writeDevelopmentLauncherScript(launcher, brand)
  if (brand !== undefined) {
    const artwork = ensureProductIconPng(join(brand.appRoot, 'resources'))
    if (artwork !== undefined) {
      try {
        stampProductIcon(launcher, artwork)
        copyFileSync(artwork, join(launcher, 'Contents', 'Resources', 'icon.png'))
      } catch (iconError) {
        void iconError
      }
    }
  }
  execFileSync('touch', [launcher])
  registerLauncher(launcher, [sourceApp, distBranded])
  try {
    retargetUserDock(launcher)
  } catch (launcherError) {
    void launcherError
  }
  return executable
}
