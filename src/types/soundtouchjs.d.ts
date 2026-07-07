declare module 'soundtouchjs' {
  /** Source of interleaved stereo samples pulled by SimpleFilter. */
  export interface SoundTouchSource {
    /** Fill `target` (Float32Array of numFrames*2) starting at source frame `position`; return frames written. */
    extract(target: Float32Array, numFrames: number, position: number): number
  }

  export class SoundTouch {
    tempo: number
    rate: number
    pitch: number
    pitchSemitones: number
    clear(): void
  }

  export class SimpleFilter {
    constructor(sourceSound: SoundTouchSource, pipe: SoundTouch, callback?: () => void)
    /** Setting clears the pipeline and moves the source read head. */
    sourcePosition: number
    extract(target: Float32Array, numFrames: number): number
    clear(): void
  }
}
