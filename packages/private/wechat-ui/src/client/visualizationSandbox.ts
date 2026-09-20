export const VISUALIZATION_STORAGE_EVENT = 'diywx-visualization-storage-change'

const STORAGE_MESSAGE = 'diywx-visualization-storage'
const SHARED_KEYS = new Set(['ddz_pid', 'ddz_name'])
let storageBridgeInstalled = false

function sharedStorageSnapshot(): Record<string, string> {
  const result: Record<string, string> = {}
  try {
    for (const key of SHARED_KEYS) {
      const value = window.localStorage.getItem(key)
      if (value !== null) result[key] = value
    }
  } catch {}
  return result
}

function announceStorageCommit(key: string): void {
  if (key !== 'ddz_pid') return
  window.dispatchEvent(new CustomEvent(VISUALIZATION_STORAGE_EVENT, { detail: { key } }))
}

function installVisualizationStorageBridge(): void {
  if (storageBridgeInstalled || typeof window === 'undefined') return
  storageBridgeInstalled = true
  window.addEventListener('message', (event) => {
    const data = event.data as { type?: unknown; key?: unknown; value?: unknown } | null
    if (data?.type !== STORAGE_MESSAGE || typeof data.key !== 'string' || !SHARED_KEYS.has(data.key)) return
    if (data.value !== null && typeof data.value !== 'string') return
    if (typeof data.value === 'string' && data.value.length > 512) return
    try {
      if (data.value === null) window.localStorage.removeItem(data.key)
      else window.localStorage.setItem(data.key, data.value)
    } catch {}
    announceStorageCommit(data.key)
  })
  window.addEventListener('storage', (event) => {
    if (event.key !== null && SHARED_KEYS.has(event.key)) announceStorageCommit(event.key)
  })
}

function storageShim(): string {
  const initial = JSON.stringify(sharedStorageSnapshot()).replace(/</gu, '\\u003c')
  return `<script data-diywx-storage-bridge>(function(){
const initial=${initial};
const allowed=new Set(['ddz_pid','ddz_name']);
const memory=new Map(Object.entries(initial));
let storage;
try{storage=window.localStorage;const key='__diywx_storage_probe__';storage.setItem(key,'1');storage.removeItem(key)}catch{storage={
getItem:key=>memory.has(key)?memory.get(key):null,
setItem:(key,value)=>{const text=String(value);memory.set(key,text);if(allowed.has(key))window.parent.postMessage({type:'${STORAGE_MESSAGE}',key,value:text},'*')},
removeItem:key=>{memory.delete(key);if(allowed.has(key))window.parent.postMessage({type:'${STORAGE_MESSAGE}',key,value:null},'*')}
}}
window.__diywxStorage=storage;
})()</script>`
}

/** Make visualize_html snapshots work inside the intentionally opaque iframe sandbox. */
export function prepareVisualizationHtml(source: string): string {
  installVisualizationStorageBridge()
  let html = source
    .replace("const API = 'http://localhost:8090/api';", "const API = 'http://' + (location.hostname || '127.0.0.1') + ':8090/api';")
    .replace("fetch('http://localhost:8090/api/state?pid=')", "fetch(API + '/state?pid=')")

  if (html.includes('createPlayerStorage')) {
    html = html.replace(/const playerStorage\s*=\s*createPlayerStorage\(\);/u, 'const playerStorage = window.__diywxStorage || createPlayerStorage();')
  } else if (/\blocalStorage\b/u.test(html)) {
    html = html.replace(/\blocalStorage\b/gu, '__diywxStorage')
  } else return html

  const shim = storageShim()
  const headEnd = html.search(/<\/head\s*>/iu)
  return headEnd < 0
    ? `${shim}${html}`
    : `${html.slice(0, headEnd)}${shim}${html.slice(headEnd)}`
}
