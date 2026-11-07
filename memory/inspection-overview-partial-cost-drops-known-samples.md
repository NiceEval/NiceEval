# Inspection Overview drops known costs when coverage is partial

## Problem

Inspection `overview.get` returns `unavailable` with a null value when an aggregate contains known observed or estimated cost samples plus one or more Attempts without cost data. Cell, Experiment, path-group, and totals therefore discard paid-cost evidence that remains valid.

## Root cause

`costForSlots` required one cost source to cover every selected subject before choosing it. That condition conflated incomplete coverage with absence: as soon as one eligible Attempt lacked both sources, the function selected no source and erased all known samples.

## Required behavior

Cost aggregation keeps observed and estimated facts separate, chooses the source with the greatest sample coverage, and prefers observed when coverage ties. Missing samples make the metric `partial`, while known `value`, `samples`, `total`, `bounds`, `source`, Attempt `refs`, and `issues` remain observable at member, cell, Experiment, path-group, and totals scopes.
