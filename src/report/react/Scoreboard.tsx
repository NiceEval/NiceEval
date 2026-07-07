// Scoreboard:考试成绩单——总分 + 分科小计。
// 固定分母的口径不藏:没跑的题挣 0 分但留在分母里,科目行如实报 missing;
// weights 是「实际生效的权重表」,渲染出来让成绩单可审计(docs/reports.md scoreboard 公式一节)。

import type { ReactElement } from "react";
import type { ScoreboardData } from "./data.ts";
import { colorClassForKey } from "./colors.ts";
import { cx } from "./format.ts";

export function Scoreboard({
  data,
  className,
}: {
  data: ScoreboardData;
  className?: string;
}): ReactElement {
  // 科目列 = 各行 subjects 的并集,按首次出现顺序;固定分母下各行本应一致,这里防御性合并
  const subjectKeys: string[] = [];
  for (const row of data.rows) {
    for (const subject of row.subjects) {
      if (!subjectKeys.includes(subject.key)) subjectKeys.push(subject.key);
    }
  }

  return (
    <section className={cx("nre", "nre-scoreboard", className)}>
      <table className="nre-scoreboard-table">
        <thead>
          <tr>
            <th scope="col" className="nre-dimension">
              {data.of}
            </th>
            <th scope="col" className="nre-total-col">
              Total<span className="nre-full-marks">/ {data.fullMarks}</span>
            </th>
            {subjectKeys.map((key) => (
              <th scope="col" key={key} className="nre-subject-col">
                {key}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row) => (
            <tr key={row.key}>
              {/* 被打分者(如 agent):稳定散列上色,跨块同键同色 */}
              <th scope="row" className={cx("nre-row-key", "nre-key", colorClassForKey(row.key))}>
                {row.key}
              </th>
              <td className="nre-total">{row.total.display}</td>
              {subjectKeys.map((key) => {
                const subject = row.subjects.find((s) => s.key === key);
                if (!subject) return <td key={key} className="nre-td-empty" />;
                return (
                  <td key={key} className="nre-subject">
                    <span
                      className="nre-subject-score"
                      title={`${subject.evals} evals, weighted ${subject.earned} of ${subject.possible}`}
                    >
                      {subject.earned}/{subject.possible}
                    </span>
                    {/* 固定分母的如实注脚:没跑、按 0 计的题数 */}
                    {subject.missing > 0 && (
                      <span className="nre-subject-missing">{subject.missing} {subject.missing === 1 ? "eval" : "evals"} missing, scored 0</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {/* 实际生效的权重表:成绩单可审计 */}
      <p className="nre-weights">
        权重:
        {data.weights.length === 0
          ? "all evals ×1"
          : data.weights.map((w) => (
              <span key={w.prefix} className="nre-weight">
                {w.prefix} ×{w.weight}
              </span>
            ))}
        {data.weights.length > 0 && <span className="nre-weight-rest">others ×1</span>}
      </p>
    </section>
  );
}
