import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { Server, Socket } from "socket.io";

const app = express();
app.use(cors({ origin: process.env.CLIENT_ORIGIN?.split(",") ?? true }));
app.use(express.json());

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: process.env.CLIENT_ORIGIN?.split(",") ?? true, methods: ["GET", "POST"] },
  pingInterval: 25000,
  pingTimeout: 20000
});

type Player = { id: string; name: string; score: number; color: string; ready: boolean };
type Target = { id: string; x: number; y: number; value: number; expiresAt: number };
type Room = {
  code: string;
  hostId: string;
  players: Map<string, Player>;
  phase: "lobby" | "playing" | "finished";
  round: number;
  roundEndsAt: number | null;
  targets: Target[];
  nextTargetAt: number;
  timer?: ReturnType<typeof setInterval>;
  lastAction: Map<string, number>;
};

const rooms = new Map<string, Room>();
const ROUND_MS = Number(process.env.ROUND_MS ?? 45_000);
const MAX_PLAYERS = 8;
const COLORS = ["#60a5fa", "#f472b6", "#34d399", "#fbbf24", "#a78bfa", "#fb7185", "#22d3ee", "#a3e635"];

function cleanName(value: unknown): string {
  return String(value ?? "").trim().replace(/[<>]/g, "").slice(0, 18) || "Player";
}
function makeCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 5; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
  return code;
}
function uniqueCode(): string {
  let code = makeCode();
  while (rooms.has(code)) code = makeCode();
  return code;
}
function publicRoom(room: Room) {
  return {
    code: room.code,
    hostId: room.hostId,
    phase: room.phase,
    round: room.round,
    roundEndsAt: room.roundEndsAt,
    targets: room.targets,
    players: [...room.players.values()].map(({ id, name, score, color, ready }) => ({ id, name, score, color, ready }))
  };
}
function emitRoom(room: Room) {
  io.to(room.code).emit("state", publicRoom(room));
}
function stopTimer(room: Room) {
  if (room.timer) clearInterval(room.timer);
  room.timer = undefined;
}
function finishRound(room: Room) {
  stopTimer(room);
  room.phase = "finished";
  room.roundEndsAt = null;
  room.targets = [];
  emitRoom(room);
  io.to(room.code).emit("notice", "Round finished! The player with the highest score wins.");
}
function tickRoom(room: Room) {
  if (room.phase !== "playing" || room.roundEndsAt === null) return;
  const now = Date.now();
  if (now >= room.roundEndsAt) {
    finishRound(room);
    return;
  }
  const prevCount = room.targets.length;
  room.targets = room.targets.filter((t) => t.expiresAt > now);
  let changed = room.targets.length !== prevCount;
  if (now >= room.nextTargetAt && room.targets.length < 4) {
    room.targets.push({
      id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
      x: 8 + Math.random() * 84,
      y: 12 + Math.random() * 72,
      value: Math.random() < 0.18 ? 3 : 1,
      expiresAt: now + 2200
    });
    room.nextTargetAt = now + 500 + Math.random() * 650;
    changed = true;
  }
  if (changed) {
    emitRoom(room);
  }
}
function startRound(room: Room, customDuration?: number) {
  stopTimer(room);
  room.phase = "playing";
  room.round += 1;
  const duration = typeof customDuration === "number" && customDuration >= 2000 && customDuration <= 120000
    ? customDuration
    : ROUND_MS;
  room.roundEndsAt = Date.now() + duration;
  room.targets = [];
  room.nextTargetAt = Date.now() + 300;
  room.lastAction.clear();
  for (const player of room.players.values()) player.score = 0;
  io.to(room.code).emit("notice", `Round ${room.round} started! Tap targets to score.`);
  emitRoom(room);
  room.timer = setInterval(() => tickRoom(room), 100);
}
function leaveRoom(socket: Socket) {
  const code = socket.data.roomCode as string | undefined;
  if (!code) return;
  const room = rooms.get(code);
  socket.leave(code);
  delete socket.data.roomCode;
  if (!room) return;
  const leavingPlayer = room.players.get(socket.id);
  room.players.delete(socket.id);
  room.lastAction.delete(socket.id);
  if (room.players.size === 0) {
    stopTimer(room);
    rooms.delete(code);
    return;
  }
  if (leavingPlayer) {
    io.to(code).emit("notice", `${leavingPlayer.name} left the arena.`);
  }
  if (room.hostId === socket.id) {
    room.hostId = room.players.keys().next().value as string;
    const newHost = room.players.get(room.hostId);
    if (newHost) {
      io.to(code).emit("notice", `${newHost.name} is now the room host.`);
    }
  }
  emitRoom(room);
}

app.get("/health", (_req, res) => res.json({
  ok: true,
  rooms: rooms.size,
  service: "Code Clash Arena",
  uptime: Math.floor(process.uptime())
}));

io.on("connection", (socket) => {
  socket.on("create-room", (rawName: unknown, callback?: (result: any) => void) => {
    if (socket.data.roomCode) leaveRoom(socket);
    const name = cleanName(rawName);
    const code = uniqueCode();
    const player: Player = { id: socket.id, name, score: 0, color: COLORS[0], ready: true };
    const room: Room = {
      code, hostId: socket.id, players: new Map([[socket.id, player]]),
      phase: "lobby", round: 0, roundEndsAt: null, targets: [], nextTargetAt: 0, lastAction: new Map()
    };
    rooms.set(code, room);
    socket.join(code);
    socket.data.roomCode = code;
    callback?.({ ok: true, code, state: publicRoom(room) });
    emitRoom(room);
  });

  socket.on("join-room", (payload: { name?: unknown; code?: unknown }, callback?: (result: any) => void) => {
    if (socket.data.roomCode) leaveRoom(socket);
    const code = String(payload?.code ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5);
    const room = rooms.get(code);
    if (!room) return callback?.({ ok: false, error: "Room not found. Check the code and try again." });
    if (room.players.size >= MAX_PLAYERS) return callback?.({ ok: false, error: "This room is full (8 players maximum)." });
    if (room.phase === "playing") return callback?.({ ok: false, error: "A round is already in progress. Join after it ends." });
    const player: Player = {
      id: socket.id, name: cleanName(payload?.name), score: 0,
      color: COLORS[room.players.size % COLORS.length], ready: true
    };
    room.players.set(socket.id, player);
    socket.join(code);
    socket.data.roomCode = code;
    callback?.({ ok: true, code, state: publicRoom(room) });
    emitRoom(room);
    io.to(code).emit("notice", `${player.name} joined the arena.`);
  });

  socket.on("start-round", (customDuration?: unknown) => {
    const code = socket.data.roomCode as string | undefined;
    const room = code ? rooms.get(code) : undefined;
    if (!room || room.hostId !== socket.id || room.phase === "playing") return;
    if (room.players.size < 2) {
      socket.emit("notice", "Invite at least one more player to start.");
      return;
    }
    startRound(room, typeof customDuration === "number" ? customDuration : undefined);
  });

  socket.on("hit-target", (targetId: unknown) => {
    const code = socket.data.roomCode as string | undefined;
    const room = code ? rooms.get(code) : undefined;
    if (!room || room.phase !== "playing") return;
    const player = room.players.get(socket.id);
    if (!player) return;
    const now = Date.now();
    const last = room.lastAction.get(socket.id) ?? 0;
    if (now - last < 70) return; // basic anti-spam limit
    room.lastAction.set(socket.id, now);
    const index = room.targets.findIndex((t) => t.id === String(targetId));
    if (index < 0 || room.targets[index].expiresAt <= now) return;
    const [target] = room.targets.splice(index, 1); // first valid hit wins; no duplicate points
    player.score += target.value;
    io.to(code!).emit("target-hit", { targetId: target.id, playerId: player.id, playerName: player.name, value: target.value });
    emitRoom(room);
  });

  socket.on("play-again", (customDuration?: unknown) => {
    const code = socket.data.roomCode as string | undefined;
    const room = code ? rooms.get(code) : undefined;
    if (!room || room.hostId !== socket.id || room.phase !== "finished") return;
    if (room.players.size < 2) {
      socket.emit("notice", "Invite at least one more player to play again.");
      return;
    }
    startRound(room, typeof customDuration === "number" ? customDuration : undefined);
  });

  socket.on("leave-room", () => leaveRoom(socket));
  socket.on("disconnect", () => leaveRoom(socket));
});

const port = Number(process.env.PORT ?? 3001);
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const distPath = path.resolve(currentDir, "../dist");
const hasDist = fs.existsSync(distPath) && fs.existsSync(path.join(distPath, "index.html"));
if (process.env.NODE_ENV === "production" || hasDist) {
  app.use(express.static(distPath));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/socket.io") || req.path === "/health") return next();
    res.sendFile(path.join(distPath, "index.html"));
  });
}
httpServer.listen(port, "0.0.0.0", () => {
  console.log(`Code Clash Arena server listening on port ${port}`);
});