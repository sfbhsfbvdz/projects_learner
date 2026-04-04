/**
 * Background Service Worker
 *
 * 负责：
 * 1. 接收来自 content_script 的分析请求
 * 2. 从 chrome.storage 读取 API Key
 * 3. 加载 prompt，运行 agent
 * 4. 把进度和结果发回 content_script
 */

import { run, runChatTurn } from "./agent/agent.js";
import systemPromptText from "./agent/prompt_agent1.md?raw";
import probePromptText from "./agent/prompt_agent2.md?raw";
import explorePromptText from "./agent/prompt_agent3.md?raw";
import verifyPromptText from "./agent/prompt_agent4.md?raw";

const PHASE_PROMPTS: Record<string, string> = {
  probe: probePromptText,
  explore: explorePromptText,
  verify: verifyPromptText,
};

// prompt 直接打包进来，不需要运行时 fetch

// ── 文件缓存（用于代码块行号查找）─────────────────────────────────────────────
// key: "owner/repo/path" → raw file content
const fileCache = new Map<string, string>();

// ── 消息处理 ──────────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message: any, sender: any, sendResponse: (response: unknown) => void) => {
  if (message.action === "analyze") {
    handleAnalyze(message, sender.tab?.id);
    sendResponse({ status: "started" });
  } else if (message.action === "learn") {
    handleLearn(message, sender.tab?.id);
    sendResponse({ status: "started" });
  } else if (message.action === "find_lines") {
    const { owner, repo, path, codeText } = message;
    const content = fileCache.get(`${owner}/${repo}/${path}`);
    if (content) {
      sendResponse(findLinesInFile(codeText.split("\n"), content));
    } else {
      sendResponse(null);
    }
  }
  return true;
});

const LANG_SUFFIX: Record<string, string> = {
  en: "\n\n---\nIMPORTANT: Output the entire outline in **English**. All section headings, descriptions, table content, comments in diagrams and file trees must be in English.",
  zh: "",
};

// ── 从 markdown 分析结果提取代码块，匹配文件行号 ──────────────────────────────

function findLinesInFile(codeLines: string[], fileContent: string): { start: number; end: number } | null {
  const fileLines = fileContent.split("\n");
  const searchLines = codeLines.map(l => l.trim()).filter(l => l.length > 0);
  if (searchLines.length < 2) return null;

  for (let i = 0; i < fileLines.length; i++) {
    if (fileLines[i].trim() !== searchLines[0]) continue;
    let matches = 1;
    for (let j = 1; j < searchLines.length && i + j < fileLines.length; j++) {
      if (fileLines[i + j].trim() === searchLines[j]) matches++;
      else break;
    }
    if (matches >= Math.min(searchLines.length, 3)) {
      return { start: i + 1, end: Math.min(i + searchLines.length, fileLines.length) };
    }
  }
  return null;
}

// ── handleLearn（苏格拉底学习流程）──────────────────────────────────────────

/**
 * 统一处理 Agent 2/3/4 的对话轮次。
 * message.phase: "probe" | "explore" | "verify"
 * message.messages: 完整对话历史（含结构化数据作为第一条 user 消息）
 */
async function handleLearn(
  { owner, repo, lang = "zh", phase, messages, requestId }: { owner: string; repo: string; lang?: string; phase: string; messages: any[]; requestId: string },
  tabId?: number
) {
  if (tabId == null) return;

  function sendProgress(text: string) {
    chrome.tabs.sendMessage(tabId, { action: "learn_progress", text, requestId, owner, repo, phase });
  }
  function sendResponse(content: string, nextPhase: string | null) {
    chrome.tabs.sendMessage(tabId, { action: "learn_response", content, nextPhase, requestId, owner, repo, phase });
  }
  function sendError(error: string) {
    chrome.tabs.sendMessage(tabId, { action: "learn_error", error, requestId, owner, repo, phase });
  }

  try {
    const { deepseekKey, githubToken } = await chrome.storage.sync.get([
      "deepseekKey",
      "githubToken",
    ]);

    if (!deepseekKey) {
      sendError(lang === "en"
        ? "Please set your DeepSeek API Key in the extension options."
        : "请先在插件设置中填写 DeepSeek API Key");
      return;
    }

    const basePrompt = PHASE_PROMPTS[phase] ?? probePromptText;
    const langSuffix = lang === "en"
      ? "\n\n---\nIMPORTANT: Conduct the entire conversation in **English**."
      : "";
    const systemPrompt = basePrompt + langSuffix;

    const withTools = phase === "explore";

    const fileContents = new Map<string, string>();
    function onFileRead(path: string, content: string) {
      fileContents.set(path, content);
      fileCache.set(`${owner}/${repo}/${path}`, content);
    }

    const raw = await runChatTurn({
      messages,
      systemPrompt,
      deepseekKey,
      owner: withTools ? owner : null,
      repo: withTools ? repo : null,
      githubToken: githubToken || null,
      withTools,
      onProgress: sendProgress,
      onFileRead,
    });

    // 解析阶段跳转信号
    const phaseMatch = raw.match(/<!--\s*PHASE:(\w+)\s*-->/);
    const nextPhase = phaseMatch ? phaseMatch[1] : null;
    const content = raw.replace(/<!--\s*PHASE:\w+\s*-->/g, "").trimEnd();

    sendResponse(content, nextPhase);
  } catch (e: any) {
    sendError(e.message ?? "未知错误");
  }
}

async function handleAnalyze(
  { owner, repo, lang = "en", requestId }: { owner: string; repo: string; lang?: string; requestId: string },
  tabId?: number
) {
  if (tabId == null) return;

  // 发送进度消息给 content_script
  function sendProgress(text: string) {
    chrome.tabs.sendMessage(tabId, { action: "progress", text, requestId, owner, repo });
  }

  function sendResult(outline: string) {
    chrome.tabs.sendMessage(tabId, { action: "result", outline, requestId, owner, repo });
  }

  function sendError(error: string) {
    chrome.tabs.sendMessage(tabId, { action: "error", error, requestId, owner, repo });
  }

  try {
    // 从 storage 读取 API Keys
    const { deepseekKey, githubToken } = await chrome.storage.sync.get([
      "deepseekKey",
      "githubToken",
    ]);

    if (!deepseekKey) {
      sendError(lang === "en"
        ? "Please set your DeepSeek API Key in the extension options."
        : "请先在插件设置中填写 DeepSeek API Key");
      return;
    }

    const prompt = systemPromptText + (LANG_SUFFIX[lang] ?? LANG_SUFFIX["en"]);

    const outline = await run({
      owner,
      repo,
      systemPrompt: prompt,
      deepseekKey,
      githubToken: githubToken || null,
      lang,
      onProgress: sendProgress,
    });

    sendResult(outline);
  } catch (e) {
    sendError(e instanceof Error ? e.message : "未知错误");
  }
}
