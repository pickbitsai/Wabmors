# WobMors

A 2000s-style mafia browser RPG, inspired by **Mob Wars** (David Maestri, 2008), **Mafia Wars** (Zynga), and **Mob Wars: La Cosa Nostra** (Kano). Server-rendered, grindy, ad-free, and offline-friendly — a working Phase 1 of that feature surface you can run locally in one command.

Not affiliated with Kano or any prior *Mob Wars* / *Mafia Wars* title. This is an independent homage.

## Run it

```bash
npm install
npm start
# → WobMors running at http://localhost:3456
```

Override the port:

```powershell
$env:PORT = "4000"; npm start    # PowerShell
```
```bash
PORT=4000 npm start               # bash
```

Then open [http://localhost:3456](http://localhost:3456), register → name your gangster → you're in.

## What's in

### Core loop (Phase 1)
- **5-stat character model** — Health, Energy, Stamina, Attack, Defense with the asymmetric skill-point economy from LCN (Stamina costs 2 SP per point; Max Health gives +10 per SP).
- **Regen-over-time vitals** — Energy 1/180s, Stamina 1/300s, Health 1/90s, computed on read, accurate across offline periods.
- **Jobs** — 26 jobs across 3 cities and 5 tiers, gated by level, consume energy, pay cash + XP, with mastery counters, loot drops, and component salvage.
- **Inventory + mob-scaled loadouts** — weapons/armor/vehicles with top-N-per-slot fielding driven by mob size.
- **PvP fights** — `(stat + item totals) × random[0.85, 1.15]` attacker vs defender; cash stolen on win; both sides take HP damage.
- **Hitlist** — place a bounty on any player; hunters cost 2 stamina per hit, get a 15% attack bonus.
- **Properties / City** — 7 property types, linear income scaling by level, 24h uncollected cap, compute-on-read income.
- **Favor Points** — earned on level up, spend for full vital refills.
- **World chat** + **rolling action log** (last 12 actions pinned on jobs/fight/hitlist/properties pages).
- **NPC seed** — 60 mobsters with gear, so you can fight from minute one.

### Social + deep systems (Phase 2 — partial)
- **Mob / Hired Guns** — recruit mobsters for 1 FP each. Mob size cap = 25 + 2/level above 75 (cap 1000). Active-in-fight count scales with level; each active mobster brings a weapon + armor + vehicle from your inventory into battle.
- **Workshop / crafting** — 4 visible recipes + 1 hidden blueprint. Components drop as job salvage. Crafting an upgraded item consumes inputs and produces better gear.
- **Multi-city jobs + mastery passives** — New York (lvl 1+), Chicago (lvl 20+), Las Vegas (lvl 40+). Mastering every tier-5 job in a city (25+ completions each) unlocks a permanent passive: -5% property cost (NYC), +5% property income (Chicago), +10% fight XP (Vegas).
- **Ambush** — after you're attacked, pay cash to set an ambush on that attacker. Their next attack eats 60% max-HP damage before the fight rolls. 23h expiry, single-use.
- **Achievements** — 13 rule-based milestones with cash/FP/XP rewards that auto-apply on earn.

### Roadmap (still to come)

**Phase 2 remainder:**
- Syndicates (guilds) + shared chat + syndicate quests
- Familia (designated inner-circle with passive cash share)
- Punches (lightweight stamina attack)
- Real-player mob recruitment (invite codes)

**Phase 3 — events + endgame:**
- **Syndicate Wars** (bi-weekly, divisions, top-15 member stats, 5-min respawn, decaying kill bonus)
- **Battle Arena** (level 250+, 24h brawl→sudden-death)
- **Raid Bosses** (ranks 0→25+, 2000-action threshold, superior drops, world bosses)
- Global + social leaderboards, seasonal events

## Architecture

```
server.js      Express routes + session auth + flash messages
db.js          SQLite schema (users, characters, inventory, job_mastery,
               properties, hitlist, fight_log, chat_messages)
data.js        Static game catalog: jobs, items, properties, NPC names,
               regen rates, skill-cost config, XP curve
game.js        Core logic: regen, level-up, jobs, fights, hitlist,
               properties, favor refills, NPC seeding
views/         EJS templates — one per page + HUD/nav partials
public/        CSS (dark gold/red mafia aesthetic)
```

### Design decisions worth knowing

- **Vitals are compute-on-read**, stored as `(value, updated_at)` — no cron ticks, no drift on server restart, handles offline regen correctly.
- **Fight resolution is server-authoritative** — client never sees the RNG seed.
- **Item auto-loadout** — each fight picks the best `1 + mob_size` items per slot; offense ranks by `atk*2 + def`, defense by `def*2 + atk`.
- **Property collection is also compute-on-read**, with a capped uncollected bucket — no background jobs per property.
- **SQLite + `better-sqlite3`** — single-file DB, synchronous API, zero-config for a game of this scale.

## Stack

- **Node.js 22+**
- **Express** — routing + sessions
- **better-sqlite3** — DB
- **EJS** — server-rendered templates (no SPA, matches the 2000s aesthetic)
- **bcryptjs** — password hashing

## Deploying on Vercel

This repo is wired up for Vercel deploys. The root `vercel.json` rewrites all requests to `api/index.js`, which re-exports the Express app from `server.js`.

### Setup
1. Connect the repo in Vercel.
2. No build command needed — `npm install` builds `better-sqlite3` natively.
3. Set a session secret (Vercel → Project → Settings → Environment Variables):
   - `SESSION_SECRET` = any long random string

### Storage caveat (important)
Vercel serverless functions have an **ephemeral `/tmp`** filesystem and no shared disk. This app currently uses `better-sqlite3` with a local file DB, so on Vercel:
- Cold starts wipe the DB (~5 min of inactivity → blank slate).
- Each function instance has its own copy of the DB.
- PvP, chat, and hitlist don't share state across users in different instances.

In short: **a Vercel preview is good for demoing the loop; it's not a real persistent game.**

### To make it production-ready
Swap the DB for a hosted backend. The cleanest options, in order of refactor cost:
- **Turso (libsql)** — drop-in SQLite-compatible, minimal code change. Set `DATABASE_URL` env var.
- **Supabase / Neon / Vercel Postgres** — bigger refactor (pg driver + dialect tweaks), but richer tooling.
- **Fly.io / Railway / Render** — keep `better-sqlite3` and get a persistent disk. Simplest if you don't need Vercel's CDN.

Ask and I'll wire one up.

## Contributing

Issues + PRs welcome. The game-data catalog in `data.js` is the easiest place to start — new jobs, items, and properties are pure data additions.

## License

MIT — see [LICENSE](LICENSE).
