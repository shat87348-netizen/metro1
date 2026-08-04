import { useCallback, useEffect, useMemo, useState } from 'react';
import MetroMap, { INITIAL_ZOOM } from './components/MetroMap';
import SidePanel from './components/SidePanel';
import { buildNetwork } from './lib/network';
import { getTrains } from './lib/simulation';
import { createStaticLayers, createTrainLayers } from './lib/layers';
import type { MetroData } from './types';
import metroJson from './data/metro.json';

/** 列车位置刷新周期；列车移动缓慢，5Hz 已足够平滑 */
const TICK_MS = 200;
const STATION_LABEL_MIN_ZOOM = 10.5;
const TRAIN_LABEL_MIN_ZOOM = 11.5;

export default function App() {
  const network = useMemo(() => buildNetwork(metroJson as MetroData), []);

  const [nowMs, setNowMs] = useState(() => Date.now());
  const [showStationLabels, setShowStationLabels] = useState(true);
  const [showTrainLabels, setShowTrainLabels] = useState(true);
  const [zoom, setZoom] = useState(INITIAL_ZOOM);

  // 实时时钟：跟随真实时间推进
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, []);

  // 缩放变化只在跨过标签显示阈值时触发重渲染
  const onZoomChange = useCallback((next: number) => {
    setZoom((prev) => {
      const crossed =
        prev >= STATION_LABEL_MIN_ZOOM !== next >= STATION_LABEL_MIN_ZOOM ||
        prev >= TRAIN_LABEL_MIN_ZOOM !== next >= TRAIN_LABEL_MIN_ZOOM;
      return crossed ? next : prev;
    });
  }, []);

  const simDate = useMemo(() => new Date(nowMs), [nowMs]);
  const trains = useMemo(() => getTrains(network, simDate), [network, simDate]);

  const trainCounts = useMemo(() => {
    const counts = new Map<number, number>();
    for (const train of trains) {
      counts.set(train.lineNo, (counts.get(train.lineNo) ?? 0) + 1);
    }
    return counts;
  }, [trains]);

  const staticLayers = useMemo(
    () => createStaticLayers(network, showStationLabels && zoom >= STATION_LABEL_MIN_ZOOM),
    [network, showStationLabels, zoom]
  );
  const trainLayers = useMemo(
    () => createTrainLayers(trains, showTrainLabels && zoom >= TRAIN_LABEL_MIN_ZOOM),
    [trains, showTrainLabels, zoom]
  );
  const layers = useMemo(() => [...staticLayers, ...trainLayers], [staticLayers, trainLayers]);

  return (
    <div className="app">
      <MetroMap layers={layers} onZoomChange={onZoomChange} />
      <SidePanel
        network={network}
        simDate={simDate}
        showStationLabels={showStationLabels}
        onToggleStationLabels={() => setShowStationLabels((v) => !v)}
        showTrainLabels={showTrainLabels}
        onToggleTrainLabels={() => setShowTrainLabels((v) => !v)}
        trainCounts={trainCounts}
        totalTrains={trains.length}
      />
    </div>
  );
}
