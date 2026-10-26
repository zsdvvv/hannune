// 한눈에 — 늘 위에 떠 있는 작은 창: 마감 가까운 순 몇 줄만. 체크하면 줄을 긋고 연하게(오늘 체크한 것만 남김)
let board = null, set = null, act = null;

const todayStart = () => { const t = new Date(); return new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime(); };

function render() {
  if (!board || !set) return;
  document.documentElement.dataset.theme = set.theme || 'paper';
  const t0 = todayStart();
  // 본 창과 같은 "끝낸 일 감추기" 설정을 따른다(어느 창에서 바꿔도 둘 다 바뀜)
  const items = board.items.filter(it => !it.hidden && (it.overdueDl || it.nextDl || it.fdl) &&
    (it.done ? (!set.hideDone && it.doneAt >= t0) : it.band !== 'done')).sort(urgencySort).slice(0, set.mini.count || 8);
  const hb = $('#hideDone');
  hb.classList.toggle('on', !!set.hideDone);
  hb.title = set.hideDone ? '끝낸 일 보이기 (본 창과 함께 바뀜)' : '끝낸 일 감추기 (본 창과 함께 바뀜)';
  $('#list').innerHTML = items.map(it => {
    const d = focusDl(it);
    return `<div class="mr ${it.done ? 'done' : ''}" data-id="${esc(it.id)}" style="--a:${areaColor(board, it.area)}">
      <label class="ck" title="완료 체크"><input type="checkbox" data-check="${esc(it.id)}" ${it.done ? 'checked' : ''}><i></i></label>${ddHTML(it)}
      <div style="min-width:0"><div class="t">${esc(it.title)}</div><div class="g">${d ? esc(d.label) + ' · ' : ''}${esc(it.group)}</div></div></div>`;
  }).join('') || '<div class="empty" style="padding:30px 12px">다가오는 마감이 없습니다.</div>';
  const all = board.items.filter(it => !it.hidden && it.band !== 'done' && !it.done);
  const today = all.filter(it => it.band === 'today').length;
  const week = all.filter(it => it.nextDl && it.nextDl.days <= 7).length;
  $('#mf').innerHTML = `오늘 ${today} · 7일 안 ${week}` + (act && act.on ? `<span class="rec">● 기록${act.item ? ' · ' + esc(act.item.title) : ''}</span>` : '');
}

document.addEventListener('click', e => {
  const c = e.target.closest('input[data-check]');
  if (c) {
    const it = board.items.find(x => x.id === c.dataset.check);
    if (!it) return;
    if (c.checked) hn.setItem(it.id, { done: true, doneAt: Date.now(), doneBand: it.band, active: null });
    else hn.setItem(it.id, { done: null, doneAt: null, doneBand: null, active: it.status === '완료' ? true : null });
    return;
  }
  if (e.target.closest('.ck')) return;
  const r = e.target.closest('.mr');
  if (r) hn.selectInMain(r.dataset.id);
});
$('#open').onclick = () => hn.showMain();
$('#hideDone').onclick = async () => { set = await hn.setSettings({ hideDone: !set.hideDone }); render(); };
$('#x').onclick = () => hn.mini(false);

function tick() { $('#clock').textContent = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false }); }

(async () => {
  [board, set, act] = await Promise.all([hn.board(), hn.settings(), hn.activityState()]);
  hn.on('board', b => { board = b; render(); });
  hn.on('settings', s => { set = s; render(); });
  hn.on('activity', a => { act = a; render(); });
  setInterval(tick, 1000);
  tick();
  render();
})();
