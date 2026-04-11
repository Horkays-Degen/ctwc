"use client";
import { useState, useEffect, useRef, useMemo } from "react";
import { createClient } from "@/lib/supabase";

// ─── DATA TRANSFORMS (Supabase rows → UI shape) ───────────────
const SLOT_POSITIONS = ["GK","CB","CB","LB","RB","CM","CM","CAM","LW","RW","ST"];

function transformCard(row: any) {
  return {
    id:          row.id,
    handle:      row.x_handle,
    displayName: row.display_name,
    avatarUrl:   row.avatar_url,
    ovr:         row.ovr,
    tier:        row.tier,
    stats:       row.stats || {},
    badges:      row.badges || [],
    teamId:      row.team_id,
    position:    row.position,
    rawProfile: {
      followers:    row.followers,
      followingCount: row.following,
      listedCount:  row.listed_count,
      tweetCount:   row.tweet_count,
      verified:     row.verified,
    },
  };
}

function transformTeam(teamRow: any, allCards: any[]) {
  const teamCards = allCards.filter(c => c.team_id === teamRow.id);
  const slots = SLOT_POSITIONS.map((pos, i) => {
    const card = teamCards.find(c => c.position === pos && teamCards.indexOf(c) === i) ||
                 teamCards[i] || null;
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
let _actx = null;
function getCtx() {
  try {
    if (!_actx) _actx = new (window.AudioContext || (window as any).webkitAudioContext)();
    if (_actx.state === "suspended") _actx.resume();
    return _actx;
  } catch(e) { return null; }
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
    const sz = Math.ceil((dur + 0.5) * c.sampleRate);
    const buf = c.createBuffer(2, sz, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < sz; i++) d[i] = Math.random() * 2 - 1;
    }
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
    const note = (freq, start, dur, type = "sine", vol = 0.22) => {
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
    if (tierName === "Common") {
      note(880,  0,   1.0, "sine", 0.16);
      note(1320, 0.1, 0.8, "sine", 0.07);
    } else if (tierName === "Rare") {
      note(440,  0,    1.2, "sine", 0.2);
      note(660,  0.15, 1.0, "sine", 0.2);
      note(880,  0.32, 0.9, "sine", 0.14);
    } else if (tierName === "Epic") {
      note(440,  0,    1.8, "sine",     0.2);
      note(554,  0,    1.8, "sine",     0.2);
      note(659,  0,    1.8, "sine",     0.2);
      note(880,  0.25, 1.4, "triangle", 0.1);
      note(1320, 0.48, 1.1, "triangle", 0.06);
    } else if (tierName === "Legendary" || tierName === "Mythic") {
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

// ─── TIERS ───────────────────────────────────────────────────
const TIERS = {
  COMMON:    { name:"Common",    border:"#7B8794", bg:"#3A3D44", bgDark:"#22242A", accent:"#9EA6B0", glow:"rgba(155,162,170,0.3)",  textColor:"#C4CAD2", minOvr:0  },
  RARE:      { name:"Rare",      border:"#3B82F6", bg:"#152B52", bgDark:"#0A1628", accent:"#60A5FA", glow:"rgba(59,130,246,0.4)",   textColor:"#93C5FD", minOvr:60 },
  EPIC:      { name:"Epic",      border:"#A855F7", bg:"#2D1250", bgDark:"#180828", accent:"#C084FC", glow:"rgba(168,85,247,0.45)",  textColor:"#D8B4FE", minOvr:75 },
  LEGENDARY: { name:"Legendary", border:"#D4A537", bg:"#4A3410", bgDark:"#2A1D06", accent:"#FBBF24", glow:"rgba(212,165,55,0.55)",  textColor:"#FDE68A", minOvr:90 },
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
  { id:0,  pos:"GK",  x:200, y:482 },
  { id:1,  pos:"LB",  x:52,  y:382 },
  { id:2,  pos:"CB",  x:145, y:364 },
  { id:3,  pos:"CB",  x:255, y:364 },
  { id:4,  pos:"RB",  x:348, y:382 },
  { id:5,  pos:"CDM", x:112, y:258 },
  { id:6,  pos:"CM",  x:200, y:238 },
  { id:7,  pos:"CAM", x:288, y:258 },
  { id:8,  pos:"LW",  x:58,  y:116 },
  { id:9,  pos:"ST",  x:200, y:96  },
  { id:10, pos:"RW",  x:342, y:116 },
];

const CAT_SLOTS = { GK:["GK"], DEF:["LB","CB","RB"], MID:["CDM","CM","CAM"], FWD:["LW","ST","RW"] };

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

// ─── STAT ENGINE ─────────────────────────────────────────────
function computeMetrics(p) {
  const eng = p.avgLikes + p.avgRetweets + p.avgQuotes + p.avgReplies + p.avgBookmarks;
  const er  = p.avgImpressions > 0 ? (eng / p.avgImpressions) * 100 : 0;
  const vir = p.avgImpressions > 0 ? ((p.avgRetweets + p.avgQuotes) / p.avgImpressions) * 100 : 0;
  const freq= p.tweetCount / Math.max(p.accountAgeDays, 1);
  const ffr = p.following  > 0 ? p.followers / p.following : p.followers;
  return { er, vir, freq, ffr, eng };
}
const norm  = (v,mn,mx) => Math.round(Math.min(99, Math.max(10, ((v-mn)/(mx-mn))*89+10)));
const clamp = v => Math.round(Math.min(99, Math.max(10, v)));
const jit   = () => (Math.random()*10)-5;

function computeOVR(p) {
  const m  = computeMetrics(p);
  const rs = norm(Math.log10(Math.max(p.followers,10)),1,7);
  const es = norm(m.er,0,10);
  const vs = norm(m.vir,0,3);
  const as = norm(m.freq,0,30);
  const ls = norm(Math.log10(Math.max(p.listedCount,1)),0,5);
  let ovr  = Math.round(rs*0.30 + es*0.25 + vs*0.20 + as*0.15 + ls*0.10);
  if (p.verified)              ovr = Math.min(99, ovr+8);
  if (p.accountAgeDays > 1825) ovr = Math.min(99, ovr+4);
  return clamp(ovr);
}

function getTier(ovr) {
  if (ovr >= 90) return TIERS.LEGENDARY;
  if (ovr >= 75) return TIERS.EPIC;
  if (ovr >= 60) return TIERS.RARE;
  return TIERS.COMMON;
}

function computeStats(p, posCode) {
  const m   = computeMetrics(p);
  const cat = POSITIONS.find(x=>x.code===posCode)?.cat || "MID";
  const reach= norm(Math.log10(Math.max(p.followers,10)),1,7);
  const er   = norm(m.er,0,10);
  const vir  = norm(m.vir,0,3);
  const act  = norm(m.freq,0,30);
  const auth = norm(Math.log10(Math.max(p.listedCount,1)),0,5);
  const lon  = norm(p.accountAgeDays,0,4000);
  const ffr  = norm(Math.min(m.ffr,5000),0,5000);
  const likes= norm(Math.log10(Math.max(p.avgLikes,1)),0,5);
  const impr = norm(Math.log10(Math.max(p.avgImpressions,1)),1,7);
  const bkm  = norm(p.avgBookmarks,0,2000);

  const PAC  = clamp((act*0.4 + impr*0.6) + jit());
  const SHO  = clamp((likes*0.5 + er*0.5)  + jit());
  const PAS  = clamp((vir*0.5 + norm(p.avgRetweets+p.avgQuotes,0,3000)*0.5) + jit());
  const DRI  = clamp((bkm*0.6 + er*0.4)    + jit());
  const DEF  = clamp((ffr*0.5 + norm(p.avgReplies,0,1000)*0.3 + lon*0.2) + jit());
  const PHY  = clamp((lon*0.35+ auth*0.4 + norm(p.tweetCount,0,50000)*0.25) + jit());

  const B = { GK:{PAC:-12,SHO:-8,PAS:0,DRI:0,DEF:15,PHY:12}, DEF:{PAC:-5,SHO:-12,PAS:-3,DRI:-5,DEF:18,PHY:10}, MID:{PAC:0,SHO:-3,PAS:15,DRI:8,DEF:0,PHY:-5}, FWD:{PAC:12,SHO:18,PAS:-3,DRI:10,DEF:-15,PHY:-3} }[cat]||{};
  return { PAC:clamp(PAC+(B.PAC||0)), SHO:clamp(SHO+(B.SHO||0)), PAS:clamp(PAS+(B.PAS||0)), DRI:clamp(DRI+(B.DRI||0)), DEF:clamp(DEF+(B.DEF||0)), PHY:clamp(PHY+(B.PHY||0)) };
}

function getBadges(p, ovr) {
  const m=computeMetrics(p), badges=[];
  if (p.verified) badges.push({label:"✓ Blue Check",color:"#60A5FA"});
  if (p.accountAgeDays>1825 && p.listedCount>500) badges.push({label:"OG Legend",color:"#FBBF24"});
  if (m.er>5)  badges.push({label:"Engagement King",color:"#A855F7"});
  if (m.vir>1.5) badges.push({label:"Meme Lord",color:"#F87171"});
  if (p.listedCount>2000) badges.push({label:"Top Authority",color:"#10B981"});
  return badges.slice(0,2);
}

function getWeightedPos() {
  const total=POSITIONS.reduce((s,p)=>s+p.weight,0); let r=Math.random()*total;
  for(const p of POSITIONS){ r-=p.weight; if(r<=0) return p; }
  return POSITIONS[POSITIONS.length-1];
}

function createCard(profile, posCode) {
  const pos  = posCode ? POSITIONS.find(p=>p.code===posCode)||getWeightedPos() : getWeightedPos();
  const ovr  = computeOVR(profile);
  const tier = getTier(ovr);
  return { id:"CT-"+Math.random().toString(36).substring(2,8).toUpperCase(),
    handle:profile.handle, displayName:profile.displayName,
    position:pos, ovr, tier,
    stats:computeStats(profile,pos.code),
    badges:getBadges(profile,ovr),
    rawProfile:profile };
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

// ─── SHIELD CARD ─────────────────────────────────────────────
function ShieldCard({ card, size="large", onClick }) {
  const t=card.tier, isLg=size==="large";
  const W=isLg?340:200, H=isLg?490:289;
  const sk=Object.keys(card.stats);
  const av=aColor(card.displayName), ini=inits(card.displayName);
  const uid=card.id.replace(/[^a-z0-9]/gi,"");
  const m=computeMetrics(card.rawProfile||{avgImpressions:1,followers:1000,following:100,avgLikes:10,avgRetweets:2,avgQuotes:1,avgReplies:3,avgBookmarks:2,tweetCount:100,listedCount:10,accountAgeDays:365,verified:false});
  const SHIELD="M170 8 C228 8 278 12 318 28 C330 33 336 43 336 56 L336 338 C336 368 323 392 298 412 L183 478 C178 481 162 481 157 478 L42 412 C17 392 4 368 4 338 L4 56 C4 43 10 33 22 28 C62 12 112 8 170 8Z";
  const INNER="M170 18 C224 18 272 22 310 36 C320 41 326 49 326 60 L326 334 C326 362 314 384 291 403 L181 465 C177 467 163 467 159 465 L49 403 C26 384 14 362 14 334 L14 60 C14 49 20 41 30 36 C68 22 116 18 170 18Z";
  return (
    <div onClick={onClick} style={{cursor:onClick?"pointer":"default",display:"inline-block",transition:"transform 0.25s"}}
      onMouseEnter={e=>{if(onClick)e.currentTarget.style.transform="scale(1.04)";}}
      onMouseLeave={e=>{e.currentTarget.style.transform="scale(1)";}}>
      <svg width={W} height={H} viewBox="0 0 340 490" style={{filter:`drop-shadow(0 0 ${isLg?22:10}px ${t.glow}) drop-shadow(0 8px 24px rgba(0,0,0,0.5))`}}>
        <defs>
          <clipPath id={`cl-${uid}`}><path d={SHIELD}/></clipPath>
          <linearGradient id={`bg-${uid}`} x1="0" y1="0" x2="0.6" y2="1"><stop offset="0%" stopColor={t.bg}/><stop offset="100%" stopColor={t.bgDark}/></linearGradient>
          <radialGradient id={`hl-${uid}`} cx="50%" cy="30%" r="55%"><stop offset="0%" stopColor={t.accent} stopOpacity="0.18"/><stop offset="100%" stopColor="transparent"/></radialGradient>
          <linearGradient id={`br-${uid}`} x1="0" y1="0" x2="0.4" y2="1"><stop offset="0%" stopColor={t.accent}/><stop offset="40%" stopColor={t.border}/><stop offset="75%" stopColor={t.accent}/><stop offset="100%" stopColor={t.border} stopOpacity="0.5"/></linearGradient>
          <pattern id={`pt-${uid}`} x="0" y="0" width="80" height="80" patternUnits="userSpaceOnUse">
            <polygon points="40,0 80,28 65,72 15,72 0,28" fill="none" stroke={t.accent} strokeWidth="0.4" opacity="0.12"/>
          </pattern>
        </defs>
        <g clipPath={`url(#cl-${uid})`}>
          <rect width="340" height="490" fill={`url(#bg-${uid})`}/>
          <rect width="340" height="490" fill={`url(#pt-${uid})`}/>
          <rect width="340" height="490" fill={`url(#hl-${uid})`}/>
          <polygon points="170,55 240,145 205,255 135,255 100,145" fill={t.accent} opacity="0.04"/>
          <polygon points="170,72 225,148 196,238 144,238 115,148" fill={t.accent} opacity="0.055"/>
          <line x1="28" y1="308" x2="312" y2="308" stroke={t.border} strokeWidth="1" opacity="0.25"/>
          <line x1="48" y1="375" x2="292" y2="375" stroke={t.border} strokeWidth="0.6" opacity="0.15"/>
          {/* OVR + pos */}
          <text x="46" y="72" fontSize="50" fontWeight="900" fill={t.textColor} fontFamily="'Segoe UI',system-ui,sans-serif" textAnchor="middle">{card.ovr}</text>
          <text x="46" y="94" fontSize="16" fontWeight="700" fill={t.textColor} opacity="0.85" fontFamily="'Segoe UI',system-ui,sans-serif" textAnchor="middle">{card.position.code}</text>
          {/* Tier */}
          <text x="294" y="56" fontSize="10" fontWeight="700" fill={t.textColor} opacity="0.5" fontFamily="'Segoe UI',system-ui,sans-serif" textAnchor="middle" letterSpacing="2">{t.name.toUpperCase()}</text>
          <text x="294" y="70" fontSize="7.5" fill={t.textColor} opacity="0.28" fontFamily="monospace" textAnchor="middle">{card.id}</text>
          {/* Avatar */}
          <circle cx="170" cy="178" r="64" fill={`${av}28`} stroke={t.border} strokeWidth="2" opacity="0.5"/>
          <circle cx="170" cy="178" r="56" fill={av}/>
          <text x="170" y="196" fontSize="36" fontWeight="800" fill="#fff" fontFamily="'Segoe UI',system-ui,sans-serif" textAnchor="middle">{ini}</text>
          {card.rawProfile?.verified&&<><circle cx="210" cy="218" r="10" fill="#1D4ED8"/><text x="210" y="222" fontSize="10" fill="#fff" textAnchor="middle" fontWeight="700">✓</text></>}
          {/* Name */}
          <text x="170" y="272" fontSize="22" fontWeight="800" fill="#fff" fontFamily="'Segoe UI',system-ui,sans-serif" textAnchor="middle">{card.displayName}</text>
          <text x="170" y="291" fontSize="11" fill={t.textColor} opacity="0.5" fontFamily="monospace" textAnchor="middle">@{card.handle}</text>
          {card.badges?.slice(0,1).map((b,i)=>(
            <g key={i}><rect x="110" y="297" width="120" height="16" rx="5" fill={b.color} opacity="0.18"/>
            <text x="170" y="309" fontSize="9" fontWeight="700" fill={b.color} fontFamily="'Segoe UI',system-ui,sans-serif" textAnchor="middle">{b.label}</text></g>
          ))}
          {/* Stats */}
          {sk.map((k,i)=>{const xp=37+i*53; return(
            <g key={k}>
              <text x={xp} y="336" fontSize="10" fontWeight="600" fill={t.textColor} opacity="0.5" fontFamily="'Segoe UI',system-ui,sans-serif" textAnchor="middle" letterSpacing="1.2">{k}</text>
              <text x={xp} y="360" fontSize="22" fontWeight="800" fill="#fff" fontFamily="'Segoe UI',system-ui,sans-serif" textAnchor="middle">{card.stats[k]}</text>
            </g>);})}
          {/* Bottom strip */}
          <rect x="42" y="382" width="256" height="52" rx="8" fill="rgba(0,0,0,0.3)"/>
          {[{v:FMT(card.rawProfile?.followers||0),l:"Followers",x:95},{v:(m.er.toFixed(1))+"%",l:"Eng.Rate",x:170},{v:FMT(card.rawProfile?.listedCount||0),l:"Listed",x:245}].map(it=>(
            <g key={it.l}><text x={it.x} y="402" fontSize="14" fontWeight="800" fill="#fff" fontFamily="'Segoe UI',system-ui,sans-serif" textAnchor="middle">{it.v}</text>
            <text x={it.x} y="417" fontSize="7.5" fontWeight="600" fill={t.textColor} opacity="0.4" fontFamily="'Segoe UI',system-ui,sans-serif" textAnchor="middle" letterSpacing="1">{it.l.toUpperCase()}</text></g>
          ))}
          <text x="170" y="471" fontSize="9" fontWeight="700" fill={t.textColor} opacity="0.18" fontFamily="'Segoe UI',system-ui,sans-serif" textAnchor="middle" letterSpacing="3.5">CTWC 2026</text>
        </g>
        <path d={SHIELD} fill="none" stroke={`url(#br-${uid})`} strokeWidth="3.5"/>
        <path d={INNER}  fill="none" stroke={t.border} strokeWidth="0.7" opacity="0.28"/>
        {t.name==="Legendary"&&(<g clipPath={`url(#cl-${uid})`}><rect y="0" width="60" height="490" fill="rgba(255,255,255,0.08)" opacity="0.7"><animate attributeName="x" from="-60" to="400" dur="3s" repeatCount="indefinite"/></rect></g>)}
      </svg>
    </div>
  );
}

// ─── CARD REVEAL — FIFA PACK OPENING ─────────────────────────
const TIER_BADGES = {
  Common:    { icon:"⚽", label:"CT PLAYER",  bg:"#3A3D44", text:"#7B8794" },
  Rare:      { icon:"🌊", label:"CT STAR",    bg:"#152B52", text:"#3B82F6" },
  Epic:      { icon:"⚡", label:"CT ELITE",   bg:"#2D1250", text:"#A855F7" },
  Legendary: { icon:"👑", label:"CT LEGEND",  bg:"#4A3410", text:"#D4A537" },
  Mythic:    { icon:"🔥", label:"CT MYTHIC",  bg:"#3D0A0A", text:"#EF4444" },
};

function CardReveal({ card, onDone }) {
  const [phase, setPhase] = useState("pack"); // pack → rip → reveal → done
  const t = card.tier;
  const badge = TIER_BADGES[t.name] || TIER_BADGES.Common;

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
    SFX.crowd("build");                                              // stadium murmur builds
    const t1 = setTimeout(()=>{ setPhase("rip");  SFX.crowd("roar"); }, 1900);  // pack rips + crowd explodes
    const t2 = setTimeout(()=>{ setPhase("reveal"); SFX.reveal(t.name); }, 2250); // card zooms in + fanfare
    const t3 = setTimeout(()=>{ setPhase("done"); onDone?.(); }, 4600);
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
              "--dx" as any:`${p.dx}px`, "--dy" as any:`${p.dy}px`, "--rot" as any:`${p.rot}deg`,
              pointerEvents:"none",
            }}/>
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
  const av=card?aColor(card.displayName):null;
  const t=card?.tier;
  return (
    <g onClick={onClick} style={{cursor:captMode||!card?"pointer":"default"}}>
      {isSelected&&<circle cx={x} cy={y} r={r+10} fill={t?.accent||"#fff"} opacity="0.2"/>}
      {isSelected&&<circle cx={x} cy={y} r={r+7}  fill="none" stroke={t?.accent||"#fff"} strokeWidth="2" opacity="0.8" strokeDasharray="4 2"/>}
      <circle cx={x} cy={y} r={r+2} fill="rgba(0,0,0,0.3)"/>
      <circle cx={x} cy={y} r={r} fill={card?av:"rgba(255,255,255,0.04)"} stroke={card?t.border:"rgba(255,255,255,0.2)"} strokeWidth={card?2:1.5} strokeDasharray={card?"0":"5 3"}/>
      {card?(
        <>
          <text x={x} y={y-5}  fontSize="13" fontWeight="800" fill="#fff" fontFamily="'Segoe UI',system-ui,sans-serif" textAnchor="middle">{inits(card.displayName)}</text>
          <text x={x} y={y+10} fontSize="9"  fontWeight="700" fill={t.textColor} fontFamily="'Segoe UI',system-ui,sans-serif" textAnchor="middle" opacity="0.9">{card.ovr}</text>
          <rect x={x-14} y={y+r} width="28" height="13" rx="4" fill="rgba(0,0,0,0.75)"/>
          <text x={x} y={y+r+9} fontSize="7.5" fontWeight="700" fill={t.textColor} fontFamily="'Segoe UI',system-ui,sans-serif" textAnchor="middle">{ps.pos}</text>
          {isCapt&&<text x={x} y={y-r-5} fontSize="13" textAnchor="middle">👑</text>}
        </>
      ):(
        <text x={x} y={y+5} fontSize="9" fontWeight="600" fill="rgba(255,255,255,0.35)" fontFamily="'Segoe UI',system-ui,sans-serif" textAnchor="middle">{ps.pos}</text>
      )}
    </g>
  );
}

// ─── FOOTBALL PITCH ───────────────────────────────────────────
function FootballPitch({ team, myCardId, onTeamUpdate }) {
  const [captMode,  setCaptMode]  = useState(false);
  const [selected,  setSelected]  = useState(null);
  const [swapMsg,   setSwapMsg]   = useState("");

  const captainId = team.captainId;
  const isCaptain = myCardId && captainId === myCardId;
  const filled    = team.slots.filter(s=>s.card).length;

  const handleNodeClick = (slotIdx) => {
    if (!captMode) return;
    const slot = team.slots[slotIdx];
    if (selected === null) {
      if (slot.card) { SFX.click(); setSelected(slotIdx); }
    } else {
      if (slotIdx !== selected) {
        const updated = JSON.parse(JSON.stringify(team));
        const tmp = updated.slots[selected].card;
        updated.slots[selected].card = updated.slots[slotIdx].card;
        updated.slots[slotIdx].card  = tmp;
        SFX.swap();
        setSwapMsg("Swapped positions!");
        setTimeout(()=>setSwapMsg(""),2000);
        onTeamUpdate?.(updated);
      }
      setSelected(null);
    }
  };

  return (
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:12}}>
      {/* Captain toolbar */}
      <div style={{display:"flex",alignItems:"center",gap:12,height:36}}>
        {isCaptain&&(
          <button onClick={()=>{SFX.click();setCaptMode(m=>!m);setSelected(null);}} style={{padding:"6px 14px",fontSize:11,fontWeight:700,borderRadius:8,border:`1px solid ${captMode?"#FBBF24":"rgba(255,255,255,0.15)"}`,background:captMode?"rgba(212,165,55,0.15)":"transparent",color:captMode?"#FBBF24":"rgba(255,255,255,0.5)",cursor:"pointer",letterSpacing:0.5}}>
            {captMode?"✓ Swap Mode ON":"👑 Swap Positions"}
          </button>
        )}
        {captMode&&<span style={{fontSize:11,color:"rgba(255,255,255,0.4)"}}>Select two players to swap their slots</span>}
        {swapMsg&&<span style={{fontSize:11,color:"#FBBF24",fontWeight:700}}>{swapMsg}</span>}
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
            isCapt={team.slots[i].card?.id===captainId}
            isSelected={selected===i}
            captMode={captMode}
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
function Nav({ onHome, right }) {
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
function Landing({ onConnect, onPool, onTeams, onTournament, pool, teams }) {
  const [hov, setHov] = useState(false);
  const preview = useRef([createCard(MOCK_PROFILES[1],"ST"),createCard(MOCK_PROFILES[7],"CM")]).current;
  const totalSigned = teams.reduce((s,t)=>s+t.memberIds.length,0);
  const fullTeams   = teams.filter(t=>t.memberIds.length===11).length;
  return (
    <div style={{minHeight:"100vh",background:"#070B14",color:"#fff",fontFamily:"'Segoe UI',system-ui,sans-serif",position:"relative",overflow:"hidden",display:"flex",flexDirection:"column"}}>
      <div style={{position:"absolute",inset:0,pointerEvents:"none"}}>
        <div style={{position:"absolute",top:-180,right:-80,width:480,height:480,borderRadius:"50%",background:"radial-gradient(circle,rgba(59,130,246,0.055) 0%,transparent 70%)"}}/>
        <div style={{position:"absolute",bottom:-120,left:-100,width:380,height:380,borderRadius:"50%",background:"radial-gradient(circle,rgba(168,85,247,0.045) 0%,transparent 70%)"}}/>
        <div style={{position:"absolute",inset:0,opacity:0.022,backgroundImage:"linear-gradient(rgba(255,255,255,0.08) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.08) 1px,transparent 1px)",backgroundSize:"52px 52px"}}/>
      </div>
      <header style={{padding:"18px 28px",display:"flex",justifyContent:"space-between",alignItems:"center",borderBottom:"1px solid rgba(255,255,255,0.05)",position:"relative",zIndex:10}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{width:32,height:32,borderRadius:8,background:"linear-gradient(135deg,#D4A537,#FBBF24)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:900,color:"#1a1a1a"}}>CT</div>
          <span style={{fontSize:18,fontWeight:800,letterSpacing:1}}>CT<span style={{color:"#FBBF24"}}>WC</span></span>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
          <button onClick={onPool}       style={{background:"transparent",border:"1px solid rgba(255,255,255,0.1)",color:"rgba(255,255,255,0.6)",borderRadius:7,padding:"7px 14px",cursor:"pointer",fontSize:12,fontWeight:600}}>Pool ({pool.length})</button>
          <button onClick={onTeams}      style={{background:"transparent",border:"1px solid rgba(255,255,255,0.1)",color:"rgba(255,255,255,0.6)",borderRadius:7,padding:"7px 14px",cursor:"pointer",fontSize:12,fontWeight:600}}>Teams</button>
          <button onClick={onTournament} style={{background:"rgba(212,165,55,0.1)",border:"1px solid rgba(212,165,55,0.25)",color:"#FBBF24",borderRadius:7,padding:"7px 14px",cursor:"pointer",fontSize:12,fontWeight:700}}>🏆 Tournament</button>
        </div>
      </header>
      <main style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",padding:"28px",position:"relative",zIndex:10}}>
        <div style={{display:"flex",alignItems:"center",gap:64,maxWidth:1060,width:"100%",flexWrap:"wrap",justifyContent:"center"}}>
          <div style={{flex:"1 1 360px",maxWidth:490}}>
            <div style={{display:"inline-block",padding:"5px 13px",borderRadius:20,background:"rgba(212,165,55,0.1)",border:"1px solid rgba(212,165,55,0.18)",fontSize:10,fontWeight:700,color:"#FBBF24",marginBottom:20,letterSpacing:1.5}}>SEASON 1 — REGISTRATION OPEN</div>
            <h1 style={{fontSize:46,fontWeight:900,lineHeight:1.07,margin:0,letterSpacing:-1}}>Crypto Twitter.<br/><span style={{background:"linear-gradient(90deg,#FBBF24,#D4A537,#F59E0B)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"}}>World Cup Cards.</span></h1>
            <p style={{fontSize:15,color:"rgba(255,255,255,0.48)",lineHeight:1.68,margin:"20px 0 30px",maxWidth:410}}>Claim your card. Join one of 32 teams. 400 spots total. Tournament kicks off when registration closes.</p>
            <button onClick={()=>{SFX.click();onConnect();}} onMouseEnter={()=>setHov(true)} onMouseLeave={()=>setHov(false)} style={{padding:"14px 32px",fontSize:14,fontWeight:700,color:"#1a1a1a",background:hov?"linear-gradient(135deg,#F59E0B,#D4A537)":"linear-gradient(135deg,#FBBF24,#D4A537)",border:"none",borderRadius:10,cursor:"pointer",boxShadow:hov?"0 0 26px rgba(212,165,55,0.45)":"0 4px 14px rgba(212,165,55,0.22)",transition:"all 0.3s",display:"flex",alignItems:"center",gap:9}}>
              <span style={{fontSize:17}}>𝕏</span> Connect & Claim Your Card
            </button>
            {/* Live stats */}
            <div style={{display:"flex",gap:24,marginTop:32,flexWrap:"wrap"}}>
              {[
                {v:pool.length, l:"Cards Claimed"},
                {v:`${totalSigned}/${teams.length*11}`, l:"Spots Filled"},
                {v:`${fullTeams}/32`, l:"Full Squads"},
              ].map(s=>(
                <div key={s.l}><div style={{fontSize:19,fontWeight:800,color:"#fff"}}>{s.v}</div><div style={{fontSize:10,color:"rgba(255,255,255,0.32)",letterSpacing:1.2,textTransform:"uppercase"}}>{s.l}</div></div>
              ))}
            </div>
            {/* Pool fill bar */}
            <div style={{marginTop:18,maxWidth:340}}>
              <div style={{height:3,background:"rgba(255,255,255,0.06)",borderRadius:2,overflow:"hidden"}}>
                <div style={{height:"100%",width:`${Math.min((pool.length/POOL_CAP)*100,100)}%`,background:"linear-gradient(90deg,#9945FF,#FBBF24)",borderRadius:2,transition:"width 0.5s"}}/>
              </div>
              <div style={{fontSize:9,color:"rgba(255,255,255,0.25)",marginTop:4,letterSpacing:1}}>{POOL_CAP - pool.length} OF {POOL_CAP} SPOTS REMAINING</div>
            </div>
          </div>
          <div style={{flex:"0 0 auto",position:"relative",height:340,width:280}}>
            <div style={{position:"absolute",top:28,left:-18,transform:"rotate(-7deg)",zIndex:1}}><ShieldCard card={preview[0]} size="small"/></div>
            <div style={{position:"absolute",top:0,left:68,transform:"rotate(4deg)",zIndex:2}}><ShieldCard card={preview[1]} size="small"/></div>
          </div>
        </div>
      </main>
      {/* 32 teams scroll strip */}
      <div style={{padding:"14px 0",borderTop:"1px solid rgba(255,255,255,0.05)",overflowX:"auto",position:"relative",zIndex:10}}>
        <div style={{display:"flex",gap:10,paddingLeft:24,paddingRight:24,width:"max-content"}}>
          {teams.map(t=>(
            <div key={t.id} onClick={onTournament} style={{display:"flex",alignItems:"center",gap:7,padding:"6px 12px",borderRadius:8,background:`${t.color}10`,border:`1px solid ${t.color}20`,cursor:"pointer",flexShrink:0,transition:"background 0.2s"}}
              onMouseEnter={e=>e.currentTarget.style.background=`${t.color}20`}
              onMouseLeave={e=>e.currentTarget.style.background=`${t.color}10`}>
              <EmblemImg team={t} size={14} />
              <span style={{fontSize:10,fontWeight:700,color:t.color,whiteSpace:"nowrap"}}>{t.name}</span>
              <span style={{fontSize:9,color:"rgba(255,255,255,0.25)"}}>{t.memberIds.length}/11</span>
            </div>
          ))}
        </div>
      </div>
      <div style={{padding:"12px 28px",borderTop:"1px solid rgba(255,255,255,0.04)",display:"flex",justifyContent:"center",gap:28,position:"relative",zIndex:10}}>
        {Object.values(TIERS).map(t=>(
          <div key={t.name} style={{display:"flex",alignItems:"center",gap:6}}>
            <div style={{width:8,height:8,borderRadius:"50%",background:t.border,boxShadow:`0 0 5px ${t.glow}`}}/>
            <span style={{fontSize:9,fontWeight:600,color:"rgba(255,255,255,0.4)",letterSpacing:1.5,textTransform:"uppercase"}}>{t.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── CONNECT PAGE ─────────────────────────────────────────────
function ConnectPage({ onClaim, onBack, claimed }) {
  const [step,setStep]=useState("select"),[profile,setProfile]=useState(null),[handle,setHandle]=useState(""),[err,setErr]=useState("");
  const attempt=(p)=>{setErr("");if(claimed.has(p.handle.toLowerCase())){setErr(`@${p.handle} has already claimed a card!`);return;}setProfile(p);setStep("loading");setTimeout(()=>setStep("preview"),2000);};
  const custom=()=>{const h=handle.replace("@","").trim();if(!h)return;if(claimed.has(h.toLowerCase())){setErr(`@${h} already claimed!`);return;}attempt({handle:h,displayName:h,followers:Math.floor(Math.random()*150000)+800,following:Math.floor(Math.random()*3000)+80,tweetCount:Math.floor(Math.random()*20000)+400,listedCount:Math.floor(Math.random()*1500)+10,accountAgeDays:Math.floor(Math.random()*3500)+180,verified:Math.random()>0.85,avgImpressions:Math.floor(Math.random()*40000)+500,avgLikes:Math.floor(Math.random()*1500)+20,avgRetweets:Math.floor(Math.random()*400)+5,avgQuotes:Math.floor(Math.random()*100)+2,avgReplies:Math.floor(Math.random()*250)+8,avgBookmarks:Math.floor(Math.random()*500)+10});};
  return (
    <div style={{minHeight:"100vh",background:"#070B14",color:"#fff",fontFamily:"'Segoe UI',system-ui,sans-serif"}}>
      <Nav onHome={onBack} right={<span style={{fontSize:11,color:"rgba(255,255,255,0.3)"}}>One card per account</span>}/>
      <div style={{maxWidth:620,margin:"0 auto",padding:"36px 20px"}}>
        {step==="select"&&(<>
          <h2 style={{fontSize:26,fontWeight:800,margin:"0 0 6px"}}>Connect Your 𝕏 Account</h2>
          <p style={{color:"rgba(255,255,255,0.4)",margin:"0 0 10px",fontSize:13}}>One account · one card · locked forever.</p>
          <div style={{padding:"9px 14px",borderRadius:8,background:"rgba(212,165,55,0.08)",border:"1px solid rgba(212,165,55,0.15)",fontSize:11,color:"#FBBF24",marginBottom:24,fontWeight:600}}>📡 Demo mode — in production this uses X OAuth + API v2 metric pull.</div>
          <div style={{display:"flex",gap:9,marginBottom:err?8:22}}>
            <input value={handle} onChange={e=>{setHandle(e.target.value);setErr("");}} onKeyDown={e=>e.key==="Enter"&&custom()} placeholder="Enter your @handle..." style={{flex:1,padding:"12px 15px",fontSize:13,borderRadius:9,background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.1)",color:"#fff",outline:"none",fontFamily:"monospace"}}/>
            <button onClick={custom} style={{padding:"12px 20px",fontSize:12,fontWeight:700,borderRadius:9,background:"linear-gradient(135deg,#D4A537,#FBBF24)",border:"none",color:"#1a1a1a",cursor:"pointer"}}>Claim</button>
          </div>
          {err&&<div style={{fontSize:12,color:"#F87171",marginBottom:16,padding:"8px 12px",background:"rgba(239,68,68,0.08)",borderRadius:7,border:"1px solid rgba(239,68,68,0.15)"}}>{err}</div>}
          <div style={{fontSize:10,color:"rgba(255,255,255,0.2)",marginBottom:10,letterSpacing:1.2,textTransform:"uppercase"}}>Demo profiles</div>
          <div style={{display:"flex",flexDirection:"column",gap:5}}>
            {MOCK_PROFILES.map(p=>{
              const ovr=computeOVR(p),t=getTier(ovr),m=computeMetrics(p),isC=claimed.has(p.handle.toLowerCase());
              return(<button key={p.handle} onClick={()=>!isC&&attempt(p)} style={{display:"flex",alignItems:"center",gap:12,padding:"11px 14px",background:isC?"rgba(255,255,255,0.01)":"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.06)",borderRadius:9,cursor:isC?"not-allowed":"pointer",color:"#fff",textAlign:"left",opacity:isC?0.45:1,width:"100%",transition:"all 0.2s"}}
                onMouseEnter={e=>{if(!isC){e.currentTarget.style.background="rgba(255,255,255,0.05)";e.currentTarget.style.borderColor=`${t.border}44`;}}}
                onMouseLeave={e=>{e.currentTarget.style.background=isC?"rgba(255,255,255,0.01)":"rgba(255,255,255,0.02)";e.currentTarget.style.borderColor="rgba(255,255,255,0.06)";}}>
                <div style={{width:32,height:32,borderRadius:"50%",background:`linear-gradient(135deg,${t.border},${t.accent})`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:800,color:"#fff",flexShrink:0}}>{inits(p.displayName)}</div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontWeight:700,fontSize:13}}>{p.displayName}{p.verified&&<span style={{color:"#60A5FA",fontSize:10,marginLeft:4}}>✓</span>}</div>
                  <div style={{fontSize:10,color:"rgba(255,255,255,0.3)",fontFamily:"monospace"}}>@{p.handle}</div>
                </div>
                <div style={{textAlign:"right",flexShrink:0}}><div style={{fontSize:12,fontWeight:700}}>{FMT(p.followers)}</div><div style={{fontSize:8,color:"rgba(255,255,255,0.3)"}}>followers</div></div>
                <div style={{fontSize:11,fontWeight:700,color:"rgba(255,255,255,0.35)",minWidth:40,textAlign:"right"}}>{m.er.toFixed(1)}%</div>
                <div style={{padding:"3px 8px",borderRadius:5,fontSize:9,fontWeight:700,background:`${t.border}1A`,color:isC?"rgba(255,255,255,0.3)":t.accent,border:`1px solid ${t.border}2A`,flexShrink:0}}>{isC?"Claimed":t.name}</div>
              </button>);
            })}
          </div>
        </>)}
        {step==="loading"&&<div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",minHeight:340}}><div style={{width:46,height:46,borderRadius:"50%",border:"3px solid rgba(212,165,55,0.12)",borderTopColor:"#FBBF24",animation:"spin 1s linear infinite"}}/><p style={{marginTop:20,fontSize:14,fontWeight:600,color:"rgba(255,255,255,0.55)"}}>Pulling metrics for @{profile?.handle}…</p><p style={{fontSize:11,color:"rgba(255,255,255,0.3)"}}>Followers · ER · Virality · Listed count…</p></div>}
        {step==="preview"&&profile&&(()=>{const m=computeMetrics(profile),ovr=computeOVR(profile),t=getTier(ovr);return(
          <div style={{textAlign:"center"}}>
            <h2 style={{fontSize:20,fontWeight:800,margin:"0 0 5px"}}>Stats Locked In</h2>
            <p style={{color:"rgba(255,255,255,0.4)",margin:"0 0 22px",fontSize:13}}>Frozen at mint — your card reflects these metrics.</p>
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:9,background:"rgba(255,255,255,0.03)",borderRadius:12,padding:20,border:"1px solid rgba(255,255,255,0.05)",maxWidth:420,margin:"0 auto 20px"}}>
              {[{l:"Followers",v:FMT(profile.followers)},{l:"Eng. Rate",v:m.er.toFixed(1)+"%"},{l:"Listed",v:FMT(profile.listedCount)},{l:"Virality",v:m.vir.toFixed(2)+"%"},{l:"Activity",v:m.freq.toFixed(1)+"/d"},{l:"OVR",v:ovr}].map(i=>(<div key={i.l}><div style={{fontSize:19,fontWeight:800,color:i.l==="OVR"?t.accent:"#fff"}}>{i.v}</div><div style={{fontSize:8,color:"rgba(255,255,255,0.32)",letterSpacing:1,textTransform:"uppercase"}}>{i.l}</div></div>))}
            </div>
            <div style={{display:"inline-block",padding:"4px 12px",borderRadius:6,background:`${t.border}20`,color:t.accent,border:`1px solid ${t.border}30`,fontSize:11,fontWeight:700,marginBottom:20}}>Projected Tier: {t.name}</div><br/>
            <button onClick={()=>{SFX.click();onClaim(profile);}} style={{padding:"14px 42px",fontSize:14,fontWeight:700,color:"#1a1a1a",background:"linear-gradient(135deg,#FBBF24,#D4A537)",border:"none",borderRadius:10,cursor:"pointer",boxShadow:"0 4px 16px rgba(212,165,55,0.28)"}}>Mint My CTWC Card</button>
          </div>);})()}
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
    let t=makeTeam(name.trim(),color,emblem);
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
function BrowseTeamsPage({ card, teams, onJoined, onBack }) {
  const [joining, setJoining] = useState(null);
  const [search, setSearch]   = useState("");
  const [filter, setFilter]   = useState("open"); // "open" | "all"

  const myTeam = card ? teams.find(t=>t.memberIds.includes(card.id)) : null;

  const visible = teams
    .filter(t => filter==="all" || t.memberIds.length < 11)
    .filter(t => !search || t.name.toLowerCase().includes(search.toLowerCase()));

  const join = (team) => {
    if (team.memberIds.length >= 11) return;
    SFX.click();
    setJoining(team.id);
    setTimeout(() => {
      const updated = addCardToTeam(team, card);
      SFX.success();
      onJoined(updated);
    }, 900);
  };

  const totalFilled  = teams.reduce((s,t)=>s+t.memberIds.length,0);
  const totalSlots   = teams.length * 11;

  return (
    <div style={{minHeight:"100vh",background:"#070B14",color:"#fff",fontFamily:"'Segoe UI',system-ui,sans-serif"}}>
      <Nav onHome={onBack}/>

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
                    <button onClick={()=>!isJoining&&join(team)} style={{width:"100%",padding:"9px",fontSize:12,fontWeight:700,color:isJoining?"#1a1a1a":"#fff",background:isJoining?`linear-gradient(135deg,${team.color},${team.color}aa)`:"rgba(255,255,255,0.05)",border:`1px solid ${team.color}40`,borderRadius:8,cursor:"pointer",transition:"all 0.25s"}}
                      onMouseEnter={e=>{e.currentTarget.style.background=`${team.color}22`;}}
                      onMouseLeave={e=>{e.currentTarget.style.background=isJoining?`linear-gradient(135deg,${team.color},${team.color}aa)`:"rgba(255,255,255,0.05)";}}>
                      {isJoining?"Joining…":"Join Team"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
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
        <div onClick={()=>setExpandCard(null)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.88)",backdropFilter:"blur(14px)",zIndex:100,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer"}}>
          <ShieldCard card={expandCard} size="large"/>
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
            <FootballPitch team={team} myCardId={myCardId} onTeamUpdate={onTeamUpdate}/>
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
                    <div style={{width:26,height:26,borderRadius:6,background:c?aColor(c.displayName):"rgba(255,255,255,0.04)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,fontWeight:800,color:c?"#fff":"rgba(255,255,255,0.2)",flexShrink:0}}>{c?inits(c.displayName):ps.pos}</div>
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

// ─── PLAYER POOL ─────────────────────────────────────────────
function PlayerPool({ pool, onBack, onClaim }) {
  const [filter,setFilter]=useState("All"), [selected,setSelected]=useState(null);
  const tierNames=["All","Legendary","Epic","Rare","Common"];
  const visible=filter==="All"?pool:pool.filter(c=>c.tier.name===filter);
  const counts={};Object.values(TIERS).forEach(t=>{counts[t.name]=pool.filter(c=>c.tier.name===t.name).length;});
  return (
    <div style={{minHeight:"100vh",background:"#070B14",color:"#fff",fontFamily:"'Segoe UI',system-ui,sans-serif"}}>
      {selected&&<div onClick={()=>setSelected(null)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.88)",backdropFilter:"blur(14px)",zIndex:100,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer"}}><ShieldCard card={selected} size="large"/></div>}
      <Nav onHome={onBack} right={<button onClick={onClaim} style={{padding:"7px 14px",fontSize:11,fontWeight:700,borderRadius:7,background:"linear-gradient(135deg,#D4A537,#FBBF24)",border:"none",color:"#1a1a1a",cursor:"pointer"}}>+ Claim Card</button>}/>
      <div style={{padding:"8px 24px",borderBottom:"1px solid rgba(255,255,255,0.04)",display:"flex",gap:20,overflowX:"auto"}}>
        {Object.values(TIERS).map(t=><div key={t.name} style={{display:"flex",alignItems:"center",gap:6,flexShrink:0}}><div style={{width:7,height:7,borderRadius:"50%",background:t.border}}/><span style={{fontSize:10,color:t.accent,fontWeight:700}}>{t.name}</span><span style={{fontSize:10,color:"rgba(255,255,255,0.25)"}}>{counts[t.name]||0}</span></div>)}
      </div>
      <div style={{maxWidth:1100,margin:"0 auto",padding:"22px 20px"}}>
        <div style={{display:"flex",gap:6,marginBottom:20,flexWrap:"wrap"}}>
          {tierNames.map(name=>{const t=Object.values(TIERS).find(x=>x.name===name);return(<button key={name} onClick={()=>setFilter(name)} style={{padding:"6px 14px",fontSize:11,fontWeight:700,borderRadius:16,cursor:"pointer",background:filter===name?(t?`${t.border}30`:"rgba(255,255,255,0.1)"):"transparent",border:`1px solid ${filter===name?(t?t.border:"rgba(255,255,255,0.2)"):"rgba(255,255,255,0.07)"}`,color:filter===name?(t?t.accent:"#fff"):"rgba(255,255,255,0.4)"}}>
            {name}{name!=="All"&&` (${counts[name]||0})`}</button>);})}
        </div>
        {visible.length===0?(<div style={{textAlign:"center",padding:"70px 0"}}><p style={{fontSize:14,color:"rgba(255,255,255,0.3)"}}>No cards yet</p><button onClick={onClaim} style={{marginTop:12,padding:"11px 24px",fontSize:13,fontWeight:700,borderRadius:9,background:"linear-gradient(135deg,#D4A537,#FBBF24)",border:"none",color:"#1a1a1a",cursor:"pointer"}}>Be the First</button></div>)
        :(<div style={{display:"flex",flexWrap:"wrap",gap:18}}>{visible.map(card=><ShieldCard key={card.id} card={card} size="small" onClick={()=>setSelected(card)}/>)}</div>)}
      </div>
    </div>
  );
}

// ─── TEAMS LIST ───────────────────────────────────────────────
function TeamsListPage({ teams, onBack, onViewTeam, onClaim }) {
  return (
    <div style={{minHeight:"100vh",background:"#070B14",color:"#fff",fontFamily:"'Segoe UI',system-ui,sans-serif"}}>
      <Nav onHome={onBack} right={<button onClick={onClaim} style={{padding:"7px 14px",fontSize:11,fontWeight:700,borderRadius:7,background:"linear-gradient(135deg,#D4A537,#FBBF24)",border:"none",color:"#1a1a1a",cursor:"pointer"}}>+ Claim Card</button>}/>
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

// ─── TOURNAMENT PAGE — 32-team bracket ───────────────────────
function TournamentPage({ teams, onBack, onBrowse, onBracket }) {
  const totalFilled = teams.reduce((s,t)=>s+t.memberIds.length,0);
  const totalSlots  = teams.length * 11;
  const fullTeams   = teams.filter(t=>t.memberIds.length===11).length;

  // Build bracket pairs (seeded by slot index for now — randomised at deadline)
  const rounds = ["Round of 32","Round of 16","Quarter Finals","Semi Finals","Final"];
  const bracket = Array.from({length:16},(_,i)=>({
    home: teams[i*2]   || null,
    away: teams[i*2+1] || null,
  }));

  return (
    <div style={{minHeight:"100vh",background:"#070B14",color:"#fff",fontFamily:"'Segoe UI',system-ui,sans-serif"}}>
      <Nav onHome={onBack}/>

      {/* Hero */}
      <div style={{background:"linear-gradient(180deg,rgba(212,165,55,0.08) 0%,transparent 100%)",borderBottom:"1px solid rgba(212,165,55,0.12)",padding:"32px 24px 28px",textAlign:"center"}}>
        <div style={{fontSize:40,marginBottom:8}}>🏆</div>
        <h1 style={{fontSize:28,fontWeight:900,margin:"0 0 6px",letterSpacing:-0.5}}>CT World Cup 2026</h1>
        <p style={{color:"rgba(255,255,255,0.45)",fontSize:14,margin:"0 0 20px"}}>32 teams · 400 players · Single elimination</p>

        {/* Status pills */}
        <div style={{display:"flex",gap:12,justifyContent:"center",flexWrap:"wrap",marginBottom:20}}>
          {[
            {label:"Registration",value:"OPEN",color:"#22C55E"},
            {label:"Players Signed",value:`${totalFilled} / ${totalSlots}`,color:"#FBBF24"},
            {label:"Full Squads",value:`${fullTeams} / 32`,color:"#A855F7"},
            {label:"Deadline",value:"TBA via CT",color:"#60A5FA"},
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
          <button onClick={onBrowse} style={{padding:"11px 28px",fontSize:13,fontWeight:700,background:"linear-gradient(135deg,#FBBF24,#D4A537)",border:"none",borderRadius:10,color:"#1a1a1a",cursor:"pointer",boxShadow:"0 4px 16px rgba(212,165,55,0.3)"}}>
            📋 Join a Team
          </button>
          <button onClick={onBracket} style={{padding:"11px 28px",fontSize:13,fontWeight:700,background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.15)",borderRadius:10,color:"#fff",cursor:"pointer"}}>
            🗺️ View Full Bracket
          </button>
        </div>
      </div>

      {/* Round headers */}
      <div style={{maxWidth:900,margin:"0 auto",padding:"24px 20px"}}>
        <div style={{display:"flex",gap:6,marginBottom:20,overflowX:"auto",paddingBottom:4}}>
          {rounds.map((r,i)=>(
            <div key={r} style={{flexShrink:0,padding:"6px 14px",borderRadius:8,background:i===0?"rgba(212,165,55,0.12)":"rgba(255,255,255,0.03)",border:i===0?"1px solid rgba(212,165,55,0.3)":"1px solid rgba(255,255,255,0.07)",fontSize:11,fontWeight:700,color:i===0?"#FBBF24":"rgba(255,255,255,0.35)",letterSpacing:0.5}}>
              {r}
            </div>
          ))}
        </div>

        {/* Bracket grid — Round of 32 pairs */}
        <div style={{marginBottom:12}}>
          <div style={{fontSize:11,fontWeight:700,color:"rgba(255,255,255,0.35)",letterSpacing:1.5,textTransform:"uppercase",marginBottom:12}}>Round of 32 — Match Pairs</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(240px,1fr))",gap:10}}>
            {bracket.map((m,i)=>(
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
        </div>

        {/* Later rounds — locked */}
        {["Round of 16","Quarter Finals","Semi Finals","Final"].map(r=>(
          <div key={r} style={{marginTop:24,padding:"18px 20px",borderRadius:12,background:"rgba(255,255,255,0.02)",border:"1px dashed rgba(255,255,255,0.07)",textAlign:"center"}}>
            <div style={{fontSize:18,marginBottom:6}}>🔒</div>
            <div style={{fontSize:13,fontWeight:700,color:"rgba(255,255,255,0.3)"}}>{r}</div>
            <div style={{fontSize:11,color:"rgba(255,255,255,0.2)",marginTop:4}}>Unlocks after registration closes</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── BRACKET PAGE — SVG tournament map ───────────────────────
function BracketPage({ teams, onBack }) {
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

  // ── Helpers ───────────────────────────────────────────────
  const Slot = ({x, y, team, gold=false}) => (
    <g>
      <rect x={x} y={y} width={SLW} height={SLH} rx={4}
        fill={team ? `${team.color}20` : gold ? "rgba(212,165,55,0.08)" : "rgba(255,255,255,0.06)"}
        stroke={team ? team.color+"70" : gold ? "rgba(212,165,55,0.35)" : "rgba(255,255,255,0.14)"}
        strokeWidth={team ? 1 : 0.6}/>
      {team ? <>
        {team.logoImg
          ? <image href={team.logoImg} x={x+3} y={y+2} width={SLH-4} height={SLH-4}/>
          : <text x={x+5}  y={y+SLH/2} dominantBaseline="middle" fontSize={13}>{team.emblem}</text>
        }
        <text x={x+22} y={y+SLH/2} dominantBaseline="middle" fontFamily="'Segoe UI',system-ui,sans-serif"
          fontSize={8.5} fontWeight={700} fill="#fff">
          {team.name.length>15 ? team.name.slice(0,15)+"…" : team.name}
        </text>
        <text x={x+SLW-4} y={y+SLH/2} dominantBaseline="middle" textAnchor="end"
          fontFamily="'Segoe UI',system-ui,sans-serif" fontSize={7} fill={team.color}>{team.memberIds.length}/11</text>
      </> : <>
        <text x={x+SLW/2} y={y+SLH/2} dominantBaseline="middle" textAnchor="middle"
          fontFamily="'Segoe UI',system-ui,sans-serif" fontSize={7.5} fill={gold?"rgba(212,165,55,0.4)":"rgba(255,255,255,0.2)"}>
          {gold ? "TBD" : "TBD"}
        </text>
      </>}
    </g>
  );

  const Match = ({x, top, t1, t2, gold=false}) => (
    <g>
      <Slot x={x} y={top}        team={t1} gold={gold}/>
      <Slot x={x} y={top+SLH+MG} team={t2} gold={gold}/>
    </g>
  );

  // Left bracket connectors: right side exits, left side entries
  const LConn = ({r, fromC, toC}) => {
    const mx=lMid(r), x0=Lx[r]+SLW, x1=Lx[r+1];
    return fromC.reduce((acc,_,i) => {
      if (i%2!==0) return acc;
      const c0=fromC[i], c1=fromC[i+1], tc=toC[i/2];
      acc.push(<path key={i} d={`M${x0},${c0} H${mx} V${c1} M${x0},${c1} H${mx} M${mx},${tc} H${x1}`}
        fill="none" stroke={LC} strokeWidth={1}/>);
      return acc;
    },[]);
  };

  // Right bracket connectors: left side exits, right side entries
  const RConn = ({r, fromC, toC}) => {
    const mx=rMid(r), x0=Rx[r], x1=Rx[r+1]+SLW;
    return fromC.reduce((acc,_,i) => {
      if (i%2!==0) return acc;
      const c0=fromC[i], c1=fromC[i+1], tc=toC[i/2];
      acc.push(<path key={i} d={`M${x0},${c0} H${mx} V${c1} M${x0},${c1} H${mx} M${mx},${tc} H${x1}`}
        fill="none" stroke={LC} strokeWidth={1}/>);
      return acc;
    },[]);
  };

  const L = teams.slice(0,16);   // left half
  const R = teams.slice(16,32);  // right half

  return (
    <div style={{minHeight:"100vh",background:"#070B14",color:"#fff",fontFamily:"'Segoe UI',system-ui,sans-serif"}}>
      <Nav onHome={onBack}/>
      <div style={{padding:"16px 20px 40px"}}>
        <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:14}}>
          <h2 style={{fontSize:20,fontWeight:900,margin:0}}>🏆 CT World Cup 2026 — Full Bracket</h2>
          <span style={{fontSize:10,padding:"3px 10px",borderRadius:6,background:"rgba(34,197,94,0.1)",border:"1px solid rgba(34,197,94,0.25)",color:"#22C55E",fontWeight:700,letterSpacing:1}}>REGISTRATION OPEN</span>
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
            {/* Pitch stripes */}
            {Array.from({length:14},(_,i)=>(
              <rect key={i} x={i*(SW/14)} y={0} width={SW/28} height={SH} fill="rgba(255,255,255,0.016)"/>
            ))}
            {/* Perspective lines from centre */}
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

            {/* ── Trophy & labels ── */}
            <text x={SW/2} y={28} textAnchor="middle" fontSize={30}>🏆</text>
            <text x={SW/2} y={52} textAnchor="middle" fontFamily="'Segoe UI',system-ui"
              fontSize={9} fontWeight={900} fill="#FBBF24" letterSpacing={4}>WINNER</text>
            {/* Line from final winner slot up to trophy */}
            <line x1={FX+SLW/2} y1={finT} x2={SW/2} y2={56}
              stroke={GC} strokeWidth={1.5} strokeDasharray="5 3"/>
            <text x={SW/2} y={finT+UNIT+11} textAnchor="middle"
              fontFamily="'Segoe UI',system-ui" fontSize={8.5} fontWeight={800}
              fill="rgba(212,165,55,0.7)" letterSpacing={2}>FINAL</text>
            <text x={SW/2} y={trdT+UNIT+11} textAnchor="middle"
              fontFamily="'Segoe UI',system-ui" fontSize={7.5} fontWeight={700}
              fill="rgba(255,255,255,0.35)" letterSpacing={1.5}>3rd Place</text>

            {/* ══ LEFT BRACKET ══ */}
            {/* R32 */}
            {Array.from({length:8},(_,i)=>(
              <Match key={i} x={Lx[0]} top={r32T[i]} t1={L[i*2]||null} t2={L[i*2+1]||null}/>
            ))}
            <LConn r={0} fromC={r32C} toC={r16C}/>

            {/* R16 */}
            {Array.from({length:4},(_,i)=>(
              <Match key={i} x={Lx[1]} top={r16T[i]} t1={null} t2={null}/>
            ))}
            <LConn r={1} fromC={r16C} toC={qfC}/>

            {/* QF */}
            {Array.from({length:2},(_,i)=>(
              <Match key={i} x={Lx[2]} top={qfT[i]} t1={null} t2={null}/>
            ))}
            <LConn r={2} fromC={qfC} toC={[sfC]}/>

            {/* SF */}
            <Match x={Lx[3]} top={sfT} t1={null} t2={null}/>
            {/* SF → Final */}
            <path d={`M${Lx[3]+SLW},${sfC} H${FX}`} fill="none" stroke={GC} strokeWidth={1.5}/>

            {/* ══ RIGHT BRACKET ══ */}
            {/* R32 */}
            {Array.from({length:8},(_,i)=>(
              <Match key={i} x={Rx[0]} top={r32T[i]} t1={R[i*2]||null} t2={R[i*2+1]||null}/>
            ))}
            <RConn r={0} fromC={r32C} toC={r16C}/>

            {/* R16 */}
            {Array.from({length:4},(_,i)=>(
              <Match key={i} x={Rx[1]} top={r16T[i]} t1={null} t2={null}/>
            ))}
            <RConn r={1} fromC={r16C} toC={qfC}/>

            {/* QF */}
            {Array.from({length:2},(_,i)=>(
              <Match key={i} x={Rx[2]} top={qfT[i]} t1={null} t2={null}/>
            ))}
            <RConn r={2} fromC={qfC} toC={[sfC]}/>

            {/* SF */}
            <Match x={Rx[3]} top={sfT} t1={null} t2={null}/>
            {/* SF → Final */}
            <path d={`M${Rx[3]},${sfC} H${FX+SLW}`} fill="none" stroke={GC} strokeWidth={1.5}/>

            {/* ══ FINAL ══ */}
            <Match x={FX} top={finT} t1={null} t2={null} gold={true}/>

            {/* ══ 3RD PLACE ══ */}
            <Match x={FX} top={trdT} t1={null} t2={null}/>

          </svg>
        </div>
        {/* Legend */}
        <div style={{display:"flex",gap:20,marginTop:14,flexWrap:"wrap"}}>
          {[{c:LC,l:"Round connector"},{c:GC,l:"Final path"},{c:"rgba(34,197,94,0.7)",l:"Full squad"}].map(({c,l})=>(
            <div key={l} style={{display:"flex",alignItems:"center",gap:6}}>
              <div style={{width:18,height:2,background:c,borderRadius:1}}/>
              <span style={{fontSize:10,color:"rgba(255,255,255,0.35)"}}>{l}</span>
            </div>
          ))}
          <span style={{fontSize:10,color:"rgba(255,255,255,0.25)",marginLeft:"auto"}}>
            Bracket seeded at registration deadline — announced via CT
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

  const supabase = createClient();

  // ── Load data from Supabase ──────────────────────────────────
  const loadData = async () => {
    const [{ data: teamsData }, { data: cardsData }] = await Promise.all([
      supabase.from("teams").select("*").order("name"),
      supabase.from("cards").select("*"),
    ]);
    if (teamsData && cardsData) {
      setTeams(teamsData.map((t: any) => transformTeam(t, cardsData)));
      setPool(cardsData.filter((c: any) => !c.team_id).map(transformCard));
      setClaimed(new Set(cardsData.map((c: any) => c.x_handle)));
    }
    setLoading(false);
  };

  useEffect(() => { loadData(); }, []);

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
      setPage("reveal");
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
  const handleJoinedTeam = async (team: any) => {
    if (!pending) return;
    const res = await fetch("/api/join-team", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ card_id: pending.id, team_id: team.id }),
    });
    if (res.ok) {
      await loadData();
      setViewTeamId(team.id);
      setPage("teamPage");
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

      {page==="landing"     && <Landing onConnect={()=>setPage("connect")} onPool={()=>setPage("pool")} onTeams={()=>setPage("teamsList")} onTournament={()=>setPage("tournament")} pool={pool} teams={teams}/>}
      {page==="connect"     && <ConnectPage onClaim={handleClaim} onBack={()=>setPage("landing")} claimed={claimed} loading={mintLoading}/>}
      {page==="reveal"      && pending && (
        <div style={{minHeight:"100vh",background:"#070B14",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",fontFamily:"'Segoe UI',system-ui,sans-serif"}}>
          <CardReveal card={pending} onDone={afterReveal}/>
          <div style={{marginTop:24,display:"flex",gap:10}}>
            <button onClick={()=>setPage("connect")} style={{padding:"9px 20px",fontSize:12,fontWeight:600,borderRadius:8,background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.08)",color:"#fff",cursor:"pointer"}}>Claim Another</button>
            <button onClick={afterReveal} style={{padding:"9px 20px",fontSize:12,fontWeight:600,borderRadius:8,background:"linear-gradient(135deg,#D4A537,#FBBF24)",border:"none",color:"#1a1a1a",cursor:"pointer"}}>Continue →</button>
          </div>
        </div>
      )}
      {page==="teamSetup"   && pending && <TeamSetupPage card={pending} onBrowseTeams={()=>setPage("browseTeams")} onSkip={()=>setPage("pool")}/>}
      {page==="createTeam"  && pending && <CreateTeamPage card={pending} onCreated={handleCreatedTeam} onBack={()=>setPage("browseTeams")}/>}
      {page==="browseTeams" && <BrowseTeamsPage card={pending} teams={teams} onJoined={handleJoinedTeam} onBack={()=>pending?setPage("teamSetup"):setPage("landing")}/>}
      {page==="teamPage"    && viewTeam && <TeamPage team={viewTeam} myCardId={myCardId} onTeamUpdate={handleTeamUpdate} onBack={()=>setPage("landing")} onPool={()=>setPage("pool")} onLeave={handleLeaveTeam} onBrowse={()=>setPage("browseTeams")}/>}
      {page==="pool"        && <PlayerPool pool={pool} onBack={()=>setPage("landing")} onClaim={()=>setPage("connect")}/>}
      {page==="teamsList"   && <TeamsListPage teams={teams} onBack={()=>setPage("landing")} onViewTeam={(id: string)=>{setViewTeamId(id);setPage("teamPage");}} onClaim={()=>setPage("connect")}/>}
      {page==="tournament"  && <TournamentPage teams={teams} onBack={()=>setPage("landing")} onBrowse={()=>setPage("browseTeams")} onBracket={()=>setPage("bracket")}/>}
      {page==="bracket"     && <BracketPage teams={teams} onBack={()=>setPage("tournament")}/>}
    </div>
  );
}
