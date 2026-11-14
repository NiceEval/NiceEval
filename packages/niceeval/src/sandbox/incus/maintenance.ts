import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Effect, Schema } from "effect";
import { IncusControl } from "./control.ts";
import { domainByName, loadIncusDescriptor, type IncusDomainDescriptor, type IncusDomainName } from "./descriptor.ts";
import { acquireDomainAdmissionLock } from "./ledger.ts";
import { incusRepositoryHost, type IncusRepository } from "./repository.ts";
import {
  artifactBelongsToDomain,
  inventoryDocument,
  readArtifactInventory,
  renderArtifactInventory,
  verifyArtifactObjects,
  type ArtifactInventoryEntry,
} from "./inventory.ts";
import {
  GcItemOutcomeSchema,
  GcOutcomeSchema,
  GcPlanSchema,
  artifactEvidenceDigest,
  artifactResourceIdentity,
  gcDigest,
  gcParseOptions,
  type GcCandidate,
  type GcItemOutcome,
  type GcOutcome,
  type GcPlan,
} from "./gc-protocol.ts";

const POLICY_VERSION = 1;
const OutcomeEnvelopeSchema = Schema.Struct({
  document: GcOutcomeSchema,
  before: Schema.NullOr(Schema.Number),
  after: Schema.NullOr(Schema.Number),
});
type OutcomeEnvelope = typeof OutcomeEnvelopeSchema.Type;
interface Authority {
  readonly backendIdentity: string;
  readonly issuerEpoch: string;
}
class MaintenanceFailure extends Error {
  constructor(
    readonly exitCode: 2 | 3 | 4,
    readonly reason: string,
    detail: string,
  ) {
    super(`${reason}: ${detail}`);
  }
}
export interface IncusMaintenanceOptions {
  readonly action: "inventory" | "gc";
  readonly domain?: IncusDomainName;
  readonly json?: boolean;
  readonly apply?: string;
  readonly unusedFor?: string;
}
export interface IncusMaintenanceResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export function parseUnusedDuration(value: string): number {
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h|d|w)$/u.exec(value);
  const units: Readonly<Record<string, number>> = {
    ms: 1,
    s: 1000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
    w: 604_800_000,
  };
  const duration = match === null ? NaN : Number(match[1]) * (units[match[2]!] ?? NaN);
  if (!Number.isSafeInteger(duration) || duration <= 0)
    throw new MaintenanceFailure(2, "invalid-duration", "--unused-for requires a positive duration such as 30d or 12h");
  return duration;
}

async function authority(control: IncusControl, domain: IncusDomainDescriptor): Promise<Authority> {
  if (
    domain.status !== "configured" ||
    !(await control.projectExists(domain.project)) ||
    !(await control.projectExists(domain.artifactProject))
  )
    throw new MaintenanceFailure(4, "domain-unavailable", "Incus runtime and artifact projects must be deployed");
  const server = await control.getServerIdentity();
  const pool =
    domain.name === "development"
      ? await control.attestDevelopmentStorage(domain.project, domain.storagePool)
      : domain.source !== undefined && domain.backingDevice !== undefined
        ? await control.attestReferenceStorage(domain.project, domain.storagePool, domain.network, {
            source: domain.source,
            backingDevice: domain.backingDevice,
          })
        : undefined;
  if (pool === undefined)
    throw new MaintenanceFailure(4, "domain-unavailable", "Incus storage authority is unavailable");
  const boot = (await readFile("/proc/sys/kernel/random/boot_id", "utf8")).trim();
  if (boot === "") throw new MaintenanceFailure(4, "domain-unavailable", "Host boot identity is unavailable");
  return {
    backendIdentity: gcDigest({
      fingerprint: server.fingerprint,
      name: server.name,
      pool,
      project: domain.project,
      artifactProject: domain.artifactProject,
    }),
    issuerEpoch: gcDigest({ boot, daemon: server.pid }),
  };
}

interface RetirementRule {
  readonly ruleId: GcCandidate["ruleId"];
  readonly protectedUntil: string;
}
async function ruleFor(
  repository: IncusRepository,
  entry: ArtifactInventoryEntry,
  domain: IncusDomainDescriptor,
  observed: number,
  unusedFor: number | undefined,
): Promise<RetirementRule | undefined> {
  const a = entry.intent;
  const rule = (ruleId: GcCandidate["ruleId"], protectedUntil = a.createdAt): RetirementRule => ({
    ruleId,
    protectedUntil,
  });
  if (
    a.state === "released" ||
    a.state === "quarantined" ||
    entry.consumerHolds !== 0 ||
    entry.verification === "metadata-drift"
  )
    return undefined;
  if (entry.instanceAbsent && entry.volumeAbsent) return rule("dangling-intent");
  if (a.retirementPlanId !== undefined) {
    if (a.state !== "invalid" && a.state !== "retiring") return undefined;
    const stored = await repository.getGcPlan(a.retirementPlanId);
    if (stored === null) return undefined;
    let previous: GcPlan;
    try {
      previous = Schema.decodeUnknownSync(GcPlanSchema, gcParseOptions)(JSON.parse(stored.payload));
    } catch {
      return undefined;
    }
    if (
      previous.planId !== a.retirementPlanId ||
      previous.ownerId !== repository.ownerId ||
      gcDigest(previous) !== stored.digest
    )
      return undefined;
    const original = previous.candidates.find(
      (candidate) =>
        candidate.entryId === a.artifactId &&
        candidate.immutableResourceIdentity === artifactResourceIdentity(a) &&
        candidate.manifestDigest === a.manifestDigest &&
        candidate.keyDigest === a.beforeCacheKey,
    );
    // Invalidation already made this exact generation unavailable to consumers.
    // Continue that recorded decision under a fresh plan, even after the old plan
    // expired or recorded failure. A dangling-only plan never authorizes deletion.
    if (original === undefined || original.ruleId === "dangling-intent") return undefined;
    return rule(original.ruleId, original.evidence.protectedUntil);
  }
  if (entry.verification !== "verified" && a.state !== "retiring") return undefined;
  if (a.state !== "committed" && a.state !== "retiring") return undefined;
  if (a.executionDomainId !== domain.executionDomainId) return rule("superseded-domain-revision");
  if (entry.superseded) return rule("superseded-generation");
  if (
    a.state === "committed" &&
    unusedFor !== undefined &&
    Date.parse(a.lastSuccessfulHoldAt ?? a.createdAt) + unusedFor < observed
  )
    return rule("unused", new Date(Date.parse(a.lastSuccessfulHoldAt ?? a.createdAt) + unusedFor).toISOString());
  return undefined;
}

async function preview(
  repository: IncusRepository,
  control: IncusControl,
  domain: IncusDomainDescriptor,
  facts: Authority,
  unusedFor: number | undefined,
) {
  const inventory = await readArtifactInventory(repository, control, domain);
  const observed = Date.now();
  const candidates: GcCandidate[] = [];
  for (const entry of inventory.entries) {
    const selection = await ruleFor(repository, entry, domain, observed, unusedFor);
    if (selection === undefined) continue;
    const { ruleId, protectedUntil } = selection;
    const a = entry.intent;
    candidates.push({
      entryId: a.artifactId,
      keyDigest: a.beforeCacheKey,
      immutableResourceIdentity: artifactResourceIdentity(a),
      manifestDigest: a.manifestDigest,
      evidenceDigest: artifactEvidenceDigest(a),
      evidence: {
        createdAt: a.createdAt,
        lastSuccessfulUseAt: a.lastSuccessfulHoldAt ?? null,
        protectedUntil,
        capacity: null,
      },
      ruleId,
      orderKey: `${ruleId}:${a.createdAt}:${a.artifactId}`,
    });
  }
  candidates.sort((left, right) => left.orderKey.localeCompare(right.orderKey));
  const plan: GcPlan = {
    schemaVersion: 1,
    planId: randomUUID(),
    domainId: domain.executionDomainId,
    ownerId: repository.ownerId,
    ...facts,
    registrySafetyRevision: 4,
    policyVersion: POLICY_VERSION,
    observedAt: new Date(observed).toISOString(),
    expiresAt: new Date(observed + 15 * 60_000).toISOString(),
    candidates,
  };
  await repository.saveGcPlan(plan);
  return {
    document: { plan, summary: { candidateCount: candidates.length, exactReclaimBytes: null } },
    estimates: candidates.map((candidate) => ({
      entryId: candidate.entryId,
      bytes:
        inventory.entries.find((entry) => entry.intent.artifactId === candidate.entryId)?.intent
          .estimatedArtifactBytes ?? null,
    })),
  };
}

function validatePlan(
  plan: GcPlan,
  digest: string,
  planId: string,
  repository: IncusRepository,
  domain: IncusDomainDescriptor,
  facts: Authority,
): void {
  const refuse = (reason: string, message: string): never => {
    throw new MaintenanceFailure(3, reason, message);
  };
  if (
    plan.planId !== planId ||
    gcDigest(plan) !== digest ||
    new Set(plan.candidates.map((entry) => entry.entryId)).size !== plan.candidates.length
  )
    refuse("plan-corrupt", "The immutable plan does not match its stored digest");
  if (plan.ownerId !== repository.ownerId) refuse("owner-changed", "The plan belongs to another repository owner");
  if (plan.backendIdentity !== facts.backendIdentity || plan.domainId !== domain.executionDomainId)
    refuse("backend-changed", "The Incus backend or domain revision changed");
  if (plan.issuerEpoch !== facts.issuerEpoch)
    refuse("issuer-changed", "The host boot or Incus controller epoch changed");
  if (plan.policyVersion !== POLICY_VERSION || plan.registrySafetyRevision !== 4)
    refuse("policy-changed", "The GC policy or registry safety contract changed");
  if (
    Date.parse(plan.expiresAt) <= Date.now() ||
    Date.parse(plan.expiresAt) - Date.parse(plan.observedAt) !== 15 * 60_000
  )
    refuse("plan-expired", "The GC preview has expired; create a fresh preview");
}

async function applyCandidate(
  repository: IncusRepository,
  control: IncusControl,
  domain: IncusDomainDescriptor,
  plan: GcPlan,
  candidate: GcCandidate,
): Promise<GcItemOutcome> {
  const outcome = (
    status: GcItemOutcome["status"],
    reasonCode: GcItemOutcome["reasonCode"],
    message: string,
  ): GcItemOutcome => ({
    entryId: candidate.entryId,
    resourceIdentity: candidate.immutableResourceIdentity,
    status,
    reasonCode,
    message,
  });
  const initial = await repository.getArtifact(candidate.entryId);
  if (initial === undefined || !artifactBelongsToDomain(initial, domain))
    return outcome("skipped", "entry-state-changed", "The planned intent is absent or outside the domain");
  // Match the publisher's scope -> domain lock order. Holds are additionally
  // checked in the atomic claim transaction, since readers need no scope lock.
  const scope = await acquireDomainAdmissionLock(
    repository,
    `${initial.executionDomainId}:artifact-scope:${initial.replacementScopeDigest ?? initial.artifactId}`,
  );
  try {
    const lock = await acquireDomainAdmissionLock(repository, initial.executionDomainId);
    try {
      const current = await repository.getArtifact(candidate.entryId);
      if (current === undefined || current.state === "quarantined")
        return outcome("skipped", "unverified", "The planned intent is unavailable or quarantined");
      if (artifactResourceIdentity(current) !== candidate.immutableResourceIdentity)
        return outcome("skipped", "resource-changed", "The immutable resource identity changed");
      if (current.manifestDigest !== candidate.manifestDigest)
        return outcome("skipped", "manifest-changed", "The manifest changed");
      if ((await repository.countArtifactHolds(current.artifactId, current.generation)) !== 0)
        return outcome(
          "skipped",
          "hold-acquired",
          "A consumer holds the artifact; hint: wait for consumer holds to reach zero and retry.",
        );
      const vm = await control.getInstance(current.project, current.instance);
      const volume = await control.getVolume(current.project, current.pool, current.dockerDataVolume);
      const verification = verifyArtifactObjects(current, vm, volume);
      const resuming = current.retirementPlanId === plan.planId;
      const continuingRetirement =
        current.retirementPlanId !== undefined && (current.state === "invalid" || current.state === "retiring");
      if (verification === "metadata-drift") return outcome("skipped", "unverified", "Provider metadata drifted");
      if (candidate.ruleId === "dangling-intent" && (vm !== undefined || volume !== undefined))
        return outcome("skipped", "resource-changed", "A provider object reappeared after preview");
      if (
        candidate.ruleId !== "dangling-intent" &&
        verification !== "verified" &&
        !resuming &&
        !continuingRetirement &&
        current.state !== "retiring"
      )
        return outcome("skipped", "resource-changed", "The provider pair changed after preview");
      if (candidate.ruleId === "superseded-generation" && !resuming && !continuingRetirement) {
        const head =
          current.replacementScopeDigest === undefined
            ? undefined
            : await repository.getArtifactHead(current.replacementScopeDigest);
        if (head === undefined || head.state !== "committed" || head.artifactId === current.artifactId)
          return outcome("skipped", "entry-state-changed", "There is no committed replacement head");
      }
      const claim = await repository.claimGcArtifact(plan.planId, current.artifactId);
      if (claim.status !== "claimed" || claim.intent === null)
        return outcome(
          "skipped",
          claim.status === "hold-acquired" ? "hold-acquired" : "entry-state-changed",
          "The preview evidence changed before invalidation",
        );
      if (claim.intent.state === "released")
        return vm === undefined && volume === undefined
          ? outcome("already-absent", "already-absent", "Both absences were already durably recorded")
          : outcome("skipped", "resource-changed", "Objects reappeared after release");
      const requested = await repository.requestArtifactRelease(claim.intent);
      if (
        (requested.instanceAbsent && vm !== undefined) ||
        (requested.customStorageVolumeAbsent && volume !== undefined)
      )
        throw new MaintenanceFailure(
          4,
          "domain-stopped",
          "A provider object reappeared after its durable absence receipt",
        );
      if (candidate.ruleId !== "dangling-intent" && vm !== undefined)
        await control.deleteInstance(current.project, current.instance);
      await control.waitAbsent(current.project, current.instance);
      const first = await repository.observeArtifactRelease(requested.intent, {
        instanceAbsent: true,
        customStorageVolumeAbsent: requested.customStorageVolumeAbsent,
      });
      // A dependent-volume deletion may have happened with the instance; re-read
      // the exact volume and verify it again before any separate delete.
      const remaining = await control.getVolume(current.project, current.pool, current.dockerDataVolume);
      if (remaining !== undefined) {
        if (
          candidate.ruleId === "dangling-intent" ||
          verifyArtifactObjects(current, undefined, remaining) === "metadata-drift"
        )
          throw new MaintenanceFailure(4, "domain-stopped", "The volume changed during retirement");
        await control.deleteVolume(current.project, current.pool, current.dockerDataVolume);
      }
      await control.waitVolumeAbsent(current.project, current.pool, current.dockerDataVolume);
      if ((await control.getInstance(current.project, current.instance)) !== undefined)
        throw new MaintenanceFailure(4, "domain-stopped", "The instance reappeared before the final absence receipt");
      if (first.intent.state !== "released")
        await repository.observeArtifactRelease(first.intent, {
          instanceAbsent: true,
          customStorageVolumeAbsent: true,
        });
      return vm === undefined && volume === undefined
        ? outcome("already-absent", "already-absent", "Confirmed both provider objects absent")
        : outcome("deleted", "deleted", "Deleted the exact artifact pair and recorded both absences");
    } finally {
      await lock.release();
    }
  } finally {
    await scope.release();
  }
}

async function apply(
  repository: IncusRepository,
  control: IncusControl,
  domain: IncusDomainDescriptor,
  facts: Authority,
  planId: string,
): Promise<OutcomeEnvelope> {
  const lock = await acquireDomainAdmissionLock(repository, `incus-gc-plan:${planId}`);
  try {
    const stored = await repository.getGcPlan(planId);
    if (stored === null) throw new MaintenanceFailure(3, "plan-corrupt", "Unknown GC plan id");
    let plan: GcPlan;
    let previous: readonly GcItemOutcome[];
    try {
      plan = Schema.decodeUnknownSync(GcPlanSchema, gcParseOptions)(JSON.parse(stored.payload));
      previous = Schema.decodeUnknownSync(
        Schema.Array(GcItemOutcomeSchema),
        gcParseOptions,
      )(JSON.parse(stored.progress));
    } catch {
      throw new MaintenanceFailure(3, "plan-corrupt", "The stored GC plan or audit has an invalid shape");
    }
    validatePlan(plan, stored.digest, planId, repository, domain, facts);
    if (
      new Set(previous.map((item) => item.entryId)).size !== previous.length ||
      previous.some(
        (item) =>
          !plan.candidates.some(
            (candidate) =>
              candidate.entryId === item.entryId && candidate.immutableResourceIdentity === item.resourceIdentity,
          ),
      )
    )
      throw new MaintenanceFailure(3, "plan-corrupt", "The durable audit does not belong to this plan");
    if (stored.outcome !== null) {
      try {
        const envelope = Schema.decodeUnknownSync(OutcomeEnvelopeSchema, gcParseOptions)(JSON.parse(stored.outcome));
        if (
          envelope.document.planId !== planId ||
          envelope.document.domainId !== plan.domainId ||
          gcDigest(envelope.document.outcomes) !== gcDigest(previous)
        )
          throw new Error("Outcome identity changed");
        return envelope;
      } catch {
        throw new MaintenanceFailure(3, "plan-corrupt", "The stored GC outcome is invalid");
      }
    }
    const startedAt = new Date().toISOString();
    const before = await control
      .getStoragePoolResources(domain.artifactProject, domain.storagePool)
      .then((pool) => pool.free)
      .catch(() => null);
    const outcomes: GcItemOutcome[] = [...previous];
    let stopped = false;
    for (const candidate of plan.candidates) {
      if (outcomes.some((item) => item.entryId === candidate.entryId)) continue;
      let item: GcItemOutcome;
      try {
        if (stopped)
          throw new MaintenanceFailure(
            4,
            "domain-stopped",
            "GC authority was lost; no further candidates were attempted",
          );
        const currentAuthority = await authority(control, domain);
        if (gcDigest(currentAuthority) !== gcDigest(facts) || Date.parse(plan.expiresAt) <= Date.now())
          throw new MaintenanceFailure(4, "domain-stopped", "GC authority or plan validity changed during apply");
        item = await applyCandidate(repository, control, domain, plan, candidate);
      } catch (cause) {
        const unavailable =
          cause instanceof MaintenanceFailure ||
          (typeof cause === "object" &&
            cause !== null &&
            "code" in cause &&
            ["incus-unreachable", "user-database-invalid", "user-database-busy"].includes(String(cause.code)));
        item = {
          entryId: candidate.entryId,
          resourceIdentity: candidate.immutableResourceIdentity,
          status: stopped ? "not-attempted" : "failed",
          reasonCode: unavailable ? "domain-stopped" : "delete-failed",
          message: cause instanceof Error ? cause.message : String(cause),
        };
        if (unavailable) stopped = true;
      }
      await repository.appendGcOutcome(planId, item);
      outcomes.push(item);
    }
    const after = await control
      .getStoragePoolResources(domain.artifactProject, domain.storagePool)
      .then((pool) => pool.free)
      .catch(() => null);
    const count = (status: GcItemOutcome["status"]) => outcomes.filter((item) => item.status === status).length;
    const document: GcOutcome = {
      planId,
      domainId: domain.executionDomainId,
      startedAt,
      finishedAt: new Date().toISOString(),
      outcomes,
      summary: {
        deleted: count("deleted"),
        alreadyAbsent: count("already-absent"),
        skipped: count("skipped"),
        failed: count("failed"),
        notAttempted: count("not-attempted"),
        exactReclaimedBytes: null,
      },
    };
    const envelope = { document, before, after };
    await repository.finishGcPlan(planId, JSON.stringify(envelope));
    return envelope;
  } finally {
    await lock.release();
  }
}

export function runIncusMaintenance(options: IncusMaintenanceOptions): Effect.Effect<IncusMaintenanceResult> {
  return Effect.scoped(
    Effect.gen(function* () {
      const unusedFor = yield* Effect.try({
        try: () => {
          if (options.apply !== undefined && options.unusedFor !== undefined)
            throw new MaintenanceFailure(2, "invalid-options", "--apply cannot be combined with --unused-for");
          return options.unusedFor === undefined ? undefined : parseUnusedDuration(options.unusedFor);
        },
        catch: (cause) => cause,
      });
      const repository = yield* incusRepositoryHost.open();
      return yield* Effect.tryPromise({
        try: async () => {
          const domain = domainByName(await loadIncusDescriptor(), options.domain ?? "reference");
          if (domain === undefined)
            throw new MaintenanceFailure(4, "domain-unavailable", "The requested Incus domain is not configured");
          const control =
            options.apply === undefined ? await IncusControl.connectReadOnly() : await IncusControl.connectMutation();
          const facts = await authority(control, domain);
          if (options.action === "inventory") {
            const inventory = await readArtifactInventory(repository, control, domain);
            return {
              exitCode: 0,
              stdout: options.json
                ? `${JSON.stringify(inventoryDocument(domain, inventory))}\n`
                : renderArtifactInventory(domain, inventory),
              stderr: "",
            };
          }
          if (options.apply === undefined) {
            const { document, estimates } = await preview(repository, control, domain, facts, unusedFor);
            const lines = [
              `GC preview ${document.plan.planId} · domain ${domain.executionDomainId} · expires in 15m`,
              `${document.summary.candidateCount} candidates · exact reclaim unknown`,
              ...document.plan.candidates.map((item) => `  ${item.entryId.slice(0, 12)} · ${item.ruleId}`),
              `Reclaim estimates (not additive): ${estimates.map((entry) => `${entry.entryId.slice(0, 12)} ${entry.bytes ?? "unknown"} bytes estimate`).join(", ") || "none"}`,
              `Apply with: niceeval sandbox provider gc incus${domain.name === "development" ? " --development" : ""} --apply ${document.plan.planId}`,
            ];
            return {
              exitCode: 0,
              stdout: options.json ? `${JSON.stringify(document)}\n` : `${lines.join("\n")}\n`,
              stderr: "",
            };
          }
          const envelope = await apply(repository, control, domain, facts, options.apply);
          const document = envelope.document;
          const summary = document.summary;
          const lines = [
            `GC outcome ${document.planId} · ${summary.deleted} deleted · ${summary.alreadyAbsent} already-absent · ${summary.skipped} skipped · ${summary.failed} failed · ${summary.notAttempted} not-attempted`,
            ...document.outcomes.map(
              (item) => `  ${item.status} ${item.entryId.slice(0, 12)} · ${item.reasonCode} · ${item.message}`,
            ),
            `pool free bytes: before=${envelope.before ?? "unknown"} after=${envelope.after ?? "unknown"}; exact marginal reclaim unknown`,
          ];
          return {
            exitCode: summary.skipped + summary.failed + summary.notAttempted === 0 ? 0 : 1,
            stdout: options.json ? `${JSON.stringify(document)}\n` : `${lines.join("\n")}\n`,
            stderr: "",
          };
        },
        catch: (cause) => cause,
      });
    }),
  ).pipe(
    Effect.catch((cause) =>
      Effect.succeed({
        exitCode: cause instanceof MaintenanceFailure ? cause.exitCode : 4,
        stdout: "",
        stderr: `${cause instanceof Error ? cause.message : String(cause)}\n`,
      }),
    ),
  );
}
