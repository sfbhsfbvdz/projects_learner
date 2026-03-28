import { useState, useRef, useEffect, useCallback } from "react";
import { Terminal, X, Loader2, ChevronRight, AlertCircle, RotateCcw, ChevronDown, ChevronUp, Minus } from "lucide-react";


type Status = "idle" | "loading" | "done" | "error";
type Lang = "en" | "zh";
type ChatPhase = "idle" | "probe" | "explore" | "verify" | "done";
interface ChatMsg { role: "assistant" | "user"; content: string; }

const T = {
  en: {
    title: "Repo Learner",
    analyze: "Analyze this repo",
    analyzeDesc: "Explore the repository structure and generate a quick-start outline.",
    generateBtn: "Generate Outline",
    analyzing: "Analyzing repository…",
    done: "Done",
    regenerate: "Regenerate",
    retry: "Retry",
    minimize: "Minimize",
    expand: "Expand",
    close: "Close",
    diagram: "Module Diagram",
    tree: "Project Structure",
    overview: "Overview",
    startLearning: "Start Learning",
    startLearningDesc: "Guided Socratic walkthrough of this codebase",
    chatTab: "Learning",
    chatPlaceholder: "Type your answer…",
    chatSend: "Send",
    chatThinking: "Thinking…",
    phaseLabels: { probe: "Probe", explore: "Explore", verify: "Verify", done: "Done" } as Record<string, string>,
    learnDone: "Learning complete",
  },
  zh: {
    title: "Repo Learner",
    analyze: "分析此项目",
    analyzeDesc: "自动探索仓库结构，生成帮助你快速上手的项目大纲",
    generateBtn: "生成项目大纲",
    analyzing: "正在分析仓库…",
    done: "生成完成",
    regenerate: "重新生成",
    retry: "重试",
    minimize: "最小化",
    expand: "展开",
    close: "关闭",
    diagram: "模块关系图",
    tree: "项目结构",
    overview: "项目大纲",
    startLearning: "开始学习",
    startLearningDesc: "苏格拉底式引导，逐步看懂这个仓库",
    chatTab: "学习对话",
    chatPlaceholder: "输入你的回答…",
    chatSend: "发送",
    chatThinking: "思考中…",
    phaseLabels: { probe: "探测", explore: "探索", verify: "验证", done: "完成" } as Record<string, string>,
    learnDone: "学习完成",
  },
} as const;

interface PanelProps {
  owner: string;
  repo: string;
}

export function Panel({ owner, repo }: PanelProps) {
  // ── Persistent state across GitHub Turbo navigation ───────────────────────
  const stateKey = `repo_learner_${owner}_${repo}`;
  const [_saved] = useState<Record<string, any> | null>(() => {
    try {
      const raw = sessionStorage.getItem(stateKey);
      if (raw) return JSON.parse(raw);
    } catch {}
    return null;
  });

  const [open, setOpen] = useState<boolean>(_saved?.open ?? true);
  const [dismissed, setDismissed] = useState(false);
  const [minimized, setMinimized] = useState<boolean>(_saved?.minimized ?? false);
  const [lang, setLang] = useState<Lang>(_saved?.lang ?? "en");
  const [status, setStatus] = useState<Status>(_saved?.status ?? "idle");
  const [activeTab, setActiveTab] = useState<"1" | "2">(_saved?.activeTab ?? "1");
  const t = T[lang];
  const [logs, setLogs] = useState<string[]>([]);
  const [outline, setOutline] = useState(_saved?.outline ?? "");
  const [error, setError] = useState(_saved?.error ?? "");
  const [loadingSeconds, setLoadingSeconds] = useState(0);
  const loadingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Socratic chat state ────────────────────────────────────────────────────
  const [chatPhase, setChatPhase] = useState<ChatPhase>(_saved?.chatPhase ?? "idle");
  const [chatMessages, setChatMessages] = useState<ChatMsg[]>(_saved?.chatMessages ?? []);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [structuredData, setStructuredData] = useState<any>(_saved?.structuredData ?? null);
  const [displayOutline, setDisplayOutline] = useState<string>(_saved?.displayOutline ?? "");
  const chatBottomRef = useRef<HTMLDivElement>(null);

  // Drag state
  const [pos, setPos] = useState<{ x: number; y: number }>(
    _saved?.pos ?? { x: window.innerWidth - 400, y: 56 }
  );
  const dragging = useRef(false);
  const dragMoved = useRef(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const panelRef = useRef<HTMLDivElement>(null);

  // Resize state — null height means auto/88vh until user drags
  const [panelSize, setPanelSize] = useState<{ w: number; h: number | null }>(
    _saved?.panelSize ?? { w: 380, h: null }
  );
  type Edge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
  const resizing = useRef<Edge | null>(null);
  const resizeStart = useRef({ mx: 0, my: 0, w: 380, h: 520, x: 0, y: 0 });

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    dragging.current = true;
    dragMoved.current = false;
    dragOffset.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
    e.preventDefault();
  }, [pos]);

  const onFloatMouseDown = useCallback((e: React.MouseEvent) => {
    dragging.current = true;
    dragMoved.current = false;
    dragOffset.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
    e.preventDefault();
  }, [pos]);

  const onResizeMouseDown = useCallback((e: React.MouseEvent, edge: Edge) => {
    resizing.current = edge;
    resizeStart.current = {
      mx: e.clientX,
      my: e.clientY,
      w: panelRef.current?.offsetWidth ?? panelSize.w,
      h: panelRef.current?.offsetHeight ?? 520,
      x: pos.x,
      y: pos.y,
    };
    e.preventDefault();
    e.stopPropagation();
  }, [panelSize.w, pos]);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (resizing.current) {
        const dx = e.clientX - resizeStart.current.mx;
        const dy = e.clientY - resizeStart.current.my;
        const edge = resizing.current;
        const MIN_W = 300, MIN_H = 300;
        const MAX_W = window.innerWidth * 0.9, MAX_H = window.innerHeight * 0.92;

        let newW = resizeStart.current.w;
        let newH = resizeStart.current.h;
        let newX = resizeStart.current.x;
        let newY = resizeStart.current.y;

        // Horizontal
        if (edge.includes("e")) newW = Math.max(MIN_W, Math.min(MAX_W, resizeStart.current.w + dx));
        if (edge.includes("w")) {
          newW = Math.max(MIN_W, Math.min(MAX_W, resizeStart.current.w - dx));
          newX = resizeStart.current.x + (resizeStart.current.w - newW);
        }
        // Vertical
        if (edge.includes("s")) newH = Math.max(MIN_H, Math.min(MAX_H, resizeStart.current.h + dy));
        if (edge === "n" || edge === "nw" || edge === "ne") {
          newH = Math.max(MIN_H, Math.min(MAX_H, resizeStart.current.h - dy));
          newY = resizeStart.current.y + (resizeStart.current.h - newH);
        }

        setPanelSize({ w: Math.round(newW), h: Math.round(newH) });
        setPos({ x: Math.round(newX), y: Math.round(newY) });
        return;
      }
      if (!dragging.current) return;
      dragMoved.current = true;
      const panelW = panelRef.current?.offsetWidth ?? 40;
      const panelH = panelRef.current?.offsetHeight ?? 40;
      const x = Math.max(0, Math.min(window.innerWidth - panelW, e.clientX - dragOffset.current.x));
      const y = Math.max(0, Math.min(window.innerHeight - panelH, e.clientY - dragOffset.current.y));
      setPos({ x, y });
    };
    const onMouseUp = () => { dragging.current = false; resizing.current = null; };
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  // ── Persist state to sessionStorage so it survives GitHub navigation ───────
  useEffect(() => {
    sessionStorage.setItem(stateKey, JSON.stringify({
      open, minimized, lang,
      status: status === "loading" ? "idle" : status,
      activeTab, outline, error: status === "loading" ? "" : error,
      pos, panelSize,
      chatPhase,
      chatMessages,
      structuredData,
      displayOutline,
    }));
  }, [open, minimized, lang, status, activeTab, outline, error, pos, panelSize, chatPhase, chatMessages, structuredData, displayOutline]);

  const handleAnalyze = () => {
    setStatus("loading");
    setLogs([]);
    setLoadingSeconds(0);
    setOutline("");
    setDisplayOutline("");
    setStructuredData(null);
    setChatPhase("idle");
    setChatMessages([]);
    setError("");
    setActiveTab("1");
    chrome.runtime.sendMessage({ action: "analyze", owner, repo, lang });
  };

  // 计时器：loading 期间每秒 +1，超过 90s 强制显示超时错误
  useEffect(() => {
    if (status === "loading") {
      loadingTimerRef.current = setInterval(() => {
        setLoadingSeconds((s) => {
          if (s >= 90) {
            clearInterval(loadingTimerRef.current!);
            setStatus("error");
            setError(lang === "en"
              ? "Request timed out. DeepSeek may be slow — please retry."
              : "请求超时，DeepSeek 响应过慢，请重试。");
            return s;
          }
          return s + 1;
        });
      }, 1000);
    } else {
      if (loadingTimerRef.current) {
        clearInterval(loadingTimerRef.current);
        loadingTimerRef.current = null;
      }
      if (status !== "loading") setLoadingSeconds(0);
    }
    return () => {
      if (loadingTimerRef.current) clearInterval(loadingTimerRef.current);
    };
  }, [status, lang]);

  // ── Socratic handlers ────────────────────────────────────────────────────

  const handleStartLearning = () => {
    if (!structuredData) return;
    const prompt = lang === "en"
      ? `Project structured data:\n\`\`\`json\n${JSON.stringify(structuredData, null, 2)}\n\`\`\`\n\nPlease start the guided session based on the above data.`
      : `项目结构化数据：\n\`\`\`json\n${JSON.stringify(structuredData, null, 2)}\n\`\`\`\n\n请基于以上数据开始引导。`;
    const firstMsg: ChatMsg = { role: "user", content: prompt };
    const newMessages = [firstMsg];
    setChatMessages(newMessages);
    setChatPhase("probe");
    setChatLoading(true);
    setActiveTab("2");
    chrome.runtime.sendMessage({ action: "learn", owner, repo, lang, phase: "probe", messages: newMessages });
  };

  const handleSendChat = () => {
    const text = chatInput.trim();
    if (!text || chatLoading || chatPhase === "done") return;
    const userMsg: ChatMsg = { role: "user", content: text };
    const newMessages = [...chatMessages, userMsg];
    setChatMessages(newMessages);
    setChatInput("");
    setChatLoading(true);
    chrome.runtime.sendMessage({ action: "learn", owner, repo, lang, phase: chatPhase, messages: newMessages });
  };

  // scroll to bottom when new chat messages arrive
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages, chatLoading]);

  useEffect(() => {
    const listener = (msg: any) => {
      if (msg.action === "progress") {
        setLogs((prev) => [...prev, msg.text]);
      } else if (msg.action === "result") {
        setStatus("done");
        const raw: string = msg.outline ?? "";
        // Parse out <structured-data> block
        const sdMatch = raw.match(/<structured-data>([\s\S]*?)<\/structured-data>/);
        if (sdMatch) {
          try {
            const parsed = JSON.parse(sdMatch[1].trim());
            setStructuredData(parsed);
          } catch {}
          const clean = raw.replace(/<structured-data>[\s\S]*?<\/structured-data>/, "").trim();
          setDisplayOutline(clean);
          setOutline(raw);
        } else {
          setOutline(raw);
          setDisplayOutline(raw);
        }
      } else if (msg.action === "error") {
        setStatus("error");
        setError(msg.error);
      } else if (msg.action === "learn_response") {
        const assistantMsg: ChatMsg = { role: "assistant", content: msg.content };
        setChatMessages((prev) => [...prev, assistantMsg]);
        setChatLoading(false);
        if (msg.nextPhase) {
          setChatPhase(msg.nextPhase as ChatPhase);
        }
      } else if (msg.action === "learn_error") {
        setChatLoading(false);
        const errMsg: ChatMsg = { role: "assistant", content: `⚠️ ${msg.error}` };
        setChatMessages((prev) => [...prev, errMsg]);
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  if (dismissed) return null;

  if (!open) {
    return (
      <div
        className="fixed z-[9999] group"
        style={{ left: pos.x, top: pos.y + 8 }}
      >
        <button
          onMouseDown={onFloatMouseDown}
          onClick={() => { if (!dragMoved.current) setOpen(true); }}
          className="flex h-10 w-10 items-center justify-center rounded-full transition-colors"
          style={{ cursor: dragging.current ? "grabbing" : "grab", background: "#161b22", border: "1px solid #30363d", color: "#8b949e" }}
        >
          <Terminal size={16} />
        </button>
        <button
          onClick={() => setDismissed(true)}
          className="absolute -top-1.5 -right-1.5 hidden group-hover:flex h-4 w-4 items-center justify-center rounded-full text-white"
          style={{ background: "#30363d" }}
          title="Close"
        >
          <X size={8} />
        </button>
      </div>
    );
  }

  return (
    <div
      ref={panelRef}
      className="fixed z-[9999]"
      style={{
        left: pos.x,
        top: pos.y,
        width: panelSize.w,
        height: minimized ? "auto" : (panelSize.h ?? undefined),
        userSelect: (dragging.current || resizing.current) ? "none" : "auto",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif",
      }}
    >
    {/* ── Inner panel (visual layer) ── */}
    <div
      className="flex flex-col w-full rounded-xl overflow-hidden"
      style={{
        height: minimized ? "auto" : (panelSize.h ? "100%" : undefined),
        maxHeight: minimized ? "auto" : (panelSize.h ? "none" : "88vh"),
        background: "#0d1117",
        border: "1px solid #30363d",
        boxShadow: "0 8px 24px rgba(0,0,0,0.4), 0 1px 3px rgba(0,0,0,0.3)",
      }}
    >
      {/* ── Header (drag handle) ── */}
      <div
        onMouseDown={onMouseDown}
        className="flex items-center justify-between px-4 py-3 shrink-0 cursor-grab active:cursor-grabbing"
        style={{ background: "#161b22", borderBottom: minimized ? "none" : "1px solid #30363d" }}
      >
        <div className="flex items-center gap-2.5 select-none min-w-0 overflow-hidden">
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md" style={{ background: "#161b22", border: "1px solid #30363d" }}>
            <Terminal size={13} style={{ color: "#58a6ff" }} />
          </div>
          <div className="flex items-center gap-1.5 min-w-0 overflow-hidden">
            <span className="text-sm font-semibold shrink-0" style={{ color: "#e6edf3" }}>
              {t.title}
            </span>
            <span className="shrink-0" style={{ color: "#30363d" }}>/</span>
            <span className="text-xs font-mono truncate" style={{ color: "#8b949e" }}>
              {owner}/{repo}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0 ml-2">
          {/* Language toggle */}
          <button
            onClick={() => setLang((l) => l === "en" ? "zh" : "en")}
            className="flex h-6 items-center justify-center rounded-md px-1.5 text-[11px] font-medium transition-colors hover:bg-[#21262d]"
            style={{ color: "#8b949e", minWidth: 28 }}
            title="Switch language"
          >
            {lang === "en" ? "中" : "EN"}
          </button>
          {/* Minimize */}
          <button
            onClick={() => setMinimized((v) => !v)}
            className="flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-[#21262d]"
            style={{ color: "#8b949e" }}
            title={minimized ? t.expand : t.minimize}
          >
            {minimized
              ? <ChevronDown size={14} />
              : <Minus size={14} />
            }
          </button>
          {/* Close */}
          <button
            onClick={() => setOpen(false)}
            className="flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-[#21262d]"
            style={{ color: "#8b949e" }}
            title={t.close}
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* ── Body (hidden when minimized) ── */}
      {!minimized && (
        <div className="flex-1 overflow-y-auto min-h-0 flex flex-col">

          {/* Tab bar — shown once learning chat has started */}
          {status === "done" && chatPhase !== "idle" && (
            <div
              className="flex shrink-0"
              style={{ borderBottom: "1px solid #30363d", background: "#161b22" }}
            >
              {(["1", "2"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className="px-4 py-2 text-xs font-medium transition-colors"
                  style={{
                    color: activeTab === tab ? "#58a6ff" : "#8b949e",
                    borderBottom: activeTab === tab ? "2px solid #58a6ff" : "2px solid transparent",
                    marginBottom: -1,
                  }}
                >
                  {tab === "1" ? t.overview : t.chatTab}
                </button>
              ))}
            </div>
          )}

          {/* Tech Stack Bar */}
          {status === "done" && displayOutline && (
            <TechStackBar outline={displayOutline} lang={lang} />
          )}

          <div className="flex-1 overflow-y-auto min-h-0">
            {/* ── Layer 1 content ── */}
            {activeTab === "1" && (
              <>
                {/* 空状态 */}
                {status === "idle" && (
                  <div className="flex flex-col items-center gap-4 px-6 py-10">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full" style={{ background: "#1c2d3f" }}>
                      <Terminal size={22} style={{ color: "#58a6ff" }} />
                    </div>
                    <div className="text-center">
                      <p className="text-sm font-medium" style={{ color: "#e6edf3" }}>{t.analyze}</p>
                      <p className="mt-1 text-xs leading-5" style={{ color: "#8b949e" }}>
                        {t.analyzeDesc}
                      </p>
                    </div>
                    <AnalyzeButton onClick={handleAnalyze} loading={false} label={t.generateBtn} />
                  </div>
                )}

                {/* 加载中 */}
                {status === "loading" && (
                  <div className="flex flex-col items-center gap-3 px-6 py-10">
                    <Loader2 size={24} className="animate-spin" style={{ color: "#58a6ff" }} />
                    <div className="text-center">
                      <p className="text-sm font-medium" style={{ color: "#e6edf3" }}>{t.analyzing}</p>
                      {logs.length > 0 && (
                        <p className="mt-1 text-xs font-mono truncate max-w-full" style={{ color: "#8b949e" }}>
                          {logs[logs.length - 1]}
                        </p>
                      )}
                      {loadingSeconds > 0 && (
                        <p className="mt-1 text-xs" style={{ color: loadingSeconds > 60 ? "#d29922" : "#6e7681" }}>
                          {loadingSeconds}s{loadingSeconds >= 20 ? (lang === "en" ? " — generating outline, please wait…" : " — 生成大纲中，请稍候…") : ""}
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {/* 错误 */}
                {status === "error" && (
                  <div className="px-4 py-4 flex flex-col gap-3">
                    <div
                      className="flex items-start gap-3 rounded-lg px-3 py-3"
                      style={{ background: "#1a0d00", border: "1px solid #7a4100" }}
                    >
                      <AlertCircle size={14} className="mt-0.5 shrink-0" style={{ color: "#d29922" }} />
                      <p className="text-xs leading-5" style={{ color: "#e3b341" }}>{error}</p>
                    </div>
                    <AnalyzeButton onClick={handleAnalyze} loading={false} label={t.retry} />
                  </div>
                )}

                {/* 结果 */}
                {status === "done" && displayOutline && (
                  <div className="flex flex-col">
                    <Outline markdown={displayOutline} lang={lang} owner={owner} repo={repo} />
                    {/* Action bar */}
                    <div
                      className="flex items-center justify-between px-4 py-3 shrink-0"
                      style={{ borderTop: "1px solid #30363d", background: "#161b22" }}
                    >
                      <span className="text-xs" style={{ color: "#8b949e" }}>{t.done}</span>
                      <div className="flex items-center gap-2">
                        {chatPhase === "idle" && structuredData && (
                          <button
                            onClick={handleStartLearning}
                            className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-white transition-colors"
                            style={{ background: "#238636" }}
                            title={t.startLearningDesc}
                          >
                            <ChevronRight size={11} />
                            {t.startLearning}
                          </button>
                        )}
                        {chatPhase !== "idle" && (
                          <button
                            onClick={() => setActiveTab("2")}
                            className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-white transition-colors"
                            style={{ background: "#1f6feb" }}
                          >
                            <ChevronRight size={11} />
                            {t.chatTab}
                          </button>
                        )}
                        <button
                          onClick={handleAnalyze}
                          className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors hover:bg-[#21262d]"
                          style={{ color: "#8b949e", border: "1px solid #30363d" }}
                        >
                          <RotateCcw size={11} />
                          {t.regenerate}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}

            {/* ── Socratic Chat ── */}
            {status === "done" && chatPhase !== "idle" && activeTab === "2" && (
              <SocraticChat
                phase={chatPhase}
                messages={chatMessages}
                loading={chatLoading}
                input={chatInput}
                onInput={setChatInput}
                onSend={handleSendChat}
                bottomRef={chatBottomRef}
                t={t}
                lang={lang}
                owner={owner}
                repo={repo}
              />
            )}
          </div>
        </div>
      )}
    </div>
    {/* ── Resize handles (8 directions) ── */}
    {!minimized && (
      <>
        {/* Edges */}
        <div onMouseDown={(e) => onResizeMouseDown(e, "n")}  style={{ position:"absolute", top:-4,    left:12,   right:12,  height:8, cursor:"ns-resize" }} />
        <div onMouseDown={(e) => onResizeMouseDown(e, "s")}  style={{ position:"absolute", bottom:-4, left:12,   right:12,  height:8, cursor:"ns-resize" }} />
        <div onMouseDown={(e) => onResizeMouseDown(e, "e")}  style={{ position:"absolute", right:-4,  top:12,    bottom:12, width:8,  cursor:"ew-resize" }} />
        <div onMouseDown={(e) => onResizeMouseDown(e, "w")}  style={{ position:"absolute", left:-4,   top:12,    bottom:12, width:8,  cursor:"ew-resize" }} />
        {/* Corners */}
        <div onMouseDown={(e) => onResizeMouseDown(e, "nw")} style={{ position:"absolute", top:-4,    left:-4,   width:16,  height:16, cursor:"nwse-resize" }} />
        <div onMouseDown={(e) => onResizeMouseDown(e, "ne")} style={{ position:"absolute", top:-4,    right:-4,  width:16,  height:16, cursor:"nesw-resize" }} />
        <div onMouseDown={(e) => onResizeMouseDown(e, "sw")} style={{ position:"absolute", bottom:-4, left:-4,   width:16,  height:16, cursor:"nesw-resize" }} />
        {/* SE corner with grip dots */}
        <div onMouseDown={(e) => onResizeMouseDown(e, "se")} style={{ position:"absolute", bottom:-4, right:-4,  width:16,  height:16, cursor:"nwse-resize", display:"flex", alignItems:"flex-end", justifyContent:"flex-end", padding:3 }}>
          <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
            <circle cx="7" cy="7" r="1" fill="#6e7681" />
            <circle cx="4" cy="7" r="1" fill="#6e7681" />
            <circle cx="7" cy="4" r="1" fill="#6e7681" />
          </svg>
        </div>
      </>
    )}
    </div>
  );
}

// ── 分析按钮 ──────────────────────────────────────────────────────────────────

function AnalyzeButton({
  onClick,
  loading,
  label = "生成项目大纲",
}: {
  onClick: () => void;
  loading: boolean;
  label?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium text-white transition-colors"
      style={{ background: loading ? "#388bfd" : "#1f6feb" }}
    >
      {loading ? (
        <Loader2 size={14} className="animate-spin" />
      ) : (
        <ChevronRight size={14} />
      )}
      {label}
    </button>
  );
}

// ── Outline 渲染 ──────────────────────────────────────────────────────────────

type SourceRef = { path: string };

type Block =
  | { type: "diagram"; content: string }
  | { type: "tree"; content: string }
  | { type: "code"; lang: string; content: string; source?: SourceRef }
  | { type: "html"; content: string };

function Outline({ markdown, lang, owner, repo }: { markdown: string; lang: Lang; owner: string; repo: string }) {
  const sections = parseOutline(markdown);
  return (
    <div className="flex flex-col divide-y" style={{ borderColor: "#30363d" }}>
      {sections.map((section, i) => (
        <OutlineSection key={i} heading={section.heading} blocks={section.blocks} lang={lang} owner={owner} repo={repo} />
      ))}
    </div>
  );
}

function OutlineSection({ heading, blocks, lang, owner, repo }: { heading: string; blocks: Block[]; lang: Lang; owner: string; repo: string }) {
  const [collapsed, setCollapsed] = useState(false);
  const t = T[lang];
  return (
    <div className="flex flex-col">
      <button
        onClick={() => setCollapsed((v) => !v)}
        className="flex items-center justify-between px-4 py-2.5 text-left transition-colors hover:bg-[#161b22]"
      >
        <span
          className="text-[11px] font-semibold uppercase tracking-wider"
          style={{ color: "#8b949e" }}
        >
          {heading}
        </span>
        {collapsed
          ? <ChevronDown size={12} style={{ color: "#8b949e" }} />
          : <ChevronUp size={12} style={{ color: "#8b949e" }} />
        }
      </button>
      {!collapsed && (
        <div className="flex flex-col gap-2 px-4 pb-4">
          {blocks.map((block, j) =>
            block.type === "diagram" ? (
              <DiagramBlock key={j} content={block.content} label={t.diagram} />
            ) : block.type === "tree" ? (
              <TreeBlock key={j} content={block.content} label={t.tree} />
            ) : block.type === "code" ? (
              <CodeBlock key={j} content={block.content} lang={block.lang} source={(block as any).source} owner={owner} repo={repo} />
            ) : (
              <div
                key={j}
                className="text-[13px] leading-6"
                style={{ color: "#e6edf3" }}
                dangerouslySetInnerHTML={{ __html: block.content }}
              />
            )
          )}
        </div>
      )}
    </div>
  );
}

function DiagramBlock({ content, label }: { content: string; label: string }) {
  return (
    <div className="rounded-lg overflow-hidden" style={{ border: "1px solid #30363d" }}>
      <div
        className="px-3 py-1.5 text-[11px] font-medium"
        style={{ background: "#21262d", borderBottom: "1px solid #30363d", color: "#8b949e" }}
      >
        {label}
      </div>
      <pre
        className="px-4 py-3 text-xs font-mono leading-6 overflow-x-auto whitespace-pre"
        style={{ background: "#161b22", color: "#79c0ff" }}
      >
        {content}
      </pre>
    </div>
  );
}

function CodeBlock({ content, lang, source, owner, repo }: { content: string; lang: string; source?: SourceRef; owner: string; repo: string }) {
  const handleSourceClick = async () => {
    if (!source) return;
    // Ask background to fuzzy-match the code block against the cached file content
    let anchor = "";
    try {
      const result: { start: number; end: number } | null = await chrome.runtime.sendMessage({
        action: "find_lines", owner, repo, path: source.path, codeText: content,
      });
      if (result) {
        anchor = `#L${result.start}-L${result.end}`;
        sessionStorage.setItem("repo_learner_flash", JSON.stringify({ start: result.start, end: result.end }));
      }
    } catch {}
    window.location.href = `https://github.com/${owner}/${repo}/blob/HEAD/${source.path}${anchor}`;
  };

  const headerLabel = source ? source.path.split("/").pop() : lang || null;

  return (
    <div className="rounded-lg overflow-hidden" style={{ border: "1px solid #30363d" }}>
      {headerLabel && (
        <div
          onClick={source ? handleSourceClick : undefined}
          className={source ? "flex items-center justify-between px-3 py-1.5 transition-colors hover:bg-[#2d333b]" : "px-3 py-1.5"}
          style={{
            background: "#21262d",
            borderBottom: "1px solid #30363d",
            color: source ? "#58a6ff" : "#8b949e",
            cursor: source ? "pointer" : "default",
            fontSize: 11,
            fontWeight: 500,
          }}
          title={source ? `点击跳转到 GitHub: ${source.path}` : undefined}
        >
          <span>{headerLabel}</span>
          {source && (
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" style={{ opacity: 0.7, flexShrink: 0 }}>
              <path d="M3.75 2h3.5a.75.75 0 0 1 0 1.5h-3.5a.25.25 0 0 0-.25.25v8.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25v-3.5a.75.75 0 0 1 1.5 0v3.5A1.75 1.75 0 0 1 12.25 14h-8.5A1.75 1.75 0 0 1 2 12.25v-8.5C2 2.784 2.784 2 3.75 2Zm6.854-1h4.146a.25.25 0 0 1 .25.25v4.146a.25.25 0 0 1-.427.177L13.03 4.03 9.28 7.78a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042l3.75-3.75-1.543-1.543A.25.25 0 0 1 10.604 1Z"/>
            </svg>
          )}
        </div>
      )}
      <pre
        className="px-4 py-3 text-xs font-mono leading-6 overflow-x-auto whitespace-pre"
        style={{ background: "#161b22", color: "#e6edf3" }}
      >
        {content}
      </pre>
    </div>
  );
}

function TreeBlock({ content, label }: { content: string; label: string }) {
  const lines = content.split("\n");
  return (
    <div
      className="rounded-lg overflow-hidden"
      style={{ border: "1px solid #30363d", borderTop: "none", borderRadius: "0 0 8px 8px" }}
    >
      <div
        className="px-3 py-1.5 text-[11px] font-medium"
        style={{ background: "#21262d", borderBottom: "1px solid #30363d", color: "#8b949e" }}
      >
        {label}
      </div>
      <pre
        className="px-4 py-3 text-xs font-mono leading-6 overflow-x-auto whitespace-pre"
        style={{ background: "#161b22" }}
      >
        {lines.map((line, i) => {
          const hashIdx = line.indexOf("#");
          if (hashIdx === -1) {
            return <span key={i} style={{ color: "#e6edf3" }}>{line + "\n"}</span>;
          }
          return (
            <span key={i}>
              <span style={{ color: "#e6edf3" }}>{line.slice(0, hashIdx)}</span>
              <span style={{ color: "#3d444d" }}>{line.slice(hashIdx)}</span>
              {"\n"}
            </span>
          );
        })}
      </pre>
    </div>
  );
}

// ── 解析 ──────────────────────────────────────────────────────────────────────

function parseOutline(md: string) {
  const lines = md.split("\n");
  const sections: { heading: string; blocks: Block[] }[] = [];
  let current: { heading: string; rawLines: string[] } | null = null;

  for (const line of lines) {
    if (line.startsWith("## ")) {
      if (current && !TECH_HEADING_RE.test(current.heading))
        sections.push(buildSection(current.heading, current.rawLines));
      current = { heading: line.replace(/^## /, "").trim(), rawLines: [] };
    } else if (current) {
      current.rawLines.push(line);
    }
  }
  if (current && !TECH_HEADING_RE.test(current.heading))
    sections.push(buildSection(current.heading, current.rawLines));
  return sections;
}

function buildSection(heading: string, rawLines: string[]): { heading: string; blocks: Block[] } {
  const blocks: Block[] = [];
  let i = 0;

  while (i < rawLines.length) {
    const fenceMatch = rawLines[i].match(/^```(\w*)$/);
    if (fenceMatch) {
      const lang = fenceMatch[1];
      const codeLines: string[] = [];
      i++;
      while (i < rawLines.length && !rawLines[i].startsWith("```")) {
        codeLines.push(rawLines[i]);
        i++;
      }
      i++;
      // Check for SOURCE tag on the very next line (allow optional blank line)
      let source: SourceRef | undefined;
      if (lang !== "diagram" && lang !== "tree") {
        let si = i;
        if (si < rawLines.length && rawLines[si].trim() === "") si++;
        if (si < rawLines.length) {
          const sm = rawLines[si].match(/^<!-- SOURCE: (.+?) -->$/);
          if (sm) {
            source = { path: sm[1].trim() };
            i = si + 1;
          }
        }
      }
      if (lang === "diagram") blocks.push({ type: "diagram", content: codeLines.join("\n") });
      else if (lang === "tree") blocks.push({ type: "tree", content: codeLines.join("\n") });
      else blocks.push({ type: "code", lang, content: codeLines.join("\n"), source });
      continue;
    }

    const textLines: string[] = [];
    while (i < rawLines.length && !rawLines[i].match(/^```/)) {
      textLines.push(rawLines[i]);
      i++;
    }
    const html = renderInline(textLines.join("\n").trim());
    if (html) blocks.push({ type: "html", content: html });
  }

  return { heading, blocks };
}

// ── Tech Stack ────────────────────────────────────────────────────────────────

type TechEntry = { key: string; label: string; pattern: RegExp; docs: string; yt: string };

const TECH_DB: TechEntry[] = [
  // Frontend frameworks
  { key: "react",      label: "React",        pattern: /\breact\b/,                    docs: "https://react.dev",                                              yt: "https://www.youtube.com/results?search_query=react+tutorial" },
  { key: "vue",        label: "Vue.js",        pattern: /\bvue\.?js\b|\bvue\b/,         docs: "https://vuejs.org/guide/",                                       yt: "https://www.youtube.com/results?search_query=vue+js+tutorial" },
  { key: "angular",    label: "Angular",       pattern: /\bangular\b/,                  docs: "https://angular.io/docs",                                        yt: "https://www.youtube.com/results?search_query=angular+tutorial" },
  { key: "svelte",     label: "Svelte",        pattern: /\bsvelte\b/,                   docs: "https://svelte.dev/docs",                                        yt: "https://www.youtube.com/results?search_query=svelte+tutorial" },
  { key: "nextjs",     label: "Next.js",       pattern: /next\.js|nextjs/,              docs: "https://nextjs.org/docs",                                        yt: "https://www.youtube.com/results?search_query=next+js+tutorial" },
  { key: "nuxt",       label: "Nuxt.js",       pattern: /nuxt\.?js|nuxtjs/,             docs: "https://nuxt.com/docs",                                          yt: "https://www.youtube.com/results?search_query=nuxt+js+tutorial" },
  { key: "remix",      label: "Remix",         pattern: /\bremix\b/,                    docs: "https://remix.run/docs/en/main",                                 yt: "https://www.youtube.com/results?search_query=remix+run+tutorial" },
  { key: "astro",      label: "Astro",         pattern: /\bastro\b/,                    docs: "https://docs.astro.build",                                       yt: "https://www.youtube.com/results?search_query=astro+framework+tutorial" },
  { key: "solidjs",    label: "Solid.js",      pattern: /solid\.?js|solidjs/,           docs: "https://www.solidjs.com/guides",                                 yt: "https://www.youtube.com/results?search_query=solidjs+tutorial" },
  // Languages
  { key: "typescript", label: "TypeScript",    pattern: /typescript/,                   docs: "https://www.typescriptlang.org/docs/",                           yt: "https://www.youtube.com/results?search_query=typescript+tutorial" },
  { key: "javascript", label: "JavaScript",    pattern: /javascript/,                   docs: "https://developer.mozilla.org/en-US/docs/Web/JavaScript",        yt: "https://www.youtube.com/results?search_query=javascript+tutorial" },
  { key: "python",     label: "Python",        pattern: /\bpython\b/,                   docs: "https://docs.python.org/3/",                                     yt: "https://www.youtube.com/results?search_query=python+tutorial+for+beginners" },
  { key: "golang",     label: "Go",            pattern: /golang|\bgo language\b|\bgo project\b|written in go/, docs: "https://go.dev/doc/",                    yt: "https://www.youtube.com/results?search_query=golang+tutorial" },
  { key: "rust",       label: "Rust",          pattern: /\brust\b/,                     docs: "https://doc.rust-lang.org/book/",                                yt: "https://www.youtube.com/results?search_query=rust+programming+tutorial" },
  { key: "java",       label: "Java",          pattern: /\bjava\b/,                     docs: "https://docs.oracle.com/en/java/",                               yt: "https://www.youtube.com/results?search_query=java+tutorial+for+beginners" },
  { key: "kotlin",     label: "Kotlin",        pattern: /\bkotlin\b/,                   docs: "https://kotlinlang.org/docs/home.html",                          yt: "https://www.youtube.com/results?search_query=kotlin+tutorial" },
  { key: "swift",      label: "Swift",         pattern: /\bswift\b/,                    docs: "https://www.swift.org/documentation/",                           yt: "https://www.youtube.com/results?search_query=swift+programming+tutorial" },
  { key: "ruby",       label: "Ruby",          pattern: /\bruby\b/,                     docs: "https://ruby-doc.org",                                           yt: "https://www.youtube.com/results?search_query=ruby+programming+tutorial" },
  { key: "csharp",     label: "C#",            pattern: /\bc#\b|\bcsharp\b/,            docs: "https://learn.microsoft.com/en-us/dotnet/csharp/",               yt: "https://www.youtube.com/results?search_query=c+sharp+tutorial+for+beginners" },
  // Backend
  { key: "nodejs",     label: "Node.js",       pattern: /node\.js|nodejs/,              docs: "https://nodejs.org/docs/latest/api/",                            yt: "https://www.youtube.com/results?search_query=node+js+tutorial" },
  { key: "express",    label: "Express",       pattern: /\bexpress\b/,                  docs: "https://expressjs.com/en/guide/routing.html",                    yt: "https://www.youtube.com/results?search_query=express+js+tutorial" },
  { key: "fastapi",    label: "FastAPI",       pattern: /fastapi/,                      docs: "https://fastapi.tiangolo.com",                                   yt: "https://www.youtube.com/results?search_query=fastapi+tutorial" },
  { key: "django",     label: "Django",        pattern: /\bdjango\b/,                   docs: "https://docs.djangoproject.com",                                 yt: "https://www.youtube.com/results?search_query=django+tutorial" },
  { key: "flask",      label: "Flask",         pattern: /\bflask\b/,                    docs: "https://flask.palletsprojects.com",                              yt: "https://www.youtube.com/results?search_query=flask+python+tutorial" },
  { key: "spring",     label: "Spring Boot",   pattern: /spring.?boot|springboot/,      docs: "https://docs.spring.io/spring-boot/docs/current/reference/html/", yt: "https://www.youtube.com/results?search_query=spring+boot+tutorial" },
  // CSS / UI
  { key: "tailwind",   label: "Tailwind CSS",  pattern: /tailwind/,                     docs: "https://tailwindcss.com/docs",                                   yt: "https://www.youtube.com/results?search_query=tailwind+css+tutorial" },
  { key: "shadcn",     label: "shadcn/ui",     pattern: /shadcn/,                       docs: "https://ui.shadcn.com/docs",                                     yt: "https://www.youtube.com/results?search_query=shadcn+ui+tutorial" },
  { key: "mui",        label: "Material UI",   pattern: /material.ui|material ui|@mui/, docs: "https://mui.com/material-ui/getting-started/",                   yt: "https://www.youtube.com/results?search_query=material+ui+react+tutorial" },
  // Build tools
  { key: "vite",       label: "Vite",          pattern: /\bvite\b/,                     docs: "https://vitejs.dev/guide/",                                      yt: "https://www.youtube.com/results?search_query=vite+build+tool+tutorial" },
  { key: "webpack",    label: "Webpack",       pattern: /\bwebpack\b/,                  docs: "https://webpack.js.org/concepts/",                               yt: "https://www.youtube.com/results?search_query=webpack+tutorial" },
  // Databases
  { key: "postgres",   label: "PostgreSQL",    pattern: /postgres(ql)?/,                docs: "https://www.postgresql.org/docs/",                               yt: "https://www.youtube.com/results?search_query=postgresql+tutorial" },
  { key: "mysql",      label: "MySQL",         pattern: /\bmysql\b/,                    docs: "https://dev.mysql.com/doc/",                                     yt: "https://www.youtube.com/results?search_query=mysql+tutorial" },
  { key: "mongodb",    label: "MongoDB",       pattern: /mongodb|mongoose/,             docs: "https://www.mongodb.com/docs/",                                  yt: "https://www.youtube.com/results?search_query=mongodb+tutorial" },
  { key: "redis",      label: "Redis",         pattern: /\bredis\b/,                    docs: "https://redis.io/docs/",                                         yt: "https://www.youtube.com/results?search_query=redis+tutorial" },
  { key: "prisma",     label: "Prisma",        pattern: /\bprisma\b/,                   docs: "https://www.prisma.io/docs/",                                    yt: "https://www.youtube.com/results?search_query=prisma+orm+tutorial" },
  { key: "supabase",   label: "Supabase",      pattern: /\bsupabase\b/,                 docs: "https://supabase.com/docs",                                      yt: "https://www.youtube.com/results?search_query=supabase+tutorial" },
  { key: "firebase",   label: "Firebase",      pattern: /\bfirebase\b/,                 docs: "https://firebase.google.com/docs",                               yt: "https://www.youtube.com/results?search_query=firebase+tutorial" },
  { key: "sqlite",     label: "SQLite",        pattern: /sqlite/,                       docs: "https://www.sqlite.org/docs.html",                               yt: "https://www.youtube.com/results?search_query=sqlite+tutorial" },
  // DevOps / Cloud
  { key: "docker",     label: "Docker",        pattern: /\bdocker\b/,                   docs: "https://docs.docker.com",                                        yt: "https://www.youtube.com/results?search_query=docker+tutorial+for+beginners" },
  { key: "k8s",        label: "Kubernetes",    pattern: /kubernetes|\bk8s\b/,           docs: "https://kubernetes.io/docs/home/",                               yt: "https://www.youtube.com/results?search_query=kubernetes+tutorial" },
  { key: "gh-actions", label: "GitHub Actions",pattern: /github.actions/,               docs: "https://docs.github.com/en/actions",                             yt: "https://www.youtube.com/results?search_query=github+actions+tutorial" },
  // AI / ML
  { key: "openai",     label: "OpenAI API",    pattern: /openai/,                       docs: "https://platform.openai.com/docs/",                              yt: "https://www.youtube.com/results?search_query=openai+api+tutorial" },
  { key: "deepseek",   label: "DeepSeek API",  pattern: /deepseek/,                     docs: "https://platform.deepseek.com/api-docs/",                        yt: "https://www.youtube.com/results?search_query=deepseek+api+tutorial" },
  { key: "langchain",  label: "LangChain",     pattern: /langchain/,                    docs: "https://python.langchain.com/docs/get_started/introduction",     yt: "https://www.youtube.com/results?search_query=langchain+tutorial" },
  { key: "hf",         label: "Hugging Face",  pattern: /hugging.?face/,                docs: "https://huggingface.co/docs",                                    yt: "https://www.youtube.com/results?search_query=hugging+face+transformers+tutorial" },
  { key: "pytorch",    label: "PyTorch",       pattern: /pytorch/,                      docs: "https://pytorch.org/docs/stable/index.html",                     yt: "https://www.youtube.com/results?search_query=pytorch+tutorial" },
  { key: "tf",         label: "TensorFlow",    pattern: /tensorflow/,                   docs: "https://www.tensorflow.org/api_docs",                            yt: "https://www.youtube.com/results?search_query=tensorflow+tutorial" },
  // Other
  { key: "graphql",    label: "GraphQL",       pattern: /graphql/,                      docs: "https://graphql.org/learn/",                                     yt: "https://www.youtube.com/results?search_query=graphql+tutorial" },
  { key: "trpc",       label: "tRPC",          pattern: /\btrpc\b/,                     docs: "https://trpc.io/docs/",                                          yt: "https://www.youtube.com/results?search_query=trpc+tutorial" },
  { key: "electron",   label: "Electron",      pattern: /\belectron\b/,                 docs: "https://www.electronjs.org/docs/latest/",                        yt: "https://www.youtube.com/results?search_query=electron+js+tutorial" },
  { key: "chrome-ext", label: "Chrome Ext",    pattern: /chrome.extension|manifest.v3|chrome\.runtime|chrome\.storage/, docs: "https://developer.chrome.com/docs/extensions/", yt: "https://www.youtube.com/results?search_query=chrome+extension+development+tutorial" },
  { key: "ws",         label: "WebSocket",     pattern: /websocket/,                    docs: "https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API", yt: "https://www.youtube.com/results?search_query=websocket+tutorial" },
];

const TECH_HEADING_RE = /^(?:技术栈|tech stack|technology stack|technologies|技术)$/i;

function parseTechStack(outline: string): string[] {
  const match = outline.match(/## (?:技术栈|Tech Stack|Technology Stack|Technologies?)\n+([\s\S]*?)(?=\n##|$)/i);
  if (!match) return [];
  return match[1]
    .split(/[,，\n]/)
    .map(s => s.replace(/^[-*•]\s*/, "").trim())
    .filter(s => s.length > 1 && !s.startsWith("#"));
}

function lookupTech(name: string): { docs: string; yt: string } {
  const lower = name.toLowerCase();
  const entry = TECH_DB.find(({ pattern }) => pattern.test(lower));
  return {
    docs: entry?.docs ?? `https://www.google.com/search?q=${encodeURIComponent(name + " documentation")}`,
    yt: entry?.yt ?? `https://www.youtube.com/results?search_query=${encodeURIComponent(name + " tutorial")}`,
  };
}

function TechStackBar({ outline, lang }: { outline: string; lang: Lang }) {
  const names = parseTechStack(outline);
  if (names.length === 0) return null;
  return (
    <div
      className="flex gap-1.5 items-center px-4 py-2.5 shrink-0 overflow-x-auto"
      style={{ borderBottom: "1px solid #30363d", background: "#161b22", scrollbarWidth: "none" }}
    >
      <span className="text-[10px] font-medium uppercase tracking-wider shrink-0" style={{ color: "#6e7681" }}>
        {lang === "en" ? "Tech Stack" : "技术栈"}
      </span>
      {names.map((name) => {
        const { docs, yt } = lookupTech(name);
        return (
          <div
            key={name}
            className="flex items-center rounded-full overflow-hidden shrink-0"
            style={{ border: "1px solid #30363d", background: "#21262d", whiteSpace: "nowrap" }}
          >
            <span className="px-2 py-0.5 text-[11px] font-medium" style={{ color: "#e6edf3" }}>
              {name}
            </span>
            <a
              href={docs}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center px-1.5 py-0.5 text-[11px] transition-colors hover:bg-[#1c2d3f]"
              style={{ borderLeft: "1px solid #30363d", color: "#58a6ff", textDecoration: "none" }}
              title={lang === "en" ? "Official Docs" : "官方文档"}
            >
              📖
            </a>
            <a
              href={yt}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center px-1.5 py-0.5 text-[11px] transition-colors hover:bg-[#2d1a1a]"
              style={{ borderLeft: "1px solid #30363d", color: "#da3633", textDecoration: "none" }}
              title={lang === "en" ? "YouTube Tutorial" : "YouTube 教程"}
            >
              ▶
            </a>
          </div>
        );
      })}
    </div>
  );
}

// ── Socratic Chat ─────────────────────────────────────────────────────────────

function PhaseBar({ phase, t }: { phase: ChatPhase; t: typeof T["en"] }) {
  const phases: ChatPhase[] = ["probe", "explore", "verify", "done"];
  const activeIdx = phases.indexOf(phase);
  return (
    <div
      className="flex items-center gap-0 shrink-0 px-4 py-2"
      style={{ borderBottom: "1px solid #30363d", background: "#161b22" }}
    >
      {phases.map((p, i) => (
        <div key={p} className="flex items-center">
          <div
            className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium"
            style={{
              background: i === activeIdx ? "#1c2d3f" : "transparent",
              color: i <= activeIdx ? "#58a6ff" : "#6e7681",
            }}
          >
            <span
              className="h-1.5 w-1.5 rounded-full shrink-0"
              style={{ background: i < activeIdx ? "#2ea043" : i === activeIdx ? "#58a6ff" : "#6e7681" }}
            />
            {t.phaseLabels[p]}
          </div>
          {i < phases.length - 1 && (
            <span style={{ color: "#30363d", fontSize: 10, margin: "0 1px" }}>›</span>
          )}
        </div>
      ))}
    </div>
  );
}

function SocraticChat({
  phase, messages, loading, input, onInput, onSend, bottomRef, t, lang, owner, repo,
}: {
  phase: ChatPhase;
  messages: ChatMsg[];
  loading: boolean;
  input: string;
  onInput: (v: string) => void;
  onSend: () => void;
  bottomRef: React.RefObject<HTMLDivElement>;
  t: typeof T["en"];
  lang: Lang;
  owner: string;
  repo: string;
}) {
  // Only show user messages (not the hidden structured-data message)
  const visibleMessages = messages.filter((m, i) => !(i === 0 && m.role === "user" && m.content.startsWith("项目结构化数据：")));

  return (
    <div className="flex flex-col h-full min-h-0">
      <PhaseBar phase={phase} t={t} />

      {/* Message list */}
      <div className="flex-1 overflow-y-auto min-h-0 px-4 py-3 flex flex-col gap-3">
        {visibleMessages.map((msg, i) => (
          <div key={i} className={`flex flex-col gap-1 ${msg.role === "user" ? "items-end" : "items-start"}`}>
            {msg.role === "assistant" ? (
              <div className="w-full">
                <Outline markdown={msg.content} lang={lang} owner={owner} repo={repo} />
              </div>
            ) : (
              <div
                className="max-w-[85%] rounded-xl px-3 py-2 text-xs leading-5 whitespace-pre-wrap"
                style={{ background: "#1f6feb", color: "#ffffff" }}
              >
                {msg.content}
              </div>
            )}
          </div>
        ))}

        {loading && (
          <div className="flex items-center gap-2 py-1">
            <Loader2 size={12} className="animate-spin" style={{ color: "#58a6ff" }} />
            <span className="text-xs" style={{ color: "#8b949e" }}>{t.chatThinking}</span>
          </div>
        )}

        {phase === "done" && !loading && (
          <div className="flex items-center gap-2 py-2">
            <span className="text-xs font-medium" style={{ color: "#2ea043" }}>✓ {t.learnDone}</span>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input bar */}
      {phase !== "done" && (
        <div
          className="flex items-center gap-2 px-3 py-2.5 shrink-0"
          style={{ borderTop: "1px solid #30363d", background: "#161b22" }}
        >
          <textarea
            value={input}
            onChange={(e) => onInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSend(); }
            }}
            placeholder={t.chatPlaceholder}
            rows={1}
            disabled={loading}
            className="flex-1 resize-none rounded-lg px-3 py-1.5 text-xs leading-5 outline-none"
            style={{
              background: "#0d1117",
              border: "1px solid #30363d",
              color: "#e6edf3",
              maxHeight: 80,
              overflowY: "auto",
            }}
          />
          <button
            onClick={onSend}
            disabled={loading || !input.trim()}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors"
            style={{
              background: loading || !input.trim() ? "#21262d" : "#1f6feb",
              color: loading || !input.trim() ? "#6e7681" : "#ffffff",
            }}
            title={t.chatSend}
          >
            <ChevronRight size={14} />
          </button>
        </div>
      )}
    </div>
  );
}

function renderInline(text: string): string {
  if (!text) return "";
  return text
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/\*\*(.+?)\*\*/g, '<strong style="color:#e6edf3">$1</strong>')
    .replace(/`([^`]+)`/g, '<code style="background:#21262d;color:#e6edf3;padding:1px 5px;border-radius:4px;font-size:11px;font-family:monospace">$1</code>')
    .replace(/^- (.+)$/gm, '<li style="margin-left:16px;list-style:disc;color:#e6edf3">$1</li>')
    .replace(/(<li.*<\/li>\n?)+/gs, (m) => `<ul style="display:flex;flex-direction:column;gap:4px">${m}</ul>`)
    .replace(/^\| (.+) \|$/gm, (_, row) =>
      `<tr>${row.split(" | ").map((c: string) =>
        `<td style="border:1px solid #30363d;padding:4px 8px;font-size:12px;color:#e6edf3">${c}</td>`
      ).join("")}</tr>`
    )
    .replace(/(<tr>.*?<\/tr>\n?)+/gs, (t) =>
      `<table style="width:100%;border-collapse:collapse;font-size:12px">${t}</table>`
    )
    .replace(/\n{2,}/g, "<br/>");
}
