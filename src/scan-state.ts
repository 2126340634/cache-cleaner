export class Busy {
  private count = 0
  private listeners: Array<(active: boolean) => void> = []

  get active(): boolean {
    return this.count > 0
  }

  onChange(fn: (active: boolean) => void): void {
    this.listeners.push(fn)
    if (this.count > 0) fn(true)
  }

  begin(): void {
    if (this.count++ === 0) this.emit(true)
  }

  end(): void {
    if (this.count > 0) this.count--
    if (this.count === 0) this.emit(false)
  }

  private emit(active: boolean): void {
    for (const fn of this.listeners) fn(active)
  }
}

export const busy = new Busy()
