import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const PROTOCOL = "niceeval.query/v1";
const INSPECTION_REVISION = "inspection/revision-7";
const BEHAVIOR_VERSION = "1.0.0";
const PAGE_ITEM_CEILING = 2;
const PAGE_BYTE_CEILING = 1_000;
const BOOTSTRAP_BYTE_CEILING = 2_048;

const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
};

const canonicalText = (value) => JSON.stringify(canonicalize(value));
const canonicalBytes = (value) => Buffer.from(canonicalText(value));
const sha256 = (value) => createHash("sha256").update(canonicalBytes(value)).digest("hex");
const clone = (value) => structuredClone(value);

const operationCatalog = [
  "runs.list",
  "run.get",
  "run.summary",
  "attempt.get",
  "attempt.trace",
  "attempt.diff",
  "attempt.sources",
  "attempt.artifacts",
  "runs.compare",
].map((id) => ({ id, behaviorVersion: BEHAVIOR_VERSION }));

const discoverBootstrap = () => ({
  protocol: PROTOCOL,
  inspectionRevision: INSPECTION_REVISION,
  operations: operationCatalog,
  followUp: {
    operationDetail: { operationId: "runs.list" },
    firstPage: {
      protocol: PROTOCOL,
      operation: { kind: "runs.list", selector: { project: "fixture" } },
    },
  },
});

const operationDetail = (operationId) => {
  assert.equal(operationId, "runs.list");
  return {
    operation: { id: operationId, behaviorVersion: BEHAVIOR_VERSION },
    requestSchema: {
      type: "object",
      additionalProperties: false,
      required: ["kind"],
      properties: {
        kind: { const: "runs.list" },
        selector: {
          type: "object",
          additionalProperties: false,
          properties: { project: { type: "string" } },
        },
        continuation: { type: "string" },
      },
    },
    resultSchema: {
      type: "object",
      additionalProperties: false,
      required: ["operation", "page"],
      properties: {
        operation: { const: "runs.list" },
        page: {
          type: "object",
          required: ["items", "limits", "continuation"],
          properties: {
            items: { type: "array", maxItems: PAGE_ITEM_CEILING },
            limits: { const: { items: PAGE_ITEM_CEILING, bytes: PAGE_BYTE_CEILING } },
            continuation: { type: ["string", "null"] },
          },
        },
      },
    },
    minimalRequest: {
      protocol: PROTOCOL,
      operation: { kind: "runs.list", selector: { project: "fixture" } },
    },
  };
};

const tokenPayload = (binding, lastLogicalItem) => ({
  tokenVersion: "niceeval.inspection-continuation/v1",
  operationId: binding.operationId,
  behaviorVersion: binding.behaviorVersion,
  inspectionRevision: binding.inspectionRevision,
  sealedCutoff: binding.sealedCutoff,
  selector: binding.selector,
  lastLogicalItem,
});

const encodeContinuation = (binding, lastLogicalItem) =>
  canonicalBytes(tokenPayload(binding, lastLogicalItem)).toString("base64url");

const decodeContinuation = (token) =>
  JSON.parse(Buffer.from(token, "base64url").toString("utf8"));

const restartCorrection = (binding, reason) => ({
  status: "correction",
  error: {
    code: "previous-result",
    reason,
    correction: {
      action: "restart",
      request: {
        protocol: PROTOCOL,
        operation: clone(binding.restartOperation),
      },
    },
  },
});

const validateContinuation = (token, binding) => {
  const decoded = decodeContinuation(token);
  const comparisons = [
    ["operationId", "operation-changed"],
    ["behaviorVersion", "behavior-version-changed"],
    ["inspectionRevision", "inspection-revision-changed"],
    ["sealedCutoff", "sealed-cutoff-changed"],
  ];
  for (const [field, reason] of comparisons) {
    if (decoded[field] !== binding[field]) return restartCorrection(binding, reason);
  }
  if (canonicalText(decoded.selector) !== canonicalText(binding.selector)) {
    return restartCorrection(binding, "selector-changed");
  }
  return { status: "valid", lastLogicalItem: decoded.lastLogicalItem, decoded };
};

const makePageEnvelope = (binding, items, hasMore) => ({
  protocol: PROTOCOL,
  inspectionRevision: binding.inspectionRevision,
  operation: binding.operationId,
  behaviorVersion: binding.behaviorVersion,
  sealedCutoff: binding.sealedCutoff,
  selector: binding.selector,
  page: {
    items,
    limits: { items: PAGE_ITEM_CEILING, bytes: PAGE_BYTE_CEILING },
    continuation: hasMore ? encodeContinuation(binding, items.at(-1).logicalId) : null,
  },
});

const boundedDomainPage = ({ binding, allItems, continuation }) => {
  let after;
  if (continuation) {
    const validation = validateContinuation(continuation, binding);
    if (validation.status !== "valid") return validation;
    after = validation.lastLogicalItem;
  }

  const remaining = allItems.filter((item) => after === undefined || item.logicalId > after);
  const selected = [];
  let stoppedByByteCeiling = false;

  for (const item of remaining) {
    if (selected.length === PAGE_ITEM_CEILING) break;
    const candidate = [...selected, item];
    const envelope = makePageEnvelope(binding, candidate, candidate.length < remaining.length);
    if (canonicalBytes(envelope).byteLength > PAGE_BYTE_CEILING) {
      assert.notEqual(selected.length, 0, "one logical item must fit the fixed byte ceiling");
      stoppedByByteCeiling = true;
      break;
    }
    selected.push(item);
  }

  const page = makePageEnvelope(binding, selected, selected.length < remaining.length);
  assert.ok(selected.length <= PAGE_ITEM_CEILING);
  assert.ok(canonicalBytes(page).byteLength <= PAGE_BYTE_CEILING);
  return { status: "ok", document: page, stoppedByByteCeiling };
};

const hasKey = (value, forbiddenKey) => {
  if (Array.isArray(value)) return value.some((item) => hasKey(item, forbiddenKey));
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(
    ([key, child]) => key === forbiddenKey || hasKey(child, forbiddenKey),
  );
};

const makeClosedSet = (set) => {
  const memberIds = [...set.memberIds].sort();
  const observedIds = memberIds.filter((memberId) => set.observations[memberId] !== undefined);
  const missing = memberIds.filter((memberId) => set.observations[memberId] === undefined);
  return {
    id: set.id,
    memberDomain: set.memberDomain,
    memberIds,
    denominator: {
      basis: set.basis,
      total: memberIds.length,
      observed: observedIds.length,
      missing: missing.length,
    },
    missing,
    values: observedIds.map((memberId) => ({ memberId, value: set.observations[memberId] })),
    evidence: [...set.evidence].sort(),
  };
};

const sideBySide = (left, right) => ({
  kind: "InspectionResult",
  operation: { id: "runs.compare", behaviorVersion: BEHAVIOR_VERSION },
  mode: "side-by-side",
  left: makeClosedSet(left),
  right: makeClosedSet(right),
});

const exact = (left, right) => {
  const leftMembers = [...left.memberIds].sort();
  const rightMembers = [...right.memberIds].sort();
  if (left.memberDomain !== right.memberDomain) {
    return { status: "rejected", code: "exact-member-domain-mismatch" };
  }
  if (canonicalText(leftMembers) !== canonicalText(rightMembers)) {
    return { status: "rejected", code: "exact-member-set-mismatch" };
  }
  return {
    status: "accepted",
    result: {
      kind: "InspectionResult",
      operation: { id: "runs.compare", behaviorVersion: BEHAVIOR_VERSION },
      mode: "exact",
      memberDomain: left.memberDomain,
      exactMemberSet: leftMembers,
      left: makeClosedSet(left),
      right: makeClosedSet(right),
    },
  };
};

const paired = (left, right) => {
  const leftClosed = makeClosedSet(left);
  const rightClosed = makeClosedSet(right);
  const leftByKey = new Map(left.pairing.map((entry) => [entry.key, entry]));
  const rightByKey = new Map(right.pairing.map((entry) => [entry.key, entry]));
  const keys = [...new Set([...leftByKey.keys(), ...rightByKey.keys()])].sort();
  const pairs = [];
  const excluded = [];
  const unmatched = { left: [], right: [] };

  for (const key of keys) {
    const leftEntry = leftByKey.get(key);
    const rightEntry = rightByKey.get(key);
    if (leftEntry && rightEntry && (leftEntry.excluded || rightEntry.excluded)) {
      excluded.push({
        key,
        leftMemberId: leftEntry.memberId,
        rightMemberId: rightEntry.memberId,
        reason: leftEntry.excluded ?? rightEntry.excluded,
      });
    } else if (leftEntry && rightEntry) {
      pairs.push({ key, leftMemberId: leftEntry.memberId, rightMemberId: rightEntry.memberId });
    } else if (leftEntry) {
      unmatched.left.push({ key, memberId: leftEntry.memberId });
    } else {
      unmatched.right.push({ key, memberId: rightEntry.memberId });
    }
  }

  return {
    kind: "InspectionResult",
    operation: { id: "runs.compare", behaviorVersion: BEHAVIOR_VERSION },
    mode: "paired",
    left: leftClosed,
    right: rightClosed,
    pair: {
      denominator: {
        basis: "first-party-pairing-key",
        total: pairs.length,
        observed: pairs.length,
        missing: 0,
      },
      pairs,
      unmatched,
      excluded,
      evidence: [...new Set([...left.evidence, ...right.evidence])].sort(),
    },
  };
};

const logicalComparisonFixture = {
  left: {
    id: "run-left",
    memberDomain: "eval-member/v1",
    memberIds: ["member-a", "member-b", "member-c"],
    basis: "slot",
    observations: { "member-a": "passed", "member-b": "failed" },
    evidence: ["evidence:left:verdict", "evidence:left:selection"],
    pairing: [
      { key: "case-1", memberId: "member-a" },
      { key: "case-2", memberId: "member-b", excluded: "input-identity-mismatch" },
      { key: "case-3", memberId: "member-c" },
    ],
  },
  right: {
    id: "run-right",
    memberDomain: "eval-member/v1",
    memberIds: ["member-x", "member-y", "member-z"],
    basis: "slot",
    observations: { "member-x": "passed", "member-y": "passed", "member-z": "failed" },
    evidence: ["evidence:right:verdict", "evidence:right:selection"],
    pairing: [
      { key: "case-1", memberId: "member-x" },
      { key: "case-2", memberId: "member-y" },
      { key: "case-4", memberId: "member-z" },
    ],
  },
};

const storageRevisionOne = {
  storageRevision: 1,
  rows: Object.values(logicalComparisonFixture).flatMap((set, setIndex) =>
    set.memberIds.map((memberId, memberIndex) => ({
      rowid: setIndex * 100 + memberIndex + 1,
      set_id: set.id,
      member_id: memberId,
      member_domain: set.memberDomain,
      basis: set.basis,
      observation: set.observations[memberId] ?? null,
      pairing: set.pairing.find((entry) => entry.memberId === memberId),
      evidence: set.evidence,
    })),
  ),
};

const storageRevisionTwo = {
  storageRevision: 2,
  segments: Object.values(logicalComparisonFixture).map((set, index) => ({
    physicalOffset: 4_096 * (index + 1),
    header: {
      logicalSetId: set.id,
      memberDomain: set.memberDomain,
      basis: set.basis,
      evidence: set.evidence,
    },
    entries: set.memberIds.map((memberId) => ({
      identity: memberId,
      value: set.observations[memberId] ?? null,
      pair: set.pairing.find((entry) => entry.memberId === memberId),
    })),
  })),
};

const adaptRevisionOne = (physical) => {
  assert.equal(physical.storageRevision, 1);
  const sets = new Map();
  for (const row of physical.rows) {
    const set = sets.get(row.set_id) ?? {
      id: row.set_id,
      memberDomain: row.member_domain,
      memberIds: [],
      basis: row.basis,
      observations: {},
      evidence: row.evidence,
      pairing: [],
    };
    set.memberIds.push(row.member_id);
    if (row.observation !== null) set.observations[row.member_id] = row.observation;
    set.pairing.push(row.pairing);
    sets.set(row.set_id, set);
  }
  return { left: sets.get("run-left"), right: sets.get("run-right") };
};

const adaptRevisionTwo = (physical) => {
  assert.equal(physical.storageRevision, 2);
  const sets = physical.segments.map((segment) => ({
    id: segment.header.logicalSetId,
    memberDomain: segment.header.memberDomain,
    memberIds: segment.entries.map((entry) => entry.identity),
    basis: segment.header.basis,
    observations: Object.fromEntries(
      segment.entries
        .filter((entry) => entry.value !== null)
        .map((entry) => [entry.identity, entry.value]),
    ),
    evidence: segment.header.evidence,
    pairing: segment.entries.map((entry) => entry.pair),
  }));
  return {
    left: sets.find((set) => set.id === "run-left"),
    right: sets.find((set) => set.id === "run-right"),
  };
};

let semanticExecutionCount = 0;
const executeInspection = (logicalFacts, request) => {
  semanticExecutionCount += 1;
  assert.deepEqual(request, {
    kind: "runs.compare",
    mode: "paired",
    left: "run-left",
    right: "run-right",
  });
  return paired(logicalFacts.left, logicalFacts.right);
};

const makeUnavailableFactSource = () => {
  let reads = 0;
  return {
    read() {
      reads += 1;
      throw new Error("delivery must not read facts");
    },
    get reads() { return reads; },
  };
};

const queryMachineDocument = ({ result }) => ({ protocol: PROTOCOL, result });

const showHumanFormatter = ({ result }) => [
  `left denominator=${canonicalText(result.left.denominator)}`,
  `left missing=${canonicalText(result.left.missing)}`,
  `left Evidence=${canonicalText(result.left.evidence)}`,
  `right denominator=${canonicalText(result.right.denominator)}`,
  `right missing=${canonicalText(result.right.missing)}`,
  `right Evidence=${canonicalText(result.right.evidence)}`,
  `pair denominator=${canonicalText(result.pair.denominator)}`,
  `pairing=${canonicalText(result.pair.pairs)}`,
  `unmatched=${canonicalText(result.pair.unmatched)}`,
  `excluded=${canonicalText(result.pair.excluded)}`,
  `pair Evidence=${canonicalText(result.pair.evidence)}`,
].join("\n");

const interactiveInsightPrivateViewModel = ({ result }) => ({
  resultIdentity: sha256(result),
  mode: result.mode,
  panels: {
    left: {
      denominator: result.left.denominator,
      missing: result.left.missing,
      evidence: result.left.evidence,
    },
    right: {
      denominator: result.right.denominator,
      missing: result.right.missing,
      evidence: result.right.evidence,
    },
    pair: result.pair,
  },
});

const deterministicStaticViewModel = ({ result }) => ({
  resultIdentity: sha256(result),
  sections: [
    {
      id: "left",
      denominator: result.left.denominator,
      missing: result.left.missing,
      evidence: result.left.evidence,
    },
    {
      id: "right",
      denominator: result.right.denominator,
      missing: result.right.missing,
      evidence: result.right.evidence,
    },
    { id: "pair", ...result.pair },
  ],
});

const revisionStore = {
  seals: [
    {
      cutoff: 1,
      facts: [
        { logicalId: "attempt:one", runId: "run-one", verdict: "failed", sealedAt: 1 },
      ],
    },
  ],
};

const buildRevision = (number, cutoff) => ({
  identity: `insight-revision-${number}`,
  inspectionRevision: INSPECTION_REVISION,
  sealedCutoff: cutoff,
});

const revisionDetail = (revision, logicalId) => {
  const visibleFacts = revisionStore.seals
    .filter((seal) => seal.cutoff <= revision.sealedCutoff)
    .flatMap((seal) => seal.facts)
    .filter((fact) => fact.sealedAt <= revision.sealedCutoff);
  const fact = visibleFacts.find((item) => item.logicalId === logicalId);
  return fact
    ? {
        status: "ok",
        revision: revision.identity,
        sealedCutoff: revision.sealedCutoff,
        detail: clone(fact),
      }
    : { status: "not-found", revision: revision.identity, sealedCutoff: revision.sealedCutoff };
};

const publishSeal = (seal) => {
  assert.ok(seal.cutoff > revisionStore.seals.at(-1).cutoff);
  revisionStore.seals.push(clone(seal));
  return { pending: true, sealedCutoff: seal.cutoff };
};

// Progressive discovery and bounded logical pagination.
const bootstrap = discoverBootstrap();
assert.ok(canonicalBytes(bootstrap).byteLength <= BOOTSTRAP_BYTE_CEILING);
assert.equal(hasKey(bootstrap, "requestSchema"), false);
const schema = operationDetail(bootstrap.followUp.operationDetail.operationId);
assert.equal(schema.operation.id, "runs.list");
assert.deepEqual(schema.minimalRequest, bootstrap.followUp.firstPage);
assert.equal(schema.resultSchema.properties.page.properties.items.maxItems, PAGE_ITEM_CEILING);

const pageBinding = {
  operationId: "runs.list",
  behaviorVersion: BEHAVIOR_VERSION,
  inspectionRevision: INSPECTION_REVISION,
  sealedCutoff: "seal-0007",
  selector: { project: "fixture" },
  restartOperation: { kind: "runs.list", selector: { project: "fixture" } },
};
const domainItems = [
  { logicalId: "run-001", state: "sealed", label: "alpha" },
  { logicalId: "run-002", state: "sealed", label: "beta" },
  { logicalId: "run-003", state: "sealed", label: "gamma" },
  { logicalId: "run-004", state: "sealed", label: "delta" },
];
const firstPage = boundedDomainPage({ binding: pageBinding, allItems: domainItems });
assert.equal(firstPage.status, "ok");
assert.equal(firstPage.document.page.items.length, PAGE_ITEM_CEILING);
assert.ok(firstPage.document.page.continuation);
assert.ok(canonicalBytes(firstPage.document).byteLength <= PAGE_BYTE_CEILING);

const decodedToken = decodeContinuation(firstPage.document.page.continuation);
assert.deepEqual(decodedToken, tokenPayload(pageBinding, "run-002"));
const forbiddenPhysicalTerms = ["cursor", "rowid", "sql", "offset", "database"];
const decodedTokenText = canonicalText(decodedToken).toLowerCase();
for (const term of forbiddenPhysicalTerms) assert.equal(decodedTokenText.includes(term), false);

const secondPage = boundedDomainPage({
  binding: pageBinding,
  allItems: domainItems,
  continuation: firstPage.document.page.continuation,
});
assert.equal(secondPage.status, "ok");
assert.deepEqual(
  secondPage.document.page.items.map((item) => item.logicalId),
  ["run-003", "run-004"],
);

const bytePressureItems = domainItems.map((item, index) => ({
  ...item,
  summary: `${index}:`.padEnd(170, String(index)),
}));
const bytePressurePage = boundedDomainPage({ binding: pageBinding, allItems: bytePressureItems });
assert.equal(bytePressurePage.status, "ok");
assert.equal(bytePressurePage.stoppedByByteCeiling, true);
assert.equal(bytePressurePage.document.page.items.length, 1);
assert.ok(canonicalBytes(bytePressurePage.document).byteLength <= PAGE_BYTE_CEILING);

for (const [field, changedValue, expectedReason] of [
  ["operationId", "run.summary", "operation-changed"],
  ["behaviorVersion", "2.0.0", "behavior-version-changed"],
  ["inspectionRevision", "inspection/revision-8", "inspection-revision-changed"],
  ["sealedCutoff", "seal-0008", "sealed-cutoff-changed"],
]) {
  const currentBinding = {
    ...pageBinding,
    [field]: changedValue,
    restartOperation: field === "operationId"
      ? { kind: "run.summary", runId: "run-001" }
      : pageBinding.restartOperation,
  };
  const correction = validateContinuation(firstPage.document.page.continuation, currentBinding);
  assert.equal(correction.status, "correction");
  assert.equal(correction.error.code, "previous-result");
  assert.equal(correction.error.reason, expectedReason);
  assert.equal(correction.error.correction.action, "restart");
  assert.deepEqual(
    correction.error.correction.request.operation,
    currentBinding.restartOperation,
  );
  assert.equal(hasKey(correction.error.correction.request, "continuation"), false);
}

// Comparison is closed once, including denominator, missing and Evidence.
const sideBySideResult = sideBySide(
  logicalComparisonFixture.left,
  logicalComparisonFixture.right,
);
assert.deepEqual(
  sideBySideResult.left.denominator,
  { basis: "slot", total: 3, observed: 2, missing: 1 },
);
assert.deepEqual(sideBySideResult.left.missing, ["member-c"]);
assert.deepEqual(
  sideBySideResult.right.denominator,
  { basis: "slot", total: 3, observed: 3, missing: 0 },
);
assert.deepEqual(sideBySideResult.right.missing, []);
assert.equal(sideBySideResult.left.evidence.length, 2);
assert.equal(sideBySideResult.right.evidence.length, 2);
assert.equal(hasKey(sideBySideResult, "delta"), false);

const exactLeft = clone(logicalComparisonFixture.left);
const exactRight = {
  ...clone(exactLeft),
  id: "exact-right",
  observations: {
    "member-a": "passed",
    "member-b": "passed",
    "member-c": "passed",
  },
  evidence: ["evidence:exact:right"],
};
assert.equal(exact(exactLeft, exactRight).status, "accepted");
assert.deepEqual(
  exact(exactLeft, { ...exactRight, memberDomain: "other-domain/v1" }),
  { status: "rejected", code: "exact-member-domain-mismatch" },
);
assert.deepEqual(
  exact(exactLeft, { ...exactRight, memberIds: ["member-a", "member-b"] }),
  { status: "rejected", code: "exact-member-set-mismatch" },
);

const pairedResult = paired(logicalComparisonFixture.left, logicalComparisonFixture.right);
assert.equal(pairedResult.left.denominator.total, 3);
assert.equal(pairedResult.right.denominator.total, 3);
assert.equal(pairedResult.pair.denominator.total, 1);
assert.deepEqual(pairedResult.pair.unmatched, {
  left: [{ key: "case-3", memberId: "member-c" }],
  right: [{ key: "case-4", memberId: "member-z" }],
});
assert.deepEqual(pairedResult.pair.excluded, [{
  key: "case-2",
  leftMemberId: "member-b",
  rightMemberId: "member-y",
  reason: "input-identity-mismatch",
}]);
assert.equal(pairedResult.pair.evidence.length, 4);
assert.equal(hasKey(pairedResult, "delta"), false);

// Physical storage revisions disappear before the canonical InspectionResult.
const inspectionRequest = {
  kind: "runs.compare",
  mode: "paired",
  left: "run-left",
  right: "run-right",
};
const revisionOneResult = executeInspection(
  adaptRevisionOne(storageRevisionOne),
  inspectionRequest,
);
const revisionTwoResult = executeInspection(
  adaptRevisionTwo(storageRevisionTwo),
  inspectionRequest,
);
assert.deepEqual(revisionOneResult, revisionTwoResult);
assert.equal(
  Buffer.compare(canonicalBytes(revisionOneResult), canonicalBytes(revisionTwoResult)),
  0,
);
assert.equal(hasKey(revisionOneResult, "storageRevision"), false);
const canonicalResult = revisionOneResult;

// Every delivery surface receives the same closed result and an unusable fact source.
const factSource = makeUnavailableFactSource();
const deliveryContext = Object.freeze({ result: canonicalResult, factSource });
const semanticExecutionsBeforeDelivery = semanticExecutionCount;
const machineDocument = queryMachineDocument(deliveryContext);
const humanText = showHumanFormatter(deliveryContext);
const interactiveViewModel = interactiveInsightPrivateViewModel(deliveryContext);
const staticViewModelOne = deterministicStaticViewModel(deliveryContext);
const staticViewModelTwo = deterministicStaticViewModel(deliveryContext);
assert.equal(machineDocument.result, canonicalResult);
assert.ok(humanText.includes(canonicalText(canonicalResult.left.denominator)));
assert.ok(humanText.includes(canonicalText(canonicalResult.pair.unmatched)));
assert.equal(interactiveViewModel.resultIdentity, sha256(canonicalResult));
assert.equal(staticViewModelOne.resultIdentity, sha256(canonicalResult));
assert.equal(
  Buffer.compare(canonicalBytes(staticViewModelOne), canonicalBytes(staticViewModelTwo)),
  0,
);
assert.equal(factSource.reads, 0);
assert.equal(semanticExecutionCount, semanticExecutionsBeforeDelivery);

// Publication only marks pending; old detail stays at its cutoff until refresh.
let activeRevision = buildRevision(1, 1);
const oldDetailBeforePublication = revisionDetail(activeRevision, "attempt:one");
const publication = publishSeal({
  cutoff: 2,
  facts: [
    { logicalId: "attempt:two", runId: "run-two", verdict: "passed", sealedAt: 2 },
  ],
});
assert.equal(publication.pending, true);
const oldDetailAfterPublication = revisionDetail(activeRevision, "attempt:one");
assert.deepEqual(oldDetailAfterPublication, oldDetailBeforePublication);
assert.equal(revisionDetail(activeRevision, "attempt:two").status, "not-found");
activeRevision = buildRevision(2, publication.sealedCutoff);
const refreshedDetail = revisionDetail(activeRevision, "attempt:two");
assert.equal(refreshedDetail.status, "ok");
assert.equal(refreshedDetail.sealedCutoff, 2);

const receipt = {
  protocol: "niceeval.inspection-protocol-spike-receipt/v1",
  status: "passed",
  assertions: {
    progressiveDiscovery: true,
    boundedDomainPage: true,
    logicalContinuationBinding: true,
    previousResultRestartCorrection: true,
    closedComparisonModes: true,
    storageRevisionNeutrality: true,
    singleCanonicalDeliveryResult: true,
    revisionCutoffRefresh: true,
  },
  limits: {
    bootstrapBytes: canonicalBytes(bootstrap).byteLength,
    bootstrapByteCeiling: BOOTSTRAP_BYTE_CEILING,
    pageItems: firstPage.document.page.items.length,
    pageItemCeiling: PAGE_ITEM_CEILING,
    pageBytes: canonicalBytes(firstPage.document).byteLength,
    pageByteCeiling: PAGE_BYTE_CEILING,
    bytePressurePageItems: bytePressurePage.document.page.items.length,
  },
  identities: {
    canonicalInspectionResultSha256: sha256(canonicalResult),
    storageRevisionOneResultSha256: sha256(revisionOneResult),
    storageRevisionTwoResultSha256: sha256(revisionTwoResult),
  },
  delivery: {
    semanticExecutionsBeforeDelivery,
    semanticExecutionsAfterDelivery: semanticExecutionCount,
    factReads: factSource.reads,
    consumers: [
      "query-machine-document",
      "show-human-formatter",
      "insight-private-view-model",
      "deterministic-static-view-model",
    ],
  },
  revisions: {
    before: {
      identity: oldDetailBeforePublication.revision,
      sealedCutoff: oldDetailBeforePublication.sealedCutoff,
    },
    afterPublicationBeforeRefresh: {
      identity: oldDetailAfterPublication.revision,
      sealedCutoff: oldDetailAfterPublication.sealedCutoff,
    },
    afterRefresh: {
      identity: refreshedDetail.revision,
      sealedCutoff: refreshedDetail.sealedCutoff,
    },
  },
  notProven: [
    "loopback-authentication",
    "real-browser-ui",
    "macos",
    "windows",
  ],
};

process.stdout.write(`${canonicalText(receipt)}\n`);
