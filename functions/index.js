/* eslint-env node */
const { onRequest } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { GoogleGenAI, Type } = require("@google/genai");
const { defineSecret } = require('firebase-functions/params');
const admin = require("firebase-admin");
const { getStorage } = require("firebase-admin/storage");
const crypto = require("crypto");

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
  admin.initializeApp();
}

const db = admin.firestore();
const GEMINI_MODEL = "gemini-3.1-flash-lite";
const MAX_HISTORY = 24;
const SHADCHAN_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    replyText:             { type: Type.STRING },
    action:                { type: Type.STRING, enum: ["continue", "ask_partner", "answer_partner", "forward_media"] },
    nextIndex:             { type: Type.INTEGER },
    matchConfirmed:        { type: Type.BOOLEAN },
    confirmedCandidateId:  { type: Type.STRING },
    closeSession:          { type: Type.BOOLEAN },
    crossSessionMessage:   { type: Type.STRING },
    mediaKeys:             { type: Type.ARRAY, items: { type: Type.STRING } }
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

    const firstName = (sessionData.userName || "").split(" ")[0];
    const stamp = () => new Date().toISOString();
    const msg = (sender, text) => ({ sender, text, timestamp: stamp() });
    const curIdx = sessionData.currentPipelineIndex || 0;

    // Reuse the media we already loaded; drop keys the model invented.
    let attachments = ai.mediaKeys.length ? ownMedia.filter(m => ai.mediaKeys.includes(m.key)) : [];
    if (ai.mediaKeys.length && !attachments.length) {
      console.warn("Model asked to forward keys that don't exist:", ai.mediaKeys);
      ai.mediaKeys = [];
      if (ai.action === "forward_media") ai.action = "continue";
    }

    // Applies on every path, not just "continue".
    const basePatch = {
      currentPipelineIndex: ai.nextIndex,
      status: ai.closeSession ? "completed" : "active"
    };

    if (ai.matchConfirmed && ai.confirmedCandidateId) {
      await recordConversationalMatch(sessionData.eventId, sessionData.userId, ai.confirmedCandidateId);
    }

    // Record every candidate skipped in this jump, not just the one right after curIdx.
    for (let i = curIdx; i < ai.nextIndex; i++) {
      const passedId = sessionData.candidatePipeline?.[i]?.candidateId;
      if (passedId) await recordPass(sessionData.eventId, sessionData.userId, passedId);
    }

    // If WE still owe someone an answer, don't let a new question jump the queue —
    // that's exactly how both threads end up paused waiting on each other.
    if (ai.action === "ask_partner" && sessionData.pendingInboundQuestion) {
      const owed = sessionData.pendingInboundQuestion;
      ai.action = "continue";
      ai.replyText = `Before that — what do you think about what ${owed.fromName} asked? ${owed.question}`;
    }

    if (ai.action === "ask_partner" && ai.crossSessionMessage) {
      const partnerId = sessionData.candidatePipeline?.[curIdx]?.candidateId;
      const partnerRef = partnerId
        ? db.collection("aiMatchmakerSessions").doc(`${sessionData.eventId}_${partnerId}`)
        : null;
      const partnerSnap = partnerRef ? await partnerRef.get() : null;
      const p = partnerSnap?.exists ? partnerSnap.data() : null;

      if (!p) {
        const fallback = "I can't get hold of them at the moment. Want to sit tight, or should I move on to the next one?";
        await commitTurn(ref, { ...basePatch, status: "active" },
          [msg("ai", ai.replyText), msg("ai", fallback)]);
        await markIfBlocked(ref, await sendTelnyxMessage(sessionData.userPhoneNumber, ai.replyText));
        await markIfBlocked(ref, await sendTelnyxMessage(sessionData.userPhoneNumber, fallback));

      } else {
        await commitTurn(ref, { ...basePatch, status: "paused_waiting_on_partner" },
          [msg("ai", ai.replyText)]);
        await markIfBlocked(ref, await sendTelnyxMessage(sessionData.userPhoneNumber, ai.replyText));

        const note = `Quick one from ${firstName} — ${ai.crossSessionMessage}`;
        await commitCrossSession(partnerRef, {
          status: "active",
          pendingInboundQuestion: {
            fromUserId: sessionData.userId,
            fromName: firstName,
            question: ai.crossSessionMessage,
            askedAt: stamp()
          }
        }, [msg("system", note)]);
        await markIfBlocked(partnerRef, await sendWithAttachments(p.userPhoneNumber, note, attachments));
      }

    } else if (ai.action === "answer_partner" || ai.action === "forward_media") {
      const targetId = sessionData.pendingInboundQuestion?.fromUserId
        || sessionData.candidatePipeline?.[curIdx]?.candidateId;

      let delivered = false;
      if (targetId) {
        const askerRef = db.collection("aiMatchmakerSessions").doc(`${sessionData.eventId}_${targetId}`);
        const askerSnap = await askerRef.get();
        if (askerSnap.exists) {
          const note = ai.crossSessionMessage
            ? `Heard back from ${firstName} — ${ai.crossSessionMessage}`
            : `${firstName} asked me to send this over.`;
          await commitCrossSession(askerRef, { status: "active" }, [msg("system", note)]);
          await markIfBlocked(askerRef, await sendWithAttachments(askerSnap.data().userPhoneNumber, note, attachments));
          delivered = true;
        }
      }
      if (!delivered) console.warn(`Undeliverable cross-session message; targetId=${targetId}`);

      await commitTurn(ref, {
        ...basePatch,
        pendingInboundQuestion: admin.firestore.FieldValue.delete()
      }, [msg("ai", ai.replyText)]);
      await markIfBlocked(ref, await sendTelnyxMessage(sessionData.userPhoneNumber, ai.replyText));

    } else {
      await commitTurn(ref, basePatch, [msg("ai", ai.replyText)]);
      await markIfBlocked(ref, await sendTelnyxMessage(sessionData.userPhoneNumber, ai.replyText));
    }
  } catch (err) {
    console.error("processClaimedTurn failed:", err);
    await ref.update({ processingUntil: null }).catch(() => {});
    await sendTelnyxMessage(sessionData.userPhoneNumber, "Sorry, give me a minute and text me again. Something's being slow on my end.").catch(() => {});
  }
}

exports.sweepStalledSessions = onSchedule({
  schedule: "every 6 hours",
  timeoutSeconds: 120,
  secrets: [telnyxApiKey, telnyxPhoneNumber]
}, async (event) => {
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
    replyText: reply || "Sorry, my phone glitched — can you send that again?",
    action: ["continue", "ask_partner", "answer_partner", "forward_media"].includes(p.action) ? p.action : "continue",
    nextIndex,
    matchConfirmed: p.matchConfirmed === true,
    confirmedCandidateId: p.confirmedCandidateId || sessionData.candidatePipeline?.[currentIdx]?.candidateId || "",
    // Only truly done when we've actually exhausted the pipeline.
    closeSession: p.closeSession === true && nextIndex >= len,
    crossSessionMessage: humanize(p.crossSessionMessage || ""),
    mediaKeys: Array.isArray(p.mediaKeys) ? p.mediaKeys : []
  };
}

async function generateAiResponseWithState(sessionData, ownMedia = []) {
  const currentIdx = Math.min(sessionData.currentPipelineIndex || 0, (sessionData.candidatePipeline || []).length);
  const pipeline = sessionData.candidatePipeline || [];
  const current = pipeline[currentIdx] || null;
  const firstName = (sessionData.userName || "").split(" ")[0] || "there";
  const ai = getAiClient();

  const pending = sessionData.pendingInboundQuestion || null;

  const systemInstruction = `
You are a shadchan at SY SmartMatch. You are texting ${firstName} from your own phone.

HOW YOU WRITE
- One or two sentences. Plain, warm, unhurried. Contractions. Lowercase is fine sometimes.
- Never use brackets, asterisks, bullets, headers, numbered lists, or emoji.
- Never narrate mechanics. Not "forwarding your question", not "processing", not "one moment while I".
- Never call yourself a system, a service, a bot, automated, a model, or an AI. Never apologize on behalf of a platform.
- Don't repeat their name in every message. Once at the start of a thread is plenty.
- Don't parrot back what they just said before answering.
- If they ask you something you don't know, say you'll find out and ask the other side. Never leave a question unanswered.
- If they ask something off-topic, answer it briefly like a person would, then steer back.

ABOUT ${firstName}
${JSON.stringify(sessionData.userProfile || {}, null, 2)}

WHO YOU'RE DISCUSSING RIGHT NOW
${current ? `${current.name} (id ${current.candidateId}). ${current.notes || ""}` : "You've been through everyone on the list."}
They are candidate ${currentIdx + 1} of ${pipeline.length}. Do not mention anyone further down the list until this one is settled.

${pending ? `WAITING ON ${firstName}
${pending.fromName} asked: "${pending.question}". You already passed this along. When ${firstName} answers, set action to "answer_partner" and put their answer, in their voice, in crossSessionMessage.` : ""}

FILES ${firstName} HAS SENT YOU (you may pass these along by key)
${ownMedia.length ? JSON.stringify(ownMedia.map(m => ({ key: m.key, type: m.contentType, label: m.label || "" }))) : "None yet."}

WHAT TO DO
- Normal reply: action "continue".
- They have a question for ${current ? current.name : "the other side"} you can't answer: action "ask_partner", put the question in crossSessionMessage. Tell ${firstName} you'll check, casually.
- They're answering a question the other side asked: action "answer_partner", answer in crossSessionMessage.
- They want you to send the other side a file they've already given you, or the other side asked for one and they said yes: action "forward_media" with the matching mediaKeys.
- If the other side wants a resume or photo ${firstName} hasn't sent you, just ask for it in plain language with action "continue".
- They're in: matchConfirmed true.
- They pass: nextIndex ${currentIdx + 1} and introduce the next person warmly in the same message.
- Only set closeSession true once nextIndex reaches ${pipeline.length}.
- If they send something explicit, offensive, or not appropriate to pass along, action "continue" and tell them kindly you'd rather not send that one on.
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
    const text = m.text || (m.media?.length ? "(sent an attachment)" : "");
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

  // Inline every not-yet-answered attachment — the whole current burst, not just this one
  // call's — so a photo or PDF sent a message earlier is something the model can actually see.
  // Capped so a burst of several large files can't blow past the request size limit and fail
  // the whole call — anything past the cap just stays a text placeholder instead.
  const MAX_INLINE_BYTES = 15 * 1024 * 1024;
  let inlinedBytes = 0;

  outer:
  for (const task of mediaTasks) {
    for (const m of task.mediaItems) {
      if (inlinedBytes >= MAX_INLINE_BYTES) break outer;
      try {
        const r = await fetch(m.url);
        const buf = Buffer.from(await r.arrayBuffer());
        if (inlinedBytes + buf.length > MAX_INLINE_BYTES) continue; // would push us over — skip, keep the placeholder
        inlinedBytes += buf.length;
        const mimeType = m.contentType === "application/pdf" ? "application/pdf" : (m.contentType || "image/jpeg");
        task.entry.parts.push({ inlineData: { data: buf.toString("base64"), mimeType } });
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
        label: contentType === "application/pdf" ? "document" : "photo",
        ownerId: sessionData.userId,
        receivedAt: new Date().toISOString()
      });
    } catch (err) {
      console.error("persistInboundMedia failed:", err);
    }
  }

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

// Images go as MMS; PDFs and anything oversized go as a bare link in the body.
async function sendWithAttachments(toPhone, text, mediaItems = []) {
  const asMms = [];
  const asLink = [];

  for (const m of mediaItems) {
    const isImage = MMS_IMAGE_TYPES.includes((m.contentType || "").toLowerCase());
    if (isImage && m.bytes <= MMS_SAFE_BYTES) asMms.push(m.url);
    else asLink.push(m.url);
  }

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