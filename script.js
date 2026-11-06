/* SheShield prototype: all alerts, contacts, and communication routes are simulated. */
(function () {
  "use strict";

  const STORAGE_KEY = "sheshield-demo-v1";
  const DEMO_COORDINATES = { lat: 28.6139, lng: 77.2090, source: "demo" };
  const PAGE_LABELS = {
    home: "Welcome",
    login: "Demo account",
    dashboard: "Overview",
    history: "Alert history",
    contacts: "Trusted contacts",
    device: "My device",
    "how-it-works": "How it works"
  };
  const MODE_COPY = {
    cellular: "Simulated cellular route · no network transmission occurs.",
    satellite: "Satellite demo mode · no satellite connection or transmission occurs.",
    offline: "Offline demo mode · new alerts wait here until you select a demo route."
  };

  const initialState = {
    profile: null,
    contacts: [],
    alerts: [],
    mode: "cellular",
    location: null,
    noticeDismissed: false
  };
  let state = loadState();
  let activeAuthTab = "register";
  let activeFilter = "all";
  let mapInstance = null;
  let mapMarker = null;
  let apiAvailable = false;
  let sosLocation = null;
  let sosLocationRequestId = 0;

  function loadState() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) return structuredClone(initialState);
      const parsed = JSON.parse(saved);
      return {
        ...structuredClone(initialState),
        mode: ["cellular", "satellite", "offline"].includes(parsed.mode) ? parsed.mode : initialState.mode,
        location: parsed.location && typeof parsed.location === "object" ? parsed.location : null,
        noticeDismissed: parsed.noticeDismissed === true
      };
    } catch (error) {
      console.error("Could not load SheShield demo data:", error);
      return structuredClone(initialState);
    }
  }

  function saveState() {
    try {
      const stateToSave = {
        mode: state.mode,
        location: state.location,
        noticeDismissed: state.noticeDismissed
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stateToSave));
      return true;
    } catch (error) {
      console.error("Could not save SheShield demo data:", error);
      showToast("Browser storage is unavailable. Changes may not persist after refresh.", true);
      return false;
    }
  }

  async function apiRequest(path, options) {
    const requestOptions = {
      method: (options && options.method) || "GET",
      credentials: "same-origin",
      headers: { Accept: "application/json" }
    };
    if (options && options.body !== undefined) {
      requestOptions.headers["Content-Type"] = "application/json";
      requestOptions.body = JSON.stringify(options.body);
    }
    let response;
    try {
      response = await fetch(path, requestOptions);
    } catch (error) {
      throw new Error("Cannot reach the SheShield server. Your request was not saved.");
    }
    if (response.status === 204) return null;
    let result;
    try {
      result = await response.json();
    } catch (error) {
      throw new Error("The server returned an unreadable response.");
    }
    if (!response.ok) throw new Error(result.error || "The server could not complete this request.");
    return result;
  }

  async function loadBackendData() {
    const [contactsResult, alertsResult] = await Promise.all([
      apiRequest("/api/contacts"),
      apiRequest("/api/alerts")
    ]);
    state.contacts = contactsResult.contacts;
    state.alerts = alertsResult.alerts;
  }

  async function loadBackendContacts() {
    const result = await apiRequest("/api/contacts");
    state.contacts = result.contacts;
  }

  async function loadBackendAlerts() {
    const result = await apiRequest("/api/alerts");
    state.alerts = result.alerts;
  }

  async function initializeBackend() {
    try {
      const health = await apiRequest("/api/health");
      apiAvailable = Boolean(health.ok && health.database === "supabase");
    } catch (error) {
      apiAvailable = false;
      showToast(error.message, true);
    }
    const status = $("#backendStatus");
    if (!apiAvailable) {
      status.innerHTML = "<i></i> BACKEND UNAVAILABLE";
      return;
    }
    status.innerHTML = "<i></i> BACKEND CONNECTED";
    status.classList.add("backend-connected");
    state.profile = null;
    state.contacts = [];
    state.alerts = [];
    try {
      const session = await apiRequest("/api/auth/me");
      state.profile = session.user;
      await loadBackendData();
    } catch (error) {
      if (!/sign in|session expired/i.test(error.message)) {
        showToast(error.message, true);
      }
    }
  }

  function $(selector, root) {
    return (root || document).querySelector(selector);
  }

  function $all(selector, root) {
    return Array.from((root || document).querySelectorAll(selector));
  }

  function escapeHTML(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (char) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char];
    });
  }

  function showToast(message, isError) {
    const region = $("#toastRegion");
    const toast = document.createElement("div");
    toast.className = "toast" + (isError ? " error" : "");
    toast.textContent = message;
    region.appendChild(toast);
    window.setTimeout(function () { toast.remove(); }, 4200);
  }

  function showModal(id) {
    const modal = document.getElementById(id);
    if (modal) {
      modal.classList.remove("hidden");
      const close = $(".modal-close", modal);
      if (close) close.focus();
    }
  }

  function closeModal(modal) {
    modal.classList.add("hidden");
  }

  function goToPage(page, updateHash) {
    if (!PAGE_LABELS[page]) page = "home";
    if (["dashboard", "contacts", "history", "device", "how-it-works"].includes(page) && !state.profile) {
      page = "login";
    }
    $all(".page-view").forEach(function (view) { view.classList.add("hidden"); });
    const target = document.getElementById("page-" + page);
    if (target) target.classList.remove("hidden");
    $all(".main-nav a").forEach(function (link) {
      link.classList.toggle("active", link.dataset.page === page);
    });
    $("#pageLabel").textContent = PAGE_LABELS[page] || "Welcome";
    $("#sidebar").classList.remove("open");
    $("#mobileOverlay").classList.remove("show");
    if (updateHash !== false && location.hash !== "#" + page) {
      history.replaceState(null, "", "#" + page);
    }
    if (page === "dashboard") {
      refreshDashboard();
      window.setTimeout(function () { initializeMap(); }, 80);
    }
    if (page === "contacts") {
      state.contacts = [];
      renderContacts();
      if (apiAvailable && state.profile) {
        $("#contactsList").innerHTML = '<div class="card empty-state"><p>Loading trusted contacts…</p></div>';
        loadBackendContacts().then(renderContacts).catch(function (error) {
          renderContacts();
          showToast(error.message, true);
        });
      } else if (!apiAvailable) {
        showToast("Trusted contacts require a connection to the SheShield backend.", true);
      }
    }
    if (page === "history") {
      state.alerts = [];
      renderHistory();
      if (apiAvailable && state.profile) {
        $("#historyRows").innerHTML = '<tr><td colspan="5">Loading demo alert history…</td></tr>';
        loadBackendAlerts().then(function () {
          renderHistory();
          refreshDashboard();
        }).catch(function (error) {
          renderHistory();
          showToast(error.message, true);
        });
      } else if (!apiAvailable) {
        showToast("Alert history requires a connection to the SheShield backend.", true);
      }
    }
    if (page === "device") renderProfile();
    if (page === "login") renderAuthForm();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function renderProfile() {
    const profileName = state.profile && state.profile.name ? state.profile.name : "Guest User";
    $("#profileName").textContent = profileName;
    $("#profileKind").textContent = state.profile
      ? (apiAvailable ? "Backend account" : "Local demo profile")
      : "Not signed in";
    $("#avatarInitials").textContent = profileName.split(/\s+/).slice(0, 2).map(function (part) {
      return part.charAt(0).toUpperCase();
    }).join("") || "G";
    $("#welcomeName").textContent = state.profile ? state.profile.name.split(/\s+/)[0] : "there";
  }

  function updateToday() {
    const now = new Date();
    $("#todayDate").textContent = new Intl.DateTimeFormat(undefined, {
      weekday: "short", month: "short", day: "numeric", year: "numeric"
    }).format(now);
    const hour = now.getHours();
    $("#greetingTime").textContent = hour < 12 ? "morning" : (hour < 18 ? "afternoon" : "evening");
  }

  function refreshDashboard() {
    renderProfile();
    updateToday();
    $("#contactCount").textContent = state.contacts.length;
    $("#alertCount").textContent = state.alerts.length;
    $("#contactsTotal").textContent = state.contacts.length;
    $("#modeExplainer").textContent = MODE_COPY[state.mode] || MODE_COPY.cellular;
    $all(".mode-option").forEach(function (button) {
      button.classList.toggle("active", button.dataset.mode === state.mode);
    });
    $("#noticeDismiss").closest(".notice-banner").classList.toggle("hidden", state.noticeDismissed);
    $("#noticeCopy").innerHTML = apiAvailable
      ? "<strong>Prototype mode:</strong> Profile, contacts, and demo alerts are stored through Supabase. Ring connectivity, alert delivery, and contact notifications remain simulated."
      : "<strong>Prototype mode:</strong> The ring, network delivery, and contact notifications are simulated. This dashboard does not contact emergency services.";
    renderRecentActivity();
    renderLocation();
    renderResetButton();
  }

  function formatDate(timestamp) {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return { date: "Unknown date", time: "Unknown time" };
    return {
      date: new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(date),
      time: new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date)
    };
  }

  function getLocationLabel(alert) {
    if (!alert.location) return "Not shared";
    return alert.location.source === "browser" ? "Browser location" : "Demo coordinates";
  }

  function renderRecentActivity() {
    const container = $("#recentActivity");
    const recent = state.alerts.slice().sort(function (a, b) {
      return new Date(b.createdAt) - new Date(a.createdAt);
    }).slice(0, 3);
    if (!recent.length) {
      container.innerHTML = '<div class="empty-state"><span>◷</span><h3>No activity yet</h3><p>Your demo alerts will show up here.</p></div>';
      return;
    }
    container.innerHTML = recent.map(function (alert) {
      const when = formatDate(alert.createdAt);
      const queued = alert.status === "queued";
      return '<div class="activity-row"><span class="activity-mark ' + (queued ? "offline" : "") + '">⌁</span>' +
        '<div><strong>Demo SOS · ' + escapeHTML(alert.id) + '</strong><small>' + escapeHTML(when.date) + ' at ' + escapeHTML(when.time) + ' · ' + escapeHTML(alert.mode) + '</small></div>' +
        '<span class="activity-status ' + (queued ? "queued" : "") + '">' + (queued ? "Waiting" : escapeHTML(alert.statusLabel || "Simulated")) + '</span></div>';
    }).join("");
  }

  function renderResetButton() {
    const button = $("#resetAlertButton");
    const latest = state.alerts.slice().sort(function (a, b) {
      return new Date(b.createdAt) - new Date(a.createdAt);
    })[0];
    button.classList.toggle("hidden", !latest || latest.status === "cancelled");
  }

  function renderLocation() {
    const location = state.location;
    const badge = $("#locationBadge");
    const title = $("#locationTitle");
    const coords = $("#locationCoords");
    const source = $("#locationSource");
    if (!location) {
      badge.textContent = "Not shared";
      title.textContent = "Location not available";
      coords.textContent = "Choose to share your browser location.";
      source.textContent = "No location";
    } else {
      badge.textContent = location.source === "browser" ? "Permission granted" : "Demo preview";
      title.textContent = location.source === "browser" ? "Browser location shared" : "Demo location preview";
      coords.textContent = "Lat " + Number(location.lat).toFixed(5) + " · Lng " + Number(location.lng).toFixed(5);
      source.textContent = location.source === "browser" ? "Browser location" : "Simulated coordinates";
    }
    updateMapMarker();
  }

  function initializeMap() {
    const mapElement = $("#map");
    if (!mapElement || mapElement.offsetParent === null) return;
    if (!window.L) {
      mapElement.innerHTML = '<div class="map-placeholder">Map unavailable right now.<br>Coordinates remain visible above.</div>';
      return;
    }
    if (!mapInstance) {
      mapInstance = L.map(mapElement, { zoomControl: true, scrollWheelZoom: false }).setView([20, 0], 2);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors'
      }).addTo(mapInstance);
    }
    window.setTimeout(function () {
      if (mapInstance) {
        mapInstance.invalidateSize();
        updateMapMarker();
      }
    }, 100);
  }

  function updateMapMarker() {
    if (!mapInstance || !state.location) return;
    const point = [Number(state.location.lat), Number(state.location.lng)];
    if (!Number.isFinite(point[0]) || !Number.isFinite(point[1])) return;
    if (!mapMarker) {
      mapMarker = L.circleMarker(point, {
        radius: 8, color: "#fff", weight: 3, fillColor: "#8656a8", fillOpacity: 1
      }).addTo(mapInstance);
    } else {
      mapMarker.setLatLng(point);
    }
    mapMarker.bindPopup(state.location.source === "browser" ? "Browser location (permission granted)" : "Simulated demo coordinates");
    mapInstance.setView(point, 13);
  }

  function requestLocation() {
    if (!navigator.geolocation) {
      showToast("This browser does not support geolocation. You can preview demo coordinates instead.", true);
      return;
    }
    $("#getLocationButton").disabled = true;
    $("#getLocationButton").textContent = "Requesting permission…";
    navigator.geolocation.getCurrentPosition(function (position) {
      state.location = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        source: "browser",
        capturedAt: new Date().toISOString()
      };
      saveState();
      $("#getLocationButton").disabled = false;
      $("#getLocationButton").innerHTML = "Refresh browser location <span>→</span>";
      renderLocation();
      showToast("Your browser location is now visible in this demo.");
    }, function (error) {
      $("#getLocationButton").disabled = false;
      $("#getLocationButton").innerHTML = "Share my location <span>→</span>";
      const reasons = {
        1: "Location permission was denied. You can still preview clearly labelled demo coordinates.",
        2: "Your location could not be determined. You can preview demo coordinates.",
        3: "The location request timed out. Please try again or preview demo coordinates."
      };
      showToast(reasons[error.code] || "Location is unavailable. You can preview demo coordinates.", true);
    }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 });
  }

  function useDemoLocation() {
    state.location = {
      lat: DEMO_COORDINATES.lat,
      lng: DEMO_COORDINATES.lng,
      source: "demo",
      capturedAt: new Date().toISOString()
    };
    saveState();
    renderLocation();
    showToast("Showing simulated demo coordinates for New Delhi, India.");
  }

  function setSosLocationUnavailable(message, requestId) {
    if (requestId !== sosLocationRequestId || $("#sosModal").classList.contains("hidden")) return;
    sosLocation = null;
    $("#sosLocationStatus").textContent = "Location unavailable";
    $("#sosLocationDetails").textContent = message + " The demo alert can still be created without coordinates.";
    $("#sosMapsLink").classList.add("hidden");
    $("#sosMapsLink").removeAttribute("href");
    $("#confirmSosButton").disabled = false;
  }

  function requestSosLocation() {
    const requestId = ++sosLocationRequestId;
    sosLocation = null;
    $("#sosLocationStatus").textContent = "Requesting browser location…";
    $("#sosLocationDetails").textContent = "Your browser may ask you to allow location access.";
    $("#sosMapsLink").classList.add("hidden");
    $("#sosMapsLink").removeAttribute("href");
    $("#confirmSosButton").disabled = true;

    if (!navigator.geolocation) {
      setSosLocationUnavailable("This browser does not support geolocation.", requestId);
      return;
    }

    try {
      navigator.geolocation.getCurrentPosition(function (position) {
        if (requestId !== sosLocationRequestId || $("#sosModal").classList.contains("hidden")) return;
        sosLocation = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy,
          source: "browser"
        };
        const latitude = sosLocation.lat.toFixed(6);
        const longitude = sosLocation.lng.toFixed(6);
        const accuracy = sosLocation.accuracy >= 1000
          ? (sosLocation.accuracy / 1000).toFixed(2) + " km"
          : Math.round(sosLocation.accuracy) + " m";
        $("#sosLocationStatus").textContent = "Browser location captured";
        $("#sosLocationDetails").textContent = "Lat " + latitude + " · Lng " + longitude + " · accuracy ±" + accuracy;
        $("#sosMapsLink").href = "https://www.google.com/maps?q=" + encodeURIComponent(latitude + "," + longitude);
        $("#sosMapsLink").classList.remove("hidden");
        $("#confirmSosButton").disabled = false;
      }, function (error) {
        const reasons = {
          1: "Location permission was denied.",
          2: "Your device could not determine a GPS location.",
          3: "The location request timed out."
        };
        setSosLocationUnavailable(reasons[error.code] || "Browser location is unavailable.", requestId);
      }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
    } catch (error) {
      setSosLocationUnavailable("The browser could not start a location request.", requestId);
    }
  }

  function makeAlertId() {
    const time = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).slice(2, 6).toUpperCase();
    return "SS-" + time + "-" + random;
  }

  async function createDemoAlert() {
    const withLocation = sosLocation ? { ...sosLocation } : null;
    const alertId = makeAlertId();
    $("#confirmSosButton").disabled = true;
    try {
      if (!apiAvailable || !state.profile) {
        throw new Error("Sign in while connected to the SheShield backend to save a demo alert.");
      }
      const result = await apiRequest("/api/alerts", {
        method: "POST",
        body: { id: alertId, mode: state.mode, location: withLocation }
      });
      const alert = result.alert;
      state.alerts = [alert].concat(state.alerts.filter(function (item) { return item.id !== alert.id; }));
      closeModal($("#sosModal"));
      showAlertResult(alert);
      refreshDashboard();
    } catch (error) {
      showToast(error.message, true);
    } finally {
      $("#confirmSosButton").disabled = false;
    }
  }

  function showAlertResult(alert) {
    const queued = alert.status === "queued";
    $("#alertResultTitle").textContent = queued ? "SOS saved offline" : "Demo alert created";
    $("#alertResultText").textContent = queued
      ? "SOS Saved Offline – Waiting for Connectivity. This demo event is stored in your account; no alert was transmitted."
      : "This alert was marked as simulated delivery through the " + alert.mode + " demo route. No actual transmission occurred.";
    $("#alertResultId").textContent = alert.id;
    $("#alertResultMode").textContent = alert.mode.charAt(0).toUpperCase() + alert.mode.slice(1);
    $("#alertResultStatus").textContent = queued ? "Waiting for connectivity" : "Simulated only";
    $("#resultIcon").classList.toggle("queued-result", queued);
    $("#resultIcon").textContent = queued ? "◷" : "✓";
    showModal("alertResultModal");
  }

  async function retryQueuedAlerts(newMode) {
    if (newMode === "offline" || !apiAvailable || !state.profile) return;
    try {
      const result = await apiRequest("/api/alerts/retry", {
        method: "POST",
        body: { mode: newMode }
      });
      if (result.retried) {
        await loadBackendAlerts();
        showToast(result.retried + " queued demo alert" + (result.retried === 1 ? "" : "s") + " updated to " + newMode + ". No message was sent.");
      }
    } catch (error) {
      showToast(error.message, true);
    }
  }

  function renderContacts() {
    $("#contactsTotal").textContent = state.contacts.length;
    $("#contactCount").textContent = state.contacts.length;
    $("#contactsNoticeCopy").textContent = apiAvailable
      ? "Contact details are saved in Supabase for your account. No messages or calls are sent."
      : "Trusted contacts are unavailable until the SheShield backend is connected. No messages or calls are sent.";
    const list = $("#contactsList");
    if (!state.contacts.length) {
      list.innerHTML = '<div class="card empty-state"><span>♡</span><h3>Your circle starts here</h3><p>Add a trusted person to keep their details nearby.</p></div>';
      return;
    }
    list.innerHTML = state.contacts.map(function (contact) {
      const initials = contact.name.split(/\s+/).slice(0, 2).map(function (part) { return part.charAt(0).toUpperCase(); }).join("");
      return '<div class="contact-item"><span class="contact-avatar">' + escapeHTML(initials) + '</span><div class="contact-item-copy"><strong>' + escapeHTML(contact.name) + '</strong><span>' + escapeHTML(contact.phone) + '</span></div><button type="button" data-remove-contact="' + escapeHTML(contact.id) + '" aria-label="Remove ' + escapeHTML(contact.name) + '">Remove</button></div>';
    }).join("");
    $all("[data-remove-contact]", list).forEach(function (button) {
      button.addEventListener("click", function () { removeContact(button.dataset.removeContact); });
    });
  }

  function isValidPhone(phone) {
    const digits = phone.replace(/\D/g, "");
    return digits.length >= 7 && digits.length <= 15;
  }

  async function addContact(event) {
    event.preventDefault();
    const name = $("#contactName").value.trim();
    const phone = $("#contactPhone").value.trim();
    const error = $("#contactError");
    error.textContent = "";
    if (name.length < 2) {
      error.textContent = "Enter a contact name with at least 2 characters.";
      $("#contactName").focus();
      return;
    }
    if (!isValidPhone(phone)) {
      error.textContent = "Enter a valid phone number with 7–15 digits.";
      $("#contactPhone").focus();
      return;
    }
    if (state.contacts.length >= 10) {
      error.textContent = "You can add up to 10 trusted contacts.";
      return;
    }
    if (state.contacts.some(function (contact) { return contact.phone.replace(/\D/g, "") === phone.replace(/\D/g, ""); })) {
      error.textContent = "That phone number is already in your safety circle.";
      return;
    }
    try {
      if (!apiAvailable || !state.profile) {
        throw new Error("Sign in while connected to the SheShield backend to save trusted contacts.");
      }
      const result = await apiRequest("/api/contacts", {
        method: "POST",
        body: { name: name, phone: phone }
      });
      state.contacts.unshift(result.contact);
      $("#contactForm").reset();
      renderContacts();
      refreshDashboard();
      showToast(name + " was added to your safety circle.");
    } catch (requestError) {
      error.textContent = requestError.message;
    }
  }

  async function removeContact(id) {
    const contact = state.contacts.find(function (item) { return item.id === id; });
    if (!contact) return;
    if (!window.confirm("Remove " + contact.name + " from your demo trusted contacts?")) return;
    try {
      if (!apiAvailable || !state.profile) {
        throw new Error("Sign in while connected to the SheShield backend to remove trusted contacts.");
      }
      await apiRequest("/api/contacts/" + encodeURIComponent(id), { method: "DELETE" });
      state.contacts = state.contacts.filter(function (item) { return item.id !== id; });
      renderContacts();
      refreshDashboard();
      showToast("Trusted contact removed.");
    } catch (error) {
      showToast(error.message, true);
    }
  }

  function renderHistory() {
    $("#historyIntro").textContent = apiAvailable
      ? "See the simulated alert events saved to your Supabase account."
      : "Alert history is unavailable until the SheShield backend is connected.";
    const alerts = state.alerts.slice().sort(function (a, b) {
      return new Date(b.createdAt) - new Date(a.createdAt);
    }).filter(function (alert) {
      return activeFilter === "all" || alert.mode === activeFilter;
    });
    $("#historyResultCount").textContent = alerts.length + " event" + (alerts.length === 1 ? "" : "s");
    $("#historyEmpty").classList.toggle("hidden", alerts.length > 0);
    $(".history-table").classList.toggle("hidden", alerts.length === 0);
    $("#historyRows").innerHTML = alerts.map(function (alert) {
      const when = formatDate(alert.createdAt);
      const status = alert.status === "queued" ? "Waiting for connectivity" :
        (alert.status === "cancelled" ? "Cancelled / reset" : (alert.statusLabel || "Simulated delivery"));
      let locationText = getLocationLabel(alert);
      if (alert.location) {
        locationText += " · " + Number(alert.location.lat).toFixed(3) + ", " + Number(alert.location.lng).toFixed(3);
      }
      const retryNote = alert.retryMode ? " (retried via " + escapeHTML(alert.retryMode) + ")" : "";
      return '<tr><td class="alert-id">' + escapeHTML(alert.id) + '</td><td class="history-time"><strong>' + escapeHTML(when.date) + '</strong><small>' + escapeHTML(when.time) + '</small></td><td>' + escapeHTML(locationText) + '</td><td><span class="route-pill ' + escapeHTML(alert.mode) + '">' + escapeHTML(alert.mode) + '</span>' + retryNote + '</td><td><span class="history-status ' + (alert.status === "queued" ? "queued" : "") + '">' + escapeHTML(status) + '</span></td></tr>';
    }).join("");
    $all(".filter-pill").forEach(function (button) {
      button.classList.toggle("active", button.dataset.filter === activeFilter);
    });
  }

  async function clearHistory() {
    if (!state.alerts.length) {
      showToast("There is no demo history to clear.");
      return;
    }
    if (!window.confirm("Clear all demo alert history from your Supabase account? This cannot be undone.")) return;
    try {
      if (!apiAvailable || !state.profile) {
        throw new Error("Sign in while connected to the SheShield backend to clear alert history.");
      }
      await apiRequest("/api/alerts", { method: "DELETE" });
      state.alerts = [];
      renderHistory();
      refreshDashboard();
      showToast("Demo alert history cleared.");
    } catch (error) {
      showToast(error.message, true);
    }
  }

  async function cancelLatestAlert() {
    const latest = state.alerts.slice().sort(function (a, b) {
      return new Date(b.createdAt) - new Date(a.createdAt);
    })[0];
    if (!latest || latest.status === "cancelled") return;
    if (!window.confirm("Reset the latest demo alert? Its Supabase record will remain marked as cancelled.")) return;
    try {
      if (!apiAvailable || !state.profile) {
        throw new Error("Sign in while connected to the SheShield backend to reset a demo alert.");
      }
      await apiRequest("/api/alerts/" + encodeURIComponent(latest.id) + "/cancel", { method: "PATCH" });
      latest.status = "cancelled";
      latest.statusLabel = "Cancelled / reset";
      refreshDashboard();
      showToast("Latest demo alert was reset. This does not cancel a real emergency response.");
    } catch (error) {
      showToast(error.message, true);
    }
  }

  function renderAuthForm() {
    $all(".auth-tab").forEach(function (tab) {
      tab.classList.toggle("active", tab.dataset.authTab === activeAuthTab);
    });
    const isRegister = activeAuthTab === "register";
    $("#authHeading").textContent = isRegister
      ? "Create your SheShield account"
      : "Welcome back";
    $("#authSubheading").textContent = isRegister
      ? "Create your account with Supabase Auth."
      : "Sign in to your SheShield account.";
    $("#authInfoCopy").textContent = apiAvailable
      ? "Your account uses Supabase Auth. No ring or emergency service is connected."
      : "The backend is unavailable. Sign-in and account creation require a connection.";
    $("#authDemoLabel").textContent = "SERVER ACCOUNT · NO REAL ALERTS ARE SENT";
    $("#authPrivacyCopy").textContent = "⌑  Supabase Auth manages your password; session tokens are kept in HttpOnly cookies.";
    $("#authName").classList.toggle("hidden", !isRegister);
    $("#authName").closest(".form-field").classList.toggle("hidden", !isRegister);
    $("#authPhone").closest(".form-field").classList.toggle("hidden", !isRegister);
    $("#authPassword").autocomplete = isRegister ? "new-password" : "current-password";
    $("#authSubmit").innerHTML = isRegister
      ? "Create account <span>→</span>"
      : "Sign in <span>→</span>";
    $("#authError").textContent = "";
  }

  function submitAuth(event) {
    event.preventDefault();
    const error = $("#authError");
    error.textContent = "";
    if (!apiAvailable) {
      error.textContent = "The SheShield backend is unavailable. Sign-in and account creation are not saved locally.";
      return;
    }
    const email = $("#authEmail").value.trim().toLowerCase();
    const password = $("#authPassword").value;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      error.textContent = "Enter a valid email address.";
      $("#authEmail").focus();
      return;
    }
    if (password.length < 8) {
      error.textContent = "Use at least 8 characters for this demo password.";
      $("#authPassword").focus();
      return;
    }
    if (activeAuthTab === "register") {
      const name = $("#authName").value.trim();
      const phone = $("#authPhone").value.trim();
      if (name.length < 2) {
        error.textContent = "Enter your name with at least 2 characters.";
        $("#authName").focus();
        return;
      }
      if (!isValidPhone(phone)) {
        error.textContent = "Enter a valid phone number with 7–15 digits.";
        $("#authPhone").focus();
        return;
      }
      apiRequest("/api/auth/register", {
        method: "POST",
        body: { name: name, email: email, phone: phone, password: password }
      }).then(async function (result) {
        if (result.requiresEmailConfirmation) {
          $("#authPassword").value = "";
          activeAuthTab = "login";
          renderAuthForm();
          error.textContent = result.message;
          return;
        }
        state.profile = result.user;
        await loadBackendData();
        $("#authPassword").value = "";
        renderProfile();
        goToPage("dashboard");
        showToast("Your account is ready, " + name.split(/\s+/)[0] + ".");
      }).catch(function (requestError) {
        error.textContent = requestError.message;
      });
      return;
    }
    apiRequest("/api/auth/login", {
      method: "POST",
      body: { email: email, password: password }
    }).then(async function (result) {
      state.profile = result.user;
      await loadBackendData();
      $("#authPassword").value = "";
      renderProfile();
      goToPage("dashboard");
      showToast("Signed in to your SheShield account.");
    }).catch(function (requestError) {
      error.textContent = requestError.message;
    });
  }

  function bindEvents() {
    document.addEventListener("click", function (event) {
      const pageLink = event.target.closest("[data-page]");
      if (pageLink) {
        event.preventDefault();
        goToPage(pageLink.dataset.page);
        return;
      }
      const closeButton = event.target.closest("[data-close-modal]");
      if (closeButton) {
        const modal = closeButton.closest(".modal-backdrop");
        if (modal) closeModal(modal);
      }
    });
    $all(".modal-backdrop").forEach(function (modal) {
      modal.addEventListener("click", function (event) {
        if (event.target === modal) closeModal(modal);
      });
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") $all(".modal-backdrop:not(.hidden)").forEach(closeModal);
    });
    $("#mobileMenu").addEventListener("click", function () {
      $("#sidebar").classList.add("open");
      $("#mobileOverlay").classList.add("show");
    });
    $("#mobileOverlay").addEventListener("click", function () {
      $("#sidebar").classList.remove("open");
      $("#mobileOverlay").classList.remove("show");
    });
    $("#profileButton").addEventListener("click", async function () {
      if (!state.profile) {
        goToPage("login");
        return;
      }
      if (window.confirm("Sign out of SheShield? Your account data remains in Supabase.")) {
        if (apiAvailable) {
          try {
            await apiRequest("/api/auth/logout", { method: "POST" });
          } catch (error) {
            showToast(error.message, true);
            return;
          }
        }
        state.profile = null;
        state.contacts = [];
        state.alerts = [];
        saveState();
        renderProfile();
        goToPage("home");
        showToast("Signed out of your account.");
      }
    });
    $("#helpButton").addEventListener("click", function () { showModal("aboutModal"); });
    $all(".auth-tab").forEach(function (tab) {
      tab.addEventListener("click", function () {
        activeAuthTab = tab.dataset.authTab;
        renderAuthForm();
      });
    });
    $("#authForm").addEventListener("submit", submitAuth);
    $("#contactForm").addEventListener("submit", addContact);
    $("#sosButton").addEventListener("click", function () {
      if (state.alerts.some(function (alert) { return alert.status === "queued"; })) {
        showToast("A demo SOS is waiting offline. Select an available demo route to update it before creating another.", true);
        return;
      }
      showModal("sosModal");
      requestSosLocation();
    });
    $("#confirmSosButton").addEventListener("click", createDemoAlert);
    $("#resetAlertButton").addEventListener("click", cancelLatestAlert);
    $("#getLocationButton").addEventListener("click", requestLocation);
    $("#demoLocationButton").addEventListener("click", useDemoLocation);
    $("#noticeDismiss").addEventListener("click", function () {
      state.noticeDismissed = true;
      saveState();
      $("#noticeDismiss").closest(".notice-banner").classList.add("hidden");
    });
    $all(".mode-option").forEach(function (button) {
      button.addEventListener("click", async function () {
        const selected = button.dataset.mode;
        if (state.mode === selected) {
          if (selected !== "offline" && state.alerts.some(function (alert) { return alert.status === "queued"; })) {
            await retryQueuedAlerts(selected);
            refreshDashboard();
          }
          return;
        }
        state.mode = selected;
        await retryQueuedAlerts(selected);
        saveState();
        refreshDashboard();
        if (selected !== "offline") showToast(selected.charAt(0).toUpperCase() + selected.slice(1) + " demo mode selected. This is not a real connection.");
      });
    });
    $all(".filter-pill").forEach(function (button) {
      button.addEventListener("click", function () {
        activeFilter = button.dataset.filter;
        renderHistory();
      });
    });
    $("#clearHistoryButton").addEventListener("click", clearHistory);
    window.addEventListener("hashchange", function () {
      const route = location.hash.replace(/^#/, "") || "home";
      goToPage(route, false);
    });
    window.addEventListener("online", async function () {
      if (apiAvailable && state.mode !== "offline" &&
          state.alerts.some(function (alert) { return alert.status === "queued"; })) {
        await retryQueuedAlerts(state.mode);
        refreshDashboard();
      }
    });
  }

  async function initialize() {
    bindEvents();
    await initializeBackend();
    renderProfile();
    const route = location.hash.replace(/^#/, "") || (state.profile ? "dashboard" : "home");
    goToPage(route, false);
  }

  initialize();
}());
