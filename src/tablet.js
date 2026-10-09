import './tablet.css';
import { apiUrl, isNativeRuntime } from './api.js';

const KEYS = {
  deviceId: 'opina_device_id',
  secret: 'opina_device_secret',
  activation: 'opina_activation_code',
  pending: 'opina_pending_responses',
  surveyCache: 'opina_last_valid_survey',
  configVersion: 'opina_config_version',
};
const WEB_APP_VERSION = 'web-kiosk/0.3.0';
const ANDROID_APP_VERSION = 'android-kiosk/1.1.0';
const DEFAULT_RATING_QUESTION = 'Como foi a sua experiência?';
const DEFAULT_SURVEY_HEADER = 'SUA OPINIÃO IMPORTA';
const DEFAULT_EMOJI_OPTIONS = [
  { value: '1', emoji: '😡', label: 'Péssimo', animation: 'shake' },
  { value: '2', emoji: '😕', label: 'Ruim', animation: 'float' },
  { value: '3', emoji: '😐', label: 'Regular', animation: 'pulse' },
  { value: '4', emoji: '🙂', label: 'Bom', animation: 'bounce' },
  { value: '5', emoji: '😍', label: 'Ótimo', animation: 'heart' },
];
const ALLOWED_EMOJI_ANIMATIONS = new Set(['shake', 'float', 'pulse', 'bounce', 'heart']);
const ALLOWED_LOGO_POSITIONS = new Set(['top', 'left', 'right', 'bottom']);
const MAX_PENDING = 200;

function randomSecret() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function activationCode() {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return String(100000 + (bytes[0] % 900000));
}

async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function secureStorage() {
  return globalThis.Capacitor?.Plugins?.OpinaSecureStorage || null;
}

async function secureGet(key) {
  const plugin = secureStorage();
  if (!plugin?.get) return localStorage.getItem(key);
  try {
    const result = await plugin.get({ key });
    return result?.value || null;
  } catch {
    return localStorage.getItem(key);
  }
}

async function secureSet(key, value) {
  const plugin = secureStorage();
  if (!plugin?.set) {
    localStorage.setItem(key, value);
    return;
  }
  try {
    await plugin.set({ key, value });
    localStorage.removeItem(key);
  } catch {
    localStorage.setItem(key, value);
  }
}

async function identity() {
  let deviceId = localStorage.getItem(KEYS.deviceId);
  let secret = await secureGet(KEYS.secret);
  let activation = localStorage.getItem(KEYS.activation);
  if (!deviceId) { deviceId = crypto.randomUUID(); localStorage.setItem(KEYS.deviceId, deviceId); }
  if (!secret) { secret = randomSecret(); await secureSet(KEYS.secret, secret); }
  if (!activation) { activation = activationCode(); localStorage.setItem(KEYS.activation, activation); }
  return { deviceId, secret, activation };
}

function ensureActivation(id) {
  const stored = localStorage.getItem(KEYS.activation);
  if (stored) { id.activation = stored; return; }
  id.activation = activationCode();
  localStorage.setItem(KEYS.activation, id.activation);
}

function appVersion() {
  return isNativeRuntime() ? ANDROID_APP_VERSION : WEB_APP_VERSION;
}

async function deviceRequest(path, id, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(apiUrl(path), {
      ...options,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${id.secret}`,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {}),
      },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data?.error || 'Falha de comunicação');
      error.status = response.status;
      throw error;
    }
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

function pendingQueue() {
  try {
    const queue = JSON.parse(localStorage.getItem(KEYS.pending) || '[]');
    return Array.isArray(queue) ? queue : [];
  } catch {
    return [];
  }
}

function saveQueue(queue) {
  const unique = [];
  const seen = new Set();
  for (const item of queue) {
    if (!item?.submissionId || seen.has(item.submissionId)) continue;
    seen.add(item.submissionId);
    unique.push(item);
  }
  localStorage.setItem(KEYS.pending, JSON.stringify(unique.slice(-MAX_PENDING)));
}

function cachedSurvey() {
  try { return JSON.parse(localStorage.getItem(KEYS.surveyCache) || 'null'); }
  catch { return null; }
}

function currentConfigVersion() {
  return Number(localStorage.getItem(KEYS.configVersion) || 0) || 0;
}

function saveSurveyCache(survey, configVersion) {
  if (survey?.id && Array.isArray(survey.questions)) {
    localStorage.setItem(KEYS.surveyCache, JSON.stringify(survey));
    if (Number.isSafeInteger(Number(configVersion)) && Number(configVersion) > 0) {
      localStorage.setItem(KEYS.configVersion, String(configVersion));
    }
  }
}

async function runtimeTelemetry() {
  const plugin = globalThis.Capacitor?.Plugins?.OpinaRuntime;
  const fallback = {
    platform: isNativeRuntime() ? 'android' : 'web',
    androidVersion: null,
    manufacturer: null,
    model: null,
    batteryLevel: null,
    charging: null,
    networkState: navigator.onLine ? 'online' : 'offline',
    kioskState: 'active',
    orientation: screen.orientation?.type?.startsWith('portrait') ? 'portrait' : 'unknown',
  };
  if (!plugin?.getInfo) return fallback;
  try {
    return { ...fallback, ...(await plugin.getInfo()) };
  } catch {
    return fallback;
  }
}

function isTransientError(error) {
  return !error?.status || error.status === 408 || error.status >= 500;
}

function safeImageDataUrl(value) {
  return /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(String(value || '')) ? value : '';
}

function applySurveyBackground(element, branding) {
  const backgroundData = safeImageDataUrl(branding?.backgroundData);
  if (!element || !backgroundData) return;
  element.style.backgroundImage = `linear-gradient(rgba(255,255,255,.82),rgba(255,255,255,.82)),url("${backgroundData}")`;
  element.style.backgroundPosition = 'center';
  element.style.backgroundSize = 'cover';
}

function emojiOptions(options) {
  return DEFAULT_EMOJI_OPTIONS.map((fallback, index) => {
    const item = Array.isArray(options) ? options[index] : null;
    return {
      value: String(index + 1),
      emoji: String(item?.emoji || (typeof item === 'string' ? item : fallback.emoji)).trim() || fallback.emoji,
      label: String(item?.label || fallback.label).trim() || fallback.label,
      animation: ALLOWED_EMOJI_ANIMATIONS.has(item?.animation) ? item.animation : fallback.animation,
    };
  });
}

export async function renderTablet(root) {
  let activeSurvey = null;
  let busy = false;
  let kioskUnlocked = false;
  let waitingForPairing = false;
  let previewReadOnly = false;
  const browserTestMode = !isNativeRuntime();

  if (browserTestMode) {
    const search = new URLSearchParams(location.search);
    const previewId = search.get('preview');
    let previewSurvey = null;
    if (previewId && /^[0-9a-f-]{36}$/i.test(previewId)) {
      const previewKey = `opina_survey_preview_${previewId}`;
      try { previewSurvey = JSON.parse(localStorage.getItem(previewKey) || 'null'); } catch { /* Ignore expired or invalid previews. */ }
      localStorage.removeItem(previewKey);
    }
    if (previewId && (!previewSurvey || !Array.isArray(previewSurvey.questions))) {
      root.innerHTML = '<main class="tablet-shell"><section class="tablet-card"><p class="tablet-kicker">PRÉ-VISUALIZAÇÃO</p><h1>Prévia indisponível</h1><p class="tablet-copy">Volte ao painel e abra a pré-visualização novamente.</p></section></main>';
      return;
    }
    const browserTestType = search.get('type') === 'emoji' ? 'emoji' : 'stars';
    renderSurvey({
      ...(previewSurvey || {
        id: 'browser-test-survey',
        questions: [{
          id: 'browser-test-question',
          text: DEFAULT_RATING_QUESTION,
          type: browserTestType,
          options: [],
        }],
      }),
    }, { readOnly: Boolean(previewId) });
    return;
  }

  root.innerHTML = '<main class="tablet-shell"><section class="tablet-card"><p class="tablet-kicker">OPINA AI</p><h1>Preparando este tablet...</h1><p class="tablet-copy">Conectando ao serviço.</p></section></main>';
  const id = await identity();
  installAdminGesture();

  function nativeRuntimePlugin() {
    return globalThis.Capacitor?.Plugins?.OpinaRuntime || null;
  }

  async function configureAdminPin() {
    const plugin = nativeRuntimePlugin();
    if (!plugin?.configureAdminPin || !/^\d{4,8}$/.test(id.activation)) return;
    try { await plugin.configureAdminPin({ pin: id.activation }); } catch { /* pairing can retry later */ }
  }

  function installAdminGesture() {
    let timer = null;
    const cancel = () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };
    root.addEventListener('touchstart', (event) => {
      if (event.touches.length < 2 || timer || kioskUnlocked) return;
      timer = setTimeout(() => {
        timer = null;
        showAdminExitDialog();
      }, 2000);
    }, { passive: true });
    root.addEventListener('touchend', (event) => { if (event.touches.length < 2) cancel(); }, { passive: true });
    root.addEventListener('touchcancel', cancel, { passive: true });
  }

  async function showAdminExitDialog() {
    if (root.querySelector('.kiosk-exit-dialog')) return;
    const plugin = nativeRuntimePlugin();
    let pinConfigured = true;
    try { pinConfigured = (await plugin?.getInfo?.())?.adminPinConfigured !== false; } catch { /* use exit mode */ }
    const dialog = document.createElement('div');
    dialog.className = 'kiosk-exit-dialog';
    dialog.innerHTML = `<div class="kiosk-exit-dialog__card" role="dialog" aria-modal="true" aria-labelledby="kiosk-exit-title"><p class="tablet-kicker">ACESSO ADMINISTRATIVO</p><h2 id="kiosk-exit-title">${pinConfigured ? 'Sair do modo quiosque' : 'Configurar acesso administrativo'}</h2><p>${pinConfigured ? 'Digite o PIN administrativo para liberar o tablet.' : 'Crie um PIN de 4 a 8 números. Ele ficará salvo somente neste tablet.'}</p><form>${pinConfigured ? '<label>PIN administrativo<input name="pin" type="password" inputmode="numeric" pattern="[0-9]{4,8}" minlength="4" maxlength="8" autocomplete="off" required></label>' : '<label>Novo PIN<input name="pin" type="password" inputmode="numeric" pattern="[0-9]{4,8}" minlength="4" maxlength="8" autocomplete="new-password" required></label><label>Confirmar PIN<input name="pinConfirm" type="password" inputmode="numeric" pattern="[0-9]{4,8}" minlength="4" maxlength="8" autocomplete="new-password" required></label>'}<p class="kiosk-exit-dialog__error" role="alert" hidden></p><div class="kiosk-exit-dialog__actions"><button class="kiosk-exit-dialog__cancel" type="button">Cancelar</button><button class="kiosk-exit-dialog__submit" type="submit">${pinConfigured ? 'Liberar tablet' : 'Definir e liberar'}</button></div></form></div>`;
    root.append(dialog);
    const form = dialog.querySelector('form');
    const input = form.querySelector('input');
    const error = dialog.querySelector('.kiosk-exit-dialog__error');
    dialog.querySelector('.kiosk-exit-dialog__cancel').onclick = () => dialog.remove();
    form.onsubmit = async (event) => {
      event.preventDefault();
      const plugin = nativeRuntimePlugin();
      if (!plugin?.exitKiosk) return;
      const submit = form.querySelector('.kiosk-exit-dialog__submit');
      submit.disabled = true;
      error.hidden = true;
      try {
        const pin = input.value.trim();
        if (!/^\d{4,8}$/.test(pin)) throw new Error('admin_pin_invalid');
        if (!pinConfigured) {
          if (pin !== form.querySelector('[name=pinConfirm]').value.trim()) throw new Error('admin_pin_mismatch');
          await plugin.configureAdminPin({ pin });
        }
        await plugin.exitKiosk({ pin });
        kioskUnlocked = true;
        dialog.remove();
        renderAdminUnlocked();
      } catch (unlockError) {
        error.textContent = unlockError?.message === 'admin_pin_mismatch' ? 'Os PINs não conferem.' : unlockError?.message === 'admin_pin_not_configured' ? 'Pareie o tablet no painel antes de sair do modo quiosque.' : 'PIN inválido.';
        error.hidden = false;
        submit.disabled = false;
        input.select();
      }
    };
    input.focus();
  }

  function renderAdminUnlocked() {
    root.innerHTML = '<main class="tablet-shell"><section class="tablet-card kiosk-unlocked-card"><p class="tablet-kicker">ACESSO ADMINISTRATIVO</p><h1>Tablet liberado</h1><p class="tablet-copy">O modo quiosque foi desativado temporariamente. Faça os ajustes necessários e bloqueie novamente antes de devolver o tablet ao atendimento.</p><button class="kiosk-reenter-button" type="button">Voltar ao modo quiosque</button></section></main>';
    root.querySelector('.kiosk-reenter-button').onclick = async () => {
      try { await nativeRuntimePlugin()?.reenterKiosk?.(); } finally {
        kioskUnlocked = false;
        if (activeSurvey) renderSurvey(activeSurvey);
        else await refreshConfig();
      }
    };
  }

  async function register() {
    ensureActivation(id);
    const body = { deviceId: id.deviceId, activationCode: id.activation, deviceSecretHash: await sha256(id.secret) };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    let response;
    try {
      response = await fetch(apiUrl('/api/devices/register'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
    const data = await response.json().catch(() => ({}));
    if (response.status === 409 && data.error === 'activation_code_conflict') {
      id.activation = activationCode();
      localStorage.setItem(KEYS.activation, id.activation);
      return register();
    }
    if (!response.ok && data.error !== 'device_already_paired') throw new Error(data.error || 'registration_failed');
    return data;
  }

  function renderPairing() {
    root.innerHTML = `<main class="tablet-shell"><section class="tablet-card pairing-card"><p class="tablet-kicker">PAREAMENTO</p><h1>Conecte este tablet</h1><p class="tablet-copy">No painel do Opina AI, abra <strong>Parear tablet</strong> e digite:</p><div class="pairing-code">${escapeHtml(id.activation)}</div><p class="device-hint">O código expira em até 24 horas. Este dispositivo continuará aguardando automaticamente.</p></section></main>`;
  }

  function renderWaiting(deviceName) {
    root.innerHTML = `<main class="tablet-shell"><section class="tablet-card waiting-card"><p class="tablet-kicker">${escapeHtml(deviceName || 'TABLET PAREADO')}</p><h1>Pronto para receber uma pesquisa</h1><p class="tablet-copy">Assim que uma pesquisa for associada no painel, ela aparecerá aqui automaticamente.</p><div class="waiting-dot" aria-hidden="true"></div></section></main>`;
  }

  function renderSurvey(survey, { readOnly = false } = {}) {
    activeSurvey = survey;
    previewReadOnly = readOnly;
    const questions = Array.isArray(survey.questions) ? survey.questions : [];
    const ratingConfirmation = questions.length === 1 && ['emoji', 'stars'].includes(questions[0]?.type);
    const quickSubmit = questions.length === 1 && !ratingConfirmation;
    const headerText = typeof survey.theme?.headerText === 'string' ? survey.theme.headerText : DEFAULT_SURVEY_HEADER;
    const logoData = safeImageDataUrl(survey.branding?.logoData);
    const logoPosition = ALLOWED_LOGO_POSITIONS.has(survey.theme?.logoPosition) ? survey.theme.logoPosition : 'top';
    const hasSideLogo = logoData && ['left', 'right'].includes(logoPosition);
    const logoMarkup = logoData
      ? `<div class="survey-brand-logo-slot survey-brand-logo-slot--${logoPosition}"><img class="survey-brand-logo" src="${escapeHtml(logoData)}" alt="Logo da pesquisa"></div>`
      : '';
    const previewBadge = previewReadOnly
      ? '<p class="tablet-preview-badge">PRÉ-VISUALIZAÇÃO · AVALIAÇÕES DESATIVADAS</p>'
      : browserTestMode ? '<p class="browser-test-badge">MODO DE TESTE · NENHUMA RESPOSTA É ENVIADA</p>' : '';
    const submitButton = previewReadOnly || quickSubmit || ratingConfirmation ? '' : '<button class="kiosk-submit" type="submit">Enviar avaliação</button>';
    root.innerHTML = `<main class="tablet-shell"><section class="survey-kiosk${hasSideLogo ? ' survey-kiosk--logo-side' : ''}${previewReadOnly ? ' survey-kiosk--preview-readonly' : ''}" data-logo-position="${logoPosition}">${logoPosition === 'bottom' ? '' : logoMarkup}<header>${headerText ? `<p class="tablet-kicker">${escapeHtml(headerText)}</p>` : ''}${previewBadge}</header><form id="kiosk-form" data-quick-submit="${quickSubmit}">${questions.map(renderQuestion).join('')}${submitButton}</form>${logoPosition === 'bottom' ? logoMarkup : ''}<footer>Opina AI · Pesquisa de satisfação</footer></section></main>`;
    applySurveyBackground(root.querySelector('.survey-kiosk'), survey.branding);
    const form = root.querySelector('#kiosk-form');
    form.onsubmit = previewReadOnly ? (event) => event.preventDefault() : submitSurvey;
    if (previewReadOnly) form.querySelectorAll('input,button').forEach((element) => { element.disabled = true; });
    if (quickSubmit && !previewReadOnly) form.addEventListener('change', submitSurvey);
    form.querySelectorAll('.rating-grid').forEach((grid) => {
      const inputs = [...grid.querySelectorAll('input')];
      const confirmation = form.querySelector(`[data-rating-confirm="${grid.dataset.ratingQuestion}"]`);
      inputs.forEach((input) => input.addEventListener('change', () => {
        const selectedValue = Number(input.value);
        if (grid.classList.contains('stars-grid')) {
          inputs.forEach((item) => item.closest('label')?.classList.toggle('is-filled', Number(item.value) <= selectedValue));
        }
        if (confirmation) {
          confirmation.hidden = false;
          confirmation.querySelector('[data-rating-value]').textContent = input.dataset.ratingLabel || input.value;
        }
      }));
      confirmation?.querySelector('.rating-confirm-button')?.addEventListener('click', () => submitSurvey({ preventDefault() {}, currentTarget: form }));
    });
  }

  function renderQuestion(question) {
    const name = `q-${question.id}`;
    if (question.type === 'stars') {
      return `<fieldset class="question"><legend>${escapeHtml(question.text)}</legend><div class="rating-grid stars-grid" data-rating-question="${name}">${Array.from({ length: 5 }, (_, index) => index + 1).map((value) => `<label><input type="radio" name="${name}" value="${value}" required><span class="star-choice" aria-label="${value} estrela${value === 1 ? '' : 's'}">★</span><small class="star-number">${value}</small></label>`).join('')}</div><div class="rating-confirmation" data-rating-confirm="${name}" hidden><p>Você confirma sua nota? <strong data-rating-value>0</strong></p><button class="rating-confirm-button" type="button">Sim</button></div></fieldset>`;
    }
    if (question.type === 'scale') {
      return `<fieldset class="question"><legend>${escapeHtml(question.text)}</legend><div class="scale-grid">${Array.from({ length: 10 }, (_, index) => index + 1).map((value) => `<label><input type="radio" name="${name}" value="${value}" required><span>${value}</span></label>`).join('')}</div></fieldset>`;
    }
    if (question.type === 'options') {
      return `<fieldset class="question"><legend>${escapeHtml(question.text)}</legend><div class="option-grid">${(question.options || []).map((option) => `<label><input type="radio" name="${name}" value="${escapeHtml(option)}" required><span>${escapeHtml(option)}</span></label>`).join('')}</div></fieldset>`;
    }
    const faces = emojiOptions(question.options);
    return `<fieldset class="question"><legend>${escapeHtml(question.text)}</legend><div class="rating-grid emoji-grid" data-rating-question="${name}">${faces.map(({ value, emoji, label, animation }) => `<label><input type="radio" name="${name}" value="${value}" data-rating-label="${escapeHtml(label)}" required><span class="emoji-face emoji-face--${value} emoji-motion--${animation}" role="img" aria-label="${escapeHtml(label)}"><span class="emoji-glyph">${escapeHtml(emoji)}</span><span class="emoji-spark" aria-hidden="true">✦</span></span><small>${escapeHtml(label)}</small></label>`).join('')}</div><div class="rating-confirmation" data-rating-confirm="${name}" hidden><p>Você confirma sua nota? <strong data-rating-value>0</strong></p><button class="rating-confirm-button" type="button">Sim</button></div></fieldset>`;
  }

  async function submitSurvey(event) {
    event.preventDefault();
    if (previewReadOnly || busy || !activeSurvey) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    const answers = {};
    for (const question of activeSurvey.questions) {
      const value = values.get(`q-${question.id}`);
      if (value === null) return;
      answers[question.id] = value;
    }
    busy = true;
    form.querySelectorAll('input,button').forEach((element) => { element.disabled = true; });
    if (browserTestMode) {
      const submittedSurvey = activeSurvey;
      renderThanks(false);
      setTimeout(() => {
        busy = false;
        if (activeSurvey?.id === submittedSurvey.id && !root.querySelector('#kiosk-form')) renderSurvey(submittedSurvey);
      }, 2200);
      return;
    }
    const submission = { surveyId: activeSurvey.id, submissionId: crypto.randomUUID(), answeredAt: new Date().toISOString(), answers };
    const queuedBeforeSend = pendingQueue();
    queuedBeforeSend.push(submission);
    saveQueue(queuedBeforeSend);
    let queued = false;
    try {
      await deviceRequest('/api/devices/responses', id, { method: 'POST', body: JSON.stringify({ deviceId: id.deviceId, ...submission }) });
      saveQueue(pendingQueue().filter((item) => item.submissionId !== submission.submissionId));
    } catch (error) {
      if (!isTransientError(error)) {
        saveQueue(pendingQueue().filter((item) => item.submissionId !== submission.submissionId));
        busy = false;
        renderSurvey(activeSurvey);
        return;
      }
      queued = true;
    }
    const submittedSurvey = activeSurvey;
    renderThanks(queued);
    setTimeout(() => {
      busy = false;
      if (activeSurvey?.id === submittedSurvey.id && !root.querySelector('#kiosk-form')) renderSurvey(submittedSurvey);
    }, 2200);
  }

  function renderThanks(queued) {
    const title = browserTestMode ? 'Teste concluído' : 'Obrigado pela sua opinião!';
    const copy = browserTestMode ? 'Nenhuma resposta foi enviada ou salva. Este tablet do navegador serve apenas para testar a experiência.' : (queued ? 'A avaliação ficou salva neste tablet e será sincronizada quando a conexão voltar.' : 'Sua avaliação foi registrada com sucesso.');
    const logoData = safeImageDataUrl(activeSurvey?.branding?.logoData);
    const logoPosition = ALLOWED_LOGO_POSITIONS.has(activeSurvey?.theme?.logoPosition) ? activeSurvey.theme.logoPosition : 'top';
    const hasSideLogo = logoData && ['left', 'right'].includes(logoPosition);
    const logoMarkup = logoData
      ? `<div class="survey-brand-logo-slot survey-brand-logo-slot--${logoPosition}"><img class="survey-brand-logo" src="${escapeHtml(logoData)}" alt="Logo da pesquisa"></div>`
      : '';
    const thanksMarkup = `<div class="thanks-content"><div class="thanks-icon">✓</div><h1>${title}</h1><p class="tablet-copy">${copy}</p></div>`;
    root.innerHTML = `<main class="tablet-shell"><section class="tablet-card thanks-card${hasSideLogo ? ' thanks-card--logo-side' : ''}" data-logo-position="${logoPosition}">${logoPosition === 'bottom' ? thanksMarkup + logoMarkup : logoMarkup + thanksMarkup}</section></main>`;
    applySurveyBackground(root.querySelector('.thanks-card'), activeSurvey?.branding);
  }

  async function flushPending() {
    const queue = pendingQueue();
    if (!queue.length) return;
    const remaining = [];
    for (const submission of queue) {
      try {
        await deviceRequest('/api/devices/responses', id, { method: 'POST', body: JSON.stringify({ deviceId: id.deviceId, ...submission }) });
      } catch (error) {
        if (isTransientError(error)) remaining.push(submission);
      }
    }
    saveQueue(remaining);
  }

  async function refreshConfig() {
    if (kioskUnlocked) return;
    try {
      const config = await deviceRequest(`/api/devices/config?deviceId=${encodeURIComponent(id.deviceId)}&currentConfigVersion=${currentConfigVersion()}`, id);
      if (config.status === 'unpaired') {
        activeSurvey = null;
        ensureActivation(id);
        waitingForPairing = true;
        await register();
        renderPairing();
        return;
      }
      if (waitingForPairing) {
        await configureAdminPin();
        waitingForPairing = false;
      }
      localStorage.removeItem(KEYS.activation);
      await flushPending();
      if (config.status === 'unchanged') {
        if (!activeSurvey) {
          const cached = cachedSurvey();
          if (cached) renderSurvey(cached);
        }
        return;
      }
      if (!config.survey) { activeSurvey = null; renderWaiting(config.deviceName); return; }
      saveSurveyCache(config.survey, config.configVersion);
      if (!activeSurvey || activeSurvey.id !== config.survey.id || !root.querySelector('#kiosk-form')) renderSurvey(config.survey);
    } catch {
      const cached = cachedSurvey();
      if (!activeSurvey && cached) renderSurvey(cached);
      else if (!activeSurvey) root.innerHTML = '<main class="tablet-shell"><section class="tablet-card"><p class="tablet-kicker">OPINA AI</p><h1>Sem conexão</h1><p class="tablet-copy">A pesquisa anterior ficará disponível assim que o cache local for criado. Tentando novamente...</p></section></main>';
    }
  }

  async function heartbeat() {
    try {
      const telemetry = await runtimeTelemetry();
      await deviceRequest('/api/devices/heartbeat', id, {
        method: 'POST',
        body: JSON.stringify({
          deviceId: id.deviceId,
          appVersion: appVersion(),
          currentConfigVersion: currentConfigVersion(),
          ...telemetry,
          pendingResponses: pendingQueue().length,
        }),
      });
      await flushPending();
    } catch { /* o polling seguinte tenta novamente */ }
  }

  try { await register(); } catch { /* refreshConfig exibirá o estado de conexão */ }
  await refreshConfig();
  setInterval(refreshConfig, 10_000);
  setInterval(heartbeat, 30_000);
  window.addEventListener('online', () => { heartbeat(); refreshConfig(); });
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&#38;', '<': '&#60;', '>': '&#62;', "'": '&#39;', '"': '&#34;' })[char]);
}
