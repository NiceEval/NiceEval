import { stringify as stringifyYaml } from "yaml";

import {
  PR_BODY_CASE_DIRECTIONS,
  PR_BODY_CASE_SECTIONS,
  PR_BODY_TERMINOLOGY_DIRECTIONS,
  isPrBodyRecordVersion,
  isPrBodyTerminologyCanonical,
  type EditPrBodyInput,
  type PrBodyCase,
  type PrBodyEnvironmentCase,
  type PrBodyPrivatePersistedCase,
  type PrBodyRecordSection,
  type PrBodyCaseSection,
  type PrBodyEditorState,
  type PrBodyTerminologyCase,
  type PrBodyUseCase,
  type TestDirective,
} from "./model.js";

const SECTION_LABELS: Readonly<Record<PrBodyCaseSection, string>> = Object.freeze({
  "public-api": "Public API",
  cli: "CLI",
  "report-components": "Report components",
  "observable-behavior": "Observable behavior and data contracts",
  "package-scripts": "Package scripts",
});

const DEFAULT_LANGUAGES: Readonly<Record<PrBodyCaseSection, string>> = Object.freeze({
  "public-api": "ts",
  cli: "sh",
  "report-components": "tsx",
  "observable-behavior": "text",
  "package-scripts": "sh",
});

export const emptyPrBodyEditorState = (): PrBodyEditorState => Object.freeze({
  version: 2,
  cases: Object.freeze([]),
  useCases: Object.freeze([]),
  tests: Object.freeze([]),
});

export function editorStateComment(state: PrBodyEditorState): string {
  return `<!-- niceeval:pr-editor\n${stringifyYaml(state).trimEnd()}\n-->`;
}

function sameCase(left: PrBodyCase, right: Pick<PrBodyCase, "section" | "direction" | "name">): boolean {
  return left.section === right.section && left.direction === right.direction && left.name === right.name;
}

function testFromInput(input: Extract<EditPrBodyInput, { readonly operation: "test-set" }>): TestDirective {
  const source: TestDirective["source"] = input.sourceMode === "link"
    ? "link"
    : input.fragmentFrom.length === 0
    ? "full"
    : {
        fragments: input.fragmentFrom.map((from, index) => ({ from, through: input.fragmentThrough[index]! })),
        reason: input.fragmentReason!,
      };
  return {
    path: input.selector.slice(0, input.selector.lastIndexOf("#")),
    cases: [{ selector: input.selector, behavior: input.behavior, entry: input.entry, assertion: input.assertion, escape: input.escape, ...(input.regression === undefined ? {} : { regression: input.regression }) }],
    source,
  };
}

function sameUseCase(left: PrBodyUseCase, right: Pick<PrBodyUseCase, "direction" | "name">): boolean {
  return left.direction === right.direction && left.name === right.name;
}

function sameNamedDirection(
  left: Pick<PrBodyEnvironmentCase | PrBodyTerminologyCase, "direction" | "name">,
  right: Pick<PrBodyEnvironmentCase | PrBodyTerminologyCase, "direction" | "name">,
): boolean {
  return left.direction === right.direction && left.name === right.name;
}

function samePrivatePersisted(left: PrBodyPrivatePersistedCase, right: Pick<PrBodyPrivatePersistedCase, "name">): boolean {
  return left.name === right.name;
}

function withRecord(state: PrBodyEditorState, record: PrBodyRecordSection): PrBodyEditorState {
  const hasContent = record.newWrite !== undefined
    || record.existingRead !== undefined
    || record.upgrade !== undefined
    || (record.privatePersisted?.length ?? 0) > 0;
  if (hasContent) return { ...state, record };
  const { record: _record, ...withoutRecord } = state;
  return withoutRecord;
}

export function updateEditorState(state: PrBodyEditorState, input: EditPrBodyInput): PrBodyEditorState {
  switch (input.operation) {
    case "reset":
      return emptyPrBodyEditorState();
    case "problem":
      return {
        ...state,
        problem: {
          userGoal: input.userGoal,
          currentLimitation: input.currentLimitation,
          requiredCapability: input.requiredCapability,
          userOutcome: input.userOutcome,
        },
      };
    case "closing-issue-add":
      return { ...state, closingIssues: [...new Set([...(state.closingIssues ?? []), input.issue])].sort((a, b) => a - b) };
    case "closing-issue-remove":
      return { ...state, closingIssues: (state.closingIssues ?? []).filter((issue) => issue !== input.issue) };
    case "case-set": {
      const item: PrBodyCase = {
        section: input.section,
        direction: input.direction,
        name: input.name,
        beforeInput: input.beforeInput,
        beforeOutput: input.beforeOutput,
        ...(input.afterInput === undefined ? {} : { afterInput: input.afterInput }),
        afterOutput: input.afterOutput,
        userImpact: input.userImpact,
        ...(input.language === undefined ? {} : { language: input.language }),
      };
      return { ...state, cases: [...state.cases.filter((entry) => !sameCase(entry, item)), item] };
    }
    case "case-remove":
      return { ...state, cases: state.cases.filter((entry) => !sameCase(entry, input)) };
    case "use-case-set": {
      const item: PrBodyUseCase = { direction: input.direction, name: input.name, contract: input.contract, startingState: input.startingState, action: input.action, result: input.result, explanation: input.explanation, ...(input.language === undefined ? {} : { language: input.language }) };
      return { ...state, useCases: [...state.useCases.filter((entry) => !sameUseCase(entry, item)), item] };
    }
    case "use-case-remove":
      return { ...state, useCases: state.useCases.filter((entry) => !sameUseCase(entry, input)) };
    case "record-new-write-set":
      return withRecord(state, { ...state.record, newWrite: { action: input.action, result: input.result } });
    case "record-new-write-remove": {
      const { newWrite: _newWrite, ...record } = state.record ?? {};
      return withRecord(state, record);
    }
    case "record-existing-read-set":
      return withRecord(state, { ...state.record, existingRead: { action: input.action, result: input.result } });
    case "record-existing-read-remove": {
      const { existingRead: _existingRead, ...record } = state.record ?? {};
      return withRecord(state, record);
    }
    case "record-upgrade-set":
      return withRecord(state, { ...state.record, upgrade: {
        version: input.version,
        beforeInput: input.beforeInput,
        beforeOutput: input.beforeOutput,
        afterInput: input.afterInput,
        afterOutput: input.afterOutput,
        safety: input.safety,
        userImpact: input.userImpact,
        evidence: input.evidence,
      } });
    case "record-upgrade-remove": {
      const { upgrade: _upgrade, ...record } = state.record ?? {};
      return withRecord(state, record);
    }
    case "record-private-set": {
      const item: PrBodyPrivatePersistedCase = {
        name: input.name,
        before: input.before,
        after: input.after,
        userImpact: input.userImpact,
      };
      return withRecord(state, {
        ...state.record,
        privatePersisted: [...(state.record?.privatePersisted ?? []).filter((entry) => !samePrivatePersisted(entry, item)), item],
      });
    }
    case "record-private-remove":
      return withRecord(state, {
        ...state.record,
        privatePersisted: (state.record?.privatePersisted ?? []).filter((entry) => !samePrivatePersisted(entry, input)),
      });
    case "environment-set": {
      const item: PrBodyEnvironmentCase = {
        direction: input.direction,
        name: input.name,
        beforeInput: input.beforeInput,
        beforeOutput: input.beforeOutput,
        ...(input.afterInput === undefined ? {} : { afterInput: input.afterInput }),
        ...(input.afterOutput === undefined ? {} : { afterOutput: input.afterOutput }),
        boundary: input.boundary,
        ...(input.necessity === undefined ? {} : { necessity: input.necessity }),
        securityImpact: input.securityImpact,
      };
      return { ...state, environment: [...(state.environment ?? []).filter((entry) => !sameNamedDirection(entry, item)), item] };
    }
    case "environment-remove":
      return { ...state, environment: (state.environment ?? []).filter((entry) => !sameNamedDirection(entry, input)) };
    case "terminology-set": {
      const item: PrBodyTerminologyCase = {
        direction: input.direction,
        name: input.name,
        before: input.before,
        after: input.after,
        explanation: input.explanation,
        canonical: input.canonical,
      };
      return { ...state, terminology: [...(state.terminology ?? []).filter((entry) => !sameNamedDirection(entry, item)), item] };
    }
    case "terminology-remove":
      return { ...state, terminology: (state.terminology ?? []).filter((entry) => !sameNamedDirection(entry, input)) };
    case "test-set": {
      const test = testFromInput(input);
      const existing = state.tests.find((entry) => entry.path === test.path);
      const combined = existing === undefined ? test : { ...test, cases: [...existing.cases.filter((entry) => entry.selector !== input.selector), ...test.cases] };
      return { ...state, tests: [...state.tests.filter((entry) => entry.path !== test.path), combined] };
    }
    case "test-remove":
      return { ...state, tests: state.tests.flatMap((entry) => {
        const cases = entry.cases.filter((item) => item.selector !== input.selector);
        return cases.length === 0 ? [] : [{ ...entry, cases }];
      }) };
    case "verification":
      return { ...state, verification: {
        candidate: input.candidate,
        red: input.red,
        green: input.green,
        repeatability: input.repeatability,
        fixedConditions: input.fixedConditions,
        unitCount: input.unitCount,
      } };
  }
}

function hasCommentClose(value: string): boolean {
  return value.includes("-->");
}

function hasFenceLine(value: string): boolean {
  return /^```/m.test(value);
}

export function editorInputFinding(input: EditPrBodyInput): string | undefined {
  const values = Object.values(input).filter((value): value is string => typeof value === "string");
  if (values.some(hasCommentClose)) return "editor values cannot contain the HTML comment terminator -->";
  if (input.operation === "verification" && values.some((value) => value.includes("\n"))) {
    return "Verification receipt fields must each be one line";
  }
  if (input.operation === "problem" && [
    input.userGoal,
    input.currentLimitation,
    input.requiredCapability,
    input.userOutcome,
  ].some((value) => value.includes("\n"))) {
    return "Problem fields must each be one line";
  }
  if (input.operation === "case-set") {
    if (input.direction !== "removed" && input.afterInput === undefined) {
      return `${input.direction} cases require --after-input`;
    }
    if ([input.beforeInput, input.beforeOutput, input.afterInput, input.afterOutput].some(
      (value) => value !== undefined && hasFenceLine(value),
    )) {
      return "case examples cannot contain a line beginning with ```";
    }
    if (input.name.includes("\n") || input.userImpact.includes("\n")) {
      return "case names and User impact must each be one line";
    }
    if (input.language !== undefined && !/^[A-Za-z0-9_+.-]+$/.test(input.language)) {
      return "case language must be a Markdown fence language identifier";
    }
  }
  if (input.operation === "test-set" && [
    input.selector,
    input.behavior,
    input.entry,
    input.assertion,
    input.escape,
    input.regression,
  ].some((value) => value?.includes("\n") === true)) {
    return "test case narrative fields must each be one line";
  }
  if (input.operation === "test-set") {
    if (!/^e2e\/.+#neref_[0-9a-f]{32}$/.test(input.selector)) return "test selector must identify a derived test reference in e2e/<path>";
    if (input.fragmentFrom.length !== input.fragmentThrough.length) {
      return "--fragment-from and --fragment-through must be repeated the same number of times";
    }
    if (input.fragmentFrom.length > 0 && input.fragmentReason === undefined) {
      return "fragmented test source requires --fragment-reason";
    }
    if (input.fragmentFrom.length === 0 && input.fragmentReason !== undefined) {
      return "--fragment-reason requires at least one --fragment-from/--fragment-through pair";
    }
    if (input.sourceMode === "link" && input.fragmentFrom.length > 0) {
      return "source=link cannot be combined with source fragments";
    }
  }
  if (input.operation === "use-case-set") {
    if (![input.name, input.contract, input.explanation].every((value) => !value.includes("\n"))) return "Use Case name, contract, and explanation must each be one line";
    if (!/^docs\/feature\/.+\/use-case\/.+\.md(?:#[A-Za-z0-9._-]+)?$/.test(input.contract)) return "Use Case contract must link a docs/feature/**/use-case/*.md leaf";
    if ([input.startingState, input.action, input.result].some(hasFenceLine)) return "Use Case examples cannot contain a line beginning with ```";
  }
  if (input.operation === "record-new-write-set" || input.operation === "record-existing-read-set") {
    if ([input.action, input.result].some(hasFenceLine)) return "Record examples cannot contain a line beginning with ```";
  }
  if (input.operation === "record-upgrade-set") {
    if (!isPrBodyRecordVersion(input.version)) {
      return "Record version must use dotted numeric N -> M form, for example 0.15 -> 0.16";
    }
    if ([input.beforeInput, input.beforeOutput, input.afterInput, input.afterOutput].some(hasFenceLine)) {
      return "Record upgrade examples cannot contain a line beginning with ```";
    }
    if ([input.safety, input.userImpact, input.evidence].some((value) => value.includes("\n"))) {
      return "Record Safety, User impact, and Evidence must each be one line";
    }
  }
  if (input.operation === "record-private-set") {
    if ([input.before, input.after].some(hasFenceLine)) return "private persisted examples cannot contain a line beginning with ```";
    if (input.name.includes("\n") || input.userImpact.includes("\n")) return "private persisted Case name and User impact must each be one line";
  }
  if (input.operation === "environment-set") {
    if ([input.beforeInput, input.beforeOutput, input.afterInput, input.afterOutput].some(
      (value) => value !== undefined && hasFenceLine(value),
    )) return "environment examples cannot contain a line beginning with ```";
    if ([input.name, input.boundary, input.necessity, input.securityImpact].some((value) => value?.includes("\n") === true)) {
      return "environment name, boundary, necessity, and security impact must each be one line";
    }
    if (input.direction === "removed" && (input.afterInput !== undefined || input.afterOutput !== undefined || input.necessity !== undefined)) {
      return "removed environment variables render After as removed and do not accept after or necessity fields";
    }
    if (input.direction !== "removed" && (input.afterInput === undefined || input.afterOutput === undefined || input.necessity === undefined)) {
      return `${input.direction} environment variables require --after-input, --after-output, and --necessity`;
    }
  }
  if (input.operation === "terminology-set") {
    if ([input.name, input.before, input.after, input.explanation, input.canonical].some((value) => value.includes("\n"))) {
      return "terminology fields must each be one line";
    }
    if ([input.before, input.after].some(hasFenceLine)) return "terminology sentences cannot contain a line beginning with ```";
    if (!isPrBodyTerminologyCanonical(input.canonical)) {
      return "terminology canonical link must be docs/concepts.md#<Unicode Markdown anchor> without whitespace, parentheses, or path characters";
    }
  }
  return undefined;
}

function fenced(language: string, value: string): string {
  return `\`\`\`${language}\n${value.trimEnd()}\n\`\`\``;
}

function renderCase(item: PrBodyCase): string {
  const language = item.language ?? DEFAULT_LANGUAGES[item.section];
  const after = item.afterInput === undefined
    ? fenced("text", item.afterOutput)
    : `${fenced(language, item.afterInput)}\n\n${fenced("text", item.afterOutput)}`;
  return [
    `#### Case: ${item.name}`,
    "",
    "##### Before",
    "",
    fenced(language, item.beforeInput),
    "",
    fenced("text", item.beforeOutput),
    "",
    "##### After",
    "",
    after,
    "",
    "##### User impact",
    "",
    item.userImpact.trim(),
  ].join("\n");
}

function renderProblem(state: PrBodyEditorState): string | undefined {
  if (state.problem === undefined) return undefined;
  return [
    "## Problem",
    "",
    `- User goal: ${state.problem.userGoal}`,
    `- Current limitation: ${state.problem.currentLimitation}`,
    `- Required capability: ${state.problem.requiredCapability}`,
    `- User outcome: ${state.problem.userOutcome}`,
  ].join("\n");
}

function renderClosingIssues(state: PrBodyEditorState): string | undefined {
  if (!state.closingIssues?.length) return undefined;
  return ["## Closing issues", "", ...state.closingIssues.map((issue) => `Fixes #${issue}`)].join("\n");
}

function renderCaseSection(state: PrBodyEditorState, section: PrBodyCaseSection): string | undefined {
    const directions: string[] = [];
    for (const direction of PR_BODY_CASE_DIRECTIONS) {
      const cases = state.cases
        .filter((entry) => entry.section === section && entry.direction === direction)
        .sort((left, right) => left.name.localeCompare(right.name));
      if (cases.length) {
        const label = `${direction[0]!.toUpperCase()}${direction.slice(1)}`;
        directions.push(`### ${label}\n\n${cases.map(renderCase).join("\n\n")}`);
      }
    }
  return directions.length ? `## ${SECTION_LABELS[section]}\n\n${directions.join("\n\n")}` : undefined;
}

function renderUseCases(state: PrBodyEditorState): string | undefined {
  const directions = PR_BODY_CASE_DIRECTIONS.flatMap((direction) => {
    const cases = state.useCases.filter((entry) => entry.direction === direction).sort((a, b) => a.name.localeCompare(b.name));
    if (!cases.length) return [];
    const label = direction[0]!.toUpperCase() + direction.slice(1);
    return [`### ${label}\n\n${cases.map((item) => [
      `#### Case: ${item.name}`,
      "", "##### Starting state", "", fenced("text", item.startingState),
      "", "##### Action", "", fenced(item.language ?? "text", item.action),
      "", "##### Result", "", fenced("text", item.result),
      "", `${item.explanation.trim()} [Canonical Use Case](${item.contract}).`,
    ].join("\n")).join("\n\n")}`];
  });
  return directions.length ? `## Use cases\n\n${directions.join("\n\n")}` : undefined;
}

function renderRecord(state: PrBodyEditorState): string | undefined {
  const record = state.record;
  if (record === undefined) return undefined;
  const blocks: string[] = [];
  if (record.newWrite !== undefined) blocks.push([
    "### Case: write a new Record", "", "#### Action", "", fenced("sh", record.newWrite.action),
    "", "#### Result", "", fenced("text", record.newWrite.result),
  ].join("\n"));
  if (record.existingRead !== undefined) blocks.push([
    "### Case: read an existing Record", "", "#### Action", "", fenced("sh", record.existingRead.action),
    "", "#### Result", "", fenced("text", record.existingRead.result),
  ].join("\n"));
  if (record.upgrade !== undefined) blocks.push([
    "### Case: upgrade or recover stored data", "", "#### Version", "", `\`${record.upgrade.version}\``,
    "", "#### Before", "", fenced("sh", record.upgrade.beforeInput), "", fenced("text", record.upgrade.beforeOutput),
    "", "#### After", "", fenced("sh", record.upgrade.afterInput), "", fenced("text", record.upgrade.afterOutput),
    "", "#### Safety", "", record.upgrade.safety,
    "", "#### User impact", "", record.upgrade.userImpact,
    "", "#### Evidence", "", record.upgrade.evidence,
  ].join("\n"));
  const privateCases = [...(record.privatePersisted ?? [])]
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((item) => [
      `### Case: ${item.name}`, "", "#### Before", "", fenced("text", item.before),
      "", "#### After", "", fenced("text", item.after),
      "", "#### User impact", "", item.userImpact,
    ].join("\n"));
  if (privateCases.length) blocks.push(`### Private persisted data\n\n${privateCases.join("\n\n")}`);
  return blocks.length ? `## Record schema and stored-data upgrade\n\n${blocks.join("\n\n")}` : undefined;
}

function renderEnvironment(state: PrBodyEditorState): string | undefined {
  const directions = PR_BODY_CASE_DIRECTIONS.flatMap((direction) => {
    const cases = (state.environment ?? []).filter((entry) => entry.direction === direction).sort((a, b) => a.name.localeCompare(b.name));
    if (!cases.length) return [];
    const label = direction[0]!.toUpperCase() + direction.slice(1);
    return [`### ${label}\n\n${cases.map((item) => {
      const after = direction === "removed"
        ? fenced("text", "removed")
        : `${fenced("sh", item.afterInput!)}\n\n${fenced("text", item.afterOutput!)}`;
      return [
        `#### Case: ${item.name}`, "", "##### Before", "", fenced("sh", item.beforeInput), "", fenced("text", item.beforeOutput),
        "", "##### After", "", after,
        "", "##### Environment boundary", "", item.boundary,
        ...(item.necessity === undefined ? [] : ["", "##### Necessity", "", item.necessity]),
        "", "##### User and security impact", "", item.securityImpact,
      ].join("\n");
    }).join("\n\n")}`];
  });
  return directions.length ? `## Environment variables\n\n${directions.join("\n\n")}` : undefined;
}

function renderTerminology(state: PrBodyEditorState): string | undefined {
  const directions = PR_BODY_TERMINOLOGY_DIRECTIONS.flatMap((direction) => {
    const cases = (state.terminology ?? []).filter((entry) => entry.direction === direction).sort((a, b) => a.name.localeCompare(b.name));
    if (!cases.length) return [];
    const label = direction === "added" ? "Added terms" : "Removed terms";
    return [`### ${label}\n\n${cases.map((item) => [
      `#### Case: ${item.name}`, "", "##### Before", "", fenced("md", item.before),
      "", "##### After", "", fenced("md", item.after),
      "", `${item.explanation} [Canonical terminology](${item.canonical}).`,
    ].join("\n")).join("\n\n")}`];
  });
  return directions.length ? `## Terminology\n\n${directions.join("\n\n")}` : undefined;
}

function renderTests(tests: readonly TestDirective[], verification: PrBodyEditorState["verification"]): string | undefined {
  if (!tests.length && verification === undefined) return undefined;
  const directives = [...tests]
    .sort((left, right) => left.path.localeCompare(right.path))
    .map((test) => `<!-- niceeval:test\n${stringifyYaml(test).trimEnd()}\n-->`);
  const receipt = verification === undefined ? [] : [[
    "### Verification receipt",
    "",
    `- Candidate: ${verification.candidate}`,
    ...(verification.red === undefined ? [] : [`- Red: ${verification.red}`]),
    `- Green: ${verification.green}`,
    `- Repeatability: ${verification.repeatability}`,
    `- Fixed conditions: ${verification.fixedConditions}`,
    `- Unit count: ${verification.unitCount}`,
  ].join("\n")];
  return `## Tests\n\n${[...directives, ...receipt].join("\n\n")}`;
}

export function renderEditorState(state: PrBodyEditorState): string {
  const blocks = [
    renderProblem(state),
    renderClosingIssues(state),
    renderUseCases(state),
    ...PR_BODY_CASE_SECTIONS.slice(0, 4).map((section) => renderCaseSection(state, section)),
    renderRecord(state),
    renderEnvironment(state),
    renderCaseSection(state, "package-scripts"),
    renderTerminology(state),
    renderTests(state.tests, state.verification),
  ]
    .filter((block): block is string => block !== undefined);
  return `${blocks.join("\n\n")}\n`;
}
