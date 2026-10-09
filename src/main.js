import './styles.css';
import './admin.css';
import { renderTablet } from './tablet.js';

const app = document.querySelector('#app');
const nativeKiosk = Boolean(globalThis.Capacitor?.Plugins?.OpinaRuntime);
const AUTH_TOKEN_KEY = 'opina_token';
const DEFAULT_RATING_QUESTION = 'Como foi a sua experiência?';
const DEFAULT_SURVEY_HEADER = 'SUA OPINIÃO IMPORTA';
const DEFAULT_EMOJI_OPTIONS = [
  { value: '1', emoji: '😡', label: 'Péssimo', animation: 'shake' },
  { value: '2', emoji: '😕', label: 'Ruim', animation: 'float' },
  { value: '3', emoji: '😐', label: 'Regular', animation: 'pulse' },
  { value: '4', emoji: '🙂', label: 'Bom', animation: 'bounce' },
  { value: '5', emoji: '😍', label: 'Ótimo', animation: 'heart' },
];
const EMOJI_ANIMATION_OPTIONS = [
  { value: 'shake', label: 'Tremer' },
  { value: 'float', label: 'Flutuar' },
  { value: 'pulse', label: 'Pulsar' },
  { value: 'bounce', label: 'Quicar' },
  { value: 'heart', label: 'Brilhar' },
];
const SURVEY_LOGO_POSITION_OPTIONS = [
  { value: 'top', label: 'Superior' },
  { value: 'left', label: 'Esquerda' },
  { value: 'right', label: 'Direita' },
  { value: 'bottom', label: 'Embaixo' },
];

function normalizeEmojiOptions(options) {
  return DEFAULT_EMOJI_OPTIONS.map((fallback, index) => {
    const item = Array.isArray(options) ? options[index] : null;
    return {
      value: String(index + 1),
      emoji: String(item?.emoji || (typeof item === 'string' ? item : fallback.emoji)).trim() || fallback.emoji,
      label: String(item?.label || fallback.label).trim() || fallback.label,
      animation: EMOJI_ANIMATION_OPTIONS.some((option) => option.value === item?.animation) ? item.animation : fallback.animation,
    };
  });
}

function readEmojiOptions(source, prefix = 'rating') {
  const get = (name) => typeof source?.get === 'function' ? source.get(name) : source?.[name];
  return DEFAULT_EMOJI_OPTIONS.map((fallback, index) => ({
    value: String(index + 1),
    emoji: String(get(`${prefix}-emoji-${index}`) || fallback.emoji).trim() || fallback.emoji,
    label: String(get(`${prefix}-label-${index}`) || fallback.label).trim() || fallback.label,
    animation: EMOJI_ANIMATION_OPTIONS.some((option) => option.value === get(`${prefix}-animation-${index}`)) ? get(`${prefix}-animation-${index}`) : fallback.animation,
  }));
}

function renderEmojiCustomizationFields(options = DEFAULT_EMOJI_OPTIONS, prefix = 'rating', legend = 'Personalizar carinhas animadas', className = '') {
  const normalized = normalizeEmojiOptions(options);
  return `<fieldset class="emoji-customizer emoji-config-field ${className}"><legend>${escapeHtml(legend)}</legend><p class="emoji-customizer__hint">Escolha o emoji, o nome e o movimento de cada nota.</p><div class="emoji-customizer__grid">${normalized.map((item, index) => `<div class="emoji-customizer__row"><span class="emoji-customizer__score">${index + 1}</span><input name="${prefix}-emoji-${index}" value="${escapeHtml(item.emoji)}" maxlength="8" aria-label="Emoji da nota ${index + 1}"><input name="${prefix}-label-${index}" value="${escapeHtml(item.label)}" maxlength="40" aria-label="Rótulo da nota ${index + 1}"><select name="${prefix}-animation-${index}" aria-label="Animação da nota ${index + 1}">${EMOJI_ANIMATION_OPTIONS.map((animation) => `<option value="${animation.value}" ${animation.value === item.animation ? 'selected' : ''}>${animation.label}</option>`).join('')}</select></div>`).join('')}</div></fieldset>`;
}

function authToken() {
  return sessionStorage.getItem(AUTH_TOKEN_KEY) || localStorage.getItem(AUTH_TOKEN_KEY);
}

function saveAuthToken(token) {
  sessionStorage.setItem(AUTH_TOKEN_KEY, token);
  localStorage.removeItem(AUTH_TOKEN_KEY);
}

function clearAuthToken() {
  sessionStorage.removeItem(AUTH_TOKEN_KEY);
  localStorage.removeItem(AUTH_TOKEN_KEY);
}

function navigatePreviewWindow(previewWindow, previewId, survey) {
  previewWindow.name = JSON.stringify({ previewId, survey });
  previewWindow.location.replace(`/tablet?preview=${encodeURIComponent(previewId)}`);
  previewWindow.opener = null;
}

function navigateServerPreviewWindow(previewWindow, token) {
  previewWindow.location.replace(`/tablet#previewToken=${encodeURIComponent(token)}`);
  previewWindow.opener = null;
}

if (nativeKiosk) {
  renderTablet(app).catch((error) => {
    console.error('Falha ao iniciar o kiosk Opina AI', error);
    app.innerHTML = '<main class="tablet-shell"><section class="tablet-card"><p class="tablet-kicker">OPINA AI</p><h1>Falha ao iniciar este tablet</h1><p class="tablet-copy">Reabra o aplicativo para tentar novamente.</p></section></main>';
  });
} else if (location.pathname === '/tablet' || location.pathname.startsWith('/tablet/')) {
  renderTablet(app).catch((error) => {
    console.error('Falha ao iniciar o kiosk Opina AI', error);
    app.innerHTML = '<main class="tablet-shell"><section class="tablet-card"><p class="tablet-kicker">OPINA AI</p><h1>Falha ao iniciar este tablet</h1><p class="tablet-copy">Reabra o aplicativo para tentar novamente.</p></section></main>';
  });
} else {
  renderAdmin(app);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[char]);
}

function dashboardIcon(name) {
  const paths = {
    spark: '<path d="m12 3.5 2.45 5.7 6.05 2.4-6.05 2.4L12 19.8 9.55 14 3.5 11.6l6.05-2.4L12 3.5Z" fill="currentColor" stroke="currentColor" stroke-linejoin="round"/><path d="m19.2 16.6.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8Z" fill="currentColor" stroke="currentColor" stroke-linejoin="round"/>',
    home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1V10Z"/>',
    tablet: '<rect x="6" y="2.5" width="12" height="19" rx="2"/><path d="M10 5h4M11 18.5h2"/>',
    survey: '<path d="M5 3.5h14a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1Z"/><path d="M8 8h8M8 12h8M8 16h5"/>',
    chart: '<path d="M4 19V5M4 19h16"/><path d="M8 16v-5M12 16V7M16 16v-8"/>',
    printer: '<path d="M6 9V3h12v6M6 17H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v7H6z"/><path d="M18 12h.01"/>',
    evaluations: '<rect x="5" y="4.5" width="14" height="17" rx="2.5"/><path d="M9 4.5v-1h6v1M8.5 10h2M13 10h2.5M8.5 14h2M13 14h2.5M8.5 18h7"/>',
    satisfaction: '<circle cx="12" cy="12" r="9"/><path d="M9 10h.01M15 10h.01M8.5 14.5c.9 1.3 2.1 2 3.5 2s2.6-.7 3.5-2"/>',
    rating: '<path d="m12 3.5 2.6 5.3 5.9.9-4.2 4.1 1 5.8L12 16.8l-5.3 2.8 1-5.8-4.2-4.1 5.9-.9L12 3.5Z" fill="currentColor" stroke="currentColor"/>',
    dissatisfaction: '<circle cx="12" cy="12" r="9"/><path d="M9 10h.01M15 10h.01M8.5 16c.9-1.4 2.1-2 3.5-2s2.6.6 3.5 2"/>',
  };
  return `<svg class="dashboard-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.spark}</svg>`;
}

async function api(path, options = {}) {
  const token = authToken();
  const response = await fetch(path, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  const data = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || 'Não foi possível concluir a operação.');
  return data;
}

async function prepareTenantImage(file, kind) {
  const allowedTypes = new Set(['image/png', 'image/jpeg', 'image/webp']);
  if (!allowedTypes.has(file.type)) throw new Error('Escolha uma imagem PNG, JPEG ou WebP.');
  if (file.size > 15 * 1024 * 1024) throw new Error('A imagem original deve ter no máximo 15 MB.');

  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('Não foi possível abrir essa imagem.');
  }

  try {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Não foi possível preparar a imagem.');
    const maxWidth = kind === 'background' ? 1920 : 1600;
    const maxHeight = kind === 'background' ? 1280 : 700;
    let scale = Math.min(1, maxWidth / bitmap.width, maxHeight / bitmap.height);

    for (let attempt = 0; attempt < 8; attempt += 1) {
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const quality = Math.max(0.5, 0.92 - attempt * 0.06);
      let data = canvas.toDataURL('image/webp', quality);
      if (!data.startsWith('data:image/webp;base64,')) {
        const fallbackType = file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png';
        data = canvas.toDataURL(fallbackType, quality);
      }
      if (data.length <= 699000) return data;
      scale *= 0.75;
    }
    throw new Error('Não foi possível reduzir a logo para até 512 KB.');
  } finally {
    bitmap.close?.();
  }
}

function openDialog({ title, description = '', fields = [], submitLabel = 'Salvar', destructive = false }) {
  const dialog = document.createElement('dialog');
  dialog.className = 'app-dialog';
  if (fields.some((field) => field.name === 'emoji-config')) dialog.classList.add('app-dialog--survey');
  const renderField = (field) => {
    const fieldName = String(field.name || 'field').replace(/[^a-z0-9_-]/gi, '');
    const fieldClass = `app-dialog__field app-dialog__field--${fieldName}`;
    return field.type === 'survey-branding'
    ? `<div class="${fieldClass} survey-editor-branding">${[field.logo, field.background].map((item) => `<section class="survey-editor-branding__item"><div class="survey-editor-branding__preview" ${item.previewSrc ? '' : 'aria-hidden="true"'}>${item.previewSrc ? `<img src="${escapeHtml(item.previewSrc)}" alt="${escapeHtml(item.previewAlt)}">` : `<span>${escapeHtml(item.emptyLabel)}</span>`}</div><h3>${escapeHtml(item.label)}</h3><p>${escapeHtml(item.hint)}</p><label class="survey-editor-branding__upload">Selecionar imagem<input name="${escapeHtml(item.name)}" type="file" accept="${escapeHtml(item.accept)}"></label><label class="app-dialog__checkbox survey-editor-branding__remove" ${item.removeHidden ? 'hidden' : ''}><input name="${escapeHtml(item.removeName)}" type="checkbox" value="true"><span>${escapeHtml(item.removeLabel)}</span></label></section>`).join('')}</div>`
    : field.type === 'emoji-config'
    ? renderEmojiCustomizationFields(field.value, field.name, field.label || 'Personalizar carinhas animadas', fieldClass)
    : field.type === 'select'
      ? `<label class="${fieldClass}">${escapeHtml(field.label)}<select name="${escapeHtml(field.name)}" required>${field.options.map((option) => `<option value="${escapeHtml(option.value)}" ${String(option.value) === String(field.value) ? 'selected' : ''}>${escapeHtml(option.label)}</option>`).join('')}</select></label>`
      : field.type === 'file'
        ? `<label class="${fieldClass}">${escapeHtml(field.label)}${field.previewSrc ? `<span class="dialog-file-preview"><img src="${escapeHtml(field.previewSrc)}" alt="Imagem atual"></span>` : ''}${field.hint ? `<small>${escapeHtml(field.hint)}</small>` : ''}<input name="${escapeHtml(field.name)}" type="file" accept="${escapeHtml(field.accept || '')}" ${field.required === false ? '' : 'required'}></label>`
        : field.type === 'checkbox'
          ? `<label class="app-dialog__checkbox ${fieldClass}" ${field.hidden ? 'hidden' : ''}><input name="${escapeHtml(field.name)}" type="checkbox" value="true" ${field.checked ? 'checked' : ''}><span>${escapeHtml(field.label)}</span></label>`
      : `<label class="${fieldClass}">${escapeHtml(field.label)}<input name="${escapeHtml(field.name)}" type="${field.type || 'text'}" value="${escapeHtml(field.value || '')}" ${field.minLength ? `minlength="${field.minLength}"` : ''} ${field.maxLength ? `maxlength="${field.maxLength}"` : ''} ${field.min !== undefined ? `min="${field.min}"` : ''} ${field.max !== undefined ? `max="${field.max}"` : ''} ${field.required === false ? '' : 'required'}></label>`;
  };
  dialog.innerHTML = `<form method="dialog" class="app-dialog__form"><div class="app-dialog__header"><div><p class="section-kicker">OPINA AI</p><h2>${escapeHtml(title)}</h2>${description ? `<p>${escapeHtml(description)}</p>` : ''}</div><button type="button" class="app-dialog__close" aria-label="Fechar">×</button></div><div class="app-dialog__fields">${fields.map(renderField).join('')}</div><div class="app-dialog__actions"><button type="button" class="outline-button app-dialog__cancel">Cancelar</button><button type="submit" class="submit-button compact ${destructive ? 'danger-button' : ''}">${escapeHtml(submitLabel)}</button></div></form>`;
  document.body.appendChild(dialog);
  const dialogType = dialog.querySelector('select[name="type"]');
  const dialogEmojiConfig = dialog.querySelector('.emoji-config-field');
  const dialogOptionsField = dialog.querySelector('input[name="options"]')?.closest('label');
  const syncDialogFields = () => {
    if (!dialogType) return;
    dialogEmojiConfig?.classList.toggle('is-hidden', dialogType.value !== 'emoji');
    dialogOptionsField?.classList.toggle('is-hidden', dialogType.value !== 'options');
  };
  dialogType?.addEventListener('change', syncDialogFields);
  syncDialogFields();
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      dialog.close();
      dialog.remove();
      resolve(value);
    };
    dialog.querySelector('.app-dialog__close').onclick = () => finish(null);
    dialog.querySelector('.app-dialog__cancel').onclick = () => finish(null);
    dialog.addEventListener('cancel', (event) => { event.preventDefault(); finish(null); }, { once: true });
    dialog.querySelector('form').onsubmit = (event) => {
      event.preventDefault();
      finish(Object.fromEntries(new FormData(event.currentTarget)));
    };
    dialog.showModal();
  });
}

async function confirmAction(title, description) {
  const result = await openDialog({ title, description, submitLabel: 'Confirmar', destructive: true, fields: [] });
  return result !== null;
}

function renderAdmin(root) {
  document.body.classList.remove('dashboard-mode');
  const token = localStorage.getItem('opina_token');
  if (token) {
    root.innerHTML = `<main class="session-restore" role="status" aria-live="polite"><span class="session-restore__mark" aria-hidden="true">${dashboardIcon('spark')}</span><span>Carregando seu painel...</span></main>`;
    api('/api/me').then((user) => {
      renderDashboard(root, user).catch(() => renderSessionError(root));
    }, () => {
      localStorage.removeItem('opina_token');
      renderLogin(root);
    });
    return;
  }
  renderLogin(root);
}

function renderSessionError(root) {
  root.innerHTML = `<main class="session-restore" role="alert"><span class="session-restore__mark" aria-hidden="true">${dashboardIcon('spark')}</span><span>Não foi possível carregar o painel.</span><button id="retry-session" class="session-restore__retry" type="button">Tentar novamente</button></main>`;
  root.querySelector('#retry-session').addEventListener('click', () => renderAdmin(root));
}

function renderLogin(root) {
  document.body.classList.remove('dashboard-mode');
  root.innerHTML = `
    <section class="login-shell" aria-label="Acesso administrativo Opina AI">
      <div class="brand-panel">
        <div class="brand-panel__rings" aria-hidden="true"></div>
        <div class="brand-panel__content">
          <p class="eyebrow">PESQUISA DE SATISFAÇÃO DIGITAL</p>
          <h1>Pesquisas de<br><span>satisfação</span></h1>
          <p class="intro">Colete opiniões no tablet e acompanhe a experiência em tempo real.</p>
          <img class="feedback-visual" src="/assets/opinaai-satisfaction-illustration.png" alt="Cartão Opina AI com rostos que representam níveis de satisfação">
          <p class="tagline">Tablet, pesquisa e resultado. Sem distrações.</p>
        </div>
      </div>
      <div class="form-panel">
        <div class="form-panel__content">
          <p class="eyebrow eyebrow--blue">ÁREA ADMINISTRATIVA</p>
          <h2>Bem-vindo de volta</h2>
          <p class="form-intro">Entre para gerenciar empresas, tablets e pesquisas.</p>
          <form id="login-form" class="login-form">
            <label for="email">E-mail</label>
            <input id="email" name="email" type="email" placeholder="seu@email.com" autocomplete="username" required>
            <label for="password">Senha</label>
            <div class="password-field">
              <input id="password" name="password" type="password" placeholder="Digite sua senha" autocomplete="current-password" required>
              <button id="toggle-password" class="icon-button" type="button" aria-label="Mostrar senha" title="Mostrar senha" aria-pressed="false">
                <svg class="password-visibility-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z"></path>
                  <circle cx="12" cy="12" r="3"></circle>
                </svg>
              </button>
            </div>
            <button class="submit-button" type="submit">Entrar</button>
            <p id="form-message" class="form-message" role="status" aria-live="polite"></p>
          </form>
        </div>
      </div>
    </section>`;

  const passwordInput = root.querySelector('#password');
  const togglePassword = root.querySelector('#toggle-password');
  const loginForm = root.querySelector('#login-form');
  const formMessage = root.querySelector('#form-message');

  togglePassword.addEventListener('click', () => {
    const isHidden = passwordInput.type === 'password';
    passwordInput.type = isHidden ? 'text' : 'password';
    togglePassword.setAttribute('aria-label', isHidden ? 'Ocultar senha' : 'Mostrar senha');
    togglePassword.setAttribute('title', isHidden ? 'Ocultar senha' : 'Mostrar senha');
    togglePassword.setAttribute('aria-pressed', String(isHidden));
    togglePassword.innerHTML = isHidden
      ? `<svg class="password-visibility-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M3 3l18 18"></path>
          <path d="M10.6 10.6a2 2 0 0 0 2.8 2.8"></path>
          <path d="M9.9 5.2A10.8 10.8 0 0 1 12 5c6.4 0 10 7 10 7a15.8 15.8 0 0 1-3.1 3.9"></path>
          <path d="M6.2 6.2C3.5 8 2 12 2 12s3.6 7 10 7c1.1 0 2.1-.2 3-.5"></path>
        </svg>`
      : `<svg class="password-visibility-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z"></path>
          <circle cx="12" cy="12" r="3"></circle>
        </svg>`;
  });

  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    formMessage.textContent = 'Entrando...';
    formMessage.classList.add('form-message--visible');
    try {
      const data = await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: root.querySelector('#email').value, password: passwordInput.value }),
      });
      saveAuthToken(data.token);
      await renderDashboard(root, data.user);
    } catch (error) {
      formMessage.textContent = error.message;
    }
  });

  const token = authToken();
  if (token) {
    api('/api/me').then((user) => renderDashboard(root, user)).catch(() => clearAuthToken());
  }
}

async function renderDashboard(root, user) {
  let selectedTenantId = user.tenantId || '';
  let tenants = [];
  if (user.role === 'SUPERADMIN') tenants = await api('/api/tenants');
  if (!selectedTenantId && tenants.length) selectedTenantId = tenants[0].id;

  const tenantOptions = () => tenants.map((tenant) => `<option value="${tenant.id}" ${String(tenant.id) === String(selectedTenantId) ? 'selected' : ''}>${escapeHtml(tenant.name)}</option>`).join('');
  const tenantListMarkup = () => tenants.length
    ? tenants.map((tenant) => `<div class="tenant-row"><div><strong>${escapeHtml(tenant.name)}</strong><small>${escapeHtml(tenant.adminEmail || 'Administrador não cadastrado')} · Tablets ativos: ${Number(tenant.activeDevices || 0)} / ${Number(tenant.deviceLimit || 1)}</small></div><button class="outline-button edit-tenant" type="button" data-tenant-id="${tenant.id}">Editar empresa</button></div>`).join('')
    : '<p class="empty-state">Nenhuma empresa cadastrada.</p>';

  document.body.classList.add('dashboard-mode');
  root.innerHTML = `
    <main class="dashboard dashboard-shell">
      <aside class="dashboard-sidebar">
        <div class="sidebar-brand"><span class="brand-symbol" aria-hidden="true">${dashboardIcon('spark')}</span><div><strong>Opina <em>AI</em></strong><small>Painel de satisfação</small></div></div>
        <p class="sidebar-label">NAVEGAÇÃO</p>
        <nav class="dashboard-nav" aria-label="Navegação do painel">
          <a class="dashboard-nav__item is-active" data-view="overview" href="#overview"><span aria-hidden="true">${dashboardIcon('home')}</span> Visão geral</a>
          <a class="dashboard-nav__item" data-view="tablets" href="#tablets"><span aria-hidden="true">${dashboardIcon('tablet')}</span> Tablets</a>
          <a class="dashboard-nav__item" data-view="surveys" href="#surveys"><span aria-hidden="true">${dashboardIcon('survey')}</span> Pesquisas</a>
          <a class="dashboard-nav__item" data-view="reports" href="#reports"><span aria-hidden="true">${dashboardIcon('chart')}</span> Relatórios</a>
        </nav>
        <div class="sidebar-profile"><span class="profile-avatar">${escapeHtml(String(user.name || 'A').slice(0, 1).toUpperCase())}</span><div><strong>${escapeHtml(user.name)}</strong><span>${user.role === 'SUPERADMIN' ? 'Superadministrador' : 'Administrador'}</span></div></div>
      </aside>
      <section class="dashboard-content">
        <header class="dashboard-topbar">
          <div class="mobile-brand"><span class="brand-symbol" aria-hidden="true">${dashboardIcon('spark')}</span><strong>Opina <em>AI</em></strong></div>
          <div class="topbar-actions"><span id="dashboard-status" class="sync-status" role="status" aria-live="polite"><i></i>Atualizado</span><a class="primary-button" href="/tablet" target="_blank">Abrir tablet de teste <span aria-hidden="true">↗</span></a><button id="change-password" class="topbar-account" type="button">Minha senha</button><button id="logout" class="topbar-logout" type="button">Sair</button></div>
        </header>
        <section id="overview" class="dashboard-page-header">
          <div><p class="section-kicker">PAINEL</p><h1 id="page-title">Visão geral</h1><p id="page-subtitle" class="page-subtitle">Acompanhe as avaliações e a operação dos tablets.</p></div>
          ${user.role === 'SUPERADMIN' ? `<label class="tenant-select"><span>Empresa</span><select id="tenant-filter" aria-label="Empresa">${tenantOptions()}</select></label>` : ''}
        </section>
        <section class="dashboard-section overview-section" data-dashboard-view="overview">
          <div class="section-heading"><div><h2>Resumo</h2></div><span class="section-counter">Período atual</span></div>
          <div id="report-metrics" class="metric-grid overview-metrics"></div>
        </section>
        ${user.role === 'SUPERADMIN' ? `<section id="companies" class="dashboard-section admin-tools" data-dashboard-view="overview"><details class="admin-details"><summary><span><small>ADMINISTRAÇÃO</small><strong>Gerenciar empresas</strong></span><b>Adicionar empresa <span aria-hidden="true">＋</span></b></summary><article class="dashboard-card"><form id="tenant-form" class="form-grid form-grid--tenant"><label>Nome da empresa<input name="name" required></label><label>E-mail do administrador<input name="email" type="email" required></label><label>Senha inicial<input name="password" type="password" minlength="8" required></label><label>Limite de tablets<input name="deviceLimit" type="number" min="1" max="10000" step="1" value="1" required></label><div class="form-submit-row"><button class="submit-button compact" type="submit">Criar empresa <span aria-hidden="true">→</span></button><p class="inline-message" id="tenant-message" role="status"></p></div></form><div class="tenant-list-heading"><strong>Empresas cadastradas</strong></div><div id="tenant-list" class="tenant-list">${tenantListMarkup()}</div></article></details></section>` : ''}
        <section id="tablets" class="dashboard-section" data-dashboard-view="tablets">
          <div class="section-heading"><div><p class="section-kicker">OPERAÇÃO</p><h2>Tablets</h2></div><span id="device-count" class="section-counter">Carregando...</span></div>
          <article class="dashboard-card action-card action-card--pair"><div class="action-card__icon" aria-hidden="true">${dashboardIcon('tablet')}</div><div class="action-card__intro"><h3>Parear tablet</h3><p>Conecte um dispositivo à operação.</p></div><form id="pair-form" class="form-stack"><label>Código exibido no tablet<input name="activationCode" inputmode="numeric" maxlength="6" pattern="[0-9]{6}" required placeholder="Ex.: 482913"></label><div class="form-grid"><label>Nome do tablet<input name="deviceName" placeholder="Tablet Recepção"></label><label>Unidade / local<input name="locationName" value="Recepção" required></label></div><div class="form-submit-row"><button class="submit-button compact" type="submit">Parear dispositivo <span aria-hidden="true">→</span></button><p class="inline-message" id="pair-message" role="status"></p></div></form></article>
          <div class="dashboard-card dashboard-card--flush"><div id="device-list" class="device-list">Carregando...</div></div>
        </section>
        <section id="surveys" class="dashboard-section" data-dashboard-view="surveys">
          <div class="section-heading"><div><p class="section-kicker">CONTEÚDO</p><h2>Pesquisas</h2></div></div>
          <article class="dashboard-card action-card action-card--survey"><div class="action-card__icon" aria-hidden="true">${dashboardIcon('survey')}</div><div class="action-card__intro"><h3>Nova pesquisa</h3><p>Crie a pergunta exibida no tablet.</p></div><form id="survey-form" class="form-stack"><div class="form-grid"><label>Título da pesquisa<input name="title" required placeholder="Ex.: Experiência de atendimento"></label><label>Pergunta para o cliente<input name="question" required value="${DEFAULT_RATING_QUESTION}" placeholder="Digite a pergunta exibida no tablet"></label></div><label>Texto acima das avaliações<input name="headerText" maxlength="120" value="${DEFAULT_SURVEY_HEADER}" placeholder="Ex.: SUA OPINIÃO IMPORTA"></label><div class="survey-branding-fields"><div class="report-branding-item"><div class="report-logo-preview"><img id="survey-logo-preview" alt="Prévia da logo desta pesquisa" hidden><span id="survey-logo-placeholder" aria-hidden="true">Logo</span></div><div class="report-branding-copy"><strong>Logo da pesquisa</strong><small>Opcional. Aparece no tablet desta pesquisa; não altera a logo do relatório.</small><p id="survey-logo-message" role="status" aria-live="polite"></p></div><div class="report-branding-actions"><label class="outline-button report-logo-select">Selecionar logo<input id="survey-logo-input" type="file" accept="image/png,image/jpeg,image/webp"></label><button id="remove-survey-logo" class="outline-button" type="button" disabled>Remover</button></div></div><div class="report-branding-item"><div class="report-background-preview"><img id="survey-background-preview" alt="Prévia do fundo desta pesquisa" hidden><span id="survey-background-placeholder" aria-hidden="true">Fundo</span></div><div class="report-branding-copy"><strong>Plano de fundo</strong><small>Opcional. Aparece somente na tela do tablet desta pesquisa.</small><p id="survey-background-message" role="status" aria-live="polite"></p></div><div class="report-branding-actions"><label class="outline-button report-logo-select">Selecionar imagem<input id="survey-background-input" type="file" accept="image/png,image/jpeg,image/webp"></label><button id="remove-survey-background" class="outline-button" type="button" disabled>Remover</button></div></div></div><label>Posição da logo no tablet<select name="logoPosition">${SURVEY_LOGO_POSITION_OPTIONS.map((option) => `<option value="${option.value}">${option.label}</option>`).join('')}</select></label><label>Tipo de resposta<select name="type"><option value="emoji">Carinhas animadas</option><option value="stars">Estrelas (1 a 5)</option><option value="scale">Nota de 1 a 10</option><option value="options">Opções personalizadas</option></select></label>${renderEmojiCustomizationFields()}<label class="options-field is-hidden">Opções separadas por vírgula<input class="options-field is-hidden" name="options" placeholder="Ótimo, Bom, Regular, Ruim"></label><div class="form-submit-row"><button id="preview-survey" class="outline-button submit-button compact" type="button">Pré-visualizar <span aria-hidden="true">↗</span></button><button class="submit-button compact" type="submit">Cadastrar pesquisa <span aria-hidden="true">→</span></button><p class="inline-message" id="survey-message" role="status"></p></div></form></article>
          <div class="dashboard-card"><div id="survey-list" class="survey-list">Carregando...</div></div>
        </section>
        <section id="reports" class="dashboard-section report-section" data-dashboard-view="reports">
          <div class="section-heading">
            <div class="report-heading-copy">
              <p class="section-kicker">RESULTADOS</p>
              <h2><span class="report-screen-title">Relatórios</span><span class="report-print-title">Relatório de satisfação</span></h2>
              <p id="report-company-subtitle" class="report-print-company"></p>
              <div class="report-print-identity"><strong id="report-company-name"></strong><img id="report-company-logo" alt="Logo da empresa" hidden></div>
            </div>
            <div class="section-heading__action"><span id="report-total" class="section-counter">Carregando...</span><button id="print-report" class="outline-button report-print-button" type="button"><span aria-hidden="true">${dashboardIcon('printer')}</span>Imprimir relatório</button></div>
          </div>
          ${['SUPERADMIN', 'ADMIN'].includes(user.role) ? `<article id="report-branding-controls" class="dashboard-card report-branding-controls"><div class="report-branding-item"><div class="report-logo-preview"><img id="tenant-logo-preview" alt="Prévia da logo da empresa" hidden><span id="tenant-logo-placeholder" aria-hidden="true">${dashboardIcon('spark')}</span></div><div class="report-branding-copy"><strong>Logo do relatório</strong><small>PNG, JPEG ou WebP. Aparece somente no relatório impresso.</small><p id="tenant-logo-message" role="status" aria-live="polite"></p></div><div class="report-branding-actions"><label class="outline-button report-logo-select">Selecionar logo<input id="tenant-logo-input" type="file" accept="image/png,image/jpeg,image/webp"></label><button id="remove-tenant-logo" class="outline-button" type="button" disabled>Remover</button></div></div></article>` : ''}
          <div id="report-print-context" class="report-print-context"></div>
          <div class="dashboard-card report-card"><div class="report-toolbar"><div class="date-row"><label>De <input id="from" type="date"></label><label>Até <input id="to" type="date"></label></div><div class="report-filters"><label>Pesquisa<select id="report-survey"><option value="">Todas</option></select></label><label>Unidade<select id="report-location"><option value="">Todas</option></select></label><label>Tablet<select id="report-device"><option value="">Todos</option></select></div><button id="load-report" class="outline-button" type="button">Atualizar <span aria-hidden="true">↻</span></button></div><div class="report-results"><div class="report-results__header"><h3>Distribuição</h3><span>Respostas por avaliação</span></div><div id="report-distribution" class="distribution-list"></div><div id="report-list" class="report-list"></div></div></div>
        </section>
      </section>
    </main>`;

  const viewMeta = {
    overview: ['Visão geral', 'Acompanhe as avaliações e a operação dos tablets.'],
    tablets: ['Tablets', 'Pareie dispositivos e acompanhe suas pesquisas.'],
    surveys: ['Pesquisas', 'Crie e gerencie as perguntas exibidas nos tablets.'],
    reports: ['Relatórios', 'Leia os resultados da experiência dos clientes.'],
  };
  const showDashboardView = (view, updateHash = true) => {
    const currentView = viewMeta[view] ? view : 'overview';
    root.querySelectorAll('[data-dashboard-view]').forEach((section) => section.classList.toggle('is-view-hidden', section.dataset.dashboardView !== currentView));
    root.querySelectorAll('.dashboard-nav__item').forEach((item) => item.classList.toggle('is-active', item.dataset.view === currentView));
    root.querySelector('#page-title').textContent = viewMeta[currentView][0];
    root.querySelector('#page-subtitle').textContent = viewMeta[currentView][1];
    if (updateHash && location.hash !== `#${currentView}`) history.replaceState(null, '', `#${currentView}`);
  };
  root.querySelectorAll('[data-view]').forEach((link) => link.addEventListener('click', (event) => {
    event.preventDefault();
    showDashboardView(link.dataset.view);
  }));
  window.onhashchange = () => showDashboardView(location.hash.slice(1), false);
  showDashboardView(location.hash.slice(1), false);

  root.querySelector('#logout').onclick = () => { clearAuthToken(); location.reload(); };
  root.querySelector('#change-password').onclick = async () => {
    const values = await openDialog({
      title: 'Trocar senha',
      description: 'Use uma senha com pelo menos 8 caracteres.',
      fields: [
        { name: 'currentPassword', label: 'Senha atual', type: 'password' },
        { name: 'newPassword', label: 'Nova senha', type: 'password', minLength: 8 },
        { name: 'confirmPassword', label: 'Confirmar nova senha', type: 'password', minLength: 8 },
      ],
      submitLabel: 'Atualizar senha',
    });
    if (!values) return;
    const status = root.querySelector('#dashboard-status');
    if (values.newPassword !== values.confirmPassword) {
      status.innerHTML = '<i></i>As senhas não conferem';
      status.classList.add('sync-status--error');
      return;
    }
    try {
      await api('/api/auth/change-password', { method: 'POST', body: JSON.stringify(values) });
      status.innerHTML = '<i></i>Senha atualizada';
      status.classList.remove('sync-status--error');
    } catch (error) {
      status.innerHTML = `<i></i>${escapeHtml(error.message)}`;
      status.classList.add('sync-status--error');
    }
  };

  if (user.role === 'SUPERADMIN') {
    root.querySelector('#tenant-filter').onchange = async (event) => {
      selectedTenantId = event.target.value;
      await loadDashboardData();
    };
    root.querySelector('#tenant-form').onsubmit = async (event) => {
      event.preventDefault();
      const form = new FormData(event.target);
      const message = root.querySelector('#tenant-message');
      const submitButton = event.target.querySelector('button[type="submit"]');
      submitButton.disabled = true;
      try {
        const created = await api('/api/tenants', { method: 'POST', body: JSON.stringify(Object.fromEntries(form)) });
        message.textContent = 'Empresa criada.';
        tenants = await api('/api/tenants');
        selectedTenantId = created.tenant.id;
        await renderDashboard(root, user);
      } catch (error) { message.textContent = error.message; } finally { submitButton.disabled = false; }
    };
    root.querySelector('#tenant-list').onclick = async (event) => {
      const button = event.target.closest('.edit-tenant');
      if (!button) return;
      const tenant = tenants.find((item) => String(item.id) === button.dataset.tenantId);
      if (!tenant) return;
      const values = await openDialog({
        title: `Editar ${tenant.name}`,
        description: 'Altere o nome da empresa, o limite de tablets e os dados de acesso do administrador.',
        fields: [
          { name: 'name', label: 'Nome da empresa', value: tenant.name },
          { name: 'deviceLimit', label: 'Limite de tablets', type: 'number', value: tenant.deviceLimit || 1, min: 1, max: 10000 },
          { name: 'adminEmail', label: 'E-mail do administrador', type: 'email', value: tenant.adminEmail || '' },
          { name: 'adminPassword', label: 'Nova senha (deixe em branco para manter)', type: 'password', minLength: 8, required: false },
        ],
        submitLabel: 'Salvar alterações',
      });
      if (!values) return;
      const message = root.querySelector('#tenant-message');
      message.classList.remove('inline-message--error');
      try {
        await api(`/api/tenants/${tenant.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ name: values.name, deviceLimit: values.deviceLimit, adminEmail: values.adminEmail, adminPassword: values.adminPassword }),
        });
        tenants = await api('/api/tenants');
        root.querySelector('#tenant-list').innerHTML = tenantListMarkup();
        const tenantFilter = root.querySelector('#tenant-filter');
        tenantFilter.innerHTML = tenantOptions();
        tenantFilter.value = String(selectedTenantId);
        const updatedTenant = tenants.find((item) => String(item.id) === String(tenant.id));
        if (updatedTenant && String(selectedTenantId) === String(tenant.id)) {
          tenantBranding = { ...tenantBranding, name: updatedTenant.name };
          applyTenantBranding(tenantBranding);
        }
        message.textContent = 'Empresa atualizada.';
      } catch (error) {
        message.textContent = error.message;
        message.classList.add('inline-message--error');
      }
    };
  }

  const typeSelect = root.querySelector('#survey-form [name=type]');
  const toggleSurveyFields = () => {
    root.querySelectorAll('.options-field').forEach((node) => node.classList.toggle('is-hidden', typeSelect.value !== 'options'));
    root.querySelectorAll('.emoji-config-field').forEach((node) => node.classList.toggle('is-hidden', typeSelect.value !== 'emoji'));
  };
  typeSelect.onchange = toggleSurveyFields;
  toggleSurveyFields();

  const surveyBrandingDraft = { logoData: null, backgroundData: null };
  const surveyBrandingTasks = { logo: Promise.resolve(), background: Promise.resolve() };
  const surveyBrandingInputs = [
    { kind: 'logo', field: 'logoData', input: root.querySelector('#survey-logo-input'), preview: root.querySelector('#survey-logo-preview'), placeholder: root.querySelector('#survey-logo-placeholder'), removeButton: root.querySelector('#remove-survey-logo'), message: root.querySelector('#survey-logo-message') },
    { kind: 'background', field: 'backgroundData', input: root.querySelector('#survey-background-input'), preview: root.querySelector('#survey-background-preview'), placeholder: root.querySelector('#survey-background-placeholder'), removeButton: root.querySelector('#remove-survey-background'), message: root.querySelector('#survey-background-message') },
  ];
  const resetSurveyBranding = () => {
    for (const asset of surveyBrandingInputs) {
      surveyBrandingDraft[asset.field] = null;
      asset.input.value = '';
      asset.preview.removeAttribute('src');
      asset.preview.hidden = true;
      asset.placeholder.hidden = false;
      asset.removeButton.disabled = true;
      asset.message.textContent = '';
      asset.message.classList.remove('inline-message--error');
      surveyBrandingTasks[asset.kind] = Promise.resolve();
    }
  };
  for (const asset of surveyBrandingInputs) {
    asset.input.onchange = () => {
      const file = asset.input.files?.[0];
      if (!file) return;
      asset.input.disabled = true;
      asset.removeButton.disabled = true;
      asset.message.textContent = `Preparando ${asset.kind === 'logo' ? 'logo' : 'plano de fundo'}...`;
      asset.message.classList.remove('inline-message--error');
      surveyBrandingTasks[asset.kind] = (async () => {
        try {
          const imageData = await prepareTenantImage(file, asset.kind);
          surveyBrandingDraft[asset.field] = imageData;
          asset.preview.src = imageData;
          asset.preview.hidden = false;
          asset.placeholder.hidden = true;
          asset.message.textContent = 'Imagem pronta para esta pesquisa.';
          asset.removeButton.disabled = false;
        } catch (error) {
          surveyBrandingDraft[asset.field] = null;
          asset.input.value = '';
          asset.message.textContent = error.message;
          asset.message.classList.add('inline-message--error');
        } finally {
          asset.input.disabled = false;
        }
      })();
    };
    asset.removeButton.onclick = () => {
      surveyBrandingDraft[asset.field] = null;
      asset.input.value = '';
      asset.preview.removeAttribute('src');
      asset.preview.hidden = true;
      asset.placeholder.hidden = false;
      asset.removeButton.disabled = true;
      asset.message.textContent = asset.kind === 'logo' ? 'Logo removida desta pesquisa.' : 'Plano de fundo removido desta pesquisa.';
      asset.message.classList.remove('inline-message--error');
    };
  }

  root.querySelector('#preview-survey').onclick = async (event) => {
    const formElement = root.querySelector('#survey-form');
    if (!formElement.reportValidity()) return;
    const button = event.currentTarget;
    const message = root.querySelector('#survey-message');
    const previewWindow = window.open('about:blank', '_blank');
    if (!previewWindow) {
      message.textContent = 'Permita pop-ups para abrir a pré-visualização.';
      message.classList.add('inline-message--error');
      return;
    }
    button.disabled = true;
    message.textContent = '';
    message.classList.remove('inline-message--error');
    try {
      await Promise.all(Object.values(surveyBrandingTasks));
      const form = new FormData(formElement);
      const type = String(form.get('type') || 'emoji');
      const options = type === 'emoji'
        ? readEmojiOptions(form, 'rating')
        : type === 'options'
          ? String(form.get('options') || '').split(',').map((item) => item.trim()).filter(Boolean)
          : [];
      const survey = {
        id: 'preview-questionnaire',
        title: form.get('title'),
        theme: { headerText: form.get('headerText'), logoPosition: form.get('logoPosition') || 'top' },
        branding: {
          logoData: surveyBrandingDraft.logoData || '',
          backgroundData: surveyBrandingDraft.backgroundData || '',
        },
        questions: [{ id: 'preview-question', text: form.get('question'), type, options }],
      };
      const previewId = crypto.randomUUID();
      navigatePreviewWindow(previewWindow, previewId, survey);
    } catch (error) {
      previewWindow.close();
      message.textContent = error.message || 'Não foi possível abrir a pré-visualização.';
      message.classList.add('inline-message--error');
    } finally {
      button.disabled = false;
    }
  };

  root.querySelector('#survey-form').onsubmit = async (event) => {
    event.preventDefault();
    const form = new FormData(event.target);
    const type = String(form.get('type') || 'emoji');
    const options = type === 'emoji'
      ? readEmojiOptions(form, 'rating')
      : String(form.get('options') || '').split(',').map((item) => item.trim()).filter(Boolean);
    const payload = {
      tenantId: selectedTenantId || undefined,
      title: form.get('title'),
      description: form.get('question'),
      headerText: form.get('headerText'),
      logoPosition: form.get('logoPosition') || 'top',
      logoData: surveyBrandingDraft.logoData,
      backgroundData: surveyBrandingDraft.backgroundData,
      questions: [{ text: form.get('question'), type, options }],
    };
    const message = root.querySelector('#survey-message');
    const submitButton = event.target.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    try {
      await Promise.all(Object.values(surveyBrandingTasks));
      await api('/api/surveys', { method: 'POST', body: JSON.stringify(payload) });
      message.textContent = 'Pesquisa cadastrada. Agora associe-a a um tablet.';
      event.target.reset(); resetSurveyBranding(); toggleSurveyFields(); await loadDashboardData();
    } catch (error) { message.textContent = error.message; } finally { submitButton.disabled = false; }
  };

  root.querySelector('#pair-form').onsubmit = async (event) => {
    event.preventDefault();
    const form = new FormData(event.target);
    const message = root.querySelector('#pair-message');
    const submitButton = event.target.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    try {
      await api('/api/devices/pair', {
        method: 'POST',
        body: JSON.stringify({ ...Object.fromEntries(form), tenantId: selectedTenantId || undefined }),
      });
      message.textContent = 'Tablet pareado com sucesso.';
      event.target.reset(); event.target.querySelector('[name=locationName]').value = 'Recepção';
      await loadDashboardData();
    } catch (error) { message.textContent = error.message; } finally { submitButton.disabled = false; }
  };

  root.querySelector('#load-report').onclick = loadDashboardData;
  const printReportButton = root.querySelector('#print-report');
  printReportButton.onclick = async () => {
    printReportButton.disabled = true;
    try {
      await loadDashboardData();
      const printImages = [root.querySelector('#report-company-logo')];
      await Promise.all(printImages.filter((image) => image && !image.hidden && image.decode).map((image) => image.decode().catch(() => {})));
      window.print();
    } finally {
      printReportButton.disabled = false;
    }
  };

  const brandingAssets = [
    { kind: 'logo', field: 'logoData', label: 'logo', inputId: '#tenant-logo-input', removeId: '#remove-tenant-logo', previewId: '#tenant-logo-preview', placeholderId: '#tenant-logo-placeholder', messageId: '#tenant-logo-message' },
  ].map((asset) => ({
    ...asset,
    input: root.querySelector(asset.inputId),
    removeButton: root.querySelector(asset.removeId),
    preview: root.querySelector(asset.previewId),
    placeholder: root.querySelector(asset.placeholderId),
    message: root.querySelector(asset.messageId),
  }));
  let brandingTenantId = null;
  let tenantBranding = null;

  function applyTenantBranding(branding) {
    const logoData = branding?.logoData || '';
    const reportIdentity = root.querySelector('.report-print-identity');
    const reportCompanyName = root.querySelector('#report-company-name');
    const reportCompanySubtitle = root.querySelector('#report-company-subtitle');
    const reportLogo = root.querySelector('#report-company-logo');

    if (reportCompanyName) reportCompanyName.textContent = branding?.name || '';
    if (reportCompanySubtitle) reportCompanySubtitle.textContent = branding?.name || '';
    if (reportIdentity) reportIdentity.hidden = !branding?.name && !logoData;
    if (reportLogo) {
      reportLogo.hidden = !logoData;
      if (logoData) {
        reportLogo.src = logoData;
        reportLogo.alt = branding?.name ? `Logo de ${branding.name}` : 'Logo da empresa';
      } else {
        reportLogo.removeAttribute('src');
      }
    }
    for (const asset of brandingAssets) {
      const imageData = branding?.[asset.field] || '';
      if (asset.preview) {
        asset.preview.hidden = !imageData;
        if (imageData) {
          asset.preview.src = imageData;
          asset.preview.alt = asset.kind === 'logo' ? 'Prévia da logo da empresa' : 'Prévia do plano de fundo';
        } else {
          asset.preview.removeAttribute('src');
        }
      }
      if (asset.placeholder) asset.placeholder.hidden = Boolean(imageData);
      if (asset.input) asset.input.disabled = !selectedTenantId;
      if (asset.removeButton) asset.removeButton.disabled = !selectedTenantId || !imageData;
    }
  }

  async function loadTenantBranding() {
    const requestedTenantId = String(selectedTenantId || '');
    if (!requestedTenantId) {
      brandingTenantId = null;
      tenantBranding = null;
      applyTenantBranding(null);
      return;
    }
    if (brandingTenantId === requestedTenantId && tenantBranding) {
      applyTenantBranding(tenantBranding);
      return;
    }
    brandingTenantId = null;
    tenantBranding = null;
    applyTenantBranding(null);
    const branding = await api(`/api/tenant/branding?tenantId=${encodeURIComponent(requestedTenantId)}`);
    if (String(selectedTenantId || '') !== requestedTenantId) return;
    brandingTenantId = requestedTenantId;
    tenantBranding = branding;
    applyTenantBranding(branding);
  }

  for (const asset of brandingAssets) {
    asset.input?.addEventListener('change', async (event) => {
      const file = event.currentTarget.files?.[0];
      if (!file) return;
      const tenantId = selectedTenantId;
      asset.input.disabled = true;
      if (asset.removeButton) asset.removeButton.disabled = true;
      if (asset.message) asset.message.textContent = `Preparando ${asset.label}...`;
      try {
        const imageData = await prepareTenantImage(file, asset.kind);
        if (asset.message) asset.message.textContent = `Salvando ${asset.label}...`;
        await api('/api/tenant/branding', {
          method: 'PUT',
          body: JSON.stringify({ tenantId, [asset.field]: imageData }),
        });
        if (String(selectedTenantId) === String(tenantId)) {
          tenantBranding = { ...tenantBranding, id: tenantId, [asset.field]: imageData };
          brandingTenantId = String(tenantId);
          applyTenantBranding(tenantBranding);
        }
        if (asset.message) asset.message.textContent = 'Logo salva para o relatório impresso.';
      } catch (error) {
        if (asset.message) asset.message.textContent = error.message;
      } finally {
        asset.input.value = '';
        asset.input.disabled = !selectedTenantId;
        if (asset.removeButton) asset.removeButton.disabled = !selectedTenantId || !tenantBranding?.[asset.field];
      }
    });

    asset.removeButton?.addEventListener('click', async () => {
      const tenantId = selectedTenantId;
      asset.removeButton.disabled = true;
      if (asset.input) asset.input.disabled = true;
      if (asset.message) asset.message.textContent = `Removendo ${asset.label}...`;
      try {
        await api('/api/tenant/branding', {
          method: 'PUT',
          body: JSON.stringify({ tenantId, [asset.field]: null }),
        });
        if (String(selectedTenantId) === String(tenantId)) {
          tenantBranding = { ...tenantBranding, id: tenantId, [asset.field]: null };
          brandingTenantId = String(tenantId);
          applyTenantBranding(tenantBranding);
        }
        if (asset.message) asset.message.textContent = 'Logo do relatório removida.';
      } catch (error) {
        if (asset.message) asset.message.textContent = error.message;
        asset.removeButton.disabled = !tenantBranding?.[asset.field];
      } finally {
        if (asset.input) asset.input.disabled = !selectedTenantId;
      }
    });
  }

  async function loadDashboardData() {
    const status = root.querySelector('#dashboard-status');
    try {
      await loadDashboardDataUnsafe();
      if (status) {
        status.innerHTML = '<i></i>Atualizado agora';
        status.classList.remove('sync-status--error');
      }
    } catch (error) {
      if (status) {
        status.innerHTML = '<i></i>Falha ao atualizar';
        status.classList.add('sync-status--error');
      }
      const visibleMessage = root.querySelector('.inline-message');
      if (visibleMessage) visibleMessage.textContent = error.message;
    }
  }

  async function loadDashboardDataUnsafe() {
    await loadTenantBranding();
    if (user.role === 'SUPERADMIN') {
      tenants = await api('/api/tenants');
      root.querySelector('#tenant-list').innerHTML = tenantListMarkup();
    }
    const suffix = selectedTenantId ? `?tenantId=${encodeURIComponent(selectedTenantId)}` : '';
    const reportParams = new URLSearchParams();
    if (selectedTenantId) reportParams.set('tenantId', selectedTenantId);
    if (root.querySelector('#from').value) reportParams.set('from', root.querySelector('#from').value);
    if (root.querySelector('#to').value) reportParams.set('to', root.querySelector('#to').value);
    const reportFilterNames = { 'report-survey': 'surveyId', 'report-location': 'locationId', 'report-device': 'deviceId' };
    const selectedReportFilters = Object.fromEntries(Object.keys(reportFilterNames).map((id) => [id, root.querySelector(`#${id}`).value]));
    for (const id of Object.keys(reportFilterNames)) {
      const value = root.querySelector(`#${id}`).value;
      if (value) reportParams.set(reportFilterNames[id], value);
    }
    const [surveys, devices, reports] = await Promise.all([
      api(`/api/surveys${suffix}`),
      api(`/api/devices${suffix}`),
      api(`/api/reports?${reportParams}`),
    ]);

    root.querySelector('#survey-list').innerHTML = surveys.length
      ? surveys.map((survey) => `<div class="survey-row"><div class="survey-row__icon" aria-hidden="true">${dashboardIcon('survey')}</div><div class="survey-row__body"><strong>${escapeHtml(survey.title)}</strong><small><span class="status-pill ${survey.published ? 'status-pill--active' : 'status-pill--muted'}">${survey.published ? 'Ativa' : 'Inativa'}</span><span>${survey.assigned_devices || 0} tablet(s)</span></small></div><div class="row-actions"><button class="outline-button edit-survey" data-survey="${survey.id}">Editar</button><button class="outline-button toggle-survey" data-survey="${survey.id}" data-published="${survey.published}">${survey.published ? 'Desativar' : 'Ativar'}</button></div></div>`).join('')
      : '<p class="empty-state">Nenhuma pesquisa cadastrada.</p>';

    root.querySelector('#device-count').textContent = `${devices.length} dispositivo(s)`;
    root.querySelector('#device-list').innerHTML = devices.length ? devices.map((device) => `
      <div class="device-row ${device.active ? '' : 'device-row--inactive'}">
        <div class="device-summary"><div class="device-name-row"><span class="status-dot ${device.runtime_status === 'online' ? 'status-dot--online' : 'status-dot--offline'}" aria-hidden="true"></span><strong>${escapeHtml(device.name)}</strong><span class="device-status-label">${device.runtime_status === 'online' ? 'Online' : 'Offline'}</span>${device.active ? '' : '<span class="status-pill status-pill--muted">Desativado</span>'}</div><small class="device-location">${escapeHtml(device.location_name || 'Sem unidade')} · Pesquisa: <strong>${escapeHtml(device.active_survey_title || 'Nenhuma')}</strong></small><details class="device-details"><summary>Ver detalhes</summary><div class="device-meta"><span>Visto ${device.last_seen_at ? escapeHtml(new Date(device.last_seen_at).toLocaleString('pt-BR')) : 'nunca'}</span><span>${escapeHtml(device.manufacturer || '—')} ${escapeHtml(device.model || '')} · Android ${escapeHtml(device.android_version || '—')}</span><span>Bateria ${device.battery_level === null || device.battery_level === undefined ? '—' : `${device.battery_level}%`}${device.charging === true ? ' · carregando' : ''} · ${escapeHtml(device.network_state || '—')}</span><span>Pendentes: ${device.pending_responses ?? '—'} · ${escapeHtml(device.orientation || '—')}</span></div></details></div>
        <div class="device-assign"><div class="device-assign__primary"><select data-survey-for="${device.id}"><option value="">Escolha uma pesquisa</option>${surveys.map((survey) => `<option value="${survey.id}" ${String(survey.id) === String(device.active_survey_id) ? 'selected' : ''}>${escapeHtml(survey.title)}</option>`).join('')}</select><button class="outline-button assign-button" data-device="${device.id}">Aplicar</button><button class="outline-button preview-device" data-device="${device.id}" ${device.active_survey_id ? '' : 'disabled'}>Pré-visualizar</button></div><span class="device-preview-message" data-preview-message="${device.id}" role="status" aria-live="polite"></span><details class="device-actions"><summary>Gerenciar</summary><div class="device-actions__menu"><button class="outline-button refresh-config" data-device="${device.id}">Atualizar config.</button><button class="outline-button clear-survey" data-device="${device.id}">Remover pesquisa</button><button class="outline-button edit-device" data-device="${device.id}" data-name="${escapeHtml(device.name)}" data-location="${escapeHtml(device.location_name || '')}">Editar</button><button class="outline-button unpair-device" data-device="${device.id}">Desparear</button>${device.active ? `<button class="outline-button danger-button deactivate-device" data-device="${device.id}">Desativar</button>` : ''}</div></details></div>
      </div>`).join('') : '<p class="empty-state">Nenhum tablet pareado.</p>';

    root.querySelectorAll('.assign-button').forEach((button) => {
      button.onclick = async () => {
        const surveyId = root.querySelector(`[data-survey-for="${button.dataset.device}"]`).value;
        if (!surveyId) return;
        button.disabled = true;
        try { await api(`/api/devices/${button.dataset.device}/assign-survey`, { method: 'POST', body: JSON.stringify({ surveyId }) }); await loadDashboardData(); }
        finally { button.disabled = false; }
      };
    });

    root.querySelectorAll('.preview-device').forEach((button) => {
      const surveySelect = root.querySelector(`[data-survey-for="${button.dataset.device}"]`);
      const message = root.querySelector(`[data-preview-message="${button.dataset.device}"]`);
      surveySelect?.addEventListener('change', () => { button.disabled = !surveySelect.value; });
      button.onclick = async () => {
        const surveyId = surveySelect?.value;
        if (!surveyId) return;
        const previewWindow = window.open('about:blank', '_blank');
        if (!previewWindow) {
          if (message) message.textContent = 'Permita pop-ups para abrir a pré-visualização.';
          return;
        }
        button.disabled = true;
        if (message) message.textContent = '';
        const originalLabel = button.textContent;
        button.textContent = 'Carregando…';
        try {
          const { token } = await api(`/api/surveys/${encodeURIComponent(surveyId)}/preview`, { method: 'POST' });
          navigateServerPreviewWindow(previewWindow, token);
        } catch (error) {
          previewWindow.close();
          if (message) message.textContent = error.message || 'Não foi possível abrir a pré-visualização.';
        } finally {
          button.textContent = originalLabel;
          button.disabled = !surveySelect?.value;
        }
      };
    });

    const reportFilterOptions = {
      'report-survey': `<option value="">Todas</option>${surveys.map((survey) => `<option value="${survey.id}">${escapeHtml(survey.title)}</option>`).join('')}`,
      'report-location': `<option value="">Todas</option>${[...new Map(devices.filter((device) => device.location_id).map((device) => [device.location_id, device.location_name])).entries()].map(([id, name]) => `<option value="${id}">${escapeHtml(name)}</option>`).join('')}`,
      'report-device': `<option value="">Todos</option>${devices.map((device) => `<option value="${device.id}">${escapeHtml(device.name)}</option>`).join('')}`,
    };
    for (const id of Object.keys(reportFilterOptions)) {
      const select = root.querySelector(`#${id}`);
      select.innerHTML = reportFilterOptions[id];
      if (selectedReportFilters[id]) select.value = selectedReportFilters[id];
    }
    const formatReportDate = (value) => value ? value.split('-').reverse().join('/') : '';
    const fromDate = root.querySelector('#from').value;
    const toDate = root.querySelector('#to').value;
    const periodLabel = fromDate && toDate
      ? `${formatReportDate(fromDate)} a ${formatReportDate(toDate)}`
      : fromDate ? `Desde ${formatReportDate(fromDate)}`
        : toDate ? `Até ${formatReportDate(toDate)}` : 'Todo o período';
    const report = reports?.metrics ? reports : { metrics: { total: 0, averageScore: null, satisfiedRate: 0, neutralRate: 0, dissatisfiedRate: 0 }, distribution: [], rows: [] };
    const metrics = report.metrics;
    const printContext = [
      ['Período', periodLabel],
      ['Pesquisa', root.querySelector('#report-survey').selectedOptions[0]?.textContent.trim() || 'Todas'],
      ['Unidade', root.querySelector('#report-location').selectedOptions[0]?.textContent.trim() || 'Todas'],
      ['Tablet', root.querySelector('#report-device').selectedOptions[0]?.textContent.trim() || 'Todos'],
    ];
    const printContextContainer = root.querySelector('#report-print-context');
    printContextContainer.replaceChildren(...printContext.map(([label, value]) => {
      const line = document.createElement('div');
      line.className = 'report-print-context__item';
      const labelElement = document.createElement('strong');
      labelElement.textContent = `${label}:`;
      const valueElement = document.createElement('span');
      valueElement.textContent = value;
      line.append(labelElement, valueElement);
      return line;
    }));
    root.querySelector('#report-total').textContent = `${metrics.total} avaliação(ões)`;
    root.querySelector('#report-metrics').innerHTML = `<div class="metric-card metric-card--blue"><div class="metric-card__top"><span class="metric-card__icon" aria-hidden="true">${dashboardIcon('evaluations')}</span><span>Avaliações</span></div><strong>${metrics.total}</strong><small>No período</small></div><div class="metric-card metric-card--green"><div class="metric-card__top"><span class="metric-card__icon" aria-hidden="true">${dashboardIcon('satisfaction')}</span><span>Satisfação</span></div><strong>${Number(metrics.satisfiedRate || 0).toLocaleString('pt-BR')}%</strong><small>Clientes satisfeitos</small></div><div class="metric-card metric-card--purple"><div class="metric-card__top"><span class="metric-card__icon" aria-hidden="true">${dashboardIcon('rating')}</span><span>Nota média</span></div><strong>${metrics.averageScore === null ? '—' : Number(metrics.averageScore).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</strong><small>De 1 a 5</small></div><div class="metric-card metric-card--orange"><div class="metric-card__top"><span class="metric-card__icon" aria-hidden="true">${dashboardIcon('dissatisfaction')}</span><span>Insatisfação</span></div><strong>${Number(metrics.dissatisfiedRate || 0).toLocaleString('pt-BR')}%</strong><small>Clientes insatisfeitos</small></div>`;
    root.querySelector('#report-distribution').innerHTML = report.distribution?.length
      ? report.distribution.map((item) => `<div class="distribution-row"><span class="distribution-label"><span class="distribution-emoji" aria-hidden="true">${escapeHtml(item.emoji)}</span><span>${escapeHtml(item.label)}</span></span><span class="distribution-bar"><i style="width:${metrics.total ? Math.min(100, (item.count / metrics.total) * 100) : 0}%"></i></span><strong>${item.count}</strong></div>`).join('')
      : '<p class="empty-state">Sem distribuição no período.</p>';
    root.querySelector('#report-list').innerHTML = report.rows?.length
      ? report.rows.slice(0, 30).map((row) => `<div class="report-row"><span class="report-row__dot" aria-hidden="true"></span><div><strong>${escapeHtml(row.survey_title)}</strong><small>${escapeHtml(row.location_name || row.device_name || 'Tablet')} · ${escapeHtml(row.day)}</small></div><b>${row.total}</b></div>`).join('')
      : '<p class="empty-state">Sem respostas no período.</p>';

    root.querySelectorAll('.clear-survey').forEach((button) => {
      button.onclick = async () => { button.disabled = true; try { await api(`/api/devices/${button.dataset.device}/remove-survey`, { method: 'POST' }); await loadDashboardData(); } finally { button.disabled = false; } };
    });
    root.querySelectorAll('.refresh-config').forEach((button) => {
      button.onclick = async () => { button.disabled = true; try { await api(`/api/devices/${button.dataset.device}/refresh-config`, { method: 'POST' }); await loadDashboardData(); } finally { button.disabled = false; } };
    });
    root.querySelectorAll('.edit-device').forEach((button) => {
      button.onclick = async () => {
        const values = await openDialog({
          title: 'Editar tablet',
          description: 'Atualize a identificação e o local de operação.',
          fields: [
            { name: 'name', label: 'Nome do tablet', value: button.dataset.name },
            { name: 'locationName', label: 'Unidade / local', value: button.dataset.location || 'Recepção' },
          ],
        });
        if (!values) return;
        button.disabled = true;
        try {
          await api(`/api/devices/${button.dataset.device}`, { method: 'PATCH', body: JSON.stringify(values) });
          await loadDashboardData();
        } finally { button.disabled = false; }
      };
    });
    root.querySelectorAll('.unpair-device').forEach((button) => {
      button.onclick = async () => {
        if (!await confirmAction('Desparear tablet?', 'A pesquisa ativa será removida do dispositivo.')) return;
        button.disabled = true;
        try { await api(`/api/devices/${button.dataset.device}/unpair`, { method: 'POST' }); await loadDashboardData(); }
        finally { button.disabled = false; }
      };
    });
    root.querySelectorAll('.deactivate-device').forEach((button) => {
      button.onclick = async () => {
        if (!await confirmAction('Desativar tablet?', 'O dispositivo deixará de receber pesquisas até ser ativado novamente.')) return;
        button.disabled = true;
        try { await api(`/api/devices/${button.dataset.device}`, { method: 'DELETE' }); await loadDashboardData(); }
        finally { button.disabled = false; }
      };
    });
    root.querySelectorAll('.edit-survey').forEach((button) => {
      button.onclick = async () => {
        const survey = await api(`/api/surveys/${button.dataset.survey}`);
        const question = survey.questions?.[0];
        const values = await openDialog({
          title: 'Editar pesquisa',
          description: 'Altere a pesquisa e, se quiser, personalize a logo e o fundo exibidos no tablet.',
          fields: [
            { name: 'title', label: 'Título da pesquisa', value: survey.title },
            { name: 'headerText', label: 'Texto acima das avaliações', value: typeof survey.theme?.headerText === 'string' ? survey.theme.headerText : DEFAULT_SURVEY_HEADER, maxLength: 120, required: false },
            { name: 'questionText', label: 'Pergunta para o cliente', value: question?.text || survey.description || '' },
            { name: 'logoPosition', label: 'Posição da logo no tablet', type: 'select', value: survey.theme?.logoPosition || 'top', options: SURVEY_LOGO_POSITION_OPTIONS },
            { name: 'type', label: 'Tipo de resposta', value: question?.type || 'emoji', type: 'select', options: [
              { value: 'emoji', label: 'Carinhas animadas' },
              { value: 'stars', label: 'Estrelas (1 a 5)' },
              { value: 'scale', label: 'Nota de 1 a 10' },
              { value: 'options', label: 'Opções personalizadas' },
            ] },
            { name: 'options', label: 'Opções separadas por vírgula', value: (question?.options || []).join(', '), required: false },
            { name: 'emoji-config', label: 'Personalizar carinhas animadas', value: normalizeEmojiOptions(question?.options), type: 'emoji-config' },
            {
              name: 'survey-branding',
              type: 'survey-branding',
              logo: {
                name: 'logoFile', label: 'Logo desta pesquisa', previewSrc: survey.branding?.logoData,
                previewAlt: 'Logo atual da pesquisa', emptyLabel: 'Sem logo', accept: 'image/png,image/jpeg,image/webp',
                hint: survey.brandingOverrides?.logo ? 'Logo atual. Selecione outra para substituir.' : 'Opcional. Aparece no tablet desta pesquisa.',
                removeName: 'removeLogo', removeLabel: 'Remover logo personalizada', removeHidden: !survey.brandingOverrides?.logo,
              },
              background: {
                name: 'backgroundFile', label: 'Plano de fundo', previewSrc: survey.branding?.backgroundData,
                previewAlt: 'Plano de fundo atual da pesquisa', emptyLabel: 'Sem fundo', accept: 'image/png,image/jpeg,image/webp',
                hint: survey.brandingOverrides?.background ? 'Fundo atual. Selecione outra imagem para substituir.' : 'Opcional. Aparece no tablet desta pesquisa.',
                removeName: 'removeBackground', removeLabel: 'Remover fundo personalizado', removeHidden: !survey.brandingOverrides?.background,
              },
            },
          ],
        });
        if (!values) return;
        const nextQuestion = { text: values.questionText, type: values.type, options: values.type === 'emoji' ? readEmojiOptions(values, 'emoji-config') : values.type === 'options' ? values.options.split(',').map((item) => item.trim()).filter(Boolean) : [] };
        const brandingUpdate = {};
        button.disabled = true;
        try {
          if (values.logoFile?.size) brandingUpdate.logoData = await prepareTenantImage(values.logoFile, 'logo');
          else if (values.removeLogo) brandingUpdate.logoData = null;
          if (values.backgroundFile?.size) brandingUpdate.backgroundData = await prepareTenantImage(values.backgroundFile, 'background');
          else if (values.removeBackground) brandingUpdate.backgroundData = null;
          await api(`/api/surveys/${survey.id}`, { method: 'PATCH', body: JSON.stringify({ title: values.title, headerText: values.headerText, logoPosition: values.logoPosition, description: values.questionText, questions: [nextQuestion] }) });
          if (Object.keys(brandingUpdate).length) {
            await api(`/api/surveys/${survey.id}/branding`, { method: 'PUT', body: JSON.stringify(brandingUpdate) });
          }
          await loadDashboardData();
        } catch (error) {
          const status = root.querySelector('#dashboard-status');
          status.innerHTML = `<i></i>${escapeHtml(error.message)}`;
          status.classList.add('sync-status--error');
        } finally { button.disabled = false; }
      };
    });
    root.querySelectorAll('.toggle-survey').forEach((button) => {
      button.onclick = async () => {
        button.disabled = true;
        try { await api(`/api/surveys/${button.dataset.survey}`, { method: 'PATCH', body: JSON.stringify({ published: button.dataset.published !== 'true' }) }); await loadDashboardData(); }
        finally { button.disabled = false; }
      };
    });
    for (const id of ['report-survey', 'report-location', 'report-device']) root.querySelector(`#${id}`).onchange = loadDashboardData;
  }

  await loadDashboardData();
}
