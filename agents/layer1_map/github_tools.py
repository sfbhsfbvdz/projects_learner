"""
GitHub API 工具层

把 list_directory / read_file / find_files 三个工具的实现从本地文件系统
换成 GitHub Contents API + Tree API。

所有函数都返回字符串，和 agent.py 的接口保持不变。
"""

import base64
import fnmatch
import json
import os
import urllib.error
import urllib.request


# ── HTTP 基础 ─────────────────────────────────────────────────────────────────

GITHUB_API = "https://api.github.com"


def _get(url: str, token: str | None = None) -> dict | list:
    """发起 GitHub API GET 请求，返回解析后的 JSON。"""
    req = urllib.request.Request(url)
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("X-GitHub-Api-Version", "2022-11-28")
    if token:
        req.add_header("Authorization", f"Bearer {token}")

    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")
        if e.code == 403:
            raise RuntimeError(f"GitHub API 速率限制或权限不足（{e.code}）: {body}")
        if e.code == 404:
            raise FileNotFoundError(f"路径不存在（404）: {url}")
        raise RuntimeError(f"GitHub API 错误 {e.code}: {body}")
    except urllib.error.URLError as e:
        raise RuntimeError(f"网络错误: {e.reason}")


# ── 工具实现 ──────────────────────────────────────────────────────────────────

def list_directory(owner: str, repo: str, path: str, token: str | None = None) -> str:
    """
    列出仓库中某个目录的内容。
    对应 GitHub Contents API：GET /repos/{owner}/{repo}/contents/{path}
    """
    path = path.strip("/")
    url = f"{GITHUB_API}/repos/{owner}/{repo}/contents/{path}"

    try:
        data = _get(url, token)
    except FileNotFoundError:
        return f"[错误] 目录不存在：{path or '/'}"
    except RuntimeError as e:
        return f"[错误] {e}"

    if not isinstance(data, list):
        return f"[错误] {path} 是文件，不是目录"

    lines = []
    for item in sorted(data, key=lambda x: (x["type"] != "dir", x["name"])):
        if item["type"] == "dir":
            lines.append(f"[DIR]  {item['name']}/")
        else:
            size = item.get("size", 0)
            lines.append(f"[FILE] {item['name']}  ({size:,} bytes)")

    return "\n".join(lines) or "（空目录）"


def read_file(
    owner: str, repo: str, path: str,
    max_lines: int = 80,
    token: str | None = None,
) -> str:
    """
    读取仓库中某个文件的文本内容。
    对应 GitHub Contents API：GET /repos/{owner}/{repo}/contents/{path}
    文件内容以 base64 编码返回，自动解码。
    """
    path = path.strip("/")
    url = f"{GITHUB_API}/repos/{owner}/{repo}/contents/{path}"

    try:
        data = _get(url, token)
    except FileNotFoundError:
        return f"[错误] 文件不存在：{path}"
    except RuntimeError as e:
        return f"[错误] {e}"

    if isinstance(data, list):
        return f"[错误] {path} 是目录，不是文件"

    if data.get("encoding") != "base64":
        return f"[错误] 不支持的编码格式：{data.get('encoding')}"

    size = data.get("size", 0)
    if size > 500_000:
        return f"[跳过] 文件过大（{size:,} bytes），建议换一个更小的文件"

    raw = base64.b64decode(data["content"]).decode("utf-8", errors="replace")
    lines = raw.splitlines(keepends=True)

    if len(lines) > max_lines:
        return "".join(lines[:max_lines]) + f"\n\n…（已截断，共 {len(lines)} 行）"
    return "".join(lines)


def find_files(
    owner: str, repo: str, pattern: str,
    base_path: str = "",
    token: str | None = None,
) -> str:
    """
    在仓库中按 glob 模式搜索文件。
    使用 Git Tree API 一次性获取全部文件路径，本地做过滤。
    GET /repos/{owner}/{repo}/git/trees/HEAD?recursive=1
    """
    url = f"{GITHUB_API}/repos/{owner}/{repo}/git/trees/HEAD?recursive=1"

    try:
        data = _get(url, token)
    except RuntimeError as e:
        return f"[错误] {e}"

    if data.get("truncated"):
        # 仓库文件太多，Tree API 截断了
        return "[警告] 仓库文件数量过多，搜索结果可能不完整\n" + _filter_tree(
            data.get("tree", []), pattern, base_path
        )

    return _filter_tree(data.get("tree", []), pattern, base_path)


def _filter_tree(tree: list, pattern: str, base_path: str) -> str:
    """从 tree 列表中按 glob 模式过滤出匹配的文件路径。"""
    base_path = base_path.strip("/")
    results = []

    for item in tree:
        if item.get("type") != "blob":   # 只要文件，跳过目录节点
            continue
        path = item["path"]

        # 如果指定了 base_path，只在其下搜索
        if base_path and not path.startswith(base_path + "/"):
            continue

        # 用文件名匹配 pattern（支持 * 和 ?），也用完整路径匹配（支持 **）
        name = os.path.basename(path)
        if fnmatch.fnmatch(name, pattern) or fnmatch.fnmatch(path, pattern):
            results.append(path)

    results = results[:50]
    if not results:
        return "（没有找到匹配文件）"

    result_text = "\n".join(results)
    if len(results) == 50:
        result_text += "\n…（只显示前 50 个）"
    return result_text
