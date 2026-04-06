`write` 工具用于写入或更新文件内容。它支持两种方式：

- 直接写入完整内容
- 使用 `......` 占位符保留源文件中未修改的部分

## 1. 直接写入

当 `template` 中不包含 `......` 时，工具会直接把 `template` 的内容写入目标文件，覆盖原文件内容。

### 示例

```json
{
  "file": "src/example.ts",
  "template": "console.log('Hello world');\n"
}
```

## 2. 锚点补全写入（包含 `......`）

当 `template` 含有 `......` 时，工具会把它当作“从源文件补全未改部分”的占位符。

### 工作方式

- `template` 中的每个 `......` 表示“保留源文件中此处的原始文本”。
- 工具会根据前后锚点，从源文件中提取原始内容并填入 `......`。
- 这让你只需提交实际变更，而不必复制整个文件。

### 规则

- `......` 必须是 6 个半角句号
- 每个 `......` 前后必须都有非空锚点文本
- 前后锚点必须与源文件完全一致
- 每个 `prefix......suffix` 组合在源文件中必须唯一
- 模板中可以使用多个 `......`

### 示例

假设源文件包含：
```ts
function initSystem() {
    setupLogging();
}

function calculateTax(amount: number) {
    const taxRate = 0.05;
    return amount * taxRate;
}
```

你只想修改 `calculateTax` 的税率：

```json
{
  "file": "src/example.ts",
  "template": "function initSystem() {\n......\n}\n\nfunction calculateTax(amount: number) {\n    const taxRate = 0.08;\n    return amount * taxRate;\n}"
}
```

工具会保留 `initSystem` 中的原始实现，只更新 `calculateTax` 里指定的改动。

## 使用建议

- 用完整函数声明、独特变量名或注释作为锚点；
- 避免只用 `{`、`}`、`return` 这类通用文本作为锚点；
- 如果模板出现歧义，扩展前后锚点的上下文。

## 结果说明

- 如果 `template` 包含 `......`，写入时会先补全占位符，再覆盖文件。
- 如果 `template` 没有 `......`，写入内容会直接覆盖文件。
- 出现错误时，工具会返回错误信息并停止写入。