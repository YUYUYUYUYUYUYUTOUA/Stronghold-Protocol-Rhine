import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHASE } from '../../shared/constants.js';
import { GameData } from '../../server/match/gamedata.js';
import { generateDraft, bountyDraftKind } from '../../server/match/choices.js';
import { createRng } from '../../server/sim/rng.js';
import { Battle } from '../../server/sim/Battle.js';
import { DATA, makeMatch, give, checkInvariants } from './harness.js';

const MODE = 'mode_multi_hard';
const CARD = new Map(DATA.choices.cards.bounty.map((c) => [c.effectId, c]));
const FORCE = {
  ...DATA,
  choices: {
    ...DATA.choices,
    schedule: {
      ...DATA.choices.schedule,
      [MODE]: {
        ...DATA.choices.schedule[MODE],
        rounds: {
          ...Object.fromEntries(Object.entries(DATA.choices.schedule[MODE].rounds).map(([r, s]) => [r, { ...s, families: [{ family: 'bounty', weight: 1 }] }])),
          6: { cards: 6, families: [{ family: 'bounty', weight: 1 }], bountyDraft: 'initial' },
        },
      },
    },
  },
};

test('five/six-seat bounty drafts preserve the original six and add distinct existing I/II/II targets paying 1/2/2', () => {
  let bossFallback = false;
  for (const seats of [5, 6]) for (const round of [3, 6, 9, 11]) for (let seed = 1; seed <= 120; seed++) {
    const small = generateDraft(new GameData(FORCE, MODE, 4), createRng(seed), round);
    const large = generateDraft(new GameData(FORCE, MODE, seats), createRng(seed), round);
    assert.equal(large.cards.length, 9, `R${round}, ${seats} seats, seed ${seed}`);
    assert.deepEqual(large.cards.slice(0, 6), small.cards, 'original six stay intact');
    assert.equal(new Set(large.cards.map((c) => c.id)).size, 9);
    assert.deepEqual(large.cards.map((c) => c.idx), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
    assert.deepEqual(large.cards.slice(6).map((c) => c.tier), [1, 2, 2]);
    assert.deepEqual(large.cards.slice(6).map((c) => c.coin), [1, 2, 2]);
    const kind = bountyDraftKind(round);
    for (const c of large.cards.slice(6)) {
      const source = CARD.get(c.id);
      assert.ok(source?.draft && source.payout === 'kill');
      assert.equal(c.payout, 'kill');
      assert.equal(c.enemyKey, source.enemyKey);
      assert.equal(c.rounds, kind === 'initial' ? 2 : 1);
      assert.ok(DATA.enemies[c.enemyKey]?.stats.maxHp > 0, 'real enemy with positive HP');
      if (kind === 'boss' && source.draftPool === 'hunter') {
        bossFallback = true;
        assert.equal(c.tier, 1);
      } else assert.equal(source.draftPool, kind, 'initial drafts never add later enemies');
    }
  }
  assert.ok(bossFallback, 'the exhausted boss I pool receives a distinct one-battle I target');
});

test('solo and one-to-four-seat drafts keep their existing card counts; other families keep six cards in large rooms', () => {
  for (const seats of [1, 2, 3, 4]) assert.equal(generateDraft(new GameData(FORCE, MODE, seats), createRng(9), 3).cards.length, 6);
  assert.equal(generateDraft(new GameData(DATA, 'mode_single_hard', 6), createRng(9), 3).cards.length, 3);
  for (const family of ['supply', 'shop', 'tactic']) {
    const data = structuredClone(FORCE);
    data.choices.schedule[MODE].rounds['3'].families = [{ family, weight: 1 }];
    assert.equal(generateDraft(new GameData(data, MODE, 6), createRng(9), 3).cards.length, 6, family);
  }
});

test('restricted/invalid bounty data does not append missing targets, non-kill payouts or repeated IDs', () => {
  const data = structuredClone(FORCE);
  const one = data.choices.cards.bounty.find((c) => c.draftPool === 'initial' && c.tier === 1);
  data.choices.cards.bounty = [one, { ...one, effectId: 'missing', enemyKey: 'missing' }, { ...one, effectId: 'perfect', payout: 'perfect' }];
  const draft = generateDraft(new GameData(data, MODE, 6), createRng(6), 3);
  assert.deepEqual(draft.cards.map((c) => c.id).sort(), [one.effectId, 'perfect'].sort());
  assert.ok(draft.cards.every((c) => c.enemyKey !== 'missing'));
});

test('six humans can choose indices 6/7/8, each choice creates its own real bounty, and three choices remain', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'HARD', humans: 6, seed: 9701, fake: true }).start();
  const m = h.m;
  assert.ok(h.drive(() => m.phase === PHASE.SP_DRAFT && m.round === 3));
  const draft = m.sp;
  assert.equal(m.publicView().sp.cards.length, 9);
  for (const idx of [6, 7, 8, 0, 1, 2]) {
    const ps = h.ps(m.spTurn());
    const card = draft.cards[idx];
    assert.deepEqual(m.handle(ps.playerId, { t: 'g.choice', idx }), { ok: true });
    assert.ok(ps.bounties.some((b) => b.card.effectId === card.id && b.card.coin === card.coin));
  }
  assert.equal(Object.keys(draft.picks).length, 6);
  assert.equal(draft.cards.filter((c) => draft.taken[c.idx] == null).length, 3);
  h.runToPhase(PHASE.PREP, 3);
  checkInvariants(m);
  m.dispose();
});

test('two timed humans and four bots safely finish a nine-card bounty draft without duplicate picks', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'HARD', humans: 2, bots: 4, seed: 9702, fake: true }).start();
  const m = h.m;
  assert.ok(h.drive(() => m.phase === PHASE.SP_DRAFT && m.round === 3));
  const draft = m.sp;
  assert.equal(draft.cards.length, 9);
  h.runToPhase(PHASE.PREP, 3);
  assert.equal(Object.keys(draft.picks).length, 6);
  assert.equal(new Set(Object.values(draft.picks)).size, 6);
  assert.equal(draft.cards.filter((c) => draft.taken[c.idx] == null).length, 3);
  assert.ok(Object.values(draft.picks).every((i) => i >= 0 && i < 9));
  assert.deepEqual(h.logs.error, []);
  assert.deepEqual(h.sched.errors, []);
  checkInvariants(m);
  m.dispose();
});

test('the three extra targets are killed by real operators and pay their 1/2/2 funds through normal settlement', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'HARD', humans: 6, seed: 9703, fake: true }).start();
  const m = h.m;
  h.setStage('act2autochess_m01');
  assert.ok(h.drive(() => m.phase === PHASE.SP_DRAFT && m.round === 3));
  const draft = m.sp;
  const picked = [];
  for (const idx of [6, 7, 8, 0, 1, 2]) {
    const ps = h.ps(m.spTurn());
    assert.deepEqual(m.handle(ps.playerId, { t: 'g.choice', idx }), { ok: true });
    if (idx >= 6) picked.push({ ps, card: draft.cards[idx] });
  }
  h.runToPhase(PHASE.PREP, 3);
  // Isolate the extra three rewards: other players' fixtures have no bounty that could pay these helpers in 联防.
  for (const ps of m.players.values()) if (!picked.some((x) => x.ps === ps)) ps.bounties = [];
  for (const { ps } of picked) {
    for (const [id, row, col] of [['chess_char_4_23_b', 9, 3], ['chess_char_6_01_b', 10, 4], ['chess_char_4_02_b', 11, 4]]) give(m, ps, id, 'board', [row, col]);
  }
  m.BattleClass = Battle;
  assert.ok(h.drive(() => m.phase === PHASE.SETTLE && m.round === 3));
  for (const { ps, card } of picked) {
    const result = m.lastResults.get(ps.playerId);
    assert.equal(result.coins, card.coin, `${card.id} ${card.enemyKey}: real damage kills its bounty target`);
    assert.equal(ps.pendingFunds, card.coin, 'settlement credits the funds once');
    assert.equal(ps.bounties[0].roundsLeft, 1, 'initial bounty lasts two battles');
  }
  assert.deepEqual(h.logs.error, []);
  assert.ok(h.drive(() => m.phase === PHASE.PREP && m.round === 4));
  for (const { ps, card } of picked) assert.equal(ps.funds, m.gd.income(4) + card.coin, 'next round makes the bounty funds spendable');
  assert.ok(h.drive(() => m.phase === PHASE.SETTLE && m.round === 4));
  for (const { ps, card } of picked) {
    assert.equal(m.lastResults.get(ps.playerId).coins, card.coin, 'the second battle also pays the exact bounty reward');
    assert.equal(ps.pendingFunds, card.coin);
    assert.equal(ps.bounties.length, 0, 'the bounty expires after its two battles');
  }
  assert.deepEqual(h.logs.error, []);
  m.dispose();
});
