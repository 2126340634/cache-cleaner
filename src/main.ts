import { QMainWindow, QTabWidget, QIcon, WindowType } from '@nodegui/nodegui'
import { execFile } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import sourceMapSupport from 'source-map-support'
import { createCachePanel, systemWinDrive } from './cache-panel'
import { createAppdataPanel } from './appdata-panel'
import { busy } from './scan-state'

sourceMapSupport.install()

const winDrive = systemWinDrive()

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

const win = new QMainWindow()
win.setWindowTitle('Cache Cleaner')
win.resize(720, 540)
win.setWindowFlag(WindowType.WindowMaximizeButtonHint, false)

const tabs = new QTabWidget()
tabs.setObjectName('tabs')
let lockIndex = -1
busy.onChange((active) => {
  if (active) {
    const cur = tabs.currentIndex()
    lockIndex = cur >= 0 ? cur : 0
  } else {
    lockIndex = -1
  }
})
tabs.addTab(createCachePanel(), new QIcon(), '缓存清理')
const appdataPanel = createAppdataPanel()
let appdataLoaded = false
tabs.addEventListener('currentChanged', (i: number) => {
  if (busy.active && i !== lockIndex) {
    tabs.setCurrentIndex(lockIndex)
    return
  }
  if (i === 1 && !appdataLoaded) {
    appdataLoaded = true
    appdataPanel.refresh()
  }
})
tabs.addTab(appdataPanel.root, new QIcon(), 'AppData 管理')
tabs.setCurrentIndex(0)
win.setCentralWidget(tabs)
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
