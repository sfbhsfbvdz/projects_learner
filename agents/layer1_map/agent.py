"""
layer1_map — 项目大纲生成 Agent（GitHub 版）

输入一个 GitHub 仓库 URL，自动探索项目结构，输出帮助用户建立方向感的「项目大纲」。

用法
----
  python agents/layer1_map/agent.py https://github.com/owner/repo
  python agents/layer1_map/agent.py https://github.com/owner/repo --token ghp_xxx
"""

import json
import os
import re
import sys

import anthropic

from github_tools import find_files, list_directory, read_file

# ── 加载 Prompt ───────────────────────────────────────────────────────────────

_HERE = os.path.dirname(os.path.abspath(__file__))

with open(os.path.join(_HERE, "prompt.md"), encoding="utf-8") as _f:
    SYSTEM_PROMPT = _f.read()

# ── 工具定义（提供给 Claude 的 JSON Schema）──────────────────────────────────

TOOLS = [
    {
        "name": "list_directory",
        "description": (
            "列出 GitHub 仓库中某个目录的内容。"
            "[DIR] 表示子目录，[FILE] 表示文件（附带大小）。"
            "path 留空或传 '' 表示根目录。"
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "目录路径，例如 '' 表示根目录，'src' 表示 src/ 目录",
                }
            },
            "required": ["path"],
        },
    },
    {
        "name": "read_file",
        "description": (
            "读取 GitHub 仓库中某个文件的文本内容。"
            "适合读取 README、package.json、入口文件等关键文件。"
            "大文件会自动截断，只返回前 max_lines 行。"
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "文件路径，例如 'README.md'、'src/index.ts'",
                },
                "max_lines": {
                    "type": "integer",
                    "description": "最多读取的行数，默认 80",
                },
            },
            "required": ["path"],
        },
    },
    {
        "name": "find_files",
        "description": (
            "在仓库中按 glob 模式搜索文件。"
            "例如用 '*.py' 搜索所有 Python 文件，用 '*.ts' 搜索 TypeScript 文件。"
            "搜索范围可以用 base_path 限制在某个子目录内。"
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "pattern": {
                    "type": "string",
                    "description": "glob 模式，例如 '*.py'、'*.json'、'*.ts'",
                },
                "base_path": {
                    "type": "string",
                    "description": "限制搜索范围的子目录，留空表示搜索整个仓库",
                },
            },
            "required": ["pattern", "base_path"],
        },
    },
]

# ── GitHub URL 解析 ───────────────────────────────────────────────────────────

def parse_github_url(url: str) -> tuple[str, str]:
    """从 GitHub URL 中提取 owner 和 repo。"""
    url = url.rstrip("/")
    # 匹配 https://github.com/owner/repo 或 github.com/owner/repo
    match = re.search(r"github\.com/([^/]+)/([^/]+)", url)
    if not match:
        raise ValueError(f"无法解析 GitHub URL：{url}")
    owner, repo = match.group(1), match.group(2)
    # 去掉 .git 后缀
    repo = repo.removesuffix(".git")
    return owner, repo

# ── 工具执行（把 Claude 的调用转发到 github_tools）──────────────────────────

def run_tool(name: str, inp: dict, owner: str, repo: str, token: str | None) -> str:
    if name == "list_directory":
        return list_directory(owner, repo, inp.get("path", ""), token)
    if name == "read_file":
        return read_file(owner, repo, inp["path"], inp.get("max_lines", 80), token)
    if name == "find_files":
        return find_files(owner, repo, inp["pattern"], inp.get("base_path", ""), token)
    return f"[错误] 未知工具：{name}"

# ── Agent 主循环 ──────────────────────────────────────────────────────────────

def run(github_url: str, token: str | None = None) -> str:
    """
    对 GitHub 仓库运行 Layer 1 大纲生成 Agent。
    返回 Markdown 格式的项目大纲。
    """
    owner, repo = parse_github_url(github_url)
    client = anthropic.Anthropic()

    messages = [
        {
            "role": "user",
            "content": (
                f"请为这个 GitHub 仓库生成项目大纲。\n\n"
                f"仓库：{owner}/{repo}\n"
                f"地址：{github_url}\n\n"
                f"先从列出根目录开始。"
            ),
        }
    ]

    print(f"▶ 开始分析：{owner}/{repo}\n", file=sys.stderr)

    while True:
        response = client.messages.create(
            model="claude-opus-4-6",
            max_tokens=4096,
            thinking={"type": "adaptive"},
            system=SYSTEM_PROMPT,
            tools=TOOLS,
            messages=messages,
        )

        # 打印工具调用（调试用）
        for block in response.content:
            if block.type == "tool_use":
                args = json.dumps(block.input, ensure_ascii=False)
                print(f"  [tool] {block.name}({args})", file=sys.stderr)

        # Claude 完成，提取最终文本
        if response.stop_reason == "end_turn":
            for block in response.content:
                if block.type == "text":
                    return block.text
            return ""

        if response.stop_reason != "tool_use":
            print(f"[警告] 意外的 stop_reason: {response.stop_reason}", file=sys.stderr)
            break

        # 把 assistant 回复追加到历史
        messages.append({"role": "assistant", "content": response.content})

        # 执行所有工具，收集结果
        tool_results = [
            {
                "type": "tool_result",
                "tool_use_id": block.id,
                "content": run_tool(block.name, block.input, owner, repo, token),
            }
            for block in response.content
            if block.type == "tool_use"
        ]

        messages.append({"role": "user", "content": tool_results})

    return ""

# ── CLI ───────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="生成 GitHub 仓库的学习大纲")
    parser.add_argument("url", help="GitHub 仓库 URL，例如 https://github.com/fastapi/fastapi")
    parser.add_argument("--token", default=None, help="GitHub Personal Access Token（可选，提升速率限制）")
    args = parser.parse_args()

    print(run(args.url, args.token))
