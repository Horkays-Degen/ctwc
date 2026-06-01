"use client";

// CTWC QF Teaser — cinematic broadcast preview (~75s).
//
// Focus: the LIVE WATCH PARTY angle — this round is the first where
// everyone watches the simulation together in real-time at /watch.
//
// Sequence:
//   0–4s    EXPLOSIVE INTRO — title card slam with riser
//   4–10s   THE JOURNEY — 32 → 16 → 8 squad funnel animation
//   10–18s  TOP SCORERS leaderboard (gold podium)
//   18–24s  MAN OF THE MATCH leaderboard
//   24–28s  QUARTER FINALS slam reveal
//   28–34s  "WATCH IT LIVE — together" — broadcast feature reveal
//   34–38s  TUE 2 JUNE · 8PM UTC
//   38–58s  4 H2H matchups (5s each)
//   58–66s  "BE THERE — ctworldcup.xyz/watch"
//   66–75s  Fade to black with sting

import { useEffect, useRef, useState, useMemo } from "react";

// ── Audio engine ──────────────────────────────────────────────
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
  const buf = c.createBuffer(2, sr * 3, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  _noiseBuf = buf;
}

// Cinematic riser — pitch sweeps up + filter sweeps up + crescendo
function riser(durMs = 2500) {
  const c = ctx(); if (!c) return; buildNoise(); if (!_noiseBuf) return;
  const dur = durMs / 1000;
  // Noise sweep
  const src = c.createBufferSource(); src.buffer = _noiseBuf;
  const flt = c.createBiquadFilter(); flt.type = "bandpass"; flt.Q.value = 4;
  flt.frequency.setValueAtTime(200, c.currentTime);
  flt.frequency.exponentialRampToValueAtTime(8000, c.currentTime + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0, c.currentTime);
  g.gain.linearRampToValueAtTime(0.15, c.currentTime + dur * 0.7);
  g.gain.linearRampToValueAtTime(0.35, c.currentTime + dur);
  src.connect(flt); flt.connect(g); g.connect(c.destination);
  src.start(); src.stop(c.currentTime + dur + 0.1);
  // Pitched tone sweep underneath
  const o = c.createOscillator(); const og = c.createGain();
  o.type = "sawtooth";
  o.frequency.setValueAtTime(80, c.currentTime);
  o.frequency.exponentialRampToValueAtTime(1200, c.currentTime + dur);
  og.gain.setValueAtTime(0, c.currentTime);
  og.gain.linearRampToValueAtTime(0.08, c.currentTime + dur * 0.5);
  og.gain.linearRampToValueAtTime(0.18, c.currentTime + dur);
  o.connect(og); og.connect(c.destination);
  o.start(); o.stop(c.currentTime + dur + 0.05);
}

// Deep cinematic impact — used after risers
function impact() {
  const c = ctx(); if (!c) return; buildNoise(); if (!_noiseBuf) return;
  // Sub bass
  const o = c.createOscillator(); const og = c.createGain();
  o.type = "sine"; o.frequency.setValueAtTime(60, c.currentTime);
  o.frequency.exponentialRampToValueAtTime(28, c.currentTime + 0.8);
  og.gain.setValueAtTime(0.7, c.currentTime);
  og.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 1.0);
  o.connect(og); og.connect(c.destination);
  o.start(); o.stop(c.currentTime + 1.0);
  // Noise punch
  const src = c.createBufferSource(); src.buffer = _noiseBuf;
  const flt = c.createBiquadFilter(); flt.type = "lowpass"; flt.frequency.value = 400;
  const g = c.createGain();
  g.gain.setValueAtTime(0.6, c.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.6);
  src.connect(flt); flt.connect(g); g.connect(c.destination);
  src.start(); src.stop(c.currentTime + 0.7);
}

// Quick swoosh transition
function swoosh() {
  const c = ctx(); if (!c) return; buildNoise(); if (!_noiseBuf) return;
  const src = c.createBufferSource(); src.buffer = _noiseBuf;
  const flt = c.createBiquadFilter(); flt.type = "bandpass"; flt.Q.value = 5;
  flt.frequency.setValueAtTime(500, c.currentTime);
  flt.frequency.exponentialRampToValueAtTime(5000, c.currentTime + 0.35);
  const g = c.createGain();
  g.gain.setValueAtTime(0, c.currentTime);
  g.gain.linearRampToValueAtTime(0.22, c.currentTime + 0.05);
  g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.4);
  src.connect(flt); flt.connect(g); g.connect(c.destination);
  src.start(); src.stop(c.currentTime + 0.42);
}

// Orchestral stab — used on team reveals
function stab(pitch = 110) {
  const c = ctx(); if (!c) return;
  [pitch, pitch * 1.5, pitch * 2].forEach((freq, i) => {
    const o = c.createOscillator(); const g = c.createGain();
    o.type = i === 0 ? "sawtooth" : "triangle";
    o.frequency.setValueAtTime(freq, c.currentTime);
    g.gain.setValueAtTime(0, c.currentTime + i * 0.01);
    g.gain.linearRampToValueAtTime(0.18 / (i + 1), c.currentTime + i * 0.01 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.45);
    o.connect(g); g.connect(c.destination);
    o.start(c.currentTime + i * 0.01); o.stop(c.currentTime + 0.5);
  });
}

// Crowd roar
function crowdRoar(dur = 2.0, intensity = 1) {
  const c = ctx(); if (!c) return; buildNoise(); if (!_noiseBuf) return;
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
}

function whistle() {
  const c = ctx(); if (!c) return;
  const o = c.createOscillator(); const g = c.createGain();
  o.type = "triangle"; o.frequency.setValueAtTime(2600, c.currentTime);
  g.gain.setValueAtTime(0, c.currentTime);
  g.gain.linearRampToValueAtTime(0.18, c.currentTime + 0.02);
  g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.24);
  o.connect(g); g.connect(c.destination);
  o.start(); o.stop(c.currentTime + 0.26);
}

// ─── Page ─────────────────────────────────────────────────────
interface Team { id: string; name: string; color: string; emblem: string; logo_img?: string | null; }
interface Match { round_num: number; match_num: number; status: string; home_id: string; away_id: string;
  home_score: number | null; away_score: number | null; winner_id: string | null; match_data?: any; }

export default function TeaserQFPage() {
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
        setMatches((data.matches ?? []) as Match[]);
        setPhase("ready");
      } catch (e) { console.error(e); setPhase("ready"); }
    })();
  }, []);

  const teamById = (id: string) => teams.find(t => t.id === id);
  const r16Matches = useMemo(() => matches.filter(m => m.round_num === 2 && m.status === "complete")
    .sort((a, b) => a.match_num - b.match_num), [matches]);
  const qfMatches = useMemo(() => matches.filter(m => m.round_num === 3)
    .sort((a, b) => a.match_num - b.match_num), [matches]);
  const qfTeams = useMemo(() => {
    const winnerIds = r16Matches.map(m => m.winner_id).filter(Boolean);
    return winnerIds.map(id => teamById(id!)).filter(Boolean) as Team[];
  }, [r16Matches, teams]);

  // Aggregate top scorers + MOTMs across R32 + R16
  const topScorers = useMemo(() => {
    const counts: Record<string, { handle: string; name: string; goals: number; teamId: string }> = {};
    matches.filter(m => m.status === "complete" && (m.round_num === 1 || m.round_num === 2)).forEach(m => {
      const events: any[] = m.match_data?.events ?? [];
      events.forEach(e => {
        if ((e.type ?? "goal") !== "goal") return;
        const teamId = e.team === "home" ? m.home_id : m.away_id;
        if (!counts[e.scorer]) counts[e.scorer] = { handle: e.scorer, name: e.scorerName, goals: 0, teamId };
        counts[e.scorer].goals += 1;
      });
    });
    return Object.values(counts).sort((a, b) => b.goals - a.goals).slice(0, 3);
  }, [matches]);

  const topMOTMs = useMemo(() => {
    const counts: Record<string, { handle: string; name: string; awards: number; teamId: string }> = {};
    matches.filter(m => m.status === "complete" && (m.round_num === 1 || m.round_num === 2)).forEach(m => {
      const motm = m.match_data?.motm;
      if (!motm) return;
      const teamId = motm.team === "home" ? m.home_id : m.away_id;
      if (!counts[motm.handle]) counts[motm.handle] = { handle: motm.handle, name: motm.displayName, awards: 0, teamId };
      counts[motm.handle].awards += 1;
    });
    return Object.values(counts).sort((a, b) => b.awards - a.awards).slice(0, 3);
  }, [matches]);

  const runSequence = () => {
    setPhase("playing");
    buildNoise();
    const add = (ms: number, fn: () => void) => {
      const id = setTimeout(fn, ms);
      timersRef.current.push(id);
    };

    // 0–4s: explosive intro
    setScene(1);
    add(0,    () => riser(2200));
    add(2200, () => impact());

    // 4–10s: journey funnel 32→16→8
    add(4000, () => { setScene(2); swoosh(); });
    add(4400, () => swoosh());
    add(5200, () => swoosh());
    add(6000, () => stab(110));
    add(6900, () => stab(120));
    add(7800, () => stab(140));

    // 10–18s: TOP SCORERS
    add(10000, () => { setScene(3); swoosh(); });
    add(10300, () => stab(146));
    add(10600, () => stab(146));
    add(10900, () => stab(180));

    // 18–24s: TOP MOTMs
    add(14500, () => { setScene(4); swoosh(); });
    add(14800, () => stab(146));
    add(15100, () => stab(146));
    add(15400, () => stab(180));

    // 24–28s: QUARTER FINALS slam
    add(19000, () => { setScene(5); riser(800); });
    add(19800, () => impact());

    // 28–34s: WATCH IT LIVE — broadcast feature
    add(22500, () => { setScene(6); swoosh(); });
    add(22800, () => crowdRoar(2.0, 0.7));

    // 34–38s: DATE/TIME
    add(27500, () => { setScene(7); swoosh(); });

    // 38–58s: H2H — 4 matches × 5s
    const H2H_START = 31500;
    const H2H_DUR = 5000;
    const totalH2H = Math.max(1, qfMatches.length || 4);
    for (let i = 0; i < totalH2H; i++) {
      const t0 = H2H_START + i * H2H_DUR;
      add(t0,        () => { setScene(8); setH2hIndex(i); swoosh(); });
      add(t0 + 600,  () => stab(120 + i * 10));
      add(t0 + 1800, () => stab(180 + i * 10));
      add(t0 + 3500, () => whistle());
    }

    // 58–66s: BE THERE
    const CLOSE = H2H_START + totalH2H * H2H_DUR;
    add(CLOSE,        () => { setScene(9); riser(1500); });
    add(CLOSE + 1500, () => { impact(); crowdRoar(3.0, 1); });

    // Fade
    add(CLOSE + 7500, () => { setScene(10); });
  };

  useEffect(() => () => { timersRef.current.forEach(clearTimeout); }, []);

  if (phase === "loading") {
    return <FullScreen><div style={loadingStyle}>LOADING QF DATA…</div></FullScreen>;
  }

  if (phase === "ready") {
    return (
      <FullScreen>
        <div style={{textAlign:"center",fontFamily:FONT}}>
          <div style={{fontSize:11,letterSpacing:5,color:"rgba(255,255,255,0.5)",marginBottom:14}}>
            CTWC 2026 · QF TEASER
          </div>
          <div style={{fontSize:54,fontWeight:900,color:"#fff",letterSpacing:-1,marginBottom:8}}>
            Cinematic. Loud. Live.
          </div>
          <div style={{fontSize:14,color:"rgba(255,255,255,0.5)",marginBottom:32,maxWidth:560,lineHeight:1.6}}>
            ~75 seconds. Click PLAY, hit record.<br/>
            <b style={{color:"#FBBF24"}}>{r16Matches.length}</b> R16 results, <b style={{color:"#FBBF24"}}>{qfTeams.length}</b> QF squads, <b style={{color:"#FBBF24"}}>{qfMatches.length}</b> QF fixtures, <b style={{color:"#FBBF24"}}>{topScorers.length}</b> scorers, <b style={{color:"#FBBF24"}}>{topMOTMs.length}</b> MOTMs.
          </div>
          <button onClick={runSequence} style={playBtnStyle}
            onMouseEnter={e=>(e.currentTarget.style.transform="scale(1.05)")}
            onMouseLeave={e=>(e.currentTarget.style.transform="scale(1)")}>
            ▶ PLAY QF TEASER
          </button>
        </div>
      </FullScreen>
    );
  }

  return (
    <FullScreen>
      <Backdrop/>

      {scene === 1 && <SceneIntro/>}
      {scene === 2 && <SceneJourney/>}
      {scene === 3 && <ScenePodium title="TOP SCORERS" subtitle="AFTER R16" icon="⚽" items={topScorers.map(s => ({...s, value: s.goals, valueLabel: s.goals === 1 ? "GOAL" : "GOALS"}))} teamById={teamById}/>}
      {scene === 4 && <ScenePodium title="MAN OF THE MATCH" subtitle="AFTER R16" icon="⭐" items={topMOTMs.map(m => ({...m, value: m.awards, valueLabel: m.awards === 1 ? "AWARD" : "AWARDS"}))} teamById={teamById}/>}
      {scene === 5 && <SceneQFSlam/>}
      {scene === 6 && <SceneWatchLive/>}
      {scene === 7 && <SceneDate/>}
      {scene === 8 && qfMatches[h2hIndex] && (
        <SceneH2H
          home={teamById(qfMatches[h2hIndex].home_id)}
          away={teamById(qfMatches[h2hIndex].away_id)}
          matchNum={qfMatches[h2hIndex].match_num}
          total={qfMatches.length}
          key={h2hIndex}
        />
      )}
      {scene === 9 && <SceneBeThere/>}
      {scene === 10 && <SceneEnd/>}

      <div style={cornerBadge}>CTWC · QF</div>
      <style>{globalCss}</style>
    </FullScreen>
  );
}

const FONT = "'Inter','Segoe UI','Helvetica Neue',system-ui,sans-serif";
const loadingStyle: React.CSSProperties = { color:"rgba(255,255,255,0.5)", fontSize:14, letterSpacing:3, fontFamily:FONT };
const playBtnStyle: React.CSSProperties = {
  padding:"18px 52px",fontSize:18,fontWeight:800,letterSpacing:3,
  background:"linear-gradient(135deg,#FBBF24,#D4A537)",
  border:"none",borderRadius:12,color:"#1a1a1a",cursor:"pointer",
  boxShadow:"0 0 32px rgba(212,165,55,0.55),0 8px 24px rgba(0,0,0,0.5)",
  transition:"transform 0.18s",
};
const cornerBadge: React.CSSProperties = {
  position: "absolute", top: 24, right: 28,
  fontSize: 10, letterSpacing: 3, fontWeight: 700,
  color: "rgba(255,255,255,0.35)", zIndex: 100,
};

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

function Backdrop() {
  return (
    <div style={{position:"absolute",inset:0,pointerEvents:"none",overflow:"hidden"}}>
      <div style={{position:"absolute",top:"-15%",right:"-10%",width:900,height:900,borderRadius:"50%",
        background:"radial-gradient(circle,rgba(212,165,55,0.10) 0%,transparent 60%)",
        animation:"orbFloat 8s ease-in-out infinite"}}/>
      <div style={{position:"absolute",bottom:"-20%",left:"-10%",width:700,height:700,borderRadius:"50%",
        background:"radial-gradient(circle,rgba(239,68,68,0.08) 0%,transparent 60%)",
        animation:"orbFloat 11s ease-in-out infinite reverse"}}/>
      <div style={{position:"absolute",inset:0,opacity:0.025,
        backgroundImage:"linear-gradient(rgba(255,255,255,0.1) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.1) 1px,transparent 1px)",
        backgroundSize:"60px 60px"}}/>
    </div>
  );
}

// ─── Scene 1: Explosive intro ─────────────────────────────────
function SceneIntro() {
  return (
    <div style={{textAlign:"center",position:"relative",zIndex:5}}>
      <div style={{position:"absolute",inset:-1000,
        background:"radial-gradient(circle,rgba(255,255,255,0.5) 0%,transparent 50%)",
        animation:"flashWhite 0.9s ease-out forwards",zIndex:-1}}/>
      <div style={{fontSize:14,letterSpacing:10,color:"#FBBF24",fontWeight:700,
        animation:"fadeUp 0.6s 0.1s both",marginBottom:14}}>SEASON 1</div>
      <div style={{fontSize:200,fontWeight:900,letterSpacing:-5,lineHeight:0.92,
        color:"#fff",textShadow:"0 0 100px rgba(212,165,55,0.7), 0 0 30px rgba(255,255,255,0.4)",
        animation:"slamCinema 1.4s cubic-bezier(0.34,1.56,0.64,1) both"}}>
        CT<span style={{background:"linear-gradient(180deg,#FBBF24 0%,#D4A537 100%)",
          WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",
          filter:"drop-shadow(0 0 32px rgba(212,165,55,0.5))"}}>WC</span>
      </div>
      <div style={{fontSize:30,letterSpacing:18,color:"rgba(255,255,255,0.55)",fontWeight:700,
        animation:"fadeUp 0.7s 0.6s both",marginTop:20}}>2026</div>
    </div>
  );
}

// ─── Scene 2: Journey funnel 32 → 16 → 8 ──────────────────────
function SceneJourney() {
  const stages = [
    { count: 32, label: "TEAMS ENTERED", color: "#9CA3AF" },
    { count: 16, label: "SURVIVED R32",  color: "#60A5FA" },
    { count: 8,  label: "REACHED R16",   color: "#22C55E" },
    { count: 8,  label: "FACE OFF NOW",  color: "#FBBF24" },
  ];
  return (
    <div style={{textAlign:"center",position:"relative",zIndex:5,padding:"0 60px",width:"100%",animation:"sceneIn 0.4s both"}}>
      <div style={{fontSize:13,letterSpacing:7,color:"rgba(255,255,255,0.5)",fontWeight:700,marginBottom:8}}>THE JOURNEY</div>
      <div style={{fontSize:54,fontWeight:900,color:"#fff",letterSpacing:-1,marginBottom:48,
        animation:"slamIn 0.5s 0.1s cubic-bezier(0.34,1.56,0.64,1) both"}}>
        32 → 16 → 8
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:18,maxWidth:1080,margin:"0 auto"}}>
        {stages.map((s, i) => (
          <div key={i} style={{
            padding:"22px 14px",borderRadius:14,
            background: i === 3 ? `linear-gradient(135deg,${s.color}33,${s.color}10)` : "rgba(255,255,255,0.03)",
            border: `2px solid ${i === 3 ? s.color : `${s.color}55`}`,
            boxShadow: i === 3 ? `0 0 30px ${s.color}66` : "none",
            animation: `teamPop 0.5s ${0.4 + i * 0.4}s cubic-bezier(0.34,1.56,0.64,1) both`,
          }}>
            <div style={{fontSize:64,fontWeight:900,color:s.color,letterSpacing:-2,
              textShadow:`0 0 24px ${s.color}66`,fontVariantNumeric:"tabular-nums"}}>
              {s.count}
            </div>
            <div style={{fontSize:10,letterSpacing:2,fontWeight:700,color:i === 3 ? "#fff" : "rgba(255,255,255,0.45)",marginTop:6}}>
              {s.label}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Scene 3/4: Podium (scorers or MOTMs) ─────────────────────
function ScenePodium({ title, subtitle, icon, items, teamById }:
  { title: string; subtitle: string; icon: string; items: any[]; teamById: (id: string) => any }) {
  return (
    <div style={{position:"relative",zIndex:5,padding:"0 60px",width:"100%",animation:"sceneIn 0.4s both"}}>
      <div style={{textAlign:"center",marginBottom:42}}>
        <div style={{fontSize:11,letterSpacing:7,color:"rgba(255,255,255,0.5)",fontWeight:700,marginBottom:6}}>{subtitle}</div>
        <div style={{fontSize:54,fontWeight:900,color:"#fff",letterSpacing:-1,
          animation:"slamIn 0.55s cubic-bezier(0.34,1.56,0.64,1) both"}}>
          {icon} <span style={{background:"linear-gradient(180deg,#FBBF24 0%,#D4A537 100%)",
            WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"}}>{title}</span>
        </div>
      </div>
      <div style={{display:"flex",justifyContent:"center",alignItems:"flex-end",gap:24,maxWidth:1100,margin:"0 auto"}}>
        {items.map((s, i) => {
          const team = teamById(s.teamId);
          const podiumColor = i === 0 ? "#FBBF24" : i === 1 ? "#C0C0C0" : "#CD7F32";
          const podiumIcon  = i === 0 ? "🥇" : i === 1 ? "🥈" : "🥉";
          const scale = i === 0 ? 1.1 : i === 1 ? 1 : 0.92;
          return (
            <div key={s.handle} style={{
              flex:`0 0 ${i === 0 ? 280 : 240}px`,
              animation:`teamPop 0.5s ${i * 0.3}s cubic-bezier(0.34,1.56,0.64,1) both`,
              textAlign:"center",transform:`scale(${scale})`,
            }}>
              <div style={{fontSize:i===0?46:36,marginBottom:8}}>{podiumIcon}</div>
              <div style={{padding:"24px 16px",borderRadius:14,
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
                }}>{title === "MAN OF THE MATCH" ? "⭐" : (s.name?.[0] ?? "?").toUpperCase()}</div>
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
                    {s.value}
                  </span>
                  <span style={{fontSize:11,fontWeight:700,letterSpacing:2,color:"rgba(255,255,255,0.55)",textTransform:"uppercase"}}>
                    {s.valueLabel}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
        {items.length === 0 && <div style={{color:"rgba(255,255,255,0.4)",fontSize:14}}>No data yet</div>}
      </div>
    </div>
  );
}

// ─── Scene 5: QUARTER FINALS slam ─────────────────────────────
function SceneQFSlam() {
  return (
    <div style={{textAlign:"center",position:"relative",zIndex:5}}>
      <div style={{position:"absolute",inset:-1000,background:"rgba(255,255,255,0.7)",
        animation:"flashWhite 0.4s ease-out forwards",zIndex:-1}}/>
      <div style={{fontSize:14,letterSpacing:9,color:"#FBBF24",fontWeight:700,marginBottom:24,
        animation:"fadeUp 0.5s 0.3s both"}}>FINAL EIGHT · STAKES HIGHEST YET</div>
      <div style={{fontSize:140,fontWeight:900,letterSpacing:-3,color:"#fff",lineHeight:0.95,
        animation:"slamShake 0.7s cubic-bezier(0.34,1.56,0.64,1) both",
        textShadow:"0 0 60px rgba(212,165,55,0.55), 0 10px 40px rgba(0,0,0,0.8)"}}>
        QUARTER<br/>
        <span style={{fontSize:200,
          background:"linear-gradient(180deg,#FBBF24 0%,#D4A537 70%,#7a5e1d 100%)",
          WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",
          filter:"drop-shadow(0 0 36px rgba(212,165,55,0.7))",letterSpacing:-10}}>FINALS</span>
      </div>
    </div>
  );
}

// ─── Scene 6: WATCH IT LIVE ───────────────────────────────────
function SceneWatchLive() {
  return (
    <div style={{textAlign:"center",position:"relative",zIndex:5,animation:"sceneIn 0.5s both"}}>
      <div style={{display:"inline-flex",alignItems:"center",gap:10,marginBottom:24,
        padding:"8px 18px",borderRadius:22,background:"rgba(239,68,68,0.18)",border:"1.5px solid rgba(239,68,68,0.55)",
        boxShadow:"0 0 30px rgba(239,68,68,0.4)"}}>
        <div style={{width:9,height:9,borderRadius:"50%",background:"#EF4444",
          boxShadow:"0 0 10px rgba(239,68,68,0.7)",animation:"ppulse 1.1s infinite"}}/>
        <span style={{fontSize:12,fontWeight:900,letterSpacing:4,color:"#EF4444"}}>NEW THIS ROUND</span>
      </div>
      <div style={{fontSize:104,fontWeight:900,color:"#fff",letterSpacing:-2.5,lineHeight:1,
        animation:"slamIn 0.6s 0.15s cubic-bezier(0.34,1.56,0.64,1) both",
        marginBottom:24}}>
        WATCH IT <span style={{
          background:"linear-gradient(180deg,#EF4444 0%,#B91C1C 100%)",
          WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",
          filter:"drop-shadow(0 0 30px rgba(239,68,68,0.6))"}}>LIVE</span>
      </div>
      <div style={{fontSize:24,fontWeight:600,color:"rgba(255,255,255,0.7)",letterSpacing:0.5,maxWidth:780,margin:"0 auto",lineHeight:1.5,
        animation:"fadeUp 0.6s 0.45s both"}}>
        Every match plays out on every screen.<br/>
        <span style={{color:"#FBBF24"}}>One bracket. One feed. One audience.</span>
      </div>
    </div>
  );
}

// ─── Scene 7: Date / Time ─────────────────────────────────────
function SceneDate() {
  return (
    <div style={{textAlign:"center",position:"relative",zIndex:5,animation:"sceneIn 0.5s both"}}>
      <div style={{fontSize:13,letterSpacing:6,color:"#FBBF24",fontWeight:700,marginBottom:32,
        animation:"fadeUp 0.5s 0.1s both"}}>KICKOFF</div>
      <div style={{fontSize:72,fontWeight:900,color:"#fff",letterSpacing:-1,lineHeight:1.05,
        animation:"fadeUp 0.5s 0.25s both",marginBottom:30}}>
        TUESDAY<br/>2 JUNE
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
    </div>
  );
}

// ─── Scene 8: H2H ─────────────────────────────────────────────
function SceneH2H({ home, away, matchNum, total }:
  { home?: Team; away?: Team; matchNum: number; total: number }) {
  if (!home || !away) return null;
  return (
    <div style={{position:"relative",zIndex:5,width:"100%",padding:"0 80px",animation:"sceneIn 0.3s both"}}>
      <div style={{position:"absolute",top:-160,left:"50%",transform:"translateX(-50%)",
        fontSize:13,letterSpacing:5,color:"rgba(255,255,255,0.5)",fontWeight:700}}>
        QF · MATCH {matchNum} OF {total}
      </div>
      <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:60,maxWidth:1400,margin:"0 auto"}}>
        <div style={{flex:"0 0 500px",animation:"slideLeft 0.5s cubic-bezier(0.22,1,0.36,1) both"}}>
          <BigTeamCard team={home}/>
        </div>
        <div style={{position:"relative",animation:"vsAppear 0.6s 0.35s cubic-bezier(0.34,1.56,0.64,1) both"}}>
          <div style={{position:"absolute",inset:-40,
            background:"radial-gradient(circle,rgba(239,68,68,0.4) 0%,transparent 70%)",
            borderRadius:"50%",animation:"glowPulse 1.0s ease-in-out infinite"}}/>
          <div style={{fontSize:140,fontWeight:900,letterSpacing:-3,
            background:"linear-gradient(180deg,#EF4444 0%,#B91C1C 100%)",
            WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",
            filter:"drop-shadow(0 0 32px rgba(239,68,68,0.7))",
            position:"relative",zIndex:1}}>VS</div>
        </div>
        <div style={{flex:"0 0 500px",animation:"slideRight 0.5s 0.15s cubic-bezier(0.22,1,0.36,1) both"}}>
          <BigTeamCard team={away}/>
        </div>
      </div>
    </div>
  );
}

function BigTeamCard({ team }: { team: Team }) {
  return (
    <div style={{
      padding:"40px 32px",borderRadius:20,
      background:`linear-gradient(135deg,${team.color}38,${team.color}0a)`,
      border:`3px solid ${team.color}`,
      boxShadow:`0 0 60px ${team.color}66, 0 16px 50px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.08)`,
      display:"flex",flexDirection:"column",alignItems:"center",gap:20,
      animation:"floatLite 2.2s ease-in-out infinite",
    }}>
      <div style={{
        width:160,height:160,borderRadius:"50%",
        background:`linear-gradient(135deg,${team.color},${team.color}aa)`,
        display:"flex",alignItems:"center",justifyContent:"center",
        fontSize:96,
        boxShadow:`0 0 30px ${team.color}99, inset 0 0 30px rgba(255,255,255,0.1)`,
        border:`4px solid ${team.color}`,
      }}>{team.emblem}</div>
      <div style={{fontSize:30,fontWeight:900,color:"#fff",letterSpacing:0.8,textAlign:"center",
        textShadow:`0 0 28px ${team.color}aa`,maxWidth:440,overflow:"hidden",
        textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
        {team.name.toUpperCase()}
      </div>
    </div>
  );
}

// ─── Scene 9: BE THERE ────────────────────────────────────────
function SceneBeThere() {
  return (
    <div style={{textAlign:"center",position:"relative",zIndex:5,animation:"sceneIn 0.5s both"}}>
      <div style={{fontSize:11,letterSpacing:8,color:"#FBBF24",fontWeight:700,marginBottom:24,
        animation:"fadeUp 0.5s 0.05s both"}}>BE ON THE SITE · 8PM UTC</div>
      <div style={{fontSize:210,fontWeight:900,letterSpacing:-5,color:"#fff",lineHeight:0.95,
        animation:"slamIn 0.7s 0.15s cubic-bezier(0.34,1.56,0.64,1) both",
        background:"linear-gradient(180deg,#fff 0%,#FBBF24 70%,#D4A537 100%)",
        WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",
        filter:"drop-shadow(0 0 55px rgba(212,165,55,0.75))",marginBottom:24}}>
        TUNE IN
      </div>
      <div style={{fontSize:54,fontWeight:900,color:"#FBBF24",letterSpacing:1.5,
        animation:"fadeUp 0.5s 0.55s both",
        textShadow:"0 0 32px rgba(212,165,55,0.6)"}}>
        ctworldcup.xyz/watch
      </div>
      <div style={{marginTop:30,fontSize:14,letterSpacing:4,color:"rgba(255,255,255,0.5)",
        animation:"fadeUp 0.5s 0.85s both"}}>
        4 MATCHES · LIVE · SYNCHRONIZED
      </div>
    </div>
  );
}

function SceneEnd() {
  return (
    <div style={{position:"absolute",inset:0,background:"#000",
      animation:"fadeIn 1.5s both",zIndex:1000,
      display:"flex",alignItems:"center",justifyContent:"center"}}>
      <div style={{fontSize:11,letterSpacing:6,color:"rgba(255,255,255,0.4)",animation:"fadeUp 1s 0.4s both"}}>
        SEE YOU AT 8PM UTC
      </div>
    </div>
  );
}

const globalCss = `
  body { margin: 0; background: #000; overflow: hidden; }
  @keyframes ppulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }
  @keyframes fadeUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
  @keyframes sceneIn { from { opacity: 0; } to { opacity: 1; } }
  @keyframes slamIn { 0% { opacity: 0; transform: scale(0.5); } 60% { opacity: 1; transform: scale(1.05); } 100% { transform: scale(1); } }
  @keyframes slamCinema {
    0%   { opacity: 0; transform: scale(0.4) rotateX(40deg); filter: blur(20px); }
    50%  { opacity: 1; transform: scale(1.12) rotateX(0deg); filter: blur(0); }
    65%  { transform: scale(0.95); }
    80%  { transform: scale(1.03); }
    100% { transform: scale(1); }
  }
  @keyframes slamShake {
    0%   { opacity: 0; transform: scale(0.6); }
    40%  { opacity: 1; transform: scale(1.08); }
    50%  { transform: scale(1.02) translateX(-6px); }
    60%  { transform: scale(1.04) translateX(6px); }
    70%  { transform: scale(1.0) translateX(-3px); }
    80%  { transform: scale(1.0) translateX(3px); }
    100% { transform: scale(1) translateX(0); }
  }
  @keyframes flashWhite { 0% { opacity: 0.9; } 100% { opacity: 0; } }
  @keyframes glowPulse { 0%, 100% { box-shadow: 0 0 36px rgba(212,165,55,0.4); } 50% { box-shadow: 0 0 72px rgba(212,165,55,0.85); } }
  @keyframes orbFloat { 0%, 100% { transform: translateY(0) scale(1); } 50% { transform: translateY(-30px) scale(1.06); } }
  @keyframes teamPop { 0% { opacity: 0; transform: scale(0.5) rotate(-8deg); } 100% { opacity: 1; transform: scale(1) rotate(0); } }
  @keyframes slideLeft  { 0% { opacity: 0; transform: translateX(-180px); } 100% { opacity: 1; transform: translateX(0); } }
  @keyframes slideRight { 0% { opacity: 0; transform: translateX(180px); } 100% { opacity: 1; transform: translateX(0); } }
  @keyframes vsAppear { 0% { opacity: 0; transform: scale(2) rotate(180deg); } 100% { opacity: 1; transform: scale(1) rotate(0); } }
  @keyframes floatLite { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-8px); } }
`;
