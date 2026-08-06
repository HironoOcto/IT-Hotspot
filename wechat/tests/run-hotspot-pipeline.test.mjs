import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  buildPipelineContext,
  classifyGitStatusEntries,
  createPipelineLogger,
  decideGitPublication,
  detectArchiveAction,
  detectScanPlaceholders,
  evaluateRunReport,
  isSupportedPushBranch,
  loadRunReport,
  parsePipelineArgs,
  parseRunReportMarkdown,
  readPublishResult,
  resolveUpstreamRoot,
  shouldSkipWechatPublish,
  verifyScanData,
  verifyScanMarkdown,
  verifyScanReport,
} from "../scripts/run-hotspot-pipeline.mjs";

const repoRoot = "/Users/linling/Documents/code/ai/IT-Hotspot";
const wechatRoot = `${repoRoot}/wechat`;

test("parsePipelineArgs defaults to dry-run mode", () => {
  const args = parsePipelineArgs([]);

  assert.equal(args.run, false);
  assert.equal(args.skipDraft, false);
  assert.equal(args.skipVerify, false);
  assert.equal(args.date, "");
});

test("parsePipelineArgs accepts --skip-verify", () => {
  const args = parsePipelineArgs(["--run", "--skip-verify", "--date", "2026-07-31"]);

  assert.equal(args.run, true);
  assert.equal(args.skipVerify, true);
  assert.equal(args.date, "2026-07-31");
});

test("parsePipelineArgs accepts --skip-pull and --upstream-root", () => {
  const defaults = parsePipelineArgs([]);
  assert.equal(defaults.skipPull, false);
  assert.equal(defaults.upstreamRoot, "");

  const args = parsePipelineArgs([
    "--run",
    "--skip-pull",
    "--upstream-root",
    "/Users/luckyclaw/.openclaw",
  ]);
  assert.equal(args.run, true);
  assert.equal(args.skipPull, true);
  assert.equal(args.upstreamRoot, "/Users/luckyclaw/.openclaw");
});

test("resolveUpstreamRoot honours explicit > env > sibling > default", () => {
  // Explicit wins over everything.
  assert.equal(
    resolveUpstreamRoot({
      explicit: "/Users/luckyclaw/.openclaw",
      repoRoot: "/tmp/whatever",
      env: { UPSTREAM_ROOT: "/env/path" },
    }),
    "/Users/luckyclaw/.openclaw"
  );

  // Env var is next when there is no explicit path.
  assert.equal(
    resolveUpstreamRoot({
      explicit: "",
      repoRoot: "/tmp/whatever",
      env: { UPSTREAM_ROOT: "/env/openclaw-workspace" },
    }),
    "/env/openclaw-workspace"
  );

  // With neither explicit nor env, and no sibling on disk, it falls back to the
  // hard-coded default (keeps the current dev machine working).
  assert.equal(
    resolveUpstreamRoot({
      explicit: "",
      repoRoot: "/nonexistent-root-xyz",
      env: {},
    }),
    "/Users/linling/Documents/code/ai/openclaw-workspace"
  );
});

test("resolveUpstreamRoot auto-detects a sibling openclaw-workspace checkout", async () => {
  const parent = mkdtempSync(path.join(tmpdir(), "hotspot-sibling-"));
  const repoRoot = path.join(parent, "IT-Hotspot");
  const sibling = path.join(parent, "openclaw-workspace");
  mkdirSync(repoRoot, { recursive: true });
  mkdirSync(sibling, { recursive: true });

  try {
    assert.equal(
      resolveUpstreamRoot({ explicit: "", repoRoot, env: {} }),
      sibling
    );
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("parsePipelineArgs accepts explicit run mode and date", () => {
  const args = parsePipelineArgs(["--run", "--date", "2026-07-11"]);

  assert.equal(args.run, true);
  assert.equal(args.date, "2026-07-11");
});

test("parsePipelineArgs supports running every step except draft creation", () => {
  const args = parsePipelineArgs(["--run", "--skip-draft", "--date", "2026-07-11"]);

  assert.equal(args.run, true);
  assert.equal(args.skipDraft, true);
  assert.equal(args.date, "2026-07-11");
});

test("parsePipelineArgs defaults force to false and accepts --force", () => {
  assert.equal(parsePipelineArgs([]).force, false);

  const args = parsePipelineArgs(["--run", "--force", "--date", "2026-07-31"]);
  assert.equal(args.run, true);
  assert.equal(args.force, true);
  assert.equal(args.date, "2026-07-31");
});

test("buildPipelineContext derives archive file name and public url", () => {
  const context = buildPipelineContext({
    cwd: wechatRoot,
    date: "2026-07-11",
    upstreamRoot: "/Users/linling/Documents/code/ai/openclaw-workspace",
  });

  assert.equal(context.date, "2026-07-11");
  assert.equal(context.root, repoRoot);
  assert.equal(context.wechatRoot, wechatRoot);
  assert.equal(context.archiveFileName, "2026-07-11-hotspot.html");
  assert.equal(
    context.archiveFilePath,
    `${repoRoot}/archive/2026-07-11-hotspot.html`
  );
  assert.equal(
    context.publicArchiveUrl,
    "https://hotspot.octohirono.dev/archive/2026-07-11-hotspot.html"
  );
  assert.equal(
    context.wechatPublishResultPath,
    `${wechatRoot}/articles/2026-07-11/publish-result.json`
  );
  assert.equal(
    context.upstreamToolDir,
    "/Users/linling/Documents/code/ai/openclaw-workspace/shared-skills/hotspot_scanning/tools"
  );
  assert.equal(
    context.upstreamGeneratedPath,
    "/Users/linling/Documents/code/ai/openclaw-workspace/shared-skills/hotspot_scanning/tools/2026-07-11-hotspot.html"
  );
});

test("classifyGitStatusEntries rejects unrelated dirty files", () => {
  const result = classifyGitStatusEntries({
    targetPath: "archive/2026-07-11-hotspot.html",
    statusLines: [
      " M archive/2026-07-11-hotspot.html",
      " M scripts/generate-site.mjs",
      "?? notes/todo.md",
    ],
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.blockingPaths, [
    "scripts/generate-site.mjs",
    "notes/todo.md",
  ]);
});

test("classifyGitStatusEntries allows a clean worktree or target-only changes", () => {
  assert.deepEqual(
    classifyGitStatusEntries({
      targetPath: "archive/2026-07-11-hotspot.html",
      statusLines: [],
    }),
    { ok: true, blockingPaths: [] }
  );

  assert.deepEqual(
    classifyGitStatusEntries({
      targetPath: "archive/2026-07-11-hotspot.html",
      statusLines: ["?? archive/2026-07-11-hotspot.html"],
    }),
    { ok: true, blockingPaths: [] }
  );
});

test("detectArchiveAction preserves an existing archive when resuming a failed run", async () => {
  const workspace = mkdtempSync(path.join(tmpdir(), "hotspot-pipeline-"));
  const generatedPath = path.join(workspace, "generated.html");
  const archiveDir = path.join(workspace, "archive");
  const targetPath = path.join(archiveDir, "2026-07-11-hotspot.html");
  mkdirSync(archiveDir, { recursive: true });

  try {
    writeFileSync(generatedPath, "<html>same</html>\n");
    writeFileSync(targetPath, "<html>same</html>\n");
    assert.deepEqual(detectArchiveAction({ generatedPath, targetPath }), {
      kind: "reuse",
      reason: "target already matches generated hotspot",
    });

    writeFileSync(targetPath, "<html>different</html>\n");
    assert.deepEqual(detectArchiveAction({ generatedPath, targetPath }), {
      kind: "reuse",
      reason: "target archive file already exists; preserving it for resume",
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("detectArchiveAction overwrites an existing archive when force is set", async () => {
  const workspace = mkdtempSync(path.join(tmpdir(), "hotspot-pipeline-force-"));
  const generatedPath = path.join(workspace, "generated.html");
  const archiveDir = path.join(workspace, "archive");
  const targetPath = path.join(archiveDir, "2026-07-31-hotspot.html");
  mkdirSync(archiveDir, { recursive: true });

  try {
    writeFileSync(generatedPath, "<html>new</html>\n");
    writeFileSync(targetPath, "<html>old</html>\n");

    // Without force the existing archive is preserved.
    assert.equal(
      detectArchiveAction({ generatedPath, targetPath }).kind,
      "reuse"
    );

    // With force the freshly generated file replaces it.
    assert.deepEqual(detectArchiveAction({ generatedPath, targetPath, force: true }), {
      kind: "move",
      reason:
        "force re-run: overwriting existing archive with freshly generated hotspot",
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("readPublishResult tolerates missing state files", async () => {
  const workspace = mkdtempSync(path.join(tmpdir(), "hotspot-publish-state-"));
  const statePath = path.join(workspace, "publish-result.json");

  try {
    assert.equal(readPublishResult(statePath), null);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("shouldSkipWechatPublish only skips when a valid publish result already exists", async () => {
  const workspace = mkdtempSync(path.join(tmpdir(), "hotspot-publish-state-"));
  const statePath = path.join(workspace, "publish-result.json");

  try {
    writeFileSync(
      statePath,
      `${JSON.stringify({ ok: true, date: "2026-07-11", mediaId: "mid-123" }, null, 2)}\n`
    );
    assert.equal(shouldSkipWechatPublish(readPublishResult(statePath)), true);

    writeFileSync(statePath, `${JSON.stringify({ ok: false }, null, 2)}\n`);
    assert.equal(shouldSkipWechatPublish(readPublishResult(statePath)), false);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("package.json exposes the wechat publish pipeline command", () => {
  const packageJson = JSON.parse(readFileSync(`${wechatRoot}/package.json`, "utf8"));

  assert.equal(
    packageJson.scripts["publish:hotspot"],
    "node scripts/run-hotspot-pipeline.mjs"
  );
});

test("decideGitPublication supports rerun after a failed push", () => {
  assert.deepEqual(
    decideGitPublication({
      targetStatus: "M  archive/2026-07-11-hotspot.html",
      differsFromOrigin: true,
    }),
    { action: "commit-and-push" }
  );

  assert.deepEqual(
    decideGitPublication({ targetStatus: "", differsFromOrigin: true }),
    { action: "push-only" }
  );

  assert.deepEqual(
    decideGitPublication({ targetStatus: "", differsFromOrigin: false }),
    { action: "noop" }
  );
});

test("createPipelineLogger writes markers to the given stream", () => {
  const lines = [];
  const stream = { write: (chunk) => lines.push(chunk) };
  const logger = createPipelineLogger(stream);

  logger.header("start");
  logger.step("doing work");
  logger.reuse("archive preserved");
  logger.done("finished");

  assert.equal(lines.length, 4);
  assert.match(lines[0], /» start\n$/);
  assert.match(lines[1], /▸ doing work\n$/);
  assert.match(lines[2], /⏭ reuse: archive preserved\n$/);
  assert.match(lines[3], /✓ finished\n$/);
});

test("isSupportedPushBranch allows either common default branch", () => {
  assert.equal(isSupportedPushBranch("main"), true);
  assert.equal(isSupportedPushBranch("master"), true);
  assert.equal(isSupportedPushBranch("feature/hotspot"), false);
});

test("evaluateRunReport passes when overall and every phase are success", () => {
  const evaluation = evaluateRunReport({
    overall_status: "success",
    phases: {
      phase1: { status: "success" },
      // Detail-level statuses are irrelevant; only the phase status matters.
      phase5_5: {
        status: "success",
        details: [{ status: "coherent" }, { status: "rejected" }],
      },
    },
  });

  assert.equal(evaluation.ok, true);
  assert.deepEqual(evaluation.failures, []);
});

test("evaluateRunReport flags a stalled run (overall + phase still running)", () => {
  const evaluation = evaluateRunReport({
    overall_status: "running",
    phases: {
      phase1: { status: "success" },
      phase5: { status: "running" },
    },
  });

  assert.equal(evaluation.ok, false);
  assert.deepEqual(evaluation.failures, [
    { phase: "overall", status: "running" },
    { phase: "phase5", status: "running" },
  ]);
});

test("evaluateRunReport treats a missing status as a failure", () => {
  const evaluation = evaluateRunReport({ phases: { phase1: {} } });

  assert.equal(evaluation.ok, false);
  assert.deepEqual(evaluation.failures, [
    { phase: "overall", status: "(missing)" },
    { phase: "phase1", status: "(missing)" },
  ]);
});

test("parseRunReportMarkdown reads overall and phase statuses from the summary table", () => {
  const markdown = [
    "# Hotspot Scanning Run Report — 2026-07-31",
    "",
    "- Overall status: running",
    "",
    "## Summary",
    "",
    "| Phase | Status | Duration | Key Counts | Outputs |",
    "|---|---|---:|---|---|",
    "| phase1 | success | 70.6s | sources=6 | a.json |",
    "| phase5 | running |  | total_tasks=135 | b.json |",
    "| phase5_5 | success | 0.1s | events=4 | c.md |",
    "",
    "## phase1 Details",
    "",
    "| Item | Status | Count | Duration | Error |",
    "|---|---|---:|---:|---|",
    "| twitter_lists | success | 150 | 6.8s |  |",
  ].join("\n");

  const report = parseRunReportMarkdown(markdown);

  assert.equal(report.overall_status, "running");
  assert.deepEqual(report.phases, {
    phase1: { status: "success" },
    phase5: { status: "running" },
    phase5_5: { status: "success" },
  });
  // Detail rows (twitter_lists) must not leak into the phase map.
  assert.equal(evaluateRunReport(report).ok, false);
});

test("loadRunReport prefers JSON and falls back to Markdown", async () => {
  const workspace = mkdtempSync(path.join(tmpdir(), "hotspot-run-report-"));
  const jsonPath = path.join(workspace, "2026-08-04-run-report.json");
  const mdPath = path.join(workspace, "2026-08-04-run-report.md");

  try {
    assert.equal(loadRunReport({ jsonPath, mdPath }), null);

    writeFileSync(mdPath, "- Overall status: success\n");
    assert.equal(loadRunReport({ jsonPath, mdPath }).kind, "markdown");

    writeFileSync(
      jsonPath,
      `${JSON.stringify({ overall_status: "success", phases: {} })}\n`
    );
    assert.equal(loadRunReport({ jsonPath, mdPath }).kind, "json");
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("verifyScanReport throws when the report is missing", async () => {
  const workspace = mkdtempSync(path.join(tmpdir(), "hotspot-verify-"));

  try {
    const context = {
      date: "2026-07-31",
      inputDir: workspace,
      runReportJsonPath: path.join(workspace, "2026-07-31-run-report.json"),
      runReportMdPath: path.join(workspace, "2026-07-31-run-report.md"),
    };
    assert.throws(() => verifyScanReport(context), /no run report found/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("verifyScanReport throws with the offending phases for an incomplete scan", async () => {
  const workspace = mkdtempSync(path.join(tmpdir(), "hotspot-verify-"));
  const jsonPath = path.join(workspace, "2026-07-31-run-report.json");

  try {
    writeFileSync(
      jsonPath,
      `${JSON.stringify({
        overall_status: "running",
        phases: { phase1: { status: "success" }, phase5: { status: "running" } },
      })}\n`
    );
    const context = {
      date: "2026-07-31",
      inputDir: workspace,
      runReportJsonPath: jsonPath,
      runReportMdPath: path.join(workspace, "2026-07-31-run-report.md"),
    };
    assert.throws(() => verifyScanReport(context), /phase5=running/);
    assert.throws(() => verifyScanReport(context), /--skip-verify/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("verifyScanReport returns the evaluation for a healthy scan", async () => {
  const workspace = mkdtempSync(path.join(tmpdir(), "hotspot-verify-"));
  const jsonPath = path.join(workspace, "2026-08-04-run-report.json");

  try {
    writeFileSync(
      jsonPath,
      `${JSON.stringify({
        overall_status: "success",
        phases: { phase1: { status: "success" }, phase6: { status: "success" } },
      })}\n`
    );
    const context = {
      date: "2026-08-04",
      inputDir: workspace,
      runReportJsonPath: jsonPath,
      runReportMdPath: path.join(workspace, "2026-08-04-run-report.md"),
    };
    const result = verifyScanReport(context);
    assert.equal(result.ok, true);
    assert.equal(result.kind, "json");
    assert.equal(result.source, jsonPath);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("detectScanPlaceholders exempts placeholders inside degraded (<降级>) items", () => {
  const md = [
    "### Reddit R1 正常帖",
    "- 标签: AI工具",
    "- 切入角度: 真实的切入角度",
    "",
    "### Reddit R2 低优先级帖",
    "- 标签: <降级:无标签>",
    "- 切入角度: <TODO_LLM:angle>", // 降级项，豁免
    "",
    "### Reddit R3 打标失败帖",
    "- 这是什么东西（一句话）: <TODO_LLM:summary>", // 普通项，必须拦
  ].join("\n");

  const result = detectScanPlaceholders(md);
  assert.equal(result.count, 1);
  assert.deepEqual(result.markers, [{ marker: "<TODO_LLM:summary>", count: 1 }]);
});

test("detectScanPlaceholders counts unresolved LLM markers by type", () => {
  const clean = detectScanPlaceholders("summary: real text\nangle: also real");
  assert.equal(clean.count, 0);
  assert.deepEqual(clean.markers, []);

  const dirty = detectScanPlaceholders(
    "summary: <TODO_LLM:summary>\nangle: <TODO_LLM:angle>\ngap: <TODO_LLM:summary>"
  );
  assert.equal(dirty.count, 3);
  assert.deepEqual(
    new Map(dirty.markers.map((m) => [m.marker, m.count])),
    new Map([
      ["<TODO_LLM:summary>", 2],
      ["<TODO_LLM:angle>", 1],
    ])
  );
});

test("verifyScanMarkdown throws when scan.md still has placeholders", async () => {
  const workspace = mkdtempSync(path.join(tmpdir(), "hotspot-scan-md-"));
  const scanPath = path.join(workspace, "2026-07-31-scan.md");

  try {
    const context = { date: "2026-07-31", scanMarkdownPath: scanPath };

    // Missing file is a failure.
    assert.throws(() => verifyScanMarkdown(context), /scan markdown not found/);

    // Placeholder-laden file is a failure that names the markers.
    writeFileSync(scanPath, "受众关注点: <TODO_LLM:audience>\n空白角度: <TODO_LLM:gap>\n");
    assert.throws(() => verifyScanMarkdown(context), /unresolved LLM placeholder/);
    assert.throws(() => verifyScanMarkdown(context), /<TODO_LLM:audience>×1/);

    // A fully resolved scan passes and reports zero placeholders.
    writeFileSync(scanPath, "受众关注点: 开发者在意价格\n空白角度: 缺少迁移成本讨论\n");
    assert.deepEqual(verifyScanMarkdown(context), {
      source: scanPath,
      placeholders: 0,
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("verifyScanData fails on a clean run report but a placeholder-laden scan.md", async () => {
  const workspace = mkdtempSync(path.join(tmpdir(), "hotspot-verify-data-"));
  const jsonPath = path.join(workspace, "2026-07-31-run-report.json");
  const scanPath = path.join(workspace, "2026-07-31-scan.md");

  try {
    // Run report looks healthy...
    writeFileSync(
      jsonPath,
      `${JSON.stringify({
        overall_status: "success",
        phases: { phase1: { status: "success" } },
      })}\n`
    );
    // ...but the scan.md was never filled in.
    writeFileSync(scanPath, "一句话: <TODO_LLM:summary>\n");
    const context = {
      date: "2026-07-31",
      inputDir: workspace,
      runReportJsonPath: jsonPath,
      runReportMdPath: path.join(workspace, "2026-07-31-run-report.md"),
      scanMarkdownPath: scanPath,
    };

    assert.throws(() => verifyScanData(context), /unresolved LLM placeholder/);

    // With a resolved scan.md the combined check passes.
    writeFileSync(scanPath, "一句话: OpenAI 降价\n");
    const result = verifyScanData(context);
    assert.equal(result.report.ok, true);
    assert.equal(result.markdown.placeholders, 0);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
