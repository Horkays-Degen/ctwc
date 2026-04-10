import { createBrowserClient } from "@supabase/ssr";

// ── Browser client (use in React components / client components) ──
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

// ── Type helpers ──────────────────────────────────────────────────
export type Team = {
  id: string;
  name: string;
  color: string;
  emblem: string;
  logo_img: string | null;
  created_at: string;
  // joined client-side
  memberCount?: number;
  cards?: Card[];
};

export type Card = {
  id: string;
  user_id: string | null;
  x_handle: string;
  display_name: string;
  avatar_url: string;
  followers: number;
  following: number;
  listed_count: number;
  tweet_count: number;
  verified: boolean;
  ovr: number;
  tier: string;
  stats: Record<string, number>;
  badges: { label: string; color: string }[];
  team_id: string | null;
  position: string | null;
  created_at: string;
};
