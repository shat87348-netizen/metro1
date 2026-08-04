/** 预处理产物 metro.json 的数据结构 */

export interface Station {
  id: string;
  name: string;
  nameEn: string;
  lng: number;
  lat: number;
}

/** 一个交路：某条线路某个方向（含大小交路）的运行路径 */
export interface Service {
  description: string;
  /** 线路几何：有高德数据时是真实 polyline，否则为站点直连 */
  path: [number, number][];
  /** 每个站在 path 中的顶点下标，长度 = stationNames.length，单调递增 */
  stationIdx: number[];
  stationNames: string[];
  /** 相邻两站间的运行时长（分钟），长度 = stationNames.length - 1 */
  segMinutes: number[];
}

/** 发车间隔时间窗，start/end 为当日分钟数 */
export interface HeadwayWindow {
  start: number;
  end: number;
  minutes: number;
}

/** 按星期分组的发车间隔规则，days 取值 1-7（周一至周日） */
export interface HeadwayRule {
  days: number[];
  windows: HeadwayWindow[];
  otherMinutes: number;
}

export interface MetroLine {
  no: number;
  name: string;
  color: string;
  stations: Station[];
  services: Service[];
  headways: HeadwayRule[];
}

export interface MetroData {
  generatedAt: string;
  lines: MetroLine[];
}
