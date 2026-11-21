export class ConcurrentUploads {
  private pending: string[] = []
  private active = new Set<string>()
  private failed = new Set<string>()
  private waiters: (() => void)[] = []
  private disposed = false
  constructor(private process: (id: string) => Promise<void>, private changed: () => void = () => {}, private concurrency = 3) {}
  get count() { return this.pending.length + this.active.size }
  get ids() { return [...this.pending, ...this.active] }
  get hasFailures() { return this.failed.size > 0 }
  enqueue(id: string) {
    if (this.disposed || this.pending.includes(id) || this.active.has(id)) return
    this.failed.delete(id)
    this.pending.push(id)
    this.pump()
  }
  private pump() {
    while (!this.disposed && this.active.size < this.concurrency && this.pending.length) {
      const id = this.pending.shift()!
      this.active.add(id)
      this.changed()
      void this.process(id).catch(() => { this.failed.add(id) }).finally(() => {
        this.active.delete(id)
        this.changed()
        this.pump()
        if (!this.count) { for (const resolve of this.waiters.splice(0)) resolve() }
      })
    }
    this.changed()
  }
  async drain() { if (this.count) await new Promise<void>(resolve => this.waiters.push(resolve)) }
  dispose() { this.disposed = true; this.pending = []; for (const resolve of this.waiters.splice(0)) resolve() }
}
