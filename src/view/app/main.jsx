import React, { useMemo, useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { createPortal } from "react-dom";
import { Check, ChevronRight, Copy } from "lucide-react";
import "../styles.css";

const initialData = window.__FASTEVAL_VIEW_DATA__ ?? {
  rows: [],
  lastRun: "No runs yet",
  passRate: "0%",
  resultCount: "0",
  duration: "0ms",
  cost: "$0",
};

function App({ data }) {
  const rows = data.rows ?? [];
  const [tab, setTab] = useState("experiments");
  const [sort, setSort] = useState({ key: "passRate", dir: -1 });
  const [query, setQuery] = useState("");
  const [openRows, setOpenRows] = useState(() => new Set());
  const [selectedGroup, setSelectedGroup] = useState(() => {
    const groups = [...new Set(rows.map((r) => r.group).filter(Boolean))].sort();
    return groups[0] ?? null;
  });

  const groupMap = useMemo(() => buildGroupMap(rows), [rows]);
  const pool = selectedGroup ? groupMap.get(selectedGroup) ?? [] : rows;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return pool
      .filter((row) => {
        if (!q) return true;
        return [
          row.label,
          row.group || "",
          row.experimentId || "",
          row.agent,
          row.model || "",
          ...(row.results ?? []).map((r) => r.id),
        ]
          .join(" ")
          .toLowerCase()
          .includes(q);
      })
      .sort((a, b) => compareRows(a, b, sort.key) * sort.dir);
  }, [pool, query, sort]);

  const setSortKey = (key) => {
    setSort((prev) =>
      prev.key === key ? { key, dir: prev.dir * -1 } : { key, dir: key === "experiment" || key === "agent" ? 1 : -1 },
    );
  };

  const toggleRow = (key) => {
    setOpenRows((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <>
      <header className="topbar">
        <a className="brand" href="https://github.com/CorrectRoadH/fasteval" target="_blank" rel="noreferrer">
          <span className="mark" />
          <span>fasteval</span>
        </a>
        <nav className="nav" aria-label="Report">
          {["experiments", "runs", "traces"].map((name) => (
            <button key={name} className={`nav-tab${tab === name ? " is-active" : ""}`} onClick={() => setTab(name)}>
              {name[0].toUpperCase() + name.slice(1)}
            </button>
          ))}
        </nav>
      </header>
      <main>
        <section className="hero">
          <h1>Eval Run Results</h1>
          <div className="meta">
            <span>
              <b>Last run:</b> {data.lastRun}
            </span>
          </div>
        </section>

        <section className="summary" aria-label="Run summary">
          <Metric label="Pass Rate" value={data.passRate} />
          <Metric label="Eval Results" value={data.resultCount} />
          <Metric label="Duration" value={data.duration} />
          <Metric label="Estimated Cost" value={data.cost} />
        </section>

        {tab === "experiments" && (
          <section id="tab-experiments">
            <div className="section-head">
              <h2>Experiments</h2>
            </div>
            <GroupSelector groupMap={groupMap} selectedGroup={selectedGroup} onSelect={setSelectedGroup} />
            <div className="section-sub-head">
              <span className="group-detail-label">{selectedGroup ?? ""}</span>
              <div className="controls">
                <input
                  className="search"
                  type="search"
                  placeholder="Filter experiment, agent, model, or eval..."
                  autoComplete="off"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <CopyAllErrors rows={filtered} />
              </div>
            </div>
            {rows.length ? (
              <ExperimentTable
                rows={filtered}
                sort={sort}
                setSortKey={setSortKey}
                openRows={openRows}
                toggleRow={toggleRow}
              />
            ) : (
              <div className="empty">
                No summary.json files found. Run <code>fasteval</code> or pass{" "}
                <code>fasteval view path/to/summary.json</code>.
              </div>
            )}
          </section>
        )}

        {tab === "runs" && <RunsView rows={rows} />}
        {tab === "traces" && <TracesView rows={rows} />}
      </main>
    </>
  );
}

function Metric({ label, value }) {
  return (
    <div className="metric">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
    </div>
  );
}

function GroupSelector({ groupMap, selectedGroup, onSelect }) {
  if (!groupMap.size) return <div id="group-selector" className="group-selector" />;
  return (
    <div id="group-selector" className="group-selector">
      {[...groupMap.keys()].sort().map((group) => {
        const groupRows = groupMap.get(group) ?? [];
        const allResults = groupRows.flatMap((r) => r.results ?? []);
        const passed = allResults.filter((r) => outcomeOf(r) === "passed").length;
        const failed = allResults.filter((r) => outcomeOf(r) === "failed").length;
        const errored = allResults.filter((r) => outcomeOf(r) === "errored").length;
        const passRate = allResults.length ? passed / allResults.length : 0;
        const tone = passRate >= 0.8 ? "good" : passRate >= 0.5 ? "warn" : "bad";
        const totalCost = groupRows.reduce((s, r) => s + (r.estimatedCostUSD || 0), 0);
        const lastRun = groupRows
          .map((r) => r.lastRunAt)
          .filter(Boolean)
          .sort()
          .at(-1);
        const selected = selectedGroup === group;
        return (
          <div
            key={group}
            className={`group-card${selected ? " is-selected" : ""}`}
            tabIndex={0}
            role="button"
            onClick={() => onSelect(group)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect(group);
              }
            }}
          >
            <div className="group-card-name">{group}</div>
            <div className={`group-card-rate ${tone}`}>{formatPercent(passRate)}</div>
            <div className="group-card-meta">
              {groupRows.length} experiment{groupRows.length === 1 ? "" : "s"} · {failed} failed
              {errored ? ` · ${errored} errors` : ""} · {formatCost(totalCost)}
            </div>
            {lastRun ? <div className="group-card-time">{formatDateTime(lastRun)}</div> : null}
          </div>
        );
      })}
    </div>
  );
}

function ExperimentTable({ rows, sort, setSortKey, openRows, toggleRow }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <SortHeader name="Experiment" sortKey="experiment" sort={sort} onSort={setSortKey} />
            <SortHeader name="Model" sortKey="model" sort={sort} onSort={setSortKey} />
            <SortHeader name="Agent" sortKey="agent" sort={sort} onSort={setSortKey} />
            <SortHeader name="Avg Duration" sortKey="avgDurationMs" sort={sort} onSort={setSortKey} />
            <SortHeader name="Success Rate" sortKey="passRate" sort={sort} onSort={setSortKey} />
            <SortHeader name="Tokens" sortKey="tokens" sort={sort} onSort={setSortKey} />
            <SortHeader name="Est. Cost" sortKey="cost" sort={sort} onSort={setSortKey} />
            <th>Outcomes</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <React.Fragment key={row.key}>
              <ExperimentRow row={row} open={openRows.has(row.key)} onToggle={() => toggleRow(row.key)} />
              {openRows.has(row.key) ? <ExperimentDetail row={row} /> : null}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SortHeader({ name, sortKey, sort, onSort }) {
  const sorted = sort.key === sortKey ? (sort.dir === 1 ? "asc" : "desc") : undefined;
  return (
    <th>
      <button data-sorted={sorted} onClick={() => onSort(sortKey)}>
        {name}
      </button>
    </th>
  );
}

function ExperimentRow({ row, open, onToggle }) {
  const tone = row.passRate >= 0.8 ? "good" : row.passRate >= 0.5 ? "warn" : "bad";
  return (
    <tr
      className={`main-row${open ? " is-open" : ""}`}
      tabIndex={0}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle();
        }
      }}
    >
      <td>
        <ChevronRight className="chev-icon" aria-hidden="true" />
        <span className="name">{row.label}</span>
        <div className="sub">
          {row.runs} eval result{row.runs === 1 ? "" : "s"}
          {row.lastRunAt ? ` · ${formatDateTime(row.lastRunAt)}` : ""}
        </div>
      </td>
      <td>{row.model || "default"}</td>
      <td>{row.agent}</td>
      <td className="num">{formatDuration(row.avgDurationMs)}</td>
      <td className={`num ${tone}`}>{formatPercent(row.passRate)}</td>
      <td className="num">{formatTokens(totalTokens(row.usage))}</td>
      <td className="num">{formatCost(row.estimatedCostUSD)}</td>
      <td>
        <span className="pill">{outcomeSummary(row)}</span>
      </td>
    </tr>
  );
}

function ExperimentDetail({ row }) {
  const totalDuration = (row.results ?? []).reduce((sum, r) => sum + (r.durationMs || 0), 0);
  const sampleResult =
    row.results?.find((r) => outcomeOf(r) === "errored") ||
    row.results?.find((r) => outcomeOf(r) === "failed") ||
    row.results?.[0] ||
    {};
  const results = [...(row.results ?? [])].sort((a, b) => a.id.localeCompare(b.id) || a.attempt - b.attempt);
  return (
    <tr className="detail-row">
      <td className="detail-cell" colSpan={8}>
        <div className="detail">
          <div className="config-strip">
            {configChips(row).map(([label, value]) => (
              <span className="config-chip" key={label}>
                <span>{label}</span>
                <b>{value}</b>
              </span>
            ))}
          </div>
          <div className="detail-kpis">
            <Kpi label="Attempts" value={row.runs} />
            <Kpi label="Passed" value={row.passed} className="good" />
            <Kpi label="Failed" value={row.failed} className={row.failed ? "bad" : ""} />
            <Kpi label="Errored" value={row.errored} className={row.errored ? "infra-err" : ""} />
            <Kpi label="Total Time" value={formatDuration(totalDuration)} />
            <Kpi label="Total Cost" value={formatCost(row.estimatedCostUSD)} />
            <Kpi label="Ran" value={formatDateTime(row.lastRunAt)} title={row.lastRunAt || ""} />
          </div>
          <h3>Evaluation Attempts</h3>
          <div className="eval-list">
            <div className="eval-grid-head">
              <span>Status</span>
              <span>Eval</span>
              <span>Reason</span>
              <span>Time</span>
              <span>Tokens</span>
              <span>Cost</span>
              <span>Run</span>
            </div>
            {results.map((result) => (
              <Attempt key={`${result.id}-${result.attempt}`} result={result} totalRuns={row.runs} />
            ))}
          </div>
          <details className="raw-details">
            <summary>
              Raw sample result <span className="raw-note">debug JSON, defaults to first error/failure when available</span>
            </summary>
            <pre>{JSON.stringify(sampleResult, null, 2)}</pre>
          </details>
        </div>
      </td>
    </tr>
  );
}

function Kpi({ label, value, className = "", title }) {
  return (
    <div className="detail-kpi">
      <span>{label}</span>
      <b className={className} title={title}>
        {value}
      </b>
    </div>
  );
}

function Attempt({ result, totalRuns }) {
  const [modalOpen, setModalOpen] = useState(false);
  const outcome = outcomeOf(result);
  const gates = failingAssertions(result);
  const reason = reasonFor(result, gates);
  const allAssertions = result.assertions || [];
  const hasScores = allAssertions.some((a) => a.score !== undefined && a.score !== null);
  const hasBody = result.hasEvents || result.hasTrace || hasScores;

  // Inline hint in the reason cell for passed evals that have soft scores
  const inlineScores = !reason && outcome === "passed" ? scoresSummary(allAssertions) : "";
  const displayReason = reason || inlineScores;

  const cells = (
    <>
      <span className="attempt-status">
        {hasBody ? <ChevronRight className="attempt-chev" aria-hidden="true" /> : null}
        <span className={outcomeClass(outcome)}>{outcomeLabel(outcome)}</span>
      </span>
      <span className="eval-id">{result.id}</span>
      <div className="assertions-cell">
        <span className="assertions" title={displayReason || undefined}>
          {displayReason || <span className="reason-empty">—</span>}
        </span>
        {reason ? <CopyReason text={reason} /> : null}
      </div>
      <span className="num">
        {formatDuration(result.durationMs)}
        {result.startedAt ? <small className="ran-at">{formatClock(result.startedAt)}</small> : null}
      </span>
      <span className="num">{formatTokens(totalTokens(result.usage))}</span>
      <span className="num">{formatCost(result.estimatedCostUSD)}</span>
      <span className="num" title={`attempt ${result.attempt + 1} of ${totalRuns}`}>
        #{result.attempt + 1}
      </span>
    </>
  );

  if (!hasBody) {
    return <div className="eval-item">{cells}</div>;
  }

  return (
    <>
      <div
        className="eval-item eval-item-clickable"
        role="button"
        tabIndex={0}
        onClick={() => setModalOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setModalOpen(true); }
        }}
      >
        {cells}
      </div>
      {modalOpen && (
        <AttemptModal result={result} allAssertions={allAssertions} hasScores={hasScores} onClose={() => setModalOpen(false)} />
      )}
    </>
  );
}

function AttemptModal({ result, allAssertions, hasScores, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">{result.id}</span>
          <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="modal-body">
          {hasScores ? <AssertionScores assertions={allAssertions} /> : null}
          {result.hasEvents && result.artifactBase ? (
            <LazyArtifact type="transcript" src={`${result.artifactBase}/events.json`} />
          ) : null}
          {result.hasTrace && result.artifactBase ? (
            <LazyArtifact type="trace" src={`${result.artifactBase}/trace.json`} />
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function AssertionScores({ assertions }) {
  const scored = (assertions || []).filter((a) => a.score !== undefined && a.score !== null);
  if (!scored.length) return null;
  return (
    <div className="assertion-scores">
      {scored.map((a, i) => {
        const cls = a.passed ? "good" : a.severity === "gate" ? "bad" : "warn";
        return (
          <span key={i} className={`score-chip score-chip-${cls}`}>
            <span className="score-name">{a.name}</span>
            <span className="score-val">
              {formatPercent(a.score)}
              {a.threshold !== undefined ? <span className="score-threshold">/{formatPercent(a.threshold)}</span> : null}
            </span>
          </span>
        );
      })}
    </div>
  );
}

function CopyReason({ text }) {
  const [copied, setCopied] = useState(false);
  const copy = async (event) => {
    event.stopPropagation();
    try {
      await copyText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  };
  return (
    <button className={`copy-reason${copied ? " is-copied" : ""}`} onClick={copy} aria-label="Copy reason" title="Copy reason">
      {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
    </button>
  );
}

function CopyAllErrors({ rows }) {
  const [copied, setCopied] = useState(false);

  const errorEntries = rows.flatMap((row) =>
    (row.results ?? [])
      .filter((r) => {
        const outcome = outcomeOf(r);
        return outcome === "failed" || outcome === "errored";
      })
      .map((r) => {
        const failedAssertions = failingAssertions(r);
        const reason = reasonFor(r, failedAssertions);
        const traceBase = r.artifactAbsBase || r.artifactBase;
        const tracePath = r.hasTrace && traceBase ? `${traceBase}/trace.json` : null;
        return { experimentName: row.label, evalId: r.id, reason, tracePath };
      })
  );

  if (!errorEntries.length) return null;

  const copy = async (event) => {
    event.stopPropagation();
    const text = errorEntries
      .map(({ experimentName, evalId, reason, tracePath }) =>
        [
          `实验: ${experimentName}  Eval: ${evalId}`,
          reason ? `错误: ${reason}` : null,
          tracePath ? `Trace: ${tracePath}` : null,
        ]
          .filter(Boolean)
          .join("\n")
      )
      .join("\n\n");
    try {
      await copyText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <button className={`copy-all-errors${copied ? " is-copied" : ""}`} onClick={copy} title="复制所有失败/报错的 eval 信息">
      {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      <span>{copied ? "已复制" : `复制错误 (${errorEntries.length})`}</span>
    </button>
  );
}

function LazyArtifact({ type, src }) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [content, setContent] = useState(null);
  const [error, setError] = useState("");

  const load = async () => {
    if (loaded) return;
    setLoaded(true);
    try {
      const resp = await fetch("/artifact?p=" + encodeURIComponent(src));
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      setContent(await resp.json());
      setError("");
    } catch (e) {
      setLoaded(false);
      setError(`load failed (static report has no server - use fasteval view): ${String(e)}`);
    }
  };

  return (
    <details
      className="trace-details"
      open={open}
      onToggle={(e) => {
        const isOpen = e.currentTarget.open;
        setOpen(isOpen);
        if (isOpen) void load();
      }}
    >
      <summary>{type === "transcript" ? "transcript" : "timing trace"}</summary>
      <div className="trace-slot">
        {error ? <div className="trace-span-meta">{error}</div> : !content ? <div className="trace-span-meta">loading...</div> : null}
        {content && type === "transcript" ? <Transcript events={content} /> : null}
        {content && type === "trace" ? <Trace spans={content} /> : null}
      </div>
    </details>
  );
}

function Trace({ spans }) {
  if (!spans?.length) return <div className="trace-span-meta">no spans</div>;
  const t0 = Math.min(...spans.map((s) => s.startMs));
  const t1 = Math.max(...spans.map((s) => s.endMs));
  const total = Math.max(1, t1 - t0);
  const byId = new Map(spans.map((s) => [s.spanId, s]));
  const depthOf = (span) => {
    let depth = 0;
    let cur = span;
    const seen = new Set();
    while (cur && cur.parentSpanId && byId.has(cur.parentSpanId) && !seen.has(cur.spanId)) {
      seen.add(cur.spanId);
      cur = byId.get(cur.parentSpanId);
      depth++;
      if (depth > 40) break;
    }
    return depth;
  };
  const ordered = [...spans].sort((a, b) => a.startMs - b.startMs || depthOf(a) - depthOf(b));
  return (
    <div className="trace">
      <div className="trace-span-meta">
        total {formatDuration(total)} · {spans.length} spans · click a row for details
      </div>
      {ordered.map((span) => {
        const left = ((span.startMs - t0) / total) * 100;
        const width = Math.max(0.6, ((span.endMs - span.startMs) / total) * 100);
        const kind = span.kind || "other";
        const tone = span.status === "error" ? "bad" : "k-" + kind;
        const detail = spanAttrs(span.attributes);
        const row = (
          <summary className="trace-row">
            <div className="trace-label" style={{ paddingLeft: depthOf(span) * 12 }} title={span.name}>
              {kind !== "other" ? <span className={`kind-chip k-${kind}`}>{kind}</span> : null}
              {span.name}
            </div>
            <div className="trace-track">
              <div className={`trace-bar ${tone}`} style={{ left: `${left}%`, width: `${width}%` }} />
            </div>
            <div className="trace-dur num">{formatDuration(span.endMs - span.startMs)}</div>
          </summary>
        );
        return detail ? (
          <details className="span-d" key={span.spanId}>
            {row}
            {detail}
          </details>
        ) : (
          <div className="span-d" key={span.spanId}>
            {row}
          </div>
        );
      })}
    </div>
  );
}

function spanAttrs(attrs) {
  if (!attrs) return null;
  const hide = /^(code\.|thread\.|target$|busy_ns$|idle_ns$|rpc\.|app_server\.)/;
  const keys = Object.keys(attrs).filter((k) => !hide.test(k));
  if (!keys.length) return null;
  const io = keys.filter((k) => k.startsWith("io."));
  const rest = keys.filter((k) => !k.startsWith("io.")).sort();
  return (
    <div className="span-attrs">
      {io.map((key) => {
        const label = key.replace(/^io\./, "");
        const value = String(attrs[key]);
        return label === "input" || label === "output" ? (
          <div className="attr-io" key={key}>
            <span className="attr-k">{label}</span>
            <pre className="attr-pre">{value}</pre>
          </div>
        ) : (
          <AttrRow key={key} label={label} value={value} />
        );
      })}
      {rest.map((key) => (
        <AttrRow key={key} label={key} value={typeof attrs[key] === "object" ? JSON.stringify(attrs[key]) : String(attrs[key])} />
      ))}
    </div>
  );
}

function AttrRow({ label, value }) {
  return (
    <div className="attr-row">
      <span className="attr-k">{label}</span>
      <span className="attr-v">{value}</span>
    </div>
  );
}

const TOOL_VERB = {
  file_read: "Read",
  file_write: "Write",
  file_edit: "Edit",
  shell: "Bash",
  web_fetch: "Fetch",
  web_search: "Search",
  glob: "Glob",
  grep: "Grep",
  list_dir: "List",
  agent_task: "Task",
};

function Transcript({ events }) {
  if (!Array.isArray(events) || !events.length) return <div className="trace-span-meta">no events</div>;
  const resultByCall = new Map();
  for (const event of events) {
    if (event.type === "action.result" || event.type === "subagent.completed") resultByCall.set(event.callId, event);
  }
  const pairedResult = new Set();
  return (
    <div className="transcript">
      {events.map((event, index) => {
        switch (event.type) {
          case "message":
            return <MessageBlock event={event} key={index} />;
          case "thinking":
            return <ThinkBlock event={event} key={index} />;
          case "action.called": {
            const result = resultByCall.get(event.callId);
            if (result) pairedResult.add(event.callId);
            return <ToolBlock call={event} result={result} key={index} />;
          }
          case "subagent.called": {
            const result = resultByCall.get(event.callId);
            if (result) pairedResult.add(event.callId);
            return (
              <ToolBlock
                call={{ tool: "agent_task", name: event.name, input: { description: event.name, ...(event.remoteUrl ? { remoteUrl: event.remoteUrl } : {}) } }}
                result={result}
                key={index}
              />
            );
          }
          case "action.result":
          case "subagent.completed":
            return pairedResult.has(event.callId) ? null : (
              <ToolBlock call={{ tool: "unknown", name: "result", input: null }} result={event} key={index} />
            );
          case "input.requested":
            return <InputBlock event={event} key={index} />;
          case "compaction":
            return (
              <div className="ts-compaction" key={index}>
                context compacted{event.reason ? " · " + event.reason : ""}
              </div>
            );
          case "error":
            return (
              <div className="ts-error" key={index}>
                ! {event.message || "error"}
              </div>
            );
          default:
            return null;
        }
      })}
    </div>
  );
}

function MessageBlock({ event }) {
  const who = event.role === "assistant" ? "assistant" : "user";
  return (
    <div className={`ts-msg ts-${who}`}>
      <span className="ts-role">{who}</span>
      <div className="ts-text">{event.text || ""}</div>
    </div>
  );
}

function ThinkBlock({ event }) {
  return (
    <details className="ts-think">
      <summary>thinking</summary>
      <div className="ts-think-text">{event.text || ""}</div>
    </details>
  );
}

function InputBlock({ event }) {
  const request = event.request || {};
  const opts = (request.options || []).map((o) => o.label || o.id).filter(Boolean).join("  /  ");
  const body = (request.prompt || "(awaiting input)") + (opts ? "\n[ " + opts + " ]" : "");
  return (
    <div className="ts-msg ts-input">
      <span className="ts-role">input requested</span>
      <div className="ts-text">{body}</div>
    </div>
  );
}

function ToolBlock({ call, result }) {
  const verb = TOOL_VERB[call.tool] || call.name || call.tool || "tool";
  const arg = toolPrimaryArg(call);
  const label = arg ? `${verb}(${arg})` : verb;
  const status = result ? result.status : "pending";
  const dot = status === "failed" ? "bad" : status === "rejected" ? "warn" : status === "pending" ? "pending" : "good";
  const inputStr = call.input == null ? "" : prettyJson(call.input);
  const outBody = result ? resultBody(result.output) : "";
  const preview = result ? previewText(outBody) : "running...";
  return (
    <details className="ts-tool-d">
      <summary className="ts-row">
        <span className={`ts-dot ${dot}`} />
        <span className="ts-tool" title={label}>
          {label}
        </span>
        <span className="ts-preview">{truncate(preview, 140)}</span>
      </summary>
      <div className="ts-body">
        {inputStr ? (
          <div className="ts-field">
            <span className="ts-k">input</span>
            <pre className="attr-pre">{truncate(inputStr, 4000)}</pre>
          </div>
        ) : null}
        {result ? (
          <div className="ts-field">
            <span className="ts-k">output{result.status && result.status !== "completed" ? " · " + result.status : ""}</span>
            <pre className="attr-pre">{outBody ? truncate(outBody, 8000) : <span className="reason-empty">(empty)</span>}</pre>
          </div>
        ) : null}
      </div>
    </details>
  );
}

function RunsView({ rows }) {
  const [query, setQuery] = useState("");
  const allRuns = useMemo(
    () => rows.flatMap((row) => (row.results ?? []).map((r) => ({ ...r, rowLabel: row.label, rowAgent: row.agent, rowModel: row.model }))),
    [rows],
  );
  const filtered = allRuns.filter((r) => {
    const q = query.trim().toLowerCase();
    return !q || `${r.id} ${r.rowLabel} ${r.rowAgent} ${r.rowModel || ""}`.toLowerCase().includes(q);
  });
  return (
    <section id="tab-runs">
      <div className="section-head">
        <h2>Individual Runs</h2>
        <div className="controls">
          <input
            className="search"
            type="search"
            placeholder="Filter eval ID or experiment..."
            autoComplete="off"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>
      {!allRuns.length ? (
        <div className="empty">No individual runs found.</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Eval ID</th>
                <th>Experiment</th>
                <th>Outcome</th>
                <th>Agent</th>
                <th>Model</th>
                <th>Duration</th>
                <th>Tokens</th>
                <th>Cost</th>
                <th>Ran At</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length ? (
                filtered.map((r) => {
                  const outcome = outcomeOf(r);
                  return (
                    <tr key={`${r.id}-${r.rowLabel}-${r.attempt}`}>
                      <td>
                        <span className="name">{r.id}</span>
                      </td>
                      <td>{r.rowLabel}</td>
                      <td className={outcomeClass(outcome)}>{outcomeLabel(outcome)}</td>
                      <td>{r.rowAgent}</td>
                      <td>{r.rowModel || "default"}</td>
                      <td className="num">{formatDuration(r.durationMs)}</td>
                      <td className="num">{formatTokens(totalTokens(r.usage))}</td>
                      <td className="num">{formatCost(r.estimatedCostUSD)}</td>
                      <td className="num">{r.startedAt ? formatDateTime(r.startedAt) : "-"}</td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={9} style={{ textAlign: "center", color: "var(--muted)" }}>
                    No results match the filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function TracesView({ rows }) {
  const allRuns = useMemo(
    () => rows.flatMap((row) => (row.results ?? []).map((r) => ({ ...r, rowLabel: row.label, rowAgent: row.agent, rowModel: row.model }))),
    [rows],
  );
  const traceable = allRuns.filter((r) => r.hasEvents || r.hasTrace);
  return (
    <section id="tab-traces">
      <div className="section-head">
        <h2>Traces</h2>
      </div>
      {!traceable.length ? (
        <div className="empty">No traces available. Traces are collected during eval runs when artifacts are saved.</div>
      ) : (
        traceable.map((r) => {
          const outcome = outcomeOf(r);
          return (
            <div className="traces-entry" key={`${r.id}-${r.rowLabel}-${r.attempt}`}>
              <div className="traces-entry-head">
                <span className={`${outcomeClass(outcome)} traces-verdict`}>{outcomeLabel(outcome)}</span>
                <span className="eval-id">{r.id}</span>
                <span className="traces-exp">{r.rowLabel}</span>
                <span className="num traces-dur">{formatDuration(r.durationMs)}</span>
              </div>
              {r.hasEvents && r.artifactBase ? <LazyArtifact type="transcript" src={`${r.artifactBase}/events.json`} /> : null}
              {r.hasTrace && r.artifactBase ? <LazyArtifact type="trace" src={`${r.artifactBase}/trace.json`} /> : null}
            </div>
          );
        })
      )}
    </section>
  );
}

function buildGroupMap(rows) {
  const map = new Map();
  for (const row of rows) {
    if (!row.group) continue;
    if (!map.has(row.group)) map.set(row.group, []);
    map.get(row.group).push(row);
  }
  return map;
}

function compareRows(a, b, key) {
  const av = valueFor(a, key);
  const bv = valueFor(b, key);
  if (typeof av === "string" || typeof bv === "string") return String(av).localeCompare(String(bv));
  return Number(av) - Number(bv);
}

function valueFor(row, key) {
  if (key === "experiment") return row.label;
  if (key === "model") return row.model || "";
  if (key === "agent") return row.agent;
  if (key === "cost") return row.estimatedCostUSD || 0;
  if (key === "tokens") return totalTokens(row.usage);
  return row[key] || 0;
}

function configChips(row) {
  const exp = row.experiment || {};
  const flags = exp.flags && Object.keys(exp.flags).length
    ? Object.entries(exp.flags).map(([k, v]) => k + "=" + formatConfigValue(v)).join(", ")
    : "none";
  return [
    ["experiment", row.experimentId || row.label],
    ["model", row.model || "default"],
    ["agent", row.agent],
    ["runs", exp.runs ?? row.runs],
    ["earlyExit", exp.earlyExit === undefined ? "n/a" : String(exp.earlyExit)],
    ["sandbox", exp.sandbox || "default"],
    ["budget", exp.budget === undefined ? "none" : "$" + exp.budget],
    ["flags", flags],
  ];
}

function outcomeOf(result) {
  const raw = result.outcome || (result.error ? "errored" : result.verdict);
  // "scored" = soft-only failures, no gate failed → counts as pass
  return raw === "scored" ? "passed" : raw;
}

function outcomeClass(outcome) {
  return outcome === "passed" ? "good" : outcome === "errored" ? "infra-err" : outcome === "failed" ? "bad" : "warn";
}

function outcomeLabel(outcome) {
  if (outcome === "passed") return "pass";
  if (outcome === "failed") return "fail";
  if (outcome === "errored") return "error";
  return outcome || "—";
}

// Only gate-severity failures are eval "failure reasons"; soft failures show as scores
function failingAssertions(result) {
  return (result.assertions || []).filter((a) => !a.passed && a.severity === "gate");
}

function reasonFor(result, failedGates) {
  if (result.error) return result.error;
  if (result.skipReason) return result.skipReason;
  return failedGates.map((a) => (a.detail ? `${a.name}: ${a.detail}` : a.name)).join(", ");
}

function scoresSummary(assertions) {
  const scored = (assertions || []).filter((a) => a.score !== undefined && a.score !== null);
  if (!scored.length) return "";
  return scored
    .map((a) => {
      const pct = formatPercent(a.score);
      return a.threshold !== undefined ? `${a.name} ${pct}/${formatPercent(a.threshold)}` : `${a.name} ${pct}`;
    })
    .join(" · ");
}

function outcomeSummary(row) {
  // fold "scored" (soft-only) into passed count
  const passed = (row.passed || 0) + (row.scored || 0);
  const parts = [`${passed} passed`, `${row.failed} failed`];
  if (row.errored) parts.push(`${row.errored} errors`);
  if (row.skipped) parts.push(`${row.skipped} skipped`);
  return parts.join(" / ");
}

function toolPrimaryArg(call) {
  const input = call.input;
  if (typeof input === "string") return input;
  if (!input || typeof input !== "object" || Array.isArray(input)) return "";
  if (call.tool === "shell") {
    const command = input.command ?? input.cmd;
    if (typeof command === "string") return command;
    if (Array.isArray(command)) return command.filter((x) => typeof x === "string").join(" ");
  }
  for (const key of ["path", "file", "file_path", "filename", "pattern", "query", "url", "uri", "prompt", "description", "command", "remoteUrl"]) {
    if (typeof input[key] === "string" && input[key]) return input[key];
  }
  return "";
}

function resultBody(output) {
  if (output == null) return "";
  if (typeof output === "string") return output;
  if (typeof output === "object" && !Array.isArray(output)) {
    for (const key of ["output", "stdout", "content", "text", "result", "body"]) {
      if (typeof output[key] === "string") return output[key];
    }
  }
  return prettyJson(output);
}

function prettyJson(value) {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function previewText(value) {
  return String(value).split("\n").find((line) => line.trim()) || "";
}

function truncate(value, n) {
  const str = String(value);
  return str.length > n ? str.slice(0, n) + " ... [+" + (str.length - n) + " chars]" : str;
}

function formatConfigValue(value) {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function totalTokens(usage) {
  return (usage?.inputTokens || 0) + (usage?.outputTokens || 0) + (usage?.cacheReadTokens || 0) + (usage?.cacheWriteTokens || 0);
}

function formatPercent(value) {
  return Math.round(value * 100) + "%";
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "0ms";
  if (ms >= 60000) return (ms / 60000).toFixed(1) + "m";
  if (ms >= 1000) return (ms / 1000).toFixed(2) + "s";
  return Math.round(ms) + "ms";
}

function formatTokens(value) {
  if (!Number.isFinite(value) || value <= 0) return "0";
  if (value >= 1000000) return (value / 1000000).toFixed(2) + "M";
  if (value >= 1000) return (value / 1000).toFixed(1) + "k";
  return String(Math.round(value));
}

function formatCost(value) {
  if (!Number.isFinite(value) || value <= 0) return "$0";
  return "$" + value.toFixed(value < 1 ? 3 : 2);
}

function formatDateTime(iso) {
  if (!iso) return "-";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatClock(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  document.execCommand("copy");
  ta.remove();
}

createRoot(document.getElementById("root")).render(<App data={initialData} />);
