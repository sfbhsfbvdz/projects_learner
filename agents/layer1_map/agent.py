"""
layer1_map — 项目大纲生成 Agent（DeepSeek 版）

用法
----
  python agents/layer1_map/agent.py https://github.com/owner/repo
  python agents/layer1_map/agent.py https://github.com/owner/repo --token ghp_xxx
"""

import json
import os
import re
import sys
import urllib.error
import urllib.request

from github_tools import find_files, list_directory, read_file

# ── 加载 Prompt ───────────────────────────────────────────────────────────────

_HERE = os.path.dirname(os.path.abspath(__file__))

with open(os.path.join(_HERE, "prompt.md"), encoding="utf-8") as _f:
    SYSTEM_PROMPT = _f.read()

# ── 工具定义（OpenAI 格式）────────────────────────────────────────────────────

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "list_directory",
            "description": "列出 GitHub 仓库中某个目录的内容。[DIR] 表示子目录，[FILE] 表示文件。path 留空表示根目录。",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "目录路径，留空表示根目录"},
                },
                "required": ["path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "read_file",
            "description": "读取 GitHub 仓库中某个文件的文本内容。",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "文件路径，例如 README.md"},
                    "max_lines": {"type": "integer", "description": "最多读取行数，默认 80"},
                },
                "required": ["path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "find_files",
            "description": "在仓库中按 glob 模式搜索文件，例如 '*.py'、'*.ts'。",
            "parameters": {
                "type": "object",
                "properties": {
                    "pattern": {"type": "string", "description": "glob 模式，例如 '*.py'"},
                    "base_path": {"type": "string", "description": "限制搜索范围的子目录，留空表示整个仓库"},
                },
                "required": ["pattern", "base_path"],
            },
        },
    },
]

# ── 调用 DeepSeek API ─────────────────────────────────────────────────────────

DEEPSEEK_API = "https://api.deepseek.com/chat/completions"

def call_deepseek(messages: list, api_key: str) -> dict:
    payload = json.dumps({
        "model": "deepseek-chat",
        "messages": [{"role": "system", "content": SYSTEM_PROMPT}, *messages],
        "tools": TOOLS,
        "tool_choice": "auto",
    }).encode()

    req = urllib.request.Request(
        DEEPSEEK_API,
        data=payload,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")
        raise RuntimeError(f"DeepSeek API 错误 {e.code}: {body}")

# ── 工具执行 ──────────────────────────────────────────────────────────────────

def run_tool(name: str, args: dict, owner: str, repo: str, token: str | None) -> str:
    if name == "list_directory":
        return list_directory(owner, repo, args.get("path", ""), token)
    if name == "read_file":
        return read_file(owner, repo, args["path"], args.get("max_lines", 80), token)
    if name == "find_files":
        return find_files(owner, repo, args["pattern"], args.get("base_path", ""), token)
    return f"[错误] 未知工具：{name}"

# ── GitHub URL 解析 ───────────────────────────────────────────────────────────

def parse_github_url(url: str) -> tuple[str, str]:
    match = re.search(r"github\.com/([^/]+)/([^/]+)", url)
    if not match:
        raise ValueError(f"无法解析 GitHub URL：{url}")
    return match.group(1), match.group(2).removesuffix(".git")

# ── Agent 主循环 ──────────────────────────────────────────────────────────────

def run(github_url: str, api_key: str, github_token: str | None = None) -> str:
    owner, repo = parse_github_url(github_url)
    messages = [
        {
            "role": "user",
            "content": f"请为这个 GitHub 仓库生成项目大纲。\n\n仓库：{owner}/{repo}\n\n先从列出根目录开始。",
        }
    ]

    print(f"▶ 开始分析：{owner}/{repo}\n", file=sys.stderr)

    while True:
        response = call_deepseek(messages, api_key)
        choice = response["choices"][0]
        message = choice["message"]

        # 追加 assistant 消息
        messages.append(message)

        # 完成
        if choice["finish_reason"] == "stop":
            return message.get("content", "")

        # 执行工具调用
        if choice["finish_reason"] == "tool_calls":
            for call in message.get("tool_calls", []):
                name = call["function"]["name"]
                args = json.loads(call["function"]["arguments"])
                print(f"  [tool] {name}({json.dumps(args, ensure_ascii=False)})", file=sys.stderr)

                result = run_tool(name, args, owner, repo, github_token)
                messages.append({
                    "role": "tool",
                    "tool_call_id": call["id"],
                    "content": result,
                })
            continue

        raise RuntimeError(f"意外的 finish_reason: {choice['finish_reason']}")

# ── CLI ───────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="生成 GitHub 仓库的学习大纲")
    parser.add_argument("url", help="GitHub 仓库 URL")
    parser.add_argument("--token", default=None, help="GitHub Token（可选）")
    args = parser.parse_args()

    api_key = os.environ.get("DEEPSEEK_API_KEY")
    if not api_key:
        print("请设置环境变量 DEEPSEEK_API_KEY", file=sys.stderr)
        sys.exit(1)

    print(run(args.url, api_key, args.token))
