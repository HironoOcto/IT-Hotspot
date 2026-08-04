# 标题规则来源

`xinzhiyuan-title.md` 与 `xinzhiyuan-title-style.md` 内置（vendored）自开源 skill
`qiaomu-xinzhiyuan-title`，供 `wechat/scripts/generate-title.mjs` 作为标题生成规则读取。

- 来源仓库：https://github.com/joeseesun/qiaomu-xinzhiyuan-title
- 许可证：MIT License
- Copyright (c) 2026 向阳乔木

内置的目的：让 `wechat/` 标题生成自包含、跨机器 clone 即用，无需在目标机另装外部 skill。
如需更新规则，从上游仓库同步这两个文件即可。
