/* eslint-env node */
const { onRequest } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { GoogleGenAI, Type } = require("@google/genai");
const { defineSecret } = require('firebase-functions/params');
const admin = require("firebase-admin");
const { getStorage } = require("firebase-admin/storage");
const crypto = require("crypto");

// Only formats Gemini can actually read as inline file data. Anything else — a resume .docx
// being the common case — either gets rejected outright or comes through as unreadable binary,
// and either way the model has nothing real to react to. Those get described in plain text
// instead of attempted as inlineData.
const GEMINI_INLINEABLE_TYPES = [
  "image/png", "image/jpeg", "image/webp", "image/heic", "image/heif",
  "application/pdf"
];

const MMS_IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp", "image/bmp"];
const MMS_SAFE_BYTES = 600 * 1024;

const TURN_LOCK_MS = 90 * 1000;
const COALESCE_MS = 4000;

// Define Cloud Secrets (Evaluated safely at runtime)
const geminiApiKey = defineSecret('GEMINI_API_KEY');
//const whatsappPhoneId = defineSecret('WHATSAPP_PHONE_NUMBER_ID');
//const whatsappAccessToken = defineSecret('WHATSAPP_ACCESS_TOKEN');
//const whatsappVerifyToken = defineSecret('WHATSAPP_VERIFY_TOKEN');

const telnyxApiKey = defineSecret('TELNYX_API_KEY');
const telnyxPhoneNumber = defineSecret('TELNYX_PHONE_NUMBER');

// Initialize Firebase Admin if it hasn't been initialized yet
if (admin.apps.length === 0) {
  admin.initializeApp({
    storageBucket: "ttevents-81927.firebasestorage.app"
  });
}

const db = admin.firestore();
const GEMINI_MODEL = "gemini-3.1-flash-lite";
const MAX_HISTORY = 24;
const SHADCHAN_TZ = "America/New_York"; // "tomorrow" and "Sunday" get measured in this timezone

function nowForPrompt() {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: SHADCHAN_TZ, weekday: "long", month: "long", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit"
  }).format(new Date());
}

// A small calendar so "Sunday" or "next Thursday" resolves to a real date without guesswork.
function upcomingDaysForPrompt(days = 14) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: SHADCHAN_TZ, year: "numeric", month: "numeric", day: "numeric"
  }).formatToParts(new Date());
  const num = (type) => Number(parts.find(p => p.type === type).value);
  const y = num("year"), m = num("month"), d = num("day");

  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long", month: "short", day: "numeric" });
  const out = [];
  for (let i = 0; i < days; i++) {
    let label = fmt.format(new Date(Date.UTC(y, m - 1, d + i, 12)));
    if (i === 0) label += " (today)";
    if (i === 1) label += " (tomorrow)";
    out.push(label);
  }
  return out.join("; ");
}

// "2026-11-08 20:00" typed in New York time -> the real moment it refers to (handles DST).
function nyLocalToDate(str) {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})/.exec(String(str || "").trim());
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const asUTC = Date.UTC(y, mo - 1, d, h, mi);
  const offsetAt = (ms) => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: SHADCHAN_TZ, hourCycle: "h23",
      year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric"
    }).formatToParts(new Date(ms));
    const g = (t) => Number(parts.find(p => p.type === t).value);
    return Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute")) - ms;
  };
  let guess = asUTC - offsetAt(asUTC);
  guess = asUTC - offsetAt(guess);
  const out = new Date(guess);
  return isNaN(out.getTime()) ? null : out;
}

// Simple fallback only, used if the Hebrew calendar library can't load: never Saturday, Friday morning only.
function okToTextNowSimple(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: SHADCHAN_TZ, weekday: "short", hourCycle: "h23", hour: "numeric"
  }).formatToParts(now);
  const day = parts.find(p => p.type === "weekday").value;
  const hour = Number(parts.find(p => p.type === "hour").value);
  if (day === "Sat") return false;
  if (day === "Fri") return hour >= 10 && hour < 13;
  return hour >= 10 && hour < 20;
}

// Shabbat and Yom Tov, worked out from the real Hebrew calendar for New York (Hebcal's open-source
// library, runs inside the function, so there's no web call that could fail). Candle lighting
// starts the rest, Havdalah ends it; back-to-back days (Yom Tov into Shabbat) stay blocked
// throughout because no Havdalah falls between them.
let hebcalPromise = null;
function loadHebcal() {
  if (!hebcalPromise) hebcalPromise = import("@hebcal/core").catch(err => { hebcalPromise = null; throw err; });
  return hebcalPromise;
}
const restCache = new Map(); // "YYYY-MM-DD" (NY day) -> [{ t: ms, start: bool }]
async function restEventsAround(now) {
  const key = new Intl.DateTimeFormat("en-CA", { timeZone: SHADCHAN_TZ }).format(now);
  if (restCache.has(key)) return restCache.get(key);
  const { HebrewCalendar, Location, flags } = await loadHebcal();
  const loc = Location.lookup("New York");
  const raw = HebrewCalendar.calendar({
    start: new Date(now.getTime() - 5 * 86400000),
    end: new Date(now.getTime() + 5 * 86400000),
    location: loc, candlelighting: true, sedrot: false,
    candleLightingMins: -18, havdalahMins: 50
  });
  const list = [];
  for (const e of raw) {
    if (!e.eventTime) continue;
    if (e.getFlags() & flags.LIGHT_CANDLES) list.push({ t: e.eventTime.getTime(), start: true });
    else if (/^Havdalah/i.test(e.getDesc())) list.push({ t: e.eventTime.getTime(), start: false });
  }
  list.sort((a, b) => a.t - b.t);
  if (restCache.size > 5) restCache.clear();
  restCache.set(key, list);
  return list;
}

// True when it's a sensible moment to send an unprompted text. 10am-8pm New York, and never from
// an hour before candle lighting until after Havdalah (Shabbos and every Yom Tov day).
async function isSafeToText(now = new Date()) {
  try {
    const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: SHADCHAN_TZ, hourCycle: "h23", hour: "numeric" }).format(now));
    if (hour < 10 || hour >= 20) return false;
    const events = await restEventsAround(now);
    const t = now.getTime();
    const HOUR = 3600000;
    // Inside the rest: the last event at or before now was a candle lighting.
    let last = null;
    for (const e of events) if (e.t <= t) last = e;
    if (last && last.start) return false;
    // The hour before candle lighting, too.
    const next = events.find(e => e.t > t);
    if (next && next.start && next.t - t < HOUR) return false;
    return true;
  } catch (err) {
    console.error("[Shadchan] Hebrew calendar unavailable, using the simple Shabbos rule:", err);
    return okToTextNowSimple(now);
  }
}

const SHADCHAN_ACTIONS = ["continue", "ask_partner", "answer_partner", "tell_partner", "forward_media", "no_reply"];

const SHADCHAN_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    replyText:             { type: Type.STRING },
    action:                { type: Type.STRING, enum: SHADCHAN_ACTIONS },
    nextIndex:             { type: Type.INTEGER },
    matchConfirmed:        { type: Type.BOOLEAN },
    confirmedCandidateId:  { type: Type.STRING },
    closeSession:          { type: Type.BOOLEAN },
    crossSessionMessage:   { type: Type.STRING },
    mediaKeys:             { type: Type.ARRAY, items: { type: Type.STRING } },
    agreedTime:            { type: Type.STRING },
    address:               { type: Type.STRING },
    dateLocal:             { type: Type.STRING },
    dateOutcome:           { type: Type.STRING, enum: ["none", "didnt_happen", "went_not_match", "went_continue"] }
  },
  required: ["replyText", "action", "nextIndex", "matchConfirmed", "closeSession"]
};

/**
 * HELPER: Lazily instantiates the Gemini AI client at runtime using injected secrets
 */
function getAiClient() {
  return new GoogleGenAI({ apiKey: geminiApiKey.value() });
}

// Automatically complete events and run AI Shadchan process for threshold passed events.
exports.autoCompleteEventsAndRunAI = onSchedule({
  schedule: "every 1 hours",
  timeoutSeconds: 540,
  secrets: [geminiApiKey, telnyxApiKey, telnyxPhoneNumber]
}, async (event) => {
  // Opening texts go out at the first safe moment. Nothing is marked done until then.
  if (!(await isSafeToText())) { console.log("Not a good time to text (night, Shabbos or Yom Tov). Will retry next hour."); return; }
  const now = admin.firestore.Timestamp.now();
  const eventsRef = db.collection("events");

  const snapshot = await eventsRef.where("isCompleted", "==", false).where("aiProcessed", "==", false).get();

  if (snapshot.empty) {
    console.log("No pending events to process.");
    return;
  }

  const batch = db.batch();
  const eventsToProcess = [];

  snapshot.forEach((doc) => {
    const eventData = doc.data();

    if (!eventData.scheduledAt) return;

    const scheduledTimeMs = eventData.scheduledAt.toDate().getTime();
    const eighteenHoursMs = 18 * 60 * 60 * 1000;
    const targetCompletionTime = scheduledTimeMs + eighteenHoursMs;

    if (Date.now() >= targetCompletionTime) {
      console.log(`Auto-completing event: ${doc.id}`);

      batch.update(doc.ref, {
        active: false,
        isCompleted: true,
        endDate: now,
        aiProcessed: true 
      });

      eventsToProcess.push(doc.id);
    }
  });

  if (eventsToProcess.length > 0) {
    await batch.commit();

    const aiPromises = eventsToProcess.map(eventId => runAiShadchanFunctions(eventId));
    await Promise.all(aiPromises);

    console.log(`Successfully completed and ran AI for ${eventsToProcess.length} event(s).`);
  }
});

// Listens for manual completion of events in the AdminDashboard.
exports.manualEventCompletionTrigger = onDocumentUpdated({
  document: "events/{eventId}",
  timeoutSeconds: 540,
  secrets: [geminiApiKey, telnyxApiKey, telnyxPhoneNumber]
}, async (event) => {
  const beforeData = event.data.before.data();
  const afterData = event.data.after.data();

  if (beforeData.isCompleted !== true && afterData.isCompleted === true && afterData.aiProcessed !== true) {
    console.log(`Manual override detected for Event: ${event.params.eventId}. Starting AI immediately.`);
    
    await event.data.after.ref.update({ aiProcessed: true });
    await runAiShadchanFunctions(event.params.eventId);
  }
});

/**
 * ------------------------------------------------------------------
 * CONVERSATIONAL AI SHADCHAN IMPLEMENTATION
 * ------------------------------------------------------------------
 */

async function runAiShadchanFunctions(eventId) {
  console.log(`Initializing individual AI Shadchan threads for Event: ${eventId}`);

  try {
    const usersSnapshot = await db.collection("users").get();
    const allUsersMap = {};
    usersSnapshot.forEach(doc => { allUsersMap[doc.id] = { id: doc.id, ...doc.data() }; });

    // 1. Create an array of Promises mapping over each user
    const userProcessingPromises = Object.keys(allUsersMap).map(async (userId) => {
      try {
        const user = allUsersMap[userId];
        const feedbackArray = user.feedbackData || [];

        const priorityYes = [];
        const standardYes = [];
        const maybes = [];

        feedbackArray.forEach(f => {
          if (f.event !== eventId) return;

          const partner = allUsersMap[f.partnerId];
          if (!partner) return; // Failsafe if partner deleted their account

          const partnerFeedback = partner.feedbackData || [];
          
          // Look for the user's ID inside the partner's feedback array
          const mutualInterest = partnerFeedback.find(
            pf => pf.partnerId === userId && 
                  pf.event === eventId && 
                  (pf.interested === "yes" || pf.interested === "maybe")
          );

          // If the partner didn't say yes or maybe, skip this candidate!
          if (!mutualInterest) return;

          const candidateInfo = {
            candidateId: f.partnerId,
            name: `${allUsersMap[f.partnerId]?.firstName || ""} ${allUsersMap[f.partnerId]?.lastName || ""}`.trim() || "An Attendee",
            notes: allUsersMap[f.partnerId]?.bio || ""
          };

          if (f.interested === "yes" && f.isPriority) {
            priorityYes.push(candidateInfo);
          } else if (f.interested === "yes") {
            standardYes.push(candidateInfo);
          } else if (f.interested === "maybe") {
            maybes.push(candidateInfo);
          }
        });

        const pipeline = [...priorityYes, ...standardYes, ...maybes];
        
        // Use 'return' instead of 'continue' since we are inside a map callback
        if (pipeline.length === 0) return;

        if (!user.smsOptIn) {
          console.log(`Skipping SMS for user ${userId}: User did not opt-in to SMS notifications.`);
          return; 
        }

        // Use Telnyx formatting (must include +1)
        const formattedPhone = formatForTelnyx(user.phone);
        if (!formattedPhone) {
          console.warn(`Skipping user ${userId}: No valid phone number found.`);
          return; 
        }

        const sessionId = `${eventId}_${userId}`;
        const sessionRef = db.collection("aiMatchmakerSessions").doc(sessionId);

        const userProfile = {
          age: user.age || 0,
          gender: user.gender || "",
          birthDate: user.birthDate || "",
          ethnicity: user.ethnicity || [],
          otherSpecify: user.otherSpecify || "",
          isKohen: user.isKohen || "no",
          isShomerShabbat: user.isShomerShabbat || "yes",
          isShomerKashrut: user.isShomerKashrut || "yes",
          wantsCoveredHead: user.wantsCoveredHead || "N/A",
          hairCovering: user.hairCovering || "N/A",
          dressStyle: user.dressStyle || "N/A",
          maritalStatus: user.maritalStatus || "",
          anythingElse: user.anythingElse || ""
        };

        const sessionData = {
          eventId: eventId,
          userId: userId,
          userName: `${user.firstName || ""} ${user.lastName || ""}`.trim(),
          userPhoneNumber: formattedPhone, 
          userProfile: userProfile, 
          candidatePipeline: pipeline,
          currentPipelineIndex: 0,
          messages: [],
          status: "active",
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        };

        const currentCandidate = pipeline[0];
        const openingMessageText = `Hi ${user.firstName || "there"}!\n\nIt's SY SmartMatch, you have a mutual match with ${currentCandidate.name}.\n\nWould you be interested in setting up a first date?`;

        sessionData.messages.push({
          sender: "ai",
          text: openingMessageText,
          timestamp: new Date().toISOString()
        });

        await sessionRef.set(sessionData);
        await sendTelnyxMessage(sessionData.userPhoneNumber, openingMessageText);
        // await sendWhatsAppTemplate(sessionData.userPhoneNumber, "intro", currentCandidate.name);

      } catch (userError) {
        // Catch individual user errors so it doesn't fail the entire Promise.all
        console.error(`Error processing AI Shadchan for user ${userId}:`, userError);
      }
    });

    // 2. Execute all user threads concurrently
    await Promise.all(userProcessingPromises);
    
    console.log(`Successfully completed all AI Shadchan threads for Event: ${eventId}`);

  } catch (error) {
    console.error("Failed to initialize AI Shadchan threads:", error);
  }
}

async function findSessionForPhone(phone) {
  // Single-field equality filter — needs no composite index, so there's nothing to
  // remember to set up before deploy. Sorting a handful of docs in memory is trivial.
  const snap = await db.collection("aiMatchmakerSessions")
    .where("userPhoneNumber", "==", phone)
    .get();
  if (snap.empty) return null;

  const docs = snap.docs.sort((a, b) => {
    const at = a.data().createdAt?.toMillis?.() || 0;
    const bt = b.data().createdAt?.toMillis?.() || 0;
    return bt - at;
  });

  return docs.find(d => d.data().status !== "opted_out") || docs[0];
}

/**
 * OFFICIAL TELNYX API WEBHOOK ENDPOINT
 */
exports.handleIncomingTelnyx = onRequest(
  { secrets: [geminiApiKey, telnyxApiKey, telnyxPhoneNumber], timeoutSeconds: 300, memory: "512MiB" },
  async (req, res) => {
    if (req.method !== "POST") { res.sendStatus(405); return; }

    const event = req.body?.data;
    const payload = event?.payload;
    if (event?.event_type !== "message.received" || !payload) { res.sendStatus(200); return; }

    const messageId = payload.id || "";
    const fromPhone = formatForTelnyx(payload.from?.phone_number);
    const incomingText = (payload.text || "").trim();
    const incomingMedia = payload.media || [];
    if (incomingMedia.length) {
      console.log(`[Shadchan] Inbound media from ${fromPhone}:`, incomingMedia.map(m => ({ url: m.url, content_type: m.content_type })));
    }
    if (!incomingText && !incomingMedia.length) { res.sendStatus(200); return; }

    try {
      // Telnyx re-delivers webhooks. Without this the user gets double-texted.
      if (messageId) {
        const seenRef = db.collection("processedInbound").doc(messageId);
        const isNew = await db.runTransaction(async (t) => {
          if ((await t.get(seenRef)).exists) return false;
          t.set(seenRef, { at: admin.firestore.FieldValue.serverTimestamp() });
          return true;
        });
        if (!isNew) { res.sendStatus(200); return; }
      }

      const sessionDoc = await findSessionForPhone(fromPhone);
      if (!sessionDoc) {
        await sendTelnyxMessage(fromPhone, "Hi, following up from SY SmartMatch. I don't have an open intro on this number right now, but tell me what you're looking for and I'll see what I can do.");
        res.sendStatus(200);
        return;
      }

      const snapshotData = sessionDoc.data();
      const storedMedia = await persistInboundMedia(
        { eventId: snapshotData.eventId, userId: snapshotData.userId },
        incomingMedia
      );

      await appendInbound(sessionDoc.ref, {
        sender: "user",
        messageId,
        text: incomingText,
        media: storedMedia,
        mediaUrls: storedMedia.map(m => m.url),
        failedMediaCount: incomingMedia.length - storedMedia.length,
        timestamp: new Date().toISOString()
      });

      const sessionData = await claimTurn(sessionDoc.ref, messageId);
      if (!sessionData) { res.sendStatus(200); return; } // a newer text is already handling this turn

      await processClaimedTurn(sessionDoc.ref, sessionData);

    } catch (err) {
      console.error("Inbound handler failed:", err);
      await sendTelnyxMessage(fromPhone, "Sorry, give me a minute and text me again. Something's being slow on my end.").catch(() => {});
    }

    res.sendStatus(200);
  }
);

// Safety net: catches any message that never got a reply — a slow generation that lost
// a race with a lock, or an instance that died mid-turn. Runs often and cheaply; in the
// healthy case this finds nothing, since normal turns finish in a few seconds.
exports.retryUnansweredMessages = onSchedule({
  schedule: "every 2 minutes",
  timeoutSeconds: 120,
  secrets: [geminiApiKey, telnyxApiKey, telnyxPhoneNumber]
}, async (event) => {
  const STUCK_AFTER_MS = 45 * 1000; // comfortably longer than the 4s coalesce + a normal reply
  const nowMs = Date.now();

  const snapshot = await db.collection("aiMatchmakerSessions")
    .where("status", "==", "active")
    .get();

  if (snapshot.empty) return;

  for (const doc of snapshot.docs) {
    const data = doc.data();
    const messages = data.messages || [];
    if (!messages.length) continue;

    const last = messages[messages.length - 1];
    if (last.sender !== "user") continue; // already answered — nothing to recover

    const age = nowMs - new Date(last.timestamp).getTime();
    if (age < STUCK_AFTER_MS) continue; // still well within normal processing time

    const lockUntil = data.processingUntil ? new Date(data.processingUntil).getTime() : 0;
    if (nowMs < lockUntil) continue; // genuinely still being worked on

    console.warn(`Recovering unanswered message in session ${doc.id}`);
    try {
      const claimed = await claimTurn(doc.ref, last.messageId);
      if (!claimed) continue; // superseded, or another instance just grabbed it
      await processClaimedTurn(doc.ref, claimed);
    } catch (err) {
      console.error(`Recovery failed for session ${doc.id}:`, err);
      await doc.ref.update({ processingUntil: null }).catch(() => {});
    }
  }
});

// Everything that happens once a turn is successfully claimed. Shared by the live webhook
// and the recovery sweep below, so the two can never drift into different behavior.
async function processClaimedTurn(ref, sessionData) {
  // A send that fails with 40300 means this number opted out (STOP/CANCEL/etc) — mark
  // whichever session just tried to text them so we stop pretending things are fine.
  const markIfBlocked = async (targetRef, result) => {
    if (result?.blocked) await targetRef.update({ status: "opted_out" }).catch(() => {});
    return result;
  };

  try {
    sessionData.messages = sessionData.messages || [];
    if (sessionData.status === "completed") sessionData.status = "active";

    const ownMedia = await resolveOwnMedia(sessionData.userId);
    const ai = await generateAiResponseWithState(sessionData, ownMedia);
    console.log(`[Shadchan] AI decision for ${sessionData.userId}: action=${ai.action} agreedTime=${ai.agreedTime || "(none)"} address=${ai.address ? "(given)" : "(none)"} mediaKeys=${JSON.stringify(ai.mediaKeys)} crossSessionMessage=${ai.crossSessionMessage ? JSON.stringify(ai.crossSessionMessage) : "(none)"}`);

    const firstName = (sessionData.userName || "").split(" ")[0];
    const stamp = () => new Date().toISOString();
    const msg = (sender, text) => ({ sender, text, timestamp: stamp() });
    const curIdx = sessionData.currentPipelineIndex || 0;

    const candidateId = sessionData.candidatePipeline?.[curIdx]?.candidateId;
    // Whoever asked us something is who we answer; otherwise it's the person we're matched with.
    const counterpartId = sessionData.pendingInboundQuestion?.fromUserId || candidateId;
    const sessionRefFor = (userId) => db.collection("aiMatchmakerSessions").doc(`${sessionData.eventId}_${userId}`);

    // Reuse the media we already loaded, matched by the key the model gave us.
    let attachments = ai.mediaKeys.length ? ownMedia.filter(m => ai.mediaKeys.includes(m.key)) : [];
    if (ai.mediaKeys.length && !attachments.length) {
      console.warn("Model asked to forward keys that don't exist:", ai.mediaKeys, "available keys:", ownMedia.map(m => m.key));
    }
    // If we're meant to be sending something but couldn't resolve which file from the model's
    // keys, fall back to whatever was actually just sent.
    if ((ai.action === "forward_media" || ai.action === "answer_partner") && !attachments.length) {
      attachments = collectBurstMedia(sessionData.messages);
      console.log(`[Shadchan] Fell back to collectBurstMedia: found ${attachments.length} item(s)`, attachments.map(a => a.key));
    }
    console.log(`[Shadchan] Final attachments to forward: ${attachments.length}`, attachments.map(a => ({ key: a.key, contentType: a.contentType })));

    // Safety nets for when the model's output and its action don't line up.
    // An address was given but the model forgot to pass it on, so pass it on.
    if (ai.address && ai.action === "continue") {
      ai.action = "tell_partner";
      ai.crossSessionMessage = ai.crossSessionMessage || `Address: ${ai.address}`;
    }
    // Nothing to deliver means there's nothing to relay.
    if (ai.action === "tell_partner" && !ai.crossSessionMessage) ai.action = "continue";
    if ((ai.action === "answer_partner" || ai.action === "forward_media") && !ai.crossSessionMessage && !attachments.length) {
      ai.action = "continue";
    }

    // Applies on every path, not just "continue".
    // no_reply is only honored for a short, plain acknowledgment once a date is set. Anything
    // else gets the reply the model wrote, so a real question is never met with silence.
    let staySilent = false;
    if (ai.action === "no_reply") {
      const lastUser = [...sessionData.messages].reverse().find(m => m.sender === "user");
      const t = (lastUser?.text || "").trim();
      staySilent = !!sessionData.dateDetails?.time && t.length > 0 && t.length <= 30 && !t.includes("?") && !lastUser?.media?.length;
      ai.action = "continue";
    }

    const dd = sessionData.dateDetails || {};
    const basePatch = {
      currentPipelineIndex: ai.nextIndex,
      status: ai.closeSession ? "completed" : "active"
    };
    // Not a match: this thread is done.
    if (dd.followUpSent && ai.dateOutcome === "went_not_match") basePatch.status = "completed";
    // Didn't happen: wipe the old plan so the time-setting steps start fresh.
    if (dd.followUpSent && ai.dateOutcome === "didnt_happen") basePatch.dateDetails = admin.firestore.FieldValue.delete();
    // Moving on to someone new: what was settled with the last person doesn't carry over.
    if (ai.nextIndex > curIdx) basePatch.dateDetails = admin.firestore.FieldValue.delete();

    if (ai.matchConfirmed && ai.confirmedCandidateId) {
      await recordConversationalMatch(sessionData.eventId, sessionData.userId, ai.confirmedCandidateId);
    }

    // Record every candidate skipped in this jump, not just the one right after curIdx.
    for (let i = curIdx; i < ai.nextIndex; i++) {
      const passedId = sessionData.candidatePipeline?.[i]?.candidateId;
      if (passedId) await recordPass(sessionData.eventId, sessionData.userId, passedId);
    }

    // Remember what's been settled on BOTH sides, so neither session loses track of it.
    const dateFields = {};
    if (ai.agreedTime) dateFields["dateDetails.time"] = ai.agreedTime;
    if (ai.address) dateFields["dateDetails.address"] = ai.address;
    if (ai.dateLocal) {
      const when = nyLocalToDate(ai.dateLocal);
      const now = Date.now();
      if (when && when.getTime() > now && when.getTime() < now + 60 * 24 * 60 * 60 * 1000) {
        dateFields["dateDetails.at"] = admin.firestore.Timestamp.fromDate(when);
        dateFields["dateDetails.followUpAt"] = admin.firestore.Timestamp.fromMillis(when.getTime() + 24 * 60 * 60 * 1000);
        dateFields["dateDetails.followUpSent"] = false;
        console.log(`[Shadchan] Date set for ${when.toISOString()}; follow-up due ${new Date(when.getTime() + 86400000).toISOString()}`);
      } else {
        console.warn(`[Shadchan] Ignoring unusable dateLocal "${ai.dateLocal}"`);
      }
    }
    if (Object.keys(dateFields).length) {
      await ref.update(dateFields).catch(err => console.error("[Shadchan] dateDetails save failed:", err));
      if (counterpartId) await sessionRefFor(counterpartId).update(dateFields).catch(() => {});
    }

    // Tell the other session how the date went, and reset both sides if it never happened.
    if (dd.followUpSent && ai.dateOutcome !== "none") {
      console.log(`[Shadchan] Date outcome from ${sessionData.userId}: ${ai.dateOutcome}`);
      await ref.update({ "dateDetails.outcome": ai.dateOutcome }).catch(() => {});
      if (counterpartId) {
        if (ai.dateOutcome === "didnt_happen") {
          await sessionRefFor(counterpartId).update({ dateDetails: admin.firestore.FieldValue.delete() }).catch(() => {});
        } else {
          await sessionRefFor(counterpartId).update({ "dateDetails.otherOutcome": ai.dateOutcome }).catch(() => {});
        }
      }
      if (ai.dateOutcome === "went_not_match" && candidateId) {
        await recordPass(sessionData.eventId, sessionData.userId, candidateId);
        // Let the other side know, kindly, at the next safe moment (followUpAfterDates delivers it).
        // Skip if they've already told us how it went, or already heard.
        try {
          const cSnap = await sessionRefFor(counterpartId || candidateId).get();
          const c = cSnap.exists ? cSnap.data() : null;
          const cdd = c?.dateDetails || {};
          const alreadyKnows = !c || cdd.outcome || cdd.noticeSent || cdd.noticeDue || cdd.otherOutcome === "went_not_match" || c.status === "opted_out";
          if (!alreadyKnows) {
            const myFirst = (sessionData.userName || "").split(" ")[0] || "them";
            const theirFirst = (c.userName || "").split(" ")[0] || "there";
            await recordPass(sessionData.eventId, c.userId || (counterpartId || candidateId), sessionData.userId);
            await cSnap.ref.update({
              "dateDetails.noticeDue": true,
              "dateDetails.noticeText": `Hi ${theirFirst}, I checked in with ${myFirst} and it sounds like it wasn't the right fit this time. Thank you for giving it a try.`
            });
          }
        } catch (err) {
          console.error("[Shadchan] Could not queue the not-a-match notice:", err);
        }
      }
    }

    // If WE still owe someone an answer, don't let a new question jump the queue —
    // that's exactly how both threads end up paused waiting on each other.
    if (ai.action === "ask_partner" && sessionData.pendingInboundQuestion) {
      ai.action = "continue";
      ai.replyText = "Can you answer that last question first?";
    }

    if (ai.action === "ask_partner" && ai.crossSessionMessage) {
      const partnerRef = candidateId ? sessionRefFor(candidateId) : null;
      const partnerSnap = partnerRef ? await partnerRef.get() : null;
      const p = partnerSnap?.exists ? partnerSnap.data() : null;

      if (!p) {
        const fallback = "Can't reach them right now. Wait, or move on to the next one?";
        await commitTurn(ref, { ...basePatch, status: "active" }, [msg("ai", fallback)]);
        await markIfBlocked(ref, await sendTelnyxMessage(sessionData.userPhoneNumber, fallback));

      } else {
        await commitTurn(ref, { ...basePatch, status: "paused_waiting_on_partner" }, [msg("ai", ai.replyText)]);
        await markIfBlocked(ref, await sendTelnyxMessage(sessionData.userPhoneNumber, ai.replyText));

        await commitCrossSession(partnerRef, {
          status: "active",
          pendingInboundQuestion: {
            fromUserId: sessionData.userId,
            fromName: firstName,
            question: ai.crossSessionMessage,
            askedAt: stamp()
          }
        }, [msg("system", ai.crossSessionMessage)]);
        console.log(`[Shadchan] Delivering to partner ${p.userPhoneNumber}: note="${ai.crossSessionMessage}" attachments=${attachments.length}`);
        const partnerSendResult = await sendWithAttachments(p.userPhoneNumber, ai.crossSessionMessage, attachments);
        console.log(`[Shadchan] Partner send result:`, partnerSendResult);
        await markIfBlocked(partnerRef, partnerSendResult);
      }

    } else if (ai.action === "answer_partner" || ai.action === "forward_media") {
      const note = ai.crossSessionMessage || "Here you go.";
      let delivered = false;
      if (counterpartId) {
        const askerRef = sessionRefFor(counterpartId);
        const askerSnap = await askerRef.get();
        if (askerSnap.exists) {
          await commitCrossSession(askerRef, { status: "active" }, [msg("system", note)]);
          console.log(`[Shadchan] Delivering to asker ${askerSnap.data().userPhoneNumber}: note="${note}" attachments=${attachments.length}`);
          const askerSendResult = await sendWithAttachments(askerSnap.data().userPhoneNumber, note, attachments);
          console.log(`[Shadchan] Asker send result:`, askerSendResult);
          await markIfBlocked(askerRef, askerSendResult);
          delivered = true;
        }
      }
      if (!delivered) {
        console.warn(`Undeliverable cross-session message; counterpartId=${counterpartId}`);
        ai.replyText = "Couldn't reach them just now. Can you text me again in a bit?";
      }

      await commitTurn(ref, {
        ...basePatch,
        pendingInboundQuestion: admin.firestore.FieldValue.delete()
      }, [msg("ai", ai.replyText)]);
      await markIfBlocked(ref, await sendTelnyxMessage(sessionData.userPhoneNumber, ai.replyText));

    } else if (ai.action === "tell_partner") {
      // Something the other side should hear that needs no reply (her address, mostly).
      // No pending question and no pause on either side, so nobody ends up waiting.
      let delivered = false;
      if (counterpartId) {
        const otherRef = sessionRefFor(counterpartId);
        const otherSnap = await otherRef.get();
        if (otherSnap.exists) {
          await commitCrossSession(otherRef, { status: "active" }, [msg("system", ai.crossSessionMessage)]);
          console.log(`[Shadchan] Telling ${otherSnap.data().userPhoneNumber}: note="${ai.crossSessionMessage}" attachments=${attachments.length}`);
          const tellResult = await sendWithAttachments(otherSnap.data().userPhoneNumber, ai.crossSessionMessage, attachments);
          console.log(`[Shadchan] Tell send result:`, tellResult);
          await markIfBlocked(otherRef, tellResult);
          delivered = true;
        }
      }
      if (!delivered) {
        console.warn(`Undeliverable tell_partner; counterpartId=${counterpartId}`);
        ai.replyText = "Couldn't reach them just now. Can you text me again in a bit?";
      }

      await commitTurn(ref, { ...basePatch, pendingInboundQuestion: admin.firestore.FieldValue.delete() }, [msg("ai", ai.replyText)]);
      await markIfBlocked(ref, await sendTelnyxMessage(sessionData.userPhoneNumber, ai.replyText));

    } else if (staySilent) {
      // A blank "ai" entry marks the message as handled, so the retry sweep doesn't try again.
      console.log(`[Shadchan] Staying quiet for ${sessionData.userId}: plain acknowledgment after the date was set`);
      await commitTurn(ref, basePatch, [{ sender: "ai", text: "", silent: true, timestamp: stamp() }]);

    } else {
      await commitTurn(ref, basePatch, [msg("ai", ai.replyText)]);
      await markIfBlocked(ref, await sendTelnyxMessage(sessionData.userPhoneNumber, ai.replyText));
    }
  } catch (err) {
    console.error("processClaimedTurn failed:", err);
    await ref.update({ processingUntil: null }).catch(() => {});
    await sendTelnyxMessage(sessionData.userPhoneNumber, "Sorry, can you text me that again in a minute?").catch(() => {});
  }
}

// The morning after a date: ask each side how it went. Runs hourly, but only texts in a
// sensible window (Sun-Thu daytime, Friday morning). Never Friday afternoon or Saturday.
exports.followUpAfterDates = onSchedule({
  schedule: "every 1 hours",
  timeoutSeconds: 300,
  secrets: [telnyxApiKey, telnyxPhoneNumber]
}, async (event) => {
  if (!(await isSafeToText())) return;

  const nowTs = admin.firestore.Timestamp.now();

  // 1) Deliver queued "it wasn't a match" notices first.
  const noticeSnap = await db.collection("aiMatchmakerSessions").where("dateDetails.noticeDue", "==", true).get();
  for (const doc of noticeSnap.docs) {
    const d = doc.data();
    const dd0 = d.dateDetails || {};
    try {
      if (d.status === "opted_out" || dd0.outcome || !dd0.noticeText) {
        await doc.ref.update({ "dateDetails.noticeDue": false }).catch(() => {});
        continue;
      }
      // Mark first so an overlapping run can't send it twice. The notice stands in for the "how did it go" check-in.
      await commitCrossSession(doc.ref, {
        status: "active",
        "dateDetails.noticeDue": false,
        "dateDetails.noticeSent": true,
        "dateDetails.followUpSent": true
      }, [{ sender: "ai", text: dd0.noticeText, timestamp: new Date().toISOString() }]);
      const result = await sendTelnyxMessage(d.userPhoneNumber, dd0.noticeText);
      if (result?.blocked) await doc.ref.update({ status: "opted_out" }).catch(() => {});
      console.log(`[Shadchan] Not-a-match notice sent to ${doc.id}:`, result);
    } catch (err) {
      console.error(`Notice failed for ${doc.id}:`, err);
    }
  }

  // 2) The day-after check-ins.
  const snapshot = await db.collection("aiMatchmakerSessions")
    .where("dateDetails.followUpAt", "<=", nowTs)
    .get();
  if (snapshot.empty) return;

  const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  let sent = 0;

  for (const doc of snapshot.docs) {
    const d = doc.data();
    const dd = d.dateDetails || {};
    if (dd.followUpSent || dd.noticeDue || d.status === "opted_out") continue;
    // Too late to ask casually. Mark it handled instead of texting about an old date.
    if (nowTs.toMillis() - dd.followUpAt.toMillis() > WEEK_MS) {
      await doc.ref.update({ "dateDetails.followUpSent": true }).catch(() => {});
      continue;
    }

    const first = (d.userName || "").split(" ")[0] || "there";
    const otherFirst = ((d.candidatePipeline?.[d.currentPipelineIndex]?.name) || "").split(" ")[0] || "them";
    const options = [
      `Hi ${first}, how did it go with ${otherFirst}?`,
      `Hey ${first}, how'd it go with ${otherFirst}?`,
      `Hi ${first}! How was it with ${otherFirst}?`
    ];
    const text = options[Math.floor(Math.random() * options.length)];

    try {
      // Mark first, so an overlapping run can't text the same person twice.
      await commitCrossSession(doc.ref, { status: "active", "dateDetails.followUpSent": true },
        [{ sender: "ai", text, timestamp: new Date().toISOString() }]);
      const result = await sendTelnyxMessage(d.userPhoneNumber, text);
      if (result?.blocked) await doc.ref.update({ status: "opted_out" }).catch(() => {});
      console.log(`[Shadchan] Follow-up sent to ${doc.id}:`, result);
      sent++;
    } catch (err) {
      console.error(`Follow-up failed for ${doc.id}:`, err);
    }
  }
  console.log(`[Shadchan] Sent ${sent} post-date follow-up(s).`);
});

exports.sweepStalledSessions = onSchedule({
  schedule: "every 1 hours",
  timeoutSeconds: 120,
  secrets: [telnyxApiKey, telnyxPhoneNumber]
}, async (event) => {
  if (!(await isSafeToText())) return;
  const waitThresholdMs = 72 * 60 * 60 * 1000; // 72 hours timeout
  const nowMs = Date.now();

  const snapshot = await db.collection("aiMatchmakerSessions")
    .where("status", "==", "paused_waiting_on_partner")
    .get();

  if (snapshot.empty) return;

  const stamp = () => new Date().toISOString();
  const timeoutText = "It looks like they haven't responded to your question yet. We can continue to wait, or if you'd prefer, we can move on to your next candidate. What would you like to do?";

  const docsToSweep = [];
  snapshot.forEach((doc) => {
    const d = doc.data();
    const messages = d.messages || [];
    if (!messages.length) return;
    const lastMessageTime = new Date(messages[messages.length - 1].timestamp).getTime();
    if (nowMs - lastMessageTime >= waitThresholdMs) docsToSweep.push({ ref: doc.ref, data: d });
  });

  if (!docsToSweep.length) return;

  // Firestore batches cap at 500 writes — chunk so a big backlog doesn't throw.
  const CHUNK = 450;
  let swept = 0;

  for (let i = 0; i < docsToSweep.length; i += CHUNK) {
    const chunk = docsToSweep.slice(i, i + CHUNK);
    const batch = db.batch();
    const sends = [];

    for (const { ref, data } of chunk) {
      // Append-only: never overwrite messages another instance may have just added.
      batch.set(ref, {
        status: "active",
        processingUntil: null,
        messages: admin.firestore.FieldValue.arrayUnion({ sender: "system", text: timeoutText, timestamp: stamp() })
      }, { merge: true });

      // The partner is still holding a question that's now moot — clear it so it doesn't
      // hang around telling the model this person owes an answer to an abandoned exchange.
      const partnerId = data.candidatePipeline?.[data.currentPipelineIndex]?.candidateId;
      if (partnerId) {
        const partnerRef = db.collection("aiMatchmakerSessions").doc(`${data.eventId}_${partnerId}`);
        batch.set(partnerRef, { pendingInboundQuestion: admin.firestore.FieldValue.delete() }, { merge: true });
      }

      sends.push(sendTelnyxMessage(data.userPhoneNumber, timeoutText));
    }

    await batch.commit();
    await Promise.allSettled(sends);
    swept += chunk.length;
  }

  console.log(`Swept and unpaused ${swept} stalled session(s).`);
});

// Strips every tell that makes it read like software.
function humanize(text) {
  if (!text) return "";
  return text
    .replace(/\[[^\]]*\]/g, "")                          // [bracketed stage directions]
    .replace(/\*\*(.*?)\*\*/g, "$1")                     // markdown bold
    .replace(/^\s*(AI|Assistant|Shadchan|Bot|System)\s*:\s*/i, "")
    .replace(/\b(as an AI|as a language model|I'?m an AI)\b[^.!?]*[.!?]?/gi, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function sanitizeAiPayload(p, sessionData, currentIdx) {
  const len = (sessionData.candidatePipeline || []).length;

  let nextIndex = Number.isInteger(p.nextIndex) ? p.nextIndex : currentIdx;
  if (nextIndex < currentIdx) nextIndex = currentIdx;   // never rewind
  if (nextIndex > len) nextIndex = len;                 // never run off the end

  const reply = humanize(p.replyText);

  return {
    replyText: reply || "Sorry, can you resend that?",
    action: SHADCHAN_ACTIONS.includes(p.action) ? p.action : "continue",
    nextIndex,
    matchConfirmed: p.matchConfirmed === true,
    confirmedCandidateId: p.confirmedCandidateId || sessionData.candidatePipeline?.[currentIdx]?.candidateId || "",
    // Only truly done when we've actually exhausted the pipeline.
    closeSession: p.closeSession === true && nextIndex >= len,
    crossSessionMessage: humanize(p.crossSessionMessage || ""),
    mediaKeys: Array.isArray(p.mediaKeys) ? p.mediaKeys : [],
    agreedTime: humanize(p.agreedTime || ""),
    address: String(p.address || "").trim(),
    dateLocal: String(p.dateLocal || "").trim(),
    dateOutcome: ["didnt_happen", "went_not_match", "went_continue"].includes(p.dateOutcome) ? p.dateOutcome : "none"
  };
}

async function generateAiResponseWithState(sessionData, ownMedia = []) {
  const currentIdx = Math.min(sessionData.currentPipelineIndex || 0, (sessionData.candidatePipeline || []).length);
  const pipeline = sessionData.candidatePipeline || [];
  const current = pipeline[currentIdx] || null;
  const otherName = current ? ((current.name || "").split(" ")[0] || "the other side") : "the other side";
  const firstName = (sessionData.userName || "").split(" ")[0] || "there";
  const ai = getAiClient();
  const dd = sessionData.dateDetails || {};

  const pending = sessionData.pendingInboundQuestion || null;
  if (pending) {
    console.log(`[Shadchan] Pending question for ${firstName} from ${pending.fromName}: "${pending.question}"`);
  }

  const systemInstruction = `
You are a shadchan texting ${firstName} from your own phone. To them you're a real person: warm, quick, natural.

TODAY
${nowForPrompt()} (New York time).
Next two weeks: ${upcomingDaysForPrompt(14)}.
Use this to turn "tomorrow", "Sunday" or "next Thursday" into a real date. If a day could mean two dates (like "tomorrow" late at night), check which one they mean. When you confirm a time, always say the day, date and time, never just "tomorrow" or "tonight".

HOW YOU TEXT
- Keep it short. One sentence is normal, two short ones at most. Aim for under 15 words.
- Talk like a friend texting. Plain words, contractions. No filler openers like "Great!", "Wonderful!" or "Glad we got that sorted".
- No brackets, asterisks, bullets, lists or emoji. Never mention being a bot, system, service or AI.
- Don't repeat their name or echo back what they said. Just answer.
- Always answer what they asked. If you don't know, say you'll ask the other side and use ask_partner.
- If they ask something off-topic, answer in a few words and steer back.

Tone examples:
"Sunday, Nov 8 at 8:00 PM works for him. What address should I send him?"
"Sure, I'll ask him."
"Sent it to him. Have a great time!"
"Not sure, let me ask."

YOU CAN ONLY ACT WHEN SOMEONE TEXTS YOU
- You can't follow up later, work on logistics, set things up, or send details once they're ready. Never say you will.
- You don't book or choose places. Your job is to get a day and time both sides agree on, then get her address to him. That's all.
- Only say you'll check with the other side if you're using ask_partner in this same reply.

ABOUT ${firstName} (the gender in this profile tells you whether ${firstName} is the woman or the man)
${JSON.stringify(sessionData.userProfile || {}, null, 2)}

WHO YOU'RE DISCUSSING RIGHT NOW
${current ? `${current.name} (id ${current.candidateId}). ${current.notes || ""}` : "You've been through everyone on the list."}
They are candidate ${currentIdx + 1} of ${pipeline.length}. Do not mention anyone further down the list until this one is settled.

${pending ? `${pending.fromName} asked ${firstName}: "${pending.question}"
Whatever ${firstName} says back, even a counter-offer like "how about Monday?", is the answer. Use answer_partner. If ${firstName} sends a file instead, that IS the answer: use forward_media with that file's key, no words needed.` : ""}

WHERE THE DATE STANDS
${dd.time ? `Time agreed: ${dd.time}.` : "No time agreed yet."}
${dd.address ? `Address: ${dd.address}.` : (dd.time ? "Address: not received yet." : "")}
${dd.followUpSent ? `The day after the date, you already asked ${firstName} how it went.` : ""}
${dd.otherOutcome === "went_not_match" ? `${otherName} told you they didn't feel it was a match.` : ""}
${dd.noticeSent ? `You already told ${firstName} that ${otherName} felt it wasn't the right fit. Don't announce it again.` : ""}

HOW A DATE GETS SET
1. Help them land on one specific day and time. Pass each proposal along with ask_partner, and each answer or counter-offer with answer_partner.
2. Once both sides have said yes to the same day and time, set agreedTime to the full day, date and time, like "Sunday, Nov 8 at 8:00 PM", and set dateLocal to that same moment as "YYYY-MM-DD HH:mm" in 24-hour New York time, like "2026-11-08 20:00". Work it out from the calendar above.
3. Right then, get her address (or wherever she'd like to meet) to him:
   - If ${firstName} is the woman, ask her in your reply: "What address should I send him?"
   - If ${firstName} is the man, put the confirmed time and the address question to her in crossSessionMessage ("Sunday, Nov 8 at 8:00 PM works for him. What address should I send him?"), and tell him it's confirmed.
4. When she gives it, use tell_partner (or answer_partner if it answers a question), put the address in crossSessionMessage, and set address. Tell her it's sent.
5. After that you're done. A quick good-luck is enough. Promise nothing more.
If the time is agreed and her address isn't in yet, and ${firstName} is the woman, ask for it (unless your last message already did and she hasn't answered). If ${firstName} is the man and asks, say you're waiting on her address and he'll get it as soon as she sends it.

ONCE THE DATE IS SET
- When the time is agreed and her address has been sent, you're done until the day after the date. Don't text first, check in, or remind anyone. Only reply when they text you something that needs an answer.
- If they only acknowledge ("ok", "thanks", "great", "will do"), use no_reply. Still write the reply you would have sent in replyText. It's only a backup and won't be sent.

${dd.noticeSent ? `AFTER THE NOT-A-MATCH NEWS
${firstName} just heard it wasn't the right fit with ${otherName}. Be warm and brief. Never give a reason; you don't have one and shouldn't guess. If ${firstName} is ready for the next person, move on (nextIndex ${currentIdx + 1}) and introduce them. If they want to talk first, just talk. If they say it wasn't a match for them either, that's fine, same thing.` : ""}

${dd.followUpSent && !dd.noticeSent ? `AFTER THE DATE
You already asked ${firstName} how it went. Their answer decides what happens. Set dateOutcome once, the first time they tell you:
- It didn't happen (cancelled, postponed, no-show): dateOutcome didnt_happen. Ask what day works to reschedule, action continue. Don't suggest a time for them. The normal time-setting steps start again from there.
- It happened and wasn't a match: dateOutcome went_not_match. One short kind line wishing them well. Nothing more.
- It happened and they want to keep going: dateOutcome went_continue. Ask what they liked about ${otherName} that they'd like you to pass on. When they tell you, send only what they said, in a short warm line, with tell_partner. If they'd rather not share anything, don't push.
${dd.otherOutcome === "went_not_match" ? `- ${otherName} didn't feel it was a match. If ${firstName} wants to keep going, tell them gently and briefly. Don't pass on anything else.` : ""}
Use dateOutcome none on every other message.` : ""}

ACTIONS
- continue: just reply to ${firstName}.
- ask_partner: ${firstName} has a question or proposal for ${otherName}. Put it in crossSessionMessage.
- answer_partner: ${firstName} is answering what ${otherName} asked or proposed, counter-offers included. Put the answer in crossSessionMessage.
- tell_partner: something ${otherName} should hear that needs no answer, like her address. Put it in crossSessionMessage.
- forward_media: pass along a file ${firstName} gave you, with its key in mediaKeys.
- no_reply: only for a bare acknowledgment after the date is set, as described above.
crossSessionMessage is the exact text the other person receives. Write it as a short text from you about ${firstName}, saying he or she, not their name. Example: "He says Sunday at 8 works."

FILES ${firstName} HAS SENT YOU (pass along by key)
${ownMedia.length ? JSON.stringify(ownMedia.map(m => ({ key: m.key, type: m.contentType, label: m.label || "" }))) : "None yet."}
- A photo, document or file with no caption, when one is expected, IS the file. Don't ask again. Use forward_media (or answer_partner) right away.
- If the other side wants a resume or photo ${firstName} hasn't sent, just ask for it in plain words, action continue.

THE MATCH
- If ${firstName} is in: matchConfirmed true.
- If ${firstName} passes: nextIndex ${currentIdx + 1}, and introduce the next person briefly in the same message.
- closeSession true only once nextIndex reaches ${pipeline.length}.
- If they send something explicit or offensive, don't pass it on. Say so kindly and briefly, action continue.
`.trim();

  // Only the tail of the thread — long histories are what starve the token budget.
  const recent = (sessionData.messages || []).slice(-MAX_HISTORY);

  // Track how far back the current unanswered stretch goes, so a photo sent a message
  // or two before this one still gets shown to the model, not just this exact turn's.
  let lastAiPos = -1;
  recent.forEach((m, i) => { if (m.sender === "ai") lastAiPos = i; });

  const contents = [];
  const mediaTasks = []; // { entry, mediaItems } — entry is a live reference, safe across trimming below

  for (let i = 0; i < recent.length; i++) {
    const m = recent[i];
    let text = m.text || "";
    if (!text && m.media?.length) {
      // Describe what arrived even for formats we can't show the model directly, so an
      // unreadable file (a .docx resume, say) never reads as "nothing was sent."
      text = m.media
        .map(item => GEMINI_INLINEABLE_TYPES.includes((item.contentType || "").toLowerCase())
          ? "(sent an attachment)"
          : `(sent a file — ${item.label || "document"})`)
        .join(" ");
      console.log(`[Shadchan] Message ${i} media placeholder: "${text}" (types: ${m.media.map(x => x.contentType).join(", ")})`);
    } else if (!text && m.failedMediaCount) {
      // Storage failed to save it — tell the model honestly instead of letting the message
      // vanish and having it confidently claim nothing was ever sent.
      text = "(tried to send a file, but it didn't come through on our end)";
    }
    if (!text) continue; // Gemini rejects a part with no content at all

    // System notes (cross-session questions/answers) are the shadchan's own words, not the
    // user's — mapping them to "user" would make the model think the person asked themselves.
    const role = (m.sender === "ai" || m.sender === "system") ? "model" : "user";
    const entry = { role, parts: [{ text }] };
    contents.push(entry);

    if (role === "user" && i > lastAiPos && m.media?.length) {
      mediaTasks.push({ entry, mediaItems: m.media });
    }
  }
  // Gemini requires the first turn to be "user" — drop any leading model turn if history got trimmed mid-thread.
  while (contents.length && contents[0].role === "model") contents.shift();
  // Degenerate case: everything got filtered out. Give the model something to answer.
  if (!contents.length) {
    const lastText = sessionData.messages?.[sessionData.messages.length - 1]?.text || "hi";
    contents.push({ role: "user", parts: [{ text: lastText }] });
  }

  // Inline every not-yet-answered attachment Gemini can actually read — the whole current
  // burst, not just this one call's — so a photo or PDF sent a message earlier is something
  // the model can actually see. Anything not in GEMINI_INLINEABLE_TYPES was already described
  // in text above instead of attempted here. Capped so several large files in one burst can't
  // blow past the request size limit — anything past the cap just stays a text placeholder.
  const MAX_INLINE_BYTES = 15 * 1024 * 1024;
  let inlinedBytes = 0;

  outer:
  for (const task of mediaTasks) {
    for (const m of task.mediaItems) {
      if (!GEMINI_INLINEABLE_TYPES.includes((m.contentType || "").toLowerCase())) {
        console.log(`[Shadchan] Skipping inline for key=${m.key} contentType=${m.contentType} — not a Gemini-readable type`);
        continue;
      }
      if (inlinedBytes >= MAX_INLINE_BYTES) break outer;
      try {
        const r = await fetch(m.url);
        const buf = Buffer.from(await r.arrayBuffer());
        if (inlinedBytes + buf.length > MAX_INLINE_BYTES) continue; // would push us over — skip, keep the placeholder
        inlinedBytes += buf.length;
        task.entry.parts.push({ inlineData: { data: buf.toString("base64"), mimeType: m.contentType } });
        console.log(`[Shadchan] Inlined key=${m.key} contentType=${m.contentType} bytes=${buf.length}`);
      } catch (err) {
        console.error("inline media fetch failed:", err);
      }
    }
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents,
        config: {
          systemInstruction,
          responseMimeType: "application/json",
          responseSchema: SHADCHAN_SCHEMA,
          temperature: 0.8,
          maxOutputTokens: 4096,                    // must cover thinking + output
          thinkingConfig: { thinkingLevel: "low" }  // on 2.5-era models use { thinkingBudget: 0 }
        }
      });

      const finish = response?.candidates?.[0]?.finishReason;
      const raw = (response.text || "").replace(/```json/gi, "").replace(/```/g, "").trim();

      if (!raw) {
        console.error(`Empty Gemini body. finishReason=${finish} attempt=${attempt}`);
        continue;
      }
      console.log(`[Shadchan] Gemini raw response (attempt ${attempt}):`, raw);
      return sanitizeAiPayload(JSON.parse(raw), sessionData, currentIdx);
    } catch (err) {
      console.error(`Gemini attempt ${attempt} failed:`, err);
    }
  }

  // Last resort — a human would never just stop replying.
  return sanitizeAiPayload({
    replyText: "Sorry, that one didn't come through on my end. Mind sending it again?",
    action: "continue",
    nextIndex: currentIdx,
    matchConfirmed: false,
    closeSession: false
  }, sessionData, currentIdx);
}

async function recordConversationalMatch(eventId, confirmingUserId, otherUserId) {
  const [u1, u2] = [confirmingUserId, otherUserId].sort();
  const ref = db.collection("activeMatches").doc(`${u1}_${u2}`);
  const myField = confirmingUserId === u1 ? "user1State" : "user2State";
  const theirField = confirmingUserId === u1 ? "user2State" : "user1State";

  await db.runTransaction(async (t) => {
    const snap = await t.get(ref);
    const prev = snap.exists ? snap.data() : {};

    // They already moved past this person — don't resurrect it.
    if (prev[theirField] === "passed") {
      console.log(`Skipping match ${u1}_${u2}: other side already passed.`);
      return;
    }

    const next = {
      eventId,
      user1Id: u1,
      user2Id: u2,
      conversationalMatch: true,
      user1State: prev.user1State || "pending",
      user2State: prev.user2State || "pending",
      [myField]: "confirmed",
      createdAt: prev.createdAt || admin.firestore.FieldValue.serverTimestamp()
    };
    next.status = next.user1State === "confirmed" && next.user2State === "confirmed"
      ? "both_confirmed"
      : "awaiting_other_side";

    t.set(ref, next, { merge: true });
  });
}

/**
 * OFFICIAL TELNYX API: Send SMS Message
 */
async function sendTelnyxMessage(toPhoneNumber, messageText, mediaUrls = [], attempt = 0) {
  const payload = { from: telnyxPhoneNumber.value(), to: toPhoneNumber };
  if (messageText) payload.text = messageText;
  if (mediaUrls?.length) payload.media_urls = mediaUrls.slice(0, 10); // Telnyx caps at 10

  try {
    const response = await fetch("https://api.telnyx.com/v2/messages", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${telnyxApiKey.value()}`,
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!response.ok) {
      const code = String(data?.errors?.[0]?.code || "");
      console.error("[Telnyx Error]", code, JSON.stringify(data));

      // 40300 = they texted STOP / CANCEL / END / QUIT. Never retry this — it's terminal.
      if (code === "40300") return { ok: false, blocked: true, code };

      // MMS rejected (expired URL, oversize, unsupported type) — get the words through at least.
      if (mediaUrls?.length) {
        console.warn("[Telnyx] MMS rejected, retrying as plain SMS");
        return await sendTelnyxMessage(toPhoneNumber, messageText, []);
      }

      // Anything else (rate limit, transient 5xx) — one quick retry before giving up. A
      // silently undelivered text looks identical to the shadchan going quiet.
      if (attempt === 0) {
        await new Promise(r => setTimeout(r, 800));
        return await sendTelnyxMessage(toPhoneNumber, messageText, mediaUrls, 1);
      }
      return { ok: false, blocked: false, code };
    }

    return { ok: true, id: data?.data?.id };
  } catch (error) {
    console.error("[Telnyx Request Failed]", error);
    if (attempt === 0) {
      await new Promise(r => setTimeout(r, 800));
      return await sendTelnyxMessage(toPhoneNumber, messageText, mediaUrls, 1);
    }
    return { ok: false, blocked: false };
  }
}

// Pull inbound media into our own bucket immediately — Telnyx URLs don't last.
async function persistInboundMedia(sessionData, incomingMedia) {
  if (!incomingMedia?.length) return [];
  const bucket = getStorage().bucket();
  const stored = [];

  for (const item of incomingMedia.slice(0, 10)) {
    try {
      const res = await fetch(item.url);
      if (!res.ok) { console.warn("media fetch failed", res.status); continue; }

      const buffer = Buffer.from(await res.arrayBuffer());
      const contentType = item.content_type || res.headers.get("content-type") || "application/octet-stream";
      const ext = (contentType.split("/")[1] || "bin").split(";")[0];
      const key = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
      const path = `shadchanMedia/${sessionData.eventId}/${sessionData.userId}/${key}.${ext}`;

      const token = crypto.randomUUID();
      const file = bucket.file(path);
      await file.save(buffer, {
        contentType,
        resumable: false,
        metadata: {
          cacheControl: "public, max-age=31536000",
          metadata: { firebaseStorageDownloadTokens: token }   // nested = custom metadata
        }
      });

      const url = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;

      stored.push({
        key,
        url,
        token,
        storagePath: path,
        contentType,
        bytes: buffer.length,
        label: MMS_IMAGE_TYPES.includes(contentType) ? "photo" : "document",
        ownerId: sessionData.userId,
        receivedAt: new Date().toISOString()
      });
      console.log(`[Shadchan] Stored media key=${key} contentType=${contentType} label=${stored[stored.length - 1].label} bytes=${buffer.length}`);
    } catch (err) {
      console.error("persistInboundMedia failed:", err);
    }
  }

  console.log(`[Shadchan] persistInboundMedia: ${stored.length}/${incomingMedia.length} item(s) stored for user ${sessionData.userId}`);

  if (stored.length) {
    await db.collection("users").doc(sessionData.userId).set(
      { shadchanMedia: admin.firestore.FieldValue.arrayUnion(...stored) },
      { merge: true }
    );
  }
  return stored;
}

// You can only ever forward files the sender gave you themselves.
async function resolveOwnMedia(userId, mediaKeys) {
  const snap = await db.collection("users").doc(userId).get();
  const all = snap.data()?.shadchanMedia || [];
  if (!mediaKeys?.length) return all;
  return all.filter(m => mediaKeys.includes(m.key));
}

// The media sent since our last reply — used to forward files reliably even when the model's
// mediaKeys don't cleanly match, since a person doesn't need to reference their resume by an
// exact ID for a real matchmaker to know which file they mean.
function collectBurstMedia(messages = []) {
  let lastAiPos = -1;
  messages.forEach((m, i) => { if (m.sender === "ai") lastAiPos = i; });
  const collected = [];
  for (let i = lastAiPos + 1; i < messages.length; i++) {
    const m = messages[i];
    if (m.sender === "user" && m.media?.length) collected.push(...m.media);
  }
  return collected;
}

// Shortens a link via TinyURL's free API before it goes out in a text. Falls back to the
// original URL on any failure — a long link beats no link.
async function shortenUrl(longUrl) {
  try {
    const res = await fetch(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(longUrl)}`);
    if (!res.ok) return longUrl;
    const short = (await res.text()).trim();
    return short.startsWith("http") ? short : longUrl;
  } catch (err) {
    console.error("[Shadchan] URL shortening failed:", err);
    return longUrl;
  }
}

// Images go as MMS; PDFs and anything oversized go as a bare link in the body.
async function sendWithAttachments(toPhone, text, mediaItems = []) {
  const asMms = [];
  const asLink = [];

  for (const m of mediaItems) {
    const isImage = MMS_IMAGE_TYPES.includes((m.contentType || "").toLowerCase());
    if (isImage && m.bytes <= MMS_SAFE_BYTES) asMms.push(m.url);
    else asLink.push(await shortenUrl(m.url));
  }
  console.log(`[Shadchan] sendWithAttachments to ${toPhone}: ${asMms.length} as MMS, ${asLink.length} as link`, mediaItems.map(m => ({ key: m.key, contentType: m.contentType, bytes: m.bytes })));

  const body = asLink.length ? `${text}\n\n${asLink.join("\n")}` : text;
  return await sendTelnyxMessage(toPhone, body, asMms);
}

async function appendInbound(ref, message) {
  await ref.set(
    { messages: admin.firestore.FieldValue.arrayUnion(message) },
    { merge: true }
  );
}

// Wait a beat for a follow-up text, then only the newest inbound generates a reply.
async function claimTurn(ref, messageId) {
  await new Promise(r => setTimeout(r, COALESCE_MS));

  return db.runTransaction(async (t) => {
    const snap = await t.get(ref);
    if (!snap.exists) return null;
    const d = snap.data();

    const lastInbound = [...(d.messages || [])].reverse().find(m => m.sender === "user");
    if (lastInbound?.messageId && lastInbound.messageId !== messageId) return null; // superseded

    const lockUntil = d.processingUntil ? new Date(d.processingUntil).getTime() : 0;
    if (Date.now() < lockUntil) return null; // another instance is mid-turn

    t.update(ref, { processingUntil: new Date(Date.now() + TURN_LOCK_MS).toISOString() });
    return d;
  });
}

// Append-only commit — never overwrites a concurrent writer's messages.
async function commitTurn(ref, patch, newMessages = []) {
  const body = { ...patch, processingUntil: null };
  if (newMessages.length) body.messages = admin.firestore.FieldValue.arrayUnion(...newMessages);
  await ref.set(body, { merge: true });
}

// Cross-session write: never touch their turn lock, they may be mid-generation.
async function commitCrossSession(ref, patch, newMessages = []) {
  const body = { ...patch };
  if (newMessages.length) body.messages = admin.firestore.FieldValue.arrayUnion(...newMessages);
  await ref.set(body, { merge: true });
}

async function recordPass(eventId, passingUserId, otherUserId) {
  const [u1, u2] = [passingUserId, otherUserId].sort();
  const myField = passingUserId === u1 ? "user1State" : "user2State";
  await db.collection("activeMatches").doc(`${u1}_${u2}`).set({
    eventId, user1Id: u1, user2Id: u2,
    conversationalMatch: true,
    [myField]: "passed",
    status: "declined"
  }, { merge: true });
}

function formatForTelnyx(phoneString) {
  if (!phoneString) return "";
  
  // Strip everything but numbers
  let cleaned = phoneString.toString().replace(/\D/g, '');
  
  // Format for US numbers
  if (cleaned.length === 10) {
    return `+1${cleaned}`;
  }
  if (cleaned.length === 11 && cleaned.startsWith('1')) {
    return `+${cleaned}`;
  }
  
  return `+${cleaned}`; // Fallback assuming country code is included
}

// function formatForWhatsApp(phoneString) {
//   if (!phoneString) return "";

//   let cleaned = phoneString.toString().replace(/\D/g, '');

//   if (cleaned.length === 10) {
//     return `1${cleaned}`;
//   }

//   return cleaned;
// }