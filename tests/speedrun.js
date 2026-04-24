#!/usr/bin/env node
// Speedrun test: drives a fresh character to Grand Don (the win state) using
// time-travel + direct game-module calls, then verifies the completion banner
// renders in the browser. Asserts the full beat-the-game flow executes end to
// end within a wall-clock budget.
//
// This is *not* a normal-play simulation — for that, see tests/ttb.js. The
// point of this test is: if a character reaches the systemic end state, the
// game correctly recognizes it and shows the completion screen.

const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');

function loadPlaywright() {
  try { return require('playwright'); } catch (_) {}
  const globalCandidates = [
    path.join(os.homedir(), 'AppData/Roaming/npm/node_modules/playwright'),
    '/usr/local/lib/node_modules/playwright',
    '/usr/lib/node_modules/playwright',
  ];
  for (const p of globalCandidates) {
    if (fs.existsSync(p)) return require(p);
  }
  throw new Error('playwright not found (install globally or locally)');
}

const PORT = process.env.WABMORS_SPEEDRUN_PORT || 4791;
const BASE = `http://localhost:${PORT}`;
const DB_PATH = path.join(__dirname, '..', 'test-speedrun.db');
// Grand Don should be reachable via the test shortcuts in well under this;
// anything over 60s means something went seriously wrong (infinite loop, etc).
const BUDGET_SECONDS = 60;

function waitForServer(url, timeoutMs = 20000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      http.get(url, { timeout: 1500 }, (res) => { res.resume(); resolve(); })
        .on('error', () => {
          if (Date.now() - start > timeoutMs) return reject(new Error('server never came up'));
          setTimeout(check, 300);
        });
    };
    check();
  });
}

function bootServer() {
  for (const ext of ['', '-wal', '-shm', '-journal']) {
    try { fs.unlinkSync(DB_PATH + ext); } catch (_) {}
  }
  const child = spawn('node', ['server.js'], {
    env: { ...process.env, PORT: String(PORT), DATABASE_FILE: DB_PATH, SESSION_SECRET: 'speedrun' },
    cwd: path.join(__dirname, '..'),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', () => {});
  child.stderr.on('data', (d) => process.stderr.write('[server] ' + d));
  return child;
}

async function run() {
  const t0 = Date.now();
  console.log('== SPEEDRUN: fresh char → Grand Don ==');

  // Force game/db modules onto the speedrun DB (must happen before requires).
  process.env.DATABASE_FILE = DB_PATH;
  delete require.cache[require.resolve(path.join(__dirname, '..', 'db.js'))];
  delete require.cache[require.resolve(path.join(__dirname, '..', 'game.js'))];
  delete require.cache[require.resolve(path.join(__dirname, '..', 'data.js'))];
  const db = require(path.join(__dirname, '..', 'db.js'));
  const game = require(path.join(__dirname, '..', 'game.js'));
  const data = require(path.join(__dirname, '..', 'data.js'));

  const server = bootServer();
  try {
    await waitForServer(BASE);

    const pw = loadPlaywright();
    const browser = await pw.chromium.launch();
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    // 1) Guest auto-create via the standard flow.
    await page.goto(`${BASE}/`);
    assert.ok(page.url().endsWith('/hub'), `expected /hub, got ${page.url()}`);

    // 2) Identify the freshly-created character (one guest user + 60 NPCs exist).
    const guestRow = db.prepare(`SELECT c.id FROM characters c
      JOIN users u ON u.id = c.user_id WHERE u.is_guest = 1 ORDER BY c.id DESC LIMIT 1`).get();
    assert.ok(guestRow, 'guest character should exist');
    const charId = guestRow.id;

    // 3) Award enough XP to hit L75 and the full complement of skill points.
    const xpTarget = data.xpForLevel(76);
    db.prepare('UPDATE characters SET xp = ?, cash = ? WHERE id = ?').run(xpTarget, 50000000, charId);
    const c1 = game.getCharacter(charId);
    const gained = game.applyLevelUps(c1);
    assert.ok(c1.level >= 75, `leveled to ${c1.level} (gained ${gained})`);

    // 4) Master every tier-5 job in every city (25 completions each).
    const tier5 = data.JOBS.filter(j => j.tier === 5);
    for (const j of tier5) {
      db.prepare(`INSERT INTO job_mastery (character_id, job_id, completions) VALUES (?, ?, 25)
                  ON CONFLICT(character_id, job_id) DO UPDATE SET completions = 25`)
        .run(charId, j.id);
    }

    // 5) Own every property (any level counts toward 'all_properties').
    //    Bypass the cash check — we've already validated purchase logic elsewhere.
    const t = Math.floor(Date.now() / 1000);
    for (const p of data.PROPERTIES) {
      db.prepare(`INSERT INTO properties (character_id, property_id, level, last_collect_ts, uncollected)
                  VALUES (?, ?, 1, ?, 0)
                  ON CONFLICT(character_id, property_id) DO NOTHING`)
        .run(charId, p.id, t);
    }

    // 6) Force the combat / jobs achievement conditions by stamping the counters.
    db.prepare('UPDATE characters SET wins = 1000, jobs_done = 1000, cash = 2000000 WHERE id = ?').run(charId);

    // 7) Evaluate — this pass should light up everything in order, ending with grand_don.
    const c2 = game.getCharacter(charId);
    game.evaluateAchievements(c2);

    // 8) Verify in DB.
    const earned = db.prepare('SELECT achievement_id FROM achievements WHERE character_id = ?').all(charId).map(r => r.achievement_id);
    const missing = data.ACHIEVEMENTS.filter(a => !earned.includes(a.id)).map(a => a.id);
    assert.deepStrictEqual(missing, [], `all achievements earned (missing: ${missing.join(', ')})`);

    const fresh = db.prepare('SELECT completed_at FROM characters WHERE id = ?').get(charId);
    assert.ok(fresh.completed_at, `completed_at should be set, got ${fresh.completed_at}`);

    // 9) Reload hub and check the completion banner renders.
    await page.goto(`${BASE}/hub`);
    const banner = await page.locator('.completion-banner').count();
    assert.strictEqual(banner, 1, 'completion banner should render');
    const title = await page.locator('.completion-title').innerText();
    assert.match(title, /GRAND DON/i, `title should say GRAND DON, got "${title}"`);

    // 10) Achievements page shows Grand Don earned.
    await page.goto(`${BASE}/achievements`);
    const grandDon = await page.locator('.achievement.earned').filter({ hasText: 'Grand Don' }).count();
    assert.strictEqual(grandDon, 1, 'Grand Don should be shown as earned');

    await browser.close();
  } finally {
    server.kill();
    for (const ext of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(DB_PATH + ext); } catch (_) {}
    }
  }

  const elapsed = (Date.now() - t0) / 1000;
  console.log(`\n\x1b[32mSPEEDRUN PASS\x1b[0m — completed in ${elapsed.toFixed(2)}s (budget ${BUDGET_SECONDS}s)`);
  if (elapsed > BUDGET_SECONDS) {
    console.error(`\x1b[31mover budget\x1b[0m`);
    process.exit(1);
  }
}

run().catch((e) => {
  console.error('\x1b[31mSPEEDRUN FAIL\x1b[0m', e);
  process.exit(1);
});
