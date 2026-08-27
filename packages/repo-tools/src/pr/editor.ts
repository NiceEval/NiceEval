import { stringify as stringifyYaml } from "yaml";

import {
  PR_BODY_CASE_DIRECTIONS,
  PR_BODY_CASE_SECTIONS,
  type EditPrBodyInput,
  type PrBodyCase,
  type PrBodyCaseSection,
  type PrBodyEditorState,
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
  version: 1,
  cases: Object.freeze([]),
  tests: Object.freeze([]),
});

export function editorStateComment(state: PrBodyEditorState): string {
  return `<!-- niceeval:pr-editor\n${stringifyYaml(state).trimEnd()}\n-->`;
}

function sameCase(left: PrBodyCase, right: Pick<PrBodyCase, "section" | "direction" | "name">): boolean {
  return left.section === right.section && left.direction === right.direction && left.name === right.name;
}

function testFromInput(input: Extract<EditPrBodyInput, { readonly operation: "test-set" }>): TestDirective {
  const source: TestDirective["source"] = input.fragmentFrom.length === 0
    ? "full"
    : {
        fragments: input.fragmentFrom.map((from, index) => ({ from, through: input.fragmentThrough[index]! })),
        reason: input.fragmentReason!,
      };
  return {
    path: input.path,
    purpose: input.purpose,
    protects: input.protects,
    runs: input.runs,
    asserts: input.asserts,
    source,
  };
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
    case "test-set": {
      const test = testFromInput(input);
      return { ...state, tests: [...state.tests.filter((entry) => entry.path !== test.path), test] };
    }
    case "test-remove":
      return { ...state, tests: state.tests.filter((entry) => entry.path !== input.path) };
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
    input.path,
    input.purpose,
    input.protects,
    input.runs,
    input.asserts,
  ].some((value) => value.includes("\n"))) {
    return "test directive fields must each be one line";
  }
  if (input.operation === "test-set") {
    if (input.fragmentFrom.length !== input.fragmentThrough.length) {
      return "--fragment-from and --fragment-through must be repeated the same number of times";
    }
    if (input.fragmentFrom.length > 0 && input.fragmentReason === undefined) {
      return "fragmented test source requires --fragment-reason";
    }
    if (input.fragmentFrom.length === 0 && input.fragmentReason !== undefined) {
      return "--fragment-reason requires at least one --fragment-from/--fragment-through pair";
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

function renderTests(tests: readonly TestDirective[]): string | undefined {
  if (!tests.length) return undefined;
  const directives = [...tests]
    .sort((left, right) => left.path.localeCompare(right.path))
    .map((test) => `<!-- niceeval:test\n${stringifyYaml(test).trimEnd()}\n-->`);
  return `## Tests\n\n${directives.join("\n\n")}`;
}

export function renderEditorState(state: PrBodyEditorState): string {
  const blocks = [renderProblem(state), ...renderCases(state), renderTests(state.tests)]
    .filter((block): block is string => block !== undefined);
  return `${blocks.join("\n\n")}\n`;
}
