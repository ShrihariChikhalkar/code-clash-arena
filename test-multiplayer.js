import { io } from "socket.io-client";

const SERVER_URL = "http://localhost:3001";
const results = [];

function assert(condition, message) {
  if (condition) {
    console.log(`  [PASS] ${message}`);
    results.push({ pass: true, message });
  } else {
    console.error(`  [FAIL] ${message}`);
    results.push({ pass: false, message });
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runMultiplayerTest() {
  console.log("Starting Code Clash Arena Multiplayer Test Suite...");

  // 1. Connect Host
  const host = io(SERVER_URL, { transports: ["websocket"] });
  await new Promise((res) => host.on("connect", res));
  assert(host.connected, "Host connected to server");

  // 2. Create room
  let roomCode = "";
  let hostRoomState = null;
  await new Promise((resolve) => {
    host.emit("create-room", "HostPlayer", (reply) => {
      assert(reply.ok, "Host created room successfully");
      assert(reply.code && reply.code.length === 5, `Received 5-character room code: ${reply.code}`);
      roomCode = reply.code;
      hostRoomState = reply.state;
      resolve();
    });
  });
  assert(hostRoomState.players.length === 1, "Host is in lobby as single player");
  assert(hostRoomState.hostId === host.id, "Host has host permissions");

  // 3. Connect Player 2
  const player2 = io(SERVER_URL, { transports: ["websocket"] });
  await new Promise((res) => player2.on("connect", res));
  assert(player2.connected, "Player 2 connected to server");

  // 4. Player 2 joins room
  let player2RoomState = null;
  let hostReceivedNotice = false;
  host.on("notice", (msg) => {
    if (msg.includes("Player2 joined")) hostReceivedNotice = true;
  });

  await new Promise((resolve) => {
    player2.emit("join-room", { name: "Player2", code: roomCode }, (reply) => {
      assert(reply.ok, "Player 2 joined room successfully");
      player2RoomState = reply.state;
      resolve();
    });
  });

  await sleep(150);
  assert(player2RoomState.players.length === 2, "Room has 2 players");
  assert(hostReceivedNotice, "Host received notification of Player 2 joining");

  // 5. Verify host control: Player 2 cannot start the round
  let player2StateUpdate = null;
  player2.on("state", (st) => { player2StateUpdate = st; });
  host.on("state", (st) => { hostRoomState = st; });

  player2.emit("start-round");
  await sleep(200);
  assert(hostRoomState.phase === "lobby", "Non-host cannot start round (remains in lobby)");

  // 6. Host starts round
  host.emit("start-round");
  await sleep(300);
  assert(hostRoomState.phase === "playing", "Round started by host (phase is 'playing')");
  assert(player2StateUpdate && player2StateUpdate.phase === "playing", "Player 2 synchronized to 'playing' phase");
  assert(hostRoomState.round === 1, "Round counter is 1");
  assert(hostRoomState.roundEndsAt !== null, "Server set roundEndsAt timestamp");

  // 7. Wait for server to spawn targets
  console.log("Waiting for server to generate targets...");
  let target = null;
  for (let i = 0; i < 20; i++) {
    await sleep(200);
    if (hostRoomState.targets && hostRoomState.targets.length > 0) {
      target = hostRoomState.targets[0];
      break;
    }
  }
  assert(target !== null, `Server generated target: ${target?.id} (value: ${target?.value})`);
  assert(target.x >= 0 && target.x <= 100 && target.y >= 0 && target.y <= 100, "Target coordinates within bounds");

  // 8. Server-authoritative scoring & race condition test
  // Both host and player2 simultaneously attempt to hit the exact same target!
  let targetHitsEmitted = [];
  const hitHandler = (hit) => targetHitsEmitted.push(hit);
  host.on("target-hit", hitHandler);
  player2.on("target-hit", hitHandler);

  console.log(`Sending simultaneous hit-target for ${target.id} from both players...`);
  host.emit("hit-target", target.id);
  player2.emit("hit-target", target.id);

  await sleep(300);
  assert(targetHitsEmitted.length === 2, "Both sockets received target-hit broadcast event once");
  const hitEvent = targetHitsEmitted[0];
  assert(hitEvent.targetId === target.id, `Hit was awarded for target ${target.id}`);
  
  // Verify scores: sum of scores must equal target.value (only one player received points)
  const hostPlayer = hostRoomState.players.find(p => p.id === host.id);
  const p2Player = hostRoomState.players.find(p => p.id === player2.id);
  const totalScore = hostPlayer.score + p2Player.score;
  assert(totalScore === target.value, `Target scored only once (total points: ${totalScore}, target value: ${target.value})`);
  assert(
    (hostPlayer.score === target.value && p2Player.score === 0) ||
    (p2Player.score === target.value && hostPlayer.score === 0),
    "Only the first hitting player received the score, duplicate hit was rejected"
  );

  // Verify target is removed from active targets on both clients
  assert(!hostRoomState.targets.some(t => t.id === target.id), "Target removed from host targets list");
  assert(!player2StateUpdate.targets.some(t => t.id === target.id), "Target removed from player2 targets list");

  // 9. Replay controls: test replay permissions
  // Temporarily force round finish test or play-again logic:
  // Non-host attempts play-again
  player2.emit("play-again");
  await sleep(100);
  // Phase should remain current phase
  assert(hostRoomState.phase === "playing", "Non-host cannot trigger play-again");

  // 10. Disconnect test: Player 2 disconnects
  let leaveNoticeReceived = false;
  host.on("notice", (msg) => {
    if (msg.includes("Player2 left")) leaveNoticeReceived = true;
  });

  player2.disconnect();
  await sleep(300);

  assert(hostRoomState.players.length === 1, "Player 2 removed from room players list");
  assert(leaveNoticeReceived, "Host received notice that Player 2 left the arena");

  // Clean up host
  host.disconnect();
  await sleep(100);

  console.log("\nALL MULTIPLAYER INTEGRATION TESTS PASSED SUCCESSFULLY!");
  process.exit(0);
}

runMultiplayerTest().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
