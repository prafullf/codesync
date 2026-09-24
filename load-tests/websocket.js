/**
 * (b) 50 concurrent WebSocket clients editing presence in one room.
 *
 * Each client speaks the real y-websocket protocol: it performs the sync
 * handshake, then publishes an awareness (cursor) update every second with a
 * timestamp. Every other client receives it via the server's fan-out, so we
 * measure broadcast latency across 50 x 49 deliveries per second.
 *
 *   k6 run -e BASE_URL=http://localhost:4000 load-tests/websocket.js
 */
import ws from 'k6/ws';
import { check } from 'k6';
import { Counter, Trend } from 'k6/metrics';
import { BASE_URL, createRoom, joinRoom, signup } from './lib.js';

const CLIENTS = Number(__ENV.CLIENTS || 50);
const HOLD_SECONDS = Number(__ENV.HOLD_SECONDS || 60);

const syncTime = new Trend('yjs_initial_sync_ms', true);
const broadcastLatency = new Trend('awareness_broadcast_latency_ms', true);
const received = new Counter('awareness_messages_received');

export const options = {
  setupTimeout: '120s',
  scenarios: {
    clients: {
      executor: 'per-vu-iterations',
      vus: CLIENTS,
      iterations: 1,
      maxDuration: `${HOLD_SECONDS + 60}s`,
    },
  },
  thresholds: {
    awareness_broadcast_latency_ms: ['p(95)<200'],
    ws_session_duration: [`p(95)>${(HOLD_SECONDS - 5) * 1000}`],
  },
};

// --- tiny lib0 encoding helpers (varUint / varString), enough for the protocol ---
function writeVarUint(bytes, num) {
  while (num > 0x7f) {
    bytes.push(0x80 | (num & 0x7f));
    num = Math.floor(num / 128);
  }
  bytes.push(num & 0x7f);
}
function writeVarString(bytes, str) {
  writeVarUint(bytes, str.length); // ASCII-only payloads
  for (let i = 0; i < str.length; i++) bytes.push(str.charCodeAt(i));
}
function readVarUint(view, pos) {
  let num = 0;
  let mult = 1;
  for (;;) {
    const b = view[pos.i++];
    num += (b & 0x7f) * mult;
    if (b < 0x80) return num;
    mult *= 128;
  }
}
function readVarString(view, pos) {
  const len = readVarUint(view, pos);
  let s = '';
  for (let i = 0; i < len; i++) s += String.fromCharCode(view[pos.i++]);
  return s;
}

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;

function syncStep1() {
  // [messageSync, syncStep1, stateVector = varUint8Array([0])] -> "I have nothing, send me everything".
  return new Uint8Array([MESSAGE_SYNC, 0, 1, 0]).buffer;
}

function awarenessUpdate(clientId, clock, state) {
  const inner = [];
  writeVarUint(inner, 1);
  writeVarUint(inner, clientId);
  writeVarUint(inner, clock);
  writeVarString(inner, JSON.stringify(state));
  const outer = [MESSAGE_AWARENESS];
  writeVarUint(outer, inner.length);
  return new Uint8Array(outer.concat(inner)).buffer;
}

export function setup() {
  const owner = signup('ws-owner');
  const roomId = createRoom(owner, 'PYTHON');
  const cookies = [];
  for (let i = 0; i < CLIENTS; i++) {
    const cookie = signup(`ws${i}`);
    joinRoom(cookie, roomId);
    cookies.push(cookie);
  }
  return { roomId, cookies };
}

export default function (data) {
  const cookie = data.cookies[(__VU - 1) % data.cookies.length];
  const url = `${BASE_URL.replace(/^http/, 'ws')}/yjs/${data.roomId}`;
  const clientId = 1000000 + __VU;
  const connectedAt = Date.now();
  let synced = false;
  let clock = 0;

  const res = ws.connect(url, { headers: { cookie } }, (socket) => {
    socket.on('open', () => socket.sendBinary(syncStep1()));

    socket.on('binaryMessage', (buf) => {
      const view = new Uint8Array(buf);
      const pos = { i: 0 };
      const type = readVarUint(view, pos);
      if (type === MESSAGE_SYNC && !synced) {
        synced = true;
        syncTime.add(Date.now() - connectedAt);
      } else if (type === MESSAGE_AWARENESS) {
        readVarUint(view, pos); // byte length of the update
        const count = readVarUint(view, pos);
        for (let k = 0; k < count; k++) {
          const id = readVarUint(view, pos);
          readVarUint(view, pos); // clock
          const json = readVarString(view, pos);
          if (id === clientId || json === 'null') continue;
          const state = JSON.parse(json);
          if (state && state.ts) {
            broadcastLatency.add(Date.now() - state.ts);
            received.add(1);
          }
        }
      }
    });

    socket.setInterval(() => {
      clock += 1;
      socket.sendBinary(awarenessUpdate(clientId, clock, { user: { name: `vu${__VU}` }, ts: Date.now() }));
    }, 1000);

    socket.setTimeout(() => socket.close(), HOLD_SECONDS * 1000);
  });

  check(res, { 'upgraded (101)': (r) => r && r.status === 101 });
}
