import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Panel } from "./Panel";
import "./globals.css";

// 解析当前 GitHub repo
const match = location.pathname.match(/^\/([^/]+)\/([^/]+)/);
if (match) {
  const owner = match[1];
  const repo = match[2];

  // 用 Shadow DOM 隔离样式，不污染 GitHub 页面
  const host = document.createElement("div");
  document.body.appendChild(host);

  const shadow = host.attachShadow({ mode: "open" });
  const mountPoint = document.createElement("div");
  shadow.appendChild(mountPoint);

  createRoot(mountPoint).render(
    <StrictMode>
      <Panel owner={owner} repo={repo} />
    </StrictMode>
  );
}
