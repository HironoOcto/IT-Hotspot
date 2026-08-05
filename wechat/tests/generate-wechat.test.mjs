import test from "node:test";
import assert from "node:assert/strict";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  buildPublishPayload,
  computeCoverCapturePlan,
  selectArticleItems,
} from "../scripts/generate-wechat.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const generatorScript = path.join(repoRoot, "scripts", "generate-wechat.mjs");
const publishRoot = path.resolve(repoRoot, "..");
const archiveSource = path.join(publishRoot, "archive");
const issueFilePattern = /^\d{4}-\d{2}-\d{2}-hotspot\.html$/;

function makeWorkspace() {
  const workspace = mkdtempSync(path.join(tmpdir(), "it-hotspot-wechat-"));
  cpSync(archiveSource, path.join(workspace, "archive"), { recursive: true });
  return workspace;
}

function runGenerator(workspace, date = "2026-05-31") {
  const outputDir = path.join(workspace, "articles");
  return spawnSync(
    process.execPath,
    [generatorScript, "--root", workspace, "--output", outputDir, "--date", date, "--skip-cover"],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, WECHAT_TITLE_MOCK: "1" },
    }
  );
}

const MOCK_QIAOMU_TITLE = "MCP真凉了？Claude/Codex工作流变天，AI代理开始自己长手脚";
const MOCK_WECHAT_TITLE =
  "【5月31日】热点早报 | MCP真凉了？Claude/Codex工作流变天，AI代理开始自己长手脚";

function listIssueFiles(archiveDir) {
  return readdirSync(archiveDir)
    .filter((fileName) => issueFilePattern.test(fileName))
    .sort((left, right) => right.localeCompare(left));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sectionBody(markdown, label) {
  const match = markdown.match(
    new RegExp(`^## ${escapeRegExp(label)}\\n([\\s\\S]*?)(?=\\n## |\\n---|\\Z)`, "m")
  );
  return match ? match[1] : "";
}

function sectionItemCount(markdown, label) {
  return (sectionBody(markdown, label).match(/^### /gm) || []).length;
}

test("wechat build creates sidecar markdown, html, and cta image from a published issue", async () => {
  const workspace = makeWorkspace();

  try {
    const result = runGenerator(workspace);
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const articleDir = path.join(workspace, "articles", "2026-05-31");
    const markdownPath = path.join(articleDir, "daily-hotspots.md");
    const htmlPath = path.join(articleDir, "daily-hotspots.html");
    const titlePath = path.join(articleDir, "title-candidates.md");
    const ctaPath = path.join(articleDir, "2026-05-31-cta.png");
    const draftBodyPath = path.join(articleDir, "draft-body.html");
    const draftManifestPath = path.join(articleDir, "draft-manifest.json");

    assert.equal(existsSync(markdownPath), true);
    assert.equal(existsSync(htmlPath), true);
    assert.equal(existsSync(titlePath), true);
    assert.equal(existsSync(ctaPath), true);
    assert.equal(existsSync(draftBodyPath), true);
    assert.equal(existsSync(draftManifestPath), true);

    const markdown = readFileSync(markdownPath, "utf8");
    assert.match(markdown, new RegExp(`^# ${escapeRegExp(MOCK_QIAOMU_TITLE)}$`, "m"));
    assert.match(markdown, /^## 今日头条$/m);
    assert.match(markdown, /^## 今日焦点 TOP 3$/m);
    assert.match(markdown, /^## 行业热点$/m);
    assert.match(markdown, /^## 实战打法$/m);
    assert.match(markdown, /^## 社区热议$/m);
    assert.match(markdown, /^## 新品 Top$/m);
    assert.doesNotMatch(markdown, /^## 今日热点$/m);
    assert.doesNotMatch(markdown, /^## 话题追踪$/m);
    assert.doesNotMatch(markdown, /^## 跨平台热点$/m);
    assert.doesNotMatch(markdown, /暂无/);

    const itemHeadings = [...markdown.matchAll(/^### (\d{2})\. (.+)$/gm)];
    assert.equal(sectionItemCount(markdown, "今日头条"), 1);
    assert.equal(sectionItemCount(markdown, "今日焦点 TOP 3"), 3);
    assert.ok(sectionItemCount(markdown, "行业热点") >= 1);
    assert.ok(sectionItemCount(markdown, "行业热点") <= 10);
    assert.ok(sectionItemCount(markdown, "实战打法") <= 5);
    assert.ok(sectionItemCount(markdown, "社区热议") <= 5);
    assert.ok(sectionItemCount(markdown, "新品 Top") <= 5);
    assert.ok(sectionItemCount(markdown, "实战打法") >= 1);
    assert.ok(sectionItemCount(markdown, "社区热议") >= 1);
    assert.ok(sectionItemCount(markdown, "新品 Top") >= 1);
    assert.deepEqual(
      itemHeadings.map((match) => match[1]),
      itemHeadings.map((_, index) => String(index + 1).padStart(2, "0"))
    );
    assert.equal(
      new Set(itemHeadings.map((match) => match[2])).size,
      itemHeadings.length,
      "article item headings should be deduplicated"
    );

    const top3Block = markdown.match(
      /^## 今日焦点 TOP 3\n([\s\S]*?)(?=\n## |\n---|\Z)/m
    );
    assert.ok(top3Block, "should render a focus top 3 block");
    assert.equal((top3Block[1].match(/^### /gm) || []).length, 3);

    assert.match(markdown, /原文摘录：/);
    assert.match(markdown, /受众观点：/);
    const audienceLines = markdown
      .split("\n")
      .filter((line) => line.startsWith("受众观点："));
    assert.ok(audienceLines.length > 0, "should render audience viewpoint lines");
    for (const line of audienceLines) {
      assert.doesNotMatch(line, /[（(][^）)]*@[^）)]*[）)]/);
      assert.doesNotMatch(line, /@[A-Za-z0-9_]+/);
    }
    assert.match(markdown, /数据：Twitter [^\\n]+ · @/);
    assert.match(markdown, /本期 Hotspot 扫描 \d+ 条英文社区动态/);
    assert.match(
      markdown,
      /https:\/\/hotspot\.octohirono\.dev\/archive\/2026-05-31-hotspot\.html/
    );

    const html = readFileSync(htmlPath, "utf8");
    const draftBody = readFileSync(draftBodyPath, "utf8");
    const draftManifest = JSON.parse(readFileSync(draftManifestPath, "utf8"));
    const titleCandidates = readFileSync(titlePath, "utf8");
    assert.match(titleCandidates, /^# 为您生成的微信公众号爆款标题/m);
    assert.match(titleCandidates, new RegExp(escapeRegExp(MOCK_QIAOMU_TITLE)));
    assert.match(titleCandidates, /- Skill：xinzhiyuan-title \(vendored\)/);
    assert.match(titleCandidates, /- Skill 路径：.+wechat\/references/);
    assert.match(html, new RegExp(`<title>${escapeRegExp(MOCK_WECHAT_TITLE)}<\\/title>`));
    assert.doesNotMatch(html, new RegExp(`<h1[^>]*>${escapeRegExp(MOCK_QIAOMU_TITLE)}<\\/h1>`));
    assert.doesNotMatch(html, /<h1 style="[^"]*">每日热点｜/);
    assert.match(html, /今日焦点/);
    assert.doesNotMatch(html, /<style>/);
    assert.match(html, /<!doctype html>/i);
    assert.match(html, /<main style="[^"]*background:#fffdf8/);
    assert.match(html, /24 小时扫盘速读/);
    assert.match(html, /TODAY'S BRIEF/);
    assert.match(html, /border-bottom:2px solid #1a1714/);
    assert.match(html, /<h1 style="[^"]*font-size:22px/);
    assert.doesNotMatch(html, /font-size:32px/);
    assert.doesNotMatch(html, /Noto Serif SC/);
    assert.doesNotMatch(html, /ui-monospace/);
    assert.match(html, /clear:both;"><b style="color:#1a1714;">受众观点：<\/b>/);
    assert.doesNotMatch(html, /grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
    assert.match(html, /display:flex;flex-direction:column;gap:18px/);
    assert.doesNotMatch(
      html,
      /<div style="min-width:0;[^"]*border-left:3px solid #cc2b1f/
    );
    assert.match(html, /№1/);
    assert.match(html, /№2/);
    assert.match(html, /№3/);
    assert.match(html, /<h2 style="[^"]*border-left[^>]*>行业热点<\/h2>/);
    assert.match(html, /<p style="[^"]*line-height/);
    assert.match(draftBody, /^<section\b/);
    assert.doesNotMatch(draftBody, /^<main\b/);
    assert.doesNotMatch(draftBody, /src="2026-05-31-cta\.png"/);
    assert.equal(draftManifest.date, "2026-05-31");
    assert.equal(draftManifest.author, "十四行手稿");
    assert.equal(draftManifest.collection, "IT-Hotspot");
    assert.equal(draftManifest.ctaImageSrc, "2026-05-31-cta.png");
    assert.equal(
      draftManifest.sourceNotice,
      "素材来源官方媒体/网络新闻，文中事件发生于2026年5月30日"
    );
    assert.equal(
      draftManifest.originalUrl,
      "https://hotspot.octohirono.dev/archive/2026-05-31-hotspot.html"
    );
    assert.equal(draftManifest.coverTarget.width, 1187);
    assert.equal(draftManifest.coverTarget.height, 507);

    const png = readFileSync(ctaPath);
    assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("wechat build defaults to the latest published issue when date is omitted", async () => {
  const workspace = makeWorkspace();

  try {
    const outputDir = path.join(workspace, "articles");
    const result = spawnSync(process.execPath, [generatorScript, "--root", workspace, "--output", outputDir, "--skip-cover"], {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, WECHAT_TITLE_MOCK: "1" },
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const latestIssue = listIssueFiles(path.join(workspace, "archive"))[0];
    const latestDate = latestIssue.replace("-hotspot.html", "");
    assert.equal(
      existsSync(
        path.join(workspace, "articles", `${latestDate}-daily-hotspots.md`)
      ),
      false
    );
    assert.equal(
      existsSync(
        path.join(workspace, "articles", latestDate, "daily-hotspots.md")
      ),
      true
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("wechat publish payload follows the draft publishing rules", () => {
  const articleDir = path.join(repoRoot, "articles", "2026-07-11");
  const payload = buildPublishPayload(articleDir);

  assert.match(payload.title, /^【7月11日】热点早报 \| /);
  assert.match(payload.sectionHtml, /^<section\b/);
  assert.doesNotMatch(payload.sectionHtml, /^<main\b/);
  assert.match(payload.sectionHtml, /src="2026-07-11-cta\.png"/);
  assert.doesNotMatch(payload.pasteHtml, /src="2026-07-11-cta\.png"/);
  assert.equal(payload.ctaImageSrc, "2026-07-11-cta.png");
  assert.equal(payload.author, "十四行手稿");
  assert.equal(
    payload.sourceNotice,
    "素材来源官方媒体/网络新闻，文中事件发生于2026年7月10日"
  );
  assert.equal(payload.collection, "IT-Hotspot");
  assert.equal(
    payload.originalUrl,
    "https://hotspot.octohirono.dev/archive/2026-07-11-hotspot.html"
  );
  assert.equal(
    payload.coverSourceUrl,
    "https://hotspot.octohirono.dev/archive/2026-07-11-hotspot.html"
  );
  assert.equal(payload.coverTarget.width, 1187);
  assert.equal(payload.coverTarget.height, 507);
  assert.equal(payload.coverTarget.aspectRatio, 1187 / 507);
  assert.equal(payload.coverCaptureRule.startAnchor, "masthead-double-rule");
  assert.equal(payload.coverCaptureRule.endAnchor, "before-top3");
  assert.equal(payload.coverCaptureRule.viewport.minWidth, 1600);
  assert.equal(payload.coverCaptureRule.viewport.minHeight, 900);
  assert.equal(
    payload.coverOutputPath,
    path.join(articleDir, "2026-07-11-cover.png")
  );
  assert.equal(
    payload.ctaImagePath,
    path.join(articleDir, "2026-07-11-cta.png")
  );
});

test("cover capture plan preserves the full hero area above 今日焦点 at cover ratio", () => {
  const plan = computeCoverCapturePlan({
    viewport: { width: 1600, height: 900 },
    wrapRect: { x: 200, y: 0, width: 1200, height: 2557.7265625 },
    mastheadRect: { x: 224, y: 24, width: 1152, height: 103, bottom: 127 },
    top3Rect: { x: 224, y: 650.9765625, width: 1152, height: 326.25, bottom: 977.2265625 },
    outputSize: { width: 1187, height: 507 },
  });

  assert.equal(plan.aspectRatio, 1187 / 507);
  assert.deepEqual(plan.sourceCrop, { x: 66, y: 24, width: 1468, height: 627 });
  assert.equal(plan.viewport.width, 1600);
  assert.equal(plan.viewport.height, 900);
  assert.equal(plan.outputSize.width, 1187);
  assert.equal(plan.outputSize.height, 507);
});

test("wechat today headline follows the issue hero instead of first focus item", async () => {
  const workspace = makeWorkspace();

  try {
    const result = runGenerator(workspace, "2026-06-06");
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const markdown = readFileSync(
      path.join(workspace, "articles", "2026-06-06", "daily-hotspots.md"),
      "utf8"
    );
    const headlineBlock = sectionBody(markdown, "今日头条");

    assert.match(
      headlineBlock,
      /OpenAI 承认出现技术问题导致部分用户账号被误封/
    );
    assert.doesNotMatch(headlineBlock, /Changing how we develop Ladybird/);
    assert.doesNotMatch(headlineBlock, /某自由软件项目因担心 AI 滥用/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("wechat audience viewpoints remove direct user handles", async () => {
  const workspace = makeWorkspace();

  try {
    const result = runGenerator(workspace, "2026-05-17");
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const markdown = readFileSync(
      path.join(workspace, "articles", "2026-05-17", "daily-hotspots.md"),
      "utf8"
    );
    const audienceLines = markdown
      .split("\n")
      .filter((line) => line.startsWith("受众观点："));

    assert.ok(audienceLines.length > 0, "should render audience viewpoints");
    for (const line of audienceLines) {
      assert.doesNotMatch(line, /@[A-Za-z0-9_-]+/);
      assert.doesNotMatch(line, /-Web7861/);
      assert.doesNotMatch(line, /（Maker）/);
    }
    assert.match(markdown, /数据：Twitter [^\n]+ · @/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("selectArticleItems keeps only one item per author within a section", () => {
  const issue = {
    todayHotspot: {
      summary: "头条内容",
      section: "今日头条",
      source: "Twitter L1 · @lead",
      url: "https://example.com/lead",
    },
    top3: [
      { summary: "焦点一", section: "HN H1", source: "HN H1", url: "https://example.com/t1" },
      { summary: "焦点二", section: "HN H2", source: "HN H2", url: "https://example.com/t2" },
      { summary: "焦点三", section: "HN H3", source: "HN H3", url: "https://example.com/t3" },
    ],
    articleItems: [
      {
        summary: "同作者第一条",
        category: "行业热点",
        section: "Twitter L3 · @dupauthor",
        source: "Twitter L3 · @dupauthor",
        url: "https://example.com/a1",
      },
      {
        summary: "同作者第二条",
        category: "行业热点",
        section: "Twitter L4 · @dupauthor",
        source: "Twitter L4 · @dupauthor",
        url: "https://example.com/a2",
      },
      {
        summary: "另一个作者",
        category: "行业热点",
        section: "Twitter L5 · @otherauthor",
        source: "Twitter L5 · @otherauthor",
        url: "https://example.com/a3",
      },
    ],
  };

  const sections = selectArticleItems(issue);
  const industry = sections.get("行业热点") || [];
  const summaries = industry.map((item) => item.summary);

  assert.equal(industry.length, 2);
  assert.ok(summaries.includes("同作者第一条"));
  assert.ok(!summaries.includes("同作者第二条"));
  assert.ok(summaries.includes("另一个作者"));
});

test("wechat sidecar outputs have a local package script and per-run output is ignored by git", () => {
  const packageJson = JSON.parse(
    readFileSync(path.join(repoRoot, "package.json"), "utf8")
  );
  const gitignore = readFileSync(path.join(publishRoot, ".gitignore"), "utf8");

  assert.equal(
    packageJson.scripts.build,
    "node scripts/generate-wechat.mjs"
  );
  // The wechat tooling (scripts/tests/docs) is tracked so other machines can run
  // it, but the per-run output under wechat/articles/ stays ignored.
  assert.match(gitignore, /^wechat\/articles\/$/m);
  assert.doesNotMatch(gitignore, /^wechat\/$/m);
});
