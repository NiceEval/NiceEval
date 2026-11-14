import { scoreSchema, classifySchema, extractSchema, batchSchema } from "../assertions/score-match-schemas.ts";
import * as Schema from "effect/Schema";
import { AGENT_JUDGE_ALGORITHM_REVISION } from "../assertions/agent-judge-revisions.ts";
import { AGENT_JUDGE_SYSTEM_PREFIX, AGENT_JUDGE_TOOL_DESCRIPTION } from "../assertions/agent-judge.prompt.ts";
import { AgentJudgeBinarySubmissionSchema, AgentJudgeGradeSubmissionSchema } from "../assertions/agent-judge-audit.ts";
import * as prompts from "../assertions/judge-presets.prompt.ts";
import * as scorePrompts from "../assertions/score-match.prompt.ts";
import { InspectionSha256 } from "../inspection/bytes.ts";
import { canonicalScoreMatchAuditJson } from "../assertions/score-match-audit.ts";
const hashIdentityPayload = (value: unknown) => new InspectionSha256().update(new TextEncoder().encode(canonicalScoreMatchAuditJson(value))).digestHex();

/** Source closure selection includes aliases and wrappers conservatively. */
export function selectsOrdinaryJudge(source: readonly (readonly [string, string])[]): boolean {
  return source.some(([, content]) => /\b(?:defineJudge|binaryJudge|factuality|faithfulness|instructionFollowing|pairwisePreference|defineScoreMatch|closeQA)\b|\.\s*judge\s*\(/u.test(content));
}

/** Text and submission schemas are the same values consumed by the gateway. */
export function agentJudgeIdentity() {
  return {
    behavior: AGENT_JUDGE_ALGORITHM_REVISION,
    content: hashIdentityPayload({
      system: AGENT_JUDGE_SYSTEM_PREFIX,
      tool: AGENT_JUDGE_TOOL_DESCRIPTION,
      binary: Schema.toJsonSchemaDocument(AgentJudgeBinarySubmissionSchema).schema,
      grade: Schema.toJsonSchemaDocument(AgentJudgeGradeSubmissionSchema).schema,
    }),
  };
}

/** Non-text rendering, admission and conversation projection use one behavior count. */
export function ordinaryJudgeIdentity() {
  return {
    behavior: 1,
    content: hashIdentityPayload({
      ...Object.fromEntries(Object.entries(prompts).filter(([, value]) => typeof value === "string")),
      binary: prompts.binaryJudgeRubric("{rubric}"),
      schemas: [scoreSchema, classifySchema, extractSchema, batchSchema].map(schema => Schema.toJsonSchemaDocument(schema).schema),
      instruction: scorePrompts.SCORE_MATCH_INSTRUCTION,
      tool: scorePrompts.SCORE_MATCH_TOOL_DESCRIPTION,
      typesafeItem: scorePrompts.typesafeItemInstructions("{rubric}", 0),
      typesafeMaterial: scorePrompts.typesafeMaterialInstructions("{rubric}"),
    }),
  };
}
