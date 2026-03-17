chrome.storage.sync.get(["deepseekKey", "githubToken"], (data) => {
  if (data.deepseekKey) document.getElementById("deepseekKey").value = data.deepseekKey;
  if (data.githubToken) document.getElementById("githubToken").value = data.githubToken;
});

document.getElementById("save").addEventListener("click", () => {
  const deepseekKey = document.getElementById("deepseekKey").value.trim();
  const githubToken = document.getElementById("githubToken").value.trim();

  if (!deepseekKey) {
    const status = document.getElementById("status");
    status.textContent = "请填写 DeepSeek API Key";
    status.style.color = "#cf222e";
    return;
  }

  chrome.storage.sync.set({ deepseekKey, githubToken }, () => {
    const status = document.getElementById("status");
    status.textContent = "✓ 已保存";
    status.style.color = "#1a7f37";
    setTimeout(() => (status.textContent = ""), 2000);
  });
});
