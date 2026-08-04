# Hotspot Auto Publish Pipeline Design

**Goal:** Build a single command under `wechat/` that can fetch the daily hotspot HTML from the upstream workspace, publish it to the parent repository, wait for the public site to become available, and then create the WeChat draft automatically.

**Scope:** This flow covers archive generation, safe git publication to `origin/main`, public URL readiness wait, WeChat article generation, and WeChat draft creation. It does not attempt to automate UI-only WeChat fields such as collections, originality toggles, or creator-source UI metadata that the public API does not expose.

## User-Facing Behavior

The pipeline exposes one `wechat/`-local script with two modes:

- `--dry-run` (default): print each planned step, exact paths, target files, target URLs, and exit without changing disk, git state, or WeChat state.
- `--run`: execute the full flow end to end.

The script accepts `--date YYYY-MM-DD`, defaulting to the current local date if omitted.

## Flow

1. Validate inputs and compute all derived paths.
2. Run the upstream hotspot generation commands inside `/Users/linling/Documents/code/ai/openclaw-workspace`.
3. Move the generated `YYYY-MM-DD-hotspot.html` into the parent repo `archive/`.
4. Validate git safety in `/Users/linling/Documents/code/ai/IT-Hotspot`.
5. Commit and push only `archive/YYYY-MM-DD-hotspot.html` to `origin/main`.
6. Wait 5 seconds for `https://hotspot.octohirono.dev/archive/YYYY-MM-DD-hotspot.html`.
7. Run the existing WeChat generation script for the same date.
8. Run the existing WeChat draft-publish script for the same date.
9. Persist the draft result locally for idempotency and return a structured summary.
