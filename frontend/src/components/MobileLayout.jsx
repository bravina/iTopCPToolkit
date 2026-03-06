/**
 * Mobile layout: three tabs at the bottom.
 * Renders only the active tab's content to save memory.
 */
export default function MobileLayout({ sidebar, editor, preview }) {
  const tabs = [
    { id: 'blocks',   label: 'Blocks',   icon: '☰', content: sidebar  },
    { id: 'editor',  label: 'Config',   icon: '⚙', content: editor   },
    { id: 'preview', label: 'YAML',     icon: '📄', content: preview  },
  ]
  const [active, setActive] = useState('editor')

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Active panel */}
      <div className="flex-1 overflow-hidden">
        {tabs.find(t => t.id === active)?.content}
      </div>

      {/* Tab bar */}
      <nav className="shrink-0 flex border-t border-slate-700 bg-slate-800">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActive(tab.id)}
            className={`flex-1 py-2 flex flex-col items-center gap-0.5 text-xs transition-colors ${
              active === tab.id
                ? 'text-blue-400 border-t-2 border-blue-400'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <span className="text-base leading-none">{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </nav>
    </div>
  )
}

// useState is needed — import it at top
import { useState } from 'react'
