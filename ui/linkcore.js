// 폰 ↔ PC 연결 공용 코드(폰 앱·PC 본체가 같이 씀).
//  - 비밀 열쇠(32바이트)는 QR로 폰에 건넨다. 여기서 방 번호와 암호 열쇠를 만든다.
//  - 중계 서버는 암호문을 옮기기만 한다: 내용을 볼 수 없고 저장도 하지 않는다.
//  - 틀 하나: [1, 방향, iv 12바이트, 암호문]. 방향을 인증값에 넣어 되돌려 보내기를 막는다.
(function (root, factory) {
  const m = factory();
  if (typeof module === 'object' && module.exports) module.exports = m; else root.LinkCore = m;
})(typeof self !== 'undefined' ? self : this, function () {
  const C = (typeof crypto !== 'undefined' && crypto.subtle) ? crypto : require('crypto').webcrypto;
  const enc = new TextEncoder(), dec = new TextDecoder();
  const VERSION = 1;
  const DIR = { PHONE_TO_PC: 1, PC_TO_PHONE: 2 };
  const KIND = { JSON: 0, AUDIO: 1, GZIP_JSON: 2 };

  const b64u = bytes => {
    let s = ''; for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  const unb64u = str => {
    const s = atob(String(str).replace(/-/g, '+').replace(/_/g, '/'));
    const o = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) o[i] = s.charCodeAt(i);
    return o;
  };
  const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  function newSecret() { return b64u(C.getRandomValues(new Uint8Array(32))); }
  function newId() { return Date.now().toString(36) + hex(C.getRandomValues(new Uint8Array(4))); }

  // 비밀 열쇠 → { room(방 번호), key(암호 열쇠) }
  async function derive(secret) {
    const ikm = await C.subtle.importKey('raw', unb64u(secret), 'HKDF', false, ['deriveBits', 'deriveKey']);
    const salt = enc.encode('hannune-link-v1');
    const bits = await C.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode('room') }, ikm, 160);
    const key = await C.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode('aes') }, ikm, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    return { room: hex(new Uint8Array(bits)), key };
  }
  async function seal(key, dir, kind, payload) {
    const iv = C.getRandomValues(new Uint8Array(12));
    const plain = new Uint8Array(payload.length + 1);
    plain[0] = kind; plain.set(payload, 1);
    const ct = new Uint8Array(await C.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new Uint8Array([VERSION, dir]) }, key, plain));
    const out = new Uint8Array(14 + ct.length);
    out[0] = VERSION; out[1] = dir; out.set(iv, 2); out.set(ct, 14);
    return out;
  }
  // 틀이 맞지 않거나 위조됐으면 null
  async function open(key, frame, wantDir) {
    const b = frame instanceof Uint8Array ? frame : new Uint8Array(frame);
    if (b.length < 15 || b[0] !== VERSION || b[1] !== wantDir) return null;
    try {
      const p = new Uint8Array(await C.subtle.decrypt({ name: 'AES-GCM', iv: b.subarray(2, 14), additionalData: new Uint8Array([VERSION, wantDir]) }, key, b.subarray(14)));
      return { kind: p[0], payload: p.subarray(1) };
    } catch (_) { return null; }
  }
  // 소리 한 조각: [id 길이 1][id][순번 4][PCM]
  function packAudio(id, seq, pcm) {
    const idb = enc.encode(id);
    const out = new Uint8Array(1 + idb.length + 4 + pcm.length);
    out[0] = idb.length; out.set(idb, 1);
    new DataView(out.buffer).setUint32(1 + idb.length, seq, true);
    out.set(pcm, 5 + idb.length);
    return out;
  }
  function unpackAudio(b) {
    const n = b[0];
    const id = dec.decode(b.subarray(1, 1 + n));
    const seq = new DataView(b.buffer, b.byteOffset).getUint32(1 + n, true);
    return { id, seq, pcm: b.subarray(5 + n) };
  }

  // 끊기면 다시 잇는 연결. opts: { relay, secret, role:'pc'|'phone', onState, onPresence, onJson, onAudio, onBlob, pingMs }
  class Link {
    constructor(opts) {
      this.o = { pingMs: 25000, ...opts };
      this.ws = null; this.keys = null; this.stopped = true;
      this.state = 'off'; this.peers = { pc: 0, phone: 0 };
      this.sendChain = Promise.resolve(); this.recvChain = Promise.resolve();
      this.retry = 0; this.rtt = null; this.bytesOut = 0;
      this.myDir = this.o.role === 'pc' ? DIR.PC_TO_PHONE : DIR.PHONE_TO_PC;
      this.peerDir = this.o.role === 'pc' ? DIR.PHONE_TO_PC : DIR.PC_TO_PHONE;
      this.peer = this.o.role === 'pc' ? 'phone' : 'pc';
    }
    get connected() { return this.state === 'on'; }
    get peerOnline() { return this.connected && this.peers[this.peer] > 0; }
    async start() {
      this.stopped = false;
      this.keys = await derive(this.o.secret);
      this._connect();
    }
    stop() { this.stopped = true; clearTimeout(this.retryTimer); clearInterval(this.pingTimer); this._setState('off'); if (this.ws) { try { this.ws.close(); } catch (_) { /* 무시 */ } this.ws = null; } }
    _setState(s) { if (this.state !== s) { this.state = s; this.o.onState && this.o.onState(s); } }
    _connect() {
      if (this.stopped) return;
      this._setState('connecting');
      const base = this.o.relay.replace(/^http/, 'ws').replace(/\/+$/, '');
      let ws;
      try { ws = new WebSocket(`${base}/ws/${this.keys.room}?role=${this.o.role}`); } catch (e) { this._later(); return; }
      ws.binaryType = 'arraybuffer';
      this.ws = ws;
      ws.onopen = () => { this.retry = 0; this._setState('on'); this._ping(); clearInterval(this.pingTimer); this.pingTimer = setInterval(() => this._ping(), this.o.pingMs); };
      ws.onclose = () => { if (this.ws === ws) { this.ws = null; clearInterval(this.pingTimer); this.peers = { pc: 0, phone: 0 }; this.o.onPresence && this.o.onPresence(this.peers); this._setState('connecting'); this._later(); } };
      ws.onerror = () => { /* onclose가 이어서 옴 */ };
      ws.onmessage = ev => {
        if (typeof ev.data === 'string') {
          if (ev.data === 'pong') { this.pongAt = Date.now(); if (this.pingAt) this.rtt = this.pongAt - this.pingAt; this.o.onRtt && this.o.onRtt(this.rtt); return; }
          try { const j = JSON.parse(ev.data); if (j.t === 'presence') { this.peers = { pc: j.pc, phone: j.phone }; this.o.onPresence && this.o.onPresence(this.peers); } } catch (_) { /* 무시 */ }
          return;
        }
        const frame = new Uint8Array(ev.data);
        this.recvChain = this.recvChain.then(() => this._recv(frame)).catch(() => { /* 한 틀 실패는 넘어감 */ });
      };
    }
    _later() {
      if (this.stopped) return;
      clearTimeout(this.retryTimer);
      const ms = Math.min(15000, 400 * Math.pow(1.8, this.retry++));
      this.retryTimer = setTimeout(() => this._connect(), ms);
    }
    _ping() {
      const ws = this.ws;
      if (!ws || ws.readyState !== 1) return;
      // 응답이 없으면 죽은 연결로 보고 다시 잇는다(지하철·망 바뀜)
      if (this.pingAt && this.pongAt < this.pingAt && Date.now() - this.pingAt > 8000) { try { ws.close(); } catch (_) { /* 무시 */ } return; }
      this.pingAt = Date.now();
      try { ws.send('ping'); } catch (_) { /* onclose가 처리 */ }
    }
    pingNow() { this.pingAt = 0; this._ping(); }
    reconnectNow() { if (this.stopped) return; if (this.ws && this.ws.readyState === 1) { this.pingNow(); return; } clearTimeout(this.retryTimer); this.retry = 0; this._connect(); }
    async _recv(frame) {
      const m = await open(this.keys.key, frame, this.peerDir);
      if (!m) { this.o.onBadFrame && this.o.onBadFrame(); return; }
      if (m.kind === KIND.AUDIO) { this.o.onAudio && this.o.onAudio(unpackAudio(m.payload)); return; }
      if (m.kind === KIND.GZIP_JSON) { this.o.onGzip && this.o.onGzip(m.payload); return; }
      let j; try { j = JSON.parse(dec.decode(m.payload)); } catch (_) { return; }
      this.o.onJson && this.o.onJson(j);
    }
    // 보내는 순서를 지킨다(암호화가 비동기라 줄을 세움). 연결이 없으면 false
    _send(kind, payload) {
      if (!this.ws || this.ws.readyState !== 1) return false;
      const ws = this.ws;
      this.sendChain = this.sendChain.then(async () => {
        const f = await seal(this.keys.key, this.myDir, kind, payload);
        if (ws.readyState === 1) { ws.send(f); this.bytesOut += f.length; }
      }).catch(() => { /* onclose가 처리 */ });
      return true;
    }
    sendJson(o) { return this._send(KIND.JSON, enc.encode(JSON.stringify(o))); }
    sendGzip(bytes) { return this._send(KIND.GZIP_JSON, bytes); }
    sendAudio(id, seq, pcm) { return this._send(KIND.AUDIO, packAudio(id, seq, pcm)); }
  }

  return { newSecret, newId, derive, seal, open, packAudio, unpackAudio, Link, DIR, KIND, b64u, unb64u };
});
