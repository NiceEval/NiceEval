// AttemptConversation:标准事件流按轮组织的完整分轮事件卡。没有 events 时零输出
// (docs/feature/reports/library/attempt-detail.md)。

import type { ReactElement, ReactNode } from "react";
import type { AttemptConversationData, AttemptConversationReply, AttemptConversationRound } from "../../model/types.ts";
import type { JsonValue, ToolName } from "../../../types.ts";
import { cx } from "../shared.ts";

const TOOL_VERB: Partial<Record<ToolName, string>> = {
  shell: "Bash",
  file_read: "Read",
  file_write: "Write",
  file_edit: "Edit",
  web_fetch: "Fetch",
  web_search: "Search",
  glob: "Glob",
  grep: "Grep",
  list_dir: "List",
  agent_task: "Task",
};

function compact(value: JsonValue | undefined, max = 140): string {
  if (value === undefined || value === null) return "";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
}

function toolPrimaryArg(input: JsonValue): string {
  if (typeof input === "string") return compact(input, 80);
  if (input === null || Array.isArray(input) || typeof input !== "object") return "";
  for (const key of ["command", "cmd", "path", "file", "file_path", "pattern", "query", "url", "prompt", "description"]) {
    const value = input[key];
    if (typeof value === "string" && value) return compact(value, 80);
    if (key === "command" && Array.isArray(value)) return compact(value.filter((item) => typeof item === "string").join(" "), 80);
  }
  return compact(input, 80);
}

function ReplyRow({ reply }: { reply: AttemptConversationReply }): ReactNode {
  switch (reply.kind) {
    case "assistant":
      return (
        <div className="nre-conv-assistant">
          <span className="nre-conv-role">assistant</span>
          <div className="nre-conv-text">{reply.text}</div>
        </div>
      );
    case "user":
      return (
        <div className="nre-conv-user">
          <span className="nre-conv-role">user</span>
          <div className="nre-conv-text">{reply.text}</div>
        </div>
      );
    case "thinking":
      return (
        <details className="nre-conv-thinking">
          <summary>thinking</summary>
          <div className="nre-conv-text">{reply.text}</div>
        </details>
      );
    case "error":
      return <div className="nre-conv-error">! {reply.text}</div>;
    case "skill":
      return (
        <div className="nre-conv-skill">
          <span className="nre-conv-role">skill loaded</span> {reply.skill}
        </div>
      );
    case "tool":
      const verb = (reply.tool ? TOOL_VERB[reply.tool] : undefined) ?? reply.name;
      const arg = toolPrimaryArg(reply.input);
      const preview = compact(reply.output);
      return (
        <details className="nre-conv-tool">
          <summary>
            <span className={cx("nre-conv-tool-dot", reply.status ? `nre-conv-tool-${reply.status}` : "nre-conv-tool-pending")} />
            <span className="nre-conv-tool-name" title={arg ? `${verb}(${arg})` : verb}>
              {arg ? `${verb}(${arg})` : verb}
            </span>
            <span className="nre-conv-tool-preview">
              {reply.status ?? "pending"}
              {preview ? ` · ${preview}` : ""}
            </span>
          </summary>
          <pre className="nre-conv-tool-io">{JSON.stringify(reply.input, null, 2)}</pre>
          {reply.output !== undefined ? <pre className="nre-conv-tool-io">{JSON.stringify(reply.output, null, 2)}</pre> : null}
        </details>
      );
    case "subagent":
      return (
        <details className="nre-conv-subagent">
          <summary>
            subagent {reply.name}
            {reply.status ? ` · ${reply.status}` : ""}
          </summary>
          {reply.output !== undefined ? <pre className="nre-conv-tool-io">{JSON.stringify(reply.output, null, 2)}</pre> : null}
        </details>
      );
    case "input":
      return <div className="nre-conv-input">input requested{reply.request.prompt ? `: ${reply.request.prompt}` : ""}</div>;
    case "compaction":
      return <div className="nre-conv-compaction">compaction{reply.reason ? `: ${reply.reason}` : ""}</div>;
    case "raw":
      return (
        <details className="nre-conv-raw">
          <summary>unrecognized event</summary>
          <pre className="nre-conv-tool-io">{JSON.stringify(reply.raw, null, 2)}</pre>
        </details>
      );
  }
}

/** AttemptSource 复用同一份回复 renderer，把一轮执行挂回对应的 send 源码行。 */
export function ConversationReplies({ replies }: { replies: AttemptConversationReply[] }): ReactElement {
  return (
    <div className="nre-conv-replies">
      {replies.map((reply, i) => (
        <ReplyRow key={i} reply={reply} />
      ))}
    </div>
  );
}

function RoundCard({ round, index }: { round: AttemptConversationRound; index: number }): ReactElement {
  return (
    <div className="nre-conv-round">
      <div className="nre-conv-round-head">
        round {index + 1}
        {round.loc ? (
          <span className="nre-conv-round-loc" title={`${round.loc.file}:${round.loc.line}`}>
            {round.loc.file.split("/").pop()}:{round.loc.line}
          </span>
        ) : null}
      </div>
      {round.sentText ? <div className="nre-conv-sent">{round.sentText}</div> : null}
      <ConversationReplies replies={round.replies} />
    </div>
  );
}

export function AttemptConversation({
  data,
  className,
}: {
  data: AttemptConversationData | null;
  className?: string;
}): ReactElement | null {
  if (data === null) return null;
  return (
    <div className={cx("nre", "nre-attempt-conversation", className)}>
      {data.rounds.map((round, i) => (
        <RoundCard key={i} round={round} index={i} />
      ))}
    </div>
  );
}
