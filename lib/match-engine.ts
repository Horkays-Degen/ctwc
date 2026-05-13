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
  // bonusOvr accumulates as a team wins rounds: R16 win +3, QF +3, SF +3,
  // Final +5 (cumulative). Boosts overall team strength when present.
  bonusOvr?: number;
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
  type:    "goal" | "yellow" | "red" | "save_miss"; // save_miss = big chance, GK saved it
  scorer:  string;   // @handle of the scorer / fouler / shooter
  scorerName: string;
  // Goals only: which teammate set it up
  assist?:     string;
  assistName?: string;
};

export type TeamMatchStats = {
  shots:           number;
  shotsOnTarget:   number;
  possession:      number;  // 0–100
  saves:           number;  // by GK
  yellowCards:     number;
  redCards:        number;
  passAccuracy:    number;  // 0–100
};

export type PlayerOfMatch = {
  handle:      string;
  displayName: string;
  team:        "home" | "away";
  rating:      number;       // 1–10
  reason:      string;       // why they're MOTM
};

export type MatchResult = {
  homeScore:    number;
  awayScore:    number;
  homePens:     number | null;
  awayPens:     number | null;
  winnerId:     string;
  events:       GoalEvent[];
  homeStrength: TeamStrength;
  awayStrength: TeamStrength;
  homeStats:    TeamMatchStats;
  awayStats:    TeamMatchStats;
  motm:         PlayerOfMatch | null;
};

// Legacy type kept for backwards compat — the new MatchResult above is canonical
export type _MatchResultLegacy = {
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

  let atkSum = 0, defSum = 0, atkW = 0, defW = 0, ovrSum = 0, bonusSum = 0;

  for (const p of filled) {
    const score = posScore(p.pos, p.stats!);
    const role  = ROLE[p.pos] ?? { atk: 0.5, def: 0.5 };
    atkSum  += score * role.atk;
    defSum  += score * role.def;
    atkW    += role.atk;
    defW    += role.def;
    ovrSum  += p.ovr;
    bonusSum += (p.bonusOvr ?? 0);
  }

  const rawAtk = atkW > 0 ? atkSum / atkW : 60;
  const rawDef = defW > 0 ? defSum / defW : 60;
  const rawOvr = ovrSum / filled.length;
  const avgBonus = bonusSum / filled.length;

  // Blend raw positional score with OVR (OVR is a calibrated composite)
  let attack  = rawAtk * 0.60 + rawOvr * 0.40;
  let defense = rawDef * 0.60 + rawOvr * 0.40;

  // Tournament progression bonus: each +1 of avgBonus boosts strength
  // by 1%. So a SF survivor (+9) plays ~9% stronger; champion-tier
  // (+14 cumulative) plays ~14% stronger. Snowballs the underdog story
  // — teams that go far get visibly tougher each round.
  const bonusFactor = 1 + (avgBonus / 100);
  attack  *= bonusFactor;
  defense *= bonusFactor;

  // Penalty for incomplete squads (down to 70% at 0 players)
  const completeness = filled.length / 11;
  const penalty = 0.70 + completeness * 0.30;

  return {
    attack:  Math.round(attack  * penalty * 10) / 10,
    defense: Math.round(defense * penalty * 10) / 10,
    ovr:     Math.round((rawOvr + avgBonus) * 10) / 10,
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

  // ── Assist picker: pick a teammate of the scorer for the assist ─
  // Assists weighted toward CAM > LW/RW > CM > everywhere else.
  const ASSIST_WEIGHT: Record<string, number> = {
    CAM: 3.0, LW: 2.5, RW: 2.5, CM: 2.0, CDM: 1.0, ST: 1.5,
    LB: 1.0, RB: 1.0, CB: 0.3, GK: 0.0,
  };
  const pickAssist = (slots: PlayerSlot[], scorerHandle: string) => {
    if (rand() < 0.18) return null;   // ~18% of goals are unassisted
    const pool = slots.filter(s => s.stats && s.handle !== scorerHandle);
    if (pool.length === 0) return null;
    const w  = pool.map(s => ASSIST_WEIGHT[s.pos] ?? 1.0);
    const tot = w.reduce((a, b) => a + b, 0);
    let pick = rand() * tot;
    for (let i = 0; i < pool.length; i++) {
      pick -= w[i];
      if (pick <= 0) return { handle: pool[i].handle, name: pool[i].displayName };
    }
    return { handle: pool[0].handle, name: pool[0].displayName };
  };

  // ── Card events (yellows + reds) ─────────────────────────────
  // Cards bias toward defenders/CDMs (they tackle more)
  const CARD_WEIGHT: Record<string, number> = {
    CB: 2.5, CDM: 2.0, LB: 1.5, RB: 1.5, CM: 1.3, ST: 1.0,
    LW: 0.8, RW: 0.8, CAM: 0.7, GK: 0.3,
  };
  const pickCardTaker = (slots: PlayerSlot[]) => {
    const pool = slots.filter(s => s.stats);
    if (pool.length === 0) return null;
    const w = pool.map(s => CARD_WEIGHT[s.pos] ?? 1.0);
    const tot = w.reduce((a, b) => a + b, 0);
    let pick = rand() * tot;
    for (let i = 0; i < pool.length; i++) {
      pick -= w[i];
      if (pick <= 0) return { handle: pool[i].handle, name: pool[i].displayName };
    }
    return { handle: pool[0].handle, name: pool[0].displayName };
  };

  // Yellow card distribution: avg 2.5 per team per match
  const homeYellows = Math.min(poisson(2.5, rand), 6);
  const awayYellows = Math.min(poisson(2.5, rand), 6);
  // Red cards are rare — ~8% chance per team per match
  const homeReds = rand() < 0.08 ? 1 : 0;
  const awayReds = rand() < 0.08 ? 1 : 0;

  const makeCardEvents = (
    slots: PlayerSlot[],
    yellows: number, reds: number,
    team: "home" | "away"
  ): GoalEvent[] => {
    const out: GoalEvent[] = [];
    for (let i = 0; i < yellows; i++) {
      const p = pickCardTaker(slots);
      if (!p) continue;
      out.push({
        minute: 5 + Math.floor(rand() * 85),
        team, type: "yellow",
        scorer: p.handle, scorerName: p.name,
      });
    }
    for (let i = 0; i < reds; i++) {
      const p = pickCardTaker(slots);
      if (!p) continue;
      out.push({
        minute: 30 + Math.floor(rand() * 60),
        team, type: "red",
        scorer: p.handle, scorerName: p.name,
      });
    }
    return out;
  };

  const homeCardEvents = makeCardEvents(homeSlots, homeYellows, homeReds, "home");
  const awayCardEvents = makeCardEvents(awaySlots, awayYellows, awayReds, "away");

  const events: GoalEvent[] = [
    ...homeMinutes.map((m, i) => {
      const a = pickAssist(homeSlots, homeScorers[i]?.handle ?? "");
      return {
        minute: m, team: "home" as const, type: "goal" as const,
        scorer:     homeScorers[i]?.handle      ?? "unknown",
        scorerName: homeScorers[i]?.displayName ?? "Unknown",
        ...(a ? { assist: a.handle, assistName: a.name } : {}),
      };
    }),
    ...awayMinutes.map((m, i) => {
      const a = pickAssist(awaySlots, awayScorers[i]?.handle ?? "");
      return {
        minute: m, team: "away" as const, type: "goal" as const,
        scorer:     awayScorers[i]?.handle      ?? "unknown",
        scorerName: awayScorers[i]?.displayName ?? "Unknown",
        ...(a ? { assist: a.handle, assistName: a.name } : {}),
      };
    }),
    ...homeCardEvents,
    ...awayCardEvents,
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

  // ── Team match stats (shots, possession, pass acc, saves) ────
  // Shots: ~10–18 per team, scales with attack strength
  const shotBase = 10;
  const homeShots = Math.round(shotBase + (homeStr.attack - 60) / 6 + rand() * 5);
  const awayShots = Math.round(shotBase + (awayStr.attack - 60) / 6 + rand() * 5);

  // On-target rate: 35–55%
  const homeOnTarget = Math.max(homeGoals,
    Math.round(homeShots * (0.35 + rand() * 0.2)));
  const awayOnTarget = Math.max(awayGoals,
    Math.round(awayShots * (0.35 + rand() * 0.2)));

  // Possession: midfield strength dominates. Sums to 100.
  const midFactor = (slots: PlayerSlot[]) =>
    slots.filter(s => ["CM", "CDM", "CAM"].includes(s.pos))
         .reduce((sum, s) => sum + (s.ovr ?? 60), 0);
  const homeMid = midFactor(homeSlots);
  const awayMid = midFactor(awaySlots);
  const totalMid = homeMid + awayMid || 1;
  // Add small randomization (±5%)
  let homePoss = Math.round((homeMid / totalMid) * 100 + (rand() - 0.5) * 10);
  homePoss = Math.max(30, Math.min(70, homePoss));
  const awayPoss = 100 - homePoss;

  // Saves by GK = on-target shots that didn't score
  const homeSaves = Math.max(0, awayOnTarget - awayGoals);
  const awaySaves = Math.max(0, homeOnTarget - homeGoals);

  // Pass accuracy: scales with OVR
  const homePassAcc = Math.round(70 + (homeStr.ovr - 60) / 3 + rand() * 5);
  const awayPassAcc = Math.round(70 + (awayStr.ovr - 60) / 3 + rand() * 5);

  const homeStats: TeamMatchStats = {
    shots:         homeShots,
    shotsOnTarget: homeOnTarget,
    possession:    homePoss,
    saves:         homeSaves,
    yellowCards:   homeYellows,
    redCards:      homeReds,
    passAccuracy:  Math.min(95, homePassAcc),
  };
  const awayStats: TeamMatchStats = {
    shots:         awayShots,
    shotsOnTarget: awayOnTarget,
    possession:    awayPoss,
    saves:         awaySaves,
    yellowCards:   awayYellows,
    redCards:      awayReds,
    passAccuracy:  Math.min(95, awayPassAcc),
  };

  // ── Player of the match ──────────────────────────────────────
  // Score each player by their contribution. Highest wins.
  type Tally = { handle: string; name: string; team: "home" | "away"; score: number; reason: string };
  const tally: Record<string, Tally> = {};
  const bump = (h: string, n: string, t: "home" | "away", score: number, reason: string) => {
    if (!tally[h]) tally[h] = { handle: h, name: n, team: t, score: 0, reason };
    tally[h].score += score;
    // Latest meaningful reason wins
    if (score >= 3) tally[h].reason = reason;
  };
  for (const e of events) {
    if (e.type === "goal") {
      bump(e.scorer, e.scorerName, e.team, 4, `${countGoals(events, e.scorer)} goal${countGoals(events, e.scorer) > 1 ? "s" : ""}`);
      if (e.assist && e.assistName) {
        bump(e.assist, e.assistName, e.team, 2, "playmaker");
      }
    }
    if (e.type === "yellow") bump(e.scorer, e.scorerName, e.team, -0.5, "");
    if (e.type === "red")    bump(e.scorer, e.scorerName, e.team, -3, "sent off");
  }
  // GK with most saves
  const homeGK = homeSlots.find(s => s.pos === "GK");
  const awayGK = awaySlots.find(s => s.pos === "GK");
  if (homeGK && homeSaves >= 4) bump(homeGK.handle, homeGK.displayName, "home", homeSaves * 0.5, `${homeSaves} saves`);
  if (awayGK && awaySaves >= 4) bump(awayGK.handle, awayGK.displayName, "away", awaySaves * 0.5, `${awaySaves} saves`);

  const ranked = Object.values(tally)
    // MOTM should usually be from the winning team — slight bonus
    .map(t => ({ ...t, score: t.score + (t.team === (winnerId === homeId ? "home" : "away") ? 1.5 : 0) }))
    .sort((a, b) => b.score - a.score);

  const motm: PlayerOfMatch | null = ranked.length > 0 && ranked[0].score >= 2
    ? {
        handle:      ranked[0].handle,
        displayName: ranked[0].name,
        team:        ranked[0].team,
        rating:      Math.min(10, Math.max(6.5, 6.5 + ranked[0].score * 0.4)),
        reason:      ranked[0].reason || "complete performance",
      }
    : null;

  return {
    homeScore:    homeGoals,
    awayScore:    awayGoals,
    homePens,
    awayPens,
    winnerId,
    events,
    homeStrength: homeStr,
    awayStrength: awayStr,
    homeStats,
    awayStats,
    motm,
  };
}

// Helper for MOTM goal-count messaging
function countGoals(events: GoalEvent[], handle: string): number {
  return events.filter(e => e.type === "goal" && e.scorer === handle).length;
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
