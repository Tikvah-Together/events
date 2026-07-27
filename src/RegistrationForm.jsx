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
          updatedAt: new Date(), // Change this to updatedAt so you don't lose the original createdAt!
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
        // They are already registered for this event, so just update their profile info
        const internalRegId = regCheckSnap.docs[0].id;
        await updateDoc(doc(db, "registrations", internalRegId), {
          userId: internalUserId,
          eventId: eventId,
          checkedIn: false,
          tableNumber: null,
          status: "pending invite",
          groupId: "Unassigned",
          timestamp: new Date(),
          gender: formData.gender,
          firstName: formData.firstName,
          lastName: formData.lastName,
        });
        alert(
          "You are already registered for this event! We have updated your profile info with the latest details you provided.",
        );
        setLoading(false);
        return;
      } else {
        // New User: Create new registration
        await addDoc(collection(db, "registrations"), {
          userId: internalUserId,
          eventId: eventId,
          checkedIn: false,
          tableNumber: null,
          status: "pending invite",
          groupId: "Unassigned",
          timestamp: new Date(),
          gender: formData.gender,
          firstName: formData.firstName,
          lastName: formData.lastName,
        });
      }

      // 5. Trigger the Email via the 'email' collection
      const eventNameForEmail = urlEventId
        ? selectedEventName
        : events.find((e) => e.id === eventId)?.name;

      await addDoc(collection(db, "email"), {
        to: formData.email.toLowerCase().trim(),
        message: {
          subject: `SY SmartMatch - Registration Received`,
          html: `
      <div style="font-family: sans-serif; color: #1E3D34; padding: 20px;">
        <h1 style="color: #1E3D34; border-bottom: 2px solid #95B699; display: inline-block; padding-bottom: 5px;">Hi ${formData.firstName}!</h1>
        <p>Thank you for registering for SY SmartMatch.</p>
        <p>Your registration has been received and is currently being reviewed. We'll be in touch with next steps soon!</p>
        <br>
        <p style="font-weight: bold;">SY SmartMatch Team</p>
      </div>
    `,
        },
      });

      alert(
        "Thank you! Your registration has been received.\nYou’ll receive a confirmation email shortly.",
      );
      window.location.reload();
    } catch (err) {
      console.error("Registration Error:", err);
      alert("Error saving registration.");
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen py-12 px-4 text-[#1E3D34]">
      {/* Container Background changed from bg-white to bg-[#DEE8DF] to seamlessly carry the theme color inside */}
      <div className="max-w-xl mx-auto bg-[#DEE8DF] p-6 sm:p-10 rounded-2xl border border-[#95B699] shadow-sm">
        <h2 className="text-3xl font-bold text-[#1E3D34] mb-8 text-center">
          Event Registration
        </h2>

        {/* Conditional UI: Show name if ID is in URL, otherwise show nothing */}
        {urlEventId ? (
          <p className="text-center text-[#1E3D34] font-bold mb-8">
            Registering for: {selectedEventName || "Loading event..."}
          </p>
        ) : (
          <div className="mb-8">
            <label className="block font-semibold mb-2 text-center text-[#1E3D34]">
              Select Event
            </label>
            <select
              className="w-full p-3 border border-[#95B699] rounded-lg shadow-sm focus:ring-2 focus:ring-[#95B699] bg-white outline-none text-[#1E3D34]"
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
                className="w-full p-3 border border-slate-200 rounded-lg bg-white outline-none focus:ring-2 focus:ring-[#95B699]"
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
                className="w-full p-3 border border-slate-200 rounded-lg bg-white outline-none focus:ring-2 focus:ring-[#95B699]"
                onChange={(e) =>
                  setFormData({ ...formData, lastName: e.target.value })
                }
              />
            </div>
          </div>

          {/* Phone, Email, and SMS Opt-in */}
          <div className="flex flex-col gap-3">
            <div className="flex gap-4">
              <div className="flex-1">
                <label className="block text-sm font-medium mb-1">
                  Cell Phone Number
                </label>
                <input
                  type="tel"
                  placeholder="Phone number"
                  required
                  className="w-full p-3 border border-slate-200 rounded-lg bg-white outline-none focus:ring-2 focus:ring-[#95B699]"
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
                  className="w-full p-3 border border-slate-200 rounded-lg bg-white outline-none focus:ring-2 focus:ring-[#95B699]"
                  onChange={(e) =>
                    setFormData({ ...formData, email: e.target.value })
                  }
                />
              </div>
            </div>
            
            {/* 10DLC Compliance Checkbox */}
            <div className="flex items-start gap-2 mt-1">
              <input
                type="checkbox"
                id="smsOptIn"
                className="mt-1 w-4 h-4 accent-[#95B699] cursor-pointer"
                onChange={(e) =>
                  setFormData({ ...formData, smsOptIn: e.target.checked })
                }
              />
              <label htmlFor="smsOptIn" className="text-xs text-slate-500 leading-snug cursor-pointer">
                By checking this box, I agree to receive SMS matchmaking notifications from SY SmartMatch. Message and data rates may apply. Reply STOP to cancel. See our <a href="/privacy.html" target="_blank" rel="noreferrer" className="underline hover:text-[#95B699]">Privacy Policy</a> and <a href="/terms.html" target="_blank" rel="noreferrer" className="underline hover:text-[#95B699]">Terms</a>.
              </label>
            </div>
          </div>

          {/* Gender Choice */}
          <div className="flex gap-4">
            <div className="flex-1">
              <label className="block text-sm font-medium mb-1">Gender</label>
              <select
                required
                className="w-full p-3 border border-slate-200 rounded-lg bg-white outline-none focus:ring-2 focus:ring-[#95B699]"
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
                className="w-full p-3 border border-slate-200 rounded-lg text-gray-500 bg-white outline-none focus:ring-2 focus:ring-[#95B699]"
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
              className="w-full p-3 border border-slate-200 rounded-lg mb-2 bg-white outline-none focus:ring-2 focus:ring-[#95B699]"
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
            <label className="block font-bold text-[#1E3D34] mb-2">
              What is your background?{" "}
              <span className="text-xs font-normal text-slate-500">
                (Select up to 2)
              </span>
            </label>

            <div className="bg-[#E4ECE6] p-5 rounded-2xl border border-[#95B699]/40 shadow-sm">
              {/* SEPHARDIC SECTION */}
              <div className="mb-6">
                <p className="text-sm font-bold text-[#1E3D34] mb-3">
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
                          ? "border-[#1E3D34] bg-[#95B699] text-[#1E3D34]"
                          : "border-transparent bg-white text-[#1E3D34] shadow-sm hover:border-[#95B699]"
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
                    className={`px-3 py-2 rounded-xl border-2 text-xs font-bold transition-all ${
                      isSelected("Other Sephardic")
                        ? "border-[#1E3D34] bg-[#95B699] text-[#1E3D34]"
                        : "border-transparent bg-white text-[#1E3D34] shadow-sm hover:border-[#95B699]"
                    }`}
                  >
                    Other Sephardic {isSelected("Other Sephardic") ? ":" : ""}
                  </button>

                  {isSelected("Other Sephardic") && (
                    <input
                      type="text"
                      placeholder="Specify (e.g. Mixed, Yemenite, Iraqi)..."
                      className="w-full p-3 border border-[#95B699]/30 rounded-xl mt-2 text-sm bg-white text-[#1E3D34] outline-none focus:ring-2 focus:ring-[#95B699]"
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
              <div className="mb-6 space-y-2 border-t border-[#95B699]/30 pt-4 flex flex-col items-start">
                <p className="text-sm font-bold text-[#1E3D34] mb-3">
                  Ashkenaz:
                </p>
                {/* Ashkenaz */}
                <button
                  type="button"
                  onClick={() => handleEthnicityToggle("Ashkenaz")}
                  className={`px-3 py-2 rounded-xl border-2 text-xs font-bold transition-all ${
                    isSelected("Ashkenaz")
                      ? "border-[#1E3D34] bg-[#95B699] text-[#1E3D34]"
                      : "border-transparent bg-white text-[#1E3D34] shadow-sm hover:border-[#95B699]"
                  }`}
                >
                  Ashkenaz
                </button>
              </div>

              <div className="space-y-2 border-t border-[#95B699]/30 pt-4 flex flex-col items-start">
                <p className="text-sm font-bold text-[#1E3D34] mb-3">Other:</p>
                {/* Other */}
                <button
                  type="button"
                  onClick={() => handleEthnicityToggle("Other")}
                  className={`px-3 py-2 rounded-xl border-2 text-xs font-bold transition-all ${
                    isSelected("Other")
                      ? "border-[#1E3D34] bg-[#95B699] text-[#1E3D34]"
                      : "border-transparent bg-white text-[#1E3D34] shadow-sm hover:border-[#95B699]"
                  }`}
                >
                  Other {isSelected("Other") ? ":" : ""}
                </button>

                {isSelected("Other") && (
                  <input
                    type="text"
                    placeholder="e.g., Chasidish, Chabad, etc."
                    className="w-full p-3 border border-[#95B699]/30 rounded-xl mt-1 text-sm bg-white text-[#1E3D34] outline-none focus:ring-2 focus:ring-[#95B699]"
                    value={formData.otherSpecify || ""}
                    onChange={(e) =>
                      setFormData({ ...formData, otherSpecify: e.target.value })
                    }
                  />
                )}
              </div>
            </div>
          </section>

          {/* Religious Lifestyle */}
          <section>
            <label className="block font-semibold mb-2">Shabbat level</label>
            <div className="flex flex-col sm:flex-row gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="isShomerShabbat"
                  value="yes"
                  className="accent-[#1E3D34]"
                  onChange={() =>
                    setFormData({ ...formData, isShomerShabbat: "yes" })
                  }
                />{" "}
                Shomer Shabbat
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="isShomerShabbat"
                  value="no"
                  className="accent-[#1E3D34]"
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
            <div className="flex flex-col sm:flex-row gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="isShomerKashrut"
                  value="yes"
                  className="accent-[#1E3D34]"
                  onChange={() =>
                    setFormData({ ...formData, isShomerKashrut: "yes" })
                  }
                />{" "}
                Kosher
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="isShomerKashrut"
                  value="no"
                  className="accent-[#1E3D34]"
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
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="dressStyle"
                    value="skirtsOnly"
                    className="accent-[#1E3D34]"
                    onChange={() =>
                      setFormData({ ...formData, dressStyle: "skirtsOnly" })
                    }
                  />{" "}
                  Skirts only
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="dressStyle"
                    value="skirtsPants"
                    className="accent-[#1E3D34]"
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
              <div className="flex flex-col gap-2 mb-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="hairCovering"
                    value="willCoverHair"
                    className="accent-[#1E3D34]"
                    onChange={() =>
                      setFormData({
                        ...formData,
                        hairCovering: "willCoverHair",
                      })
                    }
                  />{" "}
                  Will cover hair after marriage
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="hairCovering"
                    value="notPlanning"
                    className="accent-[#1E3D34]"
                    onChange={() =>
                      setFormData({ ...formData, hairCovering: "notPlanning" })
                    }
                  />{" "}
                  Not planning to cover hair
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="hairCovering"
                    value="openFlexible"
                    className="accent-[#1E3D34]"
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
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="kohen"
                    value="yes"
                    className="accent-[#1E3D34]"
                    onChange={() =>
                      setFormData({ ...formData, isKohen: "yes" })
                    }
                  />{" "}
                  Yes
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="kohen"
                    value="no"
                    className="accent-[#1E3D34]"
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
              <div className="flex flex-col sm:flex-row gap-4 mb-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="coverHead"
                    value="yes"
                    className="accent-[#1E3D34]"
                    onChange={() =>
                      setFormData({ ...formData, wantsCoveredHead: "yes" })
                    }
                  />{" "}
                  Yes
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="coverHead"
                    value="no"
                    className="accent-[#1E3D34]"
                    onChange={() =>
                      setFormData({ ...formData, wantsCoveredHead: "no" })
                    }
                  />{" "}
                  No
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="coverHead"
                    value="noPreference"
                    className="accent-[#1E3D34]"
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
            <div className="flex-1">
              <label className="block font-semibold mb-2">
                Is there anything else you'd like us to know?
              </label>
              <input
                type="text"
                placeholder="Anything else?"
                className="w-full p-3 border border-slate-200 rounded-lg mb-2 bg-white outline-none focus:ring-2 focus:ring-[#95B699]"
                onChange={(e) =>
                  setFormData({ ...formData, anythingElse: e.target.value })
                }
              />
            </div>
          </div>

          <button
            disabled={loading}
            type="submit"
            className="w-full bg-[#1E3D34] hover:bg-[#1E3D34]/90 text-white font-bold py-4 rounded-xl transition-colors shadow-lg"
          >
            {loading ? "Saving..." : "Register for Event"}
          </button>
        </form>
      </div>
    </div>
  );
}
