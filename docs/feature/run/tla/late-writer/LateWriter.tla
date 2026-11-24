--------------------------- MODULE LateWriter ---------------------------
EXTENDS Naturals
CONSTANT K
VARIABLES ownerDead, rpc, authority, publication, snapshot
v == <<ownerDead,rpc,authority,publication,snapshot>>
Keys == 1..K
Init == /\ ownerDead=FALSE /\ rpc=[k \in Keys |-> "queued"] /\ authority=[k \in Keys |-> "original"]
        /\ publication={} /\ snapshot={}
\* runner/record.ts:876-903; run/storage/sqlite.ts:324-338. Old writer already sent the command.
Stage(k) == /\ rpc[k]="queued"
            /\ rpc'=[rpc EXCEPT ![k]=IF authority[k]="original" THEN "staged" ELSE "done"]
            /\ UNCHANGED <<ownerDead,authority,publication,snapshot>>
\* run/storage/sqlite.ts:339-415. After staging, recheck exact writer inside publish transaction.
Commit(k) == /\ rpc[k]="staged" /\ rpc'=[rpc EXCEPT ![k]="done"]
             /\ publication'=IF authority[k]="original" THEN publication \cup {k} ELSE publication
             /\ UNCHANGED <<ownerDead,authority,snapshot>>
\* External process-loss boundary; run/host/lifecycle-adapter.ts:287-322 validates identity separately.
Crash == /\ ~ownerDead /\ ownerDead'=TRUE /\ UNCHANGED <<rpc,authority,publication,snapshot>>
\* run/storage/sqlite.ts:639-748. Fence exact old actor; snapshot records the public binding
\* at the moment the successor obtains authority, solely for comparison by the invariant.
Fence(k) == /\ ownerDead /\ authority[k]="original" /\ authority'=[authority EXCEPT ![k]="recovering"]
            /\ snapshot'=IF k \in publication THEN snapshot \cup {k} ELSE snapshot
            /\ UNCHANGED <<ownerDead,rpc,publication>>
\* run/storage/sqlite.ts:796-840. Second transaction closes the recovered Run and leaves bindings intact.
Close(k) == /\ authority[k]="recovering" /\ authority'=[authority EXCEPT ![k]="closed"]
            /\ UNCHANGED <<ownerDead,rpc,publication,snapshot>>
Step == Crash \/ \E k \in Keys: Stage(k) \/ Commit(k) \/ Fence(k) \/ Close(k)
Finished == \A k \in Keys: rpc[k]="done" /\ authority[k]="closed"
\* run/storage/sqlite.ts:833-839. Recovery result returned.
Done == Finished /\ UNCHANGED v
Next == Step \/ Done
Spec == Init /\ [][Next]_v /\ WF_v(Step)
FencedSetImmutable == \A k \in Keys: authority[k]#"original" => ((k \in publication) = (k \in snapshot))
RecoveryFinishes == <>Finished
========================================================================
