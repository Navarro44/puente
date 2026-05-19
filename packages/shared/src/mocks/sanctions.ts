/**
 * MockSanctionsScreeningProvider — Phase 1 stub for watchlist checks.
 *
 * Returns "cleared" for all parties by default. Provides two mechanisms
 * to force a flagged result for integration/negative testing:
 *
 *   1. armFlag(name)        — force a match for a specific party name
 *   2. armFlagAddress(addr) — force a match for a specific wallet address
 *
 * The mock produces realistic SanctionsMatch objects so downstream code
 * that inspects the match list still works correctly.
 */

import type {
  SanctionsScreeningProvider,
  ScreeningSubject,
  SanctionsScreeningResult,
  SanctionsMatch,
} from '../adapters/sanctions';

export class MockSanctionsScreeningProvider implements SanctionsScreeningProvider {
  private readonly flaggedNames = new Set<string>();
  private readonly flaggedAddresses = new Set<string>();

  /** Force the given display name to produce a sanctions match. */
  armFlag(name: string): void {
    this.flaggedNames.add(name.toLowerCase());
  }

  /** Force the given wallet address to produce a sanctions match. */
  armFlagAddress(address: string): void {
    this.flaggedAddresses.add(address.toLowerCase());
  }

  /** Clear all forced matches (useful between tests). */
  reset(): void {
    this.flaggedNames.clear();
    this.flaggedAddresses.clear();
  }

  async screen(subject: ScreeningSubject): Promise<SanctionsScreeningResult> {
    const matches: SanctionsMatch[] = [];

    const nameLower = subject.name.toLowerCase();
    const addrLower = subject.walletAddress?.toLowerCase() ?? '';

    if (this.flaggedNames.has(nameLower)) {
      matches.push({
        list: 'OFAC_SDN',
        matchedName: subject.name,
        confidence: 0.95,
        detail: 'MockSanctionsScreeningProvider: forced match via armFlag()',
      });
    }

    if (addrLower && this.flaggedAddresses.has(addrLower)) {
      matches.push({
        list: 'OFAC_SDN',
        matchedName: subject.walletAddress ?? '',
        confidence: 1.0,
        detail: 'MockSanctionsScreeningProvider: forced match via armFlagAddress()',
      });
    }

    return {
      cleared: matches.length === 0,
      matches,
      screenedAt: new Date(),
      referenceId: crypto.randomUUID(),
    };
  }
}
