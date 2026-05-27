interface Milestone {
  index: number;
  milestone_type: string;
  pct: number;
  state: string;
  released_at?: string | null;
  release_tx_hash?: string | null;
}

const MILESTONE_LABELS: Record<string, string> = {
  // These are keccak256 hashes — labels come from index position for Phase 1
};

function milestoneLabel(m: Milestone): string {
  if (m.index === 0) return `Tranche 1 — B/L verified (${m.pct}%)`;
  if (m.index === 1) return `Tranche 2 — Receipt confirmed (${m.pct}%)`;
  return `Milestone ${m.index + 1} (${m.pct}%)`;
}

export function MilestoneTimeline({ milestones }: { milestones: Milestone[] }) {
  return (
    <ol className="space-y-3">
      {milestones.map((m) => (
        <li key={m.index} className="flex items-start gap-3">
          <div
            className={`mt-0.5 h-5 w-5 rounded-full border-2 flex-shrink-0 flex items-center justify-center text-xs font-bold ${
              m.state === 'released'
                ? 'bg-green-500 border-green-500 text-white'
                : 'bg-white border-gray-300 text-gray-400'
            }`}
          >
            {m.state === 'released' ? '✓' : m.index + 1}
          </div>
          <div>
            <p className="text-sm font-medium text-gray-900">{milestoneLabel(m)}</p>
            {m.state === 'released' && m.released_at && (
              <p className="text-xs text-gray-500">
                Released {new Date(m.released_at).toLocaleDateString()}
                {m.release_tx_hash && (
                  <span className="ml-1">
                    · tx{' '}
                    <span className="font-mono">
                      {m.release_tx_hash.slice(0, 10)}…
                    </span>
                  </span>
                )}
              </p>
            )}
            {m.state === 'pending' && (
              <p className="text-xs text-gray-400">Pending</p>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
