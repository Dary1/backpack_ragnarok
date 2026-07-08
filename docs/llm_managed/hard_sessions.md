## Lessons (hard-won; do not repeat)
- [row,col] — cite engine code for ANY convention; a guessed brief caused REQ-0029.
- Deleted-file references in this doc once nearly poisoned recovery — when a file is
  deleted/renamed, sweep this doc for mentions THE SAME DAY.
- Pixi v8: eventMode='none' on ALL decorative nodes (empty hitTest = truthy, halts
  sibling search); ONE Application per board FOREVER (destroy/recreate = GL teardown
  race, swiftshader shader-recompile freeze); render() synchronously after scene
  rebuild (rAF throttled in background tabs); EventSystem pointermove fires on
  document for every app → boundingRect-gate multi-board input; multi-root SVG needs
  synthetic-root wrap before DOMParser (silent partial parse otherwise).
- Playwright E2E on the server replaced Chrome-extension verification (extension is
  flaky); drags need explicit intermediate pointermoves.
- Build artifacts: new filenames (sprite v4→v10 chain); never overwrite; git since 0022.
- gen1 data loss = agent rollback without git. gen2 quarantine `_quarantine_contaminated_era/`
  must never be read.