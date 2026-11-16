import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, setPersistence, browserSessionPersistence,
  signInWithEmailAndPassword, signOut, onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getFirestore, collection, onSnapshot } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { firebaseConfig, SHOW_OLD_LOCATION } from "./config.js";

const $ = (id) => document.getElementById(id);
const loginBox = $("login");
const loginForm = $("login-form");
const loginBtn = $("login-btn");
const loginError = $("login-error");
const signoutBtn = $("signout");
const noticeBox = $("notice");
const devicesBox = $("devices");

const STALE_CHECKIN_MS = 30 * 60 * 1000;   // normal check-ins are about every 10 minutes
const STALE_LIVE_MS = 2 * 60 * 1000;       // during a fake shutdown updates come every 30 s
const STALE_FIX_MS = 5 * 60 * 1000;        // a GPS fix older than this is "waiting for a fresh fix"

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function toMillis(value) {
  if (!value) return null;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.toDate === "function") return value.toDate().getTime();
  return null;
}

function ago(ms) {
  if (ms === null) return "never";
  const seconds = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (seconds < 45) return "just now";
  if (seconds < 3600) return Math.round(seconds / 60) + " min ago";
  if (seconds < 86400) return Math.round(seconds / 3600) + " h ago";
  return Math.round(seconds / 86400) + " d ago";
}

function clock(ms) {
  return ms === null ? "" : new Date(ms).toLocaleString();
}

function setRow(node, text, tone) {
  node.textContent = text;
  node.className = tone || "";
}

/* ---------- device cards ---------- */

function createCard() {
  const root = el("section", "card");
  const head = el("div", "head");
  const titles = el("div");
  const title = el("h2");
  const sub = el("p", "muted small");
  titles.append(title, sub);
  const badge = el("span", "badge");
  head.append(titles, badge);

  const list = el("dl");
  const row = (label) => {
    const dt = el("dt", null, label);
    const dd = el("dd");
    list.append(dt, dd);
    return dd;
  };
  const battery = row("Battery");
  const protection = row("Protection");
  const fake = row("Fake shutdown");
  const gps = row("GPS");
  const updated = row("Last update");

  const loc = el("div", "loc");
  const locTitle = el("h3");
  const locText = el("p", "muted small");
  const locLink = el("a", "small");
  locLink.target = "_blank";
  locLink.rel = "noopener noreferrer";
  const mapBox = el("div", "map hidden");
  loc.append(locTitle, locText, locLink, mapBox);

  root.append(head, list, loc);
  return { root, title, sub, badge, battery, protection, fake, gps, updated, locTitle, locText, locLink, mapBox, map: null, marker: null, circle: null };
}

function updateCard(card, d) {
  const now = Date.now();
  const updatedMs = toMillis(d.updatedAt);
  const fakeActive = d.fakeActive === true;
  const stale = updatedMs === null || now - updatedMs > (fakeActive ? STALE_LIVE_MS : STALE_CHECKIN_MS);

  card.title.textContent = d.name || d.model || "Device";
  card.sub.textContent = [d.manufacturer, d.model, d.androidVersion ? "Android " + d.androidVersion : ""].filter(Boolean).join(" · ");

  if (fakeActive) {
    card.badge.textContent = "FAKE SHUTDOWN";
    card.badge.className = "badge warn";
  } else if (d.protectionOn) {
    card.badge.textContent = "PROTECTED";
    card.badge.className = "badge ok";
  } else {
    card.badge.textContent = "PROTECTION OFF";
    card.badge.className = "badge";
  }

  const battery = typeof d.battery === "number" ? d.battery : null;
  setRow(card.battery, battery === null ? "Unknown" : battery + "%", battery !== null && battery <= 15 ? "warn" : "ok");
  setRow(card.protection, d.protectionOn ? "On" : "Off", d.protectionOn ? "ok" : "warn");
  setRow(card.fake, fakeActive ? "Active now" : "Not active", fakeActive ? "warn" : "");
  setRow(card.gps, d.gpsOn ? "On" : "Off", d.gpsOn ? "ok" : "warn");
  setRow(card.updated, updatedMs === null ? "Never" : ago(updatedMs) + (stale ? " (no recent update)" : ""), stale ? "warn" : "ok");

  updateLocation(card, d, fakeActive, now);
}

function updateLocation(card, d, fakeActive, now) {
  const lat = d.locLat;
  const lng = d.locLng;
  const hasLoc = typeof lat === "number" && typeof lng === "number";
  const showLoc = hasLoc && (fakeActive || SHOW_OLD_LOCATION);

  if (!showLoc) {
    card.locTitle.textContent = "Location";
    card.locText.textContent = hasLoc
      ? "No fake shutdown is active, so no location is shown."
      : "No location yet. It is shared only while a fake shutdown is active on the phone.";
    card.locLink.classList.add("hidden");
    card.mapBox.classList.add("hidden");
    return;
  }

  const fixMs = toMillis(d.locTime);
  const accuracy = typeof d.locAccuracy === "number" ? Math.round(d.locAccuracy) : null;
  const fresh = fixMs !== null && now - fixMs <= STALE_FIX_MS;

  if (fakeActive && fresh) {
    card.locTitle.textContent = "Live location";
  } else if (fakeActive) {
    card.locTitle.textContent = "Last known location (waiting for a fresh GPS fix)";
  } else {
    card.locTitle.textContent = "Old location from a past fake shutdown";
  }

  const parts = [];
  if (fixMs !== null) parts.push("Position taken " + ago(fixMs) + " (" + clock(fixMs) + ")");
  if (accuracy !== null) parts.push("accuracy about " + accuracy + " m");
  if (typeof d.locBattery === "number") parts.push("battery then " + d.locBattery + "%");
  card.locText.textContent = parts.join(", ") + ".";

  card.locLink.textContent = "Open in Google Maps (" + lat.toFixed(5) + ", " + lng.toFixed(5) + ")";
  card.locLink.href = "https://www.google.com/maps?q=" + encodeURIComponent(lat + "," + lng);
  card.locLink.classList.remove("hidden");

  if (typeof L === "undefined") {
    card.mapBox.classList.add("hidden");
    return;
  }
  card.mapBox.classList.remove("hidden");
  if (!card.map) {
    card.map = L.map(card.mapBox, { zoomControl: true }).setView([lat, lng], 16);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors",
    }).addTo(card.map);
    card.marker = L.circleMarker([lat, lng], { radius: 8, color: "#2ecc71", fillColor: "#2ecc71", fillOpacity: 0.9 }).addTo(card.map);
    card.circle = L.circle([lat, lng], { radius: accuracy || 20, color: "#2ecc71", weight: 1, fillOpacity: 0.1 }).addTo(card.map);
  } else {
    card.marker.setLatLng([lat, lng]);
    card.circle.setLatLng([lat, lng]);
    card.circle.setRadius(accuracy || 20);
    card.map.setView([lat, lng], card.map.getZoom());
  }
  setTimeout(() => card.map.invalidateSize(), 0);
}

/* ---------- state ---------- */

const cards = new Map();
let latestDocs = [];
let unsubscribeDevices = null;
let loaded = false;   // true after the first snapshot arrived

function renderAll() {
  const seen = new Set();
  for (const doc of latestDocs) {
    seen.add(doc.id);
    let card = cards.get(doc.id);
    if (!card) {
      card = createCard();
      cards.set(doc.id, card);
      devicesBox.append(card.root);
    }
    updateCard(card, doc.data);
  }
  for (const [id, card] of cards) {
    if (!seen.has(id)) {
      if (card.map) card.map.remove();
      card.root.remove();
      cards.delete(id);
    }
  }
  if (latestDocs.length === 0) {
    showNotice("No device yet. Sign in to the OFF SETTINGS app with this same email and tap \"Send device info now\".");
  } else {
    noticeBox.classList.add("hidden");
  }
}

function showNotice(text) {
  noticeBox.className = "card empty muted";
  noticeBox.textContent = text;
}

function clearDevices() {
  if (unsubscribeDevices) unsubscribeDevices();
  unsubscribeDevices = null;
  for (const card of cards.values()) {
    if (card.map) card.map.remove();
    card.root.remove();
  }
  cards.clear();
  latestDocs = [];
  loaded = false;
}

function friendlyAuthError(error) {
  switch (error && error.code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
    case "auth/invalid-login-credentials":
      return "Wrong email or password.";
    case "auth/too-many-requests":
      return "Too many attempts. Wait a few minutes and try again.";
    case "auth/network-request-failed":
      return "No internet connection.";
    case "auth/invalid-email":
      return "That email address is not valid.";
    case "auth/unauthorized-domain":
      return "This website's domain is not allowed yet. Add it in Firebase > Authentication > Settings > Authorized domains.";
    default:
      return "Could not sign in. " + ((error && error.message) || "");
  }
}

/* ---------- start ---------- */

function start() {
  if (String(firebaseConfig.apiKey).startsWith("PASTE") || String(firebaseConfig.projectId).startsWith("PASTE")) {
    showNotice("This site is not set up yet. Put your Firebase keys in config.js.");
    return;
  }

  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const db = getFirestore(app);

  // Session only: closing the tab signs out, which matters on a borrowed phone.
  setPersistence(auth, browserSessionPersistence).catch(() => {});

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    loginError.textContent = "";
    loginBtn.disabled = true;
    try {
      await signInWithEmailAndPassword(auth, $("email").value.trim(), $("password").value);
      $("password").value = "";
    } catch (error) {
      loginError.textContent = friendlyAuthError(error);
    } finally {
      loginBtn.disabled = false;
    }
  });

  signoutBtn.addEventListener("click", () => signOut(auth));

  onAuthStateChanged(auth, (user) => {
    clearDevices();
    if (!user) {
      loginBox.classList.remove("hidden");
      devicesBox.classList.add("hidden");
      noticeBox.classList.add("hidden");
      signoutBtn.classList.add("hidden");
      return;
    }
    loginBox.classList.add("hidden");
    devicesBox.classList.remove("hidden");
    signoutBtn.classList.remove("hidden");
    showNotice("Loading your devices...");

    unsubscribeDevices = onSnapshot(
      collection(db, "users", user.uid, "devices"),
      (snapshot) => {
        latestDocs = snapshot.docs.map((doc) => ({ id: doc.id, data: doc.data() }));
        loaded = true;
        renderAll();
      },
      (error) => {
        showNotice("Could not load devices: " + (error && error.code === "permission-denied"
          ? "the Firestore rules do not allow this account. Publish the rules from firestore.rules."
          : (error && error.message) || "unknown error"));
      }
    );
  });

  // Keep "x min ago" fresh.
  setInterval(() => { if (loaded) renderAll(); }, 30 * 1000);
}

start();
