import { SIGNS } from '../utils/selectionCutsSerializer.js'

const KEYWORD_GROUPS = [
  { label: 'Leptons',       kws: ['EL_N', 'MU_N', 'SUM_EL_N_MU_N', 'SUM_EL_N_MU_N_TAU_N'] },
  { label: 'Jets',          kws: ['JET_N', 'JET_N_BTAG', 'JET_N_GHOST', 'LJET_N', 'LJET_N_GHOST', 'LJETMASS_N', 'LJETMASSWINDOW_N'] },
  { label: 'Photons/Taus',  kws: ['PH_N', 'TAU_N'] },
  { label: 'Generic object',kws: ['OBJ_N'] },
  { label: 'MET / Mass',    kws: ['MET', 'MWT', 'MET+MWT', 'MLL', 'MLLWINDOW', 'MLL_OSSF'] },
  { label: 'Charge',        kws: ['OS', 'SS'] },
  { label: 'Control',       kws: ['IMPORT', 'EVENTFLAG', 'GLOBALTRIGMATCH', 'RUN_NUMBER'] },
  { label: 'Other',         kws: ['__raw__'] },
]

export function defaultArgs(keyword) {
  switch (keyword) {
    case 'OS': case 'SS': return {}
    case 'GLOBALTRIGMATCH': return { postfix: '' }
    case 'EVENTFLAG': return { sel: '' }
    case 'IMPORT': return { subreg: '' }
    case 'RUN_NUMBER': return { sign: '>=', ref: '' }
    case 'MET': case 'MWT': case 'MET+MWT': case 'MLL': return { sign: '>=', ref: '' }
    case 'MLLWINDOW': case 'MLL_OSSF': return { low: '', high: '', veto: false }
    case 'EL_N': case 'MU_N': case 'JET_N': case 'LJET_N': case 'PH_N': case 'TAU_N':
      return { sel: '', ptmin: '', sign: '>=', count: '' }
    case 'LJETMASS_N': return { sel: '', massmin: '', sign: '>=', count: '' }
    case 'LJETMASSWINDOW_N': return { sel: '', low: '', high: '', sign: '>=', count: '', veto: false }
    case 'JET_N_BTAG': return { sel: '', btag: '', sign: '>=', count: '' }
    case 'JET_N_GHOST': case 'LJET_N_GHOST': return { ghost: 'B', ptmin: '', sign: '>=', count: '' }
    case 'SUM_EL_N_MU_N': return { selEL: '', selMU: '', ptminEL: '', ptminMU: '', sign: '>=', count: '' }
    case 'SUM_EL_N_MU_N_TAU_N': return { selEL: '', selMU: '', selTAU: '', ptminEL: '', ptminMU: '', ptminTAU: '', sign: '>=', count: '' }
    case 'OBJ_N': return { obj: '', ptmin: '', sign: '>=', count: '' }
    case '__raw__': return { rawText: '' }
    default: return {}
  }
}

// ── Tiny field helpers ────────────────────────────────────────────────────────

function Txt({ label, value, onChange, placeholder = '', w = 'w-20' }) {
  return (
    <label className="flex items-center gap-1 shrink-0">
      {label && <span className="text-xs text-slate-500 shrink-0">{label}</span>}
      <input
        type="text"
        value={value ?? ''}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className={`${w} rounded bg-slate-700 border border-slate-600 px-1 py-0.5 text-xs font-mono text-slate-100 focus:outline-none focus:border-blue-400`}
      />
    </label>
  )
}

function Num({ label, value, onChange, placeholder = '', w = 'w-20' }) {
  return (
    <label className="flex items-center gap-1 shrink-0">
      {label && <span className="text-xs text-slate-500 shrink-0">{label}</span>}
      <input
        type="number"
        value={value ?? ''}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className={`${w} rounded bg-slate-700 border border-slate-600 px-1 py-0.5 text-xs font-mono text-slate-100 focus:outline-none focus:border-blue-400`}
      />
    </label>
  )
}

function SignPicker({ value, onChange }) {
  return (
    <select
      value={value || '>='}
      onChange={e => onChange(e.target.value)}
      className="rounded bg-slate-700 border border-slate-600 px-1 py-0.5 text-xs font-mono text-slate-100 focus:outline-none focus:border-blue-400 shrink-0"
    >
      {SIGNS.map(s => <option key={s} value={s}>{s}</option>)}
    </select>
  )
}

function Veto({ value, onChange }) {
  return (
    <label className="flex items-center gap-1 text-xs text-slate-400 shrink-0 cursor-pointer">
      <input type="checkbox" checked={!!value} onChange={e => onChange(e.target.checked)} />
      veto
    </label>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function CutRowForm({
  cut, onChange, onDelete, onMoveUp, onMoveDown, canMoveUp, canMoveDown,
  allSelectionNames, currentSelectionName,
}) {
  const { keyword, args } = cut

  function setKeyword(kw) {
    onChange({ ...cut, keyword: kw, args: defaultArgs(kw) })
  }

  function a(key, val) {
    onChange({ ...cut, args: { ...args, [key]: val } })
  }

  function renderArgs() {
    switch (keyword) {
      case 'OS': case 'SS': return null

      case 'GLOBALTRIGMATCH':
        return <Txt label="postfix" value={args.postfix} onChange={v => a('postfix', v)} placeholder="optional" />

      case 'EVENTFLAG':
        return <Txt label="sel" value={args.sel} onChange={v => a('sel', v)} placeholder="decoration_name" w="w-36" />

      case 'IMPORT':
        return (
          <label className="flex items-center gap-1 shrink-0">
            <span className="text-xs text-slate-500">region</span>
            <select
              value={args.subreg || ''}
              onChange={e => a('subreg', e.target.value)}
              className="rounded bg-slate-700 border border-slate-600 px-1 py-0.5 text-xs font-mono text-slate-100 focus:outline-none focus:border-blue-400"
            >
              <option value="">— select —</option>
              {allSelectionNames.filter(n => n !== currentSelectionName).map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        )

      case 'RUN_NUMBER':
        return <>
          <SignPicker value={args.sign} onChange={v => a('sign', v)} />
          <Num label="run#" value={args.ref} onChange={v => a('ref', v)} placeholder="400000" w="w-24" />
        </>

      case 'MET': case 'MWT': case 'MET+MWT': case 'MLL':
        return <>
          <SignPicker value={args.sign} onChange={v => a('sign', v)} />
          <Num label="MeV" value={args.ref} onChange={v => a('ref', v)} placeholder="20000" w="w-24" />
        </>

      case 'MLLWINDOW': case 'MLL_OSSF':
        return <>
          <Num label="low" value={args.low} onChange={v => a('low', v)} placeholder="MeV" w="w-20" />
          <Num label="high" value={args.high} onChange={v => a('high', v)} placeholder="MeV" w="w-20" />
          <Veto value={args.veto} onChange={v => a('veto', v)} />
        </>

      case 'EL_N': case 'MU_N': case 'JET_N': case 'LJET_N': case 'PH_N': case 'TAU_N':
        return <>
          <Txt label="sel" value={args.sel} onChange={v => a('sel', v)} placeholder="opt." w="w-16" />
          <Num label="pT≥" value={args.ptmin} onChange={v => a('ptmin', v)} placeholder="MeV" w="w-20" />
          <SignPicker value={args.sign} onChange={v => a('sign', v)} />
          <Num label="N" value={args.count} onChange={v => a('count', v)} placeholder="1" w="w-12" />
        </>

      case 'LJETMASS_N':
        return <>
          <Txt label="sel" value={args.sel} onChange={v => a('sel', v)} placeholder="opt." w="w-16" />
          <Num label="m≥" value={args.massmin} onChange={v => a('massmin', v)} placeholder="MeV" w="w-20" />
          <SignPicker value={args.sign} onChange={v => a('sign', v)} />
          <Num label="N" value={args.count} onChange={v => a('count', v)} placeholder="1" w="w-12" />
        </>

      case 'LJETMASSWINDOW_N':
        return <>
          <Txt label="sel" value={args.sel} onChange={v => a('sel', v)} placeholder="opt." w="w-16" />
          <Num label="low" value={args.low} onChange={v => a('low', v)} placeholder="MeV" w="w-20" />
          <Num label="high" value={args.high} onChange={v => a('high', v)} placeholder="MeV" w="w-20" />
          <SignPicker value={args.sign} onChange={v => a('sign', v)} />
          <Num label="N" value={args.count} onChange={v => a('count', v)} placeholder="1" w="w-12" />
          <Veto value={args.veto} onChange={v => a('veto', v)} />
        </>

      case 'JET_N_BTAG':
        return <>
          <Txt label="sel" value={args.sel} onChange={v => a('sel', v)} placeholder="opt." w="w-16" />
          <Txt label="tagger:WP" value={args.btag} onChange={v => a('btag', v)} placeholder="opt." w="w-28" />
          <SignPicker value={args.sign} onChange={v => a('sign', v)} />
          <Num label="N" value={args.count} onChange={v => a('count', v)} placeholder="1" w="w-12" />
        </>

      case 'JET_N_GHOST': case 'LJET_N_GHOST':
        return <>
          <Txt label="ghost" value={args.ghost} onChange={v => a('ghost', v)} placeholder="B or B!C" w="w-20" />
          <Num label="pT≥" value={args.ptmin} onChange={v => a('ptmin', v)} placeholder="opt." w="w-20" />
          <SignPicker value={args.sign} onChange={v => a('sign', v)} />
          <Num label="N" value={args.count} onChange={v => a('count', v)} placeholder="1" w="w-12" />
        </>

      case 'SUM_EL_N_MU_N':
        return <>
          <Txt label="selEl" value={args.selEL} onChange={v => a('selEL', v)} placeholder="opt." w="w-14" />
          <Txt label="selMu" value={args.selMU} onChange={v => a('selMU', v)} placeholder="opt." w="w-14" />
          <Num label="pTel" value={args.ptminEL} onChange={v => a('ptminEL', v)} placeholder="MeV" w="w-20" />
          <Num label="pTmu" value={args.ptminMU} onChange={v => a('ptminMU', v)} placeholder="MeV" w="w-20" />
          <SignPicker value={args.sign} onChange={v => a('sign', v)} />
          <Num label="N" value={args.count} onChange={v => a('count', v)} placeholder="1" w="w-12" />
        </>

      case 'SUM_EL_N_MU_N_TAU_N':
        return <>
          <Txt label="selEl" value={args.selEL} onChange={v => a('selEL', v)} placeholder="opt." w="w-14" />
          <Txt label="selMu" value={args.selMU} onChange={v => a('selMU', v)} placeholder="opt." w="w-14" />
          <Txt label="selTau" value={args.selTAU} onChange={v => a('selTAU', v)} placeholder="opt." w="w-14" />
          <Num label="pTel" value={args.ptminEL} onChange={v => a('ptminEL', v)} placeholder="MeV" w="w-20" />
          <Num label="pTmu" value={args.ptminMU} onChange={v => a('ptminMU', v)} placeholder="MeV" w="w-20" />
          <Num label="pTtau" value={args.ptminTAU} onChange={v => a('ptminTAU', v)} placeholder="MeV" w="w-20" />
          <SignPicker value={args.sign} onChange={v => a('sign', v)} />
          <Num label="N" value={args.count} onChange={v => a('count', v)} placeholder="1" w="w-12" />
        </>

      case 'OBJ_N':
        return <>
          <Txt label="container" value={args.obj} onChange={v => a('obj', v)} placeholder="Cont.sel" w="w-28" />
          <Num label="pT≥" value={args.ptmin} onChange={v => a('ptmin', v)} placeholder="MeV" w="w-20" />
          <SignPicker value={args.sign} onChange={v => a('sign', v)} />
          <Num label="N" value={args.count} onChange={v => a('count', v)} placeholder="1" w="w-12" />
        </>

      case '__raw__':
        return (
          <input
            type="text"
            value={args.rawText || ''}
            onChange={e => a('rawText', e.target.value)}
            placeholder="raw cut line..."
            className="flex-1 min-w-0 rounded bg-slate-700 border border-amber-600/50 px-1 py-0.5 text-xs font-mono text-amber-300 focus:outline-none focus:border-amber-400"
          />
        )

      default: return null
    }
  }

  return (
    <div className="flex items-center gap-1.5 px-2 py-1.5 rounded bg-slate-800 hover:bg-slate-750 group flex-wrap">
      {/* Keyword picker */}
      <select
        value={keyword}
        onChange={e => setKeyword(e.target.value)}
        className={`rounded bg-slate-700 border border-slate-600 px-1 py-0.5 text-xs font-mono font-bold focus:outline-none focus:border-blue-400 shrink-0 ${
          keyword === '__raw__' ? 'text-amber-300' : 'text-blue-300'
        }`}
      >
        {KEYWORD_GROUPS.map(g => (
          <optgroup key={g.label} label={g.label}>
            {g.kws.map(kw => (
              <option key={kw} value={kw}>{kw === '__raw__' ? '✎ raw' : kw}</option>
            ))}
          </optgroup>
        ))}
      </select>

      {renderArgs()}

      <div className="flex-1" />

      {/* Row controls — visible on hover */}
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        <button type="button" onClick={onMoveUp} disabled={!canMoveUp}
          className="text-slate-500 hover:text-slate-300 disabled:opacity-20 px-0.5 text-xs leading-none">↑</button>
        <button type="button" onClick={onMoveDown} disabled={!canMoveDown}
          className="text-slate-500 hover:text-slate-300 disabled:opacity-20 px-0.5 text-xs leading-none">↓</button>
        <button type="button" onClick={onDelete}
          className="text-red-500 hover:text-red-300 px-0.5 text-xs leading-none">✕</button>
      </div>
    </div>
  )
}
