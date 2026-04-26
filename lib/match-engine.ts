// ── CTWC Match Engine ─────────────────────────────────────────
// Deterministic simulation: seeded by match ID so results
// are reproducible and consistent across server/client.

export type MatchStats = {
  ENG: number; INF: number; CLT: number;
  VOL: number; VRL: number; OVR: number;
};

export type PlayerSlot = {
  pos:    string;
  stats:  MatchStats | null;
  ovr:    number;
  handle: string;
  displayName: string;
};

export type TeamStrength = {
  attack:   number;  // 0–99 scale
  defense:  number;
  ovr:      number;  // avg OVR of filled players
  filled:   number;  // how many of 11 slots are filled
};

export type GoalEvent = {
  minute:  number;
  team:    "home" | "away";
  scorer:  string;   // @handle
  scorerName: string;
};

export type MatchResult = {
  homeScore: number;
  awayScore: number;
  homePens:  number | null;  // penalty shootout, null if not needed
  awayPens:  number | null;
  winnerId:  string;          // team id
  events:    GoalEvent[];
  homeStrength: TeamStrength;
  awayStrength: TeamStrength;
};

// ── Seeded random (LCG) ───────────────────────────────────────
// Returns a function that yields deterministic pseudo-random floats [0,1)
function seededRand(seed: number) {
  let s = (seed ^ 0xDEADBEEF) >>> 0;
  return () => {
    s = Math.imul(s ^ (s >>> 16), 0x45d9f3b);
    s = Math.imul(s ^ (s >>> 16), 0x45d9f3b);
    s ^= s >>> 16;
    return (s >>> 0) / 0x100000000;
  };
}

// String → numeric seed (djb2 hash)
export function strSeed(str: string): number {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = (Math.imul(h, 33) ^ str.charCodeAt(i)) >>> 0;
  return h;
}

// ── Position ability — maps CT stats → football role score ────
function posScore(pos: string, s: MatchStats): number {
  switch (pos) {
    case "GK":  return s.INF * 0.40 + s.CLT * 0.40 + s.ENG * 0.20;
    case "CB":  return s.CLT * 0.40 + s.INF * 0.30 + s.ENG * 0.20 + s.VOL * 0.10;
    case "LB":
    case "RB":  return s.VRL * 0.35 + s.ENG * 0.35 + s.VOL * 0.30;
    case "CDM": return s.CLT * 0.40 + s.VOL * 0.30 + s.ENG * 0.30;
    case "CM":  return s.ENG * 0.30 + s.VRL * 0.30 + s.VOL * 0.25 + s.CLT * 0.15;
    case "CAM": return s.ENG * 0.45 + s.VRL * 0.45 + s.INF * 0.10;
    case "LW":
    case "RW":  return s.VRL * 0.50 + s.ENG * 0.30 + s.INF * 0.20;
    case "ST":  return s.ENG * 0.50 + s.VRL * 0.30 + s.INF * 0.20;
    default:    return (s.ENG + s.INF + s.CLT + s.VOL + s.VRL) / 5;
  }
}

// Attack vs defense role weight per position
const ROLE: Record<string, { atk: number; def: number }> = {
  GK:  { atk: 0.00, def: 1.50 },
  CB:  { atk: 0.10, def: 1.20 },
  LB:  { atk: 0.30, def: 0.90 },
  RB:  { atk: 0.30, def: 0.90 },
  CDM: { atk: 0.40, def: 0.80 },
  CM:  { atk: 0.70, def: 0.60 },
  CAM: { atk: 1.00, def: 0.20 },
  LW:  { atk: 1.10, def: 0.10 },
  RW:  { atk: 1.10, def: 0.10 },
  ST:  { atk: 1.30, def: 0.00 },
};

// ── Score a team's attack and defense power ───────────────────
export function scoreTeam(slots: PlayerSlot[]): TeamStrength {
  const filled = slots.filter(s => s.stats !== null);
  if (filled.length === 0) return { attack: 55, defense: 55, ovr: 55, filled: 0 };

  let atkSum = 0, defSum = 0, atkW = 0, defW = 0, ovrSum = 0;

  for (const p of filled) {
    const score = posScore(p.pos, p.stats!);
    const role  = ROLE[p.pos] ?? { atk: 0.5, def: 0.5 };
    atkSum  += score * role.atk;
    defSum  += score * role.def;
    atkW    += role.atk;
    defW    += role.def;
    ovrSum  += p.ovr;
  }

  const rawAtk = atkW > 0 ? atkSum / atkW : 60;
  const rawDef = defW > 0 ? defSum / defW : 60;
  const rawOvr = ovrSum / filled.length;

  // Blend raw positional score with OVR (OVR is a calibrated composite)
  const attack  = rawAtk * 0.60 + rawOvr * 0.40;
  const defense = rawDef * 0.60 + rawOvr * 0.40;

  // Penalty for incomplete squads (down to 70% at 0 players)
  const completeness = filled.length / 11;
  const penalty = 0.70 + completeness * 0.30;

  return {
    attack:  Math.round(attack  * penalty * 10) / 10,
    defense: Math.round(defense * penalty * 10) / 10,
    ovr:     Math.round(rawOvr  * 10) / 10,
    filled:  filled.length,
  };
}

// ── Poisson sampling (fast approximation) ────────────────────
function poisson(lambda: number, rand: () => number): number {
  // Knuth algorithm
  const L = Math.exp(-lambda);
  let p = 1, k = 0;
  do { k++; p *= rand(); } while (p > L && k < 20);
  return k - 1;
}

// ── Pick goal scorers (weighted by attack role) ───────────────
function pickScorers(
  slots: PlayerSlot[],
  goals: number,
  rand: () => number
): { handle: string; displayName: string }[] {
  // Weight FWD/MID players more heavily for goals
  const SCORER_WEIGHT: Record<string, number> = {
    ST: 3.5, LW: 2.5, RW: 2.5, CAM: 2.0, CM: 1.2, CDM: 0.4,
    LB: 0.3, RB: 0.3, CB: 0.15, GK: 0.0,
  };
  const candidates = slots.filter(s => s.stats);
  if (candidates.length === 0) return [];

  const weights = candidates.map(s => SCORER_WEIGHT[s.pos] ?? 1.0);
  const total   = weights.reduce((a, b) => a + b, 0);

  const scorers: { handle: string; displayName: string }[] = [];
  for (let g = 0; g < goals; g++) {
    let pick = rand() * total;
    for (let i = 0; i < candidates.length; i++) {
      pick -= weights[i];
      if (pick <= 0) {
        scorers.push({ handle: candidates[i].handle, displayName: candidates[i].displayName });
        break;
      }
    }
    // fallback: pick last
    if (scorers.length <= g) {
      const last = candidates[candidates.length - 1];
      scorers.push({ handle: last.handle, displayName: last.displayName });
    }
  }
  return scorers;
}

// ── Main simulation function ───────────────────────────────────
export function simulateMatch(
  homeId:   string,
  homeSlots: PlayerSlot[],
  awayId:   string,
  awaySlots: PlayerSlot[],
  matchId:  string,   // used as seed source (deterministic)
): MatchResult {
  const rand = seededRand(strSeed(matchId));

  const homeStr = scoreTeam(homeSlots);
  const awayStr = scoreTeam(awaySlots);

  // Expected goals — anchored so "70 attack vs 70 defense" yields ~1.5 goals
  const ANCHOR = 70;
  const BASE   = 1.5;
  const homeExp = Math.max(0.25, BASE * (homeStr.attack / ANCHOR) / (awayStr.defense / ANCHOR));
  const awayExp = Math.max(0.25, BASE * (awayStr.attack / ANCHOR) / (homeStr.defense / ANCHOR));

  // Sample goals (cap at 8 for realism)
  const homeGoals = Math.min(poisson(homeExp, rand), 8);
  const awayGoals = Math.min(poisson(awayExp, rand), 8);

  // Assign goal minutes (sorted)
  const assignMinutes = (count: number) =>
    Array.from({ length: count }, () => 1 + Math.floor(rand() * 90)).sort((a, b) => a - b);

  const homeMinutes = assignMinutes(homeGoals);
  const awayMinutes = assignMinutes(awayGoals);
  const homeScorers = pickScorers(homeSlots, homeGoals, rand);
  const awayScorers = pickScorers(awaySlots, awayGoals, rand);

  const events: GoalEvent[] = [
    ...homeMinutes.map((m, i) => ({
      minute: m, team: "home" as const,
      scorer: homeScorers[i]?.handle ?? "unknown",
      scorerName: homeScorers[i]?.displayName ?? "Unknown",
    })),
    ...awayMinutes.map((m, i) => ({
      minute: m, team: "away" as const,
      scorer: awayScorers[i]?.handle ?? "unknown",
      scorerName: awayScorers[i]?.displayName ?? "Unknown",
    })),
  ].sort((a, b) => a.minute - b.minute);

  // Penalty shootout on draw
  let winnerId: string;
  let homePens: number | null = null;
  let awayPens: number | null = null;

  if (homeGoals === awayGoals) {
    // Simulate a 5-kick shootout; winner needs more conversions
    let hk = 0, ak = 0;
    for (let i = 0; i < 5; i++) {
      // Conversion probability based on team attack/defense
      if (rand() < 0.72 + (homeStr.attack - ANCHOR) / 400) hk++;
      if (rand() < 0.72 + (awayStr.attack - ANCHOR) / 400) ak++;
    }
    // Sudden death if still tied
    let round = 0;
    while (hk === ak && round < 10) {
      if (rand() < 0.75) hk++;
      if (rand() < 0.75) ak++;
      round++;
    }
    // Force a winner if still tied
    if (hk === ak) { if (rand() < 0.5) hk++; else ak++; }
    homePens = hk;
    awayPens = ak;
    winnerId  = hk > ak ? homeId : awayId;
  } else {
    winnerId = homeGoals > awayGoals ? homeId : awayId;
  }

  return {
    homeScore:    homeGoals,
    awayScore:    awayGoals,
    homePens,
    awayPens,
    winnerId,
    events,
    homeStrength: homeStr,
    awayStrength: awayStr,
  };
}

// ── Bracket helpers ───────────────────────────────────────────

// 32-team single-elimination bracket seeding
// Returns array of 32 team IDs in bracket order (position i faces position i^1)
export function seedBracket(teamIds: string[], rand: () => number): string[] {
  // Shuffle using Fisher-Yates with provided random
  const arr = [...teamIds];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Round names
export const ROUND_NAMES: Record<number, string> = {
  1: "Round of 32",
  2: "Round of 16",
  3: "Quarter Finals",
  4: "Semi Finals",
  5: "Final",
};

// How many matches per round
export const ROUND_MATCHES: Record<number, number> = {
  1: 16, 2: 8, 3: 4, 4: 2, 5: 1,
};
