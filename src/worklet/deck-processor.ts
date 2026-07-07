/**
 * Deck playback processor. One instance per deck.
 *
 * Two playback paths:
 *  - Vinyl mode: direct linear-interpolation resampling. The tempo fader
 *    changes speed AND pitch together, like a turntable.
 *  - Keylock mode: SoundTouch time-stretch. Tempo and pitch (semitones)
 *    are independent, at the cost of slight latency and stretch artifacts.
 *
 * A "track" is 1–4 stems (full mix, or vocals/drums/bass/other). Stems are
 * mixed with per-stem gains before hitting the output, so stem toggles work
 * identically in both playback paths.
 */
import { SimpleFilter, SoundTouch, type SoundTouchSource } from 'soundtouchjs'

interface Stem {
  l: Float32Array
  r: Float32Array
}

interface LoadMessage {
  type: 'load'
  stems: { l: Float32Array; r: Float32Array }[]
}

type InMessage =
  | LoadMessage
  | { type: 'unload' }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'seek'; frames: number }
  | { type: 'tempo'; value: number }
  | { type: 'pitch'; semitones: number }
  | { type: 'keylock'; enabled: boolean }
  | { type: 'stemGain'; index: number; value: number }
  | { type: 'loop'; enabled: boolean; start: number; end: number }

const GAIN_SMOOTHING = 0.0015 // per-frame one-pole coefficient toward target
const POSITION_POST_INTERVAL = 8 // process() blocks between position updates

class DeckProcessor extends AudioWorkletProcessor {
  private stems: Stem[] = []
  private length = 0
  private playing = false
  private position = 0
  private tempo = 1
  private pitchSemitones = 0
  private keylock = false
  private stemGains = [1, 1, 1, 1]
  private smoothedGains = [1, 1, 1, 1]
  private loopEnabled = false
  private loopStart = 0
  private loopEnd = 0

  private st: SoundTouch | null = null
  private filter: SimpleFilter | null = null
  private stBuffer = new Float32Array(128 * 2)
  private blockCounter = 0

  constructor() {
    super()
    this.port.onmessage = (e: MessageEvent<InMessage>) => this.handleMessage(e.data)
  }

  private handleMessage(msg: InMessage): void {
    switch (msg.type) {
      case 'load':
        this.stems = msg.stems
        this.length = msg.stems.length > 0 ? msg.stems[0].l.length : 0
        this.position = 0
        this.playing = false
        this.resetStretch()
        this.postPosition(true)
        break
      case 'unload':
        this.stems = []
        this.length = 0
        this.playing = false
        this.position = 0
        this.resetStretch()
        break
      case 'play':
        this.playing = true
        break
      case 'pause':
        this.playing = false
        this.postPosition(true)
        break
      case 'seek':
        this.position = Math.max(0, Math.min(msg.frames, this.length - 1))
        this.resetStretch()
        this.postPosition(true)
        break
      case 'tempo':
        this.tempo = msg.value
        this.updateStretchParams()
        break
      case 'pitch':
        this.pitchSemitones = msg.semitones
        this.updateStretchParams()
        break
      case 'keylock':
        this.keylock = msg.enabled
        this.resetStretch()
        break
      case 'stemGain':
        if (msg.index >= 0 && msg.index < 4) this.stemGains[msg.index] = msg.value
        break
      case 'loop':
        this.loopEnabled = msg.enabled
        this.loopStart = msg.start
        this.loopEnd = msg.end
        break
    }
  }

  private resetStretch(): void {
    this.st = null
    this.filter = null
  }

  private updateStretchParams(): void {
    if (this.st) {
      this.st.tempo = this.tempo
      this.st.pitchSemitones = this.pitchSemitones
    }
  }

  private ensureStretch(): SimpleFilter {
    if (this.filter && this.st) return this.filter
    const st = new SoundTouch()
    st.tempo = this.tempo
    st.pitchSemitones = this.pitchSemitones
    // The source is consumed at natural speed; SoundTouch handles tempo.
    // We track position ourselves (in this.position) so loops can wrap.
    const source: SoundTouchSource = {
      extract: (target, numFrames) => {
        let written = 0
        while (written < numFrames) {
          if (this.loopEnabled && this.position >= this.loopEnd && this.loopEnd > this.loopStart) {
            this.position = this.loopStart + (this.position - this.loopEnd)
          }
          const pos = Math.floor(this.position)
          if (pos >= this.length) break
          let l = 0
          let r = 0
          for (let s = 0; s < this.stems.length; s++) {
            const g = this.smoothGain(s)
            l += this.stems[s].l[pos] * g
            r += this.stems[s].r[pos] * g
          }
          target[written * 2] = l
          target[written * 2 + 1] = r
          this.position += 1
          written++
        }
        return written
      }
    }
    this.st = st
    this.filter = new SimpleFilter(source, st)
    return this.filter
  }

  private smoothGain(stemIndex: number): number {
    const target = this.stemGains[stemIndex]
    const current = this.smoothedGains[stemIndex]
    const next = current + (target - current) * GAIN_SMOOTHING
    this.smoothedGains[stemIndex] = Math.abs(next - target) < 1e-4 ? target : next
    return this.smoothedGains[stemIndex]
  }

  private postPosition(force = false): void {
    this.blockCounter++
    if (force || this.blockCounter >= POSITION_POST_INTERVAL) {
      this.blockCounter = 0
      this.port.postMessage({ type: 'position', frames: this.position, playing: this.playing })
    }
  }

  private ended(): void {
    this.playing = false
    this.position = this.length > 0 ? this.length - 1 : 0
    this.port.postMessage({ type: 'ended' })
    this.postPosition(true)
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0]
    const left = out[0]
    const right = out.length > 1 ? out[1] : out[0]
    const numFrames = left.length

    if (!this.playing || this.stems.length === 0 || this.length === 0) {
      left.fill(0)
      right.fill(0)
      return true
    }

    if (this.keylock) {
      const filter = this.ensureStretch()
      if (this.stBuffer.length < numFrames * 2) this.stBuffer = new Float32Array(numFrames * 2)
      const got = filter.extract(this.stBuffer, numFrames)
      for (let i = 0; i < got; i++) {
        left[i] = this.stBuffer[i * 2]
        right[i] = this.stBuffer[i * 2 + 1]
      }
      for (let i = got; i < numFrames; i++) {
        left[i] = 0
        right[i] = 0
      }
      if (got === 0) this.ended()
    } else {
      const rate = this.tempo
      for (let i = 0; i < numFrames; i++) {
        if (this.loopEnabled && this.position >= this.loopEnd && this.loopEnd > this.loopStart) {
          this.position = this.loopStart + (this.position - this.loopEnd)
        }
        if (this.position >= this.length - 1) {
          for (let j = i; j < numFrames; j++) {
            left[j] = 0
            right[j] = 0
          }
          this.ended()
          return true
        }
        const pos = Math.floor(this.position)
        const frac = this.position - pos
        let l = 0
        let r = 0
        for (let s = 0; s < this.stems.length; s++) {
          const g = this.smoothGain(s)
          const sl = this.stems[s].l
          const sr = this.stems[s].r
          l += (sl[pos] + (sl[pos + 1] - sl[pos]) * frac) * g
          r += (sr[pos] + (sr[pos + 1] - sr[pos]) * frac) * g
        }
        left[i] = l
        right[i] = r
        this.position += rate
      }
    }

    this.postPosition()
    return true
  }
}

registerProcessor('deck-processor', DeckProcessor)
