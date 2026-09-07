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
import { execFileSync } from 'child_process'
import * as fs from 'fs'
import { buildOptions } from './targets'
import type { CacheOption } from './targets'
import { dirSizeInfo, formatSize } from './scan'
import { cleanOption } from './clean'
import { debounce } from './utils'
import { busy } from './scan-state'

function hand<T extends QWidget>(w: T): T {
  w.setCursor(CursorShape.PointingHandCursor)
  return w
}

function listDrives(): string[] {
  const out: string[] = []
  for (const l of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
    try {
      if (fs.statSync(`${l}:\\`).isDirectory()) out.push(l)
    } catch {}
  }
  return out
}

const DRIVES = listDrives().length ? listDrives() : ['C']

export function systemWinDrive(): string {
  const found = DRIVES.find((l) => {
    try {
      return fs.statSync(`${l}:\\Windows`).isDirectory()
    } catch {
      return false
    }
  })
  return `${found ?? DRIVES[0]}:\\`
}

function currentSid(win: string): string {
  try {
    const out = execFileSync(`${win}Windows\\System32\\whoami.exe`, ['/user'], { encoding: 'utf8' })
    const m = out.match(/S-\d+(?:-\d+)+/)
    return m ? m[0] : ''
  } catch {
    return ''
  }
}

type Row = { option: CacheOption; checkbox: QCheckBox; mark: QLabel; size: QLabel; bytes: number; empty: boolean }

export function createCachePanel(): QWidget {
  let winDrive = systemWinDrive()
  const sid = currentSid(winDrive)
  const recycle = (drive: string): string => `${drive}$Recycle.Bin\\${sid}`

  const content = new QWidget()
  content.setObjectName('root')
  const root = new QBoxLayout(Direction.TopToBottom)
  content.setLayout(root)

  const header = new QWidget()
  const head = new QBoxLayout(Direction.LeftToRight)
  header.setLayout(head)

  const driveLabel = new QLabel()
  driveLabel.setText('系统盘')
  const driveCombo = hand(new QComboBox())
  driveCombo.addItems(DRIVES.map((l) => `${l}:`))
  driveCombo.setCurrentIndex(DRIVES.indexOf(winDrive[0]))

  const approxCheck = hand(new QCheckBox())
  approxCheck.setText('近似扫描')
  approxCheck.setChecked(true)

  const selectAll = hand(new QPushButton())
  selectAll.setText('全选')
  const refreshBtn = hand(new QPushButton())
  refreshBtn.setText('刷新')

  head.addWidget(driveLabel)
  head.addWidget(driveCombo)
  head.addWidget(approxCheck)
  head.addStretch(1)
  head.addWidget(selectAll)
  head.addWidget(refreshBtn)

  const listHost = new QWidget()
  const list = new QBoxLayout(Direction.TopToBottom)
  list.setSpacing(2)
  listHost.setLayout(list)
  const scroll = new QScrollArea()
  scroll.setWidgetResizable(true)
  scroll.setWidget(listHost)

  const footer = new QWidget()
  const foot = new QBoxLayout(Direction.LeftToRight)
  footer.setLayout(foot)
  const status = new QLabel()
  status.setObjectName('status')
  const cleanBtn = hand(new QPushButton())
  cleanBtn.setText('开始清理')
  cleanBtn.setObjectName('clean')
  foot.addWidget(status, 1)
  foot.addWidget(cleanBtn, 0)

  const progress = new QProgressBar()
  progress.setObjectName('progress')
  progress.hide()

  root.addWidget(header)
  root.addWidget(scroll, 1)
  root.addWidget(progress)
  root.addWidget(footer)

  const rows: Row[] = []
  let rowWidgets: QWidget[] = []

  function addRow(option: CacheOption, checked = true): void {
    const row = new QWidget()
    const lay = new QBoxLayout(Direction.LeftToRight)
    lay.setSpacing(8)
    row.setLayout(lay)

    const checkbox = hand(new QCheckBox())
    checkbox.setObjectName('checkbox')
    checkbox.setChecked(checked)
    checkbox.addEventListener('stateChanged', syncSelectAll)
    lay.addWidget(checkbox, 0)

    const label = new QLabel()
    label.setObjectName('label')
    label.setText(option.label)
    label.setToolTip(option.dirs?.length ? `${option.path}\n${option.dirs.join('\n')}` : option.path)
    lay.addWidget(label, 0)

    const mark = new QLabel()
    mark.setObjectName('mark')
    mark.setText('')
    lay.addWidget(mark, 0)
    lay.addStretch(1)

    const size = new QLabel()
    size.setObjectName('size')
    size.setText('…')
    lay.addWidget(size, 0)

    list.addWidget(row)
    rowWidgets.push(row)
    rows.push({ option, checkbox, mark, size, bytes: -1, empty: false })
  }

  async function refreshRow(r: Row, approx: boolean, signal?: AbortSignal): Promise<void> {
    try {
      const dirs = r.option.dirs && r.option.dirs.length ? r.option.dirs : [r.option.path]
      let bytes = 0
      let denied = false
      let approximate = false
      for (const d of dirs) {
        const info = await dirSizeInfo(d, approx, signal)
        bytes += info.bytes
        denied = denied || info.denied
        approximate = approximate || info.approx
      }
      r.bytes = bytes
      r.empty = bytes === 0 && !denied && !approximate
      if (r.empty && r.checkbox.isChecked()) r.checkbox.setChecked(false)
      r.checkbox.setEnabled(!r.empty)
      r.size.setText(denied && !bytes ? '权限不足' : (approximate ? '~' : '') + formatSize(bytes))
    } catch {
      r.bytes = -1
      r.empty = false
      r.checkbox.setEnabled(true)
      r.size.setText('—')
    }
  }

  let scanning = false
  let pending = false
  let controller: AbortController | null = null

  async function refreshAll(approx: boolean, signal?: AbortSignal): Promise<void> {
    const total = rows.length
    if (total > 0) {
      progress.setRange(0, total)
      progress.setValue(0)
      progress.show()
    }
    let done = 0
    await Promise.all(
      rows.map(async (r) => {
        await refreshRow(r, approx, signal)
        done++
        if (total > 0) progress.setValue(done)
      })
    )
    syncSelectAll()
    progress.hide()
  }

  async function rebuild(approx: boolean, signal?: AbortSignal): Promise<void> {
    const prev = new Map<string, boolean>()
    for (const r of rows) prev.set(r.option.label, r.checkbox.isChecked())
    for (const w of rowWidgets) {
      list.removeWidget(w)
      w.close()
    }
    rowWidgets = []
    rows.length = 0
    const targets = buildOptions(winDrive).map((o) => (o.kind === 'recycleBin' ? { ...o, kind: undefined, path: recycle(winDrive) } : o))
    for (const o of targets) addRow(o, prev.get(o.label) ?? true)
    syncSelectAll()
    setUiEnabled(false)
    refreshBtn.setEnabled(true)
    refreshBtn.setText('停止扫描')
    await refreshAll(approx, signal)
  }

  async function runScan(): Promise<void> {
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
        await rebuild(approxCheck.isChecked(), controller.signal)
      }
    } finally {
      scanning = false
      busy.end()
      setUiEnabled(true)
      refreshBtn.setText('刷新')
      if (controller.signal.aborted) status.setText('扫描已停止')
    }
  }

  function nonEmpty(r: Row): boolean {
    return r.bytes > 0
  }

  function updateStatus(): void {
    const picked = rows.filter((r) => r.checkbox.isChecked()).length
    status.setText(`已发现 ${rows.length} 项缓存，已选中 ${picked} 项`)
  }

  function syncSelectAll(): void {
    const ts = rows.filter(nonEmpty)
    const allOn = ts.length > 0 && ts.every((r) => r.checkbox.isChecked())
    selectAll.setText(allOn ? '取消全选' : '全选')
    updateStatus()
  }

  selectAll.addEventListener('clicked', () => {
    const ts = rows.filter(nonEmpty)
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
      else runScan()
    }, 200)
  )
  approxCheck.addEventListener('stateChanged', () => runScan())

  driveCombo.addEventListener('currentIndexChanged', (i) => {
    if (i < 0) return
    winDrive = `${driveCombo.itemText(i)[0]}:\\`
    runScan()
  })

  function confirmClean(count: number): boolean {
    const box = new QMessageBox()
    box.setWindowTitle('确认清理')
    box.setText(`确定清理选中的 ${count} 项缓存吗？\n内容删除后不可恢复。`)
    box.setStyleSheet('QLabel { font-size: 16px; }')
    let ok = false
    const yes = hand(new QPushButton())
    yes.setText('开始清理')
    yes.addEventListener('clicked', () => {
      ok = true
    })
    const no = hand(new QPushButton())
    no.setText('取消')
    box.addButton(yes, ButtonRole.AcceptRole)
    box.addButton(no, ButtonRole.RejectRole)
    box.exec()
    return ok
  }

  function setUiEnabled(on: boolean): void {
    driveCombo.setEnabled(on)
    approxCheck.setEnabled(on)
    selectAll.setEnabled(on)
    refreshBtn.setEnabled(on)
    cleanBtn.setEnabled(on)
    for (const r of rows) r.checkbox.setEnabled(on && !r.empty)
  }

  cleanBtn.addEventListener('clicked', async () => {
    const picked = rows.filter((r) => r.checkbox.isChecked())
    if (picked.length === 0) {
      status.setText('请先勾选要清理的项目')
      return
    }
    if (!confirmClean(picked.length)) return
    setUiEnabled(false)
    cleanBtn.setText('清理中…')
    status.setText(`正在清理 ${picked.length} 项…`)
    progress.setRange(0, picked.length)
    progress.setValue(0)
    progress.show()
    let done = 0
    let failed = 0
    for (const r of picked) r.mark.setText('')
    for (let i = 0; i < picked.length; i++) {
      const r = picked[i]
      status.setText(`正在清理 (${i + 1}/${picked.length}) ${r.option.label}…`)
      try {
        await cleanOption(r.option)
        done++
      } catch {
        r.mark.setText('清理失败')
        failed++
      }
      progress.setValue(i + 1)
    }
    setUiEnabled(true)
    cleanBtn.setText('开始清理')
    status.setText(failed ? `完成 ${done} 项，失败 ${failed} 项` : `清理完成 ${done} 项`)
    progress.hide()
    await Promise.all(picked.map((r) => refreshRow(r, approxCheck.isChecked())))
    syncSelectAll()
  })

  runScan()
  return content
}
