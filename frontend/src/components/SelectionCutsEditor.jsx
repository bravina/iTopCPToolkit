import { v4 as uuid } from 'uuid'
import CutRowForm, { defaultArgs } from './CutRowForm.jsx'

export default function SelectionCutsEditor({ cuts, onChange, allSelectionNames, currentSelectionName }) {
  function addCut() {
    onChange([...cuts, { id: uuid(), keyword: 'EL_N', args: defaultArgs('EL_N') }])
  }

  function updateCut(id, updated) {
    onChange(cuts.map(c => c.id === id ? updated : c))
  }

  function deleteCut(id) {
    onChange(cuts.filter(c => c.id !== id))
  }

  function moveCut(id, dir) {
    const idx = cuts.findIndex(c => c.id === id)
    if (idx + dir < 0 || idx + dir >= cuts.length) return
    const next = [...cuts]
    const [removed] = next.splice(idx, 1)
    next.splice(idx + dir, 0, removed)
    onChange(next)
  }

  return (
    <div className="p-2 space-y-1">
      {cuts.length === 0 && (
        <p className="text-xs text-slate-500 italic px-2 py-1">No cuts — click "+ Add cut" below.</p>
      )}

      {cuts.map((cut, idx) => (
        <CutRowForm
          key={cut.id}
          cut={cut}
          onChange={updated => updateCut(cut.id, updated)}
          onDelete={() => deleteCut(cut.id)}
          onMoveUp={() => moveCut(cut.id, -1)}
          onMoveDown={() => moveCut(cut.id, 1)}
          canMoveUp={idx > 0}
          canMoveDown={idx < cuts.length - 1}
          allSelectionNames={allSelectionNames}
          currentSelectionName={currentSelectionName}
        />
      ))}

      {/* SAVE terminal row */}
      <div className="flex items-center gap-2 px-2 py-1 rounded bg-slate-800/40 border border-slate-700/50">
        <span className="text-xs font-mono font-bold text-green-400">SAVE</span>
        <span className="text-xs text-slate-600 italic">auto-appended</span>
      </div>

      <button
        type="button"
        onClick={addCut}
        className="mt-0.5 text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1 px-2"
      >
        + Add cut
      </button>
    </div>
  )
}
