/**
 * 从高德「公交信息查询」Web 服务 API 拉取上海地铁各线路的
 * 真实线路几何（polyline）与站点坐标，存入 data/raw/amap/。
 *
 * 需要「Web服务」平台类型的 Key（不是 Web端 JS API / Android / iOS Key）：
 * 高德控制台 https://console.amap.com/dev/key/app → 创建 Key → 服务平台选「Web服务」。
 *
 * 用法：
 *   在项目根目录建 .env 文件（已 gitignore），内容 AMAP_KEY=你的key
 *   npm run fetch-amap
 *
 * 坐标为 GCJ-02，转换在 prepare-data 阶段进行，这里保存原始返回。
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = (p) => fileURLToPath(new URL(`../${p}`, import.meta.url));

function loadKey() {
  if (process.env.AMAP_KEY) return process.env.AMAP_KEY;
  const envPath = root('.env');
  if (existsSync(envPath)) {
    const m = readFileSync(envPath, 'utf8').match(/^AMAP_KEY=(.+)$/m);
    if (m) return m[1].trim();
  }
  return process.argv[2];
}

const KEY = loadKey();
if (!KEY) {
  console.error('缺少 Key：请在 .env 写入 AMAP_KEY=xxx，或通过参数传入。');
  process.exit(1);
}

/**
 * 每条线路的查询关键字与线路名匹配规则。
 * 高德命名：普通线「地铁1号线(莘庄--富锦路)」；环线「地铁4号线外圈(宜山路--宜山路)」；
 * 「轨道交通浦江线(...)」；「市域机场线(...)」（注意：关键字搜「市域机场线」反而搜不到，
 * 要用「机场线」；「后通段」为独立线路，这里排除）。
 */
const LINES = [
  ...Array.from({ length: 18 }, (_, i) => {
    const n = i + 1;
    return n === 4
      ? { no: 4, keywords: ['地铁4号线'], match: /^地铁4号线[内外]圈\(/ }
      : { no: n, keywords: [`地铁${n}号线`], match: new RegExp(`^地铁${n}号线\\(`) };
  }),
  { no: 41, keywords: ['浦江线'], match: /^轨道交通浦江线\(/ },
  { no: 51, keywords: ['机场线'], match: /^市域机场线\(/ },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 个人 Key 的 QPS 很低，限流时指数退避重试 */
async function query(keywords) {
  for (let attempt = 0; ; attempt++) {
    const url =
      'https://restapi.amap.com/v3/bus/linename?' +
      new URLSearchParams({
        key: KEY,
        city: '上海',
        keywords,
        extensions: 'all',
        output: 'json',
        offset: '20',
      });
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.info === 'CUQPS_HAS_EXCEEDED_THE_LIMIT' && attempt < 6) {
      const wait = 1000 * 2 ** attempt;
      console.log(`  限流，${wait / 1000}s 后重试…`);
      await sleep(wait);
      continue;
    }
    return data;
  }
}

function explainError(info) {
  const known = {
    USERKEY_PLAT_NOMATCH:
      'Key 的服务平台类型不匹配：Web 服务 API 需要「Web服务」类型的 Key。\n' +
      '请到高德控制台（https://console.amap.com/dev/key/app）新建一个 Key，\n' +
      '服务平台选择「Web服务」，然后更新 .env 里的 AMAP_KEY。',
    INVALID_USER_KEY: 'Key 无效，请检查是否拷贝完整。',
    DAILY_QUERY_OVER_LIMIT: '当日配额已用完，请明天再试或提升配额。',
    USER_DAILY_QUERY_OVER_LIMIT: '当日配额已用完，请明天再试或提升配额。',
  };
  return known[info] ?? `高德返回错误：${info}`;
}

const outDir = root('data/raw/amap');
mkdirSync(outDir, { recursive: true });

const force = process.argv.includes('--force');
let ok = 0;
for (const line of LINES) {
  const outFile = `${outDir}/line_${line.no}.json`;
  if (!force && existsSync(outFile)) {
    console.log(`- 线路${line.no}：已存在，跳过（--force 可强制重拉）`);
    ok++;
    continue;
  }
  let saved = false;
  for (const kw of line.keywords) {
    const data = await query(kw);
    if (data.status !== '1') {
      console.error(`✗ ${kw}: ${data.info}`);
      console.error(explainError(data.info));
      process.exit(1);
    }
    const buslines = (data.buslines ?? []).filter(
      (b) => line.match.test(b.name ?? '') && /地铁/.test(b.type ?? '')
    );
    if (buslines.length === 0) continue;
    // 只保留需要的字段，控制文件体积
    const slim = buslines.map((b) => ({
      name: b.name,
      polyline: b.polyline,
      busstops: (b.busstops ?? []).map((s) => ({ name: s.name, location: s.location })),
    }));
    writeFileSync(outFile, JSON.stringify({ no: line.no, buslines: slim }));
    console.log(
      `✓ 线路${line.no}（${kw}）：${slim.length} 个方向，` +
        `${slim.map((b) => b.busstops.length).join('/')} 站`
    );
    ok++;
    saved = true;
    break;
  }
  if (!saved) console.warn(`⚠ 线路${line.no}：未匹配到任何结果，跳过`);
  await sleep(1100);
}

console.log(`完成：${ok}/${LINES.length} 条线路已保存到 data/raw/amap/`);
console.log('下一步：npm run prepare-data 重新生成 src/data/metro.json');
