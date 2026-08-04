import type { LineRuntime, Network, ServiceRuntime } from './network';
import type { RGB } from './color';

/** 运营时段：05:00 发首班，22:30 后不再发车（已发出的列车跑完全程） */
const SERVICE_START_MIN = 5 * 60;
const LAST_DEPARTURE_MIN = 22 * 60 + 30;
const FALLBACK_HEADWAY_MIN = 6;

export interface Train {
  position: [number, number];
  from: [number, number];
  to: [number, number];
  color: RGB;
  lineNo: number;
  /** 「当前站 → 下一站」 */
  label: string;
}

/** 某条线路在指定时刻的发车间隔（分钟） */
export function headwayMinutesAt(line: LineRuntime, when: Date): number {
  const day = when.getDay() === 0 ? 7 : when.getDay();
  const rule = line.headways.find((r) => r.days.includes(day)) ?? line.headways[0];
  if (!rule) return FALLBACK_HEADWAY_MIN;
  const minuteOfDay = when.getHours() * 60 + when.getMinutes();
  const window = rule.windows.find((w) =>
    w.start < w.end
      ? minuteOfDay >= w.start && minuteOfDay < w.end
      : minuteOfDay >= w.start || minuteOfDay < w.end
  );
  return window ? window.minutes : rule.otherMinutes;
}

interface PositionOnPath {
  position: [number, number];
  from: [number, number];
  to: [number, number];
  segmentIndex: number;
}

/** 在 path 上取沿线距离 d 处的位置与所在折线段（用于朝向） */
function pointAtDistance(
  service: ServiceRuntime,
  d: number,
  lo: number,
  hi: number
): { position: [number, number]; from: [number, number]; to: [number, number] } {
  const { path, cumDist } = service;
  // 在 [lo, hi] 顶点区间内二分查找 d 所在折线段
  let a = lo;
  let b = Math.min(hi, path.length - 1);
  while (a + 1 < b) {
    const mid = (a + b) >> 1;
    if (cumDist[mid] <= d) a = mid;
    else b = mid;
  }
  const from = path[a];
  const to = path[Math.min(a + 1, path.length - 1)];
  const span = cumDist[a + 1] - cumDist[a];
  const t = span > 0 ? (d - cumDist[a]) / span : 0;
  return {
    position: [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t],
    from,
    to,
  };
}

/** 从发车起经过 elapsedMs 后列车在交路上的位置（段内先沿几何移动后停站） */
function locate(service: ServiceRuntime, elapsedMs: number): PositionOnPath | null {
  const { path, cumDist, stationPtIdx, segTotalMs, segMoveMs } = service;
  if (path.length < 2) return null;
  let acc = 0;
  for (let i = 0; i < segTotalMs.length; i++) {
    const total = segTotalMs[i];
    if (elapsedMs <= acc + total) {
      const local = elapsedMs - acc;
      const move = segMoveMs[i];
      const ptA = stationPtIdx[i];
      const ptB = stationPtIdx[i + 1];
      if (local < move && move > 0 && ptB > ptA) {
        const t = local / move;
        const d = cumDist[ptA] + (cumDist[ptB] - cumDist[ptA]) * t;
        return { ...pointAtDistance(service, d, ptA, ptB), segmentIndex: i };
      }
      // 停站阶段：停在下一站，朝向取到站前的折线方向
      const stop = path[ptB];
      const prevPt = path[Math.max(ptB - 1, 0)];
      return { position: stop, from: prevPt, to: stop, segmentIndex: i };
    }
    acc += total;
  }
  return null;
}

/**
 * 给定模拟时刻，返回全网所有在途列车。
 * 模型：每个交路从 05:00 起按当时生效的发车间隔连续发车，
 * 到 22:30 停止发车；每班车按时刻表推算的分段时长运行至终点。
 */
export function getTrains(network: Network, simDate: Date): Train[] {
  const dayStartMs = new Date(
    simDate.getFullYear(),
    simDate.getMonth(),
    simDate.getDate()
  ).getTime();
  const nowMs = simDate.getTime();
  const firstDepartureMs = dayStartMs + SERVICE_START_MIN * 60_000;
  const departureCutoffMs = Math.min(nowMs, dayStartMs + LAST_DEPARTURE_MIN * 60_000);
  if (nowMs < firstDepartureMs) return [];

  const trains: Train[] = [];
  for (const line of network.lines) {
    // 公布的发车间隔是重叠区段的合流频率；一条线有多个交路（上下行、
    // 大小交路、支线）时按方向数摊分：每个交路以 factor × 间隔发车并错峰，
    // 合流区段的频率恰好等于公布间隔。碎片交路（末班车残段）不计入摊分。
    const maxStations = Math.max(...line.services.map((s) => s.stationNames.length), 0);
    const patternCount = line.services.filter(
      (s) => s.stationNames.length >= maxStations * 0.5
    ).length;
    const factor = Math.max(1, Math.round(patternCount / 2));

    for (const [serviceIndex, service] of line.services.entries()) {
      if (service.totalMs <= 0) continue;
      const baseHeadway = headwayMinutesAt(line, new Date(firstDepartureMs));
      let departMs = firstDepartureMs + (serviceIndex % factor) * baseHeadway * 60_000;
      while (departMs <= departureCutoffMs) {
        const elapsed = nowMs - departMs;
        if (elapsed <= service.totalMs) {
          const pos = locate(service, elapsed);
          if (pos) {
            const next = service.stationNames[pos.segmentIndex + 1];
            const current = service.stationNames[pos.segmentIndex];
            trains.push({
              position: pos.position,
              from: pos.from,
              to: pos.to,
              color: line.colorRgb,
              lineNo: line.no,
              label: next ? `${current} → ${next}` : service.description,
            });
          }
        }
        const headway = headwayMinutesAt(line, new Date(departMs));
        departMs += Math.max(0.5, headway) * factor * 60_000;
      }
    }
  }
  return trains;
}
