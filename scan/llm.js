// AI 에이전트 연결: 사용자가 고른 곳으로 보내고 JSON으로 받는다.
//  - claude : 이 PC의 Claude Code(claude -p). 구독으로 돌아 키가 필요 없다.
//  - gemini / groq / openrouter : 무료 키로 쓰는 OpenAI 호환 API
//  - ollama : 내 PC에서 돌리는 무료 모델(인터넷·키 없음)
//  - custom : OpenAI 호환 주소를 직접 넣기(LM Studio 등)
// v1.2.2: 키는 '저장된 키' 목록(agent.keys)에 이름을 붙여 모아 두고, 쓸 곳마다 따로 고른다(agent.profiles).
//  예전에는 키·모델·주소 칸이 하나씩뿐이라 쓸 곳을 바꾸면 값이 섞였다(주소 칸에 넣은 토큰이 Gemini 주소로 쓰임).
const { callClaude, claudeAvailable } = require('./claude');

const PRESETS = {
  gemini: { name: 'Google Gemini (무료 키)', base: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-3.5-flash', keyUrl: 'https://aistudio.google.com/apikey', needKey: true,
    // 모델이 닫히거나(404) 붐비면(503) 차례로 바꿔 부른다. 2.5 계열은 새 사용자에게 닫혔고, 3.7·3.8은 무료에서 답이 1분 넘게 걸렸다(2026-10 실측).
    fallback: ['gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'],
    help: 'Google 계정으로 AI Studio에 들어가 "API 키 만들기" → 복사해 붙여넣기. 무료 사용량 안에서 카드 등록 없이 쓸 수 있습니다. 모델은 비워 두면 gemini-3.5-flash(빠름)를 씁니다.' },
  groq: { name: 'Groq (무료 키, 빠름)', base: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile', keyUrl: 'https://console.groq.com/keys', needKey: true,
    help: 'Groq에 가입 → API Keys → Create API Key → 붙여넣기. 무료 사용량이 넉넉하고 매우 빠릅니다.' },
  openrouter: { name: 'OpenRouter (무료 모델)', base: 'https://openrouter.ai/api/v1', model: 'meta-llama/llama-3.3-70b-instruct:free', keyUrl: 'https://openrouter.ai/keys', needKey: true,
    help: 'OpenRouter 가입 → Keys → Create Key. 모델 이름이 ":free"로 끝나는 것은 무료입니다.' },
  ollama: { name: 'Ollama (내 PC, 완전 무료)', base: 'http://localhost:11434/v1', model: 'qwen2.5:7b', keyUrl: 'https://ollama.com/download', needKey: false,
    help: 'Ollama를 설치하고 아래 ‘내 PC AI’에서 모델을 눌러 받으면 바로 씁니다(명령창 필요 없음). 인터넷 없이 이 PC에서 돌고 글이 밖으로 나가지 않습니다(메모리 8GB 이상 권장).' },
  custom: { name: '직접 입력 (OpenAI 호환)', base: 'http://localhost:1234/v1', model: '', keyUrl: '', needKey: false, help: 'LM Studio 등 OpenAI 호환 주소를 넣습니다. 키가 필요한 곳이면 아래 키도 저장하세요.' },
};
const OWN_BASE = new Set(['custom', 'ollama']); // 주소 칸을 쓰는 곳

// 키 모양으로 어디 키인지 알아본다. ai:false는 AI 호출에 못 쓰는 키(보관만).
const KINDS = [
  { re: /^(github_pat_|ghp_|gho_|ghu_|ghs_)/, provider: 'github', name: 'GitHub 토큰', ai: false,
    why: 'GitHub 토큰은 AI 키가 아닙니다. 토큰으로 AI를 쓰던 GitHub Models가 2026-07-30에 문을 닫아 AI 호출에는 쓸 수 없습니다. 보관만 합니다.' },
  { re: /^(AIza|AQ\.)/, provider: 'gemini', name: 'Gemini 키' },
  { re: /^gsk_/, provider: 'groq', name: 'Groq 키' },
  { re: /^sk-or-/, provider: 'openrouter', name: 'OpenRouter 키' },
  { re: /^sk-ant-/, provider: 'anthropic', name: 'Anthropic 키', ai: false,
    why: 'Anthropic(Claude) API 키는 이 프로그램에서 바로 쓰지 않습니다. Claude는 쓸 곳에서 "Claude Code (이 PC)"를 고르세요. 보관만 합니다.' },
];
const KIND_NAMES = { github: 'GitHub (AI용 아님)', anthropic: 'Anthropic (보관만)', other: '기타 (보관만)' };
function keyKind(key) { const k = String(key || '').trim(); return KINDS.find(x => x.re.test(k)) || null; }
const isUrl = s => /^https?:\/\/[^\s/]+/i.test(String(s || '').trim());
const mask = k => { const s = String(k || ''); return s.length > 14 ? s.slice(0, 6) + '…' + s.slice(-4) : '••••'; };
const newId = () => 'k' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const today = () => new Date().toISOString().slice(0, 10);
const provName = p => (PRESETS[p] ? PRESETS[p].name.replace(/\s*\(.*\)$/, '') : KIND_NAMES[p] || p);

const profileOf = (a, provider) => (a && a.profiles && a.profiles[provider]) || {};
function keyFor(a, provider) {
  const keys = (a && a.keys) || [];
  const prof = profileOf(a, provider);
  const k = keys.find(x => x.id === prof.keyId) || keys.find(x => x.provider === provider);
  return k ? k.key : '';
}

function resolve(agent) {
  const a = agent || {};
  let provider = a.provider || 'auto';
  if (provider === 'auto') provider = claudeAvailable() ? 'claude' : 'none';
  if (provider === 'claude' || provider === 'none') return { provider };
  const p = PRESETS[provider] || PRESETS.custom;
  const prof = profileOf(a, provider);
  // 주소는 직접 입력·Ollama에서만, 그리고 http(s) 주소일 때만 쓴다(키를 잘못 넣어도 주소로 쓰지 않음)
  const base = OWN_BASE.has(provider) && isUrl(prof.base) ? String(prof.base).trim() : p.base;
  return { provider, base: base.replace(/\/+$/, ''), model: String(prof.model || '').trim() || p.model, key: keyFor(a, provider) };
}

function ready(agent) {
  const r = resolve(agent);
  if (r.provider === 'none') return false;
  if (r.provider === 'claude') return claudeAvailable();
  return !!r.model && (!(PRESETS[r.provider] || {}).needKey || !!r.key);
}

// ---------- 저장된 키 ----------
// v1.2.1까지의 설정(key·model·base 한 칸씩)을 저장된 키 목록 + 쓸 곳별 설정으로 옮긴다. 한 번만.
function migrate(agent) {
  const a = { ...(agent || {}) };
  if (a.vault) return a;
  const keys = Array.isArray(a.keys) ? [...a.keys] : [];
  const profiles = { ...(a.profiles || {}) };
  const prof = p => (profiles[p] = { ...(profiles[p] || {}) });
  const add = (raw, fallbackProvider, fallbackName) => {
    const key = String(raw || '').trim();
    if (!key) return null;
    const old = keys.find(x => x.key === key);
    if (old) return old;
    const kind = keyKind(key);
    const provider = kind ? kind.provider : (fallbackProvider || 'other');
    const k = { id: newId(), name: kind ? kind.name : fallbackName || provName(provider) + ' 키', provider, key, at: today() };
    keys.push(k);
    return k;
  };
  const cur = a.provider;
  if (a.key) { const k = add(a.key, PRESETS[cur] ? cur : null); if (k && PRESETS[k.provider]) prof(k.provider).keyId = k.id; }
  if (a.base) {
    if (isUrl(a.base)) { if (OWN_BASE.has(cur)) prof(cur).base = a.base; }
    else add(a.base, null, '주소 칸에 있던 값'); // 주소 칸에 잘못 붙여 넣은 키·토큰
  }
  if (a.model && PRESETS[cur]) prof(cur).model = a.model;
  return { ...a, keys, profiles, vault: 1 };
}

// 예전 판(v1.2.1 이하)이 같은 설정 파일을 읽어도 지금 고른 키·모델로 돌게 옛 칸을 맞춰 둔다
function withMirror(agent) {
  const a = { ...(agent || {}) };
  const r = resolve(a);
  a.key = r.key || '';
  a.model = r.model || '';
  a.base = OWN_BASE.has(r.provider) && isUrl(profileOf(a, r.provider).base) ? profileOf(a, r.provider).base : '';
  return a;
}

// 키 다루기: add(새 키) · use(이 키로 쓰기) · del(지우기) · name(이름 바꾸기)
// 돌려줌: { ok, msg, agent(바뀐 설정) }
function keyOp(agent, req) {
  const a = migrate(agent);
  const keys = (a.keys || []).map(k => ({ ...k }));
  const profiles = JSON.parse(JSON.stringify(a.profiles || {}));
  const setKeyOf = (p, id) => { profiles[p] = { ...(profiles[p] || {}), keyId: id }; };
  const out = (ok, msg, extra) => ({ ok, msg, agent: ok ? { ...a, keys, profiles, ...(extra || {}) } : null });
  const { op } = req || {};
  if (op === 'add') {
    const key = String(req.key || '').trim().replace(/^Bearer\s+/i, '');
    if (!key) return out(false, '키를 붙여 넣으세요.');
    if (isUrl(key)) return out(false, '이것은 주소입니다. 주소는 ‘직접 입력’이나 ‘Ollama’를 고른 뒤 주소 칸에 넣으세요.');
    if (/\s/.test(key)) return out(false, '키 안에 띄어쓰기가 있습니다. 키만 다시 복사해 붙여 넣으세요.');
    const kind = keyKind(key);
    const want = req.provider && PRESETS[req.provider] ? req.provider : null;
    const provider = kind ? kind.provider : want || 'other';
    const old = keys.find(x => x.key === key);
    if (old) {
      if (PRESETS[old.provider]) setKeyOf(old.provider, old.id);
      return out(true, `이미 저장된 키입니다(${old.name}).` + (PRESETS[old.provider] ? ' 이 키로 쓰게 했습니다.' : ''), PRESETS[old.provider] ? { provider: old.provider } : {});
    }
    const name = String(req.name || '').trim() || (kind ? kind.name : provName(provider) + ' 키');
    const k = { id: newId(), name, provider, key, at: today() };
    keys.push(k);
    if (!PRESETS[provider]) return out(true, kind && kind.why ? kind.why : '어디 키인지 몰라 보관만 합니다. 쓸 곳을 먼저 고른 뒤 다시 저장하세요.');
    setKeyOf(provider, k.id);
    const moved = want && want !== provider;
    return out(true, moved ? `${kind.name}로 보여 ‘${provName(provider)}’에 저장하고 그쪽으로 바꿨습니다.` : `저장했습니다: ‘${name}’. ‘연결 시험’을 눌러 보세요.`, { provider });
  }
  const k = keys.find(x => x.id === (req && req.id));
  if (!k) return out(false, '저장된 키를 찾지 못했습니다.');
  if (op === 'use') {
    if (!PRESETS[k.provider]) return out(false, (KINDS.find(x => x.provider === k.provider) || {}).why || '이 키는 AI 호출에 쓰지 않습니다.');
    setKeyOf(k.provider, k.id);
    return out(true, `이제 ${provName(k.provider)}에 ‘${k.name}’ 키를 씁니다.`, { provider: k.provider });
  }
  if (op === 'name') { k.name = String(req.name || '').trim() || k.name; return out(true, '이름을 바꿨습니다.'); }
  if (op === 'del') {
    keys.splice(keys.indexOf(k), 1);
    for (const p of Object.keys(profiles)) if (profiles[p].keyId === k.id) profiles[p].keyId = '';
    return out(true, `지웠습니다: ‘${k.name}’`);
  }
  return out(false, '알 수 없는 동작입니다.');
}

// ---------- 부르기 ----------
function pickJson(text) {
  const s = String(text || '').replace(/```(?:json)?/g, '');
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('AI 답에서 JSON을 찾지 못했습니다.');
  return JSON.parse(s.slice(a, b + 1));
}

async function openaiCall(r, { system, prompt, schema, timeoutMs = 120000 }) {
  const sys = system + (schema ? `\n\n반드시 다음 JSON 스키마에 맞는 JSON 객체 하나만 출력하라. 설명·코드블록 없이.\n${JSON.stringify(schema)}` : '');
  const body = { model: r.model, temperature: 0.1, messages: [{ role: 'system', content: sys }, { role: 'user', content: prompt }] };
  const headers = { 'Content-Type': 'application/json' };
  if (r.key) headers.Authorization = 'Bearer ' + r.key;
  if (r.provider === 'openrouter') { headers['HTTP-Referer'] = 'https://github.com/hannune'; headers['X-Title'] = 'Hannune'; }
  const go = async (withFormat) => {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(r.base + '/chat/completions', { method: 'POST', headers, body: JSON.stringify(withFormat ? { ...body, response_format: { type: 'json_object' } } : body), signal: ctl.signal });
      const raw = await res.text();
      let j = {};
      try { j = JSON.parse(raw); } catch (_) { /* 아래에서 처리 */ }
      if (Array.isArray(j)) j = j[0] || {}; // Gemini는 오류를 배열로 줄 때가 있다
      if (!res.ok) { const e = new Error(`${res.status} ${(j.error && (j.error.message || j.error)) || res.statusText}`); e.status = res.status; throw e; }
      if (!j.choices) { const e = new Error('AI 서버가 알 수 없는 답을 보냈습니다: ' + raw.slice(0, 80)); e.status = 502; throw e; }
      return j;
    } finally { clearTimeout(t); }
  };
  let j;
  try { j = await go(!!schema); }
  catch (e) { if (schema && (e.status === 400 || e.status === 422) && !/model/i.test(e.message)) j = await go(false); else throw e; } // json 모드를 모르는 모델
  const content = stripThink(j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content);
  return schema ? pickJson(content) : content;
}

// Ollama(내 PC)는 OpenAI 호환 주소 대신 자기 주소(/api/chat)로 부른다(v1.9):
//  - think:false — 생각하는 모델(Qwen3·Gemma4 등)이 그래픽 카드 없는 PC에서 생각만 몇 분씩 하지 않게
//  - format에 JSON 모양을 그대로 넘겨 모양에 맞는 답만 받는다
//  - 처음 불러오는 데 오래 걸려(CPU) 최소 5분 기다린다
async function ollamaCall(r, { system, prompt, schema, timeoutMs = 120000 }) {
  const base = r.base.replace(/\/v1\/?$/, '').replace('//localhost', '//127.0.0.1');
  const body = { model: r.model, stream: false, think: false, options: { temperature: 0.1 }, messages: [{ role: 'system', content: system + (schema ? `\n\n반드시 다음 JSON 스키마에 맞는 JSON 객체 하나만 출력하라.\n${JSON.stringify(schema)}` : '') }, { role: 'user', content: prompt }] };
  if (schema) body.format = schema;
  const go = async b => {
    const res = await fetch(base + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b), signal: AbortSignal.timeout(Math.max(timeoutMs, 300000)) });
    const raw = await res.text();
    let j = {};
    try { j = JSON.parse(raw); } catch (_) { /* 아래 */ }
    if (!res.ok) { const e = new Error(`${res.status} ${j.error || res.statusText}`); e.status = res.status; throw e; }
    return j;
  };
  let j;
  try { j = await go(body); }
  catch (e) {
    // 옛 Ollama·생각 기능 없는 모델: think 칸이나 format 모양을 모르면 빼고 다시
    if (e.status === 400 && /think|format|schema/i.test(e.message)) { const b = { ...body }; delete b.think; if (/format|schema/i.test(e.message)) b.format = schema ? 'json' : undefined; j = await go(b); }
    else throw e;
  }
  const content = stripThink((j.message && j.message.content) || '');
  return schema ? pickJson(content) : content;
}
const stripThink = t => String(t || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

// 모델이 없거나(404·모델 이름 오류) 붐비면(503) 다음 모델로
const retryable = e => e.status === 404 || e.status === 503 || (e.status === 400 && /model/i.test(e.message));
let lastUsed = null; // 마지막으로 답한 { provider, model, asked }

// 고른 에이전트로 부르기. 실패하면 알아보기 쉬운 말로 던진다.
async function callLLM(agent, args) {
  const r = resolve(agent);
  if (r.provider === 'none') throw new Error('AI 에이전트가 정해져 있지 않습니다. 설정 › AI 에이전트에서 고르세요.');
  if (r.provider === 'claude') { lastUsed = { provider: 'claude' }; return callClaude({ ...args, model: (agent && agent.claudeModel) || args.model || 'sonnet' }); }
  if ((PRESETS[r.provider] || {}).needKey && !r.key) throw new Error(`${provName(r.provider)} 키가 없습니다. 설정 › AI 에이전트에서 키를 저장하세요.`);
  const p = PRESETS[r.provider] || {};
  // 내 PC 모델(Ollama)은 고른 모델만 쓴다 — 없을 때 다른 모델로 말없이 바꿔 답하면 무엇이 답했는지 헷갈린다(v1.9)
  const tries = r.provider === 'ollama' ? [r.model] : [...new Set([r.model, p.model, ...(p.fallback || [])].filter(Boolean))];
  let e = null;
  for (const model of tries) {
    for (let again = 0; ; again++) {
      try { const out = await (r.provider === 'ollama' ? ollamaCall : openaiCall)({ ...r, model }, args); lastUsed = { provider: r.provider, model, asked: r.model }; return out; }
      catch (err) {
        e = err;
        // 무료 사용량의 분당 한도(429)는 잠깐 기다리면 풀린다 — 하루 한도는 기다려도 안 풀리므로 바로 알림
        if (err.status === 429 && again < 2 && !/per ?day|daily|PerDay/i.test(err.message)) {
          const s = Number((/retry in ([\d.]+)\s*s/i.exec(err.message) || [])[1]) || 15;
          await new Promise(res => setTimeout(res, Math.min(45, s + 1) * 1000));
          continue;
        }
        break;
      }
    }
    if (!retryable(e)) break;
  }
  if (e.name === 'AbortError' || e.name === 'TimeoutError') throw new Error(`AI 응답이 너무 오래 걸렸습니다(모델 ${r.model}). 더 빠른 모델을 고르거나 잠시 뒤 다시 해 보세요.`);
  if (/fetch failed|ECONNREFUSED|ENOTFOUND/.test(String(e.message) + String(e.cause))) throw new Error(r.provider === 'ollama' ? 'Ollama가 켜져 있지 않습니다. Ollama를 실행해 주세요.' : 'AI 서버에 연결하지 못했습니다(인터넷 확인).');
  if (/Failed to parse URL|Invalid URL/i.test(e.message)) throw new Error('AI 주소가 잘못됐습니다. 설정 › AI 에이전트 › 주소를 확인하세요.');
  if (e.status === 401 || e.status === 403) throw new Error(`${provName(r.provider)} 키가 맞지 않습니다. 키를 다시 복사해 저장하세요.`);
  if (e.status === 429) throw new Error(/per ?day|daily|PerDay/i.test(e.message) ? `${provName(r.provider)}의 오늘 무료 사용량을 다 썼습니다. 내일 다시 하거나 다른 곳(Claude Code 등)을 고르세요.` : '무료 사용량을 다 썼거나 너무 자주 불렀습니다. 잠시 뒤 다시 해 보세요.');
  if (r.provider === 'ollama' && (e.status === 404 || /not found/i.test(e.message))) throw new Error(`내 PC에 ${r.model} 모델이 없습니다. 설정 › 내 PC AI에서 받거나, 받아 둔 모델의 ‘쓰기’를 누르세요.`);
  if (e.status === 404 || (e.status === 400 && /model/i.test(e.message))) throw new Error(`쓸 수 없는 모델입니다: ${r.model}. 모델 칸을 비우거나 목록에서 고르세요.`);
  throw new Error('AI 오류: ' + String(e.message).slice(0, 200));
}

// 연결 시험: 모델 목록을 받아 보고, 짧은 질문 하나에 답하는지 본다
const NOT_CHAT = /tts|image|embedding|live|audio|transcribe|robotics|computer-use|aqa|lyria|veo|imagen|banana|research|antigravity|whisper|guard/i;
async function testAgent(agent) {
  const r = resolve(agent);
  if (r.provider === 'none') return { ok: false, msg: '에이전트를 고르세요.' };
  let models = [];
  if (r.provider !== 'claude' && (r.key || !(PRESETS[r.provider] || {}).needKey)) {
    try {
      const headers = r.key ? { Authorization: 'Bearer ' + r.key } : {};
      const res = await fetch(r.base + '/models', { headers, signal: AbortSignal.timeout(15000) });
      const j = await res.json().catch(() => ({}));
      models = (j.data || j.models || []).map(m => String(m.id || m.name || '').replace(/^models\//, '')).filter(m => m && !NOT_CHAT.test(m)).slice(0, 200);
    } catch (_) { /* 목록이 없는 곳도 있음 */ }
    const p = PRESETS[r.provider] || {};
    const good = [p.model, ...(p.fallback || [])].filter(m => models.includes(m)); // 잘 되는 것부터 보이게
    models = [...new Set([...good, ...models])];
  }
  const t0 = Date.now();
  lastUsed = null;
  const out = await callLLM(agent, { system: '너는 시험 응답기다.', prompt: '{"ok":true,"word":"안녕"} 과 같은 모양으로, word에 "준비됨"을 넣어 답하라.', schema: { type: 'object', properties: { ok: { type: 'boolean' }, word: { type: 'string' } }, required: ['ok', 'word'] }, timeoutMs: 60000 });
  const u = lastUsed || {};
  const swapped = u.model && u.asked && u.model !== u.asked ? ` · 모델 칸의 ‘${u.asked}’ 대신 ${u.model} 모델이 답함 — 모델 칸을 비우거나 목록에서 고르세요` : u.model ? ` · ${u.model}` : '';
  return { ok: true, msg: `연결됨 · ${((Date.now() - t0) / 1000).toFixed(1)}초${swapped} · 답: ${out.word || JSON.stringify(out).slice(0, 40)}`, models, used: u.model || null };
}

module.exports = { PRESETS, KIND_NAMES, resolve, ready, callLLM, testAgent, migrate, withMirror, keyOp, keyKind, isUrl, mask };
