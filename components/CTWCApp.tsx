"use client";
import { useState, useEffect, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import { toPng } from "html-to-image";
import { createClient } from "@/lib/supabase";

// ─── DATA TRANSFORMS (Supabase rows → UI shape) ───────────────
// Single source of truth for the formation (4-3-3 with 3× CM). MUST match:
//  - app/api/join-team/route.ts FORMATION_SLOTS
//  - app/api/tournament/simulate/route.ts SLOT_POSITIONS
//  - PITCH_SLOTS visual layout (pos field of each slot)
const SLOT_POSITIONS = ["GK","LB","CB","CB","RB","CM","CM","CM","LW","ST","RW"];

function transformCard(row: any) {
  // Resolve tier: DB stores the name string; ShieldCard needs the full TIERS object
  const tierName = typeof row.tier === "string" ? row.tier : (row.tier?.name ?? "Common");
  const tier = Object.values(TIERS).find(t => t.name === tierName) ?? TIERS.CT_PLAYER;
  // Resolve position: DB stores the code string; ShieldCard needs {code, cat, weight}
  const posCode = typeof row.position === "string" ? row.position : (row.position?.code ?? "CM");
  const position = POSITIONS.find(p => p.code === posCode) ?? POSITIONS.find(p => p.code === "CM")!;
  return {
    id:          row.id || '',
    handle:      row.x_handle || '',
    displayName: row.display_name || row.x_handle || 'CT Player',
    avatarUrl:   row.avatar_url || '',
    ovr:         row.ovr || 60,
    tier,
    stats:       row.stats || { ENG:60, INF:60, CLT:60, VOL:60, VRL:60, OVR:60 },
    badges:      row.badges || [],
    teamId:      row.team_id || null,
    position,
    rawProfile: {
      followers:    row.followers || 0,
      following:    row.following || 0,
      listedCount:  row.listed_count || 0,
      tweetCount:   row.tweet_count || 0,
      verified:     row.verified || false,
    },
  };
}

function transformTeam(teamRow: any, allCards: any[]) {
  const teamCards = allCards.filter(c => c.team_id === teamRow.id);
  // Strict position-to-slot match. Each card occupies its declared position
  // and only its declared position. Multi-instance positions (CB×2) consume
  // cards in DB order. Cards without a matching slot are simply not shown.
  const usedCardIds = new Set<string>();
  const slots = SLOT_POSITIONS.map((pos) => {
    const card = teamCards.find((c: any) => c.position === pos && !usedCardIds.has(c.id));
    if (card) usedCardIds.add(card.id);
    return { pos, card: card ? transformCard(card) : null };
  });
  return {
    id:        teamRow.id,
    name:      teamRow.name,
    color:     teamRow.color,
    emblem:    teamRow.emblem,
    logoImg:   teamRow.logo_img || null,
    memberIds: teamCards.map((c: any) => c.id),
    captainId: teamCards.length > 0 ? teamCards.reduce((best: any, c: any) =>
      (!best || c.ovr > best.ovr) ? c : best, null)?.id ?? null : null,
    slots,
    createdAt: teamRow.created_at,
  };
}


// ─── CUSTOM LOGOS ─────────────────────────────────────────────
const GBILLIONS_LOGO = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHZpZXdCb3g9JzAgMCAxMDAgMTIwJz4KICA8cmVjdCB4PSczOCcgeT0nMCcgd2lkdGg9JzIyJyBoZWlnaHQ9JzEyJyByeD0nNCcgZmlsbD0nIzE1NjVGNScvPgogIDxyZWN0IHg9JzM4JyB5PScxMDgnIHdpZHRoPScyMicgaGVpZ2h0PScxMicgcng9JzQnIGZpbGw9JyMxNTY1RjUnLz4KICA8cGF0aCBkPSdNMjAsMTAgSDYwIEM4MiwxMCA5NCwyMiA5NCwzOCBDOTQsNTAgODgsNTggNzgsNjMgQzg4LDY4IDk0LDc2IDk0LDg4IEM5NCwxMDQgODIsMTEyIDYwLDExMiBIMjAgWicgZmlsbD0nIzE1NjVGNScvPgogIDxyZWN0IHg9JzM0JyB5PScyMCcgd2lkdGg9JzM0JyBoZWlnaHQ9JzMyJyByeD0nOScgZmlsbD0nd2hpdGUnLz4KICA8cmVjdCB4PSczNCcgeT0nNjInIHdpZHRoPSczOCcgaGVpZ2h0PSczMCcgcng9JzknIGZpbGw9J3doaXRlJy8+CiAgPHJlY3QgeD0nMjAnIHk9JzEwJyB3aWR0aD0nMTYnIGhlaWdodD0nMTAwJyBmaWxsPScjMTU2NUY1Jy8+CiAgPHJlY3QgeD0nMjAnIHk9JzU1JyB3aWR0aD0nNTInIGhlaWdodD0nMTAnIHJ4PSczJyBmaWxsPScjMTU2NUY1Jy8+CiAgPHJlY3QgeD0nMzgnIHk9JzIyJyB3aWR0aD0nMjQnIGhlaWdodD0nMjgnIHJ4PSc4JyBmaWxsPScjMEEyNTgwJy8+CiAgPHJlY3QgeD0nMzgnIHk9JzY0JyB3aWR0aD0nMjgnIGhlaWdodD0nMjYnIHJ4PSc4JyBmaWxsPScjMEEyNTgwJy8+Cjwvc3ZnPg==";
// Helper: render emblem (emoji or custom logo img)
function EmblemImg({ team, size = 20, style = {} }) {
  if (team.logoImg) {
    return <img src={team.logoImg} alt={team.name} style={{ width: size, height: size, objectFit: "contain", flexShrink: 0, ...style }} />;
  }
  return <span style={{ fontSize: size * 0.9, lineHeight: 1, ...style }}>{team.emblem}</span>;
}

// ─── SOUND ENGINE (Web Audio API — no external files) ─────────
let _actx: AudioContext | null = null;
// Pre-generated noise buffer — created once on first warm-up, reused forever.
// Generating it on-demand inside crowd() blocked the main thread and caused
// the visual/audio lag the user noticed during card reveal.
let _noiseBuf: AudioBuffer | null = null;

function getCtx(): AudioContext | null {
  try {
    if (!_actx) _actx = new (window.AudioContext || (window as any).webkitAudioContext)();
    if (_actx.state === "suspended") _actx.resume();
    return _actx;
  } catch(e) { return null; }
}

// Call this on any user interaction before the reveal (e.g. "Join Team" click).
// Creates the AudioContext and fills the noise buffer off the hot path.
function warmAudio() {
  const c = getCtx(); if (!c) return;
  if (_noiseBuf) return; // already warm
  // 3 seconds of stereo white noise at half sample-rate (22 kHz) — fast to fill
  const sr  = Math.floor(c.sampleRate / 2);
  const sz  = sr * 3;
  const buf = c.createBuffer(2, sz, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < sz; i++) d[i] = Math.random() * 2 - 1;
  }
  _noiseBuf = buf;
}

const SFX = {
  muted: false,

  // Subtle click for buttons
  click() {
    if (this.muted) return;
    const c = getCtx(); if (!c) return;
    const o = c.createOscillator(), g = c.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(900, c.currentTime);
    o.frequency.exponentialRampToValueAtTime(420, c.currentTime + 0.07);
    g.gain.setValueAtTime(0.13, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.09);
    o.connect(g); g.connect(c.destination);
    o.start(); o.stop(c.currentTime + 0.1);
  },

  // Stadium crowd noise — phase: "build" (anticipation) | "roar" (peak cheer) | "cheer" (sustained)
  crowd(phase = "build") {
    if (this.muted) return;
    const c = getCtx(); if (!c) return;
    const dur = phase === "build" ? 2.0 : phase === "roar" ? 0.9 : 2.8;
    // Use the pre-warmed noise buffer — zero CPU cost on the hot path.
    // Falls back to inline generation only if warmAudio() was never called.
    if (!_noiseBuf) warmAudio();
    const buf = _noiseBuf!;
    // Multiple bandpass voice layers — low rumble, mid voices, high excitement
    const bands = phase === "roar"
      ? [{f:180,q:2.5,vol:0.18},{f:420,q:2,vol:0.22},{f:900,q:1.8,vol:0.17},{f:2200,q:1.5,vol:0.09}]
      : [{f:160,q:3,vol:0.07},{f:380,q:2.5,vol:0.09},{f:750,q:2,vol:0.07},{f:1600,q:1.5,vol:0.04}];
    bands.forEach(({f, q, vol}) => {
      const src = c.createBufferSource(); src.buffer = buf;
      const flt = c.createBiquadFilter(); flt.type = "bandpass"; flt.frequency.value = f; flt.Q.value = q;
      const g = c.createGain();
      if (phase === "build") {
        g.gain.setValueAtTime(0, c.currentTime);
        g.gain.linearRampToValueAtTime(vol * 0.4, c.currentTime + 0.6);
        g.gain.linearRampToValueAtTime(vol, c.currentTime + dur * 0.75);
        g.gain.linearRampToValueAtTime(vol * 1.5, c.currentTime + dur);
      } else if (phase === "roar") {
        g.gain.setValueAtTime(0, c.currentTime);
        g.gain.linearRampToValueAtTime(vol * 2.2, c.currentTime + 0.08);
        g.gain.linearRampToValueAtTime(vol * 1.6, c.currentTime + 0.4);
        g.gain.linearRampToValueAtTime(0, c.currentTime + dur);
      } else {
        g.gain.setValueAtTime(vol * 1.4, c.currentTime);
        g.gain.linearRampToValueAtTime(vol * 1.0, c.currentTime + dur * 0.5);
        g.gain.linearRampToValueAtTime(0, c.currentTime + dur);
      }
      src.connect(flt); flt.connect(g); g.connect(c.destination);
      src.start(); src.stop(c.currentTime + dur + 0.1);
    });
    // Air horn stab for roar
    if (phase === "roar") {
      [233, 311, 466].forEach((freq, i) => {
        const o = c.createOscillator(), g = c.createGain();
        o.type = "sawtooth"; o.frequency.value = freq;
        g.gain.setValueAtTime(0, c.currentTime + i * 0.04);
        g.gain.linearRampToValueAtTime(0.09, c.currentTime + i * 0.04 + 0.03);
        g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.55);
        o.connect(g); g.connect(c.destination);
        o.start(c.currentTime + i * 0.04); o.stop(c.currentTime + 0.6);
      });
    }
  },

  // Tier-specific reveal fanfare — layered on top of crowd roar
  reveal(tierName) {
    if (this.muted) return;
    const c = getCtx(); if (!c) return;
    const t = c.currentTime;
    const note = (freq, start, dur, type: OscillatorType = "sine", vol = 0.22) => {
      const o = c.createOscillator(), g = c.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, t + start);
      g.gain.setValueAtTime(0, t + start);
      g.gain.linearRampToValueAtTime(vol, t + start + 0.05);
      g.gain.exponentialRampToValueAtTime(0.001, t + start + dur);
      o.connect(g); g.connect(c.destination);
      o.start(t + start); o.stop(t + start + dur + 0.06);
    };
    // Sustained cheer backdrop for all tiers
    this.crowd("cheer");
    if (tierName === "CT Player") {
      note(880,  0,   1.0, "sine", 0.16);
      note(1320, 0.1, 0.8, "sine", 0.07);
    } else if (tierName === "CT Star") {
      note(440,  0,    1.2, "sine", 0.2);
      note(660,  0.15, 1.0, "sine", 0.2);
      note(880,  0.32, 0.9, "sine", 0.14);
    } else if (tierName === "CT Elite") {
      note(440,  0,    1.8, "sine",     0.2);
      note(554,  0,    1.8, "sine",     0.2);
      note(659,  0,    1.8, "sine",     0.2);
      note(880,  0.25, 1.4, "triangle", 0.1);
      note(1320, 0.48, 1.1, "triangle", 0.06);
    } else if (tierName === "CT Legend" || tierName === "Mythic") {
      // Thunderous bass drop
      note(55,   0,    1.0, "sine",     0.32);
      note(110,  0,    1.0, "sine",     0.26);
      // Triumphant fanfare
      note(440,  0,    2.8, "sine",     0.22);
      note(554,  0.12, 2.6, "sine",     0.22);
      note(659,  0.24, 2.5, "sine",     0.22);
      note(880,  0.4,  2.3, "sine",     0.22);
      note(1108, 0.56, 2.0, "sine",     0.14);
      // Shimmer crown
      note(1320, 0.4,  2.2, "triangle", 0.10);
      note(1760, 0.54, 2.0, "triangle", 0.06);
      note(2200, 0.66, 1.7, "triangle", 0.04);
      // Extra air horns
      [311, 466, 622].forEach((f, i) => note(f, 0.05 + i*0.06, 0.8, "sawtooth", 0.07));
    }
  },

  // Success chime — team created / joined
  success() {
    if (this.muted) return;
    const c = getCtx(); if (!c) return;
    const t = c.currentTime;
    [523, 659, 784].forEach((f, i) => {
      const o = c.createOscillator(), g = c.createGain();
      o.type = "sine"; o.frequency.setValueAtTime(f, t + i * 0.12);
      g.gain.setValueAtTime(0, t + i * 0.12);
      g.gain.linearRampToValueAtTime(0.22, t + i * 0.12 + 0.03);
      g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.12 + 0.9);
      o.connect(g); g.connect(c.destination);
      o.start(t + i * 0.12); o.stop(t + i * 0.12 + 0.95);
    });
  },

  // Swap swoosh — captain position swap
  swap() {
    if (this.muted) return;
    const c = getCtx(); if (!c) return;
    const t = c.currentTime;
    const o = c.createOscillator(), g = c.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(280, t);
    o.frequency.exponentialRampToValueAtTime(740, t + 0.13);
    o.frequency.exponentialRampToValueAtTime(520, t + 0.22);
    g.gain.setValueAtTime(0.18, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
    o.connect(g); g.connect(c.destination);
    o.start(t); o.stop(t + 0.32);
  },
};

// ─── TIERS (names match card-engine tier strings stored in DB) ─
const TIERS = {
  CT_PLAYER: { name:"CT Player", border:"#7B8794", bg:"#3A3D44", bgDark:"#22242A", accent:"#9EA6B0", glow:"rgba(155,162,170,0.3)",  textColor:"#C4CAD2" },
  CT_STAR:   { name:"CT Star",   border:"#3B82F6", bg:"#152B52", bgDark:"#0A1628", accent:"#60A5FA", glow:"rgba(59,130,246,0.4)",   textColor:"#93C5FD" },
  CT_ELITE:  { name:"CT Elite",  border:"#A855F7", bg:"#2D1250", bgDark:"#180828", accent:"#C084FC", glow:"rgba(168,85,247,0.45)",  textColor:"#D8B4FE" },
  CT_LEGEND: { name:"CT Legend", border:"#D4A537", bg:"#4A3410", bgDark:"#2A1D06", accent:"#FBBF24", glow:"rgba(212,165,55,0.55)",  textColor:"#FDE68A" },
  MYTHIC:    { name:"Mythic",    border:"#EF4444", bg:"#3D0A0A", bgDark:"#1A0505", accent:"#F87171", glow:"rgba(239,68,68,0.55)",   textColor:"#FCA5A5" },
};

// ─── POSITIONS ───────────────────────────────────────────────
const POSITIONS = [
  { code:"GK",  cat:"GK",  weight:1 },
  { code:"CB",  cat:"DEF", weight:2 },
  { code:"RB",  cat:"DEF", weight:1 },
  { code:"LB",  cat:"DEF", weight:1 },
  { code:"CDM", cat:"MID", weight:1 },
  { code:"CM",  cat:"MID", weight:1 },
  { code:"CAM", cat:"MID", weight:1 },
  { code:"RW",  cat:"FWD", weight:1 },
  { code:"LW",  cat:"FWD", weight:1 },
  { code:"ST",  cat:"FWD", weight:1 },
];

// ─── PITCH FORMATION SLOTS (1-4-3-3) ─────────────────────────
// viewBox 0 0 400 540  (attacking upward)
const PITCH_SLOTS = [
  { id:0,  pos:"GK", x:200, y:482 },
  { id:1,  pos:"LB", x:52,  y:382 },
  { id:2,  pos:"CB", x:145, y:364 },
  { id:3,  pos:"CB", x:255, y:364 },
  { id:4,  pos:"RB", x:348, y:382 },
  { id:5,  pos:"CM", x:112, y:258 },
  { id:6,  pos:"CM", x:200, y:238 },
  { id:7,  pos:"CM", x:288, y:258 },
  { id:8,  pos:"LW", x:58,  y:116 },
  { id:9,  pos:"ST", x:200, y:96  },
  { id:10, pos:"RW", x:342, y:116 },
];

const CAT_SLOTS = { GK:["GK"], DEF:["LB","CB","RB"], MID:["CM"], FWD:["LW","ST","RW"] };

// ─── TEAM CONFIG ─────────────────────────────────────────────
const POOL_CAP = 400; // max cards before pool closes

const PRESET_TEAMS = [
  { name:"Solana Speed Demons",        emblem:"⚡", color:"#9945FF" },
  { name:"Ethereum Maxis",             emblem:"🔷", color:"#627EEA" },
  { name:"Degen Raiders",              emblem:"🏴‍☠️", color:"#EF4444" },
  { name:"Meme Coin Marauders",        emblem:"🐸", color:"#22C55E" },
  { name:"Shitcoin Slayers",           emblem:"⚔️",  color:"#F43F5E" },
  { name:"Hyperliquid Hustlers",       emblem:"💧", color:"#06B6D4" },
  { name:"Monad Maniacs",              emblem:"🟣", color:"#8B5CF6" },
  { name:"Base Degens",                emblem:"🔵", color:"#2563EB" },
  { name:"Pump & Dump FC",             emblem:"📈", color:"#F59E0B" },
  { name:"NFT Reapers",                emblem:"💀", color:"#6B7280" },
  { name:"Perp Dex Predators",         emblem:"🦈", color:"#0891B2" },
  { name:"RWA Realists",               emblem:"🏦", color:"#65A30D" },
  { name:"ZK Shadow Ops",              emblem:"🕶️",  color:"#475569" },
  { name:"Prediction Market Prophets", emblem:"🔮", color:"#DC2626" },
  { name:"Stablecoin Syndicate",       emblem:"💵", color:"#16A34A" },
  { name:"Bitcoin Boomers",            emblem:"🟠", color:"#F97316" },
  { name:"Altcoin Army",               emblem:"🪖", color:"#D97706" },
  { name:"Venture Vultures",           emblem:"🦅", color:"#7C3AED" },
  { name:"Airdrop Addicts",            emblem:"🪂", color:"#EC4899" },
  { name:"Influencer Infantry",        emblem:"📱", color:"#0EA5E9" },
  { name:"gBillions FC",               emblem:"💰", color:"#1565F5", logoImg: GBILLIONS_LOGO },
  { name:"Alpha Snipers",              emblem:"🎯", color:"#BE123C" },
  { name:"Chart Wizards",              emblem:"📊", color:"#0D9488" },
  { name:"Diamond Hand Defenders",     emblem:"💎", color:"#D4A537" },
  { name:"Paper Hand Panic",           emblem:"📄", color:"#94A3B8" },
  { name:"FUD Factory",                emblem:"😱", color:"#991B1B" },
  { name:"Hype Squad",                 emblem:"📣", color:"#DB2777" },
  { name:"Bear Market Survivors",      emblem:"🐻", color:"#92400E" },
  { name:"Bull Run Brigade",           emblem:"🐂", color:"#15803D" },
  { name:"Liquidity Lurkers",          emblem:"💦", color:"#1D4ED8" },
  { name:"Governance Gladiators",      emblem:"⚖️",  color:"#7E22CE" },
  { name:"CT Legends",                 emblem:"👑", color:"#B45309" },
];

// ─── MOCK PROFILES (simulating X API v2) ─────────────────────
const MOCK_PROFILES = [
  { handle:"CryptoKing",   displayName:"Crypto King",   followers:245000,  following:980,  tweetCount:18400, listedCount:1840, accountAgeDays:2800, verified:true,  avgImpressions:42000,  avgLikes:1800, avgRetweets:420,  avgQuotes:95,  avgReplies:310, avgBookmarks:520  },
  { handle:"NFTWhale",     displayName:"NFT Whale",     followers:890000,  following:340,  tweetCount:31000, listedCount:6200, accountAgeDays:3900, verified:true,  avgImpressions:180000, avgLikes:7200, avgRetweets:2100, avgQuotes:480, avgReplies:890, avgBookmarks:1800 },
  { handle:"DegenTrader",  displayName:"Degen Trader",  followers:52000,   following:1200, tweetCount:9200,  listedCount:320,  accountAgeDays:1600, verified:false, avgImpressions:8400,   avgLikes:320,  avgRetweets:88,   avgQuotes:22,  avgReplies:95,  avgBookmarks:140  },
  { handle:"SolMaxi",      displayName:"Sol Maxi",      followers:78000,   following:560,  tweetCount:14200, listedCount:890,  accountAgeDays:2100, verified:false, avgImpressions:21000,  avgLikes:940,  avgRetweets:310,  avgQuotes:68,  avgReplies:220, avgBookmarks:390  },
  { handle:"AlphaHunter",  displayName:"Alpha Hunter",  followers:12000,   following:2100, tweetCount:4500,  listedCount:85,   accountAgeDays:820,  verified:false, avgImpressions:2800,   avgLikes:110,  avgRetweets:28,   avgQuotes:8,   avgReplies:42,  avgBookmarks:55   },
  { handle:"ETHBuilder",   displayName:"ETH Builder",   followers:5400,    following:1800, tweetCount:2100,  listedCount:44,   accountAgeDays:610,  verified:false, avgImpressions:1200,   avgLikes:48,   avgRetweets:12,   avgQuotes:4,   avgReplies:28,  avgBookmarks:22   },
  { handle:"MoonBoi",      displayName:"Moon Boi",      followers:34000,   following:4200, tweetCount:22000, listedCount:195,  accountAgeDays:1900, verified:false, avgImpressions:5600,   avgLikes:195,  avgRetweets:55,   avgQuotes:14,  avgReplies:78,  avgBookmarks:88   },
  { handle:"ChainAnalyst", displayName:"Chain Analyst", followers:142000,  following:720,  tweetCount:8900,  listedCount:2100, accountAgeDays:3200, verified:true,  avgImpressions:55000,  avgLikes:2400, avgRetweets:890,  avgQuotes:210, avgReplies:540, avgBookmarks:920  },
];

// ─── STAT ENGINE (mirrors lib/card-engine.ts for mock preview cards) ──
// Calibrated for active CT users: 200k followers, 150k tweets, 10k listed.
const logNorm = (v, max) => Math.min(99, Math.max(40, Math.round(Math.log1p(v) / Math.log1p(max) * 99)));

function computeStats(p) {
  const hasEng  = (p.avgImpressions ?? 0) > 0;
  const ffRatio = p.following > 0 ? p.followers / p.following : Math.min(p.followers, 200);
  const engRate = hasEng
    ? ((p.avgLikes + p.avgRetweets + (p.avgReplies ?? 0)) / p.avgImpressions) * 100
    : 0;
  const INF = logNorm(p.followers,    200_000);
  const CLT = logNorm(p.listedCount,  10_000);
  const VOL = logNorm(p.tweetCount,   150_000);
  const ENG = hasEng ? logNorm(engRate, 15) : logNorm(ffRatio, 200);
  const VRL = hasEng
    ? logNorm((p.avgRetweets + (p.avgReplies ?? 0)) * Math.log1p(p.followers), 50_000)
    : logNorm(p.followers * Math.log1p(p.listedCount + 1), 300_000);
  const rawOvr = Math.round(ENG*0.25 + INF*0.25 + CLT*0.20 + VOL*0.15 + VRL*0.15);
  const OVR = Math.min(99, Math.max(40, rawOvr + (p.verified ? 8 : 0)));
  return { ENG, INF, CLT, VOL, VRL, OVR };
}

function computeOVR(p) { return computeStats(p).OVR; }

function getTier(ovr) {
  if (ovr >= 93) return TIERS.MYTHIC;
  if (ovr >= 83) return TIERS.CT_LEGEND;
  if (ovr >= 73) return TIERS.CT_ELITE;
  if (ovr >= 60) return TIERS.CT_STAR;
  return TIERS.CT_PLAYER;
}

function assignPosCode(stats, handle) {
  const { ENG, INF, CLT, VOL, VRL } = stats;
  const h    = (handle ?? "").split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  const pick = (opts) => opts[h % opts.length];
  if (INF >= 82)                  return "GK";
  if (ENG >= 78 && VOL >= 78)     return "ST";
  if (VRL >= 78 && ENG >= 65)     return pick(["LW","RW"]);
  if (ENG >= 72)                  return "CAM";
  if (VOL >= 78 && CLT >= 60)     return "CDM";
  if (VOL >= 65 && ENG >= 55)     return "CM";
  if (CLT >= 68)                  return "CB";
  if (CLT >= 52)                  return pick(["LB","RB"]);
  return "CM";
}

function getBadges(p, ovr) {
  const badges = [];
  if (p.verified)               badges.push({label:"✓ Verified",     color:"#1DA1F2"});
  if (p.followers >= 100_000)   badges.push({label:"100K+ Followers",color:"#F59E0B"});
  if (ovr >= 93)                badges.push({label:"⚡ Mythic",        color:"#A855F7"});
  return badges.slice(0,2);
}

function createCard(profile, posCodeOverride?) {
  const stats   = computeStats(profile);
  const ovr     = stats.OVR;
  const tier    = getTier(ovr);
  const posCode = posCodeOverride ?? assignPosCode(stats, profile.handle);
  const pos     = POSITIONS.find(p => p.code === posCode) ?? POSITIONS.find(p => p.code === "CM")!;
  return {
    id:          "CT-" + Math.random().toString(36).substring(2,8).toUpperCase(),
    handle:      profile.handle,
    displayName: profile.displayName,
    avatarUrl:   profile.avatarUrl ?? "",
    position:    pos,
    ovr, tier,
    stats,
    badges:      getBadges(profile, ovr),
    rawProfile:  profile,
  };
}

function findBestSlot(slots, card) {
  const code=card.position.code, cat=POSITIONS.find(p=>p.code===code)?.cat||"MID";
  const exact=slots.findIndex(s=>!s.card && s.pos===code);
  if(exact>=0) return exact;
  const catMatch=slots.findIndex(s=>!s.card && (CAT_SLOTS[cat]||[]).includes(s.pos));
  if(catMatch>=0) return catMatch;
  return slots.findIndex(s=>!s.card);
}

function makeTeam(name, color, emblem, logoImg) {
  return { id:"TEAM-"+Math.random().toString(36).substring(2,7).toUpperCase(),
    name, color, emblem, logoImg: logoImg||null,
    slots: PITCH_SLOTS.map(ps=>({pos:ps.pos, card:null})),
    memberIds:[], captainId:null, createdAt:new Date().toISOString() };
}

function addCardToTeam(team, card) {
  const t    = JSON.parse(JSON.stringify(team));
  const idx  = findBestSlot(t.slots, card);
  if(idx<0) return t; // full
  t.slots[idx].card = card;
  t.memberIds.push(card.id);
  // captain = highest OVR
  const filled = t.slots.filter(s=>s.card);
  t.captainId  = filled.reduce((best,s)=>(!best||s.card.ovr>best.ovr)?s.card:best, null)?.id||null;
  return t;
}

// ─── TEAM CREATION CONSTANTS ─────────────────────────────────
const TEAM_COLORS = [
  "#FBBF24","#F87171","#34D399","#60A5FA","#A78BFA",
  "#FB923C","#F472B6","#22D3EE","#4ADE80","#E879F9",
];
const TEAM_EMBLEMS = [
  "⚽","🛡","🦅","🐉","🌟","⚡","🔥","🏆","🦁","🐺",
  "🌙","💎","⚔","🎯","🌊","🦊","🎖","🏅","🦋","🌺",
];

// ─── SEED DATA ────────────────────────────────────────────────
function buildSeedData() {
  // Build all 32 pre-set teams — empty slots, waiting for players
  const teams = PRESET_TEAMS.map(pt => makeTeam(pt.name, pt.color, pt.emblem, pt.logoImg));
  return { teams, pool:[], claimed:new Set() };
}

// Remove a card from a team (leave team)
function removeCardFromTeam(team, cardId) {
  const t = JSON.parse(JSON.stringify(team));
  const slotIdx = t.slots.findIndex(s => s.card?.id === cardId);
  if (slotIdx < 0) return t;
  t.slots[slotIdx].card = null;
  t.memberIds = t.memberIds.filter(id => id !== cardId);
  // Re-elect captain (highest OVR remaining)
  const filled = t.slots.filter(s => s.card);
  t.captainId = filled.length > 0
    ? filled.reduce((best,s) => (!best||s.card.ovr>best.card.ovr)?s:best).card.id
    : null;
  return t;
}

// ─── UTILS ───────────────────────────────────────────────────
const FMT = n => n>=1e6?(n/1e6).toFixed(1)+"M":n>=1e3?(n/1e3).toFixed(1)+"K":String(n);
const ACOLORS=["#6366F1","#8B5CF6","#EC4899","#F43F5E","#F59E0B","#10B981","#3B82F6","#0EA5E9"];
const aColor= n => ACOLORS[n.charCodeAt(0)%ACOLORS.length];
const inits = n => n.split(" ").map(w=>w[0]).join("").substring(0,2).toUpperCase();

// Wrap external avatar URLs in our /api/avatar-proxy so they can be drawn
// to canvas for PNG export. Same-origin URLs (e.g. our Supabase storage
// served via CORS-allowed bucket) are returned as-is.
function proxyAvatar(url: string): string {
  if (!url) return url;
  if (typeof window === "undefined") return url; // SSR — let client re-render
  try {
    const u = new URL(url, window.location.origin);
    if (u.origin === window.location.origin) return url;            // already same-origin
    if (u.hostname.includes("supabase.co")) return url;             // our storage already CORS-OK
    return `/api/avatar-proxy?url=${encodeURIComponent(url)}`;
  } catch {
    return url;
  }
}

// ─── SHIELD CARD ─────────────────────────────────────────────
// Universal CT stat labels — same for every position.
// These feel like CT personality traits, not generic football stats.
// Format helper for big numbers in source breakdowns
const fmtNum = (n: number | undefined): string => {
  if (n === undefined || n === null) return "—";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/,"") + "M";
  if (n >= 1_000)     return (n / 1_000    ).toFixed(1).replace(/\.0$/,"") + "k";
  return n.toLocaleString();
};

const CT_STATS = [
  { k:"ALPHA",  stat:"ENG", label:"Alpha Caller",
    tip:"Early alpha calls · engagement rate · first-mover energy",
    src:(p:any)=>({ label:"Engagement Rate", value: p?.followers ? `${((p.followers||0)/100).toFixed(1)}%` : "—" }) },
  { k:"CLUTCH", stat:"CLT", label:"Clutch Authority",
    tip:"Listed authority · trusted voice · clutch reputation",
    src:(p:any)=>({ label:"Listed By", value: `${fmtNum(p?.listedCount)} accounts` }) },
  { k:"GRIND",  stat:"VOL", label:"Daily Grinder",
    tip:"Tweet volume · consistency · non-stop output",
    src:(p:any)=>({ label:"Total Tweets", value: fmtNum(p?.tweetCount) }) },
  { k:"REACH",  stat:"INF", label:"Network Reach",
    tip:"Follower count · total influence · network size",
    src:(p:any)=>({ label:"Followers", value: fmtNum(p?.followers) }) },
  { k:"VIRAL",  stat:"VRL", label:"Viral Power",
    tip:"Retweet power · content spread · viral coefficient",
    src:(p:any)=>({ label:"Avg Retweets", value: "live" }) },
];

// Per-tier FX config — defines what visual layer each tier gets
const TIER_FX: Record<string,{particles:number;streaks:boolean;grain:boolean}> = {
  "CT Player": { particles:0,  streaks:false, grain:false },
  "CT Star":   { particles:5,  streaks:true,  grain:false },
  "CT Elite":  { particles:14, streaks:false, grain:false },
  "CT Legend": { particles:9,  streaks:false, grain:true  },
  "Mythic":    { particles:20, streaks:true,  grain:false },
};

// Seeded particle positions — deterministic per handle
function seedParticles(handle: string, count: number) {
  let h = 0;
  for (let i = 0; i < handle.length; i++) h = (Math.imul(h ^ handle.charCodeAt(i), 0x9e3779b9)) >>> 0;
  return Array.from({length: count}, (_, i) => {
    const r  = (Math.imul(h ^ (i * 2654435761), 0x9e3779b9)) >>> 0;
    const r2 = (Math.imul(r ^ (i * 1234567891), 0x9e3779b9)) >>> 0;
    return {
      x:    (r  >>> 0) % 96,
      y:    (r2 >>> 0) % 72,
      size: 1.5 + ((r >>> 16) % 3),
      op:   0.2 + ((r >>> 8)  % 5) * 0.1,
      dur:  2   + ((r >>> 4)  % 30) * 0.1,
      del:  ((r2 >>> 4) % 20) * 0.1,
    };
  });
}

// Shield polygon — 10-point crest shape
const SHIELD_CLIP = "polygon(50% 1%,94% 10%,100% 20%,100% 74%,79% 93%,50% 100%,21% 93%,0% 74%,0% 20%,6% 10%)";

// Constellation network lines (normalised 0–1, scaled at render time)
const CONST_LINES = [
  [[0.08,0.04],[0.32,0.13],[0.58,0.06],[0.82,0.11]],
  [[0.32,0.13],[0.50,0.24],[0.68,0.18]],
  [[0.58,0.06],[0.68,0.18],[0.92,0.14]],
  [[0.04,0.22],[0.18,0.32],[0.32,0.13]],
  [[0.82,0.11],[0.96,0.20],[0.88,0.36]],
  [[0.04,0.50],[0.14,0.40],[0.28,0.46]],
  [[0.92,0.42],[0.76,0.50],[0.94,0.60]],
  [[0.08,0.04],[0.04,0.22],[0.10,0.38]],
  [[0.92,0.14],[0.96,0.20]],
  [[0.18,0.32],[0.10,0.38],[0.14,0.40]],
];
const CONST_DOTS = [
  [0.08,0.04],[0.32,0.13],[0.58,0.06],[0.82,0.11],
  [0.50,0.24],[0.68,0.18],[0.92,0.14],[0.18,0.32],
  [0.04,0.22],[0.96,0.20],[0.88,0.36],[0.14,0.40],
  [0.04,0.50],[0.28,0.46],[0.92,0.42],[0.76,0.50],[0.94,0.60],[0.10,0.38],
];
const BRIGHT_STARS = [[0.58,0.06],[0.32,0.13],[0.82,0.11],[0.50,0.24]];

// Tier icon (hex badge)
const TIER_ICON: Record<string,string> = {
  "Mythic":"🔥","CT Legend":"👑","CT Elite":"⚡","CT Star":"🌊","CT Player":"⚽",
};

function ShieldCard({ card, size="large", onClick = undefined }: { card: any; size?: string; onClick?: any }) {
  // Hover state: { sd: stat-def, val: number, x: mouseX, y: mouseY } | null
  const [hovStat, setHovStat] = useState<{ sd: any; val: number; x: number; y: number } | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  const t    = card.tier;
  const isLg = size === "large";
  const W    = isLg ? 260 : 164;
  const H    = isLg ? 380 : 240;
  const s    = isLg ? 1 : 0.63;
  const fx   = TIER_FX[t.name] ?? TIER_FX["CT Player"];
  const VW = 260, VH = 240;

  const particles = useMemo(
    () => seedParticles(card.handle || "ct", fx.particles),
    [card.handle, fx.particles]
  );

  // Bottom panel height — where name + stats live
  const PANEL_H = Math.round(148 * s);

  return (
    <div style={{
      width: W, height: H, flexShrink: 0, position: "relative",
      cursor: onClick ? "pointer" : "default",
      userSelect: "none",
      borderRadius: Math.round(14 * s),
      transition: "transform 0.22s, box-shadow 0.22s",
      boxShadow: `0 0 ${Math.round(28*s)}px ${t.glow}55, 0 ${Math.round(12*s)}px ${Math.round(36*s)}px rgba(0,0,0,0.85)`,
    }}
    onMouseEnter={e => { if (onClick) { (e.currentTarget as HTMLElement).style.transform = "scale(1.05) translateY(-4px)"; } }}
    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = "scale(1) translateY(0)"; }}
    onClick={onClick}>

      {/* ── Card body ── */}
      <div style={{
        position: "absolute", inset: 0,
        borderRadius: Math.round(14 * s),
        overflow: "hidden",
        fontFamily: "'Segoe UI', system-ui, sans-serif",
      }}>

        {/* L0 · Tier background (shows when no avatar) */}
        <div style={{position:"absolute",inset:0,zIndex:0,
          background:`linear-gradient(175deg,${t.bg} 0%,${t.bgDark} 55%,#010205 100%)`}}/>

        {/* L1 · Avatar — fills full card, zoomed to face.
              Routed through /api/avatar-proxy so CORS-restricted sources
              (Twitter, unavatar) become drawable to canvas for PNG export. */}
        {card.avatarUrl ? (
          <img
            src={proxyAvatar(card.avatarUrl)}
            alt={card.displayName}
            crossOrigin="anonymous"
            style={{
              position:"absolute",inset:0,width:"100%",height:"100%",
              objectFit:"cover",objectPosition:"center 8%",
              display:"block",zIndex:1,
              filter:`brightness(1.08) contrast(1.08) saturate(1.15)`,
            }}
          />
        ) : (
          <div style={{position:"absolute",inset:0,zIndex:1,
            background:`linear-gradient(150deg,${aColor(card.displayName)} 0%,${t.bgDark} 100%)`,
            display:"flex",alignItems:"center",justifyContent:"center"}}>
            <span style={{fontSize:Math.round(72*s),fontWeight:900,color:"rgba(255,255,255,0.85)"}}>
              {inits(card.displayName)}
            </span>
          </div>
        )}

        {/* L2 · Constellation overlay (subtle, on top of avatar) */}
        <svg style={{position:"absolute",inset:0,width:"100%",height:"100%",
          zIndex:2,opacity:fx.particles>0?0.18:0.10,mixBlendMode:"screen",pointerEvents:"none"}}
          viewBox={`0 0 ${VW} ${VH}`} preserveAspectRatio="xMidYMid slice">
          {CONST_LINES.map((seg,i)=>(
            <polyline key={i} points={seg.map(([x,y])=>`${x*VW},${y*VH}`).join(" ")}
              fill="none" stroke={t.accent} strokeWidth="0.8" opacity="0.9"/>
          ))}
          {CONST_DOTS.map(([x,y],i)=>(
            <circle key={i} cx={x*VW} cy={y*VH} r="1.5" fill={t.accent} opacity="0.85"/>
          ))}
          {BRIGHT_STARS.map(([x,y],i)=>(
            <circle key={`b${i}`} cx={x*VW} cy={y*VH} r="2.8" fill={t.accent} opacity="0.6"/>
          ))}
          {fx.particles > 10 && [
            [[0.22,0.35],[0.42,0.45],[0.60,0.38]],
            [[0.70,0.30],[0.85,0.42],[0.78,0.55]],
            [[0.12,0.55],[0.30,0.62]],
          ].map((seg,i)=>(
            <polyline key={`x${i}`} points={seg.map(([x,y])=>`${x*VW},${y*VH}`).join(" ")}
              fill="none" stroke={t.accent} strokeWidth="0.5" opacity="0.5"/>
          ))}
        </svg>

        {/* L3 · Particles (CT Star+) */}
        {particles.map((p,i)=>(
          <div key={i} style={{
            position:"absolute",left:`${p.x}%`,top:`${p.y * 0.6}%`,
            width:Math.round(p.size*s),height:Math.round(p.size*s),borderRadius:"50%",
            background:t.accent,opacity:p.op * 0.6,zIndex:3,
            animation:`ppulse ${p.dur}s ${p.del}s ease-in-out infinite`,
          }}/>
        ))}

        {/* L4 · Top dark vignette — keeps OVR/pos text readable over avatar */}
        <div style={{position:"absolute",top:0,left:0,right:0,
          height:`${Math.round(H * 0.42)}px`,zIndex:5,pointerEvents:"none",
          background:`linear-gradient(180deg,rgba(0,0,0,0.72) 0%,rgba(0,0,0,0.38) 55%,transparent 100%)`}}/>

        {/* L5 · Bottom dark fade — strong backdrop for name + stats */}
        <div style={{position:"absolute",bottom:0,left:0,right:0,
          height:`${PANEL_H + Math.round(40*s)}px`,zIndex:5,pointerEvents:"none",
          background:`linear-gradient(0deg,rgba(0,0,0,0.97) 0%,rgba(0,0,0,0.93) 42%,rgba(0,0,0,0.60) 68%,transparent 100%)`}}/>

        {/* L6 · Tier colour wash — tints the top of the card */}
        <div style={{position:"absolute",top:0,left:0,right:0,height:"38%",
          zIndex:4,pointerEvents:"none",
          background:`linear-gradient(180deg,${t.bgDark}88 0%,transparent 100%)`}}/>

        {/* L7 · OVR + position (top-left, EA FC style) */}
        <div style={{position:"absolute",top:Math.round(12*s),left:Math.round(12*s),zIndex:10,
          textAlign:"center",lineHeight:1}}>
          <div style={{fontSize:Math.round(46*s),fontWeight:900,color:"#fff",letterSpacing:-1,
            textShadow:`0 2px ${Math.round(8*s)}px rgba(0,0,0,0.9),0 0 ${Math.round(18*s)}px ${t.glow}88`}}>
            {card.ovr}
          </div>
          <div style={{fontSize:Math.round(11*s),fontWeight:900,color:t.accent,letterSpacing:1.5,
            marginTop:Math.round(2*s),textShadow:`0 0 ${Math.round(6*s)}px ${t.glow}`}}>
            {card.position?.code ?? "MID"}
          </div>
          {/* Verified tick */}
          {card.rawProfile?.verified && (
            <div style={{marginTop:Math.round(4*s),fontSize:Math.round(9*s),color:"#1D9BF0"}}>✓</div>
          )}
        </div>

        {/* L8 · Tier badge (top-right) */}
        <div style={{position:"absolute",top:Math.round(10*s),right:Math.round(10*s),zIndex:10,
          display:"flex",flexDirection:"column",alignItems:"center",gap:Math.round(2*s)}}>
          <div style={{
            fontSize:Math.round(9*s),fontWeight:800,color:t.accent,letterSpacing:1.5,
            padding:`${Math.round(3*s)}px ${Math.round(6*s)}px`,
            background:`${t.bgDark}cc`,borderRadius:Math.round(4*s),
            border:`1px solid ${t.border}66`,
            textShadow:`0 0 ${Math.round(8*s)}px ${t.glow}`,
          }}>CTWC</div>
          <div style={{fontSize:Math.round(16*s)}}>{TIER_ICON[t.name]}</div>
        </div>

        {/* L9 · Bottom panel — name + divider + stats */}
        <div style={{position:"absolute",bottom:0,left:0,right:0,zIndex:10,
          padding:`${Math.round(10*s)}px ${Math.round(10*s)}px ${Math.round(12*s)}px`}}>

          {/* Player name */}
          <div style={{textAlign:"center",marginBottom:Math.round(6*s)}}>
            <div style={{fontSize:Math.round(15*s),fontWeight:900,color:"#fff",
              textTransform:"uppercase",letterSpacing:Math.round(1.5*s),
              textShadow:`0 0 ${Math.round(14*s)}px ${t.glow}88`,
              overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
              {card.displayName}
            </div>
            {/* X handle */}
            <div style={{display:"flex",alignItems:"center",justifyContent:"center",
              gap:Math.round(3*s),marginTop:Math.round(2*s)}}>
              <span style={{fontSize:Math.round(8*s),color:"rgba(255,255,255,0.4)",fontWeight:700}}>𝕏</span>
              <span style={{fontSize:Math.round(8*s),color:"rgba(255,255,255,0.38)",fontFamily:"monospace"}}>
                @{card.handle}
              </span>
            </div>
          </div>

          {/* Divider */}
          <div style={{height:1,margin:`0 ${Math.round(4*s)}px ${Math.round(8*s)}px`,
            background:`linear-gradient(90deg,transparent,${t.border}99,transparent)`}}/>

          {/* CT Stats row */}
          <div style={{display:"flex",justifyContent:"space-around"}}>
            {CT_STATS.map(sd => {
              const val = card.stats?.[sd.stat] ?? 60;
              const isHov = hovStat?.sd.k === sd.k;
              return (
                <div key={sd.k} style={{textAlign:"center",position:"relative",cursor:isLg?"help":"default",
                  transform:isHov?"translateY(-2px)":"none",transition:"transform 0.18s"}}
                  onMouseEnter={(e)=>{ if(isLg) setHovStat({ sd, val, x: e.clientX, y: e.clientY }); }}
                  onMouseLeave={()=>setHovStat(null)}>
                  {/* Stat number first (EA FC style — number on top) */}
                  <div style={{fontSize:Math.round(20*s),fontWeight:900,
                    color:isHov?t.accent:"#fff",lineHeight:1,
                    textShadow:isHov?`0 0 ${Math.round(16*s)}px ${t.accent}`:`0 0 ${Math.round(10*s)}px ${t.glow}77`,
                    transition:"color 0.18s, text-shadow 0.18s"}}>{val}</div>
                  <div style={{fontSize:Math.round(6.5*s),color:t.accent,fontWeight:700,
                    letterSpacing:0.3,opacity:isHov?1:0.85,marginTop:Math.round(1*s)}}>{sd.k}</div>
                </div>
              );
            })}
          </div>

          {/* Footer */}
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",
            marginTop:Math.round(7*s),paddingTop:Math.round(5*s),
            borderTop:`1px solid ${t.border}1a`}}>
            <span style={{fontSize:Math.round(6.5*s),fontWeight:700,color:t.accent,
              opacity:0.4,letterSpacing:1.5}}>CTWC 2026</span>
            <span style={{fontSize:Math.round(7*s),color:t.border,opacity:0.45,letterSpacing:1}}>
              {"✦".repeat(
                t.name==="Mythic"?5:t.name==="CT Legend"?4:t.name==="CT Elite"?3:t.name==="CT Star"?2:1
              )}
            </span>
            <span style={{fontSize:Math.round(6.5*s),fontWeight:700,color:t.accent,
              opacity:0.4,letterSpacing:1}}>S1</span>
          </div>
        </div>

        {/* L10 · Tier frame — thickness, glow, and corner ornaments scale with rarity */}
        {(() => {
          // Frame intensity per tier
          const frameSpec = {
            "CT Player": { thick: 2, glow: 0.10, double: false, corners: false },
            "CT Star":   { thick: 2, glow: 0.18, double: false, corners: false },
            "CT Elite":  { thick: 2, glow: 0.25, double: true,  corners: true  },
            "CT Legend": { thick: 3, glow: 0.32, double: true,  corners: true  },
            "Mythic":    { thick: 3, glow: 0.40, double: true,  corners: true  },
          }[t.name as string] || { thick: 2, glow: 0.10, double: false, corners: false };

          const px  = Math.max(1, Math.round(frameSpec.thick * s));
          const px2 = Math.max(1, Math.round((frameSpec.thick + 2) * s));
          const r   = Math.round(14 * s);
          const cornerSize = Math.round(18 * s);
          const cornerThick = Math.max(1.5, Math.round(2 * s));

          return (
            <>
              {/* Outer ring — main tier border */}
              <div style={{position:"absolute",inset:0,zIndex:15,pointerEvents:"none",borderRadius:r,
                boxShadow:`inset 0 0 0 ${px}px ${t.border},
                           inset 0 0 ${Math.round(22*s)}px ${t.glow}${Math.round(frameSpec.glow*255).toString(16).padStart(2,"0")}`}}/>

              {/* Inner ring — second pinstripe for Elite+ rarities */}
              {frameSpec.double && (
                <div style={{position:"absolute",inset:Math.round(4*s),zIndex:15,pointerEvents:"none",
                  borderRadius:Math.round(10*s),
                  boxShadow:`inset 0 0 0 1px ${t.accent}66`}}/>
              )}

              {/* Corner ornaments — L-shaped accents for Elite+ */}
              {frameSpec.corners && (
                <>
                  {[
                    {top:Math.round(7*s),left:Math.round(7*s),    bt:1,bb:0,bl:1,br:0},
                    {top:Math.round(7*s),right:Math.round(7*s),   bt:1,bb:0,bl:0,br:1},
                    {bottom:Math.round(7*s),left:Math.round(7*s), bt:0,bb:1,bl:1,br:0},
                    {bottom:Math.round(7*s),right:Math.round(7*s),bt:0,bb:1,bl:0,br:1},
                  ].map((p,i)=>{
                    const {bt,bb,bl,br,...pos} = p as any;
                    return (
                      <div key={i} style={{
                        position:"absolute",zIndex:16,pointerEvents:"none",
                        width:cornerSize,height:cornerSize,
                        ...pos,
                        borderTop:bt?`${cornerThick}px solid ${t.accent}`:"none",
                        borderBottom:bb?`${cornerThick}px solid ${t.accent}`:"none",
                        borderLeft:bl?`${cornerThick}px solid ${t.accent}`:"none",
                        borderRight:br?`${cornerThick}px solid ${t.accent}`:"none",
                        filter:`drop-shadow(0 0 ${Math.round(4*s)}px ${t.accent})`,
                        opacity:0.92,
                      }}/>
                    );
                  })}
                </>
              )}

              {/* Animated outer glow ring (Mythic only) */}
              {t.name === "Mythic" && (
                <div style={{position:"absolute",inset:-2,zIndex:14,pointerEvents:"none",
                  borderRadius:r+2,
                  background:`conic-gradient(from 0deg, ${t.accent}, ${t.border}, ${t.accent}, ${t.border}, ${t.accent})`,
                  filter:"blur(4px)",opacity:0.55,
                  animation:"holoSweep 5s linear infinite"}}/>
              )}
            </>
          );
        })()}

        {/* L11 · Shimmer sweep (CT Legend + Mythic) */}
        {(t.name==="CT Legend"||t.name==="Mythic")&&(
          <div style={{position:"absolute",inset:0,pointerEvents:"none",zIndex:16,
            overflow:"hidden",borderRadius:Math.round(14*s)}}>
            <div style={{position:"absolute",top:0,left:"-100%",width:"55%",height:"100%",
              background:"linear-gradient(105deg,transparent 20%,rgba(255,255,255,0.07) 50%,transparent 80%)",
              animation:"shimmer 3.5s infinite linear"}}/>
          </div>
        )}

        {/* L12 · Grain overlay (CT Legend) */}
        {fx.grain&&(
          <div style={{position:"absolute",inset:0,zIndex:17,pointerEvents:"none",opacity:0.05,
            backgroundImage:"url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
            backgroundSize:"180px 180px"}}/>
        )}
      </div>

      {/* ── Holographic Stat Inspector — rendered via portal so it escapes
            the card's overflow:hidden and any 3D-transformed ancestors ── */}
      {mounted && hovStat && typeof document !== "undefined" && createPortal(
        <HoloStatPanel hov={hovStat} tier={t} card={card}/>,
        document.body
      )}
    </div>
  );
}

// ─── HOLO STAT PANEL ──────────────────────────────────────────
// Floating, holographic breakdown panel that appears next to the cursor
// when a stat is hovered. Free of any card overflow / transform constraint.
function HoloStatPanel({ hov, tier, card }: { hov: any; tier: any; card: any }) {
  const { sd, val, x, y } = hov;
  const t = tier;
  const PANEL_W = 320;
  const PANEL_H = 200;
  const MARGIN  = 18;

  // Position: prefer above + slightly right of cursor; flip if it would clip
  const vw = typeof window !== "undefined" ? window.innerWidth  : 1200;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  let left = x + MARGIN;
  let top  = y - PANEL_H - MARGIN;
  if (left + PANEL_W > vw - 12) left = x - PANEL_W - MARGIN;
  if (top  < 12) top  = y + MARGIN;
  if (left < 12) left = 12;
  if (top  + PANEL_H > vh - 12) top = vh - PANEL_H - 12;

  const src = sd.src ? sd.src(card?.rawProfile) : null;
  // Bar fill % — clamp 0–100
  const pct = Math.max(0, Math.min(100, val));
  // Tier-tinted holo gradient
  const holoBg = `linear-gradient(135deg, rgba(8,12,22,0.96) 0%, ${t.bgDark}f5 38%, ${t.bg}88 64%, rgba(8,12,22,0.96) 100%)`;

  return (
    <div style={{
      position: "fixed",
      top, left,
      width: PANEL_W,
      zIndex: 9999,
      pointerEvents: "none",
      animation: "holoIn 0.18s cubic-bezier(0.22,1,0.36,1) both",
      fontFamily: "'Segoe UI',system-ui,sans-serif",
    }}>
      {/* Outer glow halo */}
      <div style={{
        position:"absolute",inset:-22,borderRadius:18,
        background:`radial-gradient(ellipse at center, ${t.accent}33 0%, ${t.accent}10 40%, transparent 70%)`,
        filter:"blur(14px)",
      }}/>

      <div style={{
        position:"relative",
        background: holoBg,
        backdropFilter:"blur(22px)",
        WebkitBackdropFilter:"blur(22px)",
        border:`1.5px solid ${t.border}cc`,
        borderRadius:14,
        padding:"16px 18px 18px",
        boxShadow:`0 0 50px ${t.accent}55, 0 12px 40px rgba(0,0,0,0.85), inset 0 1px 0 rgba(255,255,255,0.07)`,
        overflow:"hidden",
      }}>

        {/* Holographic shimmer band */}
        <div style={{
          position:"absolute",top:0,left:"-30%",width:"40%",height:"100%",
          background:`linear-gradient(105deg, transparent 30%, ${t.accent}22 50%, transparent 70%)`,
          animation:"holoSweep 2.2s linear infinite",pointerEvents:"none",
        }}/>

        {/* Diagonal scan lines (subtle) */}
        <div style={{
          position:"absolute",inset:0,opacity:0.08,pointerEvents:"none",
          background:`repeating-linear-gradient(135deg, ${t.accent} 0 1px, transparent 1px 4px)`,
        }}/>

        {/* HEADER ROW — stat name + huge value + bar */}
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,marginBottom:10}}>
          <div>
            <div style={{fontSize:9,fontWeight:700,letterSpacing:3,color:t.accent,opacity:0.75,marginBottom:1}}>
              {sd.k}
            </div>
            <div style={{fontSize:14,fontWeight:800,color:"#fff",letterSpacing:0.5}}>
              {sd.label}
            </div>
          </div>
          <div style={{textAlign:"right"}}>
            <div style={{fontSize:38,fontWeight:900,color:"#fff",lineHeight:1,
              textShadow:`0 0 18px ${t.accent},0 0 6px ${t.glow}`}}>
              {val}
            </div>
            <div style={{fontSize:8,fontWeight:700,letterSpacing:2,color:"rgba(255,255,255,0.4)",marginTop:1}}>
              / 100
            </div>
          </div>
        </div>

        {/* PROGRESS BAR */}
        <div style={{
          height:6,borderRadius:99,
          background:"rgba(255,255,255,0.06)",
          overflow:"hidden",position:"relative",
          marginBottom:13,
          border:`1px solid ${t.border}33`,
        }}>
          <div style={{
            height:"100%",width:`${pct}%`,borderRadius:99,
            background:`linear-gradient(90deg, ${t.border} 0%, ${t.accent} 100%)`,
            boxShadow:`0 0 12px ${t.accent}88, inset 0 0 6px rgba(255,255,255,0.3)`,
            animation:"holoBarFill 0.7s cubic-bezier(0.22,1,0.36,1) both",
          }}/>
        </div>

        {/* SOURCE METRIC */}
        {src && (
          <div style={{
            display:"flex",alignItems:"center",justifyContent:"space-between",
            padding:"7px 10px",borderRadius:8,marginBottom:10,
            background:`${t.bgDark}aa`,
            border:`1px solid ${t.border}33`,
          }}>
            <span style={{fontSize:9,fontWeight:700,letterSpacing:1.5,color:"rgba(255,255,255,0.5)",textTransform:"uppercase"}}>
              {src.label}
            </span>
            <span style={{fontSize:12,fontWeight:800,color:t.accent,letterSpacing:0.3}}>
              {src.value}
            </span>
          </div>
        )}

        {/* DESCRIPTION */}
        <div style={{
          fontSize:11,lineHeight:1.5,color:"rgba(255,255,255,0.78)",
          paddingTop:10,
          borderTop:`1px solid ${t.border}22`,
        }}>
          {sd.tip}
        </div>

        {/* CORNER BRACKETS — sci-fi inspector frame */}
        {[
          {top:6,left:6,bt:0,bb:1,bl:0,br:1},
          {top:6,right:6,bt:0,bb:1,bl:1,br:0},
          {bottom:6,left:6,bt:1,bb:0,bl:0,br:1},
          {bottom:6,right:6,bt:1,bb:0,bl:1,br:0},
        ].map((p,i)=>{
          const {bt,bb,bl,br,...pos} = p as any;
          return (
            <div key={i} style={{
              position:"absolute",width:10,height:10,
              ...pos,
              borderTop:bt?`1.5px solid ${t.accent}`:"none",
              borderBottom:bb?`1.5px solid ${t.accent}`:"none",
              borderLeft:bl?`1.5px solid ${t.accent}`:"none",
              borderRight:br?`1.5px solid ${t.accent}`:"none",
              opacity:0.85,
            }}/>
          );
        })}
      </div>
    </div>
  );
}

// ─── CARD REVEAL — FIFA PACK OPENING ─────────────────────────
const TIER_BADGES = {
  "CT Player": { icon:"⚽", label:"CT PLAYER",  bg:"#3A3D44", text:"#7B8794" },
  "CT Star":   { icon:"🌊", label:"CT STAR",    bg:"#152B52", text:"#3B82F6" },
  "CT Elite":  { icon:"⚡", label:"CT ELITE",   bg:"#2D1250", text:"#A855F7" },
  "CT Legend": { icon:"👑", label:"CT LEGEND",  bg:"#4A3410", text:"#D4A537" },
  "Mythic":    { icon:"🔥", label:"CT MYTHIC",  bg:"#3D0A0A", text:"#EF4444" },
};

// ─── INTERACTIVE CARD (3D tilt + spotlight glow) ──────────────
// Wraps a ShieldCard for modal/expanded viewing. Adds:
//   • mouse-reactive 3D tilt (rotateX/rotateY based on cursor offset)
//   • large radial spotlight glow behind the card that follows the cursor
//   • specular shine highlight on top of the card that follows the cursor
// Inspired by FUT card inspectors. Pure CSS transforms — no library.
function InteractiveCard({ card, size = "large", scale = 1 }: { card: any; size?: string; scale?: number }) {
  const [tilt, setTilt] = useState({ rx: 0, ry: 0, mx: 50, my: 50, active: false });
  const [busy, setBusy] = useState<null | "dl" | "share" | "copy">(null);
  const [toast, setToast] = useState<string | null>(null);
  const captureRef = useRef<HTMLDivElement>(null);
  const t = card?.tier;

  // Render the card to a PNG data URL (2× pixel ratio for crisp share quality).
  // Pre-loads the avatar via fetch+blob to guarantee CORS-clean drawing.
  const renderPng = async (): Promise<string | null> => {
    if (!captureRef.current) return null;
    // Belt-and-braces: wait for any <img> inside the capture node to finish
    // loading before rendering, so toPng never hits an undecoded image.
    const imgs = Array.from(captureRef.current.querySelectorAll("img"));
    await Promise.all(imgs.map(img =>
      img.complete && img.naturalWidth ? null
        : new Promise<void>(res => {
            img.onload  = () => res();
            img.onerror = () => res();
            // Fallback timeout in case load events never fire
            setTimeout(res, 3500);
          })
    ));
    try {
      return await toPng(captureRef.current, {
        pixelRatio: 2,
        cacheBust: true,
        backgroundColor: "#0a0e18", // dark fallback so transparent edges read clean on X
        style: { transform: "none" },
      });
    } catch (e) {
      console.error("[share] toPng failed:", e);
      return null;
    }
  };

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2200);
  };

  const handleDownload = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setBusy("dl");
    const dataUrl = await renderPng();
    setBusy(null);
    if (!dataUrl) return showToast("Couldn't render image");
    const link = document.createElement("a");
    link.download = `ctwc-${card.handle}.png`;
    link.href = dataUrl;
    link.click();
    showToast("Card saved!");
  };

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setBusy("copy");
    const dataUrl = await renderPng();
    setBusy(null);
    if (!dataUrl) return showToast("Couldn't render image");
    try {
      const blob = await (await fetch(dataUrl)).blob();
      // @ts-ignore — ClipboardItem available in modern browsers
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
      showToast("Copied to clipboard!");
    } catch {
      showToast("Clipboard blocked — try Download");
    }
  };

  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const px = x / rect.width;        // 0 → 1 across width
    const py = y / rect.height;       // 0 → 1 down height
    // Max tilt ~14° each axis. Y inverts so cursor near top tilts back.
    const ry = (px - 0.5) * 28;
    const rx = (0.5 - py) * 20;
    setTilt({ rx, ry, mx: px * 100, my: py * 100, active: true });
  };

  const onLeave = () => setTilt({ rx: 0, ry: 0, mx: 50, my: 50, active: false });

  // Base card dimensions (match ShieldCard's W/H), then scaled
  const isLg = size === "large";
  const baseW = isLg ? 260 : 164;
  const baseH = isLg ? 380 : 240;
  const W = baseW * scale;
  const H = baseH * scale;
  const accent = t?.accent ?? "#FBBF24";
  const glow   = t?.glow   ?? "rgba(255,255,255,0.4)";

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      style={{
        position: "relative",
        width: W,
        height: H,
        perspective: 1200,
        cursor: "grab",
      }}
    >
      {/* Spotlight glow behind card — large radial that intensifies on hover */}
      <div style={{
        position: "absolute",
        inset: -120,
        zIndex: 0,
        borderRadius: "50%",
        background: `radial-gradient(circle at ${tilt.mx}% ${tilt.my}%, ${accent}55 0%, ${accent}22 28%, ${accent}08 52%, transparent 72%)`,
        filter: "blur(28px)",
        opacity: tilt.active ? 1 : 0.7,
        transition: "opacity 0.35s",
        pointerEvents: "none",
      }}/>

      {/* Secondary ground glow (under card, gives floating feel) */}
      <div style={{
        position: "absolute",
        bottom: -40,
        left: "10%",
        right: "10%",
        height: 60,
        zIndex: 0,
        borderRadius: "50%",
        background: `radial-gradient(ellipse, ${glow} 0%, transparent 70%)`,
        filter: "blur(18px)",
        opacity: 0.85,
        pointerEvents: "none",
      }}/>

      {/* The 3D-tilted card — transformStyle: preserve-3d so the shine layer sits above */}
      <div style={{
        position: "relative",
        zIndex: 1,
        width: W,
        height: H,
        transformStyle: "preserve-3d",
        transform: `rotateX(${tilt.rx}deg) rotateY(${tilt.ry}deg) ${tilt.active ? "scale(1.04)" : "scale(1)"}`,
        transition: tilt.active ? "transform 0.08s ease-out" : "transform 0.5s cubic-bezier(0.22,1,0.36,1)",
        willChange: "transform",
      }}>
        {/* Inner scale wrapper — scales the underlying ShieldCard up to fill W×H.
            captureRef points here so PNG export captures the upright scaled card. */}
        <div ref={captureRef} style={{
          width: baseW,
          height: baseH,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
        }}>
          <ShieldCard card={card} size={size}/>
        </div>

        {/* Specular shine — bright highlight that follows the cursor */}
        <div style={{
          position: "absolute",
          inset: 0,
          borderRadius: 14,
          background: `radial-gradient(circle at ${tilt.mx}% ${tilt.my}%, rgba(255,255,255,0.32) 0%, rgba(255,255,255,0.10) 18%, transparent 40%)`,
          mixBlendMode: "overlay",
          opacity: tilt.active ? 1 : 0,
          transition: "opacity 0.25s",
          pointerEvents: "none",
          transform: "translateZ(2px)",
        }}/>

        {/* Subtle holographic gradient sheen — tier accent */}
        <div style={{
          position: "absolute",
          inset: 0,
          borderRadius: 14,
          background: `linear-gradient(${135 + tilt.ry * 2}deg, transparent 30%, ${accent}22 50%, transparent 70%)`,
          mixBlendMode: "screen",
          opacity: tilt.active ? 0.7 : 0,
          transition: "opacity 0.3s",
          pointerEvents: "none",
          transform: "translateZ(1px)",
        }}/>
      </div>

      {/* ── Share toolbar — sits below the card, doesn't tilt ── */}
      <div style={{
        position:"absolute",
        top: H + 28,
        left: "50%",
        transform: "translateX(-50%)",
        display:"flex",gap:10,
        zIndex:5,
      }}>
        <button onClick={handleDownload} disabled={!!busy}
          title="Download PNG"
          style={{
            display:"flex",alignItems:"center",gap:8,
            padding:"10px 22px",fontSize:12,fontWeight:800,letterSpacing:0.5,
            background:`linear-gradient(135deg, ${accent}, ${t?.border ?? accent})`,
            border:"none",borderRadius:9,color:"#0a0a0a",cursor:"pointer",
            boxShadow:`0 0 22px ${accent}88, 0 6px 20px rgba(0,0,0,0.5)`,
            transition:"transform 0.15s",
          }}
          onMouseEnter={e=>(e.currentTarget.style.transform="scale(1.05)")}
          onMouseLeave={e=>(e.currentTarget.style.transform="scale(1)")}
        >
          <span style={{fontSize:14}}>{busy==="dl"?"…":"⬇"}</span>
          <span>Download Card</span>
        </button>

        <button onClick={handleCopy} disabled={!!busy}
          title="Copy image"
          style={{
            display:"flex",alignItems:"center",gap:7,
            padding:"10px 16px",fontSize:12,fontWeight:700,
            background:"rgba(255,255,255,0.06)",
            border:`1px solid ${accent}55`,borderRadius:9,
            color:"#fff",cursor:"pointer",backdropFilter:"blur(8px)",
            transition:"all 0.15s",
          }}
          onMouseEnter={e=>{ e.currentTarget.style.background=`${accent}22`; }}
          onMouseLeave={e=>{ e.currentTarget.style.background="rgba(255,255,255,0.06)"; }}
        >
          <span>{busy==="copy"?"…":"⧉"}</span>
          <span>Copy</span>
        </button>
      </div>

      {/* Toast notification */}
      {toast && (
        <div style={{
          position:"absolute",top: H + 78,left:"50%",transform:"translateX(-50%)",
          padding:"7px 14px",fontSize:11,fontWeight:700,letterSpacing:0.5,
          background:"rgba(0,0,0,0.92)",border:`1px solid ${accent}88`,
          borderRadius:7,color:accent,zIndex:6,whiteSpace:"nowrap",
          boxShadow:`0 0 18px ${accent}55`,
          animation:"holoIn 0.18s cubic-bezier(0.22,1,0.36,1) both",
        }}>{toast}</div>
      )}
    </div>
  );
}

// ─── REVEAL READY GATE ────────────────────────────────────────
// Shown after a successful mint, before the actual reveal animation.
// Required because browser autoplay policy blocks AudioContext from
// playing until there's a user gesture on the page. After OAuth redirect
// or programmatic page change, no gesture has happened yet — so a tap here
// unlocks audio and fires the crowd "build" sound in the same JS task as
// the transition to the reveal animation.
function RevealReadyGate({ card, onOpen }: { card: any; onOpen: () => void }) {
  const t = card.tier;
  const badge = TIER_BADGES[t.name] || TIER_BADGES["CT Player"];
  return (
    <div onClick={onOpen} style={{
      position:"fixed",inset:0,background:"#04060d",cursor:"pointer",
      display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
      fontFamily:"'Segoe UI',system-ui,sans-serif",zIndex:200,overflow:"hidden",
    }}>
      {/* Stadium glow backdrop */}
      <div style={{position:"absolute",inset:0,
        background:`radial-gradient(ellipse 70% 50% at 50% 55%, ${t.accent}22 0%, transparent 70%)`,
        pointerEvents:"none"}}/>

      {/* Pulsing tier orb behind pack */}
      <div style={{position:"absolute",width:520,height:520,borderRadius:"50%",
        background:`radial-gradient(circle, ${t.accent}28 0%, ${t.accent}08 40%, transparent 70%)`,
        animation:"ppulse 2.4s ease-in-out infinite",pointerEvents:"none"}}/>

      {/* Title */}
      <div style={{textAlign:"center",marginBottom:36,position:"relative",zIndex:2}}>
        <div style={{fontSize:11,fontWeight:700,letterSpacing:6,color:t.accent,opacity:0.85,marginBottom:6}}>
          YOUR CTWC CARD HAS BEEN MINTED
        </div>
        <div style={{fontSize:32,fontWeight:900,color:"#fff",letterSpacing:2,
          textShadow:`0 0 24px ${t.accent}66`}}>
          Tap to open your pack
        </div>
      </div>

      {/* The pack itself — same look as CardReveal pack phase */}
      <div style={{
        width:220,height:308,borderRadius:18,position:"relative",zIndex:2,
        background:`linear-gradient(160deg, ${t.bg} 0%, #0d0f14 60%, ${t.bg}99 100%)`,
        border:`2px solid ${t.border}`,
        boxShadow:`0 0 50px ${t.accent}66, 0 0 100px ${t.accent}33, inset 0 1px 0 rgba(255,255,255,0.1)`,
        display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
        animation:"packFloat 3s ease-in-out infinite",
        overflow:"hidden",
      }}>
        {/* Shimmer */}
        <div style={{position:"absolute",top:0,left:"-60px",width:"50px",height:"100%",
          background:"linear-gradient(90deg,transparent,rgba(255,255,255,0.08),transparent)",
          animation:"shimmerSweep 2.4s 0.4s linear infinite",pointerEvents:"none"}}/>
        <div style={{fontSize:54,marginBottom:10,filter:`drop-shadow(0 0 14px ${t.accent})`}}>
          {badge.icon}
        </div>
        <div style={{fontSize:14,fontWeight:900,letterSpacing:5,color:t.accent,textTransform:"uppercase"}}>
          CTWC
        </div>
        <div style={{fontSize:10,fontWeight:700,letterSpacing:4,color:"rgba(255,255,255,0.35)",marginTop:5}}>
          2026 PACK
        </div>
        <div style={{marginTop:18,padding:"5px 16px",borderRadius:22,
          background:`${t.accent}22`,border:`1px solid ${t.border}55`,
          fontSize:11,fontWeight:700,color:t.accent,letterSpacing:2.5}}>
          {t.name.toUpperCase()}
        </div>
      </div>

      {/* CTA */}
      <button onClick={(e) => { e.stopPropagation(); onOpen(); }} style={{
        marginTop:38,padding:"14px 38px",fontSize:14,fontWeight:800,letterSpacing:3,
        borderRadius:10,background:`linear-gradient(135deg, ${t.accent}, ${t.border})`,
        border:"none",color:"#0a0a0a",cursor:"pointer",
        boxShadow:`0 0 32px ${t.accent}66`,
        position:"relative",zIndex:2,
        textTransform:"uppercase",
      }}>
        🔥 OPEN PACK
      </button>

      <div style={{marginTop:14,fontSize:10,color:"rgba(255,255,255,0.35)",
        letterSpacing:2,position:"relative",zIndex:2}}>
        Tap anywhere to continue
      </div>
    </div>
  );
}

function CardReveal({ card, onDone }) {
  const [phase, setPhase] = useState("pack"); // pack → rip → reveal → done
  const t = card.tier;
  const badge = TIER_BADGES[t.name] || TIER_BADGES["CT Player"];

  // Confetti particles seeded once
  const confetti = useRef(Array.from({length:50},(_,i)=>({
    id:i,
    x: 48 + (Math.random()-0.5)*6,
    color: [t.accent, t.border, "#fff", "#FFD700", "#FFF176"][i%5],
    dx: (Math.random()-0.5)*420,
    dy: -90 - Math.random()*260,
    size: 3 + Math.random()*6,
    rot: Math.random()*720,
    delay: Math.random()*0.3,
    shape: i%3===0 ? "circle" : i%3===1 ? "rect" : "star",
  }))).current;

  // Orbiting pack particles
  const orbits = useRef(Array.from({length:22},(_,i)=>({
    id:i,
    angle: (i/22)*360,
    r: 90 + Math.random()*50,
    sz: 2.5+Math.random()*4,
    speed: 4+Math.random()*4,
    delay: Math.random()*2,
  }))).current;

  useEffect(()=>{
    // crowd("build") is fired by the caller BEFORE setPage("reveal") so it starts
    // in the same JS task as the page transition — no paint-delay gap.
    // This useEffect only handles the rip → reveal → done sequence.
    const t1 = setTimeout(()=>{ setPhase("rip");    SFX.crowd("roar"); },   1600);
    const t2 = setTimeout(()=>{ setPhase("reveal"); SFX.reveal(t.name); }, 1820);
    const t3 = setTimeout(()=>{ setPhase("done");   onDone?.(); },           4200);
    return()=>{ clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  },[]);

  return (
    <div style={{position:"fixed",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",background:"#04060d",overflow:"hidden",zIndex:200}}>

      {/* === BACKGROUND STADIUM GLOW === */}
      <div style={{position:"absolute",inset:0,background:`radial-gradient(ellipse 70% 50% at 50% 55%, ${t.accent}18 0%, transparent 70%)`,pointerEvents:"none"}}/>

      {/* === PACK PHASE === */}
      {(phase==="pack"||phase==="rip") && (
        <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",position:"relative"}}>

          {/* Orbiting spark particles */}
          {orbits.map(o=>(
            <div key={o.id} style={{
              position:"absolute",
              width:o.sz, height:o.sz, borderRadius:"50%",
              background:t.accent,
              boxShadow:`0 0 ${o.sz*2}px ${t.accent}`,
              left:"50%", top:"50%",
              transform:`translate(-50%,-50%) rotate(${o.angle}deg) translateX(${o.r}px)`,
              opacity: phase==="rip" ? 0 : 0,
              animation:`orbitSpin ${o.speed}s ${o.delay}s linear infinite, ppulse 1.1s ${o.delay}s ease-in-out infinite`,
              transition: phase==="rip" ? "opacity 0.15s" : "none",
            }}/>
          ))}

          {/* The Card Pack */}
          <div style={{
            width:200, height:280, borderRadius:18,
            background:`linear-gradient(160deg, ${t.bg} 0%, #0d0f14 60%, ${t.bg}99 100%)`,
            border:`2px solid ${t.border}`,
            boxShadow:`0 0 40px ${t.accent}55, 0 0 80px ${t.accent}22, inset 0 1px 0 rgba(255,255,255,0.08)`,
            display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
            position:"relative", overflow:"hidden",
            animation: phase==="rip" ? "packRipLeft 0.25s ease-in forwards" : "packFloat 2.4s ease-in-out infinite",
          }}>
            {/* Shimmer sweep */}
            <div style={{position:"absolute",top:0,left:"-60px",width:"50px",height:"100%",background:"linear-gradient(90deg,transparent,rgba(255,255,255,0.07),transparent)",animation:"shimmerSweep 2s 0.4s linear infinite",pointerEvents:"none"}}/>
            {/* Pack badge */}
            <div style={{fontSize:48,marginBottom:8,filter:`drop-shadow(0 0 12px ${t.accent})`}}>{badge.icon}</div>
            <div style={{fontSize:13,fontWeight:900,letterSpacing:4,color:t.accent,fontFamily:"'Segoe UI',system-ui,sans-serif",textTransform:"uppercase"}}>CTWC</div>
            <div style={{fontSize:9,fontWeight:700,letterSpacing:3,color:"rgba(255,255,255,0.3)",fontFamily:"'Segoe UI',system-ui,sans-serif",marginTop:4}}>2026 PACK</div>
            <div style={{marginTop:16,padding:"4px 14px",borderRadius:20,background:`${t.accent}22`,border:`1px solid ${t.border}44`,fontSize:10,fontWeight:700,color:t.accent,letterSpacing:2,fontFamily:"'Segoe UI',system-ui,sans-serif"}}>{t.name.toUpperCase()}</div>
          </div>

          {/* Pack tap hint */}
          <div style={{marginTop:22,fontSize:12,fontWeight:600,color:"rgba(255,255,255,0.28)",letterSpacing:3,fontFamily:"'Segoe UI',system-ui,sans-serif",animation:"ppulse 1.4s ease-in-out infinite",textTransform:"uppercase"}}>
            Opening Pack...
          </div>
        </div>
      )}

      {/* === FLASH on RIP === */}
      {phase==="rip" && (
        <div style={{position:"absolute",inset:0,background:`${t.accent}`,animation:"flashOut 0.35s ease-out forwards",pointerEvents:"none",zIndex:10}}/>
      )}

      {/* === REVEAL PHASE === */}
      {(phase==="reveal"||phase==="done") && (
        <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",position:"relative"}}>

          {/* Tier glow burst */}
          <div style={{position:"absolute",width:480,height:480,borderRadius:"50%",background:`radial-gradient(circle, ${t.accent}40 0%, ${t.accent}10 40%, transparent 70%)`,animation:"glowBurst 0.6s ease-out forwards",pointerEvents:"none"}}/>

          {/* Confetti explosion */}
          {confetti.map(p=>(
            <div key={p.id} style={{
              position:"absolute",
              left:"50%", top:"50%",
              width:p.shape==="rect"?p.size*2:p.size,
              height:p.size,
              borderRadius:p.shape==="circle"?"50%":p.shape==="rect"?"2px":"3px",
              background:p.color,
              boxShadow:`0 0 ${p.size}px ${p.color}88`,
              animation:`confettiBurst 1.2s ${p.delay}s cubic-bezier(0.25,0.46,0.45,0.94) both`,
              "--dx":`${p.dx}px`, "--dy":`${p.dy}px`, "--rot":`${p.rot}deg`,
              pointerEvents:"none",
            } as any}/>
          ))}

          {/* Tier badge — replaces "country" from FIFA */}
          <div style={{
            display:"flex",alignItems:"center",gap:8,marginBottom:14,
            padding:"5px 18px",borderRadius:20,
            background:`linear-gradient(135deg, ${badge.bg}, ${t.bg})`,
            border:`1.5px solid ${t.border}`,
            boxShadow:`0 0 18px ${t.accent}44`,
            animation:"badgeDrop 0.55s 0.05s cubic-bezier(0.34,1.56,0.64,1) both",
            fontFamily:"'Segoe UI',system-ui,sans-serif",
          }}>
            <span style={{fontSize:18}}>{badge.icon}</span>
            <span style={{fontSize:11,fontWeight:900,letterSpacing:3,color:badge.text}}>{badge.label}</span>
          </div>

          {/* The Card */}
          <div style={{animation:"cardZoom 0.65s cubic-bezier(0.22,1,0.36,1) both",filter:`drop-shadow(0 0 28px ${t.accent}88)`}}>
            <ShieldCard card={card} size="large"/>
          </div>

          {/* Tier name shout */}
          <div style={{
            marginTop:20,fontSize:13,fontWeight:900,letterSpacing:5,
            color:t.accent,textTransform:"uppercase",
            fontFamily:"'Segoe UI',system-ui,sans-serif",
            textShadow:`0 0 20px ${t.accent}`,
            animation:"badgeDrop 0.5s 0.2s cubic-bezier(0.34,1.56,0.64,1) both",
          }}>{t.name} Card Claimed!</div>
        </div>
      )}
    </div>
  );
}

// ─── PITCH NODE ───────────────────────────────────────────────
function PitchNode({ ps, card, isCapt, isSelected, captMode, onClick }) {
  const r=26, {x,y}=ps;
  const t=card?.tier;
  const clipId=`pclip-${ps.pos}-${x}-${y}`;
  return (
    <g onClick={onClick} style={{cursor:card?"pointer":"default"}}>
      {/* Selection rings */}
      {isSelected&&<circle cx={x} cy={y} r={r+10} fill={t?.accent||"#fff"} opacity="0.2"/>}
      {isSelected&&<circle cx={x} cy={y} r={r+7}  fill="none" stroke={t?.accent||"#fff"} strokeWidth="2" opacity="0.8" strokeDasharray="4 2"/>}

      {/* Drop shadow ring */}
      <circle cx={x} cy={y} r={r+2} fill="rgba(0,0,0,0.45)"/>

      {card ? (
        <>
          {/* Clip circle for avatar */}
          <defs>
            <clipPath id={clipId}>
              <circle cx={x} cy={y} r={r}/>
            </clipPath>
          </defs>
          {/* Tier-coloured bg behind avatar (fallback if img fails) */}
          <circle cx={x} cy={y} r={r} fill={t.bg}/>
          {/* Avatar photo, clipped to circle */}
          {card.avatarUrl ? (
            <image
              href={proxyAvatar(card.avatarUrl)}
              crossOrigin="anonymous"
              x={x-r} y={y-r} width={r*2} height={r*2}
              clipPath={`url(#${clipId})`}
              preserveAspectRatio="xMidYMin slice"
            />
          ) : (
            <text x={x} y={y+5} fontSize="13" fontWeight="800" fill="#fff"
              fontFamily="'Segoe UI',system-ui,sans-serif" textAnchor="middle">
              {inits(card.displayName)}
            </text>
          )}
          {/* Tier-coloured border ring */}
          <circle cx={x} cy={y} r={r} fill="none" stroke={t.border} strokeWidth="2.5"/>
          {/* OVR + position label below circle */}
          <rect x={x-14} y={y+r} width="28" height="13" rx="4" fill="rgba(0,0,0,0.82)"/>
          <text x={x} y={y+r+9} fontSize="7.5" fontWeight="700" fill={t.textColor}
            fontFamily="'Segoe UI',system-ui,sans-serif" textAnchor="middle">{ps.pos}</text>
          {isCapt&&<text x={x} y={y-r-4} fontSize="13" textAnchor="middle">👑</text>}
        </>
      ):(
        <>
          <circle cx={x} cy={y} r={r} fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5" strokeDasharray="5 3"/>
          <text x={x} y={y+5} fontSize="9" fontWeight="600" fill="rgba(255,255,255,0.35)"
            fontFamily="'Segoe UI',system-ui,sans-serif" textAnchor="middle">{ps.pos}</text>
        </>
      )}
    </g>
  );
}

// ─── FOOTBALL PITCH ───────────────────────────────────────────
// View-only formation. Click a player → opens their card. No more swap
// mode — players pick their position at join time and it's locked.
function FootballPitch({ team, myCardId, onTeamUpdate, onCardView }) {
  const filled = team.slots.filter((s: any) => s.card).length;

  const handleNodeClick = (slotIdx: number) => {
    const slot = team.slots[slotIdx];
    if (slot.card) { SFX.click(); onCardView?.(slot.card); }
  };

  return (
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:12}}>
      {/* Status line — replaces the old swap toolbar */}
      <div style={{display:"flex",alignItems:"center",gap:12,height:30}}>
        <span style={{fontSize:11,color:"rgba(255,255,255,0.4)",letterSpacing:1.5,textTransform:"uppercase",fontWeight:600}}>
          {filled}/11 Players · 4-3-3
        </span>
      </div>

      {/* Pitch SVG */}
      <svg viewBox="0 0 400 540" width="100%" style={{maxWidth:440,borderRadius:12,boxShadow:"0 8px 40px rgba(0,0,0,0.6)"}}>
        {/* Pitch base */}
        <defs>
          <linearGradient id="pg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="#14532d"/>
            <stop offset="50%"  stopColor="#166534"/>
            <stop offset="100%" stopColor="#14532d"/>
          </linearGradient>
          <pattern id="stripes" x="0" y="0" width="40" height="540" patternUnits="userSpaceOnUse">
            <rect x="0"  y="0" width="20" height="540" fill="rgba(0,0,0,0.06)"/>
          </pattern>
        </defs>
        <rect width="400" height="540" fill="url(#pg)" rx="12"/>
        <rect width="400" height="540" fill="url(#stripes)" rx="12"/>

        {/* Pitch markings */}
        <g stroke="rgba(255,255,255,0.35)" strokeWidth="1.5" fill="none">
          {/* Outer boundary */}
          <rect x="18" y="14" width="364" height="512" rx="2"/>
          {/* Halfway line */}
          <line x1="18" y1="270" x2="382" y2="270"/>
          {/* Centre circle */}
          <circle cx="200" cy="270" r="52"/>
          {/* Centre spot */}
          <circle cx="200" cy="270" r="3" fill="rgba(255,255,255,0.35)" stroke="none"/>
          {/* Top penalty area */}
          <rect x="108" y="14" width="184" height="78"/>
          {/* Top goal area */}
          <rect x="148" y="14" width="104" height="36"/>
          {/* Bottom penalty area */}
          <rect x="108" y="448" width="184" height="78"/>
          {/* Bottom goal area */}
          <rect x="148" y="490" width="104" height="36"/>
          {/* Top penalty spot */}
          <circle cx="200" cy="72" r="2.5" fill="rgba(255,255,255,0.35)" stroke="none"/>
          {/* Bottom penalty spot */}
          <circle cx="200" cy="468" r="2.5" fill="rgba(255,255,255,0.35)" stroke="none"/>
          {/* Penalty arcs */}
          <path d="M148 92 A52 52 0 0 0 252 92" strokeDasharray="4 3"/>
          <path d="M148 448 A52 52 0 0 1 252 448" strokeDasharray="4 3"/>
          {/* Corner arcs */}
          <path d="M18 26 A10 10 0 0 1 28 16"/>
          <path d="M372 26 A10 10 0 0 0 382 16"/>
          <path d="M18 514 A10 10 0 0 0 28 524"/>
          <path d="M372 514 A10 10 0 0 1 382 524"/>
        </g>

        {/* Goals */}
        <rect x="158" y="10" width="84" height="10" fill="rgba(255,255,255,0.12)" stroke="rgba(255,255,255,0.3)" strokeWidth="1"/>
        <rect x="158" y="520" width="84" height="10" fill="rgba(255,255,255,0.12)" stroke="rgba(255,255,255,0.3)" strokeWidth="1"/>

        {/* Formation label */}
        <text x="200" y="275" fontSize="11" fill="rgba(255,255,255,0.25)" fontWeight="700" fontFamily="'Segoe UI',system-ui,sans-serif" textAnchor="middle" letterSpacing="3">1-4-3-3</text>

        {/* Player nodes */}
        {PITCH_SLOTS.map((ps,i)=>(
          <PitchNode key={ps.id} ps={ps} card={team.slots[i].card}
            isCapt={team.slots[i].card?.id===team.captainId}
            isSelected={false}
            captMode={false}
            onClick={()=>handleNodeClick(i)}
          />
        ))}
      </svg>

      {/* Squad stats bar */}
      <div style={{display:"flex",gap:24,padding:"10px 24px",background:"rgba(255,255,255,0.03)",borderRadius:10,border:"1px solid rgba(255,255,255,0.06)"}}>
        <div style={{textAlign:"center"}}>
          <div style={{fontSize:18,fontWeight:800,color:filled===11?"#10B981":"#fff"}}>{filled}<span style={{fontSize:12,color:"rgba(255,255,255,0.4)"}}>/11</span></div>
          <div style={{fontSize:9,color:"rgba(255,255,255,0.35)",letterSpacing:1,textTransform:"uppercase"}}>Players</div>
        </div>
        {filled>0&&(
          <div style={{textAlign:"center"}}>
            <div style={{fontSize:18,fontWeight:800}}>{Math.round(team.slots.filter(s=>s.card).reduce((a,s)=>a+s.card.ovr,0)/filled)}</div>
            <div style={{fontSize:9,color:"rgba(255,255,255,0.35)",letterSpacing:1,textTransform:"uppercase"}}>Avg OVR</div>
          </div>
        )}
        <div style={{textAlign:"center"}}>
          <div style={{fontSize:18,fontWeight:800,color:filled===11?"#10B981":"rgba(255,255,255,0.4)"}}>{filled===11?"FULL ✓":"Open"}</div>
          <div style={{fontSize:9,color:"rgba(255,255,255,0.35)",letterSpacing:1,textTransform:"uppercase"}}>Status</div>
        </div>
      </div>
    </div>
  );
}

// ─── SHARED NAV ───────────────────────────────────────────────
function Nav({ onHome, right = null }: { onHome: any; right?: any }) {
  const [muted, setMuted] = useState(false);
  const toggleMute = () => { const m=!muted; setMuted(m); SFX.muted=m; if(!m) SFX.click(); };
  return (
    <header style={{padding:"16px 24px",display:"flex",justifyContent:"space-between",alignItems:"center",borderBottom:"1px solid rgba(255,255,255,0.05)",fontFamily:"'Segoe UI',system-ui,sans-serif"}}>
      <div style={{display:"flex",alignItems:"center",gap:12}}>
        {onHome&&<button onClick={()=>{ SFX.click(); onHome(); }} style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.08)",color:"#fff",borderRadius:7,padding:"6px 13px",cursor:"pointer",fontSize:12,fontWeight:600}}>← Home</button>}
        <span style={{fontSize:15,fontWeight:800,color:"#fff",letterSpacing:0.5}}>CT<span style={{color:"#FBBF24"}}>WC</span></span>
      </div>
      <div style={{display:"flex",gap:10,alignItems:"center"}}>
        {right}
        <button onClick={toggleMute} title={muted?"Unmute":"Mute"} style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.08)",color:"#fff",borderRadius:7,padding:"6px 10px",cursor:"pointer",fontSize:14,lineHeight:1,transition:"all 0.2s",opacity:muted?0.5:1}}>
          {muted?"🔇":"🔊"}
        </button>
      </div>
    </header>
  );
}

// ─── LANDING ──────────────────────────────────────────────────
// ─── NOTIFICATION STACK ───────────────────────────────────────
// Toast-style notifications stacked in the top-right. Each entry has a
// timestamp, color, icon, title/body, and an optional opponent team.
function NotificationStack({ notifications, onDismiss, onClick }: any) {
  if (!notifications || notifications.length === 0) return null;
  return (
    <div style={{
      position:"fixed",top:18,right:18,zIndex:500,
      display:"flex",flexDirection:"column",gap:10,
      pointerEvents:"none", // children re-enable
      maxWidth:340,
    }}>
      {notifications.map((n: any) => (
        <div key={n.id}
          onClick={() => onClick?.(n)}
          style={{
            pointerEvents:"auto",cursor:"pointer",
            background:"linear-gradient(135deg, rgba(8,12,22,0.96), rgba(15,23,42,0.96))",
            border:`1px solid ${n.color}66`,
            borderLeft:`4px solid ${n.color}`,
            borderRadius:11,
            padding:"12px 14px 12px 14px",
            display:"flex",gap:11,alignItems:"flex-start",
            boxShadow:`0 0 24px ${n.color}33, 0 8px 24px rgba(0,0,0,0.6)`,
            backdropFilter:"blur(14px)",
            animation:"notifSlide 0.3s cubic-bezier(0.22,1,0.36,1) both",
            position:"relative",
            fontFamily:"'Segoe UI',system-ui,sans-serif",
          }}
          onMouseEnter={e => { e.currentTarget.style.transform = "translateX(-3px)"; }}
          onMouseLeave={e => { e.currentTarget.style.transform = "translateX(0)"; }}
        >
          <div style={{fontSize:24,lineHeight:1,flexShrink:0}}>{n.icon}</div>
          <div style={{flex:1,minWidth:0}}>
            <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:2}}>
              <span style={{fontSize:12,fontWeight:900,color:n.color,letterSpacing:0.4}}>{n.title}</span>
              {n.subtitle && <span style={{fontSize:9,fontWeight:700,letterSpacing:1,color:"rgba(255,255,255,0.45)",textTransform:"uppercase"}}>· {n.subtitle}</span>}
            </div>
            <div style={{fontSize:11,color:"rgba(255,255,255,0.78)",fontWeight:500}}>{n.body}</div>
            {n.opponent && (
              <div style={{display:"flex",alignItems:"center",gap:5,marginTop:4,fontSize:10,color:n.opponent.color,fontWeight:700}}>
                <EmblemImg team={n.opponent} size={11}/>
                <span>{n.opponent.name}</span>
              </div>
            )}
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); onDismiss?.(n.id); }}
            style={{
              background:"transparent",border:"none",
              color:"rgba(255,255,255,0.4)",fontSize:13,cursor:"pointer",
              padding:2,marginLeft:4,
            }}
            aria-label="Dismiss"
          >✕</button>
          {/* Auto-dismiss progress bar */}
          <div style={{
            position:"absolute",bottom:0,left:0,height:2,
            width:"100%",background:"rgba(255,255,255,0.06)",overflow:"hidden",
            borderRadius:"0 0 11px 11px",
          }}>
            <div style={{
              height:"100%",background:n.color,
              animation:"notifBar 9s linear forwards",
              boxShadow:`0 0 6px ${n.color}`,
            }}/>
          </div>
        </div>
      ))}
      <style>{`
        @keyframes notifSlide { from { opacity:0; transform:translateX(40px) } to { opacity:1; transform:translateX(0) } }
        @keyframes notifBar   { from { width:100% } to { width:0% } }
      `}</style>
    </div>
  );
}

// ─── REGISTRATION COUNTDOWN ───────────────────────────────────
// Live ticker banner shown above the hero. Hides when no deadline is set
// or after the bracket is seeded (registration already closed).
function RegistrationCountdown({ tournament }: any) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const deadline = tournament?.registration_deadline;
  if (!deadline) return null;
  if (tournament?.status && tournament.status !== "registration") return null;

  const target = new Date(deadline).getTime();
  const ms = target - now;
  const closed = ms <= 0;

  // Time pieces
  const total = Math.max(0, ms);
  const days  = Math.floor(total / 86_400_000);
  const hrs   = Math.floor((total % 86_400_000) / 3_600_000);
  const mins  = Math.floor((total % 3_600_000) / 60_000);
  const secs  = Math.floor((total % 60_000) / 1000);

  // Urgency tiers — colour & pulse change as deadline approaches
  const urgency = closed
    ? { color: "#EF4444", glow: "rgba(239,68,68,0.55)", label: "REGISTRATION CLOSED", anim: "" }
    : days >= 1
      ? { color: "#22C55E", glow: "rgba(34,197,94,0.4)", label: "REGISTRATION OPEN — Lock-in counts down", anim: "" }
      : hrs >= 1
        ? { color: "#FBBF24", glow: "rgba(212,165,55,0.5)", label: "FINAL HOURS — Claim your card", anim: "" }
        : { color: "#EF4444", glow: "rgba(239,68,68,0.55)", label: "DEADLINE IMMINENT", anim: "ppulse 0.9s ease-in-out infinite" };

  const cell = (n: number, label: string) => (
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
      <div style={{
        fontSize:24,fontWeight:900,color:urgency.color,lineHeight:1,
        fontVariantNumeric:"tabular-nums",
        textShadow:`0 0 12px ${urgency.glow}`,minWidth:38,textAlign:"center",
      }}>{String(n).padStart(2,"0")}</div>
      <div style={{fontSize:8,fontWeight:700,letterSpacing:1.5,color:"rgba(255,255,255,0.45)"}}>{label}</div>
    </div>
  );

  return (
    <div style={{
      position:"relative",zIndex:10,
      padding:"10px 28px",
      borderBottom:`1px solid ${urgency.color}33`,
      background:`linear-gradient(90deg, transparent, ${urgency.color}10 30%, ${urgency.color}10 70%, transparent)`,
      backdropFilter:"blur(8px)",
      animation: urgency.anim,
      display:"flex",alignItems:"center",justifyContent:"center",gap:24,flexWrap:"wrap",
    }}>
      <div style={{display:"flex",alignItems:"center",gap:8}}>
        <div style={{
          width:8,height:8,borderRadius:"50%",background:urgency.color,
          boxShadow:`0 0 10px ${urgency.glow}`,
          animation: closed ? "none" : "ppulse 1.4s ease-in-out infinite",
        }}/>
        <span style={{fontSize:11,fontWeight:800,color:urgency.color,letterSpacing:2.5}}>
          {urgency.label}
        </span>
      </div>
      {!closed && (
        <div style={{display:"flex",alignItems:"center",gap:14}}>
          {cell(days, "DAYS")}
          <span style={{fontSize:18,color:`${urgency.color}66`,fontWeight:900}}>:</span>
          {cell(hrs, "HRS")}
          <span style={{fontSize:18,color:`${urgency.color}66`,fontWeight:900}}>:</span>
          {cell(mins, "MIN")}
          <span style={{fontSize:18,color:`${urgency.color}66`,fontWeight:900}}>:</span>
          {cell(secs, "SEC")}
        </div>
      )}
    </div>
  );
}

function Landing({ onConnect, onPool, onTeams, onTournament, onLeaderboard, pool, teams, myCard, onMyTeam, sessionLoading, totalClaimed, tournament }: any) {
  const [hov, setHov] = useState(false);
  const preview = useRef([
    createCard(MOCK_PROFILES[1],"ST"),
    createCard(MOCK_PROFILES[7],"CM"),
    createCard(MOCK_PROFILES[3],"GK"),
  ]).current;
  const totalSigned = teams.reduce((s,t)=>s+t.memberIds.length,0);
  const fullTeams   = teams.filter(t=>t.memberIds.length===11).length;
  const pct = Math.min(Math.round((totalClaimed/POOL_CAP)*100),100);

  return (
    <div style={{minHeight:"100vh",background:"#070B14",color:"#fff",fontFamily:"'Segoe UI',system-ui,sans-serif",position:"relative",overflow:"hidden",display:"flex",flexDirection:"column"}}>

      {/* ── Animated background ── */}
      <div style={{position:"absolute",inset:0,pointerEvents:"none",overflow:"hidden"}}>
        <div style={{position:"absolute",top:"-10%",right:"-5%",width:700,height:700,borderRadius:"50%",background:"radial-gradient(circle,rgba(212,165,55,0.07) 0%,transparent 65%)",animation:"orbFloat 14s ease-in-out infinite"}}/>
        <div style={{position:"absolute",bottom:"-20%",left:"-8%",width:550,height:550,borderRadius:"50%",background:"radial-gradient(circle,rgba(168,85,247,0.06) 0%,transparent 65%)",animation:"orbFloat 18s ease-in-out infinite reverse"}}/>
        <div style={{position:"absolute",top:"35%",left:"45%",width:400,height:400,borderRadius:"50%",background:"radial-gradient(circle,rgba(59,130,246,0.04) 0%,transparent 65%)",animation:"orbFloat 22s ease-in-out infinite"}}/>
        <div style={{position:"absolute",inset:0,opacity:0.025,backgroundImage:"linear-gradient(rgba(255,255,255,0.12) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.12) 1px,transparent 1px)",backgroundSize:"60px 60px"}}/>
        <div style={{position:"absolute",top:0,left:0,right:0,height:1,background:"linear-gradient(90deg,transparent 0%,rgba(212,165,55,0.25) 50%,transparent 100%)"}}/>
      </div>

      {/* ── Header ── */}
      <header style={{padding:"18px 28px",display:"flex",justifyContent:"space-between",alignItems:"center",borderBottom:"1px solid rgba(255,255,255,0.05)",position:"relative",zIndex:10,backdropFilter:"blur(8px)"}}>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <div style={{width:38,height:38,borderRadius:10,background:"linear-gradient(135deg,#D4A537,#FBBF24)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,fontWeight:900,color:"#1a1a1a",boxShadow:"0 0 18px rgba(212,165,55,0.35)"}}>CT</div>
          <span style={{fontSize:20,fontWeight:900,letterSpacing:0.5}}>CT<span style={{color:"#FBBF24"}}>WC</span></span>
          <div style={{padding:"2px 9px",borderRadius:20,background:"rgba(34,197,94,0.1)",border:"1px solid rgba(34,197,94,0.25)",fontSize:9,fontWeight:700,color:"#22C55E",letterSpacing:1.5}}>LIVE</div>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
          <button onClick={onPool} style={{background:"transparent",border:"1px solid rgba(255,255,255,0.08)",color:"rgba(255,255,255,0.55)",borderRadius:8,padding:"7px 15px",cursor:"pointer",fontSize:12,fontWeight:600,transition:"all 0.2s"}}
            onMouseEnter={e=>{e.currentTarget.style.borderColor="rgba(255,255,255,0.2)";e.currentTarget.style.color="rgba(255,255,255,0.9)";}}
            onMouseLeave={e=>{e.currentTarget.style.borderColor="rgba(255,255,255,0.08)";e.currentTarget.style.color="rgba(255,255,255,0.55)";}}>Pool ({pool.length})</button>
          <button onClick={onTeams} style={{background:"transparent",border:"1px solid rgba(255,255,255,0.08)",color:"rgba(255,255,255,0.55)",borderRadius:8,padding:"7px 15px",cursor:"pointer",fontSize:12,fontWeight:600,transition:"all 0.2s"}}
            onMouseEnter={e=>{e.currentTarget.style.borderColor="rgba(255,255,255,0.2)";e.currentTarget.style.color="rgba(255,255,255,0.9)";}}
            onMouseLeave={e=>{e.currentTarget.style.borderColor="rgba(255,255,255,0.08)";e.currentTarget.style.color="rgba(255,255,255,0.55)";}}>Teams</button>
          <button onClick={onLeaderboard} style={{background:"transparent",border:"1px solid rgba(255,255,255,0.08)",color:"rgba(255,255,255,0.55)",borderRadius:8,padding:"7px 15px",cursor:"pointer",fontSize:12,fontWeight:600,transition:"all 0.2s"}}
            onMouseEnter={e=>{e.currentTarget.style.borderColor="rgba(255,255,255,0.2)";e.currentTarget.style.color="rgba(255,255,255,0.9)";}}
            onMouseLeave={e=>{e.currentTarget.style.borderColor="rgba(255,255,255,0.08)";e.currentTarget.style.color="rgba(255,255,255,0.55)";}}>📊 Leaderboard</button>
          <button onClick={onTournament} style={{background:"rgba(212,165,55,0.12)",border:"1px solid rgba(212,165,55,0.3)",color:"#FBBF24",borderRadius:8,padding:"7px 15px",cursor:"pointer",fontSize:12,fontWeight:700,transition:"all 0.2s",boxShadow:"0 0 12px rgba(212,165,55,0.08)"}}
            onMouseEnter={e=>{e.currentTarget.style.background="rgba(212,165,55,0.22)";e.currentTarget.style.boxShadow="0 0 22px rgba(212,165,55,0.22)";}}
            onMouseLeave={e=>{e.currentTarget.style.background="rgba(212,165,55,0.12)";e.currentTarget.style.boxShadow="0 0 12px rgba(212,165,55,0.08)";}}>🏆 Tournament</button>
        </div>
      </header>

      {/* ── Registration deadline countdown ── */}
      <RegistrationCountdown tournament={tournament}/>

      {/* ── Hero ── */}
      <main style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",padding:"52px 28px 36px",position:"relative",zIndex:10}}>
        <div style={{display:"flex",alignItems:"center",gap:80,maxWidth:1120,width:"100%",flexWrap:"wrap",justifyContent:"center"}}>

          {/* Copy */}
          <div style={{flex:"1 1 380px",maxWidth:530,animation:"fadeUp 0.6s ease both"}}>
            <div style={{display:"inline-flex",alignItems:"center",gap:8,padding:"5px 14px",borderRadius:20,background:"rgba(212,165,55,0.08)",border:"1px solid rgba(212,165,55,0.2)",fontSize:10,fontWeight:700,color:"#FBBF24",marginBottom:26,letterSpacing:2}}>
              <span style={{width:6,height:6,borderRadius:"50%",background:"#22C55E",boxShadow:"0 0 6px #22C55E",display:"inline-block",animation:"ppulse 2s ease-in-out infinite"}}/>
              SEASON 1 · REGISTRATION OPEN
            </div>

            <h1 style={{fontSize:64,fontWeight:900,lineHeight:1.03,margin:"0 0 8px",letterSpacing:-2.5}}>
              Crypto Twitter.<br/>
              <span style={{background:"linear-gradient(90deg,#FBBF24 0%,#F59E0B 45%,#D4A537 100%)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",filter:"drop-shadow(0 0 32px rgba(212,165,55,0.28))"}}>World Cup.</span>
            </h1>

            <p style={{fontSize:16,color:"rgba(255,255,255,0.42)",lineHeight:1.72,margin:"22px 0 34px",maxWidth:430}}>
              Your CT stats become your player card. Join one of 32 teams. The tournament runs on real engagement — tweet more, win more.
            </p>

            {sessionLoading ? (
              <button disabled style={{padding:"16px 36px",fontSize:15,fontWeight:700,color:"rgba(26,26,26,0.6)",background:"linear-gradient(135deg,#FBBF24,#D4A537)",border:"none",borderRadius:12,cursor:"default",opacity:0.7,display:"inline-flex",alignItems:"center",gap:10}}>
                <span style={{width:16,height:16,border:"2px solid rgba(0,0,0,0.3)",borderTopColor:"#1a1a1a",borderRadius:"50%",display:"inline-block",animation:"spin 0.7s linear infinite"}}/>
                Loading session...
              </button>
            ) : myCard ? (
              <button onClick={()=>{SFX.click();onMyTeam();}} onMouseEnter={()=>setHov(true)} onMouseLeave={()=>setHov(false)}
                style={{padding:"16px 36px",fontSize:15,fontWeight:700,color:"#1a1a1a",background:"linear-gradient(135deg,#FBBF24,#D4A537)",border:"none",borderRadius:12,cursor:"pointer",
                  boxShadow:hov?"0 0 44px rgba(212,165,55,0.55),0 8px 24px rgba(212,165,55,0.3)":"0 4px 20px rgba(212,165,55,0.22)",
                  transform:hov?"translateY(-2px)":"translateY(0)",transition:"all 0.25s",display:"inline-flex",alignItems:"center",gap:10}}>
                ⚽ My Team · OVR {myCard.ovr}
              </button>
            ) : (
              <button onClick={()=>{SFX.click();onConnect();}} onMouseEnter={()=>setHov(true)} onMouseLeave={()=>setHov(false)}
                style={{padding:"16px 36px",fontSize:15,fontWeight:700,color:"#1a1a1a",background:"linear-gradient(135deg,#FBBF24,#D4A537)",border:"none",borderRadius:12,cursor:"pointer",
                  boxShadow:hov?"0 0 44px rgba(212,165,55,0.55),0 8px 24px rgba(212,165,55,0.3)":"0 4px 20px rgba(212,165,55,0.22)",
                  transform:hov?"translateY(-2px)":"translateY(0)",transition:"all 0.25s",display:"inline-flex",alignItems:"center",gap:10}}>
                <span style={{fontSize:18}}>𝕏</span> Connect & Claim Your Card
              </button>
            )}

            {/* Live stats */}
            <div style={{display:"flex",gap:32,marginTop:38,paddingTop:30,borderTop:"1px solid rgba(255,255,255,0.07)",flexWrap:"wrap"}}>
              {[
                {v:totalClaimed,     l:"Cards Claimed",  c:"#FBBF24"},
                {v:totalSigned,      l:"Players Signed", c:"#22C55E"},
                {v:`${fullTeams}/32`,l:"Full Squads",    c:"#A855F7"},
              ].map(s=>(
                <div key={s.l}>
                  <div style={{fontSize:28,fontWeight:900,color:s.c,lineHeight:1,letterSpacing:-0.5}}>{s.v}</div>
                  <div style={{fontSize:9,color:"rgba(255,255,255,0.28)",letterSpacing:1.5,textTransform:"uppercase",marginTop:5}}>{s.l}</div>
                </div>
              ))}
            </div>

            {/* Pool fill bar */}
            <div style={{marginTop:18,maxWidth:360}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                <span style={{fontSize:9,color:"rgba(255,255,255,0.22)",letterSpacing:1.5}}>{POOL_CAP-totalClaimed} SPOTS REMAINING</span>
                <span style={{fontSize:9,color:"rgba(255,255,255,0.4)",fontWeight:700}}>{pct}% FULL</span>
              </div>
              <div style={{height:4,background:"rgba(255,255,255,0.05)",borderRadius:2,overflow:"hidden"}}>
                <div style={{height:"100%",width:`${pct}%`,background:"linear-gradient(90deg,#9945FF,#FBBF24)",borderRadius:2,transition:"width 0.6s",boxShadow:"0 0 8px rgba(212,165,55,0.4)"}}/>
              </div>
            </div>
          </div>

          {/* Card fan */}
          <div style={{flex:"0 0 auto",position:"relative",height:400,width:330,perspective:"900px",animation:"fadeUp 0.7s 0.15s ease both"}}>
            <div style={{position:"absolute",top:50,left:0,transform:"rotate(-11deg) translateZ(-10px)",zIndex:1,opacity:0.75,filter:"blur(0.3px)"}}>
              <ShieldCard card={preview[2]} size="small"/>
            </div>
            <div style={{position:"absolute",top:20,left:46,transform:"rotate(-4deg)",zIndex:2,animation:"packFloat 7s ease-in-out infinite"}}>
              <ShieldCard card={preview[0]} size="small"/>
            </div>
            <div style={{position:"absolute",top:0,left:112,transform:"rotate(7deg)",zIndex:3,animation:"packFloat 9s ease-in-out infinite reverse"}}>
              <ShieldCard card={preview[1]} size="small"/>
            </div>
            <div style={{position:"absolute",bottom:-10,left:"50%",transform:"translateX(-50%)",width:220,height:60,background:"radial-gradient(ellipse,rgba(212,165,55,0.18),transparent)",filter:"blur(24px)"}}/>
          </div>
        </div>
      </main>

      {/* ── How it works ── */}
      <div style={{borderTop:"1px solid rgba(255,255,255,0.05)",borderBottom:"1px solid rgba(255,255,255,0.05)",background:"rgba(255,255,255,0.012)",position:"relative",zIndex:10}}>
        <div style={{maxWidth:960,margin:"0 auto",padding:"0 24px",display:"grid",gridTemplateColumns:"repeat(3,1fr)"}}>
          {[
            {n:"01",icon:"𝕏", title:"Connect X",       desc:"Sign in with your account. Your public stats — followers, engagement, reach — are scored instantly."},
            {n:"02",icon:"🛡", title:"Get Your Card",   desc:"Receive an EA-FC style player card based on your real CT influence. One account, one card, forever."},
            {n:"03",icon:"⚽", title:"Win the Cup",     desc:"Join a team of 11. Compete in the bracket. Live tweets update your stats before every round."},
          ].map((s,i)=>(
            <div key={s.n} style={{padding:"24px 28px",borderRight:i<2?"1px solid rgba(255,255,255,0.05)":"none",display:"flex",gap:16,alignItems:"flex-start"}}>
              <div style={{fontSize:24,flexShrink:0,marginTop:1}}>{s.icon}</div>
              <div>
                <div style={{fontSize:9,color:"#FBBF24",fontWeight:700,letterSpacing:2,marginBottom:5}}>{s.n}</div>
                <div style={{fontSize:13,fontWeight:800,color:"#fff",marginBottom:6}}>{s.title}</div>
                <div style={{fontSize:11,color:"rgba(255,255,255,0.36)",lineHeight:1.65}}>{s.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Teams strip ── */}
      <div style={{padding:"14px 0",borderBottom:"1px solid rgba(255,255,255,0.04)",overflowX:"auto",position:"relative",zIndex:10}}>
        <div style={{display:"flex",gap:8,paddingLeft:24,paddingRight:24,width:"max-content"}}>
          {teams.map(t=>(
            <div key={t.id} onClick={onTournament} style={{display:"flex",alignItems:"center",gap:7,padding:"7px 13px",borderRadius:9,background:`${t.color}0e`,border:`1px solid ${t.color}22`,cursor:"pointer",flexShrink:0,transition:"all 0.18s"}}
              onMouseEnter={e=>{e.currentTarget.style.background=`${t.color}22`;e.currentTarget.style.borderColor=`${t.color}44`;}}
              onMouseLeave={e=>{e.currentTarget.style.background=`${t.color}0e`;e.currentTarget.style.borderColor=`${t.color}22`;}}>
              <EmblemImg team={t} size={14}/>
              <span style={{fontSize:10,fontWeight:700,color:t.color,whiteSpace:"nowrap"}}>{t.name}</span>
              <span style={{fontSize:9,color:"rgba(255,255,255,0.2)"}}>{t.memberIds.length}/11</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Tier legend ── */}
      <div style={{padding:"12px 28px",display:"flex",justifyContent:"center",gap:24,flexWrap:"wrap",position:"relative",zIndex:10}}>
        {Object.values(TIERS).map(t=>(
          <div key={t.name} style={{display:"flex",alignItems:"center",gap:6}}>
            <div style={{width:7,height:7,borderRadius:"50%",background:t.border,boxShadow:`0 0 5px ${t.glow}`}}/>
            <span style={{fontSize:9,fontWeight:600,color:"rgba(255,255,255,0.32)",letterSpacing:1.5,textTransform:"uppercase"}}>{t.name}</span>
          </div>
        ))}
      </div>

      {/* ── Footer credit ── */}
      <div style={{padding:"22px 28px 26px",textAlign:"center",position:"relative",zIndex:10,
        borderTop:"1px solid rgba(255,255,255,0.04)"}}>
        <div style={{display:"inline-flex",alignItems:"center",gap:6,
          padding:"6px 14px",borderRadius:20,
          background:"rgba(255,255,255,0.025)",border:"1px solid rgba(255,255,255,0.06)"}}>
          <span style={{fontSize:11,fontWeight:600,color:"rgba(255,255,255,0.45)"}}>vibecoded by</span>
          <a href="https://x.com/okes" target="_blank" rel="noopener noreferrer"
            onClick={(e)=>e.stopPropagation()}
            style={{
              display:"flex",alignItems:"center",gap:4,
              fontSize:11,fontWeight:800,color:"#FBBF24",textDecoration:"none",
              transition:"all 0.18s",
            }}
            onMouseEnter={e=>{ (e.currentTarget as HTMLElement).style.color="#FDE68A"; (e.currentTarget as HTMLElement).style.textShadow="0 0 10px rgba(212,165,55,0.6)"; }}
            onMouseLeave={e=>{ (e.currentTarget as HTMLElement).style.color="#FBBF24"; (e.currentTarget as HTMLElement).style.textShadow="none"; }}
          >
            <span style={{fontSize:10}}>𝕏</span>
            <span>@okes</span>
          </a>
        </div>
      </div>
    </div>
  );
}

// ─── CONNECT PAGE ─────────────────────────────────────────────
function ConnectPage({ onBack }) {
  return (
    <div style={{minHeight:"100vh",background:"#070B14",color:"#fff",fontFamily:"'Segoe UI',system-ui,sans-serif"}}>
      <Nav onHome={onBack} right={<span style={{fontSize:11,color:"rgba(255,255,255,0.3)"}}>One card per account</span>}/>
      <div style={{maxWidth:480,margin:"0 auto",padding:"80px 20px",textAlign:"center"}}>
        <div style={{fontSize:52,marginBottom:20}}>𝕏</div>
        <h2 style={{fontSize:28,fontWeight:800,margin:"0 0 10px"}}>Connect Your X Account</h2>
        <p style={{color:"rgba(255,255,255,0.45)",margin:"0 0 40px",fontSize:14,lineHeight:1.6}}>
          Sign in with X to claim your CTWC card.<br/>
          Your real stats are pulled directly from your profile.<br/>
          <strong style={{color:"rgba(255,255,255,0.7)"}}>One account · one card · locked forever.</strong>
        </p>
        <a href="/api/auth/twitter" style={{display:"inline-flex",alignItems:"center",gap:10,padding:"15px 36px",fontSize:15,fontWeight:700,color:"#fff",background:"#000",border:"2px solid rgba(255,255,255,0.15)",borderRadius:12,cursor:"pointer",textDecoration:"none",boxShadow:"0 4px 20px rgba(0,0,0,0.4)",transition:"all 0.2s"}}
          onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.background="#1a1a1a";(e.currentTarget as HTMLElement).style.borderColor="rgba(255,255,255,0.3)";}}
          onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.background="#000";(e.currentTarget as HTMLElement).style.borderColor="rgba(255,255,255,0.15)";}}>
          <span style={{fontSize:20}}>𝕏</span> Sign in with X to Claim
        </a>
        <p style={{marginTop:24,fontSize:11,color:"rgba(255,255,255,0.2)"}}>
          We only read your public profile — no posting, no DMs.
        </p>
      </div>
    </div>
  );
}

// ─── TEAM SETUP (post-reveal) — redirect straight to Browse ───
function TeamSetupPage({ card, onBrowseTeams, onSkip }) {
  useEffect(() => { onBrowseTeams(); }, []);
  return (
    <div style={{minHeight:"100vh",background:"#070B14",display:"flex",alignItems:"center",justifyContent:"center"}}>
      <div style={{color:"rgba(255,255,255,0.4)",fontSize:14,fontFamily:"'Segoe UI',system-ui,sans-serif"}}>Loading teams…</div>
    </div>
  );
}

// ─── CREATE TEAM ──────────────────────────────────────────────
function CreateTeamPage({ card, onCreated, onBack }) {
  const [name,setName]=useState(""),  [color,setColor]=useState(TEAM_COLORS[0]), [emblem,setEmblem]=useState(TEAM_EMBLEMS[0]);
  const create=()=>{
    if(!name.trim()) return;
    let t=makeTeam(name.trim(),color,emblem,null);
    t=addCardToTeam(t,card);
    SFX.success();
    onCreated(t);
  };
  return (
    <div style={{minHeight:"100vh",background:"#070B14",color:"#fff",fontFamily:"'Segoe UI',system-ui,sans-serif"}}>
      <Nav onHome={onBack}/>
      <div style={{maxWidth:520,margin:"0 auto",padding:"36px 20px"}}>
        <h2 style={{fontSize:24,fontWeight:800,margin:"0 0 6px"}}>Create Your Team</h2>
        <p style={{color:"rgba(255,255,255,0.4)",fontSize:13,margin:"0 0 28px"}}>You'll be placed as captain (you're the first member).</p>

        <div style={{marginBottom:20}}>
          <label style={{display:"block",fontSize:11,fontWeight:600,color:"rgba(255,255,255,0.5)",letterSpacing:1,textTransform:"uppercase",marginBottom:8}}>Team Name</label>
          <input value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. Diamond Hands FC" maxLength={28}
            style={{width:"100%",padding:"12px 15px",fontSize:14,borderRadius:9,background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.1)",color:"#fff",outline:"none",fontFamily:"inherit"}}/>
        </div>

        <div style={{marginBottom:20}}>
          <label style={{display:"block",fontSize:11,fontWeight:600,color:"rgba(255,255,255,0.5)",letterSpacing:1,textTransform:"uppercase",marginBottom:8}}>Team Colour</label>
          <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
            {TEAM_COLORS.map(c=><button key={c} onClick={()=>setColor(c)} style={{width:36,height:36,borderRadius:"50%",background:c,border:color===c?"3px solid #fff":"3px solid transparent",cursor:"pointer",outline:"none",transition:"transform 0.15s",transform:color===c?"scale(1.15)":"scale(1)"}}/>)}
          </div>
        </div>

        <div style={{marginBottom:32}}>
          <label style={{display:"block",fontSize:11,fontWeight:600,color:"rgba(255,255,255,0.5)",letterSpacing:1,textTransform:"uppercase",marginBottom:8}}>Team Emblem</label>
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            {TEAM_EMBLEMS.map(e=><button key={e} onClick={()=>setEmblem(e)} style={{width:44,height:44,borderRadius:10,fontSize:20,background:emblem===e?"rgba(255,255,255,0.1)":"rgba(255,255,255,0.03)",border:emblem===e?`2px solid ${color}`:"2px solid rgba(255,255,255,0.08)",cursor:"pointer",transition:"all 0.15s"}}>{e}</button>)}
          </div>
        </div>

        {/* Preview */}
        <div style={{padding:"16px 20px",borderRadius:12,background:"rgba(255,255,255,0.03)",border:`1px solid ${color}33`,marginBottom:24,display:"flex",alignItems:"center",gap:14}}>
          <div style={{width:44,height:44,borderRadius:10,background:color,display:"flex",alignItems:"center",justifyContent:"center",fontSize:22}}>{emblem}</div>
          <div>
            <div style={{fontSize:15,fontWeight:800,color:"#fff"}}>{name||"Your Team Name"}</div>
            <div style={{fontSize:11,color:"rgba(255,255,255,0.4)"}}>1/11 players · You are Captain 👑</div>
          </div>
        </div>

        <button onClick={create} disabled={!name.trim()} style={{width:"100%",padding:"14px",fontSize:14,fontWeight:700,color:"#1a1a1a",background:name.trim()?"linear-gradient(135deg,#FBBF24,#D4A537)":"rgba(255,255,255,0.1)",border:"none",borderRadius:10,cursor:name.trim()?"pointer":"not-allowed",boxShadow:name.trim()?"0 4px 16px rgba(212,165,55,0.28)":"none",transition:"all 0.2s"}}>
          Create Team & Join as Captain
        </button>
      </div>
    </div>
  );
}

// ─── BROWSE TEAMS ──────────────────────────────────────────────
function BrowseTeamsPage({ card, teams, onJoined, onBack }: any) {
  const [joining, setJoining] = useState<string | null>(null);
  const [error,   setError]   = useState<string | null>(null);
  const [search, setSearch]   = useState("");
  const [filter, setFilter]   = useState("open"); // "open" | "all"
  // The team the user clicked "Pick Position" on — opens the picker modal
  const [pickingTeam, setPickingTeam] = useState<any>(null);

  const myTeam = card ? teams.find((t: any) => t.memberIds.includes(card.id)) : null;

  const visible = teams
    .filter((t: any) => filter==="all" || t.memberIds.length < 11)
    .filter((t: any) => !search || t.name.toLowerCase().includes(search.toLowerCase()));

  // Step 1: User clicks the team's "Pick Position" button → opens picker
  const startPick = (team: any) => {
    if (team.memberIds.length >= 11) return;
    if (joining) return;
    SFX.click();
    setError(null);
    setPickingTeam(team);
  };

  // Step 2: User picks a slot in the modal → fires the actual join API call
  const confirmPick = async (position: string) => {
    if (!pickingTeam) return;
    const team = pickingTeam;
    setJoining(team.id);
    try {
      const errMsg = await onJoined(team, position);
      if (errMsg) {
        setError(errMsg);
        setJoining(null);
        setPickingTeam(null);
        return;
      }
      SFX.success();
      // On success parent navigates to TeamPage — leave joining set so the
      // button stays disabled until this page unmounts.
    } catch (e: any) {
      setError("Unexpected error — try again");
      setJoining(null);
      setPickingTeam(null);
    }
  };

  // Auto-clear errors after 6 seconds
  useEffect(() => {
    if (!error) return;
    const id = setTimeout(() => setError(null), 6000);
    return () => clearTimeout(id);
  }, [error]);

  const totalFilled  = teams.reduce((s: number, t: any) => s + t.memberIds.length, 0);
  const totalSlots   = teams.length * 11;

  return (
    <div style={{minHeight:"100vh",background:"#070B14",color:"#fff",fontFamily:"'Segoe UI',system-ui,sans-serif"}}>
      <Nav onHome={onBack}/>

      {/* Error banner — surfaces 403/409/500s from /api/join-team */}
      {error && (
        <div style={{
          margin:"14px 24px 0",
          padding:"11px 16px",
          background:"linear-gradient(90deg, rgba(239,68,68,0.18), rgba(239,68,68,0.06))",
          border:"1px solid rgba(239,68,68,0.5)",
          borderRadius:9,
          display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,
          animation:"holoIn 0.25s cubic-bezier(0.22,1,0.36,1) both",
        }}>
          <div style={{display:"flex",alignItems:"center",gap:9}}>
            <span style={{fontSize:18}}>⚠️</span>
            <span style={{fontSize:13,fontWeight:700,color:"#FCA5A5"}}>{error}</span>
          </div>
          <button onClick={()=>setError(null)} style={{
            background:"transparent",border:"none",color:"rgba(255,255,255,0.5)",
            fontSize:14,cursor:"pointer",padding:4,
          }}>✕</button>
        </div>
      )}

      {/* Header */}
      <div style={{background:"rgba(255,255,255,0.02)",borderBottom:"1px solid rgba(255,255,255,0.05)",padding:"20px 24px 18px"}}>
        <div style={{maxWidth:900,margin:"0 auto"}}>
          <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",flexWrap:"wrap",gap:12}}>
            <div>
              <h2 style={{fontSize:22,fontWeight:900,margin:"0 0 4px"}}>🏆 CT World Cup — 32 Teams</h2>
              <p style={{color:"rgba(255,255,255,0.4)",fontSize:13,margin:0}}>
                Pick your squad. Registration open — deadline announced via CT.
              </p>
            </div>
            <div style={{display:"flex",gap:16,flexShrink:0}}>
              <div style={{textAlign:"center"}}>
                <div style={{fontSize:20,fontWeight:800,color:"#FBBF24"}}>{totalFilled}</div>
                <div style={{fontSize:9,color:"rgba(255,255,255,0.3)",letterSpacing:1}}>SIGNED</div>
              </div>
              <div style={{textAlign:"center"}}>
                <div style={{fontSize:20,fontWeight:800,color:"rgba(255,255,255,0.4)"}}>{totalSlots - totalFilled}</div>
                <div style={{fontSize:9,color:"rgba(255,255,255,0.3)",letterSpacing:1}}>OPEN</div>
              </div>
            </div>
          </div>

          {/* Fill bar */}
          <div style={{marginTop:14,height:4,background:"rgba(255,255,255,0.06)",borderRadius:2,overflow:"hidden"}}>
            <div style={{height:"100%",width:`${(totalFilled/totalSlots)*100}%`,background:"linear-gradient(90deg,#9945FF,#FBBF24)",borderRadius:2,transition:"width 0.5s"}}/>
          </div>

          {/* My current team banner */}
          {myTeam && (
            <div style={{marginTop:14,padding:"10px 14px",borderRadius:10,background:`${myTeam.color}15`,border:`1px solid ${myTeam.color}40`,display:"flex",alignItems:"center",gap:10}}>
              <EmblemImg team={myTeam} size={20} />
              <span style={{fontSize:13,fontWeight:700,color:myTeam.color}}>You're on {myTeam.name}</span>
              <span style={{fontSize:11,color:"rgba(255,255,255,0.35)",marginLeft:"auto"}}>{myTeam.memberIds.length}/11 players</span>
            </div>
          )}

          {/* Search + filter */}
          <div style={{display:"flex",gap:10,marginTop:14,flexWrap:"wrap"}}>
            <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search teams…"
              style={{flex:1,minWidth:180,padding:"9px 14px",borderRadius:8,background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)",color:"#fff",outline:"none",fontSize:13,fontFamily:"inherit"}}/>
            {["open","all"].map(f=>(
              <button key={f} onClick={()=>setFilter(f)} style={{padding:"9px 16px",borderRadius:8,fontSize:12,fontWeight:700,border:"1px solid rgba(255,255,255,0.1)",background:filter===f?"rgba(255,255,255,0.1)":"transparent",color:filter===f?"#fff":"rgba(255,255,255,0.4)",cursor:"pointer",textTransform:"capitalize"}}>
                {f==="open"?"Open Slots":"All Teams"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Team grid */}
      <div style={{maxWidth:900,margin:"0 auto",padding:"20px 20px 40px"}}>
        {visible.length===0 ? (
          <div style={{textAlign:"center",padding:"60px 0",color:"rgba(255,255,255,0.3)"}}>No teams match your search.</div>
        ) : (
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:14}}>
            {visible.map(team=>{
              const filled  = team.memberIds.length;
              const isFull  = filled >= 11;
              const isMe    = card && team.memberIds.includes(card.id);
              const isJoining = joining === team.id;
              const pct     = (filled/11)*100;
              return (
                <div key={team.id} style={{background:"rgba(255,255,255,0.03)",border:`1px solid ${isMe?team.color+"80":team.color+"20"}`,borderRadius:14,padding:"16px",transition:"border-color 0.2s,box-shadow 0.2s",boxShadow:isMe?`0 0 16px ${team.color}22`:"none"}}
                  onMouseEnter={e=>{e.currentTarget.style.borderColor=`${team.color}50`;e.currentTarget.style.boxShadow=`0 0 12px ${team.color}18`;}}
                  onMouseLeave={e=>{e.currentTarget.style.borderColor=isMe?`${team.color}80`:`${team.color}20`;e.currentTarget.style.boxShadow=isMe?`0 0 16px ${team.color}22`:"none";}}>

                  <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:12}}>
                    <div style={{width:42,height:42,borderRadius:10,background:`linear-gradient(135deg,${team.color}cc,${team.color}66)`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,flexShrink:0,boxShadow:`0 0 12px ${team.color}44`}}><EmblemImg team={team} size={24}/></div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:13,fontWeight:800,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{team.name}</div>
                      <div style={{fontSize:10,color:"rgba(255,255,255,0.35)",marginTop:2}}>{filled}/11 players{isMe?" · 📍 Your team":""}</div>
                    </div>
                  </div>

                  {/* Mini fill bar */}
                  <div style={{height:3,background:"rgba(255,255,255,0.06)",borderRadius:2,overflow:"hidden",marginBottom:10}}>
                    <div style={{height:"100%",width:`${pct}%`,background:isFull?"#22C55E":team.color,borderRadius:2,transition:"width 0.4s"}}/>
                  </div>

                  {/* Slot pips */}
                  <div style={{display:"flex",gap:3,marginBottom:12,flexWrap:"wrap"}}>
                    {Array.from({length:11}).map((_,i)=>{
                      const slot=team.slots[i];
                      const c=slot?.card;
                      return <div key={i} style={{width:22,height:22,borderRadius:5,background:c?aColor(c.displayName):"rgba(255,255,255,0.04)",border:c?`1px solid ${c.tier.border}`:"1px dashed rgba(255,255,255,0.12)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:7,fontWeight:700,color:c?"#fff":"rgba(255,255,255,0.2)"}}>
                        {c?inits(c.displayName):PITCH_SLOTS[i]?.pos}
                      </div>;
                    })}
                  </div>

                  {isMe ? (
                    <div style={{width:"100%",padding:"8px",fontSize:12,fontWeight:700,color:team.color,background:`${team.color}12`,border:`1px solid ${team.color}30`,borderRadius:8,textAlign:"center"}}>✓ Joined</div>
                  ) : isFull ? (
                    <div style={{width:"100%",padding:"8px",fontSize:12,fontWeight:600,color:"rgba(255,255,255,0.25)",background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:8,textAlign:"center"}}>Squad Full</div>
                  ) : (
                    <button onClick={()=>!isJoining&&startPick(team)} style={{width:"100%",padding:"9px",fontSize:12,fontWeight:700,color:isJoining?"#1a1a1a":"#fff",background:isJoining?`linear-gradient(135deg,${team.color},${team.color}aa)`:"rgba(255,255,255,0.05)",border:`1px solid ${team.color}40`,borderRadius:8,cursor:"pointer",transition:"all 0.25s"}}
                      onMouseEnter={e=>{e.currentTarget.style.background=`${team.color}22`;}}
                      onMouseLeave={e=>{e.currentTarget.style.background=isJoining?`linear-gradient(135deg,${team.color},${team.color}aa)`:"rgba(255,255,255,0.05)";}}>
                      {isJoining?"Joining…":"Pick Position"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Position picker modal */}
      {pickingTeam && (
        <PositionPickerModal
          team={pickingTeam}
          onPick={confirmPick}
          onCancel={() => { if (!joining) setPickingTeam(null); }}
          loading={!!joining}
        />
      )}
    </div>
  );
}

// ─── POSITION PICKER MODAL ────────────────────────────────────
// Shows the football pitch with empty slots highlighted as clickable.
// Filled slots show the existing player's avatar and are disabled.
function PositionPickerModal({ team, onPick, onCancel, loading }: any) {
  const [hovered, setHovered] = useState<string | null>(null);

  // Build a map of which slots are taken: for multi-instance positions
  // (CB×2), match against PITCH_SLOTS by slot ID using occurrence order.
  const filledByPos: Record<string, any[]> = {};
  team.slots.forEach((s: any) => {
    if (s.card) {
      if (!filledByPos[s.pos]) filledByPos[s.pos] = [];
      filledByPos[s.pos].push(s.card);
    }
  });

  // Walk PITCH_SLOTS and decide if each is taken (by occurrence)
  const occurrenceCount: Record<string, number> = {};
  const slotState = PITCH_SLOTS.map((ps) => {
    occurrenceCount[ps.pos] = (occurrenceCount[ps.pos] ?? 0) + 1;
    const occIndex = occurrenceCount[ps.pos] - 1;
    const card = filledByPos[ps.pos]?.[occIndex] ?? null;
    return { ...ps, card };
  });

  return (
    <div onClick={onCancel} style={{
      position:"fixed",inset:0,zIndex:200,
      background:"rgba(0,0,0,0.92)",backdropFilter:"blur(14px)",
      display:"flex",alignItems:"center",justifyContent:"center",
      cursor: loading ? "default" : "pointer",
      fontFamily:"'Segoe UI',system-ui,sans-serif",
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        cursor:"default",
        background:"linear-gradient(180deg, #0a1424, #04060d)",
        border:`1px solid ${team.color}55`,
        borderRadius:14,padding:"22px 24px 20px",
        boxShadow:`0 0 50px ${team.color}33, 0 12px 50px rgba(0,0,0,0.85)`,
        animation:"holoIn 0.22s cubic-bezier(0.22,1,0.36,1) both",
        maxWidth:480,width:"90%",
      }}>
        {/* Header */}
        <div style={{display:"flex",alignItems:"center",gap:11,marginBottom:14}}>
          <div style={{width:42,height:42,borderRadius:10,background:team.color,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,
            boxShadow:`0 0 14px ${team.color}66`}}>
            <EmblemImg team={team} size={24}/>
          </div>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:9,fontWeight:700,letterSpacing:3,color:"rgba(255,255,255,0.4)"}}>JOIN TEAM</div>
            <div style={{fontSize:18,fontWeight:900,color:"#fff",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{team.name}</div>
          </div>
          <button onClick={onCancel} disabled={loading} style={{
            background:"transparent",border:"none",color:"rgba(255,255,255,0.5)",
            fontSize:18,cursor: loading ? "default" : "pointer",padding:4,
          }}>✕</button>
        </div>

        <div style={{fontSize:11,color:"rgba(255,255,255,0.55)",marginBottom:14,lineHeight:1.5}}>
          Tap an empty slot to claim it. Already taken slots show the existing player.
        </div>

        {/* Pitch */}
        <div style={{position:"relative",margin:"0 auto",width:400,maxWidth:"100%",aspectRatio:"400/540"}}>
          <svg viewBox="0 0 400 540" style={{width:"100%",height:"100%",display:"block"}}>
            {/* Pitch background */}
            <defs>
              <linearGradient id="pitchPick" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor="#0d4520"/>
                <stop offset="100%" stopColor="#082815"/>
              </linearGradient>
            </defs>
            <rect x="0" y="0" width="400" height="540" rx="14" fill="url(#pitchPick)"/>
            {/* Field markings */}
            <g stroke="rgba(255,255,255,0.12)" strokeWidth="1.5" fill="none">
              <rect x="6" y="6" width="388" height="528" rx="8"/>
              <line x1="6" y1="270" x2="394" y2="270"/>
              <circle cx="200" cy="270" r="52"/>
              <rect x="120" y="6"   width="160" height="60"/>
              <rect x="120" y="474" width="160" height="60"/>
              <rect x="160" y="6"   width="80"  height="22"/>
              <rect x="160" y="512" width="80"  height="22"/>
            </g>
            {/* Slot markers */}
            {slotState.map((s) => {
              const taken = !!s.card;
              const isHov = hovered === `${s.pos}-${s.id}`;
              const r = 28;
              return (
                <g key={s.id}
                  onMouseEnter={() => !taken && !loading && setHovered(`${s.pos}-${s.id}`)}
                  onMouseLeave={() => setHovered(null)}
                  onClick={() => !taken && !loading && onPick(s.pos)}
                  style={{ cursor: taken || loading ? "default" : "pointer" }}>
                  {/* Glow ring on hover */}
                  {isHov && (
                    <circle cx={s.x} cy={s.y} r={r + 12} fill={team.color} opacity="0.18"/>
                  )}
                  {/* Drop shadow */}
                  <circle cx={s.x} cy={s.y} r={r + 2} fill="rgba(0,0,0,0.45)"/>
                  {/* Main circle */}
                  <circle cx={s.x} cy={s.y} r={r}
                    fill={taken ? aColor(s.card.displayName) : isHov ? `${team.color}55` : "rgba(255,255,255,0.06)"}
                    stroke={taken ? s.card.tier.border : isHov ? team.color : "rgba(255,255,255,0.25)"}
                    strokeWidth={taken || isHov ? 2.5 : 1.5}
                    strokeDasharray={taken ? "0" : "5 3"}/>
                  {/* Avatar (if taken) — clipped to circle */}
                  {taken && s.card.avatarUrl && (
                    <>
                      <defs>
                        <clipPath id={`pickclip-${s.id}`}>
                          <circle cx={s.x} cy={s.y} r={r}/>
                        </clipPath>
                      </defs>
                      <image
                        href={proxyAvatar(s.card.avatarUrl)}
                        x={s.x - r} y={s.y - r} width={r * 2} height={r * 2}
                        clipPath={`url(#pickclip-${s.id})`}
                        preserveAspectRatio="xMidYMin slice"
                      />
                    </>
                  )}
                  {/* Position label */}
                  <rect x={s.x - 18} y={s.y + r + 2} width="36" height="14" rx="4"
                    fill={taken ? "rgba(0,0,0,0.85)" : isHov ? team.color : "rgba(0,0,0,0.7)"}/>
                  <text x={s.x} y={s.y + r + 12} fontSize="9" fontWeight="800"
                    fill={taken ? s.card.tier.textColor : "#fff"}
                    fontFamily="'Segoe UI',system-ui,sans-serif" textAnchor="middle">
                    {s.pos}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>

        {/* Hover hint at bottom */}
        <div style={{
          marginTop:12,padding:"8px 12px",borderRadius:7,
          background:hovered ? `${team.color}1f` : "rgba(255,255,255,0.03)",
          border:`1px solid ${hovered ? team.color : "rgba(255,255,255,0.08)"}55`,
          fontSize:11,fontWeight:600,color:hovered ? "#fff" : "rgba(255,255,255,0.4)",
          textAlign:"center",letterSpacing:0.5,minHeight:32,
          display:"flex",alignItems:"center",justifyContent:"center",
          transition:"all 0.18s",
        }}>
          {loading
            ? "Joining…"
            : hovered
              ? `Click ${hovered.split("-")[0]} to claim this slot`
              : "Hover an empty slot — green = available"
          }
        </div>
      </div>
    </div>
  );
}

// ─── TEAM PAGE ────────────────────────────────────────────────
function TeamPage({ team, myCardId, onTeamUpdate, onBack, onPool, onLeave, onBrowse }) {
  const [expandCard, setExpandCard]   = useState(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const filled   = team.slots.filter(s=>s.card).length;
  const captain  = team.slots.find(s=>s.card?.id===team.captainId)?.card;
  const mySlot   = team.slots.findIndex(s=>s.card?.id===myCardId);
  const myCard   = mySlot>=0 ? team.slots[mySlot].card : null;
  const amOnTeam = !!myCard;

  return (
    <div style={{minHeight:"100vh",background:"#070B14",color:"#fff",fontFamily:"'Segoe UI',system-ui,sans-serif"}}>
      {expandCard&&(
        <div onClick={()=>setExpandCard(null)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.92)",backdropFilter:"blur(16px)",zIndex:100,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer"}}>
          <InteractiveCard card={expandCard} size="large" scale={1.5}/>
        </div>
      )}
      <Nav onHome={onBack} right={
        <div style={{display:"flex",gap:8}}>
          {amOnTeam&&!confirmLeave&&(
            <button onClick={()=>setConfirmLeave(true)} style={{background:"rgba(239,68,68,0.08)",border:"1px solid rgba(239,68,68,0.25)",color:"#F87171",borderRadius:7,padding:"6px 12px",cursor:"pointer",fontSize:11,fontWeight:600}}>Leave Team</button>
          )}
          {confirmLeave&&(
            <>
              <button onClick={()=>{SFX.click();setConfirmLeave(false);onLeave(team,myCardId);}} style={{background:"rgba(239,68,68,0.15)",border:"1px solid #EF4444",color:"#FCA5A5",borderRadius:7,padding:"6px 12px",cursor:"pointer",fontSize:11,fontWeight:700}}>Confirm Leave</button>
              <button onClick={()=>setConfirmLeave(false)} style={{background:"transparent",border:"1px solid rgba(255,255,255,0.1)",color:"rgba(255,255,255,0.4)",borderRadius:7,padding:"6px 10px",cursor:"pointer",fontSize:11}}>Cancel</button>
            </>
          )}
          <button onClick={onPool} style={{background:"transparent",border:"1px solid rgba(255,255,255,0.1)",color:"rgba(255,255,255,0.5)",borderRadius:7,padding:"6px 12px",cursor:"pointer",fontSize:11,fontWeight:600}}>Player Pool</button>
        </div>
      }/>

      <div style={{maxWidth:900,margin:"0 auto",padding:"24px 20px"}}>
        {/* Team header */}
        <div style={{display:"flex",alignItems:"center",gap:16,marginBottom:28,padding:"18px 22px",background:"rgba(255,255,255,0.03)",borderRadius:14,border:`1px solid ${team.color}33`}}>
          <div style={{width:52,height:52,borderRadius:12,background:team.color,display:"flex",alignItems:"center",justifyContent:"center",fontSize:26,flexShrink:0}}><EmblemImg team={team} size={32}/></div>
          <div style={{flex:1}}>
            <h2 style={{fontSize:22,fontWeight:800,margin:"0 0 2px"}}>{team.name}</h2>
            <div style={{fontSize:12,color:"rgba(255,255,255,0.4)"}}>
              Captain: <span style={{color:"#FBBF24",fontWeight:700}}>{captain?.displayName||"TBA"} 👑</span>
              {myCard?.id===team.captainId&&<span style={{color:"rgba(255,255,255,0.3)",marginLeft:6}}>(You)</span>}
            </div>
          </div>
          <div style={{display:"flex",gap:20,textAlign:"center"}}>
            <div><div style={{fontSize:20,fontWeight:800,color:filled===11?"#10B981":"#fff"}}>{filled}/11</div><div style={{fontSize:9,color:"rgba(255,255,255,0.35)",letterSpacing:1,textTransform:"uppercase"}}>Players</div></div>
            {filled>0&&<div><div style={{fontSize:20,fontWeight:800}}>{Math.round(team.slots.filter(s=>s.card).reduce((a,s)=>a+s.card.ovr,0)/filled)}</div><div style={{fontSize:9,color:"rgba(255,255,255,0.35)",letterSpacing:1,textTransform:"uppercase"}}>Avg OVR</div></div>}
            <div><div style={{fontSize:20,fontWeight:800,color:filled===11?"#10B981":"rgba(255,255,255,0.4)"}}>{filled===11?"✓ Full":"Open"}</div><div style={{fontSize:9,color:"rgba(255,255,255,0.35)",letterSpacing:1,textTransform:"uppercase"}}>Status</div></div>
          </div>
        </div>

        {filled===11&&<div style={{padding:"12px 18px",background:"rgba(16,185,129,0.08)",border:"1px solid rgba(16,185,129,0.2)",borderRadius:10,fontSize:13,color:"#10B981",fontWeight:600,marginBottom:20,textAlign:"center"}}>⚽ Squad Complete — Ready for Tournaments!</div>}

        <div style={{display:"flex",gap:24,flexWrap:"wrap",alignItems:"flex-start"}}>
          {/* Pitch */}
          <div style={{flex:"1 1 400px",minWidth:320}}>
            <FootballPitch team={team} myCardId={myCardId} onTeamUpdate={onTeamUpdate} onCardView={setExpandCard}/>
          </div>
          {/* Roster */}
          <div style={{flex:"0 1 260px",minWidth:240}}>
            <div style={{fontSize:11,fontWeight:600,color:"rgba(255,255,255,0.4)",letterSpacing:1.2,textTransform:"uppercase",marginBottom:10}}>Squad ({filled}/11)</div>
            <div style={{display:"flex",flexDirection:"column",gap:5}}>
              {PITCH_SLOTS.map((ps,i)=>{
                const c=team.slots[i].card;
                return(
                  <div key={i} onClick={()=>c&&setExpandCard(c)} style={{display:"flex",alignItems:"center",gap:9,padding:"8px 11px",background:c?"rgba(255,255,255,0.03)":"rgba(255,255,255,0.01)",borderRadius:8,border:c?`1px solid ${c.tier.border}22`:"1px dashed rgba(255,255,255,0.07)",cursor:c?"pointer":"default",transition:"all 0.2s"}}
                    onMouseEnter={e=>{if(c){e.currentTarget.style.background="rgba(255,255,255,0.06)";}}}
                    onMouseLeave={e=>{e.currentTarget.style.background=c?"rgba(255,255,255,0.03)":"rgba(255,255,255,0.01)";}}>
                    <div style={{width:32,height:32,borderRadius:7,overflow:"hidden",flexShrink:0,
                      background:c?aColor(c.displayName):"rgba(255,255,255,0.04)",
                      border:c?`1.5px solid ${c.tier.border}66`:"1px dashed rgba(255,255,255,0.1)",
                      display:"flex",alignItems:"center",justifyContent:"center"}}>
                      {c?(
                        c.avatarUrl
                          ? <img src={c.avatarUrl} alt={c.displayName} style={{width:"100%",height:"100%",objectFit:"cover",objectPosition:"center top"}}/>
                          : <span style={{fontSize:10,fontWeight:800,color:"#fff"}}>{inits(c.displayName)}</span>
                      ):(
                        <span style={{fontSize:8,fontWeight:600,color:"rgba(255,255,255,0.2)"}}>{ps.pos}</span>
                      )}
                    </div>
                    <div style={{flex:1,minWidth:0}}>
                      {c?(<><div style={{fontSize:11,fontWeight:700,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.displayName}{c.id===team.captainId&&" 👑"}</div><div style={{fontSize:9,color:"rgba(255,255,255,0.35)",fontFamily:"monospace"}}>@{c.handle}</div></>)
                      :(<div style={{fontSize:10,color:"rgba(255,255,255,0.2)",fontStyle:"italic"}}>Empty slot</div>)}
                    </div>
                    {c&&(<div style={{flexShrink:0,textAlign:"right"}}><div style={{fontSize:12,fontWeight:800,color:c.tier.accent}}>{c.ovr}</div><div style={{fontSize:8,color:"rgba(255,255,255,0.3)"}}>{ps.pos}</div></div>)}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── LEADERBOARD ──────────────────────────────────────────────
// Top 50 cards across multiple metrics. Live — refreshes whenever the
// pool re-syncs (which happens after every stat refresh).
const LB_METRICS = [
  { k:"ovr",       label:"Top OVR",      icon:"🏆", get:(c:any)=>c.ovr ?? 0,
    fmt:(v:number)=>`${v}` },
  { k:"reach",     label:"Top Reach",    icon:"📡", get:(c:any)=>c.stats?.INF ?? 0,
    fmt:(v:number)=>`${v}` },
  { k:"alpha",     label:"Alpha Callers",icon:"⚡", get:(c:any)=>c.stats?.ENG ?? 0,
    fmt:(v:number)=>`${v}` },
  { k:"viral",     label:"Most Viral",   icon:"🔥", get:(c:any)=>c.stats?.VRL ?? 0,
    fmt:(v:number)=>`${v}` },
  { k:"grind",     label:"Top Grinders", icon:"⛏", get:(c:any)=>c.stats?.VOL ?? 0,
    fmt:(v:number)=>`${v}` },
  { k:"clutch",    label:"Most Clutch",  icon:"💎", get:(c:any)=>c.stats?.CLT ?? 0,
    fmt:(v:number)=>`${v}` },
  { k:"followers", label:"Most Followers",icon:"🌐", get:(c:any)=>c.rawProfile?.followers ?? 0,
    fmt:(v:number)=>v.toLocaleString() },
];

function LeaderboardPage({ pool, teams, myCard, onBack, onClaim }: any) {
  const [metric, setMetric] = useState(LB_METRICS[0]);
  const [selected, setSelected] = useState<any>(null);

  const teamById = useMemo(() => {
    const m: Record<string, any> = {};
    teams.forEach((t: any) => { m[t.id] = t; });
    return m;
  }, [teams]);

  const sorted = useMemo(() => {
    return [...pool]
      .sort((a, b) => metric.get(b) - metric.get(a))
      .slice(0, 50);
  }, [pool, metric]);

  const myRank = myCard ? sorted.findIndex(c => c.id === myCard.id) + 1 : 0;

  return (
    <div style={{minHeight:"100vh",background:"#070B14",color:"#fff",fontFamily:"'Segoe UI',system-ui,sans-serif"}}>
      {selected && (
        <div onClick={()=>setSelected(null)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.92)",backdropFilter:"blur(16px)",zIndex:100,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer"}}>
          <InteractiveCard card={selected} size="large" scale={1.5}/>
        </div>
      )}

      <Nav onHome={onBack} right={
        myCard
          ? <div style={{display:"flex",alignItems:"center",gap:8,padding:"5px 12px",borderRadius:8,background:"rgba(34,197,94,0.08)",border:"1px solid rgba(34,197,94,0.2)"}}>
              <div style={{width:7,height:7,borderRadius:"50%",background:"#22C55E",boxShadow:"0 0 6px #22C55E"}}/>
              <span style={{fontSize:11,fontWeight:700,color:"#22C55E"}}>{myRank > 0 ? `Ranked #${myRank}` : `OVR ${myCard.ovr}`}</span>
            </div>
          : <button onClick={onClaim} style={{padding:"7px 14px",fontSize:11,fontWeight:700,borderRadius:7,background:"linear-gradient(135deg,#D4A537,#FBBF24)",border:"none",color:"#1a1a1a",cursor:"pointer"}}>+ Claim Card</button>
      }/>

      {/* Header */}
      <div style={{
        background:"linear-gradient(180deg, rgba(212,165,55,0.08), transparent)",
        borderBottom:"1px solid rgba(255,255,255,0.05)",
        padding:"28px 24px 22px",textAlign:"center",
      }}>
        <div style={{fontSize:11,fontWeight:700,letterSpacing:5,color:"rgba(255,255,255,0.4)",marginBottom:6}}>CTWC LIVE</div>
        <div style={{fontSize:36,fontWeight:900,color:"#FBBF24",letterSpacing:2,
          textShadow:"0 0 24px rgba(212,165,55,0.5)"}}>🏆 Leaderboard</div>
        <div style={{fontSize:12,color:"rgba(255,255,255,0.45)",marginTop:6}}>
          Top {sorted.length} CT players · refreshed live with each round
        </div>
      </div>

      {/* Metric tabs */}
      <div style={{padding:"16px 24px",display:"flex",gap:8,flexWrap:"wrap",justifyContent:"center",
        borderBottom:"1px solid rgba(255,255,255,0.05)"}}>
        {LB_METRICS.map(m => (
          <button key={m.k} onClick={()=>setMetric(m)} style={{
            display:"flex",alignItems:"center",gap:7,
            padding:"8px 16px",fontSize:11,fontWeight:700,letterSpacing:0.5,
            background: metric.k === m.k ? "rgba(212,165,55,0.18)" : "transparent",
            border: `1px solid ${metric.k === m.k ? "rgba(212,165,55,0.5)" : "rgba(255,255,255,0.08)"}`,
            color: metric.k === m.k ? "#FBBF24" : "rgba(255,255,255,0.55)",
            borderRadius:18,cursor:"pointer",
            boxShadow: metric.k === m.k ? "0 0 14px rgba(212,165,55,0.25)" : "none",
            transition:"all 0.18s",
          }}>
            <span>{m.icon}</span><span>{m.label}</span>
          </button>
        ))}
      </div>

      {/* List */}
      <div style={{maxWidth:760,margin:"0 auto",padding:"22px 18px 40px"}}>
        {sorted.map((c, i) => {
          const team = c.teamId ? teamById[c.teamId] : null;
          const isMe = myCard?.id === c.id;
          const v    = metric.get(c);
          const rank = i + 1;
          const podiumColor = rank === 1 ? "#FBBF24" : rank === 2 ? "#C0C0C0" : rank === 3 ? "#CD7F32" : null;
          return (
            <div key={c.id} onClick={()=>setSelected(c)} style={{
              display:"flex",alignItems:"center",gap:14,
              padding:"11px 16px",marginBottom:6,borderRadius:11,
              background: isMe
                ? "linear-gradient(90deg, rgba(212,165,55,0.18), rgba(212,165,55,0.06))"
                : "rgba(255,255,255,0.02)",
              border: isMe
                ? "1px solid rgba(212,165,55,0.55)"
                : `1px solid ${c.tier.border}22`,
              cursor:"pointer",transition:"all 0.18s",
              boxShadow: isMe ? "0 0 18px rgba(212,165,55,0.18)" : "none",
            }}
            onMouseEnter={e=>{ if(!isMe) e.currentTarget.style.background="rgba(255,255,255,0.05)"; }}
            onMouseLeave={e=>{ if(!isMe) e.currentTarget.style.background="rgba(255,255,255,0.02)"; }}>
              {/* Rank */}
              <div style={{
                width:38,textAlign:"center",fontSize:rank<=3?20:14,fontWeight:900,
                color: podiumColor ?? (isMe ? "#FBBF24" : "rgba(255,255,255,0.5)"),
                textShadow: podiumColor ? `0 0 12px ${podiumColor}88` : "none",
                flexShrink:0,
              }}>
                {rank <= 3 ? (rank === 1 ? "🥇" : rank === 2 ? "🥈" : "🥉") : `#${rank}`}
              </div>

              {/* Avatar */}
              <div style={{
                width:42,height:42,borderRadius:9,overflow:"hidden",flexShrink:0,
                background: aColor(c.displayName),
                border:`1.5px solid ${c.tier.border}77`,
                boxShadow:`0 0 10px ${c.tier.glow}`,
              }}>
                {c.avatarUrl
                  ? <img src={proxyAvatar(c.avatarUrl)} alt={c.displayName} crossOrigin="anonymous"
                      style={{width:"100%",height:"100%",objectFit:"cover",objectPosition:"center 8%"}}/>
                  : <div style={{width:"100%",height:"100%",display:"flex",alignItems:"center",justifyContent:"center",
                      fontSize:13,fontWeight:800,color:"#fff"}}>{inits(c.displayName)}</div>
                }
              </div>

              {/* Name + handle + team */}
              <div style={{flex:1,minWidth:0}}>
                <div style={{display:"flex",alignItems:"center",gap:7}}>
                  <span style={{fontSize:14,fontWeight:800,color:"#fff",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                    {c.displayName}
                  </span>
                  {isMe && <span style={{fontSize:9,fontWeight:800,color:"#FBBF24",letterSpacing:1.5}}>YOU</span>}
                  {c.rawProfile?.verified && <span style={{fontSize:11,color:"#1D9BF0"}}>✓</span>}
                </div>
                <div style={{display:"flex",alignItems:"center",gap:6,marginTop:1,flexWrap:"wrap"}}>
                  <span style={{fontSize:10,color:"rgba(255,255,255,0.4)",fontFamily:"monospace"}}>@{c.handle}</span>
                  {team && (
                    <>
                      <span style={{fontSize:9,color:"rgba(255,255,255,0.2)"}}>·</span>
                      <span style={{display:"flex",alignItems:"center",gap:3,fontSize:10,color:team.color,fontWeight:700}}>
                        <EmblemImg team={team} size={11}/>
                        <span style={{maxWidth:120,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{team.name}</span>
                      </span>
                    </>
                  )}
                </div>
              </div>

              {/* Tier pill */}
              <div style={{
                fontSize:9,fontWeight:800,letterSpacing:1.5,
                padding:"3px 9px",borderRadius:5,
                background:`${c.tier.bg}99`,color:c.tier.accent,
                border:`1px solid ${c.tier.border}66`,flexShrink:0,
              }}>{c.tier.name.replace("CT ","").toUpperCase()}</div>

              {/* Metric value */}
              <div style={{textAlign:"right",flexShrink:0,minWidth:62}}>
                <div style={{fontSize:22,fontWeight:900,color:c.tier.accent,lineHeight:1,
                  textShadow:`0 0 10px ${c.tier.glow}`}}>{metric.fmt(v)}</div>
                <div style={{fontSize:8,fontWeight:700,letterSpacing:1.5,color:"rgba(255,255,255,0.35)",marginTop:2,textTransform:"uppercase"}}>
                  {metric.label.replace(/^Top |Most |Top$/g,"").trim()}
                </div>
              </div>
            </div>
          );
        })}
        {sorted.length === 0 && (
          <div style={{textAlign:"center",padding:60,color:"rgba(255,255,255,0.3)"}}>
            <div style={{fontSize:42,marginBottom:10}}>📊</div>
            <div style={{fontSize:13}}>No cards in the pool yet — be the first!</div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── PLAYER POOL / CARD COLLECTION ────────────────────────────
const POSITION_FILTERS = ["All","GK","LB","CB","RB","CM","LW","ST","RW"];
const SORT_OPTIONS = [
  { k:"ovr-desc",   label:"OVR ↓" },
  { k:"ovr-asc",    label:"OVR ↑" },
  { k:"name-asc",   label:"A → Z" },
  { k:"recent",     label:"Newest" },
  { k:"followers",  label:"Followers" },
];

function PlayerPool({ pool, myCard, onBack, onClaim }) {
  const [filter,setFilter]   = useState("All");
  const [posFilter,setPosFilter] = useState("All");
  const [search,setSearch]   = useState("");
  const [sort,setSort]       = useState("ovr-desc");
  const [selected,setSelected] = useState(null);
  const tierNames=["All","Mythic","CT Legend","CT Elite","CT Star","CT Player"];

  const counts: any = {}; Object.values(TIERS).forEach(t=>{ counts[t.name] = pool.filter(c=>c.tier.name===t.name).length; });

  const visible = useMemo(() => {
    let v = pool;
    if (filter !== "All") v = v.filter(c => c.tier.name === filter);
    if (posFilter !== "All") v = v.filter(c => c.position?.code === posFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      v = v.filter(c => c.displayName.toLowerCase().includes(q) || c.handle.toLowerCase().includes(q));
    }
    const sorted = [...v];
    switch (sort) {
      case "ovr-asc":   sorted.sort((a,b)=> a.ovr - b.ovr); break;
      case "ovr-desc":  sorted.sort((a,b)=> b.ovr - a.ovr); break;
      case "name-asc":  sorted.sort((a,b)=> a.displayName.localeCompare(b.displayName)); break;
      case "followers": sorted.sort((a,b)=> (b.rawProfile?.followers ?? 0) - (a.rawProfile?.followers ?? 0)); break;
      case "recent":    /* server already returns most recent first */ break;
    }
    return sorted;
  }, [pool, filter, posFilter, search, sort]);

  const hasClaimed = !!myCard;

  return (
    <div style={{minHeight:"100vh",background:"#070B14",color:"#fff",fontFamily:"'Segoe UI',system-ui,sans-serif"}}>
      {selected&&<div onClick={()=>setSelected(null)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.92)",backdropFilter:"blur(16px)",zIndex:100,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer"}}><InteractiveCard card={selected} size="large" scale={1.5}/></div>}

      <Nav onHome={onBack} right={
        hasClaimed
          ? <div style={{display:"flex",alignItems:"center",gap:8,padding:"5px 12px",borderRadius:8,background:"rgba(34,197,94,0.08)",border:"1px solid rgba(34,197,94,0.2)"}}>
              <div style={{width:7,height:7,borderRadius:"50%",background:"#22C55E",boxShadow:"0 0 6px #22C55E"}}/>
              <span style={{fontSize:11,fontWeight:700,color:"#22C55E"}}>Card Claimed · OVR {myCard.ovr}</span>
            </div>
          : <button onClick={onClaim} style={{padding:"7px 14px",fontSize:11,fontWeight:700,borderRadius:7,background:"linear-gradient(135deg,#D4A537,#FBBF24)",border:"none",color:"#1a1a1a",cursor:"pointer"}}>+ Claim Card</button>
      }/>

      <div style={{padding:"8px 24px",borderBottom:"1px solid rgba(255,255,255,0.04)",display:"flex",gap:20,overflowX:"auto"}}>
        {Object.values(TIERS).map(t=><div key={t.name} style={{display:"flex",alignItems:"center",gap:6,flexShrink:0}}><div style={{width:7,height:7,borderRadius:"50%",background:t.border}}/><span style={{fontSize:10,color:t.accent,fontWeight:700}}>{t.name}</span><span style={{fontSize:10,color:"rgba(255,255,255,0.25)"}}>{counts[t.name]||0}</span></div>)}
      </div>

      <div style={{maxWidth:1100,margin:"0 auto",padding:"22px 20px"}}>
        {/* Search + Sort row */}
        <div style={{display:"flex",gap:10,marginBottom:14,flexWrap:"wrap",alignItems:"center"}}>
          <div style={{position:"relative",flex:"1 1 260px",minWidth:240}}>
            <span style={{position:"absolute",left:12,top:"50%",transform:"translateY(-50%)",fontSize:13,color:"rgba(255,255,255,0.3)"}}>🔍</span>
            <input
              value={search}
              onChange={e=>setSearch(e.target.value)}
              placeholder="Search name or @handle…"
              style={{
                width:"100%",padding:"10px 14px 10px 36px",fontSize:12,
                background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)",
                borderRadius:9,color:"#fff",outline:"none",fontFamily:"inherit",
              }}
              onFocus={e=>{ e.currentTarget.style.borderColor="rgba(212,165,55,0.4)"; }}
              onBlur ={e=>{ e.currentTarget.style.borderColor="rgba(255,255,255,0.08)"; }}
            />
            {search && (
              <button onClick={()=>setSearch("")} style={{
                position:"absolute",right:8,top:"50%",transform:"translateY(-50%)",
                background:"transparent",border:"none",color:"rgba(255,255,255,0.4)",
                fontSize:14,cursor:"pointer",padding:4,
              }}>✕</button>
            )}
          </div>
          <select value={sort} onChange={e=>setSort(e.target.value)} style={{
            padding:"10px 12px",fontSize:11,fontWeight:700,
            background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)",
            borderRadius:9,color:"#fff",outline:"none",cursor:"pointer",fontFamily:"inherit",
          }}>
            {SORT_OPTIONS.map(o => <option key={o.k} value={o.k} style={{background:"#0a0e18"}}>{o.label}</option>)}
          </select>
          <div style={{fontSize:11,color:"rgba(255,255,255,0.4)",marginLeft:"auto"}}>
            {visible.length} {visible.length === 1 ? "card" : "cards"}
          </div>
        </div>

        {/* Position filter */}
        <div style={{display:"flex",gap:5,marginBottom:10,flexWrap:"wrap"}}>
          {POSITION_FILTERS.map(p => (
            <button key={p} onClick={()=>setPosFilter(p)} style={{
              padding:"4px 11px",fontSize:10,fontWeight:700,borderRadius:5,
              cursor:"pointer",letterSpacing:0.5,
              background: posFilter === p ? "rgba(96,165,250,0.18)" : "transparent",
              border: `1px solid ${posFilter === p ? "rgba(96,165,250,0.5)" : "rgba(255,255,255,0.08)"}`,
              color: posFilter === p ? "#60A5FA" : "rgba(255,255,255,0.4)",
            }}>{p}</button>
          ))}
        </div>

        {/* Tier filter */}
        <div style={{display:"flex",gap:6,marginBottom:20,flexWrap:"wrap"}}>
          {tierNames.map(name=>{const t=Object.values(TIERS).find(x=>x.name===name);return(<button key={name} onClick={()=>setFilter(name)} style={{padding:"6px 14px",fontSize:11,fontWeight:700,borderRadius:16,cursor:"pointer",background:filter===name?(t?`${t.border}30`:"rgba(255,255,255,0.1)"):"transparent",border:`1px solid ${filter===name?(t?t.border:"rgba(255,255,255,0.2)"):"rgba(255,255,255,0.07)"}`,color:filter===name?(t?t.accent:"#fff"):"rgba(255,255,255,0.4)"}}>
            {name}{name!=="All"&&` (${counts[name]||0})`}</button>);})}
        </div>

        {visible.length===0 ? (
          <div style={{textAlign:"center",padding:"70px 0"}}>
            <p style={{fontSize:14,color:"rgba(255,255,255,0.3)"}}>No cards yet</p>
            {!hasClaimed && <button onClick={onClaim} style={{marginTop:12,padding:"11px 24px",fontSize:13,fontWeight:700,borderRadius:9,background:"linear-gradient(135deg,#D4A537,#FBBF24)",border:"none",color:"#1a1a1a",cursor:"pointer"}}>Be the First</button>}
          </div>
        ) : (
          <div style={{display:"flex",flexWrap:"wrap",gap:18}}>
            {visible.map(card => {
              const isMe = myCard && card.id === myCard.id;
              return (
                <div key={card.id} style={{position:"relative"}}>
                  {isMe && (
                    <div style={{position:"absolute",top:-10,left:"50%",transform:"translateX(-50%)",zIndex:10,
                      padding:"3px 10px",borderRadius:20,background:"linear-gradient(135deg,#FBBF24,#D4A537)",
                      fontSize:9,fontWeight:900,color:"#1a1a1a",letterSpacing:1.5,whiteSpace:"nowrap",
                      boxShadow:"0 0 12px rgba(212,165,55,0.5)"}}>
                      ⭐ YOU
                    </div>
                  )}
                  <div style={{outline:isMe?"2px solid #FBBF24":"none",outlineOffset:isMe?4:0,borderRadius:12,
                    boxShadow:isMe?"0 0 24px rgba(212,165,55,0.35)":"none",transition:"all 0.2s"}}>
                    <ShieldCard card={card} size="small" onClick={()=>setSelected(card)}/>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── TEAMS LIST ───────────────────────────────────────────────
function TeamsListPage({ teams, myCard, onBack, onViewTeam, onClaim }) {
  return (
    <div style={{minHeight:"100vh",background:"#070B14",color:"#fff",fontFamily:"'Segoe UI',system-ui,sans-serif"}}>
      <Nav onHome={onBack} right={
        myCard
          ? <div style={{display:"flex",alignItems:"center",gap:8,padding:"5px 12px",borderRadius:8,background:"rgba(34,197,94,0.08)",border:"1px solid rgba(34,197,94,0.2)"}}>
              <div style={{width:7,height:7,borderRadius:"50%",background:"#22C55E",boxShadow:"0 0 6px #22C55E"}}/>
              <span style={{fontSize:11,fontWeight:700,color:"#22C55E"}}>OVR {myCard.ovr} · {myCard.position?.code ?? "—"}</span>
            </div>
          : <button onClick={onClaim} style={{padding:"7px 14px",fontSize:11,fontWeight:700,borderRadius:7,background:"linear-gradient(135deg,#D4A537,#FBBF24)",border:"none",color:"#1a1a1a",cursor:"pointer"}}>+ Claim Card</button>
      }/>
      <div style={{maxWidth:800,margin:"0 auto",padding:"28px 20px"}}>
        <h2 style={{fontSize:22,fontWeight:800,margin:"0 0 20px"}}>All Teams ({teams.length})</h2>
        {teams.length===0?(<div style={{textAlign:"center",padding:"60px 0",color:"rgba(255,255,255,0.3)"}}>No teams yet — claim a card to get started.</div>):(
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            {teams.map(team=>{
              const filled=team.slots.filter(s=>s.card).length;
              const avgOvr=filled>0?Math.round(team.slots.filter(s=>s.card).reduce((a,s)=>a+s.card.ovr,0)/filled):0;
              const cap=team.slots.find(s=>s.card?.id===team.captainId)?.card;
              return(
                <div key={team.id} onClick={()=>onViewTeam(team.id)} style={{display:"flex",alignItems:"center",gap:16,padding:"16px 18px",background:"rgba(255,255,255,0.03)",border:`1px solid ${team.color}22`,borderRadius:12,cursor:"pointer",transition:"all 0.2s"}}
                  onMouseEnter={e=>{e.currentTarget.style.background="rgba(255,255,255,0.05)";e.currentTarget.style.borderColor=`${team.color}55`;}}
                  onMouseLeave={e=>{e.currentTarget.style.background="rgba(255,255,255,0.03)";e.currentTarget.style.borderColor=`${team.color}22`;}}>
                  <div style={{width:44,height:44,borderRadius:10,background:team.color,display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,flexShrink:0}}><EmblemImg team={team} size={26}/></div>
                  <div style={{flex:1}}>
                    <div style={{fontSize:15,fontWeight:800}}>{team.name}</div>
                    <div style={{fontSize:11,color:"rgba(255,255,255,0.4)"}}>Captain: {cap?.displayName||"TBA"}</div>
                  </div>
                  <div style={{display:"flex",gap:20,textAlign:"center"}}>
                    <div><div style={{fontSize:16,fontWeight:800,color:filled===11?"#10B981":"#fff"}}>{filled}/11</div><div style={{fontSize:8,color:"rgba(255,255,255,0.3)",letterSpacing:1,textTransform:"uppercase"}}>Players</div></div>
                    {filled>0&&<div><div style={{fontSize:16,fontWeight:800}}>{avgOvr}</div><div style={{fontSize:8,color:"rgba(255,255,255,0.3)",letterSpacing:1,textTransform:"uppercase"}}>Avg OVR</div></div>}
                    <div><div style={{fontSize:16,fontWeight:800,color:filled===11?"#10B981":"rgba(255,255,255,0.5)"}}>{filled===11?"FULL":"OPEN"}</div><div style={{fontSize:8,color:"rgba(255,255,255,0.3)",letterSpacing:1,textTransform:"uppercase"}}>Status</div></div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── ROUND REVEAL SEQUENCE ────────────────────────────────────
// Fullscreen takeover that animates a round's matches one by one.
// Each match: team intro → score count-up → winner glow → advance arrow.
// After the last match, if isFinal, hands off to ChampionCelebration.
const ROUND_NAMES_UI: Record<number, string> = {
  1: "Round of 32", 2: "Round of 16", 3: "Quarter Finals",
  4: "Semi Finals", 5: "Grand Final",
};

function RoundRevealSequence({ results, teams, round, isFinal, onDone }: {
  results: any[]; teams: any[]; round: number; isFinal: boolean; onDone: () => void;
}) {
  const [idx, setIdx]         = useState(0);
  const [phase, setPhase]     = useState<"intro" | "score" | "winner">("intro");
  const [autoplay, setAutoplay] = useState(true);
  const [showChamp, setShowChamp] = useState(false);

  const cur = results[idx];
  const homeTeam = teams.find(t => t.id === cur?.homeId);
  const awayTeam = teams.find(t => t.id === cur?.awayId);
  const winner   = teams.find(t => t.id === cur?.winnerId);
  const isHome   = cur?.winnerId === cur?.homeId;

  // Auto-advance through phases
  useEffect(() => {
    if (!cur || !autoplay) return;
    const t1 = setTimeout(() => setPhase("score"),  1300);
    const t2 = setTimeout(() => setPhase("winner"), 2700);
    const t3 = setTimeout(() => {
      if (idx < results.length - 1) {
        setIdx(i => i + 1);
        setPhase("intro");
      } else if (isFinal) {
        setShowChamp(true);
      } else {
        onDone();
      }
    }, 4200);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [idx, autoplay, cur, isFinal, onDone, results.length]);

  // SFX hooks
  useEffect(() => {
    if (!cur) return;
    if (phase === "intro")  { try { SFX.click();    } catch {} }
    if (phase === "score")  { try { SFX.crowd("roar"); } catch {} }
  }, [phase, idx, cur]);

  if (!cur) { onDone(); return null; }

  // Champion celebration takes over
  if (showChamp) {
    return <ChampionCelebration champion={winner} runnerUp={isHome ? awayTeam : homeTeam} onDone={onDone}/>;
  }

  const skip = () => {
    if (idx < results.length - 1) { setIdx(i => i + 1); setPhase("intro"); }
    else if (isFinal) setShowChamp(true);
    else onDone();
  };

  return (
    <div style={{
      position:"fixed",inset:0,zIndex:300,
      background:"radial-gradient(ellipse at 50% 50%, #0a1424 0%, #04060d 70%)",
      display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
      fontFamily:"'Segoe UI',system-ui,sans-serif",overflow:"hidden",
    }}>
      {/* Stadium glow */}
      <div style={{position:"absolute",inset:0,
        background:"radial-gradient(ellipse 70% 40% at 50% 50%, rgba(212,165,55,0.10) 0%, transparent 70%)",
        pointerEvents:"none"}}/>

      {/* Round label */}
      <div style={{position:"absolute",top:32,left:"50%",transform:"translateX(-50%)",textAlign:"center"}}>
        <div style={{fontSize:9,fontWeight:700,letterSpacing:5,color:"rgba(255,255,255,0.4)"}}>CTWC 2026</div>
        <div style={{fontSize:18,fontWeight:900,color:"#FBBF24",letterSpacing:3,marginTop:4,
          textShadow:"0 0 20px rgba(212,165,55,0.4)"}}>{ROUND_NAMES_UI[round] ?? `Round ${round}`}</div>
        <div style={{fontSize:11,fontWeight:600,letterSpacing:2,color:"rgba(255,255,255,0.5)",marginTop:6}}>
          Match {idx + 1} of {results.length}
        </div>
      </div>

      {/* Skip / autoplay controls */}
      <div style={{position:"absolute",top:32,right:32,display:"flex",gap:10,zIndex:5}}>
        <button onClick={() => setAutoplay(a => !a)} style={{
          padding:"7px 14px",fontSize:11,fontWeight:700,
          background:autoplay?"rgba(34,197,94,0.15)":"rgba(255,255,255,0.05)",
          border:`1px solid ${autoplay?"rgba(34,197,94,0.4)":"rgba(255,255,255,0.15)"}`,
          color:autoplay?"#22C55E":"#fff",
          borderRadius:7,cursor:"pointer",letterSpacing:0.5,
        }}>{autoplay ? "● AUTO" : "○ AUTO"}</button>
        <button onClick={skip} style={{
          padding:"7px 14px",fontSize:11,fontWeight:700,
          background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.15)",
          color:"#fff",borderRadius:7,cursor:"pointer",letterSpacing:0.5,
        }}>SKIP →</button>
        <button onClick={onDone} style={{
          padding:"7px 14px",fontSize:11,fontWeight:700,
          background:"rgba(239,68,68,0.1)",border:"1px solid rgba(239,68,68,0.35)",
          color:"#F87171",borderRadius:7,cursor:"pointer",letterSpacing:0.5,
        }}>EXIT ✕</button>
      </div>

      {/* Match showcase */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:50,position:"relative"}}>
        {/* Home */}
        <TeamReveal team={homeTeam} score={cur.homeScore} pens={cur.homePens}
          isWinner={cur.winnerId === cur.homeId} phase={phase} side="left" key={`h-${idx}`}/>
        {/* VS divider */}
        <div style={{
          fontSize:36,fontWeight:900,color:"rgba(255,255,255,0.18)",letterSpacing:8,
          animation:"vsPulse 1.2s ease-in-out infinite",
        }}>VS</div>
        {/* Away */}
        <TeamReveal team={awayTeam} score={cur.awayScore} pens={cur.awayPens}
          isWinner={cur.winnerId === cur.awayId} phase={phase} side="right" key={`a-${idx}`}/>
      </div>

      {/* Bye banner */}
      {cur.bye && (
        <div style={{marginTop:32,fontSize:13,fontWeight:700,letterSpacing:2,
          color:"rgba(255,255,255,0.4)"}}>BYE — Auto-advance</div>
      )}

      {/* Winner banner (phase=winner) */}
      {phase === "winner" && winner && !cur.bye && (
        <div style={{marginTop:36,
          padding:"10px 28px",borderRadius:11,
          background:`linear-gradient(135deg, ${winner.color}30, ${winner.color}10)`,
          border:`2px solid ${winner.color}`,
          boxShadow:`0 0 30px ${winner.color}66`,
          animation:"badgeDrop 0.4s cubic-bezier(0.34,1.56,0.64,1) both",
          display:"flex",alignItems:"center",gap:10,
        }}>
          <span style={{fontSize:20}}>{winner.emblem}</span>
          <span style={{fontSize:13,fontWeight:900,letterSpacing:3,color:winner.color,
            textShadow:`0 0 12px ${winner.color}88`}}>
            {winner.name.toUpperCase()} ADVANCES
          </span>
        </div>
      )}

      {/* Match progress dots */}
      <div style={{position:"absolute",bottom:42,display:"flex",gap:6}}>
        {results.map((_, i) => (
          <div key={i} style={{
            width: i === idx ? 22 : 7, height:7, borderRadius:7,
            background: i < idx ? "#22C55E" : i === idx ? "#FBBF24" : "rgba(255,255,255,0.15)",
            transition:"all 0.3s",
          }}/>
        ))}
      </div>

      <style>{`
        @keyframes vsPulse { 0%,100%{opacity:0.18;transform:scale(1)} 50%{opacity:0.45;transform:scale(1.06)} }
        @keyframes teamSlideL { from{opacity:0;transform:translateX(-80px)} to{opacity:1;transform:translateX(0)} }
        @keyframes teamSlideR { from{opacity:0;transform:translateX(80px)}  to{opacity:1;transform:translateX(0)} }
        @keyframes scoreCountBig { 0%{transform:scale(2);opacity:0} 50%{transform:scale(0.92);opacity:1} 100%{transform:scale(1);opacity:1} }
        @keyframes winnerGlow { 0%,100%{box-shadow:0 0 30px var(--g),0 0 60px var(--g)} 50%{box-shadow:0 0 50px var(--g),0 0 100px var(--g)} }
        @keyframes loserFade { from{opacity:1} to{opacity:0.35;filter:grayscale(0.7)} }
      `}</style>
    </div>
  );
}

// Sub-component for one team in the reveal
function TeamReveal({ team, score, pens, isWinner, phase, side }: any) {
  if (!team) return <div style={{width:200}}/>;
  const slideAnim = side === "left" ? "teamSlideL" : "teamSlideR";
  const showScore = phase === "score" || phase === "winner";
  const showWinner = phase === "winner";
  const dimmed = showWinner && !isWinner;

  return (
    <div style={{
      width:240,display:"flex",flexDirection:"column",alignItems:"center",gap:18,
      animation:`${slideAnim} 0.55s cubic-bezier(0.22,1,0.36,1) both, ${dimmed ? "loserFade 0.5s 0.1s forwards" : ""}`,
    }}>
      {/* Crest disc */}
      <div style={{
        width:160,height:160,borderRadius:"50%",
        background:`linear-gradient(135deg, ${team.color}, ${team.color}aa)`,
        display:"flex",alignItems:"center",justifyContent:"center",
        boxShadow: showWinner && isWinner
          ? `0 0 50px ${team.color}, 0 0 100px ${team.color}88`
          : `0 0 24px ${team.color}66`,
        animation: showWinner && isWinner ? "winnerGlow 1.4s ease-in-out infinite" : "none",
        // @ts-ignore — CSS var
        "--g": `${team.color}aa`,
        border:`3px solid ${showWinner && isWinner ? "#FBBF24" : team.color}`,
        position:"relative",
        transition:"all 0.4s",
      }}>
        {team.logoImg
          ? <img src={team.logoImg} alt={team.name} style={{width:90,height:90,objectFit:"contain"}}/>
          : <span style={{fontSize:72}}>{team.emblem}</span>
        }
        {showWinner && isWinner && (
          <div style={{position:"absolute",top:-12,right:-12,fontSize:34,
            animation:"badgeDrop 0.4s cubic-bezier(0.34,1.56,0.64,1) both"}}>👑</div>
        )}
      </div>

      {/* Team name */}
      <div style={{textAlign:"center"}}>
        <div style={{fontSize:18,fontWeight:900,color:"#fff",letterSpacing:1,
          textShadow:`0 0 18px ${team.color}88`,maxWidth:230,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
          {team.name}
        </div>
      </div>

      {/* Score (count-up) */}
      <div style={{height:80,display:"flex",alignItems:"center",justifyContent:"center"}}>
        {showScore && (
          <div style={{textAlign:"center"}}>
            <div style={{fontSize:84,fontWeight:900,lineHeight:1,
              color: showWinner && isWinner ? "#FBBF24" : "#fff",
              textShadow: showWinner && isWinner
                ? "0 0 40px rgba(212,165,55,0.85), 0 0 16px #FBBF24"
                : "0 4px 18px rgba(0,0,0,0.7)",
              animation:"scoreCountBig 0.6s cubic-bezier(0.34,1.56,0.64,1) both",
            }}>{score ?? 0}</div>
            {pens !== undefined && pens !== null && (
              <div style={{fontSize:11,fontWeight:700,color:"rgba(255,255,255,0.55)",letterSpacing:1.5,marginTop:4}}>
                ({pens} pen)
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── CHAMPION CELEBRATION ─────────────────────────────────────
// Tournament-winning takeover. Trophy, confetti explosion, banner.
function ChampionCelebration({ champion, runnerUp, onDone }: any) {
  const [stage, setStage] = useState<"build" | "explode" | "stay">("build");
  const confetti = useRef(Array.from({ length: 90 }, (_, i) => ({
    id: i,
    color: [champion?.color ?? "#FBBF24", "#FBBF24", "#FFFFFF", "#FF6B6B", "#4ADE80"][i % 5],
    dx: (Math.random() - 0.5) * 1100,
    dy: -180 - Math.random() * 380,
    rot: Math.random() * 720 - 360,
    delay: Math.random() * 0.6,
    size: 5 + Math.random() * 10,
    shape: i % 3 === 0 ? "circle" : i % 3 === 1 ? "rect" : "star",
  }))).current;

  useEffect(() => {
    try { SFX.crowd("roar"); } catch {}
    const t1 = setTimeout(() => setStage("explode"), 600);
    const t2 = setTimeout(() => setStage("stay"),    1100);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  return (
    <div style={{
      position:"fixed",inset:0,zIndex:400,
      background:"radial-gradient(ellipse at 50% 50%, #1a0f00 0%, #04060d 75%)",
      display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
      fontFamily:"'Segoe UI',system-ui,sans-serif",overflow:"hidden",
    }}>
      {/* Radial gold glow */}
      <div style={{position:"absolute",inset:0,
        background:"radial-gradient(ellipse 60% 50% at 50% 45%, rgba(212,165,55,0.30) 0%, transparent 65%)",
        animation:"orbFloat 5s ease-in-out infinite",pointerEvents:"none"}}/>

      {/* Confetti */}
      {stage !== "build" && confetti.map(p => (
        <div key={p.id} style={{
          position:"absolute",left:"50%",top:"50%",
          width: p.shape === "rect" ? p.size * 1.8 : p.size, height: p.size,
          background: p.color,
          borderRadius: p.shape === "circle" ? "50%" : p.shape === "rect" ? "2px" : "0",
          boxShadow: `0 0 ${p.size}px ${p.color}cc`,
          animation: `confettiBurst 2s ${p.delay}s cubic-bezier(0.25,0.46,0.45,0.94) both`,
          // @ts-ignore
          "--dx": `${p.dx}px`, "--dy": `${p.dy}px`, "--rot": `${p.rot}deg`,
          pointerEvents:"none",zIndex:2,
        } as any}/>
      ))}

      {/* CTWC banner */}
      <div style={{position:"relative",zIndex:5,textAlign:"center",
        animation: stage !== "build" ? "fadeUp 0.8s cubic-bezier(0.22,1,0.36,1) both" : "none"}}>
        <div style={{fontSize:11,fontWeight:700,letterSpacing:9,color:"rgba(255,255,255,0.5)",marginBottom:14}}>
          CTWC 2026
        </div>
        <div style={{fontSize:64,fontWeight:900,color:"#FBBF24",letterSpacing:6,
          textShadow:"0 0 50px rgba(212,165,55,0.7), 0 0 14px #FBBF24",
          marginBottom:36,
        }}>
          🏆 CHAMPIONS 🏆
        </div>
      </div>

      {/* Champion crest */}
      {champion && (
        <div style={{position:"relative",zIndex:5,
          animation: stage === "stay" ? "badgeDrop 0.7s 0.2s cubic-bezier(0.34,1.56,0.64,1) both" : "none",
          opacity: stage === "build" ? 0 : 1,
        }}>
          <div style={{
            width:240,height:240,borderRadius:"50%",
            background:`radial-gradient(circle, ${champion.color}, ${champion.color}aa)`,
            border:"6px solid #FBBF24",
            boxShadow:"0 0 80px rgba(212,165,55,0.7), 0 0 160px rgba(212,165,55,0.4), inset 0 0 40px rgba(255,255,255,0.18)",
            display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto",
            animation:"winnerGlow 2.4s ease-in-out infinite",
            // @ts-ignore
            "--g": "rgba(212,165,55,0.7)",
          }}>
            {champion.logoImg
              ? <img src={champion.logoImg} alt={champion.name} style={{width:140,height:140,objectFit:"contain"}}/>
              : <span style={{fontSize:120}}>{champion.emblem}</span>
            }
          </div>
        </div>
      )}

      {/* Champion name */}
      {champion && (
        <div style={{
          marginTop:32,fontSize:36,fontWeight:900,color:"#fff",letterSpacing:3,
          textShadow:`0 0 28px ${champion.color}aa`,position:"relative",zIndex:5,
          animation: stage === "stay" ? "fadeUp 0.6s 0.5s cubic-bezier(0.22,1,0.36,1) both" : "none",
          opacity: stage === "stay" ? 1 : 0,
        }}>
          {champion.name.toUpperCase()}
        </div>
      )}

      {/* Runner-up note */}
      {runnerUp && stage === "stay" && (
        <div style={{marginTop:18,fontSize:12,color:"rgba(255,255,255,0.45)",letterSpacing:2,
          animation:"fadeUp 0.5s 0.9s cubic-bezier(0.22,1,0.36,1) both",position:"relative",zIndex:5}}>
          Defeated {runnerUp.name} in the final
        </div>
      )}

      {/* Done button */}
      <button onClick={onDone} style={{
        position:"absolute",bottom:48,padding:"14px 36px",
        fontSize:13,fontWeight:800,letterSpacing:3,
        background:"linear-gradient(135deg, #FBBF24, #D4A537)",
        border:"none",borderRadius:10,color:"#1a1a1a",cursor:"pointer",
        boxShadow:"0 0 30px rgba(212,165,55,0.6)",zIndex:5,
        animation: stage === "stay" ? "fadeUp 0.5s 1.4s cubic-bezier(0.22,1,0.36,1) both" : "none",
        opacity: stage === "stay" ? 1 : 0,
      }}>VIEW BRACKET →</button>
    </div>
  );
}

// ─── MATCH DETAIL MODAL ──────────────────────────────────────
function MatchDetailModal({ match, homeTeam, awayTeam, onClose }: any) {
  if (!match) return null;
  const data     = match.match_data ?? {};
  const events: any[] = data.events ?? [];
  const hs       = data.homeStrength;
  const as_      = data.awayStrength;
  const penalty  = match.home_pens !== null && match.home_pens !== undefined;
  const hColor   = homeTeam?.color || "#3B82F6";
  const aColor   = awayTeam?.color || "#EF4444";
  const hWin     = match.winner_id === homeTeam?.id;
  const aWin     = match.winner_id === awayTeam?.id;

  // ── Animated score count-up ───────────────────────────────────
  const [dispH, setDispH] = useState(0);
  const [dispA, setDispA] = useState(0);
  useEffect(() => {
    const targetH = match.home_score ?? 0;
    const targetA = match.away_score ?? 0;
    let h = 0, a = 0;
    const interval = setInterval(() => {
      let done = true;
      if (h < targetH) { h++; setDispH(h); done = false; }
      if (a < targetA) { a++; setDispA(a); done = false; }
      if (done) clearInterval(interval);
    }, 180);
    return () => clearInterval(interval);
  }, [match.id]);

  return (
    <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.9)",backdropFilter:"blur(16px)",zIndex:300,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
      <div onClick={e=>e.stopPropagation()} style={{background:"#0c1118",border:"1px solid rgba(255,255,255,0.1)",borderRadius:20,width:"100%",maxWidth:540,maxHeight:"92vh",overflowY:"auto",fontFamily:"'Segoe UI',system-ui,sans-serif",boxShadow:"0 24px 80px rgba(0,0,0,0.7)"}}>

        {/* ── Header ── */}
        <div style={{padding:"14px 20px",borderBottom:"1px solid rgba(255,255,255,0.06)",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <div style={{fontSize:10,fontWeight:700,color:"rgba(255,255,255,0.3)",letterSpacing:2,textTransform:"uppercase"}}>Match Report</div>
          <button onClick={onClose} style={{background:"none",border:"none",color:"rgba(255,255,255,0.35)",cursor:"pointer",fontSize:22,lineHeight:1,padding:"0 4px",transition:"color 0.15s"}}
            onMouseEnter={e=>e.currentTarget.style.color="#fff"}
            onMouseLeave={e=>e.currentTarget.style.color="rgba(255,255,255,0.35)"}>×</button>
        </div>

        {/* ── Scoreboard ── */}
        <div style={{position:"relative",overflow:"hidden"}}>
          {/* Team color bleed from sides */}
          <div style={{position:"absolute",inset:0,background:`linear-gradient(90deg,${hColor}18 0%,transparent 45%,transparent 55%,${aColor}18 100%)`,pointerEvents:"none"}}/>
          <div style={{padding:"32px 24px 24px",textAlign:"center",position:"relative"}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:16}}>

              {/* Home */}
              <div style={{flex:1,textAlign:"right"}}>
                {homeTeam && (
                  <div style={{display:"flex",alignItems:"center",justifyContent:"flex-end",gap:10}}>
                    <div>
                      <div style={{fontSize:13,fontWeight:800,color:hWin?"#22C55E":"#fff",marginBottom:2}}>{homeTeam.name}</div>
                      <div style={{fontSize:9,color:"rgba(255,255,255,0.28)"}}>{homeTeam.memberIds?.length??0} players</div>
                    </div>
                    <div style={{width:42,height:42,borderRadius:11,background:hColor,display:"flex",alignItems:"center",justifyContent:"center",boxShadow:hWin?`0 0 18px ${hColor}66`:"none"}}>
                      <EmblemImg team={homeTeam} size={26}/>
                    </div>
                  </div>
                )}
              </div>

              {/* Score */}
              <div style={{textAlign:"center",minWidth:110}}>
                <div style={{display:"flex",alignItems:"center",gap:6,justifyContent:"center"}}>
                  <span style={{fontSize:52,fontWeight:900,lineHeight:1,color:hWin?"#22C55E":"#fff",animation:"scoreCount 0.4s ease both"}}>{dispH}</span>
                  <span style={{fontSize:28,color:"rgba(255,255,255,0.2)",fontWeight:300,marginBottom:2}}>–</span>
                  <span style={{fontSize:52,fontWeight:900,lineHeight:1,color:aWin?"#22C55E":"#fff",animation:"scoreCount 0.4s 0.1s ease both"}}>{dispA}</span>
                </div>
                {penalty && <div style={{fontSize:11,color:"#FBBF24",fontWeight:700,marginTop:4}}>Pens: {match.home_pens} – {match.away_pens}</div>}
                <div style={{fontSize:9,color:"rgba(255,255,255,0.22)",letterSpacing:1.5,marginTop:5,textTransform:"uppercase"}}>{match.status==="complete"?"Full Time":"Scheduled"}</div>
              </div>

              {/* Away */}
              <div style={{flex:1,textAlign:"left"}}>
                {awayTeam && (
                  <div style={{display:"flex",alignItems:"center",gap:10}}>
                    <div style={{width:42,height:42,borderRadius:11,background:aColor,display:"flex",alignItems:"center",justifyContent:"center",boxShadow:aWin?`0 0 18px ${aColor}66`:"none"}}>
                      <EmblemImg team={awayTeam} size={26}/>
                    </div>
                    <div>
                      <div style={{fontSize:13,fontWeight:800,color:aWin?"#22C55E":"#fff",marginBottom:2}}>{awayTeam.name}</div>
                      <div style={{fontSize:9,color:"rgba(255,255,255,0.28)"}}>{awayTeam.memberIds?.length??0} players</div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ── Pitch timeline ── */}
        {events.length > 0 && (
          <div style={{padding:"0 24px 20px"}}>
            <div style={{fontSize:9,color:"rgba(255,255,255,0.28)",letterSpacing:1.5,textTransform:"uppercase",marginBottom:10}}>Match Timeline</div>
            <div style={{position:"relative",height:56,background:"rgba(255,255,255,0.02)",borderRadius:10,border:"1px solid rgba(255,255,255,0.06)",overflow:"hidden"}}>
              {/* Pitch markings */}
              <div style={{position:"absolute",left:"50%",top:4,bottom:4,width:1,background:"rgba(255,255,255,0.08)"}}/>
              <div style={{position:"absolute",left:"25%",top:12,bottom:12,width:1,background:"rgba(255,255,255,0.04)"}}/>
              <div style={{position:"absolute",left:"75%",top:12,bottom:12,width:1,background:"rgba(255,255,255,0.04)"}}/>
              {/* Center line label */}
              <div style={{position:"absolute",left:4,top:"50%",transform:"translateY(-50%)",fontSize:8,color:"rgba(255,255,255,0.18)",fontWeight:700}}>0'</div>
              <div style={{position:"absolute",right:4,top:"50%",transform:"translateY(-50%)",fontSize:8,color:"rgba(255,255,255,0.18)",fontWeight:700}}>90'</div>
              {/* Goal dots */}
              {events.map((e:any, i:number) => {
                const isHome = e.team === "home";
                const pct    = Math.min((e.minute / 90) * 100, 98);
                return (
                  <div key={i} title={`${e.scorerName} ${e.minute}'`} style={{
                    position:"absolute",
                    left:`${pct}%`,
                    top: isHome ? 4 : undefined,
                    bottom: isHome ? undefined : 4,
                    transform:"translateX(-50%)",
                    width:22,height:22,borderRadius:"50%",
                    background: isHome ? hColor : aColor,
                    display:"flex",alignItems:"center",justifyContent:"center",
                    fontSize:11,
                    boxShadow:`0 0 10px ${isHome?hColor:aColor}88`,
                    cursor:"default",
                    zIndex:2,
                  }}>⚽</div>
                );
              })}
            </div>
            {/* Minute labels under goals */}
            <div style={{display:"flex",justifyContent:"space-between",marginTop:4}}>
              {events.map((e:any,i:number)=>(
                <div key={i} style={{fontSize:8,color:`${e.team==="home"?hColor:aColor}cc`,fontWeight:700}}>{e.minute}'</div>
              ))}
            </div>
          </div>
        )}

        {/* ── Tug-of-war strength bar ── */}
        {hs && as_ && (
          <div style={{padding:"0 24px 20px"}}>
            <div style={{fontSize:9,color:"rgba(255,255,255,0.28)",letterSpacing:1.5,textTransform:"uppercase",marginBottom:10}}>Team Strength</div>
            {([["⚔️ Attack",hs.attack,as_.attack],["🛡 Defense",hs.defense,as_.defense],["⭐ Avg OVR",hs.ovr,as_.ovr]] as [string,number,number][]).map(([label,hv,av])=>{
              const total = hv+av;
              const hPct  = total > 0 ? (hv/total)*100 : 50;
              return (
                <div key={label} style={{marginBottom:8}}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
                    <span style={{fontSize:10,fontWeight:800,color:hColor}}>{Math.round(hv)}</span>
                    <span style={{fontSize:9,color:"rgba(255,255,255,0.28)"}}>{label}</span>
                    <span style={{fontSize:10,fontWeight:800,color:aColor}}>{Math.round(av)}</span>
                  </div>
                  <div style={{height:7,background:"rgba(255,255,255,0.05)",borderRadius:4,overflow:"hidden",display:"flex"}}>
                    <div style={{width:`${hPct}%`,background:`linear-gradient(90deg,${hColor}99,${hColor})`,borderRadius:"4px 0 0 4px",transition:"width 0.8s ease"}}/>
                    <div style={{flex:1,background:`linear-gradient(90deg,${aColor},${aColor}99)`,borderRadius:"0 4px 4px 0"}}/>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── Goal events list ── */}
        {events.length > 0 && (
          <div style={{padding:"0 24px 24px"}}>
            <div style={{fontSize:9,color:"rgba(255,255,255,0.28)",letterSpacing:1.5,textTransform:"uppercase",marginBottom:10}}>Goals</div>
            <div style={{display:"flex",flexDirection:"column",gap:5}}>
              {events.map((e:any,i:number)=>{
                const isHome = e.team === "home";
                const col    = isHome ? hColor : aColor;
                return (
                  <div key={i} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 13px",borderRadius:9,background:`${col}0a`,border:`1px solid ${col}22`}}>
                    <div style={{width:28,height:28,borderRadius:"50%",background:col,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,flexShrink:0,boxShadow:`0 0 8px ${col}66`}}>⚽</div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:12,fontWeight:800,color:"#fff",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{e.scorerName}</div>
                      <div style={{fontSize:10,color:col,fontWeight:600}}>{isHome?homeTeam?.name:awayTeam?.name}</div>
                    </div>
                    <div style={{fontSize:13,fontWeight:900,color:"rgba(255,255,255,0.45)",flexShrink:0}}>{e.minute}'</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {events.length === 0 && match.status === "complete" && (
          <div style={{padding:"0 24px 28px",textAlign:"center"}}>
            <div style={{fontSize:32,marginBottom:8}}>{data.bye ? "🚀" : "🔒"}</div>
            <div style={{fontSize:13,color:"rgba(255,255,255,0.3)"}}>
              {data.bye ? "Bye — team advances automatically" : "0 – 0 · No goals scored"}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── ADMIN PANEL ──────────────────────────────────────────────
function AdminPanel({ tournament, onSeed, onSimulate, onDeadline, loading }: any) {
  const [pin,  setPin]  = useState("");
  const [open, setOpen] = useState(false);
  const [msg,  setMsg]  = useState("");
  // Deadline editor — pre-populates with current value formatted for datetime-local
  const formatLocal = (iso?: string | null) => {
    if (!iso) return "";
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const [deadline, setDeadline] = useState(formatLocal(tournament?.registration_deadline));
  useEffect(() => { setDeadline(formatLocal(tournament?.registration_deadline)); }, [tournament?.registration_deadline]);

  const exec = async (action: "seed"|"simulate") => {
    const fn = action==="seed" ? onSeed : onSimulate;
    setMsg("Running…");
    const result = await fn(pin);
    setMsg(result);
  };
  const setDl = async () => {
    if (!deadline) { setMsg("Pick a date first"); return; }
    setMsg("Saving deadline…");
    const result = await onDeadline(pin, new Date(deadline).toISOString());
    setMsg(result);
  };
  const RNAMES: Record<number,string> = {1:"R32",2:"R16",3:"QF",4:"SF",5:"Final"};
  const roundLabel = RNAMES[tournament?.current_round] ?? "—";
  return (
    <div style={{margin:"20px 24px 0",padding:"14px 20px",background:"rgba(255,255,255,0.02)",border:"1px dashed rgba(255,255,255,0.10)",borderRadius:12,fontFamily:"'Segoe UI',system-ui,sans-serif"}}>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:open?14:0}}>
        <span style={{fontSize:11,color:"rgba(255,255,255,0.3)",fontWeight:600}}>⚙️ Admin</span>
        <button onClick={()=>setOpen(o=>!o)} style={{fontSize:10,padding:"3px 10px",borderRadius:5,background:"transparent",border:"1px solid rgba(255,255,255,0.1)",color:"rgba(255,255,255,0.4)",cursor:"pointer"}}>{open?"Hide":"Show"}</button>
        {tournament?.status!=="registration"&&<span style={{fontSize:10,color:"#FBBF24",fontWeight:700,marginLeft:4}}>Status: {tournament?.status} · Round {roundLabel}</span>}
      </div>
      {open&&(
        <div>
          <div style={{display:"flex",gap:8,marginBottom:10,alignItems:"center",flexWrap:"wrap"}}>
            <input type="password" value={pin} onChange={e=>setPin(e.target.value)} placeholder="Admin PIN"
              style={{padding:"7px 12px",borderRadius:7,background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.12)",color:"#fff",fontSize:12,fontFamily:"inherit",outline:"none",width:130}}/>
            {tournament?.status==="registration"&&(
              <button onClick={()=>exec("seed")} disabled={loading||!pin} style={{padding:"7px 16px",fontSize:12,fontWeight:700,borderRadius:7,background:pin?"rgba(212,165,55,0.15)":"rgba(255,255,255,0.04)",border:`1px solid ${pin?"rgba(212,165,55,0.4)":"rgba(255,255,255,0.1)"}`,color:pin?"#FBBF24":"rgba(255,255,255,0.25)",cursor:pin?"pointer":"not-allowed"}}>🎲 Seed Bracket</button>
            )}
            {(tournament?.status==="seeded"||tournament?.status==="active")&&(
              <button onClick={()=>exec("simulate")} disabled={loading||!pin} style={{padding:"7px 16px",fontSize:12,fontWeight:700,borderRadius:7,background:pin?"rgba(34,197,94,0.1)":"rgba(255,255,255,0.04)",border:`1px solid ${pin?"rgba(34,197,94,0.4)":"rgba(255,255,255,0.1)"}`,color:pin?"#22C55E":"rgba(255,255,255,0.25)",cursor:pin?"pointer":"not-allowed"}}>⚡ Simulate {roundLabel}</button>
            )}
          </div>
          {/* Registration deadline editor */}
          {tournament?.status==="registration" && (
            <div style={{display:"flex",gap:8,marginBottom:8,alignItems:"center",flexWrap:"wrap",
              padding:"10px 12px",background:"rgba(255,255,255,0.03)",borderRadius:7,border:"1px solid rgba(255,255,255,0.06)"}}>
              <span style={{fontSize:10,color:"rgba(255,255,255,0.5)",fontWeight:700,letterSpacing:1}}>⏰ DEADLINE</span>
              <input type="datetime-local" value={deadline} onChange={e=>setDeadline(e.target.value)}
                style={{padding:"6px 10px",borderRadius:7,background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.12)",color:"#fff",fontSize:11,fontFamily:"inherit",outline:"none"}}/>
              <button onClick={setDl} disabled={loading||!pin||!deadline}
                style={{padding:"6px 14px",fontSize:11,fontWeight:700,borderRadius:7,
                  background: pin&&deadline ? "rgba(96,165,250,0.15)" : "rgba(255,255,255,0.04)",
                  border:`1px solid ${pin&&deadline?"rgba(96,165,250,0.4)":"rgba(255,255,255,0.1)"}`,
                  color: pin&&deadline ? "#60A5FA" : "rgba(255,255,255,0.25)",
                  cursor: pin&&deadline ? "pointer" : "not-allowed"}}>Set Deadline</button>
            </div>
          )}
          {msg&&<div style={{fontSize:11,color:"rgba(255,255,255,0.5)",marginTop:4}}>{msg}</div>}
          <div style={{fontSize:10,color:"rgba(255,255,255,0.2)",marginTop:6}}>Deadline: locks new mints &amp; team joins. Seed: shuffles teams into bracket. Simulate: runs all matches in current round, advances winners.</div>
        </div>
      )}
    </div>
  );
}

// ─── TOURNAMENT PAGE — overview + current round ───────────────
function TournamentPage({ teams, onBack, onBrowse, onBracket, tournament, matches, onAdminSeed, onAdminSimulate, onAdminDeadline, adminLoading }: any) {
  const [selectedMatch, setSelectedMatch] = useState<any>(null);
  const totalFilled = teams.reduce((s,t)=>s+t.memberIds.length,0);
  const totalSlots  = teams.length * 11;
  const fullTeams   = teams.filter(t=>t.memberIds.length===11).length;

  const status     = tournament?.status ?? "registration";
  const curRound   = tournament?.current_round ?? 0;
  const isActive   = status === "active" || status === "seeded" || status === "complete";

  const ROUND_LABEL: Record<number,string> = {1:"Round of 32",2:"Round of 16",3:"Quarter Finals",4:"Semi Finals",5:"Final"};

  // Team lookup by id
  const teamById: Record<string,any> = {};
  teams.forEach(t => teamById[t.id] = t);

  // Matches for current round
  const currentMatches = (matches ?? []).filter((m:any) => m.round_num === curRound);
  const displayRound   = curRound > 0 ? curRound : 1;
  const displayMatches = currentMatches.length > 0 ? currentMatches : (matches ?? []).filter((m:any) => m.round_num === displayRound);

  return (
    <div style={{minHeight:"100vh",background:"#070B14",color:"#fff",fontFamily:"'Segoe UI',system-ui,sans-serif"}}>
      <Nav onHome={onBack}/>

      {/* Match detail modal */}
      {selectedMatch && (
        <MatchDetailModal
          match={selectedMatch}
          homeTeam={teamById[selectedMatch.home_id]}
          awayTeam={teamById[selectedMatch.away_id]}
          onClose={()=>setSelectedMatch(null)}
        />
      )}

      {/* Hero */}
      <div style={{background:"linear-gradient(180deg,rgba(212,165,55,0.08) 0%,transparent 100%)",borderBottom:"1px solid rgba(212,165,55,0.12)",padding:"32px 24px 28px",textAlign:"center"}}>
        <div style={{fontSize:40,marginBottom:8}}>🏆</div>
        <h1 style={{fontSize:28,fontWeight:900,margin:"0 0 6px",letterSpacing:-0.5}}>CT World Cup 2026</h1>
        <p style={{color:"rgba(255,255,255,0.45)",fontSize:14,margin:"0 0 20px"}}>32 teams · 400 players · Single elimination</p>

        {/* Status pills */}
        <div style={{display:"flex",gap:12,justifyContent:"center",flexWrap:"wrap",marginBottom:20}}>
          {[
            { label:"Registration", value: status==="registration"?"OPEN":"CLOSED",
              color: status==="registration"?"#22C55E":"#6B7280" },
            { label:"Players Signed", value:`${totalFilled} / ${totalSlots}`, color:"#FBBF24" },
            { label:"Full Squads",    value:`${fullTeams} / 32`,              color:"#A855F7" },
            { label:"Status",         value: status==="complete"?"🏆 COMPLETE": isActive?`${ROUND_LABEL[curRound]||"Starting"}`: "TBA via CT",
              color: status==="complete"?"#FBBF24": isActive?"#22C55E":"#60A5FA" },
          ].map(s=>(
            <div key={s.label} style={{padding:"8px 16px",borderRadius:10,background:"rgba(255,255,255,0.04)",border:`1px solid ${s.color}30`}}>
              <div style={{fontSize:14,fontWeight:800,color:s.color}}>{s.value}</div>
              <div style={{fontSize:9,color:"rgba(255,255,255,0.35)",letterSpacing:1,textTransform:"uppercase",marginTop:2}}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Overall fill bar */}
        <div style={{maxWidth:440,margin:"0 auto"}}>
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:5}}>
            <span style={{fontSize:10,color:"rgba(255,255,255,0.35)",letterSpacing:1}}>REGISTRATION PROGRESS</span>
            <span style={{fontSize:10,color:"rgba(255,255,255,0.5)",fontWeight:700}}>{Math.round((totalFilled/totalSlots)*100)}%</span>
          </div>
          <div style={{height:6,background:"rgba(255,255,255,0.06)",borderRadius:3,overflow:"hidden"}}>
            <div style={{height:"100%",width:`${(totalFilled/totalSlots)*100}%`,background:"linear-gradient(90deg,#9945FF,#FBBF24,#22C55E)",borderRadius:3,transition:"width 0.5s"}}/>
          </div>
        </div>

        <div style={{display:"flex",gap:12,justifyContent:"center",marginTop:20,flexWrap:"wrap"}}>
          {status==="registration" && (
            <button onClick={onBrowse} style={{padding:"11px 28px",fontSize:13,fontWeight:700,background:"linear-gradient(135deg,#FBBF24,#D4A537)",border:"none",borderRadius:10,color:"#1a1a1a",cursor:"pointer",boxShadow:"0 4px 16px rgba(212,165,55,0.3)"}}>
              📋 Join a Team
            </button>
          )}
          <button onClick={onBracket} style={{padding:"11px 28px",fontSize:13,fontWeight:700,background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.15)",borderRadius:10,color:"#fff",cursor:"pointer"}}>
            🗺️ View Full Bracket
          </button>
        </div>
      </div>

      {/* Admin panel */}
      <AdminPanel
        tournament={tournament}
        onSeed={onAdminSeed}
        onSimulate={onAdminSimulate}
        onDeadline={onAdminDeadline}
        loading={adminLoading}
      />

      {/* Matches section */}
      <div style={{maxWidth:900,margin:"0 auto",padding:"0 20px 40px"}}>

        {/* Round navigation pills */}
        {isActive && (
          <div style={{display:"flex",gap:6,marginBottom:20,overflowX:"auto",paddingBottom:4}}>
            {[1,2,3,4,5].map(r=>{
              const rMatches = (matches??[]).filter((m:any)=>m.round_num===r);
              const done     = rMatches.every((m:any)=>m.status==="complete");
              const active   = r===curRound;
              return (
                <div key={r} style={{flexShrink:0,padding:"6px 14px",borderRadius:8,
                  background:active?"rgba(212,165,55,0.12)":done?"rgba(34,197,94,0.08)":"rgba(255,255,255,0.03)",
                  border:active?"1px solid rgba(212,165,55,0.3)":done?"1px solid rgba(34,197,94,0.2)":"1px solid rgba(255,255,255,0.07)",
                  fontSize:11,fontWeight:700,
                  color:active?"#FBBF24":done?"#22C55E":"rgba(255,255,255,0.35)",
                  letterSpacing:0.5}}>
                  {ROUND_LABEL[r]}{done&&!active?" ✓":""}
                </div>
              );
            })}
          </div>
        )}

        {/* Current round matches */}
        {isActive && displayMatches.length > 0 && (
          <div>
            <div style={{fontSize:11,fontWeight:700,color:"rgba(255,255,255,0.35)",letterSpacing:1.5,textTransform:"uppercase",marginBottom:12}}>
              {ROUND_LABEL[curRound] || "Matches"}
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:12}}>
              {displayMatches.map((m:any)=>{
                const home    = teamById[m.home_id];
                const away    = teamById[m.away_id];
                const done    = m.status === "complete";
                const winHome = done && m.winner_id === m.home_id;
                const winAway = done && m.winner_id === m.away_id;
                const penalty = done && m.home_pens !== null;
                const hc      = home?.color || "#3B82F6";
                const ac      = away?.color || "#EF4444";
                return (
                  <div key={m.id} onClick={()=>done&&setSelectedMatch(m)}
                    style={{position:"relative",borderRadius:14,overflow:"hidden",cursor:done?"pointer":"default",transition:"transform 0.18s,box-shadow 0.18s",
                      border:`1px solid ${done?(winHome?`${hc}44`:(winAway?`${ac}44`:"rgba(34,197,94,0.15)")):"rgba(255,255,255,0.07)"}`,
                      background:"#0d1117"}}
                    onMouseEnter={e=>{if(done){e.currentTarget.style.transform="translateY(-2px)";e.currentTarget.style.boxShadow=`0 8px 32px rgba(0,0,0,0.4)`;} }}
                    onMouseLeave={e=>{e.currentTarget.style.transform="translateY(0)";e.currentTarget.style.boxShadow="none";}}>

                    {/* Team color bleed background */}
                    <div style={{position:"absolute",inset:0,background:`linear-gradient(90deg,${hc}12 0%,transparent 42%,transparent 58%,${ac}12 100%)`,pointerEvents:"none"}}/>

                    {/* Match header */}
                    <div style={{padding:"6px 13px",borderBottom:"1px solid rgba(255,255,255,0.05)",fontSize:9,color:"rgba(255,255,255,0.22)",fontWeight:700,letterSpacing:1,display:"flex",justifyContent:"space-between",position:"relative"}}>
                      <span>MATCH {m.match_num}</span>
                      {done && <span style={{color:"#22C55E",letterSpacing:0.5}}>FT{penalty?" · PENS":""}</span>}
                    </div>

                    {/* Home row */}
                    <div style={{display:"flex",alignItems:"center",gap:10,padding:"11px 13px",borderBottom:"1px solid rgba(255,255,255,0.04)",position:"relative",
                      background:winHome?`${hc}12`:"transparent"}}>
                      {home ? (
                        <>
                          <div style={{width:30,height:30,borderRadius:8,background:hc,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,
                            boxShadow:winHome?`0 0 12px ${hc}66`:"none"}}>
                            <EmblemImg team={home} size={18}/>
                          </div>
                          <div style={{flex:1,minWidth:0}}>
                            <div style={{fontSize:11,fontWeight:800,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",
                              color:winHome?"#22C55E":"#fff"}}>{home.name}</div>
                            <div style={{fontSize:9,color:"rgba(255,255,255,0.22)"}}>{home.memberIds?.length??0}/11</div>
                          </div>
                          {done && <span style={{fontSize:24,fontWeight:900,color:winHome?"#22C55E":"rgba(255,255,255,0.45)",flexShrink:0,letterSpacing:-1}}>{m.home_score}</span>}
                          {winHome && <span style={{fontSize:12,flexShrink:0}}>🏆</span>}
                        </>
                      ) : <span style={{fontSize:11,color:"rgba(255,255,255,0.18)",fontStyle:"italic"}}>TBD</span>}
                    </div>

                    {/* Away row */}
                    <div style={{display:"flex",alignItems:"center",gap:10,padding:"11px 13px",position:"relative",
                      background:winAway?`${ac}12`:"transparent"}}>
                      {away ? (
                        <>
                          <div style={{width:30,height:30,borderRadius:8,background:ac,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,
                            boxShadow:winAway?`0 0 12px ${ac}66`:"none"}}>
                            <EmblemImg team={away} size={18}/>
                          </div>
                          <div style={{flex:1,minWidth:0}}>
                            <div style={{fontSize:11,fontWeight:800,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",
                              color:winAway?"#22C55E":"#fff"}}>{away.name}</div>
                            <div style={{fontSize:9,color:"rgba(255,255,255,0.22)"}}>{away.memberIds?.length??0}/11</div>
                          </div>
                          {done && <span style={{fontSize:24,fontWeight:900,color:winAway?"#22C55E":"rgba(255,255,255,0.45)",flexShrink:0,letterSpacing:-1}}>{m.away_score}</span>}
                          {winAway && <span style={{fontSize:12,flexShrink:0}}>🏆</span>}
                        </>
                      ) : <span style={{fontSize:11,color:"rgba(255,255,255,0.18)",fontStyle:"italic"}}>TBD</span>}
                    </div>

                    {done && <div style={{fontSize:8,color:"rgba(255,255,255,0.18)",textAlign:"center",padding:"5px 0",letterSpacing:1,textTransform:"uppercase",borderTop:"1px solid rgba(255,255,255,0.04)",position:"relative"}}>View match report →</div>}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Registration view — show R32 preview pairs */}
        {!isActive && (
          <div>
            <div style={{fontSize:11,fontWeight:700,color:"rgba(255,255,255,0.35)",letterSpacing:1.5,textTransform:"uppercase",marginBottom:12}}>Round of 32 — Teams</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(240px,1fr))",gap:10}}>
              {Array.from({length:16},(_,i)=>({
                home: teams[i*2]   || null,
                away: teams[i*2+1] || null,
              })).map((m,i)=>(
                <div key={i} style={{background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:12,overflow:"hidden"}}>
                  <div style={{padding:"6px 12px",background:"rgba(255,255,255,0.03)",borderBottom:"1px solid rgba(255,255,255,0.05)",fontSize:9,color:"rgba(255,255,255,0.25)",fontWeight:700,letterSpacing:1}}>MATCH {i+1}</div>
                  {[m.home, m.away].map((team,side)=>(
                    <div key={side} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",borderBottom:side===0?"1px solid rgba(255,255,255,0.05)":"none"}}>
                      {team ? (
                        <>
                          <div style={{width:28,height:28,borderRadius:7,background:`linear-gradient(135deg,${team.color}cc,${team.color}66)`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,flexShrink:0}}><EmblemImg team={team} size={18}/></div>
                          <div style={{flex:1,minWidth:0}}>
                            <div style={{fontSize:11,fontWeight:700,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{team.name}</div>
                            <div style={{fontSize:9,color:"rgba(255,255,255,0.3)"}}>{team.memberIds.length}/11 players</div>
                          </div>
                          {team.memberIds.length===11&&<div style={{fontSize:9,color:"#22C55E",fontWeight:700,flexShrink:0}}>✓</div>}
                        </>
                      ) : (
                        <div style={{fontSize:11,color:"rgba(255,255,255,0.15)",fontStyle:"italic"}}>TBD</div>
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </div>
            {["Round of 16","Quarter Finals","Semi Finals","Final"].map(r=>(
              <div key={r} style={{marginTop:14,padding:"14px 20px",borderRadius:10,background:"rgba(255,255,255,0.02)",border:"1px dashed rgba(255,255,255,0.06)",display:"flex",alignItems:"center",gap:10}}>
                <span style={{fontSize:16}}>🔒</span>
                <div>
                  <div style={{fontSize:12,fontWeight:700,color:"rgba(255,255,255,0.3)"}}>{r}</div>
                  <div style={{fontSize:10,color:"rgba(255,255,255,0.2)"}}>Unlocks after registration closes</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Champion banner */}
        {status === "complete" && tournament?.champion_id && teamById[tournament.champion_id] && (() => {
          const champ = teamById[tournament.champion_id];
          return (
            <div style={{marginTop:32,position:"relative",overflow:"hidden",borderRadius:20,padding:"36px 24px",textAlign:"center",
              background:`linear-gradient(135deg,rgba(212,165,55,0.18) 0%,rgba(212,165,55,0.06) 100%)`,
              border:"2px solid rgba(212,165,55,0.45)",boxShadow:"0 0 60px rgba(212,165,55,0.12)"}}>
              {/* Background shimmer */}
              <div style={{position:"absolute",inset:0,background:"linear-gradient(105deg,transparent 40%,rgba(212,165,55,0.06) 50%,transparent 60%)",animation:"shimmer 3s ease-in-out infinite",pointerEvents:"none"}}/>
              <div style={{fontSize:52,marginBottom:10,animation:"packFloat 4s ease-in-out infinite"}}>🏆</div>
              <div style={{fontSize:10,fontWeight:700,color:"rgba(212,165,55,0.6)",letterSpacing:3,textTransform:"uppercase",marginBottom:14}}>CT World Cup 2026 Champion</div>
              <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:16,marginBottom:12}}>
                <div style={{width:56,height:56,borderRadius:14,background:champ.color,display:"flex",alignItems:"center",justifyContent:"center",fontSize:28,
                  boxShadow:`0 0 28px ${champ.color}88`}}>
                  <EmblemImg team={champ} size={34}/>
                </div>
                <div style={{fontSize:32,fontWeight:900,color:"#FBBF24",letterSpacing:-1}}>{champ.name}</div>
              </div>
              <div style={{fontSize:12,color:"rgba(255,255,255,0.35)"}}>{champ.memberIds?.length ?? 0} players · CT World Cup 2026</div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}

// ─── BRACKET PAGE — SVG tournament map ───────────────────────
function BracketPage({ teams, onBack, tournament, matches }) {
  // ── Layout constants ──────────────────────────────────────
  const SW=1400, SH=710;          // SVG canvas
  const SLW=130, SLH=26, MG=4;   // slot width/height, match gap
  const UNIT = SLH*2 + MG;       // 56 — height of one match (2 slots)
  const COL  = 150;               // column stride
  const PX=10, PY=82;            // padding
  const SP=76;                    // R32 match spacing (top to top)

  // Column x positions (left edge of slot)
  const Lx = [0,1,2,3].map(r => PX + r*COL);           // 10,160,310,460
  const Rx = [0,1,2,3].map(r => SW-PX-SLW - r*COL);    // 1260,1110,960,810
  const FX  = Math.round((Lx[3]+SLW + Rx[3])/2 - SLW/2); // center final slot x

  // Y positions
  const r32T = Array.from({length:8}, (_,i) => PY + i*SP);
  const r32C = r32T.map(y => y + UNIT/2);
  const r16C = [0,1,2,3].map(i => (r32C[i*2]+r32C[i*2+1])/2);
  const r16T = r16C.map(c => c - UNIT/2);
  const qfC  = [0,1].map(i => (r16C[i*2]+r16C[i*2+1])/2);
  const qfT  = qfC.map(c => c - UNIT/2);
  const sfC  = (qfC[0]+qfC[1])/2;
  const sfT  = sfC - UNIT/2;
  const finT = sfT;                    // Final at same y as SF
  const trdT = finT + UNIT + 26;      // 3rd place below Final

  // Connector mid-x helpers
  const lMid = (r) => Lx[r]+SLW + Math.round((Lx[r+1] - (Lx[r]+SLW))/2);
  const rMid = (r) => Rx[r]   - Math.round((Rx[r] - (Rx[r+1]+SLW))/2);
  const LC = "rgba(255,255,255,0.18)";
  const GC = "rgba(212,165,55,0.45)";

  // ── Tournament state ─────────────────────────────────────────
  const isActive = tournament?.status && tournament.status !== "registration";
  const seeding  = (tournament?.seeding ?? []) as string[];
  const teamById: Record<string,any> = {};
  teams.forEach((t:any) => teamById[t.id] = t);

  // Resolve team to show per round/match
  // For seeded bracket, seeding[i] is the team at position i
  const seededTeam = (pos: number): any | null => {
    const id = seeding[pos];
    return id && id !== "bye" ? teamById[id] : null;
  };

  // Get winner of a specific match (round, matchNum)
  const matchData  = (round: number, num: number) =>
    (matches ?? []).find((m:any) => m.round_num === round && m.match_num === num) ?? null;
  const winnerTeam = (round: number, num: number): any | null => {
    const m = matchData(round, num);
    return m?.winner_id ? teamById[m.winner_id] : null;
  };
  const matchScore = (round: number, num: number): string => {
    const m = matchData(round, num);
    if (!m || m.status !== "complete") return "";
    const s = `${m.home_score}–${m.away_score}`;
    return m.home_pens !== null ? `${s} (${m.home_pens}–${m.away_pens}p)` : s;
  };

  // Team to show in each bracket slot
  // R32: use seeding; R16+: use winners of previous round
  const slotTeam = (round: number, pos: number): any | null => {
    if (!isActive) {
      // Pre-seeding: show teams by position
      const allTeams = [...teams];
      if (round === 1) return allTeams[pos] ?? null;
      return null;
    }
    if (round === 1) return seededTeam(pos);
    // For later rounds, team = winner of the corresponding earlier match
    const matchNum = Math.floor(pos / 2) + 1;
    const side     = pos % 2; // 0=home, 1=away
    const prevM    = matchData(round - 1, matchNum);
    if (!prevM || prevM.status !== "complete") return null;
    return side === 0
      ? (teamById[prevM.home_id] === teamById[prevM.winner_id] ? teamById[prevM.home_id] : teamById[prevM.away_id])
      : null; // winner goes to slot 0 of next round's match
  };

  // ── Helpers ───────────────────────────────────────────────
  const Slot = ({x, y, team, gold=false, winner=false}: any) => (
    <g>
      <rect x={x} y={y} width={SLW} height={SLH} rx={4}
        fill={winner?"rgba(34,197,94,0.12)" : team ? `${team.color}20` : gold ? "rgba(212,165,55,0.08)" : "rgba(255,255,255,0.06)"}
        stroke={winner?"rgba(34,197,94,0.5)" : team ? team.color+"70" : gold ? "rgba(212,165,55,0.35)" : "rgba(255,255,255,0.14)"}
        strokeWidth={team ? 1 : 0.6}/>
      {team ? <>
        {team.logoImg
          ? <image href={team.logoImg} x={x+3} y={y+2} width={SLH-4} height={SLH-4}/>
          : <text x={x+5}  y={y+SLH/2} dominantBaseline="middle" fontSize={13}>{team.emblem}</text>
        }
        <text x={x+22} y={y+SLH/2} dominantBaseline="middle" fontFamily="'Segoe UI',system-ui,sans-serif"
          fontSize={8.5} fontWeight={700} fill={winner?"#22C55E":"#fff"}>
          {team.name.length>15 ? team.name.slice(0,15)+"…" : team.name}
        </text>
        <text x={x+SLW-4} y={y+SLH/2} dominantBaseline="middle" textAnchor="end"
          fontFamily="'Segoe UI',system-ui,sans-serif" fontSize={7} fill={team.color}>{team.memberIds?.length ?? 0}/11</text>
      </> : <>
        <text x={x+SLW/2} y={y+SLH/2} dominantBaseline="middle" textAnchor="middle"
          fontFamily="'Segoe UI',system-ui,sans-serif" fontSize={7.5} fill={gold?"rgba(212,165,55,0.4)":"rgba(255,255,255,0.2)"}>
          TBD
        </text>
      </>}
    </g>
  );

  // Match block: shows t1 vs t2 and score if played
  const Match = ({x, top, t1, t2, gold=false, round=0, matchNum=0}: any) => {
    const m     = round > 0 ? matchData(round, matchNum) : null;
    const done  = m?.status === "complete";
    const wId   = m?.winner_id;
    return (
      <g>
        <Slot x={x} y={top}        team={t1} gold={gold} winner={done && wId === t1?.id}/>
        <Slot x={x} y={top+SLH+MG} team={t2} gold={gold} winner={done && wId === t2?.id}/>
        {done && (
          <text x={x + SLW/2} y={top + SLH + MG + SLH + 9} textAnchor="middle"
            fontFamily="'Segoe UI',system-ui,sans-serif" fontSize={7} fill="rgba(34,197,94,0.7)" fontWeight={700}>
            {matchScore(round, matchNum)}
          </text>
        )}
      </g>
    );
  };

  // Left bracket connectors: right side exits, left side entries
  const LConn = ({r, fromC, toC}: any) => {
    const mx=lMid(r), x0=Lx[r]+SLW, x1=Lx[r+1];
    return fromC.reduce((acc: any[],_: any,i: number) => {
      if (i%2!==0) return acc;
      const c0=fromC[i], c1=fromC[i+1], tc=toC[i/2];
      acc.push(<path key={i} d={`M${x0},${c0} H${mx} V${c1} M${x0},${c1} H${mx} M${mx},${tc} H${x1}`}
        fill="none" stroke={LC} strokeWidth={1}/>);
      return acc;
    },[]);
  };

  // Right bracket connectors: left side exits, right side entries
  const RConn = ({r, fromC, toC}: any) => {
    const mx=rMid(r), x0=Rx[r], x1=Rx[r+1]+SLW;
    return fromC.reduce((acc: any[],_: any,i: number) => {
      if (i%2!==0) return acc;
      const c0=fromC[i], c1=fromC[i+1], tc=toC[i/2];
      acc.push(<path key={i} d={`M${x0},${c0} H${mx} V${c1} M${x0},${c1} H${mx} M${mx},${tc} H${x1}`}
        fill="none" stroke={LC} strokeWidth={1}/>);
      return acc;
    },[]);
  };

  // In seeded bracket: left half = positions 0-15, right half = 16-31
  // Each R32 match: position 2i vs 2i+1
  // R16 winner = winner of R32 match i faces winner of R32 match i+1 (for L: matches 1-8, R: matches 9-16)
  const L = isActive
    ? Array.from({length:16}, (_,i) => seededTeam(i))
    : teams.slice(0,16);
  const R = isActive
    ? Array.from({length:16}, (_,i) => seededTeam(i+16))
    : teams.slice(16,32);

  // Compute winners for each round column
  const lR32Winners  = Array.from({length:8},  (_,i) => winnerTeam(1, i+1));
  const lR16Winners  = Array.from({length:4},  (_,i) => winnerTeam(2, i+1));
  const lQFWinners   = Array.from({length:2},  (_,i) => winnerTeam(3, i+1));
  const lSFWinner    = winnerTeam(4, 1);
  const rR32Winners  = Array.from({length:8},  (_,i) => winnerTeam(1, i+9));
  const rR16Winners  = Array.from({length:4},  (_,i) => winnerTeam(2, i+5));
  const rQFWinners   = Array.from({length:2},  (_,i) => winnerTeam(3, i+3));
  const rSFWinner    = winnerTeam(4, 2);
  const champion     = winnerTeam(5, 1);

  return (
    <div style={{minHeight:"100vh",background:"#070B14",color:"#fff",fontFamily:"'Segoe UI',system-ui,sans-serif"}}>
      <Nav onHome={onBack}/>
      <div style={{padding:"16px 20px 40px"}}>
        <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:14,flexWrap:"wrap"}}>
          <h2 style={{fontSize:20,fontWeight:900,margin:0}}>🏆 CT World Cup 2026 — Full Bracket</h2>
          <span style={{fontSize:10,padding:"3px 10px",borderRadius:6,
            background: isActive?"rgba(212,165,55,0.1)":"rgba(34,197,94,0.1)",
            border: isActive?"1px solid rgba(212,165,55,0.3)":"1px solid rgba(34,197,94,0.25)",
            color: isActive?"#FBBF24":"#22C55E",
            fontWeight:700,letterSpacing:1}}>
            {tournament?.status === "complete" ? "🏆 COMPLETE" : isActive ? "LIVE" : "REGISTRATION OPEN"}
          </span>
        </div>
        <div style={{overflowX:"auto",borderRadius:12}}>
          <svg viewBox={`0 0 ${SW} ${SH}`} style={{width:"100%",minWidth:680,height:"auto",display:"block"}}
            xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="pitchBg" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor="#0d2010"/>
                <stop offset="100%" stopColor="#071409"/>
              </linearGradient>
              <radialGradient id="ctrGlow" cx="50%" cy="48%" r="30%">
                <stop offset="0%"   stopColor="rgba(212,165,55,0.12)"/>
                <stop offset="100%" stopColor="rgba(0,0,0,0)"/>
              </radialGradient>
            </defs>

            {/* ── Background ── */}
            <rect width={SW} height={SH} fill="url(#pitchBg)" rx={10}/>
            {Array.from({length:14},(_,i)=>(
              <rect key={i} x={i*(SW/14)} y={0} width={SW/28} height={SH} fill="rgba(255,255,255,0.016)"/>
            ))}
            {[-6,-4,-2,0,2,4,6].map((d,i)=>(
              <line key={i} x1={SW/2} y1={SH*0.45} x2={SW/2+d*SW*0.15} y2={SH}
                stroke="rgba(255,255,255,0.025)" strokeWidth={1}/>
            ))}
            <ellipse cx={SW/2} cy={SH*0.45} rx={220} ry={280} fill="url(#ctrGlow)"/>

            {/* ── Round labels ── */}
            {["R32","R16","QF","SF"].map((lbl,r)=>(
              <g key={r}>
                <text x={Lx[r]+SLW/2} y={PY-14} textAnchor="middle"
                  fontFamily="'Segoe UI',system-ui" fontSize={8} fontWeight={700}
                  fill="rgba(255,255,255,0.28)" letterSpacing={1.5}>{lbl}</text>
                <text x={Rx[r]+SLW/2} y={PY-14} textAnchor="middle"
                  fontFamily="'Segoe UI',system-ui" fontSize={8} fontWeight={700}
                  fill="rgba(255,255,255,0.28)" letterSpacing={1.5}>{lbl}</text>
              </g>
            ))}

            {/* ── Trophy & champion ── */}
            <text x={SW/2} y={28} textAnchor="middle" fontSize={30}>🏆</text>
            {champion ? (
              <>
                <rect x={FX-10} y={56} width={SLW+20} height={16} rx={4} fill="rgba(212,165,55,0.2)" stroke="rgba(212,165,55,0.5)" strokeWidth={1}/>
                <text x={SW/2} y={66} textAnchor="middle" fontFamily="'Segoe UI',system-ui"
                  fontSize={8} fontWeight={900} fill="#FBBF24">
                  {champion.name.length > 18 ? champion.name.slice(0,18)+"…" : champion.name}
                </text>
              </>
            ) : (
              <text x={SW/2} y={52} textAnchor="middle" fontFamily="'Segoe UI',system-ui"
                fontSize={9} fontWeight={900} fill="#FBBF24" letterSpacing={4}>WINNER</text>
            )}
            <line x1={FX+SLW/2} y1={finT} x2={SW/2} y2={74}
              stroke={GC} strokeWidth={1.5} strokeDasharray="5 3"/>
            <text x={SW/2} y={finT+UNIT+11} textAnchor="middle"
              fontFamily="'Segoe UI',system-ui" fontSize={8.5} fontWeight={800}
              fill="rgba(212,165,55,0.7)" letterSpacing={2}>FINAL</text>
            <text x={SW/2} y={trdT+UNIT+11} textAnchor="middle"
              fontFamily="'Segoe UI',system-ui" fontSize={7.5} fontWeight={700}
              fill="rgba(255,255,255,0.35)" letterSpacing={1.5}>3rd Place</text>

            {/* ══ LEFT BRACKET ══ */}
            {/* R32 — left half: matches 1–8 */}
            {Array.from({length:8},(_,i)=>(
              <Match key={i} x={Lx[0]} top={r32T[i]}
                t1={L[i*2]||null} t2={L[i*2+1]||null}
                round={1} matchNum={i+1}/>
            ))}
            <LConn r={0} fromC={r32C} toC={r16C}/>

            {/* R16 — left half: matches 1–4 */}
            {Array.from({length:4},(_,i)=>(
              <Match key={i} x={Lx[1]} top={r16T[i]}
                t1={lR32Winners[i*2]||null} t2={lR32Winners[i*2+1]||null}
                round={2} matchNum={i+1}/>
            ))}
            <LConn r={1} fromC={r16C} toC={qfC}/>

            {/* QF — left half: matches 1–2 */}
            {Array.from({length:2},(_,i)=>(
              <Match key={i} x={Lx[2]} top={qfT[i]}
                t1={lR16Winners[i*2]||null} t2={lR16Winners[i*2+1]||null}
                round={3} matchNum={i+1}/>
            ))}
            <LConn r={2} fromC={qfC} toC={[sfC]}/>

            {/* SF — left: match 1 */}
            <Match x={Lx[3]} top={sfT}
              t1={lQFWinners[0]||null} t2={lQFWinners[1]||null}
              round={4} matchNum={1}/>
            <path d={`M${Lx[3]+SLW},${sfC} H${FX}`} fill="none" stroke={GC} strokeWidth={1.5}/>

            {/* ══ RIGHT BRACKET ══ */}
            {/* R32 — right half: matches 9–16 */}
            {Array.from({length:8},(_,i)=>(
              <Match key={i} x={Rx[0]} top={r32T[i]}
                t1={R[i*2]||null} t2={R[i*2+1]||null}
                round={1} matchNum={i+9}/>
            ))}
            <RConn r={0} fromC={r32C} toC={r16C}/>

            {/* R16 — right half: matches 5–8 */}
            {Array.from({length:4},(_,i)=>(
              <Match key={i} x={Rx[1]} top={r16T[i]}
                t1={rR32Winners[i*2]||null} t2={rR32Winners[i*2+1]||null}
                round={2} matchNum={i+5}/>
            ))}
            <RConn r={1} fromC={r16C} toC={qfC}/>

            {/* QF — right half: matches 3–4 */}
            {Array.from({length:2},(_,i)=>(
              <Match key={i} x={Rx[2]} top={qfT[i]}
                t1={rR16Winners[i*2]||null} t2={rR16Winners[i*2+1]||null}
                round={3} matchNum={i+3}/>
            ))}
            <RConn r={2} fromC={qfC} toC={[sfC]}/>

            {/* SF — right: match 2 */}
            <Match x={Rx[3]} top={sfT}
              t1={rQFWinners[0]||null} t2={rQFWinners[1]||null}
              round={4} matchNum={2}/>
            <path d={`M${Rx[3]},${sfC} H${FX+SLW}`} fill="none" stroke={GC} strokeWidth={1.5}/>

            {/* ══ FINAL ══ */}
            <Match x={FX} top={finT}
              t1={lSFWinner||null} t2={rSFWinner||null}
              gold={true} round={5} matchNum={1}/>

            {/* ══ 3RD PLACE ══ */}
            <Match x={FX} top={trdT} t1={null} t2={null}/>

          </svg>
        </div>
        {/* Legend */}
        <div style={{display:"flex",gap:20,marginTop:14,flexWrap:"wrap"}}>
          {[{c:LC,l:"Round connector"},{c:GC,l:"Final path"},{c:"rgba(34,197,94,0.7)",l:"Winner"}].map(({c,l})=>(
            <div key={l} style={{display:"flex",alignItems:"center",gap:6}}>
              <div style={{width:18,height:2,background:c,borderRadius:1}}/>
              <span style={{fontSize:10,color:"rgba(255,255,255,0.35)"}}>{l}</span>
            </div>
          ))}
          <span style={{fontSize:10,color:"rgba(255,255,255,0.25)",marginLeft:"auto"}}>
            {isActive ? "Live bracket — winners advance automatically" : "Bracket seeded at registration deadline"}
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── APP ─────────────────────────────────────────────────────
const SEED = buildSeedData();


// ─── MAIN APP (Supabase-powered) ─────────────────────────────
export default function CTWCApp() {
  const [page,       setPage]       = useState("landing");
  const [teams,      setTeams]      = useState<any[]>([]);
  const [pool,       setPool]       = useState<any[]>([]);
  const [claimed,    setClaimed]    = useState<Set<string>>(new Set());
  const [pending,    setPending]    = useState<any>(null);
  const [myCardId,   setMyCardId]   = useState<string|null>(null);
  const [viewTeamId, setViewTeamId] = useState<string|null>(null);
  const [loading,    setLoading]    = useState(true);
  const [mintLoading,setMintLoading]= useState(false);
  const [mintError,  setMintError]  = useState<string|null>(null);
  const [myHandle,   setMyHandle]   = useState<string|null>(null);
  const [sessionLoading, setSessionLoading] = useState<boolean>(() => {
    try { return typeof window !== "undefined" && !!localStorage.getItem("ctwc_handle"); }
    catch { return false; }
  });
  const [tournament,    setTournament]    = useState<any>(null);
  const [matchResults,  setMatchResults]  = useState<any[]>([]);
  const [adminLoading,  setAdminLoading]  = useState(false);
  // Active round-reveal sequence (set after a successful simulate)
  const [reveal, setReveal] = useState<{ results: any[]; round: number; isFinal: boolean } | null>(null);
  // Stacked in-app notifications (team match results, etc.)
  const [notifications, setNotifications] = useState<any[]>([]);

  const supabase = createClient();

  // ── Load tournament state ────────────────────────────────────
  const loadTournament = async () => {
    try {
      const res = await fetch("/api/tournament/state");
      if (res.ok) {
        const data = await res.json();
        setTournament(data.tournament ?? null);
        setMatchResults(data.matches ?? []);
      }
    } catch { /* tournament tables may not exist yet — silent */ }
  };

  // ── Load data from Supabase ──────────────────────────────────
  const loadData = async () => {
    const [{ data: teamsData }, { data: cardsData }] = await Promise.all([
      supabase.from("teams").select("*").order("name"),
      supabase.from("cards").select("*"),
    ]);
    if (teamsData && cardsData) {
      setTeams(teamsData.map((t: any) => transformTeam(t, cardsData)));
      setPool(cardsData.map(transformCard)); // pool shows ALL claimed cards
      setClaimed(new Set(cardsData.map((c: any) => c.x_handle)));
    }
    setLoading(false);
  };

  useEffect(() => { loadData(); loadTournament(); }, []);

  // ── Init: OAuth redirect + session restore from localStorage ──
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params      = new URLSearchParams(window.location.search);
    const justClaimed = params.get("just_claimed");
    const oauthError  = params.get("error");

    if (justClaimed || oauthError) {
      window.history.replaceState({}, "", "/");
    }

    if (oauthError) {
      const msgs: Record<string,string> = {
        oauth_failed:   "OAuth failed — please try again.",
        token_failed:   "Could not get access token — please try again.",
        profile_failed: "Could not fetch your X profile — please try again.",
        pool_full:      "The card pool is full (400/400). Registration is closed.",
        no_user:        "X user not found.",
        mint_failed:    "Card minting failed — please try again.",
      };
      setMintError(msgs[oauthError] ?? `Unknown error: ${oauthError}`);
      return;
    }

    // New mint takes priority; fall back to stored session
    let handle: string | null = null;
    try {
      handle = justClaimed || localStorage.getItem("ctwc_handle");
      if (justClaimed) localStorage.setItem("ctwc_handle", justClaimed);
    } catch { /* localStorage blocked */ }
    if (!handle) return;

    (async () => {
      try {
        const sb = createClient();
        const { data } = await sb.from("cards").select("*").eq("x_handle", handle).single();
        if (!data) {
          try { localStorage.removeItem("ctwc_handle"); } catch {}
          if (justClaimed) setMintError("Card minting failed — please try again.");
          return;
        }
        const card = transformCard(data);
        setMyHandle(handle);
        setPending(card);
        setMyCardId(card.id);
        await loadData();
        if (justClaimed) {
          // Browser autoplay policy: a fresh page load (post-OAuth redirect)
          // has NO user gesture yet, so AudioContext is suspended. We can't
          // play audio until the user taps something. Show the "Tap to open"
          // intermediate screen — that tap unlocks audio + fires the build sound.
          setPage("revealReady");
        } else if (data.team_id) {
          setViewTeamId(data.team_id);
          setPage("teamPage");
        } else {
          setPage("teamSetup");
        }
      } catch (err) {
        console.error("Init effect error:", err);
        setMintError("Something went wrong loading your session.");
      } finally {
        setSessionLoading(false);
      }
    })();
  }, []);

  // ── Real-time: refresh when cards table changes ──────────────
  useEffect(() => {
    const channel = supabase
      .channel("cards-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "cards" }, () => {
        loadData();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  // ── Real-time: match results — push notifications for the user's team ──
  useEffect(() => {
    const myTeamId = pending?.teamId;
    if (!myTeamId) return;
    const ch = supabase
      .channel("match-changes")
      .on("postgres_changes", {
        event: "UPDATE", schema: "public", table: "matches",
      }, (payload: any) => {
        const m = payload.new;
        if (!m || m.status !== "complete") return;
        // Only notify if the user's team played in this match
        if (m.home_id !== myTeamId && m.away_id !== myTeamId) return;

        // Avoid duplicate notifications for the same match
        setNotifications(prev => {
          if (prev.some(n => n.matchId === m.id)) return prev;
          const isHome   = m.home_id === myTeamId;
          const myScore  = isHome ? m.home_score : m.away_score;
          const oppScore = isHome ? m.away_score : m.home_score;
          const oppId    = isHome ? m.away_id    : m.home_id;
          const oppTeam  = teams.find((t: any) => t.id === oppId);
          const won      = m.winner_id === myTeamId;
          const draw     = m.winner_id == null;
          const round    = m.round_num;
          const ROUND_LABELS: any = { 1:"Round of 32", 2:"Round of 16", 3:"Quarter Finals", 4:"Semi Finals", 5:"Final" };

          const note = {
            id:       `m-${m.id}`,
            matchId:  m.id,
            ts:       Date.now(),
            color:    won ? "#22C55E" : draw ? "#FBBF24" : "#EF4444",
            icon:     won ? "🏆" : draw ? "⚖️" : "💔",
            title:    won ? "Your team WON" : draw ? "Match drawn" : "Your team lost",
            subtitle: ROUND_LABELS[round] ?? `Round ${round}`,
            body:     `${myScore}–${oppScore} vs ${oppTeam?.name ?? "Unknown"}`,
            opponent: oppTeam ?? null,
          };
          // Auto-dismiss after 9s
          setTimeout(() => {
            setNotifications(p => p.filter(n => n.id !== note.id));
          }, 9000);
          // Play sound (best effort)
          try { won ? SFX.crowd("roar") : SFX.click(); } catch {}
          return [note, ...prev].slice(0, 4); // cap at 4 stacked
        });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [pending?.teamId, teams]);

  // ── Derived state ────────────────────────────────────────────
  const viewTeam = useMemo(() => teams.find(t => t.id === viewTeamId) || null, [teams, viewTeamId]);
  const myTeam   = useMemo(() => teams.find(t => t.memberIds.includes(myCardId)) || null, [teams, myCardId]);

  // ── Mint card (calls /api/mint-card → X API) ─────────────────
  const handleClaim = async (profile: { handle: string }) => {
    setMintLoading(true);
    setMintError(null);
    try {
      const res = await fetch("/api/mint-card", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ x_handle: profile.handle }),
      });
      const data = await res.json();
      if (!res.ok) { setMintError(data.error || "Mint failed"); setMintLoading(false); return; }
      const card = transformCard(data.card);
      setPending(card);
      setMyCardId(card.id);
      // Same tap-to-open gate as OAuth path — guarantees user gesture
      // before AudioContext resumes, fixing browser autoplay block.
      setPage("revealReady");
    } catch (e) {
      setMintError("Network error — try again");
    }
    setMintLoading(false);
  };

  const afterReveal = () => {
    if (!pending) return;
    setPage("teamSetup");
  };

  // ── Join team (calls /api/join-team) ─────────────────────────
  // Returns null on success, or an error message string for the caller to display.
  // `position` is the slot the user picked from the pitch UI.
  const handleJoinedTeam = async (team: any, position?: string): Promise<string | null> => {
    if (!pending) return "You don't have a card yet.";
    try {
      const res = await fetch("/api/join-team", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ card_id: pending.id, team_id: team.id, position }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return data?.error ?? `Join failed (${res.status})`;
      }
      await loadData();
      setViewTeamId(team.id);
      setPage("teamPage");
      return null;
    } catch (err: any) {
      console.error("join failed:", err);
      return "Network error — try again";
    }
  };

  // ── Leave team ───────────────────────────────────────────────
  const handleLeaveTeam = async (team: any, cardId: string) => {
    await fetch("/api/join-team", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ card_id: cardId }),
    });
    await loadData();
    setPage("browseTeams");
  };

  const handleTeamUpdate = () => { loadData(); };
  const handleCreatedTeam = (team: any) => {
    loadData();
    setViewTeamId(team.id);
    setPage("teamPage");
  };

  // ── Admin: seed bracket ───────────────────────────────────────
  const handleAdminSeed = async (pin: string): Promise<string> => {
    setAdminLoading(true);
    try {
      const res = await fetch("/api/tournament/seed", {
        method: "POST",
        headers: { "x-admin-pin": pin },
      });
      const data = await res.json();
      if (!res.ok) return `Error: ${data.error ?? res.statusText}`;
      await loadTournament();
      return `✓ Bracket seeded! ${data.matchCount} R32 matches created.`;
    } catch (e) {
      return "Network error";
    } finally {
      setAdminLoading(false);
    }
  };

  // ── Admin: set registration deadline ──────────────────────────
  const handleAdminDeadline = async (pin: string, deadline: string): Promise<string> => {
    setAdminLoading(true);
    try {
      const res = await fetch("/api/tournament/deadline", {
        method:  "POST",
        headers: { "x-admin-pin": pin, "Content-Type": "application/json" },
        body:    JSON.stringify({ deadline }),
      });
      const data = await res.json();
      if (!res.ok) return `Error: ${data.error ?? res.statusText}`;
      await loadTournament();
      return `✓ Deadline set to ${new Date(data.deadline).toLocaleString()}`;
    } catch (e) {
      return "Network error";
    } finally {
      setAdminLoading(false);
    }
  };

  // ── Admin: simulate current round ─────────────────────────────
  const handleAdminSimulate = async (pin: string): Promise<string> => {
    setAdminLoading(true);
    try {
      const res = await fetch("/api/tournament/simulate", {
        method: "POST",
        headers: { "x-admin-pin": pin },
      });
      const data = await res.json();
      if (!res.ok) return `Error: ${data.error ?? res.statusText}`;
      await loadTournament();
      // Trigger the per-match reveal sequence with the freshly returned results
      if (Array.isArray(data.results) && data.results.length > 0) {
        setReveal({
          results: data.results,
          round:   data.round ?? 1,
          isFinal: !!data.isFinal,
        });
      }
      return data.message ?? "Round simulated!";
    } catch (e) {
      return "Network error";
    } finally {
      setAdminLoading(false);
    }
  };

  if (loading) {
    return (
      <div style={{ minHeight:"100vh", background:"#070B14", display:"flex", alignItems:"center", justifyContent:"center", flexDirection:"column", gap:16, fontFamily:"'Segoe UI',system-ui,sans-serif" }}>
        <div style={{ width:40, height:40, border:"3px solid rgba(255,255,255,0.08)", borderTopColor:"#D4A537", borderRadius:"50%", animation:"spin 0.8s linear infinite" }}/>
        <span style={{ color:"rgba(255,255,255,0.4)", fontSize:13 }}>Loading CTWC…</span>
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    );
  }

  return (
    <div>
      <style>{`
        @keyframes spin { to{transform:rotate(360deg)} }
        @keyframes fadeSlide { from{opacity:0;transform:translateY(-8px)} to{opacity:1;transform:translateY(0)} }
        @keyframes ppulse { 0%,100%{opacity:0;transform:scale(0.5)} 50%{opacity:0.8;transform:scale(1.5)} }
        @keyframes packFloat { 0%,100%{transform:translateY(0px) scale(1)} 50%{transform:translateY(-12px) scale(1.02)} }
        @keyframes packRipLeft { 0%{transform:translateX(0) rotateY(0) scaleY(1);opacity:1} 100%{transform:translateX(-280px) rotateY(-35deg) scaleY(0.6);opacity:0} }
        @keyframes flashOut { 0%{opacity:0.85} 100%{opacity:0} }
        @keyframes glowBurst { 0%{transform:scale(0.2);opacity:0.9} 60%{transform:scale(1.1);opacity:0.6} 100%{transform:scale(1.4);opacity:0} }
        @keyframes cardZoom { 0%{transform:scale(0) rotateY(180deg) translateY(40px);opacity:0} 60%{transform:scale(1.08) rotateY(-4deg) translateY(-6px);opacity:1} 100%{transform:scale(1) rotateY(0deg) translateY(0);opacity:1} }
        @keyframes badgeDrop { 0%{transform:translateY(-60px) scale(0.5);opacity:0} 100%{transform:translateY(0) scale(1);opacity:1} }
        @keyframes confettiBurst { 0%{transform:translate(-50%,-50%) rotate(0deg);opacity:1} 100%{transform:translate(calc(-50% + var(--dx)),calc(-50% + var(--dy))) rotate(var(--rot));opacity:0} }
        @keyframes shimmerSweep { 0%{left:-60px} 100%{left:260px} }
        @keyframes shimmer { 0%{left:-100%} 100%{left:200%} }
        @keyframes orbFloat { 0%,100%{transform:translateY(0px) scale(1)} 50%{transform:translateY(-30px) scale(1.04)} }
        @keyframes fadeUp { from{opacity:0;transform:translateY(16px)} to{opacity:1;transform:translateY(0)} }
        @keyframes scoreCount { 0%{transform:scale(1.4);opacity:0} 60%{transform:scale(0.95);opacity:1} 100%{transform:scale(1);opacity:1} }
        @keyframes pitchPulse { 0%,100%{transform:scaleX(1)} 50%{transform:scaleX(1.03)} }
        @keyframes holoIn     { 0%{opacity:0;transform:translateY(8px) scale(0.95)} 100%{opacity:1;transform:translateY(0) scale(1)} }
        @keyframes holoSweep  { 0%{left:-30%} 100%{left:130%} }
        @keyframes holoBarFill{ 0%{width:0%} }
        *{box-sizing:border-box;margin:0;padding:0}
        body{background:#070B14;overflow-x:hidden}
        input::placeholder{color:rgba(255,255,255,0.22)}
        ::-webkit-scrollbar{width:5px}
        ::-webkit-scrollbar-track{background:transparent}
        ::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.07);border-radius:3px}
      `}</style>

      {mintError && (
        <div style={{ position:"fixed", top:16, left:"50%", transform:"translateX(-50%)", zIndex:9999, background:"#7f1d1d", border:"1px solid #ef4444", borderRadius:10, padding:"10px 20px", fontSize:13, color:"#fca5a5", boxShadow:"0 4px 20px rgba(0,0,0,0.4)" }}>
          ⚠️ {mintError} <button onClick={()=>setMintError(null)} style={{marginLeft:12,background:"none",border:"none",color:"#fca5a5",cursor:"pointer",fontSize:16}}>×</button>
        </div>
      )}

      {page==="landing"     && <Landing onConnect={()=>setPage("connect")} onPool={()=>setPage("pool")} onTeams={()=>setPage("teamsList")} onTournament={()=>setPage("tournament")} onLeaderboard={()=>setPage("leaderboard")} pool={pool} teams={teams} myCard={pending} sessionLoading={sessionLoading} totalClaimed={claimed.size} tournament={tournament} onMyTeam={()=>{ if(viewTeamId){ setPage("teamPage"); } else { setPage("teamSetup"); } }}/>}
      {page==="leaderboard" && <LeaderboardPage pool={pool} teams={teams} myCard={pending} onBack={()=>setPage("landing")} onClaim={()=>setPage("connect")}/>}
      {page==="connect"     && <ConnectPage onBack={()=>setPage("landing")}/>}
      {page==="revealReady" && pending && (
        <RevealReadyGate card={pending} onOpen={() => {
          // This click IS the user gesture — AudioContext can now play.
          getCtx();              // resumes if suspended
          warmAudio();           // pre-fill noise buffer
          SFX.crowd("build");    // fire sound in same task as page transition
          setPage("reveal");
        }}/>
      )}
      {page==="reveal"      && pending && (
        <div style={{minHeight:"100vh",background:"#070B14",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",fontFamily:"'Segoe UI',system-ui,sans-serif"}}>
          <CardReveal card={pending} onDone={afterReveal}/>
          <div style={{marginTop:24,display:"flex",gap:10}}>
            <button onClick={afterReveal} style={{padding:"9px 20px",fontSize:12,fontWeight:600,borderRadius:8,background:"linear-gradient(135deg,#D4A537,#FBBF24)",border:"none",color:"#1a1a1a",cursor:"pointer"}}>Continue → Pick Your Team</button>
          </div>
        </div>
      )}
      {page==="teamSetup"   && pending && <TeamSetupPage card={pending} onBrowseTeams={()=>setPage("browseTeams")} onSkip={()=>setPage("pool")}/>}
      {page==="createTeam"  && pending && <CreateTeamPage card={pending} onCreated={handleCreatedTeam} onBack={()=>setPage("browseTeams")}/>}
      {page==="browseTeams" && <BrowseTeamsPage card={pending} teams={teams} onJoined={handleJoinedTeam} onBack={()=>setPage("landing")}/>}
      {page==="teamPage"    && viewTeam && <TeamPage team={viewTeam} myCardId={myCardId} onTeamUpdate={handleTeamUpdate} onBack={()=>setPage("landing")} onPool={()=>setPage("pool")} onLeave={handleLeaveTeam} onBrowse={()=>setPage("browseTeams")}/>}
      {page==="pool"        && <PlayerPool pool={pool} myCard={pending} onBack={()=>setPage("landing")} onClaim={()=>setPage("connect")}/>}
      {page==="teamsList"   && <TeamsListPage teams={teams} myCard={pending} onBack={()=>setPage("landing")} onViewTeam={(id: string)=>{setViewTeamId(id);setPage("teamPage");}} onClaim={()=>setPage("connect")}/>}
      {page==="tournament"  && <TournamentPage teams={teams} onBack={()=>setPage("landing")} onBrowse={()=>setPage("browseTeams")} onBracket={()=>setPage("bracket")} tournament={tournament} matches={matchResults} onAdminSeed={handleAdminSeed} onAdminSimulate={handleAdminSimulate} onAdminDeadline={handleAdminDeadline} adminLoading={adminLoading}/>}
      {page==="bracket"     && <BracketPage teams={teams} onBack={()=>setPage("tournament")} tournament={tournament} matches={matchResults}/>}

      {/* Live in-app notifications (e.g. user's team match results) */}
      <NotificationStack
        notifications={notifications}
        onDismiss={(id: string) => setNotifications(prev => prev.filter(n => n.id !== id))}
        onClick={() => setPage("bracket")}
      />

      {/* Round reveal sequence — fires after admin simulates a round */}
      {reveal && (
        <RoundRevealSequence
          results={reveal.results}
          teams={teams}
          round={reveal.round}
          isFinal={reveal.isFinal}
          onDone={() => { setReveal(null); setPage("bracket"); }}
        />
      )}
    </div>
  );
}
