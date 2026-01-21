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
} from "firebase/firestore";
import { useSearchParams } from "react-router-dom";

// const RELIGIOUS_SUBGROUPS = [
//   "Chabad",
//   "Chasidish",
//   "Haredi",
//   "Yeshivish",
//   "Modern Yeshivish",
//   "Modern Orthodox Machmir",
//   "Heimish",
//   "Out of the box",
// ];
const ETHNICITIES = [
  "Syrian / Egyptian / Lebanese",
  "Other Sephardic",
  "Ashkenaz",
  "Other",
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
    ageRange: { min: 18, max: 40 },
    ethnicity: "",
    otherSpecify: "",
    openToEthnicities: [],
    isKohen: "no",
    isShomerShabbat: "yes",
    isShomerKashrut: "yes",
    wantsCoveredHead: "yes",
    hairCovering: "N/A",
    dressStyle: "N/A",
    maritalStatus: "",
    openToMaritalStatus: [],
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

  const handleCheckbox = (list, value, field) => {
    const current = [...list];
    const index = current.indexOf(value);
    if (index > -1) current.splice(index, 1);
    else current.push(value);
    setFormData({ ...formData, [field]: current });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.eventId) return alert("Please select an event");
    setLoading(true);

    try {
      await addDoc(collection(db, "registrations"), {
        ...formData,
        age: calculateAge(formData.birthDate),
        checkedIn: false,
        timestamp: new Date(),
      });
      alert("Registration successful!");
      window.location.reload();
    } catch (err) {
      console.error(err);
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

        {/* Conditional UI: Show name if ID is in URL, otherwise show dropdown */}
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
              required
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

          {/* Birth Date Info */}
          <div className="flex gap-4">
            <div className="flex-1">
              <label className="block text-sm font-medium mb-1">
                Your Birth Date
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

          {/* Gender Choice */}
          <div className="flex gap-4">
            <div className="flex-1">
              <label className="block text-sm font-medium mb-1">
                You're a...
              </label>
              <select
                required
                className="w-full p-3 border rounded-lg"
                onChange={(e) =>
                  setFormData({ ...formData, gender: e.target.value })
                }
              >
                <option value="">Select</option>
                <option value="man">Man</option>
                <option value="woman">Woman</option>
              </select>
            </div>
          </div>

          {/* Target Age Range Choice */}
          <section>
            <label className="block font-semibold mb-2">
              Preferred Age Range
            </label>
            <div className="flex gap-4">
              <input
                type="number"
                min="18"
                max="100"
                placeholder="Min Age"
                required
                className="w-full p-3 border rounded-lg"
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    ageRange: {
                      ...formData.ageRange,
                      min: parseInt(e.target.value),
                    },
                  })
                }
              />
              <input
                type="number"
                min="18"
                max="100"
                placeholder="Max Age"
                required
                className="w-full p-3 border rounded-lg"
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    ageRange: {
                      ...formData.ageRange,
                      max: parseInt(e.target.value),
                    },
                  })
                }
              />
            </div>
          </section>

          {/* Phone and email */}
          <div className="flex gap-4">
            <div className="flex-1">
              <label className="block text-sm font-medium mb-1">
                Phone Number
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

          {/* Ethnicity */}
          <section>
            <label className="block font-semibold mb-2">What is your background?</label>
            <select
              required
              className="w-full p-3 border rounded-lg mb-2"
              onChange={(e) =>
                setFormData({ ...formData, ethnicity: e.target.value })
              }
            >
              <option value="">Select yours...</option>
              {ETHNICITIES.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
            <label className="block text-sm text-gray-600 mb-2 italic">
              I am open to date someone who is:
            </label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
              {ETHNICITIES.map((opt) => (
                <label key={opt} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    onChange={() =>
                      handleCheckbox(
                        formData.openToEthnicities,
                        opt,
                        "openToEthnicities"
                      )
                    }
                  />
                  {opt}
                </label>
              ))}
            </div>
          </section>

          {/* Specify for Other option */}
          {formData.ethnicity === "Other" && (
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

          {/* Marital Status */}
          <section>
            <label className="block font-semibold mb-2">Marital Status</label>
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
            <label className="block text-sm text-gray-600 mb-2 italic">
              I am open to date someone who is:
            </label>
            <div className="grid grid-cols-2 gap-2 text-sm">
              {MARITAL_STATUSES.map((opt) => (
                <label key={opt} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    onChange={() =>
                      handleCheckbox(
                        formData.openToMaritalStatus,
                        opt,
                        "openToMaritalStatus"
                      )
                    }
                  />
                  {opt}
                </label>
              ))}
            </div>
          </section>

          {/* Religious Lifestyle */}
          <section>
              <label className="block font-semibold mb-2">
                Shabbat level
              </label>
              <div className="flex gap-4">
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="isShomerShabbat"
                    value="yes"
                    defaultChecked
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
                    onChange={() => setFormData({ ...formData, isShomerShabbat: "no" })}
                  />{" "}
                  Not fully shomer shabbat / still growing
                </label>
              </div>
            </section>

            
          {/* Religious Lifestyle 2 */}
          <section>
              <label className="block font-semibold mb-2">
                Kashrut level
              </label>
              <div className="flex gap-4">
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="isShomerKashrut"
                    value="yes"
                    defaultChecked
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
                    onChange={() => setFormData({ ...formData, isShomerKashrut: "no" })}
                  />{" "}
                  Not fully kosher / still growing
                </label>
              </div>
            </section>

          {/* Dress style, women only */}
          {formData.gender === "woman" && (
            <section>
              <label className="block font-semibold mb-2">
                Dress style
              </label>
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
                    onChange={() => setFormData({ ...formData, dressStyle: "skirtsPants" })}
                  />{" "}
                  Skirts + pants
                </label>
              </div>
            </section>
          )}

          {/* Hair covering, women only */}
          {formData.gender === "woman" && (
            <section>
              <label className="block font-semibold mb-2">
                Hair covering
              </label>
              <div className="flex gap-4 mb-4">
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="hairCovering"
                    value="willCoverHair"
                    onChange={() =>
                      setFormData({ ...formData, hairCovering: "willCoverHair" })
                    }
                  />{" "}
                  Will cover hair after marriage
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="hairCovering"
                    value="notPlanning"
                    onChange={() => setFormData({ ...formData, hairCovering: "notPlanning" })}
                  />{" "}
                  Not planning to cover hair
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="hairCovering"
                    value="openFlexible"
                    onChange={() => setFormData({ ...formData, hairCovering: "openFlexible" })}
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
                    defaultChecked
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
                    defaultChecked
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
                      setFormData({ ...formData, wantsCoveredHead: "noPreference" })
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
                required
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

          {/* Parents Background, not needed for now */}
          {/* <section>
          <label className="block font-semibold mb-2">Your parents are:</label>
          <select required className="w-full p-3 border rounded-lg" onChange={(e) => setFormData({...formData, parents: e.target.value})}>
            <option value="">Select</option>
            <option>Both Jewish</option>
            <option>Mom is Jewish, Dad is not</option>
            <option>Dad is Jewish, Mom is not</option>
            <option>Neither</option>
          </select>
        </section> */}

          {/* Religious Level */}
          {/* <section>
            <label className="block font-semibold mb-2">
              Which best describes you?
            </label>
            <select
              required
              className="w-full p-3 border rounded-lg"
              onChange={(e) =>
                setFormData({ ...formData, religiousLevel: e.target.value })
              }
            >
              <option value="">Select</option>
              {[
                "Orthodox",
                "Modern",
                "Traditional",
                "Conservative",
                "Reform",
                "Reconstructionist",
                "Just Jewish",
                "Spiritual",
              ].map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </section> */}

          {/* Religious Subgroup (Multi) */}
          {/* <section>
            <label className="block font-semibold mb-2">
              Community / Hashkafa
            </label>
            <select
              required
              className="w-full p-3 border rounded-lg mb-2"
              onChange={(e) =>
                setFormData({ ...formData, subGroup: e.target.value })
              }
            >
              <option value="">Select yours...</option>
              {RELIGIOUS_SUBGROUPS.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
            <label className="block text-sm text-gray-600 mb-2 italic">
              I am open to date someone who is:
            </label>
            <div className="grid grid-cols-2 gap-2 text-sm">
              {RELIGIOUS_SUBGROUPS.map((opt) => (
                <label
                  key={opt}
                  className="flex items-center gap-2 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    onChange={() =>
                      handleCheckbox(
                        formData.openToSubGroups,
                        opt,
                        "openToSubGroups"
                      )
                    }
                  />
                  {opt}
                </label>
              ))}
            </div>
          </section> */}