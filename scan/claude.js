// Claude Code CLI(claude -p) 부르기. API 키 없이 사용자의 Claude 로그인(구독)으로 돈다.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

let cached;
function claudeExe() {
  if (cached !== undefined) return cached;
  const home = os.homedir();
  const cands = process.platform === 'win32'
    ? [path.join(home, '.local', 'bin', 'claude.exe'), path.join(process.env.APPDATA || '', 'npm', 'claude.cmd')]
    : [path.join(home, '.local', 'bin', 'claude'), '/usr/local/bin/claude', '/opt/homebrew/bin/claude', path.join(home, '.claude', 'local', 'claude')];
  cached = cands.find(c => c && fs.existsSync(c)) || null;
  return cached;
}
const claudeAvailable = () => !!claudeExe();

function callClaude({ system, prompt, schema, model = 'sonnet', effort = 'low', timeoutMs = 300000 }) {
  return new Promise((resolve, reject) => {
    const exe = claudeExe();
    if (!exe) return reject(new Error('Claude Code가 설치돼 있지 않습니다.'));
    const args = ['-p', '--output-format', 'json', '--system-prompt', system,
      '--tools', '', '--no-session-persistence', '--strict-mcp-config', '--setting-sources', '',
      '--model', model, '--effort', effort];
    if (schema) args.push('--json-schema', JSON.stringify(schema));
    const p = spawn(exe, args, { cwd: os.tmpdir(), windowsHide: true, shell: exe.endsWith('.cmd') });
    let out = '', err = '';
    const timer = setTimeout(() => { p.kill(); reject(new Error('AI가 너무 오래 걸려 멈췄습니다.')); }, timeoutMs);
    p.stdout.on('data', d => { out += d; });
    p.stderr.on('data', d => { err += d; });
    p.on('error', e => { clearTimeout(timer); reject(e); });
    p.on('close', () => {
      clearTimeout(timer);
      let j;
      try { j = JSON.parse(out); } catch (_) { return reject(new Error('AI 응답을 읽지 못했습니다: ' + (err || out).slice(-300))); }
      if (j.is_error) return reject(new Error(String(j.result || 'AI 오류').slice(0, 300)));
      let r = schema ? j.structured_output : j.result;
      if (schema && r == null) { try { r = JSON.parse(j.result); } catch (_) { return reject(new Error('AI가 정해진 모양으로 답하지 않았습니다.')); } }
      resolve(r);
    });
    p.stdin.end(prompt, 'utf8');
  });
}

module.exports = { callClaude, claudeAvailable };
