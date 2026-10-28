import { io } from "socket.io-client";

const SERVER_URL = "http://localhost:3001";

function assert(condition, message) {
  if (condition) {
    console.log(`  [PASS] ${message}`);
  } else {
    console.error(`  [FAIL] ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runRoundReplayTest() {
  console.log("Starting Code Clash Arena Round Completion & Replay Test...");

  const host = io(SERVER_URL, { transports: ["websocket"] });
  const p2 = io(SERVER_URL, { transports: ["websocket"] });

  await Promise.all([
    new Promise((res) => host.on("connect", res)),
    new Promise((res) => p2.on("connect", res))
  ]);

  let code = "";
  let hostState = null;
  let p2State = null;

  host.on("state", (s) => { hostState = s; });
  p2.on("state", (s) => { p2State = s; });

  await new Promise((res) => {
    host.emit("create-room", "ChampionHost", (reply) => {
      code = reply.code;
      hostState = reply.state;
      res();
    });
  });

  await new Promise((res) => {
    p2.emit("join-room", { name: "ContenderP2", code }, (reply) => {
      p2State = reply.state;
      res();
    });
  });

  await sleep(150);
  assert(hostState.players.length === 2, "2 players joined room");

  // Host starts round with 3000ms duration for test
  host.emit("start-round", 3000);
  await sleep(300);

  assert(hostState.phase === "playing", "Round 1 is playing on host");
  assert(p2State.phase === "playing", "Round 1 is playing on P2");
  assert(hostState.round === 1, "Round number is 1");

  // Wait for a target and host hits it
  for (let i = 0; i < 20; i++) {
    await sleep(200);
    if (hostState.targets.length > 0) break;
  }
  assert(hostState.targets.length > 0, "Target spawned");
  const target = hostState.targets[0];
  host.emit("hit-target", target.id);
  await sleep(250);

  const hostScore = hostState.players.find(p => p.id === host.id)?.score;
  assert(hostScore === target.value, `Host scored ${target.value} points`);

  // Wait for round countdown to expire (4s round)
  console.log("Waiting for round timer to expire...");
  for (let i = 0; i < 35; i++) {
    await sleep(200);
    if (hostState.phase === "finished") break;
  }

  assert(hostState.phase === "finished", "Host state transitioned to 'finished'");
  assert(p2State.phase === "finished", "P2 state synchronized to 'finished'");
  assert(hostState.targets.length === 0, "Targets cleared on round end");
  assert(hostState.roundEndsAt === null, "roundEndsAt is null on finish");

  // Verify leaderboard reflects winner
  const sorted = [...hostState.players].sort((a, b) => b.score - a.score);
  assert(sorted[0].name === "ChampionHost", `Leaderboard winner is ${sorted[0].name}`);

  // Test Replay: Host calls "play-again"
  console.log("Host triggering play-again...");
  host.emit("play-again", 3000);
  await sleep(350);

  assert(hostState.phase === "playing", "Phase transitioned back to 'playing' after play-again");
  assert(p2State.phase === "playing", "P2 synchronized back to 'playing'");
  assert(hostState.round === 2, "Round counter incremented to 2");

  // Verify scores reset to 0
  for (const player of hostState.players) {
    assert(player.score === 0, `Player ${player.name} score reset to 0`);
  }
  for (const player of p2State.players) {
    assert(player.score === 0, `P2 view of ${player.name} score reset to 0`);
  }

  host.disconnect();
  p2.disconnect();
  await sleep(150);

  console.log("\nROUND COMPLETION & REPLAY TESTS PASSED SUCCESSFULLY!");
  process.exit(0);
}

runRoundReplayTest().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
