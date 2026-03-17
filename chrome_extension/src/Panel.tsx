import { useState } from "react";
import { BookOpen, X, Loader2, ChevronRight, AlertCircle } from "lucide-react";
import { Button } from "./components/ui/button";
import { Badge } from "./components/ui/badge";
import { cn } from "./lib/utils";

type Status = "idle" | "loading" | "done" | "error";

interface PanelProps {
  owner: string;
  repo: string;
}

export function Panel({ owner, repo }: PanelProps) {
  const [open, setOpen] = useState(true);
  const [status, setStatus] = useState<Status>("idle");
  const [logs, setLogs] = useState<string[]>([]);
  const [outline, setOutline] = useState("");
  const [error, setError] = useState("");

  const handleAnalyze = () => {
    setStatus("loading");
    setLogs([]);
    setOutline("");
    setError("");

    chrome.runtime.sendMessage({ action: "analyze", owner, repo });
  };

  // 接收来自 background 的消息
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === "progress") {
      setLogs((prev) => [...prev, msg.text]);
    } else if (msg.action === "result") {
      setStatus("done");
      setOutline(msg.outline);
    } else if (msg.action === "error") {
      setStatus("error");
      setError(msg.error);
    }
  });

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-[9999] flex h-11 w-11 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg hover:bg-primary/90 transition-colors"
      >
        <BookOpen size={18} />
      </button>
    );
  }

  return (
    <div className="fixed top-16 right-4 z-[9999] flex w-96 flex-col rounded-xl border border-border bg-background shadow-xl overflow-hidden max-h-[85vh]">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <BookOpen size={16} className="text-primary" />
          <span className="text-sm font-semibold text-foreground">Repo Learner</span>
          <Badge className="text-muted-foreground border-border">
            {owner}/{repo}
          </Badge>
        </div>
        <Button variant="ghost" size="icon" onClick={() => setOpen(false)}>
          <X size={14} />
        </Button>
      </div>

      {/* Body */}
      <div className="flex flex-col gap-3 p-4 overflow-y-auto flex-1">
        {/* 分析按钮 */}
        {status !== "done" && (
          <Button
            onClick={handleAnalyze}
            disabled={status === "loading"}
            className="w-full"
          >
            {status === "loading" ? (
              <>
                <Loader2 size={14} className="mr-2 animate-spin" />
                正在分析…
              </>
            ) : (
              <>
                <ChevronRight size={14} className="mr-2" />
                生成项目大纲
              </>
            )}
          </Button>
        )}

        {/* 进度日志 */}
        {status === "loading" && logs.length > 0 && (
          <div className="rounded-lg bg-muted px-3 py-2">
            {logs.map((log, i) => (
              <p key={i} className="text-xs text-muted-foreground font-mono leading-5">
                {log}
              </p>
            ))}
          </div>
        )}

        {/* 错误 */}
        {status === "error" && (
          <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2">
            <AlertCircle size={14} className="mt-0.5 text-red-500 shrink-0" />
            <p className="text-xs text-red-600">{error}</p>
          </div>
        )}

        {/* 结果 */}
        {status === "done" && (
          <>
            <Button variant="outline" size="sm" onClick={handleAnalyze} className="w-full">
              重新生成
            </Button>
            <Outline markdown={outline} />
          </>
        )}
      </div>
    </div>
  );
}

// ── Markdown 渲染 ─────────────────────────────────────────────────────────────

function Outline({ markdown }: { markdown: string }) {
  const sections = parseOutline(markdown);

  return (
    <div className="flex flex-col gap-4">
      {sections.map((section, i) => (
        <div key={i} className="flex flex-col gap-1.5">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {section.heading}
          </h3>
          <div
            className="text-sm text-foreground leading-relaxed"
            dangerouslySetInnerHTML={{ __html: section.html }}
          />
        </div>
      ))}
    </div>
  );
}

function parseOutline(md: string) {
  const lines = md.split("\n");
  const sections: { heading: string; html: string }[] = [];
  let current: { heading: string; lines: string[] } | null = null;

  for (const line of lines) {
    if (line.startsWith("## ")) {
      if (current) sections.push({ heading: current.heading, html: renderBlock(current.lines) });
      current = { heading: line.replace("## ", "").trim(), lines: [] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) sections.push({ heading: current.heading, html: renderBlock(current.lines) });

  return sections;
}

function renderBlock(lines: string[]): string {
  const text = lines.join("\n").trim();
  return text
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, `<code class="rounded bg-muted px-1 py-0.5 font-mono text-xs">$1</code>`)
    .replace(/^- (.+)$/gm, '<li class="ml-4 list-disc">$1</li>')
    .replace(/(<li.*<\/li>\n?)+/gs, (m) => `<ul class="flex flex-col gap-1">${m}</ul>`)
    .replace(/^\| (.+) \|$/gm, (_, row) =>
      `<tr>${row.split(" | ").map((c) => `<td class="border border-border px-2 py-1">${c}</td>`).join("")}</tr>`
    )
    .replace(/(<tr>.*?<\/tr>\n?)+/gs, (t) =>
      `<table class="w-full text-xs border-collapse rounded overflow-hidden">${t}</table>`
    )
    .replace(/\n{2,}/g, "<br/>");
}
