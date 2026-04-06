`read` 工具用于读取文件内容，并在需要时对长文件做结构化折叠，方便快速查看文件骨架。

## 1. 默认读取

### 1.1 参数说明

你必须用 `absolutePath` 传入绝对路径。

示例：
```json
{
  "absolutePath": "/abs/path/to/project/src/example.ts"
}
```

当你只提供 `absolutePath` 参数时，工具会返回文件内容的“折叠视图”：
- 仅保留代码骨架和括号边界
- 用 `......` 折叠较大的实现块
- 结果仍然保持可读，并可作为后续 `write` 的锚点输入

### 适用场景

- 你需要快速了解文件整体结构
- 文件太长，不希望一次输出全部实现细节
- 想为后续精确修改获取简洁的上下文

### 示例

请求参数：
```json
{
  "absolutePath": "/abs/path/to/project/src/example.ts"
}
```

返回示例：
```ts
function foo() {
......
}

const data = [
......
];
```

## 2. 指定 `template` 读取特定块

当你同时提供 `absolutePath` 和 `template` 时，工具会把 `template` 中的 `......` 当成锚点占位符，返回该占位符对应的源文件块。

### 规则

- `template` 里必须包含且仅包含一个 `......`
- `......` 的前后必须有非空的精确锚点文本
- 锚点文本必须与源文件完全一致（字节级匹配）
- `prefix......suffix` 组合在源文件中必须唯一

### 模板格式

```text
<prefix>......<suffix>
```

其中：
- `prefix` 是占位符前的精确上下文
- `suffix` 是占位符后的精确上下文

### 示例

假设源文件包含：
```ts
function calculateTax(amount: number) {
    const taxRate = 0.05;
    return amount * taxRate;
}
```

请求参数：
```json
{
  "absolutePath": "/abs/path/to/project/src/example.ts",
  "template": "function calculateTax(amount: number) {\n......\n}"
}
```

返回：
```ts
function calculateTax(amount: number) {
    const taxRate = 0.05;
    return amount * taxRate;
}
```

## 使用建议

- 如果只想浏览文件结构，先用默认 `read`。
- 如果要定位一个具体函数或块，用 `template` 提供上下文。
- 用完整函数签名、独特变量名或注释作为锚点，避免过短的通用文本。
- 不要只用 `{`、`}`、`return` 这类通用词作为锚点。

## 常见错误

- `[System Error] Pattern ambiguity detected`：表示 `prefix......suffix` 在文件中不是唯一的。
- `The prefix "..." does not exist in the source file.`：表示提供的前缀未与源文件完全匹配。
- `The suffix "..." does not exist in the source file.`：表示提供的后缀未与源文件完全匹配。

> 提示：`template` 语法和 `write` 工具中使用的锚点语法一致，方便你在读取后直接基于同一格式提交修改。