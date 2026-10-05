/* 透明图标生成：暖色屏障分区抠图 + 多尺寸 ICO
   原理：青铜/金色（暖色）像素为屏障并膨胀封缝；在屏障之外对全图做连通分区，
   接触边缘的区域=底板背景；被屏障围合的区域按暖色密度判断——
   罐腹含光河沙漏星斗（暖色密集）保留，罐颈空带（冷暗空旷）删除。 */
const Jimp = require('jimp');
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'build', 'icon-source.png');
const OUT_ICO = path.join(__dirname, '..', 'build', 'icon.ico');
const OUT_PNG = path.join(__dirname, '..', 'build', 'icon.png');
const PREVIEW = path.join(__dirname, '..', 'build', 'icon-preview-white.png');

const N = 512;
const KEEP_WALL = 260;   // 外部悬浮暖色块大于此面积保留（朱印），否则视为星点噪点

(async () => {
  const img = await Jimp.read(SRC);
  img.resize(N, N);
  const d = img.bitmap.data;
  const W = N, H = N, total = W * H;
  const idx = p => p * 4;

  const isWarmP = p => {
    const i = idx(p), r = d[i], g = d[i + 1], b = d[i + 2];
    return (r > 85 && r >= g && g >= b) || (g > 68 && g > r + 8 && g >= b - 8);
  };
  const isCoolP = p => {
    const i = idx(p), r = d[i], g = d[i + 1], b = d[i + 2], mx = Math.max(r, g, b);
    return !isWarmP(p) && b >= r - 8 && mx < 95;
  };

  // 1. 暖色屏障 + 1px 膨胀封缝
  const wall0 = new Uint8Array(total);
  for (let p = 0; p < total; p++) if (isWarmP(p)) wall0[p] = 1;
  const wall = new Uint8Array(total);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!wall0[y * W + x]) continue;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && nx < W && ny >= 0 && ny < H) wall[ny * W + nx] = 1;
        }
      }
    }
  }

  // 2. 非屏障像素连通分区：region 0 = 接触边缘的外部区；其余为围合区
  const region = new Int32Array(total).fill(-1);
  const queue = new Int32Array(total);
  let qh = 0, qt = 0;
  for (let x = 0; x < W; x++) {
    for (const y of [0, H - 1]) { const p = y * W + x; if (!wall[p] && region[p] === -1) { region[p] = 0; queue[qt++] = p; } }
  }
  for (let y = 0; y < H; y++) {
    for (const x of [0, W - 1]) { const p = y * W + x; if (!wall[p] && region[p] === -1) { region[p] = 0; queue[qt++] = p; } }
  }
  const nbOf = p => {
    const x = p % W, y = (p / W) | 0, a = [];
    if (x > 0) a.push(p - 1); if (x < W - 1) a.push(p + 1);
    if (y > 0) a.push(p - W); if (y < H - 1) a.push(p + W);
    return a;
  };
  while (qh < qt) {
    const p = queue[qh++];
    for (const q of nbOf(p)) if (!wall[q] && region[q] === -1) { region[q] = 0; queue[qt++] = q; }
  }
  const stats = [{ size: 0, warm: 0, cool: 0, sum: 0 }];
  for (let p = 0; p < total; p++) {
    if (wall[p] || region[p] !== -1) continue;
    const rid = stats.length;
    let size = 0, warm = 0, cool = 0, sum = 0;
    const stk = [p]; region[p] = rid;
    while (stk.length) {
      const q = stk.pop(); size++;
      if (isWarmP(q)) warm++;
      if (isCoolP(q)) cool++;
      const i = idx(q); sum += Math.max(d[i], d[i + 1], d[i + 2]);
      for (const r of nbOf(q)) if (!wall[r] && region[r] === -1) { region[r] = rid; stk.push(r); }
    }
    stats.push({ size, warm, cool, sum });
  }
  // 围合区判定：冷暗空旷 -> 背景；暖色密集（罐腹）-> 保留
  const emptyRegion = new Uint8Array(stats.length);
  for (let r = 1; r < stats.length; r++) {
    const s = stats[r];
    if (s.warm / s.size < 0.12 && s.cool / s.size > 0.5 && s.sum / s.size < 100) emptyRegion[r] = 1;
  }

  // 3. 外部区悬浮小暖色块（底板星点）清理；朱印等大块保留
  const wallComp = new Int32Array(total);
  const wallSizes = [0];
  const wallTouchesKeep = [false];
  for (let p = 0; p < total; p++) {
    if (!wall[p] || wallComp[p]) continue;
    const cid = wallSizes.length;
    let size = 0, keep = false;
    const stk = [p]; wallComp[p] = cid;
    while (stk.length) {
      const q = stk.pop(); size++;
      for (const r of nbOf(q)) {
        if (wall[r]) { if (!wallComp[r]) { wallComp[r] = cid; stk.push(r); } }
        else if (region[r] !== 0 && !emptyRegion[region[r]]) keep = true;
      }
    }
    wallSizes.push(size); wallTouchesKeep.push(keep);
  }

  // 4. 写 alpha（罐腹圆窗几何保护：椭圆内一律保留，避免内部暗蓝夜景被误判）
  const bg = new Uint8Array(total);
  for (let p = 0; p < total; p++) {
    if (!wall[p]) {
      if (region[p] === 0 || emptyRegion[region[p]] === 1) bg[p] = 1;
    } else {
      const cid = wallComp[p];
      if (!wallTouchesKeep[cid] && wallSizes[cid] < KEEP_WALL) bg[p] = 1;
    }
  }
  const CX = 256, CY = 306, RX = 128, RY = 122;
  const inBelly = p => {
    const x = p % W, y = (p / W) | 0;
    const dx = (x - CX) / RX, dy = (y - CY) / RY;
    return dx * dx + dy * dy <= 1;
  };
  for (let p = 0; p < total; p++) {
    const i = idx(p);
    if (inBelly(p)) { d[i + 3] = 255; continue; }
    if (bg[p]) { d[i + 3] = 0; continue; }
    // 边缘羽化：与背景相邻的暗冷像素按亮度柔化
    let near = false;
    for (const q of nbOf(p)) if (bg[q]) { near = true; break; }
    if (near && !isWarmP(p)) {
      const mx = Math.max(d[i], d[i + 1], d[i + 2]);
      if (d[i + 2] >= d[i] - 10 && mx < 96) {
        const a = Math.max(0, Math.min(255, Math.round((mx - 36) / (96 - 36) * 255)));
        d[i + 3] = Math.min(d[i + 3], a);
      }
    }
  }

  // 5. 白底预览
  const preview = img.clone();
  const pd = preview.bitmap.data;
  for (let p = 0; p < total; p++) {
    const i = p * 4, a = d[i + 3] / 255;
    pd[i] = Math.round(d[i] * a + 255 * (1 - a));
    pd[i + 1] = Math.round(d[i + 1] * a + 255 * (1 - a));
    pd[i + 2] = Math.round(d[i + 2] * a + 255 * (1 - a));
    pd[i + 3] = 255;
  }
  await preview.writeAsync(PREVIEW);
  // 深色背景预览（贴近任务栏）
  const previewD = img.clone();
  const pdd = previewD.bitmap.data;
  for (let p = 0; p < total; p++) {
    const i = p * 4, a = d[i + 3] / 255;
    const bgc = [12, 17, 25];
    pdd[i] = Math.round(d[i] * a + bgc[0] * (1 - a));
    pdd[i + 1] = Math.round(d[i + 1] * a + bgc[1] * (1 - a));
    pdd[i + 2] = Math.round(d[i + 2] * a + bgc[2] * (1 - a));
    pdd[i + 3] = 255;
  }
  await previewD.writeAsync(path.join(__dirname, '..', 'build', 'icon-preview-dark.png'));
  await img.writeAsync(OUT_PNG);

  // 6. 多尺寸 ICO
  const sizesIco = [16, 32, 48, 64, 128, 256];
  const pngs = [];
  for (const s of sizesIco) {
    const c = img.clone();
    c.resize(s, s, Jimp.RESIZE_BICUBIC);
    pngs.push({ s, buf: await c.getBufferAsync(Jimp.MIME_PNG) });
  }
  const n = pngs.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(n, 4);
  const entries = Buffer.alloc(16 * n);
  let offset = 6 + 16 * n;
  pngs.forEach((it, k) => {
    const e = entries.slice(k * 16, k * 16 + 16);
    e.writeUInt8(it.s >= 256 ? 0 : it.s, 0);
    e.writeUInt8(it.s >= 256 ? 0 : it.s, 1);
    e.writeUInt8(0, 2); e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
    e.writeUInt32LE(it.buf.length, 8); e.writeUInt32LE(offset, 12);
    offset += it.buf.length;
  });
  fs.writeFileSync(OUT_ICO, Buffer.concat([header, entries, ...pngs.map(x => x.buf)]));
  const keptRegions = stats.length - 1 - emptyRegion.reduce((a, b) => a + b, 0);
  console.log('ICON_OK regions=' + (stats.length - 1) + ' kept=' + keptRegions + ' wallComps=' + wallSizes.length);
})();
