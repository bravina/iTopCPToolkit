import { v4 as uuid } from 'uuid'

export const SIGNS = ['<', '>', '==', '>=', '<=']

function isSign(t) { return SIGNS.includes(t) }

function parseLine(line) {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#') || trimmed === 'SAVE') return null

  const parts = trimmed.split(/\s+/)
  const keyword = parts[0]
  const rest = parts.slice(1)
  const signIdx = rest.findIndex(isSign)

  try {
    switch (keyword) {
      case 'OS': case 'SS':
        return { id: uuid(), keyword, args: {} }

      case 'GLOBALTRIGMATCH':
        return { id: uuid(), keyword, args: { postfix: rest[0] || '' } }

      case 'EVENTFLAG':
        return { id: uuid(), keyword, args: { sel: rest.join(' ') } }

      case 'IMPORT':
        return { id: uuid(), keyword, args: { subreg: rest[0] || '' } }

      case 'RUN_NUMBER':
        return { id: uuid(), keyword, args: { sign: rest[0] || '>=', ref: rest[1] || '' } }

      case 'MET': case 'MWT': case 'MET+MWT': case 'MLL':
        return { id: uuid(), keyword, args: { sign: rest[0] || '>=', ref: rest[1] || '' } }

      case 'MLLWINDOW': case 'MLL_OSSF':
        return { id: uuid(), keyword, args: {
          low: rest[0] || '', high: rest[1] || '',
          veto: rest[2]?.toLowerCase() === 'veto',
        }}

      case 'EL_N': case 'MU_N': case 'JET_N': case 'LJET_N': case 'PH_N': case 'TAU_N':
        if (signIdx === 1)
          return { id: uuid(), keyword, args: { sel: '', ptmin: rest[0], sign: rest[1], count: rest[2] || '' } }
        if (signIdx === 2)
          return { id: uuid(), keyword, args: { sel: rest[0], ptmin: rest[1], sign: rest[2], count: rest[3] || '' } }
        break

      case 'LJETMASS_N':
        if (signIdx === 1)
          return { id: uuid(), keyword, args: { sel: '', massmin: rest[0], sign: rest[1], count: rest[2] || '' } }
        if (signIdx === 2)
          return { id: uuid(), keyword, args: { sel: rest[0], massmin: rest[1], sign: rest[2], count: rest[3] || '' } }
        break

      case 'LJETMASSWINDOW_N': {
        const vetoFlag = rest[rest.length - 1]?.toLowerCase() === 'veto'
        const r = vetoFlag ? rest.slice(0, -1) : rest
        const si = r.findIndex(isSign)
        if (si === 2)
          return { id: uuid(), keyword, args: { sel: '', low: r[0], high: r[1], sign: r[2], count: r[3] || '', veto: vetoFlag } }
        if (si === 3)
          return { id: uuid(), keyword, args: { sel: r[0], low: r[1], high: r[2], sign: r[3], count: r[4] || '', veto: vetoFlag } }
        break
      }

      case 'JET_N_BTAG':
        if (signIdx === 0)
          return { id: uuid(), keyword, args: { sel: '', btag: '', sign: rest[0], count: rest[1] || '' } }
        if (signIdx === 1)
          return rest[0].includes(':')
            ? { id: uuid(), keyword, args: { sel: '', btag: rest[0], sign: rest[1], count: rest[2] || '' } }
            : { id: uuid(), keyword, args: { sel: rest[0], btag: '', sign: rest[1], count: rest[2] || '' } }
        if (signIdx === 2)
          return { id: uuid(), keyword, args: { sel: rest[0], btag: rest[1], sign: rest[2], count: rest[3] || '' } }
        break

      case 'JET_N_GHOST': case 'LJET_N_GHOST':
        if (signIdx === 1)
          return { id: uuid(), keyword, args: { ghost: rest[0], ptmin: '', sign: rest[1], count: rest[2] || '' } }
        if (signIdx === 2)
          return { id: uuid(), keyword, args: { ghost: rest[0], ptmin: rest[1], sign: rest[2], count: rest[3] || '' } }
        break

      case 'SUM_EL_N_MU_N':
        if (signIdx === 1)
          return { id: uuid(), keyword, args: { selEL: '', selMU: '', ptminEL: rest[0], ptminMU: rest[0], sign: rest[1], count: rest[2] || '' } }
        if (signIdx === 2)
          return { id: uuid(), keyword, args: { selEL: '', selMU: '', ptminEL: rest[0], ptminMU: rest[1], sign: rest[2], count: rest[3] || '' } }
        if (signIdx === 4)
          return { id: uuid(), keyword, args: { selEL: rest[0], selMU: rest[1], ptminEL: rest[2], ptminMU: rest[3], sign: rest[4], count: rest[5] || '' } }
        break

      case 'SUM_EL_N_MU_N_TAU_N':
        if (signIdx === 1)
          return { id: uuid(), keyword, args: { selEL: '', selMU: '', selTAU: '', ptminEL: rest[0], ptminMU: rest[0], ptminTAU: rest[0], sign: rest[1], count: rest[2] || '' } }
        if (signIdx === 3)
          return { id: uuid(), keyword, args: { selEL: '', selMU: '', selTAU: '', ptminEL: rest[0], ptminMU: rest[1], ptminTAU: rest[2], sign: rest[3], count: rest[4] || '' } }
        if (signIdx === 6)
          return { id: uuid(), keyword, args: { selEL: rest[0], selMU: rest[1], selTAU: rest[2], ptminEL: rest[3], ptminMU: rest[4], ptminTAU: rest[5], sign: rest[6], count: rest[7] || '' } }
        break

      case 'OBJ_N':
        if (signIdx === 2)
          return { id: uuid(), keyword, args: { obj: rest[0], ptmin: rest[1], sign: rest[2], count: rest[3] || '' } }
        break
    }
  } catch (_) { /* fall through */ }

  return { id: uuid(), keyword: '__raw__', args: { rawText: trimmed } }
}

export function parseSelectionCutsString(str) {
  if (!str) return []
  return str.split('\n').map(parseLine).filter(Boolean)
}

export function parseSelectionCutsDict(value) {
  if (!value || typeof value !== 'object') return []
  return Object.entries(value).map(([name, cutsStr]) => ({
    id: uuid(),
    name,
    cuts: parseSelectionCutsString(typeof cutsStr === 'string' ? cutsStr : ''),
  }))
}

export function serializeCut(cut) {
  if (!cut?.keyword) return ''
  const { keyword: kw, args } = cut
  switch (kw) {
    case '__raw__': return args.rawText || ''
    case 'OS': return 'OS'
    case 'SS': return 'SS'
    case 'GLOBALTRIGMATCH': return args.postfix ? `GLOBALTRIGMATCH ${args.postfix}` : 'GLOBALTRIGMATCH'
    case 'EVENTFLAG': return `EVENTFLAG ${args.sel || ''}`
    case 'IMPORT': return `IMPORT ${args.subreg || ''}`
    case 'RUN_NUMBER': return `RUN_NUMBER ${args.sign || '>='} ${args.ref || ''}`
    case 'MET': case 'MWT': case 'MET+MWT': case 'MLL':
      return `${kw} ${args.sign || '>='} ${args.ref || ''}`
    case 'MLLWINDOW': case 'MLL_OSSF': {
      const p = [kw, args.low || '', args.high || '']
      if (args.veto) p.push('veto')
      return p.join(' ')
    }
    case 'EL_N': case 'MU_N': case 'JET_N': case 'LJET_N': case 'PH_N': case 'TAU_N': {
      const p = [kw]
      if (args.sel) p.push(args.sel)
      p.push(args.ptmin || '', args.sign || '>=', args.count || '')
      return p.join(' ')
    }
    case 'LJETMASS_N': {
      const p = [kw]
      if (args.sel) p.push(args.sel)
      p.push(args.massmin || '', args.sign || '>=', args.count || '')
      return p.join(' ')
    }
    case 'LJETMASSWINDOW_N': {
      const p = [kw]
      if (args.sel) p.push(args.sel)
      p.push(args.low || '', args.high || '', args.sign || '>=', args.count || '')
      if (args.veto) p.push('veto')
      return p.join(' ')
    }
    case 'JET_N_BTAG': {
      const p = [kw]
      if (args.sel) p.push(args.sel)
      if (args.btag) p.push(args.btag)
      p.push(args.sign || '>=', args.count || '')
      return p.join(' ')
    }
    case 'JET_N_GHOST': case 'LJET_N_GHOST': {
      const p = [kw, args.ghost || 'B']
      if (args.ptmin) p.push(args.ptmin)
      p.push(args.sign || '>=', args.count || '')
      return p.join(' ')
    }
    case 'SUM_EL_N_MU_N': {
      const hasSel = args.selEL || args.selMU
      const p = [kw]
      if (hasSel) {
        p.push(args.selEL || '', args.selMU || '', args.ptminEL || '', args.ptminMU || '')
      } else if (args.ptminEL === args.ptminMU && args.ptminEL) {
        p.push(args.ptminEL)
      } else {
        p.push(args.ptminEL || '', args.ptminMU || '')
      }
      p.push(args.sign || '>=', args.count || '')
      return p.join(' ')
    }
    case 'SUM_EL_N_MU_N_TAU_N': {
      const hasSel = args.selEL || args.selMU || args.selTAU
      const samePt = args.ptminEL && args.ptminEL === args.ptminMU && args.ptminEL === args.ptminTAU
      const p = [kw]
      if (hasSel) {
        p.push(args.selEL || '', args.selMU || '', args.selTAU || '', args.ptminEL || '', args.ptminMU || '', args.ptminTAU || '')
      } else if (samePt) {
        p.push(args.ptminEL)
      } else {
        p.push(args.ptminEL || '', args.ptminMU || '', args.ptminTAU || '')
      }
      p.push(args.sign || '>=', args.count || '')
      return p.join(' ')
    }
    case 'OBJ_N':
      return `OBJ_N ${args.obj || ''} ${args.ptmin || ''} ${args.sign || '>='} ${args.count || ''}`
    default: return ''
  }
}

export function cutsToRawText(cuts) {
  const lines = cuts.map(serializeCut).filter(l => l && l.trim() !== 'SAVE')
  return lines.join('\n') + '\nSAVE'
}

export function serializeSelectionCutsDict(selections) {
  if (!selections?.length) return null
  const result = {}
  for (const sel of selections) {
    if (!sel.name) continue
    result[sel.name] = cutsToRawText(sel.cuts) + '\n'
  }
  return Object.keys(result).length ? result : null
}
