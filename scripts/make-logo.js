// Gera a logo do Phone Farm a partir de um desenho só:
//   build/icon.svg + build/icon.png (1024)  -> ícone do app e dos instaladores
//   build/icons/NxN.png                      -> ícones do Linux nos tamanhos padrão
//   renderer/logo.svg                        -> logo da barra de ferramentas
//   assets/logo.svg / logo-dark.svg (+ .png) -> logomarca (ícone + nome) pra fundo claro e escuro
// Roda dentro do Electron pra renderizar os PNGs com o Chromium: `npm run logo`.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const out = (...p) => path.join(ROOT, ...p);

// Três celulares em leque (a "fazenda"), o da frente com a tela inicial cheia de apps.
const APP_COLORS = ['#22d3ee', '#f472b6', '#facc15', '#34d399', '#818cf8', '#fb923c', '#f87171', '#a3e635', '#60a5fa'];
const appGrid = APP_COLORS.map((c, i) => {
  const x = 398 + (i % 3) * 84;
  const y = 330 + Math.floor(i / 3) * 96;
  return `<rect x="${x}" y="${y}" width="60" height="60" rx="16" fill="${c}"/>`;
}).join('');

const ICON_BODY = `
  <defs>
    <linearGradient id="pf-bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#22d3ee"/>
      <stop offset=".5" stop-color="#6366f1"/>
      <stop offset="1" stop-color="#a855f7"/>
    </linearGradient>
    <linearGradient id="pf-screen" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#1e1b4b"/>
      <stop offset="1" stop-color="#0f172a"/>
    </linearGradient>
  </defs>
  <rect width="1024" height="1024" rx="230" fill="url(#pf-bg)"/>
  <rect x="352" y="212" width="320" height="600" rx="64" fill="#fff" opacity=".3" transform="rotate(-18 512 812)"/>
  <rect x="352" y="212" width="320" height="600" rx="64" fill="#fff" opacity=".5" transform="rotate(18 512 812)"/>
  <rect x="352" y="212" width="320" height="600" rx="64" fill="#fff"/>
  <rect x="372" y="232" width="280" height="560" rx="46" fill="url(#pf-screen)"/>
  <rect x="467" y="254" width="90" height="24" rx="12" fill="#000"/>
  ${appGrid}
  <rect x="452" y="752" width="120" height="10" rx="5" fill="#fff" opacity=".7"/>`;

const iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">${ICON_BODY}</svg>\n`;

const FONT = "Inter, 'Segoe UI', Roboto, 'Noto Sans', 'Helvetica Neue', Arial, sans-serif";
const wordmarkSvg = (fg, sub) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1500 400">
  <svg x="24" y="24" width="352" height="352" viewBox="0 0 1024 1024">${ICON_BODY}</svg>
  <text x="430" y="212" font-family="${FONT}" font-size="148" font-weight="800" letter-spacing="-4" fill="${fg}">Phone Farm</text>
  <text x="434" y="292" font-family="${FONT}" font-size="46" font-weight="500" fill="${sub}">Emuladores de celular para testar PWAs</text>
</svg>\n`;

fs.mkdirSync(out('build'), { recursive: true });
fs.mkdirSync(out('assets'), { recursive: true });
fs.writeFileSync(out('build', 'icon.svg'), iconSvg);
fs.writeFileSync(out('renderer', 'logo.svg'), iconSvg);
fs.writeFileSync(out('assets', 'logo.svg'), wordmarkSvg('#0f172a', '#475569'));
fs.writeFileSync(out('assets', 'logo-dark.svg'), wordmarkSvg('#ffffff', '#a5b4fc'));

// Uma janela só pra todas as imagens: criar uma segunda janela offscreen falha no Linux.
let w;
async function renderPng(svg, width, height, file) {
  if (!w) {
    w = new BrowserWindow({ width: 1500, height: 1024, show: false, transparent: true, frame: false, useContentSize: true, webPreferences: { offscreen: true } });
    await w.loadURL('about:blank');
  }
  await w.webContents.executeJavaScript(`(async () => {
    document.documentElement.style.cssText = 'margin:0;background:transparent;overflow:hidden';
    document.body.style.cssText = 'margin:0;background:transparent';
    document.body.textContent = '';
    const img = new Image(${width}, ${height});
    img.style.display = 'block';
    img.src = ${JSON.stringify(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`)};
    document.body.append(img);
    await img.decode();
  })()`);
  await new Promise((r) => setTimeout(r, 300));
  const img = await w.webContents.capturePage({ x: 0, y: 0, width, height });
  fs.writeFileSync(file, img.resize({ width, height }).toPNG());
  console.log('gerado', path.relative(ROOT, file));
}

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  await renderPng(iconSvg, 1024, 1024, out('build', 'icon.png'));
  // Tamanhos padrão do tema de ícones do Linux (o .deb/AppImage procura até 512).
  fs.mkdirSync(out('build', 'icons'), { recursive: true });
  for (const size of [16, 24, 32, 48, 64, 128, 256, 512]) {
    await renderPng(iconSvg, size, size, out('build', 'icons', `${size}x${size}.png`));
  }
  await renderPng(wordmarkSvg('#0f172a', '#475569'), 1500, 400, out('assets', 'logo.png'));
  await renderPng(wordmarkSvg('#ffffff', '#a5b4fc'), 1500, 400, out('assets', 'logo-dark.png'));
}).catch((err) => {
  console.error(err);
  process.exitCode = 1;
}).finally(() => app.quit());
