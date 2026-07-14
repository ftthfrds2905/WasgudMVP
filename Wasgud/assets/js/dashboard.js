/* =========================
   Dashboard JS
   - Reads selected product from sessionStorage
   - Fetches /api/search results
   - Computes distance, score, recommends best store
   - Updates Map, Table, and MLR chart
   ========================= */

function haversineKm(a, b) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

function normLowerBetter(val, min, max) {
  if (max === min) return 0;
  return (val - min) / (max - min);
}

function scoreStore(row, w) {
  const availPenalty = row.availabilityFlag ? 0 : 1; // unavailable = bad
  return (w.price * row.priceNorm) + (w.distance * row.distNorm) + (w.availability * availPenalty);
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function setHtml(id, html) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = html;
}

window.userLoc = null;
window.dashMap = null;
window.dashMarkers = [];

window.initDashMap = function () {
  const mapEl = document.getElementById("dashMap");
  const statusEl = document.getElementById("dashMapStatus");
  if (!mapEl) return;

  const fallback = { lat: 3.139, lng: 101.6869 }; // KL

  window.dashMap = new google.maps.Map(mapEl, {
    center: fallback,
    zoom: 13
  });

  if (!navigator.geolocation) {
    if (statusEl) statusEl.textContent = "Geolocation not supported. Using fallback.";
    window.userLoc = fallback;
    loadDashboard();
    return;
  }

  if (statusEl) statusEl.textContent = "Getting your location...";

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      window.userLoc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      if (statusEl) statusEl.textContent = "Location detected.";
      loadDashboard();
    },
    () => {
      if (statusEl) statusEl.textContent = "Location denied. Using fallback.";
      window.userLoc = fallback;
      loadDashboard();
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
};

async function loadDashboard() {
  if (window.__dashLoaded) return;
  window.__dashLoaded = true;

  const selected = JSON.parse(sessionStorage.getItem("wasgud_selected") || "null");
  if (!selected || !selected.product_name) {
    setText("dashProductName", "No product selected. Please go back and search.");
    setText("dashRecommendationReason", "No selection found in sessionStorage.");
    return;
  }

  // Load all matches for the selected product name
  const q = selected.product_name;
  const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
  const data = await res.json();
  let rows = Array.isArray(data.results) ? data.results : [];

  // IMPORTANT: your API must return latitude & longitude
  rows = rows.map(r => ({
    ...r,
    priceNum: Number(r.price),
    latNum: Number(r.latitude),
    lngNum: Number(r.longitude),
    availabilityFlag: Number(r.availability_flag ?? r.availability ?? 1) ? 1 : 0
  })).filter(r =>
    Number.isFinite(r.priceNum) &&
    Number.isFinite(r.latNum) &&
    Number.isFinite(r.lngNum)
  );

  if (rows.length === 0) {
    setText("dashProductName", q);
    setText("dashRecommendationReason", "No results with valid coordinates/price were found.");
    return;
  }

  // Compute distance
  rows = rows.map(r => ({
    ...r,
    distanceKm: haversineKm(window.userLoc, { lat: r.latNum, lng: r.lngNum })
  }));

  // Normalize for scoring
  const minP = Math.min(...rows.map(r => r.priceNum));
  const maxP = Math.max(...rows.map(r => r.priceNum));
  const minD = Math.min(...rows.map(r => r.distanceKm));
  const maxD = Math.max(...rows.map(r => r.distanceKm));

  rows = rows.map(r => ({
    ...r,
    priceNorm: normLowerBetter(r.priceNum, minP, maxP),
    distNorm: normLowerBetter(r.distanceKm, minD, maxD)
  }));

  // Weights (tune later)
  const weights = { price: 0.5, distance: 0.35, availability: 0.15 };

  rows = rows.map(r => ({ ...r, score: scoreStore(r, weights) }))
             .sort((a, b) => a.score - b.score);

  const best = rows[0];

  // Fill product info
  const imgEl = document.getElementById("dashProductImg");
  if (imgEl) imgEl.src = best.image_url || "assets/img/product_single_10.jpg";

  setText("dashProductName", best.product_name || q);
  setText("dashBestStore", best.store || "-");
  setText("dashBestPrice", best.priceNum.toFixed(2));
  setText("dashBestDistance", best.distanceKm.toFixed(2));
  setText("dashCategory", best.category || "-");

  // Badges
  setText("dashAvailabilityBadge", best.availabilityFlag ? "Available" : "Unavailable");
  setText("dashDistanceBadge", `${best.distanceKm.toFixed(2)} km`);

  // Recommendation reason
  setHtml("dashRecommendationReason",
    `<strong>Recommendation:</strong> ${best.store} was selected because it balances
     <strong>lower price</strong>, <strong>shorter distance</strong>, and <strong>availability</strong>.`
  );

  // Store table
  const tableHtml = rows.slice(0, 10).map(r => `
    <tr ${r === best ? 'class="table-success"' : ""}>
      <td>${r.store ?? "-"}</td>
      <td class="text-end">${r.priceNum.toFixed(2)}</td>
      <td class="text-end">${r.distanceKm.toFixed(2)}</td>
      <td>${r.availabilityFlag ? "Available" : "Unavailable"}</td>
      <td class="text-end">${r.score.toFixed(3)}</td>
    </tr>
  `).join("");
  setHtml("dashStoreRows", tableHtml);

  // Update map (user + best store)
  if (window.dashMap) {
    window.dashMarkers.forEach(m => m.setMap(null));
    window.dashMarkers = [];

    const userM = new google.maps.Marker({
      position: window.userLoc,
      map: window.dashMap,
      title: "You are here"
    });

    const storePos = { lat: best.latNum, lng: best.lngNum };
    const storeM = new google.maps.Marker({
      position: storePos,
      map: window.dashMap,
      title: `Best Store: ${best.store}`
    });

    window.dashMarkers.push(userM, storeM);

    const bounds = new google.maps.LatLngBounds();
    bounds.extend(window.userLoc);
    bounds.extend(storePos);
    window.dashMap.fitBounds(bounds);
  }

  // Render MLR chart
  renderMlrChart(best.product_name || q);
}

async function renderMlrChart(productName) {
  // You will create this endpoint in server.js:
  // GET /api/mlr?product=<name>
  const res = await fetch(`/api/mlr?product=${encodeURIComponent(productName)}`);
  const payload = await res.json();

  const canvas = document.getElementById("mlrChart");
  if (!canvas) return;

  new Chart(canvas, {
    type: "line",
    data: {
      labels: payload.labels || [],
      datasets: [
        { label: "Actual", data: payload.actual || [] },
        { label: "Predicted (MLR)", data: payload.predicted || [] }
      ]
    }
  });
}
