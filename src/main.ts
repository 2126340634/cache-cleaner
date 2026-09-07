import {
  QMainWindow,
  QWidget,
  QCheckBox,
  QLabel,
  QPushButton,
  QProgressBar,
  QComboBox,
  QMessageBox,
  ButtonRole,
  QBoxLayout,
  Direction,
  WindowType,
  CursorShape,
  QScrollArea
} from '@nodegui/nodegui'
import { execFile, execFileSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import sourceMapSupport from 'source-map-support'
import { buildOptions } from './targets'
import type { CacheOption } from './targets'
import { dirSizeInfo, formatSize } from './scan'
import { cleanOption } from './clean'
import { debounce } from './utils'

sourceMapSupport.install()

function listDrives(): string[] {
  const out: string[] = []
  for (const l of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
    try {
      if (fs.statSync(`${l}:\\`).isDirectory()) out.push(l)
    } catch {
      // 盘符不存在
    }
  }
  return out
}

const letters = listDrives().length ? listDrives() : ['C']
let drive =
  letters.find((l) => {
    try {
      return fs.statSync(`${l}:\\Windows`).isDirectory()
    } catch {
      return false
    }
  }) ?? letters[0]
let winDrive = `${drive}:\\`

function isElevated(): boolean {
  try {
    fs.readdirSync(`${winDrive}Windows\\Temp`)
    return true
  } catch {
    return false
  }
}

if (!isElevated()) {
  const entry = path.join(__dirname, 'main.cjs')
  execFile(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', `Start-Process -FilePath '${process.execPath}' -ArgumentList '${entry}' -Verb RunAs`],
    (err) => {
      if (!err) process.exit(0)
    }
  )
}

function currentSid(): string {
  try {
    const out = execFileSync(`${winDrive}Windows\\System32\\whoami.exe`, ['/user'], { encoding: 'utf8' })
    const m = out.match(/S-\d+(?:-\d+)+/)
    return m ? m[0] : ''
  } catch {
    return ''
  }
}
const sid = currentSid()
const recycleDir = (drive: string): string => `${drive}$Recycle.Bin\\${sid}`

const win = new QMainWindow()
win.setWindowTitle('Cache Cleaner')
win.resize(720, 540)
win.setWindowFlag(WindowType.WindowMaximizeButtonHint, false)

function hand<T extends QWidget>(w: T): T {
  w.setCursor(CursorShape.PointingHandCursor)
  return w
}

type Row = { option: CacheOption; checkbox: QCheckBox; mark: QLabel; size: QLabel }

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
driveCombo.addItems(letters.map((l) => `${l}:`))
driveCombo.setCurrentIndex(letters.indexOf(drive))

const selectAll = hand(new QPushButton())
selectAll.setText('全选')
const refreshBtn = hand(new QPushButton())
refreshBtn.setText('刷新')

head.addWidget(driveLabel)
head.addWidget(driveCombo)
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
  rows.push({ option, checkbox, mark, size })
}

async function refreshRow({ option, size }: Row): Promise<void> {
  try {
    const dirs = option.dirs && option.dirs.length ? option.dirs : [option.path]
    let bytes = 0
    let denied = false
    for (const d of dirs) {
      const info = await dirSizeInfo(d)
      bytes += info.bytes
      denied = denied || info.denied
    }
    size.setText(denied && !bytes ? '权限不足' : formatSize(bytes))
  } catch {
    size.setText('—')
  }
}

let scanning = false

async function refreshAll(): Promise<void> {
  await Promise.all(rows.map(refreshRow))
  status.setText(`已发现 ${rows.length} 项缓存`)
}

async function rebuild(): Promise<void> {
  const prev = new Map<string, boolean>()
  for (const r of rows) prev.set(r.option.label, r.checkbox.isChecked())
  for (const w of rowWidgets) {
    list.removeWidget(w)
    w.close()
  }
  rowWidgets = []
  rows.length = 0
  const targets = buildOptions(winDrive).map((o) =>
    o.kind === 'recycleBin' ? { ...o, kind: undefined, path: recycleDir(winDrive) } : o
  )
  for (const o of targets) addRow(o, prev.get(o.label) ?? true)
  syncSelectAll()
  await refreshAll()
}

async function runScan(): Promise<void> {
  if (scanning) return
  scanning = true
  refreshBtn.setEnabled(false)
  try {
    await rebuild()
  } finally {
    scanning = false
    refreshBtn.setEnabled(true)
  }
}

function syncSelectAll(): void {
  const allOn = rows.length > 0 && rows.every((r) => r.checkbox.isChecked())
  selectAll.setText(allOn ? '取消全选' : '全选')
}

selectAll.addEventListener('clicked', () => {
  const allOn = rows.length > 0 && rows.every((r) => r.checkbox.isChecked())
  for (const r of rows) r.checkbox.setChecked(!allOn)
  syncSelectAll()
})

refreshBtn.addEventListener(
  'clicked',
  debounce(() => {
    runScan()
  }, 200)
)

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
  selectAll.setEnabled(on)
  refreshBtn.setEnabled(on)
  cleanBtn.setEnabled(on)
  for (const r of rows) r.checkbox.setEnabled(on)
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
  await Promise.all(picked.map(refreshRow))
  status.setText(failed ? `完成 ${done} 项，失败 ${failed} 项` : `清理完成 ${done} 项`)
})

runScan()

win.setCentralWidget(content)
win.setStyleSheet(`
  #root { padding: 12px; }
  #checkbox::indicator { width: 22px; height: 22px; }
  #label { font-size: 15px; }
  #mark { font-size: 12px; color: #e23b3b; }
  #size { font-size: 12px; color: #8a8f98; }
  #status { font-size: 12px; color: #555; }
  QPushButton { padding: 5px 12px; }
  #clean { background: #2ecc71; color: #fff; font-weight: bold; border: none; }
  #clean:disabled { background: #9fd8b8; }
  #progress { max-height: 12px; border: 1px solid #ccc; border-radius: 3px; text-align: center; }
  #progress::chunk { background: #2ecc71; }
`)
win.show()
;(global as any).win = win
