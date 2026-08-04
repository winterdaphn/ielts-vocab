/**
 * IELTS Vocab API — Fastify + PostgreSQL
 * Auth: JWT Bearer
 * Words: relational rows + incremental sync
 * Legacy: /api/words/sync blob (kept for transition)
 */
import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from 'jsonwebtoken';
import pg from 'pg';

const { Pool } = pg;

const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET || 'dev-insecure-secret';
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS || '*';
const BATCH_MAX = 500;

function signToken(user) {
  return jwt.sign(
    { sub: user.id, username: user.username },
    JWT_SECRET,
    { expiresIn: '90d' }
  );
}

function sanitizeUsername(u) {
  if (!u || typeof u !== 'string') return '';
  return u.replace(/[^a-zA-Z0-9_\-\u4e00-\u9fa5]/g, '_').slice(0, 32);
}

function getBearer(req) {
  const header = req.headers.authorization || '';
  const m = header.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

function corsOrigin() {
  if (ALLOWED_ORIGINS === '*') return true;
  return ALLOWED_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean);
}

function parseSince(raw) {
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) return new Date(n);
  const d = new Date(String(raw));
  return Number.isNaN(d.getTime()) ? null : d;
}

function asJson(v, fallback) {
  if (v === undefined || v === null) return fallback;
  return v;
}

function rowToWord(row) {
  return {
    id: row.word_id,
    word: row.word,
    translation: row.translation || '',
    phoneticUs: row.phonetic_us || '',
    phoneticUk: row.phonetic_uk || '',
    partOfSpeech: row.pos || '',
    mnemonic: row.mnemonic || '',
    category: row.categories || [],
    synonyms: row.synonyms || [],
    similars: row.similars || [],
    derivatives: row.derivatives || [],
    collocations: row.collocations || [],
    dictCollocations: row.dict_collocations || [],
    examples: row.examples || [],
    crossedOut: !!row.crossed_out,
    starred: !!row.starred,
    ease: Number(row.ease) || 2.5,
    interval: Number(row.interval_days) || 0,
    streak: Number(row.streak) || 0,
    nextReview: row.next_review ? new Date(row.next_review).getTime() : Date.now(),
    totalReviews: Number(row.total_reviews) || 0,
    correctReviews: Number(row.correct_reviews) || 0,
    createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
    updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : Date.now(),
  };
}

function normalizeWordBody(body, wordIdParam) {
  if (!body || typeof body !== 'object') return null;
  const word = String(body.word || wordIdParam || '').trim();
  const wordId = String(body.id || wordIdParam || word)
    .trim()
    .toLowerCase();
  if (!wordId || wordId.length > 128) return null;
  return {
    wordId,
    word: word || wordId,
    translation: String(body.translation || ''),
    phoneticUs: String(body.phoneticUs || body.phonetic_us || ''),
    phoneticUk: String(body.phoneticUk || body.phonetic_uk || ''),
    pos: String(body.partOfSpeech || body.pos || ''),
    mnemonic: String(body.mnemonic || ''),
    categories: asJson(body.category ?? body.categories, []),
    synonyms: asJson(body.synonyms, []),
    similars: asJson(body.similars, []),
    derivatives: asJson(body.derivatives, []),
    collocations: asJson(body.collocations, []),
    dictCollocations: asJson(body.dictCollocations ?? body.dict_collocations, []),
    examples: asJson(body.examples, []),
    crossedOut: !!(body.crossedOut ?? body.crossed_out),
    starred: !!(body.starred),
    ease: Number(body.ease ?? 2.5),
    intervalDays: Number(body.interval ?? body.interval_days ?? 0),
    streak: Number(body.streak ?? 0),
    nextReview: body.nextReview ?? body.next_review ?? Date.now(),
    totalReviews: Number(body.totalReviews ?? body.total_reviews ?? 0),
    correctReviews: Number(body.correctReviews ?? body.correct_reviews ?? 0),
    createdAt: body.createdAt ?? body.created_at ?? Date.now(),
    updatedAt: body.updatedAt ?? body.updated_at ?? Date.now(),
  };
}

async function upsertWord(pool, userId, w) {
  const nextReview =
    typeof w.nextReview === 'number' ? new Date(w.nextReview) : new Date(w.nextReview);
  const createdAt =
    typeof w.createdAt === 'number' ? new Date(w.createdAt) : new Date(w.createdAt);
  const updatedAt =
    typeof w.updatedAt === 'number' ? new Date(w.updatedAt) : new Date(w.updatedAt);

  const result = await pool.query(
    `INSERT INTO words (
      user_id, word_id, word, translation, phonetic_us, phonetic_uk, pos, mnemonic,
      categories, synonyms, similars, derivatives, collocations, dict_collocations, examples,
      crossed_out, starred, ease, interval_days, streak, next_review,
      total_reviews, correct_reviews, created_at, updated_at
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,
      $9::jsonb,$10::jsonb,$11::jsonb,$12::jsonb,$13::jsonb,$14::jsonb,$15::jsonb,
      $16,$17,$18,$19,$20,$21,
      $22,$23,$24,$25
    )
    ON CONFLICT (user_id, word_id) DO UPDATE SET
      word = EXCLUDED.word,
      translation = EXCLUDED.translation,
      phonetic_us = EXCLUDED.phonetic_us,
      phonetic_uk = EXCLUDED.phonetic_uk,
      pos = EXCLUDED.pos,
      mnemonic = EXCLUDED.mnemonic,
      categories = EXCLUDED.categories,
      synonyms = EXCLUDED.synonyms,
      similars = EXCLUDED.similars,
      derivatives = EXCLUDED.derivatives,
      collocations = EXCLUDED.collocations,
      dict_collocations = EXCLUDED.dict_collocations,
      examples = EXCLUDED.examples,
      crossed_out = EXCLUDED.crossed_out,
      starred = EXCLUDED.starred,
      ease = EXCLUDED.ease,
      interval_days = EXCLUDED.interval_days,
      streak = EXCLUDED.streak,
      next_review = EXCLUDED.next_review,
      total_reviews = EXCLUDED.total_reviews,
      correct_reviews = EXCLUDED.correct_reviews,
      updated_at = EXCLUDED.updated_at
    RETURNING *`,
    [
      userId,
      w.wordId,
      w.word,
      w.translation,
      w.phoneticUs,
      w.phoneticUk,
      w.pos,
      w.mnemonic,
      JSON.stringify(w.categories || []),
      JSON.stringify(w.synonyms || []),
      JSON.stringify(w.similars || []),
      JSON.stringify(w.derivatives || []),
      JSON.stringify(w.collocations || []),
      JSON.stringify(w.dictCollocations || []),
      JSON.stringify(w.examples || []),
      w.crossedOut,
      w.starred,
      w.ease,
      w.intervalDays,
      w.streak,
      nextReview,
      w.totalReviews,
      w.correctReviews,
      createdAt,
      updatedAt,
    ]
  );
  return rowToWord(result.rows[0]);
}

export async function ensureTables(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_sync (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      data TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS words (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      word_id TEXT NOT NULL,
      word TEXT NOT NULL,
      translation TEXT NOT NULL DEFAULT '',
      phonetic_us TEXT NOT NULL DEFAULT '',
      phonetic_uk TEXT NOT NULL DEFAULT '',
      pos TEXT NOT NULL DEFAULT '',
      mnemonic TEXT NOT NULL DEFAULT '',
      categories JSONB NOT NULL DEFAULT '[]'::jsonb,
      synonyms JSONB NOT NULL DEFAULT '[]'::jsonb,
      similars JSONB NOT NULL DEFAULT '[]'::jsonb,
      derivatives JSONB NOT NULL DEFAULT '[]'::jsonb,
      collocations JSONB NOT NULL DEFAULT '[]'::jsonb,
      dict_collocations JSONB NOT NULL DEFAULT '[]'::jsonb,
      examples JSONB NOT NULL DEFAULT '[]'::jsonb,
      crossed_out BOOLEAN NOT NULL DEFAULT FALSE,
      starred BOOLEAN NOT NULL DEFAULT FALSE,
      ease DOUBLE PRECISION NOT NULL DEFAULT 2.5,
      interval_days DOUBLE PRECISION NOT NULL DEFAULT 0,
      streak INTEGER NOT NULL DEFAULT 0,
      next_review TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      total_reviews INTEGER NOT NULL DEFAULT 0,
      correct_reviews INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, word_id)
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS words_user_updated_idx
    ON words (user_id, updated_at);
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_prefs (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      custom_categories JSONB NOT NULL DEFAULT '[]'::jsonb,
      practice JSONB NOT NULL DEFAULT 'null'::jsonb,
      learning_streak JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

export async function buildApp(pool, { logger = false } = {}) {
  const app = Fastify({
    logger,
    bodyLimit: 10 * 1024 * 1024,
  });

  await app.register(cors, { origin: corsOrigin() });

  async function requireAuth(req, reply) {
    const token = getBearer(req);
    if (!token) {
      return reply.code(401).send({ error: 'missing_token' });
    }
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      req.user = { id: Number(payload.sub), username: payload.username };
    } catch {
      return reply.code(401).send({ error: 'invalid_token' });
    }
  }

  app.get('/api/', async () => ({ ok: true, service: 'ielts-api' }));

  app.post('/api/auth/register', async (req, reply) => {
    const username = sanitizeUsername(req.body?.username);
    const authHash = String(req.body?.authHash || '').trim();
    if (!username) return reply.code(400).send({ error: 'invalid_username' });
    if (!authHash || authHash.length < 8) {
      return reply.code(400).send({ error: 'invalid_authHash' });
    }

    const existing = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
    if (existing.rowCount > 0) {
      return reply.code(409).send({ error: 'username_taken' });
    }

    const inserted = await pool.query(
      `INSERT INTO users (username, password_hash)
       VALUES ($1, $2)
       RETURNING id, username, created_at`,
      [username, authHash]
    );
    const user = inserted.rows[0];
    const token = signToken(user);
    return {
      ok: true,
      token,
      username: user.username,
      user: { id: user.id, username: user.username },
      createdAt: new Date(user.created_at).getTime(),
    };
  });

  app.post('/api/auth/login', async (req, reply) => {
    const username = sanitizeUsername(req.body?.username);
    const authHash = String(req.body?.authHash || '').trim();
    if (!username || !authHash) {
      return reply.code(400).send({ error: 'invalid_credentials' });
    }

    const result = await pool.query(
      'SELECT id, username, password_hash, created_at FROM users WHERE username = $1',
      [username]
    );
    if (result.rowCount === 0) {
      return reply.code(401).send({ error: 'invalid_credentials' });
    }
    const user = result.rows[0];
    if (user.password_hash !== authHash) {
      return reply.code(401).send({ error: 'invalid_credentials' });
    }

    const token = signToken(user);
    return {
      ok: true,
      token,
      username: user.username,
      user: { id: user.id, username: user.username },
      createdAt: new Date(user.created_at).getTime(),
    };
  });

  // --- Relational words API ---

  app.get('/api/words', { preHandler: requireAuth }, async (req) => {
    const since = parseSince(req.query?.since);
    let result;
    if (since) {
      result = await pool.query(
        `SELECT * FROM words WHERE user_id = $1 AND updated_at > $2 ORDER BY updated_at ASC`,
        [req.user.id, since]
      );
    } else {
      result = await pool.query(
        `SELECT * FROM words WHERE user_id = $1 ORDER BY word_id ASC`,
        [req.user.id]
      );
    }
    const words = result.rows.map(rowToWord);
    const maxUpdated = words.reduce((m, w) => Math.max(m, w.updatedAt || 0), 0);
    return { ok: true, words, serverTime: Date.now(), since: since ? since.getTime() : null, maxUpdatedAt: maxUpdated || Date.now() };
  });

  app.put('/api/words/:wordId', { preHandler: requireAuth }, async (req, reply) => {
    const wordId = String(req.params.wordId || '').trim();
    const w = normalizeWordBody(req.body, wordId);
    if (!w) return reply.code(400).send({ error: 'invalid_word' });
    w.updatedAt = Date.now();
    const saved = await upsertWord(pool, req.user.id, w);
    return { ok: true, word: saved };
  });

  app.patch('/api/words/:wordId/progress', { preHandler: requireAuth }, async (req, reply) => {
    const wordId = String(req.params.wordId || '').trim();
    if (!wordId) return reply.code(400).send({ error: 'invalid_wordId' });
    const body = req.body || {};
    const sets = [];
    const vals = [];
    let i = 1;

    function add(col, val) {
      sets.push(`${col} = $${i++}`);
      vals.push(val);
    }

    if (body.ease !== undefined) add('ease', Number(body.ease));
    if (body.interval !== undefined || body.interval_days !== undefined) {
      add('interval_days', Number(body.interval ?? body.interval_days));
    }
    if (body.streak !== undefined) add('streak', Number(body.streak));
    if (body.nextReview !== undefined || body.next_review !== undefined) {
      const nr = body.nextReview ?? body.next_review;
      add('next_review', new Date(nr));
    }
    if (body.totalReviews !== undefined || body.total_reviews !== undefined) {
      add('total_reviews', Number(body.totalReviews ?? body.total_reviews));
    }
    if (body.correctReviews !== undefined || body.correct_reviews !== undefined) {
      add('correct_reviews', Number(body.correctReviews ?? body.correct_reviews));
    }
    if (body.crossedOut !== undefined || body.crossed_out !== undefined) {
      add('crossed_out', !!(body.crossedOut ?? body.crossed_out));
    }
    if (body.starred !== undefined) add('starred', !!body.starred);

    if (sets.length === 0) return reply.code(400).send({ error: 'empty_patch' });

    add('updated_at', new Date());
    vals.push(req.user.id, wordId);

    const result = await pool.query(
      `UPDATE words SET ${sets.join(', ')}
       WHERE user_id = $${i++} AND word_id = $${i}
       RETURNING *`,
      vals
    );
    if (result.rowCount === 0) {
      return reply.code(404).send({ error: 'word_not_found' });
    }
    return { ok: true, word: rowToWord(result.rows[0]) };
  });

  app.delete('/api/words/:wordId', { preHandler: requireAuth }, async (req, reply) => {
    const wordId = String(req.params.wordId || '').trim();
    const result = await pool.query(
      `DELETE FROM words WHERE user_id = $1 AND word_id = $2`,
      [req.user.id, wordId]
    );
    if (result.rowCount === 0) return reply.code(404).send({ error: 'word_not_found' });
    return { ok: true };
  });

  app.post('/api/words/batch', { preHandler: requireAuth }, async (req, reply) => {
    const list = Array.isArray(req.body?.words) ? req.body.words : null;
    if (!list) return reply.code(400).send({ error: 'missing_words' });
    if (list.length > BATCH_MAX) {
      return reply.code(413).send({ error: 'batch_too_large', max: BATCH_MAX });
    }
    const saved = [];
    for (const item of list) {
      const w = normalizeWordBody(item, item?.id || item?.word);
      if (!w) continue;
      if (!w.updatedAt) w.updatedAt = Date.now();
      saved.push(await upsertWord(pool, req.user.id, w));
    }
    return { ok: true, count: saved.length, words: saved };
  });

  app.get('/api/me/prefs', { preHandler: requireAuth }, async (req) => {
    const result = await pool.query(
      `SELECT custom_categories, practice, learning_streak, updated_at
       FROM user_prefs WHERE user_id = $1`,
      [req.user.id]
    );
    if (result.rowCount === 0) {
      return {
        ok: true,
        prefs: {
          customCategories: [],
          practice: null,
          learningStreak: {},
          updatedAt: 0,
        },
      };
    }
    const row = result.rows[0];
    return {
      ok: true,
      prefs: {
        customCategories: row.custom_categories || [],
        practice: row.practice,
        learningStreak: row.learning_streak || {},
        updatedAt: new Date(row.updated_at).getTime(),
      },
    };
  });

  app.put('/api/me/prefs', { preHandler: requireAuth }, async (req) => {
    const body = req.body || {};
    const customCategories = asJson(body.customCategories ?? body.custom_categories, []);
    const practice = body.practice !== undefined ? body.practice : null;
    const learningStreak = asJson(body.learningStreak ?? body.learning_streak, {});
    const result = await pool.query(
      `INSERT INTO user_prefs (user_id, custom_categories, practice, learning_streak, updated_at)
       VALUES ($1, $2::jsonb, $3::jsonb, $4::jsonb, NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         custom_categories = EXCLUDED.custom_categories,
         practice = EXCLUDED.practice,
         learning_streak = EXCLUDED.learning_streak,
         updated_at = NOW()
       RETURNING custom_categories, practice, learning_streak, updated_at`,
      [
        req.user.id,
        JSON.stringify(customCategories),
        JSON.stringify(practice),
        JSON.stringify(learningStreak),
      ]
    );
    const row = result.rows[0];
    return {
      ok: true,
      prefs: {
        customCategories: row.custom_categories || [],
        practice: row.practice,
        learningStreak: row.learning_streak || {},
        updatedAt: new Date(row.updated_at).getTime(),
      },
    };
  });

  // CloudBase CORS fallback: server pulls blob, client decrypts/merges
  app.post('/api/migrate/cloudbase-pull', { preHandler: requireAuth }, async (req, reply) => {
    const url = String(req.body?.url || '').replace(/\/$/, '');
    const username = sanitizeUsername(req.body?.username || req.user.username);
    const syncToken = String(req.body?.syncToken || '').trim();
    if (!url || !/^https?:\/\//i.test(url)) {
      return reply.code(400).send({ error: 'invalid_url' });
    }
    const headers = { Accept: 'application/json' };
    if (username) headers['X-Profile'] = username;
    if (syncToken) headers['X-Auth-Token'] = syncToken;
    try {
      const resp = await fetch(url + '/api/download', { headers });
      if (!resp.ok) {
        return reply.code(502).send({ error: 'cloudbase_pull_failed', status: resp.status });
      }
      const body = await resp.json().catch(() => ({}));
      const data = typeof body.data === 'string' ? body.data : '';
      return { ok: true, data };
    } catch (e) {
      console.error('cloudbase-pull', e);
      return reply.code(502).send({ error: 'cloudbase_pull_error' });
    }
  });

  // Legacy blob sync (transition)
  app.post('/api/words/sync', { preHandler: requireAuth }, async (req, reply) => {
    const data = req.body?.data;
    if (typeof data !== 'string' || !data.length) {
      return reply.code(400).send({ error: 'missing_data' });
    }
    if (data.length > 9_000_000) {
      return reply.code(413).send({ error: 'payload_too_large' });
    }

    await pool.query(
      `INSERT INTO user_sync (user_id, data, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (user_id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
      [req.user.id, data]
    );
    return { ok: true };
  });

  app.get('/api/words/sync', { preHandler: requireAuth }, async (req) => {
    const result = await pool.query(
      'SELECT data, updated_at FROM user_sync WHERE user_id = $1',
      [req.user.id]
    );
    if (result.rowCount === 0) return { ok: true, data: '' };
    const row = result.rows[0];
    return {
      ok: true,
      data: row.data,
      updatedAt: new Date(row.updated_at).getTime(),
    };
  });

  app.get('/api/youdao', async (req, reply) => {
    const q = String(req.query.q || '').trim();
    if (!q || q.length > 64) {
      return reply.code(400).send({ error: '需要 ?q=单词' });
    }

    const dicts = encodeURIComponent(
      JSON.stringify({
        count: 4,
        dicts: [['ec'], ['syno'], ['phrs'], ['rel_word']],
      })
    );
    const url =
      'https://dict.youdao.com/jsonapi?q=' +
      encodeURIComponent(q) +
      '&dicts=' +
      dicts;
    const yd = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!yd.ok) {
      return reply.code(502).send({ error: '有道上游失败：' + yd.status });
    }
    const data = await yd.json();
    return { ok: true, data };
  });

  app.setErrorHandler((error, _req, reply) => {
    console.error(error);
    if (!reply.sent) {
      reply.code(500).send({ error: 'server_error' });
    }
  });

  return app;
}

async function main() {
  const DATABASE_URL = process.env.DATABASE_URL;
  if (!DATABASE_URL) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  const pool = new Pool({ connectionString: DATABASE_URL });
  await ensureTables(pool);
  const app = await buildApp(pool, { logger: true });
  await app.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`ielts-api listening on :${PORT}`);
}

const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith('server.js') || process.argv[1].endsWith('server'));

if (isDirectRun) {
  main().catch((e) => {
    console.error('failed to start', e);
    process.exit(1);
  });
}
