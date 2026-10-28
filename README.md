# Code Clash Arena

A real-time multiplayer reaction game built with React, TypeScript, Express, and Socket.IO.

## Gameplay

- Create a room and share the 5-character code or invite link.
- 2–8 players can join before the host starts.
- Tap blue targets for 1 point and gold bonus targets for 3 points.
- Targets are created and validated by the server; the first valid hit scores.
- Each round lasts 45 seconds. The highest score wins.
- No accounts or installation are needed for players.

## Requirements

- Node.js 20 or newer
- npm

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:5173 in two separate browser sessions (for example, normal + incognito) and join the same room. The Vite dev server proxies no socket traffic: the frontend's default server URL is `window.location.origin`. For local development, set the server URL explicitly:

Create `.env.local`:
```
VITE_SERVER_URL=http://localhost:3001
```

Restart `npm run dev` after adding `.env.local`.

## Build

```bash
npm run build
```

For a single-service production deployment, use a build command that compiles the frontend and server:
```
npm install && npm run build
```

Then start:
```
NODE_ENV=production node dist-server/index.js
```

Ensure the server build outputs `dist-server/index.js`. The server serves the built `dist/` frontend when `NODE_ENV=production`.

## Deploy (single service)

Deploy this repository to a Node.js host that supports persistent processes and WebSockets, such as Render or Railway.

- Build command: `npm install && npm run build`
- Start command: `NODE_ENV=production node dist-server/index.js`
- Add `NODE_ENV=production`
- The host provides `PORT`; the server listens on it.
- Open the host's public URL and test with two separate devices.
- Check `https://YOUR-PUBLIC-URL/health` returns `{ "ok": true, ... }`.

Use a single service first so the frontend and Socket.IO server share the same origin and avoid CORS configuration. Do not use a static-only hosting plan for the whole app; the Socket.IO backend must stay running.

## Test checklist

1. Create a room in browser A.
2. Open the public URL in browser B, enter a different nickname and join with the code.
3. Verify both screens show the same two-player lobby.
4. Start a round from the host; both screens should show the same targets and timer.
5. Tap the same target on both devices quickly; only one player should receive its points.
6. Verify score changes and leaderboard match on both devices.
7. Wait 45 seconds and verify the same finished state and winner on both devices.
8. Host starts another round; scores reset for everyone.
9. Test a bad room code and a full room.
10. Check the mobile layout and the `/health` endpoint.

## Notes / limitations

- Rooms live in server memory. Restarting the service clears all rooms and scores.
- This MVP uses one Node process. For scaling to multiple instances, use a shared Socket.IO adapter and shared game state store.
- Room codes are intended for casual private games, not sensitive data.
- Add moderation, stronger abuse protection, and rate limits before a broad public launch.
