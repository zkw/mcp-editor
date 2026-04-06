`write` 工具用于写入或更新文件内容。它支持两种模式：全量覆盖与基于 `......` 占位符的局部更新。

> **核心原则**：请优先使用本工具进行代码变更。严禁使用 Bash 工具（如 `sed`、`echo`、`cat`）修改源码，以保障写入一致性。

## 1. 全量覆盖（不含占位符）
当 `template` 中不包含 `......` 时，工具将执行全量写入，直接覆盖目标文件。适用于新建文件或几行代码的极小文件。
* **absolutePath**: 目标文件的绝对路径。
* **template**: 完整的文件内容。

## 2. 锚点局部更新（包含 `......`）
对于中大型文件，你无需重新生成未修改的代码。使用 6 个连续半角句号 `......` 作为占位符，工具会自动从源文件中提取并补全省略的内容。

### 2.1 占位符使用法则（极度严格）
为了让工具精准定位你的修改位置，你必须在 `......` 的上方和下方提供**原封不动**的上下文代码（即“锚点”）。

1.  **长度底线（$\ge$ 80字符）**：`......` 的紧邻上方和下方，**必须各自保留至少 80 个字符（约 3-4 行）的原始代码**。如果你提供的原始上下文过短，工具将拒绝执行。
2.  **100% 像素级一致**：作为锚点的原始代码，其缩进、空格、换行符必须与源文件**完全相同**。任何微小的排版偏差（例如将源文件的 4 个空格改成了 Tab，或擅自删除了空行），都会导致匹配失败并报错。
3.  **全局唯一**：你保留的上下文片段必须在整个文件中是唯一的。避免仅使用 `{`、`}` 或 `return;` 这种随处可见的样板代码。
4.  **格式固定**：只能是 `......`（6个点），禁止包含多余的点或使用全角标点。在一个文件中可以使用多个 `......` 进行多处修改。

### 2.2 正确的修改范例

**假设源文件（`src/tax.ts`）如下：**
```typescript
import { Logger } from "./logger";

export function initSystem() {
    Logger.info("System initializing...");
    connectDatabase();
}

export function calculateTax(amount: number) {
    const taxRate = 0.05;
    return amount * taxRate;
}

export function cleanup() {
    Logger.info("Cleanup...");
}
```

**你的任务**：仅将 `taxRate = 0.05` 修改为 `0.08`。

**正确的工具调用：**
```json
{
  "absolutePath": "/abs/path/src/tax.ts",
  "template": "export function initSystem() {\n    Logger.info(\"System initializing...\");\n    connectDatabase();\n}\n\n......\n\nexport function calculateTax(amount: number) {\n    const taxRate = 0.08;\n    return amount * taxRate;\n}\n\nexport function cleanup() {\n    Logger.info(\"Cleanup...\");\n}\n"
}
```
*💡 解析：模板中包含了你需要修改的目标函数（`calculateTax`），并在 `......` 两侧保留了足够长的、一字不差的原始函数（`initSystem` 和 `cleanup`）作为定位锚点。*

### 2.3 错误排查指南

如果工具返回错误，请根据以下情况立即自我修正：

* **报错 `Anchor length < 80 characters` (上下文不足)**：
    * **原因 1**：你提供的原始代码太短。
    * **原因 2（最常见）**：你在原始代码中**擅自修改了缩进或空格**，导致工具在逐字比对时提早中断，截取到的有效匹配长度不足 80 字符。
    * **对策**：请重新读取源文件，确保 `......` 附近的原始代码一字不差（包括所有空白字符），并扩大上下文范围。
* **报错 `Pattern ambiguity` 或 `not unique` (存在歧义)**：
    * **原因**：你保留的上下文特征太弱（例如只保留了 `    }\n}`），在源文件中存在多处相同的片段，工具不知道该替换哪一处。
    * **对策**：增加更具辨识度的业务逻辑代码作为上下文（如带有特定变量名或常量的行）。