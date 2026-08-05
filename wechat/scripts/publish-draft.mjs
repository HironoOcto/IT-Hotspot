#!/usr/bin/env node

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const API_ROOT = "https://api.weixin.qq.com";
const DEFAULT_COMMENT_SETTINGS = {
  need_open_comment: 1,
  only_fans_can_comment: 0,
};
const MAX_THUMB_BYTES = 64 * 1024;
const THUMB_QUALITIES = [80, 70, 60, 50, 40, 30, 20];

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const wechatRoot = path.resolve(scriptDir, "..");
const defaultCredentialsPath = path.join(wechatRoot, "wechat-credentials.txt");
const legacyCredentialsPath = path.join(wechatRoot, "tmp.txt");
const defaultArticlesRoot = path.join(wechatRoot, "articles");

function parseArgs(argv) {
  const args = {
    articleDir: "",
    articlesRoot: defaultArticlesRoot,
    credentials: "",
    date: "",
    submit: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--date") {
      args.date = argv[++i];
    } else if (arg === "--article-dir") {
      args.articleDir = path.resolve(argv[++i]);
    } else if (arg === "--articles-root") {
      args.articlesRoot = path.resolve(argv[++i]);
    } else if (arg === "--credentials") {
      args.credentials = path.resolve(argv[++i]);
    } else if (arg === "--submit") {
      args.submit = true;
    }
  }

  return args;
}

function parseCredentialFile(filePath) {
  if (!existsSync(filePath)) {
    throw new Error(`Missing credential file: ${filePath}`);
  }

  const fields = {};
  for (const rawLine of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const separator = line.includes("=") ? "=" : line.includes(":") ? ":" : "";
    if (!separator) continue;

    const [rawKey, ...rest] = line.split(separator);
    fields[rawKey.trim()] = rest.join(separator).trim();
  }

  const appId = fields.AppID || fields.appid || fields.appId;
  const appSecret = fields.AppSecret || fields.appsecret || fields.appSecret;
  if (!appId || !appSecret) {
    throw new Error(`Credential file must contain AppID and AppSecret: ${filePath}`);
  }

  return { appId, appSecret };
}

// Resolve WeChat credentials, in priority order:
//   1. explicit --credentials <path>
//   2. WECHAT_APP_ID + WECHAT_APP_SECRET env vars (best for other machines / CI —
//      no secret file on disk)
//   3. default credential file wechat/wechat-credentials.txt (or legacy tmp.txt)
// All three keep the secret out of git; see .gitignore.
function resolveCredentials({ credentialsPath = "", env = process.env } = {}) {
  if (credentialsPath) return parseCredentialFile(credentialsPath);

  if (env.WECHAT_APP_ID && env.WECHAT_APP_SECRET) {
    return { appId: env.WECHAT_APP_ID, appSecret: env.WECHAT_APP_SECRET };
  }

  if (existsSync(defaultCredentialsPath)) return parseCredentialFile(defaultCredentialsPath);
  if (existsSync(legacyCredentialsPath)) return parseCredentialFile(legacyCredentialsPath);

  throw new Error(
    `No WeChat credentials found. Provide them one of these ways:\n` +
      `  - set WECHAT_APP_ID and WECHAT_APP_SECRET env vars, or\n` +
      `  - create ${defaultCredentialsPath} with lines "AppID=..." and "AppSecret=...", or\n` +
      `  - pass --credentials <path>.`
  );
}

function resolveArticleDir({ articleDir, articlesRoot, date }) {
  if (articleDir) return articleDir;
  if (date) return path.join(articlesRoot, date);

  const latest = readdirSync(articlesRoot)
    .filter((entry) => /^\d{4}-\d{2}-\d{2}$/.test(entry))
    .sort((left, right) => right.localeCompare(left))[0];
  if (!latest) {
    throw new Error(`No generated article directories found in ${articlesRoot}`);
  }
  return path.join(articlesRoot, latest);
}

function loadDraftArtifacts(articleDir) {
  const manifestPath = path.join(articleDir, "draft-manifest.json");
  const bodyPath = path.join(articleDir, "draft-body.html");

  if (!existsSync(manifestPath)) {
    throw new Error(`Missing draft manifest: ${manifestPath}`);
  }
  if (!existsSync(bodyPath)) {
    throw new Error(`Missing draft body: ${bodyPath}`);
  }

  return {
    manifest: JSON.parse(readFileSync(manifestPath, "utf8")),
    bodyHtml: readFileSync(bodyPath, "utf8"),
  };
}

function collectLocalImageSources(html) {
  const seen = new Set();
  const images = [];

  for (const match of html.matchAll(/<img\b[^>]*src="([^"]+)"[^>]*>/gi)) {
    const src = match[1].trim();
    if (!src || /^https?:\/\//i.test(src) || /^data:/i.test(src)) continue;
    if (seen.has(src)) continue;
    seen.add(src);
    images.push(src);
  }

  return images;
}

function replaceImageSources(html, uploadedBySource) {
  return html.replace(/(<img\b[^>]*src=")([^"]+)("[^>]*>)/gi, (full, start, src, end) => {
    const uploaded = uploadedBySource.get(src);
    return uploaded ? `${start}${uploaded}${end}` : full;
  });
}

function planThumbAsset(coverPath) {
  const ext = path.extname(coverPath).toLowerCase();
  const needsConversion = ext !== ".jpg" && ext !== ".jpeg";
  const uploadPath = needsConversion
    ? path.join(path.dirname(coverPath), `${path.basename(coverPath, ext)}-thumb.jpg`)
    : coverPath;

  return {
    sourcePath: coverPath,
    uploadPath,
    needsConversion,
  };
}

function mimeTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  return "application/octet-stream";
}

function buildDraftArticle({ manifest, contentHtml, thumbMediaId }) {
  return {
    title: manifest.title,
    author: manifest.author,
    digest: manifest.sourceNotice,
    content: contentHtml,
    content_source_url: manifest.originalUrl,
    thumb_media_id: thumbMediaId,
    ...DEFAULT_COMMENT_SETTINGS,
  };
}

async function requestStableAccessToken({ appId, appSecret }) {
  const response = await fetch(`${API_ROOT}/cgi-bin/stable_token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credential",
      appid: appId,
      secret: appSecret,
      force_refresh: false,
    }),
  });

  const payload = await response.json();
  ensureWeChatSuccess(payload, "request stable access token");
  if (!payload.access_token) {
    throw new Error("Stable token response did not include access_token");
  }
  return payload.access_token;
}

async function uploadInlineImage(accessToken, filePath) {
  const form = new FormData();
  const buffer = readFileSync(filePath);
  form.append("media", new Blob([buffer], { type: mimeTypeFor(filePath) }), path.basename(filePath));

  const response = await fetch(
    `${API_ROOT}/cgi-bin/media/uploadimg?access_token=${encodeURIComponent(accessToken)}`,
    { method: "POST", body: form }
  );
  const payload = await response.json();
  ensureWeChatSuccess(payload, `upload inline image ${path.basename(filePath)}`);
  if (!payload.url) {
    throw new Error(`Inline image upload did not return url for ${filePath}`);
  }
  return payload.url;
}

async function uploadThumbMaterial(accessToken, filePath) {
  const form = new FormData();
  const buffer = readFileSync(filePath);
  form.append("media", new Blob([buffer], { type: mimeTypeFor(filePath) }), path.basename(filePath));

  const response = await fetch(
    `${API_ROOT}/cgi-bin/material/add_material?access_token=${encodeURIComponent(
      accessToken
    )}&type=thumb`,
    { method: "POST", body: form }
  );
  const payload = await response.json();
  ensureWeChatSuccess(payload, `upload cover thumb ${path.basename(filePath)}`);
  if (!payload.media_id) {
    throw new Error(`Thumb upload did not return media_id for ${filePath}`);
  }
  return payload.media_id;
}

async function createDraft(accessToken, article) {
  const response = await fetch(
    `${API_ROOT}/cgi-bin/draft/add?access_token=${encodeURIComponent(accessToken)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ articles: [article] }),
    }
  );

  const payload = await response.json();
  ensureWeChatSuccess(payload, "create draft");
  if (!payload.media_id) {
    throw new Error("Draft creation did not return media_id");
  }
  return payload;
}

async function submitDraft(accessToken, mediaId) {
  const response = await fetch(
    `${API_ROOT}/cgi-bin/freepublish/submit?access_token=${encodeURIComponent(accessToken)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ media_id: mediaId }),
    }
  );
  const payload = await response.json();
  ensureWeChatSuccess(payload, "submit draft for publish");
  return payload;
}

function ensureWeChatSuccess(payload, action) {
  if (payload && typeof payload.errcode !== "undefined" && payload.errcode !== 0) {
    const base = `${action} failed: ${payload.errcode} ${payload.errmsg || ""}`.trim();
    if (payload.errcode === 40164) {
      throw new Error(`${base}. 请到公众号后台 -> 设置与开发 -> 开发接口管理，将当前出口 IP 加入白名单。`);
    }
    throw new Error(base);
  }
}

function ensureThumbUploadFile(plan) {
  if (!existsSync(plan.sourcePath)) {
    throw new Error(`Missing cover file: ${plan.sourcePath}`);
  }

  if (!plan.needsConversion && statSync(plan.sourcePath).size <= MAX_THUMB_BYTES) {
    return plan.sourcePath;
  }

  const sipsCheck = spawnSync("which", ["sips"], { encoding: "utf8" });
  if (sipsCheck.status !== 0) {
    throw new Error(
      "Cover thumb conversion requires macOS `sips`, or provide a JPG cover under 64KB."
    );
  }

  mkdirSync(path.dirname(plan.uploadPath), { recursive: true });
  for (const quality of THUMB_QUALITIES) {
    const result = spawnSync(
      "sips",
      [
        "-s",
        "format",
        "jpeg",
        "--setProperty",
        "formatOptions",
        String(quality),
        plan.sourcePath,
        "--out",
        plan.uploadPath,
      ],
      { encoding: "utf8" }
    );
    if (result.status !== 0) {
      throw new Error(result.stderr.trim() || `sips failed converting ${plan.sourcePath}`);
    }
    if (statSync(plan.uploadPath).size <= MAX_THUMB_BYTES) {
      return plan.uploadPath;
    }
  }

  throw new Error(
    `Could not compress cover thumb under ${MAX_THUMB_BYTES} bytes: ${plan.sourcePath}`
  );
}

async function publishDraft({ articleDir, credentialsPath, submit = false, env = process.env }) {
  const { appId, appSecret } = resolveCredentials({ credentialsPath, env });
  const { manifest, bodyHtml } = loadDraftArtifacts(articleDir);
  const sourceHtml = manifest.sectionHtml || bodyHtml;
  const accessToken = await requestStableAccessToken({ appId, appSecret });

  const uploadedBySource = new Map();
  for (const src of collectLocalImageSources(sourceHtml)) {
    const assetPath = path.join(articleDir, src);
    if (!existsSync(assetPath)) {
      throw new Error(`Missing local draft image: ${assetPath}`);
    }
    uploadedBySource.set(src, await uploadInlineImage(accessToken, assetPath));
  }

  const thumbPlan = planThumbAsset(manifest.coverOutputPath);
  let thumbUploadPath = "";
  try {
    thumbUploadPath = ensureThumbUploadFile(thumbPlan);
    const thumbMediaId = await uploadThumbMaterial(accessToken, thumbUploadPath);
    const contentHtml = replaceImageSources(sourceHtml, uploadedBySource);
    const article = buildDraftArticle({
      manifest,
      contentHtml,
      thumbMediaId,
    });
    const draftResult = await createDraft(accessToken, article);
    const submitResult = submit ? await submitDraft(accessToken, draftResult.media_id) : null;

    return {
      articleDir,
      date: manifest.date,
      mediaId: draftResult.media_id,
      publishId: submitResult?.publish_id ?? null,
      inlineImages: Object.fromEntries(uploadedBySource),
      unsupportedMetadata: {
        collection: manifest.collection,
        sourceNoticeUsedAsDigest: manifest.sourceNotice,
      },
    };
  } finally {
    if (
      thumbUploadPath &&
      thumbUploadPath !== thumbPlan.sourcePath &&
      existsSync(thumbUploadPath)
    ) {
      rmSync(thumbUploadPath, { force: true });
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const articleDir = resolveArticleDir(args);
    const result = await publishDraft({
      articleDir,
      credentialsPath: args.credentials,
      submit: args.submit,
    });

    console.log(
      JSON.stringify(
        {
          ok: true,
          date: result.date,
          articleDir: result.articleDir,
          mediaId: result.mediaId,
          publishId: result.publishId,
          inlineImages: result.inlineImages,
          note:
            "公众号开放接口未暴露独立的合集字段；sourceNotice 当前写入 digest 以保留来源说明。",
        },
        null,
        2
      )
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

export {
  buildDraftArticle,
  collectLocalImageSources,
  ensureWeChatSuccess,
  parseCredentialFile,
  resolveCredentials,
  planThumbAsset,
  publishDraft,
  replaceImageSources,
};
