export function readScannerLatch(key: string): boolean {
  try { return sessionStorage.getItem(key) === '1' } catch { return true }
}
export function writeScannerLatch(key: string, value: boolean) {
  try { sessionStorage.setItem(key, value ? '1' : '0') } catch { /* The controller also retains its latch in memory. */ }
}
