const Database = require('better-sqlite3');
const path = require('path');

// On Vercel / serverless, the project root is read-only. Fall back to /tmp.
// DATABASE_FILE env var overrides both.
const dbPath = process.env.DATABASE_FILE
  || (process.env.VERCEL ? '/tmp/game.db' : path.join(__dirname, 'game.db'));

const db = new Database(dbPath);
// Journal mode: WAL requires a writable directory with companion -shm/-wal files.
// On Vercel /tmp works, but cold starts may lose uncheckpointed writes — DELETE mode is safer there.
db.pragma(process.env.VERCEL ? 'journal_mode = DELETE' : 'journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  is_guest      INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS characters (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        INTEGER UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  name           TEXT UNIQUE NOT NULL,
  is_npc         INTEGER NOT NULL DEFAULT 0,
  level          INTEGER NOT NULL DEFAULT 1,
  xp             INTEGER NOT NULL DEFAULT 0,
  skill_points   INTEGER NOT NULL DEFAULT 5,

  max_health     INTEGER NOT NULL DEFAULT 100,
  max_energy     INTEGER NOT NULL DEFAULT 20,
  max_stamina    INTEGER NOT NULL DEFAULT 5,
  attack         INTEGER NOT NULL DEFAULT 5,
  defense        INTEGER NOT NULL DEFAULT 5,

  health         INTEGER NOT NULL DEFAULT 100,
  energy         INTEGER NOT NULL DEFAULT 20,
  stamina        INTEGER NOT NULL DEFAULT 5,
  health_ts      INTEGER NOT NULL,
  energy_ts      INTEGER NOT NULL,
  stamina_ts     INTEGER NOT NULL,

  cash           INTEGER NOT NULL DEFAULT 500,
  favor_points   INTEGER NOT NULL DEFAULT 5,
  gamer_points   INTEGER NOT NULL DEFAULT 0,

  wins           INTEGER NOT NULL DEFAULT 0,
  losses         INTEGER NOT NULL DEFAULT 0,
  jobs_done      INTEGER NOT NULL DEFAULT 0,

  created_at     INTEGER NOT NULL,
  completed_at   INTEGER            -- set when the Grand Don achievement fires (the win state)
);
CREATE INDEX IF NOT EXISTS idx_characters_level ON characters(level);

CREATE TABLE IF NOT EXISTS inventory (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  item_id      TEXT NOT NULL,
  quantity     INTEGER NOT NULL DEFAULT 1,
  UNIQUE(character_id, item_id)
);
CREATE INDEX IF NOT EXISTS idx_inv_char ON inventory(character_id);

CREATE TABLE IF NOT EXISTS job_mastery (
  character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  job_id       TEXT NOT NULL,
  completions  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (character_id, job_id)
);

CREATE TABLE IF NOT EXISTS properties (
  character_id     INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  property_id      TEXT NOT NULL,
  level            INTEGER NOT NULL DEFAULT 1,
  last_collect_ts  INTEGER NOT NULL,
  uncollected      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (character_id, property_id)
);

CREATE TABLE IF NOT EXISTS hitlist (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  target_id     INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  placer_id     INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  bounty        INTEGER NOT NULL,
  created_at    INTEGER NOT NULL,
  completed_by  INTEGER REFERENCES characters(id) ON DELETE SET NULL,
  completed_at  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_hit_open ON hitlist(target_id, completed_at);

CREATE TABLE IF NOT EXISTS fight_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  attacker_id   INTEGER NOT NULL,
  defender_id   INTEGER NOT NULL,
  winner_id     INTEGER NOT NULL,
  cash_stolen   INTEGER NOT NULL DEFAULT 0,
  damage_to_def INTEGER NOT NULL DEFAULT 0,
  damage_to_atk INTEGER NOT NULL DEFAULT 0,
  xp_gained     INTEGER NOT NULL DEFAULT 0,
  kind          TEXT NOT NULL DEFAULT 'fight',
  ts            INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_log_def ON fight_log(defender_id, ts);
CREATE INDEX IF NOT EXISTS idx_log_atk ON fight_log(attacker_id, ts);

CREATE TABLE IF NOT EXISTS chat_messages (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  text         TEXT NOT NULL,
  ts           INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_ts ON chat_messages(ts);

CREATE TABLE IF NOT EXISTS ambushes (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  setter_id     INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  target_id     INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  cash_paid     INTEGER NOT NULL,
  created_at    INTEGER NOT NULL,
  triggered_at  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_ambush_live ON ambushes(target_id, setter_id, triggered_at);

CREATE TABLE IF NOT EXISTS achievements (
  character_id  INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  achievement_id TEXT NOT NULL,
  earned_at     INTEGER NOT NULL,
  PRIMARY KEY (character_id, achievement_id)
);

CREATE TABLE IF NOT EXISTS mob_members (
  owner_id     INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  slot         INTEGER NOT NULL,
  name         TEXT NOT NULL,
  kind         TEXT NOT NULL,  -- 'hired_gun' or 'friend'
  joined_at    INTEGER NOT NULL,
  PRIMARY KEY (owner_id, slot)
);
CREATE INDEX IF NOT EXISTS idx_mob_owner ON mob_members(owner_id);

-- TODO(phase2): syndicates — guilds with shared chat and weekly quests.
--   CREATE TABLE syndicates (id, name, tag, created_at, leader_id, treasury);
--   CREATE TABLE syndicate_members (syndicate_id, character_id, role, joined_at);
-- TODO(phase2): familia — inner-circle, passive income share from member properties.
--   CREATE TABLE familia_members (boss_id, member_id, share_bps, joined_at);
-- TODO(phase3): arena — L250+ 24h brawls with sudden-death overtime.
--   CREATE TABLE arena_rounds (id, opens_at, closes_at, winner_id);
-- TODO(phase3): raid_bosses — world bosses with contribution-based drops.
--   CREATE TABLE raid_bosses (id, rank, hp_max, spawned_at, killed_at);

CREATE TABLE IF NOT EXISTS action_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL,
  text         TEXT NOT NULL,
  good         INTEGER NOT NULL DEFAULT 0,
  ts           INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_log_char ON action_log(character_id, id);
`);

// Best-effort migrations for pre-existing DBs. If a column is already there,
// SQLite throws — caught & swallowed.
try { db.exec('ALTER TABLE users ADD COLUMN is_guest INTEGER NOT NULL DEFAULT 0'); } catch (_) {}
try { db.exec('ALTER TABLE characters ADD COLUMN completed_at INTEGER'); } catch (_) {}

module.exports = db;
