/** 以 center 为中心、朝向 from->to 的矩形（经纬度四点环），用于渲染列车 */
export function orientedRectangle(
  center: [number, number],
  from: [number, number],
  to: [number, number],
  lengthMeters: number,
  widthMeters: number
): [number, number][] {
  const [clng, clat] = center;
  const metersPerDegLat = 111_320;
  const metersPerDegLng = 111_320 * Math.cos((clat * Math.PI) / 180);

  // 单位方向向量（本地平面坐标，米）
  let dx = (to[0] - from[0]) * metersPerDegLng;
  let dy = (to[1] - from[1]) * metersPerDegLat;
  const len = Math.hypot(dx, dy);
  if (len === 0) {
    dx = 1;
    dy = 0;
  } else {
    dx /= len;
    dy /= len;
  }
  const nx = -dy;
  const ny = dx;

  const hl = lengthMeters / 2;
  const hw = widthMeters / 2;
  const corners: [number, number][] = [
    [dx * hl + nx * hw, dy * hl + ny * hw],
    [dx * hl - nx * hw, dy * hl - ny * hw],
    [-dx * hl - nx * hw, -dy * hl - ny * hw],
    [-dx * hl + nx * hw, -dy * hl + ny * hw],
  ];
  return corners.map(([x, y]) => [clng + x / metersPerDegLng, clat + y / metersPerDegLat]);
}
