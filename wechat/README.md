# Hotspot 公众号生成工具

这个目录是 Hotspot 的本地公众号生成工作区，用来从已经发布的每日热榜 HTML 生成公众号草稿。

`wechat/` 已经被 Git 忽略，不会提交到 GitHub，也不会影响 Hotspot 网站的发布流程。根项目仍然只负责生成和发布站点。

## 安装依赖

在 `wechat/` 目录下运行：

```bash
pnpm install
```

CTA 图片会先生成 SVG，再转成 PNG。macOS 下默认使用系统自带的 `sips` 转换；如果不在 macOS 上，可以安装 `rsvg-convert`，脚本会自动使用它作为兜底。

## 生成最新一期

标题生成由 `wechat/scripts/generate-title.mjs` 完成。**标题规则已内置（vendored）在 `wechat/references/`**（来源见 [`wechat/references/SOURCE.md`](references/SOURCE.md)），随本目录一起提交，任何机器 clone 即用，**无需再安装外部 skill**。它默认通过本机已登录的 Codex CLI 生成候选标题，不需要额外设置 API key。先确认 `codex` 命令可用：

```bash
codex --version
```

如果你同时安装了多个 Codex CLI，脚本会优先使用 Codex.app 自带的 CLI。也可以手动指定：

```bash
export CODEX_BIN=/Applications/Codex.app/Contents/Resources/codex
```

如需指定模型，可以设置：

```bash
export WECHAT_TITLE_MODEL=gpt-5-mini
```

如需更新标题规则，从上游仓库同步 `wechat/references/` 下两个 md 文件即可（详见 `SOURCE.md`）。

如果你想改用 OpenAI API 而不是 Codex CLI，可以设置：

```bash
export WECHAT_TITLE_PROVIDER=openai
export OPENAI_API_KEY=你的 key
```

在 `wechat/` 目录下运行：

```bash
pnpm run build
```

脚本会读取 `../archive/` 里的最新一期：

```text
../archive/YYYY-MM-DD-hotspot.html
```

然后生成本地公众号发布文件：

```text
articles/YYYY-MM-DD/daily-hotspots.md
articles/YYYY-MM-DD/daily-hotspots.html
articles/YYYY-MM-DD/draft-body.html
articles/YYYY-MM-DD/draft-manifest.json
articles/YYYY-MM-DD/title-candidates.md
articles/YYYY-MM-DD/YYYY-MM-DD-cta.png
articles/YYYY-MM-DD/YYYY-MM-DD-cta.svg
```

`title-candidates.md` 会记录标题生成 prompt 产出的候选标题、评分、推荐理由、推荐标题拆解和敏感内容提醒，并写明本次实际使用的 skill 名称与路径。构建会把首推标题写入 `daily-hotspots.html` 的 `<title>` 标签，但不会把它写进 HTML 的 `<main>` 正文。

构建现在还会额外产出一套“发草稿载荷”：

- `draft-body.html`：可直接粘贴到公众号编辑器的正文 HTML，外层标签已经从 `<main>` 改成 `<section>`，并移除了文末本地 CTA 图片，方便后续单独上传后插入。
- `draft-manifest.json`：自动化发布元信息，包含标题、作者名、素材来源说明、文章集合、原文链接、CTA 图片路径，以及封面图规则。封面不是死卡固定截图框，而是按 `1187:507` 比例，从 masthead 顶部粗双横开始，裁到「今日焦点」标题之前；建议截图视口至少 `1600x900`。

## 生成指定日期

在 `wechat/` 目录下运行：

```bash
pnpm run build -- --date 2026-05-31
```

日期必须对应 `../archive/` 中已经存在的单期文件，例如：

```text
../archive/2026-05-31-hotspot.html
```

## 运行测试

在 `wechat/` 目录下运行：

```bash
pnpm test
```

测试会使用 mock 标题生成，不会调用 Codex 或网络模型。

测试会把已发布的单期 HTML 复制到临时目录，并验证公众号文章规则：

- 生成 Markdown、HTML、标题候选文件和 CTA PNG 文件
- 产物写入 `articles/YYYY-MM-DD/`
- HTML 的 `<title>` 使用标题生成器首推标题
- 文章从「今日头条」开始
- 重新计算「今日焦点 TOP 3」，不重复今日热点
- 不显示「跨平台热点」栏目
- 行业热点输出 6 条，可选栏目最多 3 条
- `publish:draft` 会读取凭证、替换正文本地图片、准备封面 thumb，并组装 `draft/add` payload

## 发布到公众号

1. 确认本机已登录 Codex CLI：

   ```bash
   codex --version
   ```

2. 生成指定日期的文章：

   ```bash
   pnpm run build -- --date YYYY-MM-DD
   ```

3. 打开当天目录下生成的标题候选文件，确认或手动改标题：

   ```text
   articles/YYYY-MM-DD/title-candidates.md
   ```

4. 打开当天目录下生成的 Markdown 或 HTML：

   ```text
   articles/YYYY-MM-DD/daily-hotspots.md
   articles/YYYY-MM-DD/daily-hotspots.html
   ```

5. 将正文粘贴到微信公众号编辑器。

6. 上传或插入生成的 CTA 图片：

   ```text
   articles/YYYY-MM-DD/YYYY-MM-DD-cta.png
   ```

7. 将文末「阅读原文」设置为对应的 Hotspot 单期链接：

```text
https://hotspot.octohirono.dev/archive/YYYY-MM-DD-hotspot.html
```

如果你准备让 Codex 帮你自动发草稿，优先把下面两份文件作为输入：

```text
articles/YYYY-MM-DD/draft-body.html
articles/YYYY-MM-DD/draft-manifest.json
```

其中 `draft-manifest.json` 里已经固定了这套发布规则：

- 原创作者名：`十四行手稿`
- 素材来源：`素材来源官方媒体/网络新闻，文中事件发生于前一天`
- 文章集合：`IT-Hotspot`
- 原文链接：`https://hotspot.octohirono.dev/archive/YYYY-MM-DD-hotspot.html`
- 封面图：从同一期归档页顶部截图，起点对齐 masthead 顶部粗双横，终点停在「今日焦点」标题之前，按 `1187:507` 比例裁切

### 自动创建草稿

先把公众号开放接口凭证放到：

```text
wechat/tmp.txt
```

格式支持这两种：

```text
AppID=wx...
AppSecret=...
```

或

```text
AppID: wx...
AppSecret: ...
```

然后执行：

```bash
cd wechat
pnpm run publish:draft -- --date YYYY-MM-DD
```

脚本会自动完成：

- 读取 `draft-manifest.json` 和 `draft-body.html` 对应的发布信息
- 使用公众号 `stable_token` 接口换取 access token
- 上传正文里的本地图片到公众号图库，并替换成微信返回的图片 URL
- 将封面图转成公众号 `thumb` 需要的 JPG 小图后上传
- 调用 `draft/add` 创建新草稿

如果你还想直接触发发布提审，可以追加：

```bash
pnpm run publish:draft -- --date YYYY-MM-DD --submit
```

当前已知接口边界：

- `合集`：公众号开放接口没有独立的合集字段，脚本暂时不能自动塞进 `IT-Hotspot`
- `素材来源/作者提示`：开放接口也没有单独字段，脚本当前把这句说明写进 `digest`

### 一键全自动流程

`wechat/` 目录下还提供了一条总控脚本，用来串起：

- 上游 workspace 拉取最新代码
- 校验当天扫描数据是否有效（双保险）：① 读 `YYYY-MM-DD-run-report.json`（缺失时回退 `.md`），若 `overall_status` 或任一 phase 非 `success` 则失败并列出问题 phase；② 直接扫 `YYYY-MM-DD-scan.md`，若还残留 `<TODO_LLM:...>` 占位符（例如 7-31 那次 phase5 卡在 `running`、scan.md 有 680 个占位）则失败并统计占位类型。任一不过即拒绝发布
- 生成当天 `hotspot.html`
- 移动到当前项目 `archive/`
- 自动 `git add / commit / push origin main`
- 等待 5 秒让线上归档生效
- 生成当天公众号稿件
- 创建公众号草稿

默认是 dry-run：

```bash
cd /Users/linling/Documents/code/ai/IT-Hotspot/wechat
pnpm run publish:hotspot -- --date 2026-07-11
```

真正执行：

```bash
cd /Users/linling/Documents/code/ai/IT-Hotspot/wechat
pnpm run publish:hotspot -- --date 2026-07-11 --run
```

如需在数据校验失败时强行发布（例如已确认 run-report 误报、或手动修复过 scan.md），可加 `--skip-verify` 跳过校验：

```bash
cd /Users/linling/Documents/code/ai/IT-Hotspot/wechat
pnpm run publish:hotspot -- --date 2026-07-11 --run --skip-verify
```

### 指定上游 openclaw-workspace 路径（跨机器）

脚本按以下优先级确定上游 `openclaw-workspace` 的位置，方便在不同机器上跑而无需改代码：

1. `--upstream-root <path>` 命令行参数（最高优先级）
2. `UPSTREAM_ROOT` 环境变量（常驻/自动化机器推荐，设一次即可）
3. 与本仓库同级的 `../openclaw-workspace`（存在则自动使用）
4. 内置默认值（保证开发机不改也能跑）

在**扫描机上直接跑**（上游数据本地现成，用 `--skip-pull` 跳过 `git pull`）：

```bash
export UPSTREAM_ROOT=/Users/luckyclaw/.openclaw
cd <IT-Hotspot>/wechat
pnpm run publish:hotspot -- --date 2026-07-11 --run --skip-pull
```

- 运行前会先校验上游路径是否存在、是否含 `workspace-kol/memory`；不存在直接报错并提示设置 `UPSTREAM_ROOT` / `--upstream-root`。
- `--skip-pull`：跳过上游 `git pull origin main`，直接用本地扫描数据（同机运行时上游多半有未提交改动，不宜再 pull）。

这个总控脚本的幂等规则：

- 拉取上游后会先校验当天数据：run-report 任一 phase 非 `success`，或 scan.md 残留 `<TODO_LLM:...>` 占位符，都会直接失败（可用 `--skip-verify` 跳过）
- 如果 `archive/YYYY-MM-DD-hotspot.html` 已存在且内容一致，会复用，不重复覆盖
- 如果仓库里有除当天 archive 文件以外的未提交改动，会直接失败并说明原因
- 如果当天公众号草稿已经成功创建，默认不会重复再发一篇，而是跳过发稿步骤
- 当天的发稿结果会记录到 `wechat/articles/YYYY-MM-DD/publish-result.json`

## 注意事项

- `wechat/` 是本地发布工作区，保持 Git 忽略即可。
- 公众号工具只读取已发布的单期 HTML，不会修改 `../archive/`、`../public/`、`../vercel.json`，也不会影响 Hotspot 网站构建。
- 标题规则内置在 `wechat/references/`（vendored 自 `qiaomu-xinzhiyuan-title`，MIT，见 `SOURCE.md`），随 `wechat/` 一起提交、跨机器 clone 即用，无需安装外部 skill。引擎为 `wechat/scripts/generate-title.mjs`。
- 若机器上有多个 Codex CLI，可用 `CODEX_BIN` 指定路径。
- 公众号里使用 `.png` CTA 图片。
- `.svg` CTA 文件是可编辑的设计源，方便以后调整卡片样式，不需要上传到公众号。
- 自动发草稿依赖公众号开放接口权限，以及 `AppID`/`AppSecret` 可正常换取 `stable_token`。
- 封面 `thumb` 由微信接口要求必须是较小的 JPG；脚本会在本机用 macOS 自带 `sips` 自动压缩转换。
