/**
 * Background Service Worker
 *
 * 负责：
 * 1. 接收来自 content_script 的分析请求
 * 2. 从 chrome.storage 读取 API Key
 * 3. 加载 prompt，运行 agent
 * 4. 把进度和结果发回 content_script
 */

import { run } from "./agent/agent.js";

// ── 加载 prompt.md ────────────────────────────────────────────────────────────

let systemPrompt = null;

async function getSystemPrompt() {
  if (systemPrompt) return systemPrompt;
  const url = chrome.runtime.getURL("agent/prompt.md");
  const resp = await fetch(url);
  systemPrompt = await resp.text();
  return systemPrompt;
}

// ── 消息处理 ──────────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "analyze") {
    handleAnalyze(message, sender.tab.id);
    // 返回 true 表示异步响应
    sendResponse({ status: "started" });
  }
  return true;
});

async function handleAnalyze({ owner, repo }, tabId) {
  // 发送进度消息给 content_script
  function sendProgress(text) {
    chrome.tabs.sendMessage(tabId, { action: "progress", text });
  }

  function sendResult(outline) {
    chrome.tabs.sendMessage(tabId, { action: "result", outline });
  }

  function sendError(error) {
    chrome.tabs.sendMessage(tabId, { action: "error", error });
  }

  try {
    // 从 storage 读取 API Keys
    const { deepseekKey, githubToken } = await chrome.storage.sync.get([
      "deepseekKey",
      "githubToken",
    ]);

    if (!deepseekKey) {
      sendError("请先在插件设置中填写 DeepSeek API Key");
      return;
    }

    const prompt = await getSystemPrompt();

    const outline = await run({
      owner,
      repo,
      systemPrompt: prompt,
      deepseekKey,
      githubToken: githubToken || null,
      onProgress: sendProgress,
    });

    sendResult(outline);
  } catch (e) {
    sendError(e.message ?? "未知错误");
  }
}
