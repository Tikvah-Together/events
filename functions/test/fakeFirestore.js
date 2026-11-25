// In-memory stand-in for the parts of firebase-admin's Firestore that index.js uses.
// It follows the real Admin SDK's write rules, which matter for these tests:
//   - set(data, { merge: true }) treats every key literally ("a.b" becomes a field named "a.b")
//     and merges nested plain objects field by field.
//   - update(data) reads dotted keys as paths ("a.b" sets b inside map a) and fails on a missing doc.
//   - FieldValue.delete / arrayUnion / serverTimestamp behave like the real sentinels.

class Timestamp {
  constructor(ms) { this._ms = ms; }
  toMillis() { return this._ms; }
  toDate() { return new Date(this._ms); }
  static now() { return new Timestamp(Date.now()); }
  static fromDate(d) { return new Timestamp(d.getTime()); }
  static fromMillis(ms) { return new Timestamp(ms); }
}

class Sentinel {
  constructor(kind, args = []) { this.kind = kind; this.args = args; }
}

const FieldValue = {
  delete: () => new Sentinel("delete"),
  arrayUnion: (...args) => new Sentinel("arrayUnion", args),
  serverTimestamp: () => new Sentinel("serverTimestamp"),
  increment: (n) => new Sentinel("increment", [n]),
};

const isPlainObject = (v) => v !== null && typeof v === "object" && v.constructor === Object;

function clone(v) {
  if (v instanceof Timestamp) return new Timestamp(v._ms);
  if (v instanceof Date) return new Timestamp(v.getTime()); // Firestore stores Dates as Timestamps
  if (Array.isArray(v)) return v.map(clone);
  if (isPlainObject(v)) {
    const out = {};
    for (const [k, x] of Object.entries(v)) out[k] = clone(x);
    return out;
  }
  return v;
}

function deepEqual(a, b) {
  return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
}
function normalize(v) {
  if (v instanceof Timestamp) return { __ts: v._ms };
  if (Array.isArray(v)) return v.map(normalize);
  if (isPlainObject(v)) {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = normalize(v[k]);
    return out;
  }
  return v;
}

function applyValue(target, key, value) {
  if (value instanceof Sentinel) {
    switch (value.kind) {
      case "delete": delete target[key]; return;
      case "serverTimestamp": target[key] = Timestamp.now(); return;
      case "increment": target[key] = (typeof target[key] === "number" ? target[key] : 0) + value.args[0]; return;
      case "arrayUnion": {
        const arr = Array.isArray(target[key]) ? target[key] : [];
        for (const item of value.args) if (!arr.some((x) => deepEqual(x, item))) arr.push(clone(item));
        target[key] = arr;
        return;
      }
    }
  }
  target[key] = resolveSentinels(value);
}

// For whole values written by update() or a non-merge set(): sentinels inside still resolve.
function resolveSentinels(v) {
  if (isPlainObject(v)) {
    const out = {};
    for (const [k, x] of Object.entries(v)) applyValue(out, k, x);
    return out;
  }
  return clone(v);
}

// set(..., { merge: true }): keys are literal; nested plain objects merge.
function mergeInto(target, data) {
  for (const [key, value] of Object.entries(data)) {
    if (isPlainObject(value)) {
      if (!isPlainObject(target[key])) target[key] = {};
      mergeInto(target[key], value);
    } else {
      applyValue(target, key, value);
    }
  }
}

function getPath(obj, dotted) {
  return dotted.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function compare(a, b) {
  const x = a instanceof Timestamp ? a._ms : a;
  const y = b instanceof Timestamp ? b._ms : b;
  return x < y ? -1 : x > y ? 1 : 0;
}

function createFakeFirestore() {
  const store = new Map(); // "collection/id" -> data

  class DocSnapshot {
    constructor(ref, data) { this.ref = ref; this.id = ref.id; this._data = data; this.exists = data !== undefined; }
    data() { return this._data === undefined ? undefined : clone(this._data); }
    get(field) { return clone(getPath(this._data, field)); }
  }

  class DocRef {
    constructor(collection, id) { this.collectionName = collection; this.id = id; this.path = `${collection}/${id}`; }
    async get() { return new DocSnapshot(this, store.has(this.path) ? clone(store.get(this.path)) : undefined); }
    async set(data, opts = {}) {
      if (opts.merge) {
        const cur = store.has(this.path) ? store.get(this.path) : {};
        mergeInto(cur, data);
        store.set(this.path, cur);
      } else {
        store.set(this.path, resolveSentinels(data));
      }
    }
    async update(data) {
      if (!store.has(this.path)) {
        const err = new Error(`5 NOT_FOUND: No document to update: ${this.path}`);
        err.code = 5;
        throw err;
      }
      const cur = store.get(this.path);
      for (const [key, value] of Object.entries(data)) {
        const parts = key.split(".");
        let node = cur;
        for (let i = 0; i < parts.length - 1; i++) {
          if (!isPlainObject(node[parts[i]])) node[parts[i]] = {};
          node = node[parts[i]];
        }
        applyValue(node, parts[parts.length - 1], value);
      }
    }
    async delete() { store.delete(this.path); }
  }

  class Query {
    constructor(collection, filters = []) { this.collection = collection; this.filters = filters; }
    where(field, op, value) { return new Query(this.collection, [...this.filters, { field, op, value }]); }
    doc(id) { return new DocRef(this.collection, id || Math.random().toString(36).slice(2, 12)); }
    async get() {
      const docs = [];
      for (const [path, data] of store) {
        const [coll, id] = path.split("/");
        if (coll !== this.collection) continue;
        const ok = this.filters.every(({ field, op, value }) => {
          const v = getPath(data, field);
          if (v === undefined) return false; // like Firestore, a missing field never matches
          switch (op) {
            case "==": return deepEqual(v, value);
            case "!=": return !deepEqual(v, value);
            case "<": return compare(v, value) < 0;
            case "<=": return compare(v, value) <= 0;
            case ">": return compare(v, value) > 0;
            case ">=": return compare(v, value) >= 0;
            case "in": return value.some((x) => deepEqual(v, x));
            default: throw new Error(`fake firestore: unsupported op ${op}`);
          }
        });
        if (ok) docs.push(new DocSnapshot(new DocRef(coll, id), clone(data)));
      }
      return { docs, empty: docs.length === 0, size: docs.length, forEach: (fn) => docs.forEach(fn) };
    }
  }

  const db = {
    collection: (name) => new Query(name),
    doc: (path) => { const [c, id] = path.split("/"); return new DocRef(c, id); },
    batch() {
      const ops = [];
      return {
        set: (ref, data, opts) => ops.push(() => ref.set(data, opts)),
        update: (ref, data) => ops.push(() => ref.update(data)),
        delete: (ref) => ops.push(() => ref.delete()),
        commit: async () => { for (const op of ops) await op(); },
      };
    },
    async runTransaction(fn) {
      const t = {
        get: (ref) => ref.get(),
        set: (ref, data, opts) => ref.set(data, opts),
        update: (ref, data) => ref.update(data),
        delete: (ref) => ref.delete(),
      };
      return fn(t);
    },
    // Test helpers
    _raw: (path) => clone(store.get(path)),
    _clear: () => store.clear(),
  };

  return db;
}

module.exports = { createFakeFirestore, Timestamp, FieldValue };
