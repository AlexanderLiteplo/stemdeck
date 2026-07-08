/** Generates build/icon.png (1024x1024, alpha) for electron-builder. Run: npx electron scripts/make-icon.cjs */
const { app, BrowserWindow } = require('electron')
const fs = require('fs')
const path = require('path')

const DRAW = `
const c = document.createElement('canvas')
c.width = 1024; c.height = 1024
const ctx = c.getContext('2d')

// Big Sur-style squircle
const r = 230
ctx.beginPath()
ctx.roundRect(60, 60, 904, 904, r)
const bg = ctx.createLinearGradient(0, 60, 0, 964)
bg.addColorStop(0, '#1b2133')
bg.addColorStop(1, '#0b0d12')
ctx.fillStyle = bg
ctx.fill()
ctx.lineWidth = 10
ctx.strokeStyle = '#7c5cff'
ctx.stroke()

// Two overlapping vinyl discs (deck A cyan, deck B orange)
function disc(x, y, rad, color) {
  ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2)
  ctx.fillStyle = '#10131c'; ctx.fill()
  ctx.lineWidth = 14; ctx.strokeStyle = color; ctx.stroke()
  for (let g = rad - 45; g > rad - 120; g -= 26) {
    ctx.beginPath(); ctx.arc(x, y, g, 0, Math.PI * 2)
    ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(255,255,255,0.10)'; ctx.stroke()
  }
  ctx.beginPath(); ctx.arc(x, y, 34, 0, Math.PI * 2)
  ctx.fillStyle = color; ctx.fill()
}
disc(390, 452, 240, '#39c5ff')
disc(660, 452, 240, '#ff7a39')

// Waveform bars across the bottom
const bars = [30, 60, 42, 88, 55, 100, 70, 46, 92, 60, 36, 78, 50, 96, 64, 40, 84, 58, 30, 70]
const bw = 26, gap = 10, totalW = bars.length * (bw + gap) - gap
let x = (1024 - totalW) / 2
const grad = ctx.createLinearGradient(0, 0, 1024, 0)
grad.addColorStop(0, '#39c5ff')
grad.addColorStop(0.5, '#7c5cff')
grad.addColorStop(1, '#ff7a39')
ctx.fillStyle = grad
for (const h of bars) {
  ctx.beginPath()
  ctx.roundRect(x, 830 - h, bw, h * 2, 12)
  ctx.fill()
  x += bw + gap
}
c.toDataURL('image/png')
`

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false })
  await win.loadURL('data:text/html,<html></html>')
  const dataUrl = await win.webContents.executeJavaScript(DRAW)
  const base64 = dataUrl.replace(/^data:image\/png;base64,/, '')
  const out = path.join(__dirname, '../build/icon.png')
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, Buffer.from(base64, 'base64'))
  console.log('wrote', out)
  app.exit(0)
})
