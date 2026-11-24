---- MODULE Warning ----
EXTENDS Naturals
CONSTANT Mode, Corrected
VARIABLES pc, inputs, output
v == <<pc,inputs,output>>
\* Two pairings of one Invocation, same owner, Base reference, domain, action IDs and platform.
\* Docker's case identity also includes resource limits. For resolved E2B the exact build can change
\* between two reads of the same movable template tag. before-cache-plan.ts:114-148; layer.ts:2692-2701.
Init == /\ pc="plan" /\ inputs \in [1..2 -> [cap:1..2,decl:1..2,base:1..2]]
        /\ (Mode="docker" => inputs[1].base=inputs[2].base) /\ output=FALSE
\* before-cache-collisions.ts:49-63,71-83; run.ts:532-539; before-cache-preparation.ts:471,530.
Check == /\ pc="plan" /\ pc'="done" /\ output'=(IF Corrected THEN (IF Mode="remote" THEN <<inputs[1].base,inputs[1].decl>> # <<inputs[2].base,inputs[2].decl>> ELSE inputs[1].decl#inputs[2].decl) ELSE inputs[1].decl#inputs[2].decl /\ (Mode="remote" \/ inputs[1].cap=inputs[2].cap))
         /\ UNCHANGED inputs
End == pc="done" /\ UNCHANGED v  \* run.ts:538-549; diagnostic emission is terminal for this projection.
Next == Check \/ End
Complete == pc="done" => (output=(<<inputs[1].base,inputs[1].decl>> # <<inputs[2].base,inputs[2].decl>>))
====
