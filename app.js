// The API returns independent transcription and translation artifacts. See
// API_CONTRACT.md for the response shape and legacy compatibility behavior.
const CONFIG = { API_BASE: "https://enjoy-petite-context-amendment.trycloudflare.com", DEMO: false };
const RATE = { transcribe: 0.02, translate: 0.05 };
const DIFFICULTY = { fiscal: 1.0, legal: 1.3, handwriting: 1.6, other: 1.0 };
const LANGS = ["French", "English", "German", "Spanish", "Italian", "Polish", "Turkish"];

const $ = (id) => document.getElementById(id);
const sourceOut = $("source-out"), resultOut = $("result-out");
let localPreviewUrl = null;
const euros = (n) => n.toLocaleString("en-GB", { style: "currency", currency: "EUR" });

function el(tag, props = {}, ...kids) {
  const node = Object.assign(document.createElement(tag), props);
  kids.flat().filter((kid) => kid !== null && kid !== undefined).forEach((kid) => node.append(kid));
  return node;
}
function price(words, kind, type) {
  return euros((words || 0) * RATE[type] * (DIFFICULTY[kind] || 1));
}
function revokeLocalPreview() {
  if (localPreviewUrl) URL.revokeObjectURL(localPreviewUrl);
  localPreviewUrl = null;
}

function showLocalOriginal(file, container) {
  revokeLocalPreview();
  localPreviewUrl = URL.createObjectURL(file);
  if (file.type.startsWith("image/")) {
    container.append(el("img", { className: "document-image", src: localPreviewUrl, alt: "Original uploaded document" }));
  } else if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
    container.append(el("iframe", { className: "document-frame", src: localPreviewUrl, title: "Original uploaded document" }));
  } else {
    container.append(el("p", { className: "muted" }, "Original preview will be provided by the processing service."));
  }
}

function setPending(file) {
  drop.classList.add("has-file");
  drop.querySelector("strong").textContent = file.name;
  drop.querySelector("span").textContent = "Click or drop another document to replace it";
  drop.querySelector("small").hidden = true;
  sourceOut.replaceChildren();
  const original = el("div", { className: "document-preview" });
  showLocalOriginal(file, original);
  sourceOut.append(el("h2", {}, "Original document"), original,
    el("p", { className: "muted file-name" }, file.name));
  resultOut.replaceChildren(el("div", { className: "empty" },
    el("span", { className: "spinner", "aria-hidden": "true" }),
    el("strong", {}, "Processing your document"),
    el("span", {}, "Transcription and translation will appear here.")));
}

async function process(file) {
  setPending(file);
  try {
    const result = CONFIG.DEMO ? await mock(file) : await callApi(file);
    render(result, file);
  } catch (error) {
    console.error(error);
    resultOut.replaceChildren(el("p", { className: "status warn", role: "alert" },
      "Processing failed. Please try again, or write to contact@data-compiler.com."));
  }
}

async function mock(file) {
  await new Promise((resolve) => setTimeout(resolve, 1500));
  return {
    document: { word_count: 412, source_language: "Polish", reduction_percent: null, kind: "handwriting" },
    transcription: { status: "needs_review", preview: { first_line: "Example transcription preview", image_url: null } },
    translation: { status: "needs_review", target_language: "English", preview: { first_line: "Example translated preview", image_url: null } },
    demo: true,
  };
}

async function callApi(file) {
  const api = CONFIG.API_BASE.replace(/\/+$/, "");
  const form = new FormData(); form.append("file", file);
  const upload = await fetch(`${api}/upload`, { method: "POST", body: form });
  if (!upload.ok) throw new Error("Upload: HTTP " + upload.status);
  const { job_id: jobId } = await upload.json();
  if (!jobId) throw new Error("No job_id in the response");
  for (let i = 0; i < 150; i++) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const statusResponse = await fetch(`${api}/status/${jobId}`);
    if (!statusResponse.ok) throw new Error("Status: HTTP " + statusResponse.status);
    const { state } = await statusResponse.json();
    if (state === "done") {
      const response = await fetch(`${api}/result/${jobId}`);
      if (!response.ok) throw new Error("Result: HTTP " + response.status);
      const result = await response.json();
      absolutizeArtifactUrls(result, api);
      return result;
    }
    if (state === "error") throw new Error("The pipeline failed (see the server log)");
  }
  throw new Error("Timed out");
}

function absolutizeArtifactUrls(result, api) {
  const resolve = (artifact) => {
    if (!artifact) return;
    for (const key of ["url", "image_url"]) {
      if (artifact[key] && artifact[key].startsWith("/")) artifact[key] = api + artifact[key];
    }
  };
  resolve(result.original_preview);
  resolve(result.document?.original_preview);
  resolve(result.transcription?.preview);
  resolve(result.translation?.preview);
}

function statusLabel(state, noun) {
  if (state === "ready") return `${noun} is ready`;
  if (state === "needs_review") return `${noun} needs human review`;
  if (state === "processing") return `${noun} is processing`;
  if (state === "error") return `${noun} could not be completed`;
  return `${noun} status is not available`;
}
function makeStatus(state, noun) {
  const ready = state === "ready";
  return el("p", { className: `status ${ready ? "ok" : "warn"}` }, statusLabel(state, noun));
}

function preview(artifact, label, { locked = true, demo = false } = {}) {
  const wrap = el("div", { className: "preview" });
  if (artifact?.first_line) {
    wrap.append(el("p", { className: "preview-first-line" }, artifact.first_line));
    if (artifact.image_url || artifact.url) {
      wrap.append(el("img", { className: "document-image preview-rest", src: artifact.image_url || artifact.url, alt: `${label} preview below the first line` }));
    }
  } else if (artifact?.image_url || artifact?.url) {
    wrap.append(el("img", { className: "document-image", src: artifact.image_url || artifact.url, alt: `${label} preview` }));
  } else {
    wrap.append(el("p", { className: "muted preview-missing" }, `${label} preview is not available yet.`));
  }
  if (locked && !demo) {
    wrap.classList.add("locked-preview");
    wrap.append(el("div", { className: "gate" }, el("strong", {}, "Unlock the full result"),
      el("a", { className: "button", href: "/pricing.html" }, "View options")));
  }
  return wrap;
}

function sourceImage(file, originalArtifact) {
  const box = el("div", { className: "document-preview" });
  if (originalArtifact?.url || originalArtifact?.image_url) {
    revokeLocalPreview();
    box.append(el("img", { className: "document-image", src: originalArtifact.image_url || originalArtifact.url, alt: "Original document" }));
  } else if (file) {
    showLocalOriginal(file, box);
  } else {
    box.append(el("p", { className: "muted" }, "Original preview is not available."));
  }
  return box;
}

function offerRow(title, subject, words, kind, rateType, state, trailing = null) {
  return el("div", { className: "offer" },
    el("div", {}, el("strong", {}, title), el("small", {}, statusLabel(state, subject))),
    trailing,
    el("strong", { className: "offer-price" }, price(words, kind, rateType)));
}

function render(result, file) {
  const documentInfo = result.document || {};
  // Preserve the previous API response while the server migrates to the split
  // transcription/translation result contract.
  const legacyReview = result.needs_review ? "needs_review" : result.needs_review === false ? "ready" : "unknown";
  const transcription = result.transcription || { status: legacyReview };
  const sourceLanguage = documentInfo.source_language || result.language || "Unknown";
  const words = documentInfo.word_count ?? result.words ?? 0;
  const kind = documentInfo.kind || result.kind || "other";
  const defaultTarget = sourceLanguage.toLowerCase() === "english" ? "French" : "English";
  const translation = result.translation || { status: legacyReview, target_language: defaultTarget };
  const originalPreview = documentInfo.original_preview || result.original_preview;

  sourceOut.replaceChildren(
    el("h2", {}, "Original document"),
    sourceImage(file, originalPreview),
    el("div", { className: "stats" },
      el("div", {}, el("strong", {}, String(words)), el("span", {}, "words")),
      el("div", {}, el("strong", {}, sourceLanguage), el("span", {}, "source language")),
      documentInfo.reduction_percent != null ? el("div", {}, el("strong", {}, `${documentInfo.reduction_percent}%`), el("span", {}, "reduction")) : null),
    makeStatus(transcription.status, documentInfo.processing_label || "Transcribed document"),
    preview(transcription.preview, "Transcription", { demo: Boolean(result.demo) }),
    offerRow("Transcribe for", "Transcribed document", words, kind, "transcribe", transcription.status));

  const selectedTarget = translation.target_language || defaultTarget;
  const targetSelect = el("select", { "aria-label": "Translation language" },
    LANGS.map((language) => el("option", { value: language, selected: language === selectedTarget }, language)));
  const targetControl = el("label", { className: "target-language" }, el("span", {}, "Translate into"), targetSelect);
  resultOut.replaceChildren(
    el("h2", {}, "Translation"),
    makeStatus(translation.status, "Translation"),
    preview(translation.preview, "Translation", { demo: Boolean(result.demo) }),
    offerRow("Translate for", "Translation", words, kind, "translate", translation.status, targetControl));
}

const drop = $("drop"), input = $("file");
drop.onclick = () => input.click();
drop.onkeydown = (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); input.click(); } };
input.onchange = () => input.files[0] && process(input.files[0]);
["dragenter", "dragover"].forEach((type) => drop.addEventListener(type, (event) => { event.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach((type) => drop.addEventListener(type, (event) => { event.preventDefault(); drop.classList.remove("over"); }));
drop.addEventListener("drop", (event) => event.dataTransfer.files[0] && process(event.dataTransfer.files[0]));
