/**
 * Supabase client for the oracle service.
 *
 * Uses the service-role key, which bypasses Row Level Security. This is
 * intentional — the indexer and oracle write across all organisations.
 *
 * NEVER expose this client or the service-role key to browser code or
 * include it in API responses. It is server-side only.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from './config';

export const supabase: SupabaseClient = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: { persistSession: false },
  },
);
