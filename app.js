// Settings. DEMO=true returns simulated results without a server; set it to false when the API is up.
const CONFIG = { API_BASE: "https://enjoy-petite-context-amendment.trycloudflare.com", DEMO: false };
// Prices and lead times: provisional values, adjust as needed.
const RATE = { transcribe: 0.02, translate: 0.05 };           // € per word
const DIFFICULTY = { fiscal: 1.0, legal: 1.3, handwriting: 1.6, other: 1.0 };
const WORDS_PER_DAY = 1500;
const LANGS = ["French", "English", "German", "Spanish", "Italian", "Polish", "Turkish"];

const $ = (id) => document.getElementById(id);
const out = $("out");
const euros = (n) => n.toLocaleString("en-GB", { style: "currency", currency: "EUR" });

function el(tag, props = {}, ...kids) {
  const e = Object.assign(document.createElement(tag), props);
  kids.flat().forEach((k) => e.append(k));
  return e;
}
function quote(words, kind, mult) {
  const d = DIFFICULTY[kind] || 1;
  const days = Math.max(1, Math.ceil((words * d * mult) / WORDS_PER_DAY));
  const date = new Date(Date.now() + days * 864e5).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
  return { date };
}
const price = (words, kind, type) => euros(words * RATE[type] * (DIFFICULTY[kind] || 1));

// --- Processing ---
async function process(file) {
  out.className = "empty"; out.textContent = "Processing…";
  try {
    render(CONFIG.DEMO ? await mock(file) : await callApi(file));
  } catch (e) {
    console.error(e);
    out.className = "empty"; out.textContent = "Processing failed. Please try again, or write to contact@data-compiler.com.";
  }
}
async function mock(file) {
  await new Promise((r) => setTimeout(r, 1500));
  const n = file.name.toLowerCase();
  if (n.includes("polish")) return { words: 412, language: "Polish", needs_review: true, kind: "handwriting" };
  if (n.includes("tax")) return { words: 868, language: "French", needs_review: false, kind: "fiscal" };
  return { words: 300, language: "English", needs_review: true, kind: "other" };
}
async function callApi(file) {
  const api = CONFIG.API_BASE.replace(/\/+$/, "");          // tolerate a trailing "/"
  const fd = new FormData(); fd.append("file", file);
  const up = await fetch(`${api}/upload`, { method: "POST", body: fd });
  if (!up.ok) throw new Error("Upload: HTTP " + up.status);
  const { job_id } = await up.json();
  if (!job_id) throw new Error("No job_id in the response");
  for (let i = 0; i < 150; i++) {                           // 5 minutes maximum
    await new Promise((r) => setTimeout(r, 2000));
    const st = await fetch(`${api}/status/${job_id}`);
    if (!st.ok) throw new Error("Status: HTTP " + st.status);
    const { state } = await st.json();
    if (state === "done") {
      const res = await fetch(`${api}/result/${job_id}`);
      if (!res.ok) throw new Error("Result: HTTP " + res.status);
      const data = await res.json();
      if (data.preview_url) data.preview_url = api + data.preview_url;
      return data;
    }
    if (state === "error") throw new Error("The pipeline failed (see the uvicorn terminal)");
  }
  throw new Error("Timed out");
}

// --- Display ---
function preview(r) {
  // In production `preview_url` must be an image ALREADY blurred server-side (the CSS blur below is demo-only decoration).
  const box = el("div", { className: "preview" });
  if (r.preview_url) {
    box.append(el("img", { src: r.preview_url, alt: "Document preview", style: "width:100%;display:block" }));
  } else if (CONFIG.DEMO) {
    box.append(el("div", { className: "top" }, "Tax notice issued in 2021 — Public Finance Directorate. Your references: tax number, notice reference."));
    box.append(el("div", { className: "blur" }, "The rest of the document is hidden. Taxable income, net income tax before adjustments, social contributions, balance due or refundable, payment and appeal procedures."));
  } else {
    box.append(el("div", { className: "top" }, "Preview unavailable for this document."));
  }
  box.append(el("div", { className: "gate" }, el("strong", {}, "Pay to see the full document"),
    el("button", { onclick: () => (location.href = "/pricing.html") }, "Unlock the document")));
  return box;
}
function render(r) {
  out.className = ""; out.replaceChildren();
  out.append(el("p", { className: "status " + (r.needs_review ? "warn" : "ok") },
    r.needs_review ? "Your document needs human review" : "Your document is ready"));
  out.append(el("div", { className: "stat" },
    el("div", {}, el("b", {}, String(r.words)), el("span", {}, "words")),
    el("div", {}, el("b", {}, r.language), el("span", {}, "language"))));
  out.append(preview(r));
  if (!r.needs_review) {
    const fmt = el("select", { "aria-label": "Format" }, ["DOCX", "PDF", "JSON"].map((f) => el("option", { value: f }, f)));
    out.append(el("div", { className: "opt" }, el("p", {}, "Download as"), fmt,
      el("button", { onclick: () => (location.href = "/pricing.html") }, "Download")));
    return;
  }
  const q1 = quote(r.words, r.kind, 1);
  out.append(el("div", { className: "opt" }, el("p", {}, el("strong", {}, "Transcribe"),
    el("small", {}, `Ready by ${q1.date}`)), el("strong", {}, price(r.words, r.kind, "transcribe"))));
  const sel = el("select", { "aria-label": "Target language" }, LANGS.filter((l) => l !== r.language).map((l) => el("option", { value: l }, l)));
  const info = el("small", {}), cost = el("strong", {});
  const upd = () => { info.textContent = `Ready by ${quote(r.words, r.kind, 1.8).date}`; cost.textContent = price(r.words, r.kind, "translate"); };
  sel.onchange = upd; upd();
  out.append(el("div", { className: "opt" }, el("p", {}, el("strong", {}, "Translate into "), sel, info), cost));
}

// --- File drop ---
const drop = $("drop"), input = $("file");
drop.onclick = () => input.click();
drop.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); } };
input.onchange = () => input.files[0] && process(input.files[0]);
["dragenter", "dragover"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
drop.addEventListener("drop", (e) => e.dataTransfer.files[0] && process(e.dataTransfer.files[0]));
