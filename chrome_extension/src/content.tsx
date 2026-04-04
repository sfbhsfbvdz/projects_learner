import { StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Panel } from "./Panel";
// ?inline 让 Vite 把 CSS 作为字符串导入，而不是注入到 <head>
import styles from "./globals.css?inline";

const GITHUB_SYSTEM_PATHS = new Set([
  "settings", "notifications", "explore", "marketplace", "topics",
  "trending", "login", "join", "orgs", "organizations", "sponsors",
  "about", "contact", "pricing", "features", "security", "enterprise",
  "pulls", "issues", "search", "new", "account",
]);

type RepoInfo = { owner: string; repo: string };

let root: Root | null = null;

function parseRepoFromLocation(): RepoInfo | null {
  const match = location.pathname.match(/^\/([^/]+)\/([^/]+)/);
  const firstSegment = match?.[1];
  if (!match || !firstSegment || GITHUB_SYSTEM_PATHS.has(firstSegment)) {
    return null;
  }
  return { owner: match[1], repo: match[2] };
}

function ensureRoot(): Root {
  const existingHost = document.getElementById("repo-learner-panel-host");
  const host = existingHost ?? document.createElement("div");
  if (!existingHost) {
    host.id = "repo-learner-panel-host";
    host.setAttribute("data-turbo-permanent", "");
    document.body.appendChild(host);

    const shadow = host.attachShadow({ mode: "open" });

    const styleEl = document.createElement("style");
    styleEl.textContent = styles;
    shadow.appendChild(styleEl);

    const mountPoint = document.createElement("div");
    shadow.appendChild(mountPoint);
    root = createRoot(mountPoint);
  }

  if (!root) {
    const mountPoint = host.shadowRoot?.lastElementChild;
    if (!mountPoint) {
      throw new Error("Repo Learner mount point missing");
    }
    root = createRoot(mountPoint);
  }

  return root;
}

function renderPanel() {
  const repo = parseRepoFromLocation();
  const appRoot = ensureRoot();

  appRoot.render(
    <StrictMode>
      {repo ? <Panel key={`${repo.owner}/${repo.repo}`} owner={repo.owner} repo={repo.repo} /> : null}
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

renderPanel();
flashHighlightedLines();
document.addEventListener("turbo:render", () => {
  renderPanel();
  flashHighlightedLines();
});
