import 'dotenv/config';
import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import pg from 'pg';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';

const { Pool } = pg;
const app = express();
app.set('trust proxy', 1);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, 'migrations');
const logoAssetsDir = process.env.LOGO_ASSETS_DIR || path.join(__dirname, '..', 'uploads');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://opina:opina@localhost:5433/opina_ai',
});

const jwtSecret = process.env.JWT_SECRET || (process.env.NODE_ENV === 'production' ? null : 'dev-only-change-me');
if (!jwtSecret) throw new Error('JWT_SECRET é obrigatória em produção.');
const DEFAULT_RATING_QUESTION = 'Como foi a sua experiência?';
const DEFAULT_EMOJI_OPTIONS = [
  { value: '1', emoji: '😡', label: 'Péssimo', animation: 'shake' },
  { value: '2', emoji: '😕', label: 'Ruim', animation: 'float' },
  { value: '3', emoji: '😐', label: 'Regular', animation: 'pulse' },
  { value: '4', emoji: '🙂', label: 'Bom', animation: 'bounce' },
  { value: '5', emoji: '😍', label: 'Ótimo', animation: 'heart' },
];
const ALLOWED_EMOJI_ANIMATIONS = new Set(['shake', 'float', 'pulse', 'bounce', 'heart']);
const surveyPreviews = new Map();
const SURVEY_PREVIEW_TTL_MS = 10 * 60 * 1000;
const SURVEY_PREVIEW_MAX_ENTRIES = 50;
const allowedCorsOrigins = new Set(
  String(process.env.CORS_ORIGINS || '').split(',').map((origin) => origin.trim()).filter(Boolean),
);

app.disable('x-powered-by');
app.use(helmet());
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedCorsOrigins.has(origin) || origin === 'capacitor://localhost' || /^https?:\/\/localhost(?::\d+)?$/.test(origin)) {
      callback(null, true);
      return;
    }
    callback(null, false);
  },
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, '..', 'dist')));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'too_many_requests' },
});
const pairingLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'too_many_requests' },
});
const surveyPreviewLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'too_many_requests' },
});

function storeSurveyPreview(survey) {
  const now = Date.now();
  for (const [token, preview] of surveyPreviews) {
    if (preview.expiresAt <= now) surveyPreviews.delete(token);
  }
  while (surveyPreviews.size >= SURVEY_PREVIEW_MAX_ENTRIES) {
    surveyPreviews.delete(surveyPreviews.keys().next().value);
  }
  const token = randomBytes(32).toString('base64url');
  surveyPreviews.set(token, { survey, expiresAt: now + SURVEY_PREVIEW_TTL_MS });
  return token;
}

function asPositiveInt(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function cleanText(value, max = 200) {
  const normalized = String(value ?? '').trim();
  return normalized ? normalized.slice(0, max) : '';
}

function normalizeSurveyHeaderText(value) {
  if (typeof value !== 'string') return null;
  return value.trim().slice(0, 120);
}

function normalizeSurveyLogoPosition(value) {
  return ['top', 'left', 'right', 'bottom'].includes(value) ? value : null;
}

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function secureHashEqual(left, right) {
  if (!/^[a-f0-9]{64}$/.test(left || '') || !/^[a-f0-9]{64}$/.test(right || '')) return false;
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function validateTenantId(value) {
  return asPositiveInt(value);
}

async function tenantExists(tenantId) {
  if (!tenantId) return false;
  const result = await pool.query('SELECT 1 FROM tenants WHERE id=$1', [tenantId]);
  return Boolean(result.rowCount);
}

function canAccessTenant(req, tenantId) {
  return req.user.role === 'SUPERADMIN' || req.user.tenantId === tenantId;
}

const MAX_TENANT_IMAGE_BYTES = 512 * 1024;

function decodeTenantImage(data, label = 'A imagem') {
  if (typeof data !== 'string') return { error: 'Selecione uma imagem PNG, JPEG ou WebP.' };
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(data);
  if (!match) return { error: 'Selecione uma imagem PNG, JPEG ou WebP.' };

  const [, mimeType, encoded] = match;
  const bytes = Buffer.from(encoded, 'base64');
  if (!bytes.length || bytes.length > MAX_TENANT_IMAGE_BYTES) {
    return { error: `${label} deve ter no máximo 512 KB.` };
  }
  if (bytes.toString('base64') !== encoded) return { error: `${label} enviada está inválida.` };

  const isPng = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const isJpeg = bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]));
  const isWebp = bytes.subarray(0, 4).toString('ascii') === 'RIFF'
    && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
  const matchesMime = (mimeType === 'image/png' && isPng)
    || (mimeType === 'image/jpeg' && isJpeg)
    || (mimeType === 'image/webp' && isWebp);
  if (!matchesMime) return { error: `Não foi possível validar ${label.toLowerCase()}.` };

  const extension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[mimeType];
  return { bytes, mimeType, extension };
}

const tenantImageFormats = [
  ['image/webp', 'webp'],
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
];

function tenantImageFilename(tenantId, kind, extension) {
  return kind === 'logo' ? `tenant-${tenantId}.${extension}` : `tenant-${tenantId}-${kind}.${extension}`;
}

function surveyImageFilename(surveyId, kind, extension) {
  return `survey-${surveyId}-${kind}.${extension}`;
}

async function readTenantImage(tenantId, kind) {
  for (const [mimeType, extension] of tenantImageFormats) {
    try {
      const bytes = await readFile(path.join(logoAssetsDir, tenantImageFilename(tenantId, kind, extension)));
      return { mimeType, bytes };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return null;
}

async function removeTenantImageFiles(tenantId, kind, keepExtension = null) {
  for (const extension of ['webp', 'png', 'jpg']) {
    if (extension === keepExtension) continue;
    try {
      await unlink(path.join(logoAssetsDir, tenantImageFilename(tenantId, kind, extension)));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}

async function readSurveyImage(surveyId, kind) {
  for (const [mimeType, extension] of tenantImageFormats) {
    try {
      const bytes = await readFile(path.join(logoAssetsDir, surveyImageFilename(surveyId, kind, extension)));
      return { mimeType, bytes };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return null;
}

async function removeSurveyImageFiles(surveyId, kind) {
  for (const extension of ['webp', 'png', 'jpg']) {
    try {
      await unlink(path.join(logoAssetsDir, surveyImageFilename(surveyId, kind, extension)));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}

async function writeSurveyImage(surveyId, kind, image) {
  const filename = surveyImageFilename(surveyId, kind, image.extension);
  const targetPath = path.join(logoAssetsDir, filename);
  const temporaryPath = path.join(logoAssetsDir, `.${filename}.${randomBytes(8).toString('hex')}.tmp`);
  try {
    await writeFile(temporaryPath, image.bytes, { flag: 'wx', mode: 0o644 });
    await rename(temporaryPath, targetPath);
  } finally {
    await unlink(temporaryPath).catch((error) => { if (error.code !== 'ENOENT') throw error; });
  }
  await removeSurveyImageFilesExcept(surveyId, kind, image.extension);
}

async function removeSurveyImageFilesExcept(surveyId, kind, keepExtension) {
  for (const extension of ['webp', 'png', 'jpg']) {
    if (extension === keepExtension) continue;
    try {
      await unlink(path.join(logoAssetsDir, surveyImageFilename(surveyId, kind, extension)));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}

function imageDataUrl(image) {
  return image ? `data:${image.mimeType};base64,${image.bytes.toString('base64')}` : null;
}

async function loadSurveyBranding(surveyId) {
  const [surveyLogo, surveyBackground] = await Promise.all([
    readSurveyImage(surveyId, 'logo'),
    readSurveyImage(surveyId, 'background'),
  ]);
  return {
    branding: {
      logoData: imageDataUrl(surveyLogo),
      backgroundData: imageDataUrl(surveyBackground),
    },
    brandingOverrides: { logo: Boolean(surveyLogo), background: Boolean(surveyBackground) },
  };
}

function parseDateFilter(value) {
  if (!value) return null;
  const parsed = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(parsed)) return null;
  const date = new Date(`${parsed}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== parsed ? null : parsed;
}

function emptyReportMetrics() {
  return {
    total: 0,
    averageScore: null,
    satisfiedCount: 0,
    satisfiedRate: 0,
    neutralCount: 0,
    neutralRate: 0,
    dissatisfiedCount: 0,
    dissatisfiedRate: 0,
  };
}

function emptyDistribution() {
  return [
    ['1', '😡', 'Péssimo'],
    ['2', '😕', 'Ruim'],
    ['3', '😐', 'Regular'],
    ['4', '🙂', 'Bom'],
    ['5', '😍', 'Ótimo'],
  ].map(([value, emoji, label]) => ({ value, emoji, label, count: 0 }));
}

function normalizeEmojiOptions(input) {
  const source = Array.isArray(input) ? input : [];
  return DEFAULT_EMOJI_OPTIONS.map((fallback, index) => {
    const item = source[index];
    if (typeof item === 'string') {
      return { ...fallback, emoji: cleanText(item, 16) || fallback.emoji };
    }
    return {
      value: String(index + 1),
      emoji: cleanText(item?.emoji, 16) || fallback.emoji,
      label: cleanText(item?.label, 80) || fallback.label,
      animation: ALLOWED_EMOJI_ANIMATIONS.has(item?.animation) ? item.animation : fallback.animation,
    };
  });
}

function normalizeQuestions(input) {
  const questions = Array.isArray(input) ? input.slice(0, 20) : [];
  const allowedTypes = new Set(['emoji', 'stars', 'scale', 'options']);
  const normalized = questions.map((question, index) => {
    const type = allowedTypes.has(question?.type) ? question.type : 'emoji';
    return {
      id: asPositiveInt(question?.id),
      text: cleanText(question?.text, 500) || (['emoji', 'stars'].includes(type) ? DEFAULT_RATING_QUESTION : ''),
      type,
      position: index,
      options: type === 'emoji'
        ? normalizeEmojiOptions(question?.options)
        : Array.isArray(question?.options)
          ? question.options.map((item) => cleanText(item, 120)).filter(Boolean).slice(0, 12)
          : [],
    };
  });
  if (!normalized.length || normalized.some((question) => !question.text || (question.type === 'options' && question.options.length < 2))) {
    return null;
  }
  return normalized;
}

function generateActivationCode() {
  return String(randomInt(100000, 1000000));
}

function boundedInt(value, min, max) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) return null;
  return Math.min(max, Math.max(min, parsed));
}

function normalizeTelemetry(input = {}) {
  const allowedOrientation = new Set(['portrait', 'landscape', 'unknown']);
  return {
    platform: cleanText(input.platform, 32) || null,
    androidVersion: cleanText(input.androidVersion, 32) || null,
    manufacturer: cleanText(input.manufacturer, 80) || null,
    model: cleanText(input.model, 120) || null,
    batteryLevel: boundedInt(input.batteryLevel, 0, 100),
    charging: typeof input.charging === 'boolean' ? input.charging : null,
    networkState: cleanText(input.networkState, 32) || null,
    pendingResponses: boundedInt(input.pendingResponses, 0, 100000) ?? 0,
    kioskState: cleanText(input.kioskState, 32) || null,
    orientation: allowedOrientation.has(input.orientation) ? input.orientation : 'unknown',
  };
}

async function runMigrations() {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    filename TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);

  const files = (await readdir(migrationsDir)).filter((name) => name.endsWith('.sql')).sort();
  for (const filename of files) {
    const already = await pool.query('SELECT 1 FROM schema_migrations WHERE filename=$1', [filename]);
    if (already.rowCount) continue;

    const client = await pool.connect();
    try {
      const sql = await readFile(path.join(migrationsDir, filename), 'utf8');
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations(filename) VALUES($1)', [filename]);
      await client.query('COMMIT');
      console.log(`Migration aplicada: ${filename}`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

async function bootstrapAdmin() {
  const email = cleanText(process.env.BOOTSTRAP_ADMIN_EMAIL, 180);
  const password = String(process.env.BOOTSTRAP_ADMIN_PASSWORD || '');
  const name = cleanText(process.env.BOOTSTRAP_ADMIN_NAME || 'Administrador Opina AI', 160);
  if (!email && !password) return;
  if (!email || password.length < 8) {
    throw new Error('BOOTSTRAP_ADMIN_EMAIL e BOOTSTRAP_ADMIN_PASSWORD (mín. 8 caracteres) devem ser definidos juntos.');
  }

  const exists = await pool.query('SELECT id FROM users WHERE lower(email)=lower($1)', [email]);
  if (exists.rowCount) return;
  await pool.query(
    'INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,$4)',
    [name, email, await bcrypt.hash(password, 12), 'SUPERADMIN'],
  );
  console.log(`SUPERADMIN bootstrap criado para ${email}.`);
}

async function auth(req, res, next) {
  try {
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const payload = jwt.verify(token, jwtSecret);
    const result = await pool.query(
      'SELECT id,tenant_id,name,email,role,active FROM users WHERE id=$1 AND active=true',
      [payload.id],
    );
    if (!result.rowCount) return res.status(401).json({ error: 'Não autorizado' });
    const user = result.rows[0];
    req.user = {
      id: user.id,
      tenantId: user.tenant_id,
      name: user.name,
      email: user.email,
      role: user.role,
    };
    next();
  } catch {
    res.status(401).json({ error: 'Não autorizado' });
  }
}

async function deviceAuth(req, res, next) {
  try {
    const deviceId = cleanText(req.body?.deviceId || req.query?.deviceId, 80);
    const secret = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!deviceId || !secret) return res.status(401).json({ error: 'device_auth_failed' });
    const result = await pool.query('SELECT * FROM devices WHERE device_id=$1 AND active=true', [deviceId]);
    if (!result.rowCount || !secureHashEqual(result.rows[0].device_secret_hash, sha256(secret))) {
      return res.status(401).json({ error: 'device_auth_failed' });
    }
    req.device = result.rows[0];
    next();
  } catch {
    res.status(401).json({ error: 'device_auth_failed' });
  }
}

function tenantForUser(req, suppliedTenantId) {
  if (req.user.role === 'SUPERADMIN') return asPositiveInt(suppliedTenantId) || req.user.tenantId || null;
  return req.user.tenantId;
}

function requireSuperadmin(req, res) {
  if (req.user.role !== 'SUPERADMIN') {
    res.status(403).json({ error: 'Acesso restrito ao SUPERADMIN.' });
    return false;
  }
  return true;
}

function requireManager(req, res) {
  if (!['SUPERADMIN', 'ADMIN'].includes(req.user.role)) {
    res.status(403).json({ error: 'Acesso restrito ao administrador.' });
    return false;
  }
  return true;
}

app.post('/api/auth/login', loginLimiter, asyncRoute(async (req, res) => {
  const email = cleanText(req.body?.email, 180);
  const password = String(req.body?.password || '');
  if (!email || !password) return res.status(400).json({ error: 'Informe usuário e senha.' });

  const result = await pool.query('SELECT * FROM users WHERE lower(email)=lower($1) AND active=true', [email]);
  if (!result.rowCount || !(await bcrypt.compare(password, result.rows[0].password_hash))) {
    return res.status(401).json({ error: 'Usuário ou senha inválidos' });
  }
  const user = result.rows[0];
  const token = jwt.sign({ id: user.id }, jwtSecret, { expiresIn: '8h' });
  res.json({
    token,
    user: { id: user.id, name: user.name, email: user.email, role: user.role, tenantId: user.tenant_id },
  });
}));

app.get('/api/me', auth, (req, res) => res.json(req.user));

app.post('/api/auth/change-password', auth, asyncRoute(async (req, res) => {
  const currentPassword = String(req.body?.currentPassword || '');
  const newPassword = String(req.body?.newPassword || '');
  if (!currentPassword || newPassword.length < 8) {
    return res.status(400).json({ error: 'A nova senha precisa ter pelo menos 8 caracteres.' });
  }
  const result = await pool.query('SELECT password_hash FROM users WHERE id=$1 AND active=true', [req.user.id]);
  if (!result.rowCount || !(await bcrypt.compare(currentPassword, result.rows[0].password_hash))) {
    return res.status(401).json({ error: 'Senha atual inválida.' });
  }
  await pool.query('UPDATE users SET password_hash=$1 WHERE id=$2', [await bcrypt.hash(newPassword, 12), req.user.id]);
  res.json({ ok: true });
}));

app.get('/api/tenants', auth, async (req, res) => {
  if (!requireSuperadmin(req, res)) return;
  const result = await pool.query(
    `SELECT t.id,t.name,t.device_limit AS "deviceLimit",t.created_at,
            (SELECT COUNT(*)::int FROM devices d WHERE d.tenant_id=t.id AND d.active=true) AS "activeDevices",
            (SELECT u.email FROM users u WHERE u.tenant_id=t.id AND u.role='ADMIN' AND u.active=true ORDER BY u.id LIMIT 1) AS "adminEmail"
       FROM tenants t
      ORDER BY t.name`,
  );
  res.json(result.rows);
});

app.get('/api/tenant/branding', auth, asyncRoute(async (req, res) => {
  const tenantId = tenantForUser(req, req.query.tenantId);
  if (!tenantId) return res.status(400).json({ error: 'Selecione uma empresa.' });
  if (!canAccessTenant(req, tenantId)) return res.sendStatus(403);

  const result = await pool.query('SELECT id,name FROM tenants WHERE id=$1', [tenantId]);
  if (!result.rowCount) return res.status(404).json({ error: 'Empresa não encontrada.' });

  const tenant = result.rows[0];
  const [logo, background] = await Promise.all([
    readTenantImage(tenantId, 'logo'),
    readTenantImage(tenantId, 'background'),
  ]);
  const toDataUrl = (image) => image ? `data:${image.mimeType};base64,${image.bytes.toString('base64')}` : null;
  res.json({ id: tenant.id, name: tenant.name, logoData: toDataUrl(logo), backgroundData: toDataUrl(background) });
}));

app.put('/api/tenant/branding', auth, asyncRoute(async (req, res) => {
  if (!requireManager(req, res)) return;
  const tenantId = tenantForUser(req, req.body?.tenantId);
  if (!tenantId) return res.status(400).json({ error: 'Selecione uma empresa.' });
  if (!canAccessTenant(req, tenantId)) return res.sendStatus(403);
  if (!(await tenantExists(tenantId))) return res.status(404).json({ error: 'Empresa não encontrada.' });

  const imageField = ['logoData', 'backgroundData'].find((field) => Object.hasOwn(req.body || {}, field));
  if (!imageField) return res.status(400).json({ error: 'Selecione uma logo ou imagem de fundo.' });
  const kind = imageField === 'logoData' ? 'logo' : 'background';
  const label = kind === 'logo' ? 'A logo' : 'A imagem de fundo';
  if (req.body[imageField] === null || req.body[imageField] === '') {
    await removeTenantImageFiles(tenantId, kind);
    await pool.query('UPDATE devices SET config_version=config_version+1,updated_at=now() WHERE tenant_id=$1 AND active=true', [tenantId]);
    return res.json({ ok: true, [imageField]: null });
  }

  const image = decodeTenantImage(req.body[imageField], label);
  if (image.error) return res.status(400).json({ error: image.error });
  const filename = tenantImageFilename(tenantId, kind, image.extension);
  const targetPath = path.join(logoAssetsDir, filename);
  const temporaryPath = path.join(logoAssetsDir, `.${filename}.${randomBytes(8).toString('hex')}.tmp`);
  try {
    await writeFile(temporaryPath, image.bytes, { flag: 'wx', mode: 0o644 });
    await rename(temporaryPath, targetPath);
  } finally {
    await unlink(temporaryPath).catch((error) => { if (error.code !== 'ENOENT') throw error; });
  }
  await removeTenantImageFiles(tenantId, kind, image.extension);
  await pool.query('UPDATE devices SET config_version=config_version+1,updated_at=now() WHERE tenant_id=$1 AND active=true', [tenantId]);
  res.json({ ok: true, [imageField]: req.body[imageField] });
}));

app.post('/api/tenants', auth, asyncRoute(async (req, res) => {
  if (!requireSuperadmin(req, res)) return;
  const name = cleanText(req.body?.name, 160);
  const email = cleanText(req.body?.email, 180).toLowerCase();
  const password = String(req.body?.password || '');
  const deviceLimit = req.body?.deviceLimit === undefined ? 1 : asPositiveInt(req.body.deviceLimit);
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 8 || !deviceLimit || deviceLimit > 10000) {
    return res.status(400).json({ error: 'Informe empresa, e-mail válido, senha com pelo menos 8 caracteres e limite de 1 a 10.000 tablets.' });
  }
  const existingEmail = await pool.query('SELECT 1 FROM users WHERE lower(email)=lower($1)', [email]);
  if (existingEmail.rowCount) return res.status(409).json({ error: 'Este e-mail já está cadastrado.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const tenant = await client.query('INSERT INTO tenants(name,device_limit) VALUES($1,$2) RETURNING *', [name, deviceLimit]);
    const user = await client.query(
      'INSERT INTO users(tenant_id,name,email,password_hash,role) VALUES($1,$2,$3,$4,$5) RETURNING id,name,email,role,tenant_id',
      [tenant.rows[0].id, name, email, await bcrypt.hash(password, 12), 'ADMIN'],
    );
    await client.query('COMMIT');
    res.status(201).json({ tenant: tenant.rows[0], user: user.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') return res.status(409).json({ error: 'Este e-mail já está cadastrado.' });
    throw error;
  } finally {
    client.release();
  }
}));

app.patch('/api/tenants/:id', auth, asyncRoute(async (req, res) => {
  if (!requireSuperadmin(req, res)) return;
  const tenantId = asPositiveInt(req.params.id);
  if (!tenantId) return res.status(400).json({ error: 'Empresa inválida.' });

  const hasName = Object.hasOwn(req.body || {}, 'name');
  const hasLimit = Object.hasOwn(req.body || {}, 'deviceLimit');
  const hasEmail = Object.hasOwn(req.body || {}, 'adminEmail');
  const hasPassword = Object.hasOwn(req.body || {}, 'adminPassword');
  if (!hasName && !hasLimit && !hasEmail && !hasPassword) return res.status(400).json({ error: 'Informe os dados que deseja alterar.' });

  const name = hasName ? cleanText(req.body.name, 160) : null;
  const deviceLimit = hasLimit ? asPositiveInt(req.body.deviceLimit) : null;
  const adminEmail = hasEmail ? cleanText(req.body.adminEmail, 180).toLowerCase() : null;
  const adminPassword = String(req.body?.adminPassword || '');
  if (hasName && !name) {
    return res.status(400).json({ error: 'Informe um nome válido para a empresa.' });
  }
  if (hasLimit && (!deviceLimit || deviceLimit > 10000)) {
    return res.status(400).json({ error: 'O limite deve ser de 1 a 10.000 tablets.' });
  }
  if (hasEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail || '')) {
    return res.status(400).json({ error: 'Informe um e-mail válido para o administrador.' });
  }
  if (hasPassword && adminPassword.length > 0 && adminPassword.length < 8) {
    return res.status(400).json({ error: 'A senha do administrador precisa ter pelo menos 8 caracteres.' });
  }

  const passwordHash = adminPassword ? await bcrypt.hash(adminPassword, 12) : null;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const tenant = await client.query('SELECT id,name FROM tenants WHERE id=$1 FOR UPDATE', [tenantId]);
    if (!tenant.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Empresa não encontrada.' });
    }

    if (hasName) {
      await client.query('UPDATE tenants SET name=$1 WHERE id=$2', [name, tenantId]);
      await client.query(
        "UPDATE users SET name=$1 WHERE tenant_id=$2 AND role='ADMIN' AND active=true AND name=$3",
        [name, tenantId, tenant.rows[0].name],
      );
    }
    if (hasLimit) await client.query('UPDATE tenants SET device_limit=$1 WHERE id=$2', [deviceLimit, tenantId]);
    if (hasEmail || passwordHash) {
      const admin = await client.query(
        `SELECT id FROM users
          WHERE tenant_id=$1 AND role='ADMIN' AND active=true
          ORDER BY id LIMIT 1 FOR UPDATE`,
        [tenantId],
      );
      if (!admin.rowCount) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Administrador ativo não encontrado para esta empresa.' });
      }
      if (adminEmail) {
        const duplicate = await client.query(
          'SELECT 1 FROM users WHERE lower(email)=lower($1) AND id<>$2 LIMIT 1',
          [adminEmail, admin.rows[0].id],
        );
        if (duplicate.rowCount) {
          await client.query('ROLLBACK');
          return res.status(409).json({ error: 'Este e-mail já está cadastrado.' });
        }
      }
      await client.query(
        'UPDATE users SET email=COALESCE($1,email),password_hash=COALESCE($2,password_hash) WHERE id=$3',
        [adminEmail, passwordHash, admin.rows[0].id],
      );
    }

    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') return res.status(409).json({ error: 'Este e-mail já está cadastrado.' });
    throw error;
  } finally {
    client.release();
  }
}));

app.get('/api/surveys', auth, async (req, res) => {
  const requestedTenant = asPositiveInt(req.query.tenantId);
  const tenantId = tenantForUser(req, requestedTenant);
  const params = [];
  const where = [];
  if (tenantId) { params.push(tenantId); where.push(`s.tenant_id=$${params.length}`); }
  else if (req.user.role !== 'SUPERADMIN') return res.json([]);
  const result = await pool.query(
    `SELECT s.*,COUNT(d.id)::int AS assigned_devices
       FROM surveys s
       LEFT JOIN devices d ON d.active_survey_id=s.id AND d.active=true
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      GROUP BY s.id
      ORDER BY s.created_at DESC`,
    params,
  );
  res.json(result.rows);
});

app.get('/api/surveys/:id', auth, asyncRoute(async (req, res) => {
  const surveyId = asPositiveInt(req.params.id);
  const result = await pool.query('SELECT * FROM surveys WHERE id=$1', [surveyId]);
  if (!result.rowCount) return res.status(404).json({ error: 'Pesquisa não encontrada.' });
  if (!canAccessTenant(req, result.rows[0].tenant_id)) return res.sendStatus(403);
  const questions = await pool.query('SELECT id,text,type,position,options FROM questions WHERE survey_id=$1 ORDER BY position,id', [surveyId]);
  const branding = await loadSurveyBranding(surveyId);
  res.json({ ...result.rows[0], questions: questions.rows, ...branding });
}));

app.post('/api/surveys/:id/preview', auth, surveyPreviewLimiter, asyncRoute(async (req, res) => {
  const surveyId = asPositiveInt(req.params.id);
  const result = await pool.query('SELECT id,tenant_id,title,description,theme FROM surveys WHERE id=$1', [surveyId]);
  if (!result.rowCount) return res.status(404).json({ error: 'Pesquisa não encontrada.' });
  if (!canAccessTenant(req, result.rows[0].tenant_id)) return res.sendStatus(403);
  const [questions, branding] = await Promise.all([
    pool.query('SELECT id,text,type,position,options FROM questions WHERE survey_id=$1 ORDER BY position,id', [surveyId]),
    loadSurveyBranding(surveyId),
  ]);
  const survey = { ...result.rows[0], questions: questions.rows, ...branding };
  const token = storeSurveyPreview(survey);
  res.set('Cache-Control', 'no-store').status(201).json({ token });
}));

app.get('/api/survey-previews', surveyPreviewLimiter, (req, res) => {
  const token = String(req.get('x-survey-preview-token') || '');
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return res.status(404).json({ error: 'Prévia indisponível.' });
  const preview = surveyPreviews.get(token);
  if (!preview || preview.expiresAt <= Date.now()) {
    surveyPreviews.delete(token);
    return res.status(404).json({ error: 'Prévia expirada. Abra novamente pelo painel.' });
  }
  res.set('Cache-Control', 'no-store').json({ survey: preview.survey });
});

app.post('/api/surveys', auth, async (req, res) => {
  if (!requireManager(req, res)) return;
  const tenantId = tenantForUser(req, req.body?.tenantId);
  const title = cleanText(req.body?.title, 200);
  const description = cleanText(req.body?.description, 1000);
  const headerText = req.body?.headerText === undefined
    ? 'SUA OPINIÃO IMPORTA'
    : normalizeSurveyHeaderText(req.body.headerText);
  const logoPosition = req.body?.logoPosition === undefined ? 'top' : normalizeSurveyLogoPosition(req.body.logoPosition);
  const questions = normalizeQuestions(req.body?.questions);
  if (!tenantId || !(await tenantExists(tenantId)) || !title || !questions || headerText === null || !logoPosition) {
    return res.status(400).json({ error: 'Empresa, título, texto acima da avaliação e ao menos uma pergunta são obrigatórios.' });
  }
  const surveyImages = [];
  for (const [field, kind, label] of [['logoData', 'logo', 'A logo'], ['backgroundData', 'background', 'O plano de fundo']]) {
    const value = req.body?.[field];
    if (value === undefined || value === null || value === '') continue;
    const image = decodeTenantImage(value, label);
    if (image.error) return res.status(400).json({ error: image.error });
    surveyImages.push({ kind, image });
  }

  const client = await pool.connect();
  let createdSurveyId = null;
  try {
    await client.query('BEGIN');
    const survey = await client.query(
      'INSERT INTO surveys(tenant_id,title,description,theme) VALUES($1,$2,$3,$4::jsonb) RETURNING *',
      [tenantId, title, description || null, JSON.stringify({ headerText, logoPosition })],
    );
    createdSurveyId = survey.rows[0].id;
    for (const question of questions) {
      await client.query(
        'INSERT INTO questions(survey_id,text,type,position,options) VALUES($1,$2,$3,$4,$5::jsonb)',
        [survey.rows[0].id, question.text, question.type, question.position, JSON.stringify(question.options)],
      );
    }
    for (const asset of surveyImages) await writeSurveyImage(createdSurveyId, asset.kind, asset.image);
    await client.query('COMMIT');
    res.status(201).json(survey.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    if (createdSurveyId) {
      await Promise.all(['logo', 'background'].map((kind) => removeSurveyImageFiles(createdSurveyId, kind)));
    }
    throw error;
  } finally {
    client.release();
  }
});

app.put('/api/surveys/:id/branding', auth, asyncRoute(async (req, res) => {
  if (!requireManager(req, res)) return;
  const surveyId = asPositiveInt(req.params.id);
  if (!surveyId) return res.status(400).json({ error: 'Pesquisa inválida.' });
  const fields = [['logoData', 'logo', 'A logo'], ['backgroundData', 'background', 'O plano de fundo']]
    .filter(([field]) => Object.hasOwn(req.body || {}, field));
  if (!fields.length) return res.status(400).json({ error: 'Selecione uma logo ou um plano de fundo.' });

  const existing = await pool.query('SELECT id,tenant_id FROM surveys WHERE id=$1', [surveyId]);
  if (!existing.rowCount) return res.status(404).json({ error: 'Pesquisa não encontrada.' });
  const tenantId = existing.rows[0].tenant_id;
  if (!canAccessTenant(req, tenantId)) return res.sendStatus(403);

  const assets = [];
  for (const [field, kind, label] of fields) {
    const value = req.body[field];
    if (value === null || value === '') {
      assets.push({ kind, image: null });
      continue;
    }
    const image = decodeTenantImage(value, label);
    if (image.error) return res.status(400).json({ error: image.error });
    assets.push({ kind, image });
  }

  for (const asset of assets) {
    if (asset.image) await writeSurveyImage(surveyId, asset.kind, asset.image);
    else await removeSurveyImageFiles(surveyId, asset.kind);
  }
  await pool.query(
    'UPDATE devices SET config_version=config_version+1,updated_at=now() WHERE tenant_id=$1 AND active_survey_id=$2 AND active=true',
    [tenantId, surveyId],
  );
  const result = await loadSurveyBranding(surveyId);
  res.json({ ok: true, ...result });
}));

app.patch('/api/surveys/:id', auth, asyncRoute(async (req, res) => {
  if (!requireManager(req, res)) return;
  const surveyId = asPositiveInt(req.params.id);
  if (!surveyId) return res.status(400).json({ error: 'Pesquisa inválida.' });
  const existing = await pool.query('SELECT id,tenant_id FROM surveys WHERE id=$1', [surveyId]);
  if (!existing.rowCount) return res.status(404).json({ error: 'Pesquisa não encontrada.' });
  const tenantId = existing.rows[0].tenant_id;
  if (!canAccessTenant(req, tenantId)) return res.sendStatus(403);

  const title = cleanText(req.body?.title, 200);
  const description = cleanText(req.body?.description, 1000);
  const hasHeaderText = req.body?.headerText !== undefined;
  const headerText = hasHeaderText ? normalizeSurveyHeaderText(req.body.headerText) : null;
  const hasLogoPosition = req.body?.logoPosition !== undefined;
  const logoPosition = hasLogoPosition ? normalizeSurveyLogoPosition(req.body.logoPosition) : null;
  const questions = req.body?.questions === undefined ? null : normalizeQuestions(req.body.questions);
  if (req.body?.questions !== undefined && !questions) return res.status(400).json({ error: 'Revise as perguntas e opções da pesquisa.' });
  if (req.body?.title !== undefined && !title) return res.status(400).json({ error: 'O título é obrigatório.' });
  if (hasHeaderText && headerText === null) return res.status(400).json({ error: 'O texto acima da avaliação é inválido.' });
  if (hasLogoPosition && !logoPosition) return res.status(400).json({ error: 'A posição da logo é inválida.' });
  const themeChanges = {};
  if (hasHeaderText) themeChanges.headerText = headerText;
  if (hasLogoPosition) themeChanges.logoPosition = logoPosition;
  const published = req.body?.published === undefined ? null : Boolean(req.body.published);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE surveys
          SET title=COALESCE($1,title), description=COALESCE($2,description), published=COALESCE($3,published),
              theme=CASE WHEN $4::jsonb IS NULL THEN theme ELSE COALESCE(theme,'{}'::jsonb) || $4::jsonb END
        WHERE id=$5`,
      [req.body?.title === undefined ? null : title, req.body?.description === undefined ? null : description, published,
        Object.keys(themeChanges).length ? JSON.stringify(themeChanges) : null, surveyId],
    );
    if (questions) {
      await client.query('DELETE FROM questions WHERE survey_id=$1', [surveyId]);
      for (const question of questions) {
        await client.query(
          'INSERT INTO questions(survey_id,text,type,position,options) VALUES($1,$2,$3,$4,$5::jsonb)',
          [surveyId, question.text, question.type, question.position, JSON.stringify(question.options)],
        );
      }
    }
    await client.query(
      'UPDATE devices SET config_version=config_version+1,updated_at=now() WHERE active_survey_id=$1 AND active=true',
      [surveyId],
    );
    await client.query('COMMIT');
    const updated = await pool.query('SELECT * FROM surveys WHERE id=$1', [surveyId]);
    res.json(updated.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}));

app.get('/api/reports', auth, asyncRoute(async (req, res) => {
  const tenantId = tenantForUser(req, req.query.tenantId);
  if (tenantId && !(await tenantExists(tenantId))) return res.status(404).json({ error: 'Empresa não encontrada.' });
  if (req.user.role !== 'SUPERADMIN' && !tenantId) return res.json({ metrics: emptyReportMetrics(), distribution: emptyDistribution(), rows: [] });

  const from = parseDateFilter(req.query.from);
  const to = parseDateFilter(req.query.to);
  const params = [from, to];
  const filters = [
    `COALESCE(r.answered_at,r.created_at) >= COALESCE($1::date, current_date-30)`,
    `COALESCE(r.answered_at,r.created_at) < COALESCE(($2::date + interval '1 day'), current_date+1)`,
  ];
  if (tenantId) { params.push(tenantId); filters.push(`s.tenant_id=$${params.length}`); }
  const surveyId = asPositiveInt(req.query.surveyId);
  const locationId = asPositiveInt(req.query.locationId);
  const deviceId = asPositiveInt(req.query.deviceId);
  if (surveyId) { params.push(surveyId); filters.push(`r.survey_id=$${params.length}`); }
  if (locationId) { params.push(locationId); filters.push(`r.location_id=$${params.length}`); }
  if (deviceId) { params.push(deviceId); filters.push(`r.device_id=$${params.length}`); }

  const baseSql = `WITH filtered AS (
    SELECT r.id,r.survey_id,s.title AS survey_title,r.device_id,d.name AS device_name,
           r.location_id,l.name AS location_name,
           date_trunc('day',COALESCE(r.answered_at,r.created_at))::date AS day,
           fq.type AS question_type,
           COALESCE(
             r.answers ->> fq.id::text,
             (SELECT value FROM jsonb_each_text(COALESCE(r.answers,'{}'::jsonb)) WHERE value ~ '^(10|[1-9])$' ORDER BY key LIMIT 1)
           ) AS score_text
      FROM responses r
      JOIN surveys s ON s.id=r.survey_id
      LEFT JOIN devices d ON d.id=r.device_id
      LEFT JOIN locations l ON l.id=r.location_id
      LEFT JOIN LATERAL (
        SELECT id,type FROM questions WHERE survey_id=s.id ORDER BY position,id LIMIT 1
      ) fq ON true
     WHERE ${filters.join(' AND ')}
  ), scored AS (
    SELECT *, CASE WHEN score_text ~ '^(10|[1-9])$' THEN score_text::numeric END AS score
      FROM filtered
  )`;
  const [summary, rows] = await Promise.all([
    pool.query(`${baseSql}
      SELECT COUNT(*)::int AS total,
             ROUND(AVG(score)::numeric,2) AS average_score,
             COUNT(*) FILTER (WHERE question_type IN ('emoji','stars') AND score BETWEEN 4 AND 5)::int AS satisfied_count,
             COUNT(*) FILTER (WHERE question_type IN ('emoji','stars') AND score=3)::int AS neutral_count,
             COUNT(*) FILTER (WHERE question_type IN ('emoji','stars') AND score BETWEEN 1 AND 2)::int AS dissatisfied_count,
             COUNT(*) FILTER (WHERE question_type IN ('emoji','stars') AND score=1)::int AS very_dissatisfied_count,
             COUNT(*) FILTER (WHERE question_type IN ('emoji','stars') AND score=2)::int AS dissatisfied_low_count,
             COUNT(*) FILTER (WHERE question_type IN ('emoji','stars') AND score=3)::int AS neutral_distribution_count,
             COUNT(*) FILTER (WHERE question_type IN ('emoji','stars') AND score=4)::int AS satisfied_low_count,
             COUNT(*) FILTER (WHERE question_type IN ('emoji','stars') AND score=5)::int AS satisfied_high_count
        FROM scored`, params),
    pool.query(`${baseSql}
      SELECT survey_id,survey_title,device_id,device_name,location_id,location_name,COUNT(*)::int AS total,day
        FROM scored
       GROUP BY survey_id,survey_title,device_id,device_name,location_id,location_name,day
       ORDER BY day DESC,survey_title`, params),
  ]);

  const row = summary.rows[0];
  const total = Number(row.total || 0);
  const satisfiedCount = Number(row.satisfied_count || 0);
  const metrics = {
    total,
    averageScore: row.average_score === null ? null : Number(row.average_score),
    satisfiedCount,
    satisfiedRate: total ? Number(((satisfiedCount / total) * 100).toFixed(1)) : 0,
    neutralCount: Number(row.neutral_count || 0),
    neutralRate: total ? Number(((Number(row.neutral_count || 0) / total) * 100).toFixed(1)) : 0,
    dissatisfiedCount: Number(row.dissatisfied_count || 0),
    dissatisfiedRate: total ? Number(((Number(row.dissatisfied_count || 0) / total) * 100).toFixed(1)) : 0,
  };
  let distributionOptions = DEFAULT_EMOJI_OPTIONS;
  if (surveyId) {
    const configured = await pool.query(
      'SELECT options FROM questions WHERE survey_id=$1 AND type=$2 ORDER BY position,id LIMIT 1',
      [surveyId, 'emoji'],
    );
    if (configured.rowCount) distributionOptions = normalizeEmojiOptions(configured.rows[0].options);
  }
  const counts = [row.very_dissatisfied_count, row.dissatisfied_low_count, row.neutral_distribution_count, row.satisfied_low_count, row.satisfied_high_count];
  const distribution = distributionOptions.map((option, index) => ({ ...option, count: Number(counts[index] || 0) }));
  res.json({ filters: { tenantId, from, to, surveyId, locationId, deviceId }, metrics, distribution, rows: rows.rows });
}));

app.post('/api/devices/register', pairingLimiter, asyncRoute(async (req, res) => {
  const deviceId = cleanText(req.body?.deviceId, 80);
  const activationCode = cleanText(req.body?.activationCode, 6);
  const deviceSecretHash = cleanText(req.body?.deviceSecretHash, 64).toLowerCase();
  if (!/^[a-zA-Z0-9-]{16,80}$/.test(deviceId)) return res.status(400).json({ error: 'invalid_device_id' });
  if (!/^\d{6}$/.test(activationCode)) return res.status(400).json({ error: 'invalid_activation_code' });
  if (!/^[a-f0-9]{64}$/.test(deviceSecretHash)) return res.status(400).json({ error: 'invalid_device_secret_hash' });

  const existing = await pool.query('SELECT * FROM devices WHERE device_id=$1', [deviceId]);
  if (existing.rowCount) {
    const device = existing.rows[0];
    if (device.tenant_id) {
      if (!secureHashEqual(device.device_secret_hash, deviceSecretHash)) {
        return res.status(409).json({ error: 'device_already_paired' });
      }
      return res.json({ status: 'paired', deviceId: device.id });
    }
    try {
      await pool.query(
        `UPDATE devices
            SET device_secret_hash=$1, activation_code=$2,
                activation_expires_at=now()+interval '24 hours', updated_at=now()
          WHERE id=$3`,
        [deviceSecretHash, activationCode, device.id],
      );
      return res.json({ status: 'unpaired', activationCode });
    } catch (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'activation_code_conflict' });
      throw error;
    }
  }

  try {
    await pool.query(
      `INSERT INTO devices(device_id,device_secret_hash,activation_code,activation_expires_at)
       VALUES($1,$2,$3,now()+interval '24 hours')`,
      [deviceId, deviceSecretHash, activationCode],
    );
    res.status(201).json({ status: 'unpaired', activationCode });
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'activation_code_conflict' });
    throw error;
  }
}));

app.post('/api/devices/pair', pairingLimiter, auth, asyncRoute(async (req, res) => {
  if (!requireManager(req, res)) return;
  const activationCode = cleanText(req.body?.activationCode, 6);
  const tenantId = tenantForUser(req, req.body?.tenantId);
  const locationName = cleanText(req.body?.locationName || 'Recepção', 160);
  const deviceName = cleanText(req.body?.deviceName || `Tablet ${activationCode}`, 160);
  if (!tenantId || !/^\d{6}$/.test(activationCode)) {
    return res.status(400).json({ error: 'Empresa e código de pareamento são obrigatórios.' });
  }
  if (!(await tenantExists(tenantId))) return res.status(404).json({ error: 'Empresa não encontrada.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const deviceResult = await client.query(
      `SELECT * FROM devices
        WHERE activation_code=$1 AND tenant_id IS NULL AND activation_expires_at > now()
        FOR UPDATE`,
      [activationCode],
    );
    if (!deviceResult.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Código inválido ou expirado.' });
    }
    const tenantLimit = await client.query('SELECT device_limit FROM tenants WHERE id=$1 FOR UPDATE', [tenantId]);
    if (!tenantLimit.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Empresa não encontrada.' });
    }
    const activeDeviceCount = await client.query(
      'SELECT COUNT(*)::int AS total FROM devices WHERE tenant_id=$1 AND active=true',
      [tenantId],
    );
    if (activeDeviceCount.rows[0].total >= tenantLimit.rows[0].device_limit) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: `Limite de ${tenantLimit.rows[0].device_limit} tablets atingido. Ajuste o limite com o superadministrador.`,
      });
    }
    let locationResult = await client.query(
      'SELECT id,name FROM locations WHERE tenant_id=$1 AND lower(name)=lower($2) LIMIT 1',
      [tenantId, locationName],
    );
    if (!locationResult.rowCount) {
      locationResult = await client.query(
        'INSERT INTO locations(tenant_id,name) VALUES($1,$2) RETURNING id,name',
        [tenantId, locationName],
      );
    }
    const updated = await client.query(
      `UPDATE devices
          SET tenant_id=$1, location_id=$2, name=$3, activation_code=NULL,
              activation_expires_at=NULL, paired_at=now(), updated_at=now()
        WHERE id=$4
        RETURNING id,device_id,name,tenant_id,location_id,paired_at`,
      [tenantId, locationResult.rows[0].id, deviceName, deviceResult.rows[0].id],
    );
    await client.query('COMMIT');
    res.json({ ...updated.rows[0], location: locationResult.rows[0].name });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}));

app.get('/api/devices', auth, async (req, res) => {
  const tenantId = tenantForUser(req, req.query.tenantId);
  const params = [];
  let where = '';
  if (req.user.role !== 'SUPERADMIN' || tenantId) {
    if (!tenantId) return res.json([]);
    params.push(tenantId);
    where = 'WHERE d.tenant_id=$1';
  }
  const result = await pool.query(
    `SELECT d.id,d.device_id,d.name,d.tenant_id,d.location_id,d.active,d.active_survey_id,d.app_version,d.last_seen_at,d.paired_at,
            d.status,d.platform,d.android_version,d.manufacturer,d.model,d.battery_level,d.charging,d.network_state,
            d.pending_responses,d.kiosk_state,d.orientation,d.config_version,
            l.name AS location_name,s.title AS active_survey_title,
            CASE WHEN d.last_seen_at >= now()-interval '90 seconds' THEN 'online' ELSE 'offline' END AS runtime_status
       FROM devices d
       LEFT JOIN locations l ON l.id=d.location_id
       LEFT JOIN surveys s ON s.id=d.active_survey_id
       ${where}
       ORDER BY d.created_at DESC`,
    params,
  );
  res.json(result.rows);
});

async function loadManagedDevice(req, res, deviceId) {
  const result = await pool.query('SELECT id,tenant_id,active FROM devices WHERE id=$1', [deviceId]);
  if (!result.rowCount || !result.rows[0].tenant_id) {
    res.status(404).json({ error: 'Tablet não encontrado.' });
    return null;
  }
  if (!canAccessTenant(req, result.rows[0].tenant_id)) {
    res.sendStatus(403);
    return null;
  }
  return result.rows[0];
}

app.patch('/api/devices/:id', auth, asyncRoute(async (req, res) => {
  if (!requireManager(req, res)) return;
  const deviceId = asPositiveInt(req.params.id);
  if (!deviceId) return res.status(400).json({ error: 'Tablet inválido.' });
  const device = await loadManagedDevice(req, res, deviceId);
  if (!device) return;
  const name = req.body?.name === undefined ? null : cleanText(req.body.name, 160);
  const locationName = req.body?.locationName === undefined ? null : cleanText(req.body.locationName, 160);
  const active = req.body?.active === undefined ? null : req.body.active === true;
  if (req.body?.name !== undefined && !name) return res.status(400).json({ error: 'O nome do tablet é obrigatório.' });
  if (req.body?.locationName !== undefined && !locationName) return res.status(400).json({ error: 'A unidade é obrigatória.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (active === true && !device.active) {
      const tenantLimit = await client.query('SELECT device_limit FROM tenants WHERE id=$1 FOR UPDATE', [device.tenant_id]);
      const activeDeviceCount = await client.query(
        'SELECT COUNT(*)::int AS total FROM devices WHERE tenant_id=$1 AND active=true',
        [device.tenant_id],
      );
      if (activeDeviceCount.rows[0].total >= tenantLimit.rows[0].device_limit) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: `Limite de ${tenantLimit.rows[0].device_limit} tablets atingido. Ajuste o limite com o superadministrador.`,
        });
      }
    }
    let locationId = null;
    if (locationName) {
      const location = await client.query(
        `INSERT INTO locations(tenant_id,name) VALUES($1,$2)
         ON CONFLICT (tenant_id,lower(name)) DO UPDATE SET name=EXCLUDED.name
         RETURNING id`,
        [device.tenant_id, locationName],
      );
      locationId = location.rows[0].id;
    }
    await client.query(
      `UPDATE devices
          SET name=COALESCE($1,name),location_id=COALESCE($2,location_id),active=COALESCE($3,active),updated_at=now()
        WHERE id=$4`,
      [name, locationId, active, deviceId],
    );
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}));

app.post('/api/devices/:id/refresh-config', auth, asyncRoute(async (req, res) => {
  if (!requireManager(req, res)) return;
  const deviceId = asPositiveInt(req.params.id);
  const device = await loadManagedDevice(req, res, deviceId);
  if (!device) return;
  const result = await pool.query(
    'UPDATE devices SET config_version=config_version+1,updated_at=now() WHERE id=$1 RETURNING config_version',
    [deviceId],
  );
  res.json({ ok: true, configVersion: result.rows[0].config_version });
}));

app.post('/api/devices/:id/remove-survey', auth, asyncRoute(async (req, res) => {
  if (!requireManager(req, res)) return;
  const deviceId = asPositiveInt(req.params.id);
  const device = await loadManagedDevice(req, res, deviceId);
  if (!device) return;
  await pool.query('UPDATE devices SET active_survey_id=NULL,config_version=config_version+1,updated_at=now() WHERE id=$1', [deviceId]);
  res.json({ ok: true });
}));

app.post('/api/devices/:id/unpair', auth, asyncRoute(async (req, res) => {
  if (!requireManager(req, res)) return;
  const deviceId = asPositiveInt(req.params.id);
  const device = await loadManagedDevice(req, res, deviceId);
  if (!device) return;
  await pool.query(
    `UPDATE devices
        SET tenant_id=NULL,location_id=NULL,active_survey_id=NULL,activation_code=NULL,
            activation_expires_at=NULL,paired_at=NULL,status='unknown',config_version=config_version+1,updated_at=now()
      WHERE id=$1`,
    [deviceId],
  );
  res.json({ ok: true });
}));

app.delete('/api/devices/:id', auth, asyncRoute(async (req, res) => {
  if (!requireManager(req, res)) return;
  const deviceId = asPositiveInt(req.params.id);
  const device = await loadManagedDevice(req, res, deviceId);
  if (!device) return;
  await pool.query('UPDATE devices SET active=false,active_survey_id=NULL,status=\'offline\',config_version=config_version+1,updated_at=now() WHERE id=$1', [deviceId]);
  res.json({ ok: true, deactivated: true });
}));

app.post('/api/devices/:id/assign-survey', auth, async (req, res) => {
  if (!requireManager(req, res)) return;
  const deviceId = asPositiveInt(req.params.id);
  const surveyId = asPositiveInt(req.body?.surveyId);
  if (!deviceId || !surveyId) return res.status(400).json({ error: 'Tablet e pesquisa são obrigatórios.' });

  const device = await pool.query('SELECT id,tenant_id FROM devices WHERE id=$1', [deviceId]);
  if (!device.rowCount || !device.rows[0].tenant_id) return res.status(404).json({ error: 'Tablet não encontrado.' });
  const tenantId = device.rows[0].tenant_id;
  if (!canAccessTenant(req, tenantId)) return res.sendStatus(403);
  const activeDevice = await pool.query('SELECT active FROM devices WHERE id=$1', [deviceId]);
  if (!activeDevice.rows[0]?.active) return res.status(409).json({ error: 'Tablet desativado.' });
  const survey = await pool.query('SELECT id FROM surveys WHERE id=$1 AND tenant_id=$2', [surveyId, tenantId]);
  if (!survey.rowCount) return res.status(400).json({ error: 'A pesquisa não pertence à empresa do tablet.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE devices SET active_survey_id=$1,config_version=config_version+1,updated_at=now() WHERE id=$2', [surveyId, deviceId]);
    await client.query('UPDATE surveys SET published=true WHERE id=$1', [surveyId]);
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
});

app.post('/api/devices/heartbeat', deviceAuth, asyncRoute(async (req, res) => {
  const appVersion = cleanText(req.body?.appVersion, 40) || 'unknown';
  const telemetry = normalizeTelemetry(req.body?.telemetry || req.body);
  await pool.query(
    `UPDATE devices
        SET status='online',app_version=$1,platform=$2,android_version=$3,manufacturer=$4,model=$5,
            battery_level=$6,charging=$7,network_state=$8,pending_responses=$9,kiosk_state=$10,
            orientation=$11,last_seen_at=now(),updated_at=now()
      WHERE id=$12 AND active=true`,
    [appVersion, telemetry.platform, telemetry.androidVersion, telemetry.manufacturer, telemetry.model,
      telemetry.batteryLevel, telemetry.charging, telemetry.networkState, telemetry.pendingResponses,
      telemetry.kioskState, telemetry.orientation, req.device.id],
  );
  const currentConfigVersion = asPositiveInt(req.body?.currentConfigVersion);
  res.json({
    ok: true,
    configVersion: req.device.config_version,
    configChanged: currentConfigVersion !== req.device.config_version,
  });
}));

app.get('/api/devices/config', deviceAuth, asyncRoute(async (req, res) => {
  await pool.query("UPDATE devices SET status='online',last_seen_at=now(),updated_at=now() WHERE id=$1 AND active=true", [req.device.id]);
  const currentConfigVersion = asPositiveInt(req.query.currentConfigVersion);
  if (currentConfigVersion && currentConfigVersion === req.device.config_version) {
    return res.json({ status: 'unchanged', deviceId: req.device.device_id, configVersion: req.device.config_version });
  }
  if (!req.device.tenant_id) return res.json({ status: 'unpaired', deviceId: req.device.device_id, configVersion: req.device.config_version, survey: null });
  if (!req.device.active_survey_id) {
    return res.json({ status: 'paired', deviceId: req.device.device_id, deviceName: req.device.name, configVersion: req.device.config_version, survey: null });
  }

  const survey = await pool.query(
    'SELECT id,title,description,theme FROM surveys WHERE id=$1 AND tenant_id=$2 AND published=true',
    [req.device.active_survey_id, req.device.tenant_id],
  );
  if (!survey.rowCount) return res.json({ status: 'paired', configVersion: req.device.config_version, survey: null });
  const questions = await pool.query(
    'SELECT id,text,type,position,options FROM questions WHERE survey_id=$1 ORDER BY position,id',
    [survey.rows[0].id],
  );
  const branding = await loadSurveyBranding(survey.rows[0].id);
  res.json({
    status: 'paired',
    deviceId: req.device.device_id,
    deviceName: req.device.name,
    configVersion: req.device.config_version,
    survey: { ...survey.rows[0], questions: questions.rows, ...branding },
  });
}));

app.post('/api/devices/responses', deviceAuth, async (req, res) => {
  const surveyId = asPositiveInt(req.body?.surveyId);
  const submissionId = cleanText(req.body?.submissionId, 80);
  const answers = req.body?.answers;
  if (!surveyId || !/^[a-zA-Z0-9-]{16,80}$/.test(submissionId) || !answers || typeof answers !== 'object' || Array.isArray(answers)) {
    return res.status(400).json({ error: 'invalid_response' });
  }
  if (!req.device.tenant_id) return res.status(409).json({ error: 'device_not_paired' });
  if (cleanText(req.body?.deviceId, 80) !== req.device.device_id) return res.status(400).json({ error: 'invalid_device' });
  if (!req.device.active_survey_id || req.device.active_survey_id !== surveyId) {
    return res.status(409).json({ error: 'survey_not_assigned_to_device' });
  }
  const survey = await pool.query(
    'SELECT id FROM surveys WHERE id=$1 AND tenant_id=$2 AND published=true',
    [surveyId, req.device.tenant_id],
  );
  if (!survey.rowCount) return res.status(409).json({ error: 'survey_not_available_for_device' });

  const questions = await pool.query('SELECT id,type,options FROM questions WHERE survey_id=$1 ORDER BY position,id', [surveyId]);
  const questionMap = new Map(questions.rows.map((row) => [String(row.id), row]));
  const submittedIds = Object.keys(answers);
  if (submittedIds.length !== questionMap.size || submittedIds.some((id) => !questionMap.has(String(id)))) {
    return res.status(400).json({ error: 'invalid_answers' });
  }
  for (const [questionId, value] of Object.entries(answers)) {
    const question = questionMap.get(String(questionId));
    const normalized = String(value ?? '').trim();
    const valid = question.type === 'emoji' || question.type === 'stars'
      ? /^[1-5]$/.test(normalized)
      : question.type === 'scale'
        ? /^(10|[1-9])$/.test(normalized)
        : Array.isArray(question.options) && question.options.includes(normalized);
    if (!valid) return res.status(400).json({ error: 'invalid_answers' });
  }

  let answeredAt = null;
  if (req.body?.answeredAt) {
    const timestamp = Date.parse(req.body.answeredAt);
    const now = Date.now();
    if (Number.isFinite(timestamp) && timestamp <= now + 5 * 60_000 && timestamp >= now - 30 * 24 * 60 * 60_000) {
      answeredAt = new Date(timestamp).toISOString();
    }
  }

  const inserted = await pool.query(
    `INSERT INTO responses(survey_id,device_id,location_id,submission_id,answered_at,answers)
     VALUES($1,$2,$3,$4,$5,$6::jsonb)
     ON CONFLICT DO NOTHING
     RETURNING id,created_at`,
    [surveyId, req.device.id, req.device.location_id, submissionId, answeredAt, JSON.stringify(answers)],
  );
  await pool.query('UPDATE devices SET last_seen_at=now(),updated_at=now() WHERE id=$1', [req.device.id]);
  res.status(inserted.rowCount ? 201 : 200).json({ ok: true, deduplicated: !inserted.rowCount });
});

app.get('/api/health', async (_req, res) => {
  await pool.query('SELECT 1');
  res.json({ ok: true });
});

app.get('*', (req, res) => {
  if (!req.path.startsWith('/api/')) res.sendFile(path.join(__dirname, '..', 'dist', 'index.html'));
});

app.use((error, _req, res, _next) => {
  console.error(error);
  if (res.headersSent) return;
  res.status(500).json({ error: 'Erro interno.' });
});

runMigrations()
  .then(bootstrapAdmin)
  .then(async () => {
    await mkdir(logoAssetsDir, { recursive: true });
    app.listen(process.env.PORT || 4000, () => console.log('Opina API em http://localhost:4000'));
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
