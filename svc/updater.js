// 새 판 받기(업데이트). 설치본(윈도우·맥)에서만 돈다. 개발본은 버전_선택.bat로 판을 고르므로 끈다.
//
// 어디서 새 판을 받는지는 판 종류(앱 폴더의 edition.json)가 정한다.
//   free(지금): GitHub 공개 Releases — 누구나 받는다.
//   paid(나중): edition.update.url 의 업데이트 서버에 라이선스 열쇠를 실어 묻는다.
//               서버가 열쇠를 확인해 유료 사용자에게만 새 판 정보(latest.yml·latest.json)를 준다.
//               → 앱 코드는 그대로 두고 edition.json 과 서버만 바꾸면 된다.
//
// 윈도우: electron-updater(NSIS 설치본) — 받기 → 내용 확인(sha512) → 끝낼 때 또는 '설치하고 다시 켜기'로 설치.
// 맥: 유료 개발자 서명이 없으면 애플 규칙상 저절로 바꿔 끼울 수 없다 → 새 판 dmg를 내려받아 열어 준다(Applications로 끌어 놓기만).
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const GH = { owner: 'zsdvvv', repo: 'hannune' };
const DAY = 864e5;

// '1.11.0' 과 'v1.11.2' 같은 판 번호 비교(앞이 크면 1)
function cmpVer(a, b) {
  const p = v => String(v || '').replace(/^v/i, '').split(/[.+-]/).slice(0, 3).map(x => parseInt(x, 10) || 0);
  const x = p(a), y = p(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i] ? 1 : -1;
  return 0;
}
// 맥 dmg 고르기: 이 맥의 칩(arm64·x64)에 맞는 것
function pickMacAsset(assets, arch) {
  const want = arch === 'arm64' ? /-mac-arm64\.dmg$/i : /-mac-x64\.dmg$/i;
  return (assets || []).find(a => want.test(a.name)) || null;
}

class Updater {
  // deps: { app, net, shell, version, edition, settings(), save(patch), emit(state), isPackaged, platform, arch, downloads }
  constructor(deps) {
    this.d = deps;
    this.st = { status: 'idle', current: deps.version, latest: '', notes: '', progress: 0, error: '', lastCheck: 0, file: '', page: '' };
    this.au = null;
    this.mode = this._mode();
    this.timer = null;
  }
  _mode() {
    const d = this.d;
    if (process.env.HANNUNE_UPDATE_FORCE) return d.platform === 'darwin' ? 'manual' : 'auto';
    if (!d.isPackaged) return 'dev';
    if (d.edition && d.edition.update === false) return 'off';
    if (d.platform === 'win32') return 'auto';
    if (d.platform === 'darwin') return 'manual';
    return 'page'; // 리눅스 등: 내려받는 곳만 알려 준다
  }
  // 유료 판이면 라이선스가 있어야 새 판을 받는다(지금 무료 판은 늘 받음)
  _allowed() {
    const e = this.d.edition || {};
    if (!e.paidUpdates) return { ok: true };
    const key = ((this.d.settings().license || {}).key || '').trim();
    return key ? { ok: true, key } : { ok: false, why: '새 판은 유료 사용자에게만 드립니다. 설정 › 새 판 받기에 라이선스 열쇠를 넣어 주세요.' };
  }
  _feed() {
    const e = this.d.edition || {};
    const url = process.env.HANNUNE_UPDATE_URL || (e.update && e.update.url) || '';
    return url ? { kind: 'generic', url: url.replace(/\/+$/, '') } : { kind: 'github', ...GH };
  }
  state() {
    const s = this.d.settings().update || {};
    return { ...this.st, mode: this.mode, edition: (this.d.edition || {}).name || 'free', auto: s.auto !== false, autoDownload: s.autoDownload !== false, skip: s.skip || '' };
  }
  _set(p) { Object.assign(this.st, p); this.d.emit(this.state()); }

  start() {
    if (this.mode === 'dev' || this.mode === 'off') return;
    if (this.mode === 'auto') this._initAuto();
    // 켤 때 30초 뒤 한 번, 그 뒤 6시간마다. '자동으로 확인'을 끄면 그때그때 건너뛴다(설정을 바꿔도 다시 켤 필요 없음)
    const first = setTimeout(() => { const u = this.d.settings().update || {}; if (u.auto !== false) this.check(false).catch(() => {}); }, Number(process.env.HANNUNE_UPDATE_DELAY || 30000));
    if (first.unref) first.unref();
    this.timer = setInterval(() => { const u = this.d.settings().update || {}; if (u.auto !== false) this.check(false).catch(() => {}); }, 6 * 3600 * 1000);
    if (this.timer.unref) this.timer.unref();
  }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }

  _initAuto() {
    if (this.au) return true;
    try { this.au = require('electron-updater').autoUpdater; } catch (_) { this.mode = 'page'; return false; }
    const au = this.au, f = this._feed(), lic = this._allowed();
    au.autoDownload = false;          // 받을지는 아래에서 설정을 보고 정한다
    au.autoInstallOnAppQuit = true;   // 받아 둔 새 판은 앱을 끝낼 때 설치된다
    au.allowDowngrade = false;
    au.logger = null;
    if (f.kind === 'generic') au.setFeedURL({ provider: 'generic', url: f.url, ...(lic.key ? { requestHeaders: { Authorization: 'License ' + lic.key } } : {}) });
    if (process.env.HANNUNE_UPDATE_FORCE) au.forceDevUpdateConfig = true;
    au.on('checking-for-update', () => this._set({ status: 'checking', error: '' }));
    au.on('update-not-available', () => this._set({ status: 'none', lastCheck: Date.now() }));
    au.on('update-available', info => {
      this._set({ status: 'available', latest: info.version, notes: String(info.releaseNotes || '').replace(/<[^>]+>/g, '').slice(0, 2000), lastCheck: Date.now() });
      const s = this.d.settings().update || {};
      if (s.skip === info.version) return;
      if (s.autoDownload !== false) this.download().catch(() => {});
    });
    au.on('download-progress', p => this._set({ status: 'downloading', progress: Math.round(p.percent || 0) }));
    au.on('update-downloaded', info => this._set({ status: 'ready', latest: info.version, progress: 100 }));
    au.on('error', e => this._set({ status: 'error', error: this._why(e) }));
    return true;
  }
  _why(e) {
    const m = String((e && e.message) || e || '');
    if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|net::ERR_/i.test(m)) return '업데이트 서버에 연결하지 못했습니다(인터넷 확인).';
    if (/404|latest\.yml/i.test(m)) return '새 판 정보를 찾지 못했습니다(아직 올리는 중일 수 있습니다).';
    if (/401|403/.test(m)) return '업데이트 서버가 받기를 거절했습니다(라이선스를 확인해 주세요).';
    if (/sha512|checksum/i.test(m)) return '받은 파일이 올라온 파일과 달라 설치하지 않았습니다. 다시 받아 주세요.';
    return '업데이트 오류: ' + m.slice(0, 160);
  }

  async _getJson(url, headers) {
    const res = await this.d.net.fetch(url, { headers: { accept: 'application/vnd.github+json', ...(headers || {}) } });
    if (!res.ok) throw new Error(String(res.status));
    return res.json();
  }
  // 새 판이 있는지 본다. manual = 사용자가 눌렀음(건너뛰기로 한 판도 다시 알림)
  async check(manual) {
    if (this.mode === 'dev') return this._set({ status: 'idle', error: '개발본은 버전_선택.bat로 판을 고릅니다.' }), this.state();
    if (this.mode === 'off') return this.state();
    const lic = this._allowed();
    if (!lic.ok) { this._set({ status: 'error', error: lic.why }); return this.state(); }
    if (this.st.status === 'downloading') return this.state();
    if (this.mode === 'auto') {
      if (!this._initAuto()) return this.check(manual);
      try {
        if (manual) { const s = this.d.settings().update || {}; if (s.skip) this.d.save({ update: { skip: '' } }); }
        this._set({ status: 'checking', error: '' });
        const r = await this.au.checkForUpdates();
        if (!r || !r.updateInfo || cmpVer(r.updateInfo.version, this.d.version) <= 0) this._set({ status: 'none', lastCheck: Date.now() });
      } catch (e) { this._set({ status: 'error', error: this._why(e), lastCheck: Date.now() }); }
      return this.state();
    }
    // 맥·그 밖: 새 판 정보를 직접 읽는다
    this._set({ status: 'checking', error: '' });
    try {
      const f = this._feed();
      let rel;
      if (f.kind === 'github') {
        const j = await this._getJson(`https://api.github.com/repos/${f.owner}/${f.repo}/releases/latest`);
        rel = { version: String(j.tag_name || '').replace(/^v/, ''), notes: String(j.body || ''), page: j.html_url, assets: (j.assets || []).map(a => ({ name: a.name, url: a.browser_download_url, size: a.size, sha256: /^sha256:/.test(a.digest || '') ? a.digest.slice(7) : '' })) };
      } else {
        const j = await this._getJson(`${f.url}/latest.json`, lic.key ? { Authorization: 'License ' + lic.key } : {});
        rel = { version: String(j.version || ''), notes: String(j.notes || ''), page: j.page || '', assets: j.assets || [] };
      }
      const s = this.d.settings().update || {};
      if (cmpVer(rel.version, this.d.version) <= 0) { this._set({ status: 'none', latest: rel.version, lastCheck: Date.now(), page: rel.page }); return this.state(); }
      this.rel = rel;
      this._set({ status: 'available', latest: rel.version, notes: rel.notes.slice(0, 2000), lastCheck: Date.now(), page: rel.page, progress: 0, file: '' });
      if (!manual && s.skip === rel.version) return this.state();
    } catch (e) { this._set({ status: 'error', error: this._why(e), lastCheck: Date.now() }); }
    return this.state();
  }
  // 받기. 윈도우는 electron-updater가, 맥은 dmg를 '다운로드' 폴더로 받는다.
  async download() {
    if (this.mode === 'auto') {
      if (!this.au || this.st.status === 'downloading' || this.st.status === 'ready') return this.state();
      this._set({ status: 'downloading', progress: 0 });
      try { await this.au.downloadUpdate(); } catch (e) { this._set({ status: 'error', error: this._why(e) }); }
      return this.state();
    }
    if (this.mode !== 'manual' || !this.rel) return this.state();
    const a = pickMacAsset(this.rel.assets, this.d.arch);
    if (!a) { this._set({ status: 'error', error: '이 맥에 맞는 설치 파일이 없습니다. 내려받는 곳에서 직접 받아 주세요.' }); return this.state(); }
    const lic = this._allowed();
    const dst = path.join(this.d.downloads(), a.name.replace(/[\\/:*?"<>|]/g, '_'));
    const tmp = dst + '.part';
    this._set({ status: 'downloading', progress: 0, error: '' });
    try {
      const res = await this.d.net.fetch(a.url, { headers: lic.key ? { Authorization: 'License ' + lic.key } : {} });
      if (!res.ok || !res.body) throw new Error(String(res.status));
      const total = Number(res.headers.get('content-length')) || a.size || 0;
      const out = fs.createWriteStream(tmp), hash = crypto.createHash('sha256');
      let got = 0, last = 0;
      for await (const chunk of res.body) {
        const buf = Buffer.from(chunk);
        hash.update(buf); got += buf.length;
        if (!out.write(buf)) await new Promise(r => out.once('drain', r));
        if (total && Date.now() - last > 300) { last = Date.now(); this._set({ status: 'downloading', progress: Math.min(99, Math.round(got * 100 / total)) }); }
      }
      await new Promise((ok, no) => out.end(e => (e ? no(e) : ok())));
      if (a.size && got !== a.size) throw new Error('size');
      if (a.sha256 && hash.digest('hex') !== a.sha256.toLowerCase()) throw new Error('sha256');
      fs.renameSync(tmp, dst);
      this._set({ status: 'ready', progress: 100, file: dst });
    } catch (e) {
      try { fs.unlinkSync(tmp); } catch (_) { /* 없음 */ }
      this._set({ status: 'error', error: /size|sha256/.test(String(e.message)) ? '받은 파일이 올라온 파일과 달라 지웠습니다. 다시 받아 주세요.' : this._why(e) });
    }
    return this.state();
  }
  // 설치. 윈도우는 끝내고 설치한 뒤 다시 켠다. 맥은 받은 dmg를 연다.
  install() {
    if (this.mode === 'auto' && this.au && this.st.status === 'ready') {
      this.d.app.isQuitting = true;
      setImmediate(() => this.au.quitAndInstall(true, true));
      return { ok: true, restarting: true };
    }
    if (this.mode === 'manual' && this.st.file && fs.existsSync(this.st.file)) { this.d.shell.openPath(this.st.file); return { ok: true, opened: this.st.file }; }
    return { ok: false };
  }
  skip() { if (this.st.latest) this.d.save({ update: { skip: this.st.latest } }); this._set({}); return this.state(); }
  page() { const u = this.st.page || `https://github.com/${GH.owner}/${GH.repo}/releases/latest`; this.d.shell.openExternal(u); return u; }
}

module.exports = { Updater, cmpVer, pickMacAsset };
