# REQ-0360 -- Close the powerLevel dirty-detection gaps in the content deploy path

- State: draft -- spec ready; blocked on owner ratification / priority.
- Origin: content_deploy_runbook.md "Known gaps" paragraph, folded here
  2026-08-02 (the runbook now points at this REQ; plans live on the board,
  not in runbooks).

## Gaps
1. `content/scaling_profile.json` edits and sim-code changes are
   level-affecting but NOT detected by
   `tools/predeploy_recalibrate_powerlevel.cjs --check` (outside its sha
   dirty-set): a deploy can silently skip recalibration.
2. Additive SOURCE batches (batch-005/006/007 `packs.json`) carry no
   powerLevel; a wholesale re-promotion drifts unless
   `node tools/autobalance_pack_powerlevel.cjs --emit` is run manually first
   (today flagged only inside --emit output -- a remembered manual step).

## Proposed
a. Extend the --check dirty-set to `content/scaling_profile.json` and the sim
   code that computes outcomes (`sim/lib/**` at minimum).
b. Make the runbook chokepoint FAIL CLOSED when a powerLevel-less source
   batch is about to be re-promoted (or auto-run the sync) -- promote the
   remembered manual step into the mechanism, per the guardrail doctrine
   (mechanism > prose).

## Acceptance
Runbook step 2 alone is sufficient for every content deploy; no manual --emit
needs remembering; the ci.sh drift check stays advisory.
