import { useState } from 'react'

export default function ModeSelector({ onSelect, appVersion, tctVersion, pdflatex }) {
  const [hovered, setHovered] = useState(null)

  const intnoteAvailable = !!tctVersion && !!pdflatex

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center gap-10 px-6">
      {/* Title */}
      <div className="text-center">
        <h1 className="text-4xl font-bold tracking-tight mb-1">
          <span className="text-blue-400">i</span>
          <span className="text-slate-100">Top</span>
          <span className="text-blue-400">CP</span>
          <span className="text-slate-100">Toolkit</span>
        </h1>
        {appVersion && (
          <p className="text-xs text-slate-500 font-mono">v{appVersion}</p>
        )}
      </div>

      {/* Cards */}
      <div className="flex flex-col sm:flex-row gap-5 w-full max-w-3xl">
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
        <ModeCard
          id="intnote"
          icon="✍"
          title="INTnote Writer"
          subtitle="Document"
          description="Generate a LaTeX configuration summary for an ATLAS Internal Note from a TopCPToolkit JSON file."
          accent="amber"
          hovered={hovered}
          onHover={setHovered}
          onSelect={onSelect}
          disabled={!intnoteAvailable}
          disabledReason={
            !tctVersion
              ? 'Requires TopCPToolkit — rebuild image with TCT_VERSION set.'
              : 'Requires pdflatex — rebuild image with texlive installed.'
          }
        />
      </div>

      <p className="text-xs text-slate-600 text-center max-w-sm">
        You can switch modes at any time using the header.
      </p>
    </div>
  )
}

function ModeCard({ id, icon, title, subtitle, description, accent, hovered, onHover, onSelect, disabled, disabledReason }) {
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
    amber: {
      border: isHovered && !disabled ? 'border-amber-500' : 'border-slate-700',
      bg: isHovered && !disabled ? 'bg-amber-600 text-white' : 'bg-slate-700 text-slate-300',
      iconBg: 'bg-amber-500/10 text-amber-400',
      subtitleColor: 'text-amber-400',
      ring: 'focus:ring-amber-500',
    },
  }[accent]

  return (
    <button
      type="button"
      onClick={() => !disabled && onSelect(id)}
      onMouseEnter={() => onHover(id)}
      onMouseLeave={() => onHover(null)}
      disabled={disabled}
      className={`flex-1 text-left rounded-2xl border-2 ${accentClasses.border} bg-slate-800 p-6 flex flex-col gap-4 transition-all duration-200 ${accentClasses.ring} focus:outline-none focus:ring-2
        ${disabled
          ? 'opacity-50 cursor-not-allowed'
          : 'hover:-translate-y-0.5 hover:shadow-2xl'
        }`}
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

      {disabled && disabledReason ? (
        <div className="mt-auto text-xs text-slate-500 bg-slate-700/50 rounded-lg px-3 py-2 leading-relaxed">
          ⚠ {disabledReason}
        </div>
      ) : (
        <div className={`mt-auto self-start px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors ${accentClasses.bg}`}>
          Open →
        </div>
      )}
    </button>
  )
}
