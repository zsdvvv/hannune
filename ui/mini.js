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

// 말로 넣기: 미니 창에서 바로 듣고 → 받아 적어 → 본 창의 '바로 넣기'와 같은 규칙으로 넣는다
const Cap = new VoiceCore.Capture({ preRollMs: 300, warmMs: 20000 });
let pressAt = 0;
let VS = null;
const mv = (html, err, hold) => { const el = $('#mv'); el.hidden = !html; el.innerHTML = html || ''; el.classList.toggle('err', !!err); clearTimeout(mv.t); if (html && !hold) mv.t = setTimeout(() => { el.hidden = true; }, 6000); };
const mic = $('#mMic');
const paint = lv => { mic.className = 'mic ' + (VS ? VS.state : ''); if (lv !== undefined) mic.style.setProperty('--lv', lv.toFixed(2)); };
async function miniStart() {
  if (VS && VS.state === 'listening') { if (Cap.active) Cap.stop('user'); return; }
  if (VS) return;
  const info = await hn.voiceInfo();
  if (!info.ready) { mv(esc(info.why), true); return; }
  const v = set.voice || {};
  const id = LinkCore.newId();
  VS = { id, state: 'listening', t0: Date.now(), hold: true };
  paint(0); mv('듣는 중… 말하세요', false, true);
  Voice.hush();
  hn.voiceBegin({ id, where: 'mini', source: 'mini' });
  Cap.touch();
  try { await Cap.openMic(); } catch (e) { hn.voiceCancel(id); VS = null; paint(); mv('마이크를 열지 못했습니다: ' + esc(e.message), true); return; }
  if (!VS || VS.id !== id) return;
  Cap.begin({
    onChunk: b => hn.voiceChunk(id, b),
    onLevel: lv => { if (VS && VS.id === id) paint(lv); },
    onEnd: why => {
      if (why === 'nospeech') { hn.voiceCancel(id); VS = null; paint(); mv('아무 말도 들리지 않았습니다.', true); return; }
      if (VS) VS.state = 'busy'; paint(); hn.voiceEnd(id);
    },
  }, { auto: !VS.hold, silenceMs: v.silenceMs, maxSec: v.maxSec });
}
function miniRelease(e) {
  if (!VS || VS.state !== 'listening' || !VS.hold) return;
  if (e.timeStamp - pressAt < 350) { VS.hold = false; if (Cap.active) Cap.setAuto(true, { silenceMs: (set.voice || {}).silenceMs, maxMs: ((set.voice || {}).maxSec || 30) * 1000 }); }
  else if (Cap.active) Cap.stop('user');
}
mic.addEventListener('pointerdown', e => { e.preventDefault(); pressAt = e.timeStamp; try { mic.setPointerCapture(e.pointerId); } catch (_) { /* 무시 */ } miniStart(); });
mic.addEventListener('pointerup', miniRelease);
mic.addEventListener('pointercancel', miniRelease);
mic.addEventListener('mouseenter', () => { if (VS) return; hn.voiceWarm(); Cap.warm(20000).catch(() => { /* 누를 때 다시 알림 */ }); });
async function miniEvt(ev) {
  if (!VS || ev.id !== VS.id) return;
  if (ev.type === 'interim') { mv(esc(ev.text), false, true); return; }
  if (ev.type === 'busy') { VS.state = 'busy'; paint(); mv('받아 적는 중…', false, true); return; }
  if (ev.type === 'error') { VS = null; paint(); mv(esc(ev.msg), true); return; }
  if (ev.type !== 'final') return;
  VS = null; paint();
  if (!ev.text) { mv('들린 말이 없습니다.', true); return; }
  const v = set.voice || {};
  const p = NLP.parse(ev.text, { mode: 'quick', custom: set.nlp.custom, learn: set.nlp.learn });
  const g = k => (p.actions.find(a => a.type === k) || {}).value;
  if (!p.title) { mv(`들은 말: “${esc(ev.text)}” — 할 일 이름을 함께 말해 주세요.`, true); return; }
  let date = g('date'); if (!date && g('time')) date = ymd(new Date());
  const kind = g('kind') || 'deadline';
  await hn.addManual({ title: p.title, area: g('area') || '개인', date, time: g('time') || '', label: kind === 'event' ? '일정' : '마감', imp: g('imp') || 0, kind, src: ev.text });
  const when = date ? NLP.fmtDate(date) + (g('time') ? ' ' + g('time') : '') : '';
  mv(`넣었습니다: <b>${esc(p.title)}</b>${when ? ' · ' + esc(when) : ''}${g('imp') ? ' · ' + '★'.repeat(g('imp')) : ''}`);
  if (v.speak) Voice.say(`넣었습니다. ${p.title}${when ? ', ' + when : ''}`, { voiceName: v.voiceName, rate: v.rate });
}

function tick() { $('#clock').textContent = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false }); }

(async () => {
  [board, set, act] = await Promise.all([hn.board(), hn.settings(), hn.activityState()]);
  hn.on('board', b => { board = b; render(); });
  hn.on('settings', s => { set = s; render(); });
  hn.on('activity', a => { act = a; render(); });
  hn.on('voice:evt', miniEvt);
  { const m = (set.voice || {}).micMode || 'std'; Cap.opts.audio = { channelCount: 1, echoCancellation: m !== 'raw', noiseSuppression: m === 'noisy', autoGainControl: m !== 'raw' }; }
  Cap.prepare();
  setInterval(tick, 1000);
  tick();
  render();
})();
