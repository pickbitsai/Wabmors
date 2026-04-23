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
};

// ---------- JOBS ----------
// tier: progression gate. Higher tier requires mastery of the previous tier.
// energy_cost, payout (cash), xp, mastery_required_for_next, loot (chance + item_id),
// unlock_level: minimum player level.
const JOBS = [
  // Tier 1 - street
  { id: 'mug_tourist',     name: 'Mug a Tourist',         tier: 1, unlock_level: 1,  energy: 2, cash: [25, 80],     xp: 3,  loot: { chance: 0.1, item: 'brass_knuckles' } },
  { id: 'pickpocket',      name: 'Pickpocket the Market', tier: 1, unlock_level: 1,  energy: 3, cash: [60, 140],    xp: 4,  loot: null },
  { id: 'shakedown',       name: 'Shake Down a Shopkeeper', tier: 1, unlock_level: 2, energy: 4, cash: [120, 250],   xp: 6,  loot: { chance: 0.08, item: 'switchblade' } },

  // Tier 2 - neighborhood
  { id: 'numbers_racket',  name: 'Run a Numbers Racket',  tier: 2, unlock_level: 4,  energy: 6,  cash: [400, 750],    xp: 11, loot: { chance: 0.1, item: 'leather_jacket' } },
  { id: 'rig_horse_race',  name: 'Rig a Horse Race',      tier: 2, unlock_level: 6,  energy: 8,  cash: [800, 1500],   xp: 16, loot: { chance: 0.07, item: 'beater_sedan' } },
  { id: 'jack_truck',      name: 'Jack a Delivery Truck', tier: 2, unlock_level: 8,  energy: 10, cash: [1600, 3200],  xp: 22, loot: { chance: 0.1, item: 'saturday_special' } },

  // Tier 3 - organized
  { id: 'protection_run',  name: 'Run a Protection Racket', tier: 3, unlock_level: 12, energy: 14, cash: [5000, 9000],  xp: 38, loot: { chance: 0.1, item: 'bulletproof_vest' } },
  { id: 'casino_skim',     name: 'Skim the Casino Count',  tier: 3, unlock_level: 15, energy: 18, cash: [9000, 18000], xp: 52, loot: { chance: 0.1, item: 'muscle_car' } },
  { id: 'bank_job',        name: 'Pull a Bank Job',        tier: 3, unlock_level: 18, energy: 22, cash: [18000, 40000], xp: 72, loot: { chance: 0.1, item: 'tommy_gun' } },

  // Tier 4 - made
  { id: 'hijack_armored',  name: 'Hijack an Armored Car',  tier: 4, unlock_level: 25, energy: 28, cash: [50000, 95000], xp: 120, loot: { chance: 0.1, item: 'kevlar_suit' } },
  { id: 'smuggle_ring',    name: 'Run a Smuggling Ring',   tier: 4, unlock_level: 30, energy: 34, cash: [110000, 220000], xp: 180, loot: { chance: 0.1, item: 'black_cadillac' } },
  { id: 'whack_rival',     name: 'Whack a Rival Capo',     tier: 4, unlock_level: 35, energy: 40, cash: [240000, 500000], xp: 280, loot: { chance: 0.1, item: 'sawed_off' } },

  // Tier 5 - don
  { id: 'take_syndicate',  name: 'Take Over a Syndicate',  tier: 5, unlock_level: 45, energy: 50, cash: [600000, 1200000], xp: 450, loot: { chance: 0.08, item: 'pinstripe_mail' } },
  { id: 'heist_fed',       name: 'Heist the Federal Reserve', tier: 5, unlock_level: 55, energy: 65, cash: [1500000, 3000000], xp: 700, loot: { chance: 0.08, item: 'armored_limo' } },
  { id: 'command_family',  name: 'Command the Five Families', tier: 5, unlock_level: 70, energy: 80, cash: [3500000, 7500000], xp: 1100, loot: { chance: 0.05, item: 'gold_plated_45' } },
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
const MOB = {
  base_cap: 25,           // starting cap per kind (friendlier for solo play than LCN's 500)
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
  ITEMS, JOBS, PROPERTIES, NPC_NAMES, REGEN, SKILL_COST, SKILL_POINTS_PER_LEVEL,
  INCOME_CAP_HOURS, xpForLevel, MOB, HIRED_GUN_NAMES,
};
