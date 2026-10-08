/* ==========================================================================
   POS.JS — selling screen logic
   ========================================================================== */

let currentUser = null;
let allProducts = [];
let allCategories = [];
let allBanksForPayment = [];
let allCustomersForPayment = [];
let activeCategory = "all";
let searchTerm = "";
let basket = [];
let paymentLines = [];
let businessInfo = { companyName: "Misty Code", address: "", phone: "" };

let modalProduct = null;
let modalUnitMode = null;
let modalQty = 0;

(async function init() {
  currentUser = await requireAuth(["seller", "manager"]);
  loadBusinessInfo();
  listenToCategories();
  listenToProducts();
  listenToBanksForPayment();
  listenToCustomersForPayment();
  wireStaticUI();
  wirePaymentBuilder();
  setInterval(checkOfflineLockout, 15000);
  checkOfflineLockout();
})();

function loadBusinessInfo() {
  db.collection("businessConfig").doc("main").onSnapshot((doc) => {
    if (doc.exists) businessInfo = { ...businessInfo, ...doc.data() };
  });
}

/* ----- Data loading ---------------------------------------------------------- */
function listenToCategories() {
  db.collection("categories").orderBy("name").onSnapshot((snap) => {
    allCategories = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderCategoryChips();
  });
}

function listenToProducts() {
  db.collection("products").where("active", "==", true).onSnapshot(
    (snap) => {
      allProducts = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      document.getElementById("productSkeleton")?.remove();
      renderProductGrid();
    },
    (err) => { console.error(err); showToast("Couldn't load products. Check your connection.", "danger"); }
  );
}

function listenToBanksForPayment() {
  db.collection("banks").orderBy("name").onSnapshot((snap) => {
    allBanksForPayment = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const select = document.getElementById("withdrawalBankSelect");
    const current = select.value;
    select.innerHTML = `<option value="">Select a bank…</option>` + allBanksForPayment.map((b) => `<option value="${b.id}">${escapeHtml(b.name)}</option>`).join("");
    if ([...select.options].some((o) => o.value === current)) select.value = current;
  });
}

function listenToCustomersForPayment() {
  db.collection("customers").orderBy("name").onSnapshot((snap) => {
    allCustomersForPayment = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const select = document.getElementById("creditCustomerSelect");
    const current = select.value;
    select.innerHTML = `<option value="">Select a customer…</option>` + allCustomersForPayment.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}${c.phone ? " (" + escapeHtml(c.phone) + ")" : ""}</option>`).join("");
    if ([...select.options].some((o) => o.value === current)) select.value = current;
  });
}

/* ----- Category chips --------------------------------------------------------- */
function renderCategoryChips() {
  const wrap = document.getElementById("categoryChips");
  wrap.querySelectorAll("[data-category]:not([data-category='all'])").forEach((el) => el.remove());
  allCategories.forEach((cat) => {
    const btn = document.createElement("button");
    btn.className = "chip";
    btn.dataset.category = cat.id;
    btn.textContent = cat.name;
    btn.addEventListener("click", () => setActiveCategory(cat.id));
    wrap.appendChild(btn);
  });
}
function setActiveCategory(categoryId) {
  activeCategory = categoryId;
  document.querySelectorAll(".chip").forEach((chip) => chip.classList.toggle("active", chip.dataset.category === categoryId));
  renderProductGrid();
}
document.getElementById("categoryChips").addEventListener("click", (e) => {
  if (e.target.dataset.category === "all") setActiveCategory("all");
});

/* ----- Search ------------------------------------------------------------------- */
document.getElementById("searchInput").addEventListener("input", debounce((e) => {
  searchTerm = e.target.value.trim().toLowerCase();
  renderProductGrid();
}, 200));

/* ----- Product grid --------------------------------------------------------------- */
function getBasketReservedMinor(productId) {
  return basket.filter((line) => line.productId === productId).reduce((sum, line) => sum + line.minorUnitsDeducted, 0);
}

function renderProductGrid() {
  const grid = document.getElementById("productGrid");
  const emptyEl = document.getElementById("productEmpty");
  let list = allProducts;
  if (activeCategory !== "all") list = list.filter((p) => p.categoryId === activeCategory);
  if (searchTerm) list = list.filter((p) => p.name.toLowerCase().includes(searchTerm) || (p.categoryName || "").toLowerCase().includes(searchTerm));

  grid.querySelectorAll(".product-card").forEach((el) => el.remove());
  if (list.length === 0) { emptyEl.classList.remove("hidden"); return; }
  emptyEl.classList.add("hidden");

  list.forEach((product) => {
    const reserved = getBasketReservedMinor(product.id);
    const available = product.stockMinorUnits - reserved;
    const isOut = available <= 0;
    const isLow = !isOut && available <= (product.lowStockThreshold || 0);

    const card = document.createElement("button");
    card.type = "button";
    card.className = "product-card";
    card.disabled = isOut;

    const priceLabel = product.unitType === "single"
      ? `${formatKsh(product.price)} / ${product.unitName}`
      : `${formatKsh(product.pricePerMajor)}/${product.majorUnitName} · ${formatKsh(product.pricePerMinor)}/${product.minorUnitName}`;
    const stockLabel = product.unitType === "single"
      ? `${roundKsh(available)} ${pluralize(product.unitName, roundKsh(available))} left`
      : `${formatDoubleUnitStock(available, product)} left`;

    card.innerHTML = `
      <span class="product-name">${escapeHtml(product.name)}</span>
      <span class="product-price">${priceLabel}</span>
      <span class="product-stock ${isOut ? "out" : isLow ? "low" : ""}">${isOut ? "Out of stock" : stockLabel}</span>
    `;
    card.addEventListener("click", () => openUnitModal(product));
    grid.appendChild(card);
  });
}

/* ----- Unit / quantity modal ---------------------------------------------------- */
const unitModalOverlay = document.getElementById("unitModalOverlay");

function openUnitModal(product) {
  modalProduct = product;
  modalQty = 0;
  document.getElementById("unitModalTitle").textContent = product.name;
  document.getElementById("qtyError").classList.add("hidden");

  const toggle = document.getElementById("unitToggle");
  const majorSection = document.getElementById("majorUnitQty");
  const minorSection = document.getElementById("minorUnitQty");
  const singleSection = document.getElementById("singleUnitQty");
  toggle.innerHTML = "";
  majorSection.classList.add("hidden");
  minorSection.classList.add("hidden");
  singleSection.classList.add("hidden");

  if (product.unitType === "single") {
    modalUnitMode = "single";
    singleSection.classList.remove("hidden");
    document.getElementById("singleUnitLabel").textContent = `Quantity (${product.unitName})`;
    const input = document.getElementById("singleQtyInput");
    input.value = 1;
    input.max = product.stockMinorUnits - getBasketReservedMinor(product.id);
    input.oninput = () => { modalQty = parseFloat(input.value) || 0; validateModalQty(); };
    modalQty = 1;
  } else {
    modalUnitMode = "major";
    toggle.innerHTML = `
      <button type="button" class="active" data-mode="major">Sell by ${product.majorUnitName}</button>
      <button type="button" data-mode="minor">Sell by ${product.minorUnitName}</button>
    `;
    toggle.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", () => {
        toggle.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        modalUnitMode = btn.dataset.mode;
        majorSection.classList.toggle("hidden", modalUnitMode !== "major");
        minorSection.classList.toggle("hidden", modalUnitMode !== "minor");
        if (modalUnitMode === "major") modalQty = parseFloat(document.getElementById("majorQtyInput").value) || 0;
        else modalQty = parseFloat(document.getElementById("minorQtyInput").value) || 0;
        validateModalQty();
      });
    });

    document.getElementById("majorUnitLabel").textContent = `Quantity (${product.majorUnitName})`;
    const majorInput = document.getElementById("majorQtyInput");
    const rawMaxMajor = (product.stockMinorUnits - getBasketReservedMinor(product.id)) / product.minorPerMajor;
    const maxMajor = Math.floor(rawMaxMajor * 2) / 2;
    majorInput.value = maxMajor > 0 ? Math.min(1, maxMajor) : 0;
    majorInput.min = 0.5;
    majorInput.step = 0.5;
    majorInput.max = Math.max(maxMajor, 0.5);
    modalQty = maxMajor > 0 ? Math.min(1, maxMajor) : 0;

    function setMajorQty(value) {
      const snapped = Math.round(value * 2) / 2;
      const clamped = Math.max(0.5, Math.min(snapped, Math.max(maxMajor, 0.5)));
      majorInput.value = clamped;
      modalQty = clamped;
      validateModalQty();
    }
    majorInput.oninput = () => setMajorQty(parseFloat(majorInput.value) || 0.5);
    document.getElementById("majorStepDown").onclick = () => setMajorQty((parseFloat(majorInput.value) || 0.5) - 0.5);
    document.getElementById("majorStepUp").onclick = () => setMajorQty((parseFloat(majorInput.value) || 0.5) + 0.5);

    document.getElementById("minorUnitLabel").textContent = `Quantity (${product.minorUnitName})`;
    const minorInput = document.getElementById("minorQtyInput");
    minorInput.value = "";
    minorInput.oninput = () => { modalQty = parseFloat(minorInput.value) || 0; validateModalQty(); };

    majorSection.classList.remove("hidden");
  }

  updateStockAvailableNote();
  unitModalOverlay.classList.remove("hidden");
}

function updateStockAvailableNote() {
  const note = document.getElementById("stockAvailableNote");
  const product = modalProduct;
  const available = product.stockMinorUnits - getBasketReservedMinor(product.id);
  if (product.unitType === "single") note.textContent = `${roundKsh(available)} ${pluralize(product.unitName, roundKsh(available))} available.`;
  else note.textContent = `${formatDoubleUnitStock(available, product)} available.`;
}

function getModalMinorDeduction() {
  const product = modalProduct;
  if (modalUnitMode === "single") return modalQty;
  if (modalUnitMode === "major") return majorToMinor(modalQty, product.minorPerMajor);
  return modalQty;
}

function validateModalQty() {
  const product = modalProduct;
  const available = product.stockMinorUnits - getBasketReservedMinor(product.id);
  const deduction = getModalMinorDeduction();
  const errorEl = document.getElementById("qtyError");
  const addBtn = document.getElementById("unitModalAdd");
  const invalid = deduction <= 0 || deduction > available + 0.0001;
  errorEl.classList.toggle("hidden", !invalid);
  if (deduction > available) {
    errorEl.textContent = `Not enough stock. Only ${product.unitType === "single" ? roundKsh(available) + " " + pluralize(product.unitName, roundKsh(available)) : formatDoubleUnitStock(available, product)} available.`;
  }
  addBtn.disabled = invalid;
}

document.getElementById("unitModalClose").addEventListener("click", closeUnitModal);
document.getElementById("unitModalCancel").addEventListener("click", closeUnitModal);
function closeUnitModal() { unitModalOverlay.classList.add("hidden"); modalProduct = null; }

document.getElementById("unitModalAdd").addEventListener("click", () => {
  const product = modalProduct;
  const deduction = getModalMinorDeduction();
  if (deduction <= 0) return;

  let unitLabel, pricePerUnitSold, qty;
  if (modalUnitMode === "single") { unitLabel = product.unitName; pricePerUnitSold = product.price; qty = modalQty; }
  else if (modalUnitMode === "major") { unitLabel = product.majorUnitName; pricePerUnitSold = product.pricePerMajor; qty = modalQty; }
  else { unitLabel = product.minorUnitName; pricePerUnitSold = product.pricePerMinor; qty = modalQty; }

  basket.push({
    lineId: "l" + Date.now() + Math.random().toString(16).slice(2),
    productId: product.id, name: product.name, unitSold: modalUnitMode, unitLabel, qty,
    minorUnitsDeducted: deduction, pricePerUnitSold, lineTotal: roundKsh(pricePerUnitSold * qty),
  });

  closeUnitModal();
  renderBasket();
  renderProductGrid();
  showToast(`Added ${qty} ${unitLabel} of ${product.name}`, "success");
});

/* ----- Basket ------------------------------------------------------------------------ */
function renderBasket() {
  const linesEl = document.getElementById("basketLines");
  const emptyEl = document.getElementById("basketEmpty");
  if (basket.length === 0) paymentLines = [];

  linesEl.querySelectorAll(".basket-line").forEach((el) => el.remove());
  if (basket.length === 0) {
    emptyEl.classList.remove("hidden");
  } else {
    emptyEl.classList.add("hidden");
    basket.forEach((line) => {
      const row = document.createElement("div");
      row.className = "basket-line anim-line-in";
      row.dataset.lineId = line.lineId;
      row.innerHTML = `
        <div class="basket-line-info">
          <div class="basket-line-name">${escapeHtml(line.name)}</div>
          <div class="basket-line-qty">${line.qty} ${escapeHtml(line.unitLabel)} × ${formatKsh(line.pricePerUnitSold)}</div>
        </div>
        <div class="basket-line-actions">
          <span class="basket-line-total">${formatKsh(line.lineTotal)}</span>
          <button class="basket-line-remove" aria-label="Remove" data-line-id="${line.lineId}">✕</button>
        </div>`;
      linesEl.appendChild(row);
    });
  }
  updateTotals();
}

document.getElementById("basketLines").addEventListener("click", (e) => {
  const btn = e.target.closest(".basket-line-remove");
  if (!btn) return;
  const lineId = btn.dataset.lineId;
  const row = btn.closest(".basket-line");
  row.classList.add("anim-line-out");
  setTimeout(() => { basket = basket.filter((l) => l.lineId !== lineId); renderBasket(); renderProductGrid(); }, 180);
});

document.getElementById("clearBasketBtn").addEventListener("click", () => {
  if (basket.length === 0) return;
  basket = [];
  renderBasket();
  renderProductGrid();
});

document.getElementById("discountInput").addEventListener("input", updateTotals);

function getSubtotal() { return basket.reduce((sum, l) => sum + l.lineTotal, 0); }

function getTotal() {
  const subtotal = getSubtotal();
  const discountRaw = parseFloat(document.getElementById("discountInput").value) || 0;
  const discount = Math.max(0, Math.min(discountRaw, subtotal));
  return Math.max(0, roundKsh(subtotal - discount));
}
function getPaidSoFar() { return paymentLines.reduce((sum, l) => sum + l.amount, 0); }
function getRemaining() { return Math.max(0, roundKsh(getTotal() - getPaidSoFar())); }

function updateTotals() {
  const subtotal = getSubtotal();
  const discountRaw = parseFloat(document.getElementById("discountInput").value) || 0;
  const discount = Math.max(0, Math.min(discountRaw, subtotal));
  const total = Math.max(0, roundKsh(subtotal - discount));
  document.getElementById("subtotalValue").textContent = formatKsh(subtotal);
  document.getElementById("totalValue").textContent = formatKsh(total);
  if (getPaidSoFar() > total) paymentLines = [];
  renderPaymentUI();
}

/* ----- Split payment builder (cash / mobile transfer / mobile withdrawal / credit) ---- */
function renderPaymentUI() {
  const remaining = getRemaining();
  const remainingEl = document.getElementById("paymentRemaining");
  remainingEl.textContent = `Remaining: ${formatKsh(remaining)}`;
  remainingEl.classList.toggle("zero", remaining === 0);

  const linesWrap = document.getElementById("paymentLinesList");
  linesWrap.innerHTML = paymentLines.map((l) => {
    let label;
    if (l.method === "cash") label = `💵 Cash — ${formatKsh(l.amount)}`;
    else if (l.method === "mobile_transfer") label = `📲 ${l.channel === "manager" ? "Manager" : "Shop"} M-Pesa — ${formatKsh(l.amount)}`;
    else if (l.method === "mobile_withdrawal") label = `🏧 ${escapeHtml(l.bankName)} withdrawal — ${formatKsh(l.withdrawalAmount)} (${formatKsh(l.appliedToSale)} to sale${l.changeGiven > 0 ? `, ${formatKsh(l.changeGiven)} change` : ""})`;
    else label = `🤝 Credit — ${escapeHtml(l.customerName)} — ${formatKsh(l.amount)}`;
    return `<div class="payment-line"><span>${label}</span><button type="button" class="payment-line-remove" data-remove-payment="${l.lineId}">✕</button></div>`;
  }).join("");

  const usedMethods = new Set(paymentLines.map((l) => l.method));
  document.querySelectorAll("#paymentMethodPicker .payment-btn").forEach((btn) => {
    btn.disabled = usedMethods.has(btn.dataset.method) || remaining === 0;
  });
  document.getElementById("paymentMethodPicker").classList.toggle("hidden", remaining === 0);
  document.getElementById("completeSaleBtn").disabled = basket.length === 0 || remaining !== 0 || isOfflineLockedOut();
}

document.getElementById("paymentLinesList").addEventListener("click", (e) => {
  const lineId = e.target.dataset.removePayment;
  if (!lineId) return;
  paymentLines = paymentLines.filter((l) => l.lineId !== lineId);
  renderPaymentUI();
});

function wirePaymentBuilder() {
  const cashEntry = document.getElementById("cashEntry");
  const transferEntry = document.getElementById("transferEntry");
  const withdrawalEntry = document.getElementById("withdrawalEntry");
  const creditEntry = document.getElementById("creditEntry");
  const picker = document.getElementById("paymentMethodPicker");

  function closeAllEntries() {
    cashEntry.classList.add("hidden");
    transferEntry.classList.add("hidden");
    withdrawalEntry.classList.add("hidden");
    creditEntry.classList.add("hidden");
  }

  document.querySelectorAll("#paymentMethodPicker .payment-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      closeAllEntries();
      const remaining = getRemaining();
      if (btn.dataset.method === "cash") {
        document.getElementById("cashAmountInput").value = remaining;
        cashEntry.classList.remove("hidden");
      } else if (btn.dataset.method === "mobile_transfer") {
        document.getElementById("transferAmountInput").value = remaining;
        document.querySelectorAll(".channel-btn").forEach((c) => c.classList.toggle("active", c.dataset.channel === "shop"));
        transferEntry.classList.remove("hidden");
      } else if (btn.dataset.method === "mobile_withdrawal") {
        document.getElementById("withdrawalBankSelect").value = "";
        document.getElementById("withdrawalAmountInput").value = "";
        document.getElementById("withdrawalSplitHint").textContent = "";
        withdrawalEntry.classList.remove("hidden");
      } else {
        document.getElementById("creditCustomerSelect").value = "";
        document.getElementById("creditNewCustomerFields").classList.add("hidden");
        document.getElementById("creditNewNameInput").value = "";
        document.getElementById("creditNewPhoneInput").value = "";
        document.getElementById("creditAmountInput").value = remaining;
        creditEntry.classList.remove("hidden");
      }
    });
  });

  document.getElementById("cashEntryCancel").addEventListener("click", closeAllEntries);
  document.getElementById("cashEntryAdd").addEventListener("click", () => {
    const amount = roundKsh(parseFloat(document.getElementById("cashAmountInput").value) || 0);
    if (amount <= 0) { showToast("Enter an amount.", "warning"); return; }
    if (amount > getRemaining()) { showToast(`That's more than the remaining ${formatKsh(getRemaining())}.`, "warning"); return; }
    paymentLines.push({ lineId: "p" + Date.now(), method: "cash", amount });
    closeAllEntries();
    renderPaymentUI();
  });

  document.querySelectorAll(".channel-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".channel-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
    });
  });
  document.getElementById("transferEntryCancel").addEventListener("click", closeAllEntries);
  document.getElementById("transferEntryAdd").addEventListener("click", () => {
    const amount = roundKsh(parseFloat(document.getElementById("transferAmountInput").value) || 0);
    const channel = document.querySelector(".channel-btn.active")?.dataset.channel || "shop";
    if (amount <= 0) { showToast("Enter an amount.", "warning"); return; }
    if (amount > getRemaining()) { showToast(`That's more than the remaining ${formatKsh(getRemaining())}.`, "warning"); return; }
    paymentLines.push({ lineId: "p" + Date.now(), method: "mobile_transfer", amount, channel });
    closeAllEntries();
    renderPaymentUI();
  });

  const withdrawalAmountInput = document.getElementById("withdrawalAmountInput");
  withdrawalAmountInput.addEventListener("input", () => {
    const withdrawn = roundKsh(parseFloat(withdrawalAmountInput.value) || 0);
    const remaining = getRemaining();
    const applied = Math.min(withdrawn, remaining);
    const change = withdrawn - applied;
    const hint = document.getElementById("withdrawalSplitHint");
    hint.textContent = withdrawn > 0 ? `${formatKsh(applied)} goes to this sale${change > 0 ? `, ${formatKsh(change)} handed to the customer as change` : ""}.` : "";
  });
  document.getElementById("withdrawalEntryCancel").addEventListener("click", closeAllEntries);
  document.getElementById("withdrawalEntryAdd").addEventListener("click", () => {
    const bankId = document.getElementById("withdrawalBankSelect").value;
    const bank = allBanksForPayment.find((b) => b.id === bankId);
    const withdrawn = roundKsh(parseFloat(withdrawalAmountInput.value) || 0);
    if (!bank) { showToast("Select a bank.", "warning"); return; }
    if (withdrawn <= 0) { showToast("Enter the amount withdrawn.", "warning"); return; }
    const remaining = getRemaining();
    const applied = Math.min(withdrawn, remaining);
    const change = withdrawn - applied;
    paymentLines.push({
      lineId: "p" + Date.now(), method: "mobile_withdrawal", amount: applied,
      bankId: bank.id, bankName: bank.name, bankCode: bank.code,
      withdrawalAmount: withdrawn, appliedToSale: applied, changeGiven: change,
    });
    closeAllEntries();
    renderPaymentUI();
  });

  document.getElementById("creditNewCustomerBtn").addEventListener("click", () => {
    document.getElementById("creditNewCustomerFields").classList.toggle("hidden");
  });
  document.getElementById("creditEntryCancel").addEventListener("click", closeAllEntries);
  document.getElementById("creditEntryAdd").addEventListener("click", async () => {
    let customerId = document.getElementById("creditCustomerSelect").value;
    let customerName;
    const newName = document.getElementById("creditNewNameInput").value.trim();
    const amount = roundKsh(parseFloat(document.getElementById("creditAmountInput").value) || 0);

    if (amount <= 0) { showToast("Enter an amount.", "warning"); return; }
    if (amount > getRemaining()) { showToast(`That's more than the remaining ${formatKsh(getRemaining())}.`, "warning"); return; }

    if (!customerId && newName) {
      try {
        const newPhone = document.getElementById("creditNewPhoneInput").value.trim();
        const ref = await db.collection("customers").add({ name: newName, phone: newPhone || null, balanceOwed: 0, nextDueDate: null, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
        customerId = ref.id;
        customerName = newName;
      } catch (err) {
        console.error(err);
        showToast("Couldn't add customer.", "danger");
        return;
      }
    } else if (customerId) {
      customerName = allCustomersForPayment.find((c) => c.id === customerId)?.name;
    }

    if (!customerId) { showToast("Select or add a customer.", "warning"); return; }

    paymentLines.push({ lineId: "p" + Date.now(), method: "credit", amount, customerId, customerName });
    closeAllEntries();
    renderPaymentUI();
  });
}

/* ----- Offline lockout ------------------------------------------------------------------- */
function checkOfflineLockout() {
  const overlay = document.getElementById("offlineLockOverlay");
  if (isOfflineLockedOut()) {
    overlay.classList.remove("hidden");
    document.getElementById("completeSaleBtn").disabled = true;
  } else {
    overlay.classList.add("hidden");
    renderPaymentUI();
  }
}
document.getElementById("offlineRetryBtn").addEventListener("click", checkOfflineLockout);

/* ----- Telegram notification (fire-and-forget, never blocks the sale) --------------------- */
function notifyTelegram(sale) {
  try {
    const lines = [
      `🧾 Sale #${sale.receiptNumber}`,
      `Total: ${formatKsh(sale.total)}`,
      `Items: ${sale.items.length}`,
      `Served by: ${sale.servedByName}`,
    ];
    if (sale.customerName) lines.push(`Customer: ${sale.customerName}`);
    const creditLine = sale.payments.find((p) => p.method === "credit");
    if (creditLine) lines.push(`⚠️ Includes ${formatKsh(creditLine.amount)} on credit (${creditLine.customerName})`);
    fetch("/api/notify-telegram", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: lines.join("\n") }),
    }).catch(() => {});
  } catch (err) {
    console.warn("Telegram notify skipped:", err);
  }
}

/* ----- Complete sale --------------------------------------------------------------------- */
document.getElementById("completeSaleBtn").addEventListener("click", async () => {
  if (basket.length === 0 || getRemaining() !== 0) return;
  if (isOfflineLockedOut()) { checkOfflineLockout(); return; }

  const btn = document.getElementById("completeSaleBtn");
  btn.disabled = true;
  btn.textContent = "Completing…";

  const subtotal = getSubtotal();
  const discountRaw = parseFloat(document.getElementById("discountInput").value) || 0;
  const discount = Math.max(0, Math.min(discountRaw, subtotal));
  const total = Math.max(0, roundKsh(subtotal - discount));
  const customerName = document.getElementById("customerNameInput").value.trim();

  const deductionsByProduct = {};
  basket.forEach((line) => { deductionsByProduct[line.productId] = (deductionsByProduct[line.productId] || 0) + line.minorUnitsDeducted; });
  const productIds = Object.keys(deductionsByProduct);

  const withdrawalLines = paymentLines.filter((l) => l.method === "mobile_withdrawal");
  const creditLines = paymentLines.filter((l) => l.method === "credit");
  const cashContribution = paymentLines.filter((l) => l.method === "cash").reduce((sum, l) => sum + l.amount, 0) +
    withdrawalLines.reduce((sum, l) => sum + l.appliedToSale, 0);
  const needsMoneyPool = cashContribution > 0 || withdrawalLines.length > 0;

  const todayStr = formatDateInput(new Date());
  const poolRef = db.collection("moneyPools").doc("main");

  try {
    const receiptNumber = await getNextReceiptNumber();
    const saleRef = db.collection("sales").doc();
    const withdrawalLine = withdrawalLines[0] || null;
    const bankRef = withdrawalLine ? db.collection("banks").doc(withdrawalLine.bankId) : null;
    const cashTxRef = withdrawalLine ? db.collection("cashTransactions").doc() : null;
    const creditLine = creditLines[0] || null;
    const customerRef = creditLine ? db.collection("customers").doc(creditLine.customerId) : null;
    const creditLedgerRef = creditLine ? db.collection("creditLedger").doc() : null;

    const result = await db.runTransaction(async (t) => {
      const productRefs = productIds.map((id) => db.collection("products").doc(id));
      const productDocs = await Promise.all(productRefs.map((ref) => t.get(ref)));
      const poolDoc = needsMoneyPool ? await t.get(poolRef) : null;
      const bankDoc = bankRef ? await t.get(bankRef) : null;
      const customerDoc = customerRef ? await t.get(customerRef) : null;

      const lowStock = [];
      productDocs.forEach((doc, i) => {
        const id = productIds[i];
        if (!doc.exists) throw new Error(`Product ${id} no longer exists.`);
        const data = doc.data();
        const deduction = deductionsByProduct[id];
        const newStock = data.stockMinorUnits - deduction;
        if (newStock < -0.0001) throw new Error(`Not enough stock for ${data.name}. Someone may have just sold the last of it.`);
        t.update(productRefs[i], { stockMinorUnits: Math.max(0, newStock) });
        if (newStock <= (data.lowStockThreshold || 0)) lowStock.push({ name: data.name, remaining: Math.max(0, newStock), unitLabel: data.unitType === "single" ? data.unitName : data.minorUnitName });
      });

      const lowBalance = [];
      if (needsMoneyPool) {
        if (!poolDoc.exists) throw new Error("Float/cash balances haven't been set up yet — ask the manager to set opening balances in Deposit/Withdraw.");
        const pool = poolDoc.data();
        const sameDay = pool.salesCashDate === todayStr;
        let salesCashToday = sameDay ? pool.salesCashToday || 0 : 0;
        let salesCashDeductedToday = sameDay ? pool.salesCashDeductedToday || 0 : 0;
        let float = pool.float || 0;
        let withdrawalCash = pool.withdrawalCash || 0;

        if (withdrawalLine) {
          if (!bankDoc.exists) throw new Error("That bank no longer exists.");
          const withdrawn = withdrawalLine.withdrawalAmount;
          const availableFromSalesCash = salesCashToday - salesCashDeductedToday;
          let fundedFromSalesCash = 0;
          if (withdrawn <= withdrawalCash) {
            withdrawalCash -= withdrawn;
          } else {
            const shortfall = withdrawn - withdrawalCash;
            if (shortfall > availableFromSalesCash + 0.0001) throw new Error("Not enough withdrawal cash or today's sales cash to cover this withdrawal.");
            fundedFromSalesCash = shortfall;
            salesCashDeductedToday += shortfall;
            withdrawalCash = 0;
          }
          float += withdrawn;

          const nextSeq = (bankDoc.data().seqCounter || 0) + 1;
          const transactionNumber = String(nextSeq).padStart(4, "0") + withdrawalLine.bankCode;
          t.update(bankRef, { seqCounter: nextSeq });
          t.set(cashTxRef, {
            type: "withdrawal", bankId: withdrawalLine.bankId, bankName: withdrawalLine.bankName, bankCode: withdrawalLine.bankCode,
            amount: withdrawn, fundedFromSalesCash, customerName: customerName || null, transactionNumber,
            source: "pos", linkedSaleId: saleRef.id, enteredBy: currentUser.uid, enteredByName: currentUser.displayName,
            enteredByRole: currentUser.role, createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          });
        }

        salesCashToday += cashContribution;
        t.set(poolRef, { float, withdrawalCash, salesCashToday, salesCashDate: todayStr, salesCashDeductedToday }, { merge: true });

        if (float <= (businessInfo.floatCashLowThreshold ?? 3000)) lowBalance.push({ label: "Float", remaining: float });
        if (withdrawalCash <= (businessInfo.floatCashLowThreshold ?? 3000)) lowBalance.push({ label: "Withdrawal cash", remaining: withdrawalCash });
      }

      if (creditLine) {
        const currentBalance = customerDoc && customerDoc.exists ? customerDoc.data().balanceOwed || 0 : 0;
        const currentDue = customerDoc && customerDoc.exists ? customerDoc.data().nextDueDate : null;
        const newBalance = currentBalance + creditLine.amount;
        const newDueDate = currentDue || addDaysDateStr(new Date(), CREDIT_DUE_DAYS);
        t.set(customerRef, { balanceOwed: newBalance, nextDueDate: newDueDate }, { merge: true });
        t.set(creditLedgerRef, {
          type: "sale", customerId: creditLine.customerId, customerName: creditLine.customerName, amount: creditLine.amount,
          linkedSaleId: saleRef.id, receiptNumber, dueDate: addDaysDateStr(new Date(), CREDIT_DUE_DAYS),
          enteredBy: currentUser.uid, enteredByName: currentUser.displayName, enteredByRole: currentUser.role,
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        });
      }

      t.set(saleRef, {
        receiptNumber, servedBy: currentUser.uid, servedByRole: currentUser.role, servedByName: currentUser.displayName,
        customerName: customerName || null,
        items: basket.map((l) => ({ productId: l.productId, name: l.name, unitSold: l.unitSold, unitLabel: l.unitLabel, qty: l.qty, pricePerUnitSold: l.pricePerUnitSold, lineTotal: l.lineTotal })),
        payments: paymentLines.map((l) => ({
          method: l.method, amount: l.amount, channel: l.channel || null,
          bankId: l.bankId || null, bankName: l.bankName || null, bankCode: l.bankCode || null,
          withdrawalAmount: l.withdrawalAmount || null, appliedToSale: l.appliedToSale || null, changeGiven: l.changeGiven || null,
          customerId: l.customerId || null, customerName: l.customerName || null,
        })),
        subtotal: roundKsh(subtotal), discount: roundKsh(discount), total,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      });

      return { lowStock, lowBalance };
    });

    const saleForReceipt = { receiptNumber, customerName, total, subtotal, discount, items: basket, payments: paymentLines, servedByName: currentUser.displayName, servedByRole: currentUser.role };
    showReceipt(saleForReceipt);
    notifyTelegram(saleForReceipt);

    basket = [];
    paymentLines = [];
    document.getElementById("discountInput").value = 0;
    document.getElementById("customerNameInput").value = "";
    renderBasket();
    renderProductGrid();

    if (result.lowStock.length > 0 || result.lowBalance.length > 0) showLowStockAlert(result.lowStock, result.lowBalance);
  } catch (err) {
    console.error(err);
    showToast(err.message || "Couldn't complete the sale. Please try again.", "danger");
  } finally {
    btn.textContent = "Complete sale";
    renderPaymentUI();
  }
});

/* ----- Low stock / low balance alert modal --------------------------------------------------- */
function showLowStockAlert(stockItems, balanceItems) {
  stockItems = stockItems || [];
  balanceItems = balanceItems || [];
  const list = document.getElementById("lowStockList");
  list.innerHTML =
    stockItems.map((item) => `<li>${escapeHtml(item.name)} — ${roundKsh(item.remaining)} ${escapeHtml(item.unitLabel)} left</li>`).join("") +
    balanceItems.map((item) => `<li>${escapeHtml(item.label)} balance is low — ${formatKsh(item.remaining)} left</li>`).join("");
  const total = stockItems.length + balanceItems.length;
  document.getElementById("lowStockMessage").textContent = total === 1 ? "One thing just dropped to its low alert threshold." : `${total} things just dropped to their low alert threshold.`;
  document.getElementById("lowStockOverlay").classList.remove("hidden");
}
document.getElementById("lowStockDismiss").addEventListener("click", () => document.getElementById("lowStockOverlay").classList.add("hidden"));

/* ----- Receipt ------------------------------------------------------------------------------- */
function paymentLineReceiptLabel(l) {
  if (l.method === "cash") return `Cash — ${formatKsh(l.amount)}`;
  if (l.method === "mobile_transfer") return `${l.channel === "manager" ? "Manager" : "Shop"} M-Pesa — ${formatKsh(l.amount)}`;
  if (l.method === "mobile_withdrawal") return `${l.bankName} withdrawal — ${formatKsh(l.appliedToSale)}${l.changeGiven > 0 ? ` (+${formatKsh(l.changeGiven)} change given)` : ""}`;
  return `On credit (${l.customerName}) — ${formatKsh(l.amount)}`;
}

function showReceipt(sale) {
  const area = document.getElementById("receiptPrintArea");
  const dateStr = formatDateTime(new Date());
  const itemRows = sale.items.map((l) => `
        <div class="receipt-row">
          <span class="receipt-item-name">${escapeHtml(l.name)}<br/><span>${l.qty} ${escapeHtml(l.unitLabel)} × ${formatKsh(l.pricePerUnitSold)}</span></span>
          <span>${formatKsh(l.lineTotal)}</span>
        </div>`).join("");
  const paymentRows = (sale.payments || []).map((l) => `<div class="receipt-row"><span>${escapeHtml(paymentLineReceiptLabel(l))}</span></div>`).join("");

  area.innerHTML = `
    <div class="receipt-center">
      <div class="receipt-bold">${escapeHtml(businessInfo.companyName || "Misty Code")}</div>
      ${businessInfo.address ? `<div>${escapeHtml(businessInfo.address)}</div>` : ""}
      ${businessInfo.phone ? `<div>${escapeHtml(businessInfo.phone)}</div>` : ""}
    </div>
    <div class="receipt-divider"></div>
    <div class="receipt-row"><span>Receipt #</span><span>${sale.receiptNumber}</span></div>
    <div class="receipt-row"><span>Date</span><span>${dateStr}</span></div>
    <div class="receipt-row"><span>Served by</span><span>${escapeHtml(sale.servedByName)} (${sale.servedByRole === "manager" ? "Main" : "Seller"})</span></div>
    ${sale.customerName ? `<div class="receipt-row"><span>Customer</span><span>${escapeHtml(sale.customerName)}</span></div>` : ""}
    <div class="receipt-divider"></div>
    ${itemRows}
    <div class="receipt-divider"></div>
    <div class="receipt-row"><span>Subtotal</span><span>${formatKsh(sale.subtotal)}</span></div>
    <div class="receipt-row"><span>Discount</span><span>${formatKsh(sale.discount)}</span></div>
    <div class="receipt-row receipt-total-row"><span>TOTAL</span><span>${formatKsh(sale.total)}</span></div>
    <div class="receipt-divider"></div>
    ${paymentRows}
    <div class="receipt-divider"></div>
    <div class="receipt-center">Thank you for your business!</div>
  `;
  document.getElementById("receiptOverlay").classList.remove("hidden");
}

document.getElementById("receiptCancelBtn").addEventListener("click", () => document.getElementById("receiptOverlay").classList.add("hidden"));
document.getElementById("receiptPrintBtn").addEventListener("click", () => window.print());

function wireStaticUI() {}
