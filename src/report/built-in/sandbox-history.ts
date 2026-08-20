/** Sandbox history has one closed DomainView owner. */

import type {
  Sample,
  SampleSnapshot,
} from "../../analysis/index.ts";
import { jsx, jsxs } from "react/jsx-runtime";
import type { Page } from "../definition/report.ts";
import { Col } from "../definition/primitives.tsx";
import { Hero, type HeroData } from "../components/site-components/index.tsx";
import { toSandboxHistory } from "../model/conversions.ts";
import { SandboxHistoryResultView } from "./result-components.tsx";
import {
  builtInMachineProducerIds,
  defineBuiltInReport,
} from "./machine.ts";

interface SandboxHistoryPageInput {
  readonly hero: HeroData;
  readonly history: Awaited<ReturnType<typeof toSandboxHistory>>;
}

function heroData(snapshot: SampleSnapshot): HeroData {
  const latest = snapshot.runs.reduce<number | null>(
    (current, run) => current === null || Number(run.startedAt) > current ? Number(run.startedAt) : current,
    null,
  );
  return Object.freeze({
    latestStartedAt: latest === null ? null : new Date(latest).toISOString(),
    runs: snapshot.runs.length,
  });
}

const sandboxHistoryPage = {
  id: "sandbox-history",
  path: "/",
  title: "Sandbox history",
  load: async (sample: Sample): Promise<SandboxHistoryPageInput> => Object.freeze({
    hero: heroData(sample.snapshot),
    history: await toSandboxHistory(sample),
  }),
  render: (input: SandboxHistoryPageInput) => jsxs(Col, {
    children: [
      jsx(Hero, { data: input.hero }),
      jsx(SandboxHistoryResultView, { view: input.history }),
    ],
  }),
} satisfies Page<void, SandboxHistoryPageInput>;

/** A history page over the closed sandbox-history DomainView. */
export function sandboxHistoryReport() {
  return defineBuiltInReport(builtInMachineProducerIds.sandboxHistory, {
    title: "Sandbox history",
    pages: [sandboxHistoryPage],
  });
}

/** The built-in closed-value Sandbox history Report. */
export const defaultSandboxHistoryReport = sandboxHistoryReport();

export default defaultSandboxHistoryReport;
