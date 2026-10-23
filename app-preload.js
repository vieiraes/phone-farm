// Roda dentro de cada app, antes do código da página.
// O Chromium ignora display-mode no Emulation.setEmulatedMedia, então aqui o matchMedia e as
// regras @media (display-mode: X) passam a responder como PWA instalado, e o iPhone ganha
// navigator.standalone.
const { contextBridge } = require('electron');

contextBridge.executeInMainWorld({
  func: () => {
    const fix = (q) => String(q).replace(/\(\s*display-mode\s*:\s*([a-z-]+)\s*\)/gi,
      (_, m) => (m.toLowerCase() === 'standalone' ? '(min-width: 0px)' : '(not (min-width: 0px))'));
    const mm = window.matchMedia.bind(window);
    window.matchMedia = (q) => mm(fix(q));
    if (/iPhone/.test(navigator.userAgent)) {
      Object.defineProperty(Navigator.prototype, 'standalone', { get: () => true });
      // Safari não tem Client Hints; com isso o app não vê "Chromium" no userAgentData.
      Object.defineProperty(Navigator.prototype, 'userAgentData', { get: () => undefined });
    }

    const done = new WeakSet();
    const walk = (rules) => {
      for (const r of rules) {
        if (r.media && /display-mode/i.test(r.media.mediaText)) r.media.mediaText = fix(r.media.mediaText);
        if (r.cssRules) walk(r.cssRules);
      }
    };
    const patch = () => {
      for (const s of document.styleSheets) {
        if (done.has(s)) continue;
        try {
          walk(s.cssRules);
          done.add(s);
        } catch {} // folha de outra origem: não dá pra ler
      }
    };
    document.addEventListener('DOMContentLoaded', () => {
      patch();
      new MutationObserver(patch).observe(document.documentElement, { childList: true, subtree: true });
    });
    addEventListener('load', patch);

    // Puxar para atualizar: com a página no topo, arrastar pra baixo e soltar recarrega, como no
    // Chrome do Android (círculo com seta) e no Safari do iPhone (spinner de raios).
    // Igual no celular, não dispara se a página ou o elemento tocado tiver
    // overscroll-behavior-y: none/contain, nem se o toque começar numa lista interna já rolada.
    const ios = /iPhone/.test(navigator.userAgent);
    const PULL_MAX = 130; // até onde o indicador desce (px)
    const PULL_READY = 80; // soltar a partir daqui recarrega
    let start = null; // ponto do toque que começou com a página no topo
    let pull = 0;
    let ui;

    const blocksPull = (el) => {
      for (; el && el.nodeType === 1; el = el.parentElement) {
        const cs = getComputedStyle(el);
        if (/^(none|contain)$/.test(cs.overscrollBehaviorY)) return true;
        if (el.scrollTop > 0 && /auto|scroll|overlay/.test(cs.overflowY)) return true;
      }
      return false;
    };

    const SPOKES = 8;
    const ensureUi = () => {
      if (ui) return ui;
      const host = document.createElement('div');
      host.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:0;z-index:2147483647;pointer-events:none';
      const root = host.attachShadow({ mode: 'closed' });
      const spokes = Array.from({ length: SPOKES }, (_, i) =>
        `<line x1="14" y1="4" x2="14" y2="9" transform="rotate(${i * (360 / SPOKES)} 14 14)" style="opacity:${0.25 + (0.75 * i) / (SPOKES - 1)}"/>`).join('');
      root.innerHTML = `<style>
        .ind { position: absolute; left: 50%; top: 0; opacity: 0; }
        .android { width: 40px; height: 40px; border-radius: 50%; background: #fff; box-shadow: 0 1px 6px rgba(0,0,0,.3);
                   display: flex; align-items: center; justify-content: center; }
        .android svg { width: 26px; height: 26px; }
        .android .arc { fill: none; stroke: #1a73e8; stroke-width: 2.6; stroke-linecap: round; stroke-dasharray: 50.3;
                        transform: rotate(-90deg); transform-origin: 13px 13px; opacity: .45; }
        .android .head { fill: #1a73e8; opacity: .45; }
        .android.ready .arc, .android.ready .head { opacity: 1; }
        .android.spin .head { display: none; }
        .ios svg { width: 28px; height: 28px; display: block; }
        .ios line { stroke: #8e8e93; stroke-width: 2.6; stroke-linecap: round; }
        .spin svg { animation: spin .9s linear infinite; }
        .ios.spin svg { animation-timing-function: steps(${SPOKES}); }
        @keyframes spin { to { transform: rotate(360deg); } }
      </style>
      <div class="ind ${ios ? 'ios' : 'android'}">${ios
        ? `<svg viewBox="0 0 28 28">${spokes}</svg>`
        : '<svg viewBox="0 0 26 26"><circle class="arc" cx="13" cy="13" r="8"/><path class="head" d="M13 1.5l4 3.5-4 3.5z"/></svg>'}</div>`;
      document.documentElement.append(host);
      ui = { ind: root.querySelector('.ind'), svg: root.querySelector('svg'), arc: root.querySelector('.arc'), lines: root.querySelectorAll('line') };
      return ui;
    };

    const render = (p, animate) => {
      const { ind, svg, arc, lines } = ensureUi();
      const k = Math.min(1, p / PULL_READY);
      ind.style.transition = animate ? 'transform .2s ease-out, opacity .2s' : 'none';
      ind.classList.toggle('ready', k >= 1);
      if (ios) {
        // Safari: o spinner aparece no topo e vai ganhando raios conforme puxa.
        ind.style.opacity = p ? 1 : 0;
        ind.style.transform = `translate(-50%, ${p * 0.5 - 6}px)`;
        lines.forEach((l, i) => { l.style.visibility = i < Math.ceil(k * SPOKES) ? 'visible' : 'hidden'; });
      } else {
        // Chrome: o círculo desce junto com o dedo, o arco cresce e gira.
        ind.style.opacity = p ? 1 : 0;
        ind.style.transform = `translate(-50%, ${p - 44}px)`;
        arc.style.strokeDashoffset = String(50.3 * (1 - 0.8 * k));
        svg.style.transform = `rotate(${p * 2.2}deg)`;
      }
    };

    addEventListener('touchstart', (e) => {
      start = null;
      if (e.touches.length !== 1 || window.scrollY > 0 || blocksPull(e.target)) return;
      start = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }, { capture: true, passive: true });

    addEventListener('touchmove', (e) => {
      if (!start) return;
      const t = e.touches[0];
      const dy = t.clientY - start.y;
      // Gesto mais horizontal que vertical (carrossel, swipe): não é puxar pra atualizar.
      if (pull === 0 && Math.abs(t.clientX - start.x) > Math.abs(dy)) { start = null; return; }
      pull = Math.max(0, Math.min(PULL_MAX, dy * 0.55));
      if (pull || ui) render(pull, false);
    }, { capture: true, passive: true });

    const release = () => {
      if (!start) return;
      start = null;
      if (pull >= PULL_READY) {
        // Para no ponto de "pronto", gira e recarrega; a página nova já vem sem o indicador.
        render(PULL_READY, true);
        ensureUi().ind.classList.add('spin');
        if (!ios) ui.svg.style.transform = '';
        setTimeout(() => location.reload(), 250);
      } else if (pull) {
        render(0, true);
      }
      pull = 0;
    };
    addEventListener('touchend', release, { capture: true, passive: true });
    addEventListener('touchcancel', release, { capture: true, passive: true });
  },
});
