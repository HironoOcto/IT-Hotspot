import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildDraftArticle,
  collectLocalImageSources,
  ensureWeChatSuccess,
  parseCredentialFile,
  planThumbAsset,
  replaceImageSources,
} from "../scripts/publish-draft.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("parseCredentialFile reads AppID and AppSecret from tmp.txt style content", async () => {
  const workspace = mkdtempSync(path.join(tmpdir(), "wechat-credentials-"));
  const filePath = path.join(workspace, "tmp.txt");
  writeFileSync(
    filePath,
    ["AppSecret=secret-value-1234567890", "AppID=wx1234567890abcdef", ""].join("\n")
  );

  try {
    assert.deepEqual(parseCredentialFile(filePath), {
      appId: "wx1234567890abcdef",
      appSecret: "secret-value-1234567890",
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("collectLocalImageSources returns local article assets in the draft body", () => {
  const articleDir = path.join(repoRoot, "articles", "2026-07-11");
  const manifest = JSON.parse(
    readFileSync(path.join(articleDir, "draft-manifest.json"), "utf8")
  );

  assert.deepEqual(collectLocalImageSources(manifest.sectionHtml), ["2026-07-11-cta.png"]);
});

test("replaceImageSources swaps local assets for uploaded material urls", () => {
  const input =
    '<section><p><img alt="CTA" src="2026-07-11-cta.png" /></p><p>unchanged</p></section>';

  const output = replaceImageSources(input, new Map([[
    "2026-07-11-cta.png",
    "https://mmbiz.qpic.cn/mock/cta.png",
  ]]));

  assert.match(output, /https:\/\/mmbiz\.qpic\.cn\/mock\/cta\.png/);
  assert.doesNotMatch(output, /src="2026-07-11-cta\.png"/);
  assert.match(output, /<p>unchanged<\/p>/);
});

test("planThumbAsset prepares a jpg thumb target for WeChat cover upload", () => {
  const articleDir = path.join(repoRoot, "articles", "2026-07-11");
  const manifest = JSON.parse(
    readFileSync(path.join(articleDir, "draft-manifest.json"), "utf8")
  );

  const plan = planThumbAsset(manifest.coverOutputPath);

  assert.equal(plan.sourcePath, manifest.coverOutputPath);
  assert.equal(plan.needsConversion, true);
  assert.match(plan.uploadPath, /2026-07-11-cover-thumb\.jpg$/);
});

test("buildDraftArticle assembles the draft/add payload from generated artifacts", () => {
  const articleDir = path.join(repoRoot, "articles", "2026-07-11");
  const manifest = JSON.parse(
    readFileSync(path.join(articleDir, "draft-manifest.json"), "utf8")
  );

  const article = buildDraftArticle({
    manifest,
    contentHtml: replaceImageSources(
      manifest.sectionHtml,
      new Map([["2026-07-11-cta.png", "https://mmbiz.qpic.cn/mock/cta.png"]])
    ),
    thumbMediaId: "thumb-media-id-123",
  });

  assert.equal(article.title, manifest.title);
  assert.match(article.title, /^【7月11日】热点早报 \| /);
  assert.equal(article.author, manifest.author);
  assert.equal(article.content_source_url, manifest.originalUrl);
  assert.equal(article.thumb_media_id, "thumb-media-id-123");
  assert.match(article.content, /https:\/\/mmbiz\.qpic\.cn\/mock\/cta\.png/);
  assert.equal(article.need_open_comment, 1);
  assert.equal(article.only_fans_can_comment, 0);
});

test("package.json exposes a publish:draft command", () => {
  const packageJson = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));

  assert.equal(packageJson.scripts["publish:draft"], "node scripts/publish-draft.mjs");
});

test("ensureWeChatSuccess surfaces whitelist guidance for invalid IP errors", () => {
  assert.throws(
    () =>
      ensureWeChatSuccess(
        {
          errcode: 40164,
          errmsg: "invalid ip 111.207.162.130 ipv6 ::ffff:111.207.162.130",
        },
        "request stable access token"
      ),
    /IP 白名单|111\.207\.162\.130/
  );
});
