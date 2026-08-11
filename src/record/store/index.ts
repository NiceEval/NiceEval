// Internal Store package entry. `src/record/index.ts` owns the public `niceeval/record` export
// surface and may selectively wrap LocalRecordStore; backend primitives deliberately remain here.

export {
  createLocalRecordStoreGraphAccessV1,
  DEFAULT_LOCAL_RECORD_STORE_COMMITTED_ROOT_RADIX_VERIFICATION_LIMITS_V1,
  DEFAULT_LOCAL_RECORD_STORE_GRAPH_ACCESS_OPTIONS_V1,
  DEFAULT_LOCAL_RECORD_STORE_GRAPH_ACCESS_V1,
  DEFAULT_LOCAL_RECORD_STORE_GRAPH_VERIFICATION_LIMITS_V1,
  LOCAL_RECORD_STORE_BUILTIN_CODEC_REGISTRY_V1,
  type LocalRecordStoreGraphAccessOptionsV1,
} from "./graph-access.ts";

export {
  LocalRecordStore,
  localBackendOf,
  type LocalRecordStoreState,
} from "./record-store.ts";
export {
  LocalRecordStoreBackend,
  LocalBackendTransaction,
  LocalBackendMirrorInstall,
  LocalBackendReadLease,
  LocalBackendPersistentPin,
  LocalBackendGcBarrier,
  type LocalBackendGcRoot,
  type LocalBackendGcSnapshot,
  type LocalBackendReadOwner,
  type LocalBackendRetainOwner,
  type LocalBackendWriteOwner,
  type LocalCommitPlan,
  type LocalCommitResult,
  type LocalMirrorInstallResult,
  type LocalMirrorInstallState,
  type LocalMirrorSnapshotAccess,
  type LocalRecordStoreGraphAccess,
} from "./backend.ts";
