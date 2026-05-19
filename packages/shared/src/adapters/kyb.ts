/**
 * KybProvider — Know Your Business onboarding checks for suppliers.
 *
 * KYB answers: "Is this supplier a real, legitimate business?"
 * It is a one-time onboarding gate. On success, a bytes32 credential hash
 * is anchored in SupplierRegistry on-chain; detailed KYB data stays off-chain.
 *
 * Phase 1: mock returns canned credential data for any supplier.
 * Phase 2+: Tianyancha / Qichacha for Chinese business-registry lookup.
 *   (Note: API access may require a Chinese legal entity — treat carefully.)
 *
 * Distinct from sanctions screening (one-time watchlist check) and KYT
 * (continuous on-chain transaction monitoring). See CLAUDE.md §8.
 */

/** Input identifying the supplier whose KYB checks should be run. */
export interface KybSubject {
  /** Business registration number in the supplier's jurisdiction. */
  registrationNumber: string;
  /** ISO 3166-1 alpha-2 country code of the supplier's legal registration. */
  country: string;
  /** Full legal business name. */
  legalName: string;
  /** Optional additional identifiers (e.g., tax ID, unified social credit code). */
  additionalIdentifiers?: Record<string, string>;
}

/**
 * The structured result of a KYB check.
 * The `credentialHash` field is the value to store in SupplierRegistry on-chain
 * (keccak256 of the canonical off-chain bundle).
 */
export interface KybCredential {
  /** The KybSubject.registrationNumber this credential refers to. */
  registrationNumber: string;
  legalName: string;
  registrationCountry: string;
  /** ISO 8601 date of business registration, if available. */
  registrationDate?: string;
  /**
   * keccak256 hash (bytes32 hex) of the canonical off-chain KYB document bundle.
   * This value is stored on-chain in SupplierRegistry via setCredential().
   * The full bundle remains off-chain in Supabase storage.
   */
  credentialHash: string;
  issuedAt: Date;
  /** Expiry date; undefined means no expiry. */
  expiresAt?: Date;
  /**
   * Provider-specific raw data. Kept entirely off-chain.
   * Do not store sensitive PII in the credential hash input — hash the
   * canonical subset only (registration number + country + issuer + timestamp).
   */
  rawData?: Record<string, unknown>;
}

export interface KybProvider {
  /**
   * Run KYB checks against the provider's business registry.
   * On success, returns a KybCredential whose credentialHash is ready to be
   * submitted to SupplierRegistry.setCredential().
   * On failure (business not found, documents invalid, etc.), throws with a
   * descriptive error message.
   */
  runChecks(subject: KybSubject): Promise<KybCredential>;
}
