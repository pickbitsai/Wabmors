const express = require('express');
const cookieSession = require('cookie-session');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const db = require('./db');
const game = require('./game');
const data = require('./data');

// Cache-busting version for /style.css — derived from the file's mtime at
// boot (dev) or a deploy-time constant (Vercel injects VERCEL_GIT_COMMIT_SHA).
// When the file changes, the querystring changes, so browsers can't serve
// stale CSS after a theme refactor.
function computeAssetVersion() {
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 8);
  try {
    const stat = fs.statSync(path.join(__dirname, 'public', 'style.css'));
    return String(Math.floor(stat.mtimeMs));
  } catch (_) { return String(Date.now()); }
}
const ASSET_VERSION = computeAssetVersion();

const app = express();
const PORT = process.env.PORT || 3456;

app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));
// Stateless signed-cookie sessions — work on serverless without a session store.
app.use(cookieSession({
  name: 'wabmors',
  keys: [process.env.SESSION_SECRET || 'wabmors-dev-secret-change-me'],
  maxAge: 1000 * 60 * 60 * 24 * 30,
  sameSite: 'lax',
  httpOnly: true,
  secure: process.env.VERCEL ? true : false,
}));

// ---------- flash + theme + lore ----------
// cookie-session session object is `null` until first write, so guard writes.
app.use((req, res, next) => {
  res.locals.flash = (req.session && req.session.flash) || null;
  if (req.session) req.session.flash = null;
  const theme = (req.session && req.session.theme) || 'mafia';
  const lore  = (req.session && req.session.lore)  || 'mafia';
  res.locals.theme = theme;
  res.locals.lore = lore;
  // Helper: display name for a city, honoring the active lore pack.
  res.locals.cityName = (cityDef) =>
    (data.LORE[lore] && data.LORE[lore].city_names && data.LORE[lore].city_names[cityDef.id])
    || cityDef.name;
  res.locals.loreTagline = (data.LORE[lore] && data.LORE[lore].brand_tagline) || '';
  res.locals.assetVersion = ASSET_VERSION;
  next();
});

// Set theme or lore; accepts {mafia, cyber} for either.
app.post('/prefs/:key/:value', (req, res) => {
  const { key, value } = req.params;
  if (!['theme', 'lore'].includes(key)) return res.redirect('/account');
  const allowed = ['mafia', 'cyber'];
  if (!allowed.includes(value)) return res.redirect('/account');
  if (!req.session) req.session = {};
  req.session[key] = value;
  res.redirect(req.get('Referer') || '/account');
});
function flash(req, text, kind = 'info') {
  if (!req.session) req.session = {};
  req.session.flash = { text, kind };
}

// ---------- auth middleware ----------
// Guest-first: every visitor gets a character immediately. Optional /claim
// step upgrades the guest to a real username+password for cross-device access.
function loadChar(req, res, next) {
  if (!req.session || !req.session.userId) {
    const guest = game.createGuest();
    req.session = req.session || {};
    req.session.userId = guest.user_id;
    req.char = guest;
    res.locals.char = guest;
    res.locals.isGuest = true;
    res.locals.xpForLevel = data.xpForLevel;
    return next();
  }
  const c = game.getCharacterByUser(req.session.userId);
  if (!c) {
    // Session refers to a user whose character was wiped (cold start on Vercel). Reset.
    req.session = null;
    return res.redirect('/');
  }
  game.saveVitals(c);
  req.char = c;
  res.locals.char = c;
  res.locals.isGuest = game.isGuestUser(req.session.userId);
  res.locals.xpForLevel = data.xpForLevel;
  next();
}

// ---------- ROUTES ----------
app.get('/', (req, res) => res.redirect('/hub'));

// --- login (only useful for users who've claimed their account)
app.get('/login', (req, res) => {
  if (req.session && req.session.userId) return res.redirect('/');
  res.render('login', { err: null });
});
app.post('/login', (req, res) => {
  const { username, password } = req.body;
  const u = db.prepare('SELECT * FROM users WHERE username = ? AND is_guest = 0').get(username || '');
  if (!u || !bcrypt.compareSync(password || '', u.password_hash))
    return res.render('login', { err: 'invalid credentials' });
  req.session = { userId: u.id };
  res.redirect('/');
});

app.post('/logout', (req, res) => { req.session = null; res.redirect('/login'); });

// --- claim a guest account (set username + password so you can log in elsewhere)
app.get('/claim', loadChar, (req, res) => {
  if (!res.locals.isGuest) return res.redirect('/hub');
  res.render('claim', { err: null });
});
app.post('/claim', loadChar, (req, res) => {
  if (!res.locals.isGuest) return res.redirect('/hub');
  try {
    game.claimGuest(req.session.userId, (req.body.username || '').trim(), req.body.password || '');
    flash(req, 'Account claimed — you can now log in from any device', 'good');
  } catch (e) {
    return res.render('claim', { err: e.message });
  }
  res.redirect('/hub');
});

// --- hub
app.get('/hub', loadChar, (req, res) => {
  const c = req.char;
  const nextXp = data.xpForLevel(c.level + 1);
  const curXp = data.xpForLevel(c.level);
  const earnedPassives = game.earnedCityPassives(c.id);
  res.render('hub', { nextXp, curXp, earnedPassives });
});

// --- skill allocation
app.post('/allocate', loadChar, (req, res) => {
  try {
    game.spendSkillPoint(req.char, req.body.stat);
    flash(req, '+1 allocated');
  } catch (e) { flash(req, e.message, 'err'); }
  res.redirect('/hub');
});

// --- jobs
app.get('/jobs', loadChar, (req, res) => {
  const c = req.char;
  const mastery = game.getJobMastery(c.id);
  const currentCity = data.CITIES.find(ci => ci.id === req.query.city) || data.CITIES[0];
  const availableJobs = data.JOBS
    .filter(j => j.city === currentCity.id)
    .map(j => ({ ...j, completions: mastery[j.id] || 0 }));
  const earned = game.earnedCityPassives(c.id);
  res.render('jobs', {
    jobs: availableJobs,
    cities: data.CITIES,
    currentCity,
    earnedPassives: earned,
    masteryThreshold: data.CITY_MASTERY_THRESHOLD,
    actionLog: game.getActionLog(c.id),
  });
});
app.post('/jobs/:id', loadChar, (req, res) => {
  try {
    const r = game.doJob(req.char, req.params.id);
    let msg = `+$${r.cash.toLocaleString()} / +${r.xp} XP`;
    if (r.lootItem) msg += ` / LOOT: ${data.ITEMS[r.lootItem].name}`;
    if (r.leveledUp) msg += ` / LEVEL UP! (+${r.leveledUp})`;
    flash(req, msg, r.leveledUp ? 'good' : 'info');
  } catch (e) { flash(req, e.message, 'err'); }
  res.redirect('/jobs');
});

// --- inventory
app.get('/inventory', loadChar, (req, res) => {
  const inv = game.getInventory(req.char.id);
  const atk = game.bestLoadout(req.char, 'attack');
  const def = game.bestLoadout(req.char, 'defense');
  res.render('inventory', { inv, atk, def, totalsAtk: game.loadoutTotals(atk), totalsDef: game.loadoutTotals(def) });
});

// --- shop
app.get('/shop', loadChar, (req, res) => {
  const items = Object.entries(data.ITEMS)
    .filter(([, v]) => v.cost > 0)
    .map(([id, v]) => ({ id, ...v }))
    .sort((a, b) => a.cost - b.cost);
  res.render('shop', { items });
});
app.post('/shop/buy/:id', loadChar, (req, res) => {
  try {
    const qty = Math.max(1, Math.min(10, parseInt(req.body.qty || '1', 10)));
    const r = game.buyItem(req.char, req.params.id, qty);
    flash(req, `Bought ${qty}x ${data.ITEMS[req.params.id].name} for $${r.total.toLocaleString()}`, 'good');
  } catch (e) { flash(req, e.message, 'err'); }
  res.redirect('/shop');
});

// --- fight
app.get('/fight', loadChar, (req, res) => {
  const opponents = game.findOpponents(req.char, 25);
  const ambushes = game.getLiveAmbushes(req.char.id);
  // Who has attacked me recently (last 23h)?
  const recentAttackers = db.prepare(`SELECT DISTINCT c.id, c.name FROM fight_log f
    JOIN characters c ON c.id = f.attacker_id
    WHERE f.defender_id = ? AND f.kind = 'fight' AND f.ts >= ? AND c.id != ?
    ORDER BY f.ts DESC LIMIT 10`)
    .all(req.char.id, game.now() - 23 * 3600, req.char.id);
  res.render('fight', { opponents, ambushes, recentAttackers, actionLog: game.getActionLog(req.char.id) });
});
app.post('/fight/ambush', loadChar, (req, res) => {
  try {
    const targetId = parseInt(req.body.target_id, 10);
    const cash = parseInt(req.body.cash, 10);
    game.setAmbush(req.char, targetId, cash);
    flash(req, 'Ambush set', 'good');
  } catch (e) { flash(req, e.message, 'err'); }
  res.redirect('/fight');
});
app.post('/fight/:id', loadChar, (req, res) => {
  const target = game.getCharacter(parseInt(req.params.id, 10));
  if (!target || target.id === req.char.id) { flash(req, 'invalid target', 'err'); return res.redirect('/fight'); }
  const r = game.resolveFight(req.char, target);
  if (r.error) { flash(req, r.error, 'err'); return res.redirect('/fight'); }
  let msg = r.won
    ? `WON vs ${target.name}: +$${r.cashStolen.toLocaleString()} / +${r.xp} XP — dealt ${r.dmgToDef}, took ${r.dmgToAtk}`
    : `LOST vs ${target.name}: dealt ${r.dmgToDef}, took ${r.dmgToAtk}`;
  if (r.leveledUp) msg += ` / LEVEL UP! (+${r.leveledUp})`;
  flash(req, msg, r.won ? 'good' : 'err');
  res.redirect('/fight');
});

// --- hitlist
app.get('/hitlist', loadChar, (req, res) => {
  const hits = game.getOpenHits();
  const myActive = db.prepare('SELECT COUNT(*) AS n FROM hitlist WHERE placer_id = ? AND completed_at IS NULL').get(req.char.id).n;
  res.render('hitlist', { hits, myActive, actionLog: game.getActionLog(req.char.id) });
});
app.post('/hitlist/place', loadChar, (req, res) => {
  try {
    const targetId = parseInt(req.body.target_id, 10);
    const bounty = parseInt(req.body.bounty, 10);
    game.placeHit(req.char.id, targetId, bounty);
    flash(req, 'Hit placed', 'good');
  } catch (e) { flash(req, e.message, 'err'); }
  res.redirect('/hitlist');
});
app.post('/hitlist/take/:id', loadChar, (req, res) => {
  try {
    const r = game.completeHit(parseInt(req.params.id, 10), req.char.id);
    if (r.won) flash(req, `Hit completed! +$${r.bounty.toLocaleString()}`, 'good');
    else flash(req, `Hit failed — dealt ${r.dmgToTgt}, took ${r.dmgToHnt}`, 'err');
  } catch (e) { flash(req, e.message, 'err'); }
  res.redirect('/hitlist');
});

// --- properties
app.get('/properties', loadChar, (req, res) => {
  const owned = game.getOwnedProperties(req.char.id);
  const ownedIds = new Set(owned.map(p => p.id));
  const buyable = data.PROPERTIES.filter(p => !ownedIds.has(p.id));
  const ownedWithNext = owned.map(p => ({ ...p, upgrade_cost: game.propertyUpgradeCost(p, p.level, req.char.id) }));
  const buyableWithCost = buyable.map(p => ({ ...p, upgrade_cost: game.propertyUpgradeCost(p, 0, req.char.id) }));
  res.render('properties', { owned: ownedWithNext, buyable: buyableWithCost, actionLog: game.getActionLog(req.char.id) });
});
app.post('/properties/buy/:id', loadChar, (req, res) => {
  try {
    const r = game.buyOrUpgradeProperty(req.char, req.params.id);
    flash(req, `Property now level ${r.newLevel} (−$${r.cost.toLocaleString()})`, 'good');
  } catch (e) { flash(req, e.message, 'err'); }
  res.redirect('/properties');
});
app.post('/properties/collect', loadChar, (req, res) => {
  const total = game.collectProperties(req.char);
  flash(req, `Collected $${total.toLocaleString()}`, total > 0 ? 'good' : 'info');
  res.redirect('/properties');
});

// --- favor refills
app.post('/refill/:which', loadChar, (req, res) => {
  try {
    game.favorRefill(req.char, req.params.which);
    flash(req, `${req.params.which} refilled`, 'good');
  } catch (e) { flash(req, e.message, 'err'); }
  res.redirect(req.get('Referer') || '/hub');
});

// --- workshop / crafting
app.get('/workshop', loadChar, (req, res) => {
  const recipes = game.listRecipes(req.char.id, false);
  res.render('workshop', { recipes, actionLog: game.getActionLog(req.char.id) });
});
app.post('/workshop/craft/:id', loadChar, (req, res) => {
  try {
    const r = game.craftRecipe(req.char, req.params.id);
    flash(req, `Crafted ${r.name}`, 'good');
  } catch (e) { flash(req, e.message, 'err'); }
  res.redirect('/workshop');
});

// --- mob
app.get('/mob', loadChar, (req, res) => {
  const c = req.char;
  const members = game.getMob(c.id);
  const cap = game.mobCap(c.level);
  const active = game.activeMobSize(c);
  res.render('mob', { members, cap, active });
});
app.post('/mob/hire', loadChar, (req, res) => {
  try {
    const qty = Math.max(1, Math.min(5, parseInt(req.body.qty || '1', 10)));
    for (let i = 0; i < qty; i++) game.hireGun(req.char);
    flash(req, `Hired ${qty} gun${qty > 1 ? 's' : ''}`, 'good');
  } catch (e) { flash(req, e.message, 'err'); }
  res.redirect('/mob');
});
app.post('/mob/fire/:slot', loadChar, (req, res) => {
  try {
    game.fireMobster(req.char, parseInt(req.params.slot, 10));
    flash(req, 'Fired mobster', 'info');
  } catch (e) { flash(req, e.message, 'err'); }
  res.redirect('/mob');
});

// --- account (user settings: theme, lore, claim)
app.get('/account', loadChar, (req, res) => {
  res.render('account', { lorePacks: data.LORE });
});

// --- achievements
app.get('/achievements', loadChar, (req, res) => {
  const achievements = game.getAchievements(req.char.id);
  const earned = achievements.filter(a => a.earned).length;
  res.render('achievements', { achievements, earned, total: achievements.length });
});

// --- chat
app.get('/chat', loadChar, (req, res) => {
  const messages = game.getChat(50);
  res.render('chat', { messages });
});
app.post('/chat', loadChar, (req, res) => {
  game.postChat(req.char.id, req.body.text || '');
  res.redirect('/chat');
});

// ---------- boot ----------
game.seedNpcsIfEmpty(60);

// Only listen when run directly (local dev). On serverless (Vercel), we export
// the app and the platform invokes it via an adapter.
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Wabmors running at http://localhost:${PORT}`);
  });
}

module.exports = app;
