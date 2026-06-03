"use client";

// CTWC Live Broadcast — /watch
// Synchronized live match player. Reads broadcast_started_at from the
// tournament row, then plays all matches of broadcast_round one by one,
// rendering each match's events as if it's happening live.
//
// Time model (per match):
//   PRE_SHOW_S       (15s)  → "Match X of Y · STARTING IN N"
//   MATCH_PLAY_S     (300s) → live match (90 simulated minutes)
//   MATCH_RECAP_S    (45s)  → "FT · MOTM ⭐ Player"
//   total cycle      = 360s = 6 minutes per match
//
// 4 QF matches × 6 min = 24 min total broadcast.
//
// All clients compute their own playback from wall-clock + broadcast_started_at,
// so everyone is within 1-2 seconds of each other.

import { useEffect, useRef, useState, useMemo } from "react";
import { createClient } from "@/lib/supabase";

// ─── Audio ────────────────────────────────────────────────────
let _actx: AudioContext | null = null;
let _noiseBuf: AudioBuffer | null = null;
function ctx() {
  if (typeof window === "undefined") return null;
  if (!_actx) _actx = new (window.AudioContext || (window as any).webkitAudioContext)();
  if (_actx.state === "suspended") _actx.resume();
  return _actx;
}
function buildNoise() {
  const c = ctx(); if (!c || _noiseBuf) return;
  const sr = Math.floor(c.sampleRate / 2);
  const sz = sr * 3;
  const buf = c.createBuffer(2, sz, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < sz; i++) d[i] = Math.random() * 2 - 1;
  }
  _noiseBuf = buf;
}
function crowdRoar(intensity = 1) {
  const c = ctx(); if (!c) return; buildNoise(); if (!_noiseBuf) return;
  const dur = 2.0 * intensity;
  [{f:180,q:2.5,vol:0.20},{f:420,q:2,vol:0.24},{f:900,q:1.8,vol:0.18},{f:2200,q:1.5,vol:0.09}].forEach(({f,q,vol}) => {
    const src = c.createBufferSource(); src.buffer = _noiseBuf!;
    const flt = c.createBiquadFilter(); flt.type = "bandpass"; flt.frequency.value = f; flt.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(0, c.currentTime);
    g.gain.linearRampToValueAtTime(vol * 2.0 * intensity, c.currentTime + 0.08);
    g.gain.linearRampToValueAtTime(vol * 1.3 * intensity, c.currentTime + dur * 0.55);
    g.gain.linearRampToValueAtTime(0, c.currentTime + dur);
    src.connect(flt); flt.connect(g); g.connect(c.destination);
    src.start(); src.stop(c.currentTime + dur + 0.1);
  });
  if (intensity >= 1) {
    [233, 311, 466].forEach((freq, i) => {
      const o = c.createOscillator(); const g = c.createGain();
      o.type = "sawtooth"; o.frequency.value = freq;
      g.gain.setValueAtTime(0, c.currentTime + i * 0.05);
      g.gain.linearRampToValueAtTime(0.10, c.currentTime + i * 0.05 + 0.04);
      g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.7);
      o.connect(g); g.connect(c.destination);
      o.start(c.currentTime + i * 0.05); o.stop(c.currentTime + 0.8);
    });
  }
}
function whistle(short = false) {
  const c = ctx(); if (!c) return;
  const o = c.createOscillator(); const g = c.createGain();
  o.type = "triangle"; o.frequency.setValueAtTime(2600, c.currentTime);
  g.gain.setValueAtTime(0, c.currentTime);
  g.gain.linearRampToValueAtTime(0.18, c.currentTime + 0.02);
  g.gain.linearRampToValueAtTime(0.18, c.currentTime + (short ? 0.1 : 0.22));
  g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + (short ? 0.14 : 0.28));
  o.connect(g); g.connect(c.destination);
  o.start(); o.stop(c.currentTime + 0.3);
}
function tick() {
  const c = ctx(); if (!c) return;
  const o = c.createOscillator(); const g = c.createGain();
  o.type = "square"; o.frequency.setValueAtTime(2400, c.currentTime);
  g.gain.setValueAtTime(0.06, c.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.04);
  o.connect(g); g.connect(c.destination);
  o.start(); o.stop(c.currentTime + 0.05);
}

// Ambient stadium murmur — continuous low-volume crowd noise during a match.
// Returns a stopper that fades out smoothly. Layered bandpass filters give
// that hushed-stadium-on-TV feel without overpowering the goal celebrations.
function startAmbience(): { stop: () => void } {
  const c = ctx(); buildNoise();
  if (!c || !_noiseBuf) return { stop: () => {} };
  const sources: AudioBufferSourceNode[] = [];
  const gains: GainNode[] = [];
  // Three voice layers: low rumble, mid voices, faint highs
  [{f:120,q:1.5,vol:0.07},{f:400,q:1.6,vol:0.05},{f:1200,q:1.4,vol:0.03}].forEach(({f,q,vol}) => {
    const src = c.createBufferSource(); src.buffer = _noiseBuf!; src.loop = true;
    const flt = c.createBiquadFilter(); flt.type = "bandpass"; flt.frequency.value = f; flt.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(0, c.currentTime);
    g.gain.linearRampToValueAtTime(vol, c.currentTime + 1.5);
    src.connect(flt); flt.connect(g); g.connect(c.destination);
    src.start();
    sources.push(src);
    gains.push(g);
  });
  return {
    stop: () => {
      try {
        gains.forEach(g => {
          g.gain.cancelScheduledValues(c.currentTime);
          g.gain.setValueAtTime(g.gain.value, c.currentTime);
          g.gain.linearRampToValueAtTime(0, c.currentTime + 0.5);
        });
        sources.forEach(src => { try { src.stop(c.currentTime + 0.6); } catch {} });
      } catch {}
    },
  };
}

// ─── Timing constants ─────────────────────────────────────────
// Tight, broadcast-paced. 1 simulated minute = 1 real second so a full
// 90-minute match plays in 90s. Per-match cycle:
//   5s preshow  → 90s live play → 15s recap = 110s total per match
// For QF (4 matches): ~7.3 min. For R16 (8): ~14.7 min. Final (1): ~2 min.
const PRE_SHOW_S    = 5;
const MATCH_PLAY_S  = 90;
const MATCH_RECAP_S = 15;
const MATCH_CYCLE_S = PRE_SHOW_S + MATCH_PLAY_S + MATCH_RECAP_S; // 110s

// ─── Types ────────────────────────────────────────────────────
interface Team   { id: string; name: string; color: string; emblem: string; logo_img?: string | null; }
interface Match  { id: string; round_num: number; match_num: number; home_id: string; away_id: string;
  home_score: number | null; away_score: number | null; winner_id: string | null;
  home_pens: number | null; away_pens: number | null; match_data?: any; status: string;
}
interface Tournament {
  status: string; current_round: number;
  broadcast_started_at: string | null;
  broadcast_round:      number  | null;
  broadcast_active:     boolean | null;
  champion_id?:         string  | null;
}

const FONT = "'Inter','Segoe UI','Helvetica Neue',system-ui,sans-serif";

export default function WatchPage() {
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [teams,      setTeams]      = useState<Team[]>([]);
  const [matches,    setMatches]    = useState<Match[]>([]);
  const [audioOK,    setAudioOK]    = useState(false);
  const [now,        setNow]        = useState(Date.now());
  const [presence,   setPresence]   = useState(1);
  const supabase = createClient();
  const triggeredSounds = useRef<Set<string>>(new Set());

  // Initial fetch + realtime sub for tournament/matches changes
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/tournament/state");
        const data = await res.json();
        if (cancelled) return;
        setTournament(data.tournament);
        setTeams(data.teams ?? []);
        setMatches(data.matches ?? []);
      } catch (e) { console.error("watch fetch:", e); }
    })();

    const refetch = async () => {
      try {
        const res = await fetch("/api/tournament/state");
        const data = await res.json();
        setTournament(data.tournament);
        setMatches(data.matches ?? []);
      } catch {}
    };
    const ch = supabase
      .channel("watch-tournament-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "tournament" }, refetch)
      .on("postgres_changes", { event: "*", schema: "public", table: "matches"    }, refetch)
      .subscribe();

    return () => { cancelled = true; supabase.removeChannel(ch); };
  }, []);

  // Wall-clock tick — every 250ms, drives the playback
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);

  // Supabase presence — count active viewers, multiply by 1000 for "spectators"
  useEffect(() => {
    const ch = supabase.channel("watch-presence", { config: { presence: { key: cryptoRandomId() } } });
    ch
      .on("presence", { event: "sync" }, () => {
        const state = ch.presenceState();
        const count = Object.keys(state).length;
        setPresence(count);
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await ch.track({ joinedAt: Date.now() });
        }
      });
    return () => { supabase.removeChannel(ch); };
  }, []);

  // Compute playback state from broadcast_started_at + matches
  const broadcastRound = tournament?.broadcast_round ?? null;
  const startMs = tournament?.broadcast_started_at
    ? new Date(tournament.broadcast_started_at).getTime()
    : null;
  const broadcastMatches = useMemo(() => {
    if (!broadcastRound) return [];
    return (matches ?? [])
      .filter(m => m.round_num === broadcastRound && m.status === "complete")
      .sort((a, b) => a.match_num - b.match_num);
  }, [matches, broadcastRound]);

  const teamById = (id: string) => teams.find(t => t.id === id);

  const playback = useMemo(() => {
    if (!startMs || broadcastMatches.length === 0) return null;
    const elapsedS = (now - startMs) / 1000;
    if (elapsedS < 0) return { phase: "warmup" as const, elapsedS };

    const matchIndex = Math.floor(elapsedS / MATCH_CYCLE_S);
    if (matchIndex >= broadcastMatches.length) {
      return { phase: "postshow" as const, elapsedS, matchIndex: broadcastMatches.length - 1, match: broadcastMatches[broadcastMatches.length - 1] };
    }

    const inMatch = elapsedS - matchIndex * MATCH_CYCLE_S;
    const match = broadcastMatches[matchIndex];

    if (inMatch < PRE_SHOW_S) {
      return {
        phase: "preshow" as const,
        matchIndex, match,
        preshowRemaining: Math.ceil(PRE_SHOW_S - inMatch),
        simulatedMinute: 0,
      };
    } else if (inMatch < PRE_SHOW_S + MATCH_PLAY_S) {
      const matchInS = inMatch - PRE_SHOW_S;
      // Simulated minute scales linearly 0 → 90 across MATCH_PLAY_S seconds.
      const simulatedMinute = Math.min(90, (matchInS / MATCH_PLAY_S) * 90);
      return {
        phase: "playing" as const,
        matchIndex, match,
        simulatedMinute,
        matchInS,
      };
    } else {
      return { phase: "recap" as const, matchIndex, match, simulatedMinute: 90 };
    }
  }, [now, startMs, broadcastMatches]);

  // Sound triggers — fire once per event as the simulated minute reaches it
  useEffect(() => {
    if (!audioOK || !playback || playback.phase !== "playing") return;
    const m = playback.match!;
    const events: any[] = m.match_data?.events ?? [];
    for (const e of events) {
      if (e.minute > playback.simulatedMinute) continue;
      const key = `${m.id}-${e.minute}-${e.type ?? "goal"}-${e.scorer}`;
      if (triggeredSounds.current.has(key)) continue;
      triggeredSounds.current.add(key);
      // 3s tolerance: 1 simulated minute = 1 real second now, so events are
      // tightly packed. Anything older than 3s is "stale" (late-joiner skip).
      const expectedRealS = PRE_SHOW_S + (e.minute / 90) * MATCH_PLAY_S;
      const actualRealS   = playback.matchInS ?? 0;
      if (Math.abs(actualRealS - expectedRealS) > 3) continue;
      const t = e.type ?? "goal";
      try {
        if (t === "goal")   crowdRoar(1);
        if (t === "yellow") whistle(true);
        if (t === "red")    { crowdRoar(0.5); setTimeout(() => whistle(false), 250); }
      } catch {}
    }
  }, [audioOK, playback?.simulatedMinute, playback?.matchIndex, playback?.phase]);

  // ── Whistle markers: kickoff, halftime, full-time ──────────────
  const whistleMarkers = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!audioOK || !playback || playback.phase !== "playing") return;
    const m = playback.match!;
    const min = playback.simulatedMinute;
    const matchKey = (label: string) => `${m.id}-${label}`;
    try {
      // Kickoff whistle once we enter the match (min just after 0)
      if (min >= 0.5 && min < 1.5 && !whistleMarkers.current.has(matchKey("ko"))) {
        whistleMarkers.current.add(matchKey("ko"));
        whistle(false);
      }
      // Halftime whistle (around minute 45)
      if (min >= 45 && min < 46 && !whistleMarkers.current.has(matchKey("ht"))) {
        whistleMarkers.current.add(matchKey("ht"));
        whistle(false);
      }
      // Full-time triple whistle (around minute 90)
      if (min >= 89.5 && !whistleMarkers.current.has(matchKey("ft"))) {
        whistleMarkers.current.add(matchKey("ft"));
        whistle(false);
        setTimeout(() => whistle(false), 240);
        setTimeout(() => whistle(false), 480);
        setTimeout(() => crowdRoar(0.6), 600);
      }
    } catch {}
  }, [audioOK, playback?.simulatedMinute, playback?.matchIndex, playback?.phase]);

  // ── Ambient crowd ambience during play (continuous low murmur) ──
  // Long fade-in/out so it doesn't feel mechanical. Restarts each match.
  const ambientRef = useRef<{ stop: () => void } | null>(null);
  useEffect(() => {
    if (!audioOK) return;
    if (playback?.phase === "playing") {
      if (!ambientRef.current) {
        ambientRef.current = startAmbience();
      }
    } else {
      if (ambientRef.current) {
        ambientRef.current.stop();
        ambientRef.current = null;
      }
    }
    return () => {
      if (ambientRef.current) {
        ambientRef.current.stop();
        ambientRef.current = null;
      }
    };
  }, [audioOK, playback?.phase, playback?.matchIndex]);

  // ─── Render ─────────────────────────────────────────────────
  if (!tournament) return <FullScreen><Loading/></FullScreen>;

  // Off-air states
  const broadcastIsLive = tournament.broadcast_active && startMs &&
    (now - startMs) / 1000 < broadcastMatches.length * MATCH_CYCLE_S + 60;

  if (!broadcastIsLive) {
    return (
      <FullScreen>
        <OffAir tournament={tournament}/>
      </FullScreen>
    );
  }

  // Audio prompt before user interaction
  if (!audioOK) {
    return (
      <FullScreen>
        <AudioPrompt onStart={() => { ctx(); buildNoise(); setAudioOK(true); }} viewers={presence}/>
      </FullScreen>
    );
  }

  return (
    <FullScreen>
      <Backdrop/>

      <BroadcastHeader viewers={presence} round={broadcastRound}/>

      {playback?.phase === "warmup" && (
        <PreBroadcastCountdown startMs={startMs!} now={now} round={broadcastRound}
          matchCount={broadcastMatches.length}/>
      )}
      {playback?.phase === "preshow" && playback.match && (
        <PreShow
          match={playback.match}
          remaining={playback.preshowRemaining ?? 0}
          matchIndex={playback.matchIndex}
          total={broadcastMatches.length}
          teamById={teamById}
        />
      )}
      {playback?.phase === "playing" && playback.match && (
        <LiveMatch
          match={playback.match}
          minute={playback.simulatedMinute}
          matchIndex={playback.matchIndex}
          total={broadcastMatches.length}
          teamById={teamById}
        />
      )}
      {playback?.phase === "recap" && playback.match && (
        <Recap
          match={playback.match}
          matchIndex={playback.matchIndex}
          total={broadcastMatches.length}
          teamById={teamById}
        />
      )}
      {playback?.phase === "postshow" && (
        <PostShow tournament={tournament} teamById={teamById}/>
      )}

      <style>{globalCss}</style>
    </FullScreen>
  );
}

// ─── UI components ────────────────────────────────────────────

function FullScreen({ children }: any) {
  return (
    <div style={{
      position:"fixed",inset:0,
      background:"radial-gradient(ellipse at 50% 50%, #0a1424 0%, #04060d 70%)",
      display:"flex",alignItems:"center",justifyContent:"center",
      overflow:"hidden",fontFamily:FONT,color:"#fff",
    }}>{children}</div>
  );
}

function Loading() {
  return (
    <div style={{color:"rgba(255,255,255,0.5)",fontSize:14,letterSpacing:3}}>LOADING…</div>
  );
}

// Shown when broadcast_started_at is in the future (5-min warmup window).
// Big "STARTING IN MM:SS" countdown so early-arrivers know when kickoff is.
function PreBroadcastCountdown({ startMs, now, round, matchCount }:
  { startMs: number; now: number; round: number | null; matchCount: number }) {
  const remainingS = Math.max(0, Math.ceil((startMs - now) / 1000));
  const mm = String(Math.floor(remainingS / 60)).padStart(2, "0");
  const ss = String(remainingS % 60).padStart(2, "0");
  const ROUND_LABELS: Record<number,string> = {3:"QUARTER FINALS", 4:"SEMI FINALS", 5:"GRAND FINAL"};
  const roundName = round ? (ROUND_LABELS[round] ?? `ROUND ${round}`) : "LIVE MATCHES";
  const startTime = new Date(startMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return (
    <div style={{textAlign:"center",position:"relative",zIndex:5}}>
      <div style={{display:"inline-flex",alignItems:"center",gap:10,marginBottom:26,
        padding:"8px 18px",borderRadius:22,background:"rgba(239,68,68,0.16)",border:"1.5px solid rgba(239,68,68,0.5)"}}>
        <div style={{width:9,height:9,borderRadius:"50%",background:"#EF4444",
          boxShadow:"0 0 10px rgba(239,68,68,0.7)",animation:"ppulse 1.1s infinite"}}/>
        <span style={{fontSize:12,fontWeight:900,letterSpacing:4,color:"#EF4444"}}>{roundName} · STARTING SOON</span>
      </div>
      <div style={{fontSize:18,fontWeight:700,letterSpacing:4,color:"rgba(255,255,255,0.5)",marginBottom:24}}>
        BROADCAST BEGINS IN
      </div>
      <div style={{fontSize:180,fontWeight:900,color:"#FBBF24",letterSpacing:-4,lineHeight:1,
        fontVariantNumeric:"tabular-nums",
        textShadow:"0 0 60px rgba(212,165,55,0.6)"}}>
        {mm}:{ss}
      </div>
      <div style={{marginTop:30,fontSize:14,letterSpacing:3,color:"rgba(255,255,255,0.5)"}}>
        {matchCount} {matchCount === 1 ? "MATCH" : "MATCHES"} · KICKOFF AT {startTime}
      </div>
      <div style={{marginTop:14,fontSize:12,color:"rgba(255,255,255,0.35)",letterSpacing:1}}>
        Stay on this page — it starts automatically.
      </div>
    </div>
  );
}

function OffAir({ tournament }: { tournament: Tournament }) {
  const r = tournament.broadcast_round;
  return (
    <div style={{textAlign:"center"}}>
      <div style={{fontSize:11,letterSpacing:8,color:"rgba(255,255,255,0.4)",fontWeight:700,marginBottom:18}}>
        CTWC LIVE
      </div>
      <div style={{fontSize:64,fontWeight:900,color:"#fff",letterSpacing:-1,marginBottom:14}}>
        Off Air
      </div>
      <div style={{fontSize:14,color:"rgba(255,255,255,0.5)",maxWidth:520,lineHeight:1.6,marginBottom:30}}>
        {r
          ? `The Round ${r} broadcast has ended. Final results are on the bracket.`
          : "Live broadcast goes live when admin simulates QF, SF, or Final."}
      </div>
      <a href="/" style={{
        display:"inline-flex",alignItems:"center",gap:9,
        padding:"14px 30px",fontSize:13,fontWeight:800,letterSpacing:3,
        background:"linear-gradient(135deg,#FBBF24,#D4A537)",
        border:"none",borderRadius:10,color:"#1a1a1a",textDecoration:"none",
        boxShadow:"0 0 28px rgba(212,165,55,0.5)",
      }}>← BACK TO BRACKET</a>
    </div>
  );
}

function AudioPrompt({ onStart, viewers }: { onStart: () => void; viewers: number }) {
  return (
    <div style={{textAlign:"center"}}>
      <div style={{display:"inline-flex",alignItems:"center",gap:10,marginBottom:22,
        padding:"7px 16px",borderRadius:20,background:"rgba(239,68,68,0.15)",border:"1px solid rgba(239,68,68,0.4)"}}>
        <div style={{width:8,height:8,borderRadius:"50%",background:"#EF4444",
          boxShadow:"0 0 8px rgba(239,68,68,0.7)",animation:"ppulse 1.2s infinite"}}/>
        <span style={{fontSize:11,letterSpacing:3,color:"#EF4444",fontWeight:900}}>● LIVE NOW</span>
      </div>
      <div style={{fontSize:54,fontWeight:900,color:"#fff",letterSpacing:-1,marginBottom:12}}>
        CTWC LIVE BROADCAST
      </div>
      <div style={{fontSize:14,color:"rgba(255,255,255,0.55)",maxWidth:520,lineHeight:1.65,marginBottom:30}}>
        Click to tune in. Matches play out in real-time. Sound recommended.<br/>
        <b style={{color:"#FBBF24"}}>{(viewers * 1000).toLocaleString()}</b> spectators tuned in.
      </div>
      <button onClick={onStart} style={{
        padding:"18px 56px",fontSize:18,fontWeight:900,letterSpacing:4,
        background:"linear-gradient(135deg,#FBBF24,#D4A537)",
        border:"none",borderRadius:12,color:"#1a1a1a",cursor:"pointer",
        boxShadow:"0 0 36px rgba(212,165,55,0.6),0 12px 30px rgba(0,0,0,0.6)",
      }}>📺 TUNE IN</button>
    </div>
  );
}

function Backdrop() {
  return (
    <div style={{position:"absolute",inset:0,pointerEvents:"none",overflow:"hidden"}}>
      <div style={{position:"absolute",top:"-15%",right:"-10%",width:900,height:900,borderRadius:"50%",
        background:"radial-gradient(circle,rgba(212,165,55,0.10) 0%,transparent 60%)",
        animation:"orbFloat 8s ease-in-out infinite"}}/>
      <div style={{position:"absolute",bottom:"-20%",left:"-10%",width:700,height:700,borderRadius:"50%",
        background:"radial-gradient(circle,rgba(239,68,68,0.06) 0%,transparent 60%)",
        animation:"orbFloat 11s ease-in-out infinite reverse"}}/>
    </div>
  );
}

function BroadcastHeader({ viewers, round }: { viewers: number; round: number | null }) {
  const ROUND_LABELS: Record<number,string> = {1:"R32",2:"R16",3:"QUARTER FINALS",4:"SEMI FINALS",5:"GRAND FINAL"};
  return (
    <div style={{position:"absolute",top:18,left:0,right:0,zIndex:50,
      display:"flex",justifyContent:"space-between",alignItems:"center",padding:"0 26px"}}>
      <div style={{display:"flex",alignItems:"center",gap:8}}>
        <div style={{width:9,height:9,borderRadius:"50%",background:"#EF4444",
          boxShadow:"0 0 9px rgba(239,68,68,0.8)",animation:"ppulse 1.2s infinite"}}/>
        <span style={{fontSize:11,fontWeight:900,letterSpacing:3,color:"#EF4444"}}>LIVE</span>
        <span style={{fontSize:11,fontWeight:700,letterSpacing:3,color:"rgba(255,255,255,0.5)"}}>·</span>
        <span style={{fontSize:11,fontWeight:700,letterSpacing:3,color:"rgba(255,255,255,0.7)"}}>
          {round ? ROUND_LABELS[round] ?? `ROUND ${round}` : ""}
        </span>
      </div>
      <div style={{display:"flex",alignItems:"center",gap:6}}>
        <span style={{fontSize:13}}>👥</span>
        <span style={{fontSize:13,fontWeight:900,letterSpacing:0.5,color:"#FBBF24",fontVariantNumeric:"tabular-nums"}}>
          {(viewers * 1000).toLocaleString()}
        </span>
        <span style={{fontSize:10,fontWeight:700,letterSpacing:2,color:"rgba(255,255,255,0.4)"}}>WATCHING</span>
      </div>
    </div>
  );
}

function PreShow({ match, remaining, matchIndex, total, teamById }: any) {
  const home = teamById(match.home_id);
  const away = teamById(match.away_id);
  return (
    <div style={{textAlign:"center",position:"relative",zIndex:5,animation:"sceneIn 0.5s both"}}>
      <div style={{fontSize:11,letterSpacing:6,color:"#FBBF24",fontWeight:700,marginBottom:8}}>
        MATCH {matchIndex + 1} OF {total}
      </div>
      <div style={{fontSize:18,fontWeight:700,color:"rgba(255,255,255,0.55)",letterSpacing:3,marginBottom:36}}>
        STARTING IN
      </div>
      <div style={{fontSize:160,fontWeight:900,color:"#FBBF24",letterSpacing:-4,lineHeight:1,
        textShadow:"0 0 56px rgba(212,165,55,0.6)",
        fontVariantNumeric:"tabular-nums",marginBottom:42,
        animation:"slamIn 0.4s cubic-bezier(0.34,1.56,0.64,1) both"}} key={remaining}>
        {remaining}
      </div>
      <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:60}}>
        {home && <MiniTeam team={home}/>}
        <span style={{fontSize:36,fontWeight:900,color:"rgba(255,255,255,0.4)",letterSpacing:4}}>VS</span>
        {away && <MiniTeam team={away}/>}
      </div>
    </div>
  );
}

function MiniTeam({ team }: { team: Team }) {
  return (
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:10}}>
      <div style={{
        width:90,height:90,borderRadius:"50%",
        background:`linear-gradient(135deg,${team.color},${team.color}aa)`,
        display:"flex",alignItems:"center",justifyContent:"center",
        fontSize:46,border:`3px solid ${team.color}`,
        boxShadow:`0 0 18px ${team.color}88`,
      }}>{team.emblem}</div>
      <div style={{fontSize:14,fontWeight:900,color:"#fff",letterSpacing:0.5,maxWidth:200,
        textAlign:"center",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
        {team.name}
      </div>
    </div>
  );
}

// ─── LiveMatch: the main scoreboard view ─────────────────────
function LiveMatch({ match, minute, matchIndex, total, teamById }: any) {
  const home = teamById(match.home_id);
  const away = teamById(match.away_id);
  const events: any[] = match.match_data?.events ?? [];
  const hStats = match.match_data?.homeStats ?? {};
  const aStats = match.match_data?.awayStats ?? {};
  const motm   = match.match_data?.motm;

  // Filter events that should be visible at current simulated minute
  const visibleEvents = events
    .filter(e => e.minute <= minute)
    .sort((a, b) => b.minute - a.minute);

  // Running score (count goals visible so far)
  const homeGoals = visibleEvents.filter(e => e.team === "home" && (e.type ?? "goal") === "goal").length;
  const awayGoals = visibleEvents.filter(e => e.team === "away" && (e.type ?? "goal") === "goal").length;
  const homeYellows = visibleEvents.filter(e => e.team === "home" && e.type === "yellow").length;
  const awayYellows = visibleEvents.filter(e => e.team === "away" && e.type === "yellow").length;
  const homeReds    = visibleEvents.filter(e => e.team === "home" && e.type === "red").length;
  const awayReds    = visibleEvents.filter(e => e.team === "away" && e.type === "red").length;

  // Interpolated possession (50% → final value over the match)
  const targetHomePoss = hStats.possession ?? 50;
  const tFactor = Math.min(1, minute / 70); // settles by minute 70
  const homePoss = 50 + (targetHomePoss - 50) * tFactor;
  const awayPoss = 100 - homePoss;

  const showHT = minute >= 45 && minute < 47;
  const showFT = minute >= 90;
  const hc = home?.color ?? "#3B82F6";
  const ac = away?.color ?? "#EF4444";

  return (
    <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",
      padding:"60px 36px 30px"}}>

      {/* Match label */}
      <div style={{textAlign:"center",marginBottom:14}}>
        <div style={{fontSize:10,letterSpacing:4,color:"rgba(255,255,255,0.4)",fontWeight:700}}>
          MATCH {matchIndex + 1} OF {total}
        </div>
      </div>

      {/* Big scoreboard */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:30,maxWidth:1280,
        margin:"0 auto",width:"100%"}}>
        {/* Home */}
        <div style={{flex:1,minWidth:0,textAlign:"right",
          background:`linear-gradient(90deg,transparent,${hc}1a)`,padding:"24px 28px",borderRadius:14}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"flex-end",gap:14}}>
            <div style={{textAlign:"right",minWidth:0}}>
              <div style={{fontSize:24,fontWeight:900,color:"#fff",letterSpacing:0.5,
                overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:340}}>
                {home?.name}
              </div>
              <CardsRow yellows={homeYellows} reds={homeReds} align="end"/>
            </div>
            <div style={{
              width:80,height:80,borderRadius:"50%",
              background:`linear-gradient(135deg,${hc},${hc}aa)`,
              display:"flex",alignItems:"center",justifyContent:"center",fontSize:42,
              border:`3px solid ${hc}`,boxShadow:`0 0 20px ${hc}99`,flexShrink:0,
            }}>{home?.emblem}</div>
          </div>
        </div>

        {/* Score + minute */}
        <div style={{textAlign:"center",flexShrink:0,padding:"0 18px"}}>
          <div style={{fontSize:120,fontWeight:900,color:"#fff",letterSpacing:-3,lineHeight:1,
            fontVariantNumeric:"tabular-nums",
            textShadow:"0 0 30px rgba(0,0,0,0.7)",
          }}>
            {homeGoals} <span style={{color:"rgba(255,255,255,0.3)"}}>-</span> {awayGoals}
          </div>
          <div style={{marginTop:14,display:"inline-flex",alignItems:"center",gap:8,
            padding:"6px 18px",borderRadius:99,
            background: showFT ? "rgba(34,197,94,0.18)" : showHT ? "rgba(212,165,55,0.18)" : "rgba(239,68,68,0.18)",
            border: `1.5px solid ${showFT ? "#22C55E" : showHT ? "#FBBF24" : "#EF4444"}88`,
          }}>
            <div style={{width:7,height:7,borderRadius:"50%",
              background: showFT ? "#22C55E" : showHT ? "#FBBF24" : "#EF4444",
              animation: showFT ? "none" : "ppulse 1.1s infinite"}}/>
            <span style={{fontSize:18,fontWeight:900,letterSpacing:2,
              color: showFT ? "#22C55E" : showHT ? "#FBBF24" : "#EF4444",
              fontVariantNumeric:"tabular-nums"}}>
              {showFT ? "FT" : showHT ? "HT" : `${Math.floor(minute)}'`}
            </span>
          </div>
        </div>

        {/* Away */}
        <div style={{flex:1,minWidth:0,
          background:`linear-gradient(-90deg,transparent,${ac}1a)`,padding:"24px 28px",borderRadius:14}}>
          <div style={{display:"flex",alignItems:"center",gap:14}}>
            <div style={{
              width:80,height:80,borderRadius:"50%",
              background:`linear-gradient(135deg,${ac},${ac}aa)`,
              display:"flex",alignItems:"center",justifyContent:"center",fontSize:42,
              border:`3px solid ${ac}`,boxShadow:`0 0 20px ${ac}99`,flexShrink:0,
            }}>{away?.emblem}</div>
            <div style={{textAlign:"left",minWidth:0}}>
              <div style={{fontSize:24,fontWeight:900,color:"#fff",letterSpacing:0.5,
                overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:340}}>
                {away?.name}
              </div>
              <CardsRow yellows={awayYellows} reds={awayReds} align="start"/>
            </div>
          </div>
        </div>
      </div>

      {/* Possession bar */}
      <div style={{maxWidth:1100,margin:"42px auto 0",width:"100%",padding:"0 16px"}}>
        <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
          <span style={{fontSize:13,fontWeight:900,color:hc,fontVariantNumeric:"tabular-nums"}}>
            {Math.round(homePoss)}%
          </span>
          <span style={{fontSize:10,fontWeight:700,letterSpacing:2.5,color:"rgba(255,255,255,0.4)"}}>
            POSSESSION
          </span>
          <span style={{fontSize:13,fontWeight:900,color:ac,fontVariantNumeric:"tabular-nums"}}>
            {Math.round(awayPoss)}%
          </span>
        </div>
        <div style={{height:12,background:"rgba(255,255,255,0.05)",borderRadius:6,overflow:"hidden",display:"flex"}}>
          <div style={{height:"100%",width:`${homePoss}%`,
            background:`linear-gradient(90deg,${hc}aa,${hc})`,
            transition:"width 0.5s ease",
            boxShadow:`inset 0 0 8px ${hc}66`}}/>
          <div style={{flex:1,background:`linear-gradient(90deg,${ac},${ac}aa)`,
            boxShadow:`inset 0 0 8px ${ac}66`}}/>
        </div>
      </div>

      {/* Live event ticker — bottom */}
      <div style={{maxWidth:1100,margin:"36px auto 0",width:"100%",padding:"0 16px",flex:1,
        display:"flex",flexDirection:"column"}}>
        <div style={{fontSize:10,letterSpacing:3,color:"rgba(255,255,255,0.4)",fontWeight:700,marginBottom:10}}>
          MATCH FEED
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:8,overflow:"hidden"}}>
          {visibleEvents.slice(0, 6).map((e:any, i:number) => {
            const isHome = e.team === "home";
            const col = isHome ? hc : ac;
            const t = e.type ?? "goal";
            const icon = t === "goal" ? "⚽" : t === "yellow" ? "🟨" : t === "red" ? "🟥" : "•";
            const label = t === "goal" ? "GOAL" : t === "yellow" ? "BOOKED" : t === "red" ? "SENT OFF" : "EVENT";
            return (
              <div key={`${e.minute}-${e.scorer}-${t}-${i}`}
                style={{display:"flex",alignItems:"center",gap:14,padding:"12px 18px",borderRadius:11,
                  background:`linear-gradient(90deg,${col}1a,transparent 60%)`,
                  border:`1px solid ${col}44`,
                  animation: i === 0 ? "feedPop 0.6s cubic-bezier(0.34,1.56,0.64,1) both" : "none"}}>
                <div style={{width:36,height:36,borderRadius:9,
                  background: t === "goal" ? col : "rgba(0,0,0,0.5)",
                  display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0,
                  boxShadow: t === "goal" ? `0 0 14px ${col}88` : "none"}}>{icon}</div>
                <div style={{fontSize:14,fontWeight:800,color:"#fff",flex:1,minWidth:0,
                  overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                  {e.scorerName}
                  {e.assistName && t === "goal" && (
                    <span style={{color:"rgba(255,255,255,0.5)",fontWeight:600,marginLeft:8,fontSize:12}}>
                      🅰 {e.assistName}
                    </span>
                  )}
                </div>
                <span style={{fontSize:11,fontWeight:800,color:col,letterSpacing:1.5}}>{label}</span>
                <span style={{fontSize:18,fontWeight:900,color:"rgba(255,255,255,0.6)",
                  fontVariantNumeric:"tabular-nums",minWidth:42,textAlign:"right"}}>{e.minute}'</span>
              </div>
            );
          })}
          {visibleEvents.length === 0 && (
            <div style={{fontSize:13,color:"rgba(255,255,255,0.3)",textAlign:"center",padding:24}}>
              Match underway — waiting for first event…
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CardsRow({ yellows, reds, align }: { yellows: number; reds: number; align: "start" | "end" }) {
  if (yellows === 0 && reds === 0) return null;
  return (
    <div style={{display:"flex",gap:6,marginTop:8,
      justifyContent:align==="end"?"flex-end":"flex-start",alignItems:"center"}}>
      {Array.from({length:yellows}).map((_, i) => (
        <div key={`y${i}`} style={{width:11,height:14,background:"#FBBF24",borderRadius:2,
          boxShadow:"0 0 5px rgba(212,165,55,0.5)"}}/>
      ))}
      {Array.from({length:reds}).map((_, i) => (
        <div key={`r${i}`} style={{width:11,height:14,background:"#EF4444",borderRadius:2,
          boxShadow:"0 0 6px rgba(239,68,68,0.7)"}}/>
      ))}
    </div>
  );
}

// ─── Recap: shown after each match ───────────────────────────
function Recap({ match, matchIndex, total, teamById }: any) {
  const home = teamById(match.home_id);
  const away = teamById(match.away_id);
  const motm = match.match_data?.motm;
  const homeWon = match.winner_id === match.home_id;
  const awayWon = match.winner_id === match.away_id;
  return (
    <div style={{textAlign:"center",position:"relative",zIndex:5,animation:"sceneIn 0.5s both",padding:"0 30px"}}>
      <div style={{fontSize:11,letterSpacing:6,color:"rgba(255,255,255,0.4)",fontWeight:700,marginBottom:10}}>
        FULL TIME · MATCH {matchIndex + 1}
      </div>
      <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:40,marginBottom:34}}>
        <div style={{textAlign:"right"}}>
          <div style={{fontSize:18,fontWeight:900,color:homeWon?"#22C55E":"#fff",letterSpacing:0.5}}>
            {home?.name}
          </div>
        </div>
        <div style={{fontSize:88,fontWeight:900,color:"#fff",letterSpacing:-2,
          fontVariantNumeric:"tabular-nums"}}>
          {match.home_score} - {match.away_score}
        </div>
        <div style={{textAlign:"left"}}>
          <div style={{fontSize:18,fontWeight:900,color:awayWon?"#22C55E":"#fff",letterSpacing:0.5}}>
            {away?.name}
          </div>
        </div>
      </div>
      {motm && (
        <div style={{display:"inline-flex",alignItems:"center",gap:16,
          padding:"18px 30px",borderRadius:14,
          background:"linear-gradient(135deg,rgba(212,165,55,0.18),rgba(212,165,55,0.05))",
          border:"2px solid rgba(212,165,55,0.55)",
          boxShadow:"0 0 40px rgba(212,165,55,0.3)"}}>
          <div style={{
            width:60,height:60,borderRadius:11,
            background:"linear-gradient(135deg,#FBBF24,#D4A537)",color:"#1a1a1a",
            display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
            fontWeight:900,
          }}>
            <span style={{fontSize:26}}>{motm.rating?.toFixed(1)}</span>
            <span style={{fontSize:7,letterSpacing:1.5,marginTop:2}}>RATING</span>
          </div>
          <div style={{textAlign:"left"}}>
            <div style={{fontSize:11,letterSpacing:4,color:"#FBBF24",fontWeight:800}}>⭐ MAN OF THE MATCH</div>
            <div style={{fontSize:22,fontWeight:900,color:"#fff",marginTop:4}}>{motm.displayName}</div>
            <div style={{fontSize:12,color:"rgba(255,255,255,0.55)",marginTop:2}}>{motm.reason}</div>
          </div>
        </div>
      )}
      <div style={{marginTop:30,fontSize:11,letterSpacing:3,color:"rgba(255,255,255,0.4)"}}>
        {matchIndex + 1 < total ? `NEXT MATCH STARTING SHORTLY (${matchIndex + 2}/${total})` : "FULL BROADCAST WRAPPING UP"}
      </div>
    </div>
  );
}

function PostShow({ tournament, teamById }: any) {
  const champ = tournament.champion_id ? teamById(tournament.champion_id) : null;
  return (
    <div style={{textAlign:"center"}}>
      <div style={{fontSize:11,letterSpacing:6,color:"rgba(255,255,255,0.4)",fontWeight:700,marginBottom:18}}>
        THAT'S A WRAP
      </div>
      <div style={{fontSize:64,fontWeight:900,color:"#FBBF24",letterSpacing:-1,marginBottom:18,
        textShadow:"0 0 30px rgba(212,165,55,0.6)"}}>
        BROADCAST ENDED
      </div>
      {champ && (
        <div style={{marginBottom:30,fontSize:18,color:"#fff"}}>
          🏆 Tournament Champion: <b style={{color:champ.color}}>{champ.name}</b>
        </div>
      )}
      <a href="/?p=bracket" style={{
        display:"inline-flex",alignItems:"center",gap:9,
        padding:"14px 30px",fontSize:13,fontWeight:800,letterSpacing:3,
        background:"linear-gradient(135deg,#FBBF24,#D4A537)",
        border:"none",borderRadius:10,color:"#1a1a1a",textDecoration:"none",
      }}>VIEW FULL BRACKET</a>
    </div>
  );
}

function cryptoRandomId(): string {
  try { return crypto.randomUUID(); } catch {}
  return Math.random().toString(36).slice(2);
}

const globalCss = `
  body { margin: 0; background: #000; overflow: hidden; }
  @keyframes ppulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }
  @keyframes sceneIn { from { opacity: 0; } to { opacity: 1; } }
  @keyframes slamIn { 0% { opacity: 0; transform: scale(1.6); } 60% { opacity: 1; transform: scale(0.95); } 100% { transform: scale(1); } }
  @keyframes orbFloat { 0%,100% { transform: translateY(0) scale(1); } 50% { transform: translateY(-30px) scale(1.05); } }
  @keyframes feedPop { 0% { opacity: 0; transform: translateX(-30px); } 100% { opacity: 1; transform: translateX(0); } }
`;
