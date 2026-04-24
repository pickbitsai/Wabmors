// Leaderboard standings — read-only snapshots of "who's ahead right now" by
// several metrics. Consumed by the cron tick that diffs against the previous
// snapshot and posts changes to Discord.
//
// NPCs are excluded from every board — they exist to give real players someone
// to punch, not to clog the leaderboards.

const db = require('./db');
const data = require('./data');

const TOP_N = 10;

function topByLevel(limit = TOP_N) {
  return db.prepare(`SELECT id, name, level, xp, wins, cash
    FROM characters
    WHERE is_npc = 0
    ORDER BY level DESC, xp DESC, id ASC
    LIMIT ?`).all(limit);
}

function topByCash(limit = TOP_N) {
  return db.prepare(`SELECT id, name, level, cash
    FROM characters
    WHERE is_npc = 0
    ORDER BY cash DESC, id ASC
    LIMIT ?`).all(limit);
}

function topByWins(limit = TOP_N) {
  return db.prepare(`SELECT id, name, level, wins, losses
    FROM characters
    WHERE is_npc = 0
    ORDER BY wins DESC, id ASC
    LIMIT ?`).all(limit);
}

// "First to X" boards — single row per milestone, earliest achiever.
// Grand Don uses characters.completed_at; city mastery uses the earliest
// earned_at of the final tier-5 achievement-equivalent proxy: the most recent
// job completion that pushed them over threshold. We approximate via the
// achievement table — if the player holds `all_properties` or a future
// city-specific achievement, they crossed that bar. For city mastery
// specifically we join through job_mastery because we don't issue a
// per-city achievement row.
function firstGrandDon() {
  return db.prepare(`SELECT id, name, level, completed_at
    FROM characters
    WHERE is_npc = 0 AND completed_at IS NOT NULL
    ORDER BY completed_at ASC, id ASC
    LIMIT 1`).get() || null;
}

function firstCityMastery(cityId) {
  const tier5 = data.JOBS.filter(j => j.city === cityId && j.tier === 5);
  if (tier5.length === 0) return null;
  // Earliest character where every tier-5 job has >= CITY_MASTERY_THRESHOLD completions.
  // We can't cheaply express "all mastered" in one SQL pass without the real
  // completion timestamp, so fetch candidates and verify in code.
  const jobIds = tier5.map(j => j.id);
  const placeholders = jobIds.map(() => '?').join(',');
  const rows = db.prepare(`SELECT c.id, c.name, c.level,
    (SELECT MIN(completions) FROM job_mastery m
     WHERE m.character_id = c.id AND m.job_id IN (${placeholders})) AS min_completions,
    (SELECT COUNT(*) FROM job_mastery m
     WHERE m.character_id = c.id AND m.job_id IN (${placeholders})) AS jobs_tracked
    FROM characters c
    WHERE c.is_npc = 0
    ORDER BY c.id ASC`).all(...jobIds, ...jobIds);
  const mastered = rows.filter(r =>
    r.jobs_tracked === tier5.length && r.min_completions >= data.CITY_MASTERY_THRESHOLD);
  if (mastered.length === 0) return null;
  // Earliest by id is good enough as a tie-breaker — achievement issuance happens
  // through evaluateAchievements, which runs in character-id order per tick.
  return mastered[0];
}

// Snapshot shape: the JSON blob the cron stores. Versioned so we can safely
// evolve the schema later.
function snapshot() {
  return {
    version: 1,
    taken_at: Math.floor(Date.now() / 1000),
    player_count: db.prepare('SELECT COUNT(*) AS n FROM characters WHERE is_npc = 0').get().n,
    by_level: topByLevel(),
    by_cash:  topByCash(),
    by_wins:  topByWins(),
    firsts: {
      grand_don: firstGrandDon(),
      mastery: {
        nyc:     firstCityMastery('nyc'),
        chicago: firstCityMastery('chicago'),
        vegas:   firstCityMastery('vegas'),
      },
    },
  };
}

// ---------- diff logic ----------
// Given prev + curr snapshots, return a human-readable event list:
//   [{ kind, text }, ...]
// kind ∈ { 'debut', 'promote', 'demote', 'dropped', 'first', 'grand_don' }
//
// If prev is missing (first run), emits a single 'bootstrap' event so the
// cron can post "Tracking started" rather than spamming full rankings.
//
// If wipeDetected is true, callers should skip Discord posting and just
// persist the new snapshot — see api/leaderboard-tick.js.
function diff(prev, curr) {
  if (!prev) return [{ kind: 'bootstrap', text: `Tracking started — ${curr.player_count} players on the board.` }];

  const events = [];

  // Moves within top-10 boards.
  const diffBoard = (label, prevRows, currRows, fmt) => {
    const prevIdx = new Map(prevRows.map((r, i) => [r.id, i]));
    const currIdx = new Map(currRows.map((r, i) => [r.id, i]));
    for (const [i, row] of currRows.entries()) {
      const was = prevIdx.get(row.id);
      if (was === undefined) {
        events.push({ kind: 'debut', text: `🆕 **${row.name}** debuts on ${label} at #${i + 1} (${fmt(row)}).` });
      } else if (was > i) {
        events.push({ kind: 'promote', text: `⬆️ **${row.name}** rose from #${was + 1} → #${i + 1} on ${label} (${fmt(row)}).` });
      } else if (was < i) {
        events.push({ kind: 'demote', text: `⬇️ **${row.name}** slipped from #${was + 1} → #${i + 1} on ${label}.` });
      }
    }
    for (const [id, i] of prevIdx.entries()) {
      if (!currIdx.has(id)) {
        const row = prevRows[i];
        events.push({ kind: 'dropped', text: `❌ **${row.name}** dropped off ${label} (was #${i + 1}).` });
      }
    }
  };

  diffBoard('Level',       prev.by_level, curr.by_level, r => `L${r.level}`);
  diffBoard('Cash',        prev.by_cash,  curr.by_cash,  r => `$${r.cash.toLocaleString()}`);
  diffBoard('Win count',   prev.by_wins,  curr.by_wins,  r => `${r.wins} wins`);

  // First-time milestones.
  if (!prev.firsts.grand_don && curr.firsts.grand_don) {
    const c = curr.firsts.grand_don;
    events.push({ kind: 'grand_don', text: `👑 **${c.name}** is the first Grand Don (L${c.level}) — the game has been beaten.` });
  }
  for (const [cityId, label] of [['nyc', 'New York'], ['chicago', 'Chicago'], ['vegas', 'Las Vegas']]) {
    if (!prev.firsts.mastery[cityId] && curr.firsts.mastery[cityId]) {
      const c = curr.firsts.mastery[cityId];
      events.push({ kind: 'first', text: `★ **${c.name}** is first to master ${label} (L${c.level}).` });
    }
  }

  return events;
}

// Wipe detection: if the previous snapshot had real players and the current
// snapshot has far fewer, we probably hit a cold-start /tmp wipe. We return
// true so the caller can persist the new snapshot silently rather than
// spamming Discord with dozens of fake dropouts.
function looksLikeWipe(prev, curr) {
  if (!prev) return false;
  if (prev.player_count < 5) return false; // not enough baseline to tell
  return curr.player_count < Math.floor(prev.player_count * 0.1);
}

// ---------- Discord formatting ----------
// Packs events into a single webhook message. Discord caps content at 2000
// chars; we chunk if needed. Returns an array of message bodies.
function formatForDiscord(events, curr) {
  if (events.length === 0) return [];
  const header = `**Wabmors leaderboard — ${new Date(curr.taken_at * 1000).toISOString().slice(0, 10)}**`;
  const lines = events.map(e => e.text);
  const bodies = [];
  let buf = header;
  for (const line of lines) {
    if ((buf + '\n' + line).length > 1800) {
      bodies.push(buf);
      buf = line;
    } else {
      buf += '\n' + line;
    }
  }
  if (buf.length > 0) bodies.push(buf);
  return bodies.map(content => ({ content }));
}

module.exports = {
  TOP_N,
  topByLevel, topByCash, topByWins,
  firstGrandDon, firstCityMastery,
  snapshot, diff, looksLikeWipe, formatForDiscord,
};
