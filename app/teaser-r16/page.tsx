"use client";

// CTWC R16 Teaser — cinematic reveal for Round of 16 (May 26).
// Sequence (~70s total):
//   0–2s   CTWC 2026 logo build-in with rumble
//   2–9s   R32 RESULTS recap — animated grid of completed scores
//   9–22s  TOP PERFORMERS from R32 — top scorers + most MOTM
//   22–26s ROUND OF 16 slam reveal + thunder
//   26–31s TUESDAY 26 MAY · 8:00 PM UTC with ticking clock
//   31–37s 16 surviving squads cascade
//   37–62s 8 H2H matchups (2.5s each) with slam + whistle
//   62–68s BE THERE → ctworldcup.xyz + crowd roar
//   68–70s Fade to black
//
// Visit https://ctworldcup.xyz/teaser-r16, click PLAY, screen record.

import { useEffect, useRef, useState, useMemo } from "react";

// ── Audio (standalone copy — same engine as /teaser) ──
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
function thunder() {
  const c = ctx(); if (!c) return; buildNoise(); if (!_noiseBuf) return;
  const dur = 1.2;
  const src = c.createBufferSource(); src.buffer = _noiseBuf;
  const flt = c.createBiquadFilter(); flt.type = "lowpass"; flt.frequency.value = 200; flt.Q.value = 1.5;
  const g = c.createGain();
  g.gain.setValueAtTime(0, c.currentTime);
  g.gain.linearRampToValueAtTime(0.55, c.currentTime + 0.02);
  g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
  src.connect(flt); flt.connect(g); g.connect(c.destination);
  src.start(); src.stop(c.currentTime + dur);
  const o = c.createOscillator(); const og = c.createGain();
  o.type = "sine"; o.frequency.setValueAtTime(50, c.currentTime);
  o.frequency.exponentialRampToValueAtTime(28, c.currentTime + 0.8);
  og.gain.setValueAtTime(0.55, c.currentTime);
  og.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 1.0);
  o.connect(og); og.connect(c.destination);
  o.start(); o.stop(c.currentTime + 1.0);
}
function crowdRoar(duration = 2.5) {
  const c = ctx(); if (!c) return; buildNoise(); if (!_noiseBuf) return;
  [{f:180,q:2.5,vol:0.22},{f:420,q:2,vol:0.26},{f:900,q:1.8,vol:0.20},{f:2200,q:1.5,vol:0.10}].forEach(({f,q,vol}) => {
    const src = c.createBufferSource(); src.buffer = _noiseBuf!;
    const flt = c.createBiquadFilter(); flt.type = "bandpass"; flt.frequency.value = f; flt.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(0, c.currentTime);
    g.gain.linearRampToValueAtTime(vol * 2.0, c.currentTime + 0.1);
    g.gain.linearRampToValueAtTime(vol * 1.4, c.currentTime + duration * 0.6);
    g.gain.linearRampToValueAtTime(0, c.currentTime + duration);
    src.connect(flt); flt.connect(g); g.connect(c.destination);
    src.start(); src.stop(c.currentTime + duration + 0.1);
  });
  [233, 311, 466].forEach((freq, i) => {
    const o = c.createOscillator(); const g = c.createGain();
    o.type = "sawtooth"; o.frequency.value = freq;
    g.gain.setValueAtTime(0, c.currentTime + i * 0.05);
    g.gain.linearRampToValueAtTime(0.11, c.currentTime + i * 0.05 + 0.04);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.7);
    o.connect(g); g.connect(c.destination);
    o.start(c.currentTime + i * 0.05); o.stop(c.currentTime + 0.8);
  });
}
function slam(pitch = 100) {
  const c = ctx(); if (!c) return;
  const o = c.createOscillator(); const g = c.createGain();
  o.type = "square"; o.frequency.setValueAtTime(pitch, c.currentTime);
  o.frequency.exponentialRampToValueAtTime(pitch * 0.4, c.currentTime + 0.18);
  g.gain.setValueAtTime(0.32, c.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.22);
  o.connect(g); g.connect(c.destination);
  o.start(); o.stop(c.currentTime + 0.25);
}
function woosh() {
  const c = ctx(); if (!c) return; buildNoise(); if (!_noiseBuf) return;
  const src = c.createBufferSource(); src.buffer = _noiseBuf;
  const flt = c.createBiquadFilter(); flt.type = "bandpass"; flt.frequency.value = 2000; flt.Q.value = 3;
  const g = c.createGain();
  g.gain.setValueAtTime(0, c.currentTime);
  g.gain.linearRampToValueAtTime(0.18, c.currentTime + 0.04);
  g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.3);
  flt.frequency.setValueAtTime(800, c.currentTime);
  flt.frequency.exponentialRampToValueAtTime(4000, c.currentTime + 0.3);
  src.connect(flt); flt.connect(g); g.connect(c.destination);
  src.start(); src.stop(c.currentTime + 0.32);
}
function tick() {
  const c = ctx(); if (!c) return;
  const o = c.createOscillator(); const g = c.createGain();
  o.type = "square"; o.frequency.setValueAtTime(2400, c.currentTime);
  g.gain.setValueAtTime(0.08, c.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.05);
  o.connect(g); g.connect(c.destination);
  o.start(); o.stop(c.currentTime + 0.06);
}
function whistle() {
  const c = ctx(); if (!c) return;
  const o = c.createOscillator(); const g = c.createGain();
  o.type = "triangle"; o.frequency.setValueAtTime(2600, c.currentTime);
  g.gain.setValueAtTime(0, c.currentTime);
  g.gain.linearRampToValueAtTime(0.18, c.currentTime + 0.02);
  g.gain.linearRampToValueAtTime(0.18, c.currentTime + 0.18);
  g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.22);
  o.connect(g); g.connect(c.destination);
  o.start(); o.stop(c.currentTime + 0.24);
}
function ding() {
  const c = ctx(); if (!c) return;
  [880, 1320].forEach((freq, i) => {
    const o = c.createOscillator(); const g = c.createGain();
    o.type = "sine"; o.frequency.value = freq;
    g.gain.setValueAtTime(0, c.currentTime + i * 0.05);
    g.gain.linearRampToValueAtTime(0.12, c.currentTime + i * 0.05 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + i * 0.05 + 0.5);
    o.connect(g); g.connect(c.destination);
    o.start(c.currentTime + i * 0.05); o.stop(c.currentTime + 0.6);
  });
}

// ─── Page ─────────────────────────────────────────────────────
interface Team { id: string; name: string; color: string; emblem: string; logo_img?: string | null; }
interface Match { match_num: number; round_num: number; status: string; home_id: string; away_id: string; home_score: number | null; away_score: number | null; winner_id: string | null; match_data?: any; }

export default function TeaserR16Page() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [phase, setPhase] = useState<"loading"|"ready"|"playing">("loading");
  const [scene, setScene] = useState<number>(0);
  const [h2hIndex, setH2hIndex] = useState<number>(-1);
  const timersRef = useRef<any[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/tournament/state");
        const data = await res.json();
        setTeams(data.teams ?? []);
        setMatches((data.matches ?? []).map((m:any) => ({
          ...m,
        })));
        setPhase("ready");
      } catch (e) {
        console.error("teaser-r16 fetch:", e);
        setPhase("ready");
      }
    })();
  }, []);

  const teamById = (id: string) => teams.find(t => t.id === id);

  // Derived data
  const r32Matches = useMemo(
    () => matches.filter(m => m.round_num === 1 && m.status === "complete")
                 .sort((a, b) => a.match_num - b.match_num),
    [matches]
  );
  const r16Matches = useMemo(
    () => matches.filter(m => m.round_num === 2)
                 .sort((a, b) => a.match_num - b.match_num),
    [matches]
  );
  const survivors = useMemo(() => {
    const winnerIds = r32Matches.map(m => m.winner_id).filter(Boolean);
    return winnerIds.map(id => teamById(id!)).filter(Boolean) as Team[];
  }, [r32Matches, teams]);

  // Aggregate top scorers + MOTMs from R32
  const topScorers = useMemo(() => {
    const counts: Record<string, { handle: string; name: string; goals: number; teamId: string }> = {};
    for (const m of r32Matches) {
      const events: any[] = m.match_data?.events ?? [];
      for (const e of events) {
        if ((e.type ?? "goal") !== "goal") continue;
        const teamId = e.team === "home" ? m.home_id : m.away_id;
        if (!counts[e.scorer]) counts[e.scorer] = { handle: e.scorer, name: e.scorerName, goals: 0, teamId };
        counts[e.scorer].goals += 1;
      }
    }
    return Object.values(counts).sort((a, b) => b.goals - a.goals).slice(0, 3);
  }, [r32Matches]);

  const topMOTMs = useMemo(() => {
    const counts: Record<string, { handle: string; name: string; awards: number; teamId: string }> = {};
    for (const m of r32Matches) {
      const motm = m.match_data?.motm;
      if (!motm) continue;
      const teamId = motm.team === "home" ? m.home_id : m.away_id;
      if (!counts[motm.handle]) counts[motm.handle] = { handle: motm.handle, name: motm.displayName, awards: 0, teamId };
      counts[motm.handle].awards += 1;
    }
    return Object.values(counts).sort((a, b) => b.awards - a.awards).slice(0, 3);
  }, [r32Matches]);

  const runSequence = () => {
    setPhase("playing");
    buildNoise();
    const add = (ms: number, fn: () => void) => {
      const id = setTimeout(fn, ms);
      timersRef.current.push(id);
    };

    // 0–2s — Intro
    setScene(1);
    add(150, () => thunder());

    // 2–9s — R32 RESULTS RECAP
    add(2000, () => { setScene(2); slam(140); });
    add(2500, () => woosh());
    add(3500, () => woosh());
    add(4500, () => woosh());
    add(5500, () => woosh());
    add(6500, () => woosh());

    // 9–22s — TOP PERFORMERS
    add(9000,  () => { setScene(3); ding(); });
    add(9500,  () => ding());
    add(13000, () => { setScene(4); ding(); }); // MOTM page
    add(13500, () => ding());

    // 22–26s — ROUND OF 16 reveal
    add(17500, () => { setScene(5); thunder(); });
    add(17700, () => slam(180));

    // 26–31s — Date/Time
    add(21500, () => { setScene(6); });
    add(21700, () => tick());
    add(22300, () => tick());
    add(22900, () => tick());
    add(23500, () => tick());

    // 31–37s — Survivors cascade
    add(26500, () => { setScene(7); });
    add(26550, () => woosh());
    add(27200, () => woosh());
    add(27900, () => woosh());
    add(28600, () => woosh());

    // H2H matchups — 8 matches × 2.5s each = 20s
    const H2H_START = 32500;
    const H2H_DUR   = 2500;
    const totalH2H = Math.max(1, r16Matches.length || 8);
    for (let i = 0; i < totalH2H; i++) {
      const t0 = H2H_START + i * H2H_DUR;
      add(t0,           () => { setScene(8); setH2hIndex(i); slam(120); });
      add(t0 + 1000,    () => slam(160));
      add(t0 + 1700,    () => whistle());
    }

    // Closing
    const CLOSE = H2H_START + totalH2H * H2H_DUR;
    add(CLOSE,        () => { setScene(9); thunder(); crowdRoar(3); });
    add(CLOSE + 6000, () => { setScene(10); });
  };

  useEffect(() => () => { timersRef.current.forEach(clearTimeout); }, []);

  if (phase === "loading") {
    return (
      <div style={fullScreen}>
        <div style={{color:"rgba(255,255,255,0.5)",fontSize:14,letterSpacing:3,fontFamily:FONT}}>
          LOADING R16 DATA…
        </div>
      </div>
    );
  }

  if (phase === "ready") {
    return (
      <div style={fullScreen}>
        <div style={{textAlign:"center",fontFamily:FONT}}>
          <div style={{fontSize:11,letterSpacing:5,color:"rgba(255,255,255,0.5)",marginBottom:14}}>
            CTWC 2026 · R16 TEASER
          </div>
          <div style={{fontSize:48,fontWeight:900,color:"#fff",letterSpacing:-1,marginBottom:8}}>
            Ready to record?
          </div>
          <div style={{fontSize:14,color:"rgba(255,255,255,0.5)",marginBottom:32,maxWidth:560,lineHeight:1.6}}>
            Click PLAY. Start your screen recorder. Sequence runs ~70s.
            <br/>
            Found <b style={{color:"#FBBF24"}}>{r32Matches.length}</b> R32 results,
            <b style={{color:"#FBBF24"}}> {r16Matches.length}</b> R16 fixtures,
            <b style={{color:"#FBBF24"}}> {topScorers.length}</b> top scorers,
            <b style={{color:"#FBBF24"}}> {topMOTMs.length}</b> MOTMs.
          </div>
          <button onClick={runSequence} style={{
            padding:"18px 52px",fontSize:18,fontWeight:800,letterSpacing:3,
            background:"linear-gradient(135deg,#FBBF24,#D4A537)",
            border:"none",borderRadius:12,color:"#1a1a1a",cursor:"pointer",
            boxShadow:"0 0 32px rgba(212,165,55,0.55),0 8px 24px rgba(0,0,0,0.5)",
            transition:"transform 0.18s",
          }} onMouseEnter={e=>(e.currentTarget.style.transform="scale(1.05)")}
             onMouseLeave={e=>(e.currentTarget.style.transform="scale(1)")}>
            ▶ PLAY R16 TEASER
          </button>
        </div>
      </div>
    );
  }

  // Playing scenes
  return (
    <div style={fullScreen}>
      <BackdropOrbs/>

      {scene === 1  && <Scene1Logo/>}
      {scene === 2  && <Scene2R32Recap matches={r32Matches} teamById={teamById}/>}
      {scene === 3  && <Scene3TopScorers scorers={topScorers} teamById={teamById}/>}
      {scene === 4  && <Scene4TopMOTMs motms={topMOTMs} teamById={teamById}/>}
      {scene === 5  && <Scene5R16/>}
      {scene === 6  && <Scene6DateTime/>}
      {scene === 7  && <Scene7Survivors teams={survivors}/>}
      {scene === 8  && r16Matches[h2hIndex] && (
        <Scene8H2H
          home={teamById(r16Matches[h2hIndex].home_id)}
          away={teamById(r16Matches[h2hIndex].away_id)}
          matchNum={r16Matches[h2hIndex].match_num}
          total={r16Matches.length}
          key={h2hIndex}
        />
      )}
      {scene === 9  && <Scene9BeThere/>}
      {scene === 10 && <Scene10End/>}

      <div style={cornerBadge}>CTWC 2026 · R16</div>

      <style>{globalCss}</style>
    </div>
  );
}

// ─── Constants ────────────────────────────────────────────────
const FONT = "'Inter','Segoe UI','Helvetica Neue',system-ui,sans-serif";
const fullScreen: React.CSSProperties = {
  position: "fixed", inset: 0,
  background: "radial-gradient(ellipse at 50% 50%, #0a1424 0%, #04060d 70%)",
  display: "flex", alignItems: "center", justifyContent: "center",
  overflow: "hidden",
  fontFamily: FONT,
};
const cornerBadge: React.CSSProperties = {
  position: "absolute", top: 24, right: 28,
  fontSize: 10, letterSpacing: 3, fontWeight: 700,
  color: "rgba(255,255,255,0.35)", zIndex: 100,
};

function BackdropOrbs() {
  return (
    <div style={{position:"absolute",inset:0,pointerEvents:"none",overflow:"hidden"}}>
      <div style={{position:"absolute",top:"-15%",right:"-10%",width:900,height:900,borderRadius:"50%",
        background:"radial-gradient(circle,rgba(212,165,55,0.10) 0%,transparent 60%)",
        animation:"orbFloat 8s ease-in-out infinite"}}/>
      <div style={{position:"absolute",bottom:"-20%",left:"-10%",width:700,height:700,borderRadius:"50%",
        background:"radial-gradient(circle,rgba(168,85,247,0.08) 0%,transparent 60%)",
        animation:"orbFloat 11s ease-in-out infinite reverse"}}/>
      <div style={{position:"absolute",inset:0,opacity:0.025,
        backgroundImage:"linear-gradient(rgba(255,255,255,0.1) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.1) 1px,transparent 1px)",
        backgroundSize:"60px 60px"}}/>
    </div>
  );
}

// ─── Scene 1: CTWC logo ───────────────────────────────────────
function Scene1Logo() {
  return (
    <div style={{textAlign:"center",position:"relative",zIndex:5,animation:"sceneIn 0.5s both"}}>
      <div style={{fontSize:14,letterSpacing:9,color:"#FBBF24",fontWeight:700,
        animation:"fadeUp 0.6s 0.1s both",marginBottom:14}}>SEASON 1</div>
      <div style={{fontSize:180,fontWeight:900,letterSpacing:-4,lineHeight:0.95,
        color:"#fff",textShadow:"0 0 80px rgba(212,165,55,0.6)",
        animation:"slamIn 0.7s cubic-bezier(0.34,1.56,0.64,1) both"}}>
        CT<span style={{background:"linear-gradient(180deg,#FBBF24 0%,#D4A537 100%)",
          WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",
          filter:"drop-shadow(0 0 32px rgba(212,165,55,0.5))"}}>WC</span>
      </div>
      <div style={{fontSize:24,letterSpacing:12,color:"rgba(255,255,255,0.45)",fontWeight:700,
        animation:"fadeUp 0.7s 0.5s both",marginTop:12}}>2026</div>
    </div>
  );
}

// ─── Scene 2: R32 Results Recap ───────────────────────────────
function Scene2R32Recap({ matches, teamById }: { matches: any[]; teamById: (id: string) => any }) {
  return (
    <div style={{position:"relative",zIndex:5,padding:"0 40px",width:"100%",animation:"sceneIn 0.4s both"}}>
      <div style={{textAlign:"center",marginBottom:24}}>
        <div style={{fontSize:11,letterSpacing:7,color:"rgba(255,255,255,0.5)",fontWeight:700,marginBottom:6}}>
          BRACKET RECAP
        </div>
        <div style={{fontSize:48,fontWeight:900,color:"#fff",letterSpacing:-1,
          animation:"slamIn 0.6s cubic-bezier(0.34,1.56,0.64,1) both",
          textShadow:"0 0 30px rgba(34,197,94,0.4)"}}>
          ROUND OF 32 <span style={{color:"#22C55E"}}>· COMPLETE</span>
        </div>
      </div>
      <div style={{
        display:"grid",
        gridTemplateColumns:"repeat(4,1fr)",
        gap:10,maxWidth:1280,margin:"0 auto",
      }}>
        {matches.slice(0, 16).map((m, i) => {
          const home = teamById(m.home_id);
          const away = teamById(m.away_id);
          if (!home || !away) return null;
          const homeWon = m.winner_id === m.home_id;
          const awayWon = m.winner_id === m.away_id;
          const data = m.match_data ?? {};
          const isForfeit = !!data.forfeit || !!data.bye;
          return (
            <div key={m.match_num} style={{
              padding:"10px 12px",borderRadius:8,
              background:"rgba(0,0,0,0.4)",
              border:"1px solid rgba(255,255,255,0.06)",
              animation:`teamPop 0.4s ${i * 0.08}s cubic-bezier(0.34,1.56,0.64,1) both`,
              display:"flex",flexDirection:"column",gap:5,
            }}>
              {/* Home */}
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",
                opacity: homeWon || (!homeWon && !awayWon) ? 1 : 0.4}}>
                <div style={{display:"flex",alignItems:"center",gap:6,minWidth:0,flex:1}}>
                  <span style={{fontSize:14,flexShrink:0}}>{home.emblem}</span>
                  <span style={{
                    fontSize:10,fontWeight:800,color:homeWon?"#22C55E":"#fff",
                    overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",
                  }}>{home.name}</span>
                </div>
                <span style={{fontSize:18,fontWeight:900,
                  color:homeWon?"#22C55E":"rgba(255,255,255,0.45)",
                  fontVariantNumeric:"tabular-nums"}}>{m.home_score ?? 0}</span>
              </div>
              {/* Away */}
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",
                opacity: awayWon || (!homeWon && !awayWon) ? 1 : 0.4}}>
                <div style={{display:"flex",alignItems:"center",gap:6,minWidth:0,flex:1}}>
                  <span style={{fontSize:14,flexShrink:0}}>{away.emblem}</span>
                  <span style={{
                    fontSize:10,fontWeight:800,color:awayWon?"#22C55E":"#fff",
                    overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",
                  }}>{away.name}</span>
                </div>
                <span style={{fontSize:18,fontWeight:900,
                  color:awayWon?"#22C55E":"rgba(255,255,255,0.45)",
                  fontVariantNumeric:"tabular-nums"}}>{m.away_score ?? 0}</span>
              </div>
              {isForfeit && (
                <div style={{fontSize:7,fontWeight:700,letterSpacing:1.5,
                  color:"#F87171",textAlign:"center"}}>FORFEIT</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Scene 3: Top Scorers ─────────────────────────────────────
function Scene3TopScorers({ scorers, teamById }: { scorers: any[]; teamById: (id: string) => any }) {
  return (
    <div style={{position:"relative",zIndex:5,padding:"0 60px",width:"100%",animation:"sceneIn 0.4s both"}}>
      <div style={{textAlign:"center",marginBottom:42}}>
        <div style={{fontSize:11,letterSpacing:7,color:"rgba(255,255,255,0.5)",fontWeight:700,marginBottom:6}}>
          AFTER ROUND 32
        </div>
        <div style={{fontSize:54,fontWeight:900,color:"#fff",letterSpacing:-1,
          animation:"slamIn 0.55s cubic-bezier(0.34,1.56,0.64,1) both"}}>
          ⚽ <span style={{background:"linear-gradient(180deg,#FBBF24 0%,#D4A537 100%)",
            WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"}}>TOP SCORERS</span>
        </div>
      </div>
      <div style={{
        display:"flex",justifyContent:"center",alignItems:"flex-end",gap:24,maxWidth:1100,margin:"0 auto",
      }}>
        {scorers.map((s, i) => {
          const team = teamById(s.teamId);
          const podiumColor = i === 0 ? "#FBBF24" : i === 1 ? "#C0C0C0" : "#CD7F32";
          const podiumIcon  = i === 0 ? "🥇" : i === 1 ? "🥈" : "🥉";
          const scale = i === 0 ? 1.1 : i === 1 ? 1 : 0.92;
          return (
            <div key={s.handle} style={{
              flex:`0 0 ${i === 0 ? 280 : 240}px`,
              animation:`teamPop 0.5s ${i * 0.3}s cubic-bezier(0.34,1.56,0.64,1) both`,
              textAlign:"center",
              transform:`scale(${scale})`,
            }}>
              <div style={{fontSize:i===0?46:36,marginBottom:8}}>{podiumIcon}</div>
              <div style={{
                padding:"24px 16px",borderRadius:14,
                background:`linear-gradient(135deg,${podiumColor}33,${podiumColor}10)`,
                border:`2px solid ${podiumColor}`,
                boxShadow:`0 0 30px ${podiumColor}55, 0 12px 30px rgba(0,0,0,0.6)`,
              }}>
                <div style={{
                  width:i===0?100:84,height:i===0?100:84,borderRadius:"50%",
                  background:`linear-gradient(135deg,${team?.color ?? "#888"},${team?.color ?? "#666"}aa)`,
                  display:"flex",alignItems:"center",justifyContent:"center",
                  fontSize:i===0?42:34,fontWeight:900,color:"#fff",margin:"0 auto 12px",
                  border:`3px solid ${podiumColor}`,
                  boxShadow:`0 0 18px ${team?.color ?? "#888"}aa`,
                }}>{(s.name?.[0] ?? "?").toUpperCase()}</div>
                <div style={{fontSize:i===0?20:16,fontWeight:900,color:"#fff",letterSpacing:0.3,
                  overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                  {s.name}
                </div>
                {team && (
                  <div style={{fontSize:11,fontWeight:700,color:team.color,marginTop:3,letterSpacing:0.5}}>
                    {team.emblem} {team.name}
                  </div>
                )}
                <div style={{marginTop:14,display:"flex",justifyContent:"center",alignItems:"baseline",gap:7}}>
                  <span style={{fontSize:i===0?60:48,fontWeight:900,color:podiumColor,lineHeight:1,
                    textShadow:`0 0 20px ${podiumColor}99`,fontVariantNumeric:"tabular-nums"}}>
                    {s.goals}
                  </span>
                  <span style={{fontSize:11,fontWeight:700,letterSpacing:2,color:"rgba(255,255,255,0.55)",textTransform:"uppercase"}}>
                    GOAL{s.goals === 1 ? "" : "S"}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
        {scorers.length === 0 && (
          <div style={{color:"rgba(255,255,255,0.4)",fontSize:14}}>No goals scored in R32</div>
        )}
      </div>
    </div>
  );
}

// ─── Scene 4: Top MOTMs ───────────────────────────────────────
function Scene4TopMOTMs({ motms, teamById }: { motms: any[]; teamById: (id: string) => any }) {
  return (
    <div style={{position:"relative",zIndex:5,padding:"0 60px",width:"100%",animation:"sceneIn 0.4s both"}}>
      <div style={{textAlign:"center",marginBottom:42}}>
        <div style={{fontSize:11,letterSpacing:7,color:"rgba(255,255,255,0.5)",fontWeight:700,marginBottom:6}}>
          AFTER ROUND 32
        </div>
        <div style={{fontSize:54,fontWeight:900,color:"#fff",letterSpacing:-1,
          animation:"slamIn 0.55s cubic-bezier(0.34,1.56,0.64,1) both"}}>
          ⭐ <span style={{background:"linear-gradient(180deg,#FBBF24 0%,#D4A537 100%)",
            WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"}}>MAN OF THE MATCH</span>
        </div>
      </div>
      <div style={{display:"flex",justifyContent:"center",alignItems:"flex-end",gap:24,maxWidth:1100,margin:"0 auto"}}>
        {motms.map((m, i) => {
          const team = teamById(m.teamId);
          const podiumColor = i === 0 ? "#FBBF24" : i === 1 ? "#C0C0C0" : "#CD7F32";
          const podiumIcon  = i === 0 ? "🥇" : i === 1 ? "🥈" : "🥉";
          const scale = i === 0 ? 1.1 : i === 1 ? 1 : 0.92;
          return (
            <div key={m.handle} style={{
              flex:`0 0 ${i === 0 ? 280 : 240}px`,
              animation:`teamPop 0.5s ${i * 0.3}s cubic-bezier(0.34,1.56,0.64,1) both`,
              textAlign:"center",
              transform:`scale(${scale})`,
            }}>
              <div style={{fontSize:i===0?46:36,marginBottom:8}}>{podiumIcon}</div>
              <div style={{
                padding:"24px 16px",borderRadius:14,
                background:`linear-gradient(135deg,${podiumColor}33,${podiumColor}10)`,
                border:`2px solid ${podiumColor}`,
                boxShadow:`0 0 30px ${podiumColor}55, 0 12px 30px rgba(0,0,0,0.6)`,
              }}>
                <div style={{
                  width:i===0?100:84,height:i===0?100:84,borderRadius:"50%",
                  background:`linear-gradient(135deg,${team?.color ?? "#888"},${team?.color ?? "#666"}aa)`,
                  display:"flex",alignItems:"center",justifyContent:"center",
                  fontSize:i===0?42:34,fontWeight:900,color:"#fff",margin:"0 auto 12px",
                  border:`3px solid ${podiumColor}`,
                  boxShadow:`0 0 18px ${team?.color ?? "#888"}aa`,
                }}>⭐</div>
                <div style={{fontSize:i===0?20:16,fontWeight:900,color:"#fff",letterSpacing:0.3,
                  overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                  {m.name}
                </div>
                {team && (
                  <div style={{fontSize:11,fontWeight:700,color:team.color,marginTop:3,letterSpacing:0.5}}>
                    {team.emblem} {team.name}
                  </div>
                )}
                <div style={{marginTop:14,display:"flex",justifyContent:"center",alignItems:"baseline",gap:7}}>
                  <span style={{fontSize:i===0?60:48,fontWeight:900,color:podiumColor,lineHeight:1,
                    textShadow:`0 0 20px ${podiumColor}99`,fontVariantNumeric:"tabular-nums"}}>
                    {m.awards}
                  </span>
                  <span style={{fontSize:11,fontWeight:700,letterSpacing:2,color:"rgba(255,255,255,0.55)",textTransform:"uppercase"}}>
                    AWARD{m.awards === 1 ? "" : "S"}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
        {motms.length === 0 && (
          <div style={{color:"rgba(255,255,255,0.4)",fontSize:14}}>No MOTMs recorded in R32</div>
        )}
      </div>
    </div>
  );
}

// ─── Scene 5: ROUND OF 16 ─────────────────────────────────────
function Scene5R16() {
  return (
    <div style={{textAlign:"center",position:"relative",zIndex:5}}>
      <div style={{position:"absolute",inset:-1000,background:"rgba(255,255,255,0.6)",
        animation:"flash 0.35s ease-out forwards",zIndex:-1}}/>
      <div style={{fontSize:13,letterSpacing:8,color:"#FBBF24",fontWeight:700,marginBottom:24,
        animation:"fadeUp 0.5s 0.3s both"}}>HALF THE FIELD · STAKES DOUBLE</div>
      <div style={{fontSize:160,fontWeight:900,letterSpacing:-3,color:"#fff",lineHeight:0.95,
        animation:"slamShake 0.7s cubic-bezier(0.34,1.56,0.64,1) both",
        textShadow:"0 0 60px rgba(212,165,55,0.55), 0 10px 40px rgba(0,0,0,0.8)"}}>
        ROUND OF<br/>
        <span style={{fontSize:240,
          background:"linear-gradient(180deg,#FBBF24 0%,#D4A537 70%,#7a5e1d 100%)",
          WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",
          filter:"drop-shadow(0 0 36px rgba(212,165,55,0.7))",letterSpacing:-12}}>16</span>
      </div>
    </div>
  );
}

// ─── Scene 6: Date & Time ─────────────────────────────────────
function Scene6DateTime() {
  return (
    <div style={{textAlign:"center",position:"relative",zIndex:5,animation:"sceneIn 0.5s both"}}>
      <div style={{fontSize:13,letterSpacing:6,color:"#FBBF24",fontWeight:700,marginBottom:32,
        animation:"fadeUp 0.5s 0.1s both"}}>KICKOFF</div>
      <div style={{fontSize:72,fontWeight:900,color:"#fff",letterSpacing:-1,lineHeight:1.05,
        animation:"fadeUp 0.5s 0.25s both",marginBottom:30}}>
        TUESDAY<br/>26 MAY
      </div>
      <div style={{display:"inline-flex",alignItems:"center",gap:18,
        padding:"22px 48px",borderRadius:18,
        background:"rgba(212,165,55,0.12)",border:"2px solid rgba(212,165,55,0.5)",
        boxShadow:"0 0 36px rgba(212,165,55,0.4)",
        animation:"fadeUp 0.5s 0.4s both, glowPulse 1.5s 0.4s ease-in-out infinite"}}>
        <span style={{fontSize:48}}>🕗</span>
        <span style={{fontSize:64,fontWeight:900,letterSpacing:1,color:"#FBBF24",
          fontVariantNumeric:"tabular-nums",
          textShadow:"0 0 28px rgba(212,165,55,0.7)"}}>8:00 PM UTC</span>
      </div>
      <div style={{fontSize:13,letterSpacing:3,color:"rgba(255,255,255,0.4)",marginTop:24,
        animation:"fadeUp 0.5s 0.6s both"}}>
        STATS REFRESH FROM YOUR LIVE X ACTIVITY · 1 HR BEFORE KICKOFF
      </div>
    </div>
  );
}

// ─── Scene 7: Survivors cascade ───────────────────────────────
function Scene7Survivors({ teams }: { teams: Team[] }) {
  return (
    <div style={{position:"relative",zIndex:5,width:"100%",padding:"0 60px",animation:"sceneIn 0.4s both"}}>
      <div style={{textAlign:"center",marginBottom:36}}>
        <div style={{fontSize:11,letterSpacing:7,color:"rgba(255,255,255,0.5)",fontWeight:700,marginBottom:6}}>
          16 SQUADS REMAIN
        </div>
        <div style={{fontSize:42,fontWeight:900,color:"#22C55E",letterSpacing:-0.5,
          textShadow:"0 0 28px rgba(34,197,94,0.5)"}}>
          ✓ ADVANCED TO R16
        </div>
      </div>
      <div style={{
        display:"grid",gridTemplateColumns:"repeat(8,1fr)",gap:14,
        maxWidth:1280,margin:"0 auto",
      }}>
        {teams.slice(0, 16).map((t, i) => (
          <div key={t.id} style={{
            padding:"14px 8px",borderRadius:10,
            background:`linear-gradient(135deg,${t.color}33,${t.color}11)`,
            border:`1.5px solid ${t.color}88`,
            display:"flex",flexDirection:"column",alignItems:"center",gap:6,
            animation:`teamPop 0.4s ${i * 0.06}s cubic-bezier(0.34,1.56,0.64,1) both`,
            boxShadow:`0 0 18px ${t.color}33`,
          }}>
            <div style={{fontSize:26}}>{t.emblem}</div>
            <div style={{fontSize:9,fontWeight:800,color:t.color,letterSpacing:0.3,
              textAlign:"center",lineHeight:1.2,
              overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",width:"100%"}}>
              {t.name}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Scene 8: H2H ─────────────────────────────────────────────
function Scene8H2H({ home, away, matchNum, total }:
  { home?: Team; away?: Team; matchNum: number; total: number }) {
  if (!home || !away) return null;
  return (
    <div style={{position:"relative",zIndex:5,width:"100%",padding:"0 80px",animation:"sceneIn 0.3s both"}}>
      <div style={{position:"absolute",top:-160,left:"50%",transform:"translateX(-50%)",
        fontSize:12,letterSpacing:4,color:"rgba(255,255,255,0.4)",fontWeight:700}}>
        MATCH {matchNum} OF {total}
      </div>
      <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:60,maxWidth:1400,margin:"0 auto"}}>
        <div style={{flex:"0 0 480px",animation:"slideLeft 0.55s cubic-bezier(0.22,1,0.36,1) both"}}>
          <TeamCard team={home}/>
        </div>
        <div style={{position:"relative",animation:"vsAppear 0.6s 0.35s cubic-bezier(0.34,1.56,0.64,1) both"}}>
          <div style={{position:"absolute",inset:-30,
            background:"radial-gradient(circle,rgba(212,165,55,0.3) 0%,transparent 70%)",
            borderRadius:"50%",animation:"glowPulse 1.2s ease-in-out infinite"}}/>
          <div style={{fontSize:120,fontWeight:900,color:"#fff",letterSpacing:-2,
            background:"linear-gradient(180deg,#FBBF24 0%,#D4A537 100%)",
            WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",
            filter:"drop-shadow(0 0 24px rgba(212,165,55,0.7))",
            position:"relative",zIndex:1}}>VS</div>
        </div>
        <div style={{flex:"0 0 480px",animation:"slideRight 0.55s 0.15s cubic-bezier(0.22,1,0.36,1) both"}}>
          <TeamCard team={away}/>
        </div>
      </div>
    </div>
  );
}

function TeamCard({ team }: { team: Team }) {
  return (
    <div style={{
      padding:"36px 30px",borderRadius:18,
      background:`linear-gradient(135deg,${team.color}30,${team.color}08)`,
      border:`2.5px solid ${team.color}`,
      boxShadow:`0 0 50px ${team.color}55, 0 12px 40px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.08)`,
      display:"flex",flexDirection:"column",alignItems:"center",gap:18,
      animation:"floatLite 2s ease-in-out infinite",
    }}>
      <div style={{
        width:140,height:140,borderRadius:"50%",
        background:`linear-gradient(135deg,${team.color},${team.color}aa)`,
        display:"flex",alignItems:"center",justifyContent:"center",
        fontSize:84,
        boxShadow:`0 0 24px ${team.color}88, inset 0 0 30px rgba(255,255,255,0.1)`,
        border:`3px solid ${team.color}`,
      }}>{team.emblem}</div>
      <div style={{fontSize:28,fontWeight:900,color:"#fff",letterSpacing:0.8,textAlign:"center",
        textShadow:`0 0 24px ${team.color}88`,maxWidth:420,overflow:"hidden",
        textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
        {team.name.toUpperCase()}
      </div>
    </div>
  );
}

// ─── Scene 9: BE THERE ────────────────────────────────────────
function Scene9BeThere() {
  return (
    <div style={{textAlign:"center",position:"relative",zIndex:5,animation:"sceneIn 0.5s both"}}>
      <div style={{fontSize:11,letterSpacing:8,color:"#FBBF24",fontWeight:700,marginBottom:24,
        animation:"fadeUp 0.5s 0.05s both"}}>TUE 26 MAY · 8PM UTC</div>
      <div style={{fontSize:200,fontWeight:900,letterSpacing:-4,color:"#fff",lineHeight:0.95,
        animation:"slamIn 0.7s 0.15s cubic-bezier(0.34,1.56,0.64,1) both",
        background:"linear-gradient(180deg,#fff 0%,#FBBF24 70%,#D4A537 100%)",
        WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",
        filter:"drop-shadow(0 0 50px rgba(212,165,55,0.7))",marginBottom:30}}>
        BE THERE
      </div>
      <div style={{fontSize:48,fontWeight:900,color:"#FBBF24",letterSpacing:1.5,
        animation:"fadeUp 0.5s 0.55s both",
        textShadow:"0 0 32px rgba(212,165,55,0.6)"}}>
        ctworldcup.xyz
      </div>
      <div style={{marginTop:30,fontSize:14,letterSpacing:4,color:"rgba(255,255,255,0.5)",
        animation:"fadeUp 0.5s 0.85s both"}}>
        8 MATCHES · 1 BRACKET · LIVE STAT REFRESH
      </div>
    </div>
  );
}

// ─── Scene 10: End ────────────────────────────────────────────
function Scene10End() {
  return (
    <div style={{position:"absolute",inset:0,background:"#000",
      animation:"fadeIn 1.5s both",zIndex:1000,
      display:"flex",alignItems:"center",justifyContent:"center"}}>
      <div style={{fontSize:11,letterSpacing:6,color:"rgba(255,255,255,0.4)",animation:"fadeUp 1s 0.4s both"}}>
        SEE YOU AT KICKOFF
      </div>
    </div>
  );
}

// ─── CSS ──────────────────────────────────────────────────────
const globalCss = `
  body { margin: 0; background: #000; }
  @keyframes fadeUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
  @keyframes sceneIn { from { opacity: 0; } to { opacity: 1; } }
  @keyframes slamIn { 0% { opacity: 0; transform: scale(0.5); } 60% { opacity: 1; transform: scale(1.05); } 100% { transform: scale(1); } }
  @keyframes slamShake {
    0%   { opacity: 0; transform: scale(0.6); }
    40%  { opacity: 1; transform: scale(1.08); }
    50%  { transform: scale(1.02) translateX(-6px); }
    60%  { transform: scale(1.04) translateX(6px); }
    70%  { transform: scale(1.0) translateX(-3px); }
    80%  { transform: scale(1.0) translateX(3px); }
    100% { transform: scale(1) translateX(0); }
  }
  @keyframes flash { 0% { opacity: 0.85; } 100% { opacity: 0; } }
  @keyframes glowPulse { 0%, 100% { box-shadow: 0 0 36px rgba(212,165,55,0.4); } 50% { box-shadow: 0 0 64px rgba(212,165,55,0.8); } }
  @keyframes orbFloat { 0%, 100% { transform: translateY(0) scale(1); } 50% { transform: translateY(-30px) scale(1.06); } }
  @keyframes teamPop { 0% { opacity: 0; transform: scale(0.5) rotate(-8deg); } 100% { opacity: 1; transform: scale(1) rotate(0); } }
  @keyframes slideLeft  { 0% { opacity: 0; transform: translateX(-150px); } 100% { opacity: 1; transform: translateX(0); } }
  @keyframes slideRight { 0% { opacity: 0; transform: translateX(150px); } 100% { opacity: 1; transform: translateX(0); } }
  @keyframes vsAppear { 0% { opacity: 0; transform: scale(2) rotate(180deg); } 100% { opacity: 1; transform: scale(1) rotate(0); } }
  @keyframes floatLite { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
`;
