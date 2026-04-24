#!/usr/bin/env node
// Time-to-beat simulation (headless, no server, no browser).
//
// Projects how long it takes a reasonably-played character to reach Grand Don
// under three playstyles. Pure-calc: no DB writes, no RNG. Uses job data and
// the XP curve directly so the numbers automatically re-compute when someone
// tweaks cash/xp/energy values.
//
// Strategy modeled: the player always grinds the best-xp/energy job they've
// unlocked, except once a city's tier-5 job has fewer than 25 completions, in
// which case that mastery grind takes priority. This matches how an informed
// player actually progresses toward Grand Don.

const path = require('path');
const assert = require('assert');

const data = require(path.join(__dirname, '..', 'data.js'));
const { JOBS, PROPERTIES, xpForLevel, CITIES, CITY_MASTERY_THRESHOLD } = data;

// ---------- playstyles ----------
// energy_per_day: sustained throughput a player of this type actually spends.
// - idle_optimal: awake ~16h/day, full-regen cycle spent each hour, nothing overnight
// - hardcore:     regen runs 24/7 + occasional FP refills, approximated at full 24h throughput + 1 refill/day
// - casual:       one 15-min check-in/day, spends whatever was banked up to max_energy (~20)
const BASE_ENERGY_REGEN_PER_HOUR = 3600 / data.REGEN.energy; // 20 at REGEN.energy=180
const MAX_ENERGY_BASE = 20;
const PLAYSTYLES = [
  { id: 'idle_optimal', name: 'Idle-optimal (16 waking hours, always spend on cooldown)',
    energy_per_day: BASE_ENERGY_REGEN_PER_HOUR * 16 },
  { id: 'hardcore',     name: 'Hardcore grinder (24/7 + 1 FP refill/day)',
    energy_per_day: BASE_ENERGY_REGEN_PER_HOUR * 24 + MAX_ENERGY_BASE },
  { id: 'casual',       name: 'Casual (one 15-min session/day)',
    energy_per_day: MAX_ENERGY_BASE + Math.floor(15 * 60 / data.REGEN.energy) },
];

// ---------- simulation ----------
function avgCash(job) { return (job.cash[0] + job.cash[1]) / 2; }
function isTier5(job) { return job.tier === 5; }

function citiesMasteredAt(masteryCompletions) {
  return CITIES.filter(city => {
    const t5 = JOBS.filter(j => j.city === city.id && isTier5(j));
    return t5.length > 0 && t5.every(j => (masteryCompletions[j.id] || 0) >= CITY_MASTERY_THRESHOLD);
  });
}

function simulate() {
  let level = 1;
  let xp = 0;
  let cash = 500;
  let energySpent = 0;
  const mastery = {};
  const milestones = {};
  const markMilestone = (key) => { if (!(key in milestones)) milestones[key] = energySpent; };

  const tier5Jobs = JOBS.filter(isTier5);
  for (const j of tier5Jobs) mastery[j.id] = 0;

  // Sanity stop: if we somehow can't make progress, fail loudly.
  let iterations = 0;
  const MAX_ITER = 500000;

  while (iterations++ < MAX_ITER) {
    // Mark milestones as they're reached.
    if (level >= 10)  markMilestone('L10');
    if (level >= 25)  markMilestone('L25');
    if (level >= 50)  markMilestone('L50');
    if (level >= 75)  markMilestone('L75');
    const mastered = citiesMasteredAt(mastery);
    if (mastered.find(ci => ci.id === 'nyc'))     markMilestone('master_nyc');
    if (mastered.find(ci => ci.id === 'chicago')) markMilestone('master_chicago');
    if (mastered.find(ci => ci.id === 'vegas'))   markMilestone('master_vegas');

    // Grand Don requires L75 + all mastered + cash for all 7 properties + all achievements.
    // Other achievements come for free from the grind (1000 jobs ≈ inevitable, 1M cash trivial).
    // Property cost check: each property's base_cost; upgrade_cost at level 0 = base_cost.
    const allPropCost = PROPERTIES.reduce((s, p) => s + p.base_cost, 0);
    if (level >= 75 && mastered.length === 3 && cash >= allPropCost) {
      markMilestone('grand_don');
      break;
    }

    // Pick next job: prefer unmastered tier-5 jobs the player has unlocked; otherwise best xp/energy.
    const unlocked = JOBS.filter(j => j.unlock_level <= level);
    const masteryTargets = unlocked.filter(j => isTier5(j) && (mastery[j.id] || 0) < CITY_MASTERY_THRESHOLD);
    let pick;
    if (masteryTargets.length > 0) {
      // Within mastery targets, still prefer the best xp/energy.
      pick = masteryTargets.reduce((a, b) => (b.xp / b.energy > a.xp / a.energy ? b : a));
    } else if (unlocked.length === 0) {
      throw new Error('no jobs unlocked — something is wrong');
    } else {
      pick = unlocked.reduce((a, b) => (b.xp / b.energy > a.xp / a.energy ? b : a));
    }

    energySpent += pick.energy;
    xp += pick.xp;
    cash += avgCash(pick);
    if (pick.tier === 5) mastery[pick.id] = (mastery[pick.id] || 0) + 1;

    while (xp >= xpForLevel(level + 1)) level++;
  }
  if (iterations >= MAX_ITER) throw new Error('simulation did not converge');

  return { milestones, finalLevel: level, finalCash: cash, finalEnergy: energySpent };
}

// ---------- reporting ----------
function fmtDays(days) {
  if (days < 1) return (days * 24).toFixed(1) + ' hours';
  if (days < 30) return days.toFixed(1) + ' days';
  if (days < 365) return (days / 30).toFixed(1) + ' months';
  return (days / 365).toFixed(2) + ' years';
}

function report(sim) {
  console.log('== TIME TO BEAT ==');
  console.log(`Total energy needed to Grand Don: ${sim.finalEnergy.toLocaleString()}`);
  console.log(`Final level at Grand Don: ${sim.finalLevel} (XP budget satisfied)`);
  console.log(`Cash accumulated en route: $${Math.floor(sim.finalCash).toLocaleString()}\n`);

  const header = 'Playstyle'.padEnd(52) + 'L10'.padStart(10) + 'L25'.padStart(10) + 'L50'.padStart(10) + 'L75'.padStart(10) + 'Grand Don'.padStart(16);
  console.log(header);
  console.log('-'.repeat(header.length));
  const rows = [];
  for (const p of PLAYSTYLES) {
    const days = (key) => sim.milestones[key] / p.energy_per_day;
    const row = {
      style: p.name,
      energy_per_day: p.energy_per_day,
      L10: days('L10'),
      L25: days('L25'),
      L50: days('L50'),
      L75: days('L75'),
      grand_don: days('grand_don'),
    };
    rows.push(row);
    console.log(p.name.padEnd(52)
      + fmtDays(row.L10).padStart(10)
      + fmtDays(row.L25).padStart(10)
      + fmtDays(row.L50).padStart(10)
      + fmtDays(row.L75).padStart(10)
      + fmtDays(row.grand_don).padStart(16));
  }

  console.log('\n-- mastery breakdown --');
  for (const key of ['master_nyc', 'master_chicago', 'master_vegas']) {
    const e = sim.milestones[key];
    if (e == null) { console.log(`${key}: never reached`); continue; }
    console.log(`${key}: ${e.toLocaleString()} energy (hardcore ${fmtDays(e / PLAYSTYLES[1].energy_per_day)}, idle ${fmtDays(e / PLAYSTYLES[0].energy_per_day)}, casual ${fmtDays(e / PLAYSTYLES[2].energy_per_day)})`);
  }

  return rows;
}

// ---------- sanity assertions ----------
// These codify the design intent. If balance drifts too far, the test will
// fail and force a conscious rebalance.
function assertSane(rows) {
  const hardcore = rows.find(r => r.style.startsWith('Hardcore'));
  const idle     = rows.find(r => r.style.startsWith('Idle'));
  const casual   = rows.find(r => r.style.startsWith('Casual'));

  // Hardcore target: 2–12 weeks. Mob Wars-style games historically take months;
  // under 2 weeks would mean the game is too easy to finish.
  assert.ok(hardcore.grand_don >= 14, `hardcore completion too fast (${hardcore.grand_don.toFixed(1)}d) — game is trivial`);
  assert.ok(hardcore.grand_don <= 120, `hardcore completion too slow (${hardcore.grand_don.toFixed(1)}d) — game is a slog`);

  // Idle-optimal should fall in a ~1–9 month window.
  assert.ok(idle.grand_don <= 270, `idle-optimal too slow (${idle.grand_don.toFixed(1)}d)`);
  assert.ok(idle.grand_don >= 21, `idle-optimal too fast (${idle.grand_don.toFixed(1)}d)`);

  // Casual is expected to take long (years), but should not be infinite.
  assert.ok(casual.grand_don < 365 * 10, `casual completion projected over 10 years (${casual.grand_don.toFixed(1)}d) — rebalance`);

  // Ordering sanity: hardcore < idle < casual.
  assert.ok(hardcore.grand_don < idle.grand_don, 'hardcore should beat idle');
  assert.ok(idle.grand_don < casual.grand_don, 'idle should beat casual');
}

function main() {
  const sim = simulate();
  const rows = report(sim);
  assertSane(rows);
  console.log('\n\x1b[32mTTB PASS\x1b[0m — all playstyle budgets within sane bounds');
}

if (require.main === module) main();
module.exports = { simulate, PLAYSTYLES };
