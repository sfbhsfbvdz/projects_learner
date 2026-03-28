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

async function callDeepSeek(messages, systemPrompt, apiKey, { withTools = true, timeoutMs = 45_000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let resp;
  try {
    resp = await fetch(DEEPSEEK_API, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        max_tokens: 4096,
        messages: [
          { role: "system", content: systemPrompt },
          ...messages,
        ],
        ...(withTools ? { tools: TOOLS, tool_choice: "auto" } : {}),
      }),
    });
  } finally {
    clearTimeout(timer);
  }

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

// ── 通用对话轮次（用于 Agent 2/3/4）─────────────────────────────────────────

/**
 * 运行一轮对话。
 * messages: 完整历史（不含 system），最后一条必须是用户消息。
 * withTools: Agent 3 需要 true，Agent 2/4 用 false。
 * 返回 assistant 的回复文本。
 */
export async function runChatTurn({ messages, systemPrompt, deepseekKey, owner = null, repo = null, githubToken = null, withTools = false, onProgress = null, onFileRead = null }) {
  const current = [...messages];

  if (withTools && owner && repo) {
    const MAX_TOOL_ROUNDS = 6;
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const response = await callDeepSeek(current, systemPrompt, deepseekKey, { withTools: true });
      const choice = response.choices[0];
      const message = choice.message;
      current.push(message);

      if (choice.finish_reason === "stop" || choice.finish_reason === "length") {
        return message.content ?? "";
      }

      if (choice.finish_reason === "tool_calls") {
        const toolResults = await Promise.all(
          message.tool_calls.map(async (call) => {
            const args = JSON.parse(call.function.arguments);
            onProgress?.(`  → ${call.function.name}(${JSON.stringify(args)})`);
            const result = await runTool(call.function.name, args, owner, repo, githubToken);
            if (call.function.name === "read_file" && args.path) {
              onFileRead?.(args.path, result);
            }
            return { role: "tool", tool_call_id: call.id, content: result };
          })
        );
        current.push(...toolResults);
        continue;
      }

      break;
    }
    // 工具轮次耗尽，强制输出
    const final = await callDeepSeek(current, systemPrompt, deepseekKey, { withTools: false, timeoutMs: 90_000 });
    return final.choices[0].message.content ?? "";
  } else {
    const response = await callDeepSeek(current, systemPrompt, deepseekKey, { withTools: false });
    return response.choices[0].message.content ?? "";
  }
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
export async function run({ owner, repo, systemPrompt, deepseekKey, githubToken = null, lang = "en", onProgress = null }) {
  const isEn = lang === "en";
  const messages = [
    {
      role: "user",
      content: isEn
        ? `Please generate a project outline for this GitHub repository.\n\nRepository: ${owner}/${repo}\n\nStart by listing the root directory.`
        : `请为这个 GitHub 仓库生成项目大纲。\n\n仓库：${owner}/${repo}\n\n先从列出根目录开始。`,
    },
  ];

  onProgress?.(isEn ? `▶ Analyzing ${owner}/${repo}…` : `▶ 开始分析 ${owner}/${repo}…`);

  const MAX_TOOL_ROUNDS = 6;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await callDeepSeek(messages, systemPrompt, deepseekKey);
    const choice = response.choices[0];
    const message = choice.message;

    messages.push(message);

    // 模型自己决定停止
    if (choice.finish_reason === "stop" || choice.finish_reason === "length") {
      const content = message.content ?? "";
      if (content.trim()) return content;
      // content 为空 → 直接跳出去强制输出，不再浪费轮次
      break;
    }

    // 模型要调工具
    if (choice.finish_reason === "tool_calls") {
      const toolResults = await Promise.all(
        message.tool_calls.map(async (call) => {
          const args = JSON.parse(call.function.arguments);
          onProgress?.(`  → ${call.function.name}(${JSON.stringify(args)})`);
          const result = await runTool(call.function.name, args, owner, repo, githubToken);
          return { role: "tool", tool_call_id: call.id, content: result };
        })
      );
      messages.push(...toolResults);
      continue;
    }

    // 其他未知 finish_reason → 直接跳出强制输出
    break;
  }

  // 工具轮次用完 → 强制输出
  onProgress?.(isEn ? `→ Generating outline…` : `→ 生成大纲中…`);
  messages.push({
    role: "user",
    content: isEn
      ? "Good, information collected. Now output the complete project outline in the Markdown format specified in the system prompt. Do not call any more tools."
      : "好的，信息已经收集完毕。请现在按照系统提示中规定的 Markdown 格式，直接输出完整的项目大纲，不要再调用工具。",
  });
  const final = await callDeepSeek(messages, systemPrompt, deepseekKey, { withTools: false, timeoutMs: 90_000 });
  const finalContent = final.choices[0].message.content ?? "";
  if (finalContent.trim()) return finalContent;

  throw new Error(isEn ? "Model failed to generate outline. Please retry." : "模型未能生成大纲，请重试。");
}
