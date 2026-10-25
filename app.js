const CONFIG = { API_BASE: "https://enjoy-petite-context-amendment.trycloudflare.com", DEMO: false };
const RATE = { transcribe: 0.02, translate: 0.05 };
const DIFFICULTY = { fiscal: 1.0, legal: 1.3, handwriting: 1.6, other: 1.0 };
const LANGS = ["French", "English", "German", "Spanish", "Italian", "Polish", "Turkish"];
const $ = (id) => document.getElementById(id);
const euros = (amount) => amount.toLocaleString("en-GB", { style: "currency", currency: "EUR" });

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  children.flat().filter((child) => child !== null && child !== undefined).forEach((child) => node.append(child));
  return node;
}
function price(words, kind, service) { return euros((words || 0) * RATE[service] * (DIFFICULTY[kind] || 1)); }
function statusText(state, noun) {
  if (state === "ready") return `${noun} is ready`;
  if (state === "needs_review") return `${noun} needs human review`;
  if (state === "error") return `${noun} could not be completed`;
  return `${noun} is being processed`;
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
  showProcessing();
  try {
    const result = CONFIG.DEMO ? await demoResult() : await callApi(file);
    render(result);
  } catch (error) {
    console.error(error);
    $("error").textContent = "Processing failed. Please try again, or write to contact@data-compiler.com.";
    $("error").hidden = false;
    $("drop").classList.remove("processing-drop");
    $("drop").querySelector("strong").textContent = "Drop a PDF here";
    $("drop").querySelector("span").textContent = "or click to upload";
    $("drop").querySelector("small").hidden = false;
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
  const api = CONFIG.API_BASE.replace(/\/+$/, "");
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

function makeVisualFrame(result) {
  const documentInfo = result.document || {};
  const translation = result.translation || {};
  const preview = translation.preview || {};
  const frame = el("div", { id: "translation-visual", className: "visual-frame" });
  const original = documentInfo.original_preview || {};
  const width = original.width || 900, height = original.height || 1273;
  frame.style.aspectRatio = `${width} / ${height}`;

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
  frame.append(el("div", { className: "gate" }, el("strong", {}, "Full document available after purchase")));
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
  if (Number(documentInfo.reduction_percent) > 0) {
    metrics.push(el("div", {}, el("strong", {}, `${documentInfo.reduction_percent}%`), el("span", {}, "size reduction")));
  }
  $("stats").replaceChildren(...metrics);

  const source = $("source-visual");
  source.style.aspectRatio = `${documentInfo.original_preview?.width || 900} / ${documentInfo.original_preview?.height || 1273}`;
  source.replaceChildren(documentInfo.original_preview?.url
    ? el("img", { className: "scan-base", src: documentInfo.original_preview.url, alt: "Original unblurred document" })
    : el("span", { className: "missing-source" }, "Original scan unavailable."));

  $("transcribe-action").textContent = `Transcribe for ${price(words, kind, "transcribe")}`;
  const select = $("target-language");
  const defaultTarget = language.toLowerCase() === "english" ? "French" : "English";
  const selectedTarget = translation.target_language || defaultTarget;
  select.replaceChildren(...LANGS.map((name) => el("option", { value: name, selected: name === selectedTarget }, name)));
  const updateTranslationOffer = () => {
    $("translate-action").textContent = `Translate for ${price(words, kind, "translate")}`;
    const count = select.value === selectedTarget ? translation.estimated_word_count : null;
    $("translation-stats").replaceChildren(...(count == null ? [] :
      [el("div", {}, el("strong", {}, String(count)), el("span", {}, "estimated words"))]));
  };
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
