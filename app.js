const CONFIG = {
  API_BASE: "https://api.data-compiler.com",
  DIAGNOSTIC_API_BASE: "https://api.data-compiler.com",
  DEMO: false,
};
const RATE = { transcribe: 0.02, translate: 0.05 };
const DIFFICULTY = { fiscal: 1.0, legal: 1.3, handwriting: 1.6, other: 1.0 };
const LANGS = ["Chinese (Simplified)", "French", "English", "German", "Spanish", "Italian", "Polish", "Turkish"];
const LANGUAGE_CODES = { "Chinese (Simplified)": "zh", French: "fr", English: "en", German: "de", Spanish: "es", Italian: "it", Polish: "pl", Turkish: "tr" };
const FORMATS = ["PDF (text)", "PDF (layer)", "DOCX", "TXT", "XLIFF"];
const FIRST_PAGE_ONLY_THRESHOLD = 10 * 1024 * 1024;   // keep equal to the API constants
const ACCEPTED_EXTENSIONS = [".pdf", ".png", ".jpg", ".jpeg"];
// Output formats and target languages that really work today. Everything else stays in the
// lists but invites users to contact us when selected. Edit these sets as features ship.
const AVAILABLE_FORMATS = new Set(["PDF (text)", "PDF (layer)"]);
const AVAILABLE_TARGET_LANGUAGES = new Set(["English", "French", "Chinese (Simplified)"]);
const outputFormatNotice = (name) => `${name} isn't available as an output format yet. Contact us for pricing and delivery date.`;
const targetLanguageNotice = (name) => `${name} isn't available as a target language yet. Contact us for pricing and delivery date.`;
class NoticeError extends Error {}   // a message meant for the user, shown as is
const MAX_UPLOAD_SIZE = 100 * 1024 * 1024;
const $ = (id) => document.getElementById(id);
const euros = (amount) => amount.toLocaleString("en-GB", { style: "currency", currency: "EUR" });
const diagnosticApiBase = () => (CONFIG.DIAGNOSTIC_API_BASE || CONFIG.API_BASE).trim().replace(/\/+$/, "");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let processingGeneration = 0;   // bumped per upload: stale async work checks it before touching the DOM
let processingController = null;   // aborts the fetches of the file being replaced
let fastRun = 0;             // identifies the current upload, so an old fast preview cannot draw over a new one
let progressRendered = false;
let coreDone = false;
let documentMode = null;     // "scan" or "native", known from the fast API
let progressRatio = "900 / 1273";

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  children.flat().filter((child) => child !== null && child !== undefined).forEach((child) => node.append(child));
  return node;
}
function unsupportedFormatMessage(fileName) {
  const match = /\.([A-Za-z0-9]{1,5})$/.exec(fileName || "");
  if (!match) return "Please upload a PDF, JPG or PNG file (up to 100 MB).";
  return `${match[1].toUpperCase()} files aren't supported yet. Contact us for pricing and delivery date.`;
}
async function apiNotice(response, fallback) {
  // 413 / 415 carry a user-facing sentence in `detail`; show it instead of "HTTP 415".
  if ([413, 415].includes(response.status)) {
    const body = await response.json().catch(() => null);
    if (typeof body?.detail === "string") return new NoticeError(body.detail);
  }
  return new Error(fallback);
}
function finitePercent(value) {
  if (value === null || value === undefined || value === "") return null;
  const percent = Number(value);
  return Number.isFinite(percent) ? percent : null;
}
function sizeReductionMetric(percent, title) {
  if (percent === null) return null;
  return el("div", {
    className: `size-reduction${percent > 0 ? " reduced" : ""}`,
    title,
    "aria-label": `${percent}% size reduction. ${title}`,
  }, el("strong", {}, `${percent}%`), el("span", {}, "size reduction"));
}
function price(words, kind, service) { return euros((words || 0) * RATE[service] * (DIFFICULTY[kind] || 1)); }
function statusText(state, noun) {
  if (state === "ready") return `${noun} is ready`;
  if (state === "needs_review") return `${noun} needs human review`;
  if (state === "error") return `${noun} could not be completed`;
  return `${noun} is being processed`;
}
function deliveryDate(words) {
  // Planning estimate: a reviewer can handle about 2,500 words per working day.
  const days = Math.max(1, Math.ceil(Math.max(0, Number(words) || 0) / 2500));
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 1);
  let remaining = days - 1;
  while (remaining > 0) {
    date.setDate(date.getDate() + 1);
    if (date.getDay() !== 0 && date.getDay() !== 6) remaining--;
  }
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}
function fillSelect(select, options = [], selectedValue) {
  select.replaceChildren(...options.map((value) => el("option", { value, selected: value === selectedValue }, value)));
}
function absoluteArtifactUrls(result, api) {
  const resolve = (artifact) => {
    if (!artifact) return;
    const keys = ["url", "source_text_url", "target_text_url", "image_url"];
    if (artifact.generated === false) {
      keys.forEach((key) => delete artifact[key]);
      return;
    }
    for (const key of keys) {
      if (artifact[key]?.startsWith("/")) artifact[key] = api + artifact[key];
    }
  };
  resolve(result.document?.original_preview);
  Object.values(result.document?.output_formats || {}).forEach(resolve);
  resolve(result.transcription?.text);
  resolve(result.transcription?.document);
  resolve(result.transcription?.preview);
  resolve(result.translation?.preview);
  (result.translations || []).forEach((translation) => resolve(translation.preview));
}
function showProcessing() {
  $("error").hidden = true;
  const drop = $("drop");
  drop.classList.add("processing-drop");
  drop.querySelector("strong").textContent = "Treatment in progress…";
  drop.querySelector("span").textContent = "Your document is being processed";
  drop.querySelector("small").hidden = true;
}

function updateProcessingStage(stage) {
  const messages = {
    queued: "Upload received; preparing the page…",
    opening: "Opening the document…",
    extracting_text: "Reading the document text…",
    ocr: "Recognizing text on the first page…",
    preparing_preview: "Preparing your preview…",
    translation: "Translating the preview…",
  };
  $("drop").querySelector("span").textContent = messages[stage] || "Your document is being processed";
}

function resetForNewFile() {
  fastRun++;                                   // stops the fast-preview polling of the previous file
  $("work").hidden = true;                     // back to the upload view, as on a fresh page
  $("upload-panel").hidden = false;
  $("drop").classList.add("processing-drop");
  $("drop").querySelector("strong").textContent = "Treatment in progress…";
  $("drop").querySelector("span").textContent = "Your document is being processed";
  $("drop").querySelector("small").hidden = true;
  $("error").hidden = true;
  $("source-visual").replaceChildren();        // otherwise renderCoreProgress keeps the previous file's row
  $("source-visual").classList.remove("diagnostic-flow-frame");
}

async function process(file) {
  const extension = (/\.[^.]+$/.exec(file.name.toLowerCase()) || [""])[0];
  if (!ACCEPTED_EXTENSIONS.includes(extension)) {
    $("error").textContent = unsupportedFormatMessage(file.name);
    $("error").hidden = false;
    input.value = "";
    return;
  }
  if (file.size > MAX_UPLOAD_SIZE) {
    window.alert("File is too large. The upload limit is 100 MB.");
    input.value = "";
    return;
  }
  const isPdf = file.name.toLowerCase().endsWith(".pdf");
  let firstPageOnlyConfirmed = false;
  if (isPdf && file.size > FIRST_PAGE_ONLY_THRESHOLD) {
    const continueWithFirstPage = window.confirm("This file is larger than 10 MB. Only its first page will be treated. Continue?");
    if (!continueWithFirstPage) {
      input.value = "";
      return;
    }
    firstPageOnlyConfirmed = true;
  }
  const generation = ++processingGeneration;
  processingController?.abort();          // a newer file replaces the one in progress
  const controller = new AbortController();
  processingController = controller;
  resetForNewFile();
  showProcessing();
  try {
    if (CONFIG.DEMO) {
      const result = await demoResult();
      if (generation === processingGeneration && !controller.signal.aborted) render(result);
      return;
    }
    if (!CONFIG.API_BASE.trim()) throw new Error("The Core processing API is not configured.");
    progressRendered = false;
    coreDone = false;
    documentMode = null;
    startFastPreview(file, firstPageOnlyConfirmed, controller.signal);   // not awaited: the GIF appears while Core is working
    const result = await callApi(file, controller.signal, generation);
    if (generation !== processingGeneration || controller.signal.aborted) return;
    coreDone = true;
    render(result);
  } catch (error) {
    if (generation !== processingGeneration || controller.signal.aborted) return;   // a newer file took over: stay silent
    fastRun++;   // stop the fast preview of this upload
    console.error(error);
    $("error").textContent = error instanceof NoticeError
      ? error.message
      : `${error.message || "Processing failed."} Please try again, or write to contact@data-compiler.com.`;
    $("error").hidden = false;
    $("work").hidden = true;
    $("upload-panel").hidden = false;
    $("drop").classList.remove("processing-drop");
    $("drop").querySelector("strong").textContent = "Drop a file";
    $("drop").querySelector("span").textContent = "or click to upload";
    $("drop").querySelector("small").hidden = true;
  } finally {
    if (processingController === controller) processingController = null;
    input.value = "";   // lets the user pick the same file again from the file dialog
  }
}

async function demoResult() {
  await new Promise((resolve) => setTimeout(resolve, 1200));
  return {
    document: { word_count: 53, source_language: "Polish", reduction_percent: null, kind: "handwriting", mode: "scan", original_preview: { url: null, width: 900, height: 1273 } },
    transcription: { status: "needs_review" },
    translation: { status: "needs_review", target_language: "English", preview: { mode: "scan_text_fade", source_text_url: null, target_text_url: null } },
    demo: true,
  };
}

async function callApi(file, signal, generation) {
  const api = CONFIG.API_BASE.trim().replace(/\/+$/, "");
  if (!api) throw new Error("The full-processing API is not configured.");
  const stale = () => signal.aborted || generation !== processingGeneration;
  const form = new FormData(); form.append("file", file);
  const uploaded = await fetch(`${api}/upload`, { method: "POST", body: form, signal });
  if (stale()) return null;
  if (!uploaded.ok) throw await apiNotice(uploaded, `Upload failed: HTTP ${uploaded.status}`);
  const { job_id: jobId } = await uploaded.json();
  if (!jobId) throw new Error("The upload response did not include a job id");
  if (stale()) return null;
  let progressShown = false;
  for (let attempt = 0; attempt < 600; attempt++) {
    await sleep(1000);
    if (stale()) return null;
    const statusResponse = await fetch(`${api}/status/${jobId}`, { signal });
    if (stale()) return null;
    if (!statusResponse.ok) throw new Error(`Status failed: HTTP ${statusResponse.status}`);
    const status = await statusResponse.json();
    if (stale()) return null;
    const { state } = status;
    if (state === "error") throw new Error("The processing service could not complete this document");
    if (!progressShown && status.preview?.original_preview?.url) {
      status.preview.original_preview.url = api + status.preview.original_preview.url;
      renderCoreProgress(status.preview.original_preview);
      progressShown = true;
    }
    if (status.preview?.word_boxes?.length) applyWordHighlights(status.preview);
    if (state === "done") {
      const response = await fetch(`${api}/result/${jobId}`, { signal });
      if (stale()) return null;
      if (!response.ok) throw new Error(`Result failed: HTTP ${response.status}`);
      const result = await response.json();
      if (stale()) return null;
      absoluteArtifactUrls(result, api);
      return result;
    }
  }
  throw new Error("Processing timed out");
}

function makeProgressFlow(ratio, mode) {
  // Empty page boxes with a spinner where the arrow will be: same layout as the final result.
  const ghost = (text) => {
    const page = el("div", { className: "flow-page ghost-page" }, el("span", { className: "missing-source" }, text));
    page.style.setProperty("--page-ratio", ratio);
    return page;
  };
  if (mode === "native") {   // a native PDF has no source box: only the translated page is awaited
    const page = el("div", { className: "flow-page ghost-page" },
      el("div", { className: "ghost-progress", role: "status" }, el("div", { className: "spinner" }), el("span", {}, "Translated document will appear here")));
    page.style.setProperty("--page-ratio", ratio);
    return el("div", { className: "flow-row translation-flow" }, page);
  }
  const spinner = el("div", { className: "flow-arrow flow-spinner", role: "status", "aria-label": "Translation in progress" },
    el("div", { className: "spinner" }));
  return el("div", { className: "flow-row translation-flow" }, ghost("Preparing source text…"), spinner, ghost("Preparing target languages…"));
}

function renderCoreProgress(preview, mode) {
  const ratio = `${preview.width || 900} / ${preview.height || 1273}`;
  progressRendered = true;
  progressRatio = ratio;
  if (mode) documentMode = mode;
  const source = $("source-visual");
  source.classList.add("diagnostic-flow-frame"); source.style.aspectRatio = ratio;
  if (!source.querySelector(".source-flow")) {   // the row built from the fast API (with the GIF) is kept
    const page = () => el("div", { className: "flow-page" }, el("img", { src: preview.url, alt: "Original unblurred first page" }));
    const sourcePage = page();
    const processingPage = page();
    addScanSweep(processingPage);
    const left = el("div", { className: "flow-row source-flow" }, sourcePage, makeFlowArrow("Transcribe"), processingPage);
    left.querySelectorAll(".flow-page").forEach((item) => item.style.setProperty("--page-ratio", ratio));
    source.replaceChildren(left);
  }
  $("source-status").textContent = "Transcription in progress…";
  $("source-status").hidden = false;
  $("source-status").className = "result-heading progress-heading";
  $("stats").hidden = false; $("transcription-delivery").hidden = true;
  $("transcribe-action").hidden = true; $("transcribe-format").parentElement.hidden = true;
  const visual = $("translation-visual"); visual.className = "visual-frame translation-progress";
  visual.replaceChildren(makeProgressFlow(ratio, documentMode));
  $("translation-status").textContent = "Translation in progress…";
  $("translation-status").hidden = false;
  $("translation-status").className = "result-heading progress-heading";
  $("translation-stats").hidden = true;
  $("translation-delivery").hidden = true; $("translate-action").hidden = true;
  $("translation-format").parentElement.hidden = true; $("target-language").parentElement.hidden = true;
  $("upload-panel").hidden = true; $("work").hidden = false;
}

function applyWordHighlights(preview) {
  // Replace the sweeping bar by a green highlight on the words the pipeline found (page 1).
  const row = $("source-visual").querySelector(".source-flow");
  if (!row || row.dataset.fast === "1") return;   // scan documents keep the GIF row
  const pages = row.querySelectorAll(".flow-page");
  const target = pages[pages.length - 1];
  if (!target || target.dataset.highlighted) return;
  const boxes = ocrWordBoxes(preview);
  if (!boxes.length) return;
  target.querySelector(".scan-sweep")?.remove();
  target.append(makeOcrOverlay(boxes, ocrBoxGranularity(preview)));
  target.dataset.highlighted = "1";
}

function setProgressMode(mode) {
  if (!mode || mode === documentMode) return;
  documentMode = mode;
  const visual = $("translation-visual");
  if (visual?.classList.contains("translation-progress")) visual.replaceChildren(makeProgressFlow(progressRatio, mode));
}

function renderFastLeft(diagnostic, api) {
  // Left panel: original page, arrow, then the server's diagnostic for that scan type.
  const preview = diagnostic.preview || {};
  const original = { url: artifactUrl(api, preview.original_png_url), width: preview.width, height: preview.height };
  const result = { fastDiagnostic: diagnostic, document: { original_preview: original } };
  const anim = diagnosticAnimState(result);
  if (!progressRendered && !coreDone) renderCoreProgress(original, diagnostic.document?.mode);
  else if (!coreDone) setProgressMode(diagnostic.document?.mode);
  const source = $("source-visual");
  const current = source.querySelector(".source-flow");
  if (current && current.dataset.anim === diagnosticFlowKey(result, anim)) return;   // same state: leave the GIF playing
  const row = makeDiagnosticSourceFlow(result, anim);
  row.dataset.fast = "1";
  source.classList.add("diagnostic-flow-frame");
  source.replaceChildren(row);
}

async function startFastPreview(file, firstPageOnlyConfirmed, signal) {
  const run = ++fastRun;
  const api = diagnosticApiBase();
  if (!api) return;
  const stale = () => signal.aborted || run !== fastRun;
  try {
    const form = new FormData();
    form.append("file", file);
    form.append("first_page_only_confirmed", String(firstPageOnlyConfirmed));
    const uploaded = await fetch(`${api}/v1/diagnostics`, { method: "POST", body: form, signal });
    if (!uploaded.ok || stale()) return;   // Core remains the main path
    const { job_id: jobId } = await uploaded.json();
    if (!jobId || stale()) return;
    for (let attempt = 0; attempt < 120 && run === fastRun; attempt++) {
      await sleep(attempt ? 750 : 400);
      if (stale()) return;
      const response = await fetch(`${api}/v1/diagnostics/${encodeURIComponent(jobId)}`, { signal });
      if (!response.ok || stale()) return;
      const diagnostic = await response.json();
      if (stale()) return;   // a newer file replaced this one while the response was parsed
      if (diagnostic.status === "error") return;
      if (diagnostic.document?.mode === "native" && diagnostic.preview?.original_png_url) {
        // Native pages: no GIF. The sweep stays until Core returns the words; here we only learn the mode.
        const original = { url: artifactUrl(api, diagnostic.preview.original_png_url), width: diagnostic.preview.width, height: diagnostic.preview.height };
        if (!progressRendered && !coreDone) renderCoreProgress(original, "native");
        else if (!coreDone) setProgressMode("native");
        return;
      }
      if (diagnostic.document?.mode === "scan" && diagnostic.preview?.original_png_url) {
        renderFastLeft(diagnostic, api);
        const animation = diagnostic.preview?.animation_status;
        if (diagnostic.document?.kind === "handwriting" &&
            (animation === "ready" || animation === "unavailable")) return;
        if (diagnostic.document?.kind !== "handwriting" && ocrWordBoxes(diagnostic).length) return;
      }
      if (diagnostic.status === "done") return;
    }
  } catch (error) {
    if (stale()) return;   // replaced by a newer file: not an error
    console.info("Fast preview unavailable; Core processing continues.", error);
  }
}

async function callDiagnosticApi(file, firstPageOnlyConfirmed) {
  const api = diagnosticApiBase();
  const form = new FormData();
  form.append("file", file);
  form.append("first_page_only_confirmed", String(firstPageOnlyConfirmed));
  let uploaded;
  try {
    uploaded = await fetch(`${api}/v1/diagnostics`, { method: "POST", body: form });
  } catch (error) {
    console.info("Diagnostic API is not routed yet; using the existing processing API.", error);
    return { fallbackToLegacy: true, fallbackReason: "Could not connect to the diagnostic API. Check the tunnel URL and port 8000 service." };
  }
  if ([404, 405, 501].includes(uploaded.status)) return { fallbackToLegacy: true, fallbackReason: `The API is reachable, but POST /v1/diagnostics returned HTTP ${uploaded.status}.` };
  if (uploaded.status === 409) {
    const detail = await uploaded.json().catch(() => ({}));
    if (detail.detail?.code === "first_page_confirmation_required") {
      const confirmed = window.confirm(detail.detail.message || "Only the first page will be treated. Continue?");
      if (!confirmed) throw new Error("First-page-only processing was cancelled.");
      return callDiagnosticApi(file, true);
    }
  }
  if (!uploaded.ok) throw await apiNotice(uploaded, `Diagnostic upload failed: HTTP ${uploaded.status}`);
  const uploadResult = await uploaded.json();
  const jobId = uploadResult.job_id;
  if (!jobId) return { fallbackToLegacy: true, fallbackReason: "The diagnostic API did not return a job id." };

  let lastPreviewState = "";
  for (let attempt = 0; attempt < 180; attempt++) {
    if (attempt) await new Promise((resolve) => setTimeout(resolve, 750));
    const response = await fetch(`${api}/v1/diagnostics/${encodeURIComponent(jobId)}`);
    if (!response.ok) throw new Error(`Diagnostic status failed: HTTP ${response.status}`);
    const diagnostic = await response.json();
    if (diagnostic.status === "error") return { fallbackToLegacy: true, fallbackReason: diagnostic.message || "The diagnostic API job failed. Check its server log." };
    if (diagnostic.status === "processing") updateProcessingStage(diagnostic.stage);
    if (diagnostic.document?.mode === "native" && diagnostic.status === "preview_ready") {
      return { fallbackToLegacy: true, fallbackReason: "This PDF contains native text; the fast API does not yet build a faithful translated PDF preview." };
    }
    if (diagnostic.document?.mode === "scan" && diagnostic.status === "preview_ready" && !ocrWordBoxes(diagnostic).length) {
      return { fallbackToLegacy: true, fallbackReason: "The OCR service returned no usable detection boxes. Check the Vision worker log." };
    }
    const previewState = `${diagnostic.status}:${diagnostic.translations?.length || 0}:${diagnostic.translation_status || ""}:${diagnostic.preview?.animation_status || ""}:${ocrWordBoxes(diagnostic).length}`;
    if (diagnostic.document?.mode === "scan" && diagnostic.status === "preview_ready" && previewState !== lastPreviewState) {
      renderDiagnostic(diagnostic, api);
      lastPreviewState = previewState;
    }
    if (diagnostic.status === "done") {
      if (diagnostic.document?.mode === "native") return { fallbackToLegacy: true, fallbackReason: "This PDF contains native text; the fast API does not yet build a faithful translated PDF preview." };
      if (diagnostic.document?.mode === "scan" &&
          (!ocrWordBoxes(diagnostic).length || diagnostic.translation_status !== "ready")) {
        return { fallbackToLegacy: true, fallbackReason: "OCR or translation returned no preview. Check the API log and its provider configuration." };
      }
      if (diagnostic.document?.mode === "scan") renderDiagnostic(diagnostic, api);
      return { ...diagnostic, renderedInProgress: diagnostic.document?.mode === "scan" };
    }
  }
  throw new Error("Diagnostic processing timed out");
}

function artifactUrl(api, path) {
  return path ? new URL(path, `${api}/`).href : "";
}

function renderDiagnostic(diagnostic, api) {
  const documentInfo = diagnostic.document || {};
  const preview = diagnostic.preview || {};
  const targets = diagnostic.translations || [];
  const firstTarget = targets[0] || {};
  const normalized = {
    fastDiagnostic: diagnostic,
    document: {
      ...documentInfo,
      kind: documentInfo.kind || (documentInfo.mode === "scan" ? "scan" : "other"),
      original_preview: {
        url: artifactUrl(api, preview.original_png_url),
        width: preview.width,
        height: preview.height,
      },
    },
    transcription: { status: "needs_review" },
    translation: {
      status: diagnostic.translation_status === "unavailable" ? "error" :
        diagnostic.status === "preview_ready" ? "processing" : "needs_review",
      target_language: firstTarget.language,
      estimated_word_count: firstTarget.estimated_word_count,
      reduction_percent: firstTarget.reduction_percent,
      preview: {
        source_text_url: artifactUrl(api, preview.source_text_png_url),
        target_text_url: artifactUrl(api, firstTarget.sample_png_url),
      },
    },
    targetPreviews: targets.map((target) => ({
      language: target.language,
      url: artifactUrl(api, target.sample_png_url),
    })),
    translations: targets.map((target) => ({
      target_language: target.language,
      estimated_word_count: target.estimated_word_count,
      reduction_percent: target.reduction_percent,
    })),
  };
  absoluteArtifactUrls(normalized, api);
  render(normalized);
}

const SVG_NS = "http://www.w3.org/2000/svg";
function svgEl(tag, attrs = {}, ...children) {
  const node = document.createElementNS(SVG_NS, tag);   // SVG needs its own namespace, el() would not render
  Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value));
  children.forEach((child) => node.append(child));
  return node;
}

let arrowCount = 0;
function makeFlowArrow(label) {
  // Chunky rounded arrow, like the one in a macOS "drag to Applications" installer window.
  const id = `flow-arrow-gradient-${arrowCount++}`;
  const gradient = svgEl("linearGradient", { id, x1: "0", y1: "0", x2: "0", y2: "1" },
    svgEl("stop", { offset: "0", "stop-color": "#D4DAE4" }),
    svgEl("stop", { offset: "1", "stop-color": "#A9B3C3" }));
  const arrow = svgEl("path", {
    d: "M10 17H43V9L59 22L43 35V27H10Z",
    fill: `url(#${id})`, stroke: `url(#${id})`, "stroke-width": "10", "stroke-linejoin": "round", "stroke-linecap": "round"
  });
  const svg = svgEl("svg", { viewBox: "0 0 72 44", "aria-hidden": "true", focusable: "false" }, svgEl("defs", {}, gradient), arrow);
  return el("div", { className: "flow-arrow", "aria-label": label }, svg, el("small", {}, label));
}

function makeOcrOverlay(boxes, granularity) {
  // Static fallback when the GIF is unavailable (or when reduced motion is requested).
  const overlay = svgEl("svg", {
    class: "ocr-box-overlay",
    viewBox: "0 0 1 1",
    preserveAspectRatio: "none",
    role: "img",
    "aria-label": `OCR detection boxes, ${granularity || "unknown"} level`,
  });
  const valid = (boxes || []).filter((box) =>
    [box.x, box.y, box.width, box.height].every(Number.isFinite) &&
    box.width > 0 && box.height > 0 && box.x >= 0 && box.y >= 0 &&
    box.x + box.width <= 1.01 && box.y + box.height <= 1.01);
  const step = Math.min(0.07, 3 / Math.max(valid.length, 1));   // the whole reveal lasts about 3 s
  valid.forEach((box, index) => {
    const rect = svgEl("rect", {
      class: "ocr-box", x: box.x, y: box.y, width: box.width, height: box.height, rx: 0.004, "aria-hidden": "true",
    });
    rect.style.setProperty("--box-delay", `${(index * step).toFixed(3)}s`);
    overlay.append(rect);
  });
  return overlay;
}

function ocrWordBoxes(result) {
  const previewBoxes = result?.preview?.word_boxes;
  if (Array.isArray(previewBoxes)) {
    return result.preview.box_granularity === "word" ? previewBoxes : [];
  }
  const directBoxes = result?.word_boxes;
  if (Array.isArray(directBoxes)) {
    return result.box_granularity === "word" ? directBoxes : [];
  }
  const documentBoxes = result?.document?.word_boxes;
  if (Array.isArray(documentBoxes)) {
    const granularity = result.document.box_granularity;
    return granularity === undefined || granularity === "word" ? documentBoxes : [];
  }
  return [];
}

function ocrBoxGranularity(result) {
  return result?.preview?.box_granularity ?? result?.box_granularity ?? result?.document?.box_granularity;
}

function diagnosticAnimState(result) {
  const preview = result.fastDiagnostic?.preview || {};
  const url = preview.animation_status === "ready" && preview.animation_gif_url
    ? artifactUrl(diagnosticApiBase(), preview.animation_gif_url) : "";
  const state = url ? "ready" : (preview.animation_status === "processing" ? "processing" : "unavailable");
  // The key identifies what the left row shows, so a re-render does not restart the GIF.
  return { state, url, key: `${result.fastDiagnostic?.job_id || ""}:${state}:${url}` };
}

function diagnosticFlowKey(result, anim) {
  const diagnostic = result.fastDiagnostic || {};
  const kind = diagnostic.document?.kind || result.document?.kind || "scan";
  return `${anim.key}:${kind}:${ocrWordBoxes(diagnostic).length}:${ocrBoxGranularity(diagnostic) || ""}`;
}

function addScanSweep(page) {
  page.append(el("span", { className: "scan-sweep", "aria-hidden": "true" }));
}

function makeDiagnosticSourceFlow(result, anim) {
  const info = result.document || {};
  const diagnostic = result.fastDiagnostic || {};
  const kind = diagnostic.document?.kind || info.kind || "scan";
  const boxes = ocrWordBoxes(diagnostic);
  const pageRatio = `${info.original_preview.width || 900} / ${info.original_preview.height || 1273}`;
  const source = el("div", { className: "flow-page" },
    el("img", { src: info.original_preview.url, alt: "Original unblurred first page" }));
  const detected = el("div", { className: "flow-page ocr-page" });
  if (kind === "handwriting" && anim.state === "ready") {
    detected.append(el("img", { className: "scan-anim", src: anim.url, alt: "First page with the detected words highlighted one after the other" }));
  } else {
    detected.append(el("img", { src: info.original_preview.url, alt: "First page" }));
    if (kind === "handwriting" && anim.state === "processing") {
      detected.classList.add("anim-pending");
      addScanSweep(detected);
      detected.append(el("span", { className: "anim-caption" }, "Detecting words…"));
    } else if (boxes.length) {
      detected.append(makeOcrOverlay(boxes, ocrBoxGranularity(diagnostic)));
    }
  }
  source.style.setProperty("--page-ratio", pageRatio);
  detected.style.setProperty("--page-ratio", pageRatio);
  const row = el("div", { className: "flow-row source-flow" }, source, makeFlowArrow("Transcribe"), detected);
  row.dataset.anim = diagnosticFlowKey(result, anim);
  return row;
}

function makeCoreSourceFlow(result) {
  const info = result.document || {};
  const preview = info.original_preview || {};
  const boxes = ocrWordBoxes(result);
  const ratio = `${preview.width || 900} / ${preview.height || 1273}`;
  const makePage = (detected) => {
    const page = el("div", { className: `flow-page${detected ? " ocr-page" : ""}` },
      el("img", { src: preview.url, alt: detected ? "Original page with OCR detections" : "Original unblurred first page" }));
    page.style.setProperty("--page-ratio", ratio);
    if (detected && boxes.length) page.append(makeOcrOverlay(boxes, ocrBoxGranularity(result)));
    return page;
  };
  return el("div", { className: "flow-row source-flow" }, makePage(false), makeFlowArrow("Transcribe"), makePage(true));
}

function makeDiagnosticTranslationFlow(result) {
  const info = result.document || {};
  const preview = result.fastDiagnostic?.preview || {};
  const targets = result.targetPreviews || [];
  const pageRatio = `${info.original_preview.width || 900} / ${info.original_preview.height || 1273}`;
  const source = el("div", { className: "flow-page text-preview" },
    preview.source_text_png_url
      ? el("img", { src: artifactUrl(diagnosticApiBase(), preview.source_text_png_url), alt: `${info.source_language || "Source"} transcription preview` })
      : el("span", { className: "missing-source" }, "Preparing source text preview…"));
  const targetPage = el("div", { className: "flow-page target-preview" });
  source.style.setProperty("--page-ratio", pageRatio);
  targetPage.style.setProperty("--page-ratio", pageRatio);
  if (targets.length) {
    targets.forEach((target, index) => {
      const image = el("img", { src: target.url, alt: `${target.language} translation preview`, className: `target-sample target-sample-${index}` });
      image.style.setProperty("--sample-delay", `${index * 3}s`);
      targetPage.append(image);
    });
    if (targets.length === 1) targetPage.classList.add("single-target");
  } else {
    const message = result.translation?.status === "error"
      ? "Translation preview is unavailable."
      : "Translation preview is processing…";
    targetPage.append(el("span", { className: "missing-preview" }, message));
  }
  return el("div", { className: "flow-row translation-flow" }, source, makeFlowArrow("Translate"), targetPage);
}

function makeVisualFrame(result) {
  const documentInfo = result.document || {};
  const translation = result.translation || {};
  const preview = translation.preview || {};
  const frame = el("div", { id: "translation-visual", className: "visual-frame" });
  const original = documentInfo.original_preview || {};
  const width = original.width || 900, height = original.height || 1273;
  frame.style.aspectRatio = `${width} / ${height}`;

  if (result.fastDiagnostic) {
    frame.append(makeDiagnosticTranslationFlow(result));
    return frame;
  }

  const previews = (result.translations || []).filter((item) => item.preview).map((item) => ({ item, preview: item.preview }));
  if (documentInfo.mode === "scan" || preview.mode === "scan_text_fade") {
    const selectedPreview = previews[0]?.preview || preview;
    const sourceUrl = selectedPreview.source_text_url || result.transcription?.preview?.source_text_url;
    const targetUrl = selectedPreview.target_text_url;
    frame.classList.add("diagnostic-flow-frame");
    const pageRatio = `${width} / ${height}`;
    const sourcePage = el("div", { className: "flow-page text-preview" },
      sourceUrl ? el("img", { src: sourceUrl, alt: `${documentInfo.source_language || "Source"} transcription text` }) : el("span", { className: "missing-preview" }, "Transcription preview unavailable."));
    const targetPage = el("div", { className: "flow-page text-preview" },
      targetUrl ? el("img", { src: targetUrl, alt: `${translation.target_language || "Translated"} text` }) : el("span", { className: "missing-preview" }, "Translation preview unavailable."));
    sourcePage.style.setProperty("--page-ratio", pageRatio);
    targetPage.style.setProperty("--page-ratio", pageRatio);
    frame.append(el("div", { className: "flow-row translation-flow" }, sourcePage, makeFlowArrow("Translate"), targetPage));
  } else {
    const targets = previews.filter(({ preview: targetPreview }) => targetPreview.url);
    if (!targets.length && preview.url) targets.push({ item: translation, preview });
    if (!original.url && !targets.length) {
      frame.classList.add("missing-preview");
      frame.append(el("span", {}, translation.message || "Translation preview is unavailable."));
      return frame;
    }
    frame.classList.add("native-preview");
    if (targets.length > 1) frame.classList.add("multi-native-preview");
    const pageRatio = `${width} / ${height}`;
    const makeNativeBox = (...children) => {
      const box = el("div", { className: "native-page-box" });
      box.style.setProperty("--page-ratio", pageRatio);
      box.append(...children.flat());
      return box;
    };
    const sourceBox = original.url
      ? makeNativeBox(el("img", { className: "native-page native-source", src: original.url, alt: `${documentInfo.source_language || "Source"} document` }))
      : null;
    let targetBox;
    if (targets.length > 1) {
      targetBox = makeNativeBox(targets.map(({ item, preview: targetPreview }, index) => {
        const image = el("img", { className: `native-page native-target-${index}`, src: targetPreview.url, alt: `${item.target_language || "Translated"} rebuilt document` });
        image.style.setProperty("--sample-delay", `${index * 3}s`);
        return image;
      }));
    } else if (targets.length === 1) {
      targetBox = makeNativeBox(el("img", { className: "native-page", src: targets[0].preview.url, alt: `${targets[0].item.target_language || "Translated"} rebuilt document` }));
    } else {
      targetBox = makeNativeBox(el("span", { className: "missing-preview" }, translation.message || "Translation preview is unavailable."));
    }
    frame.append(...(sourceBox ? [sourceBox, makeFlowArrow("Translate"), targetBox] : [targetBox]));
  }
  return frame;
}

function render(result) {
  const documentInfo = result.document || {};
  const transcription = result.transcription || {};
  const translation = result.translation || {};
  const words = documentInfo.word_count ?? result.words ?? 0;
  const language = documentInfo.source_language || result.language || "Unknown";
  const kind = documentInfo.kind || result.kind || "other";
  const isScannedDocument = documentInfo.mode === "scan" ||
    ["printed_scan", "handwriting", "scan"].includes(kind);

  const noTranscriptionNeeded = documentInfo.transcription_needed === false;
  $("source-status").textContent = noTranscriptionNeeded
    ? "No transcription needed!"
    : statusText(transcription.status, documentInfo.processing_label || "Transcribed document");
  $("source-status").hidden = false;
  $("source-status").className = `result-heading ${transcription.status === "ready" ? "ok" : "warn"}`;
  $("translation-status").textContent = statusText(translation.status, "Translation");
  $("translation-status").hidden = false;
  $("translation-status").className = `result-heading ${translation.status === "ready" ? "ok" : "warn"}`;
  const metrics = [
    el("div", {}, el("strong", {}, String(words)), el("span", {}, "words")),
    el("div", {}, el("strong", {}, language), el("span", {}, "language"))];
  const updateTranscriptionReduction = (format) => {
    const formatKey = { "PDF (layer)": "pdf_layer", "PDF (text)": "pdf_text" }[format];
    const output = formatKey ? documentInfo.output_formats?.[formatKey] : null;
    let percent = null;
    if (output?.generated === true) {
      percent = finitePercent(output.reduction_percent);
    } else if (output?.generated === false) {
      percent = finitePercent(output.reduction_percent);
      if (percent === null && format === "PDF (layer)") percent = 0;
    } else if (isScannedDocument) {
      percent = format === "PDF (layer)" && !output ? 0 : null;
    } else if (!output && formatKey === documentInfo.default_output_format) {
      percent = finitePercent(documentInfo.reduction_percent);
    } else if (!output && documentInfo.size_reduction_basis === "transcription") {
      percent = finitePercent(documentInfo.reduction_percent);
    }
    const stats = [...metrics];
    const reductionMetric = sizeReductionMetric(
      percent,
      format === "PDF (layer)"
        ? output?.generated === true
          ? "Generated PDF (layer) size compared with the source PDF."
          : "No PDF (layer) artifact was generated; no size reduction is expected."
        : output?.generated === true
          ? "Generated PDF (text) size compared with the source PDF."
          : "Transcribed PDF size compared with the uploaded file size."
    );
    if (reductionMetric) stats.push(reductionMetric);
    $("stats").replaceChildren(...stats);
    $("stats").hidden = false;
  };

  const source = $("source-visual");
  source.style.aspectRatio = `${documentInfo.original_preview?.width || 900} / ${documentInfo.original_preview?.height || 1273}`;
  if (result.fastDiagnostic) {
    source.classList.add("diagnostic-flow-frame");
    const anim = diagnosticAnimState(result);
    const currentRow = source.querySelector(".source-flow");
    if (!currentRow || currentRow.dataset.anim !== diagnosticFlowKey(result, anim)) {   // same key = leave the GIF playing
      source.replaceChildren(makeDiagnosticSourceFlow(result, anim));
    }
  } else if (noTranscriptionNeeded && documentInfo.original_preview?.url) {
    // Nothing was transcribed: show the untouched source page in the same page box as the translation.
    const box = el("div", { className: "native-page-box" },
      el("img", { className: "native-page native-source", src: documentInfo.original_preview.url, alt: "Original document, no transcription needed" }));
    box.style.setProperty("--page-ratio", `${documentInfo.original_preview.width || 900} / ${documentInfo.original_preview.height || 1273}`);
    source.classList.remove("diagnostic-flow-frame");
    source.classList.add("native-preview");
    source.replaceChildren(box);
  } else {
    const hasFastFlow = source.querySelector('.source-flow[data-fast="1"]');
    if (hasFastFlow && kind !== "handwriting" && documentInfo.original_preview?.url) {
      source.classList.add("diagnostic-flow-frame");
      source.replaceChildren(makeCoreSourceFlow(result));
    } else if (hasFastFlow) {
      source.classList.add("diagnostic-flow-frame");   // keep the GIF row built from the fast API
    } else if (source.querySelector('.source-flow .flow-page[data-highlighted="1"]')) {
      source.classList.add("diagnostic-flow-frame");   // keep the highlight already shown while Core was translating
    } else if (documentInfo.original_preview?.url && (documentInfo.mode === "scan" || ocrWordBoxes(result).length)) {
      source.classList.add("diagnostic-flow-frame");
      source.replaceChildren(makeCoreSourceFlow(result));
    } else {
      source.classList.remove("diagnostic-flow-frame");
      source.replaceChildren(documentInfo.original_preview?.url
        ? el("img", { className: "scan-base", src: documentInfo.original_preview.url, alt: "Original unblurred document" })
        : el("span", { className: "missing-source" }, "Original scan unavailable."));
    }
  }

  const sourceFormats = [...FORMATS];
  const outputFormatLabels = { pdf_layer: "PDF (layer)", pdf_text: "PDF (text)" };
  const serverDefault = documentInfo.default_output_format;
  const defaultFormat = outputFormatLabels[serverDefault] ||
    (isScannedDocument ? "PDF (layer)" : "PDF (text)");
  fillSelect($("transcribe-format"), sourceFormats, defaultFormat);
  $("transcribe-format").parentElement.hidden = false;
  // Nothing to order when the source page needs no transcription; the output format stays selectable.
  $("transcribe-action").hidden = noTranscriptionNeeded;
  $("transcription-delivery").hidden = noTranscriptionNeeded;
  const sourceStatus = $("source-status");
  const sourceStatusText = sourceStatus.textContent, sourceStatusClass = sourceStatus.className;
  const updateTranscriptionOffer = () => {
    const format = $("transcribe-format").value;
    updateTranscriptionReduction(format);
    if (!AVAILABLE_FORMATS.has(format)) {
      // The notice replaces the "needs human review" heading; nothing else changes.
      sourceStatus.textContent = outputFormatNotice(format);
      sourceStatus.className = "result-heading warn";
      return;
    }
    sourceStatus.textContent = sourceStatusText;
    sourceStatus.className = sourceStatusClass;
    $("transcribe-action").textContent = `Transcribe for ${price(words, kind, "transcribe")}`;
    $("transcribe-action").href = `/pricing.html?service=transcription&format=${encodeURIComponent($("transcribe-format").value)}`;
  };
  $("transcribe-format").onchange = updateTranscriptionOffer;
  updateTranscriptionOffer();
  $("transcription-delivery").textContent = `Delivery date: ${deliveryDate(words)}`;
  const rawSourceCode = documentInfo.source_language_code || Object.entries(LANGUAGE_CODES).find(([name]) => name.toLowerCase() === language.toLowerCase())?.[1] || language;
  const sourceCode = ({ french: "fr", english: "en", chinese: "zh", "chinese (simplified)": "zh" })[String(rawSourceCode).toLowerCase()] || String(rawSourceCode).split("-")[0].toLowerCase();
  const defaultTarget = sourceCode === "en" ? "French" : "English";
  const availableLanguages = LANGS.filter((item) => LANGUAGE_CODES[item] !== sourceCode && item.toLowerCase() !== language.toLowerCase());
  fillSelect($("target-language"), availableLanguages, defaultTarget);
  $("target-language").parentElement.hidden = false;
  fillSelect($("translation-format"), FORMATS, "PDF (text)");
  $("translation-format").parentElement.hidden = false;
  const translationStatus = $("translation-status");
  const translationStatusText = translationStatus.textContent, translationStatusClass = translationStatus.className;
  const updateTranslationOffer = (event) => {
    const selected = $("target-language").value;
    const languageNotice = AVAILABLE_TARGET_LANGUAGES.has(selected) ? null : targetLanguageNotice(selected);
    const formatName = $("translation-format").value;
    const formatNotice = AVAILABLE_FORMATS.has(formatName) ? null : outputFormatNotice(formatName);
    // Show the message of the control that was just changed, else the other pending one.
    const notice = event?.target?.id === "translation-format"
      ? (formatNotice || languageNotice) : (languageNotice || formatNotice);
    if (notice) {
      translationStatus.textContent = notice;
      translationStatus.className = "result-heading warn";
      return;   // nothing else changes: price, link and delivery date stay as they were
    }
    translationStatus.textContent = translationStatusText;
    translationStatus.className = translationStatusClass;
    const selectedTranslation = (result.translations || []).find((item) => item.target_language === selected) ||
      (translation.target_language === selected ? translation : null);
    $("translate-action").textContent = `Translate for ${price(words, kind, "translate")}`;
    $("translate-action").href = `/pricing.html?language=${encodeURIComponent(LANGUAGE_CODES[selected] || selected)}&format=${encodeURIComponent($("translation-format").value)}`;
    const countValue = selectedTranslation?.estimated_word_count ??
      (translation.target_language === selected ? translation.estimated_word_count : null);
    const count = Number(countValue) || null;
    const translationReductionValue = selectedTranslation?.reduction_percent !== undefined
      ? selectedTranslation.reduction_percent
      : translation.target_language === selected ? translation.reduction_percent : null;
    const translationReduction = finitePercent(translationReductionValue);
    const translationMetrics = [];
    if (count) translationMetrics.push(el("div", {}, el("strong", {}, String(count)), el("span", {}, "estimated words")));
    const translationReductionMetric = sizeReductionMetric(
      translationReduction,
      "Translated PDF size compared with the uploaded file size."
    );
    if (translationReductionMetric) translationMetrics.push(translationReductionMetric);
    $("translation-stats").replaceChildren(...translationMetrics);
    $("translation-stats").hidden = false;
    $("translation-delivery").textContent = `Delivery date: ${deliveryDate(count || words)}`;
  };
  $("target-language").onchange = updateTranslationOffer;
  $("translation-format").onchange = updateTranslationOffer;
  $("translate-action").hidden = false;
  $("translation-delivery").hidden = false;
  updateTranslationOffer();

  $("translation-visual").replaceWith(makeVisualFrame(result));
  $("upload-panel").hidden = true;
  $("work").hidden = false;
}

const drop = $("drop"), input = $("file");
drop.onclick = () => { if (!drop.classList.contains("processing-drop")) input.click(); };
drop.onkeydown = (event) => { if ((event.key === "Enter" || event.key === " ") && !drop.classList.contains("processing-drop")) { event.preventDefault(); input.click(); } };
input.onchange = () => input.files[0] && process(input.files[0]);
const zoomDialog = $("image-zoom");
const zoomImage = $("zoom-image");
$("work").addEventListener("click", (event) => {
  const image = event.target.closest(".visual-frame img");
  if (!image || !zoomDialog) return;
  zoomImage.src = image.currentSrc || image.src;
  zoomImage.alt = image.alt || "Document preview enlarged";
  zoomDialog.showModal();
});
$("zoom-close").onclick = () => zoomDialog.close();
zoomDialog.addEventListener("click", (event) => {
  if (event.target === zoomDialog) zoomDialog.close();
});
zoomDialog.addEventListener("close", () => zoomImage.removeAttribute("src"));
let activeFileDrags = 0;
const hasDraggedFiles = (event) => Array.from(event.dataTransfer?.types || []).includes("Files");
const setDragging = (on) => {
  // Accept dropped files without adding a visual drag highlight.
};
document.addEventListener("dragenter", (event) => {
  if (!hasDraggedFiles(event)) return;
  event.preventDefault();
  activeFileDrags++;
  setDragging(true);
});
document.addEventListener("dragover", (event) => {
  if (!hasDraggedFiles(event)) return;
  event.preventDefault();   // required, otherwise the browser refuses the drop
  if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
});
document.addEventListener("dragleave", (event) => {
  if (!hasDraggedFiles(event)) return;
  activeFileDrags = Math.max(0, activeFileDrags - 1);
  if (!activeFileDrags) setDragging(false);
});
document.addEventListener("drop", (event) => {
  if (!hasDraggedFiles(event)) return;
  event.preventDefault();
  activeFileDrags = 0;
  setDragging(false);
  const file = event.dataTransfer.files[0];
  if (file) process(file);
});
