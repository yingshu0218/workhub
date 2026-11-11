var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/commands/core.ts
var core_exports = {};
__export(core_exports, {
  BUSINESS_TABLES: () => BUSINESS_TABLES,
  checkCommand: () => checkCommand,
  fail: () => fail,
  financeTotals: () => financeTotals,
  minorUnits: () => minorUnits,
  stable: () => stable,
  validateRecord: () => validateRecord
});
module.exports = __toCommonJS(core_exports);
var BUSINESS_TABLES = [
  "workspaces",
  "customers",
  "interactions",
  "ledgers",
  "transactions",
  "todos",
  "todoLists",
  "notes",
  "noteFolders",
  "quickNotes",
  "projects",
  "projectMilestones",
  "habits",
  "habitLogs",
  "trophies",
  "attachments",
  "moduleConfigs",
  "customerGroups",
  "links"
];
function stable(value) {
  if (value === void 0 || value === null) return "null";
  if (Array.isArray(value)) return "[" + value.map(stable).join(",") + "]";
  if (typeof value === "object") return "{" + Object.keys(value).sort().map((k) => JSON.stringify(k) + ":" + stable(value[k])).join(",") + "}";
  return JSON.stringify(value);
}
function fail(code, detail) {
  throw new Error(code + ": " + detail);
}
function minorUnits(value) {
  const text = String(value);
  if (!/^-?\d+(\.\d{1,2})?$/.test(text)) return fail("MONEY_PRECISION", "\u91D1\u989D\u987B\u4E3A\u6700\u591A\u4E24\u4F4D\u5C0F\u6570\uFF0C\u4E0D\u80FD\u9759\u9ED8\u820D\u5165\uFF1A" + text);
  const negative = text[0] === "-";
  const parts = (negative ? text.slice(1) : text).split(".");
  const cents = Number(parts[0]) * 100 + Number(((parts[1] || "") + "00").slice(0, 2));
  if (!Number.isSafeInteger(cents)) return fail("MONEY_RANGE", "\u91D1\u989D\u8D85\u51FA\u5B89\u5168\u6574\u6570\u8303\u56F4");
  return negative ? -cents : cents;
}
function checkCommand(c) {
  if (!c || c.protocol !== 1) fail("UPGRADE_REQUIRED", "\u8BF7\u5347\u7EA7\u5230\u547D\u4EE4\u534F\u8BAE 1");
  if (!/^[A-Za-z0-9:_-]{8,128}$/.test(c.requestId || "")) fail("INVALID_REQUEST_ID", "\u9700\u8981\u7A33\u5B9A\u8BF7\u6C42\u6807\u8BC6");
  if (!c.generation) fail("GENERATION_REQUIRED", "\u5148\u83B7\u53D6\u6570\u636E\u4E16\u4EE3");
  if (!Array.isArray(c.reads) || !Array.isArray(c.scans) || !Array.isArray(c.writes) || c.writes.length > 500 || c.reads.length > 2e4 || c.scans.length > 24) fail("LIMIT_EXCEEDED", "\u547D\u4EE4\u89C4\u6A21\u8D85\u9650");
  const seen = {};
  for (const w of c.writes) {
    if (!BUSINESS_TABLES.includes(w.table) || !w.id || w.id.length > 240 || !["put", "delete"].includes(w.kind)) fail("INVALID_WRITE", "\u96C6\u5408\u3001\u6807\u8BC6\u6216\u52A8\u4F5C\u975E\u6CD5");
    const key = w.table + "/" + w.id;
    if (seen[key]) fail("INVALID_WRITE", "\u91CD\u590D\u76EE\u6807\uFF1A" + key);
    seen[key] = true;
    if (!c.reads.some((r) => r.table === w.table && r.id === w.id)) fail("VERSION_REQUIRED", key);
    if (w.kind === "put" && (!w.value || w.value.id !== w.id)) fail("INVALID_WRITE", key);
  }
  for (const r of c.reads) if (!BUSINESS_TABLES.includes(r.table)) fail("INVALID_READ", r.table);
  for (const s of c.scans) if (!BUSINESS_TABLES.includes(s.table) || !Array.isArray(s.versions) || s.versions.length > 2e4) fail("INVALID_SCAN", s.table);
}
function validateRecord(table, next, prev, get) {
  if ((prev == null ? void 0 : prev.deleted) && !next.deleted && !next.restoredAt) fail("DELETED", "\u8BF7\u4ECE\u56DE\u6536\u7AD9\u663E\u5F0F\u6062\u590D\uFF1A" + next.id);
  if (next.deleted) return;
  const requireRef = (target, value) => {
    if (value === void 0 || value === null || value === "") return;
    if (typeof value !== "string") fail("INVALID_REFERENCE", target);
    const ref = get(target, value);
    if (!ref || ref.deleted) fail("REFERENCE_NOT_FOUND", target + "/" + String(value));
  };
  const refs = {
    transactions: { ledgerId: "ledgers" },
    interactions: { customerId: "customers", projectId: "projects" },
    todos: { customerId: "customers", projectId: "projects" },
    projects: { customerId: "customers" },
    projectMilestones: { projectId: "projects" },
    habitLogs: { habitId: "habits" }
  };
  for (const field of Object.keys(refs[table] || {})) requireRef(refs[table][field], next[field]);
  if (table === "links") {
    for (const side of ["from", "to"]) {
      const target = String(next[side + "Type"] || "");
      if (!BUSINESS_TABLES.includes(target)) fail("INVALID_REFERENCE", target);
      if (!next[side + "Id"]) fail("INVALID_REFERENCE", side);
      requireRef(target, next[side + "Id"]);
    }
  }
  if (table === "transactions") {
    if (!next.ledgerId || !["income", "expense"].includes(String(next.type)) || !String(next.summary || "").trim()) fail("INVALID_TRANSACTION", next.id);
    const cents = minorUnits(next.amount);
    if (cents <= 0) fail("INVALID_TRANSACTION", "\u91D1\u989D\u987B\u4E3A\u6B63\u6570");
    if (next.amountMinor !== void 0 && next.amountMinor !== cents) fail("MONEY_MISMATCH", next.id);
    const ledger = get("ledgers", String(next.ledgerId));
    const currency = String((prev == null ? void 0 : prev.currency) || next.currency || ledger.currency);
    if (!["CNY", "USD", "EUR"].includes(currency) || currency !== ledger.currency || (prev == null ? void 0 : prev.currency) && next.currency && prev.currency !== next.currency) fail("CURRENCY_CONFLICT", "\u8BF7\u663E\u5F0F\u8FC1\u79FB\u5E01\u79CD\u6216\u9009\u62E9\u540C\u5E01\u79CD\u8D26\u672C");
    next.amountMinor = cents;
    next.currency = currency;
  }
  if (table === "ledgers") {
    if (!["CNY", "USD", "EUR"].includes(String(next.currency))) fail("INVALID_CURRENCY", next.id);
    next.openingBalanceMinor = minorUnits(next.openingBalance || 0);
  }
  if (table === "todos" && !String(next.title || "").trim()) fail("INVALID_TODO", next.id);
  if (table === "customers" && !String(next.name || "").trim()) fail("INVALID_CUSTOMER", next.id);
  if (table === "interactions" && (!next.customerId && !next.projectId || !String(next.content || "").trim())) fail("INVALID_INTERACTION", next.id);
}
function financeTotals(rows) {
  var _a;
  const out = {};
  const seen = {};
  for (const r of rows) {
    if (r.deleted || seen[r.id]) continue;
    seen[r.id] = true;
    const currency = String(r.currency || "");
    if (!["CNY", "USD", "EUR"].includes(currency)) fail("CURRENCY_REQUIRED", r.id);
    const amount = (_a = r.amountMinor) != null ? _a : minorUnits(r.amount);
    if (!Number.isSafeInteger(amount)) fail("MONEY_PRECISION", r.id);
    const group = out[currency] || (out[currency] = { incomeMinor: 0, expenseMinor: 0, count: 0 });
    if (r.type === "income") group.incomeMinor += Number(amount);
    else if (r.type === "expense") group.expenseMinor += Number(amount);
    group.count++;
  }
  return out;
}
