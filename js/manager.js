/* ==========================================================================
   MANAGER.JS — inventory / manager screen logic
   ========================================================================== */

let mgrUser = null;
let allProducts = [];
let allCategories = [];
let allAdjustments = [];
let allBanks = [];
let editingProductId = null;
let editingBankId = null;
let adjustingProduct = null;
let productModalUnitType = "single";
let adjustType = "add";

(async function init() {
  mgrUser = await requireAuth(["manager"]);
  wireTabs();
  wireProductModal();
  wireAdjustModal();
  wireCategoryModal();
  wireBankModal();
  wireSettings();
  listenToCategories();
  listenToProducts();
  listenToAdjustments();
  listenToBanks();
})();

/* ----- Tabs ------------------------------------------------------------------- */
function wireTabs() {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      document.querySelectorAll(".tab-panel").forEach((p) => p.classList.add("hidden"));
      document.getElementById(`panel-${btn.dataset.tab}`).classList.remove("hidden");
    });
  });
}

/* ----- Categories --------------------------------------------------------------- */
function listenToCategories() {
  db.collection("categories").orderBy("name").onSnapshot((snap) => {
    allCategories = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderCategorySelect();
    renderCategoryList();
    renderHistoryProductFilter();
  });
}

function renderCategorySelect() {
  const select = document.getElementById("prodCategorySelect");
  const currentVal = select.value;
  select.innerHTML = allCategories.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("") + `<option value="__new__">+ New category</option>`;
  if ([...select.options].some((o) => o.value === currentVal)) select.value = currentVal;
}

function renderCategoryList() {
  const wrap = document.getElementById("categoryList");
  if (allCategories.length === 0) { wrap.innerHTML = `<div class="empty-state"><h3>No categories yet</h3><p>Add one to start organizing products.</p></div>`; return; }
  wrap.innerHTML = allCategories.map((cat) => {
    const count = allProducts.filter((p) => p.categoryId === cat.id && p.active).length;
    return `<div class="category-item"><span>${escapeHtml(cat.name)}</span><span class="category-item-count">${count} product${count === 1 ? "" : "s"}</span></div>`;
  }).join("");
}

function wireCategoryModal() {
  document.getElementById("addCategoryBtn").addEventListener("click", () => {
    document.getElementById("newCategoryNameInput").value = "";
    document.getElementById("categoryModalOverlay").classList.remove("hidden");
  });
  document.getElementById("categoryModalClose").addEventListener("click", closeCategoryModal);
  document.getElementById("categoryCancelBtn").addEventListener("click", closeCategoryModal);
  function closeCategoryModal() { document.getElementById("categoryModalOverlay").classList.add("hidden"); }

  document.getElementById("categoryForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = document.getElementById("newCategoryNameInput").value.trim();
    if (!name) return;
    try {
      await db.collection("categories").add({ name });
      showToast("Category added.", "success");
      closeCategoryModal();
    } catch (err) { console.error(err); showToast("Couldn't add category.", "danger"); }
  });
}

/* ----- Products ------------------------------------------------------------------- */
function listenToProducts() {
  db.collection("products").onSnapshot(
    (snap) => {
      allProducts = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      renderProductsTable();
      renderCategoryList();
      renderUnitSuggestions();
      renderHistoryProductFilter();
    },
    (err) => { console.error(err); showToast("Couldn't load products.", "danger"); }
  );
}

function renderUnitSuggestions() {
  const singleUnits = new Set(), majorUnits = new Set(), minorUnits = new Set();
  allProducts.forEach((p) => {
    if (p.unitType === "single" && p.unitName) singleUnits.add(p.unitName);
    if (p.unitType === "double") { if (p.majorUnitName) majorUnits.add(p.majorUnitName); if (p.minorUnitName) minorUnits.add(p.minorUnitName); }
  });
  document.getElementById("unitSuggestions").innerHTML = [...singleUnits].map((u) => `<option value="${escapeHtml(u)}">`).join("");
  document.getElementById("majorUnitSuggestions").innerHTML = [...majorUnits].map((u) => `<option value="${escapeHtml(u)}">`).join("");
  document.getElementById("minorUnitSuggestions").innerHTML = [...minorUnits].map((u) => `<option value="${escapeHtml(u)}">`).join("");
}

function renderProductsTable() {
  const tbody = document.getElementById("productsTableBody");
  const emptyEl = document.getElementById("productsEmpty");
  const search = document.getElementById("productSearchInput").value.trim().toLowerCase();
  let list = allProducts.filter((p) => p.active);
  if (search) list = list.filter((p) => p.name.toLowerCase().includes(search));

  if (list.length === 0) { tbody.innerHTML = ""; emptyEl.classList.remove("hidden"); return; }
  emptyEl.classList.add("hidden");

  tbody.innerHTML = list.map((p) => {
    const category = allCategories.find((c) => c.id === p.categoryId);
    const unitLabel = p.unitType === "single" ? p.unitName : `${p.majorUnitName} / ${p.minorUnitName}`;
    const priceLabel = p.unitType === "single" ? `${formatKsh(p.price)}/${p.unitName}` : `${formatKsh(p.pricePerMajor)}/${p.majorUnitName} · ${formatKsh(p.pricePerMinor)}/${p.minorUnitName}`;
    const stockLabel = p.unitType === "single" ? `${roundKsh(p.stockMinorUnits)} ${p.unitName}` : formatDoubleUnitStock(p.stockMinorUnits, p);
    const isLow = p.stockMinorUnits <= (p.lowStockThreshold || 0);
    const isOut = p.stockMinorUnits <= 0;
    return `
      <tr>
        <td>${escapeHtml(p.name)}</td>
        <td>${escapeHtml(category ? category.name : "—")}</td>
        <td>${escapeHtml(unitLabel)}</td>
        <td>${priceLabel}</td>
        <td class="stock-cell ${isOut ? "out" : isLow ? "low" : ""}">${stockLabel}</td>
        <td>${roundKsh(p.lowStockThreshold || 0)}</td>
        <td class="row-actions"><button class="btn btn-outline btn-sm" data-adjust="${p.id}">Adjust stock</button><button class="btn btn-ghost btn-sm" data-edit="${p.id}">Edit</button></td>
      </tr>`;
  }).join("");
}

document.getElementById("productSearchInput").addEventListener("input", debounce(renderProductsTable, 150));
document.getElementById("productsTableBody").addEventListener("click", (e) => {
  const editId = e.target.dataset.edit;
  const adjustId = e.target.dataset.adjust;
  if (editId) openProductModal(allProducts.find((p) => p.id === editId));
  if (adjustId) openAdjustModal(allProducts.find((p) => p.id === adjustId));
});

/* ----- Add/edit product modal ---------------------------------------------------- */
function wireProductModal() {
  document.getElementById("addProductBtn").addEventListener("click", () => openProductModal(null));
  document.getElementById("productModalClose").addEventListener("click", closeProductModal);
  document.getElementById("productCancelBtn").addEventListener("click", closeProductModal);

  document.querySelectorAll(".unit-type-toggle [data-unit-type]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".unit-type-toggle [data-unit-type]").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      productModalUnitType = btn.dataset.unitType;
      document.getElementById("singleUnitFields").classList.toggle("hidden", productModalUnitType !== "single");
      document.getElementById("doubleUnitFields").classList.toggle("hidden", productModalUnitType !== "double");
    });
  });

  document.getElementById("prodCategorySelect").addEventListener("change", (e) => {
    document.getElementById("prodNewCategoryInput").classList.toggle("hidden", e.target.value !== "__new__");
  });

  const pricePerMajorInput = document.getElementById("pricePerMajorInput");
  const minorPerMajorInput = document.getElementById("minorPerMajorInput");
  const pricePerMinorInput = document.getElementById("pricePerMinorInput");
  const totalMinorStockInput = document.getElementById("totalMinorStockInput");
  function refreshPriceCompareHint() {
    const minorPerMajor = parseFloat(minorPerMajorInput.value) || 0;
    const pricePerMinor = parseFloat(pricePerMinorInput.value) || 0;
    const pricePerMajor = parseFloat(pricePerMajorInput.value) || 0;
    const hintEl = document.getElementById("priceCompareHint");
    if (minorPerMajor && pricePerMinor && pricePerMajor) {
      const equivalent = pricePerMinor * minorPerMajor;
      const diff = equivalent - pricePerMajor;
      if (diff > 0) hintEl.textContent = `Buying by the minor unit would cost ${formatKsh(equivalent)} for that amount — the major-unit price is ${formatKsh(diff)} less.`;
      else if (diff < 0) hintEl.textContent = `Buying by the minor unit would cost ${formatKsh(equivalent)} for that amount — the major-unit price is ${formatKsh(-diff)} more.`;
      else hintEl.textContent = `Same total either way — ${formatKsh(equivalent)}.`;
    } else { hintEl.textContent = ""; }
  }
  [pricePerMajorInput, minorPerMajorInput, pricePerMinorInput].forEach((el) => el.addEventListener("input", refreshPriceCompareHint));
  [minorPerMajorInput, totalMinorStockInput].forEach((el) => el.addEventListener("input", () => {
    const minorPerMajor = parseFloat(minorPerMajorInput.value) || 0;
    const totalMinor = parseFloat(totalMinorStockInput.value) || 0;
    const majorQty = minorPerMajor ? (totalMinor / minorPerMajor).toFixed(2) : 0;
    document.getElementById("majorStockHint").textContent = `≈ ${majorQty} major units`;
  }));

  document.getElementById("archiveProductBtn").addEventListener("click", async () => {
    if (!editingProductId) return;
    if (!confirm("Archive this product? It will disappear from POS but stay in past sales records.")) return;
    try {
      await db.collection("products").doc(editingProductId).update({ active: false });
      showToast("Product archived.", "success");
      closeProductModal();
    } catch (err) { console.error(err); showToast("Couldn't archive product.", "danger"); }
  });

  document.getElementById("productForm").addEventListener("submit", saveProduct);
}

function openProductModal(product) {
  editingProductId = product ? product.id : null;
  document.getElementById("productModalTitle").textContent = product ? "Edit product" : "Add product";
  document.getElementById("archiveProductBtn").classList.toggle("hidden", !product);
  document.getElementById("prodNameInput").value = product?.name || "";
  document.getElementById("lowStockInput").value = product?.lowStockThreshold ?? 0;

  renderCategorySelect();
  document.getElementById("prodNewCategoryInput").classList.add("hidden");
  document.getElementById("prodNewCategoryInput").value = "";
  if (product?.categoryId) document.getElementById("prodCategorySelect").value = product.categoryId;

  const unitType = product?.unitType || "single";
  productModalUnitType = unitType;
  document.querySelectorAll(".unit-type-toggle [data-unit-type]").forEach((b) => b.classList.toggle("active", b.dataset.unitType === unitType));
  document.getElementById("singleUnitFields").classList.toggle("hidden", unitType !== "single");
  document.getElementById("doubleUnitFields").classList.toggle("hidden", unitType !== "double");

  document.getElementById("singleUnitNameInput").value = product?.unitName || "";
  document.getElementById("singlePriceInput").value = product?.price ?? "";
  document.getElementById("singleStockInput").value = product?.stockMinorUnits ?? "";

  document.getElementById("majorUnitNameInput").value = product?.majorUnitName || "";
  document.getElementById("minorUnitNameInput").value = product?.minorUnitName || "";
  document.getElementById("minorPerMajorInput").value = product?.minorPerMajor ?? "";
  document.getElementById("pricePerMajorInput").value = product?.pricePerMajor ?? "";
  document.getElementById("pricePerMinorInput").value = product?.pricePerMinor ?? "";
  document.getElementById("totalMinorStockInput").value = product?.stockMinorUnits ?? "";
  document.getElementById("majorStockHint").textContent = product?.minorPerMajor ? `≈ ${(product.stockMinorUnits / product.minorPerMajor).toFixed(2)} major units` : "≈ 0 major units";
  document.getElementById("priceCompareHint").textContent = "";
  if (product?.minorPerMajor && product?.pricePerMinor && product?.pricePerMajor) {
    const equivalent = product.pricePerMinor * product.minorPerMajor;
    const diff = equivalent - product.pricePerMajor;
    document.getElementById("priceCompareHint").textContent = diff > 0
      ? `Buying by the minor unit would cost ${formatKsh(equivalent)} for that amount — the major-unit price is ${formatKsh(diff)} less.`
      : diff < 0
      ? `Buying by the minor unit would cost ${formatKsh(equivalent)} for that amount — the major-unit price is ${formatKsh(-diff)} more.`
      : `Same total either way — ${formatKsh(equivalent)}.`;
  }

  document.getElementById("productModalOverlay").classList.remove("hidden");
}

function closeProductModal() { document.getElementById("productModalOverlay").classList.add("hidden"); editingProductId = null; }

async function saveProduct(e) {
  e.preventDefault();
  const name = document.getElementById("prodNameInput").value.trim();
  if (!name) return;
  let categoryId = document.getElementById("prodCategorySelect").value;
  let categoryName = "";

  try {
    if (categoryId === "__new__") {
      const newName = document.getElementById("prodNewCategoryInput").value.trim();
      if (!newName) { showToast("Enter a name for the new category.", "warning"); return; }
      const ref = await db.collection("categories").add({ name: newName });
      categoryId = ref.id; categoryName = newName;
    } else {
      categoryName = allCategories.find((c) => c.id === categoryId)?.name || "";
    }

    const lowStockThreshold = parseFloat(document.getElementById("lowStockInput").value) || 0;
    let payload = { name, categoryId, categoryName, lowStockThreshold, active: true, updatedAt: firebase.firestore.FieldValue.serverTimestamp() };

    if (productModalUnitType === "single") {
      const unitName = document.getElementById("singleUnitNameInput").value.trim();
      const price = parseFloat(document.getElementById("singlePriceInput").value) || 0;
      const stock = parseFloat(document.getElementById("singleStockInput").value) || 0;
      if (!unitName) { showToast("Enter a unit name.", "warning"); return; }
      payload = { ...payload, unitType: "single", unitName, price, stockMinorUnits: stock, majorUnitName: null, minorUnitName: null, minorPerMajor: null, pricePerMinor: null, pricePerMajor: null };
    } else {
      const majorUnitName = document.getElementById("majorUnitNameInput").value.trim();
      const minorUnitName = document.getElementById("minorUnitNameInput").value.trim();
      const minorPerMajor = parseFloat(document.getElementById("minorPerMajorInput").value) || 0;
      const pricePerMajor = parseFloat(document.getElementById("pricePerMajorInput").value) || 0;
      const pricePerMinor = parseFloat(document.getElementById("pricePerMinorInput").value) || 0;
      const stockMinorUnits = parseFloat(document.getElementById("totalMinorStockInput").value) || 0;
      if (!majorUnitName || !minorUnitName || !minorPerMajor) { showToast("Fill in major unit, minor unit, and the conversion amount.", "warning"); return; }
      if (!pricePerMajor || !pricePerMinor) { showToast("Enter both the major-unit price and the minor-unit price.", "warning"); return; }
      payload = { ...payload, unitType: "double", majorUnitName, minorUnitName, minorPerMajor, pricePerMajor, pricePerMinor, stockMinorUnits, unitName: null, price: null };
    }

    if (editingProductId) {
      await db.collection("products").doc(editingProductId).update(payload);
      showToast("Product updated.", "success");
    } else {
      payload.createdAt = firebase.firestore.FieldValue.serverTimestamp();
      await db.collection("products").add(payload);
      showToast("Product added.", "success");
    }
    closeProductModal();
  } catch (err) { console.error(err); showToast("Couldn't save product. Please try again.", "danger"); }
}

/* ----- Stock adjustment modal -------------------------------------------------------- */
function wireAdjustModal() {
  document.getElementById("adjustModalClose").addEventListener("click", closeAdjustModal);
  document.getElementById("adjustCancelBtn").addEventListener("click", closeAdjustModal);
  document.querySelectorAll(".unit-type-toggle [data-adjust-type]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".unit-type-toggle [data-adjust-type]").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      adjustType = btn.dataset.adjustType;
    });
  });
  document.getElementById("adjustForm").addEventListener("submit", saveAdjustment);
}

function openAdjustModal(product) {
  adjustingProduct = product;
  adjustType = "add";
  document.querySelectorAll(".unit-type-toggle [data-adjust-type]").forEach((b) => b.classList.toggle("active", b.dataset.adjustType === "add"));
  document.getElementById("adjustModalTitle").textContent = `Adjust stock — ${product.name}`;
  const unitLabel = product.unitType === "single" ? product.unitName : product.minorUnitName;
  document.getElementById("adjustCurrentStock").textContent = `Current stock: ${product.unitType === "single" ? roundKsh(product.stockMinorUnits) + " " + unitLabel : formatDoubleUnitStock(product.stockMinorUnits, product)}`;
  document.getElementById("adjustQtyInput").value = "";
  document.getElementById("adjustQtyInput").placeholder = `Amount in ${unitLabel}`;
  document.getElementById("adjustReasonSelect").value = "Recount";
  document.getElementById("adjustReasonInput").value = "";
  document.getElementById("adjustModalOverlay").classList.remove("hidden");
}
function closeAdjustModal() { document.getElementById("adjustModalOverlay").classList.add("hidden"); adjustingProduct = null; }

async function saveAdjustment(e) {
  e.preventDefault();
  const product = adjustingProduct;
  const qty = parseFloat(document.getElementById("adjustQtyInput").value);
  const reasonCategory = document.getElementById("adjustReasonSelect").value;
  const reasonDetail = document.getElementById("adjustReasonInput").value.trim();
  if (!qty || qty <= 0) { showToast("Enter a quantity greater than zero.", "warning"); return; }
  if (!reasonDetail) { showToast("Please add a reason for this adjustment.", "warning"); return; }

  const delta = adjustType === "add" ? qty : -qty;
  const reason = `${reasonCategory}: ${reasonDetail}`;

  try {
    const productRef = db.collection("products").doc(product.id);
    await db.runTransaction(async (t) => {
      const doc = await t.get(productRef);
      if (!doc.exists) throw new Error("Product no longer exists.");
      const current = doc.data().stockMinorUnits;
      const newStock = current + delta;
      if (newStock < 0) throw new Error("This would take stock below zero.");
      t.update(productRef, { stockMinorUnits: newStock });
      t.set(db.collection("stockAdjustments").doc(), {
        productId: product.id, productName: product.name, unitLabel: product.unitType === "single" ? product.unitName : product.minorUnitName,
        delta, newStock, reason, adjustedBy: mgrUser.uid, adjustedByName: mgrUser.displayName, createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
    });
    showToast("Stock adjustment saved.", "success");
    closeAdjustModal();
  } catch (err) { console.error(err); showToast(err.message || "Couldn't save adjustment.", "danger"); }
}

/* ----- Stock history tab -------------------------------------------------------------- */
function listenToAdjustments() {
  db.collection("stockAdjustments").orderBy("createdAt", "desc").limit(500).onSnapshot(
    (snap) => { allAdjustments = snap.docs.map((d) => ({ id: d.id, ...d.data() })); renderHistoryTable(); },
    (err) => console.error(err)
  );
}

function renderHistoryProductFilter() {
  const select = document.getElementById("historyProductFilter");
  const current = select.value;
  select.innerHTML = `<option value="all">All products</option>` + allProducts.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("");
  if ([...select.options].some((o) => o.value === current)) select.value = current;
}

function renderHistoryTable() {
  const tbody = document.getElementById("historyTableBody");
  const emptyEl = document.getElementById("historyEmpty");
  const productFilter = document.getElementById("historyProductFilter").value;
  const fromDate = document.getElementById("historyFromDate").value;
  const toDate = document.getElementById("historyToDate").value;

  let list = allAdjustments;
  if (productFilter !== "all") list = list.filter((a) => a.productId === productFilter);
  if (fromDate) list = list.filter((a) => a.createdAt && a.createdAt.toDate() >= startOfDay(fromDate));
  if (toDate) list = list.filter((a) => a.createdAt && a.createdAt.toDate() <= endOfDay(toDate));

  if (list.length === 0) { tbody.innerHTML = ""; emptyEl.classList.remove("hidden"); return; }
  emptyEl.classList.add("hidden");

  tbody.innerHTML = list.map((a) => {
    const dateStr = a.createdAt ? formatDateTime(a.createdAt.toDate()) : "Just now";
    const changeClass = a.delta >= 0 ? "change-positive" : "change-negative";
    const changeStr = `${a.delta >= 0 ? "+" : ""}${roundKsh(a.delta)} ${a.unitLabel || ""}`;
    return `<tr><td>${dateStr}</td><td>${escapeHtml(a.productName)}</td><td class="${changeClass}">${changeStr}</td><td>${roundKsh(a.newStock)} ${escapeHtml(a.unitLabel || "")}</td><td>${escapeHtml(a.reason)}</td><td>${escapeHtml(a.adjustedByName)}</td></tr>`;
  }).join("");
}

document.getElementById("historyProductFilter").addEventListener("change", renderHistoryTable);
document.getElementById("historyFromDate").addEventListener("change", renderHistoryTable);
document.getElementById("historyToDate").addEventListener("change", renderHistoryTable);

/* ----- Banks tab (deposit/withdrawal channels) ------------------------------------------- */
function listenToBanks() {
  db.collection("banks").orderBy("name").onSnapshot(
    (snap) => { allBanks = snap.docs.map((d) => ({ id: d.id, ...d.data() })); renderBankList(); },
    (err) => console.error(err)
  );
}

function renderBankList() {
  const wrap = document.getElementById("bankList");
  if (!wrap) return;
  if (allBanks.length === 0) { wrap.innerHTML = `<div class="empty-state"><h3>No banks yet</h3><p>Add M-Pesa, a bank, or any channel you take deposits/withdrawals for.</p></div>`; return; }
  wrap.innerHTML = allBanks.map((b) => `
      <div class="category-item">
        <span>${escapeHtml(b.name)} <span class="hint">(${escapeHtml(b.code)})</span></span>
        <button class="btn btn-ghost btn-sm" data-edit-bank="${b.id}">Edit</button>
      </div>`).join("");
}

document.getElementById("bankList")?.addEventListener("click", (e) => {
  const id = e.target.dataset.editBank;
  if (id) openBankModal(allBanks.find((b) => b.id === id));
});

function wireBankModal() {
  document.getElementById("addBankBtn").addEventListener("click", () => openBankModal(null));
  document.getElementById("bankModalClose").addEventListener("click", closeBankModal);
  document.getElementById("bankCancelBtn").addEventListener("click", closeBankModal);
  document.getElementById("bankCodeInput").addEventListener("input", (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3); });

  document.getElementById("deleteBankBtn").addEventListener("click", async () => {
    if (!editingBankId) return;
    if (!confirm("Delete this bank? Past transactions will keep showing its name, but it won't be selectable for new ones.")) return;
    try {
      await db.collection("banks").doc(editingBankId).delete();
      showToast("Bank deleted.", "success");
      closeBankModal();
    } catch (err) { console.error(err); showToast("Couldn't delete bank.", "danger"); }
  });

  document.getElementById("bankForm").addEventListener("submit", saveBank);
}

function openBankModal(bank) {
  editingBankId = bank ? bank.id : null;
  document.getElementById("bankModalTitle").textContent = bank ? "Edit bank" : "Add bank";
  document.getElementById("bankNameInput").value = bank?.name || "";
  document.getElementById("bankCodeInput").value = bank?.code || "";
  document.getElementById("deleteBankBtn").classList.toggle("hidden", !bank);
  document.getElementById("bankModalOverlay").classList.remove("hidden");
}
function closeBankModal() { document.getElementById("bankModalOverlay").classList.add("hidden"); editingBankId = null; }

async function saveBank(e) {
  e.preventDefault();
  const name = document.getElementById("bankNameInput").value.trim();
  const code = document.getElementById("bankCodeInput").value.trim().toUpperCase();
  if (!name || code.length !== 3) { showToast("Enter a name and a 3-letter code.", "warning"); return; }

  const duplicate = allBanks.find((b) => b.code === code && b.id !== editingBankId);
  if (duplicate) { showToast(`Code ${code} is already used by ${duplicate.name}. Choose a different one.`, "warning"); return; }

  try {
    if (editingBankId) {
      await db.collection("banks").doc(editingBankId).update({ name, code });
      showToast("Bank updated.", "success");
    } else {
      await db.collection("banks").add({ name, code, seqCounter: 0 });
      showToast("Bank added.", "success");
    }
    closeBankModal();
  } catch (err) { console.error(err); showToast("Couldn't save bank.", "danger"); }
}

/* ----- Settings tab --------------------------------------------------------------------- */
function wireSettings() {
  document.getElementById("sellerEmailDisplay").textContent = FIXED_EMAILS.seller;
  document.getElementById("managerEmailDisplay").textContent = FIXED_EMAILS.manager;

  db.collection("businessConfig").doc("main").get().then((doc) => {
    if (doc.exists) {
      const data = doc.data();
      document.getElementById("companyNameInput").value = data.companyName || "Misty Code";
      document.getElementById("companyAddressInput").value = data.address || "";
      document.getElementById("companyPhoneInput").value = data.phone || "";
      document.getElementById("floatCashThresholdInput").value = data.floatCashLowThreshold ?? 3000;
    }
  });

  document.getElementById("saveBusinessBtn").addEventListener("click", async () => {
    const companyName = document.getElementById("companyNameInput").value.trim() || "Misty Code";
    const address = document.getElementById("companyAddressInput").value.trim();
    const phone = document.getElementById("companyPhoneInput").value.trim();
    const floatCashLowThreshold = parseFloat(document.getElementById("floatCashThresholdInput").value) || 0;
    try {
      await db.collection("businessConfig").doc("main").set({ companyName, address, phone, floatCashLowThreshold, currency: "KSh" }, { merge: true });
      applyLogo(companyName);
      showToast("Business details saved.", "success");
    } catch (err) { console.error(err); showToast("Couldn't save business details.", "danger"); }
  });

  const lightBtn = document.getElementById("lightModeBtn");
  const darkBtn = document.getElementById("darkModeBtn");
  function refreshThemeButtons() {
    const isDark = document.documentElement.getAttribute("data-theme") === "dark";
    lightBtn.classList.toggle("active-theme", !isDark);
    darkBtn.classList.toggle("active-theme", isDark);
  }
  refreshThemeButtons();
  lightBtn.addEventListener("click", () => { document.documentElement.removeAttribute("data-theme"); localStorage.setItem("mc_theme", "light"); refreshThemeButtons(); });
  darkBtn.addEventListener("click", () => { document.documentElement.setAttribute("data-theme", "dark"); localStorage.setItem("mc_theme", "dark"); refreshThemeButtons(); });

  const paletteButtons = document.querySelectorAll(".palette-swatch");
  function refreshPaletteButtons() {
    const current = localStorage.getItem("mc_palette") || "ocean";
    paletteButtons.forEach((btn) => btn.classList.toggle("active", btn.dataset.palette === current));
  }
  refreshPaletteButtons();
  paletteButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const palette = btn.dataset.palette;
      document.documentElement.setAttribute("data-palette", palette);
      localStorage.setItem("mc_palette", palette);
      refreshPaletteButtons();
    });
  });

  const bgButtons = document.querySelectorAll(".bg-option");
  function refreshBgButtons() {
    const current = localStorage.getItem("mc_background") || "default";
    bgButtons.forEach((b) => b.classList.toggle("active", b.dataset.bgMode === current));
  }
  refreshBgButtons();
  bgButtons.forEach((btn) => { btn.addEventListener("click", () => { setBackground(btn.dataset.bgMode); refreshBgButtons(); }); });

  document.getElementById("resetSellerBtn").addEventListener("click", () => sendReset(FIXED_EMAILS.seller));
  document.getElementById("resetManagerBtn").addEventListener("click", () => sendReset(FIXED_EMAILS.manager));
  async function sendReset(email) {
    try { await auth.sendPasswordResetEmail(email); showToast(`Reset link sent to ${email}.`, "success"); }
    catch (err) { console.error(err); showToast("Couldn't send reset link.", "danger"); }
  }
}
