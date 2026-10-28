import { useEffect, useMemo, useState } from "react";
import { io, Socket } from "socket.io-client";
import { ArrowRight, Check, Copy, Crown, Gamepad2, LogOut, Radio, Sparkles, Trophy, Users, Zap } from "lucide-react";

type Player = { id: string; name: string; score: number; color: string; ready: boolean };
type Target = { id: string; x: number; y: number; value: number; expiresAt: number };
type RoomState = { code: string; hostId: string; phase: "lobby" | "playing" | "finished"; round: number; roundEndsAt: number | null; targets: Target[]; players: Player[] };
type ServerReply = { ok: boolean; code?: string; state?: RoomState; error?: string };

const SERVER_URL = (import.meta.env.VITE_SERVER_URL as string | undefined)?.replace(/\/$/, "") || window.location.origin;
const socket: Socket = io(SERVER_URL, { autoConnect: false, transports: ["websocket", "polling"] });

export default function App() {
  const [name, setName] = useState(() => {
    try { return localStorage.getItem("code_clash_name") || ""; } catch { return ""; }
  });
  const [code, setCode] = useState("");
  const [room, setRoom] = useState<RoomState | null>(null);
  const [myId, setMyId] = useState("");
  const [message, setMessage] = useState("");
  const [copied, setCopied] = useState(false);
  const [clock, setClock] = useState(Date.now());
  const [connected, setConnected] = useState(socket.connected);
  const [lastHit, setLastHit] = useState("");

  const updateName = (newName: string) => {
    setName(newName);
    try { localStorage.setItem("code_clash_name", newName); } catch {}
  };

  useEffect(() => {
    const onConnect = () => { setConnected(true); setMyId(socket.id ?? ""); };
    const onDisconnect = () => { setConnected(false); setMessage("Disconnected from server. Reconnecting…"); };
    const onState = (state: RoomState) => setRoom(state);
    const onNotice = (notice: string) => {
      setMessage(notice);
      window.setTimeout(() => setMessage((cur) => cur === notice ? "" : cur), 4000);
    };
    const onHit = (hit: { playerName: string; value: number }) => {
      setLastHit(`${hit.playerName} scored +${hit.value}`);
      window.setTimeout(() => setLastHit(""), 1200);
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("state", onState);
    socket.on("notice", onNotice);
    socket.on("target-hit", onHit);

    if (socket.connected) {
      setConnected(true);
      setMyId(socket.id ?? "");
    } else {
      socket.connect();
    }

    const interval = window.setInterval(() => setClock(Date.now()), 150);
    return () => {
      window.clearInterval(interval);
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("state", onState);
      socket.off("notice", onNotice);
      socket.off("target-hit", onHit);
    };
  }, []);

  const me = room?.players.find((p) => p.id === myId);
  const sortedPlayers = useMemo(() => [...(room?.players ?? [])].sort((a, b) => b.score - a.score), [room?.players]);
  const remaining = room?.roundEndsAt ? Math.max(0, Math.ceil((room.roundEndsAt - clock) / 1000)) : 45;
  const isHost = room?.hostId === myId;

  function ensureConnected() {
    if (!socket.connected) socket.connect();
  }
  function createRoom() {
    if (!name.trim()) { setMessage("Enter a nickname first."); return; }
    const send = () => socket.emit("create-room", name, (result: ServerReply) => {
      if (!result.ok) setMessage(result.error ?? "Couldn't create room.");
      else { setRoom(result.state ?? null); setCode(result.code ?? ""); setMessage("Room created. Invite your friends!"); }
    });
    if (!socket.connected) { ensureConnected(); socket.once("connect", send); } else send();
  }
  function joinRoom() {
    if (!name.trim()) { setMessage("Enter a nickname first."); return; }
    if (code.trim().length < 4) { setMessage("Enter the room code."); return; }
    const send = () => socket.emit("join-room", { name, code }, (result: ServerReply) => {
      if (!result.ok) setMessage(result.error ?? "Couldn't join room.");
      else { setRoom(result.state ?? null); setCode(result.code ?? code.toUpperCase()); setMessage("Welcome to the arena!"); }
    });
    if (!socket.connected) { ensureConnected(); socket.once("connect", send); } else send();
  }
  async function copyInvite() {
    const invite = `${window.location.origin}/?room=${room?.code ?? ""}`;
    try {
      await navigator.clipboard.writeText(invite);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch { setMessage(`Share room code ${room?.code} with your friends.`); }
  }
  function exitRoom() {
    socket.emit("leave-room");
    setRoom(null); setCode(""); setMessage("");
  }
  useEffect(() => {
    const queryCode = new URLSearchParams(window.location.search).get("room");
    if (queryCode) setCode(queryCode.toUpperCase());
  }, []);

  if (!room) {
    return <main className="page landing">
      <header className="topbar"><div className="brand"><span className="brand-icon"><Gamepad2 size={21}/></span><span>CODE CLASH <b>ARENA</b></span></div><span className="status"><i className={connected ? "online" : ""}/>{connected ? "Connected" : "Ready to connect"}</span></header>
      <section className="hero">
        <div className="eyebrow"><Sparkles size={14}/> REAL-TIME MULTIPLAYER</div>
        <h1>Quick hands.<br/><span>Big brain energy.</span></h1>
        <p className="hero-copy">Race your friends to tap targets, stack points, and claim the crown. No downloads. No accounts. Just chaos.</p>
        <div className="game-preview">
          <div className="preview-grid"/>
          <div className="preview-chip chip-one"><Zap size={15} fill="currentColor"/> +3</div>
          <div className="preview-chip chip-two">+1</div>
          <div className="preview-center"><Gamepad2 size={46}/><span>READY PLAYER?</span></div>
          <div className="preview-chip chip-three">+1</div>
          <div className="preview-chip chip-four">+3</div>
          <div className="preview-bottom"><span><i/> LIVE ARENA</span><span>45 SEC ROUND</span></div>
        </div>
      </section>
      <section className="join-card">
        <div className="card-heading"><div><span className="step-label">YOUR PLAYER PROFILE</span><h2>Enter the arena</h2></div><Users size={23}/></div>
        <label htmlFor="nickname">NICKNAME</label>
        <input id="nickname" maxLength={18} value={name} onChange={(e) => updateName(e.target.value)} placeholder="e.g. PixelNinja" onKeyDown={(e) => e.key === "Enter" && createRoom()}/>
        <button className="primary" onClick={createRoom}>Create a room <ArrowRight size={17}/></button>
        <div className="or"><span/>OR JOIN YOUR CREW<span/></div>
        <div className="join-row"><input aria-label="Room code" maxLength={5} value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} placeholder="ROOM CODE"/><button className="secondary" onClick={joinRoom}>Join <ArrowRight size={16}/></button></div>
        <div className="privacy-note"><Radio size={14}/> Up to 8 players · No sign-up required</div>
        {message && <p className="message" role="status">{message}</p>}
      </section>
      <footer className="footer"><span>© CODE CLASH ARENA</span><span>BUILT FOR FRIENDLY RIVALRIES</span></footer>
    </main>;
  }

  return <main className="page game-page">
    <header className="topbar"><div className="brand"><span className="brand-icon"><Gamepad2 size={21}/></span><span>CODE CLASH <b>ARENA</b></span></div><button className="exit-button" onClick={exitRoom}><LogOut size={15}/> Leave room</button></header>
    <section className="game-header">
      <div><div className="eyebrow"><span className="live-dot"/> ROOM {room.code}</div><h1>{room.phase === "lobby" ? "Squad up." : room.phase === "finished" ? "GG, everyone." : "Tap. Score. Repeat."}</h1><p>{room.phase === "lobby" ? "Share your room code. The host starts when at least 2 players are ready." : room.phase === "finished" ? "The round is over. Check the leaderboard below." : "Tap the floating targets before they disappear. Gold targets are worth 3 points!"}</p></div>
      <button className="invite-button" onClick={copyInvite}>{copied ? <Check size={16}/> : <Copy size={16}/>} {copied ? "Copied invite" : "Invite friends"}</button>
    </section>
    {room.phase === "lobby" ? <section className="lobby-layout">
      <div className="arena lobby-arena"><div className="arena-glow"/><div className="lobby-symbol"><Users size={35}/></div><h2>Waiting for your crew</h2><p>ROOM CODE</p><button className="room-code" onClick={copyInvite}>{room.code} <Copy size={16}/></button><span className="hint">Click the code to copy an invite link</span><div className="waiting-pips"><i/><i/><i/></div></div>
      <aside className="sidebar"><div className="panel-title"><span>PLAYERS IN LOBBY</span><b>{room.players.length}/8</b></div><div className="player-list">{room.players.map((p) => <div className="player-row" key={p.id}><span className="avatar" style={{background: p.color}}>{p.name.slice(0,1).toUpperCase()}</span><span className="player-name">{p.name}{p.id === myId && <small>YOU</small>}</span>{p.id === room.hostId && <Crown size={16} className="crown"/>}</div>)}</div>{isHost ? <button className="primary start-button" disabled={room.players.length < 2} onClick={() => socket.emit("start-round")}>Start round <ArrowRight size={17}/></button> : <div className="host-note">Waiting for the host to start…</div>}<p className="small-note">At least 2 players are needed to begin.</p></aside>
    </section> : <section className="game-layout">
      <div className="arena live-arena">
        <div className="arena-top"><span className="round-pill"><Radio size={13}/> ROUND {room.round}</span><span className={`timer ${remaining <= 10 ? "urgent" : ""}`}>{`00:${String(remaining).padStart(2, "0")}`}</span></div>
        <div className="arena-field" aria-label="Game targets">
          {room.targets.map((target) => <button key={target.id} className={`target ${target.value === 3 ? "bonus-target" : ""}`} style={{left: `${target.x}%`, top: `${target.y}%`}} aria-label={`Score ${target.value} points`} onPointerDown={(e) => { e.preventDefault(); socket.emit("hit-target", target.id); }} onClick={() => socket.emit("hit-target", target.id)}>{target.value === 3 ? <Zap size={20} fill="currentColor"/> : <span/>}<b>+{target.value}</b></button>)}
          {room.targets.length === 0 && <div className="target-hint">{room.phase === "finished" ? <Trophy size={30}/> : <><span className="pulse-ring"/><span>Targets incoming…</span></>}</div>}
          {lastHit && <div className="hit-toast">{lastHit}</div>}
        </div>
        <div className="arena-bottom"><span><i className="green-dot"/> SERVER SYNCED</span><span>TAP TARGETS TO SCORE</span></div>
        {room.phase === "finished" && isHost && <button className="primary replay-button" onClick={() => socket.emit("play-again")}><Trophy size={17}/> Play again</button>}
        {room.phase === "finished" && !isHost && <p className="host-note">Waiting for the host to start another round.</p>}
      </div>
      <aside className="sidebar score-sidebar"><div className="panel-title"><span>LEADERBOARD</span><b><Users size={14}/> {room.players.length}</b></div><div className="player-list">{sortedPlayers.map((p, i) => <div className={`player-row score-row ${p.id === myId ? "is-me" : ""}`} key={p.id}><span className="rank">{i === 0 && p.score > 0 ? <Crown size={16}/> : String(i + 1).padStart(2, "0")}</span><span className="avatar" style={{background: p.color}}>{p.name.slice(0,1).toUpperCase()}</span><span className="player-name">{p.name}{p.id === myId && <small>YOU</small>}</span><b className="score">{p.score}</b></div>)}</div><div className="your-score"><span>YOUR SCORE</span><strong>{me?.score ?? 0}</strong><small>POINTS</small></div>{room.phase === "finished" && <div className="winner-box"><Trophy size={18}/><span>{sortedPlayers[0]?.name ?? "No winner"} {sortedPlayers[0]?.score ? "wins the round!" : "— round complete"}</span></div>}</aside>
    </section>}
    {message && <div className="toast-message" role="status">{message}</div>}
    <footer className="footer"><span>ROOM {room.code} · PRIVATE LOBBY</span><span>PLAY FAIR. CLASH HARD.</span></footer>
  </main>;
}