import { PathLayer, ScatterplotLayer, SolidPolygonLayer, TextLayer } from '@deck.gl/layers';
import type { Layer } from '@deck.gl/core';
import type { Network } from './network';
import type { Station } from '../types';
import type { Train } from './simulation';
import { orientedRectangle } from './geometry';

const CJK_FONT = 'PingFang SC, Microsoft YaHei, sans-serif';
const VEHICLE_LENGTH_M = 250;
const VEHICLE_WIDTH_M = 120;
const VEHICLE_HEIGHT_M = 120;
/** 车厢「当前站 → 下一站」标签颜色：主题蓝 #2b4df6 */
const TRAIN_LABEL_COLOR: [number, number, number, number] = [43, 77, 246, 255];

interface LinePathDatum {
  path: [number, number][];
  colorRgb: [number, number, number];
  name: string;
}

/**
 * 每条线路挑选覆盖全部区段的最小交路集合来画线：
 * 按站数从多到少，站点集合已被覆盖的交路（反向重复、大小交路）跳过，
 * 支线自然保留。避免上下行两条平行轨迹叠画产生摩尔纹。
 */
function collectLinePaths(network: Network): LinePathDatum[] {
  const data: LinePathDatum[] = [];
  for (const line of network.lines) {
    if (line.services.length === 0 && line.stations.length >= 2) {
      // 没有时刻表交路的线路退化为按站点顺序连线
      data.push({
        path: line.stations.map((s) => [s.lng, s.lat]),
        colorRgb: line.colorRgb,
        name: line.name,
      });
      continue;
    }
    const kept: Set<string>[] = [];
    const sorted = [...line.services].sort((a, b) => b.stationNames.length - a.stationNames.length);
    for (const service of sorted) {
      const covered = kept.some((k) => service.stationNames.every((n) => k.has(n)));
      if (covered) continue;
      kept.push(new Set(service.stationNames));
      data.push({ path: service.path, colorRgb: line.colorRgb, name: line.name });
    }
  }
  return data;
}

interface StationDatum extends Station {
  /** 所属线路名，多线换乘站合并 */
  lineNames: string[];
}

function collectStations(network: Network): StationDatum[] {
  const byId = new Map<string, StationDatum>();
  for (const line of network.lines) {
    for (const station of line.stations) {
      const existing = byId.get(station.id);
      if (existing) {
        existing.lineNames.push(line.name);
      } else {
        byId.set(station.id, { ...station, lineNames: [line.name] });
      }
    }
  }
  return [...byId.values()];
}

export function createStaticLayers(network: Network, showStationLabels: boolean): Layer[] {
  const stations = collectStations(network);
  return [
    new PathLayer<LinePathDatum>({
      id: 'metro-lines',
      data: collectLinePaths(network),
      getPath: (d) => d.path,
      getColor: (d) => d.colorRgb,
      getWidth: 45,
      widthMinPixels: 1.5,
      capRounded: true,
      jointRounded: true,
      pickable: true,
    }),
    new ScatterplotLayer<StationDatum>({
      id: 'metro-stations',
      data: stations,
      getPosition: (d) => [d.lng, d.lat],
      getRadius: 55,
      radiusMinPixels: 1.5,
      radiusMaxPixels: 6,
      getFillColor: [255, 255, 255, 230],
      getLineColor: [20, 20, 20, 255],
      getLineWidth: 18,
      lineWidthMinPixels: 0.5,
      stroked: true,
      pickable: true,
    }),
    new TextLayer<StationDatum>({
      id: 'metro-station-labels',
      visible: showStationLabels,
      data: stations,
      getPosition: (d) => [d.lng, d.lat],
      getText: (d) => d.name,
      getSize: 12,
      sizeUnits: 'pixels',
      getColor: [235, 235, 235, 255],
      getPixelOffset: [0, -14],
      fontFamily: CJK_FONT,
      characterSet: 'auto',
      outlineWidth: 2,
      outlineColor: [0, 0, 0, 200],
      fontSettings: { sdf: true },
    }),
  ];
}

export function createTrainLayers(trains: Train[], showTrainLabels: boolean): Layer[] {
  return [
    new SolidPolygonLayer<Train>({
      id: 'metro-trains',
      data: trains,
      getPolygon: (d) => orientedRectangle(d.position, d.from, d.to, VEHICLE_LENGTH_M, VEHICLE_WIDTH_M),
      getFillColor: (d) => d.color,
      extruded: true,
      getElevation: VEHICLE_HEIGHT_M,
      parameters: { depthCompare: 'always' },
    }),
    new TextLayer<Train>({
      id: 'metro-train-labels',
      visible: showTrainLabels,
      data: trains,
      getPosition: (d) => d.position,
      getText: (d) => d.label,
      getColor: TRAIN_LABEL_COLOR,
      getSize: 11,
      sizeUnits: 'pixels',
      getPixelOffset: [0, 22],
      background: true,
      getBackgroundColor: [0, 0, 0, 170],
      backgroundPadding: [4, 2],
      fontFamily: CJK_FONT,
      characterSet: 'auto',
    }),
  ];
}
