---------------------------- MODULE Pool ----------------------------
EXTENDS Naturals, FiniteSets
CONSTANTS N, Cap
VARIABLES pc, target, box, interrupt, attemptResult, cancelled, swept
v == <<pc,target,box,interrupt,attemptResult,cancelled,swept>>
A == 1..N
PoolSize == Cardinality({k \in A: box[k] # "gone"})
Active == {a \in A: pc[a] \in {"using","cleanup","returning"}}
Init == /\ pc=[a \in A |-> "wait"] /\ target=[a \in A |-> 0]
        /\ box=[k \in A |-> "gone"] /\ interrupt=FALSE /\ swept=FALSE
        /\ attemptResult=[a \in A |-> "open"] /\ cancelled={}
\* runner/sandbox-pool.ts:230-257. Reserve capacity before async I/O. Use the creator as the model key.
BeginCreate(a) == /\ ~interrupt /\ pc[a]="wait" /\ PoolSize<Cap /\ box[a]="gone"
                  /\ ~(\E k \in A: box[k]="idle")
                  /\ pc'=[pc EXCEPT ![a]="creating"] /\ target'=[target EXCEPT ![a]=a]
                  /\ box'=[box EXCEPT ![a]="creating"]
                  /\ UNCHANGED <<interrupt,attemptResult,cancelled,swept>>
\* runner/sandbox-pool.ts:258-265,599-603. A successful create hands the new entry to its initiating Attempt.
Ready(a) == /\ ~interrupt /\ pc[a]="creating" /\ pc'=[pc EXCEPT ![a]="using"]
            /\ box'=[box EXCEPT ![a]="leased"] /\ UNCHANGED <<target,interrupt,attemptResult,cancelled,swept>>
\* runner/sandbox-pool.ts:258-272,529-554,570-594. Failed or cancelled creation closes the Scope.
CreateFailed(a) == /\ pc[a]="creating" /\ pc'=[pc EXCEPT ![a]="done"]
                   /\ box'=[box EXCEPT ![a]="gone"] /\ UNCHANGED <<target,interrupt,attemptResult,cancelled,swept>>
\* runner/sandbox-pool.ts:231-236. Selecting an idle entry starts Provider lifetime I/O before a loan.
Probe(a,k) == /\ ~interrupt /\ pc[a]="wait" /\ box[k]="idle"
              /\ pc'=[pc EXCEPT ![a]="probe"] /\ target'=[target EXCEPT ![a]=k]
              /\ UNCHANGED <<box,interrupt,attemptResult,cancelled,swept>>
\* runner/sandbox-pool.ts:237-245,599-603. Recheck the entry and pool after lifetime I/O.
Confirm(a) == /\ ~interrupt /\ pc[a]="probe"
              /\ IF box[target[a]]="idle"
                 THEN /\ pc'=[pc EXCEPT ![a]="using"] /\ box'=[box EXCEPT ![target[a]]="leased"]
                 ELSE /\ pc'=[pc EXCEPT ![a]="wait"] /\ UNCHANGED box
              /\ UNCHANGED <<target,interrupt,attemptResult,cancelled,swept>>
\* runner/sandbox-pool.ts:243-245,665-686. Insufficient lifetime retires the entry before another try.
Rotate(a) == /\ ~interrupt /\ pc[a]="probe" /\ box[target[a]]="idle"
             /\ pc'=[pc EXCEPT ![a]="wait"] /\ box'=[box EXCEPT ![target[a]]="gone"]
             /\ UNCHANGED <<target,interrupt,attemptResult,cancelled,swept>>
\* runner/run.ts:189-198,3671. Cooperative interruption can arrive after assertion sealing.
Sigint == /\ ~interrupt /\ ~swept /\ interrupt'=TRUE /\ UNCHANGED <<pc,target,box,attemptResult,cancelled,swept>>
\* runner/sandbox-pool.ts:195-199,230-231,694-711. Pending acquisition ends on interruption or closed admission.
CancelWaiter(a) == /\ interrupt /\ pc[a] \in {"wait","probe"} /\ pc'=[pc EXCEPT ![a]="done"]
                   /\ UNCHANGED <<target,box,interrupt,attemptResult,cancelled,swept>>
\* runner/attempt.ts:822-862,1606-1634. Cancellation can win before assertion sealing.
CancelBody(a) == /\ pc[a]="using" /\ pc'=[pc EXCEPT ![a]="cleanup"]
                 /\ cancelled'=cancelled \cup {a} /\ attemptResult'=[attemptResult EXCEPT ![a]="errored"]
                 /\ UNCHANGED <<target,box,interrupt,swept>>
\* runner/attempt.ts:540-549,2310-2319. Assertion sealing records the execution result.
Seal(a) == /\ ~interrupt /\ pc[a]="using" /\ pc'=[pc EXCEPT ![a]="cleanup"]
           /\ attemptResult'=[attemptResult EXCEPT ![a]="passed"] /\ UNCHANGED <<target,box,interrupt,cancelled,swept>>
\* runner/run.ts:3370-3386 and runner/sandbox-pool.ts:608-611. Attempt cleanup and request closure precede reset.
CloseFacade(a) == /\ pc[a]="cleanup" /\ pc'=[pc EXCEPT ![a]="returning"]
                  /\ UNCHANGED <<target,box,interrupt,attemptResult,cancelled,swept>>
\* runner/sandbox-pool.ts:616-640. Reset to idle or remove the entry on retirement.
\* Removal from the pool makes no claim about remote destruction if physical stop fails.
Return(a) == /\ pc[a]="returning" /\ pc'=[pc EXCEPT ![a]="done"]
             /\ \E result \in {"idle","gone"} : box'=[box EXCEPT ![target[a]]=result]
             /\ UNCHANGED <<target,interrupt,attemptResult,cancelled,swept>>
\* runner/run.ts:1638-1643 and runner/sandbox-pool.ts:280-317. Terminal stop joins outstanding leases.
Sweep == /\ ~swept /\ \A a \in A : pc[a]="done"
         /\ swept'=TRUE /\ box'=[k \in A |-> "gone"] /\ UNCHANGED <<pc,target,interrupt,attemptResult,cancelled>>
Step == Sigint \/ Sweep \/ \E a \in A : BeginCreate(a) \/ Ready(a) \/ CreateFailed(a)
        \/ (\E k \in A: Probe(a,k)) \/ Confirm(a) \/ Rotate(a) \/ CancelWaiter(a) \/ CancelBody(a)
        \/ Seal(a) \/ CloseFacade(a) \/ Return(a)
\* runner/sandbox-pool.ts:296-300. Terminal stop has completed.
Next == Step \/ (swept /\ UNCHANGED v)
Spec == Init /\ [][Next]_v /\ WF_v(Step)
ExclusiveLease == \A a,b \in Active: a#b => target[a]#target[b]
WithinCapacity == PoolSize<=Cap
NoPassAfterCancel == \A a \in cancelled: attemptResult[a]#"passed"
CompleteSweep == swept => (PoolSize=0 /\ Active={})
Progress == <>swept
====================================================================
