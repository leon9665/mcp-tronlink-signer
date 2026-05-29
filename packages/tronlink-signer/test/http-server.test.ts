// Tests for HttpServer's originGuard + body-parser wiring (src/http-server.ts).
//
// We boot a REAL server on an ephemeral loopback port and drive it with node:http
// (agent:false → one fresh, immediately-closed connection per request, so nothing
// keeps the test process alive). This exercises the actual express middleware
// stack: originGuard runs BEFORE express.json({limit:'2mb'}), and requireSession
// runs inside each route. Run with tsx: `node --import tsx --test`.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { HttpServer } from '../src/http-server.js';
import { PendingStore } from '../src/pending-store.js';

let server: HttpServer;
let port: number;
let sessionId: string;

before(async () => {
  server = new HttpServer(new PendingStore(), '<html>{{SESSION_ID}}</html>', {});
  // A fixed high port (not 0): the server records this.port from the port it
  // listened on and reuses it in originGuard's allowed-host set, so an ephemeral
  // 0 would leave originGuard checking against ":0". In the default (non-strict)
  // mode an in-use port silently falls back to +1, and getPort() reflects it.
  await server.start(45917);
  port = server.getPort();
  sessionId = server.getSessionId();
});

after(async () => {
  await server.stop();
});

interface Res { status: number; body: string }
function request(opts: {
  method?: string; path?: string; headers?: Record<string, string>; body?: string | null;
}): Promise<Res> {
  const { method = 'GET', path = '/', headers = {}, body = null } = opts;
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, method, path, headers, agent: false },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }));
      },
    );
    req.on('error', reject);
    if (body != null) req.write(body);
    req.end();
  });
}

const validOrigin = () => `http://127.0.0.1:${port}`;
const jsonHeaders = (extra: Record<string, string> = {}) => ({
  'content-type': 'application/json',
  origin: validOrigin(),
  ...extra,
});

test('GET on the loopback host with no Origin passes the guard (reaches the route)', async () => {
  const r = await request({ method: 'GET', path: '/api/health' });
  assert.equal(r.status, 200);
  assert.match(r.body, /"status":"ok"/);
});

test('rejects a non-loopback Host header (DNS-rebinding defense)', async () => {
  const r = await request({ method: 'GET', path: '/', headers: { host: 'evil.com' } });
  assert.equal(r.status, 403);
  assert.match(r.body, /Forbidden host/);
});

test('a write with no Origin/Referer is rejected before the route', async () => {
  const r = await request({ method: 'POST', path: '/api/heartbeat', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(r.status, 403);
  assert.match(r.body, /Origin required/);
});

test('a write with a cross-origin Origin is rejected', async () => {
  const r = await request({
    method: 'POST', path: '/api/heartbeat',
    headers: { 'content-type': 'application/json', origin: 'http://evil.com' }, body: '{}',
  });
  assert.equal(r.status, 403);
  assert.match(r.body, /Forbidden origin/);
});

test('origin-valid but session-missing reaches the route, then 410 (guard passed, auth failed)', async () => {
  const r = await request({ method: 'POST', path: '/api/heartbeat', headers: jsonHeaders(), body: '{}' });
  assert.equal(r.status, 410);
  assert.match(r.body, /Session expired/);
});

test('origin-valid + valid session + small body → 200', async () => {
  const r = await request({
    method: 'POST', path: '/api/heartbeat',
    headers: jsonHeaders({ 'x-session-id': sessionId }), body: '{}',
  });
  assert.equal(r.status, 200);
  assert.match(r.body, /"ok":true/);
});

test('a 120KB JSON body is accepted (regression: > express 100KB default, < 2mb)', async () => {
  // A signed contract-deploy / large-data tx easily exceeds 100KB; before the
  // limit was raised this 413'd and hung /api/complete until the 5-min timeout.
  const body = JSON.stringify({ blob: 'x'.repeat(120 * 1024) });
  const r = await request({
    method: 'POST', path: '/api/heartbeat',
    headers: jsonHeaders({ 'x-session-id': sessionId }), body,
  });
  assert.equal(r.status, 200);
});

test('a body over the 2mb limit is rejected with 413', async () => {
  const body = JSON.stringify({ blob: 'x'.repeat(2.1 * 1024 * 1024) });
  const r = await request({
    method: 'POST', path: '/api/heartbeat',
    headers: jsonHeaders({ 'x-session-id': sessionId }), body,
  });
  assert.equal(r.status, 413);
});

test('the session id is never exposed via a GET endpoint', async () => {
  // It is baked into the HTML server-side only; a local process that can read it
  // could forge approvals. Spot-check the obvious read surfaces.
  for (const path of ['/api/health', '/api/debug', '/js/wallet.js']) {
    const r = await request({ method: 'GET', path });
    assert.ok(!r.body.includes(sessionId), `${path} leaked the session id`);
  }
});
