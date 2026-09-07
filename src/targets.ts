import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

export interface CacheOption {
  label: string
  path: string
  dirs?: string[]
  kind?: 'recycleBin'
}

const HOME = os.homedir()
const LOCAL = path.join(HOME, 'AppData', 'Local')

const has = (p: string): boolean => {
  try {
    return fs.statSync(p).isDirectory()
  } catch {
    return false
  }
}
const dirs = (p: string): string[] => {
  try {
    return fs.readdirSync(p, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.isSymbolicLink())
      .map((e) => e.name)
  } catch {
    return []
  }
}
const DOC = (['Documents', path.join('OneDrive', 'Documents')]
  .map((s) => path.join(HOME, s))
  .find(has)) ?? path.join(HOME, 'Documents')

const BROWSERS: Array<[string, string[]]> = [
  ['Chrome', ['Google', 'Chrome']],
  ['Edge', ['Microsoft', 'Edge']],
  ['360Chrome', ['360Chrome', 'Chrome']],
  ['360ChromeX', ['360ChromeX', 'Chrome']],
  ['Brave', ['BraveSoftware', 'Brave-Browser']],
  ['QQ浏览器', ['Tencent', 'QQBrowser']],
]

function chromiumRows(): CacheOption[] {
  const out: CacheOption[] = []
  for (const [name, rel] of BROWSERS) {
    const ud = path.join(LOCAL, ...rel, 'User Data')
    const profiles = dirs(ud)
      .filter((p) => /^(Default|Profile )/.test(p))
      .sort((a, b) => (a === 'Default' ? -1 : b === 'Default' ? 1 : a.localeCompare(b)))
    for (const p of profiles) {
      const c = path.join(ud, p, 'Cache')
      if (!has(c)) continue
      const s = profiles.length > 1 || p !== 'Default' ? `（${p}）` : ''
      out.push({ label: `${name} 缓存${s}`, path: c })
    }
  }
  return out
}

function firefoxRows(): CacheOption[] {
  const base = path.join(LOCAL, 'Mozilla', 'Firefox', 'Profiles')
  const out: CacheOption[] = []
  for (const p of dirs(base)) {
    const c = path.join(base, p, 'cache2')
    if (!has(c)) continue
    out.push({ label: `Firefox 缓存（${p}）`, path: c })
  }
  return out
}

function wechatRows(): CacheOption[] {
  const out: CacheOption[] = []
  for (const n of dirs(path.join(DOC, 'xwechat_files'))) {
    if (!n.startsWith('wxid')) continue
    const c = path.join(DOC, 'xwechat_files', n, 'cache')
    if (!has(c)) continue
    out.push({ label: `微信缓存（${n}）`, path: c })
  }
  for (const n of dirs(path.join(DOC, 'WeChat Files'))) {
    if (!n.startsWith('wxid')) continue
    const c = path.join(DOC, 'WeChat Files', n, 'FileStorage', 'Cache')
    if (!has(c)) continue
    out.push({ label: `微信缓存（${n}）`, path: c })
  }
  return out
}

const SKIP = new Set(['All Users', 'nt_qq', 'TencentMeeting'])

function qqRows(): CacheOption[] {
  const base = path.join(DOC, 'Tencent Files')
  const out: CacheOption[] = []
  for (const a of dirs(base)) {
    if (SKIP.has(a)) continue
    const acc = path.join(base, a)
    const caches = [
      path.join(acc, 'nt_qq', 'nt_temp'),
      path.join(acc, 'nt_qq', 'nt_data', 'log'),
      path.join(acc, 'nt_qq', 'nt_data', 'log-cache'),
      path.join(acc, 'nt_qq', 'nt_data', 'mmkv'),
      path.join(acc, 'AppWebCache'),
    ].filter(has)
    if (caches.length) out.push({ label: `QQ缓存（${a}）`, path: acc, dirs: caches })
  }
  return out
}

export function buildOptions(winDrive: string): CacheOption[] {
  return [
    ...chromiumRows(),
    ...firefoxRows(),
    ...wechatRows(),
    ...qqRows(),
    { label: '系统临时文件夹缓存', path: path.join(winDrive, 'Windows', 'Temp') },
    { label: '用户临时文件夹缓存', path: path.join(LOCAL, 'Temp') },
    { label: '预读取缓存', path: path.join(winDrive, 'Windows', 'Prefetch') },
    { label: 'Windows 更新缓存', path: path.join(winDrive, 'Windows', 'SoftwareDistribution', 'Download') },
    { label: '回收站', path: path.join(winDrive, '$Recycle.Bin'), kind: 'recycleBin' },
    { label: 'Windows 旧系统备份', path: path.join(winDrive, 'Windows.old') },
  ]
}
