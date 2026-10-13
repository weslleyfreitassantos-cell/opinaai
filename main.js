import './styles.css';

const app = document.querySelector('#app');

app.innerHTML = `
  <section class="login-shell" aria-label="Acesso administrativo Opina AI">
    <div class="brand-panel">
      <div class="brand-panel__rings" aria-hidden="true"></div>
      <div class="brand-panel__content">
        <h1>Pesquisas de<br><span>satisfação</span></h1>
        <p class="intro">Colete opiniões e acompanhe a experiência em tempo real.</p>

        <div class="feedback-visual" aria-label="Cartão ilustrativo de opiniões">
          <div class="feedback-visual__glow"></div>
          <div class="feedback-card">
            <div class="feedback-card__brand">
              <span class="sparkle-icon" aria-hidden="true">✦</span>
              <strong>Opina <em>AI</em></strong>
            </div>
            <div class="faces" aria-hidden="true">
              <img class="faces-reference" src="/assets/faces-reference.png" alt="">
            </div>
          </div>
        </div>

      </div>
    </div>

    <div class="form-panel">
      <div class="form-panel__content">
        <p class="eyebrow eyebrow--blue">ÁREA ADMINISTRATIVA</p>
        <h2>Bem-vindo de volta</h2>
        <p class="form-intro">Entre para gerenciar suas pesquisas e resultados.</p>

        <form id="login-form" class="login-form">
          <label for="email">Usuário ou e-mail</label>
          <input id="email" name="email" type="text" placeholder="Pesquisa@AdminAdmin" autocomplete="username" required>

          <label for="password">Senha</label>
          <div class="password-field">
            <input id="password" name="password" type="password" placeholder="Digite sua senha" autocomplete="current-password" required>
            <button id="toggle-password" class="icon-button" type="button" aria-label="Mostrar senha" title="Mostrar senha">◉</button>
          </div>

          <button class="submit-button" type="submit">Entrar</button>
          <p id="form-message" class="form-message" role="status" aria-live="polite"></p>
        </form>
      </div>
    </div>
  </section>
`;

const passwordInput = document.querySelector('#password');
const togglePassword = document.querySelector('#toggle-password');
const loginForm = document.querySelector('#login-form');
const formMessage = document.querySelector('#form-message');

togglePassword.addEventListener('click', () => {
  const isHidden = passwordInput.type === 'password';
  passwordInput.type = isHidden ? 'text' : 'password';
  togglePassword.textContent = isHidden ? '◉' : '◌';
  togglePassword.setAttribute('aria-label', isHidden ? 'Ocultar senha' : 'Mostrar senha');
  togglePassword.setAttribute('title', isHidden ? 'Ocultar senha' : 'Mostrar senha');
});

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  formMessage.textContent = 'Entrando...'; formMessage.classList.add('form-message--visible');
  try {
    const response = await fetch('/api/auth/login', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({email:document.querySelector('#email').value,password:passwordInput.value}) });
    const data = await response.json(); if (!response.ok) throw new Error(data.error);
    localStorage.setItem('opina_token', data.token); renderDashboard(data.user);
  } catch (error) { formMessage.textContent = error.message || 'Não foi possível conectar à API.'; }
});

async function renderDashboard(user) {
  const token = localStorage.getItem('opina_token');
  app.innerHTML = `<main class="dashboard"><header class="dashboard-header"><div><p class="eyebrow eyebrow--blue">OPINA AI</p><h2>Painel de pesquisas</h2><p>Olá, ${user.name}. Gerencie pesquisas e acompanhe os resultados.</p></div><button id="logout" class="outline-button">Sair</button></header><section class="dashboard-grid"><article class="dashboard-card"><h3>Nova pesquisa</h3><form id="survey-form"><label>Título</label><input name="title" required placeholder="Ex.: Atendimento da loja"><label>Descrição</label><input name="description" placeholder="Pergunta principal da pesquisa"><label>Tipo de resposta</label><select name="type"><option value="emoji">Emojis de satisfação</option><option value="scale">Nota de 1 a 10</option><option value="options">Opções personalizadas</option></select><button class="submit-button" type="submit">Cadastrar pesquisa</button><p id="survey-message" class="form-message"></p></form></article><article class="dashboard-card"><div class="card-title"><h3>Relatórios</h3><span id="report-total">Carregando...</span></div><div class="date-row"><label>De <input id="from" type="date"></label><label>Até <input id="to" type="date"></label></div><button id="load-report" class="outline-button">Atualizar período</button><div id="report-list"></div></article></section><section class="dashboard-card"><h3>Pesquisas cadastradas</h3><div id="survey-list">Carregando...</div></section></main>`;
  document.querySelector('#logout').onclick=()=>{localStorage.removeItem('opina_token'); location.reload()};
  document.querySelector('#survey-form').onsubmit=async(e)=>{e.preventDefault();const f=new FormData(e.target);const r=await fetch('/api/surveys',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({title:f.get('title'),description:f.get('description'),questions:[{text:f.get('description')||f.get('title'),type:f.get('type')}]})});document.querySelector('#survey-message').textContent=r.ok?'Pesquisa cadastrada com sucesso.':(await r.json()).error;loadDashboardData()};
  document.querySelector('#load-report').onclick=loadDashboardData; await loadDashboardData();
  async function loadDashboardData(){const [s,r]=await Promise.all([fetch('/api/surveys',{headers:{Authorization:`Bearer ${token}`}}),fetch(`/api/reports?from=${document.querySelector('#from').value}&to=${document.querySelector('#to').value}`,{headers:{Authorization:`Bearer ${token}`}})]);const surveys=await s.json(), reports=await r.json();document.querySelector('#survey-list').innerHTML=surveys.length?surveys.map(x=>`<div class="survey-row"><strong>${x.title}</strong><span>${x.published?'Publicado':'Rascunho'}</span></div>`).join(''):'Nenhuma pesquisa cadastrada.';document.querySelector('#report-total').textContent=`${reports.reduce((a,x)=>a+x.total,0)} respostas`;document.querySelector('#report-list').innerHTML=reports.map(x=>`<p>${x.day}: <strong>${x.total}</strong> resposta(s)</p>`).join('')||'<p>Sem respostas no período.</p>'}
}

if (localStorage.getItem('opina_token')) { fetch('/api/me',{headers:{Authorization:`Bearer ${localStorage.getItem('opina_token')}`}}).then(r=>r.ok?r.json():null).then(u=>u&&renderDashboard(u)); }
