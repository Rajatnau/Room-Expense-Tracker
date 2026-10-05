import sqlite3
from datetime import date
from pathlib import Path

from flask import Flask, g, jsonify, render_template, request

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "expenses.db"
DEFAULT_MEMBERS = ["Rajat", "Solai", "Jogeswara"]
CATEGORIES = {"Rent", "Food", "Other"}

app = Flask(__name__)
app.json.sort_keys = False


def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


@app.teardown_appcontext
def close_db(exception=None):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    with sqlite3.connect(DB_PATH) as db:
        db.execute(
            """CREATE TABLE IF NOT EXISTS members (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT UNIQUE NOT NULL
            )"""
        )
        db.execute(
            """CREATE TABLE IF NOT EXISTS expenses (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                month TEXT NOT NULL,
                category TEXT NOT NULL,
                amount REAL NOT NULL,
                paid_by INTEGER NOT NULL REFERENCES members(id),
                note TEXT,
                date TEXT NOT NULL
            )"""
        )
        existing = db.execute("SELECT COUNT(*) FROM members").fetchone()[0]
        if existing == 0:
            db.executemany(
                "INSERT INTO members (name) VALUES (?)",
                [(name,) for name in DEFAULT_MEMBERS],
            )
        db.commit()


# ---------- Pages ----------
@app.route("/")
def index():
    return render_template("index.html")


# ---------- Members API ----------
@app.route("/api/members", methods=["GET"])
def list_members():
    db = get_db()
    rows = db.execute("SELECT id, name FROM members ORDER BY id").fetchall()
    return jsonify([dict(r) for r in rows])


@app.route("/api/members", methods=["POST"])
def add_member():
    data = request.get_json(force=True) or {}
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "Name is required"}), 400

    db = get_db()
    exists = db.execute("SELECT 1 FROM members WHERE name = ?", (name,)).fetchone()
    if exists:
        return jsonify({"error": "That member already exists"}), 400

    cur = db.execute("INSERT INTO members (name) VALUES (?)", (name,))
    db.commit()
    return jsonify({"id": cur.lastrowid, "name": name}), 201


@app.route("/api/members/<int:member_id>", methods=["DELETE"])
def remove_member(member_id):
    db = get_db()
    count = db.execute("SELECT COUNT(*) FROM members").fetchone()[0]
    if count <= 1:
        return jsonify({"error": "At least one member is required"}), 400

    used = db.execute(
        "SELECT 1 FROM expenses WHERE paid_by = ?", (member_id,)
    ).fetchone()
    if used:
        return jsonify({"error": "Cannot remove a member referenced in existing expenses"}), 400

    db.execute("DELETE FROM members WHERE id = ?", (member_id,))
    db.commit()
    return "", 204


# ---------- Expenses API ----------
@app.route("/api/expenses", methods=["GET"])
def list_expenses():
    month = request.args.get("month", date.today().strftime("%Y-%m"))
    db = get_db()
    rows = db.execute(
        """SELECT e.id, e.month, e.category, e.amount, e.note, e.date,
                  m.id AS paid_by_id, m.name AS paid_by_name
           FROM expenses e
           JOIN members m ON m.id = e.paid_by
           WHERE e.month = ?
           ORDER BY e.date, e.id""",
        (month,),
    ).fetchall()
    return jsonify([dict(r) for r in rows])


@app.route("/api/expenses", methods=["POST"])
def add_expense():
    data = request.get_json(force=True) or {}
    category = data.get("category")
    amount = data.get("amount")
    paid_by = data.get("paid_by")
    note = (data.get("note") or "").strip()
    expense_date = data.get("date")

    if category not in CATEGORIES:
        return jsonify({"error": "Invalid category"}), 400
    try:
        amount = float(amount)
    except (TypeError, ValueError):
        return jsonify({"error": "Invalid amount"}), 400
    if amount <= 0:
        return jsonify({"error": "Amount must be positive"}), 400
    if not expense_date:
        return jsonify({"error": "Date is required"}), 400
    try:
        paid_by = int(paid_by)
    except (TypeError, ValueError):
        return jsonify({"error": "Invalid payer"}), 400

    db = get_db()
    member = db.execute("SELECT id FROM members WHERE id = ?", (paid_by,)).fetchone()
    if not member:
        return jsonify({"error": "Unknown member"}), 400

    month = expense_date[:7]
    cur = db.execute(
        """INSERT INTO expenses (month, category, amount, paid_by, note, date)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (month, category, amount, paid_by, note, expense_date),
    )
    db.commit()
    return jsonify({"id": cur.lastrowid, "month": month}), 201


@app.route("/api/expenses/<int:expense_id>", methods=["DELETE"])
def remove_expense(expense_id):
    db = get_db()
    db.execute("DELETE FROM expenses WHERE id = ?", (expense_id,))
    db.commit()
    return "", 204


# ---------- Dashboard API ----------
@app.route("/api/dashboard", methods=["GET"])
def dashboard():
    month = request.args.get("month", date.today().strftime("%Y-%m"))
    db = get_db()

    members = db.execute("SELECT id, name FROM members ORDER BY id").fetchall()
    expenses = db.execute(
        "SELECT category, amount, paid_by FROM expenses WHERE month = ?", (month,)
    ).fetchall()

    total = sum(e["amount"] for e in expenses)
    by_category = {"Rent": 0.0, "Food": 0.0, "Other": 0.0}
    for e in expenses:
        by_category[e["category"]] += e["amount"]

    share = total / len(members) if members else 0.0
    paid = {m["id"]: 0.0 for m in members}
    for e in expenses:
        paid[e["paid_by"]] = paid.get(e["paid_by"], 0.0) + e["amount"]

    balances = [
        {
            "member_id": m["id"],
            "member": m["name"],
            "paid": paid.get(m["id"], 0.0),
            "share": share,
            "balance": paid.get(m["id"], 0.0) - share,
        }
        for m in members
    ]

    creditors = sorted(
        [dict(member=b["member"], amt=b["balance"]) for b in balances if b["balance"] > 0.5],
        key=lambda x: -x["amt"],
    )
    debtors = sorted(
        [dict(member=b["member"], amt=-b["balance"]) for b in balances if b["balance"] < -0.5],
        key=lambda x: -x["amt"],
    )

    settlements = []
    i = j = 0
    while i < len(debtors) and j < len(creditors):
        pay = min(debtors[i]["amt"], creditors[j]["amt"])
        settlements.append({"from": debtors[i]["member"], "to": creditors[j]["member"], "amount": pay})
        debtors[i]["amt"] -= pay
        creditors[j]["amt"] -= pay
        if debtors[i]["amt"] < 0.5:
            i += 1
        if creditors[j]["amt"] < 0.5:
            j += 1

    return jsonify(
        {
            "month": month,
            "total": total,
            "by_category": by_category,
            "share": share,
            "balances": balances,
            "settlements": settlements,
        }
    )


init_db()

if __name__ == "__main__":
    app.run(debug=True, port=5000)
