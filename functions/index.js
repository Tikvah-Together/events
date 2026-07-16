/* eslint-env node */
const { onRequest } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { GoogleGenAI } = require("@google/genai");
const { defineSecret } = require('firebase-functions/params');
const admin = require("firebase-admin");

// Define Cloud Secrets (Evaluated safely at runtime)
const geminiApiKey = defineSecret('GEMINI_API_KEY');
const whatsappPhoneId = defineSecret('WHATSAPP_PHONE_NUMBER_ID');
const whatsappAccessToken = defineSecret('WHATSAPP_ACCESS_TOKEN');
const whatsappVerifyToken = defineSecret('WHATSAPP_VERIFY_TOKEN');

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
  secrets: [geminiApiKey, whatsappPhoneId, whatsappAccessToken]
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
  secrets: [geminiApiKey, whatsappPhoneId, whatsappAccessToken]
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
          userPhoneNumber: formatForWhatsApp(user.phone),
          userProfile: userProfile, 
          candidatePipeline: pipeline,
          currentPipelineIndex: 0,
          messages: [],
          status: "active",
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        };

        const currentCandidate = sessionData.candidatePipeline[0];
        
        // Hardcode the template text for the AI's chat history context
        const openingMessageText = `Hi!\n\nFollowing SY SmartMatch, you have a mutual match with ${currentCandidate.name}.\n\nAre you interested in setting up a first date?`;

        sessionData.messages.push({
          sender: "ai",
          text: openingMessageText,
          timestamp: new Date().toISOString()
        });

        await sessionRef.set(sessionData);
        await sendWhatsAppTemplate(sessionData.userPhoneNumber, "intro", currentCandidate.name);

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
 * OFFICIAL WHATSAPP CLOUD API WEBHOOK ENDPOINT
 */
exports.handleIncomingWhatsApp = onRequest(
  { secrets: [geminiApiKey, whatsappPhoneId, whatsappAccessToken, whatsappVerifyToken] },
  async (req, res) => {
    // 1. Webhook Verification
    const VERIFY_TOKEN = whatsappVerifyToken.value();
    if (req.method === "GET") {
      const mode = req.query["hub.mode"];
      const token = req.query["hub.verify_token"];
      const challenge = req.query["hub.challenge"];

      if (mode === "subscribe" && token === VERIFY_TOKEN) {
        res.status(200).send(challenge);
        return;
      } else {
        res.sendStatus(403);
        return;
      }
    }

    // 2. Handle Incoming Messages (POST)
    if (req.body.object === "whatsapp_business_account") {
      const entry = req.body.entry?.[0];
      const changes = entry?.changes?.[0];
      const value = changes?.value;
      const messages = value?.messages;

      if (!messages || !messages[0]) {
        res.sendStatus(200);
        return;
      }

      const message = messages[0];
      const fromPhoneNumber = message.from; 
      const incomingText = message.text?.body;

      if (!incomingText) {
        res.sendStatus(200);
        return;
      }      

      try {
        // UPDATE: Look for active OR paused sessions
        const sessionSnapshot = await db.collection("aiMatchmakerSessions")
          .where("userPhoneNumber", "==", fromPhoneNumber)
          .where("status", "in", ["active", "paused_waiting_on_partner"])
          .limit(1)
          .get();

        if (sessionSnapshot.empty) {
          await sendWhatsAppMessage(fromPhoneNumber, "No active matchmaking session found.");
          res.sendStatus(200);
          return;
        }

        const sessionDoc = sessionSnapshot.docs[0];
        const sessionData = sessionDoc.data();

        // 1. Log incoming user message
        sessionData.messages.push({
          sender: "user",
          text: incomingText,
          timestamp: new Date().toISOString()
        });

        // 2. Get AI Decision
        const aiPayload = await generateAiResponseWithState(sessionData);

        // 3. Log AI response
        sessionData.messages.push({
          sender: "ai",
          text: aiPayload.replyText,
          timestamp: new Date().toISOString()
        });

        // --- NEW STATE MACHINE ROUTING ---

        if (aiPayload.action === "ask_partner") {
          // Pause current user
          sessionData.status = "paused_waiting_on_partner";
          await sessionDoc.ref.set(sessionData);
          await sendWhatsAppMessage(sessionData.userPhoneNumber, aiPayload.replyText);

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
              timestamp: new Date().toISOString()
            });
            await partnerSessionRef.set(pData);
            await sendWhatsAppMessage(pData.userPhoneNumber, questionText);
          } else {// Failsafe if the partner is no longer active
            sessionData.status = "active";
            const errorMsg = "I'm sorry, but it seems their matchmaking session is no longer active so I can't ask them right now. Would you like to make a decision based on their profile, or should we move on?";
            
            sessionData.messages.push({ sender: "ai", text: errorMsg, timestamp: new Date().toISOString() });
            await sessionDoc.ref.set(sessionData);
            await sendWhatsAppMessage(sessionData.userPhoneNumber, errorMsg);
          }
        } 
        else if (aiPayload.action === "answer_partner") {
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
              timestamp: new Date().toISOString()
            });
            await askerSessionRef.set(aData);
            await sendWhatsAppMessage(aData.userPhoneNumber, answerText);
          }

          // Continue current user's session normally
          await sessionDoc.ref.set(sessionData);
          await sendWhatsAppMessage(sessionData.userPhoneNumber, aiPayload.replyText);
        } 
        else {
          // Normal continuation
          sessionData.currentPipelineIndex = aiPayload.nextIndex;
          if (aiPayload.closeSession) sessionData.status = "completed";

          await sessionDoc.ref.set(sessionData);
          await sendWhatsAppMessage(sessionData.userPhoneNumber, aiPayload.replyText);

          if (aiPayload.matchConfirmed && aiPayload.confirmedCandidateId) {
            await recordConversationalMatch(sessionData.eventId, sessionData.userId, aiPayload.confirmedCandidateId);
          }
        }

        res.sendStatus(200);
      } catch (err) {
        console.error("Error processing incoming WhatsApp message:", err);
        res.sendStatus(400);
      }
    } else {
      res.sendStatus(404);
    }
  }
);

/**
 * OFFICIAL WHATSAPP API: Send Template Message
 */
async function sendWhatsAppTemplate(toPhoneNumber, templateName, candidateName) {
  const phoneId = whatsappPhoneId.value();
  const accessToken = whatsappAccessToken.value();
  
  console.log(`[WhatsApp API] Sending template '${templateName}' to ${toPhoneNumber}...`);

  const url = `https://graph.facebook.com/v23.0/${phoneId}/messages`;
  
  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: toPhoneNumber,
    type: "template",
    template: {
      name: templateName,
      language: {
        code: "en_US" // Update this if you created the template in a different language!
      },
      components: [
        {
          type: "body",
          parameters: [
            {
              type: "text",
              text: candidateName
            }
          ]
        }
      ]
    }
  };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    
    if (!response.ok) {
      console.error(`[WhatsApp API Error]`, data);
    } else {
      console.log(`[WhatsApp API] Successfully sent template. Message ID: ${data.messages[0].id}`);
    }
  } catch (error) {
    console.error(`[WhatsApp API Request Failed]:`, error);
  }
}

async function generateAiInitialMessage(sessionData) {// kept in case we need to switch from Whatsapp tp SMS or other channels in the future
  const currentCandidate = sessionData.candidatePipeline[sessionData.currentPipelineIndex];
  const ai = getAiClient();

  const systemPrompt = `
    You are a warm, traditional, yet modern AI matchmaker (Shadchan) messaging your client, ${sessionData.userName}, on WhatsApp on behalf of SY SmartMatch.
    
    CLIENT PROFILE CONTEXT:
    ${JSON.stringify(sessionData.userProfile, null, 2)}
    
    Current candidate you are introducing to them: ${currentCandidate.name}.
    Candidate details: ${currentCandidate.notes || "No extra biography info provided."}
    
    TASK: Write a highly personal, inviting, short WhatsApp message introduction. 
    Act like an insightful, empathetic human who genuinely wants to see them happy. Use their profile context naturally if it helps make a connection.
    End the text by asking if they would be open to exploring things with ${currentCandidate.name}.
  `;

  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: systemPrompt,
    config: { maxOutputTokens: 400 }
  });
  return response.text.trim();
}

async function generateAiResponseWithState(sessionData) {
  const currentIdx = sessionData.currentPipelineIndex;
  const pipeline = sessionData.candidatePipeline;
  const currentCandidate = pipeline[currentIdx];
  const ai = getAiClient();

const systemInstruction = `
    You are an expert, empathetic personal matchmaker (Shadchan) messaging ${sessionData.userName} on WhatsApp on behalf of SY SmartMatch.
    
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
    
    If the user is REPLYING to a question asked by another candidate (you will see the system alert in the chat history), deliver the answer back to them.
    - Set 'action' to "answer_partner".
    - Set 'crossSessionPartnerId' to the ID of the person who asked (found in the system alert).
    - Set 'crossSessionMessage' to the user's natural answer.
    
    Otherwise, continue normally evaluating the current candidate:
    - Set 'action' to "continue".
    - If they say yes, validate warmly and set 'matchConfirmed' to true.
    - If they reject or show indifference, increment 'nextIndex'.
    - If out of options, set 'closeSession' to true.
    
    Return strictly JSON matching this schema:
    {
      "replyText": "Your natural text response back to the user AS the Shadchan.",
      "action": "continue", 
      "nextIndex": ${currentIdx},
      "matchConfirmed": false,
      "confirmedCandidateId": "${currentCandidate ? currentCandidate.candidateId : ""}",
      "closeSession": false,
      "crossSessionPartnerId": "",
      "crossSessionMessage": ""
    }
  `;

const formattedChatLog = sessionData.messages.map(m => ({
    // Treat 'system' alerts as user inputs so the AI replies to them
    role: (m.sender === "user" || m.sender === "system") ? "user" : "model", 
    parts: [{ text: m.text }]
  }));

const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: formattedChatLog,
    config: {
      systemInstruction: systemInstruction,
      responseMimeType: "application/json",
      maxOutputTokens: 1000
    }
  });

  // Remove markdown formatting if Gemini includes it
  const rawText = response.text.replace(/```json/gi, '').replace(/```/g, '').trim();
  return JSON.parse(rawText);
}

/**
 * OFFICIAL WHATSAPP API: Send Message
 */
async function sendWhatsAppMessage(toPhoneNumber, messageText) {
  const phoneId = whatsappPhoneId.value();
  const accessToken = whatsappAccessToken.value();
  
  console.log(`[WhatsApp API] Sending message to ${toPhoneNumber}...`);

  const url = `https://graph.facebook.com/v23.0/${phoneId}/messages`;
  
  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: toPhoneNumber,
    type: "text",
    text: {
      body: messageText
    }
  };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    
    if (!response.ok) {
      console.error(`[WhatsApp API Error]`, data);
    } else {
      console.log(`[WhatsApp API] Successfully sent. Message ID: ${data.messages[0].id}`);
    }
  } catch (error) {
    console.error(`[WhatsApp API Request Failed]:`, error);
  }
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

function formatForWhatsApp(phoneString) {
  if (!phoneString) return "";

  let cleaned = phoneString.toString().replace(/\D/g, '');

  if (cleaned.length === 10) {
    return `1${cleaned}`;
  }

  return cleaned;
}