// Injected into every page before its own scripts run (Page.addScriptToEvaluateOnNewDocument).
// It only DRAWS: a cursor that follows the real pointer, click ripples, key badges, captions, spotlight, zoom,
// a progress bar and slides. Real mouse and keyboard events come from the browser (CDP Input), not from here.
(() => {
  if (window.__demo) return;

  const demo = (window.__demo = {
    version: 1,
    pointer: { x: -100, y: -100, down: false, seen: false },
    config: {
      showCursor: true,
      showKeys: 'shortcuts', // 'shortcuts' | 'all' | 'none'
      theme: {
        accent: '#0f766e',
        accent2: '#14b8a6',
        text: '#ffffff',
        captionBg: 'rgba(17,24,39,.9)',
        captionText: '#ffffff',
        bg1: '#0b3d3a',
        bg2: '#134e4a',
        fontLatin: 'Inter, "Segoe UI", system-ui, sans-serif',
        fontUrdu: '"Jameel Noori Nastaleeq", "Noto Nastaliq Urdu", "Urdu Typesetting", "Noto Naskh Arabic", "Segoe UI", sans-serif',
      },
    },
  });

  // Settings chosen by the runner before the page started (theme, cursor, key badges).
  const pre = window.__demoConfig;
  if (pre) {
    if (pre.theme) Object.assign(demo.config.theme, pre.theme);
    for (const k of ['showCursor', 'showKeys']) if (pre[k] !== undefined) demo.config[k] = pre[k];
  }

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .root { position: fixed; inset: 0; pointer-events: none; z-index: 2147483647; font-family: var(--font); }
    .cursor { position: absolute; left: 0; top: 0; width: 28px; height: 32px; transform: translate(-200px,-200px); transform-origin: 3px 2px; filter: drop-shadow(0 2px 3px rgba(0,0,0,.4)); transition: transform .06s linear; will-change: transform; }
    .cursor.down { transition: none; }
    .cursor svg { position: absolute; left: 0; top: 0; display: none; }
    .cursor[data-shape="arrow"] .arrow, .cursor[data-shape="hand"] .hand, .cursor[data-shape="text"] .text { display: block; }
    .ripple { position: absolute; width: 46px; height: 46px; border-radius: 50%; border: 3px solid var(--accent); background: color-mix(in srgb, var(--accent) 20%, transparent); }
    .caption { position: absolute; left: 50%; transform: translateX(-50%); max-width: 82%; padding: 12px 28px; border-radius: 999px; background: var(--captionBg); color: var(--captionText); font-size: 21px; font-weight: 500; line-height: 1.35; text-align: center; opacity: 0; transition: opacity .25s; box-shadow: 0 6px 22px rgba(0,0,0,.28); }
    .caption.top { top: 14px; } .caption.bottom { bottom: 22px; }
    .caption.urdu { font-family: var(--fontUrdu); font-size: 25px; line-height: 1.7; padding: 6px 30px; }
    .caption.show { opacity: 1; }
    .spot { position: absolute; border-radius: 10px; box-shadow: 0 0 0 9999px rgba(0,0,0,.55), 0 0 0 3px var(--accent2); opacity: 0; transition: opacity .3s, left .3s, top .3s, width .3s, height .3s; }
    .spot.show { opacity: 1; }
    .keys { position: absolute; left: 24px; bottom: 24px; display: flex; gap: 8px; }
    .key { padding: 8px 14px; border-radius: 10px; background: rgba(17,24,39,.92); color: #fff; font: 600 18px/1 var(--font); border-bottom: 3px solid rgba(255,255,255,.28); }
    .progress { position: absolute; left: 0; top: 0; height: 4px; width: 0; background: var(--accent2); transition: width .4s; }
    .slide { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: linear-gradient(135deg, var(--bg1), var(--bg2)); color: var(--text); opacity: 0; transition: opacity .5s; }
    .slide.show { opacity: 1; }
    .slide .card { max-width: 78%; text-align: center; }
    .slide[dir="rtl"] .card { text-align: center; }
    .slide .logo { max-height: 84px; max-width: 280px; margin-bottom: 28px; opacity: 0; transform: translateY(14px); }
    .slide .kicker { font-size: 20px; letter-spacing: .14em; text-transform: uppercase; opacity: 0; color: var(--accent2); margin-bottom: 14px; }
    .slide .headline { font-size: 58px; font-weight: 750; line-height: 1.12; margin: 0 0 16px; opacity: 0; transform: translateY(18px); }
    .slide .subtitle { font-size: 26px; font-weight: 400; opacity: 0; transform: translateY(14px); color: rgba(255,255,255,.86); margin: 0 0 30px; }
    .slide ul { list-style: none; padding: 0; margin: 0 auto; display: inline-block; text-align: start; font-size: 24px; }
    .slide li { margin: 10px 0; opacity: 0; transform: translateY(10px); display: flex; gap: 12px; align-items: baseline; }
    .slide li::before { content: ""; width: 10px; height: 10px; border-radius: 50%; background: var(--accent2); flex: none; transform: translateY(-2px); }
    .slide.urdu .headline { font-family: var(--fontUrdu); font-size: 54px; line-height: 1.5; }
    .slide.urdu .subtitle, .slide.urdu li, .slide.urdu .kicker { font-family: var(--fontUrdu); line-height: 1.8; letter-spacing: 0; text-transform: none; }
    .slide.urdu .kicker { font-size: 30px; }
    .slide.urdu .subtitle { font-size: 30px; } .slide.urdu li { font-size: 28px; }
    .slide.show .logo, .slide.show .kicker, .slide.show .headline, .slide.show .subtitle, .slide.show li { opacity: 1; transform: none; transition: opacity .6s ease, transform .6s ease; }
    .slide.show .kicker { transition-delay: .1s; } .slide.show .headline { transition-delay: .25s; } .slide.show .subtitle { transition-delay: .5s; }
    .slide.show li:nth-child(1) { transition-delay: .8s; } .slide.show li:nth-child(2) { transition-delay: 1.1s; } .slide.show li:nth-child(3) { transition-delay: 1.4s; } .slide.show li:nth-child(4) { transition-delay: 1.7s; }
  `;

  const SVG_ARROW = '<svg class="arrow" width="28" height="32" viewBox="0 0 28 32"><path d="M3 2 L3 23 L8.4 18 L12.2 26.6 L15.6 25.1 L11.8 16.6 L19.2 16.6 Z" fill="#fff" stroke="#111" stroke-width="1.7" stroke-linejoin="round"/></svg>';
  const SVG_HAND = '<svg class="hand" width="28" height="32" viewBox="0 0 28 32"><path d="M10 3 C8.6 3 8 4 8 5 L8 16 L6.2 14.4 C5.2 13.6 3.8 14 3.6 15.2 C3.5 15.8 3.8 16.3 4.3 16.8 L9.6 24.6 C10.6 26.1 12.2 27 14 27 L18.4 27 C21 27 23 25 23 22.4 L23 14 C23 12.8 22.2 12 21.2 12 C20.6 12 20.1 12.2 19.8 12.6 C19.5 11.7 18.7 11 17.7 11 C17 11 16.4 11.3 16 11.8 C15.7 10.9 14.9 10.3 14 10.3 L13 10.3 L13 5 C13 3.9 11.9 3 10 3 Z" fill="#fff" stroke="#111" stroke-width="1.5" stroke-linejoin="round" transform="translate(-1 -1)"/></svg>';
  const SVG_TEXT = '<svg class="text" width="28" height="32" viewBox="0 0 28 32"><path d="M9 5 H15 M12 5 V25 M9 25 H15" stroke="#111" stroke-width="4.2" stroke-linecap="round" fill="none" transform="translate(2 1)"/><path d="M9 5 H15 M12 5 V25 M9 25 H15" stroke="#fff" stroke-width="2" stroke-linecap="round" fill="none" transform="translate(2 1)"/></svg>';

  let host, shadow, rootEl, cursorEl, captionEl, spotEl, keysEl, progressEl, slideEl;
  const pending = [];
  const whenReady = (fn) => (rootEl ? fn() : pending.push(fn));

  function build() {
    host = document.createElement('div');
    host.id = '__demo_host';
    host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;';
    shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = CSS;
    rootEl = document.createElement('div');
    rootEl.className = 'root';
    rootEl.innerHTML = `<div class="spot"></div><div class="progress"></div><div class="cursor" data-shape="arrow">${SVG_ARROW}${SVG_HAND}${SVG_TEXT}</div><div class="caption top"></div><div class="keys"></div>`;
    shadow.append(style, rootEl);
    cursorEl = rootEl.querySelector('.cursor');
    captionEl = rootEl.querySelector('.caption');
    spotEl = rootEl.querySelector('.spot');
    keysEl = rootEl.querySelector('.keys');
    progressEl = rootEl.querySelector('.progress');
    applyTheme();
    (document.documentElement || document).appendChild(host);
    pending.splice(0).forEach((fn) => fn());
  }

  function applyTheme() {
    const t = demo.config.theme;
    const vars = { accent: t.accent, accent2: t.accent2, text: t.text, captionBg: t.captionBg, captionText: t.captionText, bg1: t.bg1, bg2: t.bg2, font: t.fontLatin, fontUrdu: t.fontUrdu };
    for (const [k, v] of Object.entries(vars)) rootEl.style.setProperty(`--${k}`, v);
  }

  // ---- the pointer: follows REAL events
  const shapeFor = (x, y) => {
    const el = document.elementFromPoint(x, y);
    if (!el) return 'arrow';
    const c = getComputedStyle(el).cursor;
    if (c === 'pointer') return 'hand';
    if (c === 'text' || c === 'vertical-text') return 'text';
    if (c === 'auto' || c === 'default') {
      if (el.closest('input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]):not([type=range]), textarea, [contenteditable=""], [contenteditable="true"]')) return 'text';
      if (el.closest('a[href], button, summary, select, label, [role=button], [role=tab]')) return el.closest('button:disabled, [aria-disabled="true"]') ? 'arrow' : 'hand';
    }
    return 'arrow';
  };
  const place = () => {
    if (!cursorEl) return;
    const { x, y, down } = demo.pointer;
    cursorEl.style.transform = `translate(${x - 3}px, ${y - 2}px) scale(${down ? 0.86 : 1})`;
    cursorEl.classList.toggle('down', down);
    cursorEl.style.display = demo.config.showCursor && demo.pointer.seen ? 'block' : 'none';
  };
  const ripple = (x, y) => {
    const d = document.createElement('div');
    d.className = 'ripple';
    d.style.left = `${x - 23}px`;
    d.style.top = `${y - 23}px`;
    rootEl.appendChild(d);
    d.animate([{ transform: 'scale(.3)', opacity: 0.95 }, { transform: 'scale(1.4)', opacity: 0 }], { duration: 540, easing: 'ease-out' }).onfinish = () => d.remove();
    demo.ripples = (demo.ripples || 0) + 1;
  };

  window.addEventListener(
    'mousemove',
    (e) => {
      demo.pointer.x = e.clientX;
      demo.pointer.y = e.clientY;
      demo.pointer.seen = true;
      whenReady(() => {
        if (cursorEl) cursorEl.dataset.shape = shapeFor(e.clientX, e.clientY);
        place();
      });
    },
    true,
  );
  window.addEventListener(
    'mousedown',
    (e) => {
      demo.pointer.down = true;
      demo.pointer.seen = true;
      whenReady(() => {
        place();
        ripple(e.clientX, e.clientY);
      });
    },
    true,
  );
  window.addEventListener('mouseup', () => {
    demo.pointer.down = false;
    whenReady(place);
  }, true);

  // ---- key badges for shortcuts and special keys
  const KEY_NAMES = { Control: 'Ctrl', Meta: 'Win', ' ': 'Space', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' };
  window.addEventListener(
    'keydown',
    (e) => {
      if (demo.config.showKeys === 'none' || !e.isTrusted) return;
      if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;
      const combo = e.ctrlKey || e.altKey || e.metaKey;
      const special = ['Enter', 'Tab', 'Escape', 'Delete'].includes(e.key);
      if (!(combo || special || demo.config.showKeys === 'all')) return;
      const parts = [];
      if (e.ctrlKey) parts.push('Ctrl');
      if (e.altKey) parts.push('Alt');
      if (e.metaKey) parts.push('Win');
      if (e.shiftKey && (combo || special)) parts.push('Shift');
      parts.push(KEY_NAMES[e.key] ?? (e.key.length === 1 ? e.key.toUpperCase() : e.key));
      whenReady(() => {
        const k = document.createElement('div');
        k.className = 'key';
        k.textContent = parts.join(' + ');
        keysEl.replaceChildren(k);
        k.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none', offset: 0.12 }, { opacity: 1, offset: 0.8 }, { opacity: 0 }], { duration: 1500 }).onfinish = () => k.remove();
        demo.keyBadges = (demo.keyBadges || 0) + 1;
      });
    },
    true,
  );

  // ---- captions, spotlight, zoom, progress, slides: called from the runner
  demo.configure = (partial = {}) => {
    if (partial.theme) Object.assign(demo.config.theme, partial.theme);
    for (const k of ['showCursor', 'showKeys']) if (partial[k] !== undefined) demo.config[k] = partial[k];
    whenReady(applyTheme);
  };
  demo.caption = (text, { pos = 'top', lang = 'en' } = {}) =>
    whenReady(() => {
      captionEl.textContent = text;
      captionEl.className = `caption ${pos}${lang === 'ur' ? ' urdu' : ''}`;
      captionEl.dir = lang === 'ur' ? 'rtl' : 'ltr';
      void captionEl.offsetWidth;
      captionEl.classList.add('show');
    });
  demo.hideCaption = () => whenReady(() => captionEl.classList.remove('show'));
  demo.spotlight = (rect, pad = 8) =>
    whenReady(() => {
      if (!rect) return spotEl.classList.remove('show');
      Object.assign(spotEl.style, { left: `${rect.x - pad}px`, top: `${rect.y - pad}px`, width: `${rect.w + pad * 2}px`, height: `${rect.h + pad * 2}px` });
      spotEl.classList.add('show');
    });
  demo.zoom = ({ cx, cy, scale = 1.5, ms = 700 } = {}) => {
    const b = document.body;
    b.style.transition = `transform ${ms}ms ease-in-out`;
    b.style.transformOrigin = `${cx + scrollX}px ${cy + scrollY}px`;
    b.style.transform = `scale(${scale})`;
  };
  demo.zoomReset = (ms = 700) => {
    const b = document.body;
    b.style.transition = `transform ${ms}ms ease-in-out`;
    b.style.transform = 'none';
  };
  demo.progress = (p) => whenReady(() => (progressEl.style.width = `${Math.max(0, Math.min(1, p)) * 100}%`));
  demo.slide = ({ kind = 'title', kicker = '', headline = '', subtitle = '', bullets = [], logo = '', lang = 'en' } = {}) =>
    whenReady(() => {
      slideEl?.remove();
      slideEl = document.createElement('div');
      slideEl.className = `slide${lang === 'ur' ? ' urdu' : ''}`;
      slideEl.dir = lang === 'ur' ? 'rtl' : 'ltr';
      slideEl.dataset.kind = kind;
      const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
      slideEl.innerHTML = `<div class="card">${logo ? `<img class="logo" src="${esc(logo)}" alt="">` : ''}${kicker ? `<div class="kicker">${esc(kicker)}</div>` : ''}<h1 class="headline">${esc(headline)}</h1>${subtitle ? `<p class="subtitle">${esc(subtitle)}</p>` : ''}${bullets.length ? `<ul>${bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>` : ''}</div>`;
      rootEl.insertBefore(slideEl, rootEl.firstChild);
      void slideEl.offsetWidth;
      slideEl.classList.add('show');
    });
  demo.hideSlide = (ms = 500) =>
    whenReady(() => {
      if (!slideEl) return;
      const el = slideEl;
      el.style.transition = `opacity ${ms}ms`;
      el.classList.remove('show');
      el.style.opacity = '0';
      setTimeout(() => el.remove(), ms + 50);
      slideEl = null;
    });
  demo.hidePasswords = () => {
    if (document.getElementById('__demo_pw')) return;
    const s = document.createElement('style');
    s.id = '__demo_pw';
    s.textContent = 'input[type=password]{filter:blur(5px)!important}';
    (document.head || document.documentElement).appendChild(s);
  };
  demo.hide = (selectors = []) => {
    const id = '__demo_hide';
    document.getElementById(id)?.remove();
    if (!selectors.length) return;
    const s = document.createElement('style');
    s.id = id;
    s.textContent = `${selectors.join(',')}{display:none!important}`;
    (document.head || document.documentElement).appendChild(s);
  };

  document.addEventListener('DOMContentLoaded', () => {
    demo.hidePasswords();
    if (window.__demoHide && window.__demoHide.length) demo.hide(window.__demoHide);
  });

  // Build as soon as there is a documentElement (this script runs before the page's own scripts).
  if (document.documentElement) build();
  else new MutationObserver((_, o) => {
    if (document.documentElement) {
      o.disconnect();
      build();
    }
  }).observe(document, { childList: true });
})();
