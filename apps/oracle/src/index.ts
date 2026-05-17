// Oracle service entrypoint.
// Responsibilities (implemented in subsequent tasks):
//   1. Chain indexer: listen to EscrowFactory/Escrow events → sync Supabase read-mirror
//   2. Oracle worker: watch Shipped-state escrows → verify bill of lading → submit release tx

async function main(): Promise<void> {
  console.log("Puente oracle service starting...");
  // TODO: initialize chain watcher, B/L verifier adapter, and submission queue
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
