// 읽어 주기(윈도우·맥에 들어 있는 한국어 음성)와 마이크 그림·소리 막대. 소리 수집은 voicecore.js, 받아쓰기는 본체가 한다.
const MIC_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect class="cap" x="9" y="2.6" width="6" height="11.4" rx="3"/><path d="M5.2 11.2a6.8 6.8 0 0 0 13.6 0"/><path d="M12 18v3.2M8.8 21.2h6.4"/></svg><span class="ring"></span>';
const Voice = (() => {
  function voices() {
    const all = window.speechSynthesis ? speechSynthesis.getVoices() : [];
    return all.filter(v => /^ko/i.test(v.lang)).concat(all.filter(v => !/^ko/i.test(v.lang)));
  }
  function say(text, opts = {}) {
    return new Promise(res => {
      if (!window.speechSynthesis || !text) return res(false);
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(String(text));
      const vs = voices();
      const v = (opts.voiceName && vs.find(x => x.name === opts.voiceName)) || vs.find(x => /^ko/i.test(x.lang));
      if (v) u.voice = v;
      u.lang = 'ko-KR'; u.rate = opts.rate || 1; u.pitch = 1;
      u.onend = () => res(true); u.onerror = () => res(false);
      speechSynthesis.speak(u);
    });
  }
  function hush() { if (window.speechSynthesis) speechSynthesis.cancel(); }
  if (window.speechSynthesis) speechSynthesis.getVoices(); // 목록을 미리 불러 둠

  // 흘러가는 소리 막대: 들어온 크기를 오른쪽에 쌓는다
  function bars(canvas) {
    const g = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height, step = 8, n = Math.floor(W / step);
    const vals = new Array(n).fill(0);
    return {
      push(lv) {
        vals.push(lv); vals.shift();
        g.clearRect(0, 0, W, H);
        g.fillStyle = getComputedStyle(canvas).getPropertyValue('--red') || '#C23B22';
        vals.forEach((v, i) => { const h = Math.max(3, v * H); const x = i * step + 1; const y = (H - h) / 2; g.beginPath(); g.roundRect(x, y, 4, h, 2); g.fill(); });
      },
    };
  }
  return { say, hush, voices, bars };
})();
