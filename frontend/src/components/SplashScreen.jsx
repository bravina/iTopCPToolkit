import { useEffect, useRef } from 'react'

/**
 * Animated splash: dust coalesces left-to-right into "iTopCPToolkit", an
 * underline draws itself, a light sweep passes over the title while the
 * tagline and version appear, then everything dissolves and the canvas fades
 * over the app.
 *
 * Design notes
 *   - `onDone` is kept in a ref so parent re-renders never restart the animation
 *   - the web font is fetched with a timeout; a system font is the fallback
 *   - the title is sized to the viewport width, so it never overflows on phones
 *   - particle glow uses cached sprites instead of per-particle shadowBlur
 *   - click / tap / Esc skip; prefers-reduced-motion shows a short static version
 *   - colours are the app's brand colours, in the theme active when it mounts
 */

// ── Easing ────────────────────────────────────────────────────────────────────
const clamp01 = t => Math.max(0, Math.min(1, t))
function easeOutExpo(t)  { return t === 1 ? 1 : 1 - Math.pow(2, -10 * t) }
function easeInQuad(t)   { return t * t }
function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3) }
function easeWave(t)     { return t - Math.sin(4 * Math.PI * t) / (4 * Math.PI) }

// ── Palettes (match the header brand mark in each theme) ──────────────────────
const PALETTES = {
  dark: {
    bg:       '#0f172a',                              // slate-900
    blue:     [96, 165, 250],                         // blue-400
    ink:      [241, 245, 249],                        // slate-100
    dust:     ['#64748b', '#94a3b8', '#3b82f6'],      // slate-500/400 + blue-500
    vignette: '30,41,59',                             // slate-800
    sweep:    '#ffffff',
    head:     '#dbeafe',                              // blue-100
    tag:      '#94a3b8',                              // slate-400
    meta:     '#64748b',                              // slate-500
  },
  light: {
    bg:       '#f8fafc',                              // slate-50
    blue:     [37, 99, 235],                          // blue-600
    ink:      [15, 23, 42],                           // slate-900
    dust:     ['#94a3b8', '#64748b', '#60a5fa'],      // slate-400/500 + blue-400
    vignette: '148,163,184',                          // slate-400
    sweep:    '#2563eb',                              // blue-600
    head:     '#1d4ed8',                              // blue-700
    tag:      '#475569',                              // slate-600
    meta:     '#64748b',                              // slate-500
  },
}
const paletteFor = dark => (dark ? PALETTES.dark : PALETTES.light)

const SHADES = [0.88, 0.94, 1, 1.05]
const pick = arr => arr[Math.floor(Math.random() * arr.length)]

function shade([r, g, b], f) {
  const cl = v => Math.max(0, Math.min(255, Math.round(v * f)))
  return '#' + [cl(r), cl(g), cl(b)].map(v => v.toString(16).padStart(2, '0')).join('')
}

// "i" → blue | "Top" → ink | "CP" → blue | "Toolkit" → ink
function segmentColour(tx, seg, pal) {
  const blue = tx < seg[0] || (tx >= seg[1] && tx < seg[2])
  return shade(blue ? pal.blue : pal.ink, pick(SHADES))
}

// ── Timeline ──────────────────────────────────────────────────────────────────
const PHASES         = [['fly-in', 1800], ['hold', 1500], ['dissolve', 900], ['fade', 450]]
const REDUCED_PHASES = [['hold', 1500], ['fade', 500]]
const TAGLINE = 'Interactive configuration builder for TopCPToolkit'

// ── Font ──────────────────────────────────────────────────────────────────────
const FONT_STACK = "'Nunito', system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
const FONT_TIMEOUT_MS = 800

async function loadNunito() {
  if (typeof FontFace === 'undefined') return
  try {
    const font = new FontFace(
      'Nunito',
      'url(https://fonts.gstatic.com/s/nunito/v26/XRXI3I6Li01BKofiOc5wtlZ2di8HDDshRTM9jo7eTWk.woff2)',
      { weight: '900', style: 'normal' }
    )
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('font timeout')), FONT_TIMEOUT_MS))
    await Promise.race([font.load(), timeout])
    document.fonts.add(font)
  } catch { /* offline or slow network: system font */ }
}

/** Largest font size (≤ cap) whose rendered title fits in 86 % of the width. */
function fitFontSize(ctx, text, W) {
  ctx.font = `900 100px ${FONT_STACK}`
  const widthAt100 = ctx.measureText(text).width || 1
  return Math.max(26, Math.min(140, W / 6.5, 100 * (0.86 * W) / widthAt100))
}

// ── Glow sprites (replaces shadowBlur, which is very slow per particle) ───────
function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function makeSpriteCache(dpr) {
  const cache = new Map()
  return function sprite(colour, size) {
    const bucket = Math.round(size * 4) / 4
    const key = `${colour}|${bucket}`
    let s = cache.get(key)
    if (s) return s
    const glow = bucket * 3
    const w = Math.ceil(glow * 2)
    const cv = document.createElement('canvas')
    cv.width = cv.height = Math.ceil(w * dpr)
    const g = cv.getContext('2d')
    g.scale(dpr, dpr)
    const [r, gg, b] = hexToRgb(colour)
    const grad = g.createRadialGradient(glow, glow, 0, glow, glow, glow)
    grad.addColorStop(0,    `rgba(${r},${gg},${b},0.85)`)
    grad.addColorStop(0.4,  `rgba(${r},${gg},${b},0.35)`)
    grad.addColorStop(1,    `rgba(${r},${gg},${b},0)`)
    g.fillStyle = grad
    g.fillRect(0, 0, w, w)
    g.beginPath()
    g.arc(glow, glow, bucket, 0, Math.PI * 2)
    g.fillStyle = colour
    g.fill()
    s = { canvas: cv, w, half: glow }
    cache.set(key, s)
    return s
  }
}

// ── Sample text pixels ────────────────────────────────────────────────────────
function sampleTextPixels(W, H) {
  const text = 'iTopCPToolkit'
  const off = document.createElement('canvas')
  off.width = W; off.height = H
  const ctx = off.getContext('2d')
  const fontSize = fitFontSize(ctx, text, W)
  const titleY = H * 0.47
  ctx.font = `900 ${fontSize}px ${FONT_STACK}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#fff'
  ctx.fillText(text, W / 2, titleY)

  const textW      = ctx.measureText(text).width
  const textLeft   = W / 2 - textW / 2
  const textRight  = W / 2 + textW / 2
  const underlineY = titleY + fontSize * 0.58
  const segBoundaries = ['i', 'iTop', 'iTopCP'].map(seg => textLeft + ctx.measureText(seg).width)

  const data = ctx.getImageData(0, 0, W, H).data
  const pts  = []
  const step = fontSize < 90 ? 2 : 3
  for (let y = 0; y < H; y += step)
    for (let x = 0; x < W; x += step)
      if (data[(y * W + x) * 4 + 3] > 128) pts.push({ x, y })

  return { pts, textLeft, textRight, textW, underlineY, fontSize, segBoundaries }
}

// ── Particles ─────────────────────────────────────────────────────────────────
function buildLetterParticles(W, H, pts, textLeft, textW, segBoundaries, reduced, pal) {
  const maxPts = 3600
  const thin   = Math.max(1, Math.floor(pts.length / maxPts))
  return pts.filter((_, i) => i % thin === 0).map(t => {
    const frac = clamp01((t.x - textLeft) / textW)
    const sx = reduced ? t.x : Math.random() * W
    const sy = reduced ? t.y : Math.random() * H
    const a  = Math.random() * Math.PI * 2
    const v  = 25 + Math.random() * 60
    return {
      x: sx, y: sy, sx, sy, tx: t.x, ty: t.y, dx: t.x, dy: t.y,
      colour: segmentColour(t.x, segBoundaries, pal),
      size:   0.85 + Math.random() * 0.5,
      delay:  0.04 + frac * 0.5 + Math.random() * 0.08,   // left-to-right reveal
      dvx:    Math.cos(a) * v,
      dvy:    Math.sin(a) * v - 30,                        // gentle upward drift on dissolve
    }
  })
}

function buildUnderlineParticles(textLeft, textRight, underlineY, reduced, pal) {
  const count = 320
  return Array.from({ length: count }, (_, i) => {
    const frac = i / (count - 1)
    const tx   = textLeft + frac * (textRight - textLeft)
    const ty   = underlineY + (Math.random() - 0.5) * 1.2
    const sx   = reduced ? tx : textLeft - 60
    const a    = Math.random() * Math.PI * 2
    const v    = 20 + Math.random() * 50
    return {
      x: sx, y: ty, sx, sy: ty, tx, ty, dx: tx, dy: ty, frac,
      arrivalT: 0.22 + frac * 0.62, window: 0.12,
      colour: shade(pal.blue, pick(SHADES)),
      size:   1.1 + Math.random() * 0.5,
      dvx:    Math.cos(a) * v,
      dvy:    Math.sin(a) * v - 20,
    }
  })
}

function buildAmbient(W, H, pal) {
  return Array.from({ length: 60 }, () => ({
    x: Math.random() * W, y: Math.random() * H,
    vx: (Math.random() - 0.5) * 12, vy: -4 - Math.random() * 10,
    size: 0.6 + Math.random() * 1.2,
    alpha: 0.08 + Math.random() * 0.22,
    colour: pick(pal.dust),
  }))
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function SplashScreen({ onDone, version, dark = true }) {
  const canvasRef = useRef(null)
  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone
  // Captured once: a theme flip mid-animation must not restart it.
  const darkRef = useRef(dark)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const pal = paletteFor(darkRef.current)

    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    const phases  = reduced ? REDUCED_PHASES : PHASES
    const dpr = window.devicePixelRatio || 1
    const W   = canvas.offsetWidth
    const H   = canvas.offsetHeight
    canvas.width  = W * dpr
    canvas.height = H * dpr

    let raf  = null
    let dead = false
    const finish = () => {
      if (dead) return
      dead = true
      if (raf) cancelAnimationFrame(raf)
      onDoneRef.current?.()
    }
    const onKey = e => { if (e.key === 'Escape') finish() }
    const onTap = () => finish()
    window.addEventListener('keydown', onKey)
    canvas.addEventListener('pointerdown', onTap)

    async function start() {
      await loadNunito()
      if (dead) return

      const { pts, textLeft, textRight, textW, underlineY, fontSize, segBoundaries } = sampleTextPixels(W, H)
      const letters   = buildLetterParticles(W, H, pts, textLeft, textW, segBoundaries, reduced, pal)
      const underline = buildUnderlineParticles(textLeft, textRight, underlineY, reduced, pal)
      const ambient   = buildAmbient(W, H, pal)
      const sprite    = makeSpriteCache(dpr)
      const c = canvas.getContext('2d')

      const vignette = c.createRadialGradient(W / 2, H * 0.42, 0, W / 2, H * 0.42, Math.max(W, H) * 0.75)
      vignette.addColorStop(0, `rgba(${pal.vignette},0.55)`)
      vignette.addColorStop(1, `rgba(${pal.vignette},0)`)

      let phaseIdx = 0, phaseStart = null, lastTs = null

      function draw(p, alpha = 1, colour = p.colour, size = p.size) {
        if (alpha <= 0.01) return
        const s = sprite(colour, size)
        c.globalAlpha = alpha
        c.drawImage(s.canvas, p.x - s.half, p.y - s.half, s.w, s.w)
      }

      function text(str, x, y, { size, colour, alpha, weight = 400, spacing = 0, baseline = 'top' }) {
        if (alpha <= 0.01) return
        c.save()
        c.globalAlpha = alpha
        c.fillStyle = colour
        c.font = `${weight} ${Math.round(size)}px ${FONT_STACK}`
        c.textAlign = 'center'
        c.textBaseline = baseline
        if ('letterSpacing' in c) c.letterSpacing = `${spacing}px`
        c.fillText(str, x, y)
        c.restore()
      }

      function animate(ts) {
        if (dead) return
        const dt = lastTs ? Math.min((ts - lastTs) / 1000, 0.05) : 0
        lastTs = ts
        if (phaseStart === null) phaseStart = ts

        const [phase, dur] = phases[phaseIdx]
        const rawT = clamp01((ts - phaseStart) / dur)

        if (rawT >= 1) {
          if (phase === 'fade') { finish(); return }
          const next = phases[phaseIdx + 1][0]
          if (next === 'dissolve') [...letters, ...underline].forEach(p => { p.dx = p.x; p.dy = p.y })
          phaseIdx += 1; phaseStart = ts
          raf = requestAnimationFrame(animate)
          return
        }

        // Canvas fades out over the app (CSS opacity) rather than to black
        canvas.style.opacity = phase === 'fade' ? String(1 - easeOutCubic(rawT)) : '1'

        c.save()
        c.scale(dpr, dpr)
        c.fillStyle = pal.bg
        c.fillRect(0, 0, W, H)
        c.fillStyle = vignette
        c.fillRect(0, 0, W, H)

        // ── Ambient dust ─────────────────────────────────────────────────────
        for (const p of ambient) {
          if (!reduced) {
            p.x += p.vx * dt; p.y += p.vy * dt
            if (p.y < -5) { p.y = H + 5; p.x = Math.random() * W }
            if (p.x < -5) p.x = W + 5
            if (p.x > W + 5) p.x = -5
          }
          draw(p, p.alpha)
        }

        // ── Letters ──────────────────────────────────────────────────────────
        const sweepOn = phase === 'hold' && rawT > 0.12 && rawT < 0.72
        const sweepX  = textLeft - 0.12 * textW + ((rawT - 0.12) / 0.6) * textW * 1.24
        const sweepW  = 0.09 * textW
        const dissolveA = phase === 'dissolve' ? 1 - easeInQuad(rawT) : 1

        for (const p of letters) {
          let alpha = 1
          if (phase === 'fly-in') {
            const t = clamp01((rawT - p.delay) / (1 - p.delay))
            const e = easeOutExpo(t)
            p.x = p.sx + (p.tx - p.sx) * e
            p.y = p.sy + (p.ty - p.sy) * e
            alpha = 0.18 + 0.82 * e
          } else if (phase === 'hold') {
            p.x = p.tx; p.y = p.ty
          } else if (phase === 'dissolve') {
            const k = easeInQuad(rawT) * dur / 1000
            p.x = p.dx + p.dvx * k; p.y = p.dy + p.dvy * k
            alpha = dissolveA
          } else {
            continue
          }
          draw(p, alpha)
          if (sweepOn) {
            const d = (p.tx - sweepX) / sweepW
            const g = Math.exp(-d * d)
            if (g > 0.05) draw(p, g * 0.75, pal.sweep, p.size * 1.5)
          }
        }

        // ── Underline ────────────────────────────────────────────────────────
        for (const p of underline) {
          let alpha = 1
          if (phase === 'fly-in') {
            const localT = clamp01((rawT - p.arrivalT) / p.window)
            const e = easeWave(localT)
            p.x = p.sx + (p.tx - p.sx) * e
            p.y = p.sy + (p.ty - p.sy) * e
            alpha = localT
          } else if (phase === 'hold') {
            p.x = p.tx; p.y = p.ty
          } else if (phase === 'dissolve') {
            const k = easeInQuad(rawT) * dur / 1000
            p.x = p.dx + p.dvx * k; p.y = p.dy + p.dvy * k
            alpha = dissolveA
          } else {
            continue
          }
          draw(p, alpha)
        }
        if (phase === 'fly-in') {
          const frontier = clamp01((rawT - 0.22) / 0.62)
          if (frontier > 0 && frontier < 1) {
            const head = { x: textLeft + frontier * textW, y: underlineY, colour: pal.head, size: 2.6 }
            draw(head, 0.9)
          }
        }

        // ── Tagline + version ────────────────────────────────────────────────
        let captionA = 0
        if (phase === 'hold') captionA = reduced ? 1 : easeOutCubic(clamp01((rawT - 0.1) / 0.3))
        else if (phase === 'dissolve') captionA = 1 - rawT
        if (captionA > 0) {
          const tagSize = Math.max(11, fontSize * 0.15)
          text(TAGLINE.toUpperCase(), W / 2, underlineY + fontSize * 0.22,
               { size: tagSize, colour: pal.tag, alpha: captionA * 0.9, spacing: tagSize * 0.18 })
          if (version) {
            text(`v${version}`, W / 2, underlineY + fontSize * 0.22 + tagSize * 1.9,
                 { size: Math.max(10, fontSize * 0.13), colour: pal.meta, alpha: captionA * 0.9 })
          }
        }

        // ── Skip hint ────────────────────────────────────────────────────────
        if (phase === 'fly-in' || phase === 'hold') {
          const a = phase === 'fly-in' ? clamp01(rawT / 0.3) : 1 - easeInQuad(rawT)
          text('Click or press Esc to skip', W / 2, H - 20,
               { size: 12, colour: pal.meta, alpha: a * 0.6, baseline: 'bottom' })
        }

        c.restore()
        raf = requestAnimationFrame(animate)
      }

      raf = requestAnimationFrame(animate)
    }

    start()
    return () => {
      dead = true
      if (raf) cancelAnimationFrame(raf)
      window.removeEventListener('keydown', onKey)
      canvas.removeEventListener('pointerdown', onTap)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label="iTopCPToolkit"
      style={{
        position: 'fixed', inset: 0,
        width: '100vw', height: '100vh',
        display: 'block', background: paletteFor(dark).bg,
        zIndex: 9999,
        cursor: 'pointer',
        touchAction: 'none',
      }}
    />
  )
}
