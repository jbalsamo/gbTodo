import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const publishableKey = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  import.meta.env.VITE_SUPABASE_ANON_KEY) as string | undefined;

if (!url || !publishableKey) {
  console.warn(
    "Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY (legacy VITE_SUPABASE_ANON_KEY also accepted). Auth and cloud todos will not work until .env.local is configured.",
  );
}

export const supabase = createClient(url ?? "", publishableKey ?? "");
