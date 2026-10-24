// Réglages. DEMO=true : résultats simulés, sans serveur. Mettre false quand l'API répond.
const CONFIG = { API_BASE: "https://ilvje-31-44-97-94.run.pinggy-free.link", DEMO: false };
// Tarifs et délais : valeurs provisoires à ajuster.
const RATE = { transcribe: 0.02, translate: 0.05 };           // € par mot
const DIFFICULTY = { fiscal: 1.0, juridique: 1.3, manuscrit: 1.6, autre: 1.0 };
const WORDS_PER_DAY = 1500;
const LANGS = ["Français", "Anglais", "Allemand", "Espagnol", "Italien", "Polonais", "Turc"];

const $ = (id) => document.getElementById(id);
const out = $("out");
const euros = (n) => n.toLocaleString("fr-FR", { style: "currency", currency: "EUR" });

function el(tag, props = {}, ...kids) {
  const e = Object.assign(document.createElement(tag), props);
  kids.flat().forEach((k) => e.append(k));
  return e;
}
function quote(words, kind, mult) {
  const d = DIFFICULTY[kind] || 1;
  const days = Math.max(1, Math.ceil((words * d * mult) / WORDS_PER_DAY));
  const date = new Date(Date.now() + days * 864e5).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  return { date };
}
const price = (words, kind, type) => euros(words * RATE[type] * (DIFFICULTY[kind] || 1));

// --- Traitement ---
async function process(file) {
  out.className = "empty"; out.textContent = "Traitement en cours…";
  try {
    render(CONFIG.DEMO ? await mock(file) : await callApi(file));
  } catch (e) {
    out.className = "empty"; out.textContent = "Le traitement a échoué. Réessayez, ou écrivez à contact@data-compiler.com.";
  }
}
async function mock(file) {
  await new Promise((r) => setTimeout(r, 1500));
  const n = file.name.toLowerCase();
  if (n.includes("polish")) return { words: 412, language: "Polonais", needs_review: true, kind: "manuscrit" };
  if (n.includes("tax")) return { words: 868, language: "Français", needs_review: false, kind: "fiscal" };
  return { words: 300, language: "Anglais", needs_review: true, kind: "autre" };
}
async function callApi(file) {
  const fd = new FormData(); fd.append("file", file);
  const up = await fetch(`${CONFIG.API_BASE}/upload`, { method: "POST", body: fd });
  const { job_id } = await up.json();
  for (;;) {
    await new Promise((r) => setTimeout(r, 2000));
    const st = await (await fetch(`${CONFIG.API_BASE}/status/${job_id}`)).json();
    if (st.state === "done") break;
    if (st.state === "error") throw new Error("job");
  }
  return (await fetch(`${CONFIG.API_BASE}/result/${job_id}`)).json(); // { words, language, needs_review, kind, preview_url? }
}

// --- Affichage ---
function preview(r) {
  // En production, `preview_url` doit être une image DÉJÀ floutée côté serveur (le flou CSS ci-dessous ne sert que pour la démo).
  const box = el("div", { className: "preview" });
  if (r.preview_url) {
    box.append(el("img", { src: r.preview_url, alt: "Aperçu du document", style: "width:100%;display:block" }));
  } else if (CONFIG.DEMO) {
    box.append(el("div", { className: "top" }, "Avis d’impôt établi en 2021 — Direction générale des finances publiques. Vos références : numéro fiscal, référence de l’avis."));
    box.append(el("div", { className: "blur" }, "Le reste du document est masqué. Revenus imposables, impôt sur le revenu net avant corrections, contributions sociales, solde à payer ou à recevoir, modalités de paiement et de réclamation."));
  } else {
    box.append(el("div", { className: "top" }, "Aperçu indisponible pour ce document."));
  }
  box.append(el("div", { className: "gate" }, el("strong", {}, "Payez pour voir le document complet"),
    el("button", { onclick: () => (location.href = "/pricing.html") }, "Débloquer le document")));
  return box;
}
function render(r) {
  out.className = ""; out.replaceChildren();
  out.append(el("p", { className: "status " + (r.needs_review ? "warn" : "ok") },
    r.needs_review ? "Votre document a besoin d’une révision humaine" : "Votre document est prêt"));
  out.append(el("div", { className: "stat" },
    el("div", {}, el("b", {}, String(r.words)), el("span", {}, "mots")),
    el("div", {}, el("b", {}, r.language), el("span", {}, "langue"))));
  out.append(preview(r));
  if (!r.needs_review) {
    const fmt = el("select", { "aria-label": "Format" }, ["DOCX", "PDF", "JSON"].map((f) => el("option", { value: f }, f)));
    out.append(el("div", { className: "opt" }, el("p", {}, "Télécharger au format"), fmt,
      el("button", { onclick: () => (location.href = "/pricing.html") }, "Télécharger")));
    return;
  }
  const q1 = quote(r.words, r.kind, 1);
  out.append(el("div", { className: "opt" }, el("p", {}, el("strong", {}, "Transcrire"),
    el("small", {}, `Prêt le ${q1.date}`)), el("strong", {}, price(r.words, r.kind, "transcribe"))));
  const sel = el("select", { "aria-label": "Langue de traduction" }, LANGS.filter((l) => l !== r.language).map((l) => el("option", { value: l }, l)));
  const info = el("small", {}), cost = el("strong", {});
  const upd = () => { info.textContent = `Prêt le ${quote(r.words, r.kind, 1.8).date}`; cost.textContent = price(r.words, r.kind, "translate"); };
  sel.onchange = upd; upd();
  out.append(el("div", { className: "opt" }, el("p", {}, el("strong", {}, "Traduire en "), sel, info), cost));
}

// --- Dépôt de fichier ---
const drop = $("drop"), input = $("file");
drop.onclick = () => input.click();
drop.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); } };
input.onchange = () => input.files[0] && process(input.files[0]);
["dragenter", "dragover"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
drop.addEventListener("drop", (e) => e.dataTransfer.files[0] && process(e.dataTransfer.files[0]));
