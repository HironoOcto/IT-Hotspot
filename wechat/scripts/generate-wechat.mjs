#!/usr/bin/env node

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import QRCode from "qrcode";
import { generateTitlePackage } from "./generate-title.mjs";
import { captureWechatCover, computeCoverCapturePlan } from "./capture-cover.mjs";

const SITE_URL = "https://hotspot.octohirono.dev";
const ISSUE_FILE_RE = /^(\d{4}-\d{2}-\d{2})-hotspot\.html$/;
const TOP_STORY_COUNT = 1;
const FOCUS_ITEM_LIMIT = 3;
const INDUSTRY_ITEM_LIMIT = 6;
const OPTIONAL_ITEM_LIMIT = 3;
const HOTSPOT_RED = "#cc2b1f";
const WECHAT_COVER_OUTPUT = { width: 1187, height: 507 };
const WECHAT_COVER_VIEWPORT = { width: 1600, height: 900 };
const WECHAT_COVER_START_ANCHOR = "masthead-double-rule";
const WECHAT_COVER_END_ANCHOR = "before-top3";

const wechatRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publishRoot = path.resolve(wechatRoot, "..");

function parseArgs(argv) {
  const args = { root: publishRoot, output: path.join(wechatRoot, "articles"), date: "" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--root") {
      args.root = path.resolve(argv[++i]);
    } else if (arg === "--output") {
      args.output = path.resolve(argv[++i]);
    } else if (arg === "--date") {
      args.date = argv[++i];
    } else if (arg === "--skip-cover") {
      args.skipCover = true;
    } else if (!arg.startsWith("--") && !args.date) {
      args.date = arg;
    }
  }
  return args;
}

function listIssueFiles(archiveDir) {
  return readdirSync(archiveDir)
    .filter((fileName) => ISSUE_FILE_RE.test(fileName))
    .sort((left, right) => right.localeCompare(left));
}

function resolveIssue(rootDir, date) {
  const archiveDir = path.join(rootDir, "archive");
  if (!existsSync(archiveDir)) {
    throw new Error(`Missing archive directory: ${archiveDir}`);
  }

  const fileName = date ? `${date}-hotspot.html` : listIssueFiles(archiveDir)[0];
  if (!fileName || !ISSUE_FILE_RE.test(fileName)) {
    throw new Error("No published issue found in archive/");
  }

  const filePath = path.join(archiveDir, fileName);
  if (!existsSync(filePath)) {
    throw new Error(`Published issue not found: ${filePath}`);
  }

  return {
    date: fileName.match(ISSUE_FILE_RE)[1],
    fileName,
    filePath,
  };
}

function decodeHtml(value = "") {
  const named = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };
  let decoded = value;
  for (let i = 0; i < 2; i += 1) {
    decoded = decoded
      .replace(/&#x([0-9a-f]+);/gi, (_, hex) =>
        String.fromCodePoint(Number.parseInt(hex, 16))
      )
      .replace(/&#(\d+);/g, (_, decimal) =>
        String.fromCodePoint(Number.parseInt(decimal, 10))
      )
      .replace(/&([a-z]+);/gi, (match, name) => named[name] ?? match);
  }
  return decoded;
}

function stripTags(value = "") {
  return decodeHtml(
    value
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]{2,}/g, " ")
      .trim()
  );
}

function firstMatch(html, regex) {
  const match = html.match(regex);
  return match ? stripTags(match[1]) : "";
}

function normalizeText(value = "") {
  return stripTags(value)
    .toLowerCase()
    .replace(/[“”"'.。！？!?，,、：:；;（）()[\]【】《》<>]/g, "")
    .replace(/\s+/g, "");
}

function shortTitle(summary) {
  const clean = summary
    .replace(/^这条\s*/, "")
    .replace(/^一篇关于\s*/, "")
    .replace(/^作者\s*/, "")
    .replace(/^推文\s*/, "")
    .trim();
  return clean.length > 32 ? `${clean.slice(0, 32)}...` : clean;
}

function metricText(block) {
  const top3Metric = firstMatch(block, /<div class="top3-row">[\s\S]*?<b>([\s\S]*?)<\/b>/);
  if (top3Metric) return top3Metric;

  const metricMatch = block.match(
    /<div class="flex gap-2 items-center"[^>]*>\s*<span>([\s\S]*?)<\/span>/
  );
  return metricMatch ? stripTags(metricMatch[1]) : "";
}

function parseTop3(html) {
  const cells = [...html.matchAll(/<a class="top3-cell" href="([^"]*)"[\s\S]*?<\/a>/g)];
  return cells
    .map((match) => {
      const block = match[0];
      return {
        url: decodeHtml(match[1]),
        section: "今日焦点",
        source: firstMatch(block, /<div class="top3-kicker">([\s\S]*?)<\/div>/),
        metric: metricText(block),
        summary: firstMatch(block, /<h3 class="top3-title">([\s\S]*?)<\/h3>/),
        excerpt: "",
        audience: firstMatch(block, /<p class="top3-focus">([\s\S]*?)<\/p>/),
      };
    })
    .filter((item) => item.summary);
}

function extractArticleBlocks(html) {
  const blocks = [];
  let cursor = 0;
  const startNeedle = '<div class="article">';

  while (true) {
    const start = html.indexOf(startNeedle, cursor);
    if (start === -1) break;

    const block = extractDivBlock(html, start);
    if (!block) break;
    blocks.push(block);
    cursor = start + block.length;
  }

  return blocks;
}

function extractDivBlock(html, start) {
  let depth = 0;
  const tagRe = /<\/?div\b[^>]*>/gi;
  tagRe.lastIndex = start;
  for (let match = tagRe.exec(html); match; match = tagRe.exec(html)) {
    if (match[0].startsWith("</")) {
      depth -= 1;
      if (depth === 0) {
        return html.slice(start, tagRe.lastIndex);
      }
    } else {
      depth += 1;
    }
  }
  return "";
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function subtractOneDay(dateString) {
  const [year, month, day] = dateString.split("-").map(Number);
  const utcValue = Date.UTC(year, month - 1, day);
  const previous = new Date(utcValue - 24 * 60 * 60 * 1000);
  return [
    previous.getUTCFullYear(),
    String(previous.getUTCMonth() + 1).padStart(2, "0"),
    String(previous.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function formatChineseDate(dateString) {
  const [year, month, day] = dateString.split("-").map(Number);
  return `${year}年${month}月${day}日`;
}

function formatWechatArticleTitle(dateString, baseTitle) {
  const [, month, day] = dateString.split("-").map(Number);
  return `【${month}月${String(day).padStart(2, "0")}日】热点早报 | ${baseTitle}`;
}

function extractTabLabels(html) {
  return [...html.matchAll(/<button class="tab-btn[^"]*" data-tab="([^"]+)"[^>]*>([\s\S]*?)<\/button>/g)]
    .map((match) => ({
      tabId: decodeHtml(match[1]),
      label: stripTags(match[2]),
    }))
    .filter((tab) => tab.tabId && tab.label);
}

function extractArticleBlocksBySection(html) {
  const tabs = extractTabLabels(html);
  const grouped = [];

  for (const tab of tabs) {
    const panelRe = new RegExp(
      `<div class="tab-panel[^"]*" data-tab-panel="${escapeRegExp(tab.tabId)}"[^>]*>`,
      "i"
    );
    const panelMatch = panelRe.exec(html);
    if (!panelMatch) continue;

    const panelBlock = extractDivBlock(html, panelMatch.index);
    for (const block of extractArticleBlocks(panelBlock)) {
      grouped.push({ block, category: tab.label });
    }
  }

  if (grouped.length) return grouped;
  return extractArticleBlocks(html).map((block) => ({ block, category: "" }));
}

function parseArticleItems(html) {
  return extractArticleBlocksBySection(html)
    .map(({ block, category }) => {
      const urlMatch = block.match(/<h3 class="art-title">[\s\S]*?<a[^>]*href="([^"]*)"[\s\S]*?<\/a>/);
      const titleMatch = block.match(/<h3 class="art-title">([\s\S]*?)<\/h3>/);
      const section = firstMatch(block, /<span class="art-src[^"]*">([\s\S]*?)<\/span>/);
      return {
        url: urlMatch ? decodeHtml(urlMatch[1]) : "",
        category,
        section,
        source: section,
        metric: metricText(block),
        summary: titleMatch ? stripTags(titleMatch[1]) : "",
        excerpt: firstMatch(block, /<p class="art-summary">([\s\S]*?)<\/p>/),
        audience: firstMatch(block, /<p class="art-focus">[\s\S]*?<b>受众观点：<\/b>([\s\S]*?)<\/p>/),
      };
    })
    .filter((item) => item.summary);
}

function parseIssue(html, date, fileName) {
  const scanTotal = firstMatch(html, /<span><b>(\d+)<\/b> 条扫描<\/span>/);
  const validTotal = firstMatch(html, /<span><b>(\d+)<\/b> 条有效<\/span>/);
  const heroHeadline = firstMatch(html, /<h1 class="hero-headline">([\s\S]*?)<\/h1>/);
  const heroDeck = firstMatch(html, /<p class="hero-deck">([\s\S]*?)<\/p>/);
  const top3 = parseTop3(html);
  const articleItems = parseArticleItems(html);
  const byUrl = new Map(articleItems.filter((item) => item.url).map((item) => [item.url, item]));
  const bySummary = new Map(
    articleItems.map((item) => [normalizeText(item.summary).slice(0, 90), item])
  );

  const firstTop = top3[0] ?? {};
  const heroKey = normalizeText(heroHeadline).slice(0, 90);
  const heroTop =
    (heroKey &&
      top3.find((item) => normalizeText(item.summary).slice(0, 90) === heroKey)) ||
    {};
  const heroSource = heroTop.summary ? heroTop : firstTop;
  const matchedHero =
    (heroKey && bySummary.get(heroKey)) ||
    (heroSource.url && byUrl.get(heroSource.url)) ||
    {};
  const todayHotspot = {
    ...heroSource,
    ...matchedHero,
    section: "今日头条",
    summary: heroHeadline || matchedHero.summary || heroSource.summary,
    excerpt: matchedHero.excerpt || heroDeck,
    audience: matchedHero.audience || heroSource.audience,
    metric: matchedHero.metric || heroSource.metric,
    url: matchedHero.url || heroSource.url || "",
  };

  return {
    date,
    fileName,
    scanTotal,
    validTotal,
    issueUrl: `${SITE_URL}/archive/${fileName}`,
    todayHotspot,
    top3,
    articleItems,
  };
}

function dedupeKey(item) {
  if (item.url) return `url:${item.url}`;
  return `text:${normalizeText(item.summary).slice(0, 120)}`;
}

function enrichFromArticles(item, articleItems) {
  const key = item.url ? null : normalizeText(item.summary).slice(0, 90);
  const match =
    (item.url && articleItems.find((candidate) => candidate.url === item.url)) ||
    (key && articleItems.find((candidate) => normalizeText(candidate.summary).startsWith(key)));
  return match ? { ...item, ...match, section: item.section } : item;
}

function isIndustryItem(item) {
  if (item.category) return item.category === "行业热点";
  return /Twitter L\d|Hacker News|HN|AI\/ML|IndieDev/i.test(item.section);
}

function sectionLabel(item) {
  if (item.category === "新品产品 Top") return "新品 Top";
  if (item.category && item.category !== "跨平台热点") return item.category;
  if (/Playbooks|Twitter Account/i.test(item.section)) return "实战打法";
  if (/Twitter Search/i.test(item.section)) return "话题追踪";
  if (/Reddit/i.test(item.section)) return "社区热议";
  if (/Product Hunt|PH/i.test(item.section)) return "新品 Top";
  return "行业热点";
}

function selectArticleItems(issue) {
  const used = new Set();
  const sections = new Map();
  const sectionLimits = new Map([
    ["今日头条", TOP_STORY_COUNT],
    ["今日焦点 TOP 3", FOCUS_ITEM_LIMIT],
    ["行业热点", INDUSTRY_ITEM_LIMIT],
    ["实战打法", OPTIONAL_ITEM_LIMIT],
    ["社区热议", OPTIONAL_ITEM_LIMIT],
    ["新品 Top", OPTIONAL_ITEM_LIMIT],
  ]);

  function addTo(label, rawItem) {
    const item = enrichFromArticles(rawItem, issue.articleItems);
    if (!item.summary) return false;
    if (item.category === "跨平台热点") return false;
    const limit = sectionLimits.get(label) ?? Number.POSITIVE_INFINITY;
    if ((sections.get(label) || []).length >= limit) return false;
    const key = dedupeKey(item);
    if (used.has(key)) return false;
    used.add(key);
    if (!sections.has(label)) sections.set(label, []);
    sections.get(label).push(item);
    return true;
  }

  function fillFromLabel(label) {
    for (const item of issue.articleItems) {
      if ((sections.get(label) || []).length >= (sectionLimits.get(label) ?? 0)) break;
      if (sectionLabel(item) === label) {
        addTo(label, item);
      }
    }
  }

  const articlePool = issue.articleItems.filter((item) => item.category !== "跨平台热点");

  addTo("今日头条", issue.todayHotspot);

  for (const item of issue.top3) {
    if ((sections.get("今日焦点 TOP 3") || []).length >= FOCUS_ITEM_LIMIT) break;
    addTo("今日焦点 TOP 3", item);
  }

  for (const item of articlePool) {
    if ((sections.get("今日焦点 TOP 3") || []).length >= FOCUS_ITEM_LIMIT) break;
    addTo("今日焦点 TOP 3", item);
  }

  for (const item of articlePool.filter(isIndustryItem)) {
    if ((sections.get("行业热点") || []).length >= INDUSTRY_ITEM_LIMIT) break;
    addTo("行业热点", item);
  }

  fillFromLabel("实战打法");
  fillFromLabel("社区热议");
  fillFromLabel("新品 Top");

  return sections;
}

function markdownEscape(value = "") {
  return value.replace(/\r/g, "").trim();
}

function stripAudienceAttribution(value = "") {
  return value
    .replace(/[（(][^）)]*@[^）)]*[）)]/g, "")
    .replace(/@[A-Za-z0-9_-]+(?:[（(][^）)]*[）)])?/g, "")
    .replace(/\s+([，。！？；：、])/g, "$1")
    .replace(/([①②③④⑤⑥⑦⑧⑨⑩])\s+/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function renderItemMarkdown(item, number) {
  const parts = [`### ${String(number).padStart(2, "0")}. ${markdownEscape(item.summary)}`];
  if (item.excerpt) {
    parts.push(`原文摘录：${markdownEscape(item.excerpt)}`);
  }
  if (item.audience) {
    parts.push(`受众观点：${markdownEscape(stripAudienceAttribution(item.audience))}`);
  }
  const data = [item.source, item.metric].filter(Boolean).join(" · ");
  if (data) {
    parts.push(`数据：${markdownEscape(data)}`);
  }
  return parts.join("\n\n");
}

function renderMarkdown(issue, sections, articleTitle = "") {
  const title = articleTitle || `每日热点｜${shortTitle(issue.todayHotspot.summary)}`;
  const lines = [`# ${title}`];
  let number = 1;

  for (const [label, items] of sections) {
    if (!items.length) continue;
    lines.push(`## ${label}`);
    for (const item of items) {
      lines.push(renderItemMarkdown(item, number));
      number += 1;
    }
  }

  const selectedCount = number - 1;
  lines.push("## 本期数据");
  const scanText = issue.scanTotal
    ? `本期 Hotspot 扫描 ${issue.scanTotal} 条英文社区动态，精选 ${selectedCount} 条重点热点。`
    : `Hotspot 本期精选 ${selectedCount} 条英文社区重点热点。`;
  lines.push(scanText);
  if (issue.validTotal) {
    lines.push(`其中 ${issue.validTotal} 条进入有效信号池，完整榜单保留原文链接与评论证据。`);
  }

  lines.push("## 完整热榜");
  lines.push(`完整榜单、原文链接和评论证据见文末「阅读原文」：${issue.issueUrl}`);
  lines.push(`![Hotspot 今日完整热榜](${issue.date}-cta.png)`);

  return `${lines.join("\n\n")}\n`;
}

function escapeHtml(value = "") {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const WECHAT_FONT_FAMILY =
  "-apple-system,BlinkMacSystemFont,'Helvetica Neue','PingFang SC','Microsoft YaHei',Arial,sans-serif";

const GENERIC_STYLES = {
  container:
    `max-width:680px;margin:0 auto;padding:24px 18px 36px;background:#fffdf8;color:#1a1714;font-family:${WECHAT_FONT_FAMILY};`,
  h1:
    "margin:0 0 26px;color:#1a1714;font-size:24px;line-height:1.35;font-weight:800;",
  h2:
    `margin:32px 0 16px;padding:0 0 0 12px;border-left:4px solid ${HOTSPOT_RED};color:#1a1714;font-size:18px;line-height:1.45;font-weight:700;`,
  h3:
    "margin:22px 0 10px;color:#1a1714;font-size:16px;line-height:1.65;font-weight:700;",
  p:
    "margin:9px 0;color:#3a332d;font-size:14px;line-height:1.85;",
  excerpt:
    "margin:9px 0;padding:10px 12px;background:#f7f4ec;color:#5f574f;font-size:13px;line-height:1.75;border-left:3px solid #e7ddd0;",
  audience:
    "margin:9px 0;color:#3a332d;font-size:14px;line-height:1.85;",
  metric:
    `margin:10px 0 18px;color:#6b6157;font-size:12px;line-height:1.7;font-family:${WECHAT_FONT_FAMILY};`,
  link:
    `color:${HOTSPOT_RED};word-break:break-all;text-decoration:none;`,
  imageWrap:
    "margin:18px 0;text-align:center;",
  image:
    "max-width:100%;height:auto;display:block;margin:0 auto;",
};

function styleAttr(name) {
  return ` style="${GENERIC_STYLES[name]}"`;
}

function renderParagraph(block) {
  const escaped = escapeHtml(block).replace(
    /(https:\/\/[^\s<]+)/g,
    `<a href="$1"${styleAttr("link")}>$1</a>`
  );
  const content = escaped.replace(/\n/g, "<br />");
  if (block.startsWith("原文摘录：")) {
    return `<p${styleAttr("excerpt")}>${content}</p>`;
  }
  if (block.startsWith("受众观点：")) {
    return `<p${styleAttr("audience")}>${content}</p>`;
  }
  if (block.startsWith("数据：")) {
    return `<p${styleAttr("metric")}>${content}</p>`;
  }
  return `<p${styleAttr("p")}>${content}</p>`;
}

function renderInlineMarkdown(markdown) {
  const blocks = markdown.trim().split(/\n{2,}/);
  return blocks
    .map((block) => {
      if (block.startsWith("# ")) {
        return `<h1${styleAttr("h1")}>${escapeHtml(block.slice(2))}</h1>`;
      }
      if (block.startsWith("## ")) {
        return `<h2${styleAttr("h2")}>${escapeHtml(block.slice(3))}</h2>`;
      }
      if (block.startsWith("### ")) {
        return `<h3${styleAttr("h3")}>${escapeHtml(block.slice(4))}</h3>`;
      }
      const image = block.match(/^!\[([^\]]*)]\(([^)]+)\)$/);
      if (image) {
        return `<p${styleAttr("imageWrap")}><img alt="${escapeHtml(image[1])}" src="${escapeHtml(image[2])}"${styleAttr("image")} /></p>`;
      }
      return renderParagraph(block);
    })
    .join("\n");
}

function renderLeadDeck(item) {
  const excerpt = item.excerpt || "";
  const audience = stripAudienceAttribution(item.audience || "");
  const parts = [];

  if (excerpt) {
    const [first = "", ...rest] = [...excerpt];
    parts.push(`<p style="font-family:${WECHAT_FONT_FAMILY};font-size:15px;line-height:1.85;color:#3a332d;margin:0;"><span style="font-size:42px;font-weight:900;float:left;line-height:.9;padding:5px 8px 0 0;color:${HOTSPOT_RED};">${escapeHtml(first)}</span>${escapeHtml(rest.join(""))}</p>`);
  }

  if (audience) {
    parts.push(`<p style="font-size:14px;color:#3a332d;margin:14px 0 0;line-height:1.85;clear:both;"><b style="color:#1a1714;">受众观点：</b>${escapeHtml(audience)}</p>`);
  }

  return parts.join("\n");
}

function renderHeroSection(item) {
  if (!item) return "";
  return `<section style="padding:28px 0;border-bottom:2px solid #1a1714;">
<div style="font-family:${WECHAT_FONT_FAMILY};font-size:13px;letter-spacing:.2em;color:#6b6157;margin-bottom:12px;">⚡ 24 小时扫盘速读</div>
<div style="font-family:${WECHAT_FONT_FAMILY};font-size:10px;letter-spacing:.22em;color:#6b6157;margin-bottom:8px;">今日头条 · TODAY'S BRIEF</div>
<h1 style="font-family:${WECHAT_FONT_FAMILY};font-weight:900;font-size:22px;line-height:1.2;margin:0 0 16px;color:#1a1714;">${escapeHtml(item.summary)}</h1>
${renderLeadDeck(item)}
${renderItemMetric(item)}
</section>`;
}

function renderItemMetric(item) {
  const data = [item.source, item.metric].filter(Boolean).join(" · ");
  if (!data) return "";
  return `<p${styleAttr("metric")}>数据：${escapeHtml(data)}</p>`;
}

function renderFocusItem(item, index) {
  const source = item.source || "";
  const metric = item.metric || "";
  const audience = stripAudienceAttribution(item.audience || "");
  return `<div style="min-width:0;padding:16px 0;border-bottom:1px dotted #d9cfbf;">
<div style="display:flex;justify-content:space-between;align-items:baseline;gap:12px;margin-bottom:8px;">
<div style="min-width:0;font-family:${WECHAT_FONT_FAMILY};font-size:10px;letter-spacing:.15em;text-transform:uppercase;color:#6b6157;line-height:1.5;"><span style="color:${HOTSPOT_RED};font-weight:700;font-size:14px;margin-right:6px;">№${index + 1}</span>${escapeHtml(source)}</div>
<div style="flex-shrink:0;font-family:${WECHAT_FONT_FAMILY};font-size:10px;letter-spacing:.08em;color:#6b6157;white-space:nowrap;">${escapeHtml(metric)}</div>
</div>
<h3 style="margin:0;font-family:${WECHAT_FONT_FAMILY};font-size:17px;font-weight:700;line-height:1.45;color:#1a1714;">${escapeHtml(item.summary)}</h3>
${audience ? `<p style="font-size:12px;color:#6b6157;border-left:2px solid ${HOTSPOT_RED};padding-left:10px;line-height:1.65;margin:12px 0 0;font-style:italic;">${escapeHtml(audience)}</p>` : ""}
</div>`;
}

function renderFocusSection(items) {
  if (!items.length) return "";
  return `<section style="padding:24px 0;border-bottom:1px solid #d9cfbf;">
<div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;">
<span style="flex:1;border-top:1px solid #d9cfbf;"></span>
<span style="font-family:${WECHAT_FONT_FAMILY};font-weight:900;font-size:22px;color:#1a1714;">今日焦点</span>
<span style="flex:1;border-top:1px solid #d9cfbf;"></span>
</div>
<div style="display:flex;flex-direction:column;gap:18px;">${items
    .map(renderFocusItem)
    .join("")}</div>
</section>`;
}

function markdownTailAfterLeadSections(markdown, sections) {
  const tailLabel = [...sections.keys()].find(
    (label) => label !== "今日头条" && label !== "今日焦点 TOP 3"
  );
  if (!tailLabel) return "";
  const match = markdown.match(new RegExp(`^## ${escapeRegExp(tailLabel)}$`, "m"));
  return match ? markdown.slice(match.index) : "";
}

function renderWechatHtml(markdown, sections = new Map(), titleText = "Hotspot 微信公众号草稿") {
  const headline = sections.get("今日头条")?.[0];
  const focusItems = sections.get("今日焦点 TOP 3") || [];
  const tailMarkdown = markdownTailAfterLeadSections(markdown, sections);

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(titleText)}</title>
</head>
<body style="margin:0;background:#f7f4ec;">
<main${styleAttr("container")}>
${renderHeroSection(headline)}
${renderFocusSection(focusItems)}
${tailMarkdown ? renderInlineMarkdown(tailMarkdown) : ""}
</main>
</body>
</html>
`;
}

function escapeXml(value = "") {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function wrapSvgText(text, maxChars, maxLines = 2) {
  const chars = [...text];
  const lines = [];
  for (let i = 0; i < chars.length && lines.length < maxLines; i += maxChars) {
    let line = chars.slice(i, i + maxChars).join("");
    if (i + maxChars < chars.length && lines.length === maxLines - 1) {
      line = `${line.slice(0, Math.max(0, line.length - 1))}...`;
    }
    lines.push(line);
  }
  return lines;
}

function renderQrSvg(url, x, y, size) {
  const qr = QRCode.create(url, { errorCorrectionLevel: "M" });
  const moduleCount = qr.modules.size;
  const quietZone = 4;
  const cell = size / (moduleCount + quietZone * 2);
  const rects = [];

  for (let row = 0; row < moduleCount; row += 1) {
    for (let col = 0; col < moduleCount; col += 1) {
      if (!qr.modules.data[row * moduleCount + col]) continue;
      rects.push(
        `<rect x="${(x + (col + quietZone) * cell).toFixed(2)}" y="${(y + (row + quietZone) * cell).toFixed(2)}" width="${cell.toFixed(2)}" height="${cell.toFixed(2)}" />`
      );
    }
  }

  return `
    <rect x="${x}" y="${y}" width="${size}" height="${size}" rx="18" fill="#fff" />
    <g fill="#1a1714">${rects.join("")}</g>
  `;
}

function renderCtaSvg(issue, selectedCount) {
  const width = 1200;
  const height = 630;
  const titleLines = wrapSvgText(issue.todayHotspot.summary, 21, 2);
  const stats = issue.scanTotal
    ? `扫描 ${issue.scanTotal} 条英文社区动态 · 精选 ${selectedCount} 条重点热点`
    : "英文技术社区每日热点";
  const urlLines = wrapSvgText(issue.issueUrl.replace(/^https:\/\//, ""), 36, 2);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="1200" height="630" fill="#f7f4ec"/>
  <rect x="56" y="56" width="1088" height="518" rx="0" fill="#fffdf8"/>
  <rect x="56" y="56" width="1088" height="16" fill="${HOTSPOT_RED}"/>
  <text x="96" y="134" fill="${HOTSPOT_RED}" font-size="30" font-weight="800" font-family="-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif">Hotspot 每日热榜</text>
  <text x="96" y="178" fill="#6b6157" font-size="24" font-family="-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif">${escapeXml(issue.date)}</text>
  ${titleLines
    .map(
      (line, index) =>
        `<text x="96" y="${250 + index * 50}" fill="#1a1714" font-size="38" font-weight="800" font-family="-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif">${escapeXml(line)}</text>`
    )
    .join("\n  ")}
  <text x="96" y="390" fill="#3a332d" font-size="24" font-family="-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif">${escapeXml(stats)}</text>
  <text x="96" y="438" fill="#6b6157" font-size="22" font-family="-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif">完整榜单 / 原文链接 / 评论证据</text>
  ${urlLines
    .map(
      (line, index) =>
        `<text x="96" y="${494 + index * 34}" fill="#1a1714" font-size="22" font-family="ui-monospace,SFMono-Regular,Menlo,monospace">${escapeXml(line)}</text>`
    )
    .join("\n  ")}
  ${renderQrSvg(issue.issueUrl, 846, 166, 236)}
  <text x="842" y="446" fill="#1a1714" font-size="25" font-weight="700" font-family="-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif">扫码查看完整热榜</text>
  <text x="842" y="486" fill="#6b6157" font-size="20" font-family="-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif">也可点击文末「阅读原文」</text>
</svg>`;
}

function renderSvgToPng(svgPath, pngPath) {
  const sipsResult = spawnSync("sips", [
    "-s",
    "format",
    "png",
    svgPath,
    "--out",
    pngPath,
  ], { encoding: "utf8" });

  if (sipsResult.status === 0 && existsSync(pngPath)) {
    return;
  }

  const rsvgResult = spawnSync("rsvg-convert", [
    "-w",
    "1200",
    "-h",
    "630",
    "-f",
    "png",
    "-o",
    pngPath,
    svgPath,
  ], { encoding: "utf8" });

  if (rsvgResult.status === 0 && existsSync(pngPath)) {
    return;
  }

  throw new Error(
    [
      "Failed to render CTA PNG from SVG.",
      "The SVG source was generated, but PNG conversion requires macOS sips or rsvg-convert.",
      sipsResult.stderr || sipsResult.stdout,
      rsvgResult.stderr || rsvgResult.stdout,
    ].filter(Boolean).join("\n")
  );
}

function extractTagBlock(html, tagName) {
  const match = html.match(
    new RegExp(`<${tagName}\\b([^>]*)>([\\s\\S]*?)<\\/${tagName}>`, "i")
  );
  if (!match) {
    throw new Error(`Missing <${tagName}> block in rendered article HTML.`);
  }

  return {
    attrs: match[1] || "",
    innerHtml: match[2] || "",
    outerHtml: match[0],
  };
}

function extractHtmlTitle(html) {
  const match = html.match(/<title>([\s\S]*?)<\/title>/i);
  if (!match) {
    throw new Error("Missing <title> in rendered article HTML.");
  }
  return decodeHtml(match[1].trim());
}

function extractCtaImageSrc(sectionHtml) {
  const ctaMatch = [
    ...sectionHtml.matchAll(
      /<img\b[^>]*alt="Hotspot 今日完整热榜"[^>]*src="([^"]+)"[^>]*\/?>/gi
    ),
  ].at(-1);

  if (!ctaMatch) {
    throw new Error("Missing CTA image in rendered article HTML.");
  }

  return decodeHtml(ctaMatch[1]);
}

function replaceOuterTag(html, fromTag, toTag) {
  return html
    .replace(new RegExp(`^<${fromTag}\\b`, "i"), `<${toTag}`)
    .replace(new RegExp(`</${fromTag}>\\s*$`, "i"), `</${toTag}>`);
}

function removeTrailingCtaImage(sectionHtml, ctaImageSrc) {
  const escapedSrc = escapeRegExp(ctaImageSrc);
  const wrappedImageRe = new RegExp(
    `<p\\b[^>]*>\\s*<img\\b[^>]*src="${escapedSrc}"[^>]*\\/?>\\s*<\\/p>`,
    "i"
  );

  if (wrappedImageRe.test(sectionHtml)) {
    return sectionHtml.replace(wrappedImageRe, "").trim();
  }

  const directImageRe = new RegExp(
    `<img\\b[^>]*src="${escapedSrc}"[^>]*\\/?>`,
    "i"
  );
  return sectionHtml.replace(directImageRe, "").trim();
}

function buildPublishPayload(articleDir) {
  const date = path.basename(articleDir);
  const htmlPath = path.join(articleDir, "daily-hotspots.html");
  if (!existsSync(htmlPath)) {
    throw new Error(`Missing rendered article HTML: ${htmlPath}`);
  }

  const html = readFileSync(htmlPath, "utf8");
  const title = extractHtmlTitle(html);
  const mainBlock = extractTagBlock(html, "main");
  const sectionHtml = replaceOuterTag(mainBlock.outerHtml.trim(), "main", "section");
  const ctaImageSrc = extractCtaImageSrc(sectionHtml);
  const pasteHtml = removeTrailingCtaImage(sectionHtml, ctaImageSrc);
  const sourceDate = subtractOneDay(date);
  const articleUrl = `${SITE_URL}/archive/${date}-hotspot.html`;

  return {
    date,
    title,
    author: "十四行手稿",
    sourceNotice: `素材来源官方媒体/网络新闻，文中事件发生于${formatChineseDate(sourceDate)}`,
    collection: "IT-Hotspot",
    originalUrl: articleUrl,
    coverSourceUrl: articleUrl,
    coverTarget: {
      width: WECHAT_COVER_OUTPUT.width,
      height: WECHAT_COVER_OUTPUT.height,
      aspectRatio: WECHAT_COVER_OUTPUT.width / WECHAT_COVER_OUTPUT.height,
    },
    coverCaptureRule: {
      startAnchor: WECHAT_COVER_START_ANCHOR,
      endAnchor: WECHAT_COVER_END_ANCHOR,
      startHint: "从 masthead 顶部的粗双横开始截取",
      endHint: "裁到“今日焦点”标题之前",
      viewport: {
        minWidth: WECHAT_COVER_VIEWPORT.width,
        minHeight: WECHAT_COVER_VIEWPORT.height,
      },
    },
    coverOutputPath: path.join(articleDir, `${date}-cover.png`),
    ctaImageSrc,
    ctaImagePath: path.join(articleDir, ctaImageSrc),
    sectionHtml,
    pasteHtml,
  };
}

function writePublishArtifacts(articleDir) {
  const payload = buildPublishPayload(articleDir);
  writeFileSync(path.join(articleDir, "draft-body.html"), `${payload.pasteHtml}\n`);
  writeFileSync(
    path.join(articleDir, "draft-manifest.json"),
    `${JSON.stringify(payload, null, 2)}\n`
  );
  return payload;
}

async function generate(rootDir, date, outputDir, { skipCover = false } = {}) {
  const issueRef = resolveIssue(rootDir, date);
  const html = readFileSync(issueRef.filePath, "utf8");
  const issue = parseIssue(html, issueRef.date, issueRef.fileName);
  const sections = selectArticleItems(issue);
  const articleDir = path.join(outputDir, issue.date);

  mkdirSync(articleDir, { recursive: true });
  const titlePackage = await generateTitlePackage({
    issue,
    sections,
    outputDir: articleDir,
  });
  const wechatTitle = formatWechatArticleTitle(issue.date, titlePackage.recommendedTitle);
  const markdown = renderMarkdown(issue, sections, titlePackage.recommendedTitle);
  const renderedHtml = renderWechatHtml(markdown, sections, wechatTitle);
  const selectedCount = [...sections.values()].reduce((sum, list) => sum + list.length, 0);
  const ctaSvg = renderCtaSvg(issue, selectedCount);

  const markdownPath = path.join(articleDir, "daily-hotspots.md");
  const htmlPath = path.join(articleDir, "daily-hotspots.html");
  const ctaSvgPath = path.join(articleDir, `${issue.date}-cta.svg`);
  const ctaPngPath = path.join(articleDir, `${issue.date}-cta.png`);
  writeFileSync(markdownPath, markdown);
  writeFileSync(htmlPath, renderedHtml);
  writeFileSync(ctaSvgPath, ctaSvg);
  renderSvgToPng(ctaSvgPath, ctaPngPath);
  const payload = writePublishArtifacts(articleDir);
  if (!skipCover) {
    await captureWechatCover({
      sourceUrl: payload.coverSourceUrl,
      outputPath: payload.coverOutputPath,
    });
  }

  return issue;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const issue = await generate(args.root, args.date, args.output, {
      skipCover: args.skipCover,
    });
    console.log(`Generated WeChat sidecar output for ${issue.date}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

export {
  buildPublishPayload,
  computeCoverCapturePlan,
  formatWechatArticleTitle,
  generate,
  parseIssue,
  renderMarkdown,
  selectArticleItems,
  writePublishArtifacts,
};
