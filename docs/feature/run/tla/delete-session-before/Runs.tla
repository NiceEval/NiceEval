---- MODULE Runs ----
EXTENDS Naturals, FiniteSets
CONSTANTS N, R, K, Fault
Procs == 1..N
Runs == 1..R
Keys == 1..K
Terminal == {"completed","interrupted","failed"}
VARIABLES live, phase, actor, task, sealed, pub, frozen, absent, deleted, session, reads, retried, failed
v == <<live,phase,actor,task,sealed,pub,frozen,absent,deleted,session,reads,retried,failed>>
\* record/sqlite/coordination-repository.ts:130-197. Begin just after atomic admission.
Init == /\ live=Procs /\ phase=[r \in Runs |-> "active"] /\ actor=[r \in Runs |-> 1]
        /\ task={} /\ sealed={} /\ pub=[r \in Runs |-> {}] /\ frozen=pub /\ absent=pub
        /\ deleted={} /\ session="active" /\ reads={} /\ retried={} /\ failed=FALSE
\* run/storage/sqlite.ts:324-338: read/verify closure outside final publication transaction.
Prepare(r,k) == /\ 1 \in live /\ phase[r]="active" /\ k \notin pub[r] /\ r \notin sealed
                /\ <<r,k>> \notin reads
                /\ reads'=reads \cup {<<r,k>>} /\ UNCHANGED <<live,phase,actor,task,sealed,pub,frozen,absent,deleted,session,retried,failed>>
\* run/storage/sqlite.ts:339-415: transaction revalidates generation, state and binding.
Publish(r,k) == /\ 1 \in live /\ <<r,k>> \in reads /\ phase[r]="active" /\ actor[r]=1 /\ r \notin sealed
                /\ k \notin pub[r] /\ pub'=[pub EXCEPT ![r]=@ \cup {k}]
                /\ UNCHANGED <<live,phase,actor,task,sealed,frozen,absent,deleted,session,reads,retried,failed>>
\* run/storage/sqlite.ts:199-216,339-353; late/retried request after commit/fence is rejected.
Replay(r,k) == /\ <<r,k>> \in reads /\ (k \in pub[r] \/ phase[r]#"active" \/ actor[r]#1)
               /\ retried'=retried \cup {r}
               /\ UNCHANGED <<live,phase,actor,task,sealed,pub,frozen,absent,deleted,session,reads,failed>>
\* runner/record.ts:1049-1066. Fully executed or zero-slot normal path; unstarted slots can also close on interruption.
Seal(r) == /\ 1 \in live /\ phase[r]="active" /\ r \notin sealed /\ pub[r]=Keys
           /\ sealed'=sealed \cup {r} /\ UNCHANGED <<live,phase,actor,task,pub,frozen,absent,deleted,session,reads,retried,failed>>
\* run/storage/sqlite.ts:541-578. Terminal state, absence and close revision commit together.
Close(r) == /\ 1 \in live /\ phase[r]="active" /\ r \in sealed
            /\ phase'=[phase EXCEPT ![r]="completed"] /\ frozen'=[frozen EXCEPT ![r]=pub[r]]
            /\ UNCHANGED <<live,actor,task,sealed,pub,absent,deleted,session,reads,retried,failed>>
\* record/sqlite/coordination-repository.ts:346-367; ordinary Session close follows its Runs.
CloseSession == /\ 1 \in live /\ session="active" /\ \A r \in Runs: phase[r] \in Terminal
                /\ session'="completed" /\ UNCHANGED <<live,phase,actor,task,sealed,pub,frozen,absent,deleted,reads,retried,failed>>
\* External crash between transactions; last helper survives (needed for conditional eventual recovery).
Crash(p) == /\ p \in live /\ p#N /\ live'=live\{p}
            /\ task'={r \in task: actor[r]#p}
            /\ UNCHANGED <<phase,actor,sealed,pub,frozen,absent,deleted,session,reads,retried,failed>>
\* run/host/lifecycle-adapter.ts:287-331; run/storage/sqlite.ts:639-748.
\* Host observation summarized by selecting an expected generation; same fact rechecked under BEGIN IMMEDIATE.
Fence(r,p) == /\ phase[r] \in {"active","recovering"} /\ actor[r] \notin live /\ p \in live /\ p#1
              /\ Fault#"opaque" /\ phase'=[phase EXCEPT ![r]="recovering"]
              /\ actor'=[actor EXCEPT ![r]=p] /\ task'=task \cup {r}
              /\ UNCHANGED <<live,sealed,pub,frozen,absent,deleted,session,reads,retried,failed>>
\* run/storage/sqlite.ts:790-795; only aggregate present and closure valid in this model.
RepairSeal(r) == /\ r \in task /\ actor[r] \in live /\ r \notin sealed
                 /\ sealed'=sealed \cup {r} /\ UNCHANGED <<live,phase,actor,task,pub,frozen,absent,deleted,session,reads,retried,failed>>
Last(r) == \A s \in Runs\{r}: phase[s] \in Terminal
SessionProof == 1 \notin live /\ Fault#"pid-reuse"
\* run/storage/sqlite.ts:796-840; coordination-repository.ts:382-445 nested in this txn.
Finish(r) == /\ r \in task /\ r \in sealed /\ actor[r] \in live /\ phase[r]="recovering"
             /\ (~Last(r) \/ SessionProof \/ session#"active")
             /\ phase'=[phase EXCEPT ![r]="interrupted"] /\ task'=task\{r}
             /\ absent'=[absent EXCEPT ![r]=Keys\pub[r]] /\ frozen'=[frozen EXCEPT ![r]=pub[r]]
             /\ session'=IF Last(r) /\ session="active" THEN "interrupted" ELSE session
             /\ UNCHANGED <<live,actor,sealed,pub,deleted,reads,retried,failed>>
\* record/sqlite/transaction.ts:10-32; run/storage/sqlite.ts:796; run/host/lifecycle-adapter.ts:332-339.
\* Worker command fails before its finish commit, caller stays alive, no continuation remains.
FailFinish(r) == /\ Fault \in {"finish-timeout","resume"} /\ r \in task /\ r \in sealed /\ ~failed
                 /\ task'=task\{r} /\ failed'=TRUE
                 /\ UNCHANGED <<live,phase,actor,sealed,pub,frozen,absent,deleted,session,reads,retried>>
\* run/host/lifecycle-adapter.ts:287-336 and run/storage/sqlite.ts:649-668
\* An idle, live Host that owns the exact committed actor can continue.
\* Each task represents one outstanding command, including its finish reply.
Resume(r,p) == /\ Fault="resume" /\ phase[r]="recovering" /\ r \notin task
               /\ p \in live /\ p=actor[r] /\ task'=task \cup {r}
               /\ UNCHANGED <<live,phase,actor,sealed,pub,frozen,absent,deleted,session,reads,retried,failed>>
\* run/storage/sqlite.ts:686-714,796-840. Terminal repair of sealed aggregate + abandoned Session;
\* first transaction does not change Run state or generation. Its no-op prefix elided.
RepairSession(r) == /\ r \notin deleted /\ phase[r] \in Terminal /\ Last(r) /\ session="active" /\ SessionProof
                    /\ session'="interrupted"
                    /\ UNCHANGED <<live,phase,actor,task,sealed,pub,frozen,absent,deleted,reads,retried,failed>>
\* run/host/lifecycle-adapter.ts:184-226; run/storage/sqlite.ts:863-948: no incoming references in this workload.
Delete(r) == /\ phase[r] \in Terminal /\ r \notin deleted /\ deleted'=deleted \cup {r}
             /\ UNCHANGED <<live,phase,actor,task,sealed,pub,frozen,absent,session,reads,retried,failed>>
\* An idle host performs reads/refused retries (run/host/lifecycle-adapter.ts:250-311).
Idle == /\ (\A r \in Runs: phase[r] \in Terminal \/ (actor[r] \notin live /\ Fault="opaque") \/
               (phase[r]="recovering" /\ ((r \notin task /\ failed) \/ (Last(r) /\ Fault="pid-reuse"))))
        /\ UNCHANGED v
Service(r) == (\E k \in Keys: Prepare(r,k) \/ Publish(r,k)) \/ Seal(r) \/ Close(r)
              \/ (\E p \in Procs: Fence(r,p) \/ Resume(r,p)) \/ RepairSeal(r) \/ Finish(r)
Next == (\E r \in Runs: Service(r) \/ FailFinish(r) \/ RepairSession(r) \/ Delete(r) \/ (\E k \in Keys: Replay(r,k)))
        \/ CloseSession \/ (\E p \in Procs: Crash(p)) \/ Idle
Spec == Init /\ [][Next]_v /\ (\A r \in Runs: WF_v(Service(r)) /\ WF_v(RepairSession(r))) /\ WF_v(CloseSession)
DurableCoverage == \A r \in Runs: phase[r]\in Terminal => (pub[r]=frozen[r] /\ pub[r]\cup absent[r]=Keys /\ pub[r]\cap absent[r]={})
SessionLast == session#"active" => (\A r \in Runs: phase[r]\in Terminal)
RecoveryEntryPreserved == session="active" => Runs \ deleted # {}
DeleteTerminal == \A r \in deleted: phase[r]\in Terminal
NoLiveTakeover == \A r \in Runs: actor[r]#1 => 1 \notin live
TerminalStable == [][\A r \in Runs: phase[r]\in Terminal => phase'[r]=phase[r]]_v
AllRunsClose == <>(\A r \in Runs: phase[r]\in Terminal)
AllSessionsClose == <>(session#"active")
====
