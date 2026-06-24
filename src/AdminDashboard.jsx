import { useState, useEffect, act, useMemo } from "react";
import { db } from "./firebase";
import {
  collection,
  addDoc,
  documentId,
  serverTimestamp,
  setDoc,
  getDoc,
  getDocs,
  doc,
  updateDoc,
  deleteDoc,
  query,
  orderBy,
  onSnapshot,
  where,
} from "firebase/firestore";
import {
  Plus,
  Trash2,
  Calendar,
  Play,
  Square,
  UserMinus,
  ChevronDown,
  Pause,
  Bell,
  AlertCircle,
  Mail,
  X,
} from "lucide-react";

export default function AdminDashboard() {
  const [events, setEvents] = useState([]);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [attendees, setAttendees] = useState([]);
  const [eventName, setEventName] = useState("");
  const [roundTime, setRoundTime] = useState(7);
  const [generalLocation, setGeneralLocation] = useState("");
  const [fullAddress, setFullAddress] = useState("");
  const [loading, setLoading] = useState(false);
  const [allRegistrations, setAllRegistrations] = useState([]); // All registrations for history/duplicate checks
  const [registrations, setRegistrations] = useState([]);
  const [activeTab, setActiveTab] = useState("events"); // "events" or "master"
  const [masterUsers, setMasterUsers] = useState([]); // The full singles database
  const [selectedUserIds, setSelectedUserIds] = useState([]); // For checkboxes
  const [targetEventId, setTargetEventId] = useState(""); // For "Add to Event" dropdown
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [sentEventDetails, setSentEventDetails] = useState([]);
  const [sentReminders, setSentReminders] = useState([]);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  const [emailData, setEmailData] = useState({
    recipients: [], // an array to hold multiple user IDs
    subject: "",
    body: "",
  });
  const INITIAL_FILTERS = {
    search: "",
    hashgafa: "all",
    minAgeMan: "",
    maxAgeMan: "",
    minAgeWoman: "",
    maxAgeWoman: "",
    gender: "all",
    ethnicity: "all",
    maritalStatus: "all",
    isKohen: "all",
    shomerShabbat: "all",
    shomerKashrut: "all",
    dressStyle: "all",
    startDate: "",
    endDate: "",
    status: "all",
  };
  const [filters, setFilters] = useState(INITIAL_FILTERS);

  const resetFilters = () => {
    setFilters(INITIAL_FILTERS);
    setIsAdvancedOpen(false); // Closes the advanced panel if it's open
    setSelectedUserIds([]); // Clears any bulk selections
  };

  const getHashgafaGroup = (user) => {
    const { gender, hairCovering, wantsCoveredHead, dressStyle } = user;

    // Group 1: Expected
    if (
      (gender === "woman" &&
        dressStyle === "skirtsOnly" &&
        hairCovering === "willCoverHair") ||
      (gender === "man" && wantsCoveredHead === "yes")
    ) {
      return {
        label: "Expected",
        color: "bg-purple-100 text-purple-700",
        border: "border-purple-200",
      };
    }

    // Group 2: No Hair-Covering Expected
    if (
      (gender === "woman" &&
        dressStyle === "skirtsPants" &&
        hairCovering === "notPlanning") ||
      (gender === "man" && wantsCoveredHead === "no")
    ) {
      return {
        label: "None",
        color: "bg-blue-100 text-blue-700",
        border: "border-blue-200",
      };
    }

    // Group 3: Flexible
    return {
      label: "Flexible",
      color: "bg-green-100 text-green-700",
      border: "border-green-200",
    };
  };

  const filteredMasterList = masterUsers.filter((a) => {
    const hashgafa = getHashgafaGroup(a);

    // 1. Hashgafa (Main)
    if (filters.hashgafa !== "all" && hashgafa.label !== filters.hashgafa)
      return false;

    // 2. Gender-specific Ages (Main)
    if (a.gender === "man") {
      if (filters.minAgeMan && a.age < parseInt(filters.minAgeMan))
        return false;
      if (filters.maxAgeMan && a.age > parseInt(filters.maxAgeMan))
        return false;
    } else if (a.gender === "woman") {
      if (filters.minAgeWoman && a.age < parseInt(filters.minAgeWoman))
        return false;
      if (filters.maxAgeWoman && a.age > parseInt(filters.maxAgeWoman))
        return false;
    }

    // 3. Advanced Filters
    if (filters.gender !== "all" && a.gender !== filters.gender) return false;
    if (filters.ethnicity !== "all" && a.ethnicity !== filters.ethnicity)
      return false;
    if (
      filters.maritalStatus !== "all" &&
      a.maritalStatus !== filters.maritalStatus
    )
      return false;
    if (filters.dressStyle !== "all" && a.dressStyle !== filters.dressStyle)
      return false;

    // Boolean logic for Shomer Shabbat/Kashrut/Kohen
    const checkBool = (filterVal, userVal) => {
      if (filterVal === "all") return true;
      const isTrue = userVal === "yes" || userVal === true;
      return filterVal === "yes" ? isTrue : !isTrue;
    };

    if (!checkBool(filters.isKohen, a.isKohen)) return false;
    if (!checkBool(filters.shomerShabbat, a.isShomerShabbat)) return false;
    if (!checkBool(filters.shomerKashrut, a.isShomerKashrut)) return false;

    return true;
  });

  const filteredAttendees = attendees.filter((a) => {
    const hashgafa = getHashgafaGroup(a);

    // 1. Hashgafa (Main)
    if (filters.hashgafa !== "all" && hashgafa.label !== filters.hashgafa)
      return false;

    // 2. Gender-specific Ages (Main)
    if (a.gender === "man") {
      if (filters.minAgeMan && a.age < parseInt(filters.minAgeMan))
        return false;
      if (filters.maxAgeMan && a.age > parseInt(filters.maxAgeMan))
        return false;
    } else if (a.gender === "woman") {
      if (filters.minAgeWoman && a.age < parseInt(filters.minAgeWoman))
        return false;
      if (filters.maxAgeWoman && a.age > parseInt(filters.maxAgeWoman))
        return false;
    }

    // 3. Advanced Filters
    if (filters.gender !== "all" && a.gender !== filters.gender) return false;
    if (
      filters.ethnicity !== "all" &&
      !(
        a.ethnicity &&
        a.ethnicity.toLowerCase().includes(filters.ethnicity.toLowerCase())
      )
    )
      return false;
    if (
      filters.maritalStatus !== "all" &&
      a.maritalStatus !== filters.maritalStatus
    )
      return false;
    if (filters.dressStyle !== "all" && a.dressStyle !== filters.dressStyle)
      return false;

    // Boolean logic for Shomer Shabbat/Kashrut/Kohen
    const checkBool = (filterVal, userVal) => {
      if (filterVal === "all") return true;
      const isTrue = userVal === "yes" || userVal === true;
      return filterVal === "yes" ? isTrue : !isTrue;
    };

    if (!checkBool(filters.isKohen, a.isKohen)) return false;
    if (!checkBool(filters.shomerShabbat, a.isShomerShabbat)) return false;
    if (!checkBool(filters.shomerKashrut, a.isShomerKashrut)) return false;

    return true;
  });

  const toggleStatus = async (id, currentStatus) => {
    try {
      const eventRef = doc(db, "events", id);
      const newStatus = !currentStatus;

      // 1. Update Firestore
      await updateDoc(eventRef, { active: newStatus });
      if (newStatus) {
        // If activating, launch the event
        launchEvent();
      } else {
        // If deactivating, set all attendees to not checked in
        //setAttendeesNotCheckedIn(id);
      }

      // 2. Update the Main Detail View immediately
      setSelectedEvent((prev) => ({ ...prev, active: newStatus }));

      // 3. Update the Sidebar List immediately so the green dot appears/disappears
      setEvents((prevEvents) =>
        prevEvents.map((ev) =>
          ev.id === id ? { ...ev, active: newStatus } : ev,
        ),
      );
    } catch (err) {
      console.error("Error updating status:", err);
    }
  };

  const setAttendeesNotCheckedIn = async (id) => {
    const attQuery = query(
      collection(db, "registrations"),
      where("eventId", "==", id),
    );
    const attSnap = await getDocs(attQuery);
    const resetPromises = attSnap.docs.map((doc) =>
      updateDoc(doc.ref, {
        checkedIn: false,
        eventLabel: null,
        tableNumber: null,
      }),
    );
    await Promise.all(resetPromises);
  };

  const togglePause = async (currentEvent) => {
    // 1. Safety Check: Ensure the event object and its ID exist
    if (!currentEvent || !currentEvent.id) {
      console.error("No event ID found. Cannot toggle pause.");
      return;
    }

    const eventRef = doc(db, "events", currentEvent.id);
    const now = new Date();

    try {
      if (currentEvent.isPaused) {
        // --- RESUMING ---
        // Check if we have a valid pausedAt timestamp
        const pauseStart =
          currentEvent.pausedAt?.toDate?.() || currentEvent.pausedAt;

        if (!pauseStart) {
          console.error("Resume failed: No pause timestamp found.");
          return;
        }

        const pauseDurationMs = now.getTime() - new Date(pauseStart).getTime();
        const oldStartTime =
          currentEvent.startTime?.toDate?.() || currentEvent.startTime;
        const newStartTime = new Date(
          new Date(oldStartTime).getTime() + pauseDurationMs,
        );

        await updateDoc(eventRef, {
          isPaused: false,
          startTime: newStartTime,
          pausedAt: null,
        });
      } else {
        // --- PAUSING ---
        await updateDoc(eventRef, {
          isPaused: true,
          pausedAt: now,
        });
      }
    } catch (err) {
      console.error("Error toggling pause state:", err);
    }
  };

  const launchEvent = async () => {
    const men = attendees.filter((a) => a.gender === "man" && a.checkedIn);
    const women = attendees.filter((a) => a.gender === "woman" && a.checkedIn);

    if (men.length === 0 || women.length === 0) {
      alert("You need checked-in men and women to start!");
      toggleStatus(selectedEvent.id, true); // Revert the event to inactive
      return;
    }

    // Launch with a Start Timestamp
    const eventRef = doc(db, "events", selectedEvent.id);
    await updateDoc(eventRef, {
      active: true,
      startTime: new Date(), // This is the "Big Bang" for the timer
      totalTables: women.length,
    });
  };

  const toggleCheckIn = async (attendeeId, currentStatus) => {
    try {
      const newStatus = !currentStatus;
      const regRef = doc(db, "registrations", attendeeId);

      // 1. Get FRESH Registration data
      const regSnap = await getDoc(regRef);
      if (!regSnap.exists()) return;
      const registration = regSnap.data();

      if (!newStatus) {
        await updateDoc(regRef, {
          checkedIn: false,
          eventLabel: null,
          tableNumber: null,
        });
        return;
      }

      // 2. Fetch User (Gender) and Event (Groups)
      const [userSnap, eventSnap] = await Promise.all([
        getDoc(doc(db, "users", registration.userId)),
        getDoc(doc(db, "events", registration.eventId)),
      ]);

      const userData = { ...userSnap.data(), id: userSnap.id };
      const eventData = { ...eventSnap.data(), id: eventSnap.id };
      const eventGroups = eventData.eventGroups || [];

      // The name of the group (e.g., "Group 1")
      const participantGroupName = String(registration.groupId || "");
      const gender = userData?.gender;
      const prefix = gender === "woman" ? "G" : "B";

      // 3. Find the index by matching the NAME
      const groupIdx = eventGroups.findIndex(
        (g) => String(g.name) === participantGroupName,
      );

      // If name isn't found in the current event groups, default to "U"
      const groupSuffix =
        groupIdx >= 0 ? String.fromCharCode(65 + groupIdx) : "U";

      // 4. Fetch all registrations for this event
      const attSnap = await getDocs(
        query(
          collection(db, "registrations"),
          where("eventId", "==", registration.eventId),
        ),
      );
      const allRegs = attSnap.docs.map((d) => d.data());

      // 5. Filter for people of SAME gender AND SAME group name
      const takenNumbers = allRegs
        .filter(
          (a) =>
            a.checkedIn &&
            String(a.groupId) === participantGroupName &&
            a.eventLabel?.startsWith(prefix),
        )
        .map((a) => {
          // SAFE TRANSITION: Check if it's already a clean number
          if (typeof a.tableNumber === "number") return a.tableNumber;

          // Fallback: If there are lingering old string formats (e.g., "Table 1 - Group 1")
          if (typeof a.tableNumber === "string") {
            const match = a.tableNumber.match(/Table\s+(\d+)/i);
            if (match) return parseInt(match[1], 10);
          }

          // Ultimate fallback using your original eventLabel parsing logic
          if (a.eventLabel) {
            const beforeHyphen = a.eventLabel.split("-")[0];
            const numOnly = beforeHyphen.substring(1);
            return parseInt(numOnly, 10);
          }

          return NaN;
        })
        .filter((num) => !isNaN(num))
        .sort((a, b) => a - b);

      // 6. Find lowest available number
      let assignedNumber = 1;
      for (let i = 0; i < takenNumbers.length; i++) {
        if (takenNumbers[i] === assignedNumber) assignedNumber++;
        else if (takenNumbers[i] > assignedNumber) break;
      }

      // 7. Update Database
      await updateDoc(regRef, {
        checkedIn: true,
        eventLabel: `${prefix}${assignedNumber}-${groupSuffix}`,
        tableNumber: assignedNumber,
      });

      sendAutomatedCheckInEmail(userData, eventData);
    } catch (err) {
      console.error("Check-in error:", err);
    }
  };

  // --- SEND EMAIL HANDLER ---
  const handleSendEmail = async () => {
    if (!emailData.subject.trim() || !emailData.body.trim()) {
      alert("Please provide both a subject and a message.");
      return;
    }

    setIsSendingEmail(true);

    try {
      // 1. Map the selected user IDs to their actual email addresses
      const recipientsEmails = emailData.recipients
        .map((id) => {
          const user = masterUsers.find((u) => u.id === id);
          return user?.email;
        })
        .filter(Boolean); // Removes any empty/null emails

      if (recipientsEmails.length === 0) {
        alert("No valid email addresses found for the selected attendees.");
        setIsSendingEmail(false);
        return;
      }

      // 2. Write to the "mail" collection
      await addDoc(collection(db, "mail"), {
        to: recipientsEmails, // Send to the mapped email array
        message: {
          subject: emailData.subject,
          text: emailData.body,
          html: emailData.body.replace(/\n/g, "<br>"),
        },
        eventId: selectedEvent?.id,
        timestamp: new Date(),
      });

      setShowEmailModal(false);
      setEmailData({ recipients: [], subject: "", body: "" }); // Reset to empty array
      setSelectedUserIds([]);
      alert(
        `Email successfully queued for ${recipientsEmails.length} recipient(s)!`,
      );
    } catch (error) {
      console.error("Error queueing email:", error);
      alert("Failed to queue email. Check console for details.");
    } finally {
      setIsSendingEmail(false);
    }
  };

  const sendAutomatedCheckInEmail = async (userData, eventData) => {
    const eventURL = `https://events.tikvahtogether.org/event?userId=${userData.id}&eventId=${eventData.id}`;

    try {
      await addDoc(collection(db, "email"), {
        to: userData.email,
        message: {
          subject: "SY SmartMatch: Event Login & Check-In Confirmation",
          html: `
      <div style="font-family: sans-serif; color: #1E3D34; max-width: 600px;">
        <p>Hi ${userData.firstName},</p>
        <p>Here is your SY SmartMatch event login link:</p>
        <p style="margin-top: 30px;">${eventURL}</p>
        <p style="font-weight: bold; color: #1E3D34;">SY SmartMatch Team</p>
      </div>
    `,
        },
      });
    } catch (err) {
      console.error("Error sending individual reminder:", err);
    }
  };

  const sendBulkReminders = async () => {
    if (!selectedEvent) return;

    const confirmMessage = `Are you sure you want to send a reminder email to all confirmed participants for "${selectedEvent.name}"?`;
    if (!window.confirm(confirmMessage)) return;

    try {
      const regQuery = query(
        collection(db, "registrations"),
        where("eventId", "==", selectedEvent.id),
        where("status", "==", "confirmed"),
      );
      const regSnap = await getDocs(regQuery);
      let numberOfSentReminders = 0; // Changed to let

      if (regSnap.empty) {
        alert("No confirmed participants found.");
        return;
      }

      const emailPromises = regSnap.docs.map(async (regDoc) => {
        const regData = regDoc.data();

        // Do not auto-send to people who already have it during BULK
        if (!sentEventDetails.includes(regData.userId)) {
          const userSnap = await getDoc(doc(db, "users", regData.userId));
          if (userSnap.exists()) {
            numberOfSentReminders++;
            return sendIndividualReminder(
              { ...userSnap.data(), userId: userSnap.id },
              selectedEvent,
            );
          }
        }
      });

      await Promise.all(emailPromises);

      if (numberOfSentReminders > 0) {
        alert(
          `Successfully queued reminders for ${numberOfSentReminders} participants!`,
        );
      } else {
        alert(
          "No new reminders were sent. Everyone has already received them.",
        );
      }
    } catch (err) {
      console.error("Bulk send error:", err);
    }
  };

  const sendIndividualReminder = async (userData, eventData) => {
    const cancelUrl = `https://events.tikvahtogether.org/rsvp?userId=${userData.userId}&eventId=${eventData.id}&action=cancel`;

    try {
      await addDoc(collection(db, "email"), {
        to: userData.email,
        message: {
          subject: "SY SmartMatch: Event Details & Reminder",
          html: `
      <div style="font-family: sans-serif; color: #1E3D34; max-width: 600px;">
        <p>Hi ${userData.firstName},</p>
        <p>Looking forward to seeing you at the SY SmartMatch event.</p>
        <div style="background: #DEE8DF; padding: 20px; border-radius: 12px; border: 1px solid #95B699; margin: 20px 0;">
          <p style="margin-top: 0;"><strong>Event details:</strong></p>
          <strong>Date:</strong> ${eventData.scheduledAt?.toDate().toLocaleDateString()}<br>
          <strong>Time:</strong> ${eventData.scheduledAt?.toDate().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}<br>
          <strong>Location:</strong> ${eventData.fullAddress || eventData.generalLocation}
        </div>
        <p>Upon arrival, please check in at the front desk or scan the QR code on site.</p>
        <p>You’ll receive your starting table number and be guided where to sit.</p>
        <p>Please bring your phone fully charged, as it will be used during the event.</p>
        <p>To ensure the best experience, please arrive on time, as late arrival may result in missing some of your curated dates.</p>
        
        <p style="margin-top: 30px;">If anything changes: <a href="${cancelUrl}" style="color: #95B699; font-weight: bold;">Cancel Registration</a></p>
        
        <p style="font-weight: bold; color: #1E3D34;">SY SmartMatch Team</p>
      </div>
    `,
        },
      });
      setSentEventDetails((prev) => [...prev, userData.userId]);
      return true;
    } catch (err) {
      console.error("Error sending individual reminder:", err);
      return false;
    }
  };

  const sendFinalReminder = async (userData, eventData) => {
    const confirmationURL = `https://events.tikvahtogether.org/rsvp?userId=${userData.userId}&eventId=${eventData.id}`;
    try {
      await addDoc(collection(db, "email"), {
        to: userData.email,
        message: {
          subject: "SY SmartMatch – Final Reminder to Confirm Your Spot",
          html: `
      <div style="font-family: sans-serif; color: #1E3D34; max-width: 600px;">
        <p>Hi ${userData.firstName},</p>
        <p>This is a final reminder to confirm your spot for the upcoming SY SmartMatch event.</p>
        <p>We’ll be finalizing the list shortly, so please confirm as soon as possible if you’d like to attend.</p>

        <div style="margin: 40px 0; text-align: center;">
            <a href="${confirmationURL}" style="background: #1E3D34; color: #DEE8DF; padding: 16px 32px; text-decoration: none; border-radius: 12px; font-weight: bold; display: inline-block; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
            Confirm Your Spot
            </a>
        </div>
        
        <p style="font-weight: bold; color: #1E3D34;">SY SmartMatch Team</p>
      </div>
    `,
        },
      });
      setSentReminders((prev) => [...prev, userData.userId]);
      return true;
    } catch (err) {
      console.error("Error sending individual reminder:", err);
      return false;
    }
  };

  const sendInvite = async (a) => {
    console.log(a);
    if (!a.email) {
      alert("This user has not set an email! They cannot be invited this way.");
      return;
    }

    if (window.confirm(`Send invite to ${a.firstName} ${a.lastName}?`)) {
      try {
        // 1. Construct the URLs
        const baseUrl = "https://events.tikvahtogether.org/rsvp";
        const inviteParams = `?userId=${a.userId}&eventId=${selectedEvent?.id}`;
        const fullUrl = baseUrl + inviteParams;

        // 2. Update the registration status
        await updateDoc(doc(db, "registrations", a.id), {
          status: "invited",
        });

        // 3. Trigger the invitation email
        await addDoc(collection(db, "email"), {
          to: a.email,
          message: {
            subject: `SY SmartMatch - You're Invited`,
            html: `
      <div style="font-family: sans-serif; text-align: center; max-width: 500px; margin: auto; border: 2px solid #95B699; padding: 30px; border-radius: 20px; background-color: #ffffff;">
        <h2 style="color: #1E3D34; font-size: 24px;">Hi ${a.firstName}!</h2>
        <p style="color: #1E3D34;">We're excited to invite you to <strong>SY SmartMatch</strong>.</p>

        <div style="background: #DEE8DF; padding: 15px; border-radius: 10px; margin: 20px 0; color: #1E3D34; text-align: left;">
          <strong>Event Details:</strong><br>
          Date: ${selectedEvent?.scheduledAt?.toDate().toLocaleDateString() || "TBA"}<br>
          Time: ${selectedEvent?.scheduledAt?.toDate().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) || "TBA"}<br>
          Location: ${selectedEvent?.generalLocation || "TBA"}
        </div>
        
        <p style="font-size: 13px; color: #95B699; font-weight: bold;">
          Please confirm your spot within 3 days to secure your place.
        </p>
        
        <a href="${fullUrl}" style="display: inline-block; background: #1E3D34; color: #DEE8DF; padding: 14px 28px; text-decoration: none; border-radius: 10px; font-weight: bold; margin-top: 15px;">
          View Invitation & Confirm
        </a>
        <p style="margin-top: 25px; font-weight: bold; color: #1E3D34;">SY SmartMatch Team</p>
      </div>
    `,
          },
        });

        alert("Invite sent successfully!");
      } catch (err) {
        console.error("Error sending invite:", err);
        alert("Failed to send invite.");
      }
    }
  };

  const deleteAttendee = async (attendeeId, name) => {
    if (window.confirm(`Remove ${name} from this event?`)) {
      try {
        await deleteDoc(doc(db, "registrations", attendeeId));
      } catch (err) {
        console.error("Error deleting attendee:", err);
      }
    }
  };

  const deleteUserFromMaster = async (userId, name) => {
    // Fallback if name is passed incorrectly or empty
    const displayName = name || "this user";

    if (
      window.confirm(
        `Permanently delete ${displayName} from the Master List? This will also remove them from all events and cannot be undone.`,
      )
    ) {
      try {
        // 1. Delete the user from the master 'users' collection
        await deleteDoc(doc(db, "users", userId));

        // 2. Query and delete all registrations associated with this userId
        const regQuery = query(
          collection(db, "registrations"),
          where("userId", "==", userId),
        );
        const regSnap = await getDocs(regQuery);

        // Execute all deletion promises concurrently
        const deletePromises = regSnap.docs.map((docSnap) =>
          deleteDoc(docSnap.ref),
        );
        await Promise.all(deletePromises);
      } catch (err) {
        console.error("Error performing cascading user deletion:", err);
      }
    }
  };

  const copyRegistrationLink = (eventId) => {
    // window.location.origin will use http://localhost:3000 or your production URL automatically
    const registrationUrl = `${window.location.origin}/register?eventId=${eventId}`;

    navigator.clipboard.writeText(registrationUrl);
    alert("Link copied to clipboard!");
  };

  const addUsersToEvent = async () => {
    if (!targetEventId || selectedUserIds.length === 0) return;

    // 1. FILTER: Remove anyone who is already in 'allRegistrations' for this event
    const trulyNewIds = selectedUserIds.filter(
      (userId) =>
        !allRegistrations.some(
          (reg) => reg.userId === userId && reg.eventId === targetEventId,
        ),
    );

    if (trulyNewIds.length === 0) {
      alert("All selected users are already in this event.");
      setSelectedUserIds([]);
      return;
    }

    const targetEvent = events.find((e) => e.id === targetEventId);
    setLoading(true);

    try {
      const promises = trulyNewIds.map(async (userId) => {
        return addDoc(collection(db, "registrations"), {
          userId,
          eventId: targetEventId,
          eventName: targetEvent?.name || "Unknown Event",
          groupId: "Group 1", // Default group
          status: "pending invite",
          checkedIn: false,
        });
      });

      await Promise.all(promises);
      setSelectedUserIds([]);
      alert(`Added ${trulyNewIds.length} users to ${targetEvent?.name}`);
    } catch (err) {
      console.error(err);
      alert("Error adding users.");
    }
    setLoading(false);
  };

  useEffect(() => {
    const hasMaleAge = filters.minAgeMan || filters.maxAgeMan;
    const hasFemaleAge = filters.minAgeWoman || filters.maxAgeWoman;

    setFilters((prev) => {
      // Rule 1: Both ranges have values -> Default to "all"
      if (hasMaleAge && hasFemaleAge) {
        if (prev.gender === "all") return prev; // Avoid unnecessary re-renders
        return { ...prev, gender: "all" };
      }

      // Rule 2: Only Male range has values -> Default to "man"
      if (hasMaleAge && !hasFemaleAge) {
        if (prev.gender === "man") return prev;
        return { ...prev, gender: "man" };
      }

      // Rule 3: Only Female range has values -> Default to "woman"
      if (hasMaleAge && !hasFemaleAge) {
        if (prev.gender === "woman") return prev;
        return { ...prev, gender: "woman" };
      }

      return prev;
    });
  }, [
    filters.minAgeMan,
    filters.maxAgeMan,
    filters.minAgeWoman,
    filters.maxAgeWoman,
  ]);

  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, "registrations"), (snap) => {
      setAllRegistrations(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const syncEmailHistory = async () => {
      if (!selectedEvent) return;

      try {
        // Query for both types of emails
        const q = query(collection(db, "email"));
        const querySnapshot = await getDocs(q);

        const detailsSent = [];
        const finalSent = [];

        querySnapshot.forEach((doc) => {
          const data = doc.data();
          const subject = data.message?.subject;
          const recipient = data.to;

          // Find the attendee that matches this email to get their userId
          const attendee = attendees.find((attr) => attr.email === recipient);
          if (attendee) {
            if (subject === "SY SmartMatch: Event Details & Reminder") {
              detailsSent.push(attendee.userId);
            } else if (
              subject === "SY SmartMatch – Final Reminder to Confirm Your Spot"
            ) {
              finalSent.push(attendee.userId);
            }
          }
        });

        setSentEventDetails([...new Set(detailsSent)]);
        setSentReminders([...new Set(finalSent)]);
      } catch (err) {
        console.error("Error syncing email history:", err);
      }
    };

    if (attendees.length > 0) {
      syncEmailHistory();
    }
  }, [selectedEvent, attendees.length]);

  useEffect(() => {
    // Fetch all users for the Master List
    const unsubscribe = onSnapshot(collection(db, "users"), (snap) => {
      const users = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setMasterUsers(users);
    });
    return () => unsubscribe();
  }, []);

  // Helper to get a user's event history
  const getUserHistory = (userId) => {
    const userRegs = allRegistrations.filter((r) => r.userId === userId);
    const eventNames = userRegs
      .map((r) => {
        const event = events.find((e) => e.id === r.eventId);
        return event ? event.name : null;
      })
      .filter(Boolean);
    return eventNames;
  };

  const getUserAttendedHistory = (userId) => {
    const userRegs = allRegistrations.filter(
      (r) => r.userId === userId && r.status === "attended",
    );
    const eventNames = userRegs
      .map((r) => {
        const event = events.find((e) => e.id === r.eventId);
        return event ? event.name : null;
      })
      .filter(Boolean);
    return eventNames;
  };

  // 1. Fetch all events in real-time
  useEffect(() => {
    const q = query(collection(db, "events"), orderBy("createdAt", "desc"));
    const unsubscribe = onSnapshot(q, (snap) => {
      setEvents(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      // If we currently have an event selected, find its NEWEST version from the fresh data
      setSelectedEvent((currentSelected) => {
        if (!currentSelected) return null;
        return (
          snap.docs
            .map((d) => ({ id: d.id, ...d.data() }))
            .find((e) => e.id === currentSelected.id) || null
        );
      });
    });
    return () => unsubscribe();
  }, []);

  // 2. Fetch attendees when an event is selected (Updated for Users DB)
  useEffect(() => {
    if (!selectedEvent) return;

    const q = query(
      collection(db, "registrations"),
      where("eventId", "==", selectedEvent.id),
    );

    const unsubscribe = onSnapshot(q, async (snap) => {
      const registrationDocs = snap.docs.map((d) => ({
        id: d.id,
        ...d.data(),
      }));

      if (registrationDocs.length === 0) {
        setAttendees([]);
        return;
      }

      // Get all unique userIds from the registrations
      const userIds = registrationDocs.map((reg) => reg.userId).filter(Boolean);

      if (userIds.length > 0) {
        // Fetch user profiles from the 'users' collection
        const usersQuery = query(
          collection(db, "users"),
          where(documentId(), "in", userIds),
        );
        const userSnap = await getDocs(usersQuery);
        const userMap = {};
        userSnap.forEach((doc) => {
          userMap[doc.id] = doc.data();
        });

        // Merge Registration data with User profile data
        const mergedData = registrationDocs.map((reg) => ({
          ...reg,
          ...(userMap[reg.userId] || {}), // Spread user profile data into the attendee object
        }));

        setAttendees(mergedData);
      } else {
        setAttendees(registrationDocs);
      }
    });

    return () => unsubscribe();
  }, [selectedEvent]);

  useEffect(() => {
    const cleanupOldEvents = async () => {
      // const seventyTwoHoursAgo = new Date(Date.now() - 72 * 60 * 60 * 1000);
      // // We only want to delete events that have a scheduledAt date
      // const q = query(
      //   collection(db, "events"),
      //   where("scheduledAt", "<", seventyTwoHoursAgo),
      // );
      // const snapshot = await getDocs(q);
      // snapshot.forEach(async (eventDoc) => {
      //   // Delete registrations first (optional but recommended for data hygiene)
      //   const regQ = query(
      //     collection(db, "registrations"),
      //     where("eventId", "==", eventDoc.id),
      //   );
      //   const regSnap = await getDocs(regQ);
      //   regSnap.forEach(
      //     async (r) => await deleteDoc(doc(db, "registrations", r.id)),
      //   );
      //   // Delete the event itself
      //   await deleteDoc(doc(db, "events", eventDoc.id));
      //   console.log(`Auto-deleted expired event: ${eventDoc.id}`);
      // });
    };

    if (events.length > 0) {
      cleanupOldEvents();
    }
  }, [events]);

  useEffect(() => {
    const cleanupExpiredInvites = async () => {
      // 1. Calculate the cutoff (72 hours ago)
      const threeDaysAgo = new Date();
      threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

      try {
        // 2. Query for users who are 'invited' and whose invite is older than 3 days
        const q = query(
          collection(db, "registrations"),
          where("status", "==", "invited"),
          where("invitedAt", "<", threeDaysAgo),
        );

        const querySnapshot = await getDocs(q);

        if (querySnapshot.empty) return;

        // 3. Use a WriteBatch for better performance and atomicity
        const batch = writeBatch(db);

        querySnapshot.docs.forEach((docSnap) => {
          const docRef = doc(db, "registrations", docSnap.id);
          batch.update(docRef, {
            status: "no response",
          });
        });

        await batch.commit();
        console.log(
          `Successfully moved ${querySnapshot.size} users to 'no response'.`,
        );
      } catch (err) {
        console.error("Error during invite cleanup:", err);
      }
    };

    cleanupExpiredInvites();
  }, []); // Empty dependency array ensures this only runs once when the dashboard mounts

  const [eventDate, setEventDate] = useState("");
  const [eventTime, setEventTime] = useState("");

  const createEvent = async () => {
    if (!eventName || !eventDate || !eventTime)
      return alert("Please fill in all event details!");
    setLoading(true);
    try {
      // Combine date and time strings into a single Date object
      const scheduledDateTime = new Date(`${eventDate}T${eventTime}`);

      await addDoc(collection(db, "events"), {
        name: eventName,
        roundTime: parseInt(roundTime),
        active: false,
        currentRound: 1,
        eventGroups: [{ name: "Group 1" }],
        createdAt: new Date(),
        scheduledAt: scheduledDateTime, // This is what we use for the 72h check
        generalLocation: generalLocation,
        fullAddress: fullAddress,
      });

      setEventName("");
      setEventDate("");
      setEventTime("");
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  };
  const updateAttendeeField = async (attendee, field, newValue) => {
    try {
      const registrationFields = [
        "status",
        "checkedIn",
        "groupId",
        "tableNumber",
        "eventLabel",
        "isConfirmed",
      ];
      const isRegistrationField = registrationFields.includes(field);

      const collectionName = isRegistrationField ? "registrations" : "users";
      const docId = isRegistrationField ? attendee.id : attendee.userId;

      if (!docId) return;

      const docRef = doc(db, collectionName, docId);
      await updateDoc(docRef, { [field]: newValue });

      setAttendees((prev) =>
        prev.map((a) =>
          (isRegistrationField ? a.id === docId : a.userId === docId)
            ? { ...a, [field]: newValue }
            : a,
        ),
      );
    } catch (err) {
      console.error(`Error updating ${field}:`, err);
      alert("Failed to update. Please check your connection.");
    }
  };

  const deleteEvent = async (id) => {
    if (
      window.confirm(
        "Are you sure? This will delete all registration data for this event.",
      )
    ) {
      await deleteDoc(doc(db, "events", id));
      setSelectedEvent(null);
    }
  };

  const stats = useMemo(() => {
    const getListStats = (list) => {
      // Simplified since data is always man/woman
      const boys = list.filter((u) => u.gender?.toLowerCase() === "man").length;
      const girls = list.filter(
        (u) => u.gender?.toLowerCase() === "woman",
      ).length;

      const total = boys + girls;
      const ratio =
        total > 0
          ? {
              b: Math.round((boys / total) * 100),
              g: Math.round((girls / total) * 100),
            }
          : { b: 0, g: 0 };

      return { boys, girls, total, ratio };
    };

    // Overall stats for the current tab
    const currentList =
      activeTab === "master" ? filteredMasterList : filteredAttendees;
    const overall = getListStats(currentList);

    // Stats per group (for the Events tab)
    const groupStats = {};
    if (activeTab === "events") {
      filteredAttendees.forEach((u) => {
        const gId = u.groupId || "Unassigned";
        if (!groupStats[gId]) groupStats[gId] = [];
        groupStats[gId].push(u);
      });
      Object.keys(groupStats).forEach((key) => {
        groupStats[key] = getListStats(groupStats[key]);
      });
    }

    return { overall, groupStats };
  }, [filteredMasterList, filteredAttendees, activeTab]);

  const tableErrors = useMemo(() => {
    if (activeTab !== "events" || !selectedEvent) return [];
    const errors = [];
    const groups = {};

    attendees.forEach((a) => {
      const t = parseInt(a.tableNumber, 10);
      if (!t || isNaN(t) || t <= 0) return; // Only validate actually assigned tables

      const g = a.groupId || "Unassigned";
      if (!groups[g]) groups[g] = { boys: [], girls: [] };

      const isMale = ["man", "boy", "male"].includes(
        (a.gender || "").toLowerCase(),
      );
      if (isMale) groups[g].boys.push(t);
      else groups[g].girls.push(t);
    });

    for (const [groupId, data] of Object.entries(groups)) {
      const checkSequence = (arr, genderLabel) => {
        if (arr.length === 0) return;
        const sorted = [...arr].sort((a, b) => a - b);
        const unique = new Set(sorted);

        if (unique.size !== sorted.length) {
          errors.push(
            `Group "${groupId}" (${genderLabel}): Duplicate table numbers detected.`,
          );
        }

        const max = Math.max(...sorted);
        if (max !== unique.size) {
          errors.push(
            `Group "${groupId}" (${genderLabel}): Gap in table numbers (Expected 1 through ${max}).`,
          );
        }
      };
      checkSequence(data.boys, "Men");
      checkSequence(data.girls, "Women");
    }
    return errors;
  }, [attendees, activeTab, selectedEvent]);

  return (
    <div className="flex flex-col bg-transparent">
      {/* TAB NAVIGATION */}
      <div className="flex bg-white border-b border-slate-200 px-6 shrink-0">
        <button
          onClick={() => setActiveTab("events")}
          className={`px-6 py-4 font-bold text-sm ${activeTab === "events" ? "border-b-2 border-[#1E3D34] text-[#1E3D34]" : "text-slate-400"}`}
        >
          Events Management
        </button>
        <button
          onClick={() => setActiveTab("master")}
          className={`px-6 py-4 font-bold text-sm ${activeTab === "master" ? "border-b-2 border-[#1E3D34] text-[#1E3D34]" : "text-slate-400"}`}
        >
          Master Singles List
        </button>
        <button
          onClick={() => window.open("/event?admin=true", "_blank")}
          className="px-6 py-4 bg-blue-50 text-blue-600 font-bold text-xs rounded-lg hover:bg-blue-100 transition-colors shadow-sm flex items-center gap-2"
          title="Open Gatekeeper View"
        >
          Table View ↗
        </button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div className="flex flex-col md:flex-row h-screen bg-transparent overflow-hidden">
          {/* SIDEBAR: Event List */}
          {activeTab === "events" && (
            <div
              className={`${
                selectedEvent ? "hidden md:flex" : "flex"
              } w-full md:w-auto max-w-xs bg-white border-r border-slate-200 p-6 flex-col h-full`}
            >
              <h2 className="text-xl font-bold text-[#1E3D34] mb-6">
                Events Management
              </h2>

              <div className="space-y-4 mb-8">
                <input
                  className="w-full p-2 border border-slate-200 rounded text-sm focus:ring-2 focus:ring-blue-900 outline-none"
                  placeholder="New Event Name..."
                  value={eventName}
                  onChange={(e) => setEventName(e.target.value)}
                />

                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-400 uppercase">
                    Event Date & Time
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="date"
                      className="flex-1 p-2 border border-slate-200 rounded text-xs outline-none"
                      value={eventDate}
                      onChange={(e) => setEventDate(e.target.value)}
                    />
                    <input
                      type="time"
                      className="w-24 p-2 border border-slate-200 rounded text-xs outline-none"
                      value={eventTime}
                      onChange={(e) => setEventTime(e.target.value)}
                    />
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500 font-medium">
                    Minute(s) per round:
                  </span>
                  <input
                    type="number"
                    className="w-16 p-2 border border-slate-200 rounded text-sm outline-none"
                    value={roundTime}
                    onChange={(e) => setRoundTime(e.target.value)}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500 font-medium">
                    General Location (e.g., Zip Code or City):
                  </span>
                  <input
                    type="text"
                    className="flex-1 p-2 border border-slate-200 rounded text-sm outline-none"
                    value={generalLocation}
                    onChange={(e) => setGeneralLocation(e.target.value)}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500 font-medium">
                    Full Address:
                  </span>
                  <input
                    type="text"
                    className="flex-1 p-2 border border-slate-200 rounded text-sm outline-none"
                    value={fullAddress}
                    onChange={(e) => setFullAddress(e.target.value)}
                  />
                </div>
                <button
                  onClick={createEvent}
                  className="w-full bg-[#1E3D34] text-white py-2 rounded font-semibold flex items-center justify-center gap-2 hover:bg-[#95B699] transition shadow-sm"
                >
                  <Plus size={18} /> Create Event
                </button>
              </div>

              <div className="flex-1 overflow-y-auto space-y-2">
                <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">
                  History
                </p>
                {events.map((ev) => (
                  <div
                    key={ev.id}
                    onClick={() => setSelectedEvent(ev)}
                    className={`p-3 rounded-lg cursor-pointer transition-all border ${
                      selectedEvent?.id === ev.id
                        ? "bg-[#95B699]/30 border-blue-200"
                        : "bg-white border-transparent hover:bg-transparent"
                    }`}
                  >
                    <div className="flex justify-between items-start">
                      <span className="font-semibold text-slate-800 text-sm truncate">
                        {ev.name}
                      </span>
                      {ev.active && (
                        <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse mt-1"></span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 mt-1">
                      {ev.roundTime} minute(s) per round
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* MAIN CONTENT: Event Details */}
          <div className="flex-1 p-4 overflow-auto">
            {selectedEvent || activeTab === "master" ? (
              <div className="w-full mx-auto">
                <button
                  onClick={() => setSelectedEvent(null)}
                  className="md:hidden mb-4 text-blue-600 font-bold flex items-center gap-2"
                >
                  ← Back to Events
                </button>
                {/* HEADER SECTION */}
                {activeTab === "events" && (
                  <div className="flex flex-col lg:flex-row lg:justify-between lg:items-start gap-6 mb-10 pb-6 border-b border-slate-200">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h1 className="text-2xl md:text-4xl font-bold text-slate-900">
                          {selectedEvent.name}
                        </h1>
                        <span
                          className={`px-3 py-1 rounded-full text-[10px] font-black tracking-widest uppercase transition-colors duration-300 ${
                            selectedEvent.active
                              ? "bg-green-500 text-white animate-pulse"
                              : "bg-slate-200 text-slate-600"
                          }`}
                        >
                          {selectedEvent.active ? "LIVE" : "DRAFT"}
                        </span>
                      </div>
                      <div className="mt-3 flex flex-wrap md:flex-nowrap items-center gap-2 w-full md:w-auto group">
                        <div
                          onClick={() => copyRegistrationLink(selectedEvent.id)}
                          className="flex items-center gap-2 px-2 py-1 bg-[#95B699]/30 text-blue-700 rounded border border-blue-100 cursor-pointer hover:bg-blue-100 transition-all shadow-sm"
                        >
                          <span className="text-[10px] font-bold uppercase tracking-tight">
                            Registration Link:
                          </span>
                          <code className="text-[10px] md:text-xs font-mono break-all md:break-normal">
                            {window.location.origin}/register?eventId=
                            {selectedEvent.id}
                          </code>
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className="lucide lucide-copy"
                          >
                            <rect
                              width="14"
                              height="14"
                              x="8"
                              y="8"
                              rx="2"
                              ry="2"
                            />
                            <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
                          </svg>
                        </div>
                        <span className="text-[10px] text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity italic">
                          Click to copy URL
                        </span>
                      </div>
                      <p className="text-sm text-slate-500 mt-1">
                        Round Time: {selectedEvent.roundTime} minute(s)
                      </p>
                      <p className="text-slate-400 text-sm mt-2 font-mono">
                        ID: {selectedEvent.id}
                      </p>
                      <p className="text-slate-400 text-sm mt-2 font-mono">
                        Event Date & Time:{" "}
                        {selectedEvent.scheduledAt
                          ? selectedEvent.scheduledAt.toDate().toLocaleString()
                          : "Not scheduled"}
                      </p>
                    </div>

                    <div className="flex flex-col gap-4 bg-slate-100 p-5 rounded-xl border border-slate-200 mb-8">
                      {/* Header & Add Input Row */}
                      <div className="flex items-end justify-between gap-10">
                        <div className="flex flex-col flex-1">
                          <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">
                            Event Configuration
                          </span>
                          <div className="flex gap-2">
                            <input
                              type="text"
                              placeholder="Enter group name (e.g. Young Professionals)"
                              value={newGroupName}
                              onChange={(e) => setNewGroupName(e.target.value)}
                              className="flex-1 p-2 text-sm border border-slate-300 rounded-lg shadow-sm focus:ring-2 focus:ring-blue-500 outline-none"
                            />
                            <button
                              onClick={async () => {
                                if (!newGroupName.trim()) {
                                  alert("Please enter a group name first.");
                                  return;
                                }
                                try {
                                  const existingGroups =
                                    selectedEvent.eventGroups || [];
                                  const newGroup = {
                                    name: newGroupName.trim(),
                                  };

                                  const updatedGroups = [
                                    ...existingGroups,
                                    newGroup,
                                  ];

                                  await updateDoc(
                                    doc(db, "events", selectedEvent.id),
                                    {
                                      eventGroups: updatedGroups,
                                    },
                                  );

                                  setNewGroupName(""); // Clear the input after success
                                  alert(`"${newGroup.name}" created.`);
                                } catch (error) {
                                  alert("Error adding group.");
                                }
                              }}
                              className="flex items-center gap-2 text-xs bg-[#1E3D34] text-white px-4 py-2 rounded-lg font-bold hover:bg-[#95B699] transition-all shadow-sm h-10"
                            >
                              <Plus size={14} />
                              Add Group
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Active Groups Display */}
                      <div className="flex flex-wrap gap-3 mt-2 border-t border-slate-200 pt-4">
                        <span className="w-full text-[10px] font-bold text-slate-400 uppercase">
                          Existing Groups:
                        </span>

                        {/* We look up the event directly from the main 'events' state to ensure it's the live version */}
                        {(
                          events.find((e) => e.id === selectedEvent?.id)
                            ?.eventGroups || []
                        ).length === 0 && (
                          <span className="text-xs italic text-slate-400">
                            No groups created yet.
                          </span>
                        )}

                        {(
                          events.find((e) => e.id === selectedEvent?.id)
                            ?.eventGroups || []
                        ).map((group, idx) => (
                          <div
                            key={group.name}
                            className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg px-3 py-2 shadow-sm hover:border-blue-300 transition-colors"
                          >
                            <input
                              className="text-xs font-bold w-32 outline-none text-slate-700"
                              value={group.name}
                              onChange={async (e) => {
                                const liveEvent = events.find(
                                  (ev) => ev.id === selectedEvent.id,
                                );
                                const updatedGroups = [
                                  ...liveEvent.eventGroups,
                                ];
                                updatedGroups[idx].name = e.target.value;

                                await updateDoc(
                                  doc(db, "events", selectedEvent.id),
                                  {
                                    eventGroups: updatedGroups,
                                  },
                                );
                              }}
                            />
                            <button
                              onClick={async () => {
                                if (window.confirm(`Delete "${group.name}"?`)) {
                                  const liveEvent = events.find(
                                    (ev) => ev.id === selectedEvent.id,
                                  );
                                  const updatedGroups =
                                    liveEvent.eventGroups.filter(
                                      (_, i) => i !== idx,
                                    );

                                  await updateDoc(
                                    doc(db, "events", selectedEvent.id),
                                    {
                                      eventGroups: updatedGroups,
                                    },
                                  );
                                }
                              }}
                              className="text-slate-300 hover:text-red-500 transition-colors"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="flex items-center gap-3 w-full md:w-auto border-t md:border-none pt-4 md:pt-0">
                      {/* --- NEW EMAIL BUTTON --- */}
                      <button
                        onClick={() => {
                          // Load the checked users from the main table into the modal
                          setEmailData((prev) => ({
                            ...prev,
                            recipients: [...selectedUserIds],
                          }));
                          setShowEmailModal(true);
                        }}
                        className="px-4 py-2 bg-blue-50 text-blue-700 border border-blue-200 rounded-md font-bold flex items-center gap-2 hover:bg-blue-100 transition-all duration-200 shadow-sm"
                        title="Send Custom Email"
                      >
                        <Mail size={16} /> Email Attendees
                      </button>
                      {/* Reminder Button */}
                      <button
                        onClick={sendBulkReminders}
                        className="px-4 py-2 bg-white text-[#1E3D34] border border-[#1E3D34] rounded-md font-bold flex items-center gap-2 hover:bg-[#95B699]/30 transition-all duration-200 shadow-sm"
                        title="Send Reminders"
                      >
                        <Bell size={16} /> Remind All
                      </button>
                      <button
                        onClick={() =>
                          toggleStatus(selectedEvent.id, selectedEvent.active)
                        }
                        className={`px-6 py-2 rounded-md font-bold flex items-center gap-2 transition-all duration-200 shadow-sm border ${
                          selectedEvent.active
                            ? "bg-white text-orange-600 border-orange-200 hover:bg-orange-50"
                            : "bg-[#1E3D34] text-white border-[#1E3D34] hover:bg-[#95B699]"
                        }`}
                      >
                        {selectedEvent.active ? (
                          <>
                            <Square size={16} fill="currentColor" /> Stop Event
                          </>
                        ) : (
                          <>
                            <Play size={16} fill="currentColor" /> Launch Event
                          </>
                        )}
                      </button>
                      <button
                        onClick={() =>
                          togglePause(selectedEvent, selectedEvent.isPaused)
                        }
                        className={`px-6 py-2 rounded-md font-bold flex items-center gap-2 transition-all duration-200 shadow-sm border
                         ${
                           selectedEvent.isPaused
                             ? "bg-green-600 text-white border-green-600 hover:bg-green-700"
                             : "bg-slate-200 text-slate-600 border-slate-200 hover:bg-slate-300"
                         }`}
                        disabled={!selectedEvent.active}
                      >
                        {selectedEvent.isPaused ? (
                          <>
                            {" "}
                            <Play size={16} fill="currentColor" /> Resume{" "}
                          </>
                        ) : (
                          <>
                            {" "}
                            <Pause size={16} fill="currentColor" /> Pause{" "}
                          </>
                        )}
                      </button>

                      <button
                        onClick={() => deleteEvent(selectedEvent.id)}
                        className="p-2 text-slate-300 hover:text-red-600 hover:bg-red-50 rounded-md transition"
                        title="Delete Event"
                      >
                        <Trash2 size={22} />
                      </button>
                    </div>
                  </div>
                )}

                {/* FILTER SYSTEM */}
                <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm mb-6">
                  <div className="p-6 grid grid-cols-1 md:grid-cols-3 gap-6 items-end">
                    <div>
                      <label className="text-[10px] font-bold text-slate-400 uppercase mb-2 block">
                        Hashgafa Group
                      </label>
                      <select
                        className="w-full p-2.5 border border-slate-200 rounded-lg text-sm bg-transparent"
                        value={filters.hashgafa}
                        onChange={(e) =>
                          setFilters({ ...filters, hashgafa: e.target.value })
                        }
                      >
                        <option value="all">All Groups</option>
                        <option value="Expected">
                          Hair-Covering Expected (Purple)
                        </option>
                        <option value="Flexible">Flexible (Green)</option>
                        <option value="None">
                          No Hair-Covering Expected (Blue)
                        </option>
                      </select>
                    </div>

                    <div>
                      <label className="text-[10px] font-bold text-blue-600 uppercase mb-2 block">
                        Men's Age Range
                      </label>
                      <div className="flex gap-2">
                        <input
                          type="number"
                          placeholder="Min"
                          className="w-1/2 p-2 border border-slate-200 rounded-lg text-sm"
                          value={filters.minAgeMan}
                          onChange={(e) =>
                            setFilters({
                              ...filters,
                              minAgeMan: e.target.value,
                              gender: "man", // Auto-set gender
                            })
                          }
                        />
                        <input
                          type="number"
                          placeholder="Max"
                          className="w-1/2 p-2 border border-slate-200 rounded-lg text-sm"
                          value={filters.maxAgeMan}
                          onChange={(e) =>
                            setFilters({
                              ...filters,
                              maxAgeMan: e.target.value,
                              gender: "man", // Auto-set gender
                            })
                          }
                        />
                      </div>
                    </div>

                    <div>
                      <div className="flex justify-between items-end mb-2">
                        {/* 1. The Label stays on the left */}
                        <label className="text-[10px] font-bold text-pink-600 uppercase block">
                          Women's Age Range
                        </label>

                        {/* 2. Group the buttons together so they move as one unit to the right */}
                        <div className="flex items-center gap-4">
                          <button
                            onClick={() => setIsAdvancedOpen(!isAdvancedOpen)}
                            className="text-xs text-blue-600 font-bold flex items-center gap-1 hover:underline"
                          >
                            {isAdvancedOpen
                              ? "Hide Filters"
                              : "Advanced Filters"}
                            <ChevronDown
                              size={14}
                              className={`transition-transform ${isAdvancedOpen ? "rotate-180" : ""}`}
                            />
                          </button>

                          <button
                            onClick={resetFilters}
                            className="flex items-center gap-1 px-3 py-1.5 text-xs font-bold text-red-600 border border-red-200 rounded-lg hover:bg-red-50 transition-colors"
                          >
                            <Trash2 size={14} />
                            Clear All Filters
                          </button>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <input
                          type="number"
                          placeholder="Min"
                          className="w-1/2 p-2 border border-slate-200 rounded-lg text-sm"
                          value={filters.minAgeWoman}
                          onChange={(e) =>
                            setFilters({
                              ...filters,
                              minAgeWoman: e.target.value,
                              gender: "woman", // Auto-set gender
                            })
                          }
                        />
                        <input
                          type="number"
                          placeholder="Max"
                          className="w-1/2 p-2 border border-slate-200 rounded-lg text-sm"
                          value={filters.maxAgeWoman}
                          onChange={(e) =>
                            setFilters({
                              ...filters,
                              maxAgeWoman: e.target.value,
                              gender: "woman", // Auto-set gender
                            })
                          }
                        />
                      </div>
                    </div>

                    <div className="flex flex-col gap-2">
                      <label className="text-[10px] font-bold text-slate-400 uppercase">
                        Signup Date Range
                      </label>
                      <div className="flex items-center gap-2">
                        <input
                          type="date"
                          className="p-2 border border-slate-200 rounded text-xs outline-none"
                          value={filters.startDate}
                          onChange={(e) =>
                            setFilters({
                              ...filters,
                              startDate: e.target.value,
                            })
                          }
                        />
                        <span className="text-slate-400">-</span>
                        <input
                          type="date"
                          className="p-2 border border-slate-200 rounded text-xs outline-none"
                          value={filters.endDate}
                          onChange={(e) =>
                            setFilters({ ...filters, endDate: e.target.value })
                          }
                        />
                      </div>
                    </div>
                  </div>

                  {/* ADVANCED FILTERS (Collapsible) */}
                  {isAdvancedOpen && (
                    <div className="px-6 pb-6 pt-2 border-t border-slate-100 bg-transparent/50 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
                      {/* Gender */}
                      <div>
                        <label className="text-[10px] font-bold text-slate-400 uppercase mb-1 block">
                          Gender
                        </label>
                        <select
                          className="w-full p-2 border rounded text-xs"
                          value={filters.gender}
                          onChange={(e) =>
                            setFilters({ ...filters, gender: e.target.value })
                          }
                        >
                          <option value="all">All</option>
                          <option value="man">Men</option>
                          <option value="woman">Women</option>
                        </select>
                      </div>

                      {/* Ethnicity Filter */}
                      <div>
                        <label className="text-[10px] font-bold text-slate-400 uppercase mb-1 block">
                          Ethnicity
                        </label>
                        <select
                          className="w-full p-2 border rounded text-xs"
                          value={filters.ethnicity}
                          onChange={(e) =>
                            setFilters({
                              ...filters,
                              ethnicity: e.target.value,
                            })
                          }
                        >
                          <option value="all">Any</option>
                          <optgroup label="Sephardic">
                            <option value="Syrian">Syrian</option>
                            <option value="Egyptian">Egyptian</option>
                            <option value="Lebanese">Lebanese</option>
                            <option value="Persian">Persian</option>
                            <option value="Moroccan">Moroccan</option>
                            <option value="Israeli">Israeli</option>
                            <option value="Other Sephardic">
                              Other Sephardic
                            </option>
                          </optgroup>
                          <option value="Ashkenaz">Ashkenaz</option>
                          <option value="Other">Other</option>
                        </select>
                      </div>

                      {/* Marital */}
                      <div>
                        <label className="text-[10px] font-bold text-slate-400 uppercase mb-1 block">
                          Marital
                        </label>
                        <select
                          className="w-full p-2 border rounded text-xs"
                          value={filters.maritalStatus}
                          onChange={(e) =>
                            setFilters({
                              ...filters,
                              maritalStatus: e.target.value,
                            })
                          }
                        >
                          <option value="all">Any</option>
                          <option value="Single">Single</option>
                          <option value="Divorced">Divorced</option>
                        </select>
                      </div>

                      {/* Boolean Filters (Shabbat, Kashrut, Kohen) */}
                      {["isKohen", "shomerShabbat", "shomerKashrut"].map(
                        (key) => (
                          <div key={key}>
                            <label className="text-[10px] font-bold text-slate-400 uppercase mb-1 block">
                              {key
                                .replace("is", "")
                                .replace("shomer", "Shomer ")}
                            </label>
                            <select
                              className="w-full p-2 border rounded text-xs"
                              value={filters[key]}
                              onChange={(e) =>
                                setFilters({
                                  ...filters,
                                  [key]: e.target.value,
                                })
                              }
                            >
                              <option value="all">Any</option>
                              <option value="yes">Yes</option>
                              <option value="no">No</option>
                            </select>
                          </div>
                        ),
                      )}

                      {/* Dress Style */}
                      <div>
                        <label className="text-[10px] font-bold text-slate-400 uppercase mb-1 block">
                          Dress Style
                        </label>
                        <select
                          className="w-full p-2 border rounded text-xs"
                          value={filters.dressStyle}
                          onChange={(e) =>
                            setFilters({
                              ...filters,
                              dressStyle: e.target.value,
                            })
                          }
                        >
                          <option value="all">Any</option>
                          <option value="skirtsOnly">Skirts Only</option>
                          <option value="skirtsPants">Skirts + Pants</option>
                        </select>
                      </div>

                      {/* Confirmation Status */}
                      <div>
                        <label className="text-[10px] font-bold text-slate-400 uppercase mb-1 block">
                          Confimation Status
                        </label>
                        <select
                          className="w-full p-2 border border-blue-200 rounded text-xs bg-white"
                          value={filters.status}
                          onChange={(e) =>
                            setFilters({
                              ...filters,
                              status: e.target.value,
                            })
                          }
                        >
                          <option value="all">Any Status</option>
                          <option value="attended">Attended</option>
                          <option value="pending invite">Pending Invite</option>
                          <option value="invited">Invited</option>
                          <option value="confirmed">Confirmed</option>
                          <option value="declined">Declined</option>
                          <option value="waitlist">Waitlist</option>
                          <option value="no response">No Response</option>
                        </select>
                      </div>
                    </div>
                  )}
                  {activeTab === "master" && (
                    <div className="bg-[#95B699]/300 text-white p-4 rounded flex items-center justify-between">
                      <span className="font-bold">
                        {selectedUserIds.length} user(s) selected
                      </span>
                      <div className="flex gap-4 items-center">
                        <select
                          className="text-black text-sm p-1.5 rounded border border-slate-300"
                          value={targetEventId}
                          onChange={(e) => {
                            setTargetEventId(e.target.value);
                            setSelectedUserIds([]);
                          }}
                        >
                          <option value="">Select Target Event...</option>
                          {events.map((ev) => (
                            <option key={ev.id} value={ev.id}>
                              {ev.name}
                            </option>
                          ))}
                        </select>
                        <button
                          onClick={addUsersToEvent}
                          className="bg-green-500 hover:bg-green-600 px-4 py-1.5 rounded font-bold text-sm transition"
                        >
                          Add to Event
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* TABLE ERRORS WARNING */}
                {tableErrors.length > 0 && (
                  <div className="mb-6 bg-red-50 border border-red-200 p-4 rounded-xl shadow-sm">
                    <div className="flex items-center gap-2 mb-2">
                      <AlertCircle className="text-red-600" size={20} />
                      <h3 className="text-red-800 font-bold text-lg">
                        Table Assignment Errors
                      </h3>
                    </div>
                    <ul className="list-disc list-inside pl-2 text-red-600 text-sm font-medium space-y-1">
                      {tableErrors.map((err, i) => (
                        <li key={i}>{err}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* STATISTICS SUMMARY BAR */}
                <div className="flex flex-wrap gap-4 mb-4">
                  {/* OVERALL TOTALS */}
                  <div className="bg-white px-6 py-3 rounded-xl border border-slate-200 shadow-sm flex items-center gap-6">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                      {activeTab === "master" ? "Total List" : "Event Total"}
                    </span>
                    <div className="flex gap-4 text-sm font-bold">
                      <span className="text-blue-600">
                        Boys: {stats.overall.boys}
                      </span>
                      <span className="text-pink-600">
                        Girls: {stats.overall.girls}
                      </span>
                      <span className="text-slate-600">
                        Ratio: {stats.overall.ratio.b}% /{" "}
                        {stats.overall.ratio.g}%
                      </span>
                    </div>
                  </div>

                  {/* GROUP BREAKDOWN (Only shows on Events tab) */}
                  {activeTab === "events" &&
                    Object.entries(stats.groupStats).map(
                      ([groupId, groupData]) => (
                        <div
                          key={groupId}
                          className="bg-transparent px-4 py-3 rounded-xl border border-slate-200 flex items-center gap-4"
                        >
                          <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
                            Group {groupId}
                          </span>
                          <div className="flex gap-3 text-xs font-bold">
                            <span className="text-blue-600">
                              B: {groupData.boys}
                            </span>
                            <span className="text-pink-600">
                              G: {groupData.girls}
                            </span>
                            <span className="text-slate-400">
                              {groupData.ratio.b}% / {groupData.ratio.g}%
                            </span>
                          </div>
                        </div>
                      ),
                    )}
                </div>

                {/* TABLE SECTION */}
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                  <div className="overflow-x-auto">
                    {(() => {
                      // 1. WE LIFTED THIS FILTER LOGIC UP so the "Select All" header can access it!
                      const listToDisplay = (
                        activeTab === "master"
                          ? filteredMasterList
                          : filteredAttendees
                      ).filter((user) => {
                        if (
                          activeTab === "events" &&
                          filters.status !== "all"
                        ) {
                          if (user.status !== filters.status) return false;
                        }
                        if (!filters.startDate && !filters.endDate) return true;

                        const signupDate = user.createdAt?.toDate
                          ? user.createdAt.toDate()
                          : new Date(user.createdAt);
                        const start = filters.startDate
                          ? new Date(filters.startDate)
                          : null;
                        const end = filters.endDate
                          ? new Date(filters.endDate)
                          : null;

                        if (start && signupDate < start) return false;
                        if (end) {
                          const adjustedEnd = new Date(end);
                          adjustedEnd.setHours(23, 59, 59);
                          if (signupDate > adjustedEnd) return false;
                        }
                        return true;
                      });

                      return (
                        <table className="w-full text-left text-sm min-w-450">
                          <thead className="bg-transparent border-b border-slate-200 text-slate-500 font-bold uppercase text-[10px] tracking-widest">
                            <tr>
                              {/* CHECKBOX HEADER: Now visible on both tabs */}
                              <th className="px-6 py-4">
                                Select all&nbsp;
                                <input
                                  type="checkbox"
                                  disabled={
                                    listToDisplay.length === 0 ||
                                    (activeTab === "master" && !targetEventId)
                                  }
                                  checked={
                                    listToDisplay.length > 0 &&
                                    listToDisplay
                                      .filter((u) => {
                                        if (activeTab === "master") {
                                          return !allRegistrations.some(
                                            (r) =>
                                              r.userId === u.id &&
                                              r.eventId === targetEventId,
                                          );
                                        }
                                        return true; // For events tab, everyone is eligible
                                      })
                                      .every((u) =>
                                        selectedUserIds.includes(
                                          activeTab === "master"
                                            ? u.id
                                            : u.userId,
                                        ),
                                      )
                                  }
                                  onChange={(e) => {
                                    const eligibleIds = listToDisplay
                                      .filter((u) => {
                                        if (activeTab === "master") {
                                          return !allRegistrations.some(
                                            (r) =>
                                              r.userId === u.id &&
                                              r.eventId === targetEventId,
                                          );
                                        }
                                        return true;
                                      })
                                      .map((u) =>
                                        activeTab === "master"
                                          ? u.id
                                          : u.userId,
                                      );

                                    if (e.target.checked) {
                                      setSelectedUserIds((prev) => [
                                        ...new Set([...prev, ...eligibleIds]),
                                      ]);
                                    } else {
                                      setSelectedUserIds((prev) =>
                                        prev.filter(
                                          (id) => !eligibleIds.includes(id),
                                        ),
                                      );
                                    }
                                  }}
                                />
                              </th>
                              <th className="px-6 py-4 sticky left-0 bg-transparent z-20">
                                Name / Age
                              </th>
                              <th className="px-6 py-4">Hashgafa</th>
                              {activeTab === "master" && (
                                <th className="px-6 py-4">Signup Date</th>
                              )}
                              {activeTab === "master" && (
                                <th className="px-6 py-4">
                                  Event Registration
                                </th>
                              )}
                              {activeTab === "master" && (
                                <th className="px-6 py-4">Event History</th>
                              )}
                              {activeTab === "events" && (
                                <th className="px-6 py-4">
                                  Confirmation Status
                                </th>
                              )}
                              {activeTab === "events" && (
                                <th className="px-6 py-4">Check-In</th>
                              )}
                              {activeTab === "events" && (
                                <th className="px-6 py-4">Group Assignment</th>
                              )}
                              <th className="px-6 py-4">Gender</th>
                              {activeTab === "events" && (
                                <th className="px-6 py-4">Event Label</th>
                              )}
                              {activeTab === "events" && (
                                <th className="px-6 py-4">Table Number</th>
                              )}
                              <th className="px-6 py-4">Ethnicity</th>
                              <th className="px-6 py-4">Other Background</th>
                              <th className="px-6 py-4">Marital Status</th>
                              <th className="px-6 py-4">Kohen</th>
                              <th className="px-6 py-4">Shomer Shabbat</th>
                              <th className="px-6 py-4">Shomer Kashrut</th>
                              <th className="px-6 py-4">
                                Wants covered head (Male)
                              </th>
                              <th className="px-6 py-4">
                                Wants to cover head (Female)
                              </th>
                              <th className="px-6 py-4">
                                Dress Style (Female)
                              </th>
                              <th className="px-6 py-4">Anything else</th>
                              <th className="px-6 py-4 text-right sticky right-0 bg-transparent">
                                Actions
                              </th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {(() => {
                              // Apply multi-level sorting (Group -> Gender -> Age)
                              const sortedList = [...listToDisplay].sort(
                                (a, b) => {
                                  // 1. Sort by Group ID First
                                  const groupA = (
                                    a.groupId || "Unassigned"
                                  ).toString();
                                  const groupB = (
                                    b.groupId || "Unassigned"
                                  ).toString();

                                  if (groupA !== groupB) {
                                    return groupA.localeCompare(
                                      groupB,
                                      undefined,
                                      {
                                        numeric: true,
                                        sensitivity: "base",
                                      },
                                    );
                                  }

                                  // 2. Sort by Gender (Male/Boys first within the group)
                                  const genderA = (
                                    a.gender || ""
                                  ).toLowerCase();
                                  const genderB = (
                                    b.gender || ""
                                  ).toLowerCase();

                                  if (genderA !== genderB) {
                                    const isAMale =
                                      genderA === "male" ||
                                      genderA === "man" ||
                                      genderA === "boy";
                                    const isBMale =
                                      genderB === "male" ||
                                      genderB === "man" ||
                                      genderB === "boy";

                                    if (isAMale && !isBMale) return -1;
                                    if (!isAMale && isBMale) return 1;
                                  }

                                  // 3. Sort by Age (Youngest to Oldest within the gender block)
                                  const ageA = parseInt(a.age) || 999;
                                  const ageB = parseInt(b.age) || 999;

                                  if (ageA !== ageB) {
                                    return ageA - ageB;
                                  }

                                  // 4. Stable fallback to First Name
                                  return (a.firstName || "").localeCompare(
                                    b.firstName || "",
                                  );
                                },
                              );

                              return sortedList.map((a, index) => {
                                const hashgafa = getHashgafaGroup(a);
                                const isAlreadyInEvent = allRegistrations.some(
                                  (reg) =>
                                    reg.userId === a.id &&
                                    reg.eventId === targetEventId,
                                );

                                let isNewGroup = false;
                                if (activeTab === "events" && index > 0) {
                                  isNewGroup =
                                    a.groupId !== sortedList[index - 1].groupId;
                                }

                                return (
                                  <tr
                                    key={a.id}
                                    className={`border-b transition-colors ${
                                      isNewGroup && activeTab === "events"
                                        ? "border-t-4 border-t-slate-300"
                                        : ""
                                    } ${
                                      isAlreadyInEvent
                                        ? "bg-slate-200/70"
                                        : "hover:bg-[#95B699]/30"
                                    }`}
                                  >
                                    {/* ROW CHECKBOX: Now visible on both tabs */}
                                    <td className="px-6 py-4">
                                      <div className="flex flex-col gap-1">
                                        <input
                                          type="checkbox"
                                          checked={selectedUserIds.includes(
                                            activeTab === "master"
                                              ? a.id
                                              : a.userId,
                                          )}
                                          disabled={
                                            activeTab === "master" &&
                                            (isAlreadyInEvent || !targetEventId)
                                          }
                                          className={`${
                                            activeTab === "master" &&
                                            isAlreadyInEvent
                                              ? "cursor-not-allowed"
                                              : "cursor-pointer"
                                          }`}
                                          onChange={() => {
                                            const uid =
                                              activeTab === "master"
                                                ? a.id
                                                : a.userId;
                                            setSelectedUserIds((prev) =>
                                              prev.includes(uid)
                                                ? prev.filter(
                                                    (id) => id !== uid,
                                                  )
                                                : [...prev, uid],
                                            );
                                          }}
                                        />
                                        {activeTab === "master" &&
                                          isAlreadyInEvent && (
                                            <span className="text-[9px] font-bold text-slate-400 uppercase leading-tight">
                                              Added
                                            </span>
                                          )}
                                      </div>
                                    </td>

                                    {/* Permanent Name Column */}
                                    <td
                                      className={`px-6 py-4 sticky left-0 z-10 border-r border-slate-100 ${isAlreadyInEvent ? "bg-slate-200/70" : "hover:bg-[#95B699]/30"}`}
                                    >
                                      <p className="font-bold text-slate-900">
                                        {a.firstName} {a.lastName}
                                      </p>
                                      <p className="text-xs text-slate-400">
                                        {a.age}y • {a.gender}
                                      </p>
                                    </td>

                                    {/* Hashgafa Group */}
                                    <td className="px-6 py-4">
                                      <span
                                        className={`px-3 py-1 rounded-md text-[10px] font-bold border ${hashgafa.color} ${hashgafa.border}`}
                                      >
                                        {hashgafa.label.toUpperCase()}
                                      </span>
                                    </td>

                                    {/* Signup Date */}
                                    {activeTab === "master" && (
                                      <td className="px-6 py-4 text-slate-500">
                                        {a.createdAt
                                          ?.toDate()
                                          .toLocaleString() || "-"}
                                      </td>
                                    )}

                                    {/* Event Registration (Events this user has signed up for but not necessarily attended) */}
                                    {activeTab === "master" && (
                                      <td className="px-6 py-4 text-slate-500 text-xs italic">
                                        {getUserHistory(a.id).join(", ") || "-"}
                                      </td>
                                    )}

                                    {/* Event History (Events this user has attended) */}
                                    {activeTab === "master" && (
                                      <td className="px-6 py-4 text-slate-500 text-xs italic">
                                        {getUserAttendedHistory(a.id).join(
                                          ", ",
                                        ) || "-"}
                                      </td>
                                    )}

                                    {/* Confirmation Status */}
                                    {activeTab === "events" && (
                                      <td className="px-6 py-4">
                                        <select
                                          value={a.status}
                                          onChange={(e) =>
                                            updateAttendeeField(
                                              a,
                                              "status",
                                              e.target.value,
                                            )
                                          }
                                          className={`text-xs font-bold px-2 py-1 rounded border transition-all duration-200 ${
                                            a.status === "confirmed"
                                              ? "bg-green-100 text-green-900 border-green-300"
                                              : a.status === "declined"
                                                ? "bg-red-100 text-red-900 border-red-300"
                                                : "bg-white text-[#1E3D34] border-gray-300"
                                          }`}
                                        >
                                          <option value="pending invite">
                                            Pending Invite
                                          </option>
                                          <option value="waitlist">
                                            Waitlist
                                          </option>
                                          <option value="invited">
                                            Invited
                                          </option>
                                          <option value="confirmed">
                                            Confirmed
                                          </option>
                                          <option value="declined">
                                            Declined
                                          </option>
                                          <option value="attended">
                                            Attended
                                          </option>
                                          <option value="no response">
                                            No Response
                                          </option>
                                        </select>
                                        {a.status === "pending invite" && (
                                          <button
                                            onClick={() => sendInvite(a)}
                                            className="ml-2 text-xs text-blue-600 hover:underline"
                                          >
                                            Invite
                                          </button>
                                        )}
                                        {a.status === "confirmed" && (
                                          <button
                                            onClick={() => {
                                              const alreadySent =
                                                sentEventDetails.includes(
                                                  a.userId,
                                                );
                                              const msg = alreadySent
                                                ? `Event details were already sent to ${a.firstName} ${a.lastName}. Send again?`
                                                : `Send event details to ${a.firstName} ${a.lastName}?`;

                                              if (window.confirm(msg)) {
                                                sendIndividualReminder(
                                                  a,
                                                  selectedEvent,
                                                );
                                              }
                                            }}
                                            className={`ml-2 text-xs font-medium transition-colors ${
                                              sentEventDetails.includes(
                                                a.userId,
                                              )
                                                ? "text-green-600 hover:text-green-700"
                                                : "text-blue-600 hover:text-blue-800 hover:underline"
                                            }`}
                                          >
                                            {sentEventDetails.includes(a.userId)
                                              ? "✓ Event details email sent"
                                              : "Event Details"}
                                          </button>
                                        )}

                                        {/* Repeat similar logic for Final Reminder button */}
                                        {a.status !== "confirmed" && (
                                          <button
                                            onClick={() => {
                                              const alreadySent =
                                                sentReminders.includes(
                                                  a.userId,
                                                );
                                              const msg = alreadySent
                                                ? `Final reminder was already sent to ${a.firstName} ${a.lastName}. Send again?`
                                                : `Send manual reminder to ${a.firstName} ${a.lastName}?`;

                                              if (window.confirm(msg)) {
                                                sendFinalReminder(
                                                  a,
                                                  selectedEvent,
                                                );
                                              }
                                            }}
                                            className={`ml-2 text-xs transition-colors ${
                                              sentReminders.includes(a.userId)
                                                ? "text-green-600 hover:text-green-700"
                                                : "text-blue-600 hover:underline"
                                            }`}
                                          >
                                            {sentReminders.includes(a.userId)
                                              ? "✓ Reminder email sent"
                                              : "Remind [Final]"}
                                          </button>
                                        )}
                                      </td>
                                    )}

                                    {/* Check-In */}
                                    {activeTab === "events" && (
                                      <td className="px-6 py-4">
                                        <button
                                          onClick={() =>
                                            toggleCheckIn(a.id, a.checkedIn)
                                          }
                                          className={`flex items-center gap-2 px-3 py-1 rounded-full font-black text-[10px] ${
                                            a.checkedIn
                                              ? "bg-green-100 text-green-700"
                                              : "bg-yellow-100 text-yellow-800"
                                          }`}
                                        >
                                          {a.checkedIn
                                            ? "CHECKED IN"
                                            : "PENDING"}
                                        </button>
                                      </td>
                                    )}

                                    {/* Group Assignment */}
                                    {activeTab === "events" && (
                                      <td className="px-6 py-4">
                                        <select
                                          value={a.groupId || ""}
                                          onChange={(e) =>
                                            updateAttendeeField(
                                              a,
                                              "groupId",
                                              e.target.value,
                                            )
                                          }
                                          className="text-xs font-bold text-[#1E3D34] bg-white border border-slate-200 rounded p-1 outline-none focus:ring-2 focus:ring-blue-500"
                                        >
                                          <option value="">Unassigned</option>
                                          {(
                                            selectedEvent?.eventGroups || []
                                          ).map((group) => (
                                            <option
                                              key={group.name}
                                              value={group.name}
                                            >
                                              {group.name}
                                            </option>
                                          ))}
                                        </select>
                                      </td>
                                    )}

                                    {/* Gender */}
                                    <td className="px-6 py-4">
                                      <select
                                        value={a.gender}
                                        onChange={(e) =>
                                          updateAttendeeField(
                                            a,
                                            "gender",
                                            e.target.value,
                                          )
                                        }
                                        className={`bg-transparent font-semibold outline-none ${
                                          a.gender === "woman"
                                            ? "text-pink-600"
                                            : "text-blue-600"
                                        }`}
                                      >
                                        <option value="man">Man</option>
                                        <option value="woman">Woman</option>
                                      </select>
                                    </td>

                                    {/* Event Label */}
                                    {activeTab === "events" && (
                                      <td className="px-6 py-4 text-[11px]">
                                        <textarea
                                          className="bg-transparent border border-slate-100 rounded p-1 w-auto h-auto leading-tight outline-none focus:bg-white"
                                          value={a.eventLabel || ""}
                                          onChange={(e) =>
                                            updateAttendeeField(
                                              a,
                                              "eventLabel",
                                              e.target.value,
                                            )
                                          }
                                        />
                                      </td>
                                    )}

                                    {/* Table Number & Group Name */}
                                    {activeTab === "events" && (
                                      <td className="px-6 py-4">
                                        <div className="flex items-center gap-2">
                                          Table
                                          <input
                                            type="number"
                                            placeholder="#"
                                            className="bg-transparent border border-slate-100 rounded p-1 w-12 text-[11px] outline-none focus:bg-white"
                                            value={a.tableNumber || 0}
                                            onChange={(e) => {
                                              const newNum = e.target.value;
                                              updateAttendeeField(
                                                a,
                                                "tableNumber",
                                                parseInt(newNum) || 0,
                                              );
                                            }}
                                          />
                                          <span className="text-slate-400 text-[10px]">
                                            -
                                          </span>
                                          <input
                                            type="text"
                                            placeholder="Group Name"
                                            className="bg-transparent border border-slate-100 rounded p-1 w-24 text-[11px] outline-none focus:bg-white"
                                            value={a.groupId || ""}
                                            onChange={(e) => {
                                              const newGroupName =
                                                e.target.value;
                                              updateAttendeeField(
                                                a,
                                                "groupId",
                                                newGroupName,
                                              );
                                            }}
                                          />
                                        </div>
                                      </td>
                                    )}

                                    {/* Ethnicity Table Cell */}
                                    <td className="px-6 py-4 text-xs text-slate-600">
                                      <input
                                        type="text"
                                        className="bg-transparent hover:bg-slate-100 border-none outline-none w-full min-w-25 focus:ring-1 focus:ring-blue-400 rounded p-1 transition-all"
                                        value={a.ethnicity || ""}
                                        onChange={(e) =>
                                          updateAttendeeField(
                                            a,
                                            "ethnicity",
                                            e.target.value,
                                          )
                                        }
                                      />
                                    </td>

                                    {/* Other background */}
                                    <td className="px-6 py-4 text-slate-400 italic text-[11px]">
                                      <textarea
                                        className="bg-transparent border border-slate-100 rounded p-1 w-40 h-10 leading-tight outline-none focus:bg-white"
                                        value={a.otherSpecify}
                                        onChange={(e) =>
                                          updateAttendeeField(
                                            a,
                                            "otherSpecify",
                                            e.target.value,
                                          )
                                        }
                                      />
                                    </td>

                                    {/* Marital Status */}
                                    <td className="px-6 py-4 text-slate-500">
                                      <select
                                        className="bg-transparent outline-none"
                                        value={a.maritalStatus}
                                        onChange={(e) =>
                                          updateAttendeeField(
                                            a,
                                            "maritalStatus",
                                            e.target.value,
                                          )
                                        }
                                      >
                                        <option value="Single">Single</option>
                                        <option value="Divorced">
                                          Divorced
                                        </option>
                                        <option value="Widowed">Widowed</option>
                                      </select>
                                    </td>

                                    {/* Kohen */}
                                    <td className="px-6 py-4 text-slate-500 text-center">
                                      <input
                                        type="checkbox"
                                        checked={
                                          a.isKohen === "yes" ||
                                          a.isKohen === true
                                        }
                                        onChange={(e) =>
                                          updateAttendeeField(
                                            a,
                                            "isKohen",
                                            e.target.checked ? "yes" : "no",
                                          )
                                        }
                                      />
                                    </td>

                                    {/* Shomer Shabbat */}
                                    <td className="px-6 py-4 text-slate-500 text-center">
                                      <input
                                        type="checkbox"
                                        checked={
                                          a.isShomerShabbat === "yes" ||
                                          a.isShomerShabbat === true
                                        }
                                        onChange={(e) =>
                                          updateAttendeeField(
                                            a,
                                            "isShomerShabbat",
                                            e.target.checked ? "yes" : "no",
                                          )
                                        }
                                      />
                                    </td>

                                    {/* Shomer Kashrut */}
                                    <td className="px-6 py-4 text-slate-500 text-center">
                                      <input
                                        type="checkbox"
                                        checked={
                                          a.isShomerKashrut === "yes" ||
                                          a.isShomerKashrut === true
                                        }
                                        onChange={(e) =>
                                          updateAttendeeField(
                                            a,
                                            "isShomerKashrut",
                                            e.target.checked ? "yes" : "no",
                                          )
                                        }
                                      />
                                    </td>

                                    {/* Wants Girl to cover her hair */}
                                    <td className="px-6 py-4 text-slate-500">
                                      <select
                                        className="bg-transparent outline-none"
                                        value={a.wantsCoveredHead}
                                        onChange={(e) =>
                                          updateAttendeeField(
                                            a,
                                            "wantsCoveredHead",
                                            e.target.value,
                                          )
                                        }
                                      >
                                        <option value="N/A">
                                          Not applicable
                                        </option>
                                        <option value="yes">Yes</option>
                                        <option value="no">No</option>
                                        <option value="noPreference">
                                          No preference
                                        </option>
                                      </select>
                                    </td>

                                    {/* Girl to cover her hair */}
                                    <td className="px-6 py-4 text-slate-500">
                                      <select
                                        className="bg-transparent outline-none"
                                        value={a.hairCovering}
                                        onChange={(e) =>
                                          updateAttendeeField(
                                            a,
                                            "hairCovering",
                                            e.target.value,
                                          )
                                        }
                                      >
                                        <option value="N/A">
                                          Not applicable
                                        </option>
                                        <option value="willCoverHair">
                                          Will cover hair
                                        </option>
                                        <option value="openFlexible">
                                          Open / Flexible
                                        </option>
                                        <option value="notPlanning">
                                          Not planning to cover hair
                                        </option>
                                      </select>
                                    </td>

                                    {/* Dress Style */}
                                    <td className="px-6 py-4 text-slate-500">
                                      <select
                                        className="bg-transparent outline-none"
                                        value={a.dressStyle}
                                        onChange={(e) =>
                                          updateAttendeeField(
                                            a,
                                            "dressStyle",
                                            e.target.value,
                                          )
                                        }
                                      >
                                        <option value="N/A">
                                          Not applicable
                                        </option>
                                        <option value="skirtsOnly">
                                          Skirts only
                                        </option>
                                        <option value="skirtsPants">
                                          Skirts + pants
                                        </option>
                                      </select>
                                    </td>

                                    {/* Anything Else */}
                                    <td className="px-6 py-4 text-slate-400 italic text-[11px]">
                                      <textarea
                                        className="bg-transparent border border-slate-100 rounded p-1 w-40 h-10 leading-tight outline-none focus:bg-white"
                                        defaultValue={a.anythingElse}
                                        onBlur={(e) =>
                                          updateAttendeeField(
                                            a,
                                            "anythingElse",
                                            e.target.value.map((s) => s.trim()),
                                          )
                                        }
                                      />
                                    </td>

                                    {/* Actions */}
                                    <td
                                      className={`px-6 py-4 text-right sticky right-0 ${
                                        isAlreadyInEvent
                                          ? "bg-slate-200/70"
                                          : "hover:bg-[#95B699]/30"
                                      }`}
                                    >
                                      <button
                                        onClick={() =>
                                          activeTab === "master"
                                            ? deleteUserFromMaster(
                                                a.id,
                                                a.firstName + " " + a.lastName,
                                              )
                                            : deleteAttendee(
                                                a.id,
                                                a.firstName + " " + a.lastName,
                                              )
                                        }
                                        className="p-2 text-slate-300 hover:text-red-500 transition-all"
                                      >
                                        <UserMinus size={18} />
                                      </button>
                                    </td>
                                  </tr>
                                );
                              });
                            })()}
                          </tbody>
                        </table>
                      );
                    })()}
                  </div>
                  {attendees.length === 0 && (
                    <div className="p-20 text-center text-slate-400 italic">
                      No registrations yet.
                    </div>
                  )}
                </div>
              </div>
            ) : (
              /* EMPTY STATE: Show this when no event is selected and NOT on master tab */
              <div className="h-full flex flex-col items-center justify-center text-slate-400">
                <div className="bg-white p-8 rounded-2xl border-2 border-dashed border-slate-200 text-center">
                  <p className="text-lg font-medium">
                    Select an event from the sidebar
                  </p>
                  <p className="text-sm">
                    Or click "Master Singles List" to see everyone.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* --- EMAIL MODAL UI --- */}
      {showEmailModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            {/* Header */}
            <div className="bg-slate-50 border-b border-slate-200 p-6 flex justify-between items-center">
              <div>
                <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                  <Mail className="text-blue-600" /> Send Custom Email
                </h2>
                <p className="text-xs text-slate-500 mt-1 font-medium">
                  {selectedEvent?.name}
                </p>
              </div>
              <button
                onClick={() => setShowEmailModal(false)}
                className="text-slate-400 hover:text-slate-700 transition-colors bg-white p-2 rounded-full border border-slate-200 shadow-sm"
              >
                <X size={20} />
              </button>
            </div>

            {/* Form Body */}
            <div className="p-6 space-y-5">
              {/* --- NEW SCROLLING CHECKBOX LIST --- */}
              <div>
                <label className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2 block">
                  Select Recipients
                </label>

                {(() => {
                  // Get all users associated with this event's registrations
                  const availableRecipients = attendees
                    .map((reg) => masterUsers.find((u) => u.id === reg.userId))
                    .filter(Boolean); // Remove nulls

                  const allSelected =
                    availableRecipients.length > 0 &&
                    emailData.recipients.length === availableRecipients.length;

                  const handleToggleAll = () => {
                    if (allSelected) {
                      setEmailData({ ...emailData, recipients: [] }); // Deselect all
                    } else {
                      setEmailData({
                        ...emailData,
                        recipients: availableRecipients.map((u) => u.id),
                      }); // Select all
                    }
                  };

                  const handleToggleRecipient = (userId) => {
                    if (emailData.recipients.includes(userId)) {
                      setEmailData({
                        ...emailData,
                        recipients: emailData.recipients.filter(
                          (id) => id !== userId,
                        ),
                      });
                    } else {
                      setEmailData({
                        ...emailData,
                        recipients: [...emailData.recipients, userId],
                      });
                    }
                  };

                  return (
                    <div className="border border-slate-200 rounded-xl overflow-hidden bg-white">
                      {/* Select All Bar */}
                      <div className="bg-slate-50 border-b border-slate-200 p-3 px-4 flex items-center gap-3">
                        <input
                          type="checkbox"
                          checked={allSelected}
                          onChange={handleToggleAll}
                          className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500 cursor-pointer"
                        />
                        <span className="text-sm font-bold text-slate-700">
                          Select All ({availableRecipients.length} people)
                        </span>
                      </div>

                      {/* Scrollable List */}
                      <div className="max-h-48 overflow-y-auto p-2 space-y-1">
                        {availableRecipients.map((user) => {
                          const isChecked = emailData.recipients.includes(
                            user.id,
                          );
                          const registration = attendees.find(
                            (r) => r.userId === user.id,
                          );

                          return (
                            <label
                              key={user.id}
                              className={`flex items-center gap-3 p-2 rounded-lg cursor-pointer transition-colors ${
                                isChecked ? "bg-blue-50" : "hover:bg-slate-50"
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => handleToggleRecipient(user.id)}
                                className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500 cursor-pointer"
                              />
                              <div className="flex flex-col">
                                <span className="text-sm font-bold text-slate-800 flex items-center gap-2">
                                  {user.firstName} {user.lastName}
                                  {registration?.checkedIn ? (
                                    <span className="px-1.5 py-0.5 rounded-sm bg-green-100 text-green-700 text-[9px] uppercase tracking-wider font-bold">
                                      Checked In
                                    </span>
                                  ) : (
                                    <span className="px-1.5 py-0.5 rounded-sm bg-slate-100 text-slate-500 text-[9px] uppercase tracking-wider font-bold">
                                      Not Checked In
                                    </span>
                                  )}
                                </span>
                                <span className="text-xs text-slate-500">
                                  {user.email || "No email provided"}
                                </span>
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}
              </div>

              <div>
                <label className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2 block">
                  Subject
                </label>
                <input
                  type="text"
                  placeholder="e.g., Important update about tonight's event!"
                  value={emailData.subject}
                  onChange={(e) =>
                    setEmailData({ ...emailData, subject: e.target.value })
                  }
                  className="w-full p-3 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-slate-900 font-medium"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2 block">
                  Message
                </label>
                <textarea
                  rows={6}
                  placeholder="Type your message here..."
                  value={emailData.body}
                  onChange={(e) =>
                    setEmailData({ ...emailData, body: e.target.value })
                  }
                  className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-slate-900 resize-none"
                />
              </div>
            </div>

            {/* Footer Actions */}
            <div className="bg-slate-50 border-t border-slate-200 p-6 flex justify-end gap-3">
              <button
                onClick={() => setShowEmailModal(false)}
                className="px-6 py-3 font-bold text-slate-500 hover:bg-slate-200 rounded-xl transition-colors"
                disabled={isSendingEmail}
              >
                Cancel
              </button>
              <button
                onClick={handleSendEmail}
                disabled={isSendingEmail || emailData.recipients.length === 0}
                className="px-8 py-3 bg-blue-600 text-white font-bold rounded-xl shadow-lg shadow-blue-200 hover:bg-blue-700 active:scale-95 transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSendingEmail
                  ? "Queueing..."
                  : `Send to ${emailData.recipients.length}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
