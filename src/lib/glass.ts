/**
 * 生成「液态玻璃」边缘折射所需的位移图（displacement map）。
 *
 * 原理（参考 Apple Liquid Glass / liquid-dom）：
 *  - 用有向距离场（SDF）描述圆角矩形的边缘；
 *  - 元素中心位移为 0（背景清晰透出），越靠近边缘位移越大（背景被"挤"向外侧弯折）；
 *  - 把"向外"的法线方向编码进 R/G 通道（128 = 无偏移），交给 SVG feDisplacementMap 使用。
 *
 * 返回的 dataURL 直接喂给 <feImage>。
 */
export function makeGlassDisplacementMap(
  w: number,
  h: number,
  mode: "circle" | "rect",
  corner: number,
  band: number
): string {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  const img = ctx.createImageData(w, h);
  const cx = w / 2;
  const cy = h / 2;
  const halfW = w / 2;
  const halfH = h / 2;
  const r = mode === "circle" ? Math.max(1, Math.min(w, h) / 2) : Math.max(1, Math.min(corner, halfW, halfH));
  const b = Math.max(1, band);

  // 圆角矩形 SDF：内部为负、边缘为 0、外部为正
  const sdRoundRect = (px: number, py: number) => {
    const qx = Math.abs(px) - (halfW - r);
    const qy = Math.abs(py) - (halfH - r);
    const ax = Math.max(qx, 0);
    const ay = Math.max(qy, 0);
    return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - r;
  };
  const sdCircle = (px: number, py: number) => Math.hypot(px, py) - r;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = x - cx;
      const py = y - cy;
      const d = mode === "circle" ? sdCircle(px, py) : sdRoundRect(px, py);
      // 仅元素内部一圈产生折射（外部不影响）
      let mag = 0;
      if (d < 0) {
        const t = Math.min(1, -d / b);
        mag = Math.sin(t * Math.PI * 0.5); // 边缘最强、向中心平滑归零
      }
      const dist = Math.hypot(px, py) || 1;
      const nx = px / dist; // 向外法线（近似）
      const ny = py / dist;
      const offX = Math.max(-127, Math.min(127, nx * mag * 127));
      const offY = Math.max(-127, Math.min(127, ny * mag * 127));
      const i = (y * w + x) * 4;
      img.data[i] = 128 + offX;
      img.data[i + 1] = 128 + offY;
      img.data[i + 2] = 128;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL();
}
