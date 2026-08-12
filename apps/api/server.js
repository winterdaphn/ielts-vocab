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

/** Block SSRF when proxying user-supplied LLM base URLs. */
function isAllowedLlmUpstream(apiBase) {
  try {
    const u = new URL(String(apiBase || '').replace(/\/$/, '') + '/chat/completions');
    if (u.protocol !== 'https:') return false;
    const host = u.hostname.toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.local')) {
      return false;
    }
    if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
      const [a, b] = host.split('.').map(Number);
      if (a === 10) return false;
      if (a === 127) return false;
      if (a === 192 && b === 168) return false;
      if (a === 172 && b >= 16 && b <= 31) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function normalizeProxyApiKey(raw) {
  let key = String(raw || '').trim();
  if (/^bearer\s+/i.test(key)) key = key.replace(/^bearer\s+/i, '').trim();
  return key;
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

function sanitizeSynonymDiff(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const key = String(raw.key || '').trim();
  if (!key) return null;
  const summary = String(raw.summary || '').slice(0, 200);
  const itemsIn = Array.isArray(raw.items) ? raw.items : [];
  const items = [];
  for (const it of itemsIn) {
    if (!it || typeof it !== 'object') continue;
    const word = String(it.word || '').trim().toLowerCase().slice(0, 64);
    if (!word) continue;
    items.push({
      word,
      focus: String(it.focus || '').slice(0, 80),
      usage: String(it.usage || '').slice(0, 120),
    });
  }
  if (!summary && items.length === 0) return null;
  return { key, summary, items, contrasts: [] };
}

const SRS_TARGET_TYPES = new Set(['word', 'chunk', 'frame']);

/** Prefer joined srs_* columns when present; fall back to legacy words.* SRS columns. */
function rowToWord(row) {
  const synonymDiff = sanitizeSynonymDiff(row.synonym_diff);
  const hasSrs = row.s_ease != null || row.s_next_review != null || row.s_updated_at != null;
  const crossedOut = hasSrs ? !!row.s_crossed_out : !!row.crossed_out;
  const starred = hasSrs ? !!row.s_starred : !!row.starred;
  const ease = hasSrs ? Number(row.s_ease) || 2.5 : Number(row.ease) || 2.5;
  const interval = hasSrs
    ? Number(row.s_interval_days) || 0
    : Number(row.interval_days) || 0;
  const streak = hasSrs ? Number(row.s_streak) || 0 : Number(row.streak) || 0;
  const nextReview = hasSrs
    ? row.s_next_review
      ? new Date(row.s_next_review).getTime()
      : Date.now()
    : row.next_review
      ? new Date(row.next_review).getTime()
      : Date.now();
  const totalReviews = hasSrs
    ? Number(row.s_total_reviews) || 0
    : Number(row.total_reviews) || 0;
  const correctReviews = hasSrs
    ? Number(row.s_correct_reviews) || 0
    : Number(row.correct_reviews) || 0;
  const progressUpdatedAt = row.s_updated_at
    ? new Date(row.s_updated_at).getTime()
    : row.updated_at
      ? new Date(row.updated_at).getTime()
      : Date.now();
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
    ...(synonymDiff ? { synonymDiff } : {}),
    crossedOut,
    starred,
    ease,
    interval,
    streak,
    nextReview,
    totalReviews,
    correctReviews,
    createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
    /** Content row mtime — progress changes do not bump this */
    updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : Date.now(),
    progressUpdatedAt,
  };
}

function rowToSrs(row) {
  return {
    targetType: row.target_type,
    targetId: row.target_id,
    ease: Number(row.ease) || 2.5,
    interval: Number(row.interval_days) || 0,
    streak: Number(row.streak) || 0,
    nextReview: row.next_review ? new Date(row.next_review).getTime() : Date.now(),
    totalReviews: Number(row.total_reviews) || 0,
    correctReviews: Number(row.correct_reviews) || 0,
    starred: !!row.starred,
    crossedOut: !!row.crossed_out,
    updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : Date.now(),
  };
}

function normalizeSrsBody(body, targetType, targetId) {
  if (!body || typeof body !== 'object') return null;
  const type = String(targetType || body.targetType || body.target_type || '').trim();
  const id = String(targetId || body.targetId || body.target_id || '').trim();
  if (!SRS_TARGET_TYPES.has(type) || !id || id.length > 128) return null;
  return {
    targetType: type,
    targetId: id,
    ease: Number(body.ease ?? 2.5),
    intervalDays: Number(body.interval ?? body.interval_days ?? 0),
    streak: Number(body.streak ?? 0),
    nextReview: body.nextReview ?? body.next_review ?? Date.now(),
    totalReviews: Number(body.totalReviews ?? body.total_reviews ?? 0),
    correctReviews: Number(body.correctReviews ?? body.correct_reviews ?? 0),
    starred: !!(body.starred),
    crossedOut: !!(body.crossedOut ?? body.crossed_out),
    updatedAt: body.updatedAt ?? body.updated_at ?? Date.now(),
  };
}

async function upsertSrsProgress(pool, userId, p) {
  const nextReview =
    typeof p.nextReview === 'number' ? new Date(p.nextReview) : new Date(p.nextReview);
  const updatedAt =
    typeof p.updatedAt === 'number' ? new Date(p.updatedAt) : new Date(p.updatedAt);
  const result = await pool.query(
    `INSERT INTO srs_progress (
      user_id, target_type, target_id,
      ease, interval_days, streak, next_review,
      total_reviews, correct_reviews, starred, crossed_out, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
    ON CONFLICT (user_id, target_type, target_id) DO UPDATE SET
      ease = EXCLUDED.ease,
      interval_days = EXCLUDED.interval_days,
      streak = EXCLUDED.streak,
      next_review = EXCLUDED.next_review,
      total_reviews = EXCLUDED.total_reviews,
      correct_reviews = EXCLUDED.correct_reviews,
      starred = EXCLUDED.starred,
      crossed_out = EXCLUDED.crossed_out,
      updated_at = EXCLUDED.updated_at
    RETURNING *`,
    [
      userId,
      p.targetType,
      p.targetId,
      p.ease,
      p.intervalDays,
      p.streak,
      nextReview,
      p.totalReviews,
      p.correctReviews,
      p.starred,
      p.crossedOut,
      updatedAt,
    ]
  );
  return rowToSrs(result.rows[0]);
}

/** Partial update of srs_progress; only keys present in `fields`. */
async function patchSrsProgress(pool, userId, targetType, targetId, fields) {
  const clientUpdatedAt = Number(fields.updatedAt ?? fields.updated_at ?? 0);

  const existing = await pool.query(
    `SELECT * FROM srs_progress
     WHERE user_id = $1 AND target_type = $2 AND target_id = $3`,
    [userId, targetType, targetId]
  );
  if (existing.rowCount > 0) {
    const serverAt = new Date(existing.rows[0].updated_at).getTime();
    if (clientUpdatedAt > 0 && clientUpdatedAt < serverAt) {
      return rowToSrs(existing.rows[0]);
    }
  }

  const sets = [];
  const vals = [];
  let i = 1;
  function add(col, val) {
    sets.push(`${col} = $${i++}`);
    vals.push(val);
  }
  if (fields.ease !== undefined) add('ease', Number(fields.ease));
  if (fields.interval !== undefined || fields.interval_days !== undefined) {
    add('interval_days', Number(fields.interval ?? fields.interval_days));
  }
  if (fields.streak !== undefined) add('streak', Number(fields.streak));
  if (fields.nextReview !== undefined || fields.next_review !== undefined) {
    add('next_review', new Date(fields.nextReview ?? fields.next_review));
  }
  if (fields.totalReviews !== undefined || fields.total_reviews !== undefined) {
    add('total_reviews', Number(fields.totalReviews ?? fields.total_reviews));
  }
  if (fields.correctReviews !== undefined || fields.correct_reviews !== undefined) {
    add('correct_reviews', Number(fields.correctReviews ?? fields.correct_reviews));
  }
  if (fields.crossedOut !== undefined || fields.crossed_out !== undefined) {
    add('crossed_out', !!(fields.crossedOut ?? fields.crossed_out));
  }
  if (fields.starred !== undefined) add('starred', !!fields.starred);

  if (sets.length === 0) return null;

  add('updated_at', new Date(fields.updatedAt ?? fields.updated_at ?? Date.now()));
  vals.push(userId, targetType, targetId);

  const result = await pool.query(
    `UPDATE srs_progress SET ${sets.join(', ')}
     WHERE user_id = $${i++} AND target_type = $${i++} AND target_id = $${i}
     RETURNING *`,
    vals
  );
  if (result.rowCount > 0) return rowToSrs(result.rows[0]);

  // Missing row: upsert from patch fields + defaults
  return upsertSrsProgress(pool, userId, {
    targetType,
    targetId,
    ease: Number(fields.ease ?? 2.5),
    intervalDays: Number(fields.interval ?? fields.interval_days ?? 0),
    streak: Number(fields.streak ?? 0),
    nextReview: fields.nextReview ?? fields.next_review ?? Date.now(),
    totalReviews: Number(fields.totalReviews ?? fields.total_reviews ?? 0),
    correctReviews: Number(fields.correctReviews ?? fields.correct_reviews ?? 0),
    starred: !!(fields.starred),
    crossedOut: !!(fields.crossedOut ?? fields.crossed_out),
    updatedAt: fields.updatedAt ?? fields.updated_at ?? Date.now(),
  });
}

const WORDS_WITH_SRS_SELECT = `
  SELECT w.*,
    s.ease AS s_ease,
    s.interval_days AS s_interval_days,
    s.streak AS s_streak,
    s.next_review AS s_next_review,
    s.total_reviews AS s_total_reviews,
    s.correct_reviews AS s_correct_reviews,
    s.starred AS s_starred,
    s.crossed_out AS s_crossed_out,
    s.updated_at AS s_updated_at
  FROM words w
  LEFT JOIN srs_progress s
    ON s.user_id = w.user_id
   AND s.target_type = 'word'
   AND s.target_id = w.word_id
`;

async function fetchWordMerged(pool, userId, wordId) {
  const result = await pool.query(
    `${WORDS_WITH_SRS_SELECT}
     WHERE w.user_id = $1 AND w.word_id = $2`,
    [userId, wordId]
  );
  if (!result.rowCount) return null;
  return rowToWord(result.rows[0]);
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
    synonymDiff: sanitizeSynonymDiff(body.synonymDiff ?? body.synonym_diff),
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
      synonym_diff,
      crossed_out, starred, ease, interval_days, streak, next_review,
      total_reviews, correct_reviews, created_at, updated_at
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,
      $9::jsonb,$10::jsonb,$11::jsonb,$12::jsonb,$13::jsonb,$14::jsonb,$15::jsonb,
      $16::jsonb,
      $17,$18,$19,$20,$21,$22,
      $23,$24,$25,$26
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
      synonym_diff = EXCLUDED.synonym_diff,
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
      JSON.stringify(w.synonymDiff || null),
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
  // Canonical progress lives in srs_progress (words.* SRS columns kept dual-write for rollback)
  await upsertSrsProgress(pool, userId, {
    targetType: 'word',
    targetId: w.wordId,
    ease: w.ease,
    intervalDays: w.intervalDays,
    streak: w.streak,
    nextReview: w.nextReview,
    totalReviews: w.totalReviews,
    correctReviews: w.correctReviews,
    starred: w.starred,
    crossedOut: w.crossedOut,
    updatedAt: w.updatedAt,
  });
  return (await fetchWordMerged(pool, userId, w.wordId)) || rowToWord(result.rows[0]);
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
    ALTER TABLE words
    ADD COLUMN IF NOT EXISTS synonym_diff JSONB;
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS srs_progress (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      target_type TEXT NOT NULL
        CHECK (target_type IN ('word', 'chunk', 'frame')),
      target_id TEXT NOT NULL,
      ease DOUBLE PRECISION NOT NULL DEFAULT 2.5,
      interval_days DOUBLE PRECISION NOT NULL DEFAULT 0,
      streak INTEGER NOT NULL DEFAULT 0,
      next_review TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      total_reviews INTEGER NOT NULL DEFAULT 0,
      correct_reviews INTEGER NOT NULL DEFAULT 0,
      starred BOOLEAN NOT NULL DEFAULT FALSE,
      crossed_out BOOLEAN NOT NULL DEFAULT FALSE,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, target_type, target_id)
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS srs_progress_user_updated_idx
    ON srs_progress (user_id, updated_at);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS srs_progress_user_type_next_review_idx
    ON srs_progress (user_id, target_type, next_review);
  `);
  // One-time backfill from legacy words SRS columns (idempotent)
  await pool.query(`
    INSERT INTO srs_progress (
      user_id, target_type, target_id,
      ease, interval_days, streak, next_review,
      total_reviews, correct_reviews, starred, crossed_out, updated_at
    )
    SELECT
      user_id, 'word', word_id,
      ease, interval_days, streak, next_review,
      total_reviews, correct_reviews, starred, crossed_out, updated_at
    FROM words
    ON CONFLICT (user_id, target_type, target_id) DO NOTHING
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
  await pool.query(`
    CREATE TABLE IF NOT EXISTS practice_sessions (
      session_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'completed', 'abandoned')),
      mode TEXT NOT NULL,
      scope TEXT NOT NULL DEFAULT 'mixed',
      difficulty TEXT NOT NULL DEFAULT 'medium',
      idx INTEGER NOT NULL DEFAULT 0,
      stats JSONB NOT NULL DEFAULT '{"correct":0,"total":0}'::jsonb,
      ui_state JSONB NOT NULL DEFAULT '{}'::jsonb,
      revision INTEGER NOT NULL DEFAULT 1,
      client_updated_at BIGINT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS practice_sessions_one_active_per_user
    ON practice_sessions (user_id) WHERE status = 'active';
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS practice_session_items (
      session_id UUID NOT NULL REFERENCES practice_sessions(session_id) ON DELETE CASCADE,
      ordinal INTEGER NOT NULL,
      word_id TEXT NOT NULL,
      example JSONB,
      attempt JSONB,
      was_new BOOLEAN NOT NULL DEFAULT FALSE,
      client_updated_at BIGINT NOT NULL DEFAULT 0,
      PRIMARY KEY (session_id, ordinal)
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS chunks (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      chunk_id TEXT NOT NULL,
      phrase TEXT NOT NULL,
      phrase_key TEXT NOT NULL,
      gloss TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL DEFAULT 'collocation',
      tags JSONB NOT NULL DEFAULT '[]'::jsonb,
      anchor_word_id TEXT,
      source TEXT NOT NULL DEFAULT 'manual',
      example_en TEXT NOT NULL DEFAULT '',
      example_zh TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, chunk_id)
    );
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS chunks_user_phrase_key_idx
      ON chunks (user_id, phrase_key);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS chunks_user_updated_idx
      ON chunks (user_id, updated_at);
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS frames (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      frame_id TEXT NOT NULL,
      title TEXT NOT NULL,
      frame_key TEXT NOT NULL,
      skeleton TEXT NOT NULL DEFAULT '',
      slots JSONB NOT NULL DEFAULT '[]'::jsonb,
      gloss_zh TEXT NOT NULL DEFAULT '',
      anchor_word_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
      example_filled TEXT NOT NULL DEFAULT '',
      pack_id TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'manual',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, frame_id)
    );
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS frames_user_frame_key_idx
      ON frames (user_id, frame_key);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS frames_user_updated_idx
      ON frames (user_id, updated_at);
  `);
}

function normalizePhraseKey(phrase) {
  return String(phrase || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function rowToChunk(row) {
  return {
    id: row.chunk_id,
    phrase: row.phrase || '',
    phraseKey: row.phrase_key || '',
    gloss: row.gloss || '',
    kind: row.kind || 'collocation',
    tags: row.tags || [],
    anchorWordId: row.anchor_word_id || undefined,
    source: row.source || 'manual',
    exampleEn: row.example_en || '',
    exampleZh: row.example_zh || '',
    createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
    updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : Date.now(),
  };
}

function normalizeChunkBody(body, chunkIdParam) {
  if (!body || typeof body !== 'object') return null;
  const phrase = String(body.phrase || '').trim();
  const chunkId = String(body.id || chunkIdParam || '').trim();
  if (!chunkId || chunkId.length > 128 || !phrase) return null;
  const phraseKey = normalizePhraseKey(body.phraseKey || body.phrase_key || phrase);
  return {
    chunkId,
    phrase,
    phraseKey,
    gloss: String(body.gloss || ''),
    kind: String(body.kind || 'collocation'),
    tags: asJson(body.tags, []),
    anchorWordId: body.anchorWordId || body.anchor_word_id || null,
    source: String(body.source || 'manual'),
    exampleEn: String(body.exampleEn || body.example_en || ''),
    exampleZh: String(body.exampleZh || body.example_zh || ''),
    createdAt: body.createdAt ?? body.created_at ?? Date.now(),
    updatedAt: body.updatedAt ?? body.updated_at ?? Date.now(),
  };
}

async function upsertChunk(pool, userId, c) {
  const createdAt =
    typeof c.createdAt === 'number' ? new Date(c.createdAt) : new Date(c.createdAt);
  const updatedAt =
    typeof c.updatedAt === 'number' ? new Date(c.updatedAt) : new Date(c.updatedAt);
  const result = await pool.query(
    `INSERT INTO chunks (
      user_id, chunk_id, phrase, phrase_key, gloss, kind, tags,
      anchor_word_id, source, example_en, example_zh, created_at, updated_at
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12,$13
    )
    ON CONFLICT (user_id, chunk_id) DO UPDATE SET
      phrase = EXCLUDED.phrase,
      phrase_key = EXCLUDED.phrase_key,
      gloss = EXCLUDED.gloss,
      kind = EXCLUDED.kind,
      tags = EXCLUDED.tags,
      anchor_word_id = EXCLUDED.anchor_word_id,
      source = EXCLUDED.source,
      example_en = EXCLUDED.example_en,
      example_zh = EXCLUDED.example_zh,
      updated_at = EXCLUDED.updated_at
    RETURNING *`,
    [
      userId,
      c.chunkId,
      c.phrase,
      c.phraseKey,
      c.gloss,
      c.kind,
      JSON.stringify(c.tags || []),
      c.anchorWordId,
      c.source,
      c.exampleEn,
      c.exampleZh,
      createdAt,
      updatedAt,
    ]
  );
  // Ensure SRS row exists (do not reset progress on content upsert)
  await pool.query(
    `INSERT INTO srs_progress (
      user_id, target_type, target_id, ease, interval_days, streak, next_review,
      total_reviews, correct_reviews, starred, crossed_out, updated_at
    ) VALUES ($1,'chunk',$2,2.5,0,0,NOW(),0,0,FALSE,FALSE,NOW())
    ON CONFLICT (user_id, target_type, target_id) DO NOTHING`,
    [userId, c.chunkId]
  );
  return rowToChunk(result.rows[0]);
}

function rowToFrame(row) {
  return {
    id: row.frame_id,
    title: row.title || '',
    frameKey: row.frame_key || '',
    skeleton: row.skeleton || '',
    slots: row.slots || [],
    glossZh: row.gloss_zh || '',
    anchorWordIds: row.anchor_word_ids || [],
    exampleFilled: row.example_filled || '',
    packId: row.pack_id || '',
    source: row.source || 'manual',
    createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
    updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : Date.now(),
  };
}

function normalizeFrameBody(body, frameIdParam) {
  if (!body || typeof body !== 'object') return null;
  const title = String(body.title || '').trim();
  const skeleton = String(body.skeleton || '').trim();
  const frameId = String(body.id || frameIdParam || '').trim();
  if (!frameId || frameId.length > 128 || !title) return null;
  const frameKey = normalizePhraseKey(
    body.frameKey || body.frame_key || skeleton || title
  );
  return {
    frameId,
    title,
    frameKey,
    skeleton,
    slots: asJson(body.slots, []),
    glossZh: String(body.glossZh || body.gloss_zh || ''),
    anchorWordIds: asJson(body.anchorWordIds ?? body.anchor_word_ids, []),
    exampleFilled: String(body.exampleFilled || body.example_filled || ''),
    packId: String(body.packId || body.pack_id || ''),
    source: String(body.source || 'manual'),
    createdAt: body.createdAt ?? body.created_at ?? Date.now(),
    updatedAt: body.updatedAt ?? body.updated_at ?? Date.now(),
  };
}

async function upsertFrame(pool, userId, f) {
  const createdAt =
    typeof f.createdAt === 'number' ? new Date(f.createdAt) : new Date(f.createdAt);
  const updatedAt =
    typeof f.updatedAt === 'number' ? new Date(f.updatedAt) : new Date(f.updatedAt);
  const result = await pool.query(
    `INSERT INTO frames (
      user_id, frame_id, title, frame_key, skeleton, slots, gloss_zh,
      anchor_word_ids, example_filled, pack_id, source, created_at, updated_at
    ) VALUES (
      $1,$2,$3,$4,$5,$6::jsonb,$7,$8::jsonb,$9,$10,$11,$12,$13
    )
    ON CONFLICT (user_id, frame_id) DO UPDATE SET
      title = EXCLUDED.title,
      frame_key = EXCLUDED.frame_key,
      skeleton = EXCLUDED.skeleton,
      slots = EXCLUDED.slots,
      gloss_zh = EXCLUDED.gloss_zh,
      anchor_word_ids = EXCLUDED.anchor_word_ids,
      example_filled = EXCLUDED.example_filled,
      pack_id = EXCLUDED.pack_id,
      source = EXCLUDED.source,
      updated_at = EXCLUDED.updated_at
    RETURNING *`,
    [
      userId,
      f.frameId,
      f.title,
      f.frameKey,
      f.skeleton,
      JSON.stringify(f.slots || []),
      f.glossZh,
      JSON.stringify(f.anchorWordIds || []),
      f.exampleFilled,
      f.packId,
      f.source,
      createdAt,
      updatedAt,
    ]
  );
  await pool.query(
    `INSERT INTO srs_progress (
      user_id, target_type, target_id, ease, interval_days, streak, next_review,
      total_reviews, correct_reviews, starred, crossed_out, updated_at
    ) VALUES ($1,'frame',$2,2.5,0,0,NOW(),0,0,FALSE,FALSE,NOW())
    ON CONFLICT (user_id, target_type, target_id) DO NOTHING`,
    [userId, f.frameId]
  );
  return rowToFrame(result.rows[0]);
}

/** Generic incremental list helper for content tables with updated_at + id. */
async function listContentRows(pool, {
  userId,
  table,
  idCol,
  since,
  limit,
  cursor,
}) {
  let result;
  if (since) {
    let cursorAt = null;
    let cursorId = '';
    if (cursor.includes(':')) {
      const idx = cursor.indexOf(':');
      const ms = Number(cursor.slice(0, idx));
      cursorId = cursor.slice(idx + 1);
      if (Number.isFinite(ms) && ms > 0) cursorAt = new Date(ms);
    }
    if (limit && cursorAt && cursorId) {
      result = await pool.query(
        `SELECT * FROM ${table}
         WHERE user_id = $1
           AND (updated_at > $2 OR (updated_at = $2 AND ${idCol} > $3))
         ORDER BY updated_at ASC, ${idCol} ASC
         LIMIT $4`,
        [userId, cursorAt, cursorId, limit]
      );
    } else if (limit) {
      result = await pool.query(
        `SELECT * FROM ${table}
         WHERE user_id = $1 AND updated_at > $2
         ORDER BY updated_at ASC, ${idCol} ASC
         LIMIT $3`,
        [userId, since, limit]
      );
    } else {
      result = await pool.query(
        `SELECT * FROM ${table}
         WHERE user_id = $1 AND updated_at > $2
         ORDER BY updated_at ASC, ${idCol} ASC`,
        [userId, since]
      );
    }
  } else if (limit) {
    if (cursor) {
      result = await pool.query(
        `SELECT * FROM ${table}
         WHERE user_id = $1 AND ${idCol} > $2
         ORDER BY ${idCol} ASC LIMIT $3`,
        [userId, cursor, limit]
      );
    } else {
      result = await pool.query(
        `SELECT * FROM ${table}
         WHERE user_id = $1 ORDER BY ${idCol} ASC LIMIT $2`,
        [userId, limit]
      );
    }
  } else {
    result = await pool.query(
      `SELECT * FROM ${table} WHERE user_id = $1 ORDER BY ${idCol} ASC`,
      [userId]
    );
  }
  return result.rows;
}

export async function buildApp(pool, { logger = false } = {}) {
  const app = Fastify({
    logger,
    bodyLimit: 10 * 1024 * 1024,
  });

  await app.register(cors, { origin: corsOrigin() });

  // Allow POST with Content-Type: application/json and empty body (complete / abandon)
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    try {
      if (!body || String(body).trim() === '') {
        done(null, {});
        return;
      }
      done(null, JSON.parse(body));
    } catch (err) {
      done(err, undefined);
    }
  });

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
    const limitRaw = Number(req.query?.limit);
    const limit =
      Number.isFinite(limitRaw) && limitRaw > 0
        ? Math.min(Math.floor(limitRaw), 2000)
        : null;
    const cursor = String(req.query?.cursor || '').trim();

    let result;
    if (since) {
      // cursor format for incremental: `${updatedAtMs}:${wordId}`
      // since tracks content mtime only — progress-only edits use GET /api/srs
      let cursorAt = null;
      let cursorId = '';
      if (cursor.includes(':')) {
        const idx = cursor.indexOf(':');
        const ms = Number(cursor.slice(0, idx));
        cursorId = cursor.slice(idx + 1);
        if (Number.isFinite(ms) && ms > 0) cursorAt = new Date(ms);
      }
      if (limit && cursorAt && cursorId) {
        result = await pool.query(
          `${WORDS_WITH_SRS_SELECT}
           WHERE w.user_id = $1
             AND (
               w.updated_at > $2
               OR (w.updated_at = $2 AND w.word_id > $3)
             )
           ORDER BY w.updated_at ASC, w.word_id ASC
           LIMIT $4`,
          [req.user.id, cursorAt, cursorId, limit]
        );
      } else if (limit) {
        result = await pool.query(
          `${WORDS_WITH_SRS_SELECT}
           WHERE w.user_id = $1 AND w.updated_at > $2
           ORDER BY w.updated_at ASC, w.word_id ASC
           LIMIT $3`,
          [req.user.id, since, limit]
        );
      } else {
        result = await pool.query(
          `${WORDS_WITH_SRS_SELECT}
           WHERE w.user_id = $1 AND w.updated_at > $2
           ORDER BY w.updated_at ASC, w.word_id ASC`,
          [req.user.id, since]
        );
      }
    } else if (limit) {
      if (cursor) {
        result = await pool.query(
          `${WORDS_WITH_SRS_SELECT}
           WHERE w.user_id = $1 AND w.word_id > $2
           ORDER BY w.word_id ASC LIMIT $3`,
          [req.user.id, cursor, limit]
        );
      } else {
        result = await pool.query(
          `${WORDS_WITH_SRS_SELECT}
           WHERE w.user_id = $1
           ORDER BY w.word_id ASC LIMIT $2`,
          [req.user.id, limit]
        );
      }
    } else {
      result = await pool.query(
        `${WORDS_WITH_SRS_SELECT}
         WHERE w.user_id = $1
         ORDER BY w.word_id ASC`,
        [req.user.id]
      );
    }
    const words = result.rows.map(rowToWord);
    const maxUpdated = words.reduce((m, w) => Math.max(m, w.updatedAt || 0), 0);
    let nextCursor = null;
    if (limit && words.length === limit) {
      const last = words[words.length - 1];
      nextCursor = since
        ? `${last.updatedAt || 0}:${last.id}`
        : last.id;
    }
    return {
      ok: true,
      words,
      nextCursor,
      serverTime: Date.now(),
      since: since ? since.getTime() : null,
      maxUpdatedAt: maxUpdated || Date.now(),
    };
  });

  app.put('/api/words/:wordId', { preHandler: requireAuth }, async (req, reply) => {
    const wordId = String(req.params.wordId || '').trim();
    const w = normalizeWordBody(req.body, wordId);
    if (!w) return reply.code(400).send({ error: 'invalid_word' });
    w.updatedAt = Date.now();
    const saved = await upsertWord(pool, req.user.id, w);
    return { ok: true, word: saved };
  });

  /** Field-level patch: content → words; progress → srs_progress (no words.updated_at bump). */
  app.patch('/api/words/:wordId', { preHandler: requireAuth }, async (req, reply) => {
    const wordId = String(req.params.wordId || '').trim();
    if (!wordId) return reply.code(400).send({ error: 'invalid_wordId' });
    const body = req.body || {};
    const sets = [];
    const vals = [];
    let i = 1;
    let contentTouched = false;
    const progressFields = {};

    function add(col, val) {
      sets.push(`${col} = $${i++}`);
      vals.push(val);
      contentTouched = true;
    }

    if (body.word !== undefined) add('word', String(body.word));
    if (body.translation !== undefined) add('translation', String(body.translation || ''));
    if (body.phoneticUs !== undefined || body.phonetic_us !== undefined) {
      add('phonetic_us', String(body.phoneticUs ?? body.phonetic_us ?? ''));
    }
    if (body.phoneticUk !== undefined || body.phonetic_uk !== undefined) {
      add('phonetic_uk', String(body.phoneticUk ?? body.phonetic_uk ?? ''));
    }
    if (body.partOfSpeech !== undefined || body.pos !== undefined) {
      add('pos', String(body.partOfSpeech ?? body.pos ?? ''));
    }
    if (body.mnemonic !== undefined) add('mnemonic', String(body.mnemonic || ''));
    if (body.category !== undefined || body.categories !== undefined) {
      add('categories', JSON.stringify(body.category ?? body.categories ?? []));
    }
    if (body.synonyms !== undefined) add('synonyms', JSON.stringify(body.synonyms || []));
    if (body.similars !== undefined) add('similars', JSON.stringify(body.similars || []));
    if (body.derivatives !== undefined) {
      add('derivatives', JSON.stringify(body.derivatives || []));
    }
    if (body.collocations !== undefined) {
      add('collocations', JSON.stringify(body.collocations || []));
    }
    if (body.dictCollocations !== undefined || body.dict_collocations !== undefined) {
      add(
        'dict_collocations',
        JSON.stringify(body.dictCollocations ?? body.dict_collocations ?? [])
      );
    }
    if (body.examples !== undefined) add('examples', JSON.stringify(body.examples || []));
    if (body.synonymDiff !== undefined || body.synonym_diff !== undefined) {
      add(
        'synonym_diff',
        JSON.stringify(
          sanitizeSynonymDiff(body.synonymDiff ?? body.synonym_diff) || null
        )
      );
    }

    if (body.ease !== undefined) progressFields.ease = body.ease;
    if (body.interval !== undefined || body.interval_days !== undefined) {
      progressFields.interval = body.interval ?? body.interval_days;
    }
    if (body.streak !== undefined) progressFields.streak = body.streak;
    if (body.nextReview !== undefined || body.next_review !== undefined) {
      progressFields.nextReview = body.nextReview ?? body.next_review;
    }
    if (body.totalReviews !== undefined || body.total_reviews !== undefined) {
      progressFields.totalReviews = body.totalReviews ?? body.total_reviews;
    }
    if (body.correctReviews !== undefined || body.correct_reviews !== undefined) {
      progressFields.correctReviews = body.correctReviews ?? body.correct_reviews;
    }
    if (body.crossedOut !== undefined || body.crossed_out !== undefined) {
      progressFields.crossedOut = body.crossedOut ?? body.crossed_out;
    }
    if (body.starred !== undefined) progressFields.starred = body.starred;
    if (body.updatedAt !== undefined || body.updated_at !== undefined) {
      progressFields.updatedAt = body.updatedAt ?? body.updated_at;
    }

    const progressTouched = Object.keys(progressFields).some(
      (k) => k !== 'updatedAt'
    );

    if (!contentTouched && !progressTouched) {
      return reply.code(400).send({ error: 'empty_patch' });
    }

    let contentUpdatedAt = null;
    let progressUpdatedAt = null;

    if (contentTouched) {
      add('updated_at', new Date());
      vals.push(req.user.id, wordId);
      const result = await pool.query(
        `UPDATE words SET ${sets.join(', ')}
         WHERE user_id = $${i++} AND word_id = $${i}
         RETURNING updated_at`,
        vals
      );
      if (result.rowCount === 0) {
        return reply.code(404).send({ error: 'word_not_found' });
      }
      contentUpdatedAt = new Date(result.rows[0].updated_at).getTime();
    } else {
      const exists = await pool.query(
        `SELECT 1 FROM words WHERE user_id = $1 AND word_id = $2`,
        [req.user.id, wordId]
      );
      if (exists.rowCount === 0) {
        return reply.code(404).send({ error: 'word_not_found' });
      }
    }

    if (progressTouched) {
      const srs = await patchSrsProgress(pool, req.user.id, 'word', wordId, progressFields);
      progressUpdatedAt = srs?.updatedAt ?? null;
    }

    return {
      ok: true,
      wordId,
      ...(contentUpdatedAt != null ? { updatedAt: contentUpdatedAt } : {}),
      ...(progressUpdatedAt != null ? { progressUpdatedAt } : {}),
    };
  });

  app.patch('/api/words/:wordId/progress', { preHandler: requireAuth }, async (req, reply) => {
    // Backward-compatible — writes srs_progress only (does not bump words.updated_at).
    const wordId = String(req.params.wordId || '').trim();
    if (!wordId) return reply.code(400).send({ error: 'invalid_wordId' });
    const body = req.body || {};
    const exists = await pool.query(
      `SELECT 1 FROM words WHERE user_id = $1 AND word_id = $2`,
      [req.user.id, wordId]
    );
    if (exists.rowCount === 0) {
      return reply.code(404).send({ error: 'word_not_found' });
    }
    const progressFields = {};
    if (body.ease !== undefined) progressFields.ease = body.ease;
    if (body.interval !== undefined || body.interval_days !== undefined) {
      progressFields.interval = body.interval ?? body.interval_days;
    }
    if (body.streak !== undefined) progressFields.streak = body.streak;
    if (body.nextReview !== undefined || body.next_review !== undefined) {
      progressFields.nextReview = body.nextReview ?? body.next_review;
    }
    if (body.totalReviews !== undefined || body.total_reviews !== undefined) {
      progressFields.totalReviews = body.totalReviews ?? body.total_reviews;
    }
    if (body.correctReviews !== undefined || body.correct_reviews !== undefined) {
      progressFields.correctReviews = body.correctReviews ?? body.correct_reviews;
    }
    if (body.crossedOut !== undefined || body.crossed_out !== undefined) {
      progressFields.crossedOut = body.crossedOut ?? body.crossed_out;
    }
    if (body.starred !== undefined) progressFields.starred = body.starred;
    if (body.updatedAt !== undefined || body.updated_at !== undefined) {
      progressFields.updatedAt = body.updatedAt ?? body.updated_at;
    }
    if (Object.keys(progressFields).filter((k) => k !== 'updatedAt').length === 0) {
      return reply.code(400).send({ error: 'empty_patch' });
    }
    const srs = await patchSrsProgress(pool, req.user.id, 'word', wordId, progressFields);
    return {
      ok: true,
      wordId,
      ...(srs?.updatedAt != null ? { progressUpdatedAt: srs.updatedAt } : {}),
    };
  });

  app.delete('/api/words/:wordId', { preHandler: requireAuth }, async (req, reply) => {
    const wordId = String(req.params.wordId || '').trim();
    const result = await pool.query(
      `DELETE FROM words WHERE user_id = $1 AND word_id = $2`,
      [req.user.id, wordId]
    );
    if (result.rowCount === 0) return reply.code(404).send({ error: 'word_not_found' });
    await pool.query(
      `DELETE FROM srs_progress
       WHERE user_id = $1 AND target_type = 'word' AND target_id = $2`,
      [req.user.id, wordId]
    );
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

  // --- Unified SRS progress (word / chunk / frame) ---

  app.get('/api/srs', { preHandler: requireAuth }, async (req) => {
    const since = parseSince(req.query?.since);
    const limitRaw = Number(req.query?.limit);
    const limit =
      Number.isFinite(limitRaw) && limitRaw > 0
        ? Math.min(Math.floor(limitRaw), 2000)
        : null;
    const cursor = String(req.query?.cursor || '').trim();
    const targetType = String(req.query?.targetType || req.query?.target_type || '').trim();
    const typeFilter = SRS_TARGET_TYPES.has(targetType) ? targetType : null;

    let result;
    if (since) {
      let cursorAt = null;
      let cursorType = '';
      let cursorId = '';
      // cursor: `${updatedAtMs}:${targetType}:${targetId}`
      const parts = cursor.split(':');
      if (parts.length >= 3) {
        const ms = Number(parts[0]);
        cursorType = parts[1];
        cursorId = parts.slice(2).join(':');
        if (Number.isFinite(ms) && ms > 0) cursorAt = new Date(ms);
      }
      if (limit && cursorAt && cursorType && cursorId) {
        result = await pool.query(
          `SELECT * FROM srs_progress
           WHERE user_id = $1
             AND ($2::text IS NULL OR target_type = $2)
             AND (
               updated_at > $3
               OR (updated_at = $3 AND (target_type > $4 OR (target_type = $4 AND target_id > $5)))
             )
           ORDER BY updated_at ASC, target_type ASC, target_id ASC
           LIMIT $6`,
          [req.user.id, typeFilter, cursorAt, cursorType, cursorId, limit]
        );
      } else if (limit) {
        result = await pool.query(
          `SELECT * FROM srs_progress
           WHERE user_id = $1
             AND ($2::text IS NULL OR target_type = $2)
             AND updated_at > $3
           ORDER BY updated_at ASC, target_type ASC, target_id ASC
           LIMIT $4`,
          [req.user.id, typeFilter, since, limit]
        );
      } else {
        result = await pool.query(
          `SELECT * FROM srs_progress
           WHERE user_id = $1
             AND ($2::text IS NULL OR target_type = $2)
             AND updated_at > $3
           ORDER BY updated_at ASC, target_type ASC, target_id ASC`,
          [req.user.id, typeFilter, since]
        );
      }
    } else if (limit) {
      if (cursor.includes(':')) {
        const idx = cursor.indexOf(':');
        const cType = cursor.slice(0, idx);
        const cId = cursor.slice(idx + 1);
        result = await pool.query(
          `SELECT * FROM srs_progress
           WHERE user_id = $1
             AND ($2::text IS NULL OR target_type = $2)
             AND (target_type > $3 OR (target_type = $3 AND target_id > $4))
           ORDER BY target_type ASC, target_id ASC
           LIMIT $5`,
          [req.user.id, typeFilter, cType, cId, limit]
        );
      } else {
        result = await pool.query(
          `SELECT * FROM srs_progress
           WHERE user_id = $1
             AND ($2::text IS NULL OR target_type = $2)
           ORDER BY target_type ASC, target_id ASC
           LIMIT $3`,
          [req.user.id, typeFilter, limit]
        );
      }
    } else {
      result = await pool.query(
        `SELECT * FROM srs_progress
         WHERE user_id = $1
           AND ($2::text IS NULL OR target_type = $2)
         ORDER BY target_type ASC, target_id ASC`,
        [req.user.id, typeFilter]
      );
    }

    const items = result.rows.map(rowToSrs);
    const maxUpdated = items.reduce((m, x) => Math.max(m, x.updatedAt || 0), 0);
    let nextCursor = null;
    if (limit && items.length === limit) {
      const last = items[items.length - 1];
      nextCursor = since
        ? `${last.updatedAt || 0}:${last.targetType}:${last.targetId}`
        : `${last.targetType}:${last.targetId}`;
    }
    return {
      ok: true,
      items,
      nextCursor,
      serverTime: Date.now(),
      since: since ? since.getTime() : null,
      maxUpdatedAt: maxUpdated || Date.now(),
    };
  });

  app.put('/api/srs/:targetType/:targetId', { preHandler: requireAuth }, async (req, reply) => {
    const targetType = String(req.params.targetType || '').trim();
    const targetId = String(req.params.targetId || '').trim();
    const p = normalizeSrsBody(req.body, targetType, targetId);
    if (!p) return reply.code(400).send({ error: 'invalid_srs' });
    p.updatedAt = Date.now();
    const saved = await upsertSrsProgress(pool, req.user.id, p);
    return { ok: true, item: saved };
  });

  app.patch('/api/srs/:targetType/:targetId', { preHandler: requireAuth }, async (req, reply) => {
    const targetType = String(req.params.targetType || '').trim();
    const targetId = String(req.params.targetId || '').trim();
    if (!SRS_TARGET_TYPES.has(targetType) || !targetId) {
      return reply.code(400).send({ error: 'invalid_srs' });
    }
    const body = req.body || {};
    const saved = await patchSrsProgress(pool, req.user.id, targetType, targetId, body);
    if (!saved) return reply.code(400).send({ error: 'empty_patch' });
    return { ok: true, item: saved };
  });

  app.delete('/api/srs/:targetType/:targetId', { preHandler: requireAuth }, async (req, reply) => {
    const targetType = String(req.params.targetType || '').trim();
    const targetId = String(req.params.targetId || '').trim();
    if (!SRS_TARGET_TYPES.has(targetType) || !targetId) {
      return reply.code(400).send({ error: 'invalid_srs' });
    }
    const result = await pool.query(
      `DELETE FROM srs_progress
       WHERE user_id = $1 AND target_type = $2 AND target_id = $3`,
      [req.user.id, targetType, targetId]
    );
    if (result.rowCount === 0) return reply.code(404).send({ error: 'srs_not_found' });
    return { ok: true };
  });

  // --- Chunks (content) ---

  app.get('/api/chunks', { preHandler: requireAuth }, async (req) => {
    const since = parseSince(req.query?.since);
    const limitRaw = Number(req.query?.limit);
    const limit =
      Number.isFinite(limitRaw) && limitRaw > 0
        ? Math.min(Math.floor(limitRaw), 2000)
        : null;
    const cursor = String(req.query?.cursor || '').trim();
    const rows = await listContentRows(pool, {
      userId: req.user.id,
      table: 'chunks',
      idCol: 'chunk_id',
      since,
      limit,
      cursor,
    });
    const chunks = rows.map(rowToChunk);
    const maxUpdated = chunks.reduce((m, c) => Math.max(m, c.updatedAt || 0), 0);
    let nextCursor = null;
    if (limit && chunks.length === limit) {
      const last = chunks[chunks.length - 1];
      nextCursor = since ? `${last.updatedAt || 0}:${last.id}` : last.id;
    }
    return {
      ok: true,
      chunks,
      nextCursor,
      serverTime: Date.now(),
      since: since ? since.getTime() : null,
      maxUpdatedAt: maxUpdated || Date.now(),
    };
  });

  app.put('/api/chunks/:chunkId', { preHandler: requireAuth }, async (req, reply) => {
    const chunkId = String(req.params.chunkId || '').trim();
    const c = normalizeChunkBody(req.body, chunkId);
    if (!c) return reply.code(400).send({ error: 'invalid_chunk' });
    c.updatedAt = Date.now();
    try {
      const saved = await upsertChunk(pool, req.user.id, c);
      return { ok: true, chunk: saved };
    } catch (e) {
      if (String(e?.code) === '23505') {
        return reply.code(409).send({ error: 'phrase_key_taken' });
      }
      throw e;
    }
  });

  app.patch('/api/chunks/:chunkId', { preHandler: requireAuth }, async (req, reply) => {
    const chunkId = String(req.params.chunkId || '').trim();
    if (!chunkId) return reply.code(400).send({ error: 'invalid_chunkId' });
    const body = req.body || {};
    const sets = [];
    const vals = [];
    let i = 1;
    function add(col, val) {
      sets.push(`${col} = $${i++}`);
      vals.push(val);
    }
    if (body.phrase !== undefined) {
      add('phrase', String(body.phrase));
      add('phrase_key', normalizePhraseKey(body.phraseKey || body.phrase_key || body.phrase));
    } else if (body.phraseKey !== undefined || body.phrase_key !== undefined) {
      add('phrase_key', normalizePhraseKey(body.phraseKey ?? body.phrase_key));
    }
    if (body.gloss !== undefined) add('gloss', String(body.gloss || ''));
    if (body.kind !== undefined) add('kind', String(body.kind || 'collocation'));
    if (body.tags !== undefined) add('tags', JSON.stringify(body.tags || []));
    if (body.anchorWordId !== undefined || body.anchor_word_id !== undefined) {
      add('anchor_word_id', (body.anchorWordId ?? body.anchor_word_id) || null);
    }
    if (body.source !== undefined) add('source', String(body.source || 'manual'));
    if (body.exampleEn !== undefined || body.example_en !== undefined) {
      add('example_en', String(body.exampleEn ?? body.example_en ?? ''));
    }
    if (body.exampleZh !== undefined || body.example_zh !== undefined) {
      add('example_zh', String(body.exampleZh ?? body.example_zh ?? ''));
    }
    if (sets.length === 0) return reply.code(400).send({ error: 'empty_patch' });
    add('updated_at', new Date());
    vals.push(req.user.id, chunkId);
    try {
      const result = await pool.query(
        `UPDATE chunks SET ${sets.join(', ')}
         WHERE user_id = $${i++} AND chunk_id = $${i}
         RETURNING *`,
        vals
      );
      if (result.rowCount === 0) return reply.code(404).send({ error: 'chunk_not_found' });
      return { ok: true, chunk: rowToChunk(result.rows[0]) };
    } catch (e) {
      if (String(e?.code) === '23505') {
        return reply.code(409).send({ error: 'phrase_key_taken' });
      }
      throw e;
    }
  });

  app.delete('/api/chunks/:chunkId', { preHandler: requireAuth }, async (req, reply) => {
    const chunkId = String(req.params.chunkId || '').trim();
    const result = await pool.query(
      `DELETE FROM chunks WHERE user_id = $1 AND chunk_id = $2`,
      [req.user.id, chunkId]
    );
    if (result.rowCount === 0) return reply.code(404).send({ error: 'chunk_not_found' });
    await pool.query(
      `DELETE FROM srs_progress
       WHERE user_id = $1 AND target_type = 'chunk' AND target_id = $2`,
      [req.user.id, chunkId]
    );
    return { ok: true };
  });

  app.post('/api/chunks/batch', { preHandler: requireAuth }, async (req, reply) => {
    const list = Array.isArray(req.body?.chunks) ? req.body.chunks : null;
    if (!list) return reply.code(400).send({ error: 'missing_chunks' });
    if (list.length > BATCH_MAX) {
      return reply.code(413).send({ error: 'batch_too_large', max: BATCH_MAX });
    }
    const saved = [];
    for (const item of list) {
      const c = normalizeChunkBody(item, item?.id);
      if (!c) continue;
      if (!c.updatedAt) c.updatedAt = Date.now();
      saved.push(await upsertChunk(pool, req.user.id, c));
    }
    return { ok: true, count: saved.length, chunks: saved };
  });

  // --- Frames (content, Phase 2) ---

  app.get('/api/frames', { preHandler: requireAuth }, async (req) => {
    const since = parseSince(req.query?.since);
    const limitRaw = Number(req.query?.limit);
    const limit =
      Number.isFinite(limitRaw) && limitRaw > 0
        ? Math.min(Math.floor(limitRaw), 2000)
        : null;
    const cursor = String(req.query?.cursor || '').trim();
    const rows = await listContentRows(pool, {
      userId: req.user.id,
      table: 'frames',
      idCol: 'frame_id',
      since,
      limit,
      cursor,
    });
    const frames = rows.map(rowToFrame);
    const maxUpdated = frames.reduce((m, f) => Math.max(m, f.updatedAt || 0), 0);
    let nextCursor = null;
    if (limit && frames.length === limit) {
      const last = frames[frames.length - 1];
      nextCursor = since ? `${last.updatedAt || 0}:${last.id}` : last.id;
    }
    return {
      ok: true,
      frames,
      nextCursor,
      serverTime: Date.now(),
      since: since ? since.getTime() : null,
      maxUpdatedAt: maxUpdated || Date.now(),
    };
  });

  app.put('/api/frames/:frameId', { preHandler: requireAuth }, async (req, reply) => {
    const frameId = String(req.params.frameId || '').trim();
    const f = normalizeFrameBody(req.body, frameId);
    if (!f) return reply.code(400).send({ error: 'invalid_frame' });
    f.updatedAt = Date.now();
    try {
      const saved = await upsertFrame(pool, req.user.id, f);
      return { ok: true, frame: saved };
    } catch (e) {
      if (String(e?.code) === '23505') {
        return reply.code(409).send({ error: 'frame_key_taken' });
      }
      throw e;
    }
  });

  app.patch('/api/frames/:frameId', { preHandler: requireAuth }, async (req, reply) => {
    const frameId = String(req.params.frameId || '').trim();
    if (!frameId) return reply.code(400).send({ error: 'invalid_frameId' });
    const body = req.body || {};
    const sets = [];
    const vals = [];
    let i = 1;
    function add(col, val) {
      sets.push(`${col} = $${i++}`);
      vals.push(val);
    }
    if (body.title !== undefined) add('title', String(body.title));
    if (body.skeleton !== undefined) {
      add('skeleton', String(body.skeleton || ''));
      if (body.frameKey === undefined && body.frame_key === undefined) {
        add('frame_key', normalizePhraseKey(body.skeleton || body.title || ''));
      }
    }
    if (body.frameKey !== undefined || body.frame_key !== undefined) {
      add('frame_key', normalizePhraseKey(body.frameKey ?? body.frame_key));
    }
    if (body.slots !== undefined) add('slots', JSON.stringify(body.slots || []));
    if (body.glossZh !== undefined || body.gloss_zh !== undefined) {
      add('gloss_zh', String(body.glossZh ?? body.gloss_zh ?? ''));
    }
    if (body.anchorWordIds !== undefined || body.anchor_word_ids !== undefined) {
      add(
        'anchor_word_ids',
        JSON.stringify(body.anchorWordIds ?? body.anchor_word_ids ?? [])
      );
    }
    if (body.exampleFilled !== undefined || body.example_filled !== undefined) {
      add('example_filled', String(body.exampleFilled ?? body.example_filled ?? ''));
    }
    if (body.packId !== undefined || body.pack_id !== undefined) {
      add('pack_id', String(body.packId ?? body.pack_id ?? ''));
    }
    if (body.source !== undefined) add('source', String(body.source || 'manual'));
    if (sets.length === 0) return reply.code(400).send({ error: 'empty_patch' });
    add('updated_at', new Date());
    vals.push(req.user.id, frameId);
    try {
      const result = await pool.query(
        `UPDATE frames SET ${sets.join(', ')}
         WHERE user_id = $${i++} AND frame_id = $${i}
         RETURNING *`,
        vals
      );
      if (result.rowCount === 0) return reply.code(404).send({ error: 'frame_not_found' });
      return { ok: true, frame: rowToFrame(result.rows[0]) };
    } catch (e) {
      if (String(e?.code) === '23505') {
        return reply.code(409).send({ error: 'frame_key_taken' });
      }
      throw e;
    }
  });

  app.delete('/api/frames/:frameId', { preHandler: requireAuth }, async (req, reply) => {
    const frameId = String(req.params.frameId || '').trim();
    const result = await pool.query(
      `DELETE FROM frames WHERE user_id = $1 AND frame_id = $2`,
      [req.user.id, frameId]
    );
    if (result.rowCount === 0) return reply.code(404).send({ error: 'frame_not_found' });
    await pool.query(
      `DELETE FROM srs_progress
       WHERE user_id = $1 AND target_type = 'frame' AND target_id = $2`,
      [req.user.id, frameId]
    );
    return { ok: true };
  });

  app.post('/api/frames/batch', { preHandler: requireAuth }, async (req, reply) => {
    const list = Array.isArray(req.body?.frames) ? req.body.frames : null;
    if (!list) return reply.code(400).send({ error: 'missing_frames' });
    if (list.length > BATCH_MAX) {
      return reply.code(413).send({ error: 'batch_too_large', max: BATCH_MAX });
    }
    const saved = [];
    for (const item of list) {
      const f = normalizeFrameBody(item, item?.id);
      if (!f) continue;
      if (!f.updatedAt) f.updatedAt = Date.now();
      saved.push(await upsertFrame(pool, req.user.id, f));
    }
    return { ok: true, count: saved.length, frames: saved };
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

  // --- Practice sessions (per-item cloud sync) ---

  function mapPracticeSessionRow(row, items) {
    return {
      sessionId: row.session_id,
      status: row.status,
      mode: row.mode,
      scope: row.scope,
      difficulty: row.difficulty,
      idx: row.idx,
      stats: row.stats || { correct: 0, total: 0 },
      uiState: row.ui_state || {},
      revision: row.revision,
      clientUpdatedAt: Number(row.client_updated_at) || 0,
      createdAt: new Date(row.created_at).getTime(),
      updatedAt: new Date(row.updated_at).getTime(),
      items: (items || []).map((it) => ({
        ordinal: it.ordinal,
        wordId: it.word_id,
        example: it.example || null,
        attempt: it.attempt || null,
        wasNew: !!it.was_new,
        clientUpdatedAt: Number(it.client_updated_at) || 0,
      })),
    };
  }

  async function loadPracticeSession(pool, userId, sessionId) {
    const sess = await pool.query(
      `SELECT * FROM practice_sessions WHERE session_id = $1 AND user_id = $2`,
      [sessionId, userId]
    );
    if (sess.rowCount === 0) return null;
    const items = await pool.query(
      `SELECT * FROM practice_session_items
       WHERE session_id = $1 ORDER BY ordinal ASC`,
      [sessionId]
    );
    return mapPracticeSessionRow(sess.rows[0], items.rows);
  }

  async function deleteActivePracticeSessions(pool, userId) {
    await pool.query(
      `DELETE FROM practice_sessions WHERE user_id = $1 AND status = 'active'`,
      [userId]
    );
  }

  app.post('/api/practice/sessions', { preHandler: requireAuth }, async (req, reply) => {
    const body = req.body || {};
    const mode = String(body.mode || 'cloze');
    const scope = String(body.scope || 'mixed');
    const difficulty = String(body.difficulty || 'medium');
    const wordIds = Array.isArray(body.wordIds)
      ? body.wordIds.map((id) => String(id).trim()).filter(Boolean)
      : [];
    if (!wordIds.length || wordIds.length > 200) {
      return reply.code(400).send({ error: 'invalid_wordIds' });
    }
    const clientUpdatedAt = Number(body.clientUpdatedAt) || Date.now();
    const wasNewMap =
      body.wasNewByWordId && typeof body.wasNewByWordId === 'object'
        ? body.wasNewByWordId
        : {};

    await deleteActivePracticeSessions(pool, req.user.id);

    const ins = await pool.query(
      `INSERT INTO practice_sessions (
         user_id, status, mode, scope, difficulty, idx, stats, ui_state, revision, client_updated_at
       ) VALUES ($1, 'active', $2, $3, $4, 0, '{"correct":0,"total":0}'::jsonb, '{}'::jsonb, 1, $5)
       RETURNING *`,
      [req.user.id, mode, scope, difficulty, clientUpdatedAt]
    );
    const row = ins.rows[0];
    const sessionId = row.session_id;

    if (wordIds.length) {
      const values = [];
      const params = [];
      let p = 1;
      for (let i = 0; i < wordIds.length; i++) {
        values.push(`($${p++}, $${p++}, $${p++}, $${p++}, $${p++})`);
        params.push(sessionId, i, wordIds[i], !!wasNewMap[wordIds[i]], clientUpdatedAt);
      }
      await pool.query(
        `INSERT INTO practice_session_items (session_id, ordinal, word_id, was_new, client_updated_at)
         VALUES ${values.join(', ')}`,
        params
      );
    }

    const full = await loadPracticeSession(pool, req.user.id, sessionId);
    return { ok: true, session: full };
  });

  app.get('/api/practice/active', { preHandler: requireAuth }, async (req) => {
    const sess = await pool.query(
      `SELECT * FROM practice_sessions WHERE user_id = $1 AND status = 'active' LIMIT 1`,
      [req.user.id]
    );
    if (sess.rowCount === 0) return { ok: true, session: null };
    const sessionId = sess.rows[0].session_id;
    const full = await loadPracticeSession(pool, req.user.id, sessionId);
    return { ok: true, session: full };
  });

  app.delete('/api/practice/active', { preHandler: requireAuth }, async (req) => {
    await deleteActivePracticeSessions(pool, req.user.id);
    return { ok: true };
  });

  app.get('/api/practice/sessions/:sessionId', { preHandler: requireAuth }, async (req, reply) => {
    const sessionId = String(req.params.sessionId || '');
    const full = await loadPracticeSession(pool, req.user.id, sessionId);
    if (!full) return reply.code(404).send({ error: 'session_not_found' });
    return { ok: true, session: full };
  });

  app.get('/api/practice/sessions/:sessionId/check', { preHandler: requireAuth }, async (req, reply) => {
    const sessionId = String(req.params.sessionId || '');
    const clientRevision = Number(req.query?.revision);
    const result = await pool.query(
      `SELECT revision, updated_at FROM practice_sessions
       WHERE session_id = $1 AND user_id = $2 AND status = 'active'`,
      [sessionId, req.user.id]
    );
    if (result.rowCount === 0) {
      return { ok: true, match: false, serverRevision: null, serverUpdatedAt: null, gone: true };
    }
    const row = result.rows[0];
    const serverRevision = Number(row.revision) || 0;
    const match =
      Number.isFinite(clientRevision) && clientRevision === serverRevision;
    return {
      ok: true,
      match,
      serverRevision,
      serverUpdatedAt: new Date(row.updated_at).getTime(),
      gone: false,
    };
  });

  app.patch('/api/practice/sessions/:sessionId', { preHandler: requireAuth }, async (req, reply) => {
    const sessionId = String(req.params.sessionId || '');
    const body = req.body || {};
    const clientUpdatedAt = Number(body.clientUpdatedAt) || Date.now();

    const cur = await pool.query(
      `SELECT session_id, idx, stats, ui_state, revision, client_updated_at, updated_at
       FROM practice_sessions
       WHERE session_id = $1 AND user_id = $2 AND status = 'active'`,
      [sessionId, req.user.id]
    );
    if (cur.rowCount === 0) return reply.code(404).send({ error: 'session_not_found' });

    const row = cur.rows[0];
    // 冲突时也不回整包 items，客户端只需要 revision 做元数据
    if (clientUpdatedAt < Number(row.client_updated_at || 0)) {
      return {
        ok: true,
        applied: false,
        sessionId,
        revision: Number(row.revision) || 0,
        updatedAt: new Date(row.updated_at).getTime(),
      };
    }

    const idx = body.idx !== undefined ? Number(body.idx) : row.idx;
    const stats = body.stats !== undefined ? body.stats : row.stats;
    const uiState = body.uiState !== undefined ? body.uiState : row.ui_state;

    const updated = await pool.query(
      `UPDATE practice_sessions SET
         idx = $1,
         stats = $2::jsonb,
         ui_state = $3::jsonb,
         revision = revision + 1,
         client_updated_at = $4,
         updated_at = NOW()
       WHERE session_id = $5 AND user_id = $6
       RETURNING session_id, revision, updated_at`,
      [idx, JSON.stringify(stats), JSON.stringify(uiState), clientUpdatedAt, sessionId, req.user.id]
    );

    const out = updated.rows[0];
    return {
      ok: true,
      applied: true,
      sessionId: out.session_id,
      revision: Number(out.revision) || 0,
      updatedAt: new Date(out.updated_at).getTime(),
    };
  });

  app.put('/api/practice/sessions/:sessionId/items/:ordinal', { preHandler: requireAuth }, async (req, reply) => {
    const sessionId = String(req.params.sessionId || '');
    const ordinal = Number(req.params.ordinal);
    if (!Number.isFinite(ordinal) || ordinal < 0 || ordinal > 500) {
      return reply.code(400).send({ error: 'invalid_ordinal' });
    }
    const body = req.body || {};
    const clientUpdatedAt = Number(body.clientUpdatedAt) || Date.now();

    const sess = await pool.query(
      `SELECT session_id FROM practice_sessions
       WHERE session_id = $1 AND user_id = $2 AND status = 'active'`,
      [sessionId, req.user.id]
    );
    if (sess.rowCount === 0) return reply.code(404).send({ error: 'session_not_found' });

    const existing = await pool.query(
      `SELECT client_updated_at FROM practice_session_items
       WHERE session_id = $1 AND ordinal = $2`,
      [sessionId, ordinal]
    );
    if (existing.rowCount === 0) {
      return reply.code(404).send({ error: 'item_not_found' });
    }
    if (clientUpdatedAt < Number(existing.rows[0].client_updated_at || 0)) {
      return { ok: true, applied: false };
    }

    const example = body.example !== undefined ? body.example : undefined;
    const attempt = body.attempt !== undefined ? body.attempt : undefined;
    const wasNew = body.wasNew;

    const sets = ['client_updated_at = $1'];
    const vals = [clientUpdatedAt];
    let i = 2;
    if (example !== undefined) {
      sets.push(`example = $${i++}::jsonb`);
      vals.push(JSON.stringify(example));
    }
    if (attempt !== undefined) {
      sets.push(`attempt = $${i++}::jsonb`);
      vals.push(JSON.stringify(attempt));
    }
    if (wasNew !== undefined) {
      sets.push(`was_new = $${i++}`);
      vals.push(!!wasNew);
    }
    vals.push(sessionId, ordinal);
    const sidParam = i;
    const ordParam = i + 1;
    await pool.query(
      `UPDATE practice_session_items SET ${sets.join(', ')}
       WHERE session_id = $${sidParam} AND ordinal = $${ordParam}`,
      vals
    );

    await pool.query(
      `UPDATE practice_sessions SET revision = revision + 1, updated_at = NOW()
       WHERE session_id = $1 AND user_id = $2`,
      [sessionId, req.user.id]
    );

    return { ok: true, applied: true };
  });

  /** 批量更新题目行，避免开练预取时 N 次 PUT */
  app.put('/api/practice/sessions/:sessionId/items', { preHandler: requireAuth }, async (req, reply) => {
    const sessionId = String(req.params.sessionId || '');
    const list = Array.isArray(req.body?.items) ? req.body.items : null;
    if (!list || !list.length) return reply.code(400).send({ error: 'missing_items' });
    if (list.length > 200) return reply.code(413).send({ error: 'batch_too_large', max: 200 });

    const sess = await pool.query(
      `SELECT session_id FROM practice_sessions
       WHERE session_id = $1 AND user_id = $2 AND status = 'active'`,
      [sessionId, req.user.id]
    );
    if (sess.rowCount === 0) return reply.code(404).send({ error: 'session_not_found' });

    let applied = 0;
    for (const raw of list) {
      const ordinal = Number(raw?.ordinal);
      if (!Number.isFinite(ordinal) || ordinal < 0 || ordinal > 500) continue;
      const clientUpdatedAt = Number(raw?.clientUpdatedAt) || Date.now();

      const existing = await pool.query(
        `SELECT client_updated_at FROM practice_session_items
         WHERE session_id = $1 AND ordinal = $2`,
        [sessionId, ordinal]
      );
      if (existing.rowCount === 0) continue;
      if (clientUpdatedAt < Number(existing.rows[0].client_updated_at || 0)) continue;

      const sets = ['client_updated_at = $1'];
      const vals = [clientUpdatedAt];
      let i = 2;
      if (raw.example !== undefined) {
        sets.push(`example = $${i++}::jsonb`);
        vals.push(JSON.stringify(raw.example));
      }
      if (raw.attempt !== undefined) {
        sets.push(`attempt = $${i++}::jsonb`);
        vals.push(JSON.stringify(raw.attempt));
      }
      if (raw.wasNew !== undefined) {
        sets.push(`was_new = $${i++}`);
        vals.push(!!raw.wasNew);
      }
      if (sets.length === 1) continue;
      vals.push(sessionId, ordinal);
      const sidParam = i;
      const ordParam = i + 1;
      await pool.query(
        `UPDATE practice_session_items SET ${sets.join(', ')}
         WHERE session_id = $${sidParam} AND ordinal = $${ordParam}`,
        vals
      );
      applied += 1;
    }

    if (applied > 0) {
      await pool.query(
        `UPDATE practice_sessions SET revision = revision + 1, updated_at = NOW()
         WHERE session_id = $1 AND user_id = $2`,
        [sessionId, req.user.id]
      );
    }

    return { ok: true, applied };
  });

  async function endPracticeSession(pool, userId, sessionId) {
    await pool.query(`DELETE FROM practice_session_items WHERE session_id = $1`, [sessionId]);
    await pool.query(
      `DELETE FROM practice_sessions WHERE session_id = $1 AND user_id = $2`,
      [sessionId, userId]
    );
    return { ok: true };
  }

  app.post('/api/practice/sessions/:sessionId/complete', { preHandler: requireAuth }, async (req, reply) => {
    const sessionId = String(req.params.sessionId || '');
    const r = await pool.query(
      `SELECT session_id FROM practice_sessions WHERE session_id = $1 AND user_id = $2`,
      [sessionId, req.user.id]
    );
    if (r.rowCount === 0) return reply.code(404).send({ error: 'session_not_found' });
    return endPracticeSession(pool, req.user.id, sessionId);
  });

  app.post('/api/practice/sessions/:sessionId/abandon', { preHandler: requireAuth }, async (req, reply) => {
    const sessionId = String(req.params.sessionId || '');
    const r = await pool.query(
      `SELECT session_id FROM practice_sessions WHERE session_id = $1 AND user_id = $2`,
      [sessionId, req.user.id]
    );
    if (r.rowCount === 0) return reply.code(404).send({ error: 'session_not_found' });
    return endPracticeSession(pool, req.user.id, sessionId);
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

  /** LLM proxy — server-side fetch avoids browser Origin blocks (e.g. JoyAgent). */
  app.post('/api/llm/chat/completions', async (req, reply) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const apiBase = String(body.apiBase || '').trim();
    const apiKey = normalizeProxyApiKey(body.apiKey);
    if (!apiBase) {
      return reply.code(400).send({ error: 'missing_api_base' });
    }
    if (!apiKey) {
      return reply.code(400).send({ error: 'missing_api_key' });
    }
    if (!isAllowedLlmUpstream(apiBase)) {
      return reply.code(400).send({ error: 'invalid_api_base' });
    }

    const upstreamBody = { ...body };
    delete upstreamBody.apiBase;
    delete upstreamBody.apiKey;
    if (!upstreamBody.model || !Array.isArray(upstreamBody.messages)) {
      return reply.code(400).send({ error: 'invalid_llm_body' });
    }

    const url = apiBase.replace(/\/$/, '') + '/chat/completions';
    let upstream;
    try {
      upstream = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + apiKey,
        },
        body: JSON.stringify(upstreamBody),
      });
    } catch (err) {
      console.error('[llm-proxy] fetch failed', err);
      return reply.code(502).send({ error: 'llm_upstream_unreachable' });
    }

    const text = await upstream.text();
    reply.code(upstream.status);
    reply.header('Content-Type', upstream.headers.get('content-type') || 'application/json');
    return reply.send(text);
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
