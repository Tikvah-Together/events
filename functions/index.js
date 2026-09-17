/* eslint-env node */
const { onRequest } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { GoogleGenAI } = require("@google/genai");
const { defineSecret } = require('firebase-functions/params');
const admin = require("firebase-admin");

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
        const openingMessageText = `Hi ${user.firstName}!\n\nIt's SY SmartMatch, you have a mutual match with ${currentCandidate.name}.\n\nWould you be interested in setting up a first date?`;

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

/**
 * OFFICIAL TELNYX API WEBHOOK ENDPOINT
 */
exports.handleIncomingTelnyx = onRequest(
  { secrets: [geminiApiKey, telnyxApiKey, telnyxPhoneNumber] },
  async (req, res) => {
    // Telnyx sends POST requests containing event data
    if (req.method !== "POST") {
      res.sendStatus(405);
      return;
    }

    const event = req.body?.data;
    
    // We only care about incoming messages
    if (event?.event_type !== "message.received") {
      res.sendStatus(200);
      return;
    }

    const payload = event.payload;
    if (!payload) {
      res.sendStatus(200);
      return;
    }

    const fromPhoneNumber = payload.from.phone_number;
    const incomingText = payload.text || "";
    const incomingMedia = payload.media || [];
    const inboundMediaUrls = incomingMedia.map(m => m.url); // Extract file URLs

    if (!incomingText && inboundMediaUrls.length === 0) {
      res.sendStatus(200);
      return;
    }     

    try {
      // Look for active OR paused sessions
      const sessionSnapshot = await db.collection("aiMatchmakerSessions")
        .where("userPhoneNumber", "==", fromPhoneNumber)
        .where("status", "in", ["active", "paused_waiting_on_partner"])
        .limit(1)
        .get();

      if (sessionSnapshot.empty) {
        await sendTelnyxMessage(fromPhoneNumber, "No active matchmaking session found.");
        res.sendStatus(200);
        return;
      }

      const sessionDoc = sessionSnapshot.docs[0];
      const sessionData = sessionDoc.data();

      // 1. Log incoming user message
      sessionData.messages.push({
        sender: "user",
        text: incomingText,
        mediaUrls: inboundMediaUrls,
        timestamp: new Date().toISOString()
      });

      // 2. Get AI Decision
      const aiPayload = await generateAiResponseWithState(sessionData, inboundMediaUrls);

      // 3. Log AI response
      sessionData.messages.push({
        sender: "ai",
        text: aiPayload.replyText,
        timestamp: new Date().toISOString()
      });

      // --- STATE MACHINE ROUTING ---

      if (aiPayload.action === "ask_partner") {
        // Pause current user
        sessionData.status = "paused_waiting_on_partner";
        await sessionDoc.ref.set(sessionData);
        await sendTelnyxMessage(sessionData.userPhoneNumber, aiPayload.replyText);

        // Inject question into partner's session
        const partnerSessionId = `${sessionData.eventId}_${aiPayload.crossSessionPartnerId}`;
        const partnerSessionRef = db.collection("aiMatchmakerSessions").doc(partnerSessionId);
        const partnerSessionDoc = await partnerSessionRef.get();

        if (partnerSessionDoc.exists) {
            const pData = partnerSessionDoc.data();
            const questionText = `[Shadchan Question from ${sessionData.userName}]: "${aiPayload.crossSessionMessage}". (ID: ${sessionData.userId}) - How should I respond?`;
            
            pData.messages.push({
              sender: "system",
              text: questionText,
              mediaUrls: inboundMediaUrls, // Save to partner's history
              timestamp: new Date().toISOString()
            });
            await partnerSessionRef.set(pData);
            
            // Pass the inbound media directly
            await sendTelnyxMessage(pData.userPhoneNumber, questionText, inboundMediaUrls);
        } else {
          sessionData.status = "active";
          const errorMsg = "I'm sorry, but it seems their matchmaking session is no longer active so I can't ask them right now. Would you like to make a decision based on their profile, or should we move on?";
          
          sessionData.messages.push({ sender: "ai", text: errorMsg, timestamp: new Date().toISOString() });
          await sessionDoc.ref.set(sessionData);
          await sendTelnyxMessage(sessionData.userPhoneNumber, errorMsg);
        }
      } else if (aiPayload.action === "answer_partner") {
        // Send answer back to original asker
        const askerSessionId = `${sessionData.eventId}_${aiPayload.crossSessionPartnerId}`;
        const askerSessionRef = db.collection("aiMatchmakerSessions").doc(askerSessionId);
        const askerSessionDoc = await askerSessionRef.get();

        if (askerSessionDoc.exists) {
            const aData = askerSessionDoc.data();
            const answerText = `[Shadchan Answer from ${sessionData.userName}]: "${aiPayload.crossSessionMessage}". Would you like to match with them?`;
            
            aData.status = "active"; // Unpause original asker
            aData.messages.push({
              sender: "system",
              text: answerText,
              mediaUrls: inboundMediaUrls, // Pull directly from the webhook event
              timestamp: new Date().toISOString()
            });
            await askerSessionRef.set(aData);
            
            // Pass the inbound media directly
            await sendTelnyxMessage(aData.userPhoneNumber, answerText, inboundMediaUrls);
        }

        // Continue current user's session normally
        await sessionDoc.ref.set(sessionData);
        await sendTelnyxMessage(sessionData.userPhoneNumber, aiPayload.replyText);
      } else {
        // Normal continuation
        sessionData.currentPipelineIndex = aiPayload.nextIndex;
        if (aiPayload.closeSession) sessionData.status = "completed";

        await sessionDoc.ref.set(sessionData);
        await sendTelnyxMessage(sessionData.userPhoneNumber, aiPayload.replyText);

        if (aiPayload.matchConfirmed && aiPayload.confirmedCandidateId) {
          await recordConversationalMatch(sessionData.eventId, sessionData.userId, aiPayload.confirmedCandidateId);
        }
      }

      res.sendStatus(200);
    } catch (err) {
      console.error("Error processing incoming Telnyx message:", err);
      res.sendStatus(500);
    }
  }
);

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

  const batch = db.batch();
  const unpausePromises = [];

  snapshot.forEach((doc) => {
    const sessionData = doc.data();
    const messages = sessionData.messages || [];
    
    if (messages.length === 0) return;

    // Grab the timestamp of the last message sent
    const lastMessage = messages[messages.length - 1];
    const lastMessageTime = new Date(lastMessage.timestamp).getTime();

    if (nowMs - lastMessageTime >= waitThresholdMs) {
      console.log(`Unpausing session ${doc.id} due to partner timeout.`);

      sessionData.status = "active";
      const timeoutText = "It looks like they haven't responded to your question yet. We can continue to wait, or if you'd prefer, we can move on to your next candidate. What would you like to do?";
      
      sessionData.messages.push({
        sender: "system",
        text: timeoutText,
        timestamp: new Date().toISOString()
      });

      batch.set(doc.ref, sessionData);

      unpausePromises.push(sendTelnyxMessage(sessionData.userPhoneNumber, timeoutText)); 
    }
  });

  if (unpausePromises.length > 0) {
    await batch.commit();
    await Promise.allSettled(unpausePromises);
    console.log(`Swept and unpaused ${unpausePromises.length} stalled session(s).`);
  }
});

async function generateAiResponseWithState(sessionData, currentInboundMediaUrls = []) {
  const currentIdx = sessionData.currentPipelineIndex;
  const pipeline = sessionData.candidatePipeline;
  const currentCandidate = pipeline[currentIdx];
  const ai = getAiClient();

  const systemInstruction = `
    You are an expert, empathetic personal matchmaker (Shadchan) messaging ${sessionData.userName} on behalf of SY SmartMatch.
    
    CLIENT PROFILE CONTEXT:
    ${JSON.stringify(sessionData.userProfile, null, 2)}
    
    CRITICAL PIPELINE DATA:
    ${JSON.stringify(pipeline)}
    
    Current candidate under discussion: Index ${currentIdx} (${currentCandidate ? currentCandidate.name : "None left"}).
    
    GO-BETWEEN RULES:
    If the user has a specific question for the candidate before deciding (e.g., "Does he mind if I work late?"), you must PAUSE and ask the candidate. 
    - Set 'action' to "ask_partner".
    - Set 'crossSessionPartnerId' to the candidate's ID (${currentCandidate ? currentCandidate.candidateId : ""}).
    - Set 'crossSessionMessage' to the exact question you want to ask them.
    
    If the user is REPLYING to a question asked by another candidate, deliver the answer back to them.
    - Set 'action' to "answer_partner".
    - Set 'crossSessionPartnerId' to the ID of the person who asked (found in the system alert).
    - Set 'crossSessionMessage' to the user's natural answer.

    CONTENT MODERATION RULE (CRITICAL):
    If the user attaches an image/file that is inappropriate, explicit, offensive, or violates basic matchmaking decency, DO NOT set action to "ask_partner" or "answer_partner". Instead, set 'action' to "continue" and politely inform them that you cannot forward that type of image.
    
    Otherwise, continue normally evaluating the current candidate:
    - Set 'action' to "continue".
    - If they say yes, validate warmly and set 'matchConfirmed' to true.
    - If they reject or show indifference, increment 'nextIndex'.
    - If out of options, set 'closeSession' to true.
    
    Return strictly JSON matching this schema:
    {
      "replyText": "Your natural text response back to the user AS the Shadchan. Keep most replies to 1-2 sentences. Be warm and natural, but don't over-explain.",
      "action": "continue", 
      "nextIndex": ${currentIdx},
      "matchConfirmed": false,
      "confirmedCandidateId": "${currentCandidate ? currentCandidate.candidateId : ""}",
      "closeSession": false,
      "crossSessionPartnerId": "",
      "crossSessionMessage": ""
    }
  `;

  const formattedChatLog = sessionData.messages.map(m => {
    let text = m.text || "";
    if (m.mediaUrls && m.mediaUrls.length > 0) {
      text += `\n[User attached a file/photo. View the image data attached to this prompt.]`;
    }
    return {
      role: (m.sender === "user" || m.sender === "system") ? "user" : "model", 
      parts: [{ text: text }]
    };
  });

  // Give the AI "eyes" for the current turn by fetching the file in memory
  if (currentInboundMediaUrls && currentInboundMediaUrls.length > 0) {
    const lastIndex = formattedChatLog.length - 1;
    
    for (const url of currentInboundMediaUrls) {
      try {
        const response = await fetch(url);
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const mimeType = response.headers.get("content-type") || "image/jpeg";
        
        // Push actual file data so Gemini can see/hear it
        formattedChatLog[lastIndex].parts.push({
          inlineData: {
            data: buffer.toString("base64"),
            mimeType: mimeType
          }
        });
      } catch (err) {
        console.error("Failed to fetch media for AI:", err);
      }
    }
  }

  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: formattedChatLog,
    config: {
      systemInstruction: systemInstruction,
      responseMimeType: "application/json",
      maxOutputTokens: 1000
    }
  });

  const rawText = response.text.replace(/```json/gi, '').replace(/```/g, '').trim();
  return JSON.parse(rawText);
}

async function recordConversationalMatch(eventId, userAId, userBId) {
  const matchId = userAId < userBId ? `${userAId}_${userBId}` : `${userBId}_${userAId}`;
  await db.collection("activeMatches").doc(matchId).set({
    eventId: eventId,
    user1Id: userAId < userBId ? userAId : userBId,
    user2Id: userAId < userBId ? userBId : userAId,
    status: "awaiting_initial_reply",
    user1State: "pending",
    user2State: "pending",
    conversationalMatch: true,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
}

/**
 * OFFICIAL TELNYX API: Send SMS Message
 */
async function sendTelnyxMessage(toPhoneNumber, messageText, mediaUrls = []) {
  const apiKey = telnyxApiKey.value();
  const fromPhone = telnyxPhoneNumber.value();
  
  console.log(`[Telnyx API] Sending SMS to ${toPhoneNumber}...`);

  const url = `https://api.telnyx.com/v2/messages`;
  
  const payload = {
    from: fromPhone,
    to: toPhoneNumber,
    text: messageText
  };
  
  // Attach media if provided
  if (mediaUrls && mediaUrls.length > 0) {
    payload.media_urls = mediaUrls;
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    
    if (!response.ok) {
      console.error(`[Telnyx API Error]`, data);
    } else {
      console.log(`[Telnyx API] Successfully sent SMS. Message ID: ${data.data.id}`);
    }
  } catch (error) {
    console.error(`[Telnyx API Request Failed]:`, error);
  }
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