const api = window.farm;
const grid = document.getElementById('grid');

let config;
let devices;
const active = {}; // phoneId -> url do app em primeiro plano (null = tela inicial)
const running = new Set(); // `${phoneId}|${url}` com view viva no main

const key = (phoneId, url) => `${phoneId}|${url}`;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const appByUrl = (url) => config.apps.find((a) => a.url === url);
// Cor do manifest vai parar num atributo style: só passa o que tem cara de cor.
const cssColor = (c) => (typeof c === 'string' && /^(#[0-9a-f]{3,8}|[a-z]+|(rgb|hsl)a?\([\d\s.,%/+-]+\))$/i.test(c.trim()) ? c.trim() : null);

// Ícones da barra de status do celular (preenchidos).
const ICONS = {
  signal: '<svg viewBox="0 0 18 14"><rect x="0" y="9" width="3" height="5" rx="1"/><rect x="5" y="6" width="3" height="8" rx="1"/><rect x="10" y="3" width="3" height="11" rx="1"/><rect x="15" y="0" width="3" height="14" rx="1"/></svg>',
  wifi: '<svg viewBox="0 0 18 14"><path d="M9 14 6 10.5a4.5 4.5 0 0 1 6 0zM3.5 8 2 6.3a10 10 0 0 1 14 0L14.5 8a8 8 0 0 0-11 0z"/></svg>',
  offline: '<svg viewBox="0 0 18 14"><path d="M2 1l14 12-1 1L1 2zM9 14 6 10.5a4.5 4.5 0 0 1 4.3-1.4z"/></svg>',
  battery: '<svg viewBox="0 0 26 14" style="width:26px"><rect x=".5" y=".5" width="22" height="13" rx="3" fill="none" stroke="currentColor"/><rect x="2" y="2" width="16" height="10" rx="2"/><rect x="23.5" y="4.5" width="2" height="5" rx="1"/></svg>',
};

// Ícones da interface (traço, 24×24).
const UI_ICONS = {
  smartphone: '<rect width="14" height="20" x="5" y="2" rx="2"/><path d="M12 18h.01"/>',
  plus: '<path d="M5 12h14M12 5v14"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  zoom: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3M11 8v6M8 11h6"/>',
  pointer: '<path d="M14 4.1 12 6M5.1 8l-2.9-.8M6 12l-1.9 2M7.2 2.2 8 5.1"/><path d="M9.04 9.69a.5.5 0 0 1 .65-.65l11 4.5a.5.5 0 0 1-.07.95l-4.35 1.04a1 1 0 0 0-.74.74l-1.04 4.35a.5.5 0 0 1-.95.07z"/>',
  activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  trash: '<path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2M10 11v6M14 11v6"/>',
  more: '<circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>',
  wifiOff: '<path d="M12 20h.01M8.5 16.43a5 5 0 0 1 7 0M5 12.86a10 10 0 0 1 5.17-2.69M19 12.86a10 10 0 0 0-2-1.52M2 8.82a15 15 0 0 1 4.18-2.64M22 8.82a15 15 0 0 0-11.29-3.76M2 2l20 20"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  alert: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>',
  loader: '<path d="M21 12a9 9 0 1 1-6.22-8.56"/>',
};
const uiIcon = (name) => `<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${UI_ICONS[name]}</svg>`;

// Botões e campos com data-icon ganham o ícone na frente; o texto vai pra um <span>,
// que é o que muda quando o botão troca de rótulo.
function hydrateIcons(root = document) {
  for (const el of root.querySelectorAll('[data-icon]')) {
    const text = el.textContent.trim();
    el.innerHTML = uiIcon(el.dataset.icon) + (text ? `<span>${esc(text)}</span>` : '');
  }
}

// Atalhos da tela vazia: um modelo de cada marca.
const QUICK_DEVICES = ['iphone-17', 'galaxy-s25', 'pixel-10', 'xiaomi-15', 'poco-f7'];

// Cor de texto legível sobre um fundo (#rgb / #rrggbb).
function textOn(bg) {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(bg || '')?.[1];
  if (!hex) return '#fff';
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#000' : '#fff';
}

function geometry(phone) {
  const d = devices[phone.device];
  const rot = !!phone.rotated;
  const [sw, sh] = rot ? [d.h, d.w] : [d.w, d.h];
  let pad = { t: 14, r: 14, b: 14, l: 14 };
  if (d.homeButton) pad = rot ? { t: 16, r: 72, b: 16, l: 72 } : { t: 72, r: 16, b: 72, l: 16 };
  return { d, rot, sw, sh, pad, fw: sw + pad.l + pad.r, fh: sh + pad.t + pad.b };
}

const now = () => new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const today = () => new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });

function iconHTML(app) {
  const letter = esc((app.name || '?').trim().charAt(0).toUpperCase());
  const img = app.icon ? `<img src="${esc(app.icon)}" alt="">` : letter;
  return `<div class="img" data-letter="${letter}">${img}</div>`;
}

function launcherHTML(phone) {
  const apps = config.apps.map((a) => `
    <div class="app-icon ${running.has(key(phone.id, a.url)) ? 'running' : ''}" data-url="${esc(a.url)}" title="${esc(a.url)}">
      ${iconHTML(a)}
      <span class="label">${esc(a.name)}</span>
    </div>`).join('');
  return `
    <div class="launcher">
      <div class="clock"><div class="time">${now()}</div><div class="date">${today()}</div></div>
      ${apps ? `<div class="apps">${apps}</div>` : '<div class="empty">Nenhum app ainda.<br>Cole a URL do PWA em “Adicionar app” lá em cima.</div>'}
    </div>`;
}

function phoneHTML(phone) {
  const g = geometry(phone);
  const { d } = g;
  const z = config.zoom;
  const url = active[phone.id];
  const app = url && appByUrl(url);
  const ios = d.platform === 'ios';

  const barBg = app ? (cssColor(app.theme) || (ios ? '#ffffff' : '#000000')) : 'transparent';
  const navBg = app ? (ios ? (cssColor(app.background) || '#ffffff') : '#000000') : 'transparent';
  const barFg = app ? textOn(barBg) : '#fff';
  const navFg = app ? textOn(navBg) : '#fff';

  const nav = d.nav === 0 ? '' : ios
    ? `<div class="navbar" style="height:${d.nav}px;background:${navBg};color:${navFg}"><div class="home-indicator" data-act="home" title="Home"></div></div>`
    : `<div class="navbar" style="height:${d.nav}px;background:${navBg};color:${navFg}">
         <button data-act="recents" title="Alternar apps">▢</button>
         <button data-act="home" title="Home">◯</button>
         <button data-act="back" title="Voltar">◁</button>
       </div>`;

  const homeBtn = d.homeButton
    ? `<div class="home-button" data-act="home" title="Home" style="${g.rot
      ? `left:${g.pad.l + g.sw + 8}px;top:${g.fh / 2 - 28}px`
      : `left:${g.fw / 2 - 28}px;top:${g.pad.t + g.sh + 8}px`}"></div>`
    : '';

  const viewport = app
    ? `<div class="viewport"><div class="placeholder" style="background:${esc(cssColor(app.background) || '#fff')}">${app.icon ? `<img src="${esc(app.icon)}" alt="">` : ''}</div></div>`
    : `<div class="viewport">${launcherHTML(phone)}</div>`;

  return `
    <section class="phone" data-phone="${phone.id}" style="width:${g.fw * z}px">
      <div class="phone-head">
        <span class="os ${d.platform}">${ios ? 'iOS' : 'Android'}</span>
        <div class="phone-title">
          <b>${esc(phone.label)}</b>
          <span>${esc(d.name)} · ${g.sw}×${g.sh}</span>
        </div>
        ${phone.offline ? `<span class="tag">${uiIcon('wifiOff')}offline</span>` : ''}
        <button class="menu-btn" data-act="menu" title="Mais detalhes" aria-label="Mais detalhes de ${esc(phone.label)}">${uiIcon('more')}</button>
      </div>
      <div class="slot" style="width:${g.fw * z}px;height:${g.fh * z}px">
        <div class="frame" style="--frame:${cssColor(d.frame) || '#2b2e35'};width:${g.fw}px;height:${g.fh}px;padding:${g.pad.t}px ${g.pad.r}px ${g.pad.b}px ${g.pad.l}px;border-radius:${d.radius ? d.radius + 14 : 48}px;transform:scale(${z})">
          <div class="screen ${d.platform} ${app ? '' : 'home'}" style="width:${g.sw}px;height:${g.sh}px;border-radius:${d.radius}px">
            <div class="statusbar" style="height:${d.status}px;background:${barBg};color:${barFg}">
              <span class="clock-small">${now()}</span>
              <span class="icons">${ICONS.signal}${phone.offline ? ICONS.offline : ICONS.wifi}${ICONS.battery}</span>
            </div>
            ${viewport}
            ${nav}
            ${!g.rot && d.cutout !== 'none' ? `<div class="cutout ${d.cutout}"></div>` : ''}
          </div>
          ${homeBtn}
        </div>
      </div>
    </section>`;
}

function emptyHTML() {
  const quick = QUICK_DEVICES.filter((id) => devices[id]).map((id) =>
    `<button class="btn" data-add="${id}">${uiIcon('smartphone')}<span>${esc(devices[id].name)}</span></button>`).join('');
  return `
    <div class="empty-state">
      <img src="logo.svg" alt="" width="88" height="88">
      <h2>Nenhum celular na tela</h2>
      <p>O Phone Farm é uma ferramenta de teste: cada celular é um emulador com a tela, o toque e o User-Agent do aparelho,
         pra você abrir e testar aplicações PWA em vários celulares lado a lado.</p>
      <p class="muted">Comece por um destes, ou escolha outro modelo lá em cima:</p>
      <div class="quick">${quick}</div>
    </div>`;
}

function render() {
  grid.innerHTML = config.phones.length ? config.phones.map(phoneHTML).join('') : emptyHTML();
  document.getElementById('remove-all').disabled = !config.phones.length;
  scheduleSync();
}

// Diz ao main onde posicionar cada app aberto. Celular cortado pela rolagem fica com o app escondido,
// porque a view nativa ficaria por cima da barra de ferramentas.
let syncQueued = false;
function scheduleSync() {
  if (syncQueued) return;
  syncQueued = true;
  requestAnimationFrame(() => {
    syncQueued = false;
    const bounds = grid.getBoundingClientRect();
    const entries = [];
    for (const phone of config.phones) {
      const url = active[phone.id];
      if (!url) continue;
      const vp = grid.querySelector(`[data-phone="${phone.id}"] .viewport`);
      if (!vp) continue;
      const r = vp.getBoundingClientRect();
      const visible = r.top >= bounds.top - 1 && r.bottom <= bounds.bottom + 1 && r.left >= bounds.left - 1 && r.right <= bounds.right + 1;
      vp.classList.toggle('clipped', !visible);
      if (visible) entries.push({ phoneId: phone.id, url, rect: { x: r.left, y: r.top, width: r.width, height: r.height } });
    }
    api.sync(entries);
  });
}

async function openApp(phoneId, url) {
  await api.openApp(phoneId, url);
  running.add(key(phoneId, url));
  active[phoneId] = url;
  render();
}

function goHome(phoneId) {
  active[phoneId] = null;
  render();
}

// Botão "recentes" do Android: alterna pro próximo app aberto neste celular.
function cycleApps(phoneId) {
  const open = config.apps.map((a) => a.url).filter((u) => running.has(key(phoneId, u)));
  if (!open.length) return;
  const next = open[(open.indexOf(active[phoneId]) + 1) % open.length];
  active[phoneId] = next;
  render();
}

function onIconActivate(e) {
  if (e.type !== config.openOn) return;
  const icon = e.target.closest('.app-icon');
  if (icon) openApp(icon.closest('[data-phone]').dataset.phone, icon.dataset.url);
}

grid.addEventListener('click', (e) => {
  const quick = e.target.closest('[data-add]');
  if (quick) return addPhone(quick.dataset.add);
  const phoneId = e.target.closest('[data-phone]')?.dataset.phone;
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (!phoneId) return;
  if (act === 'menu') api.phoneMenu(phoneId, active[phoneId] || null);
  else if (act === 'home') goHome(phoneId);
  else if (act === 'back' && active[phoneId]) api.navBack(phoneId, active[phoneId]);
  else if (act === 'recents') cycleApps(phoneId);
  else onIconActivate(e);
});
grid.addEventListener('dblclick', onIconActivate);
grid.addEventListener('contextmenu', (e) => {
  const icon = e.target.closest('.app-icon');
  if (!icon) return;
  e.preventDefault();
  api.iconMenu(icon.closest('[data-phone]').dataset.phone, icon.dataset.url);
});
// Ícone que não carregou vira a inicial do nome.
grid.addEventListener('error', (e) => {
  if (e.target.tagName !== 'IMG') return;
  const box = e.target.closest('.img');
  if (box) box.textContent = box.dataset.letter;
  else e.target.remove();
}, true);
grid.addEventListener('scroll', scheduleSync);
window.addEventListener('resize', scheduleSync);
new ResizeObserver(scheduleSync).observe(grid);

// ---------- toolbar ----------
// Preferência só deste computador: se o storage falhar, o seletor volta pro primeiro modelo.
const LAST_DEVICE_KEY = 'phone-farm:last-device';
const readLastDevice = () => { try { return localStorage.getItem(LAST_DEVICE_KEY); } catch { return null; } };
const saveLastDevice = (id) => { try { localStorage.setItem(LAST_DEVICE_KEY, id); } catch { /* sem storage */ } };

async function addPhone(deviceId) {
  await api.addPhone(deviceId);
  showStatus(`${devices[deviceId].name} adicionado.`);
  // Rola até o celular novo, que entra no fim da grade.
  requestAnimationFrame(() => grid.lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
}

function setupToolbar() {
  hydrateIcons();

  const deviceSelect = document.getElementById('device-select');
  const brands = [...new Set(Object.values(devices).map((d) => d.brand))];
  deviceSelect.innerHTML = brands.map((brand) => `<optgroup label="${esc(brand)}">${
    Object.entries(devices).filter(([, d]) => d.brand === brand)
      .map(([id, d]) => `<option value="${id}">${esc(d.name)} · ${d.w}×${d.h}</option>`).join('')
  }</optgroup>`).join('');
  const last = readLastDevice();
  if (last && devices[last]) deviceSelect.value = last;
  deviceSelect.onchange = () => saveLastDevice(deviceSelect.value);
  document.getElementById('add-phone').onclick = () => addPhone(deviceSelect.value);

  const form = document.getElementById('add-app-form');
  const input = document.getElementById('app-url');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const url = input.value.trim();
    if (!url) return input.focus();
    const btn = form.querySelector('button');
    const label = btn.querySelector('span');
    btn.disabled = true;
    btn.classList.add('busy');
    label.textContent = 'Lendo manifest…';
    try {
      const res = await api.addApp(url);
      if (res.error) {
        showStatus(res.error, true);
      } else {
        input.value = '';
        showStatus(`“${res.name}” adicionado em todos os celulares.`);
      }
    } finally {
      btn.disabled = false;
      btn.classList.remove('busy');
      label.textContent = 'Adicionar app';
    }
  };

  const zoom = document.getElementById('zoom');
  const zoomLabel = document.getElementById('zoom-label');
  zoom.value = config.zoom;
  zoomLabel.textContent = `${Math.round(config.zoom * 100)}%`;
  zoom.oninput = () => { zoomLabel.textContent = `${Math.round(zoom.value * 100)}%`; };
  zoom.onchange = () => api.setPrefs({ zoom: Number(zoom.value) });

  const openOn = document.getElementById('open-on');
  openOn.value = config.openOn;
  openOn.onchange = () => api.setPrefs({ openOn: openOn.value });

  document.getElementById('about').onclick = () => api.about();
  document.getElementById('remove-all').onclick = () => api.removeAllPhones();
}

let statusTimer;
function showStatus(text, isError = false) {
  const el = document.getElementById('status');
  el.innerHTML = `${uiIcon(isError ? 'alert' : 'check')}<span>${esc(text)}</span>`;
  el.classList.toggle('error', isError);
  el.classList.add('show');
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => el.classList.remove('show'), isError ? 10000 : 4000);
}

async function updateMemory() {
  const { mb, apps } = await api.memory();
  document.querySelector('#memory span').textContent = `${apps} ${apps === 1 ? 'app aberto' : 'apps abertos'} · ${mb} MB`;
}

function tickClock() {
  const t = now();
  document.querySelectorAll('.clock-small, .clock .time').forEach((el) => { el.textContent = t; });
}

api.onConfig((cfg) => {
  config = cfg;
  for (const id of Object.keys(active)) {
    if (!config.phones.some((p) => p.id === id) || (active[id] && !appByUrl(active[id]))) active[id] = null;
  }
  render();
});

api.onAppClosed((phoneId, url) => {
  running.delete(key(phoneId, url));
  if (active[phoneId] === url) active[phoneId] = null;
  render();
});

(async () => {
  ({ config, devices } = await api.getState());
  setupToolbar();
  render();
  updateMemory();
  setInterval(updateMemory, 3000);
  setInterval(tickClock, 15000);
})();
