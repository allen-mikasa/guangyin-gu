/* 胶囊交互
 * 拖动：完全交给系统（.cap 上的 -webkit-app-region: drag），本文件不参与任何拖拽位移计算。
 *       早期版本由本文件自算位移：窗口一移动，指针上报的屏幕坐标就被窗口位移带偏，
 *       于是把自己的位移当成鼠标位移继续推，表现为"向右拖、左边缘反而不断左移"。
 * 点击：拖动区与点击区彻底分开 —— 点事项名回主窗，✕ 退出置顶。
 */
const capEl = document.getElementById('cap');

document.getElementById('cap-expand').addEventListener('click', () => window.cap.expand());
document.getElementById('cap-x').addEventListener('click', () => window.cap.exit());

window.cap.onState(s => {
  if (!s) return;
  document.getElementById('cap-mod').textContent = s.module || '光阴蛊';
  document.getElementById('cap-time').textContent = s.time || '00:00';
  capEl.classList.toggle('rest', !!s.rest);
});
