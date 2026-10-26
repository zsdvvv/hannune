// AI로 일을 읽고 영역·주제·마감·다음 할 일을 정리한다. 1단계(묶기)는 한 번, 2단계(마감·상태)는 바뀐 일만.
// 실제로 부르는 곳(Claude Code·Gemini·Groq·Ollama …)은 main.js가 설정의 AI 에이전트로 정한다.
let llm = require('./claude').callClaude;
function useLLM(fn) { llm = fn; }
const callClaude = args => llm(args);

const AREA_GUIDE = `영역(area)은 다음 가운데 하나:
- 업무: 직장 일 — 공문·보고서·회의·기관 협의·출장·발표
- 개발: 개인적으로 만드는 앱·웹·게임·도구·자동화
- 학교: 학교·대학원 수업·과제·발표, 자격증·시험 공부
- 연구: 논문·학회 투고·특허
- 집필: 책·원고
- 창업: 공모전·경진대회·창업 지원사업·사업화·투자 자료
- 개인: 그 밖의 개인 일`;

const GROUP_SCHEMA = {
  type: 'object',
  properties: {
    items: { type: 'array', items: { type: 'object', properties: {
      id: { type: 'string' }, area: { type: 'string', enum: ['업무', '개발', '학교', '연구', '집필', '창업', '개인'] },
      group: { type: 'string' }, title: { type: 'string' },
    }, required: ['id', 'area', 'group', 'title'] } },
    sessions: { type: 'array', items: { type: 'object', properties: {
      id: { type: 'string' }, match: { type: 'string' },
    }, required: ['id', 'match'] } },
  },
  required: ['items', 'sessions'],
};

const DETAIL_SCHEMA = {
  type: 'object',
  properties: {
    items: { type: 'array', items: { type: 'object', properties: {
      id: { type: 'string' },
      status: { type: 'string', enum: ['진행', '대기', '완료', '보류'] },
      summary: { type: 'string' }, next: { type: 'string' },
      deadlines: { type: 'array', items: { type: 'object', properties: {
        date: { type: 'string' }, time: { type: 'string' }, label: { type: 'string' },
        kind: { type: 'string', enum: ['deadline', 'event'] }, confidence: { type: 'number' },
      }, required: ['date', 'label', 'kind', 'confidence'] } },
    }, required: ['id', 'status', 'summary', 'next', 'deadlines'] } },
  },
  required: ['items'],
};

function todayStr() {
  const d = new Date();
  const w = '일월화수목금토'[d.getDay()];
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} (${w})`;
}

// AI에게는 긴 id 대신 짧은 번호(i0, s0…)를 주고 받아서 되돌린다 — 긴 id는 AI가 바꿔 적기 쉽다
const keyFix = k => String(k || '').replace(/[\[\]\s]/g, '').toLowerCase();

async function runGroups(board, opts) {
  const lines = board.items.map((it, i) =>
    `[i${i}] ${it.baseTitle} | ${String(it.hook || '').slice(0, 160)} | 폴더: ${it.primary || '-'} | 대화: ${it.sessions.slice(0, 3).map(s => s.title).join(' / ')}`);
  const sess = board.unassigned.slice(0, 30).map((s, i) => `[s${i}] ${s.title} | ${String(s.first || '').slice(0, 100)}`);
  const prompt = `오늘: ${todayStr()}
아래는 한 사람의 진행 중인 일 목록이다. 일마다 area·group·title을 정해라.
${AREA_GUIDE}
group: 같은 큰 주제끼리 묶는 짧은 이름(2~8자). 폴더가 달라도 주제가 같으면 같은 이름(예: 대외협력, 주간보고, 앱 개발, 논문, 대학원 수업, 이사 준비). 혼자뿐인 주제여도 된다.
title: 목록에 보일 짧은 이름(18자 이내, 핵심 낱말 먼저).

[일 목록]
${lines.join('\n')}

[분류 안 된 Claude 대화] 각 대화(s번호)가 위 일 가운데 어느 것과 관련되는지 match에 일 번호(i번호)를, 관련 없으면 "-"를 넣어라.
${sess.join('\n') || '(없음)'}

id에는 대괄호 안의 번호(i0, s0 같은 것)만 그대로 적어라. 일 목록의 모든 i번호에 대해 빠짐없이 답하라.`;
  const r = await callClaude({ system: '너는 일정·업무 정리 비서다. 정해진 JSON 모양으로만 답한다.', prompt, schema: GROUP_SCHEMA, model: opts.model, effort: 'low' });
  if (opts.log) opts.log({ task: 'groups', n: board.items.length, result: r });
  const itemOf = k => board.items[Number(keyFix(k).replace(/^i/, ''))];
  const sessOf = k => board.unassigned[Number(keyFix(k).replace(/^s/, ''))];
  return {
    items: (r.items || []).map(x => ({ ...x, it: itemOf(x.id) })).filter(x => x.it),
    sessions: (r.sessions || []).map(x => ({ s: sessOf(x.id), it: /^i\d+$/.test(keyFix(x.match)) ? itemOf(x.match) : null })).filter(x => x.s),
  };
}

async function runDetails(batch, texts, opts) {
  const blocks = batch.map((it, i) => {
    const t = String(texts[it.id] || '').replace(/\n{3,}/g, '\n\n').slice(0, 2600);
    return `### [i${i}] ${it.title}\n최근 작업: ${it.lastRel || '-'} / 최근 문서: ${it.docs.slice(0, 4).map(d => d.name).join(', ') || '-'}\n${t}`;
  });
  const prompt = `오늘: ${todayStr()}
각 일의 메모를 읽고 다음을 정리해라.
- deadlines: 앞으로 챙겨야 할 날짜만(마감·제출·회신·발표·시험·대회·출장·행사). 버전을 만든 날, 고친 날, 끝낸 날 같은 작업 기록 날짜는 넣지 마라. 연도가 없으면 문맥으로 정하라. 이미 지난 날짜는 아직 처리 안 된 것이 분명할 때만 넣어라. date는 YYYY-MM-DD, time은 시각이 적혀 있으면 HH:MM(없으면 빈 문자열), label은 무엇을 하는 날인지 12자 이내, kind는 deadline(마감·제출·회신) 또는 event(발표·시험·행사·출장), confidence는 0~1.
- status: 진행 | 대기(남의 확인·결정을 기다림) | 완료 | 보류
- summary: 지금 상태 한 줄(40자 이내)
- next: 다음에 할 일 한 줄(30자 이내, 동사로 끝)

${blocks.join('\n\n')}

id에는 ### 뒤 대괄호 안의 번호(i0, i1 …)만 적고, 모든 번호에 대해 빠짐없이 답하라.`;
  const r = await callClaude({ system: '너는 일정·업무 정리 비서다. 정해진 JSON 모양으로만 답한다.', prompt, schema: DETAIL_SCHEMA, model: opts.model, effort: 'low', timeoutMs: 400000 });
  if (opts.log) opts.log({ task: 'details', ids: batch.map(b => b.id), result: r });
  return (r.items || []).map(x => ({ ...x, it: batch[Number(keyFix(x.id).replace(/^i/, ''))] })).filter(x => x.it);
}

// board.items 와 texts 를 받아 ai 객체를 고쳐서 돌려준다. onProgress(msg)
async function analyze({ board, texts, ai, onProgress, model = 'sonnet', force = false, log }) {
  ai = ai || {};
  ai.groups = ai.groups || {};
  ai.details = ai.details || {};
  ai.sessions = ai.sessions || {};
  const items = board.items.filter(it => it.band !== 'done' || force);
  const say = m => onProgress && onProgress(m);

  say('일을 영역·주제로 묶는 중…');
  const g = await runGroups({ items: board.items, unassigned: board.unassigned }, { model, log });
  for (const x of g.items) ai.groups[x.it.id] = { area: x.area, group: x.group.trim(), title: x.title.trim() };
  for (const x of g.sessions) ai.sessions[x.s.id] = x.it ? x.it.id : '-';
  const missing = board.items.length - g.items.length;

  const todo = items.filter(it => force || !ai.details[it.id] || ai.details[it.id].hash !== it.aiHash);
  const batches = [];
  for (let i = 0; i < todo.length; i += 8) batches.push(todo.slice(i, i + 8));
  let done = 0;
  const errors = [];
  const worker = async () => {
    while (batches.length) {
      const b = batches.shift();
      try {
        const r = await runDetails(b, texts, { model, log });
        for (const x of r) {
          const it = x.it;
          ai.details[it.id] = { hash: it.aiHash, at: new Date().toISOString(), status: x.status, summary: x.summary, next: x.next,
            deadlines: (x.deadlines || []).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d.date)).map(d => ({ ...d, time: /^\d{2}:\d{2}$/.test(d.time || '') ? d.time : '' })) };
        }
      } catch (e) { errors.push(e.message); }
      done += b.length;
      say(`마감·상태 읽는 중… ${done}/${todo.length}`);
    }
  };
  say(`마감·상태 읽는 중… 0/${todo.length}`);
  await Promise.all([worker(), worker(), worker()]);
  ai.at = new Date().toISOString();
  const left = todo.filter(it => !ai.details[it.id] || ai.details[it.id].hash !== it.aiHash).length;
  if (missing > 0) errors.push(`묶기에서 ${missing}개 빠짐`);
  if (left > 0) errors.push(`마감 읽기에서 ${left}개 빠짐 — 다시 누르면 빠진 것만 읽습니다`);
  return { ai, errors, count: todo.length };
}

// 문서에서 찾은 날짜 후보를 앞뒤 문장만 보고 다듬는다: 진짜 챙길 일정인지, 짧은 이름, 시각
const FOUND_SCHEMA = {
  type: 'object',
  properties: { items: { type: 'array', items: { type: 'object', properties: {
    id: { type: 'string' }, keep: { type: 'boolean' }, date: { type: 'string' }, time: { type: 'string' },
    label: { type: 'string' }, kind: { type: 'string', enum: ['deadline', 'event'] },
  }, required: ['id', 'keep', 'date', 'label', 'kind'] } } },
  required: ['items'],
};
async function refineFound(list, { model = 'sonnet', onProgress } = {}) {
  const out = [];
  const batches = [];
  for (let i = 0; i < list.length; i += 25) batches.push(list.slice(i, i + 25));
  let n = 0;
  for (const b of batches) {
    const lines = b.map((x, i) => `[i${i}] 문서: ${x.name} | 찾은 날짜: ${x.date}${x.time ? ' ' + x.time : ''} | 원문: …${String(x.ctx || '').slice(0, 220)}…`);
    const prompt = `오늘: ${todayStr()}
아래는 문서에서 자동으로 찾은 날짜와 그 앞뒤 원문이다. 각각에 대해:
- keep: 이 사람이 챙겨야 할 마감·제출·회신·발표·회의·행사·시험 같은 일정이면 true. 문서 작성일·시행일·과거 실적·출시일·통계 기준일·단순 기간 표기면 false.
- date: 원문에 맞는 날짜(YYYY-MM-DD). 찾은 날짜가 맞으면 그대로.
- time: 원문에 시각이 있으면 HH:MM, 없으면 빈 문자열.
- label: 무엇을 하는 날인지 14자 이내(예: 검토의견 회신, 착수보고회).
- kind: deadline(마감·제출·회신) 또는 event(회의·발표·행사·시험).
id에는 대괄호 안 번호(i0 …)만 적고 모든 번호에 답하라.

${lines.join('\n')}`;
    const r = await callClaude({ system: '너는 일정 정리 비서다. 정해진 JSON 모양으로만 답한다.', prompt, schema: FOUND_SCHEMA, model, effort: 'low' });
    for (const x of r.items || []) {
      const src = b[Number(keyFix(x.id).replace(/^i/, ''))];
      if (!src) continue;
      out.push({ key: src.key, keep: !!x.keep, date: /^\d{4}-\d{2}-\d{2}$/.test(x.date || '') ? x.date : src.date,
        time: /^\d{2}:\d{2}$/.test(x.time || '') ? x.time : (src.time || ''), label: String(x.label || src.label).slice(0, 20), kind: x.kind || src.kind });
    }
    n += b.length;
    if (onProgress) onProgress(`찾은 일정 다듬는 중… ${n}/${list.length}`);
  }
  return out;
}

// 글로 쓴 일정 변경 요청을 AI가 해석(규칙 해석기가 못 알아들었을 때·사용자가 원할 때)
// 결과는 규칙 해석기와 같은 모양 { actions:[{type,value,src}] } 으로 돌려준다.
const NL_SCHEMA = {
  type: 'object',
  properties: { actions: { type: 'array', items: { type: 'object', properties: {
    type: { type: 'string', enum: ['date', 'time', 'shiftDays', 'shiftMinutes', 'imp', 'area', 'title', 'label', 'kind', 'done', 'undone', 'hide', 'unhide', 'remove', 'add'] },
    value: { type: ['string', 'number', 'boolean'] }, src: { type: 'string' },
  }, required: ['type', 'value'] } }, note: { type: 'string' } },
  required: ['actions'],
};
async function interpretChange(text, cur, opts = {}) {
  const prompt = `오늘: ${todayStr()}
지금 일정: 제목 "${cur.title || ''}", 마감 날짜 ${cur.date || '없음'}, 시각 ${cur.time || '없음'}, 중요도 ${cur.imp || 0}(0~5), 영역 ${cur.area || ''}, 마감 이름 "${cur.label || ''}"
사용자 요청: "${text}"

요청을 아래 동작들로 바꿔라(필요한 것만):
- date: 새 마감 날짜 YYYY-MM-DD / time: 새 시각 HH:MM(24시간)
- shiftDays: 지금 마감에서 며칠 미루기(+)·당기기(-) / shiftMinutes: 시각을 몇 분 미루기(+)·당기기(-)
- imp: 중요도 0~5 / area: 업무·개발·학교·연구·집필·창업·개인 중 하나
- title: 일 이름 / label: 마감 이름(예: 제출, 회의) / kind: deadline 또는 event
- done·undone·hide·unhide·remove(이 마감 지우기)·add(새 마감으로 추가): value는 true
src에는 그렇게 판단한 원문 조각을 넣어라. 알아들을 수 없으면 actions를 빈 배열로 두고 note에 이유를 써라.`;
  const r = await callClaude({ system: '너는 일정 변경 요청을 해석하는 비서다. 정해진 JSON 모양으로만 답한다.', prompt, schema: NL_SCHEMA, model: opts.model, effort: 'low', timeoutMs: 90000 });
  const actions = (r.actions || []).filter(a => a && a.type).map(a => {
    const v = a.type === 'imp' || /^shift/.test(a.type) ? Number(a.value) : (['done', 'undone', 'hide', 'unhide', 'remove', 'add'].includes(a.type) ? true : String(a.value));
    return { type: a.type, value: v, src: a.src || 'AI' , ai: true };
  }).filter(a => !(a.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(a.value)) && !(a.type === 'time' && !/^\d{2}:\d{2}$/.test(a.value)));
  return { actions, note: r.note || '' };
}

module.exports = { analyze, refineFound, interpretChange, useLLM };
