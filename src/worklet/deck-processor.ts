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
import { AUTOTUNE_LATENCY_SAMPLES } from './autotune-latency'

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
  | { type: 'jumpBy'; frames: number }
  | { type: 'tempo'; value: number }
  | { type: 'pitch'; semitones: number }
  | { type: 'keylock'; enabled: boolean }
  | { type: 'vocalRoute'; enabled: boolean }
  | { type: 'stemGain'; index: number; value: number }
  | { type: 'loop'; enabled: boolean; start: number; end: number }

const GAIN_SMOOTHING = 0.0015 // per-frame one-pole coefficient toward target
const POSITION_POST_INTERVAL = 8 // process() blocks between position updates

class DeckProcessor extends AudioWorkletProcessor {
  private stems: Stem[] = []
  private length = 0
  private playing = false
  /** Source read head. In keylock mode this feeds SoundTouch and runs AHEAD of the audio. */
  private position = 0
  /** Independent read head for the lazily-created vocal SoundTouch pipeline. */
  private positionVocal = 0
  /** Source time of the audio actually being emitted — what the UI should show. */
  private reportPos = 0
  private tempo = 1
  private pitchSemitones = 0
  private keylock = false
  private vocalRoute = false
  private stemGains = [1, 1, 1, 1]
  private smoothedGains = [1, 1, 1, 1]
  private loopEnabled = false
  private loopStart = 0
  private loopEnd = 0

  private st: SoundTouch | null = null
  private filter: SimpleFilter | null = null
  private stVocal: SoundTouch | null = null
  private filterVocal: SimpleFilter | null = null
  private stBuffer = new Float32Array(128 * 2)
  private stBufferVocal = new Float32Array(128 * 2)
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
        this.syncVocalPosition()
        this.reportPos = 0
        this.playing = false
        // A new track starts with every stem audible — otherwise stems muted
        // on the previous track stay silent while the UI shows them active.
        this.resetStemGains()
        this.resetStretch()
        this.postPosition(true)
        break
      case 'unload':
        this.stems = []
        this.length = 0
        this.playing = false
        this.position = 0
        this.syncVocalPosition()
        this.reportPos = 0
        this.resetStemGains()
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
        this.syncVocalPosition()
        this.reportPos = this.position
        this.resetStretch()
        this.postPosition(true)
        break
      // Relative jump computed against the worklet's own sample-accurate
      // position — avoids the stale round-trip through the UI thread.
      // Based on the AUDIBLE position, which in keylock lags the read head.
      case 'jumpBy':
        this.position = Math.max(0, Math.min(this.reportPos + msg.frames, this.length - 1))
        this.syncVocalPosition()
        this.reportPos = this.position
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
        // Continue from what the listener is hearing, not the read head
        this.position = this.reportPos
        this.syncVocalPosition()
        this.resetStretch()
        break
      case 'vocalRoute':
        if (this.vocalRoute !== msg.enabled) {
          this.vocalRoute = msg.enabled
          // SoundTouch may already have queued audio from the old routing.
          // Rebuild from the audible point so both new pipelines start aligned.
          if (this.keylock) {
            this.position = this.reportPos
            this.resetStretch()
          }
          // Re-apply the read-ahead in both modes: the lead only exists while
          // the route is on, so it has to be added and removed with it.
          this.syncVocalPosition()
        }
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

  /** Snap every stem back to unity — no ramp, the deck is silent at this point. */
  private resetStemGains(): void {
    this.stemGains.fill(1)
    this.smoothedGains.fill(1)
  }

  /**
   * Park the vocal read head AHEAD of the main one by exactly the latency the
   * autotune path will add, so the corrected vocal lands back in time with the
   * rest of the mix. The lead is in source samples, so it scales with tempo.
   */
  private syncVocalPosition(): void {
    const lead = this.vocalRoute ? AUTOTUNE_LATENCY_SAMPLES * this.tempo : 0
    this.positionVocal = this.position + lead
  }

  private resetStretch(): void {
    this.st = null
    this.filter = null
    this.stVocal = null
    this.filterVocal = null
  }

  private updateStretchParams(): void {
    if (this.st) {
      this.st.tempo = this.tempo
      this.st.pitchSemitones = this.pitchSemitones
    }
    if (this.stVocal) {
      this.stVocal.tempo = this.tempo
      this.stVocal.pitchSemitones = this.pitchSemitones
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
          const firstStem = this.vocalRoute && this.stems.length > 1 ? 1 : 0
          for (let s = firstStem; s < this.stems.length; s++) {
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

  private ensureVocalStretch(): SimpleFilter {
    if (this.filterVocal && this.stVocal) return this.filterVocal
    const st = new SoundTouch()
    st.tempo = this.tempo
    st.pitchSemitones = this.pitchSemitones
    const source: SoundTouchSource = {
      extract: (target, numFrames) => {
        let written = 0
        while (written < numFrames) {
          if (
            this.loopEnabled &&
            this.positionVocal >= this.loopEnd &&
            this.loopEnd > this.loopStart
          ) {
            this.positionVocal = this.loopStart + (this.positionVocal - this.loopEnd)
          }
          const pos = Math.floor(this.positionVocal)
          if (pos >= this.length) break
          const g = this.smoothGain(0)
          target[written * 2] = this.stems[0].l[pos] * g
          target[written * 2 + 1] = this.stems[0].r[pos] * g
          this.positionVocal += 1
          written++
        }
        return written
      }
    }
    this.stVocal = st
    this.filterVocal = new SimpleFilter(source, st)
    return this.filterVocal
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
      this.port.postMessage({ type: 'position', frames: this.reportPos, playing: this.playing })
    }
  }

  private ended(): void {
    this.playing = false
    this.position = this.length > 0 ? this.length - 1 : 0
    this.syncVocalPosition()
    this.reportPos = this.position
    this.port.postMessage({ type: 'ended' })
    this.postPosition(true)
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0]
    const left = out[0]
    const right = out.length > 1 ? out[1] : out[0]
    const vocalOut = outputs[1]
    const vocalLeft = vocalOut[0]
    const vocalRight = vocalOut.length > 1 ? vocalOut[1] : vocalOut[0]
    const numFrames = left.length
    const routeVocals = this.vocalRoute && this.stems.length > 1

    vocalLeft.fill(0)
    vocalRight.fill(0)

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
      if (routeVocals) {
        const vocalFilter = this.ensureVocalStretch()
        if (this.stBufferVocal.length < numFrames * 2) {
          this.stBufferVocal = new Float32Array(numFrames * 2)
        }
        const vocalGot = vocalFilter.extract(this.stBufferVocal, numFrames)
        for (let i = 0; i < vocalGot; i++) {
          vocalLeft[i] = this.stBufferVocal[i * 2]
          vocalRight[i] = this.stBufferVocal[i * 2 + 1]
        }
      }
      // Advance the audible position by the source consumed per emitted
      // frame (= tempo), wrapping with the loop like the read head does.
      let advanced = this.reportPos + got * this.tempo
      if (this.loopEnabled && this.loopEnd > this.loopStart) {
        while (advanced >= this.loopEnd) advanced -= this.loopEnd - this.loopStart
      }
      this.reportPos = Math.min(advanced, this.length - 1)
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
          if (routeVocals && s === 0) {
            // Read the vocal ahead by the autotune latency so the corrected
            // vocal comes back out in time with the rest of the mix.
            let vp = this.position + AUTOTUNE_LATENCY_SAMPLES * rate
            if (this.loopEnabled && this.loopEnd > this.loopStart) {
              while (vp >= this.loopEnd) vp -= this.loopEnd - this.loopStart
            }
            if (vp < this.length - 1) {
              const vpi = Math.floor(vp)
              const vfrac = vp - vpi
              vocalLeft[i] = (sl[vpi] + (sl[vpi + 1] - sl[vpi]) * vfrac) * g
              vocalRight[i] = (sr[vpi] + (sr[vpi + 1] - sr[vpi]) * vfrac) * g
            }
          } else {
            l += (sl[pos] + (sl[pos + 1] - sl[pos]) * frac) * g
            r += (sr[pos] + (sr[pos + 1] - sr[pos]) * frac) * g
          }
        }
        left[i] = l
        right[i] = r
        this.position += rate
      }
      this.reportPos = this.position
    }

    this.postPosition()
    return true
  }
}

registerProcessor('deck-processor', DeckProcessor)
