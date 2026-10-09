import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { after, before, test } from 'node:test';
import pg from 'pg';

const { Pool } = pg;
const port = 4107;
const baseUrl = `http://127.0.0.1:${port}`;
const tag = randomUUID().slice(0, 8);
const adminEmail = `qa-${tag}@opina.test`;
const adminPassword = `Qa-${randomUUID()}-Secure`;
const databaseUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || 'postgres://opina:opina@localhost:5433/opina_ai';
const pool = new Pool({ connectionString: databaseUrl });
let server;
let tenantNames;
let databaseReady = false;

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function api(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(options.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

async function login(email, password) {
  const { response, body } = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
  assert.equal(response.status, 200, JSON.stringify(body));
  return body.token;
}

function hash(value) { return createHash('sha256').update(value).digest('hex'); }

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const { response } = await api('/api/health');
      if (response.ok) return;
    } catch { /* server is still starting */ }
    await sleep(250);
  }
  throw new Error('Servidor de integração não iniciou.');
}

before(async () => {
  try {
    await pool.query('SELECT 1');
    databaseReady = true;
  } catch { return; }
  tenantNames = [`Tenant A ${tag}`, `Tenant B ${tag}`];
  server = spawn(process.execPath, ['server/index.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(port),
      DATABASE_URL: databaseUrl,
      JWT_SECRET: `test-${randomUUID()}-${randomUUID()}`,
      BOOTSTRAP_ADMIN_NAME: `QA ${tag}`,
      BOOTSTRAP_ADMIN_EMAIL: adminEmail,
      BOOTSTRAP_ADMIN_PASSWORD: adminPassword,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  server.stdout.on('data', (chunk) => { output += chunk.toString(); });
  server.stderr.on('data', (chunk) => { output += chunk.toString(); });
  try {
    await waitForServer();
  } catch (error) {
    throw new Error(`${error.message}\n${output}`);
  }
});

after(async () => {
  if (!databaseReady) {
    await pool.end();
    return;
  }
  if (tenantNames?.length) await pool.query('DELETE FROM tenants WHERE name = ANY($1)', [tenantNames]);
  await pool.end();
  if (server && !server.killed) server.kill();
});

test('integra autenticação, isolamento, pareamento, respostas e relatório', async (context) => {
  if (!databaseReady) {
    context.skip('PostgreSQL local indisponível; a integração roda no CI com o serviço de banco ativo.');
    return;
  }
  const superToken = await login(adminEmail, adminPassword);
  const invalidLogin = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: adminEmail, password: 'senha-incorreta' }) });
  assert.equal(invalidLogin.response.status, 401);

  const tenantAPassword = `AdminA-${randomUUID()}`;
  const tenantBPassword = `AdminB-${randomUUID()}`;
  const tenantAResult = await api('/api/tenants', {
    method: 'POST', token: superToken,
    body: JSON.stringify({ name: tenantNames[0], email: `admin-a-${tag}@opina.test`, password: tenantAPassword }),
  });
  assert.equal(tenantAResult.response.status, 201, JSON.stringify(tenantAResult.body));
  const tenantBResult = await api('/api/tenants', {
    method: 'POST', token: superToken,
    body: JSON.stringify({ name: tenantNames[1], email: `admin-b-${tag}@opina.test`, password: tenantBPassword }),
  });
  assert.equal(tenantBResult.response.status, 201, JSON.stringify(tenantBResult.body));
  const tenantA = tenantAResult.body.tenant.id;
  const tenantB = tenantBResult.body.tenant.id;
  const adminAEmail = tenantAResult.body.user.email;
  const adminBEmail = tenantBResult.body.user.email;
  let adminAToken = await login(adminAEmail, tenantAPassword);
  const adminBToken = await login(adminBEmail, tenantBPassword);
  const rotatedPassword = `${tenantAPassword}-rotated`;
  const changePassword = await api('/api/auth/change-password', {
    method: 'POST', token: adminAToken,
    body: JSON.stringify({ currentPassword: tenantAPassword, newPassword: rotatedPassword }),
  });
  assert.equal(changePassword.response.status, 200, JSON.stringify(changePassword.body));
  adminAToken = await login(adminAEmail, rotatedPassword);

  const surveyAResult = await api('/api/surveys', {
    method: 'POST', token: superToken,
    body: JSON.stringify({ tenantId: tenantA, title: `Atendimento ${tag}`, description: 'Como você avalia sua experiência?', questions: [{ text: 'Como você avalia sua experiência?', type: 'emoji', options: [] }] }),
  });
  assert.equal(surveyAResult.response.status, 201, JSON.stringify(surveyAResult.body));
  const surveyA = surveyAResult.body;
  const starSurveyResult = await api('/api/surveys', {
    method: 'POST', token: superToken,
    body: JSON.stringify({ tenantId: tenantA, title: `Avaliação por estrelas ${tag}`, description: 'Avalie com estrelas', questions: [{ text: 'Avalie com estrelas', type: 'stars', options: [] }] }),
  });
  assert.equal(starSurveyResult.response.status, 201, JSON.stringify(starSurveyResult.body));
  const starSurvey = await api(`/api/surveys/${starSurveyResult.body.id}`, { token: superToken });
  assert.equal(starSurvey.response.status, 200, JSON.stringify(starSurvey.body));
  assert.equal(starSurvey.body.questions[0].type, 'stars');
  const surveyBResult = await api('/api/surveys', {
    method: 'POST', token: superToken,
    body: JSON.stringify({ tenantId: tenantB, title: `Pesquisa B ${tag}`, description: 'Pergunta B', questions: [{ text: 'Pergunta B', type: 'emoji', options: [] }] }),
  });
  assert.equal(surveyBResult.response.status, 201, JSON.stringify(surveyBResult.body));

  const deviceAId = `test-device-${tag}-a`;
  const deviceASecret = `secret-a-${randomUUID()}`;
  const deviceBId = `test-device-${tag}-b`;
  const deviceBSecret = `secret-b-${randomUUID()}`;
  const registerA = await api('/api/devices/register', { method: 'POST', body: JSON.stringify({ deviceId: deviceAId, activationCode: '654321', deviceSecretHash: hash(deviceASecret) }) });
  const registerB = await api('/api/devices/register', { method: 'POST', body: JSON.stringify({ deviceId: deviceBId, activationCode: '654322', deviceSecretHash: hash(deviceBSecret) }) });
  assert.equal(registerA.response.status, 201, JSON.stringify(registerA.body));
  assert.equal(registerB.response.status, 201, JSON.stringify(registerB.body));
  const pairA = await api('/api/devices/pair', { method: 'POST', token: superToken, body: JSON.stringify({ tenantId: tenantA, activationCode: '654321', locationName: 'Recepção', deviceName: 'Tablet A' }) });
  const pairB = await api('/api/devices/pair', { method: 'POST', token: superToken, body: JSON.stringify({ tenantId: tenantB, activationCode: '654322', locationName: 'Recepção', deviceName: 'Tablet B' }) });
  assert.equal(pairA.response.status, 200, JSON.stringify(pairA.body));
  assert.equal(pairB.response.status, 200, JSON.stringify(pairB.body));

  const deviceA = pairA.body.id;
  const deviceB = pairB.body.id;
  const assign = await api(`/api/devices/${deviceA}/assign-survey`, { method: 'POST', token: adminAToken, body: JSON.stringify({ surveyId: surveyA.id }) });
  assert.equal(assign.response.status, 200, JSON.stringify(assign.body));
  const editSurvey = await api(`/api/surveys/${surveyA.id}`, {
    method: 'PATCH', token: adminAToken,
    body: JSON.stringify({ title: `Atendimento atualizado ${tag}`, questions: [{ text: 'Como você avalia sua experiência hoje?', type: 'emoji', options: [] }] }),
  });
  assert.equal(editSurvey.response.status, 200, JSON.stringify(editSurvey.body));
  const readSurvey = await api(`/api/surveys/${surveyA.id}`, { token: adminAToken });
  assert.equal(readSurvey.response.status, 200, JSON.stringify(readSurvey.body));
  assert.equal(readSurvey.body.questions.length, 1);
  const editDevice = await api(`/api/devices/${deviceA}`, {
    method: 'PATCH', token: adminAToken,
    body: JSON.stringify({ name: 'Tablet A Editado', locationName: 'Unidade A', active: true }),
  });
  assert.equal(editDevice.response.status, 200, JSON.stringify(editDevice.body));
  const removeSurvey = await api(`/api/devices/${deviceA}/remove-survey`, { method: 'POST', token: adminAToken });
  assert.equal(removeSurvey.response.status, 200, JSON.stringify(removeSurvey.body));
  const reassign = await api(`/api/devices/${deviceA}/assign-survey`, { method: 'POST', token: adminAToken, body: JSON.stringify({ surveyId: surveyA.id }) });
  assert.equal(reassign.response.status, 200, JSON.stringify(reassign.body));
  const crossAssign = await api(`/api/devices/${deviceA}/assign-survey`, { method: 'POST', token: adminBToken, body: JSON.stringify({ surveyId: surveyA.id }) });
  assert.equal(crossAssign.response.status, 403);
  const bDevices = await api('/api/devices', { token: adminBToken });
  assert.equal(bDevices.response.status, 200);
  assert.deepEqual(bDevices.body.map((device) => device.id), [deviceB]);

  const deviceConfig = await api(`/api/devices/config?deviceId=${encodeURIComponent(deviceAId)}`, { headers: { Authorization: `Bearer ${deviceASecret}` } });
  assert.equal(deviceConfig.response.status, 200, JSON.stringify(deviceConfig.body));
  assert.equal(deviceConfig.body.survey.id, surveyA.id);
  assert.ok(deviceConfig.body.configVersion > 0);
  const unchangedConfig = await api(`/api/devices/config?deviceId=${encodeURIComponent(deviceAId)}&currentConfigVersion=${deviceConfig.body.configVersion}`, { headers: { Authorization: `Bearer ${deviceASecret}` } });
  assert.equal(unchangedConfig.response.status, 200, JSON.stringify(unchangedConfig.body));
  assert.equal(unchangedConfig.body.status, 'unchanged');
  const telemetryHeartbeat = await api('/api/devices/heartbeat', {
    method: 'POST', headers: { Authorization: `Bearer ${deviceASecret}` },
    body: JSON.stringify({
      deviceId: deviceAId,
      appVersion: 'android-kiosk/1.0.0',
      currentConfigVersion: deviceConfig.body.configVersion,
      platform: 'android', androidVersion: '13', manufacturer: 'LENOVO', model: 'TB310FU',
      batteryLevel: 82, charging: true, networkState: 'wifi', pendingResponses: 2,
      kioskState: 'active', orientation: 'portrait',
    }),
  });
  assert.equal(telemetryHeartbeat.response.status, 200, JSON.stringify(telemetryHeartbeat.body));
  assert.equal(telemetryHeartbeat.body.configChanged, false);
  const managedDevices = await api('/api/devices', { token: adminAToken });
  const managedDeviceA = managedDevices.body.find((device) => String(device.id) === String(deviceA));
  assert.equal(managedDeviceA.platform, 'android');
  assert.equal(managedDeviceA.orientation, 'portrait');
  assert.equal(managedDeviceA.pending_responses, 2);
  const forceRefresh = await api(`/api/devices/${deviceA}/refresh-config`, { method: 'POST', token: adminAToken });
  assert.equal(forceRefresh.response.status, 200, JSON.stringify(forceRefresh.body));
  assert.ok(forceRefresh.body.configVersion > deviceConfig.body.configVersion);
  const refreshedConfig = await api(`/api/devices/config?deviceId=${encodeURIComponent(deviceAId)}&currentConfigVersion=${deviceConfig.body.configVersion}`, { headers: { Authorization: `Bearer ${deviceASecret}` } });
  assert.equal(refreshedConfig.body.survey.id, surveyA.id);
  const questionId = deviceConfig.body.survey.questions[0].id;
  const submissionId = randomUUID();
  const responsePayload = { deviceId: deviceAId, surveyId: surveyA.id, submissionId, answeredAt: new Date(Date.now() - 1000).toISOString(), answers: { [questionId]: '5' } };
  const answer = await api('/api/devices/responses', { method: 'POST', headers: { Authorization: `Bearer ${deviceASecret}` }, body: JSON.stringify(responsePayload) });
  assert.equal(answer.response.status, 201, JSON.stringify(answer.body));
  const duplicate = await api('/api/devices/responses', { method: 'POST', headers: { Authorization: `Bearer ${deviceASecret}` }, body: JSON.stringify(responsePayload) });
  assert.equal(duplicate.response.status, 200);
  assert.equal(duplicate.body.deduplicated, true);
  const invalidAnswer = await api('/api/devices/responses', { method: 'POST', headers: { Authorization: `Bearer ${deviceASecret}` }, body: JSON.stringify({ ...responsePayload, submissionId: randomUUID(), answers: { [questionId]: '9' } }) });
  assert.equal(invalidAnswer.response.status, 400);
  const dbCount = await pool.query('SELECT COUNT(*)::int AS count FROM responses WHERE submission_id=$1', [submissionId]);
  assert.equal(dbCount.rows[0].count, 1);

  const reportA = await api('/api/reports', { token: adminAToken });
  assert.equal(reportA.response.status, 200, JSON.stringify(reportA.body));
  assert.equal(reportA.body.metrics.total, 1);
  assert.equal(reportA.body.metrics.averageScore, 5);
  assert.equal(reportA.body.metrics.satisfiedRate, 100);
  assert.equal(reportA.body.distribution.find((item) => item.value === '5').count, 1);
  const reportByDevice = await api(`/api/reports?deviceId=${encodeURIComponent(deviceA)}`, { token: adminAToken });
  assert.equal(reportByDevice.response.status, 200, JSON.stringify(reportByDevice.body));
  assert.equal(reportByDevice.body.metrics.total, 1);
  assert.equal(reportByDevice.body.distribution.find((item) => item.value === '5').count, 1);
  const reportB = await api('/api/reports', { token: adminBToken });
  assert.equal(reportB.body.metrics.total, 0);

  const wrongDeviceAuth = await api(`/api/devices/config?deviceId=${encodeURIComponent(deviceAId)}`, { headers: { Authorization: 'Bearer wrong-secret' } });
  assert.equal(wrongDeviceAuth.response.status, 401);
  const crossSurveyResponse = await api('/api/devices/responses', { method: 'POST', headers: { Authorization: `Bearer ${deviceBSecret}` }, body: JSON.stringify({ deviceId: deviceBId, surveyId: surveyA.id, submissionId: randomUUID(), answers: { [surveyA.questions?.[0]?.id || questionId]: '5' } }) });
  assert.equal(crossSurveyResponse.response.status, 409);
  const crossPatch = await api(`/api/devices/${deviceA}`, { method: 'PATCH', token: adminBToken, body: JSON.stringify({ name: 'Invadido' }) });
  assert.equal(crossPatch.response.status, 403);
  const crossSurvey = await api(`/api/surveys/${surveyA.id}`, { token: adminBToken });
  assert.equal(crossSurvey.response.status, 403);
});

test('rate limit separa clientes encaminhados pelo proxy confiável', async () => {
  const suffix = Number.parseInt(tag.slice(0, 2), 16) % 254 + 1;
  const firstIp = `198.51.100.${suffix}`;
  const secondIp = `203.0.113.${suffix}`;
  const invalidLogin = (ip) => api('/api/auth/login', {
    method: 'POST',
    headers: { 'X-Forwarded-For': ip },
    body: JSON.stringify({ email: `missing-${tag}@opina.test`, password: 'invalid' }),
  });

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const { response } = await invalidLogin(firstIp);
    assert.equal(response.status, 401);
  }
  assert.equal((await invalidLogin(firstIp)).response.status, 429);
  assert.equal((await invalidLogin(secondIp)).response.status, 401);
});
