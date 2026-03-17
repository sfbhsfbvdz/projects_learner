/**
 * Agent 主循环
 * 对应 Python 版的 agent.py，逻辑完全一致。
 *
 * 调用方式：
 *   import { run } from './agent/agent.js'
 *   const outline = await run({ owner, repo, anthropicKey, githubToken, onProgress })
 */

import { listDirectory, readFile, findFiles } from "./github_tools.js";

const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";

// Claude 工具定义（和 Python 版的 TOOLS 完全一致）
const TOOLS = [
  {
    name: "list_directory",
    description:
      "列出 GitHub 仓库中某个目录的内容。[DIR] 表示子目录，[FILE] 表示文件。path 留空表示根目录。",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "目录路径，留空表示根目录" },
      },
      required: ["path"],
    },
  },
  {
    name: "read_file",
    description:
      "读取 GitHub 仓库中某个文件的文本内容。适合读取 README、package.json、入口文件等。",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "文件路径，例如 README.md" },
        max_lines: { type: "integer", description: "最多读取行数，默认 80" },
      },
      required: ["path"],
    },
  },
  {
    name: "find_files",
    description:
      "在仓库中按 glob 模式搜索文件，例如 '*.py'、'*.ts'。",
    input_schema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "glob 模式，例如 '*.py'" },
        base_path: { type: "string", description: "限制搜索范围的子目录，留空表示整个仓库" },
      },
      required: ["pattern", "base_path"],
    },
  },
];

// ── 调用 Claude API ───────────────────────────────────────────────────────────

async function callClaude(messages, systemPrompt, anthropicKey) {
  const resp = await fetch(ANTHROPIC_API, {
    method: "POST",
    headers: {
      "x-api-key": anthropicKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
      // 浏览器直接调用 Anthropic API 必须加这个 header
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: "claude-opus-4-6",
      max_tokens: 4096,
      thinking: { type: "adaptive" },
      system: systemPrompt,
      tools: TOOLS,
      messages,
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Claude API 错误 ${resp.status}: ${body}`);
  }

  return resp.json();
}

// ── 执行工具 ──────────────────────────────────────────────────────────────────

async function runTool(name, input, owner, repo, githubToken) {
  if (name === "list_directory") {
    return listDirectory(owner, repo, input.path ?? "", githubToken);
  }
  if (name === "read_file") {
    return readFile(owner, repo, input.path, input.max_lines ?? 80, githubToken);
  }
  if (name === "find_files") {
    return findFiles(owner, repo, input.pattern, input.base_path ?? "", githubToken);
  }
  return `[错误] 未知工具：${name}`;
}

// ── Agent 主循环 ──────────────────────────────────────────────────────────────

/**
 * 对 GitHub 仓库运行大纲生成 Agent。
 *
 * @param {object} opts
 * @param {string} opts.owner          - GitHub 用户名或组织名
 * @param {string} opts.repo           - 仓库名
 * @param {string} opts.systemPrompt   - 系统提示（从 prompt.md 加载）
 * @param {string} opts.anthropicKey   - Anthropic API Key
 * @param {string} [opts.githubToken]  - GitHub Token（可选，提升速率限制）
 * @param {function} [opts.onProgress] - 进度回调 (message: string) => void
 * @returns {Promise<string>} Markdown 格式的项目大纲
 */
export async function run({ owner, repo, systemPrompt, anthropicKey, githubToken = null, onProgress = null }) {
  const messages = [
    {
      role: "user",
      content: `请为这个 GitHub 仓库生成项目大纲。\n\n仓库：${owner}/${repo}\n\n先从列出根目录开始。`,
    },
  ];

  onProgress?.(`▶ 开始分析 ${owner}/${repo}…`);

  while (true) {
    const response = await callClaude(messages, systemPrompt, anthropicKey);

    // 打印工具调用进度
    for (const block of response.content) {
      if (block.type === "tool_use") {
        onProgress?.(`  → ${block.name}(${JSON.stringify(block.input)})`);
      }
    }

    // Claude 完成，返回最终文本
    if (response.stop_reason === "end_turn") {
      const textBlock = response.content.find((b) => b.type === "text");
      return textBlock?.text ?? "";
    }

    if (response.stop_reason !== "tool_use") {
      throw new Error(`意外的 stop_reason: ${response.stop_reason}`);
    }

    // 把 assistant 回复追加到历史
    messages.push({ role: "assistant", content: response.content });

    // 执行所有工具，收集结果
    const toolResults = await Promise.all(
      response.content
        .filter((b) => b.type === "tool_use")
        .map(async (block) => ({
          type: "tool_result",
          tool_use_id: block.id,
          content: await runTool(block.name, block.input, owner, repo, githubToken),
        }))
    );

    messages.push({ role: "user", content: toolResults });
  }
}
