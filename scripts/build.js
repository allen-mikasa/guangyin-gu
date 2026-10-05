/* 打包入口：规避 ELECTRON_RUN_AS_NODE（会让 electron-builder 的辅助进程行为异常），
 * 并强制把成果输出到项目内 dist 目录。用法：npm run build:win
 */
const { spawnSync } = require('child_process');
const path = require('path');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;          // 关键：否则 electron 以纯 Node 模式启动
env.ELECTRON_BUILDER_CACHE = env.ELECTRON_BUILDER_CACHE || path.join(__dirname, '..', '.cache', 'electron-builder');

const args = ['--win', 'nsis', 'portable'];
const cli = path.join(__dirname, '..', 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js');

console.log('[build] electron-builder ' + args.join(' '));
const r = spawnSync(process.execPath, [cli, ...args], {
  stdio: 'inherit',
  cwd: path.join(__dirname, '..'),
  env
});
process.exit(r.status === null ? 1 : r.status);
