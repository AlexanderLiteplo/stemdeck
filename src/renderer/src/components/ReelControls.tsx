import { useEffect, useRef, useState } from 'react'
import {
  cameraPreviewStream,
  reelElapsedSeconds,
  toggleCameraPreview,
  toggleReelMic,
  toggleReelRecording
} from '../controller'
import { useStore } from '../state/store'

function formatElapsed(seconds: number): string {
  const total = Math.floor(seconds)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

/** Runs only while recording, so a stopped app isn't re-rendering on a timer. */
function ReelClock() {
  const [, force] = useState(0)
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 250)
    return () => clearInterval(id)
  }, [])
  return <span className="reel-clock">{formatElapsed(reelElapsedSeconds())}</span>
}

/** Self-view for framing, shown only while stopped. */
function CameraPreview() {
  const videoRef = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const video = videoRef.current
    const stream = cameraPreviewStream()
    if (!video || !stream) return
    video.srcObject = stream
    void video.play()
  }, [])
  return (
    <div className="camera-preview">
      <video ref={videoRef} muted playsInline />
      <span>Top half of the reel</span>
    </div>
  )
}

export function ReelControls() {
  const reel = useStore((s) => s.reel)

  return (
    <>
      <div className="reel-controls">
        <button
          className={`toggle record reel ${reel.recording ? 'active' : ''}`}
          disabled={reel.saving}
          onClick={() => void toggleReelRecording()}
          title="Record a vertical video: your camera on top, the deck below"
        >
          {reel.saving ? '… SAVING' : reel.recording ? '■ STOP REEL' : '● REC REEL'}
        </button>
        {reel.recording && <ReelClock />}
        <button
          className={`mini-toggle ${reel.mic ? 'active' : ''}`}
          disabled={!reel.recording}
          onClick={() => void toggleReelMic()}
          title={
            reel.recording
              ? 'Talk over the mix — your voice is added to the reel only, never the speakers'
              : 'Start a reel to use the mic'
          }
        >
          {reel.mic ? '🎙 MIC ON' : '🎙 MIC OFF'}
        </button>
        {!reel.recording && (
          <button
            className={`mini-toggle ${reel.preview ? 'active' : ''}`}
            onClick={() => void toggleCameraPreview()}
            title="Check your framing before recording"
          >
            CAM
          </button>
        )}
      </div>
      {reel.preview && !reel.recording && <CameraPreview />}
    </>
  )
}
