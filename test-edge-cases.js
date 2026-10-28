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

async function runEdgeCases() {
  console.log("Starting Edge Cases Test (Bad Code, Full Room, Host Reassignment)...");

  const socket = io(SERVER_URL, { transports: ["websocket"] });
  await new Promise((res) => socket.on("connect", res));

  // 1. Bad room code test
  await new Promise((res) => {
    socket.emit("join-room", { name: "Tester", code: "ZZZZZ" }, (reply) => {
      assert(!reply.ok, "Bad room code rejected");
      assert(reply.error && reply.error.includes("not found"), "Correct error message for invalid room code");
      res();
    });
  });

  // 2. Create room and test 8-player room capacity limit
  const host = io(SERVER_URL, { transports: ["websocket"] });
  await new Promise((res) => host.on("connect", res));

  let roomCode = "";
  await new Promise((res) => {
    host.emit("create-room", "Host8", (reply) => {
      roomCode = reply.code;
      res();
    });
  });

  // Join 7 more players to reach max capacity of 8
  const clients = [];
  for (let i = 1; i <= 7; i++) {
    const p = io(SERVER_URL, { transports: ["websocket"] });
    await new Promise((res) => p.on("connect", res));
    clients.push(p);
    await new Promise((res) => {
      p.emit("join-room", { name: `Player_${i}`, code: roomCode }, (reply) => {
        assert(reply.ok, `Player ${i} joined (capacity: ${i + 1}/8)`);
        res();
      });
    });
  }

  // Attempt to join 9th player
  const ninth = io(SERVER_URL, { transports: ["websocket"] });
  await new Promise((res) => ninth.on("connect", res));
  await new Promise((res) => {
    ninth.emit("join-room", { name: "Player_9", code: roomCode }, (reply) => {
      assert(!reply.ok, "9th player rejected from joining full room");
      assert(reply.error && reply.error.includes("full"), "Error message indicates room is full");
      res();
    });
  });

  // 3. Host Reassignment: Host disconnects, Player_1 should become new host
  let hostReassignedNotice = false;
  clients[0].on("notice", (msg) => {
    if (msg.includes("is now the room host")) hostReassignedNotice = true;
  });

  host.disconnect();
  await sleep(350);
  assert(hostReassignedNotice, "Host departure triggered host reassignment broadcast");

  // Clean up
  ninth.disconnect();
  socket.disconnect();
  clients.forEach(c => c.disconnect());
  await sleep(150);

  console.log("\nEDGE CASES TESTS PASSED SUCCESSFULLY!");
  process.exit(0);
}

runEdgeCases().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
