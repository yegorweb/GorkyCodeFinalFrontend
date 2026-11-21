export function useCaptureSound() {
  let context: AudioContext | undefined
  async function arm() {
    try { context ??= new AudioContext(); if (context.state === 'suspended') await context.resume() } catch { /* Scanning also works without audio. */ }
  }
  function play() {
    if (!context || context.state !== 'running') return
    const oscillator = context.createOscillator(), gain = context.createGain()
    const now = context.currentTime
    oscillator.type = 'sine'; oscillator.frequency.setValueAtTime(1100, now)
    oscillator.frequency.exponentialRampToValueAtTime(1500, now + 0.08)
    gain.gain.setValueAtTime(0.001, now); gain.gain.exponentialRampToValueAtTime(0.12, now + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16)
    oscillator.connect(gain); gain.connect(context.destination)
    oscillator.start(now); oscillator.stop(now + 0.17)
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect() }
  }
  onBeforeUnmount(() => { void context?.close() })
  return { arm, play }
}
