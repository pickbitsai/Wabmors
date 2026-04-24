// Static game catalog. Keyed by stable string ids so DB rows never need to know the full object.

// ---------- ITEMS ----------
// slot: weapon | armor | vehicle
// atk / def contribute additively to total fight strength.
// cost = Cash to buy in shop (0 = not purchasable, loot-only).
const ITEMS = {
  // weapons
  brass_knuckles:    { name: 'Brass Knuckles',       slot: 'weapon',  atk: 3,   def: 1,   cost: 500 },
  switchblade:       { name: 'Switchblade',          slot: 'weapon',  atk: 6,   def: 2,   cost: 1500 },
  saturday_special:  { name: 'Saturday Night Special', slot: 'weapon', atk: 12,  def: 3,   cost: 6000 },
  tommy_gun:         { name: 'Tommy Gun',            slot: 'weapon',  atk: 28,  def: 8,   cost: 40000 },
  sawed_off:         { name: 'Sawed-Off Shotgun',    slot: 'weapon',  atk: 48,  def: 12,  cost: 180000 },
  gold_plated_45:    { name: 'Gold-Plated .45',      slot: 'weapon',  atk: 95,  def: 22,  cost: 900000 },

  // armor
  leather_jacket:    { name: 'Leather Jacket',       slot: 'armor',   atk: 0,   def: 4,   cost: 600 },
  bulletproof_vest:  { name: 'Bulletproof Vest',     slot: 'armor',   atk: 1,   def: 10,  cost: 4000 },
  kevlar_suit:       { name: 'Kevlar Suit',          slot: 'armor',   atk: 2,   def: 22,  cost: 25000 },
  pinstripe_mail:    { name: 'Pinstripe Chainmail',  slot: 'armor',   atk: 4,   def: 42,  cost: 140000 },
  don_regalia:       { name: "Don's Regalia",        slot: 'armor',   atk: 8,   def: 88,  cost: 720000 },

  // vehicles
  beater_sedan:      { name: 'Beater Sedan',         slot: 'vehicle', atk: 1,   def: 2,   cost: 1000 },
  muscle_car:        { name: 'Muscle Car',           slot: 'vehicle', atk: 8,   def: 6,   cost: 8000 },
  black_cadillac:    { name: 'Black Cadillac',       slot: 'vehicle', atk: 20,  def: 18,  cost: 60000 },
  armored_limo:      { name: 'Armored Limo',         slot: 'vehicle', atk: 35,  def: 50,  cost: 320000 },
  bulletproof_rolls: { name: 'Bulletproof Rolls',    slot: 'vehicle', atk: 70,  def: 110, cost: 1500000 },

  // --- components (slot:'component', not worn, only used in recipes) ---
  scrap_metal:       { name: 'Scrap Metal',          slot: 'component', atk: 0, def: 0, cost: 0 },
  gunpowder:         { name: 'Gunpowder',            slot: 'component', atk: 0, def: 0, cost: 0 },
  engine_block:      { name: 'Engine Block',         slot: 'component', atk: 0, def: 0, cost: 0 },
  armor_plate:       { name: 'Steel Plate',          slot: 'component', atk: 0, def: 0, cost: 0 },
  blueprint_stiletto: { name: 'Blueprint: Stiletto', slot: 'component', atk: 0, def: 0, cost: 0 },

  // --- craftable upgrades (made from components + base items) ---
  modded_switchblade: { name: 'Modded Switchblade',  slot: 'weapon',  atk: 9,   def: 3,   cost: 0 },
  reinforced_vest:   { name: 'Reinforced Vest',      slot: 'armor',   atk: 2,   def: 15,  cost: 0 },
  souped_up_sedan:   { name: 'Souped-Up Sedan',      slot: 'vehicle', atk: 6,   def: 5,   cost: 0 },
  custom_tommy:      { name: 'Custom Tommy Gun',     slot: 'weapon',  atk: 38,  def: 10,  cost: 0 },
};

// ---------- RECIPES ----------
// Each recipe consumes `inputs` (item_id → qty) and produces `output` (item_id, qty).
// `hidden`: true means it's only discoverable via community hint (not shown in the recipe list).
const RECIPES = [
  {
    id: 'mod_switchblade',
    name: 'Modded Switchblade',
    inputs: { switchblade: 1, scrap_metal: 3, gunpowder: 1 },
    output: { item: 'modded_switchblade', qty: 1 },
    hidden: false,
  },
  {
    id: 'reinforced_vest',
    name: 'Reinforced Vest',
    inputs: { bulletproof_vest: 1, armor_plate: 4 },
    output: { item: 'reinforced_vest', qty: 1 },
    hidden: false,
  },
  {
    id: 'souped_sedan',
    name: 'Souped-Up Sedan',
    inputs: { beater_sedan: 1, engine_block: 2, scrap_metal: 2 },
    output: { item: 'souped_up_sedan', qty: 1 },
    hidden: false,
  },
  {
    id: 'custom_tommy',
    name: 'Custom Tommy Gun',
    inputs: { tommy_gun: 1, gunpowder: 4, scrap_metal: 5, armor_plate: 2 },
    output: { item: 'custom_tommy', qty: 1 },
    hidden: false,
  },
  // Hidden blueprint — no UI hint, must be discovered
  {
    id: 'stiletto_assassin',
    name: 'Hidden Blueprint',
    inputs: { blueprint_stiletto: 1, modded_switchblade: 2, gunpowder: 10 },
    output: { item: 'gold_plated_45', qty: 1 },
    hidden: true,
  },
];

// ---------- CITIES ----------
// Each job belongs to one city. Mastering a city unlocks the next one.
// Mastery passives fire once the player hits the completion threshold on the
// final tier of that city.
const CITIES = [
  { id: 'nyc',     name: 'New York City', unlock_level: 1,
    passive: { kind: 'property_discount', value: 0.05, description: '5% discount on property purchases' } },
  { id: 'chicago', name: 'Chicago',       unlock_level: 20,
    passive: { kind: 'income_bonus',      value: 0.05, description: '+5% property income' } },
  { id: 'vegas',   name: 'Las Vegas',     unlock_level: 35,
    passive: { kind: 'fight_xp',          value: 0.10, description: '+10% XP from fights' } },
];

const CITY_MASTERY_THRESHOLD = 25; // completions of each of a city's tier-5 jobs to earn passive

// ---------- PHASE 2/3 ROADMAP (deferred — DO NOT BUILD YET) ----------
// The following systems are intentionally not implemented. When picking them
// up, the plug-in points are marked with `TODO(phase2)` / `TODO(phase3)` in:
//   - db.js          (schema additions: syndicates, familia, arena_rounds, raid_bosses)
//   - game.js        (hooks near mob / fight / achievements)
//   - server.js      (routes: /syndicate, /familia, /arena, /raids, /leaderboards)
//
// Phase 2:
//   - Syndicates (guilds, shared chat, syndicate quests)
//   - Familia (inner-circle, passive cash share from member income)
//   - Punches (lightweight 1-stamina attack with no item scaling)
//   - Real-player mob recruitment (invite codes)
//
// Phase 3:
//   - Syndicate Wars (bi-weekly, divisions, 5-min respawn, decaying kill bonus)
//   - Battle Arena (L250+, 24h brawl → sudden death)
//   - Raid Bosses (ranks 0→25+, 2000-action threshold, superior drops)
//   - Global + social leaderboards, seasonal events
//
// Grand Don (the current win condition) intentionally does NOT require any of
// the above, so the game is beatable with Phase 1 content only.

// ---------- JOBS ----------
// city: which city the job belongs to.
// tier: progression gate within the city.
// mastery_required_for_next is implicit — we only gate on unlock_level here.
const JOBS = [
  // ===== NEW YORK CITY =====
  // Tier 1 - street
  { id: 'mug_tourist',     name: 'Mug a Tourist',         city: 'nyc', tier: 1, unlock_level: 1,  energy: 2, cash: [25, 80],     xp: 3,  loot: { chance: 0.1,  item: 'brass_knuckles' }, salvage: { chance: 0.15, item: 'scrap_metal' } },
  { id: 'pickpocket',      name: 'Pickpocket the Market', city: 'nyc', tier: 1, unlock_level: 1,  energy: 3, cash: [60, 140],    xp: 4,  loot: null,                                     salvage: { chance: 0.15, item: 'scrap_metal' } },
  { id: 'shakedown',       name: 'Shake Down a Shopkeeper', city: 'nyc', tier: 1, unlock_level: 2, energy: 4, cash: [120, 250],   xp: 6,  loot: { chance: 0.08, item: 'switchblade' },  salvage: { chance: 0.1,  item: 'gunpowder' } },
  // Tier 2 - neighborhood
  { id: 'numbers_racket',  name: 'Run a Numbers Racket',  city: 'nyc', tier: 2, unlock_level: 4,  energy: 6,  cash: [400, 750],    xp: 11, loot: { chance: 0.1,  item: 'leather_jacket' }, salvage: { chance: 0.2, item: 'armor_plate' } },
  { id: 'rig_horse_race',  name: 'Rig a Horse Race',      city: 'nyc', tier: 2, unlock_level: 6,  energy: 8,  cash: [800, 1500],   xp: 16, loot: { chance: 0.07, item: 'beater_sedan' },   salvage: { chance: 0.2, item: 'engine_block' } },
  { id: 'jack_truck',      name: 'Jack a Delivery Truck', city: 'nyc', tier: 2, unlock_level: 8,  energy: 10, cash: [1600, 3200],  xp: 22, loot: { chance: 0.1,  item: 'saturday_special' }, salvage: { chance: 0.2, item: 'gunpowder' } },
  // Tier 3 - organized
  { id: 'protection_run',  name: 'Run a Protection Racket', city: 'nyc', tier: 3, unlock_level: 12, energy: 14, cash: [5000, 9000],  xp: 38, loot: { chance: 0.1, item: 'bulletproof_vest' }, salvage: { chance: 0.18, item: 'armor_plate' } },
  { id: 'casino_skim',     name: 'Skim the Casino Count',  city: 'nyc', tier: 3, unlock_level: 15, energy: 18, cash: [9000, 18000], xp: 52, loot: { chance: 0.1, item: 'muscle_car' }, salvage: { chance: 0.2, item: 'engine_block' } },
  { id: 'bank_job',        name: 'Pull a Bank Job',        city: 'nyc', tier: 3, unlock_level: 18, energy: 22, cash: [18000, 40000], xp: 72, loot: { chance: 0.1, item: 'tommy_gun' }, salvage: { chance: 0.2, item: 'gunpowder' } },
  // Tier 4 - made
  { id: 'hijack_armored',  name: 'Hijack an Armored Car',  city: 'nyc', tier: 4, unlock_level: 25, energy: 28, cash: [50000, 95000], xp: 120, loot: { chance: 0.1, item: 'kevlar_suit' }, salvage: { chance: 0.15, item: 'armor_plate' } },
  { id: 'smuggle_ring',    name: 'Run a Smuggling Ring',   city: 'nyc', tier: 4, unlock_level: 30, energy: 34, cash: [110000, 220000], xp: 180, loot: { chance: 0.1, item: 'black_cadillac' }, salvage: { chance: 0.15, item: 'engine_block' } },
  { id: 'whack_rival',     name: 'Whack a Rival Capo',     city: 'nyc', tier: 4, unlock_level: 35, energy: 40, cash: [240000, 500000], xp: 280, loot: { chance: 0.1, item: 'sawed_off' }, salvage: { chance: 0.15, item: 'gunpowder' } },
  // Tier 5 - don (mastering these earns the city passive)
  { id: 'take_syndicate',  name: 'Take Over a Syndicate',  city: 'nyc', tier: 5, unlock_level: 45, energy: 50, cash: [600000, 1200000], xp: 450, loot: { chance: 0.08, item: 'pinstripe_mail' }, salvage: { chance: 0.12, item: 'scrap_metal' } },
  { id: 'heist_fed',       name: 'Heist the Federal Reserve', city: 'nyc', tier: 5, unlock_level: 55, energy: 65, cash: [1500000, 3000000], xp: 700, loot: { chance: 0.08, item: 'armored_limo' }, salvage: { chance: 0.12, item: 'armor_plate' } },
  // blueprint_stiletto drops here — the hidden recipe's only known source.
  { id: 'command_family',  name: 'Command the Five Families', city: 'nyc', tier: 5, unlock_level: 70, energy: 80, cash: [3500000, 7500000], xp: 1100, loot: { chance: 0.05, item: 'gold_plated_45' }, salvage: { chance: 0.04, item: 'blueprint_stiletto' } },

  // ===== CHICAGO =====
  { id: 'chi_speakeasy',   name: 'Run a Speakeasy',       city: 'chicago', tier: 1, unlock_level: 20, energy: 12, cash: [8000, 14000],    xp: 42, loot: { chance: 0.1, item: 'bulletproof_vest' }, salvage: { chance: 0.18, item: 'gunpowder' } },
  { id: 'chi_bribe_cops',  name: 'Bribe the Chicago PD',  city: 'chicago', tier: 1, unlock_level: 22, energy: 16, cash: [15000, 28000],   xp: 60, loot: null, salvage: { chance: 0.2, item: 'scrap_metal' } },
  { id: 'chi_meatpacking', name: 'Run the Meat-Packing Racket', city: 'chicago', tier: 2, unlock_level: 25, energy: 20, cash: [35000, 60000], xp: 95, loot: { chance: 0.1, item: 'muscle_car' }, salvage: { chance: 0.2, item: 'engine_block' } },
  { id: 'chi_union_bust',  name: 'Bust a Union',          city: 'chicago', tier: 3, unlock_level: 30, energy: 26, cash: [75000, 140000],  xp: 155, loot: { chance: 0.1, item: 'kevlar_suit' }, salvage: { chance: 0.18, item: 'armor_plate' } },
  { id: 'chi_hit_alderman', name: 'Whack a Crooked Alderman', city: 'chicago', tier: 4, unlock_level: 36, energy: 36, cash: [190000, 340000], xp: 240, loot: { chance: 0.08, item: 'black_cadillac' }, salvage: { chance: 0.15, item: 'gunpowder' } },
  // Three tier-5 jobs (parity with NYC) — otherwise Chicago mastery is 3× faster by accident.
  { id: 'chi_own_precinct', name: 'Own an Entire Precinct', city: 'chicago', tier: 5, unlock_level: 44, energy: 48, cash: [500000, 900000], xp: 400, loot: { chance: 0.06, item: 'armored_limo' }, salvage: { chance: 0.12, item: 'armor_plate' } },
  { id: 'chi_run_outfit',   name: 'Run the Chicago Outfit', city: 'chicago', tier: 5, unlock_level: 52, energy: 60, cash: [1100000, 2200000], xp: 620, loot: { chance: 0.06, item: 'pinstripe_mail' }, salvage: { chance: 0.1, item: 'engine_block' } },
  { id: 'chi_own_city',     name: 'Own the City',           city: 'chicago', tier: 5, unlock_level: 65, energy: 75, cash: [2500000, 4800000], xp: 900, loot: { chance: 0.05, item: 'sawed_off' }, salvage: { chance: 0.08, item: 'gunpowder' } },

  // ===== LAS VEGAS =====
  // Unlock shifted 40→35 so Vegas T1–T2 land in the player's current combat band rather than being overleveled.
  { id: 'vgs_vegas_valet',  name: 'Shake Down the Valet',  city: 'vegas', tier: 1, unlock_level: 35, energy: 18, cash: [80000, 180000], xp: 95,  loot: { chance: 0.1, item: 'muscle_car' }, salvage: { chance: 0.2, item: 'scrap_metal' } },
  { id: 'vgs_pit_boss',    name: 'Pay Off a Pit Boss',     city: 'vegas', tier: 2, unlock_level: 38, energy: 26, cash: [200000, 420000], xp: 220, loot: { chance: 0.08, item: 'kevlar_suit' }, salvage: { chance: 0.18, item: 'armor_plate' } },
  { id: 'vgs_card_counter', name: 'Run a Counter Crew',    city: 'vegas', tier: 3, unlock_level: 45, energy: 42, cash: [600000, 1100000], xp: 500, loot: { chance: 0.08, item: 'pinstripe_mail' }, salvage: { chance: 0.15, item: 'engine_block' } },
  // blueprint_stiletto can also rarely drop here — second route so the hidden recipe isn't locked behind a single job.
  { id: 'vgs_skim_whale',  name: 'Skim a Whale',           city: 'vegas', tier: 3, unlock_level: 52, energy: 58, cash: [1400000, 2800000], xp: 780, loot: { chance: 0.08, item: 'armored_limo' }, salvage: { chance: 0.03, item: 'blueprint_stiletto' } },
  { id: 'vgs_bury_desert', name: 'Bury Him in the Desert', city: 'vegas', tier: 4, unlock_level: 60, energy: 72, cash: [3000000, 5500000], xp: 1200, loot: { chance: 0.06, item: 'sawed_off' }, salvage: { chance: 0.12, item: 'gunpowder' } },
  { id: 'vgs_own_strip',   name: 'Own the Strip',          city: 'vegas', tier: 5, unlock_level: 75, energy: 95, cash: [8000000, 16000000], xp: 2000, loot: { chance: 0.05, item: 'bulletproof_rolls' }, salvage: { chance: 0.08, item: 'armor_plate' } },
];

// ---------- PROPERTIES ----------
// base_income: cash/hour at level 1. Scales linearly with level.
// base_cost: cost to purchase at L1. Upgrade cost = base_cost * level * 0.6 (see game.js).
// unlock_level: minimum player level to buy.
const PROPERTIES = [
  { id: 'newsstand',    name: 'Corner Newsstand',    base_income: 40,      base_cost: 3000,     unlock_level: 1  },
  { id: 'pool_hall',    name: 'Pool Hall',           base_income: 180,     base_cost: 18000,    unlock_level: 4  },
  { id: 'pawnshop',     name: 'Pawnshop',            base_income: 700,     base_cost: 80000,    unlock_level: 8  },
  { id: 'restaurant',   name: 'Italian Restaurant',  base_income: 2800,    base_cost: 380000,   unlock_level: 15 },
  { id: 'nightclub',    name: 'Nightclub',           base_income: 11000,   base_cost: 1800000,  unlock_level: 25 },
  { id: 'casino',       name: 'Underground Casino',  base_income: 45000,   base_cost: 8500000,  unlock_level: 40 },
  { id: 'port',         name: 'Port Warehouse',      base_income: 180000,  base_cost: 42000000, unlock_level: 60 },
];

// Uncollected income is capped at 24h of production.
const INCOME_CAP_HOURS = 24;

// ---------- MOB CAPS ----------
// LCN: 500 hired guns + 500 friends at start; after lvl 75 +2/level, hard cap 1000 each.
// For simplicity we roll both into a single "mob" with a hard cap per kind.
// Cap shape: L1=5, +1/level up to L21=25, flat until L75, then +2/level to hard cap.
// Earlier mob growth gives low-level FP something to buy besides refills, without
// changing late-game economy (cap at L75+ matches the prior formula exactly).
const MOB = {
  base_cap: 5,
  early_bonus_per_level: 1,  // +1 cap per level 2..21
  early_bonus_max: 20,       // caps early bonus at L21 (5 + 20 = 25)
  level75_bonus_per: 2,
  level75_threshold: 75,
  hard_cap: 1000,
  hired_gun_cost_fp: 1,   // favor points per hired gun
  // Each mobster brings 1 weapon + 1 armor + 1 vehicle into fights, gated by player level:
  active_per_level: 0.5,  // min(mob_size, floor(level * 0.5)) mobsters actively contribute
  // Flat stat bonus per active mobster in addition to items:
  flat_atk_per_mobster: 0,
  flat_def_per_mobster: 0,
};

// ---------- AMBUSH ----------
// Target pays cash to set an ambush on a specific attacker.
// Next time that attacker hits the target, the ambush fires ONCE, dealing
// heavy damage to the attacker and consuming itself.
const AMBUSH = {
  base_cost: 2000,          // minimum cash to set
  max_age_hours: 23,        // ambush expires if the attacker doesn't return
  damage_multiplier: 0.6,   // ambush does damage = multiplier * attacker.max_health
};

// ---------- ACHIEVEMENTS ----------
// Simple rule-based. Evaluated after actions; stored in achievements table.
// reward: { cash?, favor_points?, xp? }
const ACHIEVEMENTS = [
  { id: 'first_blood',      name: 'First Blood',       desc: 'Win your first fight',               rule: c => c.wins >= 1,         reward: { cash: 500,     favor_points: 1 } },
  { id: 'ten_wins',         name: 'Ten Wins',          desc: 'Win 10 fights',                      rule: c => c.wins >= 10,        reward: { cash: 5000,    favor_points: 1 } },
  { id: 'hundred_wins',     name: 'Century of Violence', desc: 'Win 100 fights',                  rule: c => c.wins >= 100,       reward: { cash: 50000,   favor_points: 3 } },
  { id: 'thousand_wins',    name: 'Bloodbath',         desc: 'Win 1,000 fights',                   rule: c => c.wins >= 1000,      reward: { cash: 500000,  favor_points: 10 } },
  { id: 'first_job',        name: 'Day One',           desc: 'Complete your first job',            rule: c => c.jobs_done >= 1,    reward: { cash: 100 } },
  { id: 'hundred_jobs',     name: 'Grinder',           desc: 'Complete 100 jobs',                  rule: c => c.jobs_done >= 100,  reward: { cash: 10000,   favor_points: 1 } },
  { id: 'thousand_jobs',    name: 'The Earner',        desc: 'Complete 1,000 jobs',                rule: c => c.jobs_done >= 1000, reward: { cash: 200000,  favor_points: 5 } },
  { id: 'level_10',         name: 'Made Man',          desc: 'Reach level 10',                     rule: c => c.level >= 10,       reward: { cash: 5000,    favor_points: 1 } },
  { id: 'level_25',         name: 'Capo',              desc: 'Reach level 25',                     rule: c => c.level >= 25,       reward: { cash: 50000,   favor_points: 2 } },
  { id: 'level_50',         name: 'Underboss',         desc: 'Reach level 50',                     rule: c => c.level >= 50,       reward: { cash: 250000,  favor_points: 5 } },
  { id: 'level_75',         name: 'Don',               desc: 'Reach level 75',                     rule: c => c.level >= 75,       reward: { cash: 1000000, favor_points: 10 } },
  { id: 'first_property',   name: 'Landlord',          desc: 'Own your first property',            rule: (c, ctx) => ctx.propertyCount >= 1, reward: { cash: 500 } },
  { id: 'all_properties',   name: 'Empire',            desc: 'Own all 7 properties',               rule: (c, ctx) => ctx.propertyCount >= 7, reward: { cash: 500000, favor_points: 10 } },
  { id: 'millionaire',      name: 'Made a Million',    desc: 'Hold $1,000,000',                    rule: c => c.cash >= 1000000,   reward: { favor_points: 3 } },
  // --- THE WIN CONDITION ---
  // Grand Don is the systemic completion state: max-tier level + all 3 cities
  // mastered + every property owned + every other achievement earned.
  // Firing this sets characters.completed_at and shows the completion screen.
  // Must be listed LAST so per-pass evaluation sees all prior achievements.
  { id: 'grand_don',        name: 'Grand Don',         desc: 'L75 · all cities mastered · all properties owned · every other achievement',
    rule: (c, ctx) => c.level >= 75 && ctx.allCitiesMastered && ctx.propertyCount >= 7 && ctx.allOtherAchievementsEarned,
    reward: { cash: 10000000, favor_points: 100 } },
];

// ---------- LORE PACKS ----------
// Independent from the visual theme: a user can run cyber-theme + mafia-lore
// or mafia-theme + cyber-lore. The lore layer is display-only — every
// underlying id (e.g. city.id = 'nyc') stays stable so game logic doesn't care.
const LORE = {
  mafia: {
    label: 'Mafia',
    description: 'Classic 2000s Cosa Nostra — wiseguys, New York, Chicago, Vegas.',
    brand_tagline: 'a 2000s-style mafia grinder',
    city_names: {
      // id → display name (leave undefined to keep the default in data)
    },
    // Left as empty overrides — default gangster pool from GUEST_NOUNS is used
    guest_nouns: null,
  },
  cyber: {
    label: 'Neon / Silent Guardian',
    description: 'Rain-soaked megacity, operating in OVERSOUL\'s blind spots. Districts are wired. Crews are factions.',
    brand_tagline: 'running the grid in OVERSOUL\'s blind spots',
    city_names: {
      nyc:     'The Veins',
      chicago: 'The Rust',
      vegas:   'The Gloss',
    },
    guest_nouns: [
      'Kaye', 'Ironside', 'Westfall', 'Mercy', 'Old Seven', 'Wire',
      'Cascade', 'Gloss', 'Rust', 'Vein', 'Hollow', 'Pyre', 'Spire',
      'Reclaim', 'Sable', 'Cipher', 'Echo', 'Null', 'Render', 'Signal',
    ],
  },
};

// ---------- GUEST NAME POOL ----------
// Random gangster nickname assembled on first visit. Used so the default
// character has a personality without a name-entry screen.
const GUEST_ADJECTIVES = [
  'Quiet', 'Slick', 'Fat', 'Skinny', 'Lucky', 'Mad', 'Crazy', 'Silent', 'Blind',
  'One-Eye', 'Cool', 'Fast', 'Sneaky', 'Cold', 'Iron', 'Stone', 'Tiny', 'Big',
  'Sharp', 'Tough', 'Sly', 'Bad', 'Quick', 'Wild', 'Frosty', 'Red', 'Black', 'Gray',
];
const GUEST_NOUNS = [
  'Tony', 'Vinny', 'Frankie', 'Sal', 'Paulie', 'Johnny', 'Louie', 'Mikey',
  'Rocco', 'Angelo', 'Benny', 'Nick', 'Carlo', 'Joey', 'Tommy', 'Ralphie',
  'Dom', 'Sonny', 'Bruno', 'Gino', 'Marco', 'Lorenzo', 'Vito', 'Silvio',
];

const HIRED_GUN_NAMES = [
  'Little Nicky', 'Three-Finger Louie', 'Fat Tony', 'Bugsy', 'Ricky the Rat',
  'Ace of Spades', 'Benny the Book', 'Uncle Junior', 'Dominic the Dragon', 'Mario the Mechanic',
  'The Weasel', 'Philly Joe', 'Crazy Eddie', 'Don the Enforcer', 'Stone-Cold Sammy',
];

// ---------- NPC NAMES for seed opponents ----------
const NPC_NAMES = [
  'Sal the Foot', 'Jimmy Two-Times', 'Vinny the Nose', 'Carlo the Hat', 'Tony Eggs',
  'Paulie Walnuts', 'Frankie Five-Fingers', 'Big Pussy', 'Johnny Sack', 'Silvio Dante',
  'Fat Clemenza', 'Tessio', 'Sonny Red', 'Benny Eggs', 'Joey Cupcakes',
  'Mikey Mustache', 'Louie the Lip', 'Rocco the Barber', 'Nicky Newark', 'Angelo Ice',
  'Donny Brasco', 'Tommy DeVito', 'Henry the Horse', 'Ralph the Razor', 'Mo Green',
];

// ---------- REGEN ----------
// Seconds per +1 point. Original Mob Wars was: energy 180s, stamina 300s, health 90s.
const REGEN = {
  energy:  180,
  stamina: 300,
  health:  90,
};

// ---------- SKILL POINT COSTS ----------
const SKILL_COST = {
  max_health:  { sp: 1, per: 10 }, // 1 SP -> +10 HP
  max_energy:  { sp: 1, per: 1 },
  max_stamina: { sp: 2, per: 1 },  // double cost
  attack:      { sp: 1, per: 1 },
  defense:     { sp: 1, per: 1 },
};

const SKILL_POINTS_PER_LEVEL = 5;

// XP required to reach level N (cumulative). Classic near-quadratic curve.
function xpForLevel(level) {
  if (level <= 1) return 0;
  return Math.floor(100 * Math.pow(level - 1, 1.7));
}

module.exports = {
  ITEMS, JOBS, PROPERTIES, RECIPES, CITIES, CITY_MASTERY_THRESHOLD,
  NPC_NAMES, REGEN, SKILL_COST, SKILL_POINTS_PER_LEVEL,
  INCOME_CAP_HOURS, xpForLevel, MOB, HIRED_GUN_NAMES,
  AMBUSH, ACHIEVEMENTS, GUEST_ADJECTIVES, GUEST_NOUNS,
  LORE,
};
