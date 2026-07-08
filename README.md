# 🎧 StemDeck

**Open-source desktop DJ app with AI stem separation — powered entirely by the music files on your computer.**

Two decks, a full mixer, beat sync, keylock pitch/tempo control, and one-click AI stem isolation (vocals / drums / bass / other) so you can mix like it's four turntables per deck. No cloud, no subscription, no uploads: your MP3s never leave your machine.

## Features

- **Two decks + mixer** — 3-band EQ with kill, trim, combined LP/HP filter knob, channel faders, equal-power crossfader, master limiter and VU meter
- **AI stem isolation** — split any track into vocals/drums/bass/other locally, then mute/ride each stem live (acapella over another track's beat, instant instrumentals, drum swaps…)
- **Pitch & tempo** — ±8% pitch fader (vinyl mode: pitch follows tempo, like a turntable), **keylock** mode (SoundTouch time-stretch: tempo changes without chipmunking), and semitone key shift up/down
- **BPM detection + SYNC** — automatic BPM/beat-phase analysis, one-button tempo match and beat-phase alignment to the other deck, pitch-bend nudge buttons for manual beatmatching
- **Performance tools** — 4 hot cues per deck, CDJ-style cue point, manual loops (in/out/exit) and beat-snapped 1/2/4/8-beat loops
- **Waveforms** — seekable overview waveform with playhead, cue markers, and loop region
- **Record your mix** — one-button master recording, auto-saved to `~/Music/StemDeck Recordings` and browsable in-app (reveal in Finder, or re-import a mix as a track)
- **Library with crates** — add or drag-and-drop local audio files (MP3, WAV, FLAC, M4A, AAC, OGG, AIFF); organize them into folders (crates) with a two-pane browser: crates on the left, tracks on the right. Drag any track onto a crate to file it.

## The stem engine

StemDeck shells out to [python-audio-separator](https://github.com/nomadkaraoke/python-audio-separator), which runs the best open pre-trained source-separation models available:

| Model | Stems | Why |
|---|---|---|
| **Demucs v4 FT** (`htdemucs_ft`) — default | vocals / drums / bass / other | The proven default for clean 4-stem DJ splits |
| **BS-Roformer** (SDR 12.98) | vocals / instrumental | State-of-the-art vocal isolation (ByteDance's Band-Split RoFormer architecture, top of the SDX leaderboards) |

Models are downloaded automatically on first use and run 100% locally. Separated stems are cached, so each track only needs to be split once.

### Installing the stem engine

```bash
# recommended (isolated env):
pipx install "audio-separator[cpu]"

# or with pip:
pip install "audio-separator[cpu]"

# Apple Silicon / NVIDIA users: install the GPU flavor for much faster separation
pip install "audio-separator[gpu]"
```

The app looks for `audio-separator` on your PATH (plus `~/.local/bin`, `/opt/homebrew/bin`, `/usr/local/bin`). You can point it somewhere else with the `STEMDECK_AUDIO_SEPARATOR` env var. Everything else in StemDeck works without it — you just won't be able to split new stems.

> Note: `audio-separator` needs Python ≤3.13 (PyTorch requirement). If your system Python is newer: `pipx install --python python3.12 "audio-separator[cpu]"`.

## Running StemDeck

```bash
git clone https://github.com/AlexanderLiteplo/stemdeck.git
cd stemdeck
npm install
npm run dev     # development (hot reload)
npm start       # build + run the production bundle
```

## How to DJ with it

1. **Add tracks** (button or drag-and-drop). BPM and beat phase are detected automatically. Make **crates** with **+ NEW CRATE** and drag tracks onto them to organize your library.
2. **Load** tracks by dragging them from the library onto a deck (or with the A / B buttons).
3. Hit **SYNC** on the incoming deck to match tempo and beat phase — or beatmatch by hand with the pitch fader and ◀ ▶ nudge buttons.
4. Enable **KEYLOCK** to change tempo without changing pitch, then use **− / + st** to shift the musical key so tracks blend harmonically.
5. Stems split automatically for new tracks (toggleable). Once split, tracks load with stem controls, so you can kill the vocals, solo the drums, or ride each stem's volume live.
6. Blend with the EQs, filter, and crossfader. Hit **● REC MIX** to record the set.

## Architecture

- **Electron + React + TypeScript** (electron-vite)
- **Web Audio API** graph: per-deck AudioWorklet → trim → 3-band EQ → HP/LP filter → fader → crossfader → master limiter
- **Custom AudioWorklet deck processor** — sample-accurate playback with two paths: direct interpolation (vinyl mode) and [SoundTouchJS](https://github.com/cutterbl/SoundTouchJS) time-stretch (keylock mode); stems are mixed with click-free smoothed gains inside the worklet
- **BPM analysis** — onset-energy autocorrelation with harmonic reinforcement + comb-filter beat phase estimation, in a Web Worker
- **Stem separation** — spawned `audio-separator` CLI (Demucs / BS-Roformer models), cached per track+model in the app's data dir

## Roadmap

- Headphone cue / pre-listen on a second audio device
- Scratch/jog wheel and slip mode
- Musical key detection + harmonic mixing hints
- FX section (delay, reverb, echo-out)
- Beatgrid editing
- MIDI controller mapping
- Packaged installers (dmg/exe)

PRs welcome!

## License

[MIT](LICENSE) — the SoundTouch audio processing library used for keylock is [LGPL-2.1](https://gitlab.com/soundtouch/soundtouch) via SoundTouchJS.
