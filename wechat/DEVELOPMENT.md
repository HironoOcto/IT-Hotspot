
## 本地生成公众号每日热点

公众号生成逻辑放在根目录下的 `wechat/` 本地工作区里。`wechat/` 已被 Git 忽略，用于避免污染 Hotspot 发布项目。

公众号工具读取已经生成好的单期源码：

```text
archive/YYYY-MM-DD-hotspot.html
```

然后在本地生成：

```text
wechat/articles/YYYY-MM-DD/daily-hotspots.md
wechat/articles/YYYY-MM-DD/daily-hotspots.html
wechat/articles/YYYY-MM-DD/draft-body.html
wechat/articles/YYYY-MM-DD/draft-manifest.json
wechat/articles/YYYY-MM-DD/title-candidates.md
wechat/articles/YYYY-MM-DD/YYYY-MM-DD-cta.png
```

这些文件用于公众号发布，不参与 Hotspot 网站构建，也不会提交到 GitHub。

`title-candidates.md` 记录标题生成 prompt 产出的候选标题、评分、推荐理由、推荐标题拆解和敏感内容提醒，并写明本次实际使用的 skill 名称与路径。构建会把首推标题写入 `daily-hotspots.html` 的 `<title>` 标签，但不会把该标题写进 HTML 的 `<main>` 正文。

标题生成由 `wechat/scripts/generate-title.mjs` 完成，标题规则**内置在 `wechat/references/`**（vendored 自 `qiaomu-xinzhiyuan-title`，MIT，出处见 `wechat/references/SOURCE.md`），随 `wechat/` 一起提交、跨机器 clone 即用，无需安装外部 skill。生成时通过本机已登录的 `codex exec`（或 OpenAI API）产出候选标题。

新增的草稿产物约定如下：

- `draft-body.html`：外层已转换为 `<section>` 的公众号可粘贴正文，不包含文末本地 CTA 图片。
- `draft-manifest.json`：供自动化发布使用的结构化元信息，包含标题、作者、来源说明、合集、原文链接、CTA 图片路径和封面图裁切规则。封面应从 masthead 顶部粗双横开始，裁到「今日焦点」标题之前，并保持 `1187:507` 比例；建议截图视口至少 `1600x900`。
- `scripts/publish-draft.mjs`：自动消费草稿产物，上传正文图片和封面 thumb，并调用公众号 `draft/add` 接口创建草稿。

可用 `WECHAT_TITLE_MODEL` 覆盖模型；如需改用 OpenAI API，可设置 `WECHAT_TITLE_PROVIDER=openai` 和 `OPENAI_API_KEY`。如需更新标题规则，从上游仓库同步 `wechat/references/` 下两个 md 文件即可。

### 准备公众号工具依赖

```bash
cd wechat
pnpm install
```

### 生成最新一期

```bash
cd wechat
pnpm run build
```

### 生成指定日期

```bash
cd wechat
pnpm run build -- --date 2026-05-31
```

### 测试公众号工具

```bash
cd wechat
pnpm test
```

### 自动建公众号草稿

公众号开放接口凭证按优先级读取：`--credentials <path>` > 环境变量 `WECHAT_APP_ID`/`WECHAT_APP_SECRET`（推荐，跨机器不落盘）> 默认文件 `wechat/wechat-credentials.txt`（兼容旧名 `wechat/tmp.txt`）。凭证含密钥，已在 `.gitignore` 忽略，切勿提交。

文件格式支持：

```text
AppID=wx...
AppSecret=...
```

然后执行：

```bash
cd wechat
pnpm run publish:draft -- --date 2026-07-11
```

如果要继续走开放接口发布提审：

```bash
pnpm run publish:draft -- --date 2026-07-11 --submit
```

实现细节：

- 自动草稿内容使用 `draft-manifest.json` 里的 `sectionHtml`，因为它保留了文末 CTA 图片
- `draft-body.html` 仍然保留给人工粘贴场景使用
- 本地正文图片通过 `media/uploadimg` 上传后回填微信图片 URL
- 封面图通过 `material/add_material?type=thumb` 上传，因此脚本会先把 cover 转成小体积 JPG
- 当前开放接口没有独立 `合集` 字段，也没有单独的 `素材来源/作者提示` 字段；脚本暂将来源说明写入 `digest`

### wechat 一键总控脚本

`wechat/scripts/run-hotspot-pipeline.mjs` 负责把上游 hotspot 生成、站点归档推送和公众号发草稿串起来。

默认 dry-run：

```bash
cd /Users/linling/Documents/code/ai/IT-Hotspot/wechat
pnpm run publish:hotspot -- --date 2026-07-11
```

真实执行：

```bash
cd /Users/linling/Documents/code/ai/IT-Hotspot/wechat
pnpm run publish:hotspot -- --date 2026-07-11 --run
```

关键行为：

- 上游 `openclaw-workspace` 路径按优先级解析，跨机器免改代码：`--upstream-root <path>` > `UPSTREAM_ROOT` 环境变量 > 同级 `../openclaw-workspace` > 内置默认值。运行前会校验该路径存在且含 `workspace-kol/memory`，否则报错提示。
- `--skip-pull`：跳过上游 `git pull origin main`。在**扫描机上同机运行**时用它——数据本地现成，且上游多半有未提交改动，不宜再 pull。例：`UPSTREAM_ROOT=/Users/luckyclaw/.openclaw pnpm run publish:hotspot -- --date 2026-07-11 --run --skip-pull`
- 拉取上游最新数据后，会先做两道数据校验：① 读 `workspace-kol/memory/YYYY-MM-DD-run-report.json`（缺失时回退同名 `.md`），`overall_status` 或任一 phase 非 `success` 就失败并列出问题 phase（例如 `overall=running, phase5=running`）；② 直接扫 `YYYY-MM-DD-scan.md`，若还残留 `<TODO_LLM:...>` 占位符就失败并按类型统计数量（作为 run-report 与 scan.md 不一致时的兜底）。这从源头拦下 scan.md 全是占位的坏数据；加 `--skip-verify` 可跳过这两步
- 只要发现 `IT-Hotspot` 工作区里有除目标 `archive/YYYY-MM-DD-hotspot.html` 之外的未提交改动，就会直接失败
- 如果当天 archive 文件已存在且内容与新生成结果完全一致，会继续后续流程，不重复覆盖
- 如果当天公众号草稿已经创建成功，会读取 `wechat/articles/YYYY-MM-DD/publish-result.json`，默认跳过重复发稿
- 该脚本不会尝试自动补 UI-only 的公众号字段，例如合集、原创开关和创作来源

公众号正文会做二次编排：

- 「今日热点」来自当期页面的首屏热点
- 「今日焦点 TOP 3」会排除今日热点后重新补足 3 条
- 不显示「跨平台热点」栏目
- 空栏目不显示
- 优先用「行业热点」补足到 8 条左右
- 每条热点使用「一句话概述 / 原文摘录 / 受众观点 / 数据」
- 文末生成完整热榜入口和 CTA 图片

如果你只是在发布 Hotspot 网站，不需要进入 `wechat/`，也不需要运行公众号工具。
