// 맥: 유료 인증서가 없어도 애플 칩(arm64)에서 돌도록 임시 서명(ad-hoc)을 한다.
// (서명이 전혀 없으면 애플 칩 맥은 앱을 아예 실행하지 않는다)
const { execSync } = require('child_process');
const path = require('path');

exports.default = async function adhocSign(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execSync(`codesign --force --deep --sign - "${app}"`, { stdio: 'inherit' });
};
