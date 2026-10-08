/* ==========================================================================
   CREDIT.JS — Customer Credit page logic
   --------------------------------------------------------------------------
   A customer's "due date" is tracked as the due date of their OLDEST still-
   open credit sale (nextDueDate on the customer doc). It's an approximation
   rather than true per-sale FIFO allocation — good enough for a small shop's
   reminder purposes, much simpler to maintain than tracking which specific
   sale a repayment cleared.
   ========================================================================== */

let creditUser = null;
let allCustomers = [];
let currentLedgerCustomer = null;
let ledgerEntries = [];
let selectedRepayMethod = "cash";

(async function init() {
  creditUser = await requireAuth(["seller", "manager"]);
  wireCustomerModal();
  wireLedgerModal();
  wireRepayModal();
  wireOverdueModal();
  listenToCustomers();
})();

/* ----- Customers list ---------------------------------------------------------- */
function listenToCustomers() {
  db.collection("customers").onSnapshot(
    (snap) => {
      allCustomers = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      allCustomers.sort((a, b) => (b.balanceOwed || 0) - (a.balanceOwed || 0));
      renderCustomerList();
      renderTotalOutstanding();
      checkOverdue();
    },
    (err) => { console.error(err); showToast("Couldn't load customers.", "danger"); }
  );
}

function renderTotalOutstanding() {
  const total = allCustomers.reduce((sum, c) => sum + (c.balanceOwed || 0), 0);
  document.getElementById("totalOutstandingValue").textContent = formatKsh(total);
}

function isOverdue(customer) {
  if (!(customer.balanceOwed > 0) || !customer.nextDueDate) return false;
  return customer.nextDueDate <= formatDateInput(new Date());
}

function renderCustomerList() {
  const wrap = document.getElementById("customerList");
  const emptyEl = document.getElementById("customerEmpty");
  const search = document.getElementById("customerSearchInput").value.trim().toLowerCase();

  let list = allCustomers;
  if (search) list = list.filter((c) => c.name.toLowerCase().includes(search) || (c.phone || "").includes(search));

  if (list.length === 0) {
    wrap.innerHTML = "";
    emptyEl.classList.remove("hidden");
    return;
  }
  emptyEl.classList.add("hidden");

  wrap.innerHTML = list
    .map((c) => {
      const balance = c.balanceOwed || 0;
      const overdue = isOverdue(c);
      return `
      <div class="customer-item" data-customer-id="${c.id}">
        <div>
          <span class="customer-item-name">${escapeHtml(c.name)}</span>
          ${overdue ? `<span class="overdue-badge">Overdue</span>` : ""}
          ${c.phone ? `<div class="customer-item-phone">${escapeHtml(c.phone)}</div>` : ""}
        </div>
        <span class="customer-item-balance ${balance === 0 ? "clear" : ""}">${formatKsh(balance)}</span>
      </div>`;
    })
    .join("");
}

document.getElementById("customerSearchInput").addEventListener("input", debounce(renderCustomerList, 150));
document.getElementById("customerList").addEventListener("click", (e) => {
  const row = e.target.closest(".customer-item");
  if (!row) return;
  const customer = allCustomers.find((c) => c.id === row.dataset.customerId);
  if (customer) openLedger(customer);
});

/* ----- Add customer modal -------------------------------------------------------- */
function wireCustomerModal() {
  document.getElementById("addCustomerBtn").addEventListener("click", () => {
    document.getElementById("newCustomerNameInput").value = "";
    document.getElementById("newCustomerPhoneInput").value = "";
    document.getElementById("customerModalOverlay").classList.remove("hidden");
  });
  document.getElementById("customerModalClose").addEventListener("click", closeCustomerModal);
  document.getElementById("customerCancelBtn").addEventListener("click", closeCustomerModal);
  function closeCustomerModal() { document.getElementById("customerModalOverlay").classList.add("hidden"); }

  document.getElementById("customerForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = document.getElementById("newCustomerNameInput").value.trim();
    const phone = document.getElementById("newCustomerPhoneInput").value.trim();
    if (!name) return;
    try {
      await db.collection("customers").add({ name, phone: phone || null, balanceOwed: 0, nextDueDate: null, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
      showToast("Customer added.", "success");
      closeCustomerModal();
    } catch (err) {
      console.error(err);
      showToast("Couldn't add customer.", "danger");
    }
  });
}

/* ----- Ledger modal ---------------------------------------------------------------- */
function wireLedgerModal() {
  document.getElementById("ledgerModalClose").addEventListener("click", closeLedgerModal);
  document.getElementById("openRepayBtn").addEventListener("click", openRepayModal);
}

function closeLedgerModal() {
  document.getElementById("ledgerModalOverlay").classList.add("hidden");
  currentLedgerCustomer = null;
}

function openLedger(customer) {
  currentLedgerCustomer = customer;
  document.getElementById("ledgerModalTitle").textContent = customer.name;
  document.getElementById("ledgerBalanceValue").textContent = formatKsh(customer.balanceOwed || 0);

  const dueHint = document.getElementById("ledgerDueHint");
  if (customer.balanceOwed > 0 && customer.nextDueDate) {
    const overdue = isOverdue(customer);
    dueHint.textContent = overdue ? `Overdue since ${customer.nextDueDate}` : `Due ${customer.nextDueDate}`;
    dueHint.style.color = overdue ? "var(--color-danger)" : "var(--color-text-muted)";
  } else {
    dueHint.textContent = "";
  }

  document.getElementById("ledgerEntries").innerHTML = `<div class="skeleton" style="height:60px;"></div>`;
  document.getElementById("ledgerModalOverlay").classList.remove("hidden");

  db.collection("creditLedger")
    .where("customerId", "==", customer.id)
    .orderBy("createdAt", "desc")
    .limit(200)
    .get()
    .then((snap) => {
      ledgerEntries = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      renderLedgerEntries();
    })
    .catch((err) => {
      console.error(err);
      document.getElementById("ledgerEntries").innerHTML = `<p class="hint">Couldn't load history.</p>`;
    });
}

function renderLedgerEntries() {
  const wrap = document.getElementById("ledgerEntries");
  if (ledgerEntries.length === 0) {
    wrap.innerHTML = `<p class="hint">No activity yet.</p>`;
    return;
  }
  wrap.innerHTML = ledgerEntries
    .map((e) => {
      const dateStr = e.createdAt ? formatDateTime(e.createdAt.toDate()) : "Just now";
      if (e.type === "sale") {
        return `
        <div class="ledger-entry">
          <div class="ledger-entry-info"><span>Sold on credit${e.receiptNumber ? ` — #${e.receiptNumber}` : ""}</span><span class="ledger-entry-date">${dateStr}</span></div>
          <span class="ledger-entry-amount sale">+${formatKsh(e.amount)}</span>
        </div>`;
      }
      const methodLabel = e.method === "cash" ? "Cash" : e.method === "shop_mpesa" ? "Shop M-Pesa" : "Manager M-Pesa";
      return `
      <div class="ledger-entry">
        <div class="ledger-entry-info"><span>Repayment — ${escapeHtml(methodLabel)}</span><span class="ledger-entry-date">${dateStr} · ${escapeHtml(e.enteredByName || "")}</span></div>
        <span class="ledger-entry-amount repayment">−${formatKsh(e.amount)}</span>
      </div>`;
    })
    .join("");
}

/* ----- Record repayment modal --------------------------------------------------------- */
function wireRepayModal() {
  document.getElementById("repayModalClose").addEventListener("click", closeRepayModal);
  document.getElementById("repayCancelBtn").addEventListener("click", closeRepayModal);
  document.querySelectorAll("[data-repay-method]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("[data-repay-method]").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      selectedRepayMethod = btn.dataset.repayMethod;
    });
  });
  document.getElementById("repayForm").addEventListener("submit", saveRepayment);
}

function openRepayModal() {
  if (!currentLedgerCustomer) return;
  selectedRepayMethod = "cash";
  document.querySelectorAll("[data-repay-method]").forEach((b) => b.classList.toggle("active", b.dataset.repayMethod === "cash"));
  document.getElementById("repayCustomerHint").textContent = `${currentLedgerCustomer.name} owes ${formatKsh(currentLedgerCustomer.balanceOwed || 0)}.`;
  document.getElementById("repayAmountInput").value = currentLedgerCustomer.balanceOwed || "";
  document.getElementById("repayModalOverlay").classList.remove("hidden");
}
function closeRepayModal() { document.getElementById("repayModalOverlay").classList.add("hidden"); }

async function saveRepayment(e) {
  e.preventDefault();
  const customer = currentLedgerCustomer;
  const amount = roundKsh(parseFloat(document.getElementById("repayAmountInput").value) || 0);
  if (amount <= 0) { showToast("Enter an amount.", "warning"); return; }
  if (amount > (customer.balanceOwed || 0) + 0.0001) { showToast(`That's more than they owe (${formatKsh(customer.balanceOwed || 0)}).`, "warning"); return; }

  const customerRef = db.collection("customers").doc(customer.id);
  try {
    await db.runTransaction(async (t) => {
      const doc = await t.get(customerRef);
      if (!doc.exists) throw new Error("Customer no longer exists.");
      const current = doc.data().balanceOwed || 0;
      const newBalance = roundKsh(current - amount);
      t.update(customerRef, { balanceOwed: Math.max(0, newBalance), nextDueDate: newBalance <= 0 ? null : doc.data().nextDueDate });
      t.set(db.collection("creditLedger").doc(), {
        type: "repayment", customerId: customer.id, customerName: customer.name, amount, method: selectedRepayMethod,
        enteredBy: creditUser.uid, enteredByName: creditUser.displayName, enteredByRole: creditUser.role,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
    });
    showToast("Repayment recorded.", "success");
    closeRepayModal();
    closeLedgerModal();
  } catch (err) {
    console.error(err);
    showToast(err.message || "Couldn't record repayment.", "danger");
  }
}

/* ----- Overdue alert --------------------------------------------------------------------- */
function wireOverdueModal() {
  document.getElementById("overdueDismiss").addEventListener("click", () => {
    document.getElementById("overdueOverlay").classList.add("hidden");
  });
}

let overdueAlertShownThisLoad = false;
function checkOverdue() {
  if (overdueAlertShownThisLoad) return;
  const overdueCustomers = allCustomers.filter(isOverdue);
  if (overdueCustomers.length === 0) return;
  overdueAlertShownThisLoad = true;

  document.getElementById("overdueList").innerHTML = overdueCustomers
    .map((c) => `<li>${escapeHtml(c.name)} — ${formatKsh(c.balanceOwed)} (due ${c.nextDueDate})</li>`)
    .join("");
  document.getElementById("overdueMessage").textContent =
    overdueCustomers.length === 1 ? "One customer's credit is now due." : `${overdueCustomers.length} customers' credit is now due.`;
  document.getElementById("overdueOverlay").classList.remove("hidden");
}
