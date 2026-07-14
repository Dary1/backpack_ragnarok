#!/usr/bin/env python3
"""REQ-0144 -- emit one deterministic sample verdict as JSON, for the cjs
storage contract test (proves the python tool output ingests cleanly into
server/storage_moderation.verdictToRow). Fixed stub score; no model needed."""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.dirname(HERE)
REPO = os.path.dirname(TOOLS)
sys.path.insert(0, TOOLS)
os.chdir(REPO)

import moderation_gate as MG  # noqa: E402
import moderation_fixtures as F  # noqa: E402

rec = MG.run_pipeline(F.png_bytes(F.ip_mark_a()), nsfw_scorer=lambda img: 0.01)
print(json.dumps(rec))
