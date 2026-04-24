#!/usr/bin/env node
// Lightweight Node test harness using the globally-installed `playwright`
// automation API (no @playwright/test dependency). Boots the server on a
// unique port with a fresh DB, runs a battery of flows, and reports PASS/FAIL.

const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');

// Resolve the globally-installed playwright package since it isn't a local dep.
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

const PORT = process.env.WABMORS_TEST_PORT || 4789;
const BASE = `http://localhost:${PORT}`;
const DB_PATH = path.join(__dirname, '..', 'test.db');

// ---------- utilities ----------
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
  // Wipe any prior test db
  for (const ext of ['', '-wal', '-shm', '-journal']) {
    try { fs.unlinkSync(DB_PATH + ext); } catch (_) {}
  }
  const child = spawn('node', ['server.js'], {
    env: { ...process.env, PORT: String(PORT), DATABASE_FILE: DB_PATH, SESSION_SECRET: 'test' },
    cwd: path.join(__dirname, '..'),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', () => {});
  child.stderr.on('data', (d) => process.stderr.write('[server] ' + d));
  return child;
}

// ---------- minimal test framework ----------
const results = [];
let passed = 0, failed = 0;

async function step(name, fn) {
  process.stdout.write(`  • ${name} ... `);
  try {
    await fn();
    console.log('\x1b[32mPASS\x1b[0m');
    results.push({ name, ok: true });
    passed++;
  } catch (e) {
    console.log('\x1b[31mFAIL\x1b[0m');
    console.log('      ' + (e.stack || e.message).split('\n').slice(0, 4).join('\n      '));
    results.push({ name, ok: false, error: e.message });
    failed++;
  }
}

// ---------- tests ----------
// Backend integration checks (no server/browser needed — just hit the game
// module with a time-travel DB). Covers regen, offline income, achievements,
// leveling — the invisible stuff UI smoke tests can't see.
async function runBackendChecks() {
  const BE_DB = path.join(__dirname, '..', 'test-be.db');
  for (const ext of ['', '-wal', '-shm', '-journal']) {
    try { fs.unlinkSync(BE_DB + ext); } catch (_) {}
  }
  // Force the game module (and its db import) onto this fresh DB. Must come
  // before require('./db') is cached.
  process.env.DATABASE_FILE = BE_DB;

  // Clear node's require cache for these files so we pick up the new DB path.
  delete require.cache[require.resolve(path.join(__dirname, '..', 'db.js'))];
  delete require.cache[require.resolve(path.join(__dirname, '..', 'game.js'))];
  delete require.cache[require.resolve(path.join(__dirname, '..', 'data.js'))];
  const db   = require(path.join(__dirname, '..', 'db.js'));
  const game = require(path.join(__dirname, '..', 'game.js'));

  console.log('\n== BACKEND INTEGRATION ==');

  await step('regen: energy rewinds 400s → +2 at 180s/pt', async () => {
    const c = game.createGuest();
    game.doJob(c, 'mug_tourist');
    game.doJob(c, 'mug_tourist');
    db.prepare('UPDATE characters SET energy_ts = energy_ts - 400 WHERE id = ?').run(c.id);
    const r = game.getCharacter(c.id);
    assert.strictEqual(r.energy, 18, `expected 18 after +2, got ${r.energy}`);
  });

  await step('regen: stamina rewinds 900s → regenerates toward max', async () => {
    const c = game.createGuest();
    game.seedNpcsIfEmpty(10);
    const npc = db.prepare('SELECT id FROM characters WHERE is_npc = 1 LIMIT 1').get();
    game.resolveFight(game.getCharacter(c.id), game.getCharacter(npc.id));
    const before = game.getCharacter(c.id).stamina;
    db.prepare('UPDATE characters SET stamina_ts = stamina_ts - 900 WHERE id = ?').run(c.id);
    const after = game.getCharacter(c.id).stamina;
    assert.ok(after > before, `stamina should tick back up, before=${before} after=${after}`);
  });

  await step('regen: caps at max, excess time does not accumulate', async () => {
    const c = game.createGuest();
    db.prepare('UPDATE characters SET energy_ts = energy_ts - 99999 WHERE id = ?').run(c.id);
    const r = game.getCharacter(c.id);
    assert.strictEqual(r.energy, r.max_energy, 'stays at max');
  });

  await step('property income accrues offline & caps at 24h', async () => {
    const c = game.createGuest();
    db.prepare('UPDATE characters SET cash = 10000 WHERE id = ?').run(c.id);
    const a = game.getCharacter(c.id);
    game.buyOrUpgradeProperty(a, 'newsstand');
    // 30 min = half an hour at $40/hr → ~$20
    db.prepare('UPDATE properties SET last_collect_ts = last_collect_ts - 1800 WHERE character_id = ?').run(c.id);
    const p = game.getOwnedProperties(c.id)[0];
    assert.ok(p.uncollected >= 18 && p.uncollected <= 22, `30min ≈ $20 (got $${p.uncollected})`);
    // now rewind an additional 24h — cap should kick in
    db.prepare('UPDATE properties SET last_collect_ts = last_collect_ts - 86400 WHERE character_id = ?').run(c.id);
    const p2 = game.getOwnedProperties(c.id)[0];
    assert.strictEqual(p2.uncollected, p2.cap, `24h cap: ${p2.uncollected} / ${p2.cap}`);
  });

  await step('collect banks uncollected and resets timer', async () => {
    const c = game.createGuest();
    db.prepare('UPDATE characters SET cash = 10000 WHERE id = ?').run(c.id);
    game.buyOrUpgradeProperty(game.getCharacter(c.id), 'newsstand');
    db.prepare('UPDATE properties SET last_collect_ts = last_collect_ts - 3600 WHERE character_id = ?').run(c.id);
    const before = game.getCharacter(c.id).cash;
    const collected = game.collectProperties(game.getCharacter(c.id));
    const after = game.getCharacter(c.id).cash;
    assert.ok(collected > 0, `collected > 0 (got ${collected})`);
    assert.ok(after - before >= collected, `cash rose by at least the collected amount`);
    // collecting again should yield nothing
    const again = game.collectProperties(game.getCharacter(c.id));
    assert.strictEqual(again, 0, `immediate re-collect should be $0, got ${again}`);
  });

  await step('level-up refills all vitals and grants +5 SP', async () => {
    const c = game.createGuest();
    db.prepare('UPDATE characters SET xp = 99999, energy = 5, stamina = 1, health = 50 WHERE id = ?').run(c.id);
    const pre = game.getCharacter(c.id);
    game.applyLevelUps(pre);
    const post = game.getCharacter(c.id);
    assert.ok(post.level > 1, `leveled up to ${post.level}`);
    assert.strictEqual(post.energy, post.max_energy, 'energy refilled');
    assert.strictEqual(post.stamina, post.max_stamina, 'stamina refilled');
    assert.strictEqual(post.health, post.max_health, 'health refilled');
    assert.ok(post.skill_points >= 5, `got SP (${post.skill_points})`);
  });

  await step('achievements evaluate + auto-pay rewards', async () => {
    const c = game.createGuest();
    db.prepare('UPDATE characters SET wins = 1, cash = 1000 WHERE id = ?').run(c.id);
    const pre = game.getCharacter(c.id);
    const cashBefore = pre.cash;
    game.evaluateAchievements(pre);
    const post = game.getCharacter(c.id);
    const earned = game.getAchievements(c.id).filter(a => a.earned).map(a => a.id);
    assert.ok(earned.includes('first_blood'), 'First Blood (wins >= 1) should fire');
    assert.ok(post.cash > cashBefore, `First Blood reward applied (+$, cashBefore=${cashBefore} cashAfter=${post.cash})`);
  });

  await step('city mastery passive: NYC discount applies to property cost', async () => {
    const c = game.createGuest();
    db.prepare('UPDATE characters SET cash = 100000000, level = 80 WHERE id = ?').run(c.id);
    const base = game.propertyUpgradeCost({ base_cost: 3000 }, 0);
    // Force mastery by seeding job_mastery rows for every NYC tier-5 job
    const t5 = ['take_syndicate', 'heist_fed', 'command_family'];
    for (const j of t5) {
      db.prepare(`INSERT INTO job_mastery (character_id, job_id, completions) VALUES (?, ?, 50)
                  ON CONFLICT(character_id, job_id) DO UPDATE SET completions = 50`).run(c.id, j);
    }
    const discounted = game.propertyUpgradeCost({ base_cost: 3000 }, 0, c.id);
    assert.ok(discounted < base, `NYC mastery should discount (${discounted} < ${base})`);
    const ratio = discounted / base;
    assert.ok(ratio >= 0.93 && ratio <= 0.97, `~5% off (got ${(1 - ratio) * 100}%)`);
  });

  // clean up
  for (const ext of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(BE_DB + ext); } catch (_) {}
  }
}

async function runAll() {
  // Backend section first — fast, no server/browser.
  await runBackendChecks();

  const pw = loadPlaywright();
  console.log(`\nBooting server on :${PORT} (fresh DB)`);
  const server = bootServer();
  try {
    await waitForServer(BASE);
  } catch (e) {
    server.kill();
    throw e;
  }

  const shotsDir = path.join(__dirname, '..', 'screenshots');
  if (!fs.existsSync(shotsDir)) fs.mkdirSync(shotsDir);

  const browser = await pw.chromium.launch();
  try {
    // ----- DESKTOP project -----
    console.log('\n== DESKTOP 1280×800 ==');
    {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const page = await ctx.newPage();

      await step('guest auto-create → hub', async () => {
        const resp = await page.goto(`${BASE}/`);
        assert.ok(resp && page.url().endsWith('/hub'), `expected /hub, got ${page.url()}`);
        const name = (await page.locator('.pill.name').first().innerText()).split('\n')[0].trim();
        assert.match(name, /#\d+/, `guest name should have #NNNN suffix, got "${name}"`);
        const claim = await page.locator('.pill.name .claim-inline').count();
        assert.strictEqual(claim, 1, 'Claim link should render inside the name pill');
      });

      await step('theme swap changes body class + bg color + font', async () => {
        await page.goto(`${BASE}/account`);
        const mafiaClass = await page.locator('body').getAttribute('class');
        assert.match(mafiaClass, /theme-mafia/);
        const mafiaBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);

        await page.locator('form[action="/prefs/theme/cyber"] button').click();
        await page.waitForURL(/\/account/);
        const cyberClass = await page.locator('body').getAttribute('class');
        assert.match(cyberClass, /theme-cyber/);
        const cyberBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
        assert.notStrictEqual(cyberBg, mafiaBg, `cyber bg (${cyberBg}) should differ from mafia (${mafiaBg})`);
        assert.strictEqual(cyberBg, 'rgb(0, 0, 0)', `cyber bg should be pure black, got ${cyberBg}`);

        const font = await page.evaluate(() => getComputedStyle(document.body).fontFamily.toLowerCase());
        assert.match(font, /consolas|courier|mono/, `cyber font should be monospace, got ${font}`);

        // Also check nav background — the bug the user reported
        const navBg = await page.evaluate(() => {
          const nav = document.querySelector('.navbar');
          return nav ? getComputedStyle(nav).backgroundColor : null;
        });
        assert.strictEqual(navBg, 'rgb(0, 0, 0)', `nav bg should also flip, got ${navBg}`);

        // Switch back
        await page.locator('form[action="/prefs/theme/mafia"] button').click();
        await page.waitForURL(/\/account/);
      });

      await step('lore pack swaps city names', async () => {
        await page.goto(`${BASE}/jobs`);
        const mafiaCity = await page.locator('.city-tab.active').innerText();
        assert.match(mafiaCity, /New York/);

        await page.goto(`${BASE}/account`);
        await page.locator('form[action="/prefs/lore/cyber"] button').click();
        await page.waitForURL(/\/account/);

        await page.goto(`${BASE}/jobs`);
        const cyberCity = await page.locator('.city-tab.active').innerText();
        assert.match(cyberCity, /The Veins/, `cyber lore city should be "The Veins", got "${cyberCity}"`);

        await page.goto(`${BASE}/account`);
        await page.locator('form[action="/prefs/lore/mafia"] button').click();
      });

      await step('do a job, action log + energy advance', async () => {
        await page.goto(`${BASE}/jobs`);
        const enBefore = await page.locator('.pill.en').innerText();
        for (let i = 0; i < 3; i++) {
          await page.locator('form[action="/jobs/mug_tourist"] button').first().click();
          await page.waitForURL(/\/jobs/);
        }
        const enAfter = await page.locator('.pill.en').innerText();
        assert.notStrictEqual(enAfter, enBefore, 'energy should have changed');
        const logText = await page.locator('.action-log li .text').first().innerText();
        assert.match(logText, /Mug a Tourist/);
      });

      await step('fight: attacking drains stamina', async () => {
        await page.goto(`${BASE}/fight`);
        const stBefore = await page.locator('.pill.st').innerText();
        await page.locator('form[action^="/fight/"] button').first().click();
        await page.waitForURL(/\/fight/);
        const stAfter = await page.locator('.pill.st').innerText();
        assert.notStrictEqual(stAfter, stBefore, 'stamina should decrement');
      });

      await step('claim account', async () => {
        const nameBefore = (await page.locator('.pill.name').first().innerText()).split('\n')[0].trim();
        await page.goto(`${BASE}/claim`);
        const uniq = 'testuser_' + Math.floor(Math.random() * 1e6);
        await page.fill('input[name=username]', uniq);
        await page.fill('input[name=password]', 'pizza1');
        await page.locator('form[action="/claim"] button').click();
        await page.waitForURL((u) => !/claim/.test(u.pathname));
        const claimAfter = await page.locator('.pill.name .claim-inline').count();
        assert.strictEqual(claimAfter, 0, 'claim link should disappear after claiming');

        // Logout → relogin → same character
        await page.locator('form[action="/logout"] button').click();
        await page.waitForURL(/\/login$/);
        await ctx.clearCookies();
        await page.goto(`${BASE}/login`);
        await page.fill('input[name=username]', uniq);
        await page.fill('input[name=password]', 'pizza1');
        await page.locator('form[action="/login"] button').click();
        await page.waitForURL(/\/hub/);
        const nameAfter = (await page.locator('.pill.name').first().innerText()).split('\n')[0].trim();
        assert.strictEqual(nameAfter, nameBefore, `relogin should restore same character, had "${nameBefore}" now "${nameAfter}"`);
      });

      await step('desktop screenshots (mafia + cyber)', async () => {
        // Mafia
        for (const p of ['/hub', '/jobs', '/account', '/fight', '/workshop']) {
          await page.goto(BASE + p);
          const slug = p.replace('/', '') || 'root';
          await page.screenshot({ path: path.join(shotsDir, `desktop-mafia-${slug}.png`), fullPage: true });
        }
        // Cyber
        await page.goto(`${BASE}/account`);
        await page.locator('form[action="/prefs/theme/cyber"] button').click();
        await page.waitForURL(/\/account/);
        for (const p of ['/hub', '/jobs', '/account', '/fight', '/workshop']) {
          await page.goto(BASE + p);
          const slug = p.replace('/', '') || 'root';
          await page.screenshot({ path: path.join(shotsDir, `desktop-cyber-${slug}.png`), fullPage: true });
        }
        // Reset
        await page.goto(`${BASE}/account`);
        await page.locator('form[action="/prefs/theme/mafia"] button').click();
      });

      await ctx.close();
    }

    // ----- RESPONSIVE screenshot sweep -----
    for (const vp of [
      { label: 'phone',  w: 390,  h: 844  },
      { label: 'tablet', w: 768,  h: 1024 },
    ]) {
      console.log(`\n== ${vp.label.toUpperCase()} ${vp.w}×${vp.h} ==`);
      const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h } });
      const page = await ctx.newPage();

      await step(`${vp.label}: hub renders without horizontal overflow`, async () => {
        await page.goto(`${BASE}/`);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
        assert.strictEqual(overflow, false, `viewport ${vp.w}px: body horizontally overflows`);
      });

      await step(`${vp.label}: nav is reachable (scrollable or visible)`, async () => {
        await page.goto(`${BASE}/hub`);
        const navCount = await page.locator('.navbar a').count();
        assert.ok(navCount >= 5, `nav should have ≥5 links, has ${navCount}`);
      });

      await step(`${vp.label}: screenshot sweep`, async () => {
        for (const p of ['/hub', '/jobs', '/account']) {
          await page.goto(BASE + p);
          const slug = p.replace('/', '') || 'root';
          await page.screenshot({ path: path.join(shotsDir, `${vp.label}-${slug}.png`), fullPage: true });
        }
      });

      await ctx.close();
    }
  } finally {
    await browser.close();
    server.kill();
    // best-effort cleanup
    for (const ext of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(DB_PATH + ext); } catch (_) {}
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

runAll().catch((e) => {
  console.error('\nFATAL:', e.stack || e.message);
  process.exit(1);
});
