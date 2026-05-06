# IT Hotspot

这是一个静态 IT Hotspot 网站项目。

站点对外只有 3 类页面：

- `/`：默认跳到最新一期
- `/archive/`：往期归档页
- `/archive/YYYY-MM-DD-hotspot.html`：单期页面

## 项目结构

```text
.
├── archive/
│   ├── 2026-05-04-hotspot.html
│   ├── 2026-05-05-hotspot.html
│   └── 2026-05-06-hotspot.html
├── public/                  # 构建产物，不提交到 Git
├── scripts/
│   └── generate-site.mjs
├── tests/
│   └── generate-site.test.mjs
├── package.json
├── pnpm-lock.yaml
└── vercel.json
```

你平时真正手工维护的，只有 `archive/YYYY-MM-DD-hotspot.html` 这些源码文件。

下面这些内容都由构建脚本自动生成：

- `public/index.html`
- `public/archive/index.html`
- `public/archive/YYYY-MM-DD-hotspot.html`
- `public/sitemap.xml`
- `public/robots.txt`
- `vercel.json`

## 先讲清楚几个工具到底是干嘛的

### Node.js

需要。

这个项目的构建脚本和测试都是 Node 跑的，所以本地开发、Vercel 构建、以及“服务器上现场构建”都需要 Node。

### pnpm

需要。

这个仓库统一用 `pnpm` 作为包管理器和命令入口，所以本地执行时都用：

```bash
pnpm install
pnpm run build
pnpm test
```

### corepack

可选。

`corepack` 不是项目依赖，也不是部署依赖。它只是 Node 自带的一个“包管理器启动器”，用来更稳地帮你拿到仓库声明的 `pnpm` 版本。

如果你机器上已经有可用的 `pnpm`，可以直接用，不一定非要先跑 `corepack`。

### python3

可选。

它只用于“本地预览生成后的静态页面”。不是项目依赖，也不是 Vercel 部署依赖。

如果你不用 `python3`，换成任何能把 `public/` 跑成 HTTP 静态站的工具都可以。

## 版本约定

- 最低支持：`Node >= 20`
- 当前本地验证与线上推荐：`Node 24.x`
- 包管理器：`pnpm@10.33.0`

之所以不是把本地 Node 锁死到唯一一个小版本，是因为这个项目是轻量静态站，没有复杂原生依赖；但线上还是建议固定到 `24.x`，这样部署结果更稳定。

## 第一次在新机器上开始

### 1. 安装 Node.js

先确认可用：

```bash
node -v
```

### 2. 准备 pnpm

推荐方式是用 `corepack`：

```bash
corepack enable
corepack prepare pnpm@10.33.0 --activate
pnpm -v
```

如果你本机已经装好了可用的 `pnpm`，也可以直接：

```bash
pnpm -v
```

### 3. 安装项目依赖

```bash
pnpm install
```

即使当前依赖很少，这一步也建议保留，因为它能保证本地环境、锁文件和 Vercel 使用的是同一套入口。

### 4. 首次验证

```bash
pnpm run build
pnpm test
```

### 5. 本地预览

如果你想在浏览器里看效果，启动一个静态服务器指向 `public/`。

最简单的方式：

```bash
python3 -m http.server 8000 --directory public
```

然后打开：

```text
http://localhost:8000
```

这时：

- `/` 会打开最新一期
- `/archive/` 是归档页
- 单期页面都在 `/archive/YYYY-MM-DD-hotspot.html`

## 每次更新一期后要做什么

这是最重要的日常流程。

### 1. 新增或修改一期源码

文件名必须保持：

```text
archive/YYYY-MM-DD-hotspot.html
```

例如：

```text
archive/2026-05-07-hotspot.html
```

### 2. 重新生成站点

```bash
pnpm run build
```

这一步会自动：

- 识别最新一期
- 生成 `public/` 下全部静态页面
- 给单期页面补 canonical 和 meta description
- 更新根目录 `vercel.json`，让 `/` 指向最新一期

### 3. 跑测试

```bash
pnpm test
```

如果失败，常见原因通常是：

- 文件名格式不对
- 某一期缺少 `hero-headline`
- 某一期缺少 `hero-deck`
- 顶部统计字段结构被改了，脚本提取不到

### 4. 本地预览一下 `public/`

```bash
python3 -m http.server 8000 --directory public
```

建议至少看：

- 首页 `/`
- 归档页 `/archive/`
- 最新一期详情页

重点检查：

- 首页是不是去了最新一期
- 归档页是不是出现了新一期
- 归档链接是否正常
- 单期页里的“往期热点”是否能返回归档页

### 5. 提交代码

通常要提交的是：

- 新增或修改的 `archive/YYYY-MM-DD-hotspot.html`
- 更新后的 `vercel.json`
- 你手动改过的脚本、测试、文档

通常不要提交的是：

- `public/`
- `node_modules/`

`public/` 是构建产物，`node_modules/` 是安装产物，这两类都应该由本地或 Vercel 重新生成。

## 常用命令

### 安装依赖

```bash
pnpm install
```

### 构建站点

```bash
pnpm run build
```

### 跑测试

```bash
pnpm test
```

### 本地预览

```bash
python3 -m http.server 8000 --directory public
```

### Vercel 预览部署

```bash
pnpm dlx vercel
```

### Vercel 生产部署

```bash
pnpm dlx vercel --prod
```

## 怎么部署到 Vercel

推荐用 Git 集成方式。你 push 代码后，Vercel 会自动重新构建和部署。

### Vercel 需要什么

Vercel 需要的是：

- `package.json`
- `pnpm-lock.yaml`
- `vercel.json`
- `pnpm run build`

Vercel 不需要的是：

- `python3`
- 你手动执行 `corepack`
- 上传 `node_modules/`
- 上传 `public/`

### 推荐配置

在 Vercel Project Settings 里，按下面设置：

- `Framework Preset`: `Other`
- `Build Command`: `pnpm run build`
- `Output Directory`: `public`
- `Node.js Version`: `24.x`

### 部署流程

日常线上更新通常就是：

1. 修改或新增 `archive/YYYY-MM-DD-hotspot.html`
2. 本地执行 `pnpm run build`
3. 本地执行 `pnpm test`
4. 提交并 push
5. 等 Vercel 自动部署

### 为什么这个项目和 `ai-html` 不一样

你的另一个项目 `ai-html` 可以不需要 `public/`，是因为它本质上是“零构建纯静态站”，Vercel 直接把仓库根目录拿去服务。

这个 `IT-Hotspot` 项目不一样，它有构建步骤：

- 要从现有 issue HTML 里提取元数据
- 要生成归档页
- 要生成 sitemap 和 robots
- 要更新首页跳转目标

所以这里更合适的做法是：

- 源码留在仓库里
- 构建时统一产出到 `public/`
- Vercel 只部署 `public/`

这样 Vercel 的行为最稳定，仓库也更干净。

## 如果部署到自己的服务器

分两种情况：

### 方式一：本地先构建，再上传静态文件

这时服务器只需要托管静态文件。

你本地执行：

```bash
pnpm run build
```

然后把 `public/` 里的内容部署到你的静态服务器即可。

这种方式下，服务器通常不需要：

- `Node.js`
- `pnpm`
- `corepack`
- `python3`

### 方式二：服务器上现场构建

这时服务器需要：

- `Node.js`
- `pnpm`

通常不需要：

- `python3`

`corepack` 仍然只是可选工具，不是必须。

## 一个很常见的问题

### 要把 `node_modules/` 上传到 GitHub 吗

不要。

原因很简单：

- 体积大
- 变化噪音多
- 不同环境可以重新安装
- Vercel 会自己根据 `package.json` 和 `pnpm-lock.yaml` 安装依赖

这个仓库应该提交的是“源码和配置”，不是“安装结果”。
