// cases: docs/engineering/testing/architecture/unit/experiments-runner.md
import { resolve } from "node:path";
import { Effect, Result, Schema } from "effect";
import { expect, test } from "vitest";
import { adapterEvidenceUnavailable } from "./attempt-resources.ts";
import { defineAdapter } from "../adapter.ts";
import { defineEval, defineExperiment } from "../define.ts";
import { modelRolesFromWire, modelRolesToWire } from "../model-roles.ts";
import { preparePluginRun, linkPluginPair } from "../plugin/link.ts";
import { ExperimentIdSchema, RunIdSchema, UtcMillisSchema } from "../record/codec/identifiers.ts";
import { canonicalizeRunContext, runContextCanonicalJson } from "../record/model/run-context.ts";
import { validateRunDocument } from "../record/model/validation.ts";
import { linkedRunRecordIdentity, type LinkedRunPlan } from "../sandbox/plan.ts";
import {
  configIdentityForRun,
  configIdentityFromResult,
  configIdentityPaths,
  configDeltas,
  counterfactualConfigIdentity,
} from "./config-identity.ts";
import {
  stableIdentityJson,
  hashIdentityPayload,
  slotExecutionIdentityInput,
  slotExecutionIdentityDigestHex,
} from "./execution-identity.ts";
import { fingerprintWithManifest } from "./fingerprint.ts";
import { attachEvalModules } from "./module-graph.ts";
import { discoverEval, EVALUATION_ALGORITHM, type AgentRun, type ExperimentInput } from "./types.ts";

// Captured BEFORE the implementation change; never regenerate from the candidate.
const HEAD_GOLDEN = {
  head: "c138c4b8e1bf8278955c025c3fa32229ba6a1920",
  source: "export default { test() {} };\n",
  cases: {
    omitted: {
      text: '{"adapter":{"behaviorRevision":"1","cleanupTimeoutMs":30000,"contract":"model-identity","name":"model-identity"},"agentInstalls":[],"flags":{},"judgeRuntime":{"_tag":"Unconfigured"},"model":{"_tag":"Omitted"},"models":{"slots":{}},"plugins":[],"reasoningEffort":{"_tag":"Omitted"},"sandboxLayer":{"kind":"direct"},"sandboxReuse":false}',
      hash: "24a3fd48b670314af5d0373a1ca328406fc1ab30da5a27c2ceb1a911460859a2",
      historical:
        '{"adapter":{"behaviorRevision":"1","cleanupTimeoutMs":30000,"contract":"model-identity","name":"model-identity"},"agentInstalls":[],"flags":{},"judgeRuntime":{"_tag":"Unconfigured"},"model":{"_tag":"Omitted"},"models":{"slots":{}},"plugins":[],"reasoningEffort":{"_tag":"Omitted"},"sandboxLayer":{"kind":"direct"},"sandboxReuse":false}',
      paths: [
        ["adapter.name", "model-identity"],
        ["adapter.contract", "model-identity"],
        ["adapter.behaviorRevision", "1"],
        ["adapter.cleanupTimeoutMs", 30000],
        ["sandboxReuse", false],
        ["plugins", []],
        [
          "sandboxLayer",
          {
            kind: "direct",
          },
        ],
        ["agentInstalls", []],
      ],
      manifest: {
        niceeval: {
          evaluationAlgorithm: "assert-first/v2",
        },
        config: {
          "adapter.name": "model-identity",
          "adapter.contract": "model-identity",
          "adapter.behaviorRevision": "1",
          "adapter.cleanupTimeoutMs": 30000,
          sandboxReuse: false,
          plugins: [],
          sandboxLayer: {
            kind: "direct",
          },
          agentInstalls: [],
        },
        plan: {
          mode: "direct",
          pair: {
            evalId: "model-identity",
            experimentId: "model-identity",
            agentName: "model-identity",
          },
        },
        plugins: {
          pair: {
            occurrences: [],
          },
        },
        source: {
          "evals/model-identity.eval.ts": "fixed-author-source-v1",
        },
        data: {},
      },
      fingerprint: "415a4b3ad5e809f2556ea412c7be3eb32765539f5542c35a7be5ae8bf8b3779f",
      renameFingerprint: "87d29fdbfd843c1e323b8cdbc233d1238fa063f9c3e20bf8e2652437792b6b1a",
      slotText:
        '{"experimentId":"model-identity","evalId":"model-identity","attempt":0,"input":{"domain":"eval/v1","value":"415a4b3ad5e809f2556ea412c7be3eb32765539f5542c35a7be5ae8bf8b3779f"},"config":{"domain":"config/v1","value":"24a3fd48b670314af5d0373a1ca328406fc1ab30da5a27c2ceb1a911460859a2"},"timeout":null}',
      slotDigest: "d537489051a0327a7d5262b372396489bfdce192d5764aed20be34e9bf836587",
    },
    model: {
      text: '{"adapter":{"behaviorRevision":"1","cleanupTimeoutMs":30000,"contract":"model-identity","name":"model-identity"},"agentInstalls":[],"flags":{},"judgeRuntime":{"_tag":"Unconfigured"},"model":{"_tag":"Configured","value":"fixture/model"},"models":{"slots":{"default":{"model":"fixture/model","reasoningEffort":null}}},"plugins":[],"reasoningEffort":{"_tag":"Omitted"},"sandboxLayer":{"kind":"direct"},"sandboxReuse":false}',
      hash: "d0faabe0a6ef93c3f68ee72a8b8a88e7df084ed99cc77560b50b8f80e2cbfd26",
      historical:
        '{"adapter":{"behaviorRevision":"1","cleanupTimeoutMs":30000,"contract":"model-identity","name":"model-identity"},"agentInstalls":[],"flags":{},"judgeRuntime":{"_tag":"Unconfigured"},"model":{"_tag":"Configured","value":"fixture/model"},"models":{"slots":{"default":{"model":"fixture/model","reasoningEffort":null}}},"plugins":[],"reasoningEffort":{"_tag":"Omitted"},"sandboxLayer":{"kind":"direct"},"sandboxReuse":false}',
      paths: [
        ["adapter.name", "model-identity"],
        ["adapter.contract", "model-identity"],
        ["adapter.behaviorRevision", "1"],
        ["adapter.cleanupTimeoutMs", 30000],
        ["models.default.model", "fixture/model"],
        ["models.default.reasoningEffort", null],
        ["model", "fixture/model"],
        ["sandboxReuse", false],
        ["plugins", []],
        [
          "sandboxLayer",
          {
            kind: "direct",
          },
        ],
        ["agentInstalls", []],
      ],
      manifest: {
        niceeval: {
          evaluationAlgorithm: "assert-first/v2",
        },
        config: {
          "adapter.name": "model-identity",
          "adapter.contract": "model-identity",
          "adapter.behaviorRevision": "1",
          "adapter.cleanupTimeoutMs": 30000,
          "models.default.model": "fixture/model",
          "models.default.reasoningEffort": null,
          model: "fixture/model",
          sandboxReuse: false,
          plugins: [],
          sandboxLayer: {
            kind: "direct",
          },
          agentInstalls: [],
        },
        plan: {
          mode: "direct",
          pair: {
            evalId: "model-identity",
            experimentId: "model-identity",
            agentName: "model-identity",
          },
        },
        plugins: {
          pair: {
            occurrences: [],
          },
        },
        source: {
          "evals/model-identity.eval.ts": "fixed-author-source-v1",
        },
        data: {},
      },
      fingerprint: "08c366308040fc8536e02e957def97d2a680ee39999b919e238448e20635f557",
      renameFingerprint: "10ca07d023fee7e22098fb39893fca7792ad9a51f6a6fa4db9f45316506fb207",
      slotText:
        '{"experimentId":"model-identity","evalId":"model-identity","attempt":0,"input":{"domain":"eval/v1","value":"08c366308040fc8536e02e957def97d2a680ee39999b919e238448e20635f557"},"config":{"domain":"config/v1","value":"d0faabe0a6ef93c3f68ee72a8b8a88e7df084ed99cc77560b50b8f80e2cbfd26"},"timeout":null}',
      slotDigest: "3b692648a2c287deb1f40c1d505b81c69521d236b38662a260250ae3c096bbc3",
    },
    effort: {
      text: '{"adapter":{"behaviorRevision":"1","cleanupTimeoutMs":30000,"contract":"model-identity","name":"model-identity"},"agentInstalls":[],"flags":{},"judgeRuntime":{"_tag":"Unconfigured"},"model":{"_tag":"Omitted"},"models":{"slots":{"default":{"model":null,"reasoningEffort":"high"}}},"plugins":[],"reasoningEffort":{"_tag":"Configured","value":"high"},"sandboxLayer":{"kind":"direct"},"sandboxReuse":false}',
      hash: "cb70412eaad4b02c1dfde8ee22db62d8b5690b81f15d249f65d7d0cfff2416ce",
      historical:
        '{"adapter":{"behaviorRevision":"1","cleanupTimeoutMs":30000,"contract":"model-identity","name":"model-identity"},"agentInstalls":[],"flags":{},"judgeRuntime":{"_tag":"Unconfigured"},"model":{"_tag":"Omitted"},"models":{"slots":{"default":{"model":null,"reasoningEffort":"high"}}},"plugins":[],"reasoningEffort":{"_tag":"Configured","value":"high"},"sandboxLayer":{"kind":"direct"},"sandboxReuse":false}',
      paths: [
        ["adapter.name", "model-identity"],
        ["adapter.contract", "model-identity"],
        ["adapter.behaviorRevision", "1"],
        ["adapter.cleanupTimeoutMs", 30000],
        ["models.default.model", null],
        ["models.default.reasoningEffort", "high"],
        ["reasoningEffort", "high"],
        ["sandboxReuse", false],
        ["plugins", []],
        [
          "sandboxLayer",
          {
            kind: "direct",
          },
        ],
        ["agentInstalls", []],
      ],
      manifest: {
        niceeval: {
          evaluationAlgorithm: "assert-first/v2",
        },
        config: {
          "adapter.name": "model-identity",
          "adapter.contract": "model-identity",
          "adapter.behaviorRevision": "1",
          "adapter.cleanupTimeoutMs": 30000,
          "models.default.model": null,
          "models.default.reasoningEffort": "high",
          reasoningEffort: "high",
          sandboxReuse: false,
          plugins: [],
          sandboxLayer: {
            kind: "direct",
          },
          agentInstalls: [],
        },
        plan: {
          mode: "direct",
          pair: {
            evalId: "model-identity",
            experimentId: "model-identity",
            agentName: "model-identity",
          },
        },
        plugins: {
          pair: {
            occurrences: [],
          },
        },
        source: {
          "evals/model-identity.eval.ts": "fixed-author-source-v1",
        },
        data: {},
      },
      fingerprint: "d85ca725d2076bfbfeca6a5ec1a34a379dd4fcf3cfd0525d541435b45c9caaf6",
      renameFingerprint: "a31bf3cd8a43dabaac0f7b891c4f99804fd1d971a8cc6d41235968fb10ddf60c",
      slotText:
        '{"experimentId":"model-identity","evalId":"model-identity","attempt":0,"input":{"domain":"eval/v1","value":"d85ca725d2076bfbfeca6a5ec1a34a379dd4fcf3cfd0525d541435b45c9caaf6"},"config":{"domain":"config/v1","value":"cb70412eaad4b02c1dfde8ee22db62d8b5690b81f15d249f65d7d0cfff2416ce"},"timeout":null}',
      slotDigest: "fd6183396d10a092ea8280793ca4f76141ab168e1517d36419412ea369d69b2c",
    },
    both: {
      text: '{"adapter":{"behaviorRevision":"1","cleanupTimeoutMs":30000,"contract":"model-identity","name":"model-identity"},"agentInstalls":[],"flags":{},"judgeRuntime":{"_tag":"Unconfigured"},"model":{"_tag":"Configured","value":"fixture/model"},"models":{"slots":{"default":{"model":"fixture/model","reasoningEffort":"high"}}},"plugins":[],"reasoningEffort":{"_tag":"Configured","value":"high"},"sandboxLayer":{"kind":"direct"},"sandboxReuse":false}',
      hash: "f6c9291fa7661015c43a7f1aba0a7fd5b3ebf26368afe217fe5d842a3dc2c9ef",
      historical:
        '{"adapter":{"behaviorRevision":"1","cleanupTimeoutMs":30000,"contract":"model-identity","name":"model-identity"},"agentInstalls":[],"flags":{},"judgeRuntime":{"_tag":"Unconfigured"},"model":{"_tag":"Configured","value":"fixture/model"},"models":{"slots":{"default":{"model":"fixture/model","reasoningEffort":"high"}}},"plugins":[],"reasoningEffort":{"_tag":"Configured","value":"high"},"sandboxLayer":{"kind":"direct"},"sandboxReuse":false}',
      paths: [
        ["adapter.name", "model-identity"],
        ["adapter.contract", "model-identity"],
        ["adapter.behaviorRevision", "1"],
        ["adapter.cleanupTimeoutMs", 30000],
        ["models.default.model", "fixture/model"],
        ["models.default.reasoningEffort", "high"],
        ["model", "fixture/model"],
        ["reasoningEffort", "high"],
        ["sandboxReuse", false],
        ["plugins", []],
        [
          "sandboxLayer",
          {
            kind: "direct",
          },
        ],
        ["agentInstalls", []],
      ],
      manifest: {
        niceeval: {
          evaluationAlgorithm: "assert-first/v2",
        },
        config: {
          "adapter.name": "model-identity",
          "adapter.contract": "model-identity",
          "adapter.behaviorRevision": "1",
          "adapter.cleanupTimeoutMs": 30000,
          "models.default.model": "fixture/model",
          "models.default.reasoningEffort": "high",
          model: "fixture/model",
          reasoningEffort: "high",
          sandboxReuse: false,
          plugins: [],
          sandboxLayer: {
            kind: "direct",
          },
          agentInstalls: [],
        },
        plan: {
          mode: "direct",
          pair: {
            evalId: "model-identity",
            experimentId: "model-identity",
            agentName: "model-identity",
          },
        },
        plugins: {
          pair: {
            occurrences: [],
          },
        },
        source: {
          "evals/model-identity.eval.ts": "fixed-author-source-v1",
        },
        data: {},
      },
      fingerprint: "e2c391f4aaef8626a8b89bca4846863fb1517e2e71c87c5f26b40490ce980e42",
      renameFingerprint: "31a2619788885bbd93fdab7b8067d69c5fc125e50f3ff241cbda06228043dd55",
      slotText:
        '{"experimentId":"model-identity","evalId":"model-identity","attempt":0,"input":{"domain":"eval/v1","value":"e2c391f4aaef8626a8b89bca4846863fb1517e2e71c87c5f26b40490ce980e42"},"config":{"domain":"config/v1","value":"f6c9291fa7661015c43a7f1aba0a7fd5b3ebf26368afe217fe5d842a3dc2c9ef"},"timeout":null}',
      slotDigest: "2c0482c060652995f2c5f8c6502ad7d0b2b8ea7b5d88d89cbc8819d77b6e5174",
    },
    explicit: {
      text: '{"adapter":{"behaviorRevision":"1","cleanupTimeoutMs":30000,"contract":"model-identity","name":"model-identity"},"agentInstalls":[],"flags":{},"judgeRuntime":{"_tag":"Unconfigured"},"model":{"_tag":"Configured","value":"fixture/model"},"models":{"slots":{"default":{"model":"fixture/model","reasoningEffort":"high"}}},"plugins":[],"reasoningEffort":{"_tag":"Configured","value":"high"},"sandboxLayer":{"kind":"direct"},"sandboxReuse":false}',
      hash: "f6c9291fa7661015c43a7f1aba0a7fd5b3ebf26368afe217fe5d842a3dc2c9ef",
      historical:
        '{"adapter":{"behaviorRevision":"1","cleanupTimeoutMs":30000,"contract":"model-identity","name":"model-identity"},"agentInstalls":[],"flags":{},"judgeRuntime":{"_tag":"Unconfigured"},"model":{"_tag":"Configured","value":"fixture/model"},"models":{"slots":{"default":{"model":"fixture/model","reasoningEffort":"high"}}},"plugins":[],"reasoningEffort":{"_tag":"Configured","value":"high"},"sandboxLayer":{"kind":"direct"},"sandboxReuse":false}',
      paths: [
        ["adapter.name", "model-identity"],
        ["adapter.contract", "model-identity"],
        ["adapter.behaviorRevision", "1"],
        ["adapter.cleanupTimeoutMs", 30000],
        ["models.default.model", "fixture/model"],
        ["models.default.reasoningEffort", "high"],
        ["model", "fixture/model"],
        ["reasoningEffort", "high"],
        ["sandboxReuse", false],
        ["plugins", []],
        [
          "sandboxLayer",
          {
            kind: "direct",
          },
        ],
        ["agentInstalls", []],
      ],
      manifest: {
        niceeval: {
          evaluationAlgorithm: "assert-first/v2",
        },
        config: {
          "adapter.name": "model-identity",
          "adapter.contract": "model-identity",
          "adapter.behaviorRevision": "1",
          "adapter.cleanupTimeoutMs": 30000,
          "models.default.model": "fixture/model",
          "models.default.reasoningEffort": "high",
          model: "fixture/model",
          reasoningEffort: "high",
          sandboxReuse: false,
          plugins: [],
          sandboxLayer: {
            kind: "direct",
          },
          agentInstalls: [],
        },
        plan: {
          mode: "direct",
          pair: {
            evalId: "model-identity",
            experimentId: "model-identity",
            agentName: "model-identity",
          },
        },
        plugins: {
          pair: {
            occurrences: [],
          },
        },
        source: {
          "evals/model-identity.eval.ts": "fixed-author-source-v1",
        },
        data: {},
      },
      fingerprint: "e2c391f4aaef8626a8b89bca4846863fb1517e2e71c87c5f26b40490ce980e42",
      renameFingerprint: "31a2619788885bbd93fdab7b8067d69c5fc125e50f3ff241cbda06228043dd55",
      slotText:
        '{"experimentId":"model-identity","evalId":"model-identity","attempt":0,"input":{"domain":"eval/v1","value":"e2c391f4aaef8626a8b89bca4846863fb1517e2e71c87c5f26b40490ce980e42"},"config":{"domain":"config/v1","value":"f6c9291fa7661015c43a7f1aba0a7fd5b3ebf26368afe217fe5d842a3dc2c9ef"},"timeout":null}',
      slotDigest: "2c0482c060652995f2c5f8c6502ad7d0b2b8ea7b5d88d89cbc8819d77b6e5174",
    },
    multi: {
      text: '{"adapter":{"behaviorRevision":"1","cleanupTimeoutMs":30000,"contract":"model-identity","name":"model-identity"},"agentInstalls":[],"flags":{},"judgeRuntime":{"_tag":"Unconfigured"},"model":{"_tag":"Omitted"},"models":{"slots":{"planner":{"model":"fixture/planner","reasoningEffort":null},"reviewer":{"model":"fixture/reviewer","reasoningEffort":"high"}}},"plugins":[],"reasoningEffort":{"_tag":"Omitted"},"sandboxLayer":{"kind":"direct"},"sandboxReuse":false}',
      hash: "c80b30c8cb6fc97ca3a131ce5e574d7ccf39bfb11b663ec62f62bcec5eda5d85",
      historical:
        '{"adapter":{"behaviorRevision":"1","cleanupTimeoutMs":30000,"contract":"model-identity","name":"model-identity"},"agentInstalls":[],"flags":{},"judgeRuntime":{"_tag":"Unconfigured"},"model":{"_tag":"Omitted"},"models":{"slots":{"planner":{"model":"fixture/planner","reasoningEffort":null},"reviewer":{"model":"fixture/reviewer","reasoningEffort":"high"}}},"plugins":[],"reasoningEffort":{"_tag":"Omitted"},"sandboxLayer":{"kind":"direct"},"sandboxReuse":false}',
      paths: [
        ["adapter.name", "model-identity"],
        ["adapter.contract", "model-identity"],
        ["adapter.behaviorRevision", "1"],
        ["adapter.cleanupTimeoutMs", 30000],
        ["models.planner.model", "fixture/planner"],
        ["models.planner.reasoningEffort", null],
        ["models.reviewer.model", "fixture/reviewer"],
        ["models.reviewer.reasoningEffort", "high"],
        ["sandboxReuse", false],
        ["plugins", []],
        [
          "sandboxLayer",
          {
            kind: "direct",
          },
        ],
        ["agentInstalls", []],
      ],
      manifest: {
        niceeval: {
          evaluationAlgorithm: "assert-first/v2",
        },
        config: {
          "adapter.name": "model-identity",
          "adapter.contract": "model-identity",
          "adapter.behaviorRevision": "1",
          "adapter.cleanupTimeoutMs": 30000,
          "models.planner.model": "fixture/planner",
          "models.planner.reasoningEffort": null,
          "models.reviewer.model": "fixture/reviewer",
          "models.reviewer.reasoningEffort": "high",
          sandboxReuse: false,
          plugins: [],
          sandboxLayer: {
            kind: "direct",
          },
          agentInstalls: [],
        },
        plan: {
          mode: "direct",
          pair: {
            evalId: "model-identity",
            experimentId: "model-identity",
            agentName: "model-identity",
          },
        },
        plugins: {
          pair: {
            occurrences: [],
          },
        },
        source: {
          "evals/model-identity.eval.ts": "fixed-author-source-v1",
        },
        data: {},
      },
      fingerprint: "c9769bd42a7e05ca805a4f822d437fb95940058e952e982b15cdf63a11548b30",
      renameFingerprint: "a1cbf48d612fb28e3fc31209fabce16cc3ea1863b33462b9ba0897437ec9110a",
      slotText:
        '{"experimentId":"model-identity","evalId":"model-identity","attempt":0,"input":{"domain":"eval/v1","value":"c9769bd42a7e05ca805a4f822d437fb95940058e952e982b15cdf63a11548b30"},"config":{"domain":"config/v1","value":"c80b30c8cb6fc97ca3a131ce5e574d7ccf39bfb11b663ec62f62bcec5eda5d85"},"timeout":null}',
      slotDigest: "8866ad26ffcfad24687e03fd0399948c7129e8e17ecefcc94e5ad98696870878",
    },
    reordered: {
      text: '{"adapter":{"behaviorRevision":"1","cleanupTimeoutMs":30000,"contract":"model-identity","name":"model-identity"},"agentInstalls":[],"flags":{},"judgeRuntime":{"_tag":"Unconfigured"},"model":{"_tag":"Omitted"},"models":{"slots":{"planner":{"model":"fixture/planner","reasoningEffort":null},"reviewer":{"model":"fixture/reviewer","reasoningEffort":"high"}}},"plugins":[],"reasoningEffort":{"_tag":"Omitted"},"sandboxLayer":{"kind":"direct"},"sandboxReuse":false}',
      hash: "c80b30c8cb6fc97ca3a131ce5e574d7ccf39bfb11b663ec62f62bcec5eda5d85",
      historical:
        '{"adapter":{"behaviorRevision":"1","cleanupTimeoutMs":30000,"contract":"model-identity","name":"model-identity"},"agentInstalls":[],"flags":{},"judgeRuntime":{"_tag":"Unconfigured"},"model":{"_tag":"Omitted"},"models":{"slots":{"planner":{"model":"fixture/planner","reasoningEffort":null},"reviewer":{"model":"fixture/reviewer","reasoningEffort":"high"}}},"plugins":[],"reasoningEffort":{"_tag":"Omitted"},"sandboxLayer":{"kind":"direct"},"sandboxReuse":false}',
      paths: [
        ["adapter.name", "model-identity"],
        ["adapter.contract", "model-identity"],
        ["adapter.behaviorRevision", "1"],
        ["adapter.cleanupTimeoutMs", 30000],
        ["models.planner.model", "fixture/planner"],
        ["models.planner.reasoningEffort", null],
        ["models.reviewer.model", "fixture/reviewer"],
        ["models.reviewer.reasoningEffort", "high"],
        ["sandboxReuse", false],
        ["plugins", []],
        [
          "sandboxLayer",
          {
            kind: "direct",
          },
        ],
        ["agentInstalls", []],
      ],
      manifest: {
        niceeval: {
          evaluationAlgorithm: "assert-first/v2",
        },
        config: {
          "adapter.name": "model-identity",
          "adapter.contract": "model-identity",
          "adapter.behaviorRevision": "1",
          "adapter.cleanupTimeoutMs": 30000,
          "models.planner.model": "fixture/planner",
          "models.planner.reasoningEffort": null,
          "models.reviewer.model": "fixture/reviewer",
          "models.reviewer.reasoningEffort": "high",
          sandboxReuse: false,
          plugins: [],
          sandboxLayer: {
            kind: "direct",
          },
          agentInstalls: [],
        },
        plan: {
          mode: "direct",
          pair: {
            evalId: "model-identity",
            experimentId: "model-identity",
            agentName: "model-identity",
          },
        },
        plugins: {
          pair: {
            occurrences: [],
          },
        },
        source: {
          "evals/model-identity.eval.ts": "fixed-author-source-v1",
        },
        data: {},
      },
      fingerprint: "c9769bd42a7e05ca805a4f822d437fb95940058e952e982b15cdf63a11548b30",
      renameFingerprint: "a1cbf48d612fb28e3fc31209fabce16cc3ea1863b33462b9ba0897437ec9110a",
      slotText:
        '{"experimentId":"model-identity","evalId":"model-identity","attempt":0,"input":{"domain":"eval/v1","value":"c9769bd42a7e05ca805a4f822d437fb95940058e952e982b15cdf63a11548b30"},"config":{"domain":"config/v1","value":"c80b30c8cb6fc97ca3a131ce5e574d7ccf39bfb11b663ec62f62bcec5eda5d85"},"timeout":null}',
      slotDigest: "8866ad26ffcfad24687e03fd0399948c7129e8e17ecefcc94e5ad98696870878",
    },
    historicalMissing: {
      text: '{"adapter":{"behaviorRevision":"1","cleanupTimeoutMs":30000,"contract":"model-identity","name":"model-identity"},"agentInstalls":[],"flags":{},"judgeRuntime":{"_tag":"Unconfigured"},"model":{"_tag":"Omitted"},"plugins":[],"reasoningEffort":{"_tag":"Omitted"},"sandboxLayer":{"kind":"direct"},"sandboxReuse":false}',
      hash: "17b57f665ec2bb6f6440e153c6b5c3297c30ceb2e71ff46a4e49ef5f9ba9a3de",
      paths: [
        ["adapter.name", "model-identity"],
        ["adapter.contract", "model-identity"],
        ["adapter.behaviorRevision", "1"],
        ["adapter.cleanupTimeoutMs", 30000],
        ["sandboxReuse", false],
        ["plugins", []],
        [
          "sandboxLayer",
          {
            kind: "direct",
          },
        ],
        ["agentInstalls", []],
      ],
    },
  },
  deltas: [
    {
      _tag: "Added",
      selector: "config:models.default.model",
      to: "null",
    },
    {
      _tag: "Added",
      selector: "config:models.default.reasoningEffort",
      to: "high",
    },
    {
      _tag: "Removed",
      selector: "config:models.planner.model",
      from: "fixture/planner",
    },
    {
      _tag: "Removed",
      selector: "config:models.planner.reasoningEffort",
      from: "null",
    },
    {
      _tag: "Removed",
      selector: "config:models.reviewer.model",
      from: "fixture/reviewer",
    },
    {
      _tag: "Removed",
      selector: "config:models.reviewer.reasoningEffort",
      from: "high",
    },
    {
      _tag: "Added",
      selector: "config:reasoningEffort",
      to: "high",
    },
  ],
  counterfactual:
    '{"adapter":{"behaviorRevision":"1","cleanupTimeoutMs":30000,"contract":"model-identity","name":"model-identity"},"agentInstalls":[],"flags":{},"judgeRuntime":{"_tag":"Unconfigured"},"model":{"_tag":"Omitted"},"models":{"slots":{"planner":{"model":"fixture/planner","reasoningEffort":null},"reviewer":{"model":"fixture/reviewer","reasoningEffort":"high"}}},"plugins":[],"reasoningEffort":{"_tag":"Omitted"},"sandboxLayer":{"kind":"direct"},"sandboxReuse":false}',
} as const;

const adapter = defineAdapter({ name: "model-identity", behaviorRevision: "1", create: () => ({}) });
const selections = {
  omitted: {},
  model: { model: "fixture/model" },
  effort: { reasoningEffort: "high" },
  both: { model: "fixture/model", reasoningEffort: "high" },
  explicit: { models: { default: { model: "fixture/model", reasoningEffort: "high" } } },
  multi: {
    models: { planner: { model: "fixture/planner" }, reviewer: { model: "fixture/reviewer", reasoningEffort: "high" } },
  },
  reordered: {
    models: { reviewer: { model: "fixture/reviewer", reasoningEffort: "high" }, planner: { model: "fixture/planner" } },
  },
} satisfies Record<string, Omit<ExperimentInput<typeof adapter>, "adapter">>;

function pairFor(input: (typeof selections)[keyof typeof selections]) {
  const def = defineExperiment({ adapter, ...input });
  const run: AgentRun = {
    ...def,
    agent: undefined,
    experimentId: "model-identity",
    experimentBaseDir: resolve("experiments"),
    experimentSourcePath: resolve("experiments/model-identity.ts"),
    selectedEvalIds: ["model-identity"],
    sandboxBeforeCache: "use",
    timeoutSource: undefined,
    pluginBehavior: [],
    setup: undefined,
    teardown: undefined,
  };
  const source = HEAD_GOLDEN.source;
  const path = resolve("evals/model-identity.eval.ts");
  const definition = defineEval({ test() {} });
  const evalDef = discoverEval(definition, {
    id: "model-identity",
    baseDir: resolve("evals"),
    sourcePath: path,
    loaderDataPaths: [],
    criteriaPaths: [],
    privatePaths: [],
    source: { path: "evals/model-identity.eval.ts", content: source, sha256: hashIdentityPayload(source) },
    definition,
    evalGroup: undefined,
  });
  attachEvalModules(evalDef, {
    root: path,
    modules: [
      {
        path,
        source,
        normalized: source,
        identity: "fixed-author-source-v1",
        sourceType: undefined,
        edges: [],
        unresolved: [],
      },
    ],
    unresolved: [],
  });
  const plan: LinkedRunPlan = {
    _tag: "Direct",
    pair: { kind: "direct", evalId: evalDef.id, experimentId: run.experimentId, agentName: "model-identity" },
  };
  return {
    key: "model-identity",
    run,
    sourceRun: run,
    evalDef,
    plan,
    identity: linkedRunRecordIdentity(plan),
    plugin: linkPluginPair(evalDef, preparePluginRun(run)),
  };
}

function historicalResult(pair: ReturnType<typeof pairFor>, includeModels = true): import("./types.ts").EvalResult {
  return {
    adapter: configIdentityForRun(pair.run, pair.plan).adapter,
    ...(pair.run.model === undefined ? {} : { model: pair.run.model }),
    id: pair.evalDef.id,
    verdict: "passed",
    evaluationAlgorithm: EVALUATION_ALGORITHM,
    attempt: 0,
    durationMs: 0,
    factResults: [],
    factUses: [],
    evaluationKind: "pass",
    evidenceCoverage: adapterEvidenceUnavailable,
    experiment: {
      ...(includeModels ? { models: modelRolesToWire(pair.run.models ?? {}) } : {}),
      ...(pair.run.reasoningEffort === undefined ? {} : { reasoningEffort: pair.run.reasoningEffort }),
      attempts: 1,
      earlyExit: false,
      sandboxLayer: { kind: "direct" },
      sandboxPlansByEval: {},
      agentInstalls: [],
    },
  };
}

// @feature docs/feature/experiments/README.md
test.each(Object.entries(selections))("model configuration %s preserves HEAD identity bytes", async (name, input) => {
  const expected = HEAD_GOLDEN.cases[name as keyof typeof selections];
  const pair = pairFor(input);
  const identity = configIdentityForRun(pair.run, pair.plan);
  expect(stableIdentityJson(identity)).toBe(expected.text);
  expect(hashIdentityPayload(identity)).toBe(expected.hash);
  expect(configIdentityPaths(identity)).toEqual(expected.paths);
  const historical = configIdentityFromResult(historicalResult(pair));
  expect(stableIdentityJson(historical)).toBe(expected.historical);
  if (historical === undefined) throw new Error("Expected recorded configuration");
  expect(configDeltas(historical, identity)).toEqual([]);
  const fp = await Effect.runPromise(fingerprintWithManifest(pair));
  expect(fp.manifest).toEqual(expected.manifest);
  expect(fp.fingerprint).toBe(expected.fingerprint);
  expect(fp.renameFingerprint("renamed")).toBe(expected.renameFingerprint);
  const slot = {
    experimentId: "model-identity",
    evalId: pair.evalDef.id,
    attempt: 0,
    input: { domain: "eval/v1", value: fp.fingerprint },
    config: { domain: "config/v1", value: hashIdentityPayload(identity) },
    timeout: null,
  };
  expect(slotExecutionIdentityInput(slot)).toBe(expected.slotText);
  expect(slotExecutionIdentityDigestHex(slot)).toBe(expected.slotDigest);
  const wire = modelRolesToWire(pair.run.models ?? {});
  expect(modelRolesToWire(modelRolesFromWire(wire))).toEqual(wire);
  const context = {
    experimentId: Schema.decodeUnknownSync(ExperimentIdSchema)("model-identity"),
    execution: {
      adapter: identity.adapter,
      models: wire,
      model: pair.run.model ?? null,
      reasoningEffort: pair.run.reasoningEffort ?? null,
      flags: {},
    },
    labels: {},
  };
  const decoded = canonicalizeRunContext(context);
  expect(Result.isSuccess(decoded)).toBe(true);
  if (Result.isFailure(decoded)) throw new Error("Context must accept nullable model wire");
  const json = runContextCanonicalJson(decoded.success);
  const headIdentity = JSON.parse(expected.text);
  expect(json).toBe(
    stableIdentityJson({
      experimentId: "model-identity",
      execution: {
        adapter: headIdentity.adapter,
        models: headIdentity.models.slots,
        model: headIdentity.model._tag === "Configured" ? headIdentity.model.value : null,
        reasoningEffort: headIdentity.reasoningEffort._tag === "Configured" ? headIdentity.reasoningEffort.value : null,
        flags: {},
      },
      labels: {},
    }),
  );
  const again = canonicalizeRunContext(JSON.parse(json));
  if (Result.isFailure(again)) throw new Error("Context must be revalidatable");
  expect(runContextCanonicalJson(again.success)).toBe(json);
  expect(
    validateRunDocument({
      runId: Schema.decodeUnknownSync(RunIdSchema)("00000000-0000-4000-8000-000000000001"),
      experimentId: again.success.experimentId,
      context: again.success,
      startedAt: Schema.decodeUnknownSync(UtcMillisSchema)(0),
      completedAt: Schema.decodeUnknownSync(UtcMillisSchema)(1),
      expectedSlots: [],
    }),
  ).toEqual([]);
});

// @feature docs/feature/experiments/README.md
test("historical omission and whole-model authorization retain identity distinctions", () => {
  const pair = pairFor(selections.omitted);
  const historical = configIdentityFromResult(historicalResult(pair, false));
  if (historical === undefined) throw new Error("Historical configuration must exist without models");
  expect(Object.hasOwn(historical, "models")).toBe(false);
  expect(stableIdentityJson(historical)).toBe(HEAD_GOLDEN.cases.historicalMissing.text);
  expect(hashIdentityPayload(historical)).toBe(HEAD_GOLDEN.cases.historicalMissing.hash);
  expect(configIdentityPaths(historical)).toEqual(HEAD_GOLDEN.cases.historicalMissing.paths);
  const priorPair = pairFor(selections.multi),
    currentPair = pairFor(selections.effort);
  const prior = configIdentityForRun(priorPair.run, priorPair.plan),
    current = configIdentityForRun(currentPair.run, currentPair.plan);
  expect(configDeltas(prior, current)).toEqual(HEAD_GOLDEN.deltas);
  const accepted = new Set(HEAD_GOLDEN.deltas.map((delta) => delta.selector));
  expect(stableIdentityJson(counterfactualConfigIdentity(current, prior, accepted))).toBe(HEAD_GOLDEN.counterfactual);
  accepted.delete("config:models.planner.model");
  expect(counterfactualConfigIdentity(current, prior, accepted).models).toEqual(current.models);
  const context = {
    experimentId: "model-identity",
    execution: { adapter: null, model: null, reasoningEffort: null, flags: {} },
    labels: {},
  };
  const read = canonicalizeRunContext(context);
  if (Result.isFailure(read)) throw new Error("Historical context must decode");
  expect(Object.hasOwn(read.success.execution, "models")).toBe(false);
  expect(runContextCanonicalJson(read.success)).toBe(stableIdentityJson(context));
});
