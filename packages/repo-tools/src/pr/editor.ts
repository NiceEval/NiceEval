import { stringify as stringifyYaml } from "yaml";

import {
  PR_BODY_CASE_DIRECTIONS,
  PR_BODY_CASE_SECTIONS,
  type EditPrBodyInput,
  type PrBodyCase,
  type PrBodyCaseSection,
  type PrBodyEditorState,
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
    if (!/^e2e\/.+#necase_[0-9A-HJKMNP-TV-Z]{16}$/.test(input.selector)) return "test selector must be e2e/<path>#necase_<16 Crockford characters>";
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

function renderCases(state: PrBodyEditorState): readonly string[] {
  const sections: string[] = [];
  for (const section of PR_BODY_CASE_SECTIONS) {
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
    if (directions.length) sections.push(`## ${SECTION_LABELS[section]}\n\n${directions.join("\n\n")}`);
  }
  return sections;
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
  const blocks = [renderProblem(state), renderClosingIssues(state), renderUseCases(state), ...renderCases(state), renderTests(state.tests, state.verification)]
    .filter((block): block is string => block !== undefined);
  return `${blocks.join("\n\n")}\n`;
}
