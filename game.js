const db = require('./db');
const {
  ITEMS, JOBS, PROPERTIES, REGEN, SKILL_COST, SKILL_POINTS_PER_LEVEL,
  INCOME_CAP_HOURS, xpForLevel, NPC_NAMES, MOB, HIRED_GUN_NAMES,
  CITIES, CITY_MASTERY_THRESHOLD, AMBUSH, ACHIEVEMENTS,
} = require('./data');

const now = () => Math.floor(Date.now() / 1000);
const rand = (min, max) => min + Math.floor(Math.random() * (max - min + 1));
const randf = (min, max) => min + Math.random() * (max - min);

// ---------- ACTION LOG ----------
// Trim per-character to the last LOG_KEEP rows to keep table small.
const LOG_KEEP = 30;
function logAction(charId, kind, text, good = 0) {
  db.prepare('INSERT INTO action_log (character_id, kind, text, good, ts) VALUES (?, ?, ?, ?, ?)')
    .run(charId, kind, text, good ? 1 : 0, now());
  // Prune
  db.prepare(`DELETE FROM action_log WHERE character_id = ? AND id NOT IN (
    SELECT id FROM action_log WHERE character_id = ? ORDER BY id DESC LIMIT ?
  )`).run(charId, charId, LOG_KEEP);
}
function getActionLog(charId, n = 12) {
  return db.prepare('SELECT kind, text, good, ts FROM action_log WHERE character_id = ? ORDER BY id DESC LIMIT ?')
    .all(charId, n);
}

// ---------- REGEN ----------
// Vitals are stored as (value, updated_at). We compute current on read and
// persist if changed. Max regen only fills up to max; excess (e.g. from daily rewards) is preserved.
function regenVitals(c) {
  const t = now();
  for (const [key, tsKey, max] of [
    ['energy', 'energy_ts', c.max_energy],
    ['stamina', 'stamina_ts', c.max_stamina],
    ['health', 'health_ts', c.max_health],
  ]) {
    const stat = key;
    const elapsed = t - c[tsKey];
    if (elapsed <= 0) continue;
    if (c[stat] >= max) {
      // Cap at max but advance the clock so we don't accumulate past.
      if (c[stat] > max) continue; // preserve overflow
      c[tsKey] = t;
      continue;
    }
    const rate = REGEN[stat];
    const gained = Math.floor(elapsed / rate);
    if (gained > 0) {
      c[stat] = Math.min(max, c[stat] + gained);
      c[tsKey] = c[tsKey] + gained * rate;
    }
  }
}

function saveVitals(c) {
  db.prepare(`UPDATE characters SET
    health = ?, energy = ?, stamina = ?,
    health_ts = ?, energy_ts = ?, stamina_ts = ?
    WHERE id = ?`)
    .run(c.health, c.energy, c.stamina, c.health_ts, c.energy_ts, c.stamina_ts, c.id);
}

// ---------- CHARACTER HELPERS ----------
function getCharacter(id) {
  const c = db.prepare('SELECT * FROM characters WHERE id = ?').get(id);
  if (!c) return null;
  regenVitals(c);
  return c;
}

function getCharacterByUser(userId) {
  const c = db.prepare('SELECT * FROM characters WHERE user_id = ?').get(userId);
  if (!c) return null;
  regenVitals(c);
  return c;
}

function createCharacter({ userId, name, isNpc = 0, level = 1 }) {
  const t = now();
  const insert = db.prepare(`INSERT INTO characters
    (user_id, name, is_npc, level, xp, skill_points,
     max_health, max_energy, max_stamina, attack, defense,
     health, energy, stamina, health_ts, energy_ts, stamina_ts,
     cash, favor_points, gamer_points, created_at)
    VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`);

  // Scale up NPC/start stats by level.
  const hp = 100 + (level - 1) * 15;
  const en = 20 + (level - 1) * 3;
  const st = 5 + (level - 1) * 1;
  const atk = 5 + (level - 1) * 4;
  const def = 5 + (level - 1) * 4;
  const sp = isNpc ? 0 : SKILL_POINTS_PER_LEVEL;
  const cash = isNpc ? rand(200, 5000) * level : 500;
  const fp = isNpc ? 0 : 5;

  const result = insert.run(
    userId, name, isNpc, level, sp,
    hp, en, st, atk, def,
    hp, en, st, t, t, t,
    cash, fp, t
  );
  return getCharacter(result.lastInsertRowid);
}

// ---------- LEVELING ----------
function applyLevelUps(c) {
  let levelsGained = 0;
  while (c.xp >= xpForLevel(c.level + 1)) {
    c.level += 1;
    c.skill_points += SKILL_POINTS_PER_LEVEL;
    // Refill on level up
    c.energy = Math.max(c.energy, c.max_energy);
    c.health = Math.max(c.health, c.max_health);
    c.stamina = Math.max(c.stamina, c.max_stamina);
    // Favor point every 5 levels
    if (c.level % 5 === 0) c.favor_points += 1;
    levelsGained += 1;
  }
  if (levelsGained > 0) {
    db.prepare(`UPDATE characters SET
      level = ?, skill_points = ?, favor_points = ?,
      health = ?, energy = ?, stamina = ?,
      health_ts = ?, energy_ts = ?, stamina_ts = ?
      WHERE id = ?`)
      .run(c.level, c.skill_points, c.favor_points,
           c.health, c.energy, c.stamina,
           c.health_ts, c.energy_ts, c.stamina_ts, c.id);
  }
  return levelsGained;
}

function spendSkillPoint(c, stat) {
  const cfg = SKILL_COST[stat];
  if (!cfg) throw new Error('unknown stat');
  if (c.skill_points < cfg.sp) throw new Error('not enough skill points');
  c.skill_points -= cfg.sp;
  c[stat] += cfg.per;
  // If we increased a max cap, leave current at its current value (player heals/regens back).
  db.prepare(`UPDATE characters SET skill_points = ?, ${stat} = ? WHERE id = ?`)
    .run(c.skill_points, c[stat], c.id);
}

// ---------- INVENTORY ----------
function addItem(charId, itemId, qty = 1) {
  if (!ITEMS[itemId]) throw new Error('unknown item: ' + itemId);
  db.prepare(`INSERT INTO inventory (character_id, item_id, quantity) VALUES (?, ?, ?)
              ON CONFLICT(character_id, item_id) DO UPDATE SET quantity = quantity + excluded.quantity`)
    .run(charId, itemId, qty);
}

function removeItem(charId, itemId, qty = 1) {
  const row = db.prepare('SELECT quantity FROM inventory WHERE character_id = ? AND item_id = ?').get(charId, itemId);
  if (!row || row.quantity < qty) return false;
  const next = row.quantity - qty;
  if (next === 0) db.prepare('DELETE FROM inventory WHERE character_id = ? AND item_id = ?').run(charId, itemId);
  else db.prepare('UPDATE inventory SET quantity = ? WHERE character_id = ? AND item_id = ?').run(next, charId, itemId);
  return true;
}

function getInventory(charId) {
  return db.prepare('SELECT item_id, quantity FROM inventory WHERE character_id = ?')
    .all(charId)
    .map(r => ({ ...ITEMS[r.item_id], item_id: r.item_id, quantity: r.quantity }))
    .sort((a, b) => (a.slot === b.slot ? b.atk + b.def - a.atk - a.def : a.slot.localeCompare(b.slot)));
}

// Number of "slots" per item type brought into a fight:
//   1 (the player themselves) + the active mob size.
// Active mob size = min(total mob size, floor(level * MOB.active_per_level)).
function activeMobSize(char) {
  const total = mobCount(char.id);
  const byLevel = Math.floor(char.level * MOB.active_per_level);
  return Math.min(total, byLevel);
}
function loadoutSlotsPerType(char) {
  return 1 + activeMobSize(char);
}

// Equipped loadout: top-N weapons + top-N armor + top-N vehicles (N = 1 + active mob size).
function bestLoadout(char, mode = 'attack') {
  const inv = getInventory(char.id);
  const n = loadoutSlotsPerType(char);
  const pickTopN = (slot) => {
    const candidates = inv
      .filter(i => i.slot === slot && i.quantity > 0)
      // Each quantity slot can back one mobster; expand stacks
      .flatMap(i => Array(i.quantity).fill(i));
    if (candidates.length === 0) return [];
    const score = mode === 'attack'
      ? (i) => i.atk * 2 + i.def
      : (i) => i.def * 2 + i.atk;
    candidates.sort((a, b) => score(b) - score(a));
    return candidates.slice(0, n);
  };
  return {
    weapons:  pickTopN('weapon'),
    armors:   pickTopN('armor'),
    vehicles: pickTopN('vehicle'),
  };
}

function loadoutTotals(loadout) {
  const all = [...(loadout.weapons || []), ...(loadout.armors || []), ...(loadout.vehicles || [])];
  return all.reduce((acc, i) => ({ atk: acc.atk + i.atk, def: acc.def + i.def }), { atk: 0, def: 0 });
}

// Preview helpers (single-best, for UI summary)
function topItem(loadout, slot) {
  const list = loadout[slot === 'weapon' ? 'weapons' : slot === 'armor' ? 'armors' : 'vehicles'];
  return list && list[0] ? list[0] : null;
}

// ---------- MOB / HIRED GUNS ----------
function mobCap(level) {
  const bonus = Math.max(0, level - MOB.level75_threshold) * MOB.level75_bonus_per;
  return Math.min(MOB.hard_cap, MOB.base_cap + bonus);
}
function mobCount(ownerId) {
  return db.prepare('SELECT COUNT(*) AS n FROM mob_members WHERE owner_id = ?').get(ownerId).n;
}
function getMob(ownerId) {
  return db.prepare('SELECT slot, name, kind, joined_at FROM mob_members WHERE owner_id = ? ORDER BY slot ASC').all(ownerId);
}
function nextMobSlot(ownerId) {
  const row = db.prepare('SELECT MAX(slot) AS m FROM mob_members WHERE owner_id = ?').get(ownerId);
  return (row.m || 0) + 1;
}
function hireGun(c) {
  if (c.favor_points < MOB.hired_gun_cost_fp) throw new Error('not enough favor points');
  if (mobCount(c.id) >= mobCap(c.level)) throw new Error('mob full (level up to raise cap)');
  c.favor_points -= MOB.hired_gun_cost_fp;
  const name = HIRED_GUN_NAMES[Math.floor(Math.random() * HIRED_GUN_NAMES.length)]
    + ' #' + Math.floor(Math.random() * 10000);
  db.prepare('INSERT INTO mob_members (owner_id, slot, name, kind, joined_at) VALUES (?, ?, ?, ?, ?)')
    .run(c.id, nextMobSlot(c.id), name, 'hired_gun', now());
  db.prepare('UPDATE characters SET favor_points = ? WHERE id = ?').run(c.favor_points, c.id);
  logAction(c.id, 'mob', `Hired ${name} (−1 FP)`, 1);
  return { name };
}
function fireMobster(c, slot) {
  const row = db.prepare('SELECT name FROM mob_members WHERE owner_id = ? AND slot = ?').get(c.id, slot);
  if (!row) throw new Error('not in mob');
  db.prepare('DELETE FROM mob_members WHERE owner_id = ? AND slot = ?').run(c.id, slot);
  logAction(c.id, 'mob', `Fired ${row.name}`, 0);
}

// ---------- JOBS ----------
function doJob(c, jobId) {
  const job = JOBS.find(j => j.id === jobId);
  if (!job) throw new Error('unknown job');
  if (c.level < job.unlock_level) throw new Error('level too low');
  if (c.energy < job.energy) throw new Error('not enough energy');

  c.energy -= job.energy;
  c.energy_ts = now(); // reset the regen clock from current state
  const cash = rand(job.cash[0], job.cash[1]);
  const xp = job.xp;
  c.cash += cash;
  c.xp += xp;
  c.jobs_done += 1;

  let lootItem = null;
  if (job.loot && Math.random() < job.loot.chance) {
    lootItem = job.loot.item;
    addItem(c.id, lootItem, 1);
  }
  let salvageItem = null;
  if (job.salvage && Math.random() < job.salvage.chance) {
    salvageItem = job.salvage.item;
    addItem(c.id, salvageItem, 1);
  }

  // mastery
  db.prepare(`INSERT INTO job_mastery (character_id, job_id, completions) VALUES (?, ?, 1)
              ON CONFLICT(character_id, job_id) DO UPDATE SET completions = completions + 1`)
    .run(c.id, jobId);

  db.prepare(`UPDATE characters SET
    cash = ?, xp = ?, energy = ?, energy_ts = ?, jobs_done = ?
    WHERE id = ?`)
    .run(c.cash, c.xp, c.energy, c.energy_ts, c.jobs_done, c.id);

  const leveledUp = applyLevelUps(c);
  evaluateAchievements(c);
  let msg = `${job.name}: +$${cash.toLocaleString()} / +${xp} XP`;
  if (lootItem) msg += ` / loot: ${ITEMS[lootItem].name}`;
  if (salvageItem) msg += ` / salvage: ${ITEMS[salvageItem].name}`;
  if (leveledUp) msg += ` / LEVEL UP! (+${leveledUp})`;
  logAction(c.id, 'job', msg, 1);
  return { cash, xp, lootItem, salvageItem, leveledUp };
}

function getJobMastery(charId) {
  const rows = db.prepare('SELECT job_id, completions FROM job_mastery WHERE character_id = ?').all(charId);
  const map = {};
  for (const r of rows) map[r.job_id] = r.completions;
  return map;
}

// ---------- CITY MASTERY PASSIVES ----------
// A city's passive is earned once every tier-5 job in that city has
// >= CITY_MASTERY_THRESHOLD completions.
function earnedCityPassives(charId) {
  const mastery = getJobMastery(charId);
  const earned = [];
  for (const city of CITIES) {
    const tier5 = JOBS.filter(j => j.city === city.id && j.tier === 5);
    if (tier5.length === 0) continue;
    const allMastered = tier5.every(j => (mastery[j.id] || 0) >= CITY_MASTERY_THRESHOLD);
    if (allMastered) earned.push(city);
  }
  return earned;
}

function cityPassiveModifier(charId, kind) {
  let total = 0;
  for (const city of earnedCityPassives(charId)) {
    if (city.passive.kind === kind) total += city.passive.value;
  }
  return total;
}

// ---------- FIGHTING ----------
// Total fight strength = personal stat + item slot sum (top-N per slot, N = 1 + active mob) + flat per-mobster bonus.
function fightStrength(c, mode = 'attack') {
  const loadout = bestLoadout(c, mode);
  const items = loadoutTotals(loadout);
  const mobN = activeMobSize(c);
  const flat = mode === 'attack'
    ? mobN * MOB.flat_atk_per_mobster
    : mobN * MOB.flat_def_per_mobster;
  if (mode === 'attack') return (c.attack + items.atk + flat) * randf(0.85, 1.15);
  return (c.defense + items.def + flat) * randf(0.85, 1.15);
}

function resolveFight(attacker, defender) {
  if (attacker.stamina < 1) return { error: 'not enough stamina' };
  attacker.stamina -= 1;
  attacker.stamina_ts = now();

  // Check if defender has set an ambush against this attacker.
  const ambush = consumeAmbush(defender.id, attacker.id);
  let ambushDmg = 0;
  if (ambush) {
    ambushDmg = Math.floor(attacker.max_health * AMBUSH.damage_multiplier);
    attacker.health = Math.max(0, attacker.health - ambushDmg);
  }

  const atkStr = fightStrength(attacker, 'attack');
  const defStr = fightStrength(defender, 'defense');
  const atkWon = atkStr >= defStr;

  // damage dealt is scaled by the strength ratio
  const ratio = atkStr / Math.max(1, defStr);
  const baseDmgToDef = Math.floor(attacker.max_health * randf(0.05, 0.15) * (atkWon ? Math.min(2, ratio) : 1 / Math.max(1, ratio)));
  const baseDmgToAtk = Math.floor(defender.max_health * randf(0.03, 0.09) * (atkWon ? 1 / Math.max(1, ratio) : Math.min(2, 1 / ratio)));

  const dmgToDef = Math.max(1, baseDmgToDef);
  const dmgToAtk = Math.max(1, baseDmgToAtk);

  defender.health = Math.max(0, defender.health - dmgToDef);
  attacker.health = Math.max(0, attacker.health - dmgToAtk);

  let cashStolen = 0;
  let xp = 0;
  if (atkWon) {
    cashStolen = Math.floor(defender.cash * randf(0.03, 0.12));
    cashStolen = Math.min(cashStolen, defender.cash);
    defender.cash -= cashStolen;
    attacker.cash += cashStolen;
    xp = 3 + Math.floor(defender.level * 0.8);
    const xpBonus = cityPassiveModifier(attacker.id, 'fight_xp');
    if (xpBonus > 0) xp = Math.floor(xp * (1 + xpBonus));
    attacker.xp += xp;
    attacker.wins += 1;
    defender.losses += 1;
  } else {
    attacker.losses += 1;
    defender.wins += 1;
  }

  const t = now();
  db.prepare(`UPDATE characters SET
    cash = ?, xp = ?, health = ?, stamina = ?,
    health_ts = ?, stamina_ts = ?,
    wins = ?, losses = ?
    WHERE id = ?`)
    .run(attacker.cash, attacker.xp, attacker.health, attacker.stamina,
         attacker.health_ts, attacker.stamina_ts,
         attacker.wins, attacker.losses, attacker.id);
  db.prepare(`UPDATE characters SET
    cash = ?, health = ?, health_ts = ?, wins = ?, losses = ?
    WHERE id = ?`)
    .run(defender.cash, defender.health, t, defender.wins, defender.losses, defender.id);

  db.prepare(`INSERT INTO fight_log
    (attacker_id, defender_id, winner_id, cash_stolen, damage_to_def, damage_to_atk, xp_gained, kind, ts)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(attacker.id, defender.id, atkWon ? attacker.id : defender.id,
         cashStolen, dmgToDef, dmgToAtk, xp, 'fight', t);

  const leveledUp = atkWon ? applyLevelUps(attacker) : 0;
  evaluateAchievements(attacker);

  let msg = atkWon
    ? `Beat ${defender.name}: +$${cashStolen.toLocaleString()} / +${xp} XP · dealt ${dmgToDef}, took ${dmgToAtk}`
    : `Lost to ${defender.name}: dealt ${dmgToDef}, took ${dmgToAtk}`;
  if (ambushDmg > 0) msg += ` · AMBUSHED for ${ambushDmg}`;
  logAction(attacker.id, 'fight', msg, atkWon ? 1 : 0);
  if (ambushDmg > 0) {
    logAction(defender.id, 'ambush', `Ambush fired on ${attacker.name} for ${ambushDmg} damage`, 1);
  }

  return { won: atkWon, cashStolen, xp, dmgToDef, dmgToAtk, leveledUp,
           ambushDmg, atkStr: Math.floor(atkStr), defStr: Math.floor(defStr) };
}

// Opponents within +/- 20% level range, excluding self.
function findOpponents(c, limit = 20) {
  const lo = Math.max(1, Math.floor(c.level * 0.8));
  const hi = Math.ceil(c.level * 1.2) + 1;
  return db.prepare(`SELECT id, name, level, wins, losses, cash, is_npc
    FROM characters
    WHERE id != ? AND level BETWEEN ? AND ?
    ORDER BY RANDOM() LIMIT ?`)
    .all(c.id, lo, hi, limit);
}

// ---------- HITLIST ----------
function placeHit(placerId, targetId, bounty) {
  if (placerId === targetId) throw new Error('cannot hit self');
  const placer = getCharacter(placerId);
  if (placer.cash < bounty) throw new Error('not enough cash');
  if (bounty < 1000) throw new Error('bounty too small (min 1000)');
  db.prepare('UPDATE characters SET cash = cash - ? WHERE id = ?').run(bounty, placerId);
  db.prepare(`INSERT INTO hitlist (target_id, placer_id, bounty, created_at) VALUES (?, ?, ?, ?)`)
    .run(targetId, placerId, bounty, now());
}

function getOpenHits(limit = 50) {
  return db.prepare(`SELECT h.id, h.bounty, h.created_at,
      t.id AS target_id, t.name AS target_name, t.level AS target_level, t.health AS target_health,
      p.name AS placer_name
    FROM hitlist h
    JOIN characters t ON t.id = h.target_id
    JOIN characters p ON p.id = h.placer_id
    WHERE h.completed_at IS NULL
    ORDER BY h.bounty DESC LIMIT ?`).all(limit);
}

function completeHit(hitId, hunterId) {
  const hit = db.prepare('SELECT * FROM hitlist WHERE id = ? AND completed_at IS NULL').get(hitId);
  if (!hit) throw new Error('hit not open');
  if (hit.target_id === hunterId) throw new Error('cannot hunt self');
  const hunter = getCharacter(hunterId);
  const target = getCharacter(hit.target_id);
  if (hunter.stamina < 2) throw new Error('need 2 stamina for a hit');
  hunter.stamina -= 2;
  hunter.stamina_ts = now();

  const hunterStr = fightStrength(hunter, 'attack') * 1.15; // hit bonus
  const targetStr = fightStrength(target, 'defense');
  const won = hunterStr >= targetStr;

  const t = now();
  const dmgToTgt = Math.floor(target.max_health * randf(0.25, 0.5));
  const dmgToHnt = Math.floor(hunter.max_health * randf(0.05, 0.15));
  target.health = Math.max(0, target.health - dmgToTgt);
  hunter.health = Math.max(0, hunter.health - dmgToHnt);

  if (won) {
    hunter.cash += hit.bounty;
    hunter.xp += Math.floor(hit.bounty * 0.00002) + 10;
    hunter.wins += 1;
    db.prepare('UPDATE hitlist SET completed_by = ?, completed_at = ? WHERE id = ?')
      .run(hunter.id, t, hit.id);
  } else {
    hunter.losses += 1;
  }

  db.prepare(`UPDATE characters SET cash = ?, xp = ?, health = ?, stamina = ?,
    health_ts = ?, stamina_ts = ?, wins = ?, losses = ? WHERE id = ?`)
    .run(hunter.cash, hunter.xp, hunter.health, hunter.stamina,
         hunter.health_ts, hunter.stamina_ts, hunter.wins, hunter.losses, hunter.id);
  db.prepare('UPDATE characters SET health = ?, health_ts = ? WHERE id = ?')
    .run(target.health, t, target.id);
  db.prepare(`INSERT INTO fight_log
    (attacker_id, defender_id, winner_id, cash_stolen, damage_to_def, damage_to_atk, xp_gained, kind, ts)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'hit', ?)`)
    .run(hunter.id, target.id, won ? hunter.id : target.id,
         won ? hit.bounty : 0, dmgToTgt, dmgToHnt, won ? 10 : 0, t);

  if (won) applyLevelUps(hunter);
  evaluateAchievements(hunter);
  const msg = won
    ? `Hit completed on ${target.name}: +$${hit.bounty.toLocaleString()}`
    : `Hit failed on ${target.name}: dealt ${dmgToTgt}, took ${dmgToHnt}`;
  logAction(hunter.id, 'hit', msg, won ? 1 : 0);
  return { won, bounty: won ? hit.bounty : 0, dmgToTgt, dmgToHnt };
}

// ---------- PROPERTIES ----------
function propertyIncomePerHour(prop, level, charId = null) {
  const base = prop.base_income * level;
  if (charId === null) return base;
  const bonus = cityPassiveModifier(charId, 'income_bonus');
  return Math.floor(base * (1 + bonus));
}

function propertyUpgradeCost(prop, currentLevel, charId = null) {
  const raw = currentLevel === 0 ? prop.base_cost : Math.floor(prop.base_cost * (currentLevel + 1) * 0.6);
  if (charId === null) return raw;
  const discount = cityPassiveModifier(charId, 'property_discount');
  return Math.floor(raw * (1 - discount));
}

function getOwnedProperties(charId) {
  const rows = db.prepare('SELECT * FROM properties WHERE character_id = ?').all(charId);
  return rows.map(r => {
    const def = PROPERTIES.find(p => p.id === r.property_id);
    const perHour = propertyIncomePerHour(def, r.level, charId);
    const elapsedHours = (now() - r.last_collect_ts) / 3600;
    const capped = Math.min(INCOME_CAP_HOURS, elapsedHours);
    const currentUncollected = r.uncollected + Math.floor(perHour * capped);
    const capValue = perHour * INCOME_CAP_HOURS;
    return { ...def, level: r.level, per_hour: perHour,
             uncollected: Math.min(currentUncollected, capValue), cap: capValue,
             last_collect_ts: r.last_collect_ts };
  });
}

function buyOrUpgradeProperty(c, propertyId) {
  const def = PROPERTIES.find(p => p.id === propertyId);
  if (!def) throw new Error('unknown property');
  if (c.level < def.unlock_level) throw new Error('level too low');
  const row = db.prepare('SELECT * FROM properties WHERE character_id = ? AND property_id = ?').get(c.id, propertyId);
  const currentLevel = row ? row.level : 0;
  const cost = propertyUpgradeCost(def, currentLevel, c.id);
  if (c.cash < cost) throw new Error('not enough cash');
  c.cash -= cost;
  db.prepare('UPDATE characters SET cash = ? WHERE id = ?').run(c.cash, c.id);
  const t = now();
  if (row) {
    // Bank uncollected before bumping the level so rate change is clean.
    const perHour = propertyIncomePerHour(def, row.level);
    const elapsedHours = (t - row.last_collect_ts) / 3600;
    const capped = Math.min(INCOME_CAP_HOURS, elapsedHours);
    const banked = row.uncollected + Math.floor(perHour * capped);
    db.prepare(`UPDATE properties SET level = level + 1, last_collect_ts = ?, uncollected = ?
                WHERE character_id = ? AND property_id = ?`)
      .run(t, banked, c.id, propertyId);
  } else {
    db.prepare(`INSERT INTO properties (character_id, property_id, level, last_collect_ts, uncollected)
                VALUES (?, ?, 1, ?, 0)`).run(c.id, propertyId, t);
  }
  evaluateAchievements(c);
  return { cost, newLevel: currentLevel + 1 };
}

function collectProperties(c) {
  const props = getOwnedProperties(c.id);
  let total = 0;
  const t = now();
  for (const p of props) {
    total += p.uncollected;
    db.prepare('UPDATE properties SET uncollected = 0, last_collect_ts = ? WHERE character_id = ? AND property_id = ?')
      .run(t, c.id, p.id);
  }
  if (total > 0) {
    c.cash += total;
    db.prepare('UPDATE characters SET cash = ? WHERE id = ?').run(c.cash, c.id);
    logAction(c.id, 'collect', `Collected $${total.toLocaleString()} from properties`, 1);
    evaluateAchievements(c);
  }
  return total;
}

// ---------- FAVOR POINT REFILLS ----------
function favorRefill(c, which) {
  if (c.favor_points < 1) throw new Error('no favor points');
  c.favor_points -= 1;
  const t = now();
  if (which === 'energy') { c.energy = c.max_energy; c.energy_ts = t; }
  else if (which === 'stamina') { c.stamina = c.max_stamina; c.stamina_ts = t; }
  else if (which === 'health') { c.health = c.max_health; c.health_ts = t; }
  else throw new Error('unknown refill');
  db.prepare(`UPDATE characters SET favor_points = ?, energy = ?, stamina = ?, health = ?,
    energy_ts = ?, stamina_ts = ?, health_ts = ? WHERE id = ?`)
    .run(c.favor_points, c.energy, c.stamina, c.health,
         c.energy_ts, c.stamina_ts, c.health_ts, c.id);
}

// ---------- AMBUSH ----------
function setAmbush(setter, targetId, cashPaid) {
  if (cashPaid < AMBUSH.base_cost) throw new Error(`ambush needs at least $${AMBUSH.base_cost.toLocaleString()}`);
  if (setter.cash < cashPaid) throw new Error('not enough cash');
  if (setter.id === targetId) throw new Error('cannot ambush self');
  setter.cash -= cashPaid;
  db.prepare('UPDATE characters SET cash = ? WHERE id = ?').run(setter.cash, setter.id);
  db.prepare('INSERT INTO ambushes (setter_id, target_id, cash_paid, created_at) VALUES (?, ?, ?, ?)')
    .run(setter.id, targetId, cashPaid, now());
  logAction(setter.id, 'ambush', `Ambush set (−$${cashPaid.toLocaleString()})`, 1);
}

// Find a live ambush where `setter_id` = defender (I set it) and `target_id` = attacker (I'm targeting them).
// Consumes the ambush if found.
function consumeAmbush(defenderId, attackerId) {
  const cutoff = now() - AMBUSH.max_age_hours * 3600;
  const row = db.prepare(`SELECT id, cash_paid FROM ambushes
    WHERE setter_id = ? AND target_id = ? AND triggered_at IS NULL AND created_at >= ?
    ORDER BY id ASC LIMIT 1`).get(defenderId, attackerId, cutoff);
  if (!row) return null;
  db.prepare('UPDATE ambushes SET triggered_at = ? WHERE id = ?').run(now(), row.id);
  return row;
}

function getLiveAmbushes(setterId) {
  const cutoff = now() - AMBUSH.max_age_hours * 3600;
  return db.prepare(`SELECT a.*, c.name AS target_name FROM ambushes a
    JOIN characters c ON c.id = a.target_id
    WHERE a.setter_id = ? AND a.triggered_at IS NULL AND a.created_at >= ?
    ORDER BY a.created_at DESC`).all(setterId, cutoff);
}

// ---------- ACHIEVEMENTS ----------
function evaluateAchievements(c) {
  const earned = new Set(db.prepare('SELECT achievement_id FROM achievements WHERE character_id = ?').all(c.id).map(r => r.achievement_id));
  const ctx = {
    propertyCount: db.prepare('SELECT COUNT(*) AS n FROM properties WHERE character_id = ?').get(c.id).n,
  };
  const newlyEarned = [];
  for (const a of ACHIEVEMENTS) {
    if (earned.has(a.id)) continue;
    try {
      if (a.rule(c, ctx)) {
        db.prepare('INSERT INTO achievements (character_id, achievement_id, earned_at) VALUES (?, ?, ?)').run(c.id, a.id, now());
        // Apply rewards in-place on `c`
        if (a.reward.cash) c.cash += a.reward.cash;
        if (a.reward.xp) c.xp += a.reward.xp;
        if (a.reward.favor_points) c.favor_points += a.reward.favor_points;
        newlyEarned.push(a);
      }
    } catch (_) { /* rule error = skip */ }
  }
  if (newlyEarned.length) {
    db.prepare('UPDATE characters SET cash = ?, xp = ?, favor_points = ? WHERE id = ?')
      .run(c.cash, c.xp, c.favor_points, c.id);
    for (const a of newlyEarned) {
      const parts = [];
      if (a.reward.cash) parts.push(`+$${a.reward.cash.toLocaleString()}`);
      if (a.reward.favor_points) parts.push(`+${a.reward.favor_points} FP`);
      if (a.reward.xp) parts.push(`+${a.reward.xp} XP`);
      logAction(c.id, 'achievement', `★ ${a.name}: ${parts.join(' / ') || 'unlocked'}`, 1);
    }
  }
  return newlyEarned;
}

function getAchievements(charId) {
  const earned = new Set(db.prepare('SELECT achievement_id FROM achievements WHERE character_id = ?').all(charId).map(r => r.achievement_id));
  return ACHIEVEMENTS.map(a => ({ ...a, earned: earned.has(a.id) }));
}

// ---------- CRAFTING ----------
const { RECIPES } = require('./data');

function inventoryMap(charId) {
  const rows = db.prepare('SELECT item_id, quantity FROM inventory WHERE character_id = ?').all(charId);
  const map = {};
  for (const r of rows) map[r.item_id] = r.quantity;
  return map;
}

function canCraft(charId, recipeId) {
  const recipe = RECIPES.find(r => r.id === recipeId);
  if (!recipe) return { ok: false, reason: 'unknown recipe' };
  const have = inventoryMap(charId);
  for (const [itemId, qty] of Object.entries(recipe.inputs)) {
    if ((have[itemId] || 0) < qty) return { ok: false, reason: `need ${qty} ${ITEMS[itemId]?.name || itemId}` };
  }
  return { ok: true };
}

function craftRecipe(c, recipeId) {
  const recipe = RECIPES.find(r => r.id === recipeId);
  if (!recipe) throw new Error('unknown recipe');
  const check = canCraft(c.id, recipeId);
  if (!check.ok) throw new Error(check.reason);
  // consume inputs
  for (const [itemId, qty] of Object.entries(recipe.inputs)) {
    if (!removeItem(c.id, itemId, qty)) throw new Error('inventory error');
  }
  // produce output
  addItem(c.id, recipe.output.item, recipe.output.qty);
  logAction(c.id, 'craft', `Crafted ${ITEMS[recipe.output.item].name}`, 1);
  return { item: recipe.output.item, name: ITEMS[recipe.output.item].name };
}

function listRecipes(charId, includeHidden = false) {
  const have = inventoryMap(charId);
  return RECIPES
    .filter(r => includeHidden || !r.hidden)
    .map(r => {
      const inputs = Object.entries(r.inputs).map(([id, qty]) => ({
        item_id: id,
        name: ITEMS[id]?.name || id,
        qty,
        owned: have[id] || 0,
      }));
      const outputItem = ITEMS[r.output.item];
      const canDo = inputs.every(i => i.owned >= i.qty);
      return { ...r, inputs, outputItem, canDo };
    });
}

// ---------- SHOP ----------
function buyItem(c, itemId, qty = 1) {
  const item = ITEMS[itemId];
  if (!item) throw new Error('unknown item');
  if (!item.cost) throw new Error('item not for sale');
  const total = item.cost * qty;
  if (c.cash < total) throw new Error('not enough cash');
  c.cash -= total;
  db.prepare('UPDATE characters SET cash = ? WHERE id = ?').run(c.cash, c.id);
  addItem(c.id, itemId, qty);
  return { total };
}

// ---------- CHAT ----------
function postChat(charId, text) {
  text = String(text || '').trim().slice(0, 280);
  if (!text) return;
  db.prepare('INSERT INTO chat_messages (character_id, text, ts) VALUES (?, ?, ?)')
    .run(charId, text, now());
}
function getChat(limit = 40) {
  const rows = db.prepare(`SELECT m.text, m.ts, c.name
    FROM chat_messages m JOIN characters c ON c.id = m.character_id
    ORDER BY m.id DESC LIMIT ?`).all(limit);
  return rows.reverse();
}

// ---------- SEED ----------
function seedNpcsIfEmpty(minCount = 60) {
  const count = db.prepare('SELECT COUNT(*) AS n FROM characters WHERE is_npc = 1').get().n;
  if (count >= minCount) return;
  const needed = minCount - count;
  for (let i = 0; i < needed; i++) {
    const level = 1 + Math.floor(Math.random() * 30);
    const name = NPC_NAMES[Math.floor(Math.random() * NPC_NAMES.length)]
      + ' ' + ['Jr', 'Sr', 'II', 'III', '"the Kid"', '"the Shark"', '"Eggs"', '"Ice"'][Math.floor(Math.random() * 8)]
      + ' #' + Math.floor(Math.random() * 10000);
    const npc = createCharacter({ userId: null, name, isNpc: 1, level });
    // Seed some gear based on level
    const possibleWeapons = ['brass_knuckles','switchblade','saturday_special','tommy_gun','sawed_off'];
    const possibleArmor = ['leather_jacket','bulletproof_vest','kevlar_suit','pinstripe_mail'];
    const possibleVehicle = ['beater_sedan','muscle_car','black_cadillac','armored_limo'];
    const gearIndex = Math.min(3, Math.floor(level / 8));
    addItem(npc.id, possibleWeapons[gearIndex], 1);
    addItem(npc.id, possibleArmor[Math.min(gearIndex, possibleArmor.length - 1)], 1);
    addItem(npc.id, possibleVehicle[Math.min(gearIndex, possibleVehicle.length - 1)], 1);
  }
}

module.exports = {
  now, rand, randf,
  regenVitals, saveVitals,
  getCharacter, getCharacterByUser, createCharacter,
  applyLevelUps, spendSkillPoint,
  addItem, removeItem, getInventory, bestLoadout, loadoutTotals,
  doJob, getJobMastery,
  resolveFight, findOpponents,
  placeHit, getOpenHits, completeHit,
  getOwnedProperties, buyOrUpgradeProperty, collectProperties, propertyUpgradeCost,
  favorRefill, buyItem,
  postChat, getChat,
  logAction, getActionLog,
  mobCap, mobCount, getMob, hireGun, fireMobster, activeMobSize,
  craftRecipe, listRecipes, canCraft,
  earnedCityPassives, cityPassiveModifier,
  setAmbush, getLiveAmbushes,
  evaluateAchievements, getAchievements,
  seedNpcsIfEmpty,
};
