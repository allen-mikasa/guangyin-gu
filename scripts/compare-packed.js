// 对比已安装 app.asar 与工作区的胶囊相关文件，确认包内是最新内容
const fs = require('fs');
const asarPath = process.argv[2] || 'D:/光阴蛊/guangyin-gu/resources/app.asar';
const b = fs.readFileSync(asarPath);
const hs = b.readUInt32LE(12);
const json = JSON.parse(b.slice(16, 16 + hs).toString('utf8'));
const base = 16 + hs;
const readFile = e => b.slice(base + Number(e.offset), base + Number(e.offset) + Number(e.size)).toString('utf8');

const pairs = [
  ['src/capsule-renderer.js', 'src/capsule-renderer.js'],
  ['capsule-preload.js', 'capsule-preload.js'],
  ['src/capsule.html', 'src/capsule.html'],
  ['src/renderer.js', 'src/renderer.js'],
  ['src/index.html', 'src/index.html'],
  ['src/styles.css', 'src/styles.css'],
];

for (const [asarKey, wsPath] of pairs) {
  const parts = asarKey.split('/');
  let node = json.files;
  for (const p of parts) {
    node = parts.length > 1 && p !== parts[0] ? node.files[p] : node[p];
    if (parts.length > 1 && p === parts[0]) node = json.files[p].files ? json.files[p] : node;
  }
  let entry;
  if (asarKey.includes('/')) entry = json.files[parts[0]].files[parts[1]];
  else entry = json.files[asarKey];
  const packed = readFile(entry);
  const ws = fs.readFileSync(wsPath, 'utf8');
  // asar 打包会去掉 BOM、并可能多一个首行换行，比较前统一归一化
  const norm = s => s.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/^\n+/, '').trimEnd();
  const same = norm(packed) === norm(ws);
  console.log(`${asarKey}: 包内 ${packed.length} 字节 / 工作区 ${ws.length} 字节 → ${same ? '一致 ✓' : '❌ 不一致'}`);
  if (packed !== ws && asarKey.includes('capsule')) {
    console.log('  包内前 200 字: ' + JSON.stringify(packed.slice(0, 200)));
  }
}
