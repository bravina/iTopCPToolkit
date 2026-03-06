import { useEffect, useRef } from 'react'

// ── Easing ────────────────────────────────────────────────────────────────────
function easeOutExpo(t)    { return t === 1 ? 1 : 1 - Math.pow(2, -10 * t) }
function easeInExpo(t)     { return t === 0 ? 0 : Math.pow(2, 10 * t - 10) }
function easeInQuad(t)     { return t * t }
function easeWave(t)       { return t - Math.sin(4 * Math.PI * t) / (4 * Math.PI) }

// ── Palette ───────────────────────────────────────────────────────────────────
const COLOURS = ['#ffffff', '#f4f4f4', '#e0e0e0', '#cccccc', '#b8b8b8', '#d4d4d4']
function randColour() { return COLOURS[Math.floor(Math.random() * COLOURS.length)] }

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
  ctx.fillStyle = '#fff'
  ctx.font = `900 ${fontSize}px 'Nunito', 'Courier New', monospace`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('iTopCPToolkit', W / 2, H / 2)

  const metrics    = ctx.measureText('iTopCPToolkit')
  const textW      = metrics.width
  const textLeft   = W / 2 - textW / 2
  const textRight  = W / 2 + textW / 2
  const underlineY = H / 2 + fontSize * 0.60
  const underlineT = Math.max(10, fontSize * 0.13)

  const data = ctx.getImageData(0, 0, W, H).data
  const pts  = []
  const step = 3   // finer sampling → more particles, denser text shape
  for (let y = 0; y < H; y += step)
    for (let x = 0; x < W; x += step)
      if (data[(y * W + x) * 4 + 3] > 128) pts.push({ x, y })

  return { pts, textLeft, textRight, underlineY, underlineT, fontSize }
}

// ── Letter particles ──────────────────────────────────────────────────────────
function buildLetterParticles(W, H, pts) {
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
      colour: randColour(),
      size:   0.7 + Math.random() * 0.9,   // finer
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
    // Stagger: spread arrivals across 0.2 → 0.85 of fly-in, left-to-right
    const arrivalT  = 0.20 + frac * 0.65
    const window    = 0.14
    // Blow-away: sweep rightward across full screen, slight vertical spread
    const blowSpeed = 2200 + Math.random() * 600
    const blowAngle = (Math.random() - 0.5) * 0.06   // very nearly horizontal
    return {
      x: textLeft - 80, y: ty,
      sx: textLeft - 80, sy: ty,
      tx, ty, frac, arrivalT, window,
      blowVx: Math.cos(blowAngle) * blowSpeed,
      blowVy: Math.sin(blowAngle) * blowSpeed,
      blowSx: 0, blowSy: 0,
      colour: randColour(),
      size:   1.0 + Math.random() * 1.2,   // visible line
      freq:   2 + Math.random() * 3,
      amp:    0.3 + Math.random() * 0.5,
    }
  })
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function SplashScreen({ onDone, version }) {
  const canvasRef = useRef(null)

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

      const { pts, textLeft, textRight, underlineY, underlineT, fontSize } = sampleTextPixels(W, H)
      const sampleMemo = { underlineY, fontSize }
      const letterParts    = buildLetterParticles(W, H, pts)
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
            // Snapshot letters; also re-snapshot underline from their current
            // (already off-screen) position so they don't jump back to origin
            letterParts.forEach(p => { p.blowSx = p.x; p.blowSy = p.y })
            underlineParts.forEach(p => { p.blowSx = p.x; p.blowSy = p.y })
          }
          s.phase = next; s.phaseStart = ts
          raf = requestAnimationFrame(animate)
          return
        }

        if (s.phase === 'fade' && rawT >= 1) { dead = true; onDone(); return }

        // ── Clear — semi-transparent during blow phases for comet trails ──
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
          c.shadowColor = '#ffffff'
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
            p.x = p.tx + osc * 0.3; p.y = p.ty   // no vertical drift
          }
          if (s.phase === 'blow-away-line') {
            const e = easeInQuad(rawT)
            p.x = p.blowSx + p.blowVx * e * dur / 1000
            p.y = p.blowSy + p.blowVy * e * dur / 1000
          }
          if (s.phase === 'blow-away') {
            // already off-screen — just keep pushing so trails clear
            p.x = p.blowSx + p.blowVx * rawT * dur / 1000
            p.y = p.blowSy + p.blowVy * rawT * dur / 1000
          }
          if (s.phase === 'fade') { p.x += p.blowVx * dt; p.y += p.blowVy * dt }

          // skip drawing if clearly off-screen
          if (p.x > W + 20 || p.x < -20) return

          c.beginPath()
          c.arc(p.x, p.y, p.size, 0, Math.PI * 2)
          c.fillStyle   = p.colour
          c.shadowColor = '#ffffff'
          c.shadowBlur  = 5
          c.fill()
          c.shadowBlur  = 0
        })

        // ── Version subtitle ───────────────────────────────────────────────
        if (version && (s.phase === 'hold' || s.phase === 'blow-away-line')) {
          // Fade in over first 40% of hold, stay, then fade out over last 30%
          let subtitleAlpha = 0
          if (s.phase === 'hold') {
            if (rawT < 0.4) subtitleAlpha = rawT / 0.4
            else if (rawT < 0.7) subtitleAlpha = 1
            else subtitleAlpha = 1 - (rawT - 0.7) / 0.3
          }
          // Keep visible (but fading) while line blows away
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
      style={{
        position: 'fixed', inset: 0,
        width: '100vw', height: '100vh',
        display: 'block', background: '#0a0e1a',
        zIndex: 9999,
      }}
    />
  )
}
