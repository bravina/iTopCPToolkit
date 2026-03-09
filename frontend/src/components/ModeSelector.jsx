import { useState } from 'react'

export default function ModeSelector({ onSelect, appVersion }) {
  const [hovered, setHovered] = useState(null)

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center gap-10 px-6">
      {/* Title */}
      <div className="text-center">
        <h1 className="text-4xl font-bold tracking-tight text-slate-100 mb-1">
          i<span className="text-blue-400">Top</span>CPToolkit
        </h1>
        {appVersion && (
          <p className="text-xs text-slate-500 font-mono">v{appVersion}</p>
        )}
      </div>

      {/* Cards */}
      <div className="flex flex-col sm:flex-row gap-5 w-full max-w-2xl">
        <ModeCard
          id="builder"
          icon="⚙"
          title="Config Builder"
          subtitle="Create"
          description="Build a new YAML configuration from scratch using an interactive block editor."
          accent="blue"
          hovered={hovered}
          onHover={setHovered}
          onSelect={onSelect}
        />
        <ModeCard
          id="reader"
          icon="◎"
          title="Config Reader"
          subtitle="Inspect"
          description="Load an existing YAML configuration to inspect, validate, annotate, or diff."
          accent="emerald"
          hovered={hovered}
          onHover={setHovered}
          onSelect={onSelect}
        />
      </div>

      <p className="text-xs text-slate-600 text-center max-w-sm">
        You can switch modes at any time using the header.
      </p>
    </div>
  )
}

function ModeCard({ id, icon, title, subtitle, description, accent, hovered, onHover, onSelect }) {
  const isHovered = hovered === id
  const accentClasses = {
    blue: {
      border: isHovered ? 'border-blue-500' : 'border-slate-700',
      bg: isHovered ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300',
      iconBg: 'bg-blue-500/10 text-blue-400',
      subtitleColor: 'text-blue-400',
      ring: 'focus:ring-blue-500',
    },
    emerald: {
      border: isHovered ? 'border-emerald-500' : 'border-slate-700',
      bg: isHovered ? 'bg-emerald-600 text-white' : 'bg-slate-700 text-slate-300',
      iconBg: 'bg-emerald-500/10 text-emerald-400',
      subtitleColor: 'text-emerald-400',
      ring: 'focus:ring-emerald-500',
    },
  }[accent]

  return (
    <button
      type="button"
      onClick={() => onSelect(id)}
      onMouseEnter={() => onHover(id)}
      onMouseLeave={() => onHover(null)}
      className={`flex-1 text-left rounded-2xl border-2 ${accentClasses.border} bg-slate-800 p-6 flex flex-col gap-4 transition-all duration-200 ${accentClasses.ring} focus:outline-none focus:ring-2 hover:-translate-y-0.5 hover:shadow-2xl`}
    >
      <div className={`w-12 h-12 rounded-xl ${accentClasses.iconBg} flex items-center justify-center text-2xl`}>
        {icon}
      </div>

      <div>
        <p className={`text-xs font-semibold uppercase tracking-widest ${accentClasses.subtitleColor} mb-0.5`}>
          {subtitle}
        </p>
        <h2 className="text-xl font-bold text-slate-100">{title}</h2>
      </div>

      <p className="text-sm text-slate-400 leading-relaxed">{description}</p>

      <div className={`mt-auto self-start px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors ${accentClasses.bg}`}>
        Open →
      </div>
    </button>
  )
}
