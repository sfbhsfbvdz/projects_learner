import { StrictMode, useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { Button } from "./components/ui/button";
import "./globals.css";

function Options() {
  const [deepseekKey, setDeepseekKey] = useState("");
  const [githubToken, setGithubToken] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    chrome.storage.sync.get(["deepseekKey", "githubToken"], (data: { deepseekKey?: string; githubToken?: string }) => {
      if (data.deepseekKey) setDeepseekKey(data.deepseekKey);
      if (data.githubToken) setGithubToken(data.githubToken);
    });
  }, []);

  const handleSave = () => {
    chrome.storage.sync.set({ deepseekKey, githubToken }, () => {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    });
  };

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="mx-auto max-w-md">
        <h1 className="mb-6 text-xl font-bold text-foreground">Repo Learner 设置</h1>

        <div className="flex flex-col gap-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">
              DeepSeek API Key <span className="text-red-500">*</span>
            </label>
            <input
              type="password"
              value={deepseekKey}
              onChange={(e) => setDeepseekKey(e.target.value)}
              placeholder="sk-..."
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              从 platform.deepseek.com/api_keys 获取
            </p>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">
              GitHub Token（可选）
            </label>
            <input
              type="password"
              value={githubToken}
              onChange={(e) => setGithubToken(e.target.value)}
              placeholder="ghp_..."
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              不填限速 60次/小时，填写后提升到 5000次/小时
            </p>
          </div>

          <Button onClick={handleSave} disabled={!deepseekKey}>
            {saved ? "✓ 已保存" : "保存"}
          </Button>
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode><Options /></StrictMode>
);
