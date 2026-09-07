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
  for (const e of es) {
    if (e.isSymbolicLink()) continue
    try {
      await fsp.rm(path.join(dir, e.name), { recursive: true, force: true })
    } catch {
      // 单个文件被占用/无权删时跳过，不阻塞其余文件
    }
  }
}

export async function cleanOption(o: CacheOption): Promise<void> {
  for (const d of o.dirs && o.dirs.length ? o.dirs : [o.path]) {
    await cleanDir(d)
  }
}
