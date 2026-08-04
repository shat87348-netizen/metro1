import type { Network } from '../lib/network';
import { headwayMinutesAt } from '../lib/simulation';

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

function formatClock(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function formatHeadway(minutes: number): string {
  const m = Math.floor(minutes);
  const s = Math.round((minutes - m) * 60);
  if (s === 0) return `${m}分`;
  if (m === 0) return `${s}秒`;
  return `${m}分${s.toString().padStart(2, '0')}秒`;
}

interface Props {
  network: Network;
  simDate: Date;
  showStationLabels: boolean;
  onToggleStationLabels: () => void;
  showTrainLabels: boolean;
  onToggleTrainLabels: () => void;
  trainCounts: ReadonlyMap<number, number>;
  totalTrains: number;
}

export default function SidePanel({
  network,
  simDate,
  showStationLabels,
  onToggleStationLabels,
  showTrainLabels,
  onToggleTrainLabels,
  trainCounts,
  totalTrains,
}: Props) {
  const inService = totalTrains > 0;
  return (
    <aside className="panel">
      <header className="p-head">
        <span className="p-mark" aria-hidden="true" />
        <div className="p-title">
          <span className="p-title-cn">上海地铁运行图</span>
          <span className="p-title-en">Shanghai Metro — Live Map</span>
        </div>
      </header>

      <div className="p-clock">
        <span className="p-time">{formatClock(simDate)}</span>
        <div className="p-meta">
          <span className="p-day">周{WEEKDAYS[simDate.getDay()]}</span>
          <span className={inService ? 'p-status on' : 'p-status off'}>
            {inService ? (
              <>
                <b>{totalTrains}</b> 班在途
              </>
            ) : (
              '停运时段'
            )}
          </span>
        </div>
      </div>

      <div className="p-controls">
        <div className="p-seg">
          <button
            className={`p-btn p-btn-wide ${showStationLabels ? 'is-on' : ''}`}
            onClick={onToggleStationLabels}
          >
            站名
          </button>
          <button
            className={`p-btn p-btn-wide ${showTrainLabels ? 'is-on' : ''}`}
            onClick={onToggleTrainLabels}
          >
            列车标签
          </button>
        </div>
      </div>

      <div className="p-lines">
        <div className="p-lines-head">
          <span>线路 / Line</span>
          <span>间隔</span>
          <span>在途</span>
        </div>
        <div className="p-lines-body">
          {network.lines.map((line) => {
            const count = trainCounts.get(line.no) ?? 0;
            return (
              <div key={line.no} className="p-line">
                <span className="p-line-bar" style={{ background: line.color }} />
                <span className="p-line-name">{line.name}</span>
                <span className="p-line-headway">{formatHeadway(headwayMinutesAt(line, simDate))}</span>
                <span className={`p-line-count ${count > 0 ? '' : 'zero'}`}>{count}</span>
              </div>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
