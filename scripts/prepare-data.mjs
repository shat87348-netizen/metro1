/**
 * 离线数据预处理：把 data/raw/ 下的原始爬虫数据（约 6MB）清洗成
 * 运行时所需的紧凑数据 src/data/metro.json（约 150KB）。
 *
 * 处理内容：
 *  - 站点：只保留坐标有效的站点（名称 + 经纬度）
 *  - 交路（service）：时刻表按 description（方向/终点）分组，
 *    按首班时间判断顺序，并从相邻站的首/末班时间差推算每段运行时长
 *  - 发车间隔：按星期分组，时间窗 -> 间隔分钟数
 *
 * 运行：npm run prepare-data
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gcj02ToWgs84 } from './gcj02.mjs';

const rawPath = (name) => fileURLToPath(new URL(`../data/raw/${name}`, import.meta.url));
const raw = (name) => JSON.parse(readFileSync(rawPath(name), 'utf8'));

const linesRaw = raw('shanghai_metro.json');
const scheduleRaw = raw('shanghai_metro_schedule.json');
const intervalsRaw = raw('interval.json');

const SPECIAL_LINE_NAMES = { 41: '浦江线', 51: '市域机场线' };
const lineName = (no) => SPECIAL_LINE_NAMES[no] ?? `${no}号线`;

// "HH:MM[:SS]" -> 当日分钟数；无效返回 NaN
function parseClock(text) {
  if (typeof text !== 'string') return NaN;
  const m = text.trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m) return NaN;
  return Number(m[1]) * 60 + Number(m[2]);
}

// "MM:SS" 或数字 -> 分钟数；无效返回 NaN
function parseDuration(value) {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return NaN;
  const m = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (m) return Number(m[1]) + Number(m[2]) / 60;
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

// 两个时刻的前向差值（跨午夜取模一天）
function forwardDelta(fromMin, toMin) {
  let d = toMin - fromMin;
  if (d <= 0) d += 24 * 60;
  return d;
}

// 相邻两站的运行时长（分钟）：取首班/末班两组时间差中的较小值，夹取到 0.5~45
function segmentMinutes(a, b) {
  const candidates = [];
  const fa = parseClock(a.first_time);
  const fb = parseClock(b.first_time);
  if (Number.isFinite(fa) && Number.isFinite(fb)) candidates.push(forwardDelta(fa, fb));
  const la = parseClock(a.last_time);
  const lb = parseClock(b.last_time);
  if (Number.isFinite(la) && Number.isFinite(lb)) candidates.push(forwardDelta(la, lb));
  if (candidates.length === 0) return 2.5;
  return Math.max(0.5, Math.min(Math.min(...candidates), 45));
}

/**
 * 判断一组时刻表条目的排列方向：对 first_time 与 last_time 的相邻差值做多数表决。
 * 原始数据中部分方向（如 11 号线「往安亭」）按终点在前排列，且 first_time 全为 "--"，
 * 只能靠 last_time 判断。返回按行车方向排列的新数组。
 */
function orientEntries(entries) {
  let forward = 0;
  let backward = 0;
  for (const field of ['first_time', 'last_time']) {
    let prev = NaN;
    for (const entry of entries) {
      const t = parseClock(entry[field]);
      if (Number.isFinite(t) && Number.isFinite(prev)) {
        let d = t - prev;
        if (d > 720) d -= 1440;
        if (d < -720) d += 1440;
        if (d > 0 && d <= 45) forward++;
        else if (d < 0 && d >= -45) backward++;
      }
      if (Number.isFinite(t)) prev = t;
    }
  }
  return backward > forward ? [...entries].reverse() : entries;
}

/* ---------- 高德线路几何（可选增强） ---------- */

// 站名归一化：去空白、统一间隔号、剥掉括号注记（高德为同名站加消歧后缀，
// 如「国家会展中心(2号线)」「浦东南路(原东昌路)」），用于官方与高德站名匹配
const normName = (s) =>
  String(s ?? '')
    .replace(/\s+/g, '')
    .replace(/[•・]/g, '·')
    .replace(/[（(][^）)]*[）)]/g, '');

const round6 = (n) => Math.round(n * 1e6) / 1e6;

/** 读取 data/raw/amap/line_<no>.json（若存在），返回该线路的几何候选列表 */
function loadAmapGeometry(lineNo) {
  const file = rawPath(`amap/line_${lineNo}.json`);
  if (!existsSync(file)) return [];
  const { buslines } = JSON.parse(readFileSync(file, 'utf8'));
  const candidates = [];
  for (const b of buslines ?? []) {
    if (!b.polyline || !Array.isArray(b.busstops) || b.busstops.length < 2) continue;
    const pts = b.polyline.split(';').map((pair) => {
      const [lng, lat] = pair.split(',').map(Number);
      return gcj02ToWgs84(lng, lat).map(round6);
    });
    const stops = b.busstops.map((s) => {
      const [lng, lat] = String(s.location).split(',').map(Number);
      const [wlng, wlat] = gcj02ToWgs84(lng, lat);
      return { name: normName(s.name), lng: round6(wlng), lat: round6(wlat) };
    });
    // 每个站映射到 polyline 上最近的顶点，并保证单调递增
    const stopPtIdx = [];
    let minFrom = 0;
    for (const stop of stops) {
      let best = minFrom;
      let bestD = Infinity;
      for (let i = minFrom; i < pts.length; i++) {
        const dx = pts[i][0] - stop.lng;
        const dy = pts[i][1] - stop.lat;
        const d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      stopPtIdx.push(best);
      minFrom = best;
    }
    candidates.push({ pts, stops, stopPtIdx });
    // 同时提供反向候选（部分方向高德只收录单向几何）
    const rpts = [...pts].reverse();
    candidates.push({
      pts: rpts,
      stops: [...stops].reverse(),
      stopPtIdx: [...stopPtIdx].reverse().map((i) => pts.length - 1 - i),
    });
  }
  return candidates;
}

/**
 * 把一个交路的站名序列映射到某个几何候选上。
 * 要求所有站都能按顺序在候选站列表中找到；环线（首尾同站）允许
 * 末站落在 polyline 终点（需与首站距离足够近）。
 * 成功返回 { path, stationIdx }，失败返回 null。
 */
function mapServiceToGeometry(candidates, stationNames) {
  const names = stationNames.map(normName);
  const isRing = names.length > 2 && names[0] === names[names.length - 1];
  const matchNames = isRing ? names.slice(0, -1) : names;

  for (const cand of candidates) {
    const stopNames = cand.stops.map((s) => s.name);
    const idxs = [];
    let from = 0;
    let ok = true;
    for (const name of matchNames) {
      let found = -1;
      for (let k = from; k < stopNames.length; k++) {
        if (stopNames[k] === name) {
          found = k;
          break;
        }
      }
      if (found < 0) {
        ok = false;
        break;
      }
      idxs.push(found);
      from = found + 1;
    }
    if (!ok) continue;

    const ptStart = cand.stopPtIdx[idxs[0]];
    let ptIdxs = idxs.map((i) => cand.stopPtIdx[i]);
    let ptEnd = ptIdxs[ptIdxs.length - 1];

    if (isRing) {
      // 环线：路径延伸到 polyline 末尾，要求末尾点回到首站附近（约 800 米内）
      const tail = cand.pts[cand.pts.length - 1];
      const first = cand.stops[idxs[0]];
      const dLng = (tail[0] - first.lng) * 111320 * Math.cos((first.lat * Math.PI) / 180);
      const dLat = (tail[1] - first.lat) * 111320;
      if (Math.hypot(dLng, dLat) > 800) continue;
      ptEnd = cand.pts.length - 1;
      ptIdxs = [...ptIdxs, ptEnd];
    }
    if (ptEnd <= ptStart) continue;

    return {
      path: cand.pts.slice(ptStart, ptEnd + 1),
      stationIdx: ptIdxs.map((i) => i - ptStart),
    };
  }
  return null;
}

function buildServices(timetableEntries, stationById, amapCandidates) {
  // 按 description（方向/终点站）分组，保持原始顺序
  const groups = new Map();
  for (const entry of timetableEntries) {
    const key = entry.description || '未知方向';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }

  const oriented = [...groups].map(([description, entries]) => ({
    description,
    entries: orientEntries(entries),
    ids: new Set(entries.map((e) => e.stat_id)),
  }));

  // 拆解复合分组：支线线路的回程方向（如 5 号线「往莘庄」）会把两条支线的
  // 站点拼进同一组，形成一条穿过两条支线的假路径。若某组的站点集合恰好等于
  // 另外两组的并集（且两组都不覆盖它），则用那两组的反向路径替代该组。
  const isSuperset = (a, b) => [...b].every((x) => a.has(x));
  const runs = [];
  for (const group of oriented) {
    let decomposed = null;
    outer: for (const a of oriented) {
      if (a === group || isSuperset(a.ids, group.ids)) continue;
      for (const b of oriented) {
        if (b === group || b === a || isSuperset(b.ids, group.ids)) continue;
        const union = new Set([...a.ids, ...b.ids]);
        if (union.size === group.ids.size && isSuperset(group.ids, union)) {
          decomposed = [a, b];
          break outer;
        }
      }
    }
    if (decomposed) {
      // 段时长仍按干净组的原方向推算，路径构建完成后再整体翻转
      for (const part of decomposed) {
        runs.push({ description: group.description, entries: part.entries, reversed: true });
      }
    } else {
      runs.push({ description: group.description, entries: group.entries, reversed: false });
    }
  }

  const services = [];
  for (const { description, entries, reversed } of runs) {
    // 只保留有坐标的站点；被跳过的站点其段时长并入前一段
    const path = [];
    const stationNames = [];
    const segMinutes = [];
    let pendingMinutes = 0;
    let prev = null;
    for (const entry of entries) {
      const station = stationById.get(entry.stat_id);
      if (prev) pendingMinutes += segmentMinutes(prev, entry);
      prev = entry;
      if (!station) continue;
      if (path.length > 0) {
        segMinutes.push(Math.max(0.5, pendingMinutes));
      }
      pendingMinutes = 0;
      path.push([station.lng, station.lat]);
      stationNames.push(station.name);
    }
    if (path.length < 2) continue;
    if (reversed) {
      path.reverse();
      stationNames.reverse();
      segMinutes.reverse();
    }
    // 优先使用高德真实线路几何；匹配失败退回站点直连
    const geo = mapServiceToGeometry(amapCandidates, stationNames);
    if (geo) {
      services.push({ description, path: geo.path, stationIdx: geo.stationIdx, stationNames, segMinutes });
    } else {
      if (amapCandidates.length > 0) {
        console.warn(`  ⚠ ${description}：未能匹配高德几何，退回站点直连`);
      }
      services.push({
        description,
        path,
        stationIdx: path.map((_, i) => i),
        stationNames,
        segMinutes,
      });
    }
  }
  return services;
}

function buildHeadways(lineNo) {
  const record = intervalsRaw.find((item) => Number(item.line) === Number(lineNo));
  if (!record || !Array.isArray(record.interval)) return [];
  const rules = [];
  for (const dayGroup of record.interval) {
    const windows = [];
    let otherMinutes = 6;
    for (const [key, value] of Object.entries(dayGroup.range_interval ?? {})) {
      // 值可能是 "MM:SS"，也可能是分段数组（不同区段不同间隔），取最密的一段
      const minutes = Array.isArray(value)
        ? Math.min(...value.map((v) => parseDuration(v.time)).filter(Number.isFinite))
        : parseDuration(value);
      if (!Number.isFinite(minutes) || minutes <= 0) continue;
      if (key === 'other') {
        otherMinutes = minutes;
        continue;
      }
      const [startText, endText] = key.split('-');
      const start = parseClock(startText);
      const end = parseClock(endText);
      if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
      windows.push({ start, end, minutes });
    }
    rules.push({ days: dayGroup.range ?? [], windows, otherMinutes });
  }
  return rules;
}

const outLines = [];
for (const lineRaw of linesRaw.lines) {
  const no = lineRaw.line_info.line_no;

  const stationById = new Map();
  for (const s of lineRaw.stations) {
    if (!s.longitude || !s.latitude) continue;
    stationById.set(s.stat_id, {
      id: s.stat_id,
      name: String(s.name_cn || s.stat_name || '').trim(),
      nameEn: String(s.name_en || '').trim(),
      lng: s.longitude,
      lat: s.latitude,
    });
  }

  // 高德几何（可选）：若已通过 fetch-amap 拉取，则用真实 polyline 与站点坐标
  const amapCandidates = loadAmapGeometry(no);
  if (amapCandidates.length > 0) {
    // 用高德站点坐标修正官方数据坐标，保证站点圆点落在线路几何上
    const amapStopByName = new Map();
    for (const cand of amapCandidates) {
      for (const stop of cand.stops) {
        if (!amapStopByName.has(stop.name)) amapStopByName.set(stop.name, stop);
      }
    }
    for (const station of stationById.values()) {
      const stop = amapStopByName.get(normName(station.name));
      if (stop) {
        station.lng = stop.lng;
        station.lat = stop.lat;
      }
    }
  }

  const scheduleLine = scheduleRaw.lines.find((l) => l.line_info.line_no === no);
  const timetableEntries = scheduleLine?.timetable?.timetable ?? [];

  outLines.push({
    no,
    name: lineName(no),
    color: lineRaw.line_info.color,
    stations: [...stationById.values()],
    services: buildServices(timetableEntries, stationById, amapCandidates),
    headways: buildHeadways(no),
  });
}

const output = { generatedAt: new Date().toISOString(), lines: outLines };
const json = JSON.stringify(output);
const outPath = fileURLToPath(new URL('../src/data/metro.json', import.meta.url));
writeFileSync(outPath, json);

const totalStations = outLines.reduce((n, l) => n + l.stations.length, 0);
const totalServices = outLines.reduce((n, l) => n + l.services.length, 0);
console.log(
  `已生成 src/data/metro.json：${outLines.length} 条线路，${totalStations} 个站点，` +
    `${totalServices} 个交路，${(json.length / 1024).toFixed(0)}KB`
);
