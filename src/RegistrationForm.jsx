import { useState, useEffect } from "react";
import { db } from "./firebase";
import {
  collection,
  addDoc,
  getDocs,
  query,
  where,
  doc,
  getDoc,
  updateDoc,
} from "firebase/firestore";
import { useSearchParams } from "react-router-dom";

const SEPHARDIC_LIST = [
  "Syrian",
  "Egyptian",
  "Lebanese",
  "Persian",
  "Moroccan",
  "Israeli",
];
const MARITAL_STATUSES = ["Single", "Divorced", "Widowed"];

export default function RegistrationForm() {
  const [searchParams] = useSearchParams();
  const urlEventId = searchParams.get("eventId"); // Get ?eventId=XYZ from URL

  const [events, setEvents] = useState([]);
  const [selectedEventName, setSelectedEventName] = useState(""); // To show name if ID is hidden
  const [loading, setLoading] = useState(false);

  const [formData, setFormData] = useState({
    eventId: urlEventId || "",
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    gender: "",
    birthDate: "",
    ethnicity: [],
    otherSpecify: "",
    isKohen: "no",
    isShomerShabbat: "yes",
    isShomerKashrut: "yes",
    wantsCoveredHead: "N/A",
    hairCovering: "N/A",
    dressStyle: "N/A",
    maritalStatus: "",
    anythingElse: "",
  });

  // Fetch events or specific event name
  useEffect(() => {
    const fetchEventData = async () => {
      if (urlEventId) {
        // If we have an ID, just get that one event's name for the header
        const docRef = doc(db, "events", urlEventId);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          setSelectedEventName(docSnap.data().name);
        }
      } else {
        // Otherwise, fetch all events for the dropdown. They should be inactive.
        const q = query(collection(db, "events"), where("active", "==", false));
        const snap = await getDocs(q);
        setEvents(snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
      }
    };
    fetchEventData();
  }, [urlEventId]);

  const calculateAge = (dateString) => {
    const today = new Date();
    const birthDate = new Date(dateString);
    let age = today.getFullYear() - birthDate.getFullYear();
    const m = today.getMonth() - birthDate.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) age--;
    return age;
  };

  // Helper to check for exact match in your comma-separated string
  const isSelected = (val) => {
    if (!formData.ethnicity) return false;
    return formData.ethnicity.includes(val);
  };

  const handleCheckbox = (list, value, field) => {
    const current = [...list];
    const index = current.indexOf(value);
    if (index > -1) current.splice(index, 1);
    else current.push(value);
    setFormData({ ...formData, [field]: current });
  };

  const handleEthnicityToggle = (val) => {
    const isAlreadySelected = formData.ethnicity.includes(val);

    // 1. If we are ADDING an option (any option), check the TOTAL limit
    if (!isAlreadySelected) {
      if (formData.ethnicity.length >= 2) {
        alert("You can only select a maximum of 2 backgrounds total.");
        return; // Exit early so no state update happens
      }
    }

    // 2. If removing OR if we haven't hit the limit yet, update state
    setFormData((prev) => {
      const current = [...prev.ethnicity];
      const index = current.indexOf(val);

      if (index > -1) {
        current.splice(index, 1);
      } else {
        current.push(val);
      }

      return { ...prev, ethnicity: current };
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.eventId) return alert("Please select an event");
    setLoading(true);

    try {
      // 1. Split the data
      const { eventId, ...userProfile } = formData;
      userProfile.ethnicity = userProfile.ethnicity.join(", "); // Convert array to string for storage
      const userAge = calculateAge(formData.birthDate);

      // 2. Find or Create the permanent User based on Email
      // (You could also use Phone number as the unique key)
      const userQuery = query(
        collection(db, "users"),
        where("email", "==", formData.email.toLowerCase().trim()),
      );
      const userSnap = await getDocs(userQuery);

      let internalUserId;

      if (!userSnap.empty) {
        // Existing User: Update their profile with latest info
        internalUserId = userSnap.docs[0].id;
        await updateDoc(doc(db, "users", internalUserId), {
          ...userProfile,
          age: userAge,
          createdAt: new Date(),
        });
      } else {
        // New User: Create permanent profile
        const newUserRef = await addDoc(collection(db, "users"), {
          ...userProfile,
          age: userAge,
          createdAt: new Date(),
        });
        internalUserId = newUserRef.id;
      }

      if (!eventId) {
        setLoading(false);
        return;
      }

      // 3. Check if they are already registered for THIS specific event
      const regCheckQuery = query(
        collection(db, "registrations"),
        where("eventId", "==", eventId),
        where("userId", "==", internalUserId),
      );
      const regCheckSnap = await getDocs(regCheckQuery);

      if (!regCheckSnap.empty) {
        alert("You are already registered for this event!");
        setLoading(false);
        return;
      }

      // 4. Create the Event Registration
      await addDoc(collection(db, "registrations"), {
        userId: internalUserId,
        eventId: eventId,
        checkedIn: false,
        tableNumber: null,
        status: "pending invite", // other e.g., invited, confirmed, declined, waitlist, no response (3 days after invite)
        groupId: "Group 1", // Default group assignment
        timestamp: new Date(),
        // We store a few redundant fields for quick filtering in Admin without extra joins
        gender: formData.gender,
        firstName: formData.firstName,
        lastName: formData.lastName,
      });

      // 5. Trigger the Email via the 'email' collection
      // Find the name dynamically to ensure it isn't stale
      const eventNameForEmail = urlEventId
        ? selectedEventName
        : events.find((e) => e.id === eventId)?.name;

      await addDoc(collection(db, "email"), {
        to: formData.email.toLowerCase().trim(),
        message: {
          subject: `Registration Received: ${eventNameForEmail || "Upcoming Event"}`,
          html: `
      <div style="font-family: sans-serif; color: #334155;">
        <h1 style="color: #0f172a;">Hi ${formData.firstName}!</h1>
        <p>Thanks for registering for <b>${eventNameForEmail || "our upcoming event"}</b>.</p>
        <p>Status: <b>Pending Invite</b></p>
        <p>Please keep an eye out for an invitation to the event. You will have three days to accept the invitation.</p>
        <p>Looking forward to seeing you there!</p>
      </div>
    `,
        },
      });

      alert("Registration successful!");
      window.location.reload();
    } catch (err) {
      console.error("Registration Error:", err);
      alert("Error saving registration.");
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-white py-12 px-4">
      <div className="max-w-xl mx-auto">
        <h2 className="text-3xl font-bold text-slate-800 mb-8 text-center">
          Event Registration
        </h2>

        {/* Conditional UI: Show name if ID is in URL, otherwise show nothing */}
        {urlEventId ? (
          <p className="text-center text-blue-600 font-medium mb-8">
            Registering for: {selectedEventName || "Loading event..."}
          </p>
        ) : (
          <div className="mb-8">
            <label className="block font-semibold mb-2 text-center text-slate-600">
              Select Event
            </label>
            <select
              className="w-full p-3 border rounded-lg shadow-sm focus:ring-2 focus:ring-blue-500 outline-none"
              value={formData.eventId}
              onChange={(e) =>
                setFormData({ ...formData, eventId: e.target.value })
              }
            >
              <option value="">-- Choose an Event --</option>
              {events.map((ev) => (
                <option key={ev.id} value={ev.id}>
                  {ev.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Name info */}
          <div className="flex gap-4">
            <div className="flex-1">
              <label className="block text-sm font-medium mb-1">
                First Name
              </label>
              <input
                type="text"
                placeholder="First name"
                required
                className="p-3 border rounded-lg"
                onChange={(e) =>
                  setFormData({ ...formData, firstName: e.target.value })
                }
              />
            </div>
            <div className="flex-1">
              <label className="block text-sm font-medium mb-1">
                Last Name
              </label>
              <input
                type="text"
                placeholder="Last name"
                required
                className="p-3 border rounded-lg"
                onChange={(e) =>
                  setFormData({ ...formData, lastName: e.target.value })
                }
              />
            </div>
          </div>

          {/* Phone and email */}
          <div className="flex gap-4">
            <div className="flex-1">
              <label className="block text-sm font-medium mb-1">
                Cell Phone Number
              </label>
              <input
                type="tel"
                placeholder="Phone number"
                required
                className="p-3 border rounded-lg"
                onChange={(e) =>
                  setFormData({ ...formData, phone: e.target.value })
                }
              />
            </div>
            <div className="flex-1">
              <label className="block text-sm font-medium mb-1">
                Email Address
              </label>
              <input
                type="email"
                placeholder="Email address"
                required
                className="p-3 border rounded-lg"
                onChange={(e) =>
                  setFormData({ ...formData, email: e.target.value })
                }
              />
            </div>
          </div>

          {/* Gender Choice */}
          <div className="flex gap-4">
            <div className="flex-1">
              <label className="block text-sm font-medium mb-1">Gender</label>
              <select
                required
                className="w-full p-3 border rounded-lg"
                onChange={(e) =>
                  setFormData({ ...formData, gender: e.target.value })
                }
              >
                <option value="">Select</option>
                <option value="man">Male</option>
                <option value="woman">Female</option>
              </select>
            </div>
          </div>

          {/* Birth Date Info */}
          <div className="flex gap-4">
            <div className="flex-1">
              <label className="block text-sm font-medium mb-1">
                Date of birth
              </label>
              <input
                type="date"
                required
                className="p-3 border rounded-lg text-gray-500"
                onChange={(e) =>
                  setFormData({ ...formData, birthDate: e.target.value })
                }
              />
            </div>
          </div>

          {/* Current Marital Status */}
          <section>
            <label className="block font-semibold mb-2">Current Status</label>
            <select
              required
              className="w-full p-3 border rounded-lg mb-2"
              onChange={(e) =>
                setFormData({ ...formData, maritalStatus: e.target.value })
              }
            >
              <option value="">Select yours...</option>
              {MARITAL_STATUSES.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </section>

          {/* Background Selection */}
          <section className="space-y-4">
            <label className="block font-bold text-slate-700 mb-2">
              What is your background?{" "}
              <span className="text-xs font-normal text-slate-400">
                (Select up to 2 if applicable)
              </span>
            </label>

            <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
              <p className="text-xs font-black uppercase tracking-widest text-slate-400 mb-4">
                Select up to 2
              </p>

              {/* SEPHARDIC SECTION */}
              <div className="mb-6">
                <p className="text-sm font-bold text-slate-600 mb-3">
                  Sephardic:
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {SEPHARDIC_LIST.map((opt) => (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => handleEthnicityToggle(opt)}
                      className={`px-3 py-2 rounded-xl border-2 text-xs font-bold transition-all ${
                        isSelected(opt)
                          ? "border-pink-500 bg-pink-50 text-pink-600"
                          : "border-white bg-white text-slate-500 shadow-sm hover:border-slate-200"
                      }`}
                    >
                      {opt}
                    </button>
                  ))}
                </div>

                {/* Other Sephardic Button & Input */}
                <div className="mt-2">
                  <button
                    type="button"
                    onClick={() => handleEthnicityToggle("Other Sephardic")}
                    className={`w-full px-3 py-2 rounded-xl border-2 text-xs font-bold transition-all text-left ${
                      isSelected("Other Sephardic")
                        ? "border-pink-500 bg-pink-50 text-pink-600"
                        : "border-white bg-white text-slate-500 shadow-sm hover:border-slate-200"
                    }`}
                  >
                    Other Sephardic {isSelected("Other Sephardic") ? ":" : ""}
                  </button>

                  {isSelected("Other Sephardic") && (
                    <input
                      type="text"
                      placeholder="Specify (e.g. Mixed, Mashadi, Shirazi)..."
                      className="w-full p-3 border rounded-xl mt-2 text-sm bg-white"
                      value={formData.otherSephardicSpecify || ""}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          otherSephardicSpecify: e.target.value,
                        })
                      }
                    />
                  )}
                </div>
              </div>

              {/* SEPARATE LINES SECTION */}
              <div className="space-y-2 border-t border-slate-200 pt-4">
                {/* Ashkenaz */}
                <button
                  type="button"
                  onClick={() => handleEthnicityToggle("Ashkenaz")}
                  className={`w-full px-3 py-2 rounded-xl border-2 text-xs font-bold transition-all text-left ${
                    isSelected("Ashkenaz")
                      ? "border-pink-500 bg-pink-50 text-pink-600"
                      : "border-white bg-white text-slate-500 shadow-sm hover:border-slate-200"
                  }`}
                >
                  Ashkenaz
                </button>

                {/* Other */}
                <button
                  type="button"
                  onClick={() => handleEthnicityToggle("Other")}
                  className={`w-full px-3 py-2 rounded-xl border-2 text-xs font-bold transition-all text-left ${
                    isSelected("Other")
                      ? "border-pink-500 bg-pink-50 text-pink-600"
                      : "border-white bg-white text-slate-500 shadow-sm hover:border-slate-200"
                  }`}
                >
                  Other {isSelected("Other") ? ":" : ""}
                </button>

                {isSelected("Other") && (
                  <input
                    type="text"
                    placeholder="e.g., Chasidish, Chabad, etc."
                    className="w-full p-3 border rounded-xl mt-1 text-sm bg-white"
                    value={formData.otherSpecify || ""}
                    onChange={(e) =>
                      setFormData({ ...formData, otherSpecify: e.target.value })
                    }
                  />
                )}
              </div>
            </div>
          </section>

          {/* Specify for Other option */}
          {formData.ethnicity.includes("Other") && (
            <section>
              <label className="block font-semibold mb-2">
                Please specify your background:
              </label>
              <input
                type="text"
                placeholder="e.g., Chasidish, Chabad, etc."
                className="w-full p-3 border rounded-lg mb-2"
                onChange={(e) =>
                  setFormData({ ...formData, otherSpecify: e.target.value })
                }
              />
            </section>
          )}

          {/* Religious Lifestyle */}
          <section>
            <label className="block font-semibold mb-2">Shabbat level</label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="isShomerShabbat"
                  value="yes"
                  onChange={() =>
                    setFormData({ ...formData, isShomerShabbat: "yes" })
                  }
                />{" "}
                Shomer Shabbat
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="isShomerShabbat"
                  value="no"
                  onChange={() =>
                    setFormData({ ...formData, isShomerShabbat: "no" })
                  }
                />{" "}
                Not fully shomer shabbat / still growing
              </label>
            </div>
          </section>

          {/* Religious Lifestyle 2 */}
          <section>
            <label className="block font-semibold mb-2">Kashrut level</label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="isShomerKashrut"
                  value="yes"
                  onChange={() =>
                    setFormData({ ...formData, isShomerKashrut: "yes" })
                  }
                />{" "}
                Kosher
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="isShomerKashrut"
                  value="no"
                  onChange={() =>
                    setFormData({ ...formData, isShomerKashrut: "no" })
                  }
                />{" "}
                Not fully kosher / still growing
              </label>
            </div>
          </section>

          {/* Dress style, women only */}
          {formData.gender === "woman" && (
            <section>
              <label className="block font-semibold mb-2">Dress style</label>
              <div className="flex gap-4 mb-4">
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="dressStyle"
                    value="skirtsOnly"
                    onChange={() =>
                      setFormData({ ...formData, dressStyle: "skirtsOnly" })
                    }
                  />{" "}
                  Skirts only
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="dressStyle"
                    value="skirtsPants"
                    onChange={() =>
                      setFormData({ ...formData, dressStyle: "skirtsPants" })
                    }
                  />{" "}
                  Skirts + pants
                </label>
              </div>
            </section>
          )}

          {/* Hair covering, women only */}
          {formData.gender === "woman" && (
            <section>
              <label className="block font-semibold mb-2">Hair covering</label>
              <div className="flex gap-4 mb-4">
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="hairCovering"
                    value="willCoverHair"
                    onChange={() =>
                      setFormData({
                        ...formData,
                        hairCovering: "willCoverHair",
                      })
                    }
                  />{" "}
                  Will cover hair after marriage
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="hairCovering"
                    value="notPlanning"
                    onChange={() =>
                      setFormData({ ...formData, hairCovering: "notPlanning" })
                    }
                  />{" "}
                  Not planning to cover hair
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="hairCovering"
                    value="openFlexible"
                    onChange={() =>
                      setFormData({ ...formData, hairCovering: "openFlexible" })
                    }
                  />{" "}
                  Open / flexible
                </label>
              </div>
            </section>
          )}

          {/* Kohen, only for men */}
          {formData.gender === "man" && (
            <section>
              <label className="block font-semibold mb-2">
                Are you a Kohen?
              </label>
              <div className="flex gap-4">
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="kohen"
                    value="yes"
                    onChange={() =>
                      setFormData({ ...formData, isKohen: "yes" })
                    }
                  />{" "}
                  Yes
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="kohen"
                    value="no"
                    onChange={() => setFormData({ ...formData, isKohen: "no" })}
                  />{" "}
                  No
                </label>
              </div>
            </section>
          )}

          {/* Cover hair, only for men */}
          {formData.gender === "man" && (
            <section>
              <label className="block font-semibold mb-2">
                Do you prefer a woman who will cover her hair?
              </label>
              <div className="flex gap-4 mb-4">
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="coverHead"
                    value="yes"
                    onChange={() =>
                      setFormData({ ...formData, wantsCoveredHead: "yes" })
                    }
                  />{" "}
                  Yes
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="coverHead"
                    value="no"
                    onChange={() =>
                      setFormData({ ...formData, wantsCoveredHead: "no" })
                    }
                  />{" "}
                  No
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="coverHead"
                    value="noPreference"
                    onChange={() =>
                      setFormData({
                        ...formData,
                        wantsCoveredHead: "noPreference",
                      })
                    }
                  />{" "}
                  Doesn't matter
                </label>
              </div>
            </section>
          )}

          {/* Anything Else */}
          <div className="flex gap-4">
            <div className="flex-3">
              <label className="block font-semibold mb-2">
                Is there anything else you'd like us to know?
              </label>
              <input
                type="text"
                placeholder="Anything else?"
                className="w-full p-3 border rounded-lg mb-2"
                onChange={(e) =>
                  setFormData({ ...formData, anythingElse: e.target.value })
                }
              />
            </div>
          </div>

          <button
            disabled={loading}
            type="submit"
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 rounded-xl transition-colors shadow-lg"
          >
            {loading ? "Saving..." : "Register for Event"}
          </button>
        </form>
      </div>
    </div>
  );
}
