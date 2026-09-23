const MYMEMORY_URL = "https://api.mymemory.translated.net/get";
const MFU_COORDS = { lat: 20.0432, lng: 99.8925 };

const LANDMARKS = [
  { keywords: ["ฟ้าไทย", "fah thai", "ตลาดฟ้าไทย"], name: "Fah Thai market area", approxNote: "~5\u20138 min / 3\u20133.5 km from MFU (typical for this area)" }
];

const REPLY_TEMPLATES = [
  { id: "avail", en: "Hi, is this room still available?" },
  { id: "view", en: "Can I schedule a viewing this weekend?" },
  { id: "deposit", en: "Is the deposit negotiable?" },
  { id: "utilities", en: "What utilities are included in the price?" },
  { id: "foreigner", en: "Do you accept international students as tenants?" }
];

const els = {};
document.querySelectorAll("[id]").forEach((el) => (els[el.id] = el));

let currentMode = "text";
let lastResult = null;
let expandedSavedId = null; // tracks which saved item currently has details open
let currentImageDataUrl = null;

init();

async function init() {
  bindTabs();
  bindModeButtons();
  bindRun();
  bindSave();
  bindAlerts();
  bindReply();
  bindImageInput();

  const { pendingText } = await chrome.storage.local.get("pendingText");
  if (pendingText) {
    els.thaiText.value = pendingText;
    await chrome.storage.local.remove("pendingText");
    setActiveTab("translate");
  }

  renderSaved();
  renderAlerts();
  renderReplyOptions();
}

// ---------- Tabs ----------
function bindTabs() {
  document.querySelectorAll(".tab").forEach((btn) => {
    btn.addEventListener("click", () => setActiveTab(btn.dataset.tab));
  });
}

function setActiveTab(name) {
  document.querySelectorAll(".panel").forEach((p) => p.classList.add("hidden"));
  const panel = document.getElementById(`panel-${name}`);
  if (panel) panel.classList.remove("hidden");
  document.querySelectorAll(".tab").forEach((t) => {
    const active = t.dataset.tab === name;
    t.classList.toggle("active", active);
    t.setAttribute("aria-selected", active);
  });
}
// -------- image -------
function bindImageInput() {
    console.log("bindImageInput called, imageInput element:", els.imageInput);
    els.imageInput.addEventListener("change", handleImageSelect);
}

async function handleImageSelect(e) {
    console.log("handleImageSelect fired", e.target.files);
    const file = e.target.files[0];
    if (!file) return;
    currentImageDataUrl = await compressImage(file);
    console.log("compressed image length:", currentImageDataUrl?.length);
    els.imagePreview.src = currentImageDataUrl;
    els.imagePreview.classList.remove("hidden");
    console.log("imagePreview classes after:", els.imagePreview.className);
}

async function compressImage(file, maxWidth = 800, quality = 0.7) {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxWidth / bitmap.width);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width * scale;
    canvas.height = bitmap.height * scale;
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", quality);
}
// ---------- Input mode ----------
function bindModeButtons() {
    document.querySelectorAll(".mode-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
            currentMode = btn.dataset.mode;

            document.querySelectorAll(".mode-btn").forEach((b) =>
                b.classList.toggle("active", b === btn)
            );

            els.thaiText.classList.toggle("hidden", currentMode !== "text");
            els.imageDrop.classList.toggle("hidden", currentMode !== "image");

            els.runBtn.textContent =
                currentMode === "image"
                    ? "Save image"
                    : "Translate & extract";
        });
    });
}

// ---------- Translation ----------
async function translateChunk(text, sourceLang, targetLang) {
  const params = new URLSearchParams({ q: text, langpair: `${sourceLang}|${targetLang}` });
  const res = await fetch(`${MYMEMORY_URL}?${params.toString()}`);
  if (!res.ok) throw new Error(`Translate request failed (${res.status})`);
  const data = await res.json();
  return data?.responseData?.translatedText || "";
}

function splitIntoChunks(text, maxBytes = 450) {
  const lines = text.split(/\n+/).filter(Boolean);
  const chunks = [];
  let current = "";
  const byteLen = (s) => new TextEncoder().encode(s).length;

  for (const line of lines) {
    const candidate = current ? `${current}\n${line}` : line;
    if (byteLen(candidate) > maxBytes && current) {
      chunks.push(current);
      current = line;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);
  return chunks.length ? chunks : [text];
}

async function translateLong(text, sourceLang, targetLang) {
  const chunks = splitIntoChunks(text);
  const results = [];
  for (const chunk of chunks) {
    results.push(await translateChunk(chunk, sourceLang, targetLang));
  }
  return results.join(" ");
}

// ---------- Field extraction ----------
function extractPrice(text) {
  let m = text.match(/ค่าเช่า[:\s]*([\d,]{3,})\s*(บาท)?/);
  if (m) return `${m[1]} THB/month`;
  m = text.match(/([\d]{1,3}(?:,\d{3})+|\d{3,6})\s*(?:บาท)?\s*\/?\s*(?:เดือน)/);
  if (m) return `${m[1]} THB/month`;
  m = text.match(/(\d[\d,]{2,})\s*บาทเท่านั้น/);
  if (m) return `${m[1]} THB/month`;
  return null;
}

function extractDeposit(text) {
  let m = text.match(/ประกัน[:\s]*([\d]+)\s*(เดือน|บาท)/);
  if (m) return m[2] === "เดือน" ? `${m[1]} month(s) rent` : `${m[1]} THB`;
  m = text.match(/มัดจำ[:\s]*([\d]+)\s*(เดือน|บาท)?/);
  if (m) return m[2] === "บาท" ? `${m[1]} THB` : `${m[1]} month(s) rent (approx.)`;
  return null;
}

function extractPhone(text) {
  const matches = text.match(/0\d{1,2}[-\s]?\d{3}[-\s]?\d{3,4}/g);
  if (!matches) return null;
  const unique = [...new Set(matches.map((s) => s.trim()))];
  return unique.join(", ");
}

function extractLocation(text) {
  let m = text.match(/ทำเล\s*[:：]\s*([^\n]+)/);
  if (m) return m[1].trim();
  m = text.match(/(ซอย[^\n,]+)/);
  if (m) return m[1].trim();
  m = text.match(/(พื้นที่ใช้สอย[^\n,]+)/);
  if (m) return m[1].replace("พื้นที่ใช้สอย", "").trim();
  m = text.match(/(ห่างจาก[^\n,]+|ห่างมอ[^\n,]+|ใกล้[^\n,]+)/);
  if (m) return m[1].trim();
  return null;
}

function extractAvailability(text) {
  if (/พร้อมเข้าอยู่/.test(text)) return "Ready to move in";
  if (/ห้องว่าง|บ้านว่าง|ว่างให้เช่า/.test(text)) return "Available now";
  return null;
}

// ---------- Distance detection ----------
function detectDistance(text) {
  const linkMatch = text.match(/https?:\/\/(?:maps\.app\.goo\.gl|g\.co\/kgs|goo\.gl\/maps|www\.google\.com\/maps)\S+/i);
  const kmNear = text.match(/([\d.]+)\s*(?:กม\.?|km)/i);
  if (linkMatch) {
    const kmPart = kmNear ? ` (\u2248${kmNear[1]} km)` : "";
    return { text: `Map link provided by landlord${kmPart}`, link: linkMatch[0] };
  }

  const stated = text.match(/(\d+)\s*(นาที|min)/i);
  if (stated) {
    return { text: `${stated[1]} min from MFU (stated in listing)`, link: null };
  }

  for (const landmark of LANDMARKS) {
    if (landmark.keywords.some((k) => text.toLowerCase().includes(k.toLowerCase()))) {
      return { text: `${landmark.name} \u2014 ${landmark.approxNote}`, link: null };
    }
  }

  return { text: "Distance not stated \u2014 check the listing manually", link: null };
}

// ---------- Run translate/extract ----------
function bindRun() {
  els.runBtn.addEventListener("click", runExtraction);
}

async function runExtraction() {
  const text = els.thaiText.value.trim();
  if (currentMode === "text" && !text) {
    showStatus(els.runStatus, "Paste some Thai text first.", "error");
    return;
    }
    //-- image --
    if (currentMode === "image") {
        if (!currentImageDataUrl) {
            showStatus(els.runStatus, "Please upload a screenshot first.", "error");
            return;
        }

        lastResult = {
            sourceText: "",
            sourceLink: els.sourceLinkInput.value.trim() || null,
            translatedText: "",
            price: null,
            deposit: null,
            location: null,
            contactPhone: null,
            availability: null,
            distanceText: "Not extracted from screenshot",
            distanceLink: null
        };

        renderResult(lastResult);
        showStatus(els.runStatus, "Screenshot ready to save.", "ok");
        return;
    }

  els.runBtn.disabled = true;
  showStatus(els.runStatus, "Translating\u2026", "");
  els.result.classList.add("hidden");

  try {
    const translatedText = await translateLong(text, "th", "en");
    const distance = detectDistance(text);
    const sourceLink = els.sourceLinkInput.value.trim() || null;

    lastResult = {
      sourceText: text,
      sourceLink,
      translatedText,
      price: extractPrice(text),
      deposit: extractDeposit(text),
      location: extractLocation(text),
      contactPhone: extractPhone(text),
      availability: extractAvailability(text),
      distanceText: distance.text,
      distanceLink: distance.link
    };

    renderResult(lastResult);
    showStatus(els.runStatus, "Done.", "ok");
  } catch (err) {
    console.error(err);
    showStatus(els.runStatus, `Couldn't translate that: ${err.message}`, "error");
  } finally {
    els.runBtn.disabled = false;
  }
}

function renderResult(r) {
  els.translatedText.textContent = r.translatedText || "(no translation returned)";

  const fields = [
    ["Price", r.price],
    ["Deposit", r.deposit],
    ["Location", r.location],
    ["Phone", r.contactPhone],
    ["Available", r.availability]
  ];
  els.detailsList.innerHTML = fields
    .map(([label, value]) => `<dt>${label}</dt><dd>${value ? escapeHtml(value) : "\u2014"}</dd>`)
    .join("");

  els.distanceText.innerHTML = r.distanceLink
    ? `${escapeHtml(r.distanceText)} \u2014 <a href="${r.distanceLink}" target="_blank" rel="noopener">open map</a>`
    : escapeHtml(r.distanceText);

  els.result.classList.remove("hidden");
  els.replyPanel.classList.add("hidden");
  showStatus(els.saveStatus, "", "");
}

// ---------- Save listing ----------
function bindSave() {
  els.saveListingBtn.addEventListener("click", saveCurrentListing);
}

 // --- add image ---
function renderSavedItem(l) {
    const isExpanded = expandedSavedId === l.id;
    const sourceLinkRow = l.sourceLink
        ? `<a class="chip-btn chip-link" href="${l.sourceLink}" target="_blank" rel="noopener">View original post</a>`
        : "";
    const photoBlock = l.image
        ? `<img class="saved-item-photo" src="${l.image}" alt="listing photo" />`
        : "";

    const detailsBlock = isExpanded
        ? `
      <div class="saved-item-details">
        <div><strong>Translation</strong></div>
        <p style="margin:4px 0 8px;">${escapeHtml(l.translatedText || "(no translation saved)")}</p>
        <dl class="details-grid">
          <dt>Price</dt><dd>${l.price ? escapeHtml(l.price) : "\u2014"}</dd>
          <dt>Deposit</dt><dd>${l.deposit ? escapeHtml(l.deposit) : "\u2014"}</dd>
          <dt>Location</dt><dd>${l.location ? escapeHtml(l.location) : "\u2014"}</dd>
          <dt>Phone</dt><dd>${l.contactPhone ? escapeHtml(l.contactPhone) : "\u2014"}</dd>
          <dt>Available</dt><dd>${l.availability ? escapeHtml(l.availability) : "\u2014"}</dd>
        </dl>
      </div>`
        : "";

    return `
    <li class="saved-item" data-id="${l.id}">
      ${photoBlock}
      <div class="saved-item-top">
        <span class="saved-item-price">${l.price ? escapeHtml(l.price) : "Price n/a"}</span>
        <span>${l.availability ? escapeHtml(l.availability) : ""}</span>
      </div>
      <div class="saved-item-loc">${l.location ? escapeHtml(l.location) : "Location n/a"}</div>
      <div class="saved-item-loc">${l.distanceText ? escapeHtml(l.distanceText) : ""}</div>
      <div class="saved-item-actions">
        <button class="chip-btn" data-action="toggle-details">${isExpanded ? "Hide details" : "View details"}</button>
        <button class="chip-btn" data-action="call" data-phone="${(l.contactPhone || "").split(",")[0].trim()}">Call landlord</button>
        ${sourceLinkRow}
        <button class="chip-btn" data-action="remove">Remove</button>
      </div>
      ${detailsBlock}
    </li>`;
}

async function renderSaved() {
  const { savedListings = [] } = await chrome.storage.local.get("savedListings");
  els.savedEmpty.classList.toggle("hidden", savedListings.length > 0);
  els.savedList.innerHTML = savedListings.map(renderSavedItem).join("");

  els.savedList.querySelectorAll("[data-action='toggle-details']").forEach((btn) =>
    btn.addEventListener("click", (e) => {
      const id = Number(e.target.closest(".saved-item").dataset.id);
      expandedSavedId = expandedSavedId === id ? null : id;
      renderSaved();
    })
  );
  els.savedList.querySelectorAll("[data-action='remove']").forEach((btn) =>
    btn.addEventListener("click", async (e) => {
      const id = Number(e.target.closest(".saved-item").dataset.id);
      const { savedListings = [] } = await chrome.storage.local.get("savedListings");
      await chrome.storage.local.set({ savedListings: savedListings.filter((l) => l.id !== id) });
      if (expandedSavedId === id) expandedSavedId = null;
      renderSaved();
    })
  );
  els.savedList.querySelectorAll("[data-action='call']").forEach((btn) =>
    btn.addEventListener("click", (e) => {
      const phone = e.target.dataset.phone;
      if (phone) window.open(`tel:${phone}`);
    })
  );
}
// -------- save image -------
async function saveCurrentListing() {
    if (!lastResult) return;
    const { savedListings = [] } = await chrome.storage.local.get("savedListings");
    const listing = {
        id: Date.now(),
        savedAt: new Date().toISOString(),
        image: currentImageDataUrl,   // -- new image --
        ...lastResult
    };
    savedListings.unshift(listing);
    await chrome.storage.local.set({ savedListings });
    showStatus(els.saveStatus, "Saved to your listings.", "ok");

    currentImageDataUrl = null;     // -- new image - clear to not save with the new image --
    els.imagePreview.classList.add("hidden");
    els.imagePreview.src = "";

    renderSaved();
}
// ---------- Alerts / preferences ----------
function bindAlerts() {
  els.addAlertBtn.addEventListener("click", async () => {
    const preferredArea = els.alertArea.value.trim();
    const maxPrice = Number(els.alertPrice.value) || null;
    if (!preferredArea && !maxPrice) return;
    const { searchAlerts = [] } = await chrome.storage.local.get("searchAlerts");
    searchAlerts.unshift({ id: Date.now(), preferredArea, maxPrice, isActive: true });
    await chrome.storage.local.set({ searchAlerts });
    els.alertArea.value = "";
    els.alertPrice.value = "";
    renderAlerts();
  });
}

async function renderAlerts() {
  const { searchAlerts = [] } = await chrome.storage.local.get("searchAlerts");
  els.alertsListUI.innerHTML = searchAlerts
    .map(
      (a) => `
      <li class="saved-item" data-id="${a.id}">
        <div class="saved-item-top">
          <span class="saved-item-price">${a.preferredArea || "Any area"}</span>
          <span>${a.maxPrice ? `\u2264 ${a.maxPrice} THB` : ""}</span>
        </div>
        <div class="saved-item-actions">
          <button class="chip-btn" data-action="remove">Remove</button>
        </div>
      </li>`
    )
    .join("");
  els.alertsListUI.querySelectorAll("[data-action='remove']").forEach((btn) =>
    btn.addEventListener("click", async (e) => {
      const id = Number(e.target.closest(".saved-item").dataset.id);
      const { searchAlerts = [] } = await chrome.storage.local.get("searchAlerts");
      await chrome.storage.local.set({ searchAlerts: searchAlerts.filter((a) => a.id !== id) });
      renderAlerts();
    })
  );
}

// ---------- Reply-in-Thai generator ----------
function renderReplyOptions() {
  els.replyOptions.innerHTML = REPLY_TEMPLATES.map(
    (t) => `
    <label class="reply-option">
      <input type="checkbox" value="${t.id}" checked />
      <span>${escapeHtml(t.en)}</span>
    </label>`
  ).join("");
}

function bindReply() {
  els.toggleReplyBtn.addEventListener("click", () => {
    els.replyPanel.classList.toggle("hidden");
  });
  els.generateReplyBtn.addEventListener("click", generateReply);
  els.copyReplyBtn.addEventListener("click", () => {
    els.replyOutput.select();
    document.execCommand("copy");
    showStatus(els.saveStatus, "", "");
  });
}

async function generateReply() {
  const checked = [...els.replyOptions.querySelectorAll("input:checked")].map((i) => i.value);
  const chosen = REPLY_TEMPLATES.filter((t) => checked.includes(t.id));
  if (!chosen.length) return;

  els.generateReplyBtn.disabled = true;
  els.generateReplyBtn.textContent = "Translating\u2026";
  try {
    const lines = [];
    for (const t of chosen) {
      const th = await translateChunk(t.en, "en", "th");
      lines.push(th);
    }
    els.replyOutput.value = lines.join("\n");
    els.replyOutput.classList.remove("hidden");
    els.copyReplyBtn.classList.remove("hidden");
  } catch (err) {
    console.error(err);
  } finally {
    els.generateReplyBtn.disabled = false;
    els.generateReplyBtn.textContent = "Generate Thai message";
  }
}

// ---------- Helpers ----------
function showStatus(el, message, kind) {
  el.textContent = message;
  el.className = `status ${kind}`;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
