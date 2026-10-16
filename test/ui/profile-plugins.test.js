import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProfiledDataStore } from '../../public/js/data.js';
import { createDataProfilePreparation } from '../../public/js/ui/dataProfile.js';
import { createStore } from '../../public/js/store.js';
import { isModdedRoom, roomPluginFacts } from '../../public/js/ui/pluginTag.js';
import { roomFacts } from '../../public/js/screens/room.js';
import { contentOf } from '../../public/js/ui/stats.js';

function cache() {
  return createProfiledDataStore({ fetch: async (url) => ({ ok: true,
    json: async () => url.endsWith('assets.json') ? { source: 'shared' }
      : { op: { id: 'op', name: url.includes('/vanilla/') ? 'vanilla' : 'rhine' } },
  }) });
}

test('profile facade keeps cosmetic views shared while gameplay sets replace only their current profile', async () => {
  const data = cache();
  await data.loadAll('assets', 'chess');
  data.setView('assets', (value) => ({ ...value, cosmetic: true }));
  const old = data.snapshot();
  data.setContent({ id: 'plugin-rhine', values: { chess: { added: { id: 'added', name: 'plugin' } } } });
  assert.equal(data.contentId(), 'plugin-rhine');
  assert.equal(data.lookup('chess', 'added').name, 'plugin');
  assert.notEqual(data.generation, old.generation, 'a pending preparation cannot unlock replaced data');
  data.selectProfile(false);
  await data.load('chess');
  assert.equal(data.contentId(), null);
  assert.equal(data.lookup('chess', 'op').name, 'vanilla');
  assert.equal(data.lookup('chess', 'added'), null);
  assert.equal(data.get('assets').cosmetic, true, 'art overlays survive a gameplay profile switch');
  assert.equal(data.getRaw('assets').cosmetic, undefined);
  data.selectProfile(true);
  assert.equal(data.lookup('chess', 'op').name, 'rhine', 'leaving a set restores the original cached roster');
  assert.equal(data.contentId(), null);
});

test('a profile barrier can complete again when a verified gameplay set arrives', async () => {
  const data = cache(), target = createStore({ ui: {} });
  const prepare = createDataProfilePreparation({ cache: data, target, files: ['chess'] });
  await prepare(true);
  data.setContent({ id: 'plugin', values: { chess: { extra: { id: 'extra' } } } });
  await prepare(true);
  assert.equal(target.get().ui.dataReady, true);
  assert.equal(target.get().ui.dataGeneration, data.generation);
  assert.ok(data.lookup('chess', 'extra'));
  data.setContent(null);
  await prepare(true);
  assert.equal(target.get().ui.dataReady, true);
  assert.equal(data.lookup('chess', 'extra'), null);
  assert.equal(data.lookup('chess', 'op').name, 'rhine');
});


test('an original profile with its own content hash waits for verification without a plugin or unofficial mark', () => {
  const room = { mode: 'solo', hostId: 'p1', rhineEnabled: false,
    seats: [{ seat: 0, playerId: 'p1', connected: true, content: 'loading' }],
    content: { cs: 'cd'.repeat(32), vanilla: false, plugins: [] } };
  assert.equal(isModdedRoom(room), false);
  assert.equal(roomPluginFacts(room, 'p1').modded, false);
  assert.equal(roomFacts(room, 'p1').canStart, false);
  assert.equal(roomFacts(room, 'p1').myContent, 'loading');
  room.seats[0].content = 'ready';
  assert.equal(roomFacts(room, 'p1').canStart, true);
  assert.equal(contentOf(room.content), null, 'the original game remains eligible for the ordinary statistics');
  room.content.plugins = [{ id: 'sandbox-kit', version: '1', class: 'script' }];
  assert.equal(isModdedRoom(room), true);
  assert.deepEqual(contentOf(room.content), { cs: room.content.cs, plugins: ['sandbox-kit@1'] });
});
