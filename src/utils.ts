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
