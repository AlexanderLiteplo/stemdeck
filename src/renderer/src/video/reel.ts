/**
 * Instagram Reels recorder: your camera on top, the StemDeck window below,
 * composited onto a 1080x1920 canvas and muxed with the master mix.
 *
 * The window capture is granted without a picker by the main process
 * (setDisplayMediaRequestHandler), which always hands back StemDeck's own window.
 */
import { engine } from '../audio/engine'

export const REEL_WIDTH = 1080
export const REEL_HEIGHT = 1920
/** Camera occupies the top half; the deck gets the rest. */
const CAMERA_HEIGHT = 960
const FPS = 30
const BACKGROUND = '#0b0d12'

const VIDEO_MIME_CANDIDATES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm'
]

function pickMimeType(): string | undefined {
  return VIDEO_MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type))
}

/** Fill the box, cropping the overflow — used for the camera. */
function drawCover(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  dx: number,
  dy: number,
  dw: number,
  dh: number
): void {
  const { videoWidth: vw, videoHeight: vh } = video
  if (!vw || !vh) return
  const scale = Math.max(dw / vw, dh / vh)
  const sw = dw / scale
  const sh = dh / scale
  ctx.drawImage(video, (vw - sw) / 2, (vh - sh) / 2, sw, sh, dx, dy, dw, dh)
}

/** Fit inside the box, letterboxed — used for the deck, which must stay whole. */
function drawContain(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  dx: number,
  dy: number,
  dw: number,
  dh: number
): void {
  const { videoWidth: vw, videoHeight: vh } = video
  if (!vw || !vh) return
  const scale = Math.min(dw / vw, dh / vh)
  const w = vw * scale
  const h = vh * scale
  ctx.drawImage(video, dx + (dw - w) / 2, dy + (dh - h) / 2, w, h)
}

async function playInto(stream: MediaStream): Promise<HTMLVideoElement> {
  const video = document.createElement('video')
  video.srcObject = stream
  video.muted = true
  video.playsInline = true
  await video.play()
  return video
}

export class ReelRecorder {
  private canvas = document.createElement('canvas')
  private ctx: CanvasRenderingContext2D
  private cameraStream: MediaStream | null = null
  private screenStream: MediaStream | null = null
  private micStream: MediaStream | null = null
  private cameraVideo: HTMLVideoElement | null = null
  private screenVideo: HTMLVideoElement | null = null
  private recorder: MediaRecorder | null = null
  private chunks: Blob[] = []
  private raf = 0
  startedAt = 0

  constructor() {
    this.canvas.width = REEL_WIDTH
    this.canvas.height = REEL_HEIGHT
    this.ctx = this.canvas.getContext('2d')!
  }

  /** Live camera feed, for the framing preview. */
  get camera(): MediaStream | null {
    return this.cameraStream
  }

  async start(): Promise<void> {
    this.cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
      audio: false
    })
    this.screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: FPS },
      audio: false
    })
    this.cameraVideo = await playInto(this.cameraStream)
    this.screenVideo = await playInto(this.screenStream)

    // Stopping the share from the OS-level indicator must end the take too.
    this.screenStream.getVideoTracks()[0]?.addEventListener('ended', () => this.onScreenEnded?.())

    const canvasStream = this.canvas.captureStream(FPS)
    const audioTrack = engine.reelAudioStream.getAudioTracks()[0]
    const mixed = new MediaStream([canvasStream.getVideoTracks()[0], ...(audioTrack ? [audioTrack] : [])])

    this.chunks = []
    this.recorder = new MediaRecorder(mixed, {
      mimeType: pickMimeType(),
      videoBitsPerSecond: 8_000_000,
      audioBitsPerSecond: 192_000
    })
    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data)
    }
    this.recorder.start(1000)
    this.startedAt = performance.now()
    this.draw()
  }

  /** Fired when the user ends the screen share from outside the app. */
  onScreenEnded: (() => void) | null = null

  private draw = (): void => {
    this.raf = requestAnimationFrame(this.draw)
    const ctx = this.ctx
    ctx.fillStyle = BACKGROUND
    ctx.fillRect(0, 0, REEL_WIDTH, REEL_HEIGHT)
    if (this.cameraVideo) drawCover(ctx, this.cameraVideo, 0, 0, REEL_WIDTH, CAMERA_HEIGHT)
    if (this.screenVideo) {
      drawContain(ctx, this.screenVideo, 0, CAMERA_HEIGHT, REEL_WIDTH, REEL_HEIGHT - CAMERA_HEIGHT)
    }
    // Seam between the two halves
    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)'
    ctx.fillRect(0, CAMERA_HEIGHT - 1, REEL_WIDTH, 2)
  }

  /** Open the mic and route it into the reel mix (not the speakers). */
  async enableMic(): Promise<void> {
    if (!this.micStream) {
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      })
      engine.attachMic(this.micStream)
    }
    engine.setMicLevel(1)
  }

  muteMic(): void {
    engine.setMicLevel(0)
  }

  async stop(): Promise<Blob> {
    cancelAnimationFrame(this.raf)
    const recorder = this.recorder
    const blob = recorder
      ? await new Promise<Blob>((resolve) => {
          recorder.onstop = () => resolve(new Blob(this.chunks, { type: 'video/webm' }))
          recorder.stop()
        })
      : new Blob([], { type: 'video/webm' })
    this.dispose()
    return blob
  }

  private dispose(): void {
    engine.setMicLevel(0)
    engine.detachMic()
    for (const stream of [this.cameraStream, this.screenStream, this.micStream]) {
      stream?.getTracks().forEach((track) => track.stop())
    }
    this.cameraStream = this.screenStream = this.micStream = null
    this.cameraVideo = this.screenVideo = null
    this.recorder = null
    this.chunks = []
  }
}
