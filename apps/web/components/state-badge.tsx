import type { TransactionState } from '@puente/shared';

const STATE_STYLES: Record<TransactionState, string> = {
  Created: 'bg-gray-100 text-gray-700',
  Funded: 'bg-blue-100 text-blue-700',
  Shipped: 'bg-yellow-100 text-yellow-700',
  PartialReleased: 'bg-purple-100 text-purple-700',
  Completed: 'bg-green-100 text-green-700',
  Disputed: 'bg-red-100 text-red-700',
  Resolved: 'bg-orange-100 text-orange-700',
};

export function StateBadge({ state }: { state: string }) {
  const style = STATE_STYLES[state as TransactionState] ?? 'bg-gray-100 text-gray-600';
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${style}`}>
      {state}
    </span>
  );
}
