const CATEGORY_COLORS = {
  Rent: "var(--rent)",
  Food: "var(--food)",
  Other: "var(--other)",
};

let members = []; // [{id, name}]

function currencyFmt(n) {
  const sign = n < 0 ? "-" : "";
  return sign + "₹" + Math.abs(n).toLocaleString("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 0 });
}

function currentMonthStr() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
}

function getSelectedMonth() {
  return document.getElementById("monthSelect").value || currentMonthStr();
}

async function api(path, options) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

// ---------- Tabs ----------
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(btn.dataset.tab).classList.add("active");
  });
});

// ---------- Month picker ----------
const monthSelect = document.getElementById("monthSelect");
monthSelect.value = currentMonthStr();
monthSelect.addEventListener("change", renderAll);

// ---------- Members ----------
function renderPaidByOptions() {
  const sel = document.getElementById("expPaidBy");
  const previous = sel.value;
  sel.innerHTML = "";
  members.forEach((m) => {
    const opt = document.createElement("option");
    opt.value = m.id;
    opt.textContent = m.name;
    sel.appendChild(opt);
  });
  if (previous) sel.value = previous;
}

function renderMembers() {
  const list = document.getElementById("memberList");
  list.innerHTML = "";
  members.forEach((m) => {
    const li = document.createElement("li");
    const nameSpan = document.createElement("span");
    nameSpan.textContent = m.name;
    const delBtn = document.createElement("button");
    delBtn.className = "btn-danger";
    delBtn.textContent = "Remove";
    delBtn.addEventListener("click", () => removeMember(m.id));
    li.appendChild(nameSpan);
    li.appendChild(delBtn);
    list.appendChild(li);
  });
  renderPaidByOptions();
}

async function removeMember(id) {
  try {
    await api(`/api/members/${id}`, { method: "DELETE" });
    await loadMembers();
    await renderAll();
  } catch (e) {
    alert(e.message);
  }
}

document.getElementById("memberForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = document.getElementById("newMemberName");
  const name = input.value.trim();
  if (!name) return;
  try {
    await api("/api/members", { method: "POST", body: JSON.stringify({ name }) });
    input.value = "";
    await loadMembers();
    await renderAll();
  } catch (err) {
    alert(err.message);
  }
});

async function loadMembers() {
  members = await api("/api/members");
  renderMembers();
}

// ---------- Expenses ----------
document.getElementById("expenseForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const category = document.getElementById("expCategory").value;
  const amount = parseFloat(document.getElementById("expAmount").value);
  const paidBy = document.getElementById("expPaidBy").value;
  const note = document.getElementById("expNote").value.trim();
  const date = document.getElementById("expDate").value;

  if (!amount || amount <= 0 || !paidBy || !date) return;

  try {
    const result = await api("/api/expenses", {
      method: "POST",
      body: JSON.stringify({ category, amount, paid_by: paidBy, note, date }),
    });

    document.getElementById("expAmount").value = "";
    document.getElementById("expNote").value = "";

    monthSelect.value = result.month;
    await renderAll();
  } catch (err) {
    alert(err.message);
  }
});

async function renderExpenseTable() {
  const month = getSelectedMonth();
  const rows = await api(`/api/expenses?month=${encodeURIComponent(month)}`);
  const tbody = document.querySelector("#expenseTable tbody");
  tbody.innerHTML = "";
  document.getElementById("noExpensesHint").style.display = rows.length ? "none" : "block";

  rows.forEach((e) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${e.date}</td>
      <td><span class="cat-tag ${e.category}">${categoryIcon(e.category)} ${e.category}</span></td>
      <td>${e.note || "—"}</td>
      <td>${e.paid_by_name}</td>
      <td>${currencyFmt(e.amount)}</td>
      <td><button class="btn-danger" data-id="${e.id}">✕</button></td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll("button[data-id]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await api(`/api/expenses/${btn.dataset.id}`, { method: "DELETE" });
      await renderAll();
    });
  });
}

function categoryIcon(cat) {
  return { Rent: "🏠", Food: "🍚", Other: "🛒" }[cat] || "";
}

// ---------- Dashboard ----------
function renderSummaryCards(data) {
  const cards = [
    { label: "Total Expense", value: currencyFmt(data.total) },
    { label: "🏠 Rent", value: currencyFmt(data.by_category.Rent) },
    { label: "🍚 Food", value: currencyFmt(data.by_category.Food) },
    { label: "🛒 Other", value: currencyFmt(data.by_category.Other) },
  ];

  const container = document.getElementById("summaryCards");
  container.innerHTML = "";
  cards.forEach((c) => {
    const div = document.createElement("div");
    div.className = "card";
    div.innerHTML = `<div class="label">${c.label}</div><div class="value">${c.value}</div>`;
    container.appendChild(div);
  });
}

function renderCategoryBreakdown(data) {
  const total = data.total;
  const container = document.getElementById("categoryBreakdown");
  container.innerHTML = "";

  if (total === 0) {
    container.innerHTML = '<p class="empty-hint">No expenses recorded for this month.</p>';
    return;
  }

  Object.entries(data.by_category).forEach(([cat, amt]) => {
    const pct = total ? (amt / total) * 100 : 0;
    const row = document.createElement("div");
    row.className = "breakdown-row";
    row.innerHTML = `
      <span class="dot" style="background:${CATEGORY_COLORS[cat]}"></span>
      <span style="min-width:60px">${cat}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${CATEGORY_COLORS[cat]}"></div></div>
      <span class="amt">${currencyFmt(amt)}</span>
    `;
    container.appendChild(row);
  });
}

function renderPersonTable(data) {
  const tbody = document.querySelector("#personTable tbody");
  tbody.innerHTML = "";

  data.balances.forEach((b) => {
    const tr = document.createElement("tr");
    const balClass = b.balance > 0.5 ? "positive" : b.balance < -0.5 ? "negative" : "neutral";
    const balText =
      b.balance > 0.5
        ? `Gets ${currencyFmt(b.balance)}`
        : b.balance < -0.5
        ? `Pays ${currencyFmt(-b.balance)}`
        : "Settled";
    tr.innerHTML = `
      <td>${b.member}</td>
      <td>${currencyFmt(b.paid)}</td>
      <td>${currencyFmt(b.share)}</td>
      <td class="${balClass}">${balText}</td>
    `;
    tbody.appendChild(tr);
  });
}

function renderSettlements(data) {
  const container = document.getElementById("settlements");
  container.innerHTML = "";

  if (!data.settlements.length) {
    container.innerHTML = '<p class="empty-hint">Everyone is settled up for this month. 🎉</p>';
    return;
  }

  data.settlements.forEach((t) => {
    const row = document.createElement("div");
    row.className = "settlement-row";
    row.innerHTML = `
      <span>${t.from}</span>
      <span class="arrow">→</span>
      <span>${t.to}</span>
      <span class="amt">${currencyFmt(t.amount)}</span>
    `;
    container.appendChild(row);
  });
}

async function renderDashboard() {
  const month = getSelectedMonth();
  const data = await api(`/api/dashboard?month=${encodeURIComponent(month)}`);
  renderSummaryCards(data);
  renderCategoryBreakdown(data);
  renderPersonTable(data);
  renderSettlements(data);
}

// ---------- Render all ----------
async function renderAll() {
  await renderDashboard();
  await renderExpenseTable();
  renderPaidByOptions();
}

// init
document.getElementById("expDate").value = new Date().toISOString().slice(0, 10);
(async function init() {
  await loadMembers();
  await renderAll();
})();
