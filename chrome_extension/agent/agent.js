/**
 * Agent 主循环（DeepSeek 版）
 *
 * DeepSeek 使用 OpenAI 兼容格式：
 * - 工具定义放在 tools[].function 里
 * - 工具调用结果用 role: "tool" 返回
 */

import { listDirectory, readFile, findFiles } from "./github_tools.js";

const DEEPSEEK_API = "https://api.deepseek.com/chat/completions";

// ── 工具定义（OpenAI 格式）────────────────────────────────────────────────────

const TOOLS = [
  {
    type: "function",
    function: {
      name: "list_directory",
      description: "列出 GitHub 仓库中某个目录的内容。[DIR] 表示子目录，[FILE] 表示文件。path 留空表示根目录。",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "目录路径，留空表示根目录" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "读取 GitHub 仓库中某个文件的文本内容。适合读取 README、package.json、入口文件等。",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "文件路径，例如 README.md" },
          max_lines: { type: "integer", description: "最多读取行数，默认 80" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "find_files",
      description: "在仓库中按 glob 模式搜索文件，例如 '*.py'、'*.ts'。",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "glob 模式，例如 '*.py'" },
          base_path: { type: "string", description: "限制搜索范围的子目录，留空表示整个仓库" },
        },
        required: ["pattern", "base_path"],
      },
    },
  },
];

// ── 调用 DeepSeek API ─────────────────────────────────────────────────────────

async function callDeepSeek(messages, systemPrompt, apiKey) {
  const resp = await fetch(DEEPSEEK_API, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages: [
        { role: "system", content: systemPrompt },
        ...messages,
      ],
      tools: TOOLS,
      tool_choice: "auto",
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`DeepSeek API 错误 ${resp.status}: ${body}`);
  }

  return resp.json();
}

// ── 执行工具 ──────────────────────────────────────────────────────────────────

async function runTool(name, args, owner, repo, githubToken) {
  if (name === "list_directory") {
    return listDirectory(owner, repo, args.path ?? "", githubToken);
  }
  if (name === "read_file") {
    return readFile(owner, repo, args.path, args.max_lines ?? 80, githubToken);
  }
  if (name === "find_files") {
    return findFiles(owner, repo, args.pattern, args.base_path ?? "", githubToken);
  }
  return `[错误] 未知工具：${name}`;
}

// ── Agent 主循环 ──────────────────────────────────────────────────────────────

/**
 * @param {object} opts
 * @param {string} opts.owner
 * @param {string} opts.repo
 * @param {string} opts.systemPrompt
 * @param {string} opts.deepseekKey
 * @param {string} [opts.githubToken]
 * @param {function} [opts.onProgress]
 * @returns {Promise<string>}
 */
export async function run({ owner, repo, systemPrompt, deepseekKey, githubToken = null, onProgress = null }) {
  const messages = [
    {
      role: "user",
      content: `请为这个 GitHub 仓库生成项目大纲。\n\n仓库：${owner}/${repo}\n\n先从列出根目录开始。`,
    },
  ];

  onProgress?.(`▶ 开始分析 ${owner}/${repo}…`);

  while (true) {
    const response = await callDeepSeek(messages, systemPrompt, deepseekKey);
    const choice = response.choices[0];
    const message = choice.message;

    // 把 assistant 消息追加到历史
    messages.push(message);

    // 完成，返回最终文本
    if (choice.finish_reason === "stop") {
      return message.content ?? "";
    }

    // 执行工具调用
    if (choice.finish_reason === "tool_calls") {
      const toolResults = await Promise.all(
        message.tool_calls.map(async (call) => {
          const args = JSON.parse(call.function.arguments);
          onProgress?.(`  → ${call.function.name}(${JSON.stringify(args)})`);

          const result = await runTool(call.function.name, args, owner, repo, githubToken);
          return {
            role: "tool",
            tool_call_id: call.id,
            content: result,
          };
        })
      );

      messages.push(...toolResults);
      continue;
    }

    throw new Error(`意外的 finish_reason: ${choice.finish_reason}`);
  }
}
