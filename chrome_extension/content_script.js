/**
 * Content Script
 *
 * 注入到 github.com/*/*（仓库页面）。
 * 负责：
 * 1. 识别当前 repo（owner/repo）
 * 2. 在页面右侧注入「生成大纲」按钮和结果面板
 * 3. 和 background 通信，接收进度和结果
 */

// ── 识别当前 repo ─────────────────────────────────────────────────────────────

function parseRepo() {
  // URL 格式：https://github.com/{owner}/{repo}[/...]
  const match = location.pathname.match(/^\/([^/]+)\/([^/]+)/);
  if (!match) return null;
  return { owner: match[1], repo: match[2] };
}

// ── 注入 UI ───────────────────────────────────────────────────────────────────

function injectPanel() {
  if (document.getElementById("repo-learner-panel")) return;

  const panel = document.createElement("div");
  panel.id = "repo-learner-panel";
  panel.innerHTML = `
    <div id="rl-header">
      <span id="rl-title">Repo Learner</span>
      <button id="rl-close">✕</button>
    </div>
    <div id="rl-body">
      <button id="rl-analyze-btn">生成项目大纲</button>
      <div id="rl-output"></div>
    </div>
  `;
  document.body.appendChild(panel);

  // 关闭按钮
  document.getElementById("rl-close").addEventListener("click", () => {
    panel.remove();
  });

  // 分析按钮
  document.getElementById("rl-analyze-btn").addEventListener("click", startAnalysis);
}

// ── 触发分析 ──────────────────────────────────────────────────────────────────

function startAnalysis() {
  const repoInfo = parseRepo();
  if (!repoInfo) return;

  setOutput('<div class="rl-loading">正在分析，请稍候…</div>');

  chrome.runtime.sendMessage({
    action: "analyze",
    owner: repoInfo.owner,
    repo: repoInfo.repo,
  });
}

// ── 接收 background 消息 ──────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message) => {
  if (message.action === "progress") {
    appendProgress(message.text);
  } else if (message.action === "result") {
    showResult(message.outline);
  } else if (message.action === "error") {
    showError(message.error);
  }
});

// ── UI 更新 ───────────────────────────────────────────────────────────────────

function setOutput(html) {
  const output = document.getElementById("rl-output");
  if (output) output.innerHTML = html;
}

function appendProgress(text) {
  const output = document.getElementById("rl-output");
  if (!output) return;

  let log = output.querySelector(".rl-log");
  if (!log) {
    output.innerHTML = '<pre class="rl-log"></pre>';
    log = output.querySelector(".rl-log");
  }
  log.textContent += text + "\n";
  log.scrollTop = log.scrollHeight;
}

function showResult(markdown) {
  // 简单的 Markdown → HTML 渲染（只处理常见格式）
  const html = markdownToHtml(markdown);
  setOutput(`<div class="rl-result">${html}</div>`);
}

function showError(msg) {
  setOutput(`<div class="rl-error">❌ ${msg}</div>`);
}

// ── 轻量 Markdown 渲染 ────────────────────────────────────────────────────────

function markdownToHtml(md) {
  return md
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/^\| (.+) \|$/gm, (_, row) => {
      const cells = row.split(" | ").map((c) => `<td>${c}</td>`).join("");
      return `<tr>${cells}</tr>`;
    })
    .replace(/(<tr>.*<\/tr>\n?)+/gs, (table) => `<table>${table}</table>`)
    .replace(/^- (.+)$/gm, "<li>$1</li>")
    .replace(/(<li>.*<\/li>\n?)+/gs, (list) => `<ul>${list}</ul>`)
    .replace(/\n{2,}/g, "</p><p>")
    .replace(/^(?!<[htupl])/gm, "")
    .trim();
}

// ── 入口 ─────────────────────────────────────────────────────────────────────

if (parseRepo()) {
  injectPanel();
}
