/**
 * Local smoke: pg-mem + relational words API
 * Run: node smoke.mjs
 */
import { newDb } from 'pg-mem';
import { buildApp, ensureTables } from './server.js';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'smoke-secret';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  const db = newDb({ autoCreateForeignKeyIndices: true });
  db.public.registerFunction({
    name: 'now',
    returns: 'timestamptz',
    implementation: () => new Date(),
    impure: true,
  });

  const { Pool } = db.adapters.createPg();
  const pool = new Pool();
  await ensureTables(pool);
  const app = await buildApp(pool);
  const auth = { authorization: '' };

  const hash = 'dGVzdGhhc2gxMjM0NTY=';
  const reg = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username: 'smoke_user', authHash: hash },
  });
  assert(reg.statusCode === 200, 'register ' + reg.body);
  auth.authorization = 'Bearer ' + reg.json().token;

  const health = await app.inject({ method: 'GET', url: '/api/' });
  assert(health.statusCode === 200, 'health');

  const word = {
    id: 'elated',
    word: 'elated',
    translation: '兴高采烈的',
    mnemonic: 'note1',
    synonyms: [{ word: 'joyful', gloss: '快乐的' }],
    ease: 2.5,
    interval: 0,
    streak: 0,
    nextReview: Date.now(),
    totalReviews: 0,
    correctReviews: 0,
    createdAt: Date.now(),
    crossedOut: false,
    starred: false,
    examples: [],
    category: [],
  };

  const put = await app.inject({
    method: 'PUT',
    url: '/api/words/elated',
    headers: auth,
    payload: word,
  });
  assert(put.statusCode === 200, 'put ' + put.body);
  assert(put.json().word.mnemonic === 'note1', 'mnemonic');
  assert(put.json().word.synonyms?.[0]?.word === 'joyful', 'synonym');

  const patch = await app.inject({
    method: 'PATCH',
    url: '/api/words/elated/progress',
    headers: auth,
    payload: { streak: 2, nextReview: Date.now() + 3600000, starred: true },
  });
  assert(patch.statusCode === 200, 'patch ' + patch.body);
  assert(patch.json().word.streak === 2, 'streak');
  assert(patch.json().word.starred === true, 'starred');

  const list = await app.inject({
    method: 'GET',
    url: '/api/words',
    headers: auth,
  });
  assert(list.statusCode === 200, 'list');
  assert(list.json().words.length === 1, 'list count');

  const since = Date.now() + 10_000;
  const incr = await app.inject({
    method: 'GET',
    url: '/api/words?since=' + since,
    headers: auth,
  });
  assert(incr.statusCode === 200, 'since');
  assert(incr.json().words.length === 0, 'since empty');

  const batch = await app.inject({
    method: 'POST',
    url: '/api/words/batch',
    headers: auth,
    payload: {
      words: [
        { ...word, id: 'happy', word: 'happy', translation: '快乐' },
        { ...word, mnemonic: 'note2', synonyms: [{ word: 'glad', gloss: '高兴' }] },
      ],
    },
  });
  assert(batch.statusCode === 200, 'batch ' + batch.body);
  assert(batch.json().count === 2, 'batch count');

  const prefs = await app.inject({
    method: 'PUT',
    url: '/api/me/prefs',
    headers: auth,
    payload: {
      customCategories: ['my_cat'],
      learningStreak: { count: 3, lastDay: '2026-08-04' },
      practice: null,
    },
  });
  assert(prefs.statusCode === 200, 'prefs put ' + prefs.body);

  const prefsGet = await app.inject({
    method: 'GET',
    url: '/api/me/prefs',
    headers: auth,
  });
  assert(prefsGet.json().prefs.customCategories[0] === 'my_cat', 'prefs get');

  const del = await app.inject({
    method: 'DELETE',
    url: '/api/words/happy',
    headers: auth,
  });
  assert(del.statusCode === 200, 'delete');

  const noAuth = await app.inject({ method: 'GET', url: '/api/words' });
  assert(noAuth.statusCode === 401, 'auth guard');

  await app.close();
  await pool.end();
  console.log('SMOKE OK: relational words / progress / batch / prefs');
}

main().catch((e) => {
  console.error('SMOKE FAILED', e);
  process.exit(1);
});
