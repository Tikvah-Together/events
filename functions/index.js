/* eslint-env node */
/**
 * Import function triggers from their respective submodules:
 *
 * const {onCall} = require("firebase-functions/v2/https");
 * const {onDocumentWritten} = require("firebase-functions/v2/firestore");
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

// const {setGlobalOptions} = require("firebase-functions");
// const {onRequest} = require("firebase-functions/https");
// const logger = require("firebase-functions/logger");

// For cost control, you can set the maximum number of containers that can be
// running at the same time. This helps mitigate the impact of unexpected
// traffic spikes by instead downgrading performance. This limit is a
// per-function limit. You can override the limit for each function using the
// `maxInstances` option in the function's options, e.g.
// `onRequest({ maxInstances: 5 }, (req, res) => { ... })`.
// NOTE: setGlobalOptions does not apply to functions using the v1 API. V1
// functions should each use functions.runWith({ maxInstances: 10 }) instead.
// In the v1 API, each function can only serve one request per container, so
// this will be the maximum concurrent request count.
// setGlobalOptions({ maxInstances: 10 });

// Create and deploy your first functions
// https://firebase.google.com/docs/functions/get-started

// exports.helloWorld = onRequest((request, response) => {
//   logger.info("Hello logs!", {structuredData: true});
//   response.send("Hello from Firebase!");
// });

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

// Initialize Firebase Admin if it hasn't been initialized yet
if (admin.apps.length === 0) {
  admin.initializeApp();
}

exports.generateMatches = onCall(async (request) => {
  // 1. Guard check for the eventId
  const eventId = request.data.eventId;
  if (!eventId) {
    throw new HttpsError("invalid-argument", "The function must be called with a valid 'eventId'.");
  }

  const db = admin.firestore();

  try {
    // 2. Fetch all user documents to extract their feedback arrays
    const usersSnapshot = await db.collection("users").get();
    const participants = {};

    // Filter and build a map of users who actually gave feedback for this event
    usersSnapshot.forEach((doc) => {
      const userData = doc.data();
      const feedbackArray = userData.feedbackData || [];

      // Check if this specific event exists in their array
      const hasEventFeedback = feedbackArray.some(f => f.event === eventId);

      if (hasEventFeedback) {
        participants[doc.id] = {
          id: doc.id,
          name: userData.firstName + " " + userData.lastName || "No name found",
          phoneNumber: userData.phoneNumber || "",
          feedback: feedbackArray
        };
      }
    });

    const uniqueMatches = {};

    // 3. Find Mutual Matches
    Object.keys(participants).forEach((userAId) => {
      const userA = participants[userAId];

      userA.feedback.forEach((feedbackA) => {
        // Look for entries matching this event where User A selected "yes"
        if (feedbackA.event === eventId && feedbackA.interested === "yes") {
          const userBId = feedbackA.partnerId;

          // Check if User B exists and also left feedback
          if (participants[userBId]) {
            const userB = participants[userBId];

            // Look for User B saying "yes" back to User A for this same event
            const mutualFeedback = userB.feedback.find(
              (feedbackB) => feedbackB.event === eventId && feedbackB.partnerId === userAId && feedbackB.interested === "yes"
            );

            if (mutualFeedback) {
              // Create an alphabetical composite key (e.g. "User123_User999") to avoid duplicate processing
              const matchId = userAId < userBId ? `${userAId}_${userBId}` : `${userBId}_${userAId}`;

              const isUser1A = userAId < userBId;
              const user1 = isUser1A ? userA : userB;
              const user2 = isUser1A ? userB : userA;
              const user1Feedback = isUser1A ? feedbackA : mutualFeedback;
              const user2Feedback = isUser1A ? mutualFeedback : feedbackA;

              // Save the structural data, mapping priority statuses
              uniqueMatches[matchId] = {
                eventId: eventId,
                user1Id: user1.id,
                user2Id: user2.id,
                user1Name: user1.name,
                user2Name: user2.name,
                user1Priority: user1Feedback.isPriority || false,
                user2Priority: user2Feedback.isPriority || false,
              };
            }
          }
        }
      });
    });

    // 4. Save the matches into the activeMatches collection using a Batch write
    const batch = db.batch();
    let matchCount = 0;

    for (const matchId in uniqueMatches) {
      const matchData = uniqueMatches[matchId];
      const matchRef = db.collection("activeMatches").doc(matchId);

      // Only write if the match doesn't already exist from a previous calculation
      const matchDoc = await matchRef.get();
      if (!matchDoc.exists) {
        batch.set(matchRef, {
          ...matchData,
          status: "awaiting_initial_reply", // Starts at step 1 of your workflow
          user1State: "pending",
          user2State: "pending",
          lastContactedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        matchCount++;
      }
    }

    if (matchCount > 0) {
      await batch.commit();
    }

    return { success: true, matchesGenerated: matchCount };

  } catch (error) {
    console.error("Error generating matches: ", error);
    throw new HttpsError("internal", "Failed to calculate mutual matches.");
  }
});
