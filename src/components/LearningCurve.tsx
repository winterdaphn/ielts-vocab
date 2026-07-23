import { dayLabelShort, type LearningDayStat } from '@/utils/learningLog';

interface Props {
  data: LearningDayStat[];
}

/** Lightweight SVG learning curve — no chart library */
export default function LearningCurve({ data }: Props) {
  const max = Math.max(1, ...data.map((d) => Math.max(d.reviewed, d.newLearned)));
  const w = 320;
  const h = 96;
  const padX = 8;
  const padY = 10;
  const plotW = w - padX * 2;
  const plotH = h - padY * 2;
  const n = Math.max(1, data.length - 1);

  function pt(i: number, value: number): [number, number] {
    const x = padX + (i / n) * plotW;
    const y = padY + plotH - (value / max) * plotH;
    return [x, y];
  }

  function path(getter: (d: LearningDayStat) => number): string {
    return data
      .map((d, i) => {
        const [x, y] = pt(i, getter(d));
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }

  const today = data[data.length - 1];
  const totalReviewed = data.reduce((s, d) => s + d.reviewed, 0);
  const totalNew = data.reduce((s, d) => s + d.newLearned, 0);

  return (
    <div className="learning-curve">
      <div className="learning-curve-head">
        <h3>近 14 天学习曲线</h3>
        <p className="text-light" style={{ fontSize: 12, margin: 0 }}>
          共练 {totalReviewed} 题 · 新词 {totalNew}
          {today ? ` · 今日 ${today.reviewed}` : ''}
        </p>
      </div>
      <svg
        className="learning-curve-svg"
        viewBox={`0 0 ${w} ${h}`}
        role="img"
        aria-label="学习曲线"
      >
        <path d={path((d) => d.reviewed)} className="curve-line curve-reviewed" fill="none" />
        <path d={path((d) => d.newLearned)} className="curve-line curve-new" fill="none" />
        {data.map((d, i) => {
          const [xr, yr] = pt(i, d.reviewed);
          const [xn, yn] = pt(i, d.newLearned);
          return (
            <g key={d.day}>
              <circle cx={xr} cy={yr} r={2.2} className="curve-dot curve-reviewed" />
              {d.newLearned > 0 && (
                <circle cx={xn} cy={yn} r={2.2} className="curve-dot curve-new" />
              )}
            </g>
          );
        })}
      </svg>
      <div className="learning-curve-legend">
        <span>
          <i className="swatch reviewed" /> 练习量
        </span>
        <span>
          <i className="swatch new" /> 新词
        </span>
        <span className="curve-range">
          {dayLabelShort(data[0]?.day || '')} – {dayLabelShort(data[data.length - 1]?.day || '')}
        </span>
      </div>
    </div>
  );
}
