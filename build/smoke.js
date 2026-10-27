// 실행 시험: 만든 설치본 앱을 실제로 켜서(시험 모드) 창이 뜨고 화면이 그려지는지 본다.
// 꺼지면 종료 코드·신호와 맥 충돌 기록(.ips)을 smoke-out/ 에 모은다.
// 사용: node build/smoke.js   (먼저 electron-builder --dir 로 앱을 만들어 둘 것)
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const out = path.resolve('smoke-out');
fs.mkdirSync(out, { recursive: true });

function findExe() {
  if (process.platform === 'darwin') {
    for (const d of ['dist/mac-arm64', 'dist/mac', 'dist/mac-universal']) {
      if (!fs.existsSync(d)) continue;
      const app = fs.readdirSync(d).find(n => n.endsWith('.app'));
      if (!app) continue;
      const macos = path.join(d, app, 'Contents', 'MacOS');
      return path.join(macos, fs.readdirSync(macos)[0]);
    }
  }
  if (process.platform === 'win32') {
    const d = 'dist/win-unpacked';
    const exe = fs.readdirSync(d).find(n => n.toLowerCase().endsWith('.exe') && !/uninstall/i.test(n));
    return path.resolve(d, exe);
  }
  if (process.platform === 'linux') {
    const d = 'dist/linux-unpacked';
    const exe = fs.readdirSync(d).find(n => /^hannune$/i.test(n));
    return path.resolve(d, exe);
  }
  throw new Error('앱을 찾지 못함');
}

// 예시 할 일 몇 개(시험 데이터)
const data = path.join(os.tmpdir(), 'hn-smoke');
fs.rmSync(data, { recursive: true, force: true });
fs.mkdirSync(data, { recursive: true });
const t = new Date();
const d = n => { const x = new Date(t.getFullYear(), t.getMonth(), t.getDate() + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
const user = { items: {}, manual: [], sessions: {} };
[['보고서 제출', '업무', 1], ['팀 회의', '업무', 2], ['논문 초록', '연구', 4], ['여행 예약', '개인', null]].forEach(([title, area, off], i) => {
  const id = 'u:s' + i;
  user.manual.push({ id, title, area, note: '', created: Date.now() });
  user.items[id] = off === null ? {} : { myDeadlines: [{ date: d(off), time: '18:00', label: '마감', kind: 'deadline' }] };
});
fs.writeFileSync(path.join(data, 'user.json'), JSON.stringify(user));
fs.writeFileSync(path.join(data, 'settings.json'), JSON.stringify({ ui: { welcomeOff: true }, idle: { enabled: false }, alarms: { digest: false } }));

const exe = findExe();
console.log('앱:', exe);
const env = { ...process.env, HANNUNE_DATA: data, HANNUNE_DEMO: '1' };
delete env.ELECTRON_RUN_AS_NODE;
const started = Date.now();
const p = spawn(exe, ['--selftest'], { env });
let log = '';
p.stdout.on('data', b => { log += b; process.stdout.write(b); });
p.stderr.on('data', b => { log += b; process.stderr.write(b); });
const timer = setTimeout(() => { log += '\nTIMEOUT'; console.log('TIMEOUT'); p.kill('SIGKILL'); }, 240000);
p.on('exit', (code, sig) => {
  clearTimeout(timer);
  const sec = ((Date.now() - started) / 1000).toFixed(1);
  log += `\nEXIT code=${code} signal=${sig} after ${sec}s`;
  console.log(`EXIT code=${code} signal=${sig} after ${sec}s`);
  fs.writeFileSync(path.join(out, 'log.txt'), log);
  const shots = path.join(data, 'cache', 'shots');
  let n = 0;
  if (fs.existsSync(shots)) for (const f of fs.readdirSync(shots)) { fs.copyFileSync(path.join(shots, f), path.join(out, f)); n++; }
  if (process.platform === 'darwin') {
    const dr = path.join(os.homedir(), 'Library', 'Logs', 'DiagnosticReports');
    try { for (const f of fs.readdirSync(dr)) if (/hannune|electron|helper/i.test(f) || /한눈에/.test(f.normalize('NFC'))) fs.copyFileSync(path.join(dr, f), path.join(out, f)); } catch (_) { /* 없음 */ }
  }
  const ok = code === 0 && fs.existsSync(path.join(out, 'view_list.png'));
  console.log(ok ? `실행 시험 통과 (화면 ${n}장)` : '실행 시험 실패');
  process.exit(ok ? 0 : 1);
});
