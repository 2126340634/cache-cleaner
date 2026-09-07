import { ButtonRole, CursorShape, QMessageBox, QPushButton, QWidget } from '@nodegui/nodegui'

export function debounce<T extends (...args: any[]) => void>(func: T, t: number): (...args: Parameters<T>) => void {
  let timer: NodeJS.Timeout | null = null
  return function (this: unknown, ...args: Parameters<T>) {
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(() => {
      func.apply(this, args)
      timer = null
    }, t)
  }
}

// 给控件加“手型”光标，用于可点击控件
export function hand<T extends QWidget>(w: T): T {
  w.setCursor(CursorShape.PointingHandCursor)
  return w
}

// 弹出自定义按钮的确认框，返回是否点了“是/确认”按钮
export function confirmBox(title: string, text: string, yesText: string, noText = '取消', fontSize = 16): boolean {
  const box = new QMessageBox()
  box.setWindowTitle(title)
  box.setText(text)
  box.setStyleSheet(`QLabel { font-size: ${fontSize}px; }`)
  let ok = false
  const yes = hand(new QPushButton())
  yes.setText(yesText)
  yes.addEventListener('clicked', () => {
    ok = true
  })
  const no = hand(new QPushButton())
  no.setText(noText)
  box.addButton(yes, ButtonRole.AcceptRole)
  box.addButton(no, ButtonRole.RejectRole)
  box.exec()
  return ok
}
