#!/usr/bin/env node

import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

const SITE_URL = "https://hotspot.octohirono.dev";
const SITE_NAME = "Hotspot 每日热榜";
const ISSUE_FILE_RE = /^(\d{4})-(\d{2})-(\d{2})-hotspot\.html$/;
const OUTPUT_DIR = "public";
const FAVICON_FILE = "favicon.ico";
const APPLE_TOUCH_ICON_FILE = "apple-touch-icon.png";

function parseArgs(argv) {
  const args = { root: process.cwd() };

  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--root") {
      args.root = path.resolve(argv[index + 1] ?? args.root);
      index += 1;
    }
  }

  return args;
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function decodeEntities(value) {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&#x27;", "'")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&#39;", "'");
}

// 块级 / 换行标签需用空格分隔，内联标签（em/sup/strong/span/a/b/i…）则直接去掉，
// 否则像 <em>4</em>.<em>8</em> 这种会被错误地变成 "4 . 8"。
const BLOCK_TAG_PATTERN =
  /<\/?(?:br|p|div|li|ul|ol|h[1-6]|section|article|header|footer|tr|td|th|blockquote)\b[^>]*>/gi;

function cleanText(value) {
  const withBlockBreaks = value
    .replace(BLOCK_TAG_PATTERN, " ")
    .replace(/<[^>]+>/g, "");
  return decodeEntities(withBlockBreaks).replace(/\s+/g, " ").trim();
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/\n/g, " ");
}

function shortenDescription(value, maxLength = 160) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1).trimEnd()}…`;
}

// 标题截断：优先在子句边界切断，并去掉末尾悬空标点，避免出现 "…相比 4.…" 式生硬截断。
function truncateTitle(value, maxLength = 40) {
  if (value.length <= maxLength) {
    return value;
  }

  let cut = value.slice(0, maxLength);
  const boundary = Math.max(
    cut.lastIndexOf("，"),
    cut.lastIndexOf("。"),
    cut.lastIndexOf("、"),
    cut.lastIndexOf("；"),
    cut.lastIndexOf(" ")
  );
  if (boundary >= maxLength * 0.6) {
    cut = cut.slice(0, boundary);
  }
  cut = cut.replace(/[\s，、。；：,.\-—·（(]+$/u, "");
  return `${cut}…`;
}

function requireMatch(text, regex, label, filePath) {
  const match = text.match(regex);
  if (!match) {
    throw new Error(`Missing ${label} in ${filePath}`);
  }
  return match;
}

function formatWeekday(date) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    timeZone: "UTC",
  })
    .format(date)
    .toUpperCase();
}

function formatMonthName(date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    timeZone: "UTC",
  })
    .format(date)
    .toUpperCase();
}

function parseIssue(filePath) {
  const fileName = path.basename(filePath);
  const fileMatch = fileName.match(ISSUE_FILE_RE);
  if (!fileMatch) {
    throw new Error(`Invalid issue filename: ${fileName}`);
  }

  const html = readFileSync(filePath, "utf8");
  const headlineRaw = requireMatch(
    html,
    /<h1 class="hero-headline">([\s\S]*?)<\/h1>/,
    "hero headline",
    filePath
  )[1];
  const deckRaw = requireMatch(
    html,
    /<p class="hero-deck">([\s\S]*?)<\/p>/,
    "hero deck",
    filePath
  )[1];
  const scanCount = requireMatch(
    html,
    /<span><b>(\d+)<\/b> 条扫描<\/span>/,
    "scan count",
    filePath
  )[1];
  const crossPlatformCount = requireMatch(
    html,
    /<span><b>(\d+)<\/b> 个跨平台事件<\/span>/,
    "cross-platform count",
    filePath
  )[1];
  const validCount = requireMatch(
    html,
    /<span><b>(\d+)<\/b> 条有效<\/span>/,
    "valid count",
    filePath
  )[1];

  const [, year, month, day] = fileMatch;
  const dateString = `${year}-${month}-${day}`;
  const date = new Date(`${dateString}T00:00:00Z`);
  const headline = cleanText(headlineRaw);
  const deck = cleanText(deckRaw);

  return {
    fileName,
    filePath,
    html,
    dateString,
    date,
    year,
    month,
    day,
    weekday: formatWeekday(date),
    monthName: formatMonthName(date),
    headline,
    deck,
    scanCount,
    crossPlatformCount,
    validCount,
    canonicalUrl: `${SITE_URL}/archive/${fileName}`,
    description: shortenDescription(deck),
  };
}

function collectIssues(rootDir) {
  const archiveDir = path.join(rootDir, "archive");
  const issues = readdirSync(archiveDir)
    .filter((fileName) => ISSUE_FILE_RE.test(fileName))
    .map((fileName) => parseIssue(path.join(archiveDir, fileName)))
    .sort((left, right) => right.dateString.localeCompare(left.dateString));

  if (issues.length === 0) {
    throw new Error(`No issue files found in ${archiveDir}`);
  }

  return issues;
}

function upsertTag(html, tagRegex, tagMarkup) {
  if (tagRegex.test(html)) {
    return html.replace(tagRegex, tagMarkup);
  }

  return html.replace("</head>", `  ${tagMarkup}\n</head>`);
}

function withFaviconLinks(html, prefix = "") {
  const assetPrefix = prefix ? `${prefix}/` : "";
  const faviconTags = `  <link rel="icon" href="${assetPrefix}${FAVICON_FILE}" sizes="any" />\n  <link rel="apple-touch-icon" href="${assetPrefix}${APPLE_TOUCH_ICON_FILE}" />`;

  html = html.replace(/\s*<link rel="icon" href="[^"]+"[^>]*\/?>\n?/g, "");
  html = html.replace(
    /\s*<link rel="apple-touch-icon" href="[^"]+"[^>]*\/?>\n?/g,
    ""
  );

  return html.replace("</head>", `${faviconTags}\n</head>`);
}

function enhanceIssueHtml(
  issue,
  {
    faviconPrefix = "..",
    archiveLinkHref = "./",
    canonicalUrl = issue.canonicalUrl,
    ogType = "article",
    structuredDataType = "Article",
  } = {}
) {
  let html = issue.html;
  const canonicalTag = `<link rel="canonical" href="${canonicalUrl}" />`;
  const descriptionTag = `<meta name="description" content="${escapeAttribute(
    issue.description
  )}" />`;

  html = upsertTag(
    html,
    /<link rel="canonical" href="[^"]+"\s*\/?>/,
    canonicalTag
  );
  html = upsertTag(
    html,
    /<meta name="description" content="[^"]*"\s*\/?>/,
    descriptionTag
  );

  // 用当天主标题改写 <title>（SERP 里显示的就是它），取代千篇一律的日期模板。
  const titleText = `${truncateTitle(issue.headline)} | ${SITE_NAME} ${issue.dateString}`;
  html = upsertTag(
    html,
    /<title>[\s\S]*?<\/title>/,
    `<title>${escapeHtml(titleText)}</title>`
  );

  html = html.replace(
    /<a(?:\s+href="[^"]*")?>往期热点<\/a>/g,
    `<a href="${archiveLinkHref}">往期热点</a>`
  );
  html = withFaviconLinks(html, faviconPrefix);

  const ogBlock = `  <meta property="og:type" content="${ogType}" />
  <meta property="og:title" content="${escapeAttribute(issue.headline)}" />
  <meta property="og:description" content="${escapeAttribute(issue.description)}" />
  <meta property="og:url" content="${canonicalUrl}" />
  <meta property="og:site_name" content="${SITE_NAME}" />
  <meta property="og:locale" content="zh_CN" />
  <meta name="twitter:card" content="summary" />
  <meta name="twitter:title" content="${escapeAttribute(issue.headline)}" />
  <meta name="twitter:description" content="${escapeAttribute(issue.description)}" />`;
  html = html.replace("</head>", `${ogBlock}\n</head>`);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": structuredDataType,
    name: "Hotspot · 每日热榜",
    headline: issue.headline,
    description: issue.description,
    url: canonicalUrl,
    datePublished: issue.dateString,
    dateModified: issue.dateString,
    inLanguage: "zh-CN",
    publisher: { "@type": "Organization", name: "Hotspot", url: SITE_URL },
    isPartOf: { "@type": "CollectionPage", url: `${SITE_URL}/archive/` },
  };
  if (structuredDataType === "WebPage") {
    jsonLd.mainEntity = {
      "@type": "Article",
      headline: issue.headline,
      url: issue.canonicalUrl,
      datePublished: issue.dateString,
      dateModified: issue.dateString,
      inLanguage: "zh-CN",
    };
  }
  html = html.replace(
    "</head>",
    `  <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>\n</head>`
  );

  return html;
}

function buildArchiveData(issues) {
  const years = new Map();

  for (const issue of issues) {
    if (!years.has(issue.year)) {
      years.set(issue.year, { year: issue.year, months: new Map() });
    }

    const yearEntry = years.get(issue.year);
    if (!yearEntry.months.has(issue.month)) {
      yearEntry.months.set(issue.month, {
        month: issue.month,
        monthName: issue.monthName,
        issues: [],
      });
    }

    yearEntry.months.get(issue.month).issues.push(issue);
  }

  return [...years.values()]
    .sort((left, right) => right.year.localeCompare(left.year))
    .map((yearEntry) => ({
      year: yearEntry.year,
      months: [...yearEntry.months.values()].sort((left, right) =>
        right.month.localeCompare(left.month)
      ),
    }));
}

function renderMonthButtons(yearEntry, activeYear) {
  return yearEntry.months
    .map(
      (monthEntry) => `<a
              class="month-chip${yearEntry.year === activeYear ? " active" : ""}"
              data-month-link="${yearEntry.year}-${monthEntry.month}"
              href="#month-${yearEntry.year}-${monthEntry.month}"
            >${monthEntry.monthName.slice(0, 3)}</a>`
    )
    .join("\n");
}

function renderArchiveHtml(issues) {
  const archiveData = buildArchiveData(issues);
  const latestYear = archiveData[0].year;
  const yearNav = archiveData
    .map(
      (yearEntry) => `<li>
              <a class="year-link${yearEntry.year === latestYear ? " active" : ""}" data-year-link="${
                yearEntry.year
              }" href="#year-${yearEntry.year}">${yearEntry.year}</a>
            </li>`
    )
    .join("\n");
  const monthPanels = archiveData
    .map(
      (yearEntry) => `<div class="month-grid${yearEntry.year === latestYear ? " active" : ""}" data-months-for="${
        yearEntry.year
      }">
            ${renderMonthButtons(yearEntry, latestYear)}
          </div>`
    )
    .join("\n");
  const sections = archiveData
    .map((yearEntry) => {
      const monthSections = yearEntry.months
        .map((monthEntry) => {
          const issueItems = monthEntry.issues
            .map(
              (issue) => `<a class="archive-item" href="${issue.fileName}">
                <div class="issue-date">
                  <span class="issue-day">${issue.day}</span>
                  <span class="issue-weekday">${issue.weekday}</span>
                </div>
                <div class="issue-copy">
                  <div class="issue-kicker">HOTSPOT ISSUE</div>
                  <h4>${escapeHtml(issue.headline)}</h4>
                  <p>${escapeHtml(issue.deck)}</p>
                </div>
                <div class="issue-metrics">
                  <div><strong>${issue.scanCount}</strong><span>SCANS</span></div>
                  <div><strong>${issue.validCount}</strong><span>VALID</span></div>
                  <div><strong>${issue.crossPlatformCount}</strong><span>CROSS</span></div>
                </div>
              </a>`
            )
            .join("\n");

          return `<section class="month-section" id="month-${yearEntry.year}-${monthEntry.month}" data-year-section="${
            yearEntry.year
          }">
            <div class="month-header">
              <h3>${monthEntry.monthName}</h3>
              <span>${monthEntry.issues.length} ISSUES</span>
            </div>
            <div class="month-list">
              ${issueItems}
            </div>
          </section>`;
        })
        .join("\n");

      return `<section class="year-group" id="year-${yearEntry.year}" data-year-group="${yearEntry.year}">
          ${monthSections}
        </section>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Hotspot 往期归档 · 独立开发 AI 创业每日情报</title>
  <meta
    name="description"
    content="IT Hotspot 往期归档。按年份和月份浏览历期独立开发、出海与 AI 创业每日热榜，每期包含头条事件、跨平台热点与扫描统计。"
  />
  <link rel="canonical" href="${SITE_URL}/archive/" />
  <meta property="og:type" content="website" />
  <meta property="og:title" content="Hotspot 往期归档 · 独立开发 AI 创业每日情报" />
  <meta property="og:description" content="IT Hotspot 往期归档。按年份和月份浏览历期独立开发、出海与 AI 创业每日热榜。" />
  <meta property="og:url" content="${SITE_URL}/archive/" />
  <meta property="og:site_name" content="${SITE_NAME}" />
  <meta property="og:locale" content="zh_CN" />
  <meta name="twitter:card" content="summary" />
  <meta name="twitter:title" content="Hotspot 往期归档 · 独立开发 AI 创业每日情报" />
  <meta name="twitter:description" content="IT Hotspot 往期归档。按年份和月份浏览历期独立开发、出海与 AI 创业每日热榜。" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link
    rel="stylesheet"
    href="https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@400;700;900&family=Noto+Sans+SC:wght@400;500;700&family=JetBrains+Mono:wght@500;700&family=Playfair+Display:wght@700;900&display=swap"
  />
  <link rel="icon" href="../favicon.ico" sizes="any" />
  <link rel="apple-touch-icon" href="../apple-touch-icon.png" />
  <script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "Hotspot 往期归档",
    description: "IT Hotspot 往期归档。按年份和月份浏览历期独立开发、出海与 AI 创业每日热榜。",
    url: `${SITE_URL}/archive/`,
    inLanguage: "zh-CN",
    publisher: { "@type": "Organization", name: "Hotspot", url: SITE_URL },
    numberOfItems: issues.length,
  })}</script>
  <script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Hotspot", item: SITE_URL },
      { "@type": "ListItem", position: 2, name: "往期归档", item: `${SITE_URL}/archive/` },
    ],
  })}</script>
  <style>
    :root {
      --paper: #f6f1e7;
      --paper-2: #fcf8ef;
      --ink: #171512;
      --muted: #6e665e;
      --rule: #cabda9;
      --rule-soft: #ddd3c4;
      --accent: #b21f16;
      --chip: #111111;
    }
    * { box-sizing: border-box; }
    html { scroll-behavior: smooth; }
    body {
      margin: 0;
      background: radial-gradient(circle at top, #fbf7ef 0%, var(--paper) 56%, #f0e7d8 100%);
      color: var(--ink);
      font-family: "Noto Sans SC", sans-serif;
    }
    a { color: inherit; text-decoration: none; }
    .page {
      max-width: 1440px;
      margin: 0 auto;
      padding: 24px 28px 56px;
    }
    .masthead {
      border-top: 6px double var(--ink);
      border-bottom: 1px solid var(--rule);
      padding: 32px 0 18px;
    }
    .masthead-row {
      display: grid;
      grid-template-columns: 1fr auto 1fr;
      gap: 24px;
      align-items: end;
    }
    .masthead-copy,
    .masthead-meta {
      font-family: "JetBrains Mono", monospace;
      color: var(--muted);
      font-size: 14px;
      line-height: 1.8;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .masthead-meta { text-align: right; }
    .brand {
      font-family: "Playfair Display", "Noto Serif SC", serif;
      font-size: clamp(64px, 9vw, 88px);
      line-height: 0.95;
      letter-spacing: -0.05em;
      font-weight: 900;
      text-align: center;
      margin: 0;
    }
    .top-nav {
      display: flex;
      justify-content: center;
      gap: 36px;
      border-bottom: 1px solid var(--ink);
      padding: 16px 0 14px;
      margin-top: 18px;
      font-family: "Noto Serif SC", serif;
      font-size: 18px;
    }
    .top-nav a { color: var(--muted); }
    .top-nav a.active {
      color: var(--ink);
      font-weight: 700;
      text-decoration: underline;
      text-underline-offset: 6px;
    }
    .layout {
      display: grid;
      grid-template-columns: 220px minmax(0, 1fr);
      gap: 34px;
      margin-top: 38px;
    }
    .sidebar {
      position: sticky;
      top: 24px;
      align-self: start;
      display: grid;
      gap: 28px;
    }
    .side-block::before,
    .archive-header::before {
      content: "";
      display: block;
      width: 100%;
      height: 6px;
      margin-bottom: 18px;
      border-top: 2px solid var(--ink);
      border-bottom: 1px solid var(--ink);
    }
    .side-block h2,
    .archive-header h2 {
      margin: 0 0 16px;
      font-family: "Noto Serif SC", serif;
      font-size: 18px;
      font-weight: 700;
    }
    .year-list {
      list-style: none;
      padding: 0;
      margin: 0;
      display: grid;
      gap: 10px;
      font-family: "JetBrains Mono", monospace;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }
    .year-link {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      color: var(--muted);
    }
    .year-link.active {
      color: var(--accent);
      font-weight: 700;
    }
    .year-link.active::before {
      content: "";
      width: 7px;
      height: 7px;
      background: var(--accent);
      display: inline-block;
    }
    .month-grid {
      display: none;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 8px;
    }
    .month-grid.active { display: grid; }
    .month-chip {
      display: inline-flex;
      justify-content: center;
      align-items: center;
      min-height: 32px;
      border: 1px solid var(--rule);
      background: var(--paper-2);
      font-family: "JetBrains Mono", monospace;
      font-size: 12px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .month-chip.active,
    .month-chip:hover {
      background: var(--chip);
      color: var(--paper-2);
      border-color: var(--chip);
    }
    .content {
      min-width: 0;
    }
    .archive-header .kicker {
      color: var(--accent);
      font-family: "JetBrains Mono", monospace;
      letter-spacing: 0.12em;
      font-size: 14px;
      text-transform: uppercase;
      margin-bottom: 10px;
    }
    .archive-header h1 {
      margin: 0;
      font-family: "Noto Serif SC", serif;
      font-size: clamp(34px, 5vw, 48px);
      line-height: 1.12;
    }
    .archive-header p {
      margin: 10px 0 0;
      color: var(--muted);
      font-size: 19px;
      font-style: italic;
    }
    .year-group + .year-group {
      margin-top: 28px;
    }
    .month-section {
      margin-top: 30px;
    }
    .month-header {
      display: flex;
      align-items: baseline;
      gap: 18px;
      padding-bottom: 18px;
      border-bottom: 1px solid var(--ink);
    }
    .month-header h3 {
      margin: 0;
      font-family: "Playfair Display", "Noto Serif SC", serif;
      font-size: clamp(46px, 6vw, 58px);
      font-weight: 700;
      line-height: 0.95;
      letter-spacing: -0.04em;
    }
    .month-header::after {
      content: "";
      flex: 1;
      height: 1px;
      background: var(--rule-soft);
    }
    .month-header span {
      font-family: "JetBrains Mono", monospace;
      color: var(--muted);
      font-size: 13px;
      letter-spacing: 0.12em;
      text-transform: uppercase;
    }
    .month-list {
      border-top: 1px solid var(--rule-soft);
    }
    .archive-item {
      display: grid;
      grid-template-columns: 84px minmax(0, 1fr) 220px;
      gap: 26px;
      align-items: center;
      padding: 22px 0;
      border-bottom: 1px solid var(--rule-soft);
      transition: background-color 180ms ease, color 180ms ease;
    }
    .archive-item:hover {
      background: rgba(178, 31, 22, 0.045);
    }
    .issue-date {
      text-align: center;
      font-family: "JetBrains Mono", monospace;
      text-transform: uppercase;
    }
    .issue-day {
      display: block;
      font-size: 42px;
      line-height: 1;
      font-weight: 700;
    }
    .issue-weekday {
      display: block;
      margin-top: 6px;
      font-size: 12px;
      color: var(--muted);
      letter-spacing: 0.08em;
    }
    .issue-copy {
      min-width: 0;
    }
    .issue-kicker {
      font-family: "JetBrains Mono", monospace;
      color: var(--muted);
      letter-spacing: 0.12em;
      text-transform: uppercase;
      font-size: 12px;
      margin-bottom: 10px;
    }
    .issue-copy h4 {
      margin: 0;
      font-family: "Noto Serif SC", serif;
      font-size: 28px;
      line-height: 1.35;
    }
    .issue-copy p {
      margin: 10px 0 0;
      color: #544d45;
      font-size: 15px;
      line-height: 1.8;
    }
    .issue-metrics {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 16px;
      text-align: right;
      font-family: "JetBrains Mono", monospace;
    }
    .issue-metrics strong {
      display: block;
      font-size: 20px;
      line-height: 1.1;
    }
    .issue-metrics span {
      display: block;
      margin-top: 8px;
      color: var(--muted);
      font-size: 10px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .footer {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 24px;
      margin-top: 54px;
      padding-top: 28px;
      border-top: 6px double var(--ink);
      color: var(--muted);
      font-size: 13px;
      line-height: 1.8;
    }
    .footer h5 {
      margin: 0 0 10px;
      color: var(--ink);
      font-family: "JetBrains Mono", monospace;
      font-size: 12px;
      letter-spacing: 0.12em;
      text-transform: uppercase;
    }
    .footer-note {
      margin-top: 14px;
      font-family: "JetBrains Mono", monospace;
      font-size: 12px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--ink);
    }
    @media (max-width: 1024px) {
      .layout { grid-template-columns: 1fr; }
      .sidebar { position: static; }
      .masthead-row { grid-template-columns: 1fr; text-align: center; }
      .masthead-copy, .masthead-meta { text-align: center; }
      .archive-item { grid-template-columns: 84px minmax(0, 1fr); }
      .issue-metrics { grid-column: 2; text-align: left; }
    }
    @media (max-width: 720px) {
      .page { padding: 16px 16px 40px; }
      .top-nav { gap: 18px; font-size: 16px; }
      .month-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
      .archive-item { grid-template-columns: 1fr; gap: 14px; }
      .issue-date, .issue-metrics { text-align: left; }
      .issue-day { font-size: 34px; }
      .footer { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <main class="page">
    <header class="masthead">
      <div class="masthead-row">
        <div class="masthead-copy">独立开发 · 出海 · AI 创业<br />内容归档 · 报纸版</div>
        <p class="brand">HOTSPOT</p>
        <div class="masthead-meta">ARCHIVE INDEX<br />SINCE ${archiveData.at(-1).year}</div>
      </div>
      <nav class="top-nav" aria-label="Primary">
        <a href="../index.html">最新热榜</a>
        <a class="active" href="./">往期归档</a>
      </nav>
    </header>

    <div class="layout">
      <aside class="sidebar">
        <section class="side-block">
          <h2>年份选择</h2>
          <ul class="year-list">
            ${yearNav}
          </ul>
        </section>
        <section class="side-block">
          <h2>月份快速跳转</h2>
          ${monthPanels}
        </section>
      </aside>

      <section class="content">
        <header class="archive-header">
          <div class="kicker">INDIE INTEL REGISTRY</div>
          <h1 id="archive-title">Archive Index / ${latestYear}</h1>
          <p>内容归档 · 见证独立开发者的每一天</p>
        </header>
        ${sections}
      </section>
    </div>

    <footer class="footer">
      <div>
        <h5>关于项目</h5>
        <p>Hotspot 是一个专注独立开发者、出海与 AI 创业的情报站点。我们把每日热点整理成完整期刊，并以报纸式结构留存归档。</p>
      </div>
      <div>
        
      </div>
      <div>
        <h5>订阅与归档</h5>
        <p>域名 ${SITE_URL.replace("https://", "")} · 总归档 ${issues.length} 期 · 最新一期 ${issues[0].dateString}</p>
        <div class="footer-note">© ${new Date().getUTCFullYear()} HOTSPOT EDITORIAL — INDIE INTEL REGISTRY</div>
      </div>
    </footer>
  </main>
  <script>
    (() => {
      const title = document.getElementById("archive-title");
      const yearLinks = [...document.querySelectorAll("[data-year-link]")];
      const monthPanels = [...document.querySelectorAll("[data-months-for]")];
      const sections = [...document.querySelectorAll("[data-year-section]")];

      function setActiveYear(year) {
        yearLinks.forEach((link) => {
          link.classList.toggle("active", link.dataset.yearLink === year);
        });
        monthPanels.forEach((panel) => {
          panel.classList.toggle("active", panel.dataset.monthsFor === year);
        });
        if (title) {
          title.textContent = \`Archive Index / \${year}\`;
        }
      }

      yearLinks.forEach((link) => {
        link.addEventListener("click", () => setActiveYear(link.dataset.yearLink));
      });

      const observer = new IntersectionObserver(
        (entries) => {
          const visible = entries
            .filter((entry) => entry.isIntersecting)
            .sort((left, right) => right.intersectionRatio - left.intersectionRatio)[0];
          if (visible) {
            setActiveYear(visible.target.dataset.yearSection);
          }
        },
        { rootMargin: "-20% 0px -65% 0px", threshold: [0.1, 0.3, 0.6] }
      );

      sections.forEach((section) => observer.observe(section));
      setActiveYear("${latestYear}");
    })();
  </script>
</body>
</html>`;
}

function renderVercelConfig() {
  return JSON.stringify(
    {
      outputDirectory: OUTPUT_DIR,
    },
    null,
    2
  );
}

function renderSitemapXml(issues) {
  const latestDate = issues[0].dateString;
  const entries = [
    { loc: `${SITE_URL}/`, lastmod: latestDate },
    { loc: `${SITE_URL}/archive/`, lastmod: latestDate },
    ...issues.map((issue) => ({
      loc: `${SITE_URL}/archive/${issue.fileName}`,
      lastmod: issue.dateString,
    })),
  ];

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries
  .map(
    ({ loc, lastmod }) => `  <url>
    <loc>${escapeHtml(loc)}</loc>
    <lastmod>${lastmod}</lastmod>
  </url>`
  )
  .join("\n")}
</urlset>`;
}

function renderRobotsTxt() {
  return `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`;
}

function renderLlmsTxt() {
  return `# Hotspot 每日热榜

> 专注独立开发者、出海与 AI 创业的每日情报站点

## 关于

Hotspot 每日扫描 Twitter/X、Hacker News、Reddit、Product Hunt 等平台，提取独立开发、出海创业、AI 产品领域的热点事件，以报纸版格式整理归档。每期均标注来源链接与传播数据。

## 内容结构

每期页面（/archive/YYYY-MM-DD-hotspot.html）包含：
- 头条事件（hero headline + deck）
- 跨平台热点（多平台同时出现的事件）
- 行业热点（按平台分类的原始热点）
- 实战打法（方法论与教程类内容）
- 话题追踪（持续关注的议题）
- 社区热议（评论区精选）
- 新品产品 Top（Product Hunt 精选）

## 发布

- 发布频率：每日更新
- 归档页：${SITE_URL}/archive/
- Sitemap：${SITE_URL}/sitemap.xml
`;
}

function writeFile(filePath, contents) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents);
}

function buildSite(rootDir) {
  const issues = collectIssues(rootDir);
  const latestIssue = issues[0];
  const publicDir = path.join(rootDir, OUTPUT_DIR);
  const publicArchiveDir = path.join(publicDir, "archive");

  rmSync(publicDir, { recursive: true, force: true });

  for (const issue of issues) {
    writeFile(
      path.join(publicArchiveDir, issue.fileName),
      enhanceIssueHtml(issue)
    );
  }

  writeFile(path.join(publicArchiveDir, "index.html"), renderArchiveHtml(issues));
  writeFile(
    path.join(publicDir, "index.html"),
    enhanceIssueHtml(latestIssue, {
      faviconPrefix: "",
      archiveLinkHref: "archive/",
      canonicalUrl: `${SITE_URL}/`,
      ogType: "website",
      structuredDataType: "WebPage",
    })
  );
  writeFile(path.join(rootDir, "vercel.json"), renderVercelConfig());
  writeFile(path.join(publicDir, "sitemap.xml"), renderSitemapXml(issues));
  writeFile(path.join(publicDir, "robots.txt"), renderRobotsTxt());
  writeFile(path.join(publicDir, "llms.txt"), renderLlmsTxt());
  copyFileSync(path.join(rootDir, FAVICON_FILE), path.join(publicDir, FAVICON_FILE));
  copyFileSync(
    path.join(rootDir, "assets", APPLE_TOUCH_ICON_FILE),
    path.join(publicDir, APPLE_TOUCH_ICON_FILE)
  );
}

const { root } = parseArgs(process.argv.slice(2));
buildSite(root);
