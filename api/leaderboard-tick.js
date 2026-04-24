// Vercel Cron endpoint — hit daily, diffs the leaderboard against the last
// snapshot in Vercel Blob and posts changes to a Discord webhook.
//
// Secrets (set in Vercel project env):
//   BLOB_READ_WRITE_TOKEN   — auto-provided when Blob is bound to the project
//   DISCORD_WEBHOOK_URL     — full https://discord.com/api/webhooks/... URL
//   CRON_SECRET             — shared secret Vercel Cron sets as Bearer auth
//
// Returns JSON describing what happened so `vercel logs` shows useful output.

const { put, list } = require('@vercel/blob');
const leaderboard = require('../leaderboard');

// The blob key we rewrite on every tick. Versioned so a schema rev can coexist
// with the old snapshot during rollout.
const SNAPSHOT_KEY = 'leaderboard/snapshot.v1.json';

async function readPrevSnapshot() {
  // list() is cheap; we could also blindly fetch by URL, but urls aren't
  // deterministic without the random suffix. Using allowOverwrite keeps the
  // URL stable, but list-then-fetch is safer against migration drift.
  try {
    const result = await list({ prefix: SNAPSHOT_KEY, limit: 1 });
    const blob = result.blobs.find(b => b.pathname === SNAPSHOT_KEY);
    if (!blob) return null;
    const resp = await fetch(blob.url);
    if (!resp.ok) return null;
    return await resp.json();
  } catch (e) {
    console.error('[leaderboard-tick] prev snapshot read failed:', e.message);
    return null;
  }
}

async function writeSnapshot(snap) {
  return put(SNAPSHOT_KEY, JSON.stringify(snap, null, 2), {
    access: 'public',
    contentType: 'application/json',
    allowOverwrite: true,
    addRandomSuffix: false,
  });
}

async function postToDiscord(bodies) {
  const url = process.env.DISCORD_WEBHOOK_URL;
  if (!url) throw new Error('DISCORD_WEBHOOK_URL not set');
  const results = [];
  for (const body of bodies) {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    results.push({ status: resp.status, ok: resp.ok });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`Discord webhook ${resp.status}: ${text.slice(0, 200)}`);
    }
  }
  return results;
}

module.exports = async (req, res) => {
  // Vercel Cron sets `Authorization: Bearer $CRON_SECRET`. Anything else is
  // an unauthorized caller.
  const expected = process.env.CRON_SECRET;
  const provided = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (expected && provided !== expected) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  try {
    const curr = leaderboard.snapshot();
    const prev = await readPrevSnapshot();
    const wiped = leaderboard.looksLikeWipe(prev, curr);
    const events = wiped ? [] : leaderboard.diff(prev, curr);
    const messages = leaderboard.formatForDiscord(events, curr);

    let discord = { skipped: true, reason: 'no events' };
    if (wiped) {
      discord = { skipped: true, reason: 'wipe_detected',
                  prev_players: prev && prev.player_count, curr_players: curr.player_count };
    } else if (messages.length > 0) {
      const results = await postToDiscord(messages);
      discord = { skipped: false, messages: results.length, statuses: results };
    }

    // Always persist the current snapshot so the next tick has a baseline.
    await writeSnapshot(curr);

    res.status(200).json({
      ok: true,
      players: curr.player_count,
      events: events.length,
      discord,
      wiped,
    });
  } catch (e) {
    console.error('[leaderboard-tick] failed:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
};
