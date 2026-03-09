import { useEffect, useRef } from 'react'

// ── Easing ────────────────────────────────────────────────────────────────────
function easeOutExpo(t)    { return t === 1 ? 1 : 1 - Math.pow(2, -10 * t) }
function easeInExpo(t)     { return t === 0 ? 0 : Math.pow(2, 10 * t - 10) }
function easeInQuad(t)     { return t * t }
function easeWave(t)       { return t - Math.sin(4 * Math.PI * t) / (4 * Math.PI) }

// ── Palette ───────────────────────────────────────────────────────────────────
// Blue shades for "i" and "CP", white/grey shades for "Top" and "Toolkit"
const BLUE_COLOURS  = ['#60a5fa', '#93c5fd', '#3b82f6', '#bfdbfe', '#7dd3fc', '#a3c4fd']
const WHITE_COLOURS = ['#ffffff', '#f4f4f4', '#e0e0e0', '#cccccc', '#b8b8b8', '#d4d4d4']

function randBlue()  { return BLUE_COLOURS[Math.floor(Math.random() * BLUE_COLOURS.length)] }
function randWhite() { return WHITE_COLOURS[Math.floor(Math.random() * WHITE_COLOURS.length)] }

// Assign colour based on which text segment the pixel belongs to:
//   "i" → blue  |  "Top" → white  |  "CP" → blue  |  "Toolkit" → white
function segmentColour(tx, segBoundaries) {
  if (tx < segBoundaries[0]) return randBlue()   // "i"
  if (tx < segBoundaries[1]) return randWhite()  // "Top"
  if (tx < segBoundaries[2]) return randBlue()   // "CP"
  return randWhite()                             // "Toolkit"
}

const PHASE_DURATION = { 'fly-in': 2000, hold: 900, 'blow-away-line': 500, 'blow-away': 1400, fade: 600 }
const NEXT_PHASE     = { 'fly-in': 'hold', hold: 'blow-away-line', 'blow-away-line': 'blow-away', 'blow-away': 'fade' }

// ── Font loading ──────────────────────────────────────────────────────────────
async function loadNunito() {
  try {
    const font = new FontFace(
      'Nunito',
      'url(https://fonts.gstatic.com/s/nunito/v26/XRXI3I6Li01BKofiOc5wtlZ2di8HDDshRTM9jo7eTWk.woff2)',
      { weight: '900', style: 'normal' }
    )
    await font.load()
    document.fonts.add(font)
  } catch (_) { /* fall back to monospace */ }
}

// ── Sample text pixels ────────────────────────────────────────────────────────
function sampleTextPixels(W, H) {
  const off = document.createElement('canvas')
  off.width = W; off.height = H
  const ctx = off.getContext('2d')
  const fontSize = Math.min(W / 6.5, 140)
  ctx.font = `900 ${fontSize}px 'Nunito', 'Courier New', monospace`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  // Draw full text in white to sample all pixels
  ctx.fillStyle = '#fff'
  ctx.fillText('iTopCPToolkit', W / 2, H / 2)

  const metrics    = ctx.measureText('iTopCPToolkit')
  const textW      = metrics.width
  const textLeft   = W / 2 - textW / 2
  const textRight  = W / 2 + textW / 2
  const underlineY = H / 2 + fontSize * 0.60
  const underlineT = Math.max(10, fontSize * 0.13)

  // Compute x-boundaries for each segment: "i", "iTop", "iTopCP"
  // Pixels left of boundary[0] → "i", between [0] and [1] → "Top", etc.
  const segBoundaries = ['i', 'iTop', 'iTopCP'].map(seg => textLeft + ctx.measureText(seg).width)

  const data = ctx.getImageData(0, 0, W, H).data
  const pts  = []
  const step = 3
  for (let y = 0; y < H; y += step)
    for (let x = 0; x < W; x += step)
      if (data[(y * W + x) * 4 + 3] > 128) pts.push({ x, y })

  return { pts, textLeft, textRight, underlineY, underlineT, fontSize, segBoundaries }
}

// ── Letter particles ──────────────────────────────────────────────────────────
function buildLetterParticles(W, H, pts, segBoundaries) {
  const maxPts = 2400
  const thin   = Math.max(1, Math.floor(pts.length / maxPts))
  return pts.filter((_, i) => i % thin === 0).map(t => {
    const angle     = Math.random() * Math.PI * 2
    const radius    = 0.38 * Math.sqrt(W * W + H * H) + Math.random() * 180
    const blowAngle = -Math.PI / 4 + (Math.random() - 0.5) * 1.2
    const blowSpeed = 600 + Math.random() * 900
    return {
      x:  W / 2 + Math.cos(angle) * radius,
      y:  H / 2 + Math.sin(angle) * radius,
      sx: W / 2 + Math.cos(angle) * radius,
      sy: H / 2 + Math.sin(angle) * radius,
      tx: t.x, ty: t.y,
      blowVx: Math.cos(blowAngle) * blowSpeed,
      blowVy: Math.sin(blowAngle) * blowSpeed - 50 * Math.random(),
      blowSx: 0, blowSy: 0,
      colour: segmentColour(t.x, segBoundaries),
      size:   0.7 + Math.random() * 0.9,
      delay:  Math.random() * 0.35,
      freq:   2 + Math.random() * 3,
      amp:    0.4 + Math.random() * 0.6,
    }
  })
}

// ── Underline particles ───────────────────────────────────────────────────────
function buildUnderlineParticles(textLeft, textRight, underlineY, underlineT) {
  const count = 300
  return Array.from({ length: count }, (_, i) => {
    const frac      = i / (count - 1)
    const tx        = textLeft + frac * (textRight - textLeft)
    const ty        = underlineY + (Math.random() - 0.5) * underlineT
    const arrivalT  = 0.20 + frac * 0.65
    const window    = 0.14
    const blowSpeed = 2200 + Math.random() * 600
    const blowAngle = (Math.random() - 0.5) * 0.06
    return {
      x: textLeft - 80, y: ty,
      sx: textLeft - 80, sy: ty,
      tx, ty, frac, arrivalT, window,
      blowVx: Math.cos(blowAngle) * blowSpeed,
      blowVy: Math.sin(blowAngle) * blowSpeed,
      blowSx: 0, blowSy: 0,
      colour: randBlue(),   // underline is blue (accent color)
      size:   1.0 + Math.random() * 1.2,
      freq:   2 + Math.random() * 3,
      amp:    0.3 + Math.random() * 0.5,
    }
  })
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function SplashScreen({ onDone, version }) {
  const canvasRef = useRef(null)

  // Escape key skips the splash immediately
  useEffect(() => {
    function handleKey(e) {
      if (e.key === 'Escape') onDone()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onDone])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const dpr = window.devicePixelRatio || 1
    const W   = canvas.offsetWidth
    const H   = canvas.offsetHeight
    canvas.width  = W * dpr
    canvas.height = H * dpr

    let raf  = null
    let dead = false

    async function start() {
      await loadNunito()
      if (dead) return

      const { pts, textLeft, textRight, underlineY, underlineT, fontSize, segBoundaries } =
        sampleTextPixels(W, H)
      const sampleMemo = { underlineY, fontSize }
      const letterParts    = buildLetterParticles(W, H, pts, segBoundaries)
      const underlineParts = buildUnderlineParticles(textLeft, textRight, underlineY, underlineT)

      const s = { phase: 'fly-in', phaseStart: null, lastTs: null }

      function animate(ts) {
        if (dead) return
        const c  = canvas.getContext('2d')
        const dt = s.lastTs ? (ts - s.lastTs) / 1000 : 0
        s.lastTs = ts
        if (!s.phaseStart) s.phaseStart = ts

        const elapsed = ts - s.phaseStart
        const dur     = PHASE_DURATION[s.phase]
        const rawT    = Math.min(elapsed / dur, 1)

        // Phase transition
        if (rawT >= 1 && s.phase !== 'fade') {
          const next = NEXT_PHASE[s.phase]
          if (next === 'blow-away-line') {
            underlineParts.forEach(p => { p.blowSx = p.x; p.blowSy = p.y })
          }
          if (next === 'blow-away' || next === 'fade') {
            letterParts.forEach(p => { p.blowSx = p.x; p.blowSy = p.y })
            underlineParts.forEach(p => { p.blowSx = p.x; p.blowSy = p.y })
          }
          s.phase = next; s.phaseStart = ts
          raf = requestAnimationFrame(animate)
          return
        }

        if (s.phase === 'fade' && rawT >= 1) { dead = true; onDone(); return }

        // ── Clear ──────────────────────────────────────────────────────────
        c.save()
        c.scale(dpr, dpr)
        const trailing = s.phase === 'blow-away-line' || s.phase === 'blow-away' || s.phase === 'fade'
        if (trailing) {
          c.fillStyle = 'rgba(10,14,26,0.82)'
        } else {
          c.fillStyle = '#0a0e1a'
        }
        c.fillRect(0, 0, W, H)
        if (s.phase === 'fade') c.globalAlpha = 1 - easeOutExpo(rawT)

        // ── Letter particles ───────────────────────────────────────────────
        letterParts.forEach(p => {
          if (s.phase === 'fly-in') {
            const t = Math.max(0, Math.min((rawT - p.delay) / (1 - p.delay), 1))
            const e = easeOutExpo(t)
            p.x = p.sx + (p.tx - p.sx) * e
            p.y = p.sy + (p.ty - p.sy) * e
          }
          if (s.phase === 'hold' || s.phase === 'blow-away-line') {
            const osc = Math.sin(rawT * Math.PI * 2 * p.freq) * p.amp
            p.x = p.tx + osc; p.y = p.ty + osc * 0.5
          }
          if (s.phase === 'blow-away') {
            const e = easeInExpo(rawT)
            p.x = p.blowSx + p.blowVx * e * dur / 1000
            p.y = p.blowSy + p.blowVy * e * dur / 1000
          }
          if (s.phase === 'fade') { p.x += p.blowVx * dt; p.y += p.blowVy * dt }

          c.beginPath()
          c.arc(p.x, p.y, p.size, 0, Math.PI * 2)
          c.fillStyle   = p.colour
          c.shadowColor = p.colour
          c.shadowBlur  = 6
          c.fill()
          c.shadowBlur  = 0
        })

        // ── Underline particles ────────────────────────────────────────────
        underlineParts.forEach(p => {
          if (s.phase === 'fly-in') {
            const localT = Math.max(0, Math.min((rawT - p.arrivalT) / p.window, 1))
            const e = easeWave(localT)
            p.x = p.sx + (p.tx - p.sx) * e
            p.y = p.sy + (p.ty - p.sy) * e
          }
          if (s.phase === 'hold') {
            const osc = Math.sin(rawT * Math.PI * 2 * p.freq + p.frac * Math.PI) * p.amp
            p.x = p.tx + osc * 0.3; p.y = p.ty
          }
          if (s.phase === 'blow-away-line') {
            const e = easeInQuad(rawT)
            p.x = p.blowSx + p.blowVx * e * dur / 1000
            p.y = p.blowSy + p.blowVy * e * dur / 1000
          }
          if (s.phase === 'blow-away') {
            p.x = p.blowSx + p.blowVx * rawT * dur / 1000
            p.y = p.blowSy + p.blowVy * rawT * dur / 1000
          }
          if (s.phase === 'fade') { p.x += p.blowVx * dt; p.y += p.blowVy * dt }

          if (p.x > W + 20 || p.x < -20) return

          c.beginPath()
          c.arc(p.x, p.y, p.size, 0, Math.PI * 2)
          c.fillStyle   = p.colour
          c.shadowColor = p.colour
          c.shadowBlur  = 5
          c.fill()
          c.shadowBlur  = 0
        })

        // ── Version subtitle ───────────────────────────────────────────────
        if (version && (s.phase === 'hold' || s.phase === 'blow-away-line')) {
          let subtitleAlpha = 0
          if (s.phase === 'hold') {
            if (rawT < 0.4) subtitleAlpha = rawT / 0.4
            else if (rawT < 0.7) subtitleAlpha = 1
            else subtitleAlpha = 1 - (rawT - 0.7) / 0.3
          }
          if (s.phase === 'blow-away-line') subtitleAlpha = 1 - rawT

          if (subtitleAlpha > 0) {
            const { underlineY, fontSize } = sampleMemo
            const subFontSize = Math.round(fontSize * 0.22)
            c.save()
            c.globalAlpha = subtitleAlpha * 0.55
            c.fillStyle   = '#e0e0e0'
            c.font        = `400 ${subFontSize}px 'Nunito', monospace`
            c.textAlign   = 'center'
            c.textBaseline = 'top'
            c.fillText(`v${version}`, W / 2, underlineY + fontSize * 0.18)
            c.restore()
          }
        }

        // ── Escape hint (first 1.5s of fly-in) ────────────────────────────
        if (s.phase === 'fly-in' && rawT < 0.6) {
          const hintAlpha = rawT < 0.3 ? rawT / 0.3 : 1 - (rawT - 0.3) / 0.3
          c.save()
          c.globalAlpha = hintAlpha * 0.35
          c.fillStyle = '#94a3b8'
          c.font = `400 12px monospace`
          c.textAlign = 'center'
          c.textBaseline = 'bottom'
          c.fillText('Press Esc to skip', W / 2, H - 20)
          c.restore()
        }

        c.restore()
        raf = requestAnimationFrame(animate)
      }

      raf = requestAnimationFrame(animate)
    }

    start()
    return () => { dead = true; if (raf) cancelAnimationFrame(raf) }
  }, [onDone])

  return (
    <canvas
      ref={canvasRef}
      onClick={() => {}} // clicking canvas does nothing; use Esc
      style={{
        position: 'fixed', inset: 0,
        width: '100vw', height: '100vh',
        display: 'block', background: '#0a0e1a',
        zIndex: 9999,
        cursor: 'default',
      }}
    />
  )
}
