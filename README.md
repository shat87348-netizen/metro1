# 上海地铁运行图

在暗色地图上实时模拟上海地铁全网列车运行：20 条线路、519 个站点，列车位置基于官方时刻表与发车间隔静态推算。

技术栈：Vite + React + TypeScript + deck.gl + MapLibre（免费 CARTO 底图，无需任何 token）。

## 快速开始

```bash
npm install
npm run dev      # 开发服务器
npm run build    # 类型检查 + 生产构建，产物在 dist/
```

## 架构

```
data/raw/                 原始爬虫数据（约 6MB，仅预处理时使用）
scripts/prepare-data.mjs  离线预处理：清洗为 src/data/metro.json（约 97KB）
src/
  types.ts                metro.json 的数据结构定义
  lib/
    network.ts            运行时模型：预计算每段移动/停站毫秒数
    simulation.ts         纯函数：给定模拟时刻 → 全网在途列车位置
    geometry.ts           带朝向的列车矩形（经纬度多边形）
    layers.ts             deck.gl 图层构建（线路/站点/站名/列车）
    color.ts              颜色工具
  components/
    MetroMap.tsx           DeckGL + MapLibre 底图
    SidePanel.tsx          时钟、倍速、标签开关、各线间隔与在途班次
  App.tsx                 模拟时钟（真实流逝 × 倍速）与状态编排
```

### 数据预处理（`npm run prepare-data`）

原始数据只在这一步被读取，做三件事：

1. **站点**：只保留坐标有效的站点（名称 + 经纬度）。
2. **交路**：时刻表按 description（方向/终点）分组；用首末班时间差的
   多数表决判断站序方向（部分方向按终点在前排列且 first_time 全为 `--`）；
   支线线路（如 5 号线）的回程会把两条支线拼进同一组，检测到「某组站点
   集合恰好等于另外两组的并集」时拆解为两条独立交路；相邻站运行时长取
   首/末班时间差的较小值，夹取到 0.5–45 分钟。
3. **发车间隔**：按星期分组，时间窗（如 07:00-09:00）→ 间隔分钟数；
   分段间隔取最密一段。

### 运行模拟

每个交路从 05:00 起按当时生效的发车间隔连续发车，22:30 停止发车，已发出
的列车跑完全程。每段的最后 30 秒（不超过该段一半）视为停站。列车位置每
200ms 刷新一次；静态图层（线路/站点）缓存复用，缩放只在跨过标签显示阈值
时才触发重渲染。

## 部署

纯静态站点，`npm run build` 后把 `dist/` 部署到任意静态托管即可
（Cloudflare Pages：构建命令 `npm run build`，输出目录 `dist`）。

## 高德线路几何（可选增强）

默认线路是站点间直连。接入高德「公交信息查询」API 后，线路会使用真实
轨道几何（polyline），站点坐标也会被修正到线上，列车沿真实曲线行驶：

1. 在[高德控制台](https://console.amap.com/dev/key/app)创建 Key，
   **服务平台必须选「Web服务」**（Web端 JS API / Android / iOS 类型的
   Key 调用 REST 接口会报 `USERKEY_PLAT_NOMATCH`）。
2. 项目根目录建 `.env`（已 gitignore）：`AMAP_KEY=你的key`
3. 运行：

```bash
npm run fetch-amap && npm run prepare-data
```

拉取结果存在 `data/raw/amap/`（GCJ-02 原始坐标），预处理时转换为
WGS-84（`scripts/gcj02.mjs`）再与官方时刻表按站名匹配合并；匹配失败的
交路自动退回站点直连并在日志中提示。高德数据仅在预处理阶段使用，Key
不会进入前端产物。

## 数据说明

- 时刻表与发车间隔来源为官方数据快照（见 `data/raw/`，抓取于 2025-08），
  列车位置为推算结果，非实时数据。
- 更新时刻表数据：替换 `data/raw/` 下的文件后运行 `npm run prepare-data`。
- 一条线路的多个交路按方向数摊分发车频率并错峰，使重叠区段的合流频率
  等于公布的发车间隔。
