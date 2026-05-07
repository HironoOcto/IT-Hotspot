import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, cpSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const generatorScript = path.join(repoRoot, "scripts", "generate-site.mjs");
const archiveSource = path.join(repoRoot, "archive");
const assetSource = path.join(repoRoot, "assets");
const faviconSource = path.join(repoRoot, "favicon.ico");
const issueFilePattern = /^\d{4}-\d{2}-\d{2}-hotspot\.html$/;

function makeWorkspace() {
  const workspace = mkdtempSync(path.join(tmpdir(), "it-hotspot-"));
  cpSync(archiveSource, path.join(workspace, "archive"), { recursive: true });
  cpSync(assetSource, path.join(workspace, "assets"), { recursive: true });
  cpSync(faviconSource, path.join(workspace, "favicon.ico"));
  return workspace;
}

function runGenerator(workspace) {
  return spawnSync(process.execPath, [generatorScript, "--root", workspace], {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

function listIssueFiles(archiveDir) {
  return readdirSync(archiveDir)
    .filter((fileName) => issueFilePattern.test(fileName))
    .sort((left, right) => right.localeCompare(left));
}

test("build generates archive, redirect, sitemap, and robots artifacts", async () => {
  const workspace = makeWorkspace();

  try {
    const result = runGenerator(workspace);
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const publicDir = path.join(workspace, "public");
    const archiveIndex = path.join(publicDir, "archive", "index.html");
    const rootIndex = path.join(publicDir, "index.html");
    const vercelConfig = path.join(workspace, "vercel.json");
    const sitemap = path.join(publicDir, "sitemap.xml");
    const robots = path.join(publicDir, "robots.txt");
    const favicon = path.join(publicDir, "favicon.ico");
    const appleTouchIcon = path.join(publicDir, "apple-touch-icon.png");
    const issueFiles = listIssueFiles(path.join(workspace, "archive"));
    const latestIssueFile = issueFiles[0];

    assert.equal(existsSync(publicDir), true);
    assert.equal(existsSync(archiveIndex), true);
    assert.equal(existsSync(rootIndex), true);
    assert.equal(existsSync(vercelConfig), true);
    assert.equal(existsSync(sitemap), true);
    assert.equal(existsSync(robots), true);
    assert.equal(existsSync(favicon), true);
    assert.equal(existsSync(appleTouchIcon), true);
    assert.equal(existsSync(path.join(workspace, "archive", "index.html")), false);
    assert.equal(existsSync(path.join(workspace, "index.html")), false);
    assert.equal(existsSync(path.join(workspace, "sitemap.xml")), false);
    assert.equal(existsSync(path.join(workspace, "robots.txt")), false);

    const archiveHtml = readFileSync(archiveIndex, "utf8");
    assert.match(archiveHtml, /Archive Index \/ 2026/);
    for (const issueFile of issueFiles) {
      assert.match(archiveHtml, new RegExp(`href="${issueFile.replaceAll(".", "\\.")}"`));
    }
    assert.match(archiveHtml, /SAM ALT?MAN|Sam Altman/u);
    assert.doesNotMatch(archiveHtml, /Load Older Issues/);

    const generatedIndex = readFileSync(rootIndex, "utf8");
    assert.match(generatedIndex, new RegExp(latestIssueFile.replaceAll(".", "\\.")));
    assert.match(generatedIndex, /<link rel="icon" href="favicon\.ico" sizes="any" \/>/);
    assert.match(
      generatedIndex,
      /<link rel="apple-touch-icon" href="apple-touch-icon\.png" \/>/
    );

    const generatedVercelConfig = JSON.parse(readFileSync(vercelConfig, "utf8"));
    assert.deepEqual(generatedVercelConfig, { outputDirectory: "public" });

    const generatedSitemap = readFileSync(sitemap, "utf8");
    assert.match(generatedSitemap, /https:\/\/hotspot\.octohirono\.dev\/archive\//);
    assert.match(generatedSitemap, new RegExp(`https://hotspot\\.octohirono\\.dev/archive/${latestIssueFile.replaceAll(".", "\\.")}`));

    const generatedRobots = readFileSync(robots, "utf8");
    assert.match(generatedRobots, /Sitemap: https:\/\/hotspot\.octohirono\.dev\/sitemap\.xml/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("build enhances issue pages with archive link and SEO metadata", async () => {
  const workspace = makeWorkspace();

  try {
    const issueFiles = listIssueFiles(path.join(workspace, "archive"));
    const latestIssueFile = issueFiles[0];
    const originalLatestIssue = readFileSync(
      path.join(workspace, "archive", latestIssueFile),
      "utf8"
    );
    const result = runGenerator(workspace);
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const latestIssue = readFileSync(
      path.join(workspace, "public", "archive", latestIssueFile),
      "utf8"
    );
    const sourceIssue = readFileSync(
      path.join(workspace, "archive", latestIssueFile),
      "utf8"
    );

    assert.match(
      latestIssue,
      new RegExp(
        `<link rel="canonical" href="https://hotspot\\.octohirono\\.dev/archive/${latestIssueFile.replaceAll(".", "\\.")}"\\s*/?>`
      )
    );
    assert.match(latestIssue, /<meta name="description" content="[^"]+"/);
    assert.match(latestIssue, /href="\.\/"[^>]*>往期热点<\/a>/);
    assert.match(latestIssue, /<link rel="icon" href="\.\.\/favicon\.ico" sizes="any" \/>/);
    assert.match(
      latestIssue,
      /<link rel="apple-touch-icon" href="\.\.\/apple-touch-icon\.png" \/>/
    );
    assert.equal(sourceIssue, originalLatestIssue);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
