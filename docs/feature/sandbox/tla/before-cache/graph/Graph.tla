---- MODULE Graph ----
EXTENDS Naturals, FiniteSets
CONSTANT N, Limit, Corrected
Nodes == 1..N
Parent(i) == IF i=1 THEN 0 ELSE IF i=N THEN 1 ELSE i-1
Children(i) == {j \in Nodes: Parent(j)=i}

Targets == {N-1,N}
VARIABLES phase, result, holds, offer, waiting
v == <<phase,result,holds,offer,waiting>>
Candidates(i) == IF Corrected THEN {k \in Children(i): phase[k]#"unclaimed" /\ result[k]="pending"} ELSE Children(i)
First(i) == IF Candidates(i)={} THEN 0 ELSE CHOOSE j \in Candidates(i): \A k \in Candidates(i): j<=k
Init == /\ phase = [i \in Nodes |-> IF i \in Targets THEN "lookup" ELSE "unclaimed"]
        /\ waiting=[i \in Nodes |-> 0] /\ result=[i \in Nodes |-> "pending"] /\ holds={} /\ offer={}
\* before-cache-preparation.ts:645-651,745-751; node ID is the one local single-flight owner.
Lookup(i) == /\ phase[i]="lookup" /\ \E r \in {"hit","miss","degraded","failed"}:
                /\ phase'=[phase EXCEPT ![i]=IF r \in {"hit","failed"} THEN "retired" ELSE IF r="miss" THEN "parent" ELSE "defer"]
                /\ result'=[result EXCEPT ![i]=IF r \in {"hit","failed"} THEN r ELSE @]
             /\ UNCHANGED <<holds,offer,waiting>>
\* before-cache-preparation.ts:761; lookup hits skip all ancestors.
Demand(i) == /\ phase[i] \in {"parent","defer"} /\ Parent(i)>0 /\ phase[Parent(i)]="unclaimed"
             /\ phase'=[phase EXCEPT ![Parent(i)]="lookup"] /\ UNCHANGED <<result,holds,offer,waiting>>
\* before-cache-preparation.ts:761-789. A degraded lookup still waits for its parent.
Ready(i) == /\ phase[i] \in {"parent","defer"}
            /\ IF Parent(i)=0 THEN TRUE ELSE result[Parent(i)]#"pending"
            /\ LET pr == IF Parent(i)=0 THEN "prepared" ELSE result[Parent(i)]
                   r == IF pr="failed" THEN "failed" ELSE IF pr="degraded" \/ phase[i]="defer" THEN "degraded" ELSE "pending"
               IN /\ result'=[result EXCEPT ![i]=r] /\ phase'=[phase EXCEPT ![i]=IF r="pending" THEN "gate" ELSE "retired"]
            /\ UNCHANGED <<holds,offer,waiting>>
\* before-cache-preparation.ts:784-790, borrowed staging bypasses both gates; one lane.
Start(i) == /\ phase[i]="gate" /\ (i \in offer \/ Cardinality(holds)<Limit)
            /\ holds'=IF i \in offer THEN holds ELSE holds \cup {i}
            /\ phase'=[phase EXCEPT ![i]="working"] /\ UNCHANGED <<result,waiting>> /\ offer'=offer \ {i}
\* before-cache-preparation.ts:310-327,333-384,803-814,828-829. Internal non-pub node may only degrade at materialization.
Settle(i) == /\ phase[i]="working" /\ \E r \in {"prepared","failed","degraded"}:
              /\ LET borrow == r="prepared" /\ First(i)#0 IN
                 /\ phase'=[phase EXCEPT ![i]=IF borrow THEN "waitChild" ELSE "retired"]
                 /\ waiting'=[waiting EXCEPT ![i]=IF borrow THEN First(i) ELSE 0]
                 /\ offer'=IF borrow THEN offer \cup {First(i)} ELSE offer
                 /\ holds'=IF borrow THEN holds ELSE holds \ {i}
              /\ result'=[result EXCEPT ![i]=r]
\* before-cache-preparation.ts:814,829; only the actual child's work completes its retirement.
Release(i) == /\ phase[i]="waitChild" /\ phase[waiting[i]]="retired"
              /\ phase'=[phase EXCEPT ![i]="retired"] /\ holds'=holds \ {i} /\ UNCHANGED <<result,offer,waiting>>
\* before-cache-preparation.ts:894-906; focus on user-visible completion, not shutdown after all targets resolve.
Done == \A i \in Targets: result[i]#"pending"
End == Done /\ UNCHANGED v  \* before-cache-preparation.ts:894-906; terminal dispatch observation.
Move == \E i \in Nodes: Lookup(i) \/ Demand(i) \/ Ready(i) \/ Start(i) \/ Settle(i) \/ Release(i)
Next == Move \/ End
Spec == Init /\ [][Next]_v /\ WF_v(Move)
DispatchTerminates == <>Done
GateBound == Cardinality(holds)<=Limit
====
