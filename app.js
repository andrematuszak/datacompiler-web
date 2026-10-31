const CONFIG = {
  API_BASE: "https://opened-hon-renewal-hired.trycloudflare.com",
  DIAGNOSTIC_API_BASE: "https://reminder-recreation-gordon-bibliography.trycloudflare.com", // Set to the separate Cloudflare URL for datacompiler-api.
  DEMO: false,
};
const RATE = { transcribe: 0.02, translate: 0.05 };
const DIFFICULTY = { fiscal: 1.0, legal: 1.3, handwriting: 1.6, other: 1.0 };
const LANGS = ["Chinese (Simplified)", "French", "English", "German", "Spanish", "Italian", "Polish", "Turkish"];
const LANGUAGE_CODES = { "Chinese (Simplified)": "zh", French: "fr", English: "en", German: "de", Spanish: "es", Italian: "it", Polish: "pl", Turkish: "tr" };
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
function fillSelect(select, options = [], selectedValue) {
  select.replaceChildren(...options.map((value) => el("option", { value, selected: value === selectedValue }, value)));
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
    if (!CONFIG.API_BASE.trim()) throw new Error("The Core processing API is not configured.");
    render(await callApi(file));
  } catch (error) {
    console.error(error);
    $("error").textContent = `${error.message || "Processing failed."} Please try again, or write to contact@data-compiler.com.`;
    $("error").hidden = false;
    $("work").hidden = true;
    $("upload-panel").hidden = false;
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
  if (!api) throw new Error("The full-processing API is not configured.");
  const form = new FormData(); form.append("file", file);
  const uploaded = await fetch(`${api}/upload`, { method: "POST", body: form });
  if (!uploaded.ok) throw new Error(`Upload failed: HTTP ${uploaded.status}`);
  const { job_id: jobId } = await uploaded.json();
  if (!jobId) throw new Error("The upload response did not include a job id");
  let progressShown = false;
  for (let attempt = 0; attempt < 600; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const statusResponse = await fetch(`${api}/status/${jobId}`);
    if (!statusResponse.ok) throw new Error(`Status failed: HTTP ${statusResponse.status}`);
    const status = await statusResponse.json();
    const { state } = status;
    if (state === "error") throw new Error("The processing service could not complete this document");
    if (!progressShown && status.preview?.original_preview?.url) {
      status.preview.original_preview.url = api + status.preview.original_preview.url;
      renderCoreProgress(status.preview.original_preview);
      progressShown = true;
    }
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

function renderCoreProgress(preview) {
  const ratio = `${preview.width || 900} / ${preview.height || 1273}`;
  const page = () => el("div", { className: "flow-page" }, el("img", { src: preview.url, alt: "Original unblurred first page" }));
  const left = el("div", { className: "flow-row source-flow" }, page(), makeFlowArrow("OCR"), page());
  left.querySelectorAll(".flow-page").forEach((item) => item.style.setProperty("--page-ratio", ratio));
  const source = $("source-visual");
  source.classList.add("diagnostic-flow-frame"); source.style.aspectRatio = ratio; source.replaceChildren(left);
  $("source-status").textContent = "Transcription in progress…";
  $("source-status").className = "result-heading progress-heading";
  $("stats").hidden = true; $("transcription-delivery").hidden = true;
  $("transcribe-action").hidden = true; $("transcribe-format").parentElement.hidden = true;
  const visual = $("translation-visual"); visual.className = "visual-frame translation-progress";
  visual.replaceChildren(el("span", {}, "Translation in progress"));
  $("translation-status").hidden = true; $("translation-stats").hidden = true;
  $("translation-delivery").hidden = true; $("translate-action").hidden = true;
  $("translation-format").parentElement.hidden = true; $("target-language").parentElement.hidden = true;
  $("upload-panel").hidden = true; $("work").hidden = false;
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
  if (!uploaded.ok) throw new Error(`Diagnostic upload failed: HTTP ${uploaded.status}`);
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
    if (diagnostic.document?.mode === "scan" && diagnostic.status === "preview_ready" && !diagnostic.preview?.word_boxes?.length) {
      return { fallbackToLegacy: true, fallbackReason: "The OCR service returned no usable detection boxes. Check the Vision worker log." };
    }
    const previewState = `${diagnostic.status}:${diagnostic.translations?.length || 0}:${diagnostic.translation_status || ""}:${diagnostic.preview?.animation_status || ""}`;
    if (diagnostic.document?.mode === "scan" && diagnostic.status === "preview_ready" && previewState !== lastPreviewState) {
      renderDiagnostic(diagnostic, api);
      lastPreviewState = previewState;
    }
    if (diagnostic.status === "done") {
      if (diagnostic.document?.mode === "native") return { fallbackToLegacy: true, fallbackReason: "This PDF contains native text; the fast API does not yet build a faithful translated PDF preview." };
      if (diagnostic.document?.mode === "scan" &&
          (!diagnostic.preview?.word_boxes?.length || diagnostic.translation_status !== "ready")) {
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
  const cycle = Math.max(3, valid.length * 0.07 + 1);
  overlay.style.setProperty("--box-cycle", `${cycle}s`);
  valid.forEach((box, index) => {
    const rect = svgEl("rect", {
      class: "ocr-box", x: box.x, y: box.y, width: box.width, height: box.height, rx: 0.004, "aria-hidden": "true",
    });
    rect.style.setProperty("--box-delay", `${index * 0.07}s`);
    overlay.append(rect);
  });
  return overlay;
}

function diagnosticAnimState(result) {
  const preview = result.fastDiagnostic?.preview || {};
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const url = preview.animation_status === "ready" && preview.animation_gif_url && !reduceMotion
    ? artifactUrl(diagnosticApiBase(), preview.animation_gif_url) : "";
  const state = url ? "ready" : (preview.animation_status === "processing" ? "processing" : "unavailable");
  // The key identifies what the left row shows, so a re-render does not restart the GIF.
  return { state, url, key: `${result.fastDiagnostic?.job_id || ""}:${state}:${url}` };
}

function makeDiagnosticSourceFlow(result, anim) {
  const info = result.document || {};
  const preview = result.fastDiagnostic?.preview || {};
  const pageRatio = `${info.original_preview.width || 900} / ${info.original_preview.height || 1273}`;
  const source = el("div", { className: "flow-page" },
    el("img", { src: info.original_preview.url, alt: "Original unblurred first page" }));
  const detected = el("div", { className: "flow-page ocr-page" });
  if (anim.state === "ready") {
    detected.append(el("img", { className: "scan-anim", src: anim.url, alt: "First page with the detected words highlighted one after the other" }));
  } else {
    detected.append(el("img", { src: info.original_preview.url, alt: "First page" }));
    if (anim.state === "processing") {
      detected.classList.add("anim-pending");
      detected.append(el("span", { className: "anim-caption" }, "Detecting words…"));
    } else {
      detected.append(makeOcrOverlay(preview.word_boxes, preview.box_granularity));
    }
  }
  source.style.setProperty("--page-ratio", pageRatio);
  detected.style.setProperty("--page-ratio", pageRatio);
  const row = el("div", { className: "flow-row source-flow" }, source, makeFlowArrow("OCR"), detected);
  row.dataset.anim = anim.key;
  return row;
}

function makeCoreSourceFlow(result) {
  const info = result.document || {};
  const preview = info.original_preview || {};
  const ratio = `${preview.width || 900} / ${preview.height || 1273}`;
  const makePage = (detected) => {
    const page = el("div", { className: `flow-page${detected ? " ocr-page" : ""}` },
      el("img", { src: preview.url, alt: detected ? "Original page with OCR detections" : "Original unblurred first page" }));
    page.style.setProperty("--page-ratio", ratio);
    if (detected) page.append(makeOcrOverlay(info.word_boxes, info.box_granularity));
    return page;
  };
  return el("div", { className: "flow-row source-flow" }, makePage(false), makeFlowArrow("OCR"), makePage(true));
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
    const sourceUrl = selectedPreview.source_text_url;
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
  } else if (previews.length > 1 && previews.some(({ preview: targetPreview }) => targetPreview.url)) {
    frame.classList.add("native-preview", "multi-native-preview");
    previews.forEach(({ item, preview: targetPreview }, index) => {
      if (!targetPreview.url) return;
      const image = el("img", { className: `native-page native-target-${index}`, src: targetPreview.url, alt: `${item.target_language} translated rebuilt document` });
      image.style.setProperty("--sample-delay", `${index * 3}s`); frame.append(image);
    });
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
  $("source-status").hidden = false;
  $("source-status").className = `result-heading ${transcription.status === "ready" ? "ok" : "warn"}`;
  $("translation-status").textContent = statusText(translation.status, "Translation");
  $("translation-status").hidden = false;
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
  $("stats").hidden = false;

  const source = $("source-visual");
  source.style.aspectRatio = `${documentInfo.original_preview?.width || 900} / ${documentInfo.original_preview?.height || 1273}`;
  if (result.fastDiagnostic) {
    source.classList.add("diagnostic-flow-frame");
    const anim = diagnosticAnimState(result);
    const currentRow = source.querySelector(".source-flow");
    if (!currentRow || currentRow.dataset.anim !== anim.key) {   // same key = leave the GIF playing
      source.replaceChildren(makeDiagnosticSourceFlow(result, anim));
    }
  } else {
    if (documentInfo.original_preview?.url && (documentInfo.mode === "scan" || documentInfo.word_boxes?.length)) {
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
  const hasHandwritingLayer = documentInfo.mode === "scan" && kind === "handwriting";
  if (hasHandwritingLayer) sourceFormats.push("PDF (layer)");
  fillSelect($("transcribe-format"), sourceFormats, hasHandwritingLayer ? "PDF (layer)" : "PDF (text)");
  $("transcribe-format").parentElement.hidden = false;
  $("transcribe-action").hidden = false;
  $("transcription-delivery").hidden = false;
  $("transcribe-action").textContent = `Transcribe for ${price(words, kind, "transcribe")}`;
  $("transcription-delivery").textContent = `Delivery date: ${deliveryDate(words)}`;
  const rawSourceCode = documentInfo.source_language_code || Object.entries(LANGUAGE_CODES).find(([name]) => name.toLowerCase() === language.toLowerCase())?.[1] || language;
  const sourceCode = ({ french: "fr", english: "en", chinese: "zh", "chinese (simplified)": "zh" })[String(rawSourceCode).toLowerCase()] || String(rawSourceCode).split("-")[0].toLowerCase();
  const defaultTarget = sourceCode === "en" ? "French" : "English";
  const availableLanguages = LANGS.filter((item) => LANGUAGE_CODES[item] !== sourceCode && item.toLowerCase() !== language.toLowerCase());
  fillSelect($("target-language"), availableLanguages, defaultTarget);
  $("target-language").parentElement.hidden = false;
  fillSelect($("translation-format"), FORMATS, "PDF (text)");
  $("translation-format").parentElement.hidden = false;
  const updateTranslationOffer = () => {
    const selected = $("target-language").value;
    const selectedTranslation = (result.translations || []).find((item) => item.target_language === selected) ||
      (translation.target_language === selected ? translation : null);
    $("translate-action").textContent = `Translate for ${price(words, kind, "translate")}`;
    $("translate-action").href = `/pricing.html?language=${encodeURIComponent(LANGUAGE_CODES[selected] || selected)}&format=${encodeURIComponent($("translation-format").value)}`;
    const count = Number(selectedTranslation?.estimated_word_count) || null;
    $("translation-stats").replaceChildren(...(count ? [el("div", {}, el("strong", {}, String(count)), el("span", {}, "estimated words"))] : []));
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
["dragenter", "dragover"].forEach((type) => drop.addEventListener(type, (event) => { event.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach((type) => drop.addEventListener(type, (event) => { event.preventDefault(); drop.classList.remove("over"); }));
drop.addEventListener("drop", (event) => { const file = event.dataTransfer.files[0]; if (file) process(file); });
