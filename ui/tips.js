// 조작 요소마다 설명을 커서 바로 위에 띄운다(title을 말풍선으로 바꿈). 본 창·미니 창이 같이 씀.
(function () {
  const tip = document.createElement('div');
  tip.className = 'tip'; tip.hidden = true;
  const add = () => document.body.appendChild(tip);
  if (document.body) add(); else document.addEventListener('DOMContentLoaded', add);
  let cur = null, suppress = false; // 누르고 있는 동안은 말풍선을 띄우지 않는다
  const place = e => {
    const r = tip.getBoundingClientRect();
    const half = r.width / 2;
    tip.style.left = Math.max(half + 6, Math.min(window.innerWidth - half - 6, e.clientX)) + 'px';
    tip.style.top = Math.max(r.height + 4, e.clientY - 12) + 'px';
  };
  const hide = () => { tip.hidden = true; cur = null; };
  document.addEventListener('mouseover', e => {
    if (e.target.closest && e.target.closest('[data-ctips]')) { hide(); return; } // 서클 칸은 서클 말풍선이 맡는다(두 개 뜨지 않게)
    const el = e.target.closest && e.target.closest('[title],[data-tip]');
    const ctl = !el && e.target.closest && e.target.closest('.fr input, .fr select, .fr textarea, .fr .sw-t');
    if (ctl && !ctl.dataset.tip) { const row = ctl.closest('.fr'); const txt = row ? row.textContent.replace(/\s+/g, ' ').trim().slice(0, 140) : ''; if (txt) ctl.dataset.tip = txt; }
    const target = el || (ctl && ctl.dataset.tip ? ctl : null);
    if (!target) { hide(); return; }
    if (target !== el) { if (target === cur || suppress) return; cur = target; tip.textContent = target.dataset.tip; tip.hidden = false; place(e); return; }
    if (el.hasAttribute('title')) { el.dataset.tip = el.getAttribute('title'); el.removeAttribute('title'); }
    if (el === cur || suppress) return;
    cur = el;
    if (!el.dataset.tip) { hide(); return; }
    tip.textContent = el.dataset.tip;
    tip.hidden = false;
    place(e);
  }, true);
  document.addEventListener('mousemove', e => { if (cur && !tip.hidden) place(e); }, true);
  document.addEventListener('pointerdown', () => { hide(); suppress = true; }, true);
  document.addEventListener('pointerup', () => { suppress = false; }, true);
  document.addEventListener('wheel', hide, { capture: true, passive: true });
  window.addEventListener('blur', hide);
  // 시험용: 설명이 없는 조작 요소를 찾아 알려 준다(글자가 그 자체로 설명인 단추는 뺌)
  window.tipAudit = function () {
    const bad = [];
    // 글자가 있는 단추·줄은 그 글자가 설명이므로, 그림 단추와 입력 칸만 본다(설정 칸은 그 줄의 글을 말풍선으로 띄움)
    for (const el of document.querySelectorAll('button, select, input, textarea')) {
      if (el.offsetParent === null) continue;
      if (el.title || el.dataset.tip || el.closest('.fr, [title], [data-tip]')) continue;
      const label = (el.textContent || el.placeholder || '').trim().slice(0, 18);
      if (el.tagName === 'BUTTON' && label.length >= 2) continue;
      if (el.placeholder) continue;
      bad.push(`${el.tagName.toLowerCase()}:${label}`);
    }
    return `${bad.length}개` + (bad.length ? ' ' + bad.slice(0, 12).join(' | ') : '');
  };
})();
