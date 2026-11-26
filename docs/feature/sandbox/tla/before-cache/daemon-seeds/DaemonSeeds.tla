---- MODULE DaemonSeeds ----
EXTENDS FiniteSets

CONSTANTS Seeds, Holders, Online
VARIABLES generation, admission, installed, references, pending
vars == <<generation, admission, installed, references, pending>>

Init ==
    /\ generation = "old"
    /\ admission = TRUE
    /\ installed = Seeds
    /\ references \in [Seeds -> SUBSET Holders]
    /\ pending = {}

Rotate ==
    /\ generation = "old"
    /\ generation' = "new"
    /\ admission' = Online
    /\ installed' = IF Online THEN {s \in installed : references[s] # {}} ELSE installed
    /\ pending' = IF Online THEN installed' ELSE {}
    /\ UNCHANGED references

Release(s, h) ==
    /\ h \in references[s]
    /\ references' = [references EXCEPT ![s] = @ \ {h}]
    /\ IF s \in pending /\ references'[s] = {}
          THEN /\ installed' = installed \ {s}
               /\ pending' = pending \ {s}
          ELSE UNCHANGED <<installed, pending>>
    /\ UNCHANGED <<generation, admission>>

Done ==
    /\ generation = "new"
    /\ \A s \in Seeds : references[s] = {}
    /\ UNCHANGED vars

Next == Rotate \/ (\E s \in Seeds, h \in Holders : Release(s, h)) \/ Done
Spec == Init /\ [][Next]_vars /\ WF_vars(Rotate)
        /\ (\A s \in Seeds, h \in Holders : WF_vars(Release(s, h)))

ReferencedSeedsRemain == \A s \in Seeds : references[s] # {} => s \in installed
RotatedAdmissionEventuallyOpens == (generation = "new") ~> admission
RotatedCapacityEventuallyFrees == (generation = "new") ~> (installed = {})
====
