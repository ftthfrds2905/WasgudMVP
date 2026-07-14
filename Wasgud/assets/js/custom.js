/* =========================
   Wasgud Custom JS (Live Server Friendly)
   - Loads datapoints.json + mlr_model.json (no Node server)
   - Index: map + search + smart picks
   - Dashboard: filters + table + map + MLR chart + R²/MAE
   ========================= */

(function () {
  // -----------------------------
  // Paths (Live Server portable)
  // -----------------------------
  const DATA_URL_CANDIDATES = [
    "assets/data/datapoints.json",
    "./assets/data/datapoints.json",
    "/assets/data/datapoints.json"
  ];

  const MLR_URL_CANDIDATES = [
    "assets/data/mlr_model.json",
    "./assets/data/mlr_model.json",
    "/assets/data/mlr_model.json"
  ];

  // -----------------------------
  // LocalStorage keys
  // -----------------------------
  const LS_SELECTED = "wasgud_selected_product";
  const LS_USER_LOC = "wasgud_user_location";

  // -----------------------------
  // State
  // -----------------------------
  let DATA = [];
  let DATA_LOADED = false;
  let DATA_LOADING = null;

  let MLR = null;
  let MLR_LOADED = false;
  let MLR_LOADING = null;

  // Dashboard runtime state
  let DASH_ROWS_ALL = [];
  let DASH_ROWS_VIEW = [];
  let DASH_USER_LOC = null;

  let dashChart = null;

  // -----------------------------
  // Utilities
  // -----------------------------
  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, (m) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    }[m]));
  }

  function normText(v) {
    return String(v ?? "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  function fmtPrice(v) {
    const n = Number(v);
    if (!isFinite(n)) return "-";
    return n.toFixed(2);
  }

  function log(...args) { console.log("[Wasgud]", ...args); }
  function warn(...args) { console.warn("[Wasgud]", ...args); }
  function err(...args) { console.error("[Wasgud]", ...args); }

  // -----------------------------
  // Dataset normalization (matches your datapoints.json keys)
  // -----------------------------
  function normalizeRow(row) {
    // Your JSON keys include spaces & capitals:
    // "Product Name", "Base Price", "Subcategory", "Availability_Flag", etc.
    const productName =
      row["Product Name"] ?? row["Product_Name"] ?? row["product_name"] ?? row["name"] ?? "";

    const store =
      row["Store"] ?? row["Store_Name"] ?? row["store"] ?? "";

    const brand =
      row["Brand"] ?? row["brand"] ?? "";

    const category =
      row["Category"] ?? row["category"] ?? "";

    const subcategory =
      row["Subcategory"] ?? row["Sub Category"] ?? row["sub_category"] ?? row["subcategory"] ?? "";

    const basePrice = Number(row["Base Price"] ?? row["Base_Price"] ?? row["base_price"] ?? NaN);
    const price = Number(row["Price"] ?? row["price"] ?? NaN);

    const lat = Number(row["Latitude"] ?? row["lat"] ?? NaN);
    const lng = Number(row["Longitude"] ?? row["lng"] ?? NaN);

    const availability =
      row["Availability"] ?? row["availability"] ?? "Y";

    const availabilityFlag =
      row["Availability_Flag"] ?? row["availability_flag"] ?? row["in_stock"] ?? null;

    return {
      raw: row,

      product_name: String(productName),
      product_key: normText(productName),

      store: String(store),
      store_key: normText(store),

      brand: String(brand),
      brand_key: normText(brand),

      category: String(category),
      category_key: normText(category),

      subcategory: String(subcategory),
      subcategory_key: normText(subcategory),

      base_price: isFinite(basePrice) ? basePrice : null,
      price: isFinite(price) ? price : null,

      latitude: isFinite(lat) ? lat : null,
      longitude: isFinite(lng) ? lng : null,

      availability: String(availability),
      availability_flag: (availabilityFlag == null ? null : Number(availabilityFlag))
    };
  }

  // -----------------------------
  // Fetch helpers
  // -----------------------------
  async function fetchJsonWithFallback(urls) {
    let lastError = null;

    for (const url of urls) {
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
        const json = await res.json();
        return { urlUsed: url, json };
      } catch (e) {
        lastError = e;
        warn("Load attempt failed:", String(e));
      }
    }
    throw lastError || new Error("Unable to load JSON from any candidate path.");
  }

  async function loadDataOnce() {
    if (DATA_LOADED) return DATA;
    if (DATA_LOADING) return DATA_LOADING;

    DATA_LOADING = (async () => {
      const { urlUsed, json } = await fetchJsonWithFallback(DATA_URL_CANDIDATES);
      if (!Array.isArray(json)) throw new Error(`datapoints.json must be an ARRAY. Loaded from ${urlUsed}`);

      DATA = json.map(normalizeRow);
      DATA_LOADED = true;
      log(`Loaded ${DATA.length} dataset rows from:`, urlUsed);
      return DATA;
    })();

    return DATA_LOADING;
  }

  async function loadMlrOnce() {
    if (MLR_LOADED) return MLR;
    if (MLR_LOADING) return MLR_LOADING;

    MLR_LOADING = (async () => {
      const { urlUsed, json } = await fetchJsonWithFallback(MLR_URL_CANDIDATES);

      // Your model shape:
      // { intercept: number, coefficients: { "Store_...": val, ..., "Base Price": val }, metrics: {r2_test, mae_test} }
      if (!json || typeof json.intercept !== "number" || !json.coefficients || typeof json.coefficients !== "object") {
        throw new Error("mlr_model.json format not recognised. Expect { intercept:number, coefficients:{...} }");
      }

      // Keep as-is; we will do exact-key lookups
      MLR = json;
      MLR_LOADED = true;
      log("Loaded MLR model from:", urlUsed);
      return MLR;
    })();

    return MLR_LOADING;
  }

  // -----------------------------
  // Geolocation helpers
  // -----------------------------
  function getUserLocationFromStorage() {
    try {
      const v = JSON.parse(localStorage.getItem(LS_USER_LOC) || "null");
      if (v && isFinite(v.lat) && isFinite(v.lng)) return v;
    } catch {}
    return null;
  }

  function saveUserLocation(loc) {
    localStorage.setItem(LS_USER_LOC, JSON.stringify(loc));
  }

  // -----------------------------
  // Distance helpers
  // -----------------------------
  function toRad(x) { return (x * Math.PI) / 180; }

  function haversineKm(a, b) {
    if (!a || !b) return null;
    const R = 6371;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);

    const s =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * (Math.sin(dLng / 2) ** 2);

    return 2 * R * Math.asin(Math.sqrt(s));
  }

  function availabilityScore(v, flag) {
    // Prefer numeric Availability_Flag if present
    if (flag != null && isFinite(Number(flag))) return Number(flag) ? 1 : 0;

    const t = normText(v);
    return (t === "y" || t === "1" || t === "yes" || t === "available" || t === "in stock") ? 1 : 0;
  }

  // -----------------------------
  // Map (iframe embed)
  // -----------------------------
  function renderIframeMap(containerEl, center, zoom = 14) {
    if (!containerEl) return;
    const lat = center?.lat ?? 3.139;
    const lng = center?.lng ?? 101.6869;

    containerEl.innerHTML = `
      <div style="width:100%; height:420px; border-radius:12px; overflow:hidden; background:#e9ecef;">
        <iframe
          title="Wasgud Map"
          width="100%"
          height="420"
          style="border:0;"
          loading="lazy"
          referrerpolicy="no-referrer-when-downgrade"
          src="https://www.google.com/maps?q=${encodeURIComponent(lat + "," + lng)}&z=${encodeURIComponent(zoom)}&output=embed">
        </iframe>
      </div>
    `;
  }

  function initGeolocationMap() {
    const mapEl = document.getElementById("map");
    const statusEl = document.getElementById("mapStatus");
    if (!mapEl) return; // only index has #map

    if (!mapEl.style.height) mapEl.style.height = "420px";

    const stored = getUserLocationFromStorage();
    if (stored) {
      renderIframeMap(mapEl, stored, 15);
      if (statusEl) statusEl.textContent = "Location loaded.";
      return;
    }

    if (!navigator.geolocation) {
      renderIframeMap(mapEl, { lat: 3.139, lng: 101.6869 }, 13);
      if (statusEl) statusEl.textContent = "Geolocation not supported. Showing default location.";
      return;
    }

    if (statusEl) statusEl.textContent = "Getting your location...";

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const userLoc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        saveUserLocation(userLoc);
        renderIframeMap(mapEl, userLoc, 15);
        if (statusEl) statusEl.textContent = "Location detected.";
        initSmartPicks();
      },
      () => {
        renderIframeMap(mapEl, { lat: 3.139, lng: 101.6869 }, 13);
        if (statusEl) statusEl.textContent =
          "Unable to retrieve location. Allow location access to improve recommendations.";
        initSmartPicks();
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  // -----------------------------
  // Index: Search (overlay + table)
  // -----------------------------
  function initSearchOnMap() {
    const input = document.getElementById("inputModalSearch");
    const btn = document.getElementById("btnModalSearch");
    const status = document.getElementById("searchStatus");
    const tbody = document.getElementById("searchResultsBody");
    if (!input || !btn || !status || !tbody) return;

    function showEmpty(msg) {
      tbody.innerHTML = `<tr><td colspan="4" class="text-muted text-center">${escapeHtml(msg)}</td></tr>`;
    }

    async function doSearch() {
      const q = normText(input.value);
      tbody.innerHTML = "";

      if (!q) {
        status.textContent = "Type something to search.";
        showEmpty("Start typing to search products");
        return;
      }

      status.textContent = "Searching...";

      try {
        const rows = await loadDataOnce();
        const results = rows.filter(r => r.product_key.includes(q)).slice(0, 80);

        status.textContent = `${results.length} result(s) found`;
        if (results.length === 0) return showEmpty("No matches found.");

        const frag = document.createDocumentFragment();

        for (const r of results) {
          const tr = document.createElement("tr");
          tr.className = "wasgud-result-row";
          tr.style.cursor = "pointer";
          tr.title = "Click to open dashboard";

          tr.dataset.payload = JSON.stringify({
            product_name: r.product_name,
            store: r.store,
            brand: r.brand,
            category: r.category,
            subcategory: r.subcategory,
            base_price: r.base_price,
            price: r.price,
            latitude: r.latitude,
            longitude: r.longitude,
            availability: r.availability,
            availability_flag: r.availability_flag
          });

          tr.innerHTML = `
            <td>${escapeHtml(r.product_name)}</td>
            <td>${escapeHtml(r.store)}</td>
            <td class="text-end">RM ${escapeHtml(fmtPrice(r.price))}</td>
            <td>${escapeHtml(r.category)}</td>
          `;
          frag.appendChild(tr);
        }

        tbody.appendChild(frag);
      } catch (e) {
        err("Search failed:", e);
        status.textContent = "Search failed. Open DevTools Console for details.";
        showEmpty("Could not load results.");
      }
    }

    tbody.addEventListener("click", (ev) => {
      const tr = ev.target.closest("tr.wasgud-result-row");
      if (!tr) return;

      try {
        const payload = JSON.parse(tr.dataset.payload || "null");
        if (!payload) return;

        localStorage.setItem(LS_SELECTED, JSON.stringify(payload));
        window.location.assign("dashboard.html");
      } catch (e) {
        err("Failed to open dashboard:", e);
      }
    });

    btn.addEventListener("click", doSearch);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") doSearch(); });

    showEmpty("Start typing to search products");
  }

  // -----------------------------
  // Index: Smart Picks Near You
  // -----------------------------
  async function initSmartPicks() {
    const rowEl = document.getElementById("smartPicksRow");
    if (!rowEl) return;

    rowEl.innerHTML = `<div class="col-12 text-center text-muted">Loading recommendations...</div>`;

    try {
      const rows = await loadDataOnce();
      const userLoc = getUserLocationFromStorage();

      // Group by product_key -> pick best row per product
      const byProduct = new Map();
      for (const r of rows) {
        if (!r.product_key) continue;
        if (!byProduct.has(r.product_key)) byProduct.set(r.product_key, []);
        byProduct.get(r.product_key).push(r);
      }

      const picks = [];

      for (const list of byProduct.values()) {
        const enriched = list.map(o => {
          const dist = (userLoc && o.latitude != null && o.longitude != null)
            ? haversineKm(userLoc, { lat: o.latitude, lng: o.longitude })
            : null;
          return { ...o, distance_km: dist };
        });

        enriched.sort((a, b) => {
          const aA = availabilityScore(a.availability, a.availability_flag);
          const bA = availabilityScore(b.availability, b.availability_flag);
          if (bA !== aA) return bA - aA;

          const ad = a.distance_km ?? 999999;
          const bd = b.distance_km ?? 999999;
          if (ad !== bd) return ad - bd;

          const ap = a.price ?? 999999;
          const bp = b.price ?? 999999;
          return ap - bp;
        });

        if (enriched[0]) picks.push(enriched[0]);
      }

      // overall rank: nearest then cheapest
      picks.sort((a, b) => {
        const ad = a.distance_km ?? 999999;
        const bd = b.distance_km ?? 999999;
        if (ad !== bd) return ad - bd;

        const ap = a.price ?? 999999;
        const bp = b.price ?? 999999;
        return ap - bp;
      });

      const top = picks.slice(0, 6);

      if (top.length === 0) {
        rowEl.innerHTML = `<div class="col-12 text-center text-muted">No recommendations available.</div>`;
        return;
      }

      rowEl.innerHTML = "";

      for (const p of top) {
        const distTxt = p.distance_km != null ? `${p.distance_km.toFixed(2)} km` : "Distance N/A";
        const priceTxt = p.price != null ? `RM ${fmtPrice(p.price)}` : "RM -";

        const col = document.createElement("div");
        col.className = "col-12 col-md-6 col-lg-4 mb-4";

        col.innerHTML = `
          <div class="card wasgud-pick-card h-100 shadow-sm">
            <div class="card-body">
              <div class="d-flex justify-content-between align-items-start">
                <div>
                  <h5 class="mb-1">${escapeHtml(p.product_name)}</h5>
                  <div class="text-muted small">${escapeHtml(p.category || "Uncategorised")}</div>
                </div>
                <span class="wasgud-badge">${escapeHtml(distTxt)}</span>
              </div>

              <hr>

              <div class="d-flex justify-content-between">
                <div class="small text-muted">Best store</div>
                <div class="fw-bold">${escapeHtml(p.store)}</div>
              </div>

              <div class="d-flex justify-content-between mt-1">
                <div class="small text-muted">Price</div>
                <div class="fw-bold text-success">${escapeHtml(priceTxt)}</div>
              </div>

              <button class="btn btn-success w-100 mt-3 wasgud-open-pick">View comparison</button>
            </div>
          </div>
        `;

        col.querySelector(".wasgud-open-pick").addEventListener("click", () => {
          localStorage.setItem(LS_SELECTED, JSON.stringify({
            product_name: p.product_name,
            store: p.store,
            brand: p.brand,
            category: p.category,
            subcategory: p.subcategory,
            base_price: p.base_price,
            price: p.price,
            latitude: p.latitude,
            longitude: p.longitude,
            availability: p.availability,
            availability_flag: p.availability_flag
          }));
          window.location.assign("dashboard.html");
        });

        rowEl.appendChild(col);
      }
    } catch (e) {
      err("Smart Picks failed:", e);
      rowEl.innerHTML = `<div class="col-12 text-center text-muted">Failed to load recommendations.</div>`;
    }
  }

  // -----------------------------
  // MLR prediction (MATCHES YOUR MODEL KEYS)
  // -----------------------------
  function mlrPredict(row, model) {
    if (!model || typeof model.intercept !== "number" || !model.coefficients) return null;

    const coef = model.coefficients;
    let y = Number(model.intercept);

    // One-hot features (exact keys as in mlr_model.json)
    const kStore = `Store_${row.store ?? ""}`;
    const kBrand = `Brand_${row.brand ?? ""}`;
    const kCat = `Category_${row.category ?? ""}`;
    const kSub = `Subcategory_${row.subcategory ?? ""}`;

    if (coef[kStore] != null) y += Number(coef[kStore]);
    if (coef[kBrand] != null) y += Number(coef[kBrand]);
    if (coef[kCat] != null) y += Number(coef[kCat]);
    if (coef[kSub] != null) y += Number(coef[kSub]);

    // Numeric
    const base = Number(row.base_price);
    const baseCoef =
      (coef["Base Price"] != null) ? Number(coef["Base Price"]) :
      (coef["Base_Price"] != null) ? Number(coef["Base_Price"]) :
      (coef["base_price"] != null) ? Number(coef["base_price"]) :
      null;

    if (baseCoef != null && isFinite(base)) {
      y += baseCoef * base;
    }

    if (!isFinite(y)) return null;
    return y;
  }

  // -----------------------------
  // Dashboard: metrics badges
  // -----------------------------
  function renderMlrMetrics(model) {
    const r2El = document.getElementById("mlrR2");
    const maeEl = document.getElementById("mlrMAE");
    if (!r2El || !maeEl) return;

    const r2 = model?.metrics?.r2_test;
    const mae = model?.metrics?.mae_test;

    r2El.textContent = (typeof r2 === "number") ? `R²: ${r2.toFixed(4)}` : "R²: -";
    maeEl.textContent = (typeof mae === "number") ? `MAE: RM ${mae.toFixed(2)}` : "MAE: -";
  }

  // -----------------------------
  // Dashboard: init
  // -----------------------------
  async function initDashboard() {
    const dashRoot = document.getElementById("dashboardRoot");
    if (!dashRoot) return; // not on dashboard.html

    const nameEl = document.getElementById("dashProductName");
    const catEl = document.getElementById("dashCategory");
    const priceEl = document.getElementById("dashPrice");
    const recEl = document.getElementById("dashRecommendation");

    const mapEl = document.getElementById("dashMap");
    const mapStatus = document.getElementById("dashMapStatus");

    const tbody = document.getElementById("dashStoresBody");

    const filterDistance = document.getElementById("filterDistance");
    const filterDistanceValue = document.getElementById("filterDistanceValue");
    const filterStore = document.getElementById("filterStore");

    const chartCanvas = document.getElementById("priceChart");

    // Load selection
    let selected = null;
    try { selected = JSON.parse(localStorage.getItem(LS_SELECTED) || "null"); } catch {}

    if (!selected || !selected.product_name) {
      if (recEl) recEl.className = "alert alert-warning mb-4";
      if (recEl) recEl.textContent = "No product selected. Please go back and search a product first.";
      if (tbody) tbody.innerHTML = `<tr><td colspan="5" class="text-muted text-center">No selection.</td></tr>`;
      if (mapEl) renderIframeMap(mapEl, getUserLocationFromStorage() || { lat: 3.139, lng: 101.6869 }, 13);
      return;
    }

    // Header
    if (nameEl) nameEl.textContent = selected.product_name || "Selected Product";
    if (catEl) catEl.textContent = selected.category || "-";
    if (priceEl) priceEl.textContent = (selected.price != null) ? `RM ${fmtPrice(selected.price)}` : "RM -";

    // Load dataset + model
    const [rows, model] = await Promise.all([
      loadDataOnce(),
      loadMlrOnce().catch((e) => { warn("MLR model failed to load:", e); return null; })
    ]);

    if (model) renderMlrMetrics(model);

    DASH_USER_LOC = getUserLocationFromStorage();

    // Find all rows for this product name (exact normalized match)
    const productKey = normText(selected.product_name);
    const options = rows.filter(r => r.product_key === productKey);

    // Enrich with distance + predicted price
    DASH_ROWS_ALL = options.map(o => {
      const dist = (DASH_USER_LOC && o.latitude != null && o.longitude != null)
        ? haversineKm(DASH_USER_LOC, { lat: o.latitude, lng: o.longitude })
        : null;

      const pred = model ? mlrPredict(o, model) : null;

      return {
        ...o,
        distance_km: dist,
        predicted_price: (pred != null && isFinite(pred)) ? pred : null
      };
    });

    // Build store filter
    if (filterStore) {
      const stores = Array.from(new Set(DASH_ROWS_ALL.map(r => r.store).filter(Boolean))).sort();
      filterStore.innerHTML = "";
      for (const s of stores) {
        const opt = document.createElement("option");
        opt.value = s;
        opt.textContent = s;
        opt.selected = true;
        filterStore.appendChild(opt);
      }
    }

    // Default distance text
    if (filterDistance && filterDistanceValue) {
      filterDistanceValue.textContent = String(filterDistance.value || "30");
    }

    function applyFiltersAndRender() {
      const maxKm = filterDistance ? Number(filterDistance.value) : 999999;
      if (filterDistanceValue) filterDistanceValue.textContent = String(maxKm);

      let allowedStores = null;
      if (filterStore) {
        const selectedOptions = Array.from(filterStore.selectedOptions || []).map(o => o.value);
        allowedStores = new Set(selectedOptions);
      }

      DASH_ROWS_VIEW = DASH_ROWS_ALL.filter(r => {
        const okDistance = (r.distance_km == null) ? true : (r.distance_km <= maxKm);
        const okStore = (!allowedStores) ? true : allowedStores.has(r.store);
        return okDistance && okStore;
      });

      renderDashboardTable(tbody, DASH_ROWS_VIEW);
      renderDashboardRecommendation(recEl, mapEl, mapStatus, DASH_ROWS_VIEW);
      renderDashboardChart(chartCanvas, DASH_ROWS_VIEW);
    }

    if (filterDistance) filterDistance.addEventListener("input", applyFiltersAndRender);
    if (filterStore) filterStore.addEventListener("change", applyFiltersAndRender);

    applyFiltersAndRender();
  }

  // -----------------------------
  // Dashboard: recommendation + map
  // -----------------------------
  function renderDashboardRecommendation(recEl, mapEl, mapStatus, rowsView) {
    if (!recEl) return;

    if (!rowsView || rowsView.length === 0) {
      recEl.className = "alert alert-warning mb-4";
      recEl.textContent = "No store results match your filters. Expand distance or select more stores.";
      if (mapEl) renderIframeMap(mapEl, DASH_USER_LOC || { lat: 3.139, lng: 101.6869 }, 13);
      if (mapStatus) mapStatus.textContent = "Showing default location.";
      return;
    }

    // Recommendation order:
    // 1) predicted asc (if available)
    // 2) actual asc
    // 3) distance asc
    // 4) availability desc
    const sorted = [...rowsView].sort((a, b) => {
      const ap = a.predicted_price ?? 999999;
      const bp = b.predicted_price ?? 999999;
      if (ap !== bp) return ap - bp;

      const aa = a.price ?? 999999;
      const ba = b.price ?? 999999;
      if (aa !== ba) return aa - ba;

      const ad = a.distance_km ?? 999999;
      const bd = b.distance_km ?? 999999;
      if (ad !== bd) return ad - bd;

      const aAv = availabilityScore(a.availability, a.availability_flag);
      const bAv = availabilityScore(b.availability, b.availability_flag);
      return bAv - aAv;
    });

    const best = sorted[0];

    const distTxt = (best.distance_km != null) ? `${best.distance_km.toFixed(2)} km` : "distance unknown";
    const actualTxt = (best.price != null) ? `RM ${fmtPrice(best.price)}` : "RM -";
    const predTxt = (best.predicted_price != null) ? `RM ${fmtPrice(best.predicted_price)}` : "N/A";
    const availTxt = availabilityScore(best.availability, best.availability_flag) ? "Available" : "Not available";

    recEl.className = "alert alert-success mb-4";
    recEl.innerHTML = `
      <div class="fw-bold mb-1">Recommended Store: ${escapeHtml(best.store || "-")}</div>
      <div class="small">
        ${escapeHtml(availTxt)} · Actual: <b>${escapeHtml(actualTxt)}</b> · Predicted: <b>${escapeHtml(predTxt)}</b> · ${escapeHtml(distTxt)}
      </div>
    `;

    if (mapEl) {
      let center = DASH_USER_LOC || { lat: 3.139, lng: 101.6869 };
      if (best.latitude != null && best.longitude != null) {
        center = { lat: best.latitude, lng: best.longitude };
        if (mapStatus) mapStatus.textContent = "Map centered on recommended store.";
      } else {
        if (mapStatus) mapStatus.textContent = "Store coordinates missing. Centering on your location.";
      }
      renderIframeMap(mapEl, center, 15);
    }
  }

  // -----------------------------
  // Dashboard: table
  // -----------------------------
  function renderDashboardTable(tbody, rowsView) {
    if (!tbody) return;

    tbody.innerHTML = "";

    if (!rowsView || rowsView.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="text-muted text-center">No matching store options.</td></tr>`;
      return;
    }

    // Sort by distance then actual price
    const ordered = [...rowsView].sort((a, b) => {
      const ad = a.distance_km ?? 999999;
      const bd = b.distance_km ?? 999999;
      if (ad !== bd) return ad - bd;

      const ap = a.price ?? 999999;
      const bp = b.price ?? 999999;
      return ap - bp;
    });

    const frag = document.createDocumentFragment();

    for (const s of ordered.slice(0, 80)) {
      const km = (s.distance_km != null) ? s.distance_km.toFixed(2) : "-";
      const actual = (s.price != null) ? fmtPrice(s.price) : "-";
      const pred = (s.predicted_price != null) ? fmtPrice(s.predicted_price) : "-";

      const link = (s.latitude != null && s.longitude != null)
        ? `https://www.google.com/maps?q=${encodeURIComponent(s.latitude + "," + s.longitude)}`
        : null;

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${escapeHtml(s.store)}</td>
        <td class="text-end">RM ${escapeHtml(actual)}</td>
        <td class="text-end">${pred === "-" ? "-" : "RM " + escapeHtml(pred)}</td>
        <td class="text-end">${escapeHtml(km)}</td>
        <td>${link ? `<a href="${link}" target="_blank" rel="noopener">Open</a>` : "-"}</td>
      `;
      frag.appendChild(tr);
    }

    tbody.appendChild(frag);
  }

  // -----------------------------
  // Dashboard: Chart.js
  // -----------------------------
  function renderDashboardChart(canvas, rowsView) {
    if (!canvas) return;

    if (typeof Chart === "undefined") {
      warn("Chart.js not found. Add Chart.js CDN in dashboard.html.");
      return;
    }

    const labels = (rowsView || []).map(r => r.store || "Store");
    const actual = (rowsView || []).map(r => (r.price != null ? Number(r.price) : null));
    const predicted = (rowsView || []).map(r => (r.predicted_price != null ? Number(r.predicted_price) : null));

    if (dashChart) {
      dashChart.destroy();
      dashChart = null;
    }

    dashChart = new Chart(canvas, {
      data: {
        labels,
        datasets: [
          { type: "bar", label: "Actual (RM)", data: actual },
          { type: "line", label: "Predicted (RM)", data: predicted, tension: 0.2, pointRadius: 4 }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: true } },
        scales: { y: { beginAtZero: true } }
      }
    });
  }

  // -----------------------------
  // Boot
  // -----------------------------
  document.addEventListener("DOMContentLoaded", () => {
    log("custom.js loaded on:", window.location.pathname);

    // Index
    initGeolocationMap();
    initSearchOnMap();
    initSmartPicks();

    // Dashboard
    initDashboard();
  });
})();
  