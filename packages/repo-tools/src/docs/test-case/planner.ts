import { Match, Result } from "effect";

import { CaseAlreadyCurrent, RelationAlreadyCurrent, RelationNotCurrent } from "./errors.js";
import { selectCurrentCase, type CaseSelector } from "./selector.js";
import type { CaseHistory, CaseIssue, CaseRelation, CaseRelationsSidecar } from "./sidecar.js";

interface Audit { readonly atCommit: string; readonly transactionId: string }
export type CaseRelationAction =
  | { readonly _tag: "AttachCase"; readonly selector: CaseSelector; readonly owner: string }
  | { readonly _tag: "RetireCase"; readonly selector: CaseSelector; readonly reason: string }
  | { readonly _tag: "SetOwner"; readonly selector: CaseSelector; readonly owner: string }
  | { readonly _tag: "AddRegression"; readonly selector: CaseSelector; readonly memory: string }
  | { readonly _tag: "RetireRegression"; readonly selector: CaseSelector; readonly memory: string; readonly reason: string }
  | { readonly _tag: "AddIssue"; readonly selector: CaseSelector; readonly issue: CaseIssue }
  | { readonly _tag: "RetireIssue"; readonly selector: CaseSelector; readonly url: string; readonly reason: string };

function history(audit: Audit, caseId: string, action: CaseHistory["action"], from?: Record<string, unknown>, to?: Record<string, unknown>, reason?: string): CaseHistory {
  return { caseId, atCommit: audit.atCommit, transactionId: audit.transactionId, action, ...(from === undefined ? {} : { from }), ...(to === undefined ? {} : { to }), ...(reason === undefined ? {} : { reason }) } as CaseHistory;
}

function updated(sidecar: CaseRelationsSidecar, caseId: string, relation: CaseRelation, event: CaseHistory): CaseRelationsSidecar {
  return { ...sidecar, current: { ...sidecar.current, [caseId]: relation }, history: [...sidecar.history, event] };
}

export function planCaseRelation(sidecar: CaseRelationsSidecar, action: CaseRelationAction, audit: Audit) {
  const selectorText = (selector: CaseSelector) => `${selector.path}#${selector.caseId}`;
  const current = (selector: CaseSelector) => selectCurrentCase(sidecar, selector);
  return Match.value(action).pipe(Match.tags({
    AttachCase: ({ selector, owner }) => Object.hasOwn(sidecar.current, selector.caseId)
      ? Result.fail(new CaseAlreadyCurrent({ selector: selectorText(selector) }))
      : Result.succeed(updated(sidecar, selector.caseId, { owner, regressions: [], issues: [] }, history(audit, selector.caseId, "case-attached", undefined, { owner }))),
    RetireCase: ({ selector, reason }) => Result.map(current(selector), (relation) => {
      const next = { ...sidecar.current }; delete next[selector.caseId];
      return { ...sidecar, current: next, history: [...sidecar.history, history(audit, selector.caseId, "case-retired", relation as unknown as Record<string, unknown>, undefined, reason)], tombstones: [...sidecar.tombstones, { caseId: selector.caseId, lastSelector: selectorText(selector), lastRelation: relation, retiredAtCommit: audit.atCommit, transactionId: audit.transactionId, reason }] };
    }),
    SetOwner: ({ selector, owner }) => Result.map(current(selector), (relation) => updated(sidecar, selector.caseId, { ...relation, owner }, history(audit, selector.caseId, "owner-set", { owner: relation.owner }, { owner }))),
    AddRegression: ({ selector, memory }) => Result.flatMap(current(selector), (relation) => relation.regressions.includes(memory)
      ? Result.fail(new RelationAlreadyCurrent({ selector: selectorText(selector), relation: "regression", value: memory }))
      : Result.succeed(updated(sidecar, selector.caseId, { ...relation, regressions: [...relation.regressions, memory].sort() }, history(audit, selector.caseId, "regression-added", undefined, { memory })))),
    RetireRegression: ({ selector, memory, reason }) => Result.flatMap(current(selector), (relation) => !relation.regressions.includes(memory)
      ? Result.fail(new RelationNotCurrent({ selector: selectorText(selector), relation: "regression", value: memory }))
      : Result.succeed(updated(sidecar, selector.caseId, { ...relation, regressions: relation.regressions.filter((value) => value !== memory) }, history(audit, selector.caseId, "regression-retired", { memory }, undefined, reason)))),
    AddIssue: ({ selector, issue }) => Result.flatMap(current(selector), (relation) => relation.issues.some((currentIssue) => currentIssue.url === issue.url)
      ? Result.fail(new RelationAlreadyCurrent({ selector: selectorText(selector), relation: "issue", value: issue.url }))
      : Result.succeed(updated(sidecar, selector.caseId, { ...relation, issues: [...relation.issues, issue].sort((a, b) => a.url.localeCompare(b.url)) }, history(audit, selector.caseId, "issue-added", undefined, { url: issue.url })))),
    RetireIssue: ({ selector, url, reason }) => Result.flatMap(current(selector), (relation) => !relation.issues.some((issue) => issue.url === url)
      ? Result.fail(new RelationNotCurrent({ selector: selectorText(selector), relation: "issue", value: url }))
      : Result.succeed(updated(sidecar, selector.caseId, { ...relation, issues: relation.issues.filter((issue) => issue.url !== url) }, history(audit, selector.caseId, "issue-retired", { url }, undefined, reason)))),
  }), Match.exhaustive);
}

export interface CaseMovePlan {
  readonly source: CaseRelationsSidecar;
  readonly target: CaseRelationsSidecar;
}

export function planCaseMove(
  source: CaseRelationsSidecar,
  target: CaseRelationsSidecar,
  selector: CaseSelector,
  audit: Audit,
): Result.Result<CaseMovePlan, import("./errors.js").CaseNotCurrent | import("./errors.js").CasePathStale | CaseAlreadyCurrent> {
  const selected = selectCurrentCase(source, selector);
  if (Result.isFailure(selected)) return Result.fail(selected.failure);
  const targetSelector = `${target.testFile}#${selector.caseId}`;
  if (Object.hasOwn(target.current, selector.caseId) || target.tombstones.some((entry) => entry.caseId === selector.caseId)) {
    return Result.fail(new CaseAlreadyCurrent({ selector: targetSelector }));
  }
  const sourceCurrent = { ...source.current };
  delete sourceCurrent[selector.caseId];
  const event = history(audit, selector.caseId, "case-moved", { path: source.testFile }, { path: target.testFile });
  return Result.succeed({
    source: { ...source, current: sourceCurrent, history: [...source.history, event] },
    target: { ...target, current: { ...target.current, [selector.caseId]: selected.success }, history: [...target.history, event] },
  });
}
