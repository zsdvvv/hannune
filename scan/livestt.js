// Gemini 실시간 받아쓰기(gemini-3.5-transcribe-live). 말하는 동안 글자가 오고, 말이 끝나면 약 0.3초 뒤 최종 글자가 온다.
// 한 연결로 여러 번 말할 수 있어 미리 열어 두면 첫 글자까지 연결 시간(0.6초)이 없어진다. (2026-11 실측)
const MODEL = 'gemini-3.5-transcribe-live';
const URL_BASE = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=';

class LiveSTT {
  // on: { interim(글), final(글), complete(), closed(까닭), goaway() }
  constructor({ key, vocab = [], lang = 'ko-KR', on = {} }) {
    Object.assign(this, { key, vocab, lang, on });
    this.ws = null; this.ready = false; this.closedWhy = null;
  }
  connect(timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(URL_BASE + encodeURIComponent(this.key));
      ws.binaryType = 'arraybuffer';
      this.ws = ws;
      const timer = setTimeout(() => { reject(new Error('받아쓰기 서버 연결 시간 초과')); try { ws.close(); } catch (_) { /* 무시 */ } }, timeoutMs);
      ws.onopen = () => {
        ws.send(JSON.stringify({ setup: { model: 'models/' + MODEL, generationConfig: { responseModalities: ['TEXT'] },
          inputAudioTranscription: { languageCodes: [this.lang], ...(this.vocab.length ? { customVocabulary: this.vocab } : {}) } } }));
      };
      ws.onerror = () => { clearTimeout(timer); reject(new Error('받아쓰기 서버에 연결하지 못했습니다.')); };
      ws.onclose = e => {
        clearTimeout(timer);
        this.ready = false;
        this.closedWhy = `${e.code} ${e.reason || ''}`.trim();
        reject(new Error('받아쓰기 연결이 닫혔습니다: ' + this.closedWhy));
        this.on.closed && this.on.closed(this.closedWhy);
      };
      ws.onmessage = ev => {
        let j;
        try { j = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString('utf8')); } catch (_) { return; }
        if (j.setupComplete) { clearTimeout(timer); this.ready = true; resolve(); return; }
        if (j.goAway) { this.on.goaway && this.on.goaway(); return; }
        const sc = j.serverContent;
        if (!sc) return;
        if (sc.interimInputTranscription && sc.interimInputTranscription.text) this.on.interim && this.on.interim(sc.interimInputTranscription.text);
        if (sc.inputTranscription && sc.inputTranscription.text) this.on.final && this.on.final(sc.inputTranscription.text);
        if (sc.generationComplete) this.on.complete && this.on.complete();
      };
    });
  }
  audio(buf) {
    if (!this.ready || this.ws.readyState !== 1) return false;
    this.ws.send(JSON.stringify({ realtimeInput: { audio: { data: Buffer.from(buf).toString('base64'), mimeType: 'audio/pcm;rate=16000' } } }));
    return true;
  }
  endAudio() { if (this.ready && this.ws.readyState === 1) this.ws.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } })); }
  close() { this.on = {}; try { if (this.ws) this.ws.close(); } catch (_) { /* 무시 */ } this.ready = false; }
}

module.exports = { LiveSTT, MODEL };
