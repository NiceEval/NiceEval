import type { RowRun, T } from "../shared.ts";
import { verdictClass, verdictLabel } from "../lib/verdict.ts";
import { formatDuration } from "../lib/format.ts";
import { LazyArtifact } from "../components/LazyArtifact.tsx";

/** 全部历史 attempt 的 trace/transcript 视图;列表在 App 里由 flattenAttempts 算好。 */
export function TracesView({ attempts, t }: { attempts: RowRun[]; t: T }) {
  const traceable = attempts.filter((r: RowRun) => r.hasEvents || r.hasTrace);
  return (
    <section id="tab-traces">
      <div className="section-head">
        <h2>{t("section.traces")}</h2>
      </div>
      {!traceable.length ? (
        <div className="empty">{t("empty.traces")}</div>
      ) : (
        traceable.map((r: RowRun) => {
          const verdict = r.verdict;
          return (
            <div className="traces-entry" key={`${r.id}-${r.rowLabel}-${r.attempt}`}>
              <div className="traces-entry-head">
                <span className={`${verdictClass(verdict)} traces-verdict`}>{verdictLabel(verdict, t)}</span>
                <span className="eval-id">{r.id}</span>
                <span className="traces-exp">{r.rowLabel}</span>
                <span className="num traces-dur">{formatDuration(r.durationMs)}</span>
              </div>
              {r.hasEvents && r.artifactBase ? <LazyArtifact type="transcript" src={`${r.artifactBase}/events.json`} t={t} /> : null}
              {r.hasTrace && r.artifactBase ? <LazyArtifact type="trace" src={`${r.artifactBase}/trace.json`} t={t} /> : null}
            </div>
          );
        })
      )}
    </section>
  );
}
