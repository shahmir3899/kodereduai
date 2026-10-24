// Injected helper that finds elements the way a person describes them. Exposes window.__demo.find(locator).
(() => {
  const demo = (window.__demo = window.__demo || {});
  const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.02;
  };
  const INTERACTIVE = 'a[href], button, summary, label, select, textarea, input, [role=button], [role=tab], [role=menuitem], [role=option], [role=link], [role=checkbox], [role=radio], [role=switch], [onclick]';
  const ROLES = {
    button: 'button, [role=button], input[type=button], input[type=submit], summary',
    link: 'a[href], [role=link]',
    textbox: 'input:not([type]), input[type=text], input[type=email], input[type=search], input[type=tel], input[type=url], input[type=password], input[type=number], textarea, [role=textbox]',
    checkbox: 'input[type=checkbox], [role=checkbox]',
    radio: 'input[type=radio], [role=radio]',
    tab: '[role=tab]',
    combobox: 'select, [role=combobox]',
    heading: 'h1, h2, h3, h4, h5, h6, [role=heading]',
    listitem: 'li, [role=listitem]',
    row: 'tr, [role=row]',
    option: 'option, [role=option]',
    menuitem: '[role=menuitem]',
    img: 'img, [role=img]',
  };
  const nameOf = (el) => {
    const labelled = el.getAttribute('aria-labelledby');
    if (labelled) return norm(labelled.split(/\s+/).map((id) => document.getElementById(id)?.innerText).join(' '));
    return norm(el.getAttribute('aria-label') || (el.labels && el.labels[0]?.innerText) || el.innerText || el.value || el.getAttribute('placeholder') || el.getAttribute('title') || el.getAttribute('alt') || '');
  };
  const matchText = (haystack, needle, exact) => (exact ? haystack === needle : haystack === needle || haystack.startsWith(needle) || (needle.length > 3 && haystack.includes(needle) && haystack.length < needle.length * 3));
  const ordered = (list) => list.sort((a, b) => (a.compareDocumentPosition(b) & 4 ? -1 : 1));

  function candidates(loc, root) {
    const exact = !!loc.exact;
    if (loc.css) return [...root.querySelectorAll(loc.css)];
    if (loc.testid) return [...root.querySelectorAll(`[data-testid="${loc.testid}"], [data-test="${loc.testid}"], [data-cy="${loc.testid}"]`)];
    if (loc.placeholder) return [...root.querySelectorAll('[placeholder]')].filter((e) => matchText(norm(e.getAttribute('placeholder')), norm(loc.placeholder), exact));
    if (loc.alt) return [...root.querySelectorAll('[alt]')].filter((e) => matchText(norm(e.getAttribute('alt')), norm(loc.alt), exact));
    if (loc.label) {
      const want = norm(loc.label);
      const out = [];
      for (const l of root.querySelectorAll('label')) if (matchText(norm(l.innerText), want, exact) && l.control) out.push(l.control);
      for (const e of root.querySelectorAll('[aria-label]')) if (matchText(norm(e.getAttribute('aria-label')), want, exact)) out.push(e);
      return [...new Set(out)];
    }
    if (loc.role) {
      const list = [...root.querySelectorAll(ROLES[loc.role] || `[role=${loc.role}]`)];
      const want = norm(loc.name ?? loc.text ?? '');
      return want ? list.filter((e) => matchText(nameOf(e), want, exact)) : list;
    }
    if (loc.text) {
      const want = norm(loc.text);
      const all = [...(root === document ? document.body : root).querySelectorAll('*')].filter((e) => !['SCRIPT', 'STYLE', 'NOSCRIPT', 'OPTION'].includes(e.tagName) && e.id !== '__demo_host');
      const hits = all.filter((e) => {
        if (!visible(e)) return false;
        const t = norm(e.innerText);
        return t && matchText(t, want, exact);
      });
      // keep the deepest match, then lift it to the thing a person would click
      const deepest = hits.filter((e) => !hits.some((o) => o !== e && e.contains(o)));
      return deepest.map((e) => e.closest(INTERACTIVE) || e);
    }
    return [];
  }

  /** locator: a string (visible text) or { text, role, name, label, placeholder, testid, css, within, nth, exact }. */
  demo.find = (locator) => {
    const loc = typeof locator === 'string' ? { text: locator } : locator;
    let root = document;
    if (loc.within) {
      const inner = demo.find(loc.within);
      if (!inner.ok) return { ok: false, count: 0, why: `the area "${JSON.stringify(loc.within)}" was not found` };
      root = demo.last;
    }
    let list = ordered([...new Set(candidates(loc, root))]).filter(visible);
    if (loc.within && root !== document) list = list.filter((e) => root.contains(e));
    const index = loc.nth ?? 0;
    const el = list[index];
    if (!el) return { ok: false, count: list.length, why: list.length ? `only ${list.length} match(es), no number ${index}` : 'nothing visible matches' };
    demo.last = el;
    const r = el.getBoundingClientRect();
    return {
      ok: true,
      count: list.length,
      tag: el.tagName.toLowerCase(),
      type: el.type || '',
      rect: { x: r.left, y: r.top, w: r.width, h: r.height },
      text: (el.innerText || el.value || el.getAttribute('aria-label') || '').slice(0, 80),
      editable: el.matches('input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]), textarea, [contenteditable=""], [contenteditable=true]'),
      checked: 'checked' in el ? el.checked : null,
      disabled: !!el.disabled || el.getAttribute('aria-disabled') === 'true',
    };
  };

  /** Where is the last found element relative to the scroll area it lives in? */
  demo.scrollInfo = () => {
    const el = demo.last;
    if (!el) return null;
    let sp = null;
    for (let p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
      const o = getComputedStyle(p).overflowY;
      if ((o === 'auto' || o === 'scroll') && p.scrollHeight > p.clientHeight + 2) {
        sp = p;
        break;
      }
    }
    const er = el.getBoundingClientRect();
    if (!sp) return { page: true, view: { top: 0, bottom: innerHeight, left: 0, right: innerWidth }, el: { top: er.top, bottom: er.bottom, left: er.left, right: er.right }, maxUp: scrollY, maxDown: document.scrollingElement.scrollHeight - innerHeight - scrollY };
    const pr = sp.getBoundingClientRect();
    return {
      page: false,
      view: { top: Math.max(0, pr.top), bottom: Math.min(innerHeight, pr.bottom), left: Math.max(0, pr.left), right: Math.min(innerWidth, pr.right) },
      el: { top: er.top, bottom: er.bottom, left: er.left, right: er.right },
      maxUp: sp.scrollTop,
      maxDown: sp.scrollHeight - sp.clientHeight - sp.scrollTop,
    };
  };

  /** Total scroll position of everything under a point, to tell whether a scroll moved anything. */
  demo.scrollAt = (x, y) => {
    let sum = window.scrollY;
    for (let el = document.elementFromPoint(x, y); el && el !== document.documentElement; el = el.parentElement) sum += el.scrollTop || 0;
    return sum;
  };

  demo.textOnPage = () => document.body.innerText;
  demo.activeEditable = () => {
    const a = document.activeElement;
    return !!a && a.matches?.('input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]), textarea, [contenteditable=""], [contenteditable=true]');
  };
  demo.selectState = () => {
    const el = demo.last;
    if (!el || el.tagName !== 'SELECT') return null;
    return { index: el.selectedIndex, options: [...el.options].map((o) => o.text.trim()), value: el.value };
  };
})();
