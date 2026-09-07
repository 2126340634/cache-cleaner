// AppData 目录知识库匹配，命中 kb.json 就返回标签，未收录返回 null
// 数据在 src/kb.json，需要加条目/改标签直接编辑那个文件
import kbEntries from './kb.json'

export interface KbEntry {
  name: string
  label: string
  clean?: boolean
}

export interface Tag {
  label: string
  clean: boolean | undefined
}

const KB: KbEntry[] = kbEntries as KbEntry[]

// 仅按文件夹名精确匹配（不区分大小写），未收录返回 null
export function tagKb(folder: string): Tag | null {
  const key = folder.toLowerCase()
  const found = KB.find((e) => e.name.toLowerCase() === key)
  if (!found) return null
  return { label: found.label, clean: found.clean }
}
