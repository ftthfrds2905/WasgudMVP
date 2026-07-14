// assets/js/excelCrud.js
// Manual CRUD + Persistent Storage (localStorage) + Export to Excel

const STORAGE_KEY = "wasgud_client_items_db_v1";
const SHEET_NAME = "Items";

// State
let rows = loadDB();

// DOM (table)
const tableBody = document.getElementById("tableBody");
const statusLine = document.getElementById("statusLine");

// DOM (create form)
const inlineForm = document.getElementById("inlineForm");
const f_id = document.getElementById("f_id");
const f_date = document.getElementById("f_date");
const f_product = document.getElementById("f_product");
const f_store = document.getElementById("f_store");
const f_price = document.getElementById("f_price");
const f_qty = document.getElementById("f_qty");
const f_status = document.getElementById("f_status");

const btnNextId = document.getElementById("btnNextId");
const btnExport = document.getElementById("btnExport");
const btnClearAll = document.getElementById("btnClearAll");

// DOM (edit modal)
const editModal = document.getElementById("editModal");
const btnCloseModal = document.getElementById("btnCloseModal");
const btnCancelModal = document.getElementById("btnCancelModal");
const editForm = document.getElementById("editForm");

const editIndex = document.getElementById("editIndex");
const e_id = document.getElementById("e_id");
const e_date = document.getElementById("e_date");
const e_product = document.getElementById("e_product");
const e_store = document.getElementById("e_store");
const e_price = document.getElementById("e_price");
const e_qty = document.getElementById("e_qty");
const e_status = document.getElementById("e_status");

// Init defaults
initDefaults();
renderTable();
setStatus(`${rows.length} record(s) loaded from browser storage.`);

// ---------- Create ----------
inlineForm.addEventListener("submit", (e) => {
  e.preventDefault();

  const record = {
    id: Number(f_id.value),
    date: f_date.value,
    product: f_product.value.trim(),
    store: f_store.value.trim(),
    price: Number(f_price.value),
    qty: Number(f_qty.value),
    booking_status: f_status.value.trim()
  };

  const err = validate(record);
  if (err) return alert(err);

  if (rows.some(r => r.id === record.id)) {
    return alert("ID already exists. Please use a unique ID.");
  }

  rows.push(record);
  sortRows(rows);
  persist();

  renderTable();
  setStatus(`Record ID ${record.id} added. Total: ${rows.length}`);

  // Reset for fast entry
  f_product.value = "";
  f_store.value = "";
  f_price.value = "";
  f_qty.value = "";
  f_status.value = "";
  f_date.value = todayISO();
  f_id.value = String(getNextId());
});

// Next ID helper
btnNextId.addEventListener("click", () => {
  f_id.value = String(getNextId());
});

// ---------- Read ----------
function renderTable() {
  if (!rows.length) {
    tableBody.innerHTML = `<tr><td colspan="8" class="text-muted text-center">No data yet. Add your first record above.</td></tr>`;
    return;
  }

  tableBody.innerHTML = rows.map((r, i) => `
    <tr>
      <td>${r.id}</td>
      <td>${escapeHtml(r.date)}</td>
      <td>${escapeHtml(r.product)}</td>
      <td>${escapeHtml(r.store)}</td>
      <td class="text-end">${Number(r.price).toFixed(2)}</td>
      <td class="text-end">${r.qty}</td>
      <td>${escapeHtml(r.booking_status)}</td>
      <td>
        <button class="btn btn-sm btn-outline-primary me-1" data-action="edit" data-index="${i}">Edit</button>
        <button class="btn btn-sm btn-outline-danger" data-action="delete" data-index="${i}">Delete</button>
      </td>
    </tr>
  `).join("");

  tableBody.querySelectorAll("button[data-action]").forEach(btn => {
    const action = btn.getAttribute("data-action");
    const index = Number(btn.getAttribute("data-index"));
    btn.addEventListener("click", () => {
      if (action === "edit") openEdit(index);
      if (action === "delete") doDelete(index);
    });
  });
}

// ---------- Update ----------
function openEdit(index) {
  const r = rows[index];
  editIndex.value = String(index);

  e_id.value = r.id;
  e_date.value = r.date;
  e_product.value = r.product;
  e_store.value = r.store;
  e_price.value = r.price;
  e_qty.value = r.qty;
  e_status.value = r.booking_status;

  editModal.style.display = "block";
}

editForm.addEventListener("submit", (e) => {
  e.preventDefault();

  const idx = Number(editIndex.value);
  if (Number.isNaN(idx) || idx < 0 || idx >= rows.length) {
    return alert("Invalid edit state.");
  }

  const updated = {
    id: Number(e_id.value),
    date: e_date.value,
    product: e_product.value.trim(),
    store: e_store.value.trim(),
    price: Number(e_price.value),
    qty: Number(e_qty.value),
    booking_status: e_status.value.trim()
  };

  const err = validate(updated);
  if (err) return alert(err);

  // Prevent ID collision with other records
  const collision = rows.some((r, i) => i !== idx && r.id === updated.id);
  if (collision) return alert("Another record already uses this ID.");

  const oldId = rows[idx].id;
  rows[idx] = updated;

  sortRows(rows);
  persist();
  renderTable();
  closeEdit();

  setStatus(`Record updated (ID ${oldId} → ${updated.id}). Total: ${rows.length}`);
});

// Close modal
btnCloseModal.addEventListener("click", closeEdit);
btnCancelModal.addEventListener("click", closeEdit);

function closeEdit() {
  editModal.style.display = "none";
}

// ---------- Delete ----------
function doDelete(index) {
  const r = rows[index];
  if (!confirm(`Delete record ID ${r.id} (${r.product})?`)) return;

  rows.splice(index, 1);
  persist();
  renderTable();
  setStatus(`Record ID ${r.id} deleted. Total: ${rows.length}`);
}

// ---------- Persist ----------
function persist() {
  // ensure clean numeric types
  rows = rows.map(r => ({
    id: Number(r.id),
    date: String(r.date),
    product: String(r.product || ""),
    store: String(r.store || ""),
    price: Number(r.price),
    qty: Number(r.qty),
    booking_status: String(r.booking_status || "")
  }));
  localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
}

function loadDB() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // light normalization
    return parsed.map(r => ({
      id: Number(r.id),
      date: String(r.date || todayISO()),
      product: String(r.product || ""),
      store: String(r.store || ""),
      price: Number(r.price || 0),
      qty: Number(r.qty || 0),
      booking_status: String(r.booking_status || "")
    })).filter(r => r.id && r.product && r.store);
  } catch {
    return [];
  }
}

// ---------- Clear All ----------
btnClearAll.addEventListener("click", () => {
  if (!confirm("Clear all records? This will erase the stored data in this browser.")) return;
  rows = [];
  persist();
  renderTable();
  initDefaults();
  setStatus("All records cleared.");
});

// ---------- Export to Excel ----------
btnExport.addEventListener("click", () => {
  // require XLSX library loaded from CDN
  if (typeof XLSX === "undefined") {
    return alert("Excel export library not found. Check your internet connection (CDN).");
  }

  const exportRows = rows.map(r => ({
    id: r.id,
    date: r.date,
    product: r.product,
    store: r.store,
    price: r.price,
    qty: r.qty,
    booking_status: r.booking_status
  }));

  const ws = XLSX.utils.json_to_sheet(exportRows, {
    header: ["id", "date", "product", "store", "price", "qty", "booking_status"]
  });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, SHEET_NAME);

  XLSX.writeFile(wb, "wasgud_client_items.xlsx");
  setStatus("Excel exported: wasgud_client_items.xlsx");
});

// ---------- Validation + Utilities ----------
function validate(r) {
  if (!r.id || r.id < 1) return "ID must be a positive number.";
  if (!r.date) return "Date is required.";
  if (!r.product) return "Product is required.";
  if (!r.store) return "Store is required.";
  if (Number.isNaN(r.price) || r.price < 0) return "Price must be >= 0.";
  if (!r.qty || r.qty < 1) return "Qty must be >= 1.";
  if (!r.booking_status) return "Booking status is required.";
  return "";
}

function sortRows(arr) {
  // newest date first, then id desc
  arr.sort((a, b) => (String(b.date).localeCompare(String(a.date)) || Number(b.id) - Number(a.id)));
}

function getNextId() {
  if (!rows.length) return 1;
  return Math.max(...rows.map(r => Number(r.id) || 0)) + 1;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function initDefaults() {
  f_date.value = todayISO();
  f_id.value = String(getNextId());
}

function setStatus(msg) {
  statusLine.textContent = msg;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (m) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[m]));
}
