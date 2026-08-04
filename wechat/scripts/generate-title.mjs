#!/usr/bin/env node

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_MODEL = "gpt-5-mini";
const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const CODEX_APP_BIN = "/Applications/Codex.app/Contents/Resources/codex";
// Title rules are vendored in wechat/references/ so this script is self-contained
// and needs no external skill install. See wechat/references/SOURCE.md for origin.
const RULES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "references");
const RULES_ID = "xinzhiyuan-title (vendored)";

const TITLE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["recommendedTitle", "titles", "recommendedBreakdowns", "sensitivityNotes"],
  properties: {
    recommendedTitle: { type: "string" },
    titles: {
      type: "array",
      minItems: 5,
      maxItems: 10,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "title",
          "score",
          "recommended",
          "technique",
          "clickAnalysis",
          "sensitiveRisk",
          "revision",
        ],
        properties: {
          title: { type: "string" },
          score: { type: "number" },
          recommended: { type: "boolean" },
          technique: { type: "string" },
          clickAnalysis: { type: "string" },
          sensitiveRisk: { type: "string" },
          revision: { type: "string" },
        },
      },
    },
    recommendedBreakdowns: {
      type: "array",
      minItems: 1,
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "title",
          "guideWord",
          "coreWord",
          "modifierWord",
          "emotionalWord",
          "actionWord",
          "structureAnalysis",
          "useCase",
        ],
        properties: {
          title: { type: "string" },
          guideWord: { type: "string" },
          coreWord: { type: "string" },
          modifierWord: { type: "string" },
          emotionalWord: { type: "string" },
          actionWord: { type: "string" },
          structureAnalysis: { type: "string" },
          useCase: { type: "string" },
        },
      },
    },
    sensitivityNotes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "expression", "suggestion"],
        properties: {
          title: { type: "string" },
          expression: { type: "string" },
          suggestion: { type: "string" },
        },
      },
    },
  },
};

function compactText(value = "", maxLength = 180) {
  const compact = String(value).replace(/\s+/g, " ").trim();
  return compact.length > maxLength ? `${compact.slice(0, maxLength - 1)}…` : compact;
}

function itemForPrompt(item = {}) {
  return {
    summary: compactText(item.summary, 220),
    audience: compactText(item.audience, 180),
    source: compactText(item.source || item.section, 80),
    metric: compactText(item.metric, 80),
  };
}

function buildArticleInput(issue, sections) {
  return {
    date: issue.date,
    issueUrl: issue.issueUrl,
    scanTotal: issue.scanTotal,
    validTotal: issue.validTotal,
    todayHotspot: itemForPrompt(issue.todayHotspot),
    sections: [...sections.entries()].map(([label, items]) => ({
      label,
      items: items.map(itemForPrompt),
    })),
  };
}

function resolveTitleRules() {
  const skillFile = path.join(RULES_DIR, "xinzhiyuan-title.md");
  const referenceFile = path.join(RULES_DIR, "xinzhiyuan-title-style.md");
  for (const file of [skillFile, referenceFile]) {
    if (!existsSync(file)) {
      throw new Error(
        `Missing vendored title rules: ${file}. Expected under wechat/references/ (see wechat/references/SOURCE.md).`
      );
    }
  }
  return { skillId: RULES_ID, skillDir: RULES_DIR, skillFile, referenceFile };
}

function readSkillContext(skillSource) {
  const skillText = readFileSync(skillSource.skillFile, "utf8");
  const referenceText = skillSource.referenceFile
    ? readFileSync(skillSource.referenceFile, "utf8")
    : "";
  return { skillText, referenceText };
}

function buildPrompt(articleInput, skillSource) {
  const { skillText, referenceText } = readSkillContext(skillSource);
  return [
    "你正在为 Hotspot 公众号日报生成标题候选。",
    "",
    "任务要求：",
    "- 按新智元风格生成 5-7 个中文标题候选。",
    "- 真实反映文章内容，不允许编造“刚刚、全球第一、首个、Nature、融资额、榜单、人名”等未给出的事实。",
    "- 优先突出 AI/科技实体、真实数字、动作、冲突和后果感。",
    "- recommendedTitle 必须来自 titles 里的 recommended 项。",
    "- 输出保持 JSON schema，不要输出 Markdown。",
    "",
    "以下是标题生成规则：",
    skillText,
    "",
    "以下是标题风格参考：",
    referenceText,
    "",
    "文章内容 JSON：",
    JSON.stringify(articleInput, null, 2),
  ].join("\n");
}

function mockTitlePackage(articleInput) {
  const primary = articleInput.todayHotspot.summary.includes("MCP")
    ? "MCP真凉了？Claude/Codex工作流变天，AI代理开始自己长手脚"
    : "AI工具链一夜换挡！开发者工作流重写，下一波红利要来了";
  return {
      recommendedTitle: primary,
      titles: [
        {
          title: primary,
          score: 9.6,
          recommended: true,
          technique: "实体+冲突+后果",
          clickAnalysis: "把 MCP、Claude、Codex 三个实体前置，再用“变天”制造行业后果感，符合新智元式压缩节奏。",
          sensitiveRisk: "中",
          revision: "如需更稳，可把“变天”改成“重写”。",
        },
        {
          title: "MCP真过时了？Claude/Codex分道扬镳，AI代理工作流被重做",
          score: 9.3,
          recommended: true,
          technique: "疑问钩子",
          clickAnalysis: "保留争议性疑问句，同时补上分歧和后果，适合日报封面标题。",
          sensitiveRisk: "低",
          revision: "",
        },
        {
          title: "Claude、Codex不再陪跑MCP！脚本派回潮，AI代理开始自己找工具",
          score: 9.1,
          recommended: true,
          technique: "对立转折",
          clickAnalysis: "用“不再陪跑”强化路线分化，强调代理自动找工具的能力变化。",
          sensitiveRisk: "中",
          revision: "如担心语气偏猛，可把“不再陪跑”改成“重新评估”。",
        },
        {
          title: "MCP路线被重估：Claude脚本派抬头，AI代理调度逻辑全变了",
          score: 8.8,
          recommended: false,
          technique: "路线重估",
          clickAnalysis: "更偏行业分析，信息密度高，但情绪张力稍弱。",
          sensitiveRisk: "低",
          revision: "",
        },
        {
          title: "140条AI热榜里，这场MCP争论最像下一代Agent工具链预演",
          score: 8.5,
          recommended: false,
          technique: "数据切入",
          clickAnalysis: "加入日报数据感，适合社群转发，但不如强实体标题直接。",
          sensitiveRisk: "低",
          revision: "",
        },
      ],
      recommendedBreakdowns: [
        {
          title: primary,
          guideWord: "MCP",
          coreWord: "Claude/Codex、工作流",
          modifierWord: "真、自己长手脚",
          emotionalWord: "变天",
          actionWord: "开始",
          structureAnalysis: "疑问句起手，实体并列后接强后果，属于典型新智元式三段压缩。",
          useCase: "适合把 MCP 争论作为当日主线、强调工具链迁移时使用。",
        },
        {
          title: "MCP真过时了？Claude/Codex分道扬镳，AI代理工作流被重做",
          guideWord: "MCP",
          coreWord: "Claude/Codex、工作流",
          modifierWord: "真过时了、分道扬镳",
          emotionalWord: "分道扬镳",
          actionWord: "被重做",
          structureAnalysis: "先抛问题，再给路线分裂和结果，适合技术读者快速判断是否点开。",
          useCase: "适合标题位偏理性、但仍需要冲击力时使用。",
        },
        {
          title: "Claude、Codex不再陪跑MCP！脚本派回潮，AI代理开始自己找工具",
          guideWord: "Claude、Codex",
          coreWord: "MCP、脚本派、AI代理",
          modifierWord: "不再陪跑、回潮",
          emotionalWord: "回潮",
          actionWord: "找工具",
          structureAnalysis: "实体开门见山，冲突后直接落到代理能力变化，适合工具链受众。",
          useCase: "适合面向 Agent / Codex / Claude 深度用户分发。",
        },
      ],
      sensitivityNotes: [
        {
          title: primary,
          expression: "变天",
          suggestion: "若需更稳，可改为“正在重写”或“被重估”。",
        },
      ],
    };
}

function extractOutputText(responseJson) {
  if (typeof responseJson.output_text === "string") return responseJson.output_text;
  const chunks = [];
  for (const item of responseJson.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && content.text) chunks.push(content.text);
    }
  }
  return chunks.join("");
}

function normalizeTitle(value = "") {
  return String(value)
    .replace(/^\s*(?:\d+[.、]\s*)?/, "")
    .replace(/^[\s*\-⭐️（）()]+/g, "")
    .replace(/\s+/g, "")
    .trim();
}

function validateTitlePackage(packageJson) {
  if (!packageJson || typeof packageJson !== "object") {
    throw new Error("Title generator returned an empty response.");
  }
  if (!Array.isArray(packageJson.titles) || packageJson.titles.length < 5) {
    throw new Error("Title generator must return at least 5 title candidates.");
  }

  packageJson.titles = packageJson.titles
    .map((item) => ({ ...item, title: normalizeTitle(item.title) }))
    .filter((item) => item.title)
    .sort((left, right) => Number(right.score || 0) - Number(left.score || 0));

  const recommended =
    packageJson.titles.find((item) => item.recommended)?.title ||
    packageJson.titles[0]?.title;
  packageJson.recommendedTitle = normalizeTitle(packageJson.recommendedTitle || recommended);

  if (!packageJson.titles.some((item) => item.title === packageJson.recommendedTitle)) {
    packageJson.recommendedTitle = recommended;
  }

  if (!packageJson.recommendedTitle) {
    throw new Error("Title generator did not return a usable recommended title.");
  }

  return packageJson;
}

async function callOpenAi(prompt, env = process.env) {
  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Missing OPENAI_API_KEY. Set OPENAI_API_KEY before running the WeChat build, or use WECHAT_TITLE_MOCK=1 only for tests."
    );
  }

  const model = env.WECHAT_TITLE_MODEL || DEFAULT_MODEL;
  const baseUrl = (env.OPENAI_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const response = await fetch(`${baseUrl}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "developer",
          content: [{ type: "input_text", text: prompt }],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "wechat_title_candidates",
          strict: true,
          schema: TITLE_SCHEMA,
        },
      },
    }),
  });

  const body = await response.text();
  if (!response.ok) {
    throw new Error(`OpenAI title generation failed: ${response.status} ${body}`);
  }

  const responseJson = JSON.parse(body);
  const outputText = extractOutputText(responseJson);
  if (!outputText) {
    throw new Error("OpenAI title generation returned no output text.");
  }

  return {
    model,
    packageJson: JSON.parse(outputText),
  };
}

function extractJsonObject(value = "") {
  const trimmed = value.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed;

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced) return fenced[1].trim();

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start !== -1 && end > start) return trimmed.slice(start, end + 1);
  return trimmed;
}

function resolveCodexBin(env = process.env) {
  if (env.CODEX_BIN) return env.CODEX_BIN;
  if (existsSync(CODEX_APP_BIN)) return CODEX_APP_BIN;
  return "codex";
}

function callCodex(prompt, env = process.env) {
  const tempDir = mkdtempSync(path.join(tmpdir(), "wechat-title-codex-"));
  const schemaPath = path.join(tempDir, "schema.json");
  const outputPath = path.join(tempDir, "response.json");
  writeFileSync(schemaPath, JSON.stringify(TITLE_SCHEMA, null, 2));

  const args = [
    "exec",
    "--ephemeral",
    "--sandbox",
    "read-only",
    "--output-schema",
    schemaPath,
    "--output-last-message",
    outputPath,
  ];
  if (env.WECHAT_TITLE_MODEL) {
    args.push("--model", env.WECHAT_TITLE_MODEL);
  }
  args.push("-");

  const codexPrompt = [
    "You are generating a final machine-readable response for a build script.",
    "Return only one JSON object matching the provided output schema.",
    "Do not write files, do not run commands, do not include Markdown fences.",
    "",
    prompt,
  ].join("\n");

  try {
    const result = spawnSync(resolveCodexBin(env), args, {
      input: codexPrompt,
      encoding: "utf8",
      env,
      cwd: process.cwd(),
      maxBuffer: 1024 * 1024 * 20,
    });

    if (result.status !== 0) {
      throw new Error(
        [
          "Codex title generation failed.",
          result.stderr,
          result.stdout,
        ].filter(Boolean).join("\n")
      );
    }

    const output = readFileSync(outputPath, "utf8");
    return {
      model: env.WECHAT_TITLE_MODEL || "codex",
      packageJson: JSON.parse(extractJsonObject(output)),
    };
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function renderTitleCandidatesMarkdown(titlePackage, metadata = {}) {
  const lines = [
    "# 为您生成的微信公众号爆款标题",
    "",
    `> 推荐使用标题：${titlePackage.recommendedTitle}`,
    "",
    "## 推荐标题",
    "",
  ];

  titlePackage.titles.forEach((item, index) => {
    const marker = item.recommended ? "⭐️ " : "";
    lines.push(`${index + 1}. ${marker}(${Number(item.score).toFixed(1)}分)`);
    lines.push(`### ${item.title}`);
    lines.push("");
  });

  lines.push("## 标题技巧与点击率分析");
  lines.push("");
  titlePackage.titles.forEach((item, index) => {
    lines.push(`${index + 1}. **${item.title}**：${item.technique} - ${item.clickAnalysis}`);
  });
  lines.push("");
  lines.push("## 推荐标题元素解构分析");
  lines.push("");

  titlePackage.recommendedBreakdowns.forEach((item) => {
    lines.push(`### ⭐️ ${item.title}`);
    lines.push("");
    lines.push(`- **引导词**：${item.guideWord}`);
    lines.push(`- **核心词**：${item.coreWord}`);
    lines.push(`- **修饰词**：${item.modifierWord}`);
    lines.push(`- **情感词**：${item.emotionalWord}`);
    lines.push(`- **行动词**：${item.actionWord}`);
    lines.push(`- **结构分析**：${item.structureAnalysis}`);
    lines.push(`- **使用场景**：${item.useCase}`);
    lines.push("");
  });

  lines.push("## 敏感内容提醒");
  lines.push("");
  if (titlePackage.sensitivityNotes.length) {
    lines.push("| 标题 | 潜在敏感表达 | 修改建议 |");
    lines.push("|---|---|---|");
    titlePackage.sensitivityNotes.forEach((note) => {
      lines.push(`| ${note.title} | ${note.expression} | ${note.suggestion} |`);
    });
  } else {
    lines.push("未发现明显敏感表达。发布前仍建议结合正文做人工复核。");
  }

  lines.push("");
  lines.push("## 生成信息");
  lines.push("");
  lines.push(`- 生成时间：${metadata.generatedAt || new Date().toISOString()}`);
  lines.push(`- 模型：${metadata.model || "mock"}`);
  if (metadata.skillId) lines.push(`- Skill：${metadata.skillId}`);
  if (metadata.skillDir) lines.push(`- Skill 路径：${metadata.skillDir}`);
  if (metadata.skillMode) lines.push(`- Skill 模式：${metadata.skillMode}`);
  if (metadata.date) lines.push(`- 文章日期：${metadata.date}`);
  if (metadata.issueUrl) lines.push(`- 原文链接：${metadata.issueUrl}`);
  lines.push("");

  return `${lines.join("\n")}\n`;
}

async function generateTitlePackage({ issue, sections, outputDir, env = process.env }) {
  const articleInput = buildArticleInput(issue, sections);
  const skillSource = resolveTitleRules();
  const prompt = buildPrompt(articleInput, skillSource);
  const generatedAt = new Date().toISOString();
  const provider = env.WECHAT_TITLE_MOCK === "1"
    ? "mock"
    : (env.WECHAT_TITLE_PROVIDER || "codex").toLowerCase();
  const result = provider === "mock"
    ? { model: "mock", packageJson: mockTitlePackage(articleInput) }
    : provider === "openai"
      ? await callOpenAi(prompt, env)
      : callCodex(prompt, env);

  const titlePackage = validateTitlePackage(result.packageJson);
  const markdown = renderTitleCandidatesMarkdown(titlePackage, {
    generatedAt,
    model: result.model,
    skillId: skillSource.skillId,
    skillDir: skillSource.skillDir,
    date: issue.date,
    issueUrl: issue.issueUrl,
  });

  if (outputDir) {
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(path.join(outputDir, "title-candidates.md"), markdown);
  }

  return {
    ...titlePackage,
    markdown,
    prompt,
    model: result.model,
    skill: skillSource,
  };
}

async function runCli() {
  const inputPath = process.argv[2];
  const outputDir = process.argv[3] || "";
  if (!inputPath) {
    throw new Error("Usage: node generate-title.mjs <article-input.json> [output-dir]");
  }
  const payload = JSON.parse(readFileSync(inputPath, "utf8"));
  const result = await generateTitlePackage({
    issue: payload.issue,
    sections: new Map(payload.sections),
    outputDir,
  });
  process.stdout.write(JSON.stringify(result, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCli().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

export {
  buildArticleInput,
  buildPrompt,
  generateTitlePackage,
  renderTitleCandidatesMarkdown,
  resolveTitleRules,
};
