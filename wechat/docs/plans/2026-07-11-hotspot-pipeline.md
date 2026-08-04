# Hotspot Auto Publish Pipeline Implementation Plan

**Goal:** Build a `wechat/`-local automation command that can fetch the daily hotspot, safely publish it to `origin/main`, wait for the public archive URL, and create the WeChat draft automatically.

**Architecture:** Add one Node orchestrator in `wechat/scripts/` that owns sequencing and safety checks, while reusing the existing `wechat/` scripts for WeChat generation and draft publishing. Persist the successful WeChat draft result locally so repeated runs can skip duplicate draft creation and remain idempotent.

**Tech Stack:** Node.js ESM, built-in `node:test`, `child_process.spawnSync`, existing git CLI, existing `wechat` scripts
