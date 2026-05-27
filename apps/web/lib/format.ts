/** Formats a USDC atomic-unit amount (6 decimals) into a human-readable string. */
export function formatUsdc(atomic: string | bigint): string {
  const n = BigInt(atomic);
  const whole = n / 1_000_000n;
  const frac = n % 1_000_000n;
  return `${whole.toLocaleString()}.${frac.toString().padStart(6, '0').slice(0, 2)} USDC`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function truncateAddress(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/**
 * Encodes a human-readable B/L reference string into a bytes32 hex value,
 * right-padding with zeros (same as ethers.encodeBytes32String).
 * Max 31 characters to leave room for the null terminator.
 */
export function blTextToBytes32(text: string): `0x${string}` {
  const bytes = Buffer.from(text.slice(0, 31), 'utf8');
  const padded = Buffer.alloc(32, 0);
  bytes.copy(padded);
  return `0x${padded.toString('hex')}` as `0x${string}`;
}

export function swiftSavingsPercent(): number {
  return 3.5; // midpoint of 3-5% SWIFT all-in cost vs Puente's 0.5%
}

/** Estimated SWIFT savings in USDC atomic units for a given escrow amount. */
export function estimatedSwiftSavings(amount: string): bigint {
  const n = BigInt(amount);
  const swiftCostBps = 350n; // 3.5%
  const puenteBps = 50n;     // 0.5%
  return (n * (swiftCostBps - puenteBps)) / 10_000n;
}
