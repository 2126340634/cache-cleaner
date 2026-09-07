import { promises as fsp } from 'fs'
import type { Dirent } from 'fs'
import * as path from 'path'

const LIMIT = 32
let n = 0
const q: Array<() => void> = []
function take(): Promise<void> {
  if (n < LIMIT) {
    n++
    return Promise.resolve()
  }
  return new Promise<void>((res) => q.push(() => {
    n++
    res()
  }))
}
function put(): void {
  n--
  q.shift()?.()
}
function lim<T>(fn: () => Promise<T>): Promise<T> {
  return take().then(fn).finally(() => put())
}

async function walk(dir: string): Promise<number> {
  let es: Dirent[]
  try {
    es = await lim(() => fsp.readdir(dir, { withFileTypes: true }))
  } catch {
    return 0
  }
  const jobs: Array<Promise<number>> = []
  for (const e of es) {
    const p = path.join(dir, e.name)
    if (e.isSymbolicLink()) continue
    if (e.isDirectory()) jobs.push(walk(p))
    else if (e.isFile()) {
      jobs.push(lim(() => fsp.stat(p)).then((s) => (s.isFile() ? s.size : 0)).catch(() => 0))
    }
  }
  let total = 0
  for (const j of jobs) total += await j
  return total
}

export interface DirInfo {
  bytes: number
  denied: boolean
}

export async function dirSizeInfo(dir: string): Promise<DirInfo> {
  try {
    await lim(() => fsp.readdir(dir))
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    return { bytes: 0, denied: code === 'EACCES' || code === 'EPERM' || code === 'EBUSY' }
  }
  return { bytes: await walk(dir), denied: false }
}

const UNITS = ['KB', 'MB', 'GB', 'TB']

export function formatSize(bytes: number): string {
  if (bytes === 0) return '0 KB'
  let v = bytes / 1024
  let i = 0
  while (v >= 1024 && i < UNITS.length - 1) {
    v /= 1024
    i++
  }
  return `${v >= 1000 ? v.toFixed(0) : v.toFixed(1)} ${UNITS[i]}`
}
