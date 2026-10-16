import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../../server/index.js';
import { TestClient } from '../helpers/wsClient.js';

const quiet = { info() {}, warn() {}, error() {}, debug() {} };
const extensions = ['rhineShip', 'kazdelShip', 'remShip'];

for (const transport of ['process', 'worker']) test(`an original-profile room stays original through the real ${transport} host and first battle`, { timeout: 60_000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-original-host-'));
  let server, client;
  try {
    server = await startServer({ host: '127.0.0.1', port: 0, quiet: true, log: quiet,
      pluginsDir: path.join(dir, 'plugins'), assetIndex: false, seedFn: () => 31,
      matchHost: { transport, matchOptions: { clientCombat: true, botRehearsal: 0, timerScale: 0 } } });
    client = await TestClient.connect(`ws://127.0.0.1:${server.port}/ws`);
    await client.hello('Original');
    const ok = async (msg) => assert.equal((await client.request(msg, 15_000)).t, 'ok', JSON.stringify(msg));
    await ok({ t: 'room.create', mode: 'solo', difficulty: 'NORMAL', rhineEnabled: false });
    const state = await client.waitFor('room.state', s => s.rhineEnabled === false && !!s.content);
    const cs = state.content.cs;
    assert.notEqual(cs, server.content.cs);
    assert.equal(state.content.vanilla, false, 'the original profile has independently checked content');
    assert.deepEqual(state.content.plugins, []);
    const installed = server.contents.dataOf(cs);
    for (const bond of extensions) assert.equal(installed.bonds[bond], undefined);
    assert.equal(installed.chess.chess_rhine_mayer_a, undefined);
    assert.equal(installed.chess.chess_rem_savage_a, undefined);
    await ok({ t: 'room.contentReady', cs });
    await ok({ t: 'room.start' });
    const info = await client.waitFor('m.public', p => p.phase === 'INFO_CHECK', 15_000);
    assert.equal(info.rhineEnabled, false, 'the IPC option must retain an explicit false');
    assert.equal(info.dataProfile, 'vanilla');
    assert.ok(server.lobby.getRoom(state.code).match.hosted);
    await ok({ t: 'g.infoReady' });
    await client.waitFor('m.public', p => p.phase === 'BAND_DRAFT', 10_000);
    await ok({ t: 'g.band', bandId: 'band_bldsk' });
    const prep = await client.waitFor('m.public', p => p.phase === 'PREP' && p.round === 1, 10_000);
    assert.equal(prep.rhineEnabled, false);
    assert.equal(prep.dataProfile, 'vanilla');
    await ok({ t: 'g.ready', ready: true });
    const battle = await client.waitFor('b.start', () => true, 10_000);
    assert.equal(battle.spec.rhineEnabled, false);
    assert.equal(battle.spec.dataProfile, 'vanilla');
    assert.equal(battle.spec.cs, cs);
    for (const player of battle.spec.players) for (const bond of extensions) assert.equal(player.bonds[bond], undefined);
  } finally {
    await client?.close();
    await server?.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
