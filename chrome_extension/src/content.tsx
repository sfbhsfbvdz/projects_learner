import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Panel } from "./Panel";
// ?inline 让 Vite 把 CSS 作为字符串导入，而不是注入到 <head>
import styles from "./globals.css?inline";

const GITHUB_SYSTEM_PATHS = new Set([
  "settings", "notifications", "explore", "marketplace", "topics",
  "trending", "login", "join", "orgs", "organizations", "sponsors",
  "about", "contact", "pricing", "features", "security", "enterprise",
  "pulls", "issues", "search", "new", "account",
]);

const match = location.pathname.match(/^\/([^/]+)\/([^/]+)/);
const firstSegment = match?.[1];
if (match && firstSegment && !GITHUB_SYSTEM_PATHS.has(firstSegment)) {
  const owner = match[1];
  const repo = match[2];

  const host = document.createElement("div");
  host.id = "repo-learner-panel-host";
  // Turbo Drive (GitHub's SPA router) replaces <body> on navigation.
  // data-turbo-permanent tells Turbo to keep this element alive across navigations.
  host.setAttribute("data-turbo-permanent", "");
  document.body.appendChild(host);

  // Shadow DOM 隔离样式
  const shadow = host.attachShadow({ mode: "open" });

  // 把 Tailwind CSS 注入到 Shadow DOM 内部，否则样式进不去
  const styleEl = document.createElement("style");
  styleEl.textContent = styles;
  shadow.appendChild(styleEl);

  const mountPoint = document.createElement("div");
  shadow.appendChild(mountPoint);

  createRoot(mountPoint).render(
    <StrictMode>
      <Panel owner={owner} repo={repo} />
    </StrictMode>
  );
}

// Flash highlighted lines when navigating to a file view
function flashHighlightedLines() {
  try {
    const raw = sessionStorage.getItem("repo_learner_flash");
    if (!raw) return;
    sessionStorage.removeItem("repo_learner_flash");
    const { start, end } = JSON.parse(raw) as { start: number; end: number };
    setTimeout(() => {
      for (let n = start; n <= Math.min(end, start + 150); n++) {
        const lineEl = document.getElementById(`L${n}`);
        const row = lineEl?.closest("tr");
        if (row) {
          (row as HTMLElement).animate(
            [
              { backgroundColor: "rgba(56, 139, 253, 0.35)" },
              { backgroundColor: "transparent" },
              { backgroundColor: "rgba(56, 139, 253, 0.35)" },
              { backgroundColor: "transparent" },
            ],
            { duration: 1200, fill: "forwards" }
          );
        }
      }
    }, 900);
  } catch {}
}

flashHighlightedLines();
document.addEventListener("turbo:render", flashHighlightedLines);
