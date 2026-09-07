import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {
  QWidget,
  QCheckBox,
  QLabel,
  QPushButton,
  QProgressBar,
  QComboBox,
  QScrollArea,
  QBoxLayout,
  Direction,
  CursorShape,
  QMessageBox,
  ButtonRole
} from '@nodegui/nodegui'
import { tagKb } from './kb'
import { dirSizeInfo, formatSize } from './scan'
import { cleanDir } from './clean'
import { debounce } from './utils'
import { busy } from './scan-state'

const APP_SCOPES: Array<[string, string]> = [
  ['Local', 'Local'],
  ['LocalLow', 'LocalLow'],
  ['Roaming', 'Roaming']
]
const SKIP = new Set(['Application Data'])

function hand<T extends QWidget>(w: T): T {
  w.setCursor(CursorShape.PointingHandCursor)
  return w
}

function ask(message: string, yesText: string): boolean {
  const box = new QMessageBox()
  box.setWindowTitle('确认清理')
  box.setText(message)
  box.setStyleSheet('QLabel { font-size: 16px; }')
  let ok = false
  const yes = hand(new QPushButton())
  yes.setText(yesText)
  yes.addEventListener('clicked', () => (ok = true))
  const no = hand(new QPushButton())
  no.setText('取消')
  box.addButton(yes, ButtonRole.AcceptRole)
  box.addButton(no, ButtonRole.RejectRole)
  box.exec()
  return ok
}

function listDirs(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.isSymbolicLink() && !SKIP.has(e.name))
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b))
  } catch {
    return []
  }
}

type Row = { path: string; checkbox: QCheckBox; tag: QLabel; size: QLabel; safe: boolean; warn: boolean; empty: boolean }

export function createAppdataPanel(): { root: QWidget; refresh: () => void } {
  const root = new QWidget()
  root.setObjectName('root')
  const lay = new QBoxLayout(Direction.TopToBottom)
  root.setLayout(lay)

  const header = new QWidget()
  const hlay = new QBoxLayout(Direction.LeftToRight)
  header.setLayout(hlay)
  const scopeCombo = hand(new QComboBox())
  scopeCombo.addItems(APP_SCOPES.map((s) => s[0]))
  const approxCheck = hand(new QCheckBox())
  approxCheck.setText('近似扫描')
  approxCheck.setChecked(true)
  const selectAll = hand(new QPushButton())
  selectAll.setText('勾选安全项')
  const refreshBtn = hand(new QPushButton())
  refreshBtn.setText('刷新')
  hlay.addWidget(scopeCombo)
  hlay.addWidget(approxCheck)
  hlay.addStretch(1)
  hlay.addWidget(selectAll)
  hlay.addWidget(refreshBtn)
  lay.addWidget(header)

  const listHost = new QWidget()
  const list = new QBoxLayout(Direction.TopToBottom)
  list.setSpacing(2)
  listHost.setLayout(list)
  const scroll = new QScrollArea()
  scroll.setWidgetResizable(true)
  scroll.setWidget(listHost)
  lay.addWidget(scroll, 1)

  const progress = new QProgressBar()
  progress.setObjectName('progress')
  progress.hide()
  lay.addWidget(progress)

  const footer = new QWidget()
  const flay = new QBoxLayout(Direction.LeftToRight)
  footer.setLayout(flay)
  const status = new QLabel()
  status.setObjectName('status')
  const cleanBtn = hand(new QPushButton())
  cleanBtn.setText('清理勾选')
  cleanBtn.setObjectName('clean')
  flay.addWidget(status, 1)
  flay.addWidget(cleanBtn, 0)
  lay.addWidget(footer)

  let rows: Row[] = []
  let rowWidgets: QWidget[] = []
  let currentScope = 0
  let scanning = false
  let pending = false
  let controller: AbortController | null = null

  function baseDir(): string {
    return path.join(os.homedir(), 'AppData', APP_SCOPES[currentScope][1])
  }

  function canCheck(r: Row): boolean {
    return (r.safe || r.warn) && !r.empty
  }

  function cleanable(): Row[] {
    return rows.filter((r) => r.safe && !r.empty)
  }

  function updateStatus(): void {
    const picked = rows.filter((r) => r.checkbox.isChecked()).length
    status.setText(`已发现 ${rows.length} 项缓存，已选中 ${picked} 项`)
  }

  function syncSelectAll(): void {
    const ts = cleanable()
    const allOn = ts.length > 0 && ts.every((r) => r.checkbox.isChecked())
    selectAll.setText(allOn ? '取消勾选' : '勾选安全项')
    updateStatus()
  }

  function addRow(dir: string, checked = false): void {
    const row = new QWidget()
    const rl = new QBoxLayout(Direction.LeftToRight)
    rl.setSpacing(8)
    row.setLayout(rl)

    const t = tagKb(dir)
    const safe = t !== null && t.clean === true
    const warn = t === null || (t !== null && t.clean === undefined)
    const checkbox = hand(new QCheckBox())
    checkbox.setObjectName('checkbox')
    checkbox.setEnabled(safe || warn)
    checkbox.setChecked(safe && checked)
    checkbox.addEventListener('stateChanged', syncSelectAll)
    checkbox.addEventListener('clicked', (checked) => {
      if (!warn || !checked) return
      checkbox.setChecked(false)
      syncSelectAll()
      if (ask(`“${dir}”可能包含重要文件或数据，确定要勾选吗？`, '确定勾选')) checkbox.setChecked(true)
    })
    rl.addWidget(checkbox, 0)

    const name = new QLabel()
    name.setObjectName('label')
    name.setText(dir)
    rl.addWidget(name, 0)

    const tag = new QLabel()
    tag.setObjectName('size')
    if (t) {
      tag.setText(t.label)
      tag.setStyleSheet(t.clean ? 'color:#2ecc71;' : 'color:#8a8f98;')
    }
    rl.addWidget(tag, 0)

    rl.addStretch(1)

    const size = new QLabel()
    size.setObjectName('size')
    size.setText('…')
    rl.addWidget(size, 0)

    list.addWidget(row)
    rowWidgets.push(row)
    rows.push({ path: path.join(baseDir(), dir), checkbox, tag, size, safe, warn, empty: false })
  }

  async function sizeRow(r: Row, approx: boolean, signal?: AbortSignal): Promise<void> {
    try {
      const info = await dirSizeInfo(r.path, approx, signal)
      r.size.setText(info.denied && !info.bytes ? '权限不足' : (info.approx ? '~' : '') + formatSize(info.bytes))
      r.empty = !info.denied && !info.approx && info.bytes === 0
      if (r.empty && r.checkbox.isChecked()) r.checkbox.setChecked(false)
      r.checkbox.setEnabled(canCheck(r))
      syncSelectAll()
    } catch {
      r.size.setText('—')
    }
  }

  function rebuild(): void {
    const prev = new Map<string, boolean>()
    for (const r of rows) if (r.checkbox.isEnabled()) prev.set(r.path, r.checkbox.isChecked())
    for (const w of rowWidgets) {
      list.removeWidget(w)
      w.close()
    }
    rowWidgets = []
    rows = []
    for (const d of listDirs(baseDir())) addRow(d, prev.get(d) ?? false)
    syncSelectAll()
  }

  function setUiEnabled(on: boolean): void {
    scopeCombo.setEnabled(on)
    approxCheck.setEnabled(on)
    selectAll.setEnabled(on)
    refreshBtn.setEnabled(on)
    cleanBtn.setEnabled(on)
    for (const r of rows) r.checkbox.setEnabled(on && canCheck(r))
  }

  async function refresh(): Promise<void> {
    if (scanning) {
      pending = true
      return
    }
    controller = new AbortController()
    scanning = true
    busy.begin()
    refreshBtn.setText('停止扫描')
    try {
      pending = true
      while (pending && !controller.signal.aborted) {
        pending = false
        const approx = approxCheck.isChecked()
        rebuild()
        setUiEnabled(false)
        refreshBtn.setEnabled(true)
        const total = rows.length
        if (total > 0) {
          progress.setRange(0, total)
          progress.setValue(0)
          progress.show()
        }
        let done = 0
        await Promise.all(
          rows.map(async (r) => {
            await sizeRow(r, approx, controller!.signal)
            done++
            if (total > 0) progress.setValue(done)
          })
        )
      }
    } finally {
      scanning = false
      setUiEnabled(true)
      busy.end()
      progress.hide()
      refreshBtn.setText('刷新')
      if (controller?.signal.aborted) status.setText('扫描已停止')
    }
  }

  selectAll.addEventListener('clicked', () => {
    const ts = cleanable()
    const allOn = ts.length > 0 && ts.every((r) => r.checkbox.isChecked())
    if (allOn) {
      for (const r of rows) r.checkbox.setChecked(false)
    } else {
      for (const r of ts) r.checkbox.setChecked(true)
    }
    syncSelectAll()
  })
  refreshBtn.addEventListener(
    'clicked',
    debounce(() => {
      if (scanning) controller?.abort()
      else refresh()
    }, 200)
  )
  approxCheck.addEventListener('stateChanged', () => refresh())
  scopeCombo.addEventListener('currentIndexChanged', (i) => {
    if (i < 0) return
    currentScope = i
    refresh()
  })

  cleanBtn.addEventListener('clicked', async () => {
    const picked = rows.filter((r) => r.checkbox.isChecked())
    if (picked.length === 0) {
      status.setText('请先勾选要清理的项目')
      return
    }
    if (!ask(`确定清空这 ${picked.length} 个缓存文件夹的内容吗？\n删除后不可恢复。`, '确定清理')) return

    setUiEnabled(false)
    cleanBtn.setText('清理中…')
    status.setText(`正在清理 ${picked.length} 项…`)
    progress.setRange(0, picked.length)
    progress.setValue(0)
    progress.show()
    let done = 0
    let failed = 0
    for (let i = 0; i < picked.length; i++) {
      const r = picked[i]
      try {
        await cleanDir(r.path)
        done++
      } catch {
        failed++
      }
      progress.setValue(i + 1)
    }
    progress.hide()
    setUiEnabled(true)
    cleanBtn.setText('清理勾选')
    status.setText(failed ? `完成 ${done} 项，失败 ${failed} 项` : `清理完成 ${done} 项`)
    await Promise.all(picked.map((r) => sizeRow(r, approxCheck.isChecked())))
    syncSelectAll()
  })

  return { root, refresh }
}
