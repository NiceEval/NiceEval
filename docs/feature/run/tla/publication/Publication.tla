-------------------------- MODULE Publication --------------------------
EXTENDS Naturals, FiniteSets
CONSTANT R
VARIABLES phase, created, pc, expected, pub, aggregateClosed, runClosed, cancelled, interrupted, failed, receipt
v == <<phase,created,pc,expected,pub,aggregateClosed,runClosed,cancelled,interrupted,failed,receipt>>
Runs == 1..R
Init == /\ phase="create" /\ created={} /\ pc=[r \in Runs |-> "queued"]
        /\ expected=[r \in Runs |-> "none"] /\ pub=[r \in Runs |-> "none"]
        /\ aggregateClosed={} /\ runClosed={} /\ cancelled={} /\ interrupted=FALSE
        /\ failed={} /\ receipt=[ids |-> {}, completion |-> "none", bindings |-> pub]
\* runner/record.ts:463-495 -> record/sqlite/coordination-repository.ts:130-197.
\* Public Host creates session, all Run resources and expected slots in one SQLite transaction.
Create == /\ phase="create" /\ created'=Runs /\ phase'="opening"
          /\ UNCHANGED <<pc,expected,pub,aggregateClosed,runClosed,cancelled,interrupted,failed,receipt>>
\* runner/record.ts:497-512. Mutable writers are opened one by one after the durable session
\* transaction. Intervening crashes project to the same public state, all Runs present and active.
OpenWriters == /\ phase="opening" /\ phase'="dispatch"
               /\ UNCHANGED <<created,pc,expected,pub,aggregateClosed,runClosed,cancelled,interrupted,failed,receipt>>
\* runner/run.ts:3133-3149,3204. Slot reservation distinct from a published Attempt.
Reserve(r) == /\ phase="dispatch" /\ ~interrupted /\ pc[r]="queued" /\ pc'=[pc EXCEPT ![r]="open"]
              /\ UNCHANGED <<phase,created,expected,pub,aggregateClosed,runClosed,cancelled,interrupted,failed,receipt>>
\* runner/run.ts:3665-3673,3809-3818. Effective dispatch interruption; race after dispatch has ended cannot unseal an Attempt.
Signal == /\ phase="dispatch" /\ ~interrupted /\ interrupted'=TRUE
          /\ UNCHANGED <<phase,created,pc,expected,pub,aggregateClosed,runClosed,cancelled,failed,receipt>>
\* runner/attempt.ts:2068-2080,2310-2355; runner/run.ts:3400-3440. Decide outcome before committing Record data.
Seal(r) == /\ phase="dispatch" /\ pc[r]="open"
           /\ \E e \in (IF interrupted THEN {"errored"} ELSE {"passed","errored"}) :
                 /\ expected'=[expected EXCEPT ![r]=e] /\ pc'=[pc EXCEPT ![r]="sealed"]
                 /\ cancelled'=IF interrupted THEN cancelled \cup {r} ELSE cancelled
           /\ UNCHANGED <<phase,created,pub,aggregateClosed,runClosed,interrupted,failed,receipt>>
\* runner/record.ts:1033-1046,1055-1064. An interrupted slot can close absent before publication.
Absent(r) == /\ phase="dispatch" /\ interrupted /\ pc[r] \in {"queued","open","sealed"}
             /\ pc'=[pc EXCEPT ![r]="settled"] /\ cancelled'=IF pc[r]="open" THEN cancelled \cup {r} ELSE cancelled
             /\ UNCHANGED <<phase,created,expected,pub,aggregateClosed,runClosed,interrupted,failed,receipt>>
\* runner/record.ts:876-892. The mutable Attempt writer closes before origin publication.
CompleteWriter(r) == /\ phase="dispatch" /\ pc[r]="sealed" /\ pc'=[pc EXCEPT ![r]="writerComplete"]
                     /\ UNCHANGED <<phase,created,expected,pub,aggregateClosed,runClosed,cancelled,interrupted,failed,receipt>>
\* runner/record.ts:893-907; run/storage/sqlite.ts:339-415. Binding+origin publication in one transaction.
PublishOrigin(r) == /\ phase="dispatch" /\ pc[r]="writerComplete" /\ pc'=[pc EXCEPT ![r]="settled"]
                    /\ pub'=[pub EXCEPT ![r]=expected[r]]
                    /\ UNCHANGED <<phase,created,expected,aggregateClosed,runClosed,cancelled,interrupted,failed,receipt>>
\* runner/record.ts:965-981,995-1018. Per-Run write failure recorded for final publish.
WriterFailure(r) == /\ phase="dispatch" /\ pc[r] \in {"sealed","writerComplete"}
                    /\ pc'=[pc EXCEPT ![r]="settled"] /\ failed'=failed \cup {r}
                    /\ UNCHANGED <<phase,created,expected,pub,aggregateClosed,runClosed,cancelled,interrupted,receipt>>
\* runner/run.ts:3665-3674,3809-3852. Join dispatch/cleanup before publishing per-Run terminal state.
Join == /\ phase="dispatch" /\ \A r \in Runs: pc[r]="settled"
        /\ phase'=IF failed#{} /\ ~interrupted THEN "error" ELSE "close"
        /\ UNCHANGED <<created,pc,expected,pub,aggregateClosed,runClosed,cancelled,interrupted,failed,receipt>>
\* runner/record.ts:1049-1066,1083-1094. Model one planned member per Run. The legacy aggregate seal
\* and Run close have distinct persistence boundaries; writer failures are handled independently on interrupt.
SealAggregate(r) == /\ phase="close" /\ r \notin failed \cup aggregateClosed
                    /\ \A prior \in 1..(r-1): prior \in runClosed \cup failed
                    /\ aggregateClosed'=aggregateClosed \cup {r}
                    /\ UNCHANGED <<phase,created,pc,expected,pub,runClosed,cancelled,interrupted,failed,receipt>>
\* runner/record.ts:1072-1079; run/storage/sqlite.ts:541-578. Close exact active writer's Run.
CloseRun(r) == /\ phase="close" /\ r \in aggregateClosed \ (failed \cup runClosed)
               /\ runClosed'=runClosed \cup {r}
               /\ UNCHANGED <<phase,created,pc,expected,pub,aggregateClosed,cancelled,interrupted,failed,receipt>>
\* runner/record.ts:1083-1104. Typed close failure interrupts normal receipt or skips failed interrupted sibling.
CloseFailure(r) == /\ phase="close" /\ r \in aggregateClosed \ (failed \cup runClosed)
                   /\ failed'=failed \cup {r} /\ phase'=IF interrupted THEN "close" ELSE "error"
                   /\ UNCHANGED <<created,pc,expected,pub,aggregateClosed,runClosed,cancelled,interrupted,receipt>>
\* runner/run.ts:3839-3862. Cutoff snapshot of own origin publication only; DB read is later than last close.
ReadCutoff == /\ phase="close" /\ runClosed \cup failed=Runs /\ phase'="returned"
              /\ receipt'=[ids |-> Runs, completion |-> IF interrupted THEN "interrupted" ELSE "completed", bindings |-> pub]
              /\ UNCHANGED <<created,pc,expected,pub,aggregateClosed,runClosed,cancelled,interrupted,failed>>
\* External fail-stop between any two transactions. docs/feature/experiments/README.md:44-59.
Crash == /\ phase \notin {"returned","error","dead"} /\ phase'="dead"
         /\ UNCHANGED <<created,pc,expected,pub,aggregateClosed,runClosed,cancelled,interrupted,failed,receipt>>
Step == Create \/ OpenWriters \/ Signal \/ Join \/ ReadCutoff \/ Crash \/ \E r \in Runs:
        Reserve(r) \/ Seal(r) \/ Absent(r) \/ CompleteWriter(r) \/ PublishOrigin(r)
        \/ WriterFailure(r) \/ SealAggregate(r) \/ CloseRun(r) \/ CloseFailure(r)
Terminal == phase \in {"returned","error","dead"}
\* runner/run.ts:3921-3924. Terminal receipt/failure/loss.
Next == Step \/ (Terminal /\ UNCHANGED v)
Spec == Init /\ [][Next]_v /\ WF_v(Step)
NoPartialRunCreate == created \in {{},Runs}
NoCancelledSuccess == \A r \in cancelled: pub[r]#"passed"
NoInventedResult == \A r \in Runs: pub[r]#"none" => (r \in created /\ pub[r]=expected[r])
ReceiptMatches == phase="returned" =>
                 (receipt.ids=created /\ receipt.bindings=pub /\
                 (IF interrupted THEN receipt.completion="interrupted" ELSE receipt.completion="completed" /\ runClosed=Runs))
NoEarlyReceipt == phase#"returned" => receipt.completion="none"
Progress == <>Terminal
========================================================================
