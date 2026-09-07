import { promises as fsp } from 'fs'
import type { Dirent } from 'fs'
import * as path from 'path'

const APPROX_IO = 20000 // 近似模式，单个文件夹最多fs操作次数

export interface DirInfo {
  bytes: number
  denied: boolean
  approx: boolean
}

interface Acc {
  max: number // 最大可操作数
  over: boolean // 超出max的可操作数
}

async function walk(dir: string, acc: Acc, signal?: AbortSignal): Promise<number> {
  if (signal?.aborted) return 0
  let es: Dirent[]
  try {
    es = await fsp.readdir(dir, { withFileTypes: true })
  } catch {
    return 0
  }
  let total = 0
  for (const e of es) {
    if (signal?.aborted) break
    if (e.isSymbolicLink()) continue
    if (acc.over || --acc.max < 0) {
      acc.over = true
      break
    }
    const p = path.join(dir, e.name)
    if (e.isDirectory()) total += await walk(p, acc, signal)
    else if (e.isFile()) {
      if (signal?.aborted) break
      try {
        const st = await fsp.stat(p)
        if (st.isFile()) total += st.size
      } catch {}
    }
  }
  return total
}

export async function dirSizeInfo(dir: string, approx = false, signal?: AbortSignal): Promise<DirInfo> {
  try {
    await fsp.readdir(dir)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    return { bytes: 0, denied: code === 'EACCES' || code === 'EPERM' || code === 'EBUSY', approx: false }
  }
  const acc: Acc = { max: approx ? APPROX_IO : Infinity, over: false }
  const bytes = await walk(dir, acc, signal)
  return { bytes, denied: false, approx: acc.over }
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
