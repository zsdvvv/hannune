// AI 에이전트 연결: 사용자가 고른 곳으로 보내고 JSON으로 받는다.
//  - claude : 이 PC의 Claude Code(claude -p). 구독으로 돌아 키가 필요 없다.
//  - gemini / groq / openrouter : 무료 키로 쓰는 OpenAI 호환 API
//  - ollama : 내 PC에서 돌리는 무료 모델(인터넷·키 없음)
//  - custom : OpenAI 호환 주소를 직접 넣기(LM Studio 등)
const { callClaude, claudeAvailable } = require('./claude');

const PRESETS = {
  gemini: { name: 'Google Gemini (무료 키)', base: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.5-flash', keyUrl: 'https://aistudio.google.com/apikey', needKey: true,
    help: 'Google 계정으로 AI Studio에 들어가 "API 키 만들기" → 복사해 붙여넣기. 무료 사용량 안에서 카드 등록 없이 쓸 수 있습니다.' },
  groq: { name: 'Groq (무료 키, 빠름)', base: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile', keyUrl: 'https://console.groq.com/keys', needKey: true,
    help: 'Groq에 가입 → API Keys → Create API Key → 붙여넣기. 무료 사용량이 넉넉하고 매우 빠릅니다.' },
  openrouter: { name: 'OpenRouter (무료 모델)', base: 'https://openrouter.ai/api/v1', model: 'meta-llama/llama-3.3-70b-instruct:free', keyUrl: 'https://openrouter.ai/keys', needKey: true,
    help: 'OpenRouter 가입 → Keys → Create Key. 모델 이름이 ":free"로 끝나는 것은 무료입니다.' },
  ollama: { name: 'Ollama (내 PC, 완전 무료)', base: 'http://localhost:11434/v1', model: 'qwen2.5:7b', keyUrl: 'https://ollama.com/download', needKey: false,
    help: 'Ollama를 설치하고 명령창에서 "ollama pull qwen2.5:7b" 한 번. 인터넷 없이 이 PC에서 돕니다(메모리 8GB 이상 권장).' },
  custom: { name: '직접 입력 (OpenAI 호환)', base: 'http://localhost:1234/v1', model: '', keyUrl: '', needKey: false, help: 'LM Studio 등 OpenAI 호환 주소를 넣습니다.' },
};

function resolve(agent) {
  const a = agent || {};
  let provider = a.provider || 'auto';
  if (provider === 'auto') provider = claudeAvailable() ? 'claude' : 'none';
  if (provider === 'claude' || provider === 'none') return { provider };
  const p = PRESETS[provider] || PRESETS.custom;
  return { provider, base: (a.base || p.base).replace(/\/+$/, ''), model: a.model || p.model, key: a.key || '' };
}

function ready(agent) {
  const r = resolve(agent);
  if (r.provider === 'none') return false;
  if (r.provider === 'claude') return claudeAvailable();
  return !!r.model && (!(PRESETS[r.provider] || {}).needKey || !!r.key);
}

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
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { const e = new Error(`${res.status} ${(j.error && (j.error.message || j.error)) || res.statusText}`); e.status = res.status; throw e; }
      return j;
    } finally { clearTimeout(t); }
  };
  let j;
  try { j = await go(!!schema); }
  catch (e) { if (schema && (e.status === 400 || e.status === 422)) j = await go(false); else throw e; } // json 모드를 모르는 모델
  const content = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
  return schema ? pickJson(content) : content;
}

// 고른 에이전트로 부르기. 실패하면 알아보기 쉬운 말로 던진다.
async function callLLM(agent, args) {
  const r = resolve(agent);
  if (r.provider === 'none') throw new Error('AI 에이전트가 정해져 있지 않습니다. 설정 › AI 에이전트에서 고르세요.');
  if (r.provider === 'claude') return callClaude({ ...args, model: (agent && agent.claudeModel) || args.model || 'sonnet' });
  try { return await openaiCall(r, args); }
  catch (e) {
    if (e.name === 'AbortError') throw new Error('AI 응답이 너무 오래 걸렸습니다.');
    if (/fetch failed|ECONNREFUSED/.test(String(e.message) + String(e.cause))) throw new Error(r.provider === 'ollama' ? 'Ollama가 켜져 있지 않습니다. Ollama를 실행해 주세요.' : 'AI 서버에 연결하지 못했습니다(인터넷 확인).');
    if (e.status === 401 || e.status === 403) throw new Error('API 키가 맞지 않습니다.');
    if (e.status === 429) throw new Error('무료 사용량을 다 썼거나 너무 자주 불렀습니다. 잠시 뒤 다시 해 보세요.');
    throw new Error('AI 오류: ' + String(e.message).slice(0, 200));
  }
}

// 연결 시험: 모델 목록을 받아 보고, 짧은 질문 하나에 답하는지 본다
async function testAgent(agent) {
  const r = resolve(agent);
  if (r.provider === 'none') return { ok: false, msg: '에이전트를 고르세요.' };
  let models = [];
  if (r.provider !== 'claude') {
    try {
      const headers = r.key ? { Authorization: 'Bearer ' + r.key } : {};
      const res = await fetch(r.base + '/models', { headers });
      const j = await res.json().catch(() => ({}));
      models = (j.data || j.models || []).map(m => String(m.id || m.name || '').replace(/^models\//, '')).filter(Boolean).slice(0, 200);
    } catch (_) { /* 목록이 없는 곳도 있음 */ }
  }
  const t0 = Date.now();
  const out = await callLLM(agent, { system: '너는 시험 응답기다.', prompt: '{"ok":true,"word":"안녕"} 과 같은 모양으로, word에 "준비됨"을 넣어 답하라.', schema: { type: 'object', properties: { ok: { type: 'boolean' }, word: { type: 'string' } }, required: ['ok', 'word'] }, timeoutMs: 60000 });
  return { ok: true, msg: `연결됨 · ${((Date.now() - t0) / 1000).toFixed(1)}초 · 답: ${out.word || JSON.stringify(out).slice(0, 40)}`, models };
}

module.exports = { PRESETS, resolve, ready, callLLM, testAgent };
