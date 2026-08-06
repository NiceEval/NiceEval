#!/usr/bin/env tsx
import "../execution/report-targets";
import { runEvidenceRepository } from "../support/contracts";

const result = await runEvidenceRepository({
  argv: process.argv.slice(2),
  candidateTarball: process.env.NICEEVAL_CANDIDATE_TARBALL,
  recipes: new URL("../recipes", import.meta.url),
  behaviors: new URL("../test/behavior", import.meta.url),
  worldStore: new URL("../.worlds", import.meta.url),
  commands: {
    prepare: "prepare --recipe <id>",
    verify: "verify --world <world-id> --behavior <id>",
  },
});

process.exitCode = result.exitCode;
