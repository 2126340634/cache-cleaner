import { promises as fsp } from 'fs'
import type { Dirent } from 'fs'
import * as path from 'path'
import type { CacheOption } from './targets'

export async function cleanDir(dir: string): Promise<void> {
  let es: Dirent[]
  try {
    es = await fsp.readdir(dir, { withFileTypes: true })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return
    throw err
  }
  let failed = 0
  for (const e of es) {
    if (e.isSymbolicLink()) continue
    try {
      await fsp.rm(path.join(dir, e.name), { recursive: true, force: true })
    } catch {
      failed++
    }
  }
  if (failed > 0) {
    throw new Error(`无法删除 ${failed}/${es.length} 项（权限不足或被占用）`)
  }
}

export async function cleanOption(o: CacheOption): Promise<void> {
  const dirs = o.dirs && o.dirs.length ? o.dirs : [o.path]
  let firstError: Error | null = null
  for (const d of dirs) {
    try {
      await cleanDir(d)
    } catch (err) {
      firstError = firstError ?? (err as Error)
    }
  }
  if (firstError) throw firstError
}
