/* eslint-env node */
// Offline tests for the AI Shadchan functions. No Firebase project, Telnyx or Gemini needed:
//   - Firestore is an in-memory fake (test/fakeFirestore.js) with the real Admin SDK write rules
//   - Telnyx sends are recorded instead of sent
//   - Gemini replies are scripted per step, so each scenario is repeatable
//
// Run from the functions folder:   node test/shadchan.test.js
// Test another copy of index.js:   node test/shadchan.test.js path/to/index.js
// Show the functions' own logs:    VERBOSE=1 node test/shadchan.test.js

const fs = require("fs");
const path = require("path");
const Module = require("module");
const { createFakeFirestore, Timestamp, FieldValue } = require("./fakeFirestore");

const FUNCTIONS_DIR = path.join(__dirname, "..");
const TARGET = path.resolve(process.argv[2] || path.join(FUNCTIONS_DIR, "index.js"));

// ---------------------------------------------------------------- environment
process.env.GEMINI_API_KEY = "test";
process.env.TELNYX_API_KEY = "test";
process.env.TELNYX_PHONE_NUMBER = "+15550000000";

const db = createFakeFirestore();
const fakeAdmin = {
  apps: [],
  initializeApp() { this.apps.push({}); },
  firestore: Object.assign(() => db, { FieldValue, Timestamp }),
};
const fakeStorage = {
  getStorage: () => ({ bucket: () => ({ name: "test-bucket", file: () => ({ save: async () => {} }) }) }),
};

// Scripted Gemini: each generateContent call takes the next reply off the queue.
const geminiQueue = [];
const geminiPrompts = [];
const realGenAI = require(require.resolve("@google/genai", { paths: [FUNCTIONS_DIR] }));
class FakeGoogleGenAI {
  constructor() {
    this.models = {
      generateContent: async (req) => {
        geminiPrompts.push(req.config.systemInstruction);
        if (!geminiQueue.length) throw new Error("Test bug: Gemini was called but no reply was scripted");
        return { text: JSON.stringify(geminiQueue.shift()), candidates: [{ finishReason: "STOP" }] };
      },
    };
  }
}

// Telnyx / TinyURL / media downloads
const sent = []; // { to, text, media }
const optedOutNumbers = new Set();
global.fetch = async (url, opts = {}) => {
  if (String(url).includes("api.telnyx.com/v2/messages")) {
    const body = JSON.parse(opts.body);
    if (optedOutNumbers.has(body.to)) {
      return { ok: false, json: async () => ({ errors: [{ code: "40300" }] }) };
    }
    sent.push({ to: body.to, text: body.text, media: body.media_urls || [] });
    return { ok: true, json: async () => ({ data: { id: `msg${sent.length}` } }) };
  }
  if (String(url).includes("tinyurl.com")) return { ok: true, text: async () => "https://tinyurl.com/x" };
  return { ok: true, arrayBuffer: async () => new ArrayBuffer(8), headers: { get: () => "image/jpeg" } };
};

// Load index.js with the fakes swapped in, plus two test-only tweaks:
// no 4-second coalescing wait, and a switch for "is it a safe time to text".
const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === "firebase-admin") return fakeAdmin;
  if (request === "firebase-admin/storage") return fakeStorage;
  if (request === "@google/genai") return { ...realGenAI, GoogleGenAI: FakeGoogleGenAI };
  return origLoad.call(this, request, ...rest);
};
let src = fs.readFileSync(TARGET, "utf8")
  .replace("const COALESCE_MS = 4000;", "const COALESCE_MS = 5;")
  .replace("async function isSafeToText(now = new Date()) {",
    "async function isSafeToText(now = new Date()) {\n  if (global.__safeToText !== undefined) return global.__safeToText;");
src += `
module.exports.__t = { processClaimedTurn, runAiShadchanFunctions, isSafeToText,
  stripRelativeDayWords: typeof stripRelativeDayWords === "function" ? stripRelativeDayWords : null };`;
const mod = new Module(path.join(FUNCTIONS_DIR, "__index_under_test.js"));
mod.filename = mod.id;
mod.paths = Module._nodeModulePaths(FUNCTIONS_DIR);
if (!process.env.VERBOSE) { console.log = () => {}; console.warn = () => {}; }
const realError = console.error;
const loggedErrors = [];
console.error = (...a) => { loggedErrors.push(a.map(String).join(" ")); if (process.env.VERBOSE) realError(...a); };
mod._compile(src, mod.filename);
const fn = mod.exports;
const T = mod.exports.__t;

// ---------------------------------------------------------------- helpers
const out = (...a) => process.stdout.write(a.join(" ") + "\n");
const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok });
  out(`${ok ? "  PASS" : "  FAIL"}  ${name}${!ok && detail ? `\n          ${detail}` : ""}`);
}

const EVENT = "evt1";
const SARA = { id: "sara", phone: "+17185550101" };
const ELY = { id: "ely", phone: "+17185550102" };
const sessionRef = (userId, eventId = EVENT) => db.collection("aiMatchmakerSessions").doc(`${eventId}_${userId}`);
const session = async (userId) => (await sessionRef(userId).get()).data();
const textsTo = (phone, since) => sent.slice(since).filter((s) => s.to === phone);

function ai(fields) {
  return { replyText: "ok", action: "continue", nextIndex: 0, matchConfirmed: false, closeSession: false, ...fields };
}

let msgCounter = 0;
async function inbound(person, text) {
  const req = {
    method: "POST",
    body: { data: { event_type: "message.received", payload: { id: `in${++msgCounter}`, from: { phone_number: person.phone }, text, media: [] } } },
  };
  const res = { sendStatus() { return this; }, status() { return this; }, send() { return this; }, json() { return this; } };
  await fn.handleIncomingTelnyx(req, res);
}

async function seedPair(eventId = EVENT) {
  const fb = (partnerId, partnerName) => ({ event: eventId, partnerId, partnerName, interested: "yes", isPriority: false });
  await db.collection("users").doc(SARA.id).set({
    firstName: "Sara4", lastName: "Jacobi4", gender: "woman", phone: "7185550101", smsOptIn: true,
    feedbackData: [fb(ELY.id, "Elyahu1")],
  });
  await db.collection("users").doc(ELY.id).set({
    firstName: "Elyahu1", lastName: "Jacobi", gender: "man", phone: "7185550102", smsOptIn: true,
    feedbackData: [fb(SARA.id, "Sara4")],
  });
}

async function freshConversation() {
  db._clear();
  geminiQueue.length = 0;
  optedOutNumbers.clear();
  await seedPair();
  await T.runAiShadchanFunctions(EVENT);
}

// ---------------------------------------------------------------- scenarios
const scenarios = [];
const scenario = (name, run) => scenarios.push({ name, run });

scenario("Opening texts after an event", async () => {
  const mark = sent.length;
  await freshConversation();
  check("both people get one opening text", textsTo(SARA.phone, mark).length === 1 && textsTo(ELY.phone, mark).length === 1);
  check("a session exists for each person", !!(await session(SARA.id)) && !!(await session(ELY.id)));
});

scenario("Screenshot replay: Sara asks once, then 'Thanks' and corrections", async () => {
  await freshConversation();
  let mark = sent.length;

  // Sara proposes Wednesday; the model (like in the screenshots) writes "tonight, Wednesday..."
  geminiQueue.push(ai({ action: "ask_partner", replyText: "I'll see if he's free for tonight, Wednesday, Nov 25 at 7:00 PM.",
    crossSessionMessage: "She wants to change the date to tonight, Wednesday, Nov 25 at 7:00 PM. Does that work for you?" }));
  await inbound(SARA, "Can we do Wednesday at 7 instead?");
  const toEly = textsTo(ELY.phone, mark);
  check("Elyahu gets the question once", toEly.length === 1, `got ${toEly.length}`);
  check("'tonight' is removed when the weekday is given",
    toEly[0] && !/tonight/i.test(toEly[0].text) && /Wednesday, Nov 25/.test(toEly[0].text), toEly[0]?.text);
  const s1 = await session(SARA.id);
  check("Sara's session remembers the question it's waiting on", !!s1.outstandingAsk?.question && s1.status === "paused_waiting_on_partner");

  // "Thanks" — in the screenshots the model re-asked, worded differently
  mark = sent.length;
  geminiQueue.push(ai({ action: "ask_partner", replyText: "I'll let you know as soon as he replies.",
    crossSessionMessage: "She's asking to switch to tonight, Wednesday, Nov 25 at 7:00 PM. Does that work for you?" }));
  await inbound(SARA, "Thanks");
  check("the prompt told the AI it's already waiting on him", /WAITING ON/.test(geminiPrompts[geminiPrompts.length - 1] || ""));
  check("'Thanks' does not re-send the question to Elyahu", textsTo(ELY.phone, mark).length === 0, `got ${textsTo(ELY.phone, mark).length}`);
  check("Sara still gets her reply", textsTo(SARA.phone, mark).length === 1);

  // "Technically it's tomorrow" — same day and time, different word order
  mark = sent.length;
  geminiQueue.push(ai({ action: "ask_partner", replyText: "Let me check if he's free for Wednesday, Nov 25 at 7:00 PM.",
    crossSessionMessage: "She's asking if 7:00 PM tonight, Wednesday, Nov 25 works for you." }));
  await inbound(SARA, "Technically it's tomorrow");
  check("same day/time in other words is not re-sent", textsTo(ELY.phone, mark).length === 0, `got ${textsTo(ELY.phone, mark).length}`);

  // A genuinely different request still goes through
  mark = sent.length;
  geminiQueue.push(ai({ action: "ask_partner", replyText: "I'll ask him about Thursday at 6.",
    crossSessionMessage: "Actually, could he do Thursday, Nov 26 at 6:00 PM instead?" }));
  await inbound(SARA, "Actually ask if Thursday at 6 works");
  check("a different day/time is passed on", textsTo(ELY.phone, mark).length === 1);
  const s2 = await session(SARA.id);
  check("the waiting question is updated to the new one", /Thursday, Nov 26 at 6:00 PM/.test(s2.outstandingAsk?.question || ""));
  const e2 = await session(ELY.id);
  check("Elyahu's pending question is the newest one", /Thursday/.test(e2.pendingInboundQuestion?.question || ""));
});

scenario("Elyahu answers, then Sara can ask again", async () => {
  await freshConversation();
  geminiQueue.push(ai({ action: "ask_partner", replyText: "I'll ask him.",
    crossSessionMessage: "Could he do Wednesday, Nov 25 at 7:00 PM?" }));
  await inbound(SARA, "Ask if Wednesday 7pm works");

  let mark = sent.length;
  geminiQueue.push(ai({ action: "answer_partner", replyText: "Got it, I'll let her know.",
    crossSessionMessage: "He says Wednesday doesn't work, Thursday, Nov 26 at 8:00 PM is still best." }));
  await inbound(ELY, "No, that doesn't work");
  check("Sara gets Elyahu's answer", textsTo(SARA.phone, mark).length === 1);
  check("Elyahu gets his own reply", textsTo(ELY.phone, mark).length === 1);
  const s = await session(SARA.id);
  check("Sara is no longer marked as waiting", !s.outstandingAsk && s.status === "active");
  check("Elyahu's answered question is cleared", !(await session(ELY.id)).pendingInboundQuestion);

  mark = sent.length;
  geminiQueue.push(ai({ action: "ask_partner", replyText: "I'll ask him once more.",
    crossSessionMessage: "She's asking if Wednesday, Nov 25 at 7:00 PM could work after all." }));
  await inbound(SARA, "Please ask him again");
  check("after an answer, asking again is allowed", textsTo(ELY.phone, mark).length === 1);
});

scenario("A question that arrives while the other side is mid-reply isn't lost", async () => {
  await freshConversation();
  geminiQueue.push(ai({ action: "ask_partner", replyText: "I'll ask him.", crossSessionMessage: "Could he do Wednesday, Nov 25 at 7:00 PM?" }));
  await inbound(SARA, "Ask about Wednesday");

  // Elyahu's turn starts with the Wednesday question...
  const elyAtStart = await session(ELY.id);
  // ...and while Gemini is thinking, Sara's next question lands on his session.
  const newer = { fromUserId: SARA.id, fromName: "Sara4", question: "Or Thursday, Nov 26 at 6:00 PM?", askedAt: new Date(Date.now() + 1000).toISOString() };
  await sessionRef(ELY.id).set({ pendingInboundQuestion: newer }, { merge: true });

  geminiQueue.push(ai({ action: "answer_partner", replyText: "I'll tell her.", crossSessionMessage: "He says Wednesday doesn't work." }));
  await T.processClaimedTurn(sessionRef(ELY.id), elyAtStart);
  const after = await session(ELY.id);
  check("the newer question is still waiting for Elyahu", after.pendingInboundQuestion?.question === newer.question,
    `pendingInboundQuestion is now ${JSON.stringify(after.pendingInboundQuestion)}`);
});

scenario("Nobody is texted after they opt out", async () => {
  await freshConversation();
  await sessionRef(ELY.id).update({ status: "opted_out" });
  const mark = sent.length;
  geminiQueue.push(ai({ action: "ask_partner", replyText: "I'll ask him.", crossSessionMessage: "Could he do Wednesday, Nov 25 at 7:00 PM?" }));
  await inbound(SARA, "Ask about Wednesday");
  check("no text goes to the opted-out person", textsTo(ELY.phone, mark).length === 0);
  check("Sara is told they can't be reached", /Can't reach them/.test(textsTo(SARA.phone, mark)[0]?.text || ""));
});

scenario("Scheduled texts go out once (reminder, check-in, not-a-match notice)", async () => {
  await freshConversation();
  const now = Date.now();
  const ts = (ms) => Timestamp.fromMillis(ms);
  await sessionRef(SARA.id).update({ dateDetails: { at: ts(now + 5 * 3600000), reminderAt: ts(now - 60000), reminderSent: false } });
  await sessionRef(ELY.id).update({ dateDetails: { at: ts(now - 25 * 3600000), followUpAt: ts(now - 60000), followUpSent: false } });
  await db.collection("aiMatchmakerSessions").doc(`${EVENT}_third`).set({
    userId: "third", userName: "Third Person", userPhoneNumber: "+17185550103", status: "active", messages: [],
    dateDetails: { noticeDue: true, noticeText: "Hi Third, it wasn't the right fit this time." },
  });

  global.__safeToText = true;
  const mark = sent.length;
  await fn.followUpAfterDates.run({});
  await fn.followUpAfterDates.run({}); // the next hourly run
  await fn.followUpAfterDates.run({}); // and the one after
  global.__safeToText = undefined;

  const count = (phone) => textsTo(phone, mark).length;
  check("day-of reminder sent exactly once in 3 runs", count(SARA.phone) === 1, `sent ${count(SARA.phone)} times`);
  check("day-after check-in sent exactly once in 3 runs", count(ELY.phone) === 1, `sent ${count(ELY.phone)} times`);
  check("not-a-match notice sent exactly once in 3 runs", count("+17185550103") === 1, `sent ${count("+17185550103")} times`);
  const raw = db._raw(`aiMatchmakerSessions/${EVENT}_${ELY.id}`);
  check("flags are saved inside dateDetails (no stray 'dateDetails.x' fields)",
    raw.dateDetails?.followUpSent === true && !Object.keys(raw).some((k) => k.startsWith("dateDetails.")),
    `top-level keys: ${Object.keys(raw).join(", ")}`);
});

scenario("Hourly auto-start and the Force Start button", async () => {
  db._clear();
  const H = 3600000, now = Date.now();
  const ev = (id, hoursAgo, extra = {}) => db.collection("events").doc(id).set({
    name: id, isCompleted: false, active: false, scheduledAt: Timestamp.fromMillis(now - hoursAgo * H), ...extra,
  });
  await ev("newEvent", 20, { aiProcessed: false });
  await ev("legacyEvent", 20); // created before aiProcessed existed
  await ev("alreadyDone", 20, { aiProcessed: true });
  await ev("staleEvent", 24 * 10); // 10 days old, never completed
  await ev("tooSoon", 5, { aiProcessed: false });
  await seedPair("newEvent");

  global.__safeToText = true;
  let mark = sent.length;
  await fn.autoCompleteEventsAndRunAI.run({});
  const e = async (id) => (await db.collection("events").doc(id).get()).data();
  check("new event (aiProcessed: false) is completed after 18h", (await e("newEvent")).isCompleted === true && (await e("newEvent")).aiProcessed === true);
  check("older event without the field is completed too", (await e("legacyEvent")).isCompleted === true);
  check("event already processed is left alone", (await e("alreadyDone")).isCompleted === false);
  check("10-day-old event is skipped (no surprise texts)", (await e("staleEvent")).isCompleted === false);
  check("event under 18h old waits", (await e("tooSoon")).isCompleted === false);
  check("opening texts went out for the mutual match", textsTo(SARA.phone, mark).length === 1 && textsTo(ELY.phone, mark).length === 1);

  // Force Start, as the admin page does it
  db._clear();
  await seedPair("manualEvent");
  await db.collection("events").doc("manualEvent").set({ isCompleted: true, aiProcessed: false });
  const change = (before, after) => ({
    params: { eventId: "manualEvent" },
    data: { before: { data: () => before }, after: { data: () => after, ref: db.collection("events").doc("manualEvent") } },
  });
  mark = sent.length;
  await fn.manualEventCompletionTrigger.run(change({ isCompleted: false, aiProcessed: false }, { isCompleted: true, aiProcessed: false }));
  check("Force Start runs the AI right away", textsTo(SARA.phone, mark).length === 1 && textsTo(ELY.phone, mark).length === 1);
  check("Force Start marks the event processed", (await db.collection("events").doc("manualEvent").get()).data().aiProcessed === true);

  // The hourly job's own update also fires this trigger; it must not run the AI a second time
  mark = sent.length;
  await fn.manualEventCompletionTrigger.run(change({ isCompleted: false, aiProcessed: false }, { isCompleted: true, aiProcessed: true }));
  check("no second run when the hourly job completes an event", sent.length === mark);
  global.__safeToText = undefined;
});

scenario("Safe-to-text hours, Shabbos and Yom Tov (real Hebrew calendar)", async () => {
  const at = (iso) => T.isSafeToText(new Date(iso));
  const cases = [
    ["Wed Nov 25 2026, 1:30 AM", "2026-11-25T01:30:00-05:00", false],
    ["Wed Nov 25 2026, 2:00 PM", "2026-11-25T14:00:00-05:00", true],
    ["Wed Nov 25 2026, 8:30 PM", "2026-11-25T20:30:00-05:00", false],
    ["Fri Nov 27 2026, 11:00 AM", "2026-11-27T11:00:00-05:00", true],
    ["Fri Nov 27 2026, 3:30 PM (under an hour to candles)", "2026-11-27T15:30:00-05:00", false],
    ["Sat Nov 28 2026, noon (Shabbos)", "2026-11-28T12:00:00-05:00", false],
    ["Sat Nov 28 2026, 7:00 PM (after Havdalah)", "2026-11-28T19:00:00-05:00", true],
    ["Thu Apr 2 2026, noon (Pesach)", "2026-04-02T12:00:00-04:00", false],
    ["Fri Apr 3 2026, noon (Yom Tov into Shabbos)", "2026-04-03T12:00:00-04:00", false],
    ["Sat Apr 4 2026, noon (Shabbos Chol Hamoed)", "2026-04-04T12:00:00-04:00", false],
    ["Sun Apr 5 2026, noon (Chol Hamoed)", "2026-04-05T12:00:00-04:00", true],
  ];
  const errorsBefore = loggedErrors.length;
  for (const [label, iso, expected] of cases) {
    const got = await at(iso);
    check(`${label}: ${expected ? "OK to text" : "no texting"}`, got === expected, `got ${got}`);
  }
  check("real Hebrew calendar loaded (no fallback)", !loggedErrors.slice(errorsBefore).some((e) => /calendar unavailable/i.test(e)));
});

// ---------------------------------------------------------------- run
(async () => {
  out(`Testing ${path.relative(process.cwd(), TARGET) || TARGET}`);
  for (const s of scenarios) {
    out(`\n${s.name}`);
    try { await s.run(); } catch (err) { check("scenario ran without crashing", false, err.stack); }
  }
  const failed = results.filter((r) => !r.ok).length;
  out(`\n${results.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
