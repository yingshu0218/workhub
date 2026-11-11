"use strict";
var __defProp = Object.defineProperty;
var __defProps = Object.defineProperties;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropDescs = Object.getOwnPropertyDescriptors;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getOwnPropSymbols = Object.getOwnPropertySymbols;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __propIsEnum = Object.prototype.propertyIsEnumerable;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __spreadValues = (a, b) => {
  for (var prop in b || (b = {}))
    if (__hasOwnProp.call(b, prop))
      __defNormalProp(a, prop, b[prop]);
  if (__getOwnPropSymbols)
    for (var prop of __getOwnPropSymbols(b)) {
      if (__propIsEnum.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    }
  return a;
};
var __spreadProps = (a, b) => __defProps(a, __getOwnPropDescs(b));
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
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

// src/commands/personal.ts
var personal_exports = {};
__export(personal_exports, {
  TABLE_DOMAIN: () => TABLE_DOMAIN,
  activityLinkId: () => activityLinkId,
  eventFeed: () => eventFeed,
  financeRows: () => financeRows,
  financeSelection: () => financeSelection,
  financeTotals: () => financeTotals,
  otherEndpoint: () => other,
  parseTime: () => parseTime,
  personalLinks: () => links,
  pickFields: () => pick,
  planPersonal: () => planPersonal,
  projectRecord: () => projectRecord,
  rangeEnd: () => rangeEnd,
  recordPath: () => recordPath,
  refOf: () => refOf,
  resolvePersonal: () => resolvePersonal,
  stable: () => stable,
  taskRows: () => taskRows
});
module.exports = __toCommonJS(personal_exports);

// src/sync/remoteNormalize.ts
function sha256ToBase36_15(input) {
  const bytes = [];
  for (const character of input) {
    let c = character.codePointAt(0);
    if (c >= 55296 && c <= 57343) c = 65533;
    if (c < 128) bytes.push(c);
    else if (c < 2048) bytes.push(192 | c >> 6, 128 | c & 63);
    else if (c < 65536) bytes.push(224 | c >> 12, 128 | c >> 6 & 63, 128 | c & 63);
    else bytes.push(240 | c >> 18, 128 | c >> 12 & 63, 128 | c >> 6 & 63, 128 | c & 63);
  }
  const utf8 = new Uint8Array(bytes);
  const H = [
    1779033703,
    3144134277,
    1013904242,
    2773480762,
    1359893119,
    2600822924,
    528734635,
    1541459225
  ];
  const K = [
    1116352408,
    1899447441,
    3049323471,
    3921009573,
    961987163,
    1508970993,
    2453635748,
    2870763221,
    3624381080,
    310598401,
    607225278,
    1426881987,
    1925078388,
    2162078206,
    2614888103,
    3248222580,
    3835390401,
    4022224774,
    264347078,
    604807628,
    770255983,
    1249150122,
    1555081692,
    1996064986,
    2554220882,
    2821834349,
    2952996808,
    3210313671,
    3336571891,
    3584528711,
    113926993,
    338241895,
    666307205,
    773529912,
    1294757372,
    1396182291,
    1695183700,
    1986661051,
    2177026350,
    2456956037,
    2730485921,
    2820302411,
    3259730800,
    3345764771,
    3516065817,
    3600352804,
    4094571909,
    275423344,
    430227734,
    506948616,
    659060556,
    883997877,
    958139571,
    1322822218,
    1537002063,
    1747873779,
    1955562222,
    2024104815,
    2227730452,
    2361852424,
    2428436474,
    2756734187,
    3204031479,
    3329325298
  ];
  const rotr = (x, n) => x >>> n | x << 32 - n;
  const l = utf8.length;
  const bitLen = l * 8;
  const padded = new Uint8Array(((l + 8 >> 6) + 1) * 64);
  padded.set(utf8);
  padded[l] = 128;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 4, bitLen);
  const w = new Array(64);
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ w[i - 15] >>> 3;
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ w[i - 2] >>> 10;
      w[i] = w[i - 16] + s0 + w[i - 7] + s1 | 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = e & f ^ ~e & g;
      const t1 = h + S1 + ch + K[i] + w[i] | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = a & b ^ a & c ^ b & c;
      const t2 = S0 + maj | 0;
      h = g;
      g = f;
      f = e;
      e = d + t1 | 0;
      d = c;
      c = b;
      b = a;
      a = t1 + t2 | 0;
    }
    for (let i = 0; i < 8; i++) H[i] = H[i] + [a, b, c, d, e, f, g, h][i] | 0;
  }
  const hex = H.map((x) => (x >>> 0).toString(16).padStart(8, "0")).join("");
  const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
  let s = "";
  let digits = hex.split("").map((c) => parseInt(c, 16));
  while (digits.length) {
    let remainder = 0;
    const quotient = [];
    for (const digit of digits) {
      const value = remainder * 16 + digit;
      const next = Math.floor(value / 36);
      if (quotient.length || next) quotient.push(next);
      remainder = value % 36;
    }
    s = alphabet[remainder] + s;
    digits = quotient;
  }
  return s.padStart(15, "0").slice(0, 15);
}

// src/commands/core.ts
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
  "links",
  "activities"
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
  const text2 = String(value);
  if (!/^-?\d+(\.\d{1,2})?$/.test(text2)) return fail("MONEY_PRECISION", "\u91D1\u989D\u987B\u4E3A\u6700\u591A\u4E24\u4F4D\u5C0F\u6570\uFF0C\u4E0D\u80FD\u9759\u9ED8\u820D\u5165\uFF1A" + text2);
  const negative = text2[0] === "-";
  const parts = (negative ? text2.slice(1) : text2).split(".");
  const cents = Number(parts[0]) * 100 + Number(((parts[1] || "") + "00").slice(0, 2));
  if (!Number.isSafeInteger(cents)) return fail("MONEY_RANGE", "\u91D1\u989D\u8D85\u51FA\u5B89\u5168\u6574\u6570\u8303\u56F4");
  return negative ? -cents : cents;
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
    if (!Number.isSafeInteger(group.incomeMinor) || !Number.isSafeInteger(group.expenseMinor)) fail("MONEY_RANGE", "\u6C47\u603B\u8D85\u51FA\u5B89\u5168\u6574\u6570\u8303\u56F4\uFF1A" + currency);
    group.count++;
  }
  return out;
}

// src/repositories/linkId.ts
function canonicalEndpoints(from, to, kind) {
  if (kind !== "relation") return [from, to];
  return from.id <= to.id ? [from, to] : [to, from];
}
function discriminator(kind, meta) {
  var _a, _b;
  if (kind !== "relation") return "";
  return `${(_a = meta == null ? void 0 : meta.label) != null ? _a : ""}#${(_b = meta == null ? void 0 : meta.category) != null ? _b : ""}`;
}
function buildLinkId(from, to, kind, meta) {
  const [f, t] = canonicalEndpoints(from, to, kind);
  return `lk-${sha256ToBase36_15(`${f.type}:${f.id}|${t.type}:${t.id}|${kind}|${discriminator(kind, meta)}`)}`;
}

// src/commands/personal.ts
var TABLE_DOMAIN = { activities: "activity", customers: "crm", projects: "project", todos: "todo", transactions: "fin", ledgers: "fin", notes: "note", attachments: "attachment", links: "link", habits: "habit" };
function recordPath(table, id) {
  const value = encodeURIComponent(id);
  return table === "activities" ? "/activities/" + value : table === "operations" ? "/operations/" + value : table === "todos" ? "/todo?focus=" + value : table === "transactions" ? "/finance?focus=" + value : table === "customers" ? "/crm/" + value : table === "projects" ? "/projects/" + value : table === "notes" ? "/notes/" + value : "";
}
function refOf(table, r) {
  return { table, id: r.id, revision: Number(r.rev || 0), path: recordPath(table, r.id) };
}
function text(v, max = 1e3) {
  return typeof v === "string" ? v.slice(0, max) : "";
}
function strings(v, max = 50) {
  if (v == null) return [];
  if (!Array.isArray(v) || v.length > max || v.some((x) => typeof x !== "string" || !x || x.length > 240)) fail("INVALID_LIST", "\u9700\u8981\u6709\u9650\u6807\u8BC6/\u6807\u7B7E\u6570\u7EC4");
  return [...new Set(v)];
}
function object(v) {
  if (!v || typeof v !== "object" || Array.isArray(v)) fail("INVALID_INPUT", "\u9700\u8981\u7ED3\u6784\u5316\u5BF9\u8C61");
  return v;
}
function list(v, max = 50) {
  if (v == null) return [];
  if (!Array.isArray(v) || v.length > max) fail("LIMIT_EXCEEDED", "\u52A8\u4F5C\u6570\u7EC4\u8D85\u9650");
  return v.map(object);
}
function requireText(v, label, max = 1e3) {
  const s = text(v, max + 1).trim();
  if (!s || s.length > max) fail("INVALID_INPUT", label);
  return s;
}
function parseTime(v, zone = "Asia/Shanghai") {
  if (typeof v === "number" && Number.isFinite(v) && v > 0 && v <= 864e13) return v;
  if (typeof v !== "string") return fail("INVALID_DATE", "\u8BF7\u660E\u786E\u53D1\u751F\u65E5\u671F\u4E0E\u65F6\u533A");
  const parts = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2}))?$/.exec(v);
  if (!parts) return fail("INVALID_DATE", "\u65E5\u671F\u6216\u504F\u79FB\u683C\u5F0F\u4E0D\u5408\u6CD5\uFF1A" + v);
  const year = Number(parts[1]), month = Number(parts[2]), day = Number(parts[3]), days = [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (!year || month < 1 || month > 12 || day < 1 || day > days[month - 1] || Number(parts[4] || 0) > 23 || Number(parts[5] || 0) > 59 || Number(parts[6] || 0) > 59) return fail("INVALID_DATE", "\u65E5\u5386\u65E5\u671F\u4E0D\u5408\u6CD5\uFF1A" + v);
  if (parts[8] && parts[8] !== "Z") {
    const offset = parts[8].slice(1).split(":").map(Number);
    if (offset[0] > 14 || offset[1] > 59 || offset[0] === 14 && offset[1] !== 0) return fail("INVALID_DATE", "\u65F6\u533A\u504F\u79FB\u4E0D\u5408\u6CD5");
  }
  let input = v;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    if (!["Asia/Shanghai", "UTC"].includes(zone)) return fail("DATE_OFFSET_REQUIRED", "\u6B64\u65F6\u533A\u7684\u65E5\u671F\u9700\u63D0\u4F9B\u660E\u786E UTC \u504F\u79FB");
    input += zone === "UTC" ? "T00:00:00Z" : "T00:00:00+08:00";
  } else if (!/(Z|[+-]\d\d:\d\d)$/.test(v)) return fail("DATE_OFFSET_REQUIRED", "\u65E5\u671F\u65F6\u95F4\u5FC5\u987B\u542B UTC \u504F\u79FB");
  const n = Date.parse(input);
  if (!Number.isFinite(n)) return fail("INVALID_DATE", v);
  return n;
}
function rangeEnd(v, zone = "Asia/Shanghai") {
  return parseTime(v, zone) + (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? 86399999 : 0);
}
function live(h, table, id) {
  if (!h.can(table)) fail("FORBIDDEN", table);
  const r = h.get(table, id);
  if (!r || r.deleted) return fail("NOT_FOUND", table + "/" + id);
  return r;
}
function endpoint(type, id) {
  return { anyOf: [{ fromType: type, fromId: id }, { toType: type, toId: id }] };
}
function links(h, type, id, limit = 1e3) {
  const rows = h.select("links", __spreadProps(__spreadValues({}, endpoint(type, id)), { where: { deleted: 0 }, projection: "link", limit: limit + 1 }));
  if (rows.length > limit) fail("LIMIT_EXCEEDED", "\u8BE5\u5BF9\u8C61\u5173\u8054\u8D85\u8FC7\u5355\u6B21\u8303\u56F4\uFF0C\u8BF7\u7F29\u5C0F\u64CD\u4F5C");
  return rows.filter((l) => !l.deleted);
}
function other(l, table, id) {
  return l.fromType === table && l.fromId === id ? { table: String(l.toType), id: String(l.toId) } : { table: String(l.fromType), id: String(l.fromId) };
}
function activityLinkId(_h, from, to, kind = "related", meta) {
  return buildLinkId({ type: from.table, id: from.id }, { type: to.table, id: to.id }, kind, meta);
}
var Builder = class {
  constructor(h, generation, requestId, kind, input) {
    this.h = h;
    this.generation = generation;
    this.requestId = requestId;
    this.kind = kind;
    this.input = input;
    __publicField(this, "reads", /* @__PURE__ */ new Map());
    __publicField(this, "scans", []);
    __publicField(this, "writes", /* @__PURE__ */ new Map());
    __publicField(this, "result", {});
  }
  get(table, id) {
    var _a;
    if (BUSINESS_TABLES.includes(table) && !this.h.can(table)) fail("FORBIDDEN", "\u7F3A\u5C11\u8BFB\u53D6\u80FD\u529B\uFF1A" + table);
    const key = table + "/" + id;
    if (this.writes.has(key)) return (_a = this.writes.get(key)) == null ? void 0 : _a.value;
    const r = this.h.get(table, id);
    this.reads.set(key, { table, id, rev: r ? Number(r.rev || 0) : null });
    return r;
  }
  select(table, scope) {
    const rows = this.h.select(table, __spreadProps(__spreadValues({}, scope), { limit: 1001, sort: "localId" }));
    if (rows.length > 1e3) fail("LIMIT_EXCEEDED", "\u5355\u6B21\u5F71\u54CD\u8303\u56F4\u8D85\u8FC7\u4E00\u5343\u6761\uFF1A" + table);
    if (BUSINESS_TABLES.includes(table)) this.scans.push({ table, scope, versions: rows.map((r) => [r.id, Number(r.rev || 0)]).sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0) });
    for (const r of rows) this.get(table, r.id);
    return rows;
  }
  alive(table, id) {
    const r = this.get(table, id);
    if (!r || r.deleted) return fail("NOT_FOUND", table + "/" + id);
    return r;
  }
  put(table, row, sourceScope) {
    if (!this.h.can(table, true)) fail("FORBIDDEN", "\u7F3A\u5C11\u5199\u80FD\u529B\uFF1A" + table);
    this.get(table, row.id);
    this.writes.set(table + "/" + row.id, { table, id: row.id, kind: "put", value: row, sourceScope });
  }
  id(kind, key) {
    return kind + "-" + this.h.hash(this.h.owner + "/" + this.requestId + "/" + kind + "/" + key).slice(0, 32);
  }
  link(from, to, sourceScope, kind = "related", meta = {}) {
    this.alive(from.table, from.id);
    this.alive(to.table, to.id);
    const id = activityLinkId(this.h, from, to, kind, meta);
    const prev = this.get("links", id);
    const evidence = sourceScope && (this.writes.has("activities/" + sourceScope) || this.h.get("activities", sourceScope)) ? sourceScope : void 0;
    const oldMeta = (prev == null ? void 0 : prev.meta) && typeof prev.meta === "object" ? prev.meta : {};
    const sourceIds = [.../* @__PURE__ */ new Set([...strings(oldMeta.sourceActivityIds), ...typeof oldMeta.sourceActivityId === "string" ? [oldMeta.sourceActivityId] : [], ...evidence ? [evidence] : []])];
    const merged = __spreadValues(__spreadValues(__spreadValues({}, oldMeta), meta), evidence ? { sourceActivityId: evidence, sourceActivityIds: sourceIds.slice(-50) } : {});
    const [f, t] = canonicalEndpoints({ type: from.table, id: from.id }, { type: to.table, id: to.id }, kind);
    this.put("links", __spreadValues({ id, fromType: f.type, fromId: f.id, toType: t.type, toId: t.id, kind, meta: merged, createdAt: (prev == null ? void 0 : prev.createdAt) || this.h.now, deleted: 0 }, (prev == null ? void 0 : prev.deleted) ? { restoredAt: this.h.now } : {}), sourceScope);
  }
  unlinkFor(table, id) {
    const ids = [];
    for (const persisted of this.select("links", endpoint(table, id))) {
      const l = this.get("links", persisted.id);
      if (!l.deleted) {
        this.put("links", __spreadProps(__spreadValues({}, l), { deleted: 1, deletedAt: this.h.now }), String(l.fromType === "activities" ? l.fromId : ""));
        ids.push(l.id);
      }
    }
    return ids;
  }
  command() {
    return { protocol: 1, generation: this.generation, requestId: this.requestId, operationId: this.h.hash(this.h.owner + "/" + this.requestId).slice(0, 15), kind: this.kind, intent: { kind: this.kind, input: this.input }, reads: [...this.reads.values()], scans: this.scans, writes: [...this.writes.values()], result: this.result };
  }
};
function capture(b, d) {
  const contacts = /* @__PURE__ */ new Map(), topics = /* @__PURE__ */ new Map(), seen = /* @__PURE__ */ new Set();
  const key = (v) => {
    const k = requireText(v, "\u6BCF\u9879\u9700\u8981\u7A33\u5B9A key", 80);
    if (seen.has(k)) fail("DUPLICATE_KEY", k);
    seen.add(k);
    return k;
  };
  for (const c of list(d.contacts)) {
    const k = key(c.key), id = c.id ? String(c.id) : b.id("contact", k);
    if (c.id) b.alive("customers", id);
    else b.put("customers", { id, name: requireText(c.name, "\u8054\u7CFB\u4EBA\u59D3\u540D", 120), aliases: strings(c.aliases), preferredName: text(c.preferredName, 120), contactType: c.contactType || "unspecified", company: text(c.company, 120), title: text(c.title, 120), decisionLevel: "", tags: [], phone: text(c.phone, 120), wechat: text(c.wechat, 120), email: text(c.email, 240), address: text(c.address, 500), lastContactAt: 0, createdAt: b.h.now });
    contacts.set(k, id);
  }
  for (const p of list(d.topics)) {
    const k = key(p.key), id = p.id ? String(p.id) : b.id("topic", k);
    if (p.id) b.alive("projects", id);
    else b.put("projects", { id, name: requireText(p.name, "\u4E8B\u9879\u540D\u79F0", 160), aliases: strings(p.aliases), color: "#0065b8", status: "active", createdAt: b.h.now });
    topics.set(k, id);
  }
  const events = list(d.activities, 20);
  if (!events.length) fail("INVALID_CAPTURE", "\u81F3\u5C11\u4E00\u9879\u5DF2\u53D1\u751F\u7ECF\u5386");
  const created = [], duplicateEvidence = [];
  for (const a of events) {
    const k = key(a.key), id = b.id("activity", k), scope = id;
    const zone = requireText(a.timeZone || d.timeZone || "Asia/Shanghai", "\u65F6\u533A", 80);
    const precision = a.timePrecision || "date";
    if (!["date", "minute", "range"].includes(String(precision))) fail("INVALID_TIME_PRECISION", k);
    const at = parseTime(a.occurredAt, zone), until = a.occurredUntil == null ? null : parseTime(a.occurredUntil, zone);
    if (at > b.h.now + 6e4 || until && until > b.h.now + 6e4) fail("NOT_OCCURRED", "\u672A\u6765\u8BA1\u5212\u8BF7\u8BB0\u5F55\u4E3A\u5F85\u529E");
    if (until && until < at || precision === "range" && !until) fail("INVALID_TIME_RANGE", k);
    const cids = strings(a.contactIds).map((x) => contacts.get(x) || x), pids = strings(a.topicIds).map((x) => topics.get(x) || x);
    b.put("activities", { id, title: requireText(a.title, "\u4E8B\u4EF6\u4E3B\u9898", 240), summary: requireText(a.summary || a.title, "\u4E8B\u4EF6\u6458\u8981", 4e3), occurredAt: at, occurredUntil: until, timePrecision: precision, timeZone: zone, recordedAt: b.h.now, category: text(a.category, 60), tags: strings(a.tags), sourceOperationId: b.command().operationId, sourceText: text(a.sourceText, 8e3), deleted: 0 }, scope);
    for (const cid of cids) {
      const c = b.alive("customers", cid);
      b.link({ table: "activities", id }, { table: "customers", id: cid }, scope, "related", { sourceKind: "participation" });
      if (a.category === "communication") b.put("customers", __spreadProps(__spreadValues({}, c), { lastContactAt: Math.max(Number(c.lastContactAt || 0), at) }), scope);
    }
    for (const pid of pids) b.link({ table: "activities", id }, { table: "projects", id: pid }, scope);
    for (const t of list(a.transactions, 20)) {
      const tid = t.existingId ? String(t.existingId) : b.id("transaction", key(t.key));
      if (t.existingId) b.alive("transactions", tid);
      else {
        if (t.fact !== "occurred") fail("NOT_OCCURRED", "\u62A5\u4EF7\u3001\u5F00\u7968\u548C\u9884\u8BA1\u6536\u6B3E\u4E0D\u80FD\u4F5C\u4E3A\u5B9E\u9645\u6536\u652F\uFF1B\u8BF7\u660E\u786E fact=occurred");
        if (!Number.isSafeInteger(t.amountMinor) || Number(t.amountMinor) <= 0) fail("MONEY_PRECISION", "amountMinor \u4E3A\u6B63\u6574\u6570\u5206");
        const ledger = b.alive("ledgers", requireText(t.ledgerId, "\u8BF7\u6307\u5B9A\u8D26\u672C", 240));
        if (t.currency !== ledger.currency) fail("CURRENCY_CONFLICT", tid);
        const candidates = b.h.select("transactions", { where: { ledgerId: ledger.id, type: String(t.type) }, from: at - 864e5, to: at + 864e5, timeField: "occurredAt", limit: 1001 }).filter((r) => !r.deleted && r.amountMinor === t.amountMinor && r.currency === t.currency);
        if (candidates.length) duplicateEvidence.push({ key: t.key, candidates: candidates.slice(0, 10).map((r) => refOf("transactions", r)), truncated: candidates.length > 10 });
        if (candidates.length && t.duplicateDecision !== "new") fail("DUPLICATE_REVIEW_REQUIRED", JSON.stringify(duplicateEvidence));
        b.put("transactions", { id: tid, ledgerId: ledger.id, type: t.type, amountMinor: t.amountMinor, amount: Number(t.amountMinor) / 100, currency: t.currency, summary: requireText(t.summary || a.title, "\u6D41\u6C34\u6458\u8981", 240), channel: text(t.channel, 120), status: t.status || "\u5F85\u5BF9\u8D26", occurredAt: t.occurredAt == null ? at : parseTime(t.occurredAt, zone), tags: [], note: text(t.note, 2e3) }, scope);
      }
      b.link({ table: "activities", id }, { table: "transactions", id: tid }, scope, "related", { sourceKind: "finance" });
      for (const cid of cids) b.link({ table: "transactions", id: tid }, { table: "customers", id: cid }, scope);
      for (const pid of pids) b.link({ table: "transactions", id: tid }, { table: "projects", id: pid }, scope);
    }
    for (const t of list(a.tasks, 20)) {
      const tid = t.existingId ? String(t.existingId) : b.id("todo", key(t.key));
      if (t.existingId) b.alive("todos", tid);
      else b.put("todos", { id: tid, title: requireText(t.title, "\u627F\u8BFA\u5185\u5BB9", 240), desc: text(t.desc, 4e3), priority: t.priority || "none", status: "todo", dueAt: t.dueAt == null ? null : parseTime(t.dueAt, zone), customerId: cids[0] || null, projectId: pids[0] || null, createdAt: b.h.now, tags: [] }, scope);
      b.link({ table: "activities", id }, { table: "todos", id: tid }, scope);
      for (const cid of cids) b.link({ table: "todos", id: tid }, { table: "customers", id: cid }, scope);
    }
    for (const r of list(a.records)) {
      const table = String(r.table), rid = requireText(r.id, "\u5173\u8054\u5BF9\u8C61", 240);
      if (!["notes", "attachments"].includes(table)) fail("INVALID_REFERENCE", table);
      b.link({ table: "activities", id }, { table, id: rid }, scope, table === "attachments" ? "attachment" : "related");
    }
    for (const r of list(a.relations, 20)) {
      const fromId = contacts.get(String(r.fromContactId)) || String(r.fromContactId), toId = contacts.get(String(r.toContactId)) || String(r.toContactId);
      if (fromId === toId) fail("INVALID_RELATION", "\u4E0D\u80FD\u5173\u8054\u81EA\u8EAB");
      b.link({ table: "customers", id: fromId }, { table: "customers", id: toId }, scope, "relation", { label: requireText(r.label, "\u660E\u786E\u5173\u7CFB\u8BED\u4E49", 120), category: r.category || "person", sourceKind: "explicit" });
    }
    created.push({ table: "activities", id });
  }
  b.result = { records: created.map((r) => __spreadProps(__spreadValues({}, r), { path: recordPath(r.table, r.id) })), duplicateEvidence, referenceAt: d.referenceAt || b.h.now, timeZone: d.timeZone || "Asia/Shanghai" };
}
var PATCH_FIELDS = {
  activities: ["title", "summary", "occurredAt", "occurredUntil", "timePrecision", "timeZone", "category", "tags"],
  customers: ["name", "aliases", "preferredName", "contactType", "company", "title", "phone", "email", "wechat", "address", "tags"],
  projects: ["name", "aliases", "status", "note"],
  transactions: ["amountMinor", "summary", "note", "status", "occurredAt", "ledgerId", "currency"],
  todos: ["title", "desc", "dueAt", "status", "priority", "customerId", "projectId", "tags"],
  notes: ["title", "markdown", "projectId", "tags"]
};
function amend(b, d) {
  var _a;
  const changes = list(d.changes, 50);
  if (!changes.length) fail("INVALID_AMEND", "\u8BF7\u6307\u5B9A\u4FEE\u6B63\u5BF9\u8C61");
  const diffs = [];
  for (const change of changes) {
    const table = String(change.table), id = requireText(change.id, "\u5BF9\u8C61 ID", 240), old = b.alive(table, id), patch = __spreadValues({}, object(change.patch || {}));
    if (change.expectedRev !== old.rev) fail("VERSION_CONFLICT", table + "/" + id);
    for (const field of Object.keys(patch)) if (!((_a = PATCH_FIELDS[table]) == null ? void 0 : _a.includes(field))) fail("INVALID_PATCH", table + "/" + field);
    const zone = String(patch.timeZone || change.timeZone || old.timeZone || "Asia/Shanghai");
    for (const field of table === "activities" ? ["occurredAt", "occurredUntil"] : table === "transactions" ? ["occurredAt"] : table === "todos" ? ["dueAt"] : []) if (Object.prototype.hasOwnProperty.call(patch, field)) {
      if (patch[field] == null) {
        if (field === "occurredAt") fail("INVALID_DATE", "\u53D1\u751F\u65E5\u671F\u4E0D\u53EF\u6E05\u7A7A");
      } else patch[field] = parseTime(patch[field], zone);
    }
    const next = __spreadValues(__spreadValues({}, old), patch);
    if (table === "activities" && (Number(next.occurredAt) > b.h.now + 6e4 || Number(next.occurredUntil) > b.h.now + 6e4)) fail("NOT_OCCURRED", "\u672A\u6765\u8BA1\u5212\u8BF7\u8BB0\u5F55\u4E3A\u5F85\u529E");
    if (table === "transactions" && patch.amountMinor !== void 0) {
      if (!Number.isSafeInteger(patch.amountMinor) || Number(patch.amountMinor) <= 0) fail("MONEY_PRECISION", id);
      next.amount = Number(patch.amountMinor) / 100;
    }
    if (table === "todos" && patch.status !== void 0) {
      if (!["todo", "done", "voided"].includes(String(patch.status))) fail("INVALID_STATUS", id);
      next.completedAt = patch.status === "done" ? b.h.now : null;
      next.voidedAt = patch.status === "voided" ? b.h.now : null;
    }
    b.put(table, next, table === "activities" ? id : void 0);
    diffs.push(__spreadProps(__spreadValues({}, refOf(table, old)), { before: bounded(pick(old, Object.keys(patch))), after: bounded(pick(next, Object.keys(patch))) }));
    if (["activities", "transactions", "todos"].includes(table)) for (const pair of [["contactIds", "customers"], ["topicIds", "projects"]]) {
      if (change[pair[0]] === void 0) continue;
      const wanted = strings(change[pair[0]]);
      const existing = b.select("links", { where: { fromType: table, fromId: id, toType: pair[1], kind: "related" } });
      for (const l of existing) if (!l.deleted && !wanted.includes(String(l.toId))) b.put("links", __spreadProps(__spreadValues({}, l), { deleted: 1, deletedAt: b.h.now }), id);
      for (const target of wanted) b.link({ table, id }, { table: pair[1], id: target }, id);
      if (table === "todos") b.put(table, __spreadProps(__spreadValues({}, b.alive(table, id)), { [pair[0] === "contactIds" ? "customerId" : "projectId"]: wanted[0] || null }));
      diffs.push({ table, id, relation: pair[0], before: existing.filter((l) => !l.deleted).map((l) => l.toId), after: wanted });
    }
  }
  b.result = { differences: diffs };
}
function dependencies(b, table, id, included) {
  for (const l of b.select("links", endpoint(table, id))) if (!l.deleted && !included.has("links/" + l.id)) fail("DEPENDENCY_CONFLICT", "\u540E\u7EED\u5173\u8054\uFF1Alinks/" + l.id);
  for (const pair of table === "customers" ? [["todos", "customerId"], ["projects", "customerId"]] : table === "projects" ? [["todos", "projectId"], ["notes", "projectId"]] : table === "ledgers" ? [["transactions", "ledgerId"]] : []) {
    for (const r of b.select(pair[0], { where: { [pair[1]]: id } })) if (!r.deleted && !included.has(pair[0] + "/" + r.id)) fail("DEPENDENCY_CONFLICT", pair[0] + "/" + r.id);
  }
}
function undo(b, d) {
  const operationId = requireText(d.operationId, "operationId", 80), op = b.h.get("operations", operationId);
  if (!op || op.status !== "committed") fail("NOT_FOUND", operationId);
  const all = b.h.select("operation_effects", { where: { operationId }, limit: 501 });
  if (all.length > 500) fail("LIMIT_EXCEEDED", "\u64A4\u9500\u8303\u56F4\u8D85\u9650");
  const chosen = d.effectIds === void 0 ? all : all.filter((e) => strings(d.effectIds, 500).includes(e.id));
  if (!chosen.length) fail("INVALID_UNDO", "\u6CA1\u6709\u9009\u4E2D\u53EF\u64A4\u9500\u53D8\u66F4");
  const included = new Set(chosen.map((e) => e.tableName + "/" + e.recordId));
  const differences = [];
  for (const e of chosen) {
    if (e.redacted || e.action === "purge") fail("REDACTED_NOT_RECOVERABLE", String(e.recordId));
    const table = String(e.tableName), id = String(e.recordId), current = b.get(table, id);
    if (!current || Number(current.rev || 0) !== e.afterRev) fail("DEPENDENCY_CONFLICT", "\u540E\u7EED\u4FEE\u6539\uFF1A" + table + "/" + id);
    if (e.action === "create") {
      dependencies(b, table, id, included);
      b.put(table, __spreadProps(__spreadValues({}, current), { deleted: 1, deletedAt: b.h.now }));
    } else {
      const before = object(e.before);
      b.put(table, __spreadValues(__spreadProps(__spreadValues({}, before), { id, rev: current.rev }), current.deleted && !before.deleted ? { restoredAt: b.h.now } : {}));
    }
    differences.push({ effectId: e.id, table, id, action: e.action === "create" ? "delete_created" : "restore_previous" });
  }
  b.result = { undoOf: operationId, differences };
}
function merge(b, d) {
  const source = b.alive("customers", String(d.sourceId)), target = b.alive("customers", String(d.targetId));
  if (source.id === target.id) fail("INVALID_MERGE", "\u4E0D\u80FD\u5408\u5E76\u81EA\u8EAB");
  if (source.rev !== d.sourceRev || target.rev !== d.targetRev) fail("VERSION_CONFLICT", "\u8054\u7CFB\u4EBA\u7248\u672C");
  for (const l of b.select("links", endpoint("customers", source.id))) {
    if (l.deleted) continue;
    const next = __spreadValues({}, l);
    if (l.fromType === "customers" && l.fromId === source.id) next.fromId = target.id;
    if (l.toType === "customers" && l.toId === source.id) next.toId = target.id;
    b.put("links", __spreadProps(__spreadValues({}, l), { deleted: 1, deletedAt: b.h.now }));
    if (!(next.fromType === next.toType && next.fromId === next.toId)) b.link({ table: String(next.fromType), id: String(next.fromId) }, { table: String(next.toType), id: String(next.toId) }, void 0, String(next.kind), object(next.meta || {}));
  }
  for (const table of ["todos", "projects"]) for (const row of b.select(table, { where: { customerId: source.id } })) if (!row.deleted) b.put(table, __spreadProps(__spreadValues({}, row), { customerId: target.id }));
  b.put("customers", __spreadProps(__spreadValues({}, target), { aliases: [.../* @__PURE__ */ new Set([...strings(target.aliases), String(source.name), ...strings(source.aliases)])], lastContactAt: Math.max(Number(source.lastContactAt || 0), Number(target.lastContactAt || 0)) }));
  b.put("customers", __spreadProps(__spreadValues({}, source), { deleted: 1, deletedAt: b.h.now, mergedIntoId: target.id }));
  b.result = { mergedFrom: source.id, mergedInto: target.id };
}
function remove(b, d, purge) {
  const targets = list(d.targets, 100), ids = /* @__PURE__ */ new Map();
  for (const t of targets) {
    const table = String(t.table), id = String(t.id);
    if (!PATCH_FIELDS[table] && table !== "attachments") fail("INVALID_TARGET", table);
    const row = b.get(table, id);
    if (!row) fail("NOT_FOUND", table + "/" + id);
    if (row.rev !== t.expectedRev) fail("VERSION_CONFLICT", table + "/" + id);
    ids.set(table + "/" + id, { table, id });
    if (purge && table === "activities") {
      for (const l of b.select("links", endpoint(table, id))) {
        const r = other(l, table, id);
        if (r.table === "attachments") ids.set(r.table + "/" + r.id, r);
      }
      if (row.sourceTable === "interactions" && row.sourceId && b.get("interactions", String(row.sourceId))) ids.set("interactions/" + row.sourceId, { table: "interactions", id: String(row.sourceId) });
    }
  }
  if (!ids.size) fail("INVALID_TARGET", "\u8BF7\u660E\u786E\u6E05\u7406\u8303\u56F4");
  if (purge) {
    for (const target of ids.values()) if (target.table === "attachments") for (const l of b.select("links", endpoint("attachments", target.id))) {
      const ref = other(l, "attachments", target.id);
      if (!ids.has(ref.table + "/" + ref.id)) fail("PRIVACY_SCOPE_REQUIRED", "\u9644\u4EF6\u4ECD\u7531\u5176\u4ED6\u4E8B\u5B9E\u5F15\u7528\uFF1A" + ref.table + "/" + ref.id);
    }
  }
  for (const target of [...ids.values()]) if (purge && target.table === "customers") {
    const related = b.select("links", endpoint("customers", target.id)).filter((l) => !l.deleted).map((l) => other(l, "customers", target.id)).filter((r) => r.table === "activities" && !ids.has(r.table + "/" + r.id));
    if (related.length) fail("PRIVACY_SCOPE_REQUIRED", "\u8FD8\u9700\u660E\u786E\u76F8\u5173\u4E8B\u4EF6\u6E05\u7406\u8303\u56F4\uFF1A" + JSON.stringify(related));
  }
  for (const { table, id } of ids.values()) {
    const row = b.get(table, id);
    const children = [], scalarLinks = [];
    if (table === "projects") {
      for (const child of b.select("projectMilestones", { where: { projectId: id } })) if (!child.deleted) {
        children.push({ table: "projectMilestones", id: child.id });
        ids.set("projectMilestones/" + child.id, { table: "projectMilestones", id: child.id });
      }
      for (const t of ["todos", "notes"]) for (const r of b.select(t, { where: { projectId: id } })) if (!r.deleted) {
        scalarLinks.push({ table: t, id: r.id, field: "projectId", mode: "set", value: id });
        b.put(t, __spreadProps(__spreadValues({}, r), { projectId: null }));
      }
    }
    if (table === "transactions") {
      for (const link of b.select("links", { where: { fromType: table, fromId: id, kind: "attachment" } })) if (!link.deleted) {
        const attachment = b.get("attachments", String(link.toId));
        if (attachment && !attachment.deleted) {
          const ref = { table: "attachments", id: attachment.id };
          children.push(ref);
          ids.set(ref.table + "/" + ref.id, ref);
        }
      }
    }
    const cascadeLinkIds = [];
    if (purge) for (const l of b.select("links", endpoint(table, id))) ids.set("links/" + l.id, { table: "links", id: l.id });
    else for (const ref of [{ table, id }, ...children]) cascadeLinkIds.push(...b.unlinkFor(ref.table, ref.id));
    if (table === "customers") {
      for (const t of ["todos", "projects"]) for (const r of b.select(t, { where: { customerId: id } })) if (!r.deleted) {
        scalarLinks.push({ table: t, id: r.id, field: "customerId", mode: "set", value: id });
        b.put(t, __spreadProps(__spreadValues({}, r), { customerId: null }));
      }
    }
    if (purge) {
      if (!b.h.can(table, true)) fail("FORBIDDEN", table);
      b.writes.set(table + "/" + id, { table, id, kind: "delete", sourceScope: table === "activities" ? id : void 0 });
    } else b.put(table, __spreadProps(__spreadValues({}, row), { deleted: 1, deletedAt: b.h.now, trashSnapshot: { children, links: scalarLinks, cascadeLinkIds: [...new Set(cascadeLinkIds)] } }));
  }
  b.result = { records: [...ids.values()], privacyCleanup: purge };
}
function planPersonal(h, kind, input, generation, requestId) {
  const d = object(input), b = new Builder(h, generation, requestId, kind, input);
  if (kind === "capture") capture(b, d);
  else if (kind === "amend") amend(b, d);
  else if (kind === "undo") undo(b, d);
  else if (kind === "merge") merge(b, d);
  else if (kind === "delete" || kind === "purge") remove(b, d, kind === "purge");
  else fail("UNKNOWN_ACTION", kind);
  if (b.writes.size > 500) fail("LIMIT_EXCEEDED", "\u590D\u5408\u64CD\u4F5C\u5F71\u54CD\u8D85\u8FC7\u4E94\u767E\u6761");
  return b.command();
}
function pick(row, fields) {
  const out = {};
  for (const k of fields) if (row[k] !== void 0) out[k] = row[k];
  return out;
}
function bounded(value) {
  if (typeof value === "string") return value.length > 500 ? { text: value.slice(0, 500), length: value.length, truncated: true } : value;
  if (Array.isArray(value)) return value.slice(0, 50).map(bounded);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, bounded(v)]));
  return value;
}
function projectRecord(h, table, row) {
  if (!h.can(table)) return { restricted: true };
  const fields = table === "activities" ? ["title", "summary", "occurredAt", "occurredUntil", "timePrecision", "timeZone", "recordedAt", "category", "tags", "sourceOperationId"] : table === "transactions" ? ["summary", "amountMinor", "currency", "type", "status", "occurredAt", "ledgerId"] : table === "todos" ? ["title", "status", "dueAt", "completedAt", "voidedAt", "priority", "customerId", "projectId"] : table === "customers" ? ["name", "aliases", "preferredName", "contactType", "company", "lastContactAt", "tags"] : table === "projects" ? ["name", "aliases", "status"] : table === "notes" ? ["title", "tags"] : ["name", "mime", "size"];
  const value = pick(row, fields);
  for (const key of ["customerId", "projectId", "dueAt", "completedAt", "voidedAt", "occurredUntil"]) if (key in value && !value[key]) value[key] = null;
  const truncatedFields = [];
  for (const key of Object.keys(value)) {
    if (typeof value[key] === "string" && value[key].length > 500) {
      value[key] = value[key].slice(0, 500);
      truncatedFields.push(key);
    }
    if (Array.isArray(value[key])) {
      if (value[key].length > 50) truncatedFields.push(key);
      value[key] = value[key].slice(0, 50).map((v) => typeof v === "string" ? v.slice(0, 240) : v);
    }
  }
  return __spreadValues(__spreadValues(__spreadValues(__spreadValues({}, refOf(table, row)), value), truncatedFields.length ? { truncatedFields } : {}), table === "transactions" ? { amountUnit: "minor" } : {});
}
function eventFeed(h, d, take) {
  const from = d.from == null ? void 0 : parseTime(d.from, String(d.timeZone || "Asia/Shanghai")), to = d.to == null ? void 0 : rangeEnd(d.to, String(d.timeZone || "Asia/Shanghai"));
  let ids;
  const filterRefs = [...d.contactId ? [{ table: "customers", id: String(d.contactId) }] : [], ...d.topicId ? [{ table: "projects", id: String(d.topicId) }] : []];
  for (const filterRef of filterRefs) {
    live(h, filterRef.table, filterRef.id);
    const matched = links(h, filterRef.table, filterRef.id, 2e4).map((l) => other(l, filterRef.table, filterRef.id)).filter((r) => r.table === "activities").map((r) => r.id);
    ids = ids ? ids.filter((id) => matched.includes(id)) : matched;
  }
  const out = [];
  const activitySelection = { where: __spreadValues({ deleted: 0 }, d.category ? { category: String(d.category) } : {}), ids, from, to, timeField: "occurredAt", q: text(d.q, 120), sort: "-occurredAt,localId" };
  const boundedActivities = !!h.groupedFinance || d.sourceType === "activity";
  const matchingActivities = h.can("activities") && (!ids || ids.length) ? h.select("activities", __spreadProps(__spreadValues({}, activitySelection), { projection: boundedActivities ? "list" : "identity", limit: boundedActivities ? take : 20001 })) : [];
  if (matchingActivities.length > 2e4) fail("LIMIT_EXCEEDED", "\u4E8B\u4EF6\u8303\u56F4\u8D85\u8FC7\u4E24\u4E07\u6761\uFF0C\u8BF7\u7F29\u5C0F\u65E5\u671F");
  matchingActivities.sort((a, b) => Number(b.occurredAt) - Number(a.occurredAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const selected = matchingActivities.slice(0, take);
  const displayed = boundedActivities ? selected : h.select("activities", { ids: selected.map((a) => a.id), projection: "list", limit: take });
  const displayedById = new Map(displayed.map((a) => [a.id, a]));
  for (const selectedActivity of selected) {
    const a = displayedById.get(selectedActivity.id);
    if (!a) continue;
    out.push({ key: a.sourceTable && a.sourceId ? a.sourceTable + ":" + a.sourceId : "activity:" + a.id, sourceType: "activity", sourceId: a.id, at: Number(a.occurredAt), operationId: String(a.sourceOperationId || ""), record: projectRecord(h, "activities", a) });
  }
  if (d.sourceType !== "activity" && !d.category && h.can("todos")) {
    const taskIds = filterRefs.length ? taskRows(h, __spreadProps(__spreadValues({}, d), { status: "all" })).map((r) => r.id) : void 0;
    const effects = h.select("operation_effects", { where: { tableName: "todos" }, ids: taskIds, idField: "recordId", from, to, timeField: "occurredAt", sort: "-occurredAt,id", limit: 20001 });
    if (effects.length > 2e4) fail("LIMIT_EXCEEDED", "\u6267\u884C\u5386\u53F2\u8303\u56F4\u8FC7\u5927\uFF0C\u8BF7\u7F29\u5C0F\u65E5\u671F");
    for (const e of effects) {
      if (e.redacted || !e.before || !e.after) continue;
      const before = object(e.before), after = object(e.after);
      if (before.status === after.status && before.dueAt === after.dueAt) continue;
      const t = h.get("todos", String(e.recordId));
      if (!t || t.deleted) continue;
      out.push({ key: "effect:" + e.id, sourceType: "task_change", sourceId: e.id, at: Number(e.occurredAt), operationId: String(e.operationId), record: __spreadProps(__spreadValues({}, projectRecord(h, "todos", t)), { before: pick(before, ["status", "dueAt"]), after: pick(after, ["status", "dueAt"]) }) });
    }
  }
  if (d.sourceType !== "activity" && !d.category && h.can("transactions")) {
    let grouped;
    if (h.groupedFinance && h.can("activities")) grouped = new Set(h.groupedFinance(activitySelection));
    else {
      const activityEdges = h.select("links", { where: { fromType: "activities", toType: "transactions", deleted: 0 }, projection: "edge", limit: 20001 });
      if (activityEdges.length > 2e4) fail("LIMIT_EXCEEDED", "\u4E8B\u4EF6\u8D22\u52A1\u5173\u8054\u8303\u56F4\u8D85\u9650\uFF0C\u8BF7\u7F29\u5C0F\u67E5\u8BE2");
      const represented = new Set(matchingActivities.map((a) => a.id));
      grouped = new Set(activityEdges.filter((l) => represented.has(String(l.fromId))).map((l) => String(l.toId)));
    }
    if (grouped.size > 2e4) fail("LIMIT_EXCEEDED", "\u4E8B\u4EF6\u8D22\u52A1\u5173\u8054\u8303\u56F4\u8D85\u9650\uFF0C\u8BF7\u7F29\u5C0F\u67E5\u8BE2");
    const txns = h.select("transactions", __spreadProps(__spreadValues({}, financeSelection(h, d)), { excludeIds: [...grouped].map(String), limit: take }));
    for (const t of txns) {
      out.push({ key: "transaction:" + t.id, sourceType: "legacy_finance", sourceId: t.id, at: Number(t.occurredAt), record: projectRecord(h, "transactions", t) });
    }
  }
  const q = text(d.q, 120).toLocaleLowerCase();
  return out.filter((r) => (!d.sourceType || d.sourceType === r.sourceType) && (!q || r.sourceType === "activity" || String(r.record.title || r.record.summary || "").toLocaleLowerCase().includes(q))).sort((a, b) => b.at - a.at || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)).slice(0, take);
}
function resolvePersonal(h, table, d) {
  if (!h.can(table)) fail("FORBIDDEN", table);
  if (d.id) return { status: "resolved", candidates: [__spreadProps(__spreadValues({}, projectRecord(h, table, live(h, table, String(d.id)))), { match: "id" })], id: d.id };
  const q = requireText(d.query, "\u8BF7\u63D0\u4F9B\u59D3\u540D\u3001\u522B\u540D\u6216\u8EAB\u4EFD\u7EBF\u7D22", 120).toLocaleLowerCase();
  const pool = h.select(table, { where: { deleted: 0 }, projection: "list", limit: 20001 });
  if (pool.length > 2e4) fail("LIMIT_EXCEEDED", "\u8BF7\u4F7F\u7528\u660E\u786E ID");
  const ranked = pool.map((r) => {
    const aliases = strings(r.aliases);
    const name = String(r.name || "").toLocaleLowerCase();
    const exactIdentity = d.identity && [r.email, r.phone, r.wechat].includes(d.identity);
    return { r, rank: exactIdentity ? 0 : name === q ? 1 : aliases.some((s) => s.toLocaleLowerCase() === q) ? 2 : name.includes(q) || aliases.some((s) => s.toLocaleLowerCase().includes(q)) ? 3 : 9 };
  }).filter((x) => x.rank < 9).sort((a, b) => a.rank - b.rank || a.r.id.localeCompare(b.r.id));
  const best = ranked.filter((x) => {
    var _a;
    return x.rank === ((_a = ranked[0]) == null ? void 0 : _a.rank);
  });
  const resolved = best.length === 1 && (best[0].rank < 3 || ranked.length === 1);
  return __spreadProps(__spreadValues({ status: resolved ? "resolved" : "ambiguous" }, resolved ? { id: best[0].r.id } : {}), { candidates: ranked.slice(0, 10).map((x) => __spreadProps(__spreadValues({}, projectRecord(h, table, x.r)), { match: ["identity", "name", "alias", "fuzzy"][x.rank] })), truncated: ranked.length > 10, reason: resolved ? void 0 : ranked.length ? "\u8BF7\u9009\u62E9\u5177\u4F53\u8EAB\u4EFD\uFF0C\u540D\u79F0\u76F8\u540C\u4E0D\u4F1A\u5408\u5E76" : "\u672A\u627E\u5230\uFF0C\u8BF7\u786E\u8BA4\u6216\u5728\u6574\u7EC4\u9884\u89C8\u5185\u65B0\u5EFA" });
}
function taskRows(h, d) {
  if (!h.can("todos")) fail("FORBIDDEN", "todos");
  let ids;
  for (const [key, table, field] of [["contactId", "customers", "customerId"], ["topicId", "projects", "projectId"]]) if (d[key]) {
    const id = String(d[key]), direct = h.select("todos", { where: { [field]: id, deleted: 0 }, projection: "list", limit: 20001 });
    if (direct.length > 2e4) fail("LIMIT_EXCEEDED", "\u5F85\u529E\u5173\u8054\u8303\u56F4\u8D85\u9650");
    const next = /* @__PURE__ */ new Set([...direct.map((t) => t.id), ...links(h, table, id, 2e4).map((l) => other(l, table, id)).filter((r) => r.table === "todos").map((r) => r.id)]);
    ids = ids ? new Set([...ids].filter((value) => next.has(value))) : next;
  }
  const rows = h.select("todos", __spreadProps(__spreadValues({ where: __spreadValues({ deleted: 0 }, d.status === "all" ? {} : { status: String(d.status || "todo") }) }, ids ? { ids: [...ids] } : {}), { projection: "list", limit: 20001, sort: "dueAt,localId" }));
  if (rows.length > 2e4) fail("LIMIT_EXCEEDED", "\u8BF7\u7F29\u5C0F\u5F85\u529E\u8303\u56F4");
  const now = Number(d.referenceAt || h.now), zone = String(d.timeZone || "Asia/Shanghai");
  if (!["Asia/Shanghai", "UTC"].includes(zone)) fail("UNSUPPORTED_TIME_ZONE", "\u65E5\u754C\u67E5\u8BE2\u5F53\u524D\u652F\u6301 Asia/Shanghai \u4E0E UTC\uFF1B\u5176\u5B83\u65F6\u533A\u8BF7\u660E\u786E\u7EDD\u5BF9\u8303\u56F4");
  const day = Math.floor((now + (zone === "Asia/Shanghai" ? 288e5 : 0)) / 864e5);
  return rows.filter((t) => d.due === "undated" ? !t.dueAt : d.due === "today" ? !!t.dueAt && Math.floor((Number(t.dueAt) + (zone === "Asia/Shanghai" ? 288e5 : 0)) / 864e5) === day : d.due === "overdue" ? !!t.dueAt && Math.floor((Number(t.dueAt) + (zone === "Asia/Shanghai" ? 288e5 : 0)) / 864e5) < day : true);
}
function financeSelection(h, d) {
  if (!h.can("transactions")) fail("FORBIDDEN", "transactions");
  const where = { deleted: 0 };
  for (const k of ["ledgerId", "type", "status"]) if (d[k]) where[k] = String(d[k]);
  let ids;
  const targets = [...d.contactId ? [{ table: "customers", id: String(d.contactId) }] : [], ...d.topicId ? [{ table: "projects", id: String(d.topicId) }] : []];
  for (const target of targets) {
    live(h, target.table, target.id);
    const next = new Set(links(h, target.table, target.id, 2e4).map((l) => other(l, target.table, target.id)).filter((r) => r.table === "transactions").map((r) => r.id));
    ids = ids ? new Set([...ids].filter((id) => next.has(id))) : next;
  }
  return __spreadProps(__spreadValues({ where }, ids ? { ids: [...ids] } : {}), { q: text(d.q, 120), from: d.from == null ? void 0 : parseTime(d.from, String(d.timeZone || "Asia/Shanghai")), to: d.to == null ? void 0 : rangeEnd(d.to, String(d.timeZone || "Asia/Shanghai")), timeField: "occurredAt", sort: "-occurredAt,localId", projection: "list" });
}
function financeRows(h, d) {
  const rows = h.select("transactions", __spreadProps(__spreadValues({}, financeSelection(h, d)), { limit: 20001 }));
  if (rows.length > 2e4) fail("LIMIT_EXCEEDED", "\u8BF7\u7F29\u5C0F\u8D22\u52A1\u8303\u56F4");
  return rows;
}
