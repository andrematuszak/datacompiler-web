const CONFIG = {
  API_BASE: "",
  DIAGNOSTIC_API_BASE: "https://leader-coal-promise-neil.trycloudflare.com", // Set to the separate Cloudflare URL for datacompiler-api.
  DEMO: false,
};
const RATE = { transcribe: 0.02, translate: 0.05 };
const DIFFICULTY = { fiscal: 1.0, legal: 1.3, handwriting: 1.6, other: 1.0 };
const LANGS = ["French", "English", "German", "Spanish", "Italian", "Polish", "Turkish"];
const FORMATS = ["PDF (text)", "DOCX", "TXT", "XLIFF"];
const FIRST_PAGE_ONLY_THRESHOLD = 20 * 1024 * 1024;
const MAX_UPLOAD_SIZE = 100 * 1024 * 1024;
const $ = (id) => document.getElementById(id);
const euros = (amount) => amount.toLocaleString("en-GB", { style: "currency", currency: "EUR" });
const diagnosticApiBase = () => (CONFIG.DIAGNOSTIC_API_BASE || CONFIG.API_BASE).trim().replace(/\/+$/, "");

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  children.flat().filter((child) => child !== null && child !== undefined).forEach((child) => node.append(child));
  return node;
}
function formatFileSize(bytes) {
  if (bytes == null || !Number.isFinite(Number(bytes))) return "not available";
  const size = Number(bytes) || 0;
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
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
function fillFormats(select, formats = FORMATS, defaultFormat = "PDF (text)") {
  select.replaceChildren(...formats.map((format) => el("option", { value: format, selected: format === defaultFormat }, format)));
}
function absoluteArtifactUrls(result, api) {
  const resolve = (artifact) => {
    if (!artifact) return;
    for (const key of ["url", "source_text_url", "target_text_url", "image_url"]) {
      if (artifact[key]?.startsWith("/")) artifact[key] = api + artifact[key];
    }
  };
  resolve(result.document?.original_preview);
  resolve(result.translation?.preview);
}

function showProcessing() {
  $("error").hidden = true;
  const drop = $("drop");
  drop.classList.add("processing-drop");
  drop.querySelector("strong").textContent = "Treatment in progress…";
  drop.querySelector("span").textContent = "Your document is being processed";
  drop.querySelector("small").hidden = true;
}

async function process(file) {
  if (file.size > MAX_UPLOAD_SIZE) {
    window.alert("File is too large. The upload limit is 100 MB.");
    input.value = "";
    return;
  }
  const isPdf = file.name.toLowerCase().endsWith(".pdf");
  let firstPageOnlyConfirmed = false;
  if (isPdf && file.size > FIRST_PAGE_ONLY_THRESHOLD) {
    const continueWithFirstPage = window.confirm("File is large. Only the first page will be treated. Continue?");
    if (!continueWithFirstPage) {
      input.value = "";
      return;
    }
    firstPageOnlyConfirmed = true;
  }
  showProcessing();
  try {
    if (CONFIG.DEMO) {
      render(await demoResult());
      return;
    }
    const diagnostic = await callDiagnosticApi(file, firstPageOnlyConfirmed);
    if (diagnostic && !diagnostic.fallbackToLegacy) {
      if (diagnostic.document?.mode === "native") {
        render(await callApi(file));
      } else {
        if (!diagnostic.renderedInProgress) renderDiagnostic(diagnostic, diagnosticApiBase());
      }
      return;
    }
    render(await callApi(file));
  } catch (error) {
    console.error(error);
    $("error").textContent = "Processing failed. Please try again, or write to contact@data-compiler.com.";
    $("error").hidden = false;
    $("drop").classList.remove("processing-drop");
    $("drop").querySelector("strong").textContent = "Drop a file here";
    $("drop").querySelector("span").textContent = "or click to upload";
    $("drop").querySelector("small").hidden = true;
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

async function callApi(file) {
  const api = CONFIG.API_BASE.trim().replace(/\/+$/, "");
  const form = new FormData(); form.append("file", file);
  const uploaded = await fetch(`${api}/upload`, { method: "POST", body: form });
  if (!uploaded.ok) throw new Error(`Upload failed: HTTP ${uploaded.status}`);
  const { job_id: jobId } = await uploaded.json();
  if (!jobId) throw new Error("The upload response did not include a job id");
  for (let attempt = 0; attempt < 150; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const statusResponse = await fetch(`${api}/status/${jobId}`);
    if (!statusResponse.ok) throw new Error(`Status failed: HTTP ${statusResponse.status}`);
    const { state } = await statusResponse.json();
    if (state === "error") throw new Error("The processing service could not complete this document");
    if (state === "done") {
      const response = await fetch(`${api}/result/${jobId}`);
      if (!response.ok) throw new Error(`Result failed: HTTP ${response.status}`);
      const result = await response.json();
      absoluteArtifactUrls(result, api);
      return result;
    }
  }
  throw new Error("Processing timed out");
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
    return { fallbackToLegacy: true };
  }
  if ([404, 405, 501].includes(uploaded.status)) return { fallbackToLegacy: true };
  if (uploaded.status === 409) {
    const detail = await uploaded.json().catch(() => ({}));
    if (detail.detail?.code === "first_page_confirmation_required") {
      const confirmed = window.confirm(detail.detail.message || "Only the first page will be treated. Continue?");
      if (!confirmed) throw new Error("First-page-only processing was cancelled.");
      return callDiagnosticApi(file, true);
    }
  }
  if (!uploaded.ok) throw new Error(`Diagnostic upload failed: HTTP ${uploaded.status}`);
  const uploadResult = await uploaded.json();
  const jobId = uploadResult.job_id;
  if (!jobId) return { fallbackToLegacy: true };

  let lastPreviewState = "";
  for (let attempt = 0; attempt < 180; attempt++) {
    if (attempt) await new Promise((resolve) => setTimeout(resolve, 750));
    const response = await fetch(`${api}/v1/diagnostics/${encodeURIComponent(jobId)}`);
    if (!response.ok) throw new Error(`Diagnostic status failed: HTTP ${response.status}`);
    const diagnostic = await response.json();
    if (diagnostic.status === "error") return { fallbackToLegacy: true };
    if (diagnostic.document?.mode === "native" && diagnostic.status === "preview_ready") {
      return { fallbackToLegacy: true };
    }
    if (diagnostic.document?.mode === "scan" && diagnostic.status === "preview_ready" && !diagnostic.preview?.word_boxes?.length) {
      return { fallbackToLegacy: true };
    }
    const previewState = `${diagnostic.status}:${diagnostic.translations?.length || 0}:${diagnostic.translation_status || ""}`;
    if (diagnostic.document?.mode === "scan" && diagnostic.status === "preview_ready" && previewState !== lastPreviewState) {
      renderDiagnostic(diagnostic, api);
      lastPreviewState = previewState;
    }
    if (diagnostic.status === "done") {
      if (diagnostic.document?.mode === "native") return { fallbackToLegacy: true };
      if (diagnostic.document?.mode === "scan" &&
          (!diagnostic.preview?.word_boxes?.length || diagnostic.translation_status !== "ready")) {
        return { fallbackToLegacy: true };
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
      kind: documentInfo.mode === "scan" ? "handwriting" : "other",
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
      preview: {
        source_text_url: artifactUrl(api, preview.source_text_png_url),
        target_text_url: artifactUrl(api, firstTarget.sample_png_url),
      },
    },
    targetPreviews: targets.map((target) => ({
      language: target.language,
      url: artifactUrl(api, target.sample_png_url),
    })),
  };
  render(normalized);
}

function makeFlowArrow(label) {
  return el("div", { className: "flow-arrow", "aria-label": label },
    el("span", { "aria-hidden": "true" }, "→"), el("small", {}, label));
}

function makeOcrOverlay(boxes, granularity) {
  const overlay = el("svg", {
    className: "ocr-box-overlay",
    viewBox: "0 0 1 1",
    preserveAspectRatio: "none",
    role: "img",
    "aria-label": `OCR detection boxes, ${granularity || "unknown"} level`,
  });
  const valid = (boxes || []).filter((box) =>
    [box.x, box.y, box.width, box.height].every(Number.isFinite) &&
    box.width > 0 && box.height > 0 && box.x >= 0 && box.y >= 0 &&
    box.x + box.width <= 1.01 && box.y + box.height <= 1.01);
  const cycle = Math.max(3, valid.length * 0.07 + 1);
  overlay.style.setProperty("--box-cycle", `${cycle}s`);
  valid.forEach((box, index) => {
    const rect = el("rect", {
      className: "ocr-box",
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      rx: 0.004,
      "aria-hidden": "true",
    });
    rect.style.setProperty("--box-delay", `${index * 0.07}s`);
    overlay.append(rect);
  });
  return overlay;
}

function makeDiagnosticSourceFlow(result) {
  const info = result.document || {};
  const preview = result.fastDiagnostic?.preview || {};
  const pageRatio = `${info.original_preview.width || 900} / ${info.original_preview.height || 1273}`;
  const source = el("div", { className: "flow-page" },
    el("img", { src: info.original_preview.url, alt: "Original unblurred first page" }));
  const detected = el("div", { className: "flow-page ocr-page" },
    el("img", { src: info.original_preview.url, alt: "First page with OCR boxes animated in reading order" }),
    makeOcrOverlay(preview.word_boxes, preview.box_granularity));
  source.style.setProperty("--page-ratio", pageRatio);
  detected.style.setProperty("--page-ratio", pageRatio);
  return el("div", { className: "flow-row source-flow" }, source, makeFlowArrow("OCR"), detected);
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

  if (documentInfo.mode === "scan" || preview.mode === "scan_text_fade") {
    frame.classList.add("scan-fade");
    if (preview.source_text_url && preview.target_text_url) {
      frame.append(
        el("img", { className: "text-layer source-layer", src: preview.source_text_url, alt: "Transcription text" }),
        el("img", { className: "text-layer target-layer", src: preview.target_text_url, alt: "English translation" }));
    }
  } else if (preview.url) {
    frame.classList.add("native-preview");
    frame.append(el("img", { className: "native-page", src: preview.url, alt: "Translated rebuilt document" }));
  } else {
    frame.classList.add("missing-preview");
    frame.append(el("span", {}, translation.message || "Translation preview is unavailable."));
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

  $("source-status").textContent = statusText(transcription.status, documentInfo.processing_label || "Transcribed document");
  $("source-status").className = `result-heading ${transcription.status === "ready" ? "ok" : "warn"}`;
  $("translation-status").textContent = statusText(translation.status, "Translation");
  $("translation-status").className = `result-heading ${translation.status === "ready" ? "ok" : "warn"}`;
  const metrics = [
    el("div", {}, el("strong", {}, String(words)), el("span", {}, "words")),
    el("div", {}, el("strong", {}, language), el("span", {}, "language"))];
  const reduction = Number(documentInfo.reduction_percent);
  const diagnosticSize = documentInfo.diagnostic_input_size_bytes ?? documentInfo.original_file_size_bytes;
  const processedPageNote = documentInfo.first_page_only ? " Only the first page was processed." : "";
  const sizeDetails = `Estimated output size: ${formatFileSize(documentInfo.processed_file_size_bytes)}; processed input: ${formatFileSize(diagnosticSize)}; uploaded file: ${formatFileSize(documentInfo.original_file_size_bytes)}.${processedPageNote}`;
  if (documentInfo.reduction_percent !== null && documentInfo.reduction_percent !== undefined && Number.isFinite(reduction)) {
    const visibleReduction = Math.max(0, reduction);
    metrics.push(el("div", { className: `size-reduction${visibleReduction > 0 ? " reduced" : ""}`, title: sizeDetails, "aria-label": `${visibleReduction}% smaller. ${sizeDetails}` },
      el("strong", {}, `${visibleReduction}%`), el("span", {}, "smaller")));
  }
  $("stats").replaceChildren(...metrics);

  const source = $("source-visual");
  source.style.aspectRatio = `${documentInfo.original_preview?.width || 900} / ${documentInfo.original_preview?.height || 1273}`;
  if (result.fastDiagnostic) {
    source.classList.add("diagnostic-flow-frame");
    source.replaceChildren(makeDiagnosticSourceFlow(result));
  } else {
    source.classList.remove("diagnostic-flow-frame");
    source.replaceChildren(documentInfo.original_preview?.url
      ? el("img", { className: "scan-base", src: documentInfo.original_preview.url, alt: "Original unblurred document" })
      : el("span", { className: "missing-source" }, "Original scan unavailable."));
  }

  const sourceFormats = [...FORMATS];
  const hasHandwritingLayer = documentInfo.mode === "scan" && kind === "handwriting";
  if (hasHandwritingLayer) sourceFormats.push("PDF (layer)");
  fillFormats($("transcribe-format"), sourceFormats, hasHandwritingLayer ? "PDF (layer)" : "PDF (text)");
  $("transcribe-action").textContent = `Transcribe for ${price(words, kind, "transcribe")}`;
  $("transcription-delivery").textContent = `Delivery date: ${deliveryDate(words)}`;
  const select = $("target-language");
  const defaultTarget = language.toLowerCase() === "english" ? "French" : "English";
  const selectedTarget = translation.target_language || defaultTarget;
  select.replaceChildren(...LANGS.map((name) => el("option", { value: name, selected: name === selectedTarget }, name)));
  const updateTranslationOffer = () => {
    $("translate-action").textContent = `Translate for ${price(words, kind, "translate")}`;
    const count = select.value === selectedTarget ? translation.estimated_word_count : null;
    $("translation-stats").replaceChildren(...(count == null ? [] :
      [el("div", {}, el("strong", {}, String(count)), el("span", {}, "estimated words"))]));
    $("translation-delivery").textContent = `Delivery date: ${deliveryDate(count ?? words)}`;
  };
  fillFormats($("translation-format"));
  select.onchange = updateTranslationOffer;
  updateTranslationOffer();

  $("translation-visual").replaceWith(makeVisualFrame(result));
  $("upload-panel").hidden = true;
  $("work").hidden = false;
}

const drop = $("drop"), input = $("file");
drop.onclick = () => { if (!drop.classList.contains("processing-drop")) input.click(); };
drop.onkeydown = (event) => { if ((event.key === "Enter" || event.key === " ") && !drop.classList.contains("processing-drop")) { event.preventDefault(); input.click(); } };
input.onchange = () => input.files[0] && process(input.files[0]);
["dragenter", "dragover"].forEach((type) => drop.addEventListener(type, (event) => { event.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach((type) => drop.addEventListener(type, (event) => { event.preventDefault(); drop.classList.remove("over"); }));
drop.addEventListener("drop", (event) => { const file = event.dataTransfer.files[0]; if (file) process(file); });
