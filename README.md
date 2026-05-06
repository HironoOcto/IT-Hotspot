# IT Hotspot

这是一个静态 IT Hotspot 网站项目。

站点有两个核心入口：

- `/`：默认打开最新一期 hotspot
- `/archive/`：往期归档页

每一期内容都单独放在 `archive/` 目录下，文件名格式固定为：

```text
archive/YYYY-MM-DD-hotspot.html
```

例如：

```text
archive/2026-05-05-hotspot.html
```

## 先看项目结构

```text
.
├── archive/
│   ├── 2026-05-04-hotspot.html
│   ├── 2026-05-05-hotspot.html
│   ├── 2026-05-06-hotspot.html
│   └── index.html
├── scripts/
│   └── generate-site.mjs
├── tests/
│   └── generate-site.test.mjs
├── index.html
├── robots.txt
├── sitemap.xml
├── vercel.json
├── pnpm-lock.yaml
└── package.json
```

平时只需要手动维护 `archive/YYYY-MM-DD-hotspot.html`。

下面这些文件不要手工改，统一由生成脚本产出：

- `archive/index.html`
- `index.html`
- `robots.txt`
- `sitemap.xml`
- `vercel.json`

重新生成它们，运行：

```bash
pnpm run build
```

## 第一次在新机器上开始

这个项目是纯静态站，不需要数据库，也不需要后端服务。

先把一个最重要的边界讲清楚：

- **Node.js**：需要。项目的构建和测试都靠它。
- **pnpm**：需要。项目现在统一用它跑命令。
- **corepack**：可选。它只是帮你更稳地拿到指定版本的 `pnpm`。
- **python3**：可选。它只是在本地临时起一个静态服务器，方便预览页面。

### 不同场景分别需要什么

| 场景 | 需要 | 不需要 |
| --- | --- | --- |
| 本地构建 / 测试 | `Node.js`、`pnpm` | `python3` |
| 本地浏览器预览 | `Node.js`、`pnpm`、任选一种静态服务器 | `corepack` |
| 部署到 Vercel | 仓库里有 `package.json` 和 `pnpm-lock.yaml` | `python3` |
| 部署到自己的服务器（只托管生成后的静态文件） | 静态文件服务能力 | `Node.js`、`pnpm`、`corepack`、`python3` |
| 部署到自己的服务器（服务器上现场构建） | `Node.js`、`pnpm` | `python3` |

### 先准备最少环境

当前约定是：

- 最低支持版本：`Node >= 20`
- 当前本地验证版本：`Node 24.x`
- Vercel 线上建议版本：`Node 24.x`

先确认 Node 已安装：

```bash
node -v
```

### 准备 pnpm

这个仓库已经正式声明使用 `pnpm`。

你有两种方式拿到它：

#### 方式一：用 corepack，推荐

`corepack` 是 Node 自带的包管理器启动器。它的作用不是“运行项目”，而是帮你准备正确版本的 `pnpm`。

如果你机器上有 `corepack`，执行：

```bash
corepack --version
corepack enable
corepack prepare pnpm@10.33.0 --activate
pnpm -v
```

#### 方式二：你已经自己装好了 pnpm

如果你的机器本来就已经有可用的 `pnpm`，那就直接确认版本：

```bash
pnpm -v
```

这种情况下，不需要额外执行 `corepack`。

### 安装项目环境

在项目根目录执行：

```bash
pnpm install
```

即使当前项目没有复杂依赖，仍然建议保留这一步，原因有三个：

- 让本地环境和锁文件保持一致
- 让后续新增依赖时流程不需要再改
- 让 Vercel、本地和协作者都走同一套工具入口

### 首次本地验证

先确认构建和测试没问题：

```bash
pnpm run build
pnpm test
```

如果你还想在浏览器里本地预览，再任选一种静态服务器。

#### 方案 A：用 Python 预览，最省事

`python3` 只在这里才会用到。它不是项目依赖，也不是部署依赖。

```bash
python3 -m http.server 8000
```

然后打开：

```text
http://localhost:8000
```

#### 方案 B：用你自己的静态服务器

如果你不想装 `python3`，也可以用任何你熟悉的本地静态服务器。只要能把项目根目录以 HTTP 方式跑起来就行。

## 每次更新一期内容后要做什么

如果你新增了一期，或者修改了某一期 HTML，按这个顺序走。

### 1. 把新一期文件放进 `archive/`

文件名必须保持这个格式：

```text
YYYY-MM-DD-hotspot.html
```

例如：

```text
archive/2026-05-07-hotspot.html
```

### 2. 重新生成站点文件

在项目根目录执行：

```bash
pnpm run build
```

这一步会自动完成这些事：

- 重新找出最新一期
- 更新首页 `index.html`
- 更新归档页 `archive/index.html`
- 更新 `sitemap.xml`
- 更新 `robots.txt`
- 更新 `vercel.json`
- 给每一期页面补充 SEO 信息

### 3. 跑测试

```bash
pnpm test
```

如果测试失败，先不要部署。常见原因是：

- 文件名格式不对
- 某一期 HTML 缺少 `hero-headline`
- 某一期 HTML 缺少 `hero-deck`
- 顶部统计字段结构被改了，导致生成脚本提取不到数据

### 4. 本地预览一遍

这一步只是为了在浏览器里看页面，不是构建必需步骤。

如果你已经有本地静态服务器，用你自己的就行；如果没有，最简单的方式是：

```bash
python3 -m http.server 8000
```

至少检查这三个页面：

- 首页 `/`
- 归档页 `/archive/`
- 最新一期页面

重点看：

- 首页是不是打开了最新一期
- 归档页里是不是出现了新的一期
- 归档页点击后能不能进入对应页面
- 每一期页面里的“往期热点”能不能回到归档页

### 5. 提交代码

建议把这些一起提交：

- 新增或修改的 `archive/YYYY-MM-DD-hotspot.html`
- 生成后的 `archive/index.html`
- 生成后的 `index.html`
- 生成后的 `sitemap.xml`
- 生成后的 `robots.txt`
- 生成后的 `vercel.json`
- `pnpm-lock.yaml`（如果它发生变化）

## 本地怎么跑起来

日常开发其实分两步：

### 第一步：构建和测试

```bash
pnpm run build
pnpm test
```

### 第二步：如果要在浏览器里预览，再起一个静态服务器

最简单的是：

```bash
python3 -m http.server 8000
```

然后打开：

```text
http://localhost:8000
```

额外说明：

- `http://localhost:8000/` 会打开最新一期
- `http://localhost:8000/archive/` 是归档页
- 双击 `index.html` 用 `file://` 也能看，但还是推荐走本地 HTTP 服务
- 如果你不用 `python3`，换成别的静态服务器也可以

## 常用命令

### 重新生成整个站点

```bash
pnpm run build
```

### 跑自动测试

```bash
pnpm test
```

### 用 Vercel CLI 预览部署

```bash
pnpm dlx vercel
```

### 发布到 Vercel 生产环境

```bash
pnpm dlx vercel --prod
```

## 为什么不是固定单一 Node 版本

这个项目没有复杂原生依赖，也没有重量级前端框架，所以没必要把本地开发环境锁死到唯一一个 Node 版本。

现在采用的是两层约束：

- 项目最低支持：`Node >= 20`
- 当前推荐和线上运行：`Node 24.x`

这样做的好处是：

- 新机器首跑门槛更低
- 协作者不用为了一个轻量静态站强行切唯一版本
- Vercel 线上仍然可以固定在 `24.x`，保证部署结果稳定

## 怎么部署到 Vercel

推荐用 Vercel 的 Git 集成方式。日常体验最省心：你 push 代码后，Vercel 会自动重新部署。

先说结论：

- **不需要 `python3`**
- **不需要你手动在 Vercel 上操作 `corepack`**

Vercel 只需要根据仓库内容完成构建。对这个项目来说，关键是：

- `package.json`
- `pnpm-lock.yaml`
- `pnpm run build`

### 方式一：在 Vercel 控制台部署

#### 1. 把仓库推到 GitHub、GitLab 或 Bitbucket

Vercel 通常是从 Git 仓库拉代码部署的。

#### 2. 在 Vercel 里导入项目

登录 Vercel 后：

1. 点击 **Add New...**
2. 选择 **Project**
3. 选择你的 Git 仓库

#### 3. 配置构建参数

如果 Vercel 让你填写这些项，按下面设置：

- **Framework Preset**：`Other`
- **Build Command**：`pnpm run build`
- **Output Directory**：留空
- **Node.js Version**：`24.x`

这个项目的生成结果直接写回仓库根目录和 `archive/`，所以不需要单独指定一个构建输出目录。

`pnpm-lock.yaml` 会帮助 Vercel 明确识别当前项目使用 `pnpm`。

#### 4. 点击部署

Vercel 会在构建时运行：

```bash
pnpm run build
```

部署完成后，Vercel 会给你一个默认域名。

### 绑定自定义域名 `hotspot.octohirono.dev`

部署成功后，在 Vercel 项目里：

1. 打开 **Settings**
2. 打开 **Domains**
3. 添加 `hotspot.octohirono.dev`
4. 按 Vercel 提示配置 DNS 记录

一般来说，Vercel 会告诉你需要添加哪条记录。按提示在你的 DNS 服务商后台配置即可。

### 以后怎么更新线上站点

如果已经接了 Git 自动部署，后续流程通常就是：

1. 新增或修改某一期 `archive/YYYY-MM-DD-hotspot.html`
2. 本地执行 `pnpm run build`
3. 本地执行 `pnpm test`
4. 提交并 push
5. 等 Vercel 自动部署完成

### 方式二：用 Vercel CLI 部署

如果你想从命令行部署，推荐直接用 `pnpm dlx`，不用全局安装：

```bash
pnpm dlx vercel
```

部署到生产环境：

```bash
pnpm dlx vercel --prod
```

CLI 部署前，也建议先在本地跑一遍：

```bash
pnpm run build
pnpm test
```

如果你确实更习惯全局安装，也可以自行安装 Vercel CLI，但不建议把它作为仓库默认流程。

## 部署到自己的服务器时需要什么

这里要分两种情况。

### 情况一：你先在本地构建，再把生成后的静态文件传到服务器

这种方式下，服务器只负责托管静态文件。

服务器通常不需要：

- `Node.js`
- `pnpm`
- `corepack`
- `python3`

你只需要把这些生成后的文件部署上去：

- `archive/`
- `index.html`
- `robots.txt`
- `sitemap.xml`
- `vercel.json` 以外你实际需要的静态文件

### 情况二：服务器自己拉代码并现场构建

这种方式下，服务器需要：

- `Node.js`
- `pnpm`

服务器通常仍然不需要：

- `python3`

`corepack` 也不是必须的；它只是你在服务器上安装或管理 `pnpm` 的一种方式。

## 这套生成机制依赖什么

生成脚本会从每一期 HTML 里提取这些字段：

- `hero-headline`
- `hero-deck`
- 顶部三项统计：
  - `条扫描`
  - `条有效`
  - `个跨平台事件`

如果你后面改了期刊页面模板，记得同时确认 `scripts/generate-site.mjs` 还能正确提取这些内容。

## 遇到问题先看哪里

### 归档页没更新

先确认你有没有执行：

```bash
pnpm run build
```

### 首页没跳到最新一期

先看生成后的 `vercel.json` 和根目录 `index.html` 是否已经更新。

### 测试失败

优先检查：

- 文件名格式
- `hero-headline`
- `hero-deck`
- 顶部统计结构

### Vercel 部署后页面不对

优先检查：

- Vercel 的 **Build Command** 是否是 `pnpm run build`
- Vercel 的 **Node.js Version** 是否设置为 `24.x`
- 你 push 上去的仓库里是否包含最新一期 HTML
- 构建日志里有没有生成脚本报错
