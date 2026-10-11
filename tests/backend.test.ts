import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backendOrigin, privateOrigin, readApiResponse } from '../src/backend';
const location = (protocol: string, hostname: string, port: string, origin: string) => ({
  protocol,
  hostname,
  port,
  origin,
});
test('packaged localhost/file/custom-scheme origins always use private HA HTTPS', () => {
  for (const origin of [
    location('https:', 'localhost', '', 'https://localhost'),
    location('http:', 'localhost', '8080', 'http://localhost:8080'),
    location('file:', '', '', 'null'),
    location('evenhub:', 'localhost', '', 'evenhub://localhost'),
  ])
    assert.equal(backendOrigin(origin), privateOrigin);
  assert.equal(
    backendOrigin(location('http:', 'localhost', '5173', 'http://localhost:5173')),
    'http://localhost:5173/alfred',
  );
  assert.equal(
    backendOrigin(location('http:', '192.168.0.70', '5173', 'http://192.168.0.70:5173')),
    'http://192.168.0.70:5173/alfred',
  );
});
test('non-JSON responses give actionable errors; server pairing failures are preserved', async () => {
  await assert.rejects(
    readApiResponse(new Response('not json', { status: 502 })),
    /unreadable response.*502/,
  );
  await assert.rejects(
    readApiResponse(Response.json({ error: 'Pairing code did not match.' }, { status: 403 })),
    /Pairing code did not match/,
  );
  assert.deepEqual(await readApiResponse(Response.json({ ok: true })), { ok: true });
});
