/**
 * GitHub API 工具层
 * 对应 Python 版的 github_tools.py，逻辑完全一致。
 */

const GITHUB_API = "https://api.github.com";

// ── 基础请求 ──────────────────────────────────────────────────────────────────

async function githubGet(path, token) {
  const headers = {
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const resp = await fetch(`${GITHUB_API}${path}`, { headers });

  if (!resp.ok) {
    const body = await resp.text();
    if (resp.status === 404) throw new Error(`路径不存在（404）: ${path}`);
    if (resp.status === 403) throw new Error(`速率限制或权限不足（403）`);
    throw new Error(`GitHub API 错误 ${resp.status}: ${body}`);
  }

  return resp.json();
}

// ── 三个工具 ──────────────────────────────────────────────────────────────────

/**
 * 列出仓库中某个目录的内容。
 * 对应 GET /repos/{owner}/{repo}/contents/{path}
 */
export async function listDirectory(owner, repo, path = "", token = null) {
  const apiPath = `/repos/${owner}/${repo}/contents/${path}`;
  let data;

  try {
    data = await githubGet(apiPath, token);
  } catch (e) {
    return `[错误] ${e.message}`;
  }

  if (!Array.isArray(data)) return `[错误] ${path || "/"} 是文件，不是目录`;

  const sorted = data.sort((a, b) => {
    if (a.type === b.type) return a.name.localeCompare(b.name);
    return a.type === "dir" ? -1 : 1;
  });

  const lines = sorted.map((item) =>
    item.type === "dir"
      ? `[DIR]  ${item.name}/`
      : `[FILE] ${item.name}  (${item.size?.toLocaleString() ?? "?"} bytes)`
  );

  return lines.join("\n") || "（空目录）";
}

/**
 * 读取仓库中某个文件的文本内容。
 * 对应 GET /repos/{owner}/{repo}/contents/{path}，返回 base64，自动解码。
 */
export async function readFile(owner, repo, path, maxLines = 80, token = null) {
  const apiPath = `/repos/${owner}/${repo}/contents/${path}`;
  let data;

  try {
    data = await githubGet(apiPath, token);
  } catch (e) {
    return `[错误] ${e.message}`;
  }

  if (Array.isArray(data)) return `[错误] ${path} 是目录，不是文件`;
  if (data.size > 500_000) return `[跳过] 文件过大（${data.size.toLocaleString()} bytes）`;
  if (data.encoding !== "base64") return `[错误] 不支持的编码：${data.encoding}`;

  // base64 解码
  const raw = decodeURIComponent(
    escape(atob(data.content.replace(/\n/g, "")))
  );

  const lines = raw.split("\n");
  if (lines.length > maxLines) {
    return lines.slice(0, maxLines).join("\n") + `\n\n…（已截断，共 ${lines.length} 行）`;
  }
  return raw;
}

/**
 * 在仓库中按 glob 模式搜索文件。
 * 使用 Tree API 一次拿到全部路径，本地过滤。
 * 对应 GET /repos/{owner}/{repo}/git/trees/HEAD?recursive=1
 */
export async function findFiles(owner, repo, pattern, basePath = "", token = null) {
  const apiPath = `/repos/${owner}/${repo}/git/trees/HEAD?recursive=1`;
  let data;

  try {
    data = await githubGet(apiPath, token);
  } catch (e) {
    return `[错误] ${e.message}`;
  }

  const tree = data.tree ?? [];
  const results = tree
    .filter((item) => item.type === "blob")
    .map((item) => item.path)
    .filter((path) => {
      if (basePath && !path.startsWith(basePath + "/")) return false;
      return matchGlob(pattern, path);
    })
    .slice(0, 50);

  if (results.length === 0) return "（没有找到匹配文件）";

  let text = results.join("\n");
  if (data.truncated || results.length === 50) text += "\n…（只显示前 50 个）";
  return text;
}

// ── Glob 匹配（简单实现，支持 * 和 ?）────────────────────────────────────────

function matchGlob(pattern, str) {
  // 用文件名匹配，也用完整路径匹配
  const filename = str.split("/").pop();
  return globMatch(pattern, filename) || globMatch(pattern, str);
}

function globMatch(pattern, str) {
  // 把 glob 转成正则
  const re = new RegExp(
    "^" +
    pattern
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")  // 转义特殊字符
      .replace(/\*/g, ".*")                    // * → .*
      .replace(/\?/g, ".") +                   // ? → .
    "$"
  );
  return re.test(str);
}
