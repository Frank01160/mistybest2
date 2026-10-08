/* ==========================================================================
   WITHDRAWALS.JS — Deposit / Withdraw logic, tied to the Float and
   Withdrawal-cash pools shared with the POS.
   ========================================================================== */

let wdUser = null;
let wdBanks = [];
let allTransactions = [];
let filteredTransactions = [];
let selectedWdType = "deposit";
let activeBankFilter = "all";
let moneyPool = { float: 0, withdrawalCash: 0, salesCashToday: 0, salesCashDate: "", salesCashDeductedToday: 0 };
let lowThreshold = 3000;
let adjustPool = "float";
let adjustDir = "add";
let pendingConfirmAction = null;

(async function init() {
  wdUser = await requireAuth(["seller", "manager"]);
  wireTabs();
  wireEntryForm();
  wireAdjustForm();
  wireConfirmModal();
  wireLowBalanceModal();
  wireHistoryFilters();
  wireExports();
  listenToBanks();
  listenToMoneyPool();
  listenToThreshold();
  setDefaultHistoryRange();
  listenToTransactions();
})();

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

function listenToMoneyPool() {
  db.collection("moneyPools").doc("main").onSnapshot((doc) => {
    if (doc.exists) moneyPool = { ...moneyPool, ...doc.data() };
    renderBalanceCards();
  });
}
function listenToThreshold() {
  db.collection("businessConfig").doc("main").onSnapshot((doc) => {
    if (doc.exists && typeof doc.data().floatCashLowThreshold === "number") lowThreshold = doc.data().floatCashLowThreshold;
    renderBalanceCards();
  });
}
function renderBalanceCards() {
  const floatEl = document.getElementById("floatBalanceValue");
  const cashEl = document.getElementById("cashBalanceValue");
  floatEl.textContent = formatKsh(moneyPool.float || 0);
  cashEl.textContent = formatKsh(moneyPool.withdrawalCash || 0);
  floatEl.classList.toggle("low", (moneyPool.float || 0) <= lowThreshold);
  cashEl.classList.toggle("low", (moneyPool.withdrawalCash || 0) <= lowThreshold);
}
function getAvailableFromSalesCashToday() {
  const todayStr = formatDateInput(new Date());
  if (moneyPool.salesCashDate !== todayStr) return 0;
  return (moneyPool.salesCashToday || 0) - (moneyPool.salesCashDeductedToday || 0);
}

function listenToBanks() {
  db.collection("banks").orderBy("name").onSnapshot((snap) => {
    wdBanks = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderBankSelect();
    renderBankChips();
  });
}
function renderBankSelect() {
  const select = document.getElementById("wdBankSelect");
  const current = select.value;
  select.innerHTML = `<option value="">Select a bank…</option>` + wdBanks.map((b) => `<option value="${b.id}">${escapeHtml(b.name)}</option>`).join("");
  if ([...select.options].some((o) => o.value === current)) select.value = current;
  validateEntryForm();
}
function renderBankChips() {
  const wrap = document.getElementById("bankChips");
  wrap.querySelectorAll("[data-bank]:not([data-bank='all'])").forEach((el) => el.remove());
  wdBanks.forEach((b) => {
    const chip = document.createElement("button");
    chip.className = "chip";
    chip.dataset.bank = b.id;
    chip.textContent = b.name;
    chip.addEventListener("click", () => setBankFilter(b.id));
    wrap.appendChild(chip);
  });
}
function setBankFilter(bankId) {
  activeBankFilter = bankId;
  document.querySelectorAll("#bankChips .chip").forEach((c) => c.classList.toggle("active", c.dataset.bank === bankId));
  applyHistoryFilters();
}
document.getElementById("bankChips").addEventListener("click", (e) => { if (e.target.dataset.bank === "all") setBankFilter("all"); });

function wireEntryForm() {
  document.querySelectorAll("#panel-entry .wd-type-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#panel-entry .wd-type-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      selectedWdType = btn.dataset.wdType;
    });
  });
  document.getElementById("wdBankSelect").addEventListener("change", validateEntryForm);
  document.getElementById("wdAmountInput").addEventListener("input", validateEntryForm);
  document.getElementById("wdSubmitBtn").addEventListener("click", openTransactionConfirm);
}
function validateEntryForm() {
  const bankId = document.getElementById("wdBankSelect").value;
  const amount = parseInt(document.getElementById("wdAmountInput").value, 10);
  document.getElementById("wdSubmitBtn").disabled = !(bankId && Number.isInteger(amount) && amount > 0);
}

function openTransactionConfirm() {
  const bankId = document.getElementById("wdBankSelect").value;
  const bank = wdBanks.find((b) => b.id === bankId);
  const amount = parseInt(document.getElementById("wdAmountInput").value, 10);
  const customerName = document.getElementById("wdCustomerInput").value.trim();
  if (!bank || !amount || amount <= 0) return;

  if (selectedWdType === "deposit" && amount > (moneyPool.float || 0)) {
    showToast(`Not enough float to cover this deposit. Float is currently ${formatKsh(moneyPool.float || 0)} — ask the manager to top it up first.`, "danger");
    return;
  }

  let shortfallNote = "";
  if (selectedWdType === "withdrawal" && amount > (moneyPool.withdrawalCash || 0)) {
    const shortfall = amount - (moneyPool.withdrawalCash || 0);
    const availableFromSales = getAvailableFromSalesCashToday();
    if (shortfall > availableFromSales + 0.0001) {
      showToast(`Not enough withdrawal cash or today's sales cash to cover this. Short by ${formatKsh(shortfall - availableFromSales)}.`, "danger");
      return;
    }
    shortfallNote = `<div class="wd-confirm-line" style="color: var(--color-warning);"><span>From today's sales cash</span><span>${formatKsh(shortfall)}</span></div>`;
  }

  pendingConfirmAction = { kind: "transaction", type: selectedWdType, bank, amount, customerName };
  document.getElementById("wdConfirmBody").innerHTML = `
    <div class="wd-confirm-amount" style="color: ${selectedWdType === "deposit" ? "var(--color-success)" : "var(--color-danger)"};">${selectedWdType === "deposit" ? "Deposit" : "Withdrawal"} — ${formatKsh(amount)}</div>
    <div class="wd-confirm-line"><span>Bank / channel</span><span>${escapeHtml(bank.name)}</span></div>
    <div class="wd-confirm-line"><span>Customer</span><span>${escapeHtml(customerName || "Not provided")}</span></div>
    <div class="wd-confirm-line"><span>Entered by</span><span>${escapeHtml(wdUser.displayName)}</span></div>
    ${shortfallNote}`;
  document.getElementById("wdConfirmOverlay").classList.remove("hidden");
}

function wireAdjustForm() {
  document.querySelectorAll("[data-adjust-pool]").forEach((btn) => btn.addEventListener("click", () => {
    document.querySelectorAll("[data-adjust-pool]").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    adjustPool = btn.dataset.adjustPool;
  }));
  document.querySelectorAll("[data-adjust-dir]").forEach((btn) => btn.addEventListener("click", () => {
    document.querySelectorAll("[data-adjust-dir]").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    adjustDir = btn.dataset.adjustDir;
  }));
  document.getElementById("adjustSubmitBtn").addEventListener("click", openAdjustConfirm);
}

function openAdjustConfirm() {
  const amount = roundKsh(parseFloat(document.getElementById("adjustAmountInput").value) || 0);
  const reason = document.getElementById("adjustReasonWdInput").value.trim();
  if (amount <= 0) { showToast("Enter an amount.", "warning"); return; }
  if (!reason) { showToast("Please add a reason for this adjustment.", "warning"); return; }

  const currentValue = adjustPool === "float" ? (moneyPool.float || 0) : (moneyPool.withdrawalCash || 0);
  if (adjustDir === "deduct" && amount > currentValue) {
    showToast(`That's more than the current ${adjustPool === "float" ? "Float" : "Withdrawal cash"} balance (${formatKsh(currentValue)}).`, "danger");
    return;
  }

  pendingConfirmAction = { kind: "adjustment", pool: adjustPool, dir: adjustDir, amount, reason };
  document.getElementById("wdConfirmBody").innerHTML = `
    <div class="wd-confirm-amount" style="color: ${adjustDir === "add" ? "var(--color-success)" : "var(--color-danger)"};">${adjustDir === "add" ? "+" : "−"} ${formatKsh(amount)} ${adjustPool === "float" ? "Float" : "Withdrawal cash"}</div>
    <div class="wd-confirm-line"><span>Reason</span><span>${escapeHtml(reason)}</span></div>
    <div class="wd-confirm-line"><span>New balance</span><span>${formatKsh(adjustDir === "add" ? currentValue + amount : currentValue - amount)}</span></div>
    <div class="wd-confirm-line"><span>Adjusted by</span><span>${escapeHtml(wdUser.displayName)}</span></div>`;
  document.getElementById("wdConfirmOverlay").classList.remove("hidden");
}

function wireConfirmModal() {
  document.getElementById("wdConfirmClose").addEventListener("click", closeConfirmModal);
  document.getElementById("wdConfirmCancel").addEventListener("click", closeConfirmModal);
  document.getElementById("wdConfirmSave").addEventListener("click", saveConfirmedAction);
}
function closeConfirmModal() { document.getElementById("wdConfirmOverlay").classList.add("hidden"); pendingConfirmAction = null; }

async function saveConfirmedAction() {
  if (!pendingConfirmAction) return;
  const saveBtn = document.getElementById("wdConfirmSave");
  saveBtn.disabled = true;
  saveBtn.textContent = "Saving…";
  try {
    if (pendingConfirmAction.kind === "transaction") {
      await saveTransaction(pendingConfirmAction);
      document.getElementById("wdAmountInput").value = "";
      document.getElementById("wdCustomerInput").value = "";
      document.getElementById("wdBankSelect").value = "";
      validateEntryForm();
    } else {
      await saveAdjustment(pendingConfirmAction);
      document.getElementById("adjustAmountInput").value = "";
      document.getElementById("adjustReasonWdInput").value = "";
    }
    closeConfirmModal();
  } catch (err) {
    console.error(err);
    showToast(err.message || "Couldn't save. Please try again.", "danger");
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = "Confirm";
  }
}

async function saveTransaction(action) {
  const { type, bank, amount, customerName } = action;
  const bankRef = db.collection("banks").doc(bank.id);
  const poolRef = db.collection("moneyPools").doc("main");
  const todayStr = formatDateInput(new Date());

  const lowBalance = await db.runTransaction(async (t) => {
    const bankDoc = await t.get(bankRef);
    const poolDoc = await t.get(poolRef);
    if (!bankDoc.exists) throw new Error("This bank no longer exists.");

    const pool = poolDoc.exists ? poolDoc.data() : { float: 0, withdrawalCash: 0 };
    const sameDay = pool.salesCashDate === todayStr;
    let salesCashToday = sameDay ? pool.salesCashToday || 0 : 0;
    let salesCashDeductedToday = sameDay ? pool.salesCashDeductedToday || 0 : 0;
    let float = pool.float || 0;
    let withdrawalCash = pool.withdrawalCash || 0;
    let fundedFromSalesCash = 0;

    if (type === "deposit") {
      if (amount > float + 0.0001) throw new Error("Not enough float to cover this deposit.");
      float -= amount;
      withdrawalCash += amount;
    } else {
      if (amount <= withdrawalCash) {
        withdrawalCash -= amount;
      } else {
        const shortfall = amount - withdrawalCash;
        const availableFromSales = salesCashToday - salesCashDeductedToday;
        if (shortfall > availableFromSales + 0.0001) throw new Error("Not enough withdrawal cash or today's sales cash to cover this withdrawal.");
        fundedFromSalesCash = shortfall;
        salesCashDeductedToday += shortfall;
        withdrawalCash = 0;
      }
      float += amount;
    }

    const nextSeq = (bankDoc.data().seqCounter || 0) + 1;
    const transactionNumber = String(nextSeq).padStart(4, "0") + bank.code;
    t.update(bankRef, { seqCounter: nextSeq });
    t.set(poolRef, { float, withdrawalCash, salesCashToday, salesCashDate: todayStr, salesCashDeductedToday }, { merge: true });
    t.set(db.collection("cashTransactions").doc(), {
      type, bankId: bank.id, bankName: bank.name, bankCode: bank.code, amount, fundedFromSalesCash,
      customerName: customerName || null, transactionNumber, source: "standalone",
      enteredBy: wdUser.uid, enteredByName: wdUser.displayName, enteredByRole: wdUser.role,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });

    const warnings = [];
    if (float <= lowThreshold) warnings.push({ label: "Float", remaining: float });
    if (withdrawalCash <= lowThreshold) warnings.push({ label: "Withdrawal cash", remaining: withdrawalCash });
    return warnings;
  });

  showToast(`${type === "deposit" ? "Deposit" : "Withdrawal"} saved.`, "success");
  if (lowBalance.length > 0) showLowBalanceAlert(lowBalance);
}

async function saveAdjustment(action) {
  const { pool: poolType, dir, amount, reason } = action;
  const poolRef = db.collection("moneyPools").doc("main");
  const lowBalance = await db.runTransaction(async (t) => {
    const poolDoc = await t.get(poolRef);
    const pool = poolDoc.exists ? poolDoc.data() : { float: 0, withdrawalCash: 0 };
    const field = poolType === "float" ? "float" : "withdrawalCash";
    const current = pool[field] || 0;
    const delta = dir === "add" ? amount : -amount;
    const newValue = current + delta;
    if (newValue < 0) throw new Error("This would take the balance below zero.");
    t.set(poolRef, { [field]: newValue }, { merge: true });
    t.set(db.collection("cashTransactions").doc(), {
      type: "adjustment", poolType, delta, newBalance: newValue, reason,
      enteredBy: wdUser.uid, enteredByName: wdUser.displayName, enteredByRole: wdUser.role,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    return newValue <= lowThreshold ? [{ label: poolType === "float" ? "Float" : "Withdrawal cash", remaining: newValue }] : [];
  });
  showToast("Balance adjustment saved.", "success");
  if (lowBalance.length > 0) showLowBalanceAlert(lowBalance);
}

function wireLowBalanceModal() {
  document.getElementById("lowBalanceDismiss").addEventListener("click", () => document.getElementById("lowBalanceOverlay").classList.add("hidden"));
}
function showLowBalanceAlert(items) {
  document.getElementById("lowBalanceList").innerHTML = items.map((i) => `<li>${escapeHtml(i.label)} balance is low — ${formatKsh(i.remaining)} left</li>`).join("");
  document.getElementById("lowBalanceMessage").textContent = items.length === 1 ? "A balance just dropped to its alert threshold." : `${items.length} balances just dropped to their alert threshold.`;
  document.getElementById("lowBalanceOverlay").classList.remove("hidden");
}

function setDefaultHistoryRange() {
  const today = new Date();
  document.getElementById("wdFromDate").value = formatDateInput(today);
  document.getElementById("wdToDate").value = formatDateInput(today);
}
function wireHistoryFilters() {
  document.getElementById("wdFromDate").addEventListener("change", applyHistoryFilters);
  document.getElementById("wdToDate").addEventListener("change", applyHistoryFilters);
  document.getElementById("wdTypeFilter").addEventListener("change", applyHistoryFilters);
}
function listenToTransactions() {
  db.collection("cashTransactions").orderBy("createdAt", "desc").limit(2000).onSnapshot(
    (snap) => { allTransactions = snap.docs.map((d) => ({ id: d.id, ...d.data() })); applyHistoryFilters(); },
    (err) => { console.error(err); showToast("Couldn't load transaction history.", "danger"); }
  );
}
function applyHistoryFilters() {
  const fromVal = document.getElementById("wdFromDate").value;
  const toVal = document.getElementById("wdToDate").value;
  const typeVal = document.getElementById("wdTypeFilter").value;
  filteredTransactions = allTransactions.filter((tx) => {
    if (!tx.createdAt) return false;
    const d = tx.createdAt.toDate();
    if (fromVal && d < startOfDay(fromVal)) return false;
    if (toVal && d > endOfDay(toVal)) return false;
    if (typeVal !== "all" && tx.type !== typeVal) return false;
    if (activeBankFilter !== "all" && tx.bankId !== activeBankFilter) return false;
    return true;
  });
  renderHistorySummary();
  renderHistoryTable();
}
function renderHistorySummary() {
  const deposits = filteredTransactions.filter((t) => t.type === "deposit").reduce((sum, t) => sum + t.amount, 0);
  const withdrawals = filteredTransactions.filter((t) => t.type === "withdrawal").reduce((sum, t) => sum + t.amount, 0);
  document.getElementById("wdSummaryDeposits").textContent = formatKsh(deposits);
  document.getElementById("wdSummaryWithdrawals").textContent = formatKsh(withdrawals);
  document.getElementById("wdSummaryCount").textContent = filteredTransactions.length;
}
function historyRowBankOrPool(tx) {
  if (tx.type === "adjustment") return tx.poolType === "float" ? "Float" : "Withdrawal cash";
  return escapeHtml(tx.bankName || "—");
}
function historyRowAmount(tx) {
  if (tx.type === "adjustment") {
    const sign = tx.delta >= 0 ? "+" : "";
    const cls = tx.delta >= 0 ? "change-positive" : "change-negative";
    return `<span class="${cls}">${sign}${formatKsh(tx.delta)}</span>`;
  }
  let base = formatKsh(tx.amount);
  if (tx.type === "withdrawal" && tx.fundedFromSalesCash > 0) base += `<br/><span class="hint">${formatKsh(tx.fundedFromSalesCash)} from today's sales cash</span>`;
  return base;
}
function renderHistoryTable() {
  const tbody = document.getElementById("wdHistoryBody");
  const emptyEl = document.getElementById("wdHistoryEmpty");
  if (filteredTransactions.length === 0) { tbody.innerHTML = ""; emptyEl.classList.remove("hidden"); return; }
  emptyEl.classList.add("hidden");
  tbody.innerHTML = filteredTransactions.map((tx) => {
    const typeLabel = tx.type === "deposit" ? "Deposit" : tx.type === "withdrawal" ? "Withdrawal" : "Adjustment";
    return `<tr>
        <td>${escapeHtml(tx.transactionNumber || "—")}</td>
        <td>${tx.createdAt ? formatDateTime(tx.createdAt.toDate()) : "—"}</td>
        <td><span class="wd-type-badge ${tx.type}">${typeLabel}</span></td>
        <td>${historyRowBankOrPool(tx)}</td>
        <td>${historyRowAmount(tx)}</td>
        <td>${escapeHtml(tx.customerName || tx.reason || "—")}</td>
        <td>${escapeHtml(tx.enteredByName || "—")}</td>
      </tr>`;
  }).join("");
}

function wireExports() {
  document.getElementById("wdExportCsvBtn").addEventListener("click", exportWdCsv);
  document.getElementById("wdExportPdfBtn").addEventListener("click", exportWdPdf);
}
function exportWdCsv() {
  if (filteredTransactions.length === 0) { showToast("No transactions in this range to export.", "warning"); return; }
  const rows = [["Transaction #", "Date", "Type", "Bank/Pool", "Amount", "Customer/Reason", "Entered by"]];
  filteredTransactions.forEach((tx) => rows.push([
    tx.transactionNumber || "", tx.createdAt ? formatDateTime(tx.createdAt.toDate()) : "", tx.type,
    tx.type === "adjustment" ? (tx.poolType === "float" ? "Float" : "Withdrawal cash") : tx.bankName,
    tx.type === "adjustment" ? tx.delta : tx.amount, tx.customerName || tx.reason || "", tx.enteredByName || "",
  ]));
  downloadCsv(`deposits-withdrawals-${document.getElementById("wdFromDate").value}-to-${document.getElementById("wdToDate").value}.csv`, rows);
}
function exportWdPdf() {
  if (filteredTransactions.length === 0) { showToast("No transactions in this range to export.", "warning"); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  const from = document.getElementById("wdFromDate").value;
  const to = document.getElementById("wdToDate").value;
  const deposits = filteredTransactions.filter((t) => t.type === "deposit").reduce((sum, t) => sum + t.amount, 0);
  const withdrawals = filteredTransactions.filter((t) => t.type === "withdrawal").reduce((sum, t) => sum + t.amount, 0);
  doc.setFontSize(16); doc.text("Deposits & Withdrawals", 14, 18);
  doc.setFontSize(10); doc.setTextColor(100);
  doc.text(`Range: ${from} to ${to}`, 14, 25);
  doc.text(`Deposits: ${formatKsh(deposits)}   Withdrawals: ${formatKsh(withdrawals)}   Transactions: ${filteredTransactions.length}`, 14, 31);
  const rows = filteredTransactions.map((tx) => [
    tx.transactionNumber || "—", tx.createdAt ? formatDateTime(tx.createdAt.toDate()) : "",
    tx.type === "deposit" ? "Deposit" : tx.type === "withdrawal" ? "Withdrawal" : "Adjustment",
    tx.type === "adjustment" ? (tx.poolType === "float" ? "Float" : "Withdrawal cash") : tx.bankName,
    formatKsh(tx.type === "adjustment" ? tx.delta : tx.amount), tx.customerName || tx.reason || "—", tx.enteredByName || "",
  ]);
  doc.autoTable({ startY: 37, head: [["Transaction #", "Date", "Type", "Bank/Pool", "Amount", "Customer/Reason", "Entered by"]], body: rows, styles: { fontSize: 8 }, headStyles: { fillColor: [27, 73, 101] } });
  doc.save(`deposits-withdrawals-${from}-to-${to}.pdf`);
}
