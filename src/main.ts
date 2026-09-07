import { QMainWindow, QTabWidget, QIcon, WindowType } from '@nodegui/nodegui'
import sourceMapSupport from 'source-map-support'
import { execFileSync } from 'child_process'
import * as path from 'path'
import { createCachePanel } from './cache-panel'
import { createAppdataPanel } from './appdata-panel'
import { confirmBox } from './utils'
import { busy } from './scan-state'

const isElevated = (): boolean => {
  try {
    execFileSync('net', ['session'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

// 管理员权限询问
function promptElevate(): void {
  const restart = confirmBox(
    '需要管理员权限',
    '清理 Windows 更新缓存等系统目录需要管理员权限。\n是否以管理员身份重启？',
    '以管理员身份重启',
    '暂不',
    15
  )
  if (!restart) return
  const args = process.argv.slice(1).map((a) => path.resolve(a))
  if (!args.length) return
  const cmd = `Start-Process -FilePath '${process.execPath}' -ArgumentList '${args.join("','")}' -Verb RunAs`
  try {
    execFileSync('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', cmd])
    process.exit(0)
  } catch {}
}

sourceMapSupport.install()

const win = new QMainWindow()
win.setWindowTitle('Cache Cleaner')
win.resize(640, 480)
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
if (!isElevated()) promptElevate()
