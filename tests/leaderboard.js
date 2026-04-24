#!/usr/bin/env node
// Leaderboard diff + wipe-detection + Discord formatting tests.
// Pure-unit: no DB writes, no network. Builds fake snapshots inline and
// asserts diff() produces the expected events.

const assert = require('assert');
const path = require('path');

// Force game/db modules onto a fresh test DB so snapshot() has something to
// read, even though most tests here use hand-rolled snapshot objects.
const DB_PATH = path.join(__dirname, '..', 'test-leaderboard.db');
const fs = require('fs');
for (const ext of ['', '-wal', '-shm', '-journal']) {
  try { fs.unlinkSync(DB_PATH + ext); } catch (_) {}
}
process.env.DATABASE_FILE = DB_PATH;

const leaderboard = require(path.join(__dirname, '..', 'leaderboard.js'));

let passed = 0, failed = 0;
function step(name, fn) {
  process.stdout.write(`  • ${name} ... `);
  try {
    fn();
    console.log('\x1b[32mPASS\x1b[0m');
    passed++;
  } catch (e) {
    console.log('\x1b[31mFAIL\x1b[0m');
    console.log('      ' + (e.stack || e.message).split('\n').slice(0, 4).join('\n      '));
    failed++;
  }
}

function fakeSnapshot(overrides = {}) {
  return {
    version: 1,
    taken_at: 1700000000,
    player_count: 50,
    by_level: [],
    by_cash: [],
    by_wins: [],
    firsts: { grand_don: null, mastery: { nyc: null, chicago: null, vegas: null } },
    ...overrides,
  };
}

console.log('== LEADERBOARD DIFF ==');

step('bootstrap: first run emits one event', () => {
  const curr = fakeSnapshot({ player_count: 12 });
  const events = leaderboard.diff(null, curr);
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].kind, 'bootstrap');
  assert.match(events[0].text, /12 players/);
});

step('no change: empty diff', () => {
  const same = fakeSnapshot({
    by_level: [{ id: 1, name: 'Vinny', level: 10 }, { id: 2, name: 'Tony', level: 9 }],
    by_cash:  [{ id: 1, name: 'Vinny', level: 10, cash: 1000 }],
    by_wins:  [{ id: 2, name: 'Tony', level: 9, wins: 5 }],
  });
  const events = leaderboard.diff(same, same);
  assert.strictEqual(events.length, 0);
});

step('promotion: player moves up on Level board', () => {
  const prev = fakeSnapshot({ by_level: [{ id: 1, name: 'Tony', level: 10 }, { id: 2, name: 'Vinny', level: 9 }] });
  const curr = fakeSnapshot({ by_level: [{ id: 2, name: 'Vinny', level: 11 }, { id: 1, name: 'Tony', level: 10 }] });
  const events = leaderboard.diff(prev, curr);
  const promotes = events.filter(e => e.kind === 'promote');
  const demotes  = events.filter(e => e.kind === 'demote');
  assert.strictEqual(promotes.length, 1, `got promotes: ${promotes.map(e => e.text)}`);
  assert.match(promotes[0].text, /Vinny.*#2.*#1/);
  assert.strictEqual(demotes.length, 1);
  assert.match(demotes[0].text, /Tony.*#1.*#2/);
});

step('debut: new player appears in top-N', () => {
  const prev = fakeSnapshot({ by_wins: [{ id: 1, name: 'Tony', level: 5, wins: 10 }] });
  const curr = fakeSnapshot({ by_wins: [{ id: 1, name: 'Tony', level: 5, wins: 10 }, { id: 99, name: 'Newbie', level: 3, wins: 8 }] });
  const events = leaderboard.diff(prev, curr);
  const debuts = events.filter(e => e.kind === 'debut');
  assert.strictEqual(debuts.length, 1);
  assert.match(debuts[0].text, /Newbie.*#2/);
});

step('dropped: player falls off top-N', () => {
  const prev = fakeSnapshot({ by_cash: [{ id: 1, name: 'Tony', level: 5, cash: 100 }, { id: 2, name: 'Vinny', level: 6, cash: 50 }] });
  const curr = fakeSnapshot({ by_cash: [{ id: 1, name: 'Tony', level: 5, cash: 100 }] });
  const events = leaderboard.diff(prev, curr);
  const dropped = events.filter(e => e.kind === 'dropped');
  assert.strictEqual(dropped.length, 1);
  assert.match(dropped[0].text, /Vinny/);
});

step('grand_don milestone fires exactly once on first transition', () => {
  const prev = fakeSnapshot();
  const curr = fakeSnapshot({ firsts: { ...prev.firsts, grand_don: { id: 7, name: 'DonVito', level: 75 } } });
  const events = leaderboard.diff(prev, curr);
  const gd = events.filter(e => e.kind === 'grand_don');
  assert.strictEqual(gd.length, 1);
  assert.match(gd[0].text, /DonVito/);

  // And on the next tick, with the same winner in prev, no event.
  const events2 = leaderboard.diff(curr, curr);
  assert.strictEqual(events2.filter(e => e.kind === 'grand_don').length, 0);
});

step('city-mastery firsts: per-city trigger', () => {
  const prev = fakeSnapshot();
  const curr = fakeSnapshot({
    firsts: { grand_don: null, mastery: {
      nyc: { id: 3, name: 'Carlo', level: 40 },
      chicago: null, vegas: null,
    }},
  });
  const events = leaderboard.diff(prev, curr);
  const firsts = events.filter(e => e.kind === 'first');
  assert.strictEqual(firsts.length, 1);
  assert.match(firsts[0].text, /Carlo.*New York/);
});

console.log('\n== WIPE DETECTION ==');

step('wipe: 50 → 2 is a wipe', () => {
  const prev = fakeSnapshot({ player_count: 50 });
  const curr = fakeSnapshot({ player_count: 2 });
  assert.strictEqual(leaderboard.looksLikeWipe(prev, curr), true);
});

step('not a wipe: gentle decline within noise', () => {
  const prev = fakeSnapshot({ player_count: 50 });
  const curr = fakeSnapshot({ player_count: 45 });
  assert.strictEqual(leaderboard.looksLikeWipe(prev, curr), false);
});

step('not a wipe: no prev at all', () => {
  assert.strictEqual(leaderboard.looksLikeWipe(null, fakeSnapshot()), false);
});

step('not a wipe: tiny baseline where one player leaving looks catastrophic', () => {
  const prev = fakeSnapshot({ player_count: 3 });
  const curr = fakeSnapshot({ player_count: 0 });
  assert.strictEqual(leaderboard.looksLikeWipe(prev, curr), false);
});

console.log('\n== DISCORD FORMATTING ==');

step('empty events → no messages', () => {
  const curr = fakeSnapshot();
  const msgs = leaderboard.formatForDiscord([], curr);
  assert.strictEqual(msgs.length, 0);
});

step('single event → one message with date header', () => {
  const curr = fakeSnapshot({ taken_at: 1700000000 });
  const events = [{ kind: 'promote', text: '**Vinny** rose from #3 → #1 on Level.' }];
  const msgs = leaderboard.formatForDiscord(events, curr);
  assert.strictEqual(msgs.length, 1);
  assert.match(msgs[0].content, /Wabmors leaderboard/);
  assert.match(msgs[0].content, /Vinny/);
});

step('long burst: chunks under 2000-char Discord cap', () => {
  const curr = fakeSnapshot();
  const events = [];
  for (let i = 0; i < 100; i++) events.push({ kind: 'promote', text: `**Player${i}** did a thing worth tracking`.padEnd(50, '.') });
  const msgs = leaderboard.formatForDiscord(events, curr);
  for (const m of msgs) assert.ok(m.content.length <= 2000, `chunk too long: ${m.content.length}`);
  // At ~50 chars each, 100 events spread across multiple messages.
  assert.ok(msgs.length >= 2, `expected chunking, got ${msgs.length} messages`);
});

console.log('\n== SNAPSHOT (live DB read) ==');

step('snapshot works on empty DB and returns the shape the tick expects', () => {
  // Seed a minimum schema by importing db.
  require(path.join(__dirname, '..', 'db.js'));
  const snap = leaderboard.snapshot();
  assert.strictEqual(snap.version, 1);
  assert.ok(typeof snap.taken_at === 'number');
  assert.ok(Array.isArray(snap.by_level));
  assert.ok(Array.isArray(snap.by_cash));
  assert.ok(Array.isArray(snap.by_wins));
  assert.ok(snap.firsts && snap.firsts.mastery);
  assert.strictEqual(snap.firsts.grand_don, null);
});

for (const ext of ['', '-wal', '-shm', '-journal']) {
  try { fs.unlinkSync(DB_PATH + ext); } catch (_) {}
}

if (failed > 0) {
  console.log(`\n\x1b[31m${failed} failed\x1b[0m (${passed} passed)`);
  process.exit(1);
}
console.log(`\n\x1b[32m${passed} passed\x1b[0m`);
