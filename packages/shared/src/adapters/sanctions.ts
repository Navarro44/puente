/**
 * SanctionsScreeningProvider — watchlist checks for all transaction parties.
 *
 * Sanctions screening answers: "Is any party on a government watchlist?"
 * It runs on every party (buyer org, supplier, Singapore receiving entity)
 * immediately BEFORE an escrow is funded. A match blocks the escrow.
 *
 * Phase 1: mock returns 'cleared' for all parties (with a way to force a
 * flagged result for integration testing).
 * Phase 2+: ComplyAdvantage / Chainalysis / equivalent.
 *
 * Distinct from KYB (business legitimacy) and KYT (on-chain tx monitoring).
 * See CLAUDE.md §8.
 */

/** A party to be screened. Supply as many identifiers as are known. */
export interface ScreeningSubject {
  /** Full legal name of the entity or individual. */
  name: string;
  /** ISO 3166-1 alpha-2 country code of the party's legal registration or residence. */
  country?: string;
  /** Ethereum wallet address, if applicable. */
  walletAddress?: string;
  /** Business registration number or national ID. */
  registrationNumber?: string;
  /** Date of birth (individuals) or incorporation date (entities) in ISO 8601. */
  dob?: string;
}

/** A single hit against a watchlist. */
export interface SanctionsMatch {
  /**
   * Identifier for the list on which the match was found.
   * Examples: "OFAC_SDN", "UN_SANCTIONS", "EU_SANCTIONS", "UK_SANCTIONS",
   *           "INTERPOL", "PEP_GLOBAL".
   */
  list: string;
  /** Name of the matched entity as it appears on the list. */
  matchedName: string;
  /** Confidence score from 0.0 (no confidence) to 1.0 (exact match). */
  confidence: number;
  /** Provider-supplied reason or list entry ID. */
  detail?: string;
}

export interface SanctionsScreeningResult {
  /** True iff no matches were found and the party is cleared to proceed. */
  cleared: boolean;
  /** Non-empty iff cleared == false. */
  matches: SanctionsMatch[];
  screenedAt: Date;
  /** Opaque provider reference for audit trail linkage. */
  referenceId: string;
}

export interface SanctionsScreeningProvider {
  /**
   * Screen a single party against global sanctions and watchlists.
   * Must be called for every party before an escrow is funded.
   * If cleared == false, the escrow must NOT be funded.
   */
  screen(subject: ScreeningSubject): Promise<SanctionsScreeningResult>;
}
