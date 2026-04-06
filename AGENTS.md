# AGENTS.md

本项目用于实现基于锚点补全（anchor-completion）的 MCP 编辑服务。

使用说明：

1. 生成 tarball：
   - 运行 `bun pm pack --filename mcp-anchor-shell-0.1.0.tgz`。
   - 该命令会在当前目录生成名为 `mcp-anchor-shell-0.1.0.tgz` 的包文件。

2. 安装包：
   - 如果正常安装，执行 `bun install -g ./mcp-anchor-shell-0.1.0.tgz`。
   - 如果遇到相对路径解析错误，请改用绝对路径：
     `bun install -g /full/path/mcp-anchor-shell-0.1.0.tgz`。

3. 注意事项：
   - 确保 tarball 包文件已成功生成。
   - 确认使用的路径与文件名都正确。
   - 若安装仍失败，请检查当前目录和文件权限。
