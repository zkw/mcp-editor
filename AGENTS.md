# AGENTS.md

本项目用于实现基于锚点补全（anchor-completion）的 MCP 编辑服务。

## 打包命令

使用 Bun 打包当前工作区为 `.tgz` 包：

```bash
bun pm pack --filename mcp-anchor-shell-0.1.0.tgz
```

该命令会根据 `package.json` 中的 `files` 字段和项目根目录内容生成 tarball。

## 说明

- 打包后的文件名应与 `package.json` 中的 `name` 和 `version` 保持一致。
- 若需要更改输出目录，可在命令中添加 `--destination <dir>`。
