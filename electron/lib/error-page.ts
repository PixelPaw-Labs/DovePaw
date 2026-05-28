const HTML_ESCAPES: Record<string, string> = {
  "<": "&lt;",
  ">": "&gt;",
  "&": "&amp;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(s: string): string {
  return (s ?? "").replace(/[<>&"']/g, (c) => HTML_ESCAPES[c] ?? c);
}

export function renderErrorPage(failedURL: string, reason: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>This page wandered off</title><style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:linear-gradient(135deg,#fef3c7 0%,#fde68a 100%);color:#78350f;height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
.box{text-align:center;max-width:560px}
.emoji{font-size:120px;line-height:1;margin-bottom:24px;animation:wob 3s ease-in-out infinite;display:inline-block}
@keyframes wob{0%,100%{transform:rotate(-6deg)}50%{transform:rotate(6deg)}}
h1{font-size:28px;font-weight:700;margin-bottom:10px}
.quip{font-size:15px;color:#92400e;margin-bottom:22px;font-style:italic}
.url{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;background:rgba(120,53,15,.1);padding:8px 12px;border-radius:6px;font-size:12px;word-break:break-all;margin-bottom:8px;display:inline-block;max-width:100%}
.reason{font-size:12px;color:#a16207;margin-bottom:26px}
.actions{display:flex;gap:10px;justify-content:center;flex-wrap:wrap}
button{background:#78350f;color:#fef3c7;border:none;padding:9px 18px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer}
button:hover{background:#92400e}
button.sec{background:transparent;color:#78350f;border:2px solid #78350f;padding:7px 16px}
</style></head><body><div class="box">
<div class="emoji">😼</div>
<h1>The cat ate this page.</h1>
<p class="quip">Either it never existed, the internet swallowed it, or somebody fat-fingered the URL.</p>
<div class="url">${escapeHtml(failedURL)}</div>
<p class="reason">Reason: ${escapeHtml(reason)}</p>
<div class="actions"><button onclick="history.back()">← Back</button><button class="sec" onclick="location.reload()">Try again</button></div>
</div></body></html>`;
}
