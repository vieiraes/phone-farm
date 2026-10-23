const { app, BrowserWindow, WebContentsView, ipcMain, Menu, dialog, session, net } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { DEVICES } = require('./devices');

// O app empacotado se chama "Phone Farm" (productName), o que mudaria a pasta de dados;
// fixando aqui, a versão instalada e o `npm start` usam os mesmos celulares e logins.
app.setPath('userData', path.join(app.getPath('appData'), 'phone-farm'));
const CONFIG_PATH = path.join(app.getPath('userData'), 'farm.json');
const ICON_PATH = path.join(__dirname, 'build', 'icon.png');
const DEFAULT_CONFIG = {
  zoom: 0.7,
  openOn: 'click', // 'click' = 1 toque, 'dblclick' = 2 cliques
  phones: [
    { id: 'p-1', device: 'iphone-17', label: 'Celular 1' },
    { id: 'p-2', device: 'galaxy-s25', label: 'Celular 2' },
  ],
  apps: [{ name: 'Squoosh', url: 'https://squoosh.app/', icon: null, theme: null, background: null }],
};

let config;
let win;
// Uma view por (celular, app): `${phoneId}|${url}` -> WebContentsView
const views = new Map();

function loadConfig() {
  try {
    config = { ...structuredClone(DEFAULT_CONFIG), ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) };
  } catch {
    config = structuredClone(DEFAULT_CONFIG);
  }
  // Modelo que saiu da lista vira o primeiro da lista, em vez de quebrar a tela.
  for (const p of config.phones) if (!DEVICES[p.device]) p.device = Object.keys(DEVICES)[0];
}

// Grava num .tmp e renomeia: se o app cair no meio, o farm.json antigo continua inteiro.
function saveConfig() {
  const tmp = `${CONFIG_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2));
  fs.renameSync(tmp, CONFIG_PATH);
  if (win && !win.isDestroyed()) win.webContents.send('config', config);
}

const phoneById = (id) => config.phones.find((p) => p.id === id);
const partitionOf = (phone) => `persist:${phone.id}`;
const keyOf = (phoneId, url) => `${phoneId}|${url}`;
const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
// Cor do manifest vai parar num atributo style: só passa o que tem cara de cor.
const cssColor = (c) => (typeof c === 'string' && /^(#[0-9a-f]{3,8}|[a-z]+|(rgb|hsl)a?\([\d\s.,%/+-]+\))$/i.test(c.trim()) ? c.trim() : null);
const FETCH_TIMEOUT_MS = 10_000;

function viewportOf(phone) {
  const d = DEVICES[phone.device];
  const [sw, sh] = phone.rotated ? [d.h, d.w] : [d.w, d.h];
  return { width: sw, height: sh - d.status - d.nav, screenWidth: sw, screenHeight: sh, dpr: d.dpr };
}

// Client Hints (navigator.userAgentData, Sec-CH-UA-*) de Chrome no Android. Safari não tem
// userAgentData, então no iPhone o app-preload.js esconde a propriedade.
function uaMetadataOf(d) {
  if (d.platform !== 'android') return undefined;
  const full = process.versions.chrome;
  const major = full.split('.')[0];
  const brands = [['Chromium', major], ['Google Chrome', major], ['Not?A_Brand', '99']];
  return {
    brands: brands.map(([brand, version]) => ({ brand, version })),
    fullVersionList: brands.map(([brand, version]) => ({ brand, version: version === '99' ? '99.0.0.0' : full })),
    platform: 'Android',
    platformVersion: `${d.android}.0.0`,
    architecture: '',
    model: d.model,
    mobile: true,
  };
}

// Emulação via CDP: tamanho de celular, toque e UA. O display-mode standalone fica no app-preload.js.
async function applyEmulation(view, phone) {
  const dbg = view.webContents.debugger;
  const vp = viewportOf(phone);
  const d = DEVICES[phone.device];
  try {
    if (!dbg.isAttached()) dbg.attach('1.3');
    await dbg.sendCommand('Emulation.setUserAgentOverride', {
      userAgent: d.ua,
      platform: d.platform === 'ios' ? 'iPhone' : 'Linux armv8l',
      userAgentMetadata: uaMetadataOf(d),
    });
    await dbg.sendCommand('Emulation.setDeviceMetricsOverride', {
      width: vp.width,
      height: vp.height,
      deviceScaleFactor: vp.dpr,
      mobile: true,
      scale: config.zoom,
      screenWidth: vp.screenWidth,
      screenHeight: vp.screenHeight,
      screenOrientation: phone.rotated ? { type: 'landscapePrimary', angle: 90 } : { type: 'portraitPrimary', angle: 0 },
    });
    await dbg.sendCommand('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await dbg.sendCommand('Emulation.setEmitTouchEventsForMouse', { enabled: true, configuration: 'mobile' });
    await dbg.sendCommand('Emulation.setScrollbarsHidden', { hidden: true });
  } catch (err) {
    console.error(`[emulação ${phone.id}]`, err.message);
  }
}

function applyNetwork(phone) {
  const ses = session.fromPartition(partitionOf(phone));
  if (phone.offline) ses.enableNetworkEmulation({ offline: true });
  else ses.disableNetworkEmulation();
}

// UA da sessão inteira: vale também pra popups (login com Google) e service workers,
// que não passam pelo setUserAgent da view.
function applySessionUA(phone) {
  session.fromPartition(partitionOf(phone)).setUserAgent(DEVICES[phone.device].ua);
}

// Página de erro no lugar da tela branca quando o app não carrega.
function errorPage(url, desc) {
  return `<meta name="viewport" content="width=device-width,initial-scale=1">
<body style="font:16px system-ui,sans-serif;padding:24px;color:#333;background:#fff">
<h3>Não deu pra abrir o app</h3>
<p style="word-break:break-all">${escHtml(url)}</p>
<p style="color:#888">${escHtml(desc)}</p>
<p><a href="${escHtml(url)}">Tentar de novo</a></p>`;
}

function createView(phone, appUrl) {
  const appInfo = config.apps.find((a) => a.url === appUrl);
  const view = new WebContentsView({
    webPreferences: {
      partition: partitionOf(phone),
      preload: path.join(__dirname, 'app-preload.js'),
      sandbox: true,
      contextIsolation: true,
    },
  });
  view.setBackgroundColor(cssColor(appInfo?.background) || '#ffffff');
  view.setVisible(false);
  const wc = view.webContents;
  wc.setUserAgent(DEVICES[phone.device].ua);
  // Popups (ex.: login com Google) abrem numa janela que usa a mesma partition do celular.
  wc.setWindowOpenHandler(() => ({
    action: 'allow',
    overrideBrowserWindowOptions: { width: 420, height: 760, autoHideMenuBar: true },
  }));
  wc.on('render-process-gone', () => closeView(phone.id, appUrl));
  wc.on('did-fail-load', (_e, code, desc, failedUrl, isMainFrame) => {
    // -3 = ERR_ABORTED: redirect ou navegação cancelada, não é falha de verdade.
    if (!isMainFrame || code === -3) return;
    wc.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(errorPage(failedUrl, desc))}`).catch(() => {});
  });
  win.contentView.addChildView(view);
  views.set(keyOf(phone.id, appUrl), view);
  // Os comandos CDP só respondem com uma página carregada; about:blank cria o alvo,
  // e a emulação já vale desde o primeiro byte do app.
  // A falha do loadURL já vira página de erro no did-fail-load; o catch só evita o unhandled rejection.
  wc.loadURL('about:blank')
    .then(() => applyEmulation(view, phone))
    .then(() => wc.loadURL(appUrl))
    .catch(() => {});
  return view;
}

function closeView(phoneId, url) {
  const key = keyOf(phoneId, url);
  const view = views.get(key);
  if (!view) return;
  views.delete(key);
  if (!view.webContents.isDestroyed()) view.webContents.close();
  // Durante o encerramento a janela pode já ter sido destruída.
  if (win.isDestroyed()) return;
  win.contentView.removeChildView(view);
  win.webContents.send('app-closed', phoneId, url);
}

function closePhoneViews(phoneId) {
  for (const key of [...views.keys()]) {
    const [pid, url] = key.split(/\|(.*)/s);
    if (pid === phoneId) closeView(pid, url);
  }
}

function reemulatePhone(phone, reload) {
  applySessionUA(phone);
  for (const [key, view] of views) {
    if (!key.startsWith(`${phone.id}|`)) continue;
    view.webContents.setUserAgent(DEVICES[phone.device].ua);
    applyEmulation(view, phone).then(() => reload && view.webContents.reload());
  }
}

// Sem esquema: servidor local (localhost, IP de rede local, nome sem ponto como devbox:3000,
// .local/.lan/.test) vai de http, o resto de https.
function normalizeUrl(rawUrl) {
  if (/^[a-z]+:\/\//i.test(rawUrl)) return new URL(rawUrl).href;
  const local = /^(localhost|\[::1\]|127\.|0\.0\.0\.0|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|[^./:]+(:\d+)?(\/|$)|[^/:]+\.(local|lan|test|localhost)(:\d+)?(\/|$))/i.test(rawUrl);
  return new URL(`${local ? 'http' : 'https'}://${rawUrl}`).href;
}

// Lê o manifest do PWA pra pegar nome, ícone, cores e start_url.
// Falha (com mensagem pro usuário) só se a página em si não responder ou responder erro.
async function resolveApp(rawUrl) {
  let url;
  try {
    url = normalizeUrl(rawUrl.trim());
  } catch {
    throw new Error(`URL inválida: ${rawUrl}`);
  }
  const info = { name: new URL(url).hostname, url, icon: null, theme: null, background: null };
  const fetchWithTimeout = (u) => net.fetch(u, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  let res;
  try {
    res = await fetchWithTimeout(url);
  } catch (err) {
    const why = err.name === 'TimeoutError' ? `sem resposta em ${FETCH_TIMEOUT_MS / 1000}s` : err.message;
    throw new Error(`Não consegui abrir ${url} (${why}). O servidor está rodando?`);
  }
  if (!res.ok) throw new Error(`${url} respondeu ${res.status}. Confira o endereço.`);
  try {
    const base = res.url || url;
    const html = await res.text();
    const title = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim();
    if (title) info.name = title;
    const hrefOf = (rel) => {
      const tag = html.match(new RegExp(`<link\\b[^>]*\\brel=["']?${rel}["']?[^>]*>`, 'i'))?.[0];
      return tag?.match(/\bhref=["']?([^"'\s>]+)/i)?.[1];
    };
    const manifestHref = hrefOf('manifest');
    if (manifestHref) {
      const manifestUrl = new URL(manifestHref, base).href;
      const m = await (await fetchWithTimeout(manifestUrl)).json();
      info.name = m.short_name || m.name || info.name;
      info.theme = cssColor(m.theme_color);
      info.background = cssColor(m.background_color);
      if (m.start_url) info.url = new URL(m.start_url, manifestUrl).href;
      // sizes "any" é ícone vetorial (SVG): ganha de qualquer PNG.
      const size = (i) => Math.max(0, ...String(i.sizes || '0x0').split(' ').map((s) => (s === 'any' ? Infinity : parseInt(s, 10) || 0)));
      const best = (m.icons || [])
        .filter((i) => !i.purpose || i.purpose.split(' ').includes('any'))
        .sort((a, b) => size(b) - size(a))[0];
      if (best) info.icon = new URL(best.src, manifestUrl).href;
    }
    if (!info.icon) {
      const iconHref = hrefOf('apple-touch-icon') || hrefOf('(?:shortcut )?icon');
      info.icon = new URL(iconHref || "/favicon.ico", base).href;
    }
  } catch (err) {
    console.error('[manifest]', url, err.message);
  }
  return info;
}

function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 760,
    minHeight: 520,
    backgroundColor: '#0f1115',
    title: 'Phone Farm',
    icon: ICON_PATH,
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), sandbox: true, contextIsolation: true },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

ipcMain.handle('get-state', () => ({ config, devices: DEVICES, version: app.getVersion() }));

ipcMain.on('about', () => {
  const brands = [...new Set(Object.values(DEVICES).map((d) => d.brand))].join(', ');
  dialog.showMessageBox(win, {
    type: 'info',
    icon: ICON_PATH,
    title: 'Sobre o Phone Farm',
    message: `Phone Farm ${app.getVersion()}`,
    detail: [
      'Ferramenta de teste: abre emuladores de celular lado a lado pra testar aplicações PWA, sem precisar de um Android ou iPhone de verdade.',
      `Cada celular tem os próprios cookies, login e service workers. ${Object.keys(DEVICES).length} modelos (${brands}).`,
      'É uma emulação no Chromium: tamanho de tela, toque e User-Agent são do aparelho, mas o motor não é o Safari nem o Chrome do celular.',
    ].join('\n\n'),
    buttons: ['OK'],
  });
});

// O renderer manda onde cada app ativo deve aparecer; o resto fica escondido.
ipcMain.on('sync', (_e, entries) => {
  const shown = new Set();
  for (const { phoneId, url, rect } of entries) {
    const view = views.get(keyOf(phoneId, url));
    if (!view) continue;
    shown.add(view);
    view.setBounds({ x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) });
    view.setVisible(true);
  }
  for (const view of views.values()) if (!shown.has(view)) view.setVisible(false);
});

ipcMain.handle('open-app', (_e, phoneId, url) => {
  const phone = phoneById(phoneId);
  if (phone && !views.has(keyOf(phoneId, url))) createView(phone, url);
});

// Erros viram { error } porque o invoke do Electron embrulha a mensagem de exceções.
ipcMain.handle('add-app', async (_e, rawUrl) => {
  let info;
  try {
    info = await resolveApp(rawUrl);
  } catch (err) {
    return { error: err.message };
  }
  if (config.apps.some((a) => a.url === info.url)) return { error: 'Esse app já está na lista.' };
  // Mesmo app em outro endereço (ex.: produção e localhost): o nome ganha a porta ou o host.
  if (config.apps.some((a) => a.name === info.name)) {
    const u = new URL(info.url);
    info.name = `${info.name} · ${u.port || u.hostname}`;
  }
  config.apps.push(info);
  saveConfig();
  return { name: info.name };
});

ipcMain.handle('add-phone', (_e, deviceId) => {
  // Próximo número depois do maior em uso, pra não repetir nome depois de remover um celular.
  const used = config.phones.map((p) => Number(/^Celular (\d+)$/.exec(p.label)?.[1]) || 0);
  // Sufixo aleatório: dois cliques no mesmo milissegundo dariam o mesmo id (e a mesma partition).
  const id = `p-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const phone = { id, device: deviceId, label: `Celular ${Math.max(0, ...used) + 1}` };
  config.phones.push(phone);
  applySessionUA(phone);
  saveConfig();
});

ipcMain.handle('set-prefs', (_e, prefs) => {
  const zoomChanged = prefs.zoom !== undefined && prefs.zoom !== config.zoom;
  Object.assign(config, prefs);
  saveConfig();
  if (zoomChanged) for (const phone of config.phones) reemulatePhone(phone, false);
});

ipcMain.on('nav-back', (_e, phoneId, url) => {
  const nav = views.get(keyOf(phoneId, url))?.webContents.navigationHistory;
  if (nav?.canGoBack()) nav.goBack();
});

ipcMain.handle('memory', () => {
  const kb = app.getAppMetrics().reduce((sum, m) => sum + (m.memory?.workingSetSize || 0), 0);
  return { mb: Math.round(kb / 1024), apps: views.size };
});

ipcMain.on('phone-menu', (_e, phoneId, activeUrl) => {
  const phone = phoneById(phoneId);
  if (!phone) return;
  const active = activeUrl && views.get(keyOf(phoneId, activeUrl));
  Menu.buildFromTemplate([
    { label: `${phone.label} · ${DEVICES[phone.device].name}`, enabled: false },
    { type: 'separator' },
    {
      label: 'Trocar modelo',
      submenu: [...new Set(Object.values(DEVICES).map((d) => d.brand))].map((brand) => ({
        label: brand,
        submenu: Object.entries(DEVICES).filter(([, d]) => d.brand === brand).map(([id, d]) => ({
          label: d.name,
          type: 'radio',
          checked: phone.device === id,
          click: () => { phone.device = id; saveConfig(); reemulatePhone(phone, true); },
        })),
      })),
    },
    { label: 'Girar', click: () => { phone.rotated = !phone.rotated; saveConfig(); reemulatePhone(phone, false); } },
    { label: 'Offline', type: 'checkbox', checked: !!phone.offline, click: () => { phone.offline = !phone.offline; applyNetwork(phone); saveConfig(); } },
    { type: 'separator' },
    { label: 'Recarregar app', enabled: !!active, click: () => active.webContents.reload() },
    { label: 'DevTools do app', enabled: !!active, click: () => active.webContents.openDevTools({ mode: 'detach' }) },
    { label: 'Fechar todos os apps (libera memória)', enabled: [...views.keys()].some((k) => k.startsWith(`${phoneId}|`)), click: () => closePhoneViews(phoneId) },
    { type: 'separator' },
    {
      label: 'Limpar dados (logout geral)…',
      click: async () => {
        const { response } = await dialog.showMessageBox(win, {
          type: 'warning', buttons: ['Cancelar', 'Limpar'], defaultId: 0, cancelId: 0,
          message: `Apagar cookies, storage, cache e service workers do ${phone.label}?`,
        });
        if (response !== 1) return;
        await wipePhoneData(phone);
      },
    },
    {
      label: 'Remover celular…',
      click: async () => {
        const { response } = await dialog.showMessageBox(win, {
          type: 'warning', buttons: ['Cancelar', 'Remover'], defaultId: 0, cancelId: 0,
          message: `Remover o ${phone.label} e apagar os dados dele?`,
        });
        if (response !== 1) return;
        await wipePhoneData(phone);
        config.phones = config.phones.filter((p) => p.id !== phoneId);
        saveConfig();
      },
    },
  ]).popup({ window: win });
});

async function wipePhoneData(phone) {
  closePhoneViews(phone.id);
  const ses = session.fromPartition(partitionOf(phone));
  await ses.clearStorageData();
  await ses.clearCache();
}

// Botão "Remover todos": pra não ter que apagar 10, 20 celulares um por um.
ipcMain.handle('remove-all-phones', async () => {
  const n = config.phones.length;
  if (!n) return;
  const { response } = await dialog.showMessageBox(win, {
    type: 'warning',
    buttons: ['Cancelar', 'Só limpar os dados', `Remover os ${n} celulares`],
    defaultId: 0,
    cancelId: 0,
    message: n === 1 ? 'Remover o celular?' : `Remover todos os ${n} celulares?`,
    detail: 'Remover apaga os celulares e os dados de cada um (cookies, logins, storage, cache e service workers).\n'
      + '"Só limpar os dados" faz o logout geral e mantém os celulares na tela.\nA lista de apps continua igual nos dois casos.',
  });
  if (response === 0) return;
  const phones = [...config.phones];
  await Promise.all(phones.map(wipePhoneData));
  if (response === 2) {
    config.phones = [];
    saveConfig();
  }
});

ipcMain.on('icon-menu', (_e, phoneId, url) => {
  Menu.buildFromTemplate([
    { label: 'Fechar app neste celular', enabled: views.has(keyOf(phoneId, url)), click: () => closeView(phoneId, url) },
    {
      label: 'Remover app de todos os celulares',
      click: () => {
        for (const phone of config.phones) closeView(phone.id, url);
        config.apps = config.apps.filter((a) => a.url !== url);
        saveConfig();
      },
    },
  ]).popup({ window: win });
});

app.whenReady().then(async () => {
  loadConfig();
  config.phones.forEach(applyNetwork);
  config.phones.forEach(applySessionUA);
  createWindow();
  // Completa ícone/nome de apps que ainda não foram resolvidos (ex.: o app de exemplo).
  // A url fica como está: o app pode já ter sido aberto com ela enquanto o manifest era lido.
  const pending = config.apps.filter((a) => !a.icon);
  if (pending.length) {
    await Promise.all(pending.map(async (a) => {
      const { url, ...found } = await resolveApp(a.url).catch(() => ({}));
      Object.assign(a, found);
    }));
    saveConfig();
  }
});

app.on('window-all-closed', () => app.quit());
