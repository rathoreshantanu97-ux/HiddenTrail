import { createClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// SUPABASE CLIENT — reads connection info from environment variables.
//
// LOCAL DEV: create a file named `.env.local` in the project root (NOT
// committed to git — it's already covered by the default Vite
// .gitignore) containing:
//
//   VITE_SUPABASE_URL=https://your-project-ref.supabase.co
//   VITE_SUPABASE_ANON_KEY=your-anon-public-key
//
// Both values come from Supabase Dashboard -> Project Settings -> API.
// Use the "anon public" key, NOT the "service_role" key — the anon key is
// safe to ship to a browser (that's its whole purpose; RLS policies are
// what keep it safe), the service_role key bypasses RLS entirely and
// must never appear in client-side code.
//
// PRODUCTION (Vercel): add the same two variables under your Vercel
// project -> Settings -> Environment Variables, then redeploy. Vite only
// exposes env vars prefixed with VITE_ to browser code, which is why both
// names above start with that prefix.
// ---------------------------------------------------------------------------

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  // Don't throw here — throwing at import time would break the entire
  // app (including same-device pass-and-play, which doesn't need
  // Supabase at all) just because online multiplayer isn't configured
  // yet. Instead, multiplayer-specific code paths check
  // isSupabaseConfigured() before attempting to use this client, and
  // show a clear setup message instead of a blank crashed screen.
  console.warn(
    "[Supabase] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY not set. " +
      "Online multiplayer will be unavailable until these are configured " +
      "(see src/lib/supabaseClient.js for setup instructions). " +
      "Same-device pass-and-play still works without this."
  );
}

export const isSupabaseConfigured = () => Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = isSupabaseConfigured()
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;
