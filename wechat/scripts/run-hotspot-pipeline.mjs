#!/usr/bin/env node

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SITE_ORIGIN = "https://hotspot.octohirono.dev";
const DEFAULT_WAIT_MS = 5_000;
const DEFAULT_UPSTREAM_ROOT = "/Users/linling/Documents/code/ai/openclaw-workspace";
const wechatRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultRepoRoot = path.resolve(wechatRoot, "..");

// Resolve where the upstream openclaw-workspace lives, in priority order so the
// same script works across machines with different checkouts (dev machine vs the
// scan machine, where it may sit at e.g. /Users/luckyclaw/.openclaw):
//   1. explicit --upstream-root <path>
//   2. UPSTREAM_ROOT env var (best for a fixed automation host)
//   3. a sibling ../openclaw-workspace next to this IT-Hotspot checkout, if present
//   4. the hard-coded default (keeps the current dev machine working untouched)
function resolveUpstreamRoot({ explicit, repoRoot, env = process.env } = {}) {
  if (explicit) return path.resolve(explicit);
  if (env.UPSTREAM_ROOT) return path.resolve(env.UPSTREAM_ROOT);
  if (repoRoot) {
    const sibling = path.resolve(repoRoot, "..", "openclaw-workspace");
    if (existsSync(sibling)) return sibling;
  }
  return DEFAULT_UPSTREAM_ROOT;
}

function parsePipelineArgs(argv) {
  const args = {
    run: false,
    skipDraft: false,
    skipVerify: false,
    skipPull: false,
    force: false,
    date: "",
    upstreamRoot: "",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--run") {
      args.run = true;
    } else if (arg === "--skip-draft") {
      args.skipDraft = true;
    } else if (arg === "--skip-verify") {
      args.skipVerify = true;
    } else if (arg === "--skip-pull") {
      args.skipPull = true;
    } else if (arg === "--force") {
      args.force = true;
    } else if (arg === "--date") {
      args.date = argv[++i] || "";
    } else if (arg === "--upstream-root") {
      args.upstreamRoot = argv[++i] || "";
    }
  }
  return args;
}

function todayString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function buildPipelineContext({ cwd, date, upstreamRoot, siteOrigin = SITE_ORIGIN }) {
  const resolvedDate = date || todayString();
  const archiveFileName = `${resolvedDate}-hotspot.html`;
  const resolvedWechatRoot = path.resolve(cwd);
  const root = path.resolve(resolvedWechatRoot, "..");
  const resolvedUpstreamRoot = resolveUpstreamRoot({
    explicit: upstreamRoot,
    repoRoot: root,
  });
  const archiveFilePath = path.join(root, "archive", archiveFileName);
  const wechatArticleDir = path.join(resolvedWechatRoot, "articles", resolvedDate);
  const wechatPublishResultPath = path.join(wechatArticleDir, "publish-result.json");
  const upstreamHotspotRoot = path.join(
    resolvedUpstreamRoot,
    "shared-skills",
    "hotspot_scanning"
  );
  const upstreamToolDir = path.join(upstreamHotspotRoot, "tools");
  const upstreamPython = path.join(upstreamHotspotRoot, ".venv", "bin", "python");
  const upstreamGeneratedPath = path.join(upstreamToolDir, archiveFileName);
  const inputDir = path.join(resolvedUpstreamRoot, "workspace-kol", "memory");
  const runReportJsonPath = path.join(inputDir, `${resolvedDate}-run-report.json`);
  const runReportMdPath = path.join(inputDir, `${resolvedDate}-run-report.md`);
  const scanMarkdownPath = path.join(inputDir, `${resolvedDate}-scan.md`);

  return {
    root,
    wechatRoot: resolvedWechatRoot,
    date: resolvedDate,
    archiveFileName,
    archiveRelativePath: path.posix.join("archive", archiveFileName),
    archiveFilePath,
    publicArchiveUrl: `${siteOrigin}/archive/${archiveFileName}`,
    siteWaitMs: DEFAULT_WAIT_MS,
    upstreamRoot: resolvedUpstreamRoot,
    upstreamToolDir,
    upstreamPython,
    upstreamGeneratedPath,
    inputDir,
    runReportJsonPath,
    runReportMdPath,
    scanMarkdownPath,
    wechatArticleDir,
    wechatPublishResultPath,
  };
}

function normalizeRepoPath(value) {
  return value.replace(/\\/g, "/");
}

function classifyGitStatusEntries({ targetPath, statusLines }) {
  const normalizedTarget = normalizeRepoPath(targetPath);
  const blockingPaths = [];

  for (const line of statusLines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const pathPart = trimmed
      .replace(/^[MARCDU?!\s]+/, "")
      .split(" -> ")
      .at(-1)
      .trim();
    const normalizedPath = normalizeRepoPath(pathPart);
    if (normalizedPath !== normalizedTarget) {
      blockingPaths.push(normalizedPath);
    }
  }

  return {
    ok: blockingPaths.length === 0,
    blockingPaths,
  };
}

function detectArchiveAction({ generatedPath, targetPath, force = false }) {
  if (!existsSync(generatedPath)) {
    return { kind: "missing-generated", reason: "generated hotspot file not found" };
  }
  if (!existsSync(targetPath)) {
    return { kind: "move", reason: "target archive file does not exist yet" };
  }
  if (force) {
    return {
      kind: "move",
      reason: "force re-run: overwriting existing archive with freshly generated hotspot",
    };
  }

  const generated = readFileSync(generatedPath);
  const target = readFileSync(targetPath);
  if (generated.equals(target)) {
    return { kind: "reuse", reason: "target already matches generated hotspot" };
  }
  return {
    kind: "reuse",
    reason: "target archive file already exists; preserving it for resume",
  };
}

function readPublishResult(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function shouldSkipWechatPublish(result) {
  return Boolean(result?.ok && result?.mediaId && result?.date);
}

// The upstream scan pipeline records a per-phase status in the run report. A
// healthy run has `overall_status` and every phase at "success"; an aborted run
// (e.g. the 2026-07-31 scan that shipped a scan.md full of unresolved
// <TODO_LLM:...> placeholders) leaves the overall status and one or more phases
// at "running"/"failed". We verify at the PHASE level only — detail-level
// statuses like "coherent"/"rejected" (phase5_5) are legitimate outcomes, not
// failures.
function evaluateRunReport(report) {
  const failures = [];
  const overallStatus = report?.overall_status ?? null;
  if (overallStatus !== "success") {
    failures.push({ phase: "overall", status: overallStatus ?? "(missing)" });
  }

  const phases = report?.phases ?? {};
  for (const [phaseKey, phase] of Object.entries(phases)) {
    const status = phase?.status ?? null;
    if (status !== "success") {
      failures.push({ phase: phaseKey, status: status ?? "(missing)" });
    }
  }

  return { ok: failures.length === 0, overallStatus, failures };
}

// Minimal parser for the Markdown run report, used only when the JSON report is
// absent. It reads `- Overall status: <x>` and the summary table rows that begin
// with a phase id (e.g. `| phase5 | running | ... |`).
function parseRunReportMarkdown(markdown) {
  const overallMatch = markdown.match(/^-\s*Overall status:\s*(\S+)/im);
  const phases = {};
  const phaseRow = /^\|\s*(phase[0-9][\w.]*)\s*\|\s*([^|]+?)\s*\|/gim;
  let match;
  while ((match = phaseRow.exec(markdown)) !== null) {
    phases[match[1]] = { status: match[2].trim() };
  }
  return {
    overall_status: overallMatch ? overallMatch[1] : null,
    phases,
  };
}

function loadRunReport({ jsonPath, mdPath }) {
  if (existsSync(jsonPath)) {
    let raw;
    try {
      raw = readFileSync(jsonPath, "utf8");
      return { source: jsonPath, kind: "json", report: JSON.parse(raw) };
    } catch (error) {
      throw new Error(`Run report is not valid JSON (${jsonPath}): ${error.message}`);
    }
  }
  if (existsSync(mdPath)) {
    return {
      source: mdPath,
      kind: "markdown",
      report: parseRunReportMarkdown(readFileSync(mdPath, "utf8")),
    };
  }
  return null;
}

// Gate publishing on a valid upstream scan. Throws with an actionable message
// when the scan is missing or incomplete; the caller can bypass with
// --skip-verify.
function verifyScanReport(context) {
  const loaded = loadRunReport({
    jsonPath: context.runReportJsonPath,
    mdPath: context.runReportMdPath,
  });

  if (!loaded) {
    throw new Error(
      `Scan verification failed: no run report found for ${context.date} ` +
        `(looked for ${context.date}-run-report.json / .md in ${context.inputDir}). ` +
        `Re-run the upstream scan, or pass --skip-verify to bypass.`
    );
  }

  const evaluation = evaluateRunReport(loaded.report);
  if (!evaluation.ok) {
    const detail = evaluation.failures
      .map((failure) => `${failure.phase}=${failure.status}`)
      .join(", ");
    throw new Error(
      `Scan verification failed for ${context.date}: non-success phases → ${detail}. ` +
        `The scan is incomplete (its scan.md likely still contains unresolved ` +
        `<TODO_LLM:...> placeholders); refusing to publish. ` +
        `Source: ${loaded.source}. Re-run the upstream scan, or pass --skip-verify to bypass.`
    );
  }

  return { source: loaded.source, kind: loaded.kind, ...evaluation };
}

// Belt-and-suspenders check on the generated scan.md itself. A completed scan
// resolves every `<TODO_LLM:...>` placeholder (summary/angle/audience/gap/...);
// an aborted phase5 leaves them verbatim in the file (the 2026-07-31 scan shipped
// 680 of them). This catches the symptom directly even if the run report were
// ever out of sync with the scan.
//
// Exception: items explicitly marked degraded (`<降级:...>`, e.g. low-priority
// posts phase5 intentionally skips) legitimately leave placeholders like
// <TODO_LLM:angle> and never reach the published output, so we exempt those
// blocks. We split the scan into per-item "### ..." blocks and only count
// placeholders in ordinary (non-degraded) items — the 2026-07-31 failure had no
// `<降级` markers at all, so its placeholders are still flagged.
function detectScanPlaceholders(markdown) {
  const counts = new Map();
  let count = 0;
  for (const block of markdown.split(/^###\s/m)) {
    if (block.includes("<降级")) continue;
    for (const marker of block.match(/<TODO_LLM:[^>]*>/g) ?? []) {
      counts.set(marker, (counts.get(marker) ?? 0) + 1);
      count += 1;
    }
  }
  return {
    count,
    markers: [...counts.entries()].map(([marker, markerCount]) => ({
      marker,
      count: markerCount,
    })),
  };
}

function verifyScanMarkdown(context) {
  const scanPath = context.scanMarkdownPath;
  if (!existsSync(scanPath)) {
    throw new Error(
      `Scan verification failed: scan markdown not found for ${context.date} ` +
        `(${scanPath}). Re-run the upstream scan, or pass --skip-verify to bypass.`
    );
  }

  const placeholders = detectScanPlaceholders(readFileSync(scanPath, "utf8"));
  if (placeholders.count > 0) {
    const summary = placeholders.markers
      .map((entry) => `${entry.marker}×${entry.count}`)
      .join(", ");
    throw new Error(
      `Scan verification failed for ${context.date}: scan.md still has ` +
        `${placeholders.count} unresolved LLM placeholder(s) → ${summary}. ` +
        `The per-post tagging (phase5) did not finish; refusing to publish. ` +
        `Source: ${scanPath}. Re-run the upstream scan, or pass --skip-verify to bypass.`
    );
  }

  return { source: scanPath, placeholders: placeholders.count };
}

// Full scan gate: the run report must show every phase succeeded, AND the
// generated scan.md must have no leftover LLM placeholders. Either check throws
// on failure; the caller bypasses both with --skip-verify.
function verifyScanData(context) {
  const report = verifyScanReport(context);
  const markdown = verifyScanMarkdown(context);
  return { report, markdown };
}

function writePublishResult(filePath, result) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(
    filePath,
    `${JSON.stringify(
      {
        ...result,
        ok: true,
        createdAt: new Date().toISOString(),
      },
      null,
      2
    )}\n`
  );
}

function decideGitPublication({ targetStatus, differsFromOrigin }) {
  if (targetStatus) {
    return { action: "commit-and-push" };
  }
  if (differsFromOrigin) {
    return { action: "push-only" };
  }
  return { action: "noop" };
}

function isSupportedPushBranch(branchName) {
  return branchName === "main" || branchName === "master";
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    ...options,
  });

  if (result.status !== 0) {
    const details = [result.stdout, result.stderr, result.error?.message]
      .filter(Boolean)
      .join("\n")
      .trim();
    const suffix = details ? `\n${details}` : "";
    throw new Error(`Command failed: ${command} ${args.join(" ")}${suffix}`);
  }

  return result;
}

function getGitStatusLines(repoRoot) {
  const result = runCommand("git", ["status", "--short"], { cwd: repoRoot });
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean);
}

function ensureGitWorktreeSafe(repoRoot, targetRelativePath) {
  const status = classifyGitStatusEntries({
    targetPath: targetRelativePath,
    statusLines: getGitStatusLines(repoRoot),
  });
  if (!status.ok) {
    throw new Error(
      `Git worktree is dirty outside ${targetRelativePath}: ${status.blockingPaths.join(", ")}`
    );
  }
}

function renderDryRun(
  context,
  { skipDraft = false, skipVerify = false, skipPull = false, force = false } = {}
) {
  const pythonCmd = [
    context.upstreamPython,
    "gen_hotspot.py",
    "--date",
    context.date,
    "--input-dir",
    context.inputDir,
  ].join(" ");

  return [
    `Mode: dry-run`,
    `Force re-run: ${
      force
        ? "yes (pull latest IT-Hotspot from origin, overwrite archive, republish WeChat draft)"
        : "no"
    }`,
    `Date: ${context.date}`,
    `Upstream workspace: ${context.upstreamRoot}`,
    `Archive target: ${context.archiveFilePath}`,
    `Public URL: ${context.publicArchiveUrl}`,
    `WeChat result state: ${context.wechatPublishResultPath}`,
    force
      ? `Step 0: (cwd ${context.root}) git pull --ff-only origin <current branch>`
      : "Step 0: skip main-repo pull (enable with --force)",
    skipPull
      ? "Step 1: skip upstream pull (--skip-pull) — use local scan data as-is"
      : `Step 1: (cwd ${context.upstreamRoot}) git pull origin main`,
    skipVerify
      ? "Step 1.5: skip scan verification (--skip-verify)"
      : `Step 1.5: verify scan (${context.date}-run-report.json/.md all phases success + ${context.date}-scan.md has no <TODO_LLM:...> placeholders) — fail otherwise`,
    `Step 2: (cwd ${context.upstreamToolDir}) ${pythonCmd}`,
    `Step 3: move ${context.upstreamGeneratedPath} -> ${context.archiveFilePath}`,
    `Step 4: (cwd ${context.root}) git add -- ${context.archiveRelativePath}`,
    `Step 5: (cwd ${context.root}) git commit -m "chore: publish hotspot ${context.date}"`,
    `Step 6: (cwd ${context.root}) git push origin <current branch>`,
    `Step 7: wait ${context.siteWaitMs / 1000}s for ${context.publicArchiveUrl}`,
    `Step 8: (cwd ${context.wechatRoot}) node scripts/generate-wechat.mjs --date ${context.date}`,
    skipDraft
      ? "Step 9: skip draft creation (--skip-draft)"
      : `Step 9: (cwd ${context.wechatRoot}) node scripts/publish-draft.mjs --date ${context.date}`,
  ].join("\n");
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// Progress logging goes to stderr so the final JSON result stays clean on stdout.
function createPipelineLogger(stream = process.stderr) {
  const stamp = () => new Date().toISOString().slice(11, 19);
  const write = (marker, message) => stream.write(`[${stamp()}] ${marker} ${message}\n`);
  return {
    header: (message) => write("»", message),
    step: (message) => write("▸", message),
    info: (message) => write("  ↳", message),
    // Distinct marker so idempotent reuse of a previous run's result is obvious.
    reuse: (message) => write("⏭ reuse:", message),
    done: (message) => write("✓", message),
  };
}

const noopLogger = {
  header() {},
  step() {},
  info() {},
  reuse() {},
  done() {},
};

function currentPublishBranch(repoRoot) {
  // `rev-parse` is supported by older Git versions unlike `branch --show-current`.
  const branchName = runCommand("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    cwd: repoRoot,
  }).stdout.trim();
  if (!isSupportedPushBranch(branchName)) {
    throw new Error(
      `Refusing to publish from ${branchName || "(detached HEAD)"}; expected main or master`
    );
  }
  return branchName;
}

function pullMainRepoLatest(context) {
  const branchName = currentPublishBranch(context.root);
  // Fast-forward the local publish branch onto the latest origin so a forced
  // re-run rebuilds on top of GitHub's current state instead of a stale one.
  runCommand("git", ["pull", "--ff-only", "origin", branchName], { cwd: context.root });
  return { branch: branchName };
}

function commitArchiveFile(context) {
  const branchName = currentPublishBranch(context.root);

  runCommand("git", ["fetch", "origin", branchName], { cwd: context.root });
  runCommand("git", ["add", "--", context.archiveRelativePath], { cwd: context.root });
  const targetStatus = runCommand(
    "git",
    ["status", "--short", "--", context.archiveRelativePath],
    { cwd: context.root }
  ).stdout.trim();
  const originDiff = spawnSync(
    "git",
    ["diff", "--quiet", `origin/${branchName}`, "--", context.archiveRelativePath],
    { cwd: context.root }
  );
  const publication = decideGitPublication({
    targetStatus,
    differsFromOrigin: originDiff.status === 1,
  });

  if (publication.action === "commit-and-push") {
    runCommand(
      "git",
      ["commit", "-m", `chore: publish hotspot ${context.date}`],
      { cwd: context.root }
    );
    runCommand("git", ["push", "origin", branchName], { cwd: context.root });
    return { committed: true, pushed: true, reason: "archive file committed and pushed" };
  }

  if (publication.action === "push-only") {
    runCommand("git", ["push", "origin", branchName], { cwd: context.root });
    return {
      committed: false,
      pushed: true,
      reason: "archive file was already committed locally and has now been pushed",
    };
  }

  return {
    committed: false,
    pushed: false,
    reason: `archive file already committed and already present on origin/${branchName}`,
  };
}

function prepareArchive(context, { force = false } = {}) {
  const action = detectArchiveAction({
    generatedPath: context.upstreamGeneratedPath,
    targetPath: context.archiveFilePath,
    force,
  });

  if (action.kind === "missing-generated") {
    throw new Error(
      `Upstream hotspot generation did not produce ${context.upstreamGeneratedPath}`
    );
  }
  mkdirSync(path.dirname(context.archiveFilePath), { recursive: true });
  if (action.kind === "move") {
    renameSync(context.upstreamGeneratedPath, context.archiveFilePath);
  } else if (action.kind === "reuse" && existsSync(context.upstreamGeneratedPath)) {
    unlinkSync(context.upstreamGeneratedPath);
  }

  return action;
}

function runWechatGenerate(context) {
  runCommand(
    process.execPath,
    [path.join(context.wechatRoot, "scripts", "generate-wechat.mjs"), "--date", context.date],
    { cwd: context.wechatRoot, env: process.env }
  );
}

function runWechatPublish(context) {
  const result = runCommand(
    process.execPath,
    [path.join(context.wechatRoot, "scripts", "publish-draft.mjs"), "--date", context.date],
    { cwd: context.wechatRoot, env: process.env }
  );
  return JSON.parse(result.stdout.trim());
}

function ensureUpstreamAvailable(context) {
  if (!existsSync(context.upstreamRoot)) {
    throw new Error(
      `Upstream workspace not found: ${context.upstreamRoot}. ` +
        `Set UPSTREAM_ROOT or pass --upstream-root <path> to point at your openclaw-workspace checkout.`
    );
  }
  if (!existsSync(context.inputDir)) {
    throw new Error(
      `Upstream workspace at ${context.upstreamRoot} is missing workspace-kol/memory ` +
        `(looked for ${context.inputDir}). Check that --upstream-root / UPSTREAM_ROOT points at the right checkout.`
    );
  }
}

function pullUpstreamLatest(context) {
  runCommand("git", ["pull", "origin", "main"], { cwd: context.upstreamRoot });
}

function runUpstreamGenerate(context) {
  if (!existsSync(context.upstreamPython)) {
    throw new Error(`Missing upstream virtualenv python: ${context.upstreamPython}`);
  }
  runCommand(
    context.upstreamPython,
    ["gen_hotspot.py", "--date", context.date, "--input-dir", context.inputDir],
    { cwd: context.upstreamToolDir, env: process.env }
  );
}

function runUpstreamHotspot(context) {
  pullUpstreamLatest(context);
  runUpstreamGenerate(context);
}

async function runHotspotPipeline({
  cwd,
  date,
  run,
  skipDraft = false,
  skipVerify = false,
  skipPull = false,
  force = false,
  upstreamRoot = "",
  logger = noopLogger,
}) {
  const context = buildPipelineContext({ cwd, date, upstreamRoot });
  if (!run) {
    return {
      ok: true,
      dryRun: true,
      output: renderDryRun(context, { skipDraft, skipVerify, skipPull, force }),
    };
  }

  logger.header(
    `Publishing hotspot ${context.date}${force ? " (force re-run)" : ""}`
  );
  logger.info(`Upstream workspace: ${context.upstreamRoot}`);

  logger.step("Verifying git worktree is clean");
  ensureGitWorktreeSafe(context.root, context.archiveRelativePath);

  logger.step("Checking upstream workspace is available");
  ensureUpstreamAvailable(context);

  if (force) {
    logger.step("Pulling latest IT-Hotspot from origin (--force)");
    const pull = pullMainRepoLatest(context);
    logger.info(`fast-forwarded ${pull.branch} to origin`);
  } else {
    logger.info("Main-repo pull skipped (enable with --force)");
  }

  if (skipPull) {
    logger.reuse("upstream pull skipped (--skip-pull) — using local scan data as-is");
  } else {
    logger.step("Pulling latest scan data upstream (git pull origin main)");
    pullUpstreamLatest(context);
  }

  let scanVerification = null;
  if (skipVerify) {
    logger.reuse("scan verification skipped (--skip-verify)");
  } else {
    logger.step("Verifying scan data (run report + scan.md placeholders)");
    scanVerification = verifyScanData(context);
    logger.info(
      `run report OK — all phases success (${path.basename(scanVerification.report.source)})`
    );
    logger.info(
      `scan.md OK — no unresolved LLM placeholders (${path.basename(scanVerification.markdown.source)})`
    );
  }

  logger.step("Generating hotspot upstream (gen_hotspot.py)");
  runUpstreamGenerate(context);

  logger.step("Placing archive file");
  const archiveAction = prepareArchive(context, { force });
  if (archiveAction.kind === "reuse") {
    logger.reuse(`archive — ${archiveAction.reason}`);
  } else {
    logger.info(`archive ${archiveAction.kind} — ${archiveAction.reason}`);
  }

  logger.step("Committing and pushing archive to GitHub");
  ensureGitWorktreeSafe(context.root, context.archiveRelativePath);
  const gitResult = commitArchiveFile(context);
  if (!gitResult.committed && !gitResult.pushed) {
    logger.reuse(`git — ${gitResult.reason}`);
  } else {
    logger.info(`git — ${gitResult.reason}`);
  }

  logger.step(`Waiting ${context.siteWaitMs / 1000}s for ${context.publicArchiveUrl}`);
  sleep(context.siteWaitMs);

  logger.step("Generating WeChat article");
  runWechatGenerate(context);

  const existingPublish = readPublishResult(context.wechatPublishResultPath);
  let publishResult = existingPublish;
  let wechatSkipped = false;

  if (skipDraft) {
    wechatSkipped = true;
    logger.info("WeChat draft creation skipped (--skip-draft)");
  } else if (!force && shouldSkipWechatPublish(existingPublish)) {
    wechatSkipped = true;
    logger.reuse(
      `WeChat draft — already published (mediaId ${existingPublish.mediaId})`
    );
  } else {
    logger.step("Publishing WeChat draft");
    publishResult = runWechatPublish(context);
    writePublishResult(context.wechatPublishResultPath, publishResult);
    logger.info(`WeChat draft created (mediaId ${publishResult?.mediaId ?? "n/a"})`);
  }

  logger.done(`Done — ${context.publicArchiveUrl}`);

  return {
    ok: true,
    dryRun: false,
    date: context.date,
    force,
    upstreamRoot: context.upstreamRoot,
    upstreamPulled: !skipPull,
    scanVerified: !skipVerify,
    scanVerification,
    archiveAction: archiveAction.kind,
    git: gitResult,
    publicArchiveUrl: context.publicArchiveUrl,
    draftSkipped: skipDraft,
    wechatSkipped,
    publishResult,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const args = parsePipelineArgs(process.argv.slice(2));
    const result = await runHotspotPipeline({
      cwd: process.cwd(),
      date: args.date,
      run: args.run,
      skipDraft: args.skipDraft,
      skipVerify: args.skipVerify,
      skipPull: args.skipPull,
      force: args.force,
      upstreamRoot: args.upstreamRoot,
      logger: createPipelineLogger(),
    });

    if (result.dryRun) {
      console.log(result.output);
    } else {
      console.log(JSON.stringify(result, null, 2));
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

export {
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
  runHotspotPipeline,
  shouldSkipWechatPublish,
  verifyScanData,
  verifyScanMarkdown,
  verifyScanReport,
  writePublishResult,
};
