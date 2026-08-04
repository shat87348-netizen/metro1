import type { MetroData, MetroLine, Service } from '../types';
import { hexToRgb, type RGB } from './color';

/** 到站停留时长上限：每段的最后 30 秒（不超过该段一半）视为停站 */
const MAX_DWELL_MS = 30_000;

/** 交路运行时模型：预计算每段的移动/停站毫秒数与沿线累计距离 */
export interface ServiceRuntime {
  description: string;
  path: [number, number][];
  stationNames: string[];
  /** 每个站在 path 中的顶点下标 */
  stationPtIdx: number[];
  /** path 每个顶点的沿线累计距离（米） */
  cumDist: number[];
  segTotalMs: number[];
  segMoveMs: number[];
  totalMs: number;
}

export interface LineRuntime extends Omit<MetroLine, 'services'> {
  colorRgb: RGB;
  services: ServiceRuntime[];
}

export interface Network {
  generatedAt: string;
  lines: LineRuntime[];
}

/** 相邻两点距离（米），等距圆柱近似，市域尺度误差可忽略 */
function distMeters(a: [number, number], b: [number, number]): number {
  const midLat = ((a[1] + b[1]) / 2) * (Math.PI / 180);
  const dx = (b[0] - a[0]) * 111_320 * Math.cos(midLat);
  const dy = (b[1] - a[1]) * 111_320;
  return Math.hypot(dx, dy);
}

function toServiceRuntime(service: Service): ServiceRuntime {
  const segTotalMs: number[] = [];
  const segMoveMs: number[] = [];
  let totalMs = 0;
  for (const minutes of service.segMinutes) {
    const ms = minutes * 60_000;
    const dwell = Math.min(MAX_DWELL_MS, ms / 2);
    segTotalMs.push(ms);
    segMoveMs.push(ms - dwell);
    totalMs += ms;
  }

  const cumDist: number[] = [0];
  for (let i = 1; i < service.path.length; i++) {
    cumDist.push(cumDist[i - 1] + distMeters(service.path[i - 1], service.path[i]));
  }

  return {
    description: service.description,
    path: service.path,
    stationNames: service.stationNames,
    stationPtIdx: service.stationIdx,
    cumDist,
    segTotalMs,
    segMoveMs,
    totalMs,
  };
}

export function buildNetwork(data: MetroData): Network {
  return {
    generatedAt: data.generatedAt,
    lines: data.lines.map((line) => ({
      ...line,
      colorRgb: hexToRgb(line.color),
      services: line.services.map(toServiceRuntime),
    })),
  };
}
