// 加载已保存的值
chrome.storage.sync.get(["anthropicKey", "githubToken"], (data) => {
  if (data.anthropicKey) document.getElementById("anthropicKey").value = data.anthropicKey;
  if (data.githubToken) document.getElementById("githubToken").value = data.githubToken;
});

// 保存
document.getElementById("save").addEventListener("click", () => {
  const anthropicKey = document.getElementById("anthropicKey").value.trim();
  const githubToken = document.getElementById("githubToken").value.trim();

  if (!anthropicKey) {
    document.getElementById("status").textContent = "请填写 Anthropic API Key";
    document.getElementById("status").style.color = "#cf222e";
    return;
  }

  chrome.storage.sync.set({ anthropicKey, githubToken }, () => {
    const status = document.getElementById("status");
    status.textContent = "✓ 已保存";
    status.style.color = "#1a7f37";
    setTimeout(() => (status.textContent = ""), 2000);
  });
});
