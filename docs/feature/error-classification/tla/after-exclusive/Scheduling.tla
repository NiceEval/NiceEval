--------------------------- MODULE Scheduling ---------------------------
EXTENDS Naturals, FiniteSets
CONSTANTS N, G, E, Experiments, Exclusive, RetainExp
VARIABLES phase, retryUsed
vars == <<phase, retryUsed>>
A == 1..N
Exp(a) == (a-1) % Experiments
In(s) == {a \in A : phase[a] \in s}
Active == In({"sending","sleeping","resumeExp","resumeGlobal"})
Global == In({"firstGlobal","sending"})
Local == In({"local","firstGlobal","waitLane","lane","sending","resumeGlobal"})
         \cup IF RetainExp THEN In({"sleeping"}) ELSE {}
Lane == IF Exclusive THEN In({"lane","sending","sleeping","resumeExp","resumeGlobal"}) ELSE {}
NumIn(set,a) == Cardinality({b \in set : Exp(b)=Exp(a)})
Set(a,s) == phase' = [phase EXCEPT ![a] = s]
Move(a,s) == Set(a,s) /\ UNCHANGED retryUsed
Init == phase = [a \in A |-> "queued"] /\ retryUsed = {}
\* runner/run.ts:2778-2810,3477. Before- and Claim-ready distinct Eval keys.
TakeExperiment(a) == /\ phase[a]="queued" /\ NumIn(Local,a)<E /\ Move(a,"local")
\* runner/run.ts:2732-2772,3393-3399. The first-slot wave arrival follows take.
TakeGlobal(a) == /\ phase[a]="local" /\ Cardinality(Global)<G /\ Move(a,"firstGlobal")
\* runner/run.ts:3441-3448. Exclusive wait returns just the global gate.
Dispatch(a) == /\ phase[a]="firstGlobal" /\ Move(a,IF Exclusive THEN "waitLane" ELSE "sending")
\* runner/run.ts:3448. Provider is acquired before global reacquisition.
AcquireLane(a) == /\ phase[a]="waitLane" /\ Lane={} /\ Move(a,"lane")
\* runner/run.ts:3448. Physical body starts here.
StartExclusive(a) == /\ phase[a]="lane" /\ Cardinality(Global)<G /\ Move(a,"sending")
\* context/send-retry.ts:119-135; runner/run.ts:2938-2941,3201. One rejected retry (bounded).
Rejected(a) == /\ phase[a]="sending" /\ a \notin retryUsed
               /\ Set(a,"sleeping") /\ retryUsed'=retryUsed \cup {a}
\* context/send-retry.ts:66-87. Timer eventually fires and cleanup reacquires.
Timer(a) == /\ phase[a]="sleeping" /\ Move(a,IF RetainExp THEN "resumeGlobal" ELSE "resumeExp")
\* pre-fix runner/run.ts:2940. Local acquired before global on return.
ResumeLocal(a) == /\ phase[a]="resumeExp" /\ NumIn(Local,a)<E /\ Move(a,"resumeGlobal")
\* context/send-retry.ts:86,134-135; runner/run.ts:2747-2755.
ResumeGlobal(a) == /\ phase[a]="resumeGlobal" /\ Cardinality(Global)<G /\ Move(a,"sending")
\* runner/run.ts:2771,2809,3448; all scopes unwind. No pending external call in this slice.
Finish(a) == /\ phase[a]="sending" /\ Move(a,"done")
Step == \E a \in A : TakeExperiment(a) \/ TakeGlobal(a) \/ Dispatch(a) \/ AcquireLane(a)
                      \/ StartExclusive(a) \/ Rejected(a) \/ Timer(a) \/ ResumeLocal(a)
                      \/ ResumeGlobal(a) \/ Finish(a)
Done == In({"done"})=A
\* runner/run.ts:3797, terminal stutter for deadlock check.
Next == Step \/ (Done /\ UNCHANGED vars)
Spec == Init /\ [][Next]_vars /\ WF_vars(Step)
GlobalBound == Cardinality(Global)<=G
ExperimentBound == \A a \in A : NumIn(Active,a)<=E
LaneBound == Cardinality(Lane)<=1
Progress == <>Done
========================================================================
