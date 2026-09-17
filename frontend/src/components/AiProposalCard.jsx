/**
 * The review step between a proposal and the config.  The assistant never
 * applies anything: this card is what it produces, and Apply is the user's.
 *
 * Props: proposal (see ai/proposals.js), status, stale, onApply, onReject, onReview
 */
export default function AiProposalCard({ proposal, status = 'pending', stale, onApply, onReject, onReview }) {
  const { summary, kind, labels, stats, issues } = proposal
  const decided = status !== 'pending'

  return (
    <div className={`rounded border text-xs ${decided
      ? 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40'
      : 'border-blue-300 dark:border-blue-700 bg-blue-50/60 dark:bg-blue-900/20'}`}>
      <div className="px-2 py-1.5 flex items-start gap-2 border-b border-slate-200 dark:border-slate-700">
        <span aria-hidden="true">{kind === 'config' ? '📄' : '✎'}</span>
        <div className="min-w-0">
          <p className="font-semibold text-slate-800 dark:text-slate-200 break-words">{summary}</p>
          <p className="text-slate-500">
            {kind === 'config'
              ? `whole configuration — ${labels.length} block${labels.length === 1 ? '' : 's'}`
              : `${labels.length} edit${labels.length === 1 ? '' : 's'}`}
            {' · '}
            <Stat n={stats.added} sign="+" cls="text-emerald-600 dark:text-emerald-400" />
            <Stat n={stats.removed} sign="−" cls="text-red-600 dark:text-red-400" />
            <Stat n={stats.changed} sign="~" cls="text-yellow-600 dark:text-yellow-400" />
            {!stats.added && !stats.removed && !stats.changed && <span className="italic">no change to the YAML</span>}
          </p>
        </div>
      </div>

      <ul className="px-2 py-1.5 space-y-0.5 font-mono text-slate-600 dark:text-slate-400 max-h-32 overflow-y-auto">
        {labels.slice(0, 20).map((l, i) => <li key={i} className="break-words">· {l}</li>)}
        {labels.length > 20 && <li className="italic">…and {labels.length - 20} more</li>}
      </ul>

      {(issues.errors.length > 0 || issues.warnings.length > 0) && (
        <ul className="px-2 pb-1.5 space-y-0.5">
          {issues.errors.slice(0, 5).map((i, n) => (
            <li key={`e${n}`} className="text-red-700 dark:text-red-300">✗ {i.path}: {i.message}</li>
          ))}
          {issues.warnings.slice(0, 5).map((i, n) => (
            <li key={`w${n}`} className="text-yellow-700 dark:text-yellow-400">⚠ {i.path}: {i.message}</li>
          ))}
          {issues.errors.length + issues.warnings.length > 10 && (
            <li className="text-slate-500 italic">…{issues.errors.length + issues.warnings.length - 10} more issues</li>
          )}
        </ul>
      )}

      {kind === 'config' && !decided && (
        <p className="px-2 pb-1.5 text-yellow-700 dark:text-yellow-400">
          Applying this replaces your whole configuration and clears the undo history.
        </p>
      )}

      {stale && !decided && (
        <p className="px-2 pb-1.5 text-slate-500 italic">
          Your config has changed since this was proposed; the diff is against the config as it was.
        </p>
      )}

      <div className="px-2 py-1.5 flex items-center gap-1.5 border-t border-slate-200 dark:border-slate-700">
        {decided ? (
          <span className={status === 'applied'
            ? 'text-emerald-700 dark:text-emerald-400'
            : 'text-slate-500'}>
            {status === 'applied'
              ? (kind === 'config' ? '✓ Applied — it replaced your configuration' : '✓ Applied — ⌘Z/Ctrl+Z undoes it')
              : '✕ Rejected — nothing was changed'}
          </span>
        ) : (
          <>
            <button type="button" onClick={onReview}
              className="px-2 py-1 rounded border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800">
              Review diff
            </button>
            <button type="button" onClick={onApply}
              className="ml-auto px-2.5 py-1 rounded font-semibold bg-blue-600 hover:bg-blue-500 text-white">
              Apply
            </button>
            <button type="button" onClick={onReject}
              className="px-2.5 py-1 rounded font-semibold border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800">
              Reject
            </button>
          </>
        )}
      </div>
    </div>
  )
}

function Stat({ n, sign, cls }) {
  if (!n) return null
  return <span className={`${cls} mr-1.5`}>{sign}{n}</span>
}
