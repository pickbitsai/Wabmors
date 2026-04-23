const express = require('express');
const cookieSession = require('cookie-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const db = require('./db');
const game = require('./game');
const data = require('./data');

const app = express();
const PORT = process.env.PORT || 3456;

app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));
// Stateless signed-cookie sessions — work on serverless without a session store.
app.use(cookieSession({
  name: 'wobmors',
  keys: [process.env.SESSION_SECRET || 'wobmors-dev-secret-change-me'],
  maxAge: 1000 * 60 * 60 * 24 * 30,
  sameSite: 'lax',
  httpOnly: true,
  secure: process.env.VERCEL ? true : false,
}));

// ---------- flash helper ----------
// cookie-session session object is `null` until first write, so guard writes.
app.use((req, res, next) => {
  res.locals.flash = (req.session && req.session.flash) || null;
  if (req.session) req.session.flash = null;
  next();
});
function flash(req, text, kind = 'info') {
  if (!req.session) req.session = {};
  req.session.flash = { text, kind };
}

// ---------- auth middleware ----------
function loadChar(req, res, next) {
  if (!req.session.userId) return res.redirect('/login');
  const c = game.getCharacterByUser(req.session.userId);
  if (!c) return res.redirect('/create-character');
  // persist regen state
  game.saveVitals(c);
  req.char = c;
  res.locals.char = c;
  res.locals.xpForLevel = data.xpForLevel;
  next();
}

function guest(req, res, next) {
  if (req.session.userId) return res.redirect('/');
  next();
}

// ---------- ROUTES ----------
app.get('/', (req, res) => {
  if (!req.session.userId) return res.redirect('/login');
  res.redirect('/hub');
});

// --- auth
app.get('/register', guest, (req, res) => res.render('register', { err: null }));
app.post('/register', guest, (req, res) => {
  const { username, password } = req.body;
  if (!username || !password || username.length < 3 || password.length < 4)
    return res.render('register', { err: 'username >=3 chars, password >=4 chars' });
  try {
    const hash = bcrypt.hashSync(password, 10);
    const r = db.prepare('INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)')
      .run(username, hash, game.now());
    req.session.userId = r.lastInsertRowid;
    return res.redirect('/create-character');
  } catch (e) {
    return res.render('register', { err: 'username taken' });
  }
});

app.get('/login', guest, (req, res) => res.render('login', { err: null }));
app.post('/login', guest, (req, res) => {
  const { username, password } = req.body;
  const u = db.prepare('SELECT * FROM users WHERE username = ?').get(username || '');
  if (!u || !bcrypt.compareSync(password || '', u.password_hash))
    return res.render('login', { err: 'invalid credentials' });
  req.session.userId = u.id;
  res.redirect('/');
});

app.post('/logout', (req, res) => { req.session = null; res.redirect('/login'); });

app.get('/create-character', (req, res) => {
  if (!req.session.userId) return res.redirect('/login');
  const existing = game.getCharacterByUser(req.session.userId);
  if (existing) return res.redirect('/');
  res.render('create_character', { err: null });
});
app.post('/create-character', (req, res) => {
  if (!req.session.userId) return res.redirect('/login');
  const existing = game.getCharacterByUser(req.session.userId);
  if (existing) return res.redirect('/');
  const name = (req.body.name || '').trim();
  if (name.length < 3 || name.length > 24)
    return res.render('create_character', { err: 'name must be 3-24 chars' });
  try {
    game.createCharacter({ userId: req.session.userId, name });
  } catch (e) {
    return res.render('create_character', { err: 'name taken' });
  }
  res.redirect('/hub');
});

// --- hub
app.get('/hub', loadChar, (req, res) => {
  const c = req.char;
  const nextXp = data.xpForLevel(c.level + 1);
  const curXp = data.xpForLevel(c.level);
  res.render('hub', { nextXp, curXp });
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
  const availableJobs = data.JOBS.map(j => ({ ...j, completions: mastery[j.id] || 0 }));
  res.render('jobs', { jobs: availableJobs, actionLog: game.getActionLog(c.id) });
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
  res.render('fight', { opponents, actionLog: game.getActionLog(req.char.id) });
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
  const ownedWithNext = owned.map(p => ({ ...p, upgrade_cost: game.propertyUpgradeCost(p, p.level) }));
  const buyableWithCost = buyable.map(p => ({ ...p, upgrade_cost: game.propertyUpgradeCost(p, 0) }));
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
    console.log(`WobMors running at http://localhost:${PORT}`);
  });
}

module.exports = app;
