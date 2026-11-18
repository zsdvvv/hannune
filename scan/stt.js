// 받아쓰기 엔진 고르기와 '끝난 뒤 한 번에' 받아쓰기.
//  live   : Gemini 실시간(gemini-3.5-transcribe-live). 기본. 말하는 동안 글자가 오고 끝난 뒤 약 0.3초. 처리는 voicehub.js·livestt.js
//  gemini : Gemini 일반 모델에 소리 파일을 통째로 보냄. 느릴 때가 있어(2026-11 실측 1.5~20초) 실시간이 안 될 때·비교용
//  groq   : Groq Whisper(/audio/transcriptions). 키가 있을 때(실측 못 함)
//  clova  : 네이버 CLOVA Speech Recognition. 유료 키가 있을 때(실측 못 함)
//  local  : 내 PC의 whisper.cpp(소리가 밖으로 안 나감). 내려받아야 씀, 실시간 표시는 없음
//  custom : OpenAI 호환 /audio/transcriptions 주소
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const llm = require('./llm');

// v1.3의 기본은 flash-lite였다. 2026-11-05 실측에서 18~20초까지 걸리는 때가 있어 예비로만 둔다.
const GEMINI_MODELS = ['gemini-3.5-flash-lite', 'gemini-3.5-flash', 'gemini-3.6-flash'];
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const CLOVA_URL = 'https://naveropenapi.apigw.ntruss.com/recog/v1/stt';

function keyOf(settings, provider) { return llm.resolve({ ...(settings.agent || {}), provider }).key; }

function localPaths(settings, dataDir) {
  const v = settings.voice || {};
  const dir = path.join(dataDir, 'whisper');
  return { dir, exe: v.localExe || path.join(dir, 'whisper-cli.exe'), model: v.localModel || path.join(dir, 'ggml-small.bin') };
}
function localReady(settings, dataDir) { const p = localPaths(settings, dataDir); return fs.existsSync(p.exe) && fs.existsSync(p.model); }

// 어떤 엔진을 쓸지 정한다. { engine, key, model, ready, why, label }
function pick(settings, dataDir, want) {
  const v = settings.voice || {};
  const eng = want || v.engine || 'auto';
  const gem = keyOf(settings, 'gemini'), groq = keyOf(settings, 'groq');
  const mk = {
    live: () => (gem ? { engine: 'live', key: gem, model: 'gemini-3.5-transcribe-live', ready: true, label: 'Gemini 실시간' } : { engine: 'live', ready: false, why: 'Gemini 키가 없습니다(설정 › AI 에이전트에서 저장)' }),
    gemini: () => (gem ? { engine: 'gemini', key: gem, model: v.model || GEMINI_MODELS[0], ready: true, label: 'Gemini 일반' } : { engine: 'gemini', ready: false, why: 'Gemini 키가 없습니다(설정 › AI 에이전트에서 저장)' }),
    groq: () => (groq ? { engine: 'groq', key: groq, base: 'https://api.groq.com/openai/v1', model: 'whisper-large-v3-turbo', ready: true, label: 'Groq Whisper' } : { engine: 'groq', ready: false, why: 'Groq 키가 없습니다' }),
    clova: () => (v.clovaId && v.clovaSecret ? { engine: 'clova', id: v.clovaId, secret: v.clovaSecret, url: v.clovaUrl || CLOVA_URL, ready: true, label: '네이버 CLOVA' } : { engine: 'clova', ready: false, why: 'CLOVA 키(Client ID·Secret)가 없습니다' }),
    local: () => (localReady(settings, dataDir) ? { engine: 'local', ...localPaths(settings, dataDir), ready: true, label: '내 PC Whisper' } : { engine: 'local', ready: false, why: '내 PC Whisper를 아직 내려받지 않았습니다(설정 › 음성)' }),
    custom: () => { const r = llm.resolve({ ...(settings.agent || {}), provider: 'custom' }); return { engine: 'custom', key: r.key, base: r.base, model: v.model || 'whisper-1', ready: !!r.base, why: r.base ? '' : '직접 입력 주소가 없습니다', label: '직접 입력 주소' }; },
    none: () => ({ engine: 'none', ready: false, why: '음성 받아쓰기를 꺼 두었습니다. 입력 칸에서 Win+H(윈도우 받아쓰기)는 쓸 수 있습니다.' }),
  };
  if (eng !== 'auto' && mk[eng]) return mk[eng]();
  // 알아서: 실시간 → Groq → 내 PC
  for (const e of ['live', 'groq', 'local']) { const p = mk[e](); if (p.ready) return p; }
  return { engine: 'none', ready: false, why: 'Gemini·Groq 키가 없습니다. 설정 › AI 에이전트에서 무료 키를 저장하거나, 입력 칸에서 Win+H(윈도우 받아쓰기)를 쓰세요.' };
}

// PCM(16kHz 16bit 모노) → WAV 파일 바이트
function wavOf(pcm) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(16000, 24); h.writeUInt32LE(32000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}
// 앞뒤 무음을 잘라 낸다(빠르고, 무음에서 글자를 지어내는 일을 줄임). 말소리가 하나도 없으면 null
function trimPcm(pcm, margin = 0.2) {
  const frame = 640; // 20ms
  const n = Math.floor(pcm.length / frame);
  const rms = new Float64Array(n);
  let peak = 0;
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let o = i * frame; o < (i + 1) * frame; o += 2) { const v = pcm.readInt16LE(o) / 32768; sum += v * v; }
    rms[i] = Math.sqrt(sum / 320);
    if (rms[i] > peak) peak = rms[i];
  }
  if (peak < 0.012) return null;
  const thr = Math.max(0.008, peak * 0.05);
  let a = 0, b = n - 1;
  while (a < n && rms[a] < thr) a++;
  while (b > a && rms[b] < thr) b--;
  const m = Math.round(margin / 0.02);
  return pcm.subarray(Math.max(0, a - m) * frame, Math.min(n, b + m + 1) * frame);
}

function hintText(hint) {
  const h = hint || {};
  const words = ['내일', '모레', '다음 주', '오전', '오후', '시까지', '미뤄', '당겨', '별 하나~다섯', '중요', '완료', '회의', '제출', '보고서', ...(h.areas || []), ...(h.words || [])];
  const titles = (h.titles || []).slice(0, 30);
  return `오늘은 ${h.today || ''}. 말하는 사람은 자기 할 일·마감을 한국어로 말한다.\n자주 나오는 말: ${[...new Set(words)].join(', ')}.` + (titles.length ? `\n이 사람의 일 이름(들리면 이 표기대로): ${titles.join(' / ')}` : '');
}
const PROMPT = hint => `${hintText(hint)}\n\n이 음성을 한국어로 그대로 받아 적어라. 시각·날짜·개수는 아라비아 숫자로(오후 3시, 11월 5일, 별 4). 들리지 않거나 말이 없으면 빈 줄만. 설명·따옴표 없이 받아 적은 글만 한 줄로 출력하라.`;

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function gemini(p, wav, hint) {
  const models = [...new Set([p.model, ...GEMINI_MODELS])];
  let last = null;
  for (const model of models) {
    for (let again = 0; again < 2; again++) {
      const res = await fetch(`${GEMINI_BASE}/models/${model}:generateContent`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': p.key }, signal: AbortSignal.timeout(45000),
        // 글자 수 제한을 넉넉히: 200으로 두면 생각하는 모델(flash)이 "금요일까지"에서 잘렸다(2026-11-05 실측)
        body: JSON.stringify({ contents: [{ parts: [{ text: PROMPT(hint) }, { inline_data: { mime_type: 'audio/wav', data: wav.toString('base64') } }] }], generationConfig: { temperature: 0, maxOutputTokens: 2048 } }),
      });
      const raw = await res.text();
      let j = {}; try { j = JSON.parse(raw); } catch (_) { /* 아래 */ }
      if (Array.isArray(j)) j = j[0] || {};
      if (res.ok) {
        const c = ((j.candidates || [])[0] || {}).content;
        return { text: String((c && c.parts || []).map(x => x.text || '').join('')).trim(), model };
      }
      last = new Error(`${res.status} ${(j.error && j.error.message) || raw.slice(0, 120)}`); last.status = res.status;
      if (res.status === 429 && !/per ?day|daily/i.test(last.message)) { await sleep(Math.min(30, Number((/retry in ([\d.]+)/i.exec(last.message) || [])[1]) || 10) * 1000); continue; }
      break;
    }
    if (!(last.status === 404 || last.status === 503 || last.status === 400)) break;
  }
  throw last;
}

async function whisperApi(p, wav, hint) {
  const fd = new FormData();
  fd.append('file', new Blob([wav], { type: 'audio/wav' }), 'voice.wav');
  fd.append('model', p.model);
  fd.append('language', 'ko');
  fd.append('response_format', 'json');
  fd.append('temperature', '0');
  if (hint) fd.append('prompt', hintText(hint).slice(0, 800));
  const headers = p.key ? { Authorization: 'Bearer ' + p.key } : {};
  const res = await fetch(p.base.replace(/\/+$/, '') + '/audio/transcriptions', { method: 'POST', headers, body: fd, signal: AbortSignal.timeout(45000) });
  const raw = await res.text();
  let j = {}; try { j = JSON.parse(raw); } catch (_) { /* 아래 */ }
  if (!res.ok) { const e = new Error(`${res.status} ${(j.error && (j.error.message || j.error)) || raw.slice(0, 120)}`); e.status = res.status; throw e; }
  return { text: String(j.text || '').trim(), model: p.model };
}

async function clova(p, wav) {
  const url = p.url + (p.url.includes('?') ? '&' : '?') + 'lang=Kor';
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'x-ncp-apigw-api-key-id': p.id, 'x-ncp-apigw-api-key': p.secret }, body: wav, signal: AbortSignal.timeout(30000) });
  const raw = await res.text();
  let j = {}; try { j = JSON.parse(raw); } catch (_) { /* 아래 */ }
  if (!res.ok) { const e = new Error(`${res.status} ${j.errorMessage || j.error || raw.slice(0, 120)}`); e.status = res.status; throw e; }
  return { text: String(j.text || '').trim(), model: 'CSR' };
}

// 내 PC whisper.cpp: 임시 파일에 쓰고 돌린 뒤 지운다
function localWhisper(p, wav, hint) {
  return new Promise((resolve, reject) => {
    const f = path.join(os.tmpdir(), `hannune-${crypto.randomBytes(6).toString('hex')}.wav`);
    fs.writeFileSync(f, wav);
    const done = fn => { try { fs.unlinkSync(f); } catch (_) { /* 무시 */ } fn(); };
    const args = ['-m', p.model, '-l', 'ko', '-nt', '-np', '-t', String(Math.max(4, Math.min(8, os.cpus().length - 2))), '-f', f];
    if (hint && (hint.titles || []).length) args.push('--prompt', (hint.titles || []).slice(0, 12).join(', ').slice(0, 300));
    const c = spawn(p.exe, args, { windowsHide: true });
    let out = '', err = '';
    c.stdout.on('data', d => { out += d; });
    c.stderr.on('data', d => { err += d; });
    c.on('error', e => done(() => reject(e)));
    const timer = setTimeout(() => { try { c.kill(); } catch (_) { /* 무시 */ } }, 120000);
    c.on('close', code => { clearTimeout(timer); done(() => (code === 0 ? resolve({ text: out.replace(/\s+/g, ' ').trim(), model: path.basename(p.model) }) : reject(new Error('whisper 실패: ' + err.slice(-160))))); });
  });
}

function friendly(e, p) {
  if (e.name === 'TimeoutError' || e.name === 'AbortError') return new Error('받아쓰기 서버가 너무 오래 걸립니다. 다시 말해 보세요.');
  if (/fetch failed|ENOTFOUND|ECONNREFUSED/.test(String(e.message) + String(e.cause))) return new Error('받아쓰기 서버에 연결하지 못했습니다(인터넷 확인).');
  if (e.status === 401 || e.status === 403) return new Error(`${p.label || p.engine} 키가 맞지 않습니다.`);
  if (e.status === 429) return new Error('무료 사용량을 다 썼거나 너무 자주 불렀습니다. 잠시 뒤 다시 말해 보세요.');
  return new Error('받아쓰기 오류: ' + String(e.message).slice(0, 160));
}

// 끝난 뒤 한 번에 받아쓰기. pcm: Buffer. 돌려줌 { text, engine, model, ms }
async function batch(p, pcm, hint) {
  const t = trimPcm(pcm);
  if (!t) return { text: '', engine: p.engine, model: p.model || '', ms: 0, silent: true };
  const wav = wavOf(t);
  const t0 = Date.now();
  try {
    const r = p.engine === 'gemini' || p.engine === 'live' ? await gemini({ ...p, model: p.engine === 'live' ? GEMINI_MODELS[0] : p.model }, wav, hint)
      : p.engine === 'clova' ? await clova(p, wav)
        : p.engine === 'local' ? await localWhisper(p, wav, hint)
          : await whisperApi(p, wav, hint);
    return { text: r.text, engine: p.engine, model: r.model, ms: Date.now() - t0 };
  } catch (e) { throw friendly(e, p); }
}

// WAV 파일 바이트 → PCM(시험용)
function pcmFromWav(wav) {
  let o = 12;
  while (o + 8 < wav.length) { const id = wav.toString('ascii', o, o + 4), n = wav.readUInt32LE(o + 4); if (id === 'data') return wav.subarray(o + 8, o + 8 + n); o += 8 + n + (n % 2); }
  return wav.subarray(44);
}

module.exports = { pick, batch, wavOf, trimPcm, pcmFromWav, localPaths, localReady, hintText, GEMINI_MODELS, CLOVA_URL };
