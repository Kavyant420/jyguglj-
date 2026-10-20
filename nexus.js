/* Nexus agent + PIK IDE — no dependencies, no API key required.
   Override defaults with window.NEXUS_CONFIG before loading this file. */
(() => {
"use strict";

const CFG = Object.assign({
  base: "https://gen.pollinations.ai",              // current gateway
  legacy: "https://text.pollinations.ai/openai",    // fallback if the gateway returns 5xx
  apiKey: "",                                       // optional; free models work without it
  fallbackModels: ["openai-fast", "openai", "mistral"],
  maxHistory: 12,
  system: "You are Nexus, a coding agent inside PIK IDE. Be concise. Put code in fenced blocks. " +
          "When the user shares editor code, edit that code and return the full updated file."
}, window.NEXUS_CONFIG);

const $ = (s, r = document) => r.querySelector(s);
const sleep = (ms, signal) => new Promise((res, rej) => {
  const t = setTimeout(res, ms);
  signal?.addEventListener("abort", () => { clearTimeout(t); rej(new DOMException("Aborted", "AbortError")); }, { once: true });
});
const store = {
  get(k, d) { try { const v = localStorage.getItem("nx:" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("nx:" + k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem("nx:" + k); } catch {} }
};

const root = $("#nx"), msgs = $("#msgs"), prompt = $("#prompt"), sendBtn = $("#send"),
      modelSel = $("#model"), code = $("#code"), gutter = $("#gutter"), out = $("#out"), statusEl = $("#status");

function status(text, kind = "") { statusEl.textContent = text; statusEl.dataset.kind = kind; }

/* ================= Resizable panes ================= */
const stacked = () => matchMedia("(max-width:760px)").matches;
const clamp = (v, a, b) => Math.min(Math.max(v, a), Math.max(a, b));
const sizes = { "agent-w": 380, "agent-h": 300, "editor-h": 340 };

function setSize(name, px) {
  sizes[name] = Math.round(px);
  document.documentElement.style.setProperty("--" + name, sizes[name] + "px");
  store.set("size:" + name, sizes[name]);
}
for (const k of Object.keys(sizes)) { const v = store.get("size:" + k); if (v) setSize(k, v); }

function resizeTo(kind, x, y) {
  if (kind === "agent") {
    const r = root.getBoundingClientRect();
    if (stacked()) setSize("agent-h", clamp(y - r.top, 160, r.height - 240));
    else setSize("agent-w", clamp(x - r.left, 240, r.width - 360));
  } else {
    const top = $(".nx-editor").getBoundingClientRect().top, h = $(".nx-ide").getBoundingClientRect().height;
    setSize("editor-h", clamp(y - top, 100, h - 170));
  }
}

document.querySelectorAll(".nx-split").forEach(el => {
  const kind = el.dataset.split;
  el.addEventListener("pointerdown", e => {
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    el.classList.add("is-active");
    document.body.classList.add("nx-dragging");
    const move = ev => resizeTo(kind, ev.clientX, ev.clientY);
    const up = () => {
      el.classList.remove("is-active");
      document.body.classList.remove("nx-dragging");
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  });
  el.addEventListener("keydown", e => {
    const step = e.shiftKey ? 96 : 24, key = e.key;
    const dir = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[key];
    if (!dir) return;
    e.preventDefault();
    const name = kind === "agent" ? (stacked() ? "agent-h" : "agent-w") : "editor-h";
    const cur = kind === "agent"
      ? (stacked() ? $(".nx-agent").offsetHeight : $(".nx-agent").offsetWidth)
      : $(".nx-editor").offsetHeight;
    // For the agent split, horizontal arrows apply to side-by-side, vertical to stacked; for the editor split, vertical only.
    const horizontalKey = key === "ArrowLeft" || key === "ArrowRight";
    if ((kind === "editor" && horizontalKey) || (kind === "agent" && stacked() === horizontalKey)) return;
    setSize(name, cur + dir * step);
  });
});

$("#maxide").addEventListener("click", e => {
  const on = root.classList.toggle("nx--max");
  e.currentTarget.setAttribute("aria-pressed", on);
  e.currentTarget.textContent = on ? "Show agent" : "Maximize IDE";
});
$("#reset").addEventListener("click", () => {
  for (const k of Object.keys(sizes)) { store.del("size:" + k); document.documentElement.style.removeProperty("--" + k); }
});

/* ================= Editor ================= */
const DEFAULT_CODE = `<!doctype html>
<html>
<body style="font-family:system-ui;display:grid;place-items:center;height:100vh;margin:0">
  <h1>Hello from PIK IDE</h1>
</body>
</html>
`;
code.value = store.get("code", DEFAULT_CODE);

function syncGutter() {
  const n = code.value.split("\n").length;
  if (gutter.dataset.n != n) {
    gutter.dataset.n = n;
    gutter.textContent = Array.from({ length: n }, (_, i) => i + 1).join("\n");
  }
  gutter.scrollTop = code.scrollTop;
}
let saveT;
code.addEventListener("input", () => { syncGutter(); clearTimeout(saveT); saveT = setTimeout(() => store.set("code", code.value), 400); });
code.addEventListener("scroll", () => { gutter.scrollTop = code.scrollTop; });
code.addEventListener("keydown", e => {
  if (e.key === "Tab") { e.preventDefault(); document.execCommand("insertText", false, "  "); }
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); run(); }
});
syncGutter();

function run() {
  out.srcdoc = code.value;   // sandboxed iframe: scripts run, but with no access to this page
  status("Ran " + new Date().toLocaleTimeString(), "ok");
}
function setCode(text) {
  code.focus(); code.select();
  if (!document.execCommand("insertText", false, text)) code.value = text;   // execCommand keeps undo history
  code.dispatchEvent(new Event("input"));
}
async function copy(text, btn) {
  try { await navigator.clipboard.writeText(text); flash(btn, "Copied"); }
  catch { flash(btn, "Copy failed"); }
}
function flash(btn, label) {
  const old = btn.dataset.label || btn.textContent;
  btn.dataset.label = old; btn.textContent = label;
  setTimeout(() => { btn.textContent = old; }, 1200);
}
$("#run").addEventListener("click", run);
$("#copy").addEventListener("click", e => copy(code.value, e.currentTarget));
$("#wipe").addEventListener("click", () => { setCode(""); status("Editor cleared"); });

/* ================= Pollinations client (no key required) ================= */
const auth = () => CFG.apiKey ? { Authorization: "Bearer " + CFG.apiKey } : {};

async function loadModels() {
  let list = [];
  try {
    const r = await fetch(CFG.base + "/v1/models", { headers: auth() });
    if (!r.ok) throw new Error(r.status);
    const j = await r.json();
    const arr = Array.isArray(j) ? j : (j.data || j.models || []);
    list = arr
      .filter(m => typeof m === "string" || !(m.paid_only || m.paidOnly))
      .map(m => typeof m === "string" ? m : (m.id || m.name))
      .filter(id => id && !/audio|tts|whisper|image|video|embed/i.test(id));
  } catch { /* fall through to static list */ }
  if (!list.length) list = CFG.fallbackModels;
  modelSel.replaceChildren(...list.map(id => Object.assign(document.createElement("option"), { value: id, textContent: id })));
  const saved = store.get("model");
  if (saved && list.includes(saved)) modelSel.value = saved;
}
modelSel.addEventListener("change", () => store.set("model", modelSel.value));

async function* sse(res) {
  const rd = res.body.getReader(), dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await rd.read();
    if (done) return;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line.startsWith("data:")) continue;
      const d = line.slice(5).trim();
      if (d === "[DONE]") return;
      try {
        const delta = JSON.parse(d).choices?.[0]?.delta || {};
        yield { think: delta.reasoning_content || delta.reasoning || "", text: delta.content || "" };
      } catch { /* ignore keep-alives */ }
    }
  }
}

/* Streams one model. Retries 429/5xx with backoff and falls back to the legacy host; never retries after output starts. */
async function* streamModel(messages, model, signal) {
  const body = JSON.stringify({ model, messages, stream: true });
  let lastErr;
  for (const url of [CFG.base + "/v1/chat/completions", CFG.legacy]) {
    for (let attempt = 0; attempt < 3; attempt++) {
      let started = false;
      try {
        const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...auth() }, body, signal });
        if (!res.ok) { const e = new Error("HTTP " + res.status); e.status = res.status; throw e; }
        for await (const part of sse(res)) { started = true; yield part; }
        return;
      } catch (e) {
        if (e.name === "AbortError" || started) throw e;
        lastErr = e;
        if (e.status && ![429, 500, 502, 503, 504].includes(e.status)) break;   // not transient: try next host
        await sleep(700 * 2 ** attempt + Math.random() * 250, signal);
      }
    }
  }
  throw lastErr || new Error("Network error");
}

/* Splits <think>…</think> out of plain content for models that inline their reasoning. */
function thinkSplitter() {
  let inT = false, carry = "";
  return chunk => {
    let s = carry + chunk, t = "", x = ""; carry = "";
    while (s) {
      const tag = inT ? "</think>" : "<think>", i = s.indexOf(tag);
      if (i >= 0) {
        if (inT) t += s.slice(0, i); else x += s.slice(0, i);
        s = s.slice(i + tag.length); inT = !inT; continue;
      }
      let keep = 0;
      for (let k = Math.min(tag.length - 1, s.length); k > 0; k--) if (tag.startsWith(s.slice(-k))) { keep = k; break; }
      const o = s.slice(0, s.length - keep); carry = s.slice(s.length - keep);
      if (inT) t += o; else x += o;
      s = "";
    }
    return { t, x };
  };
}

/* ================= Chat UI ================= */
const history = [];
let controller = null;

function el(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }

function renderBody(node, text) {
  const parts = text.split(/(```[\s\S]*?(?:```|$))/g).filter(Boolean);
  node.replaceChildren(...parts.map(p => {
    const m = p.startsWith("```") && /^```([\w+-]*)\n?([\s\S]*?)(?:```)?$/.exec(p);
    if (!m) return el("p", "", p.trim());
    const box = el("div", "code"), head = el("div", "code__head", m[1] || "code");
    const cp = el("button", "btn btn--sm btn--ghost", "Copy"), ins = el("button", "btn btn--sm", "Insert");
    cp.type = ins.type = "button"; cp.dataset.act = "copy"; ins.dataset.act = "insert";
    head.append(cp, ins);
    const pre = el("pre"); pre.textContent = m[2].replace(/\n$/, "");
    box.append(head, pre);
    return box;
  }));
}

msgs.addEventListener("click", e => {
  const b = e.target.closest("button[data-act]");
  if (!b) return;
  const text = b.closest(".code").querySelector("pre").textContent;
  if (b.dataset.act === "copy") copy(text, b);
  else { setCode(text); flash(b, "Inserted"); status("Inserted into editor", "ok"); }
});

function addMsg(kind) {
  $(".nx-empty")?.remove();
  const m = el("article", "msg msg--" + kind), body = el("div", "msg__body");
  m.append(body); msgs.append(m);
  return { m, body };
}
const scrollDown = () => { msgs.scrollTop = msgs.scrollHeight; };

function setBusy(on) {
  sendBtn.textContent = on ? "Stop" : "Send";
  sendBtn.classList.toggle("btn--stop", on);
  sendBtn.classList.toggle("btn--primary", !on);
  sendBtn.dataset.mode = on ? "stop" : "send";
}

async function send(text) {
  const share = $("#share").getAttribute("aria-pressed") === "true";
  const user = addMsg("user"); user.m.textContent = text;
  const content = share && code.value.trim() ? text + "\n\nCurrent editor code:\n```\n" + code.value + "\n```" : text;
  history.push({ role: "user", content });
  const { m, body } = addMsg("ai");
  body.append(Object.assign(el("div", "pending"), { innerHTML: "<span>Thinking</span><i></i><i></i><i></i>" }));
  scrollDown();

  controller = new AbortController(); setBusy(true);
  const msgsOut = [{ role: "system", content: CFG.system }, ...history.slice(-CFG.maxHistory)];
  const chain = [modelSel.value, ...Array.from(modelSel.options, o => o.value).filter(v => v !== modelSel.value)].slice(0, 3);

  let answer = "", thinkEl = null, thinkBody = null, t0 = 0, answerEl = el("div"), done = false, lastErr;
  const paint = () => { renderBody(answerEl, answer); scrollDown(); };
  let raf = 0; const schedule = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; paint(); }); };

  for (const [i, model] of chain.entries()) {
    try {
      const split = thinkSplitter();
      for await (const part of streamModel(msgsOut, model, controller.signal)) {
        const { t, x } = split(part.text);
        const thought = part.think + t;
        if (body.querySelector(".pending")) { body.replaceChildren(); body.append(answerEl); }
        if (thought) {
          if (!thinkEl) {
            t0 = Date.now();
            thinkEl = el("details", "think"); thinkEl.open = true; thinkEl.dataset.state = "live";
            thinkEl.innerHTML = '<summary><span class="think__orb"></span><span class="think__label">Thinking…</span></summary>';
            thinkBody = el("div", "think__body"); thinkEl.append(thinkBody);
            body.prepend(thinkEl);
          }
          thinkBody.textContent += thought; thinkBody.scrollTop = thinkBody.scrollHeight;
        }
        if (x) { answer += x; schedule(); }
      }
      done = true; if (i > 0) status("Switched to " + model, "ok"); break;
    } catch (e) {
      if (e.name === "AbortError") { done = true; break; }
      lastErr = e;
      if (answer || thinkBody?.textContent) break;      // output already started: keep it, don't switch
      if (i < chain.length - 1) status(`${model} unavailable (${e.status || "network"}), trying ${chain[i + 1]}…`, "err");
    }
  }

  if (raf) cancelAnimationFrame(raf);
  paint();
  if (thinkEl) {
    thinkEl.dataset.state = "done"; thinkEl.open = false;
    thinkEl.querySelector(".think__label").textContent = "Thought for " + Math.max(1, Math.round((Date.now() - t0) / 1000)) + "s";
  }
  if (!done && !answer) {
    m.classList.add("msg--err");
    body.replaceChildren(el("p", "", `Couldn't reach the free models (${lastErr?.status ? "HTTP " + lastErr.status : "network error"}). ` +
      "Wait a few seconds and press Send again, or pick another model."));
    history.pop(); status("Request failed", "err");
  } else if (answer) history.push({ role: "assistant", content: answer });
  else if (thinkBody) history.pop();
  controller = null; setBusy(false); scrollDown();
}

$("#composer").addEventListener("submit", e => {
  e.preventDefault();
  if (controller) { controller.abort(); return; }
  const text = prompt.value.trim();
  if (!text) return;
  prompt.value = ""; grow();
  send(text);
});
prompt.addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); $("#composer").requestSubmit(); }
});
function grow() { prompt.style.height = "auto"; prompt.style.height = Math.min(prompt.scrollHeight, 160) + "px"; }
prompt.addEventListener("input", grow);

$("#share").addEventListener("click", e => {
  const b = e.currentTarget; b.setAttribute("aria-pressed", b.getAttribute("aria-pressed") !== "true");
});
$("#clear").addEventListener("click", () => {
  controller?.abort(); history.length = 0;
  msgs.replaceChildren(el("p", "nx-empty", "Ask Nexus to write, fix or explain code. Use Insert on any code block to send it to the editor."));
});

$("#clear").click();
loadModels();
})();
