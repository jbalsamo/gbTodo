import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const publishableKey = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  import.meta.env.VITE_SUPABASE_ANON_KEY) as string | undefined;

const trimmedUrl = url?.trim() ?? "";
const trimmedKey = publishableKey?.trim() ?? "";

/** True when both Vite env vars are non-empty (safe to create a client). */
export const isSupabaseConfigured = Boolean(trimmedUrl && trimmedKey);

if (!isSupabaseConfigured) {
  console.warn(
    "Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY (legacy VITE_SUPABASE_ANON_KEY also accepted). Auth and cloud todos will not work until .env.local is configured.",
  );
}

/**
 * Shared Supabase client, or null when env is missing/empty.
 * Never call createClient with empty strings — that throws and blanks the app.
 */
export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(trimmedUrl, trimmedKey)
  : null;
