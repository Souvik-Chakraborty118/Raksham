const API_BASE_URL = "https://raksham-api-zdv4.onrender.com";

const isProfilePage = window.location.pathname.includes('profile.html');
const isIndexPage = window.location.pathname.includes('index.html') || window.location.pathname === '/' || window.location.pathname === '';

window.currentScanLat = null;
window.currentScanLon = null;
window.currentRoutedServices = null;
window.lastDispatchedServices = null;
window.routingPromise = null;

async function fetchAndDisplayData() {
    const urlParams = new URLSearchParams(window.location.search);
    const emergencyId = urlParams.get('id');
    const userEmail = localStorage.getItem('raksham_user_email');

    if (isIndexPage && emergencyId) {
        try {
            let response = await fetch(`${API_BASE_URL}/profile/${emergencyId}`);
            let data = await response.json();
            if (!data.error) populateIndexDOM(data);
        } catch (error) { console.error(error); }
    }
    else if (isProfilePage && userEmail) {
        try {
            let response = await fetch(`${API_BASE_URL}/retrieve_profile_data`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: userEmail })
            });
            let data = await response.json();
            if (!data.error) {
                populateProfileDOM(data.user_data);
                const qrImg = document.getElementById('qr-image');
                const dlLink = document.getElementById('download-link');
                const dlBtn = document.getElementById('download-btn');
                if (qrImg && data.qr_image) {
                    qrImg.src = data.qr_image; qrImg.style.display = 'block';
                    dlLink.href = data.qr_image; dlBtn.style.display = 'inline-block';
                }
            } else window.location.href = 'login.html';
        } catch (error) { console.error(error); }
    } else if (isProfilePage && !userEmail) window.location.href = 'login.html';
}

function populateIndexDOM(data) {
    const setText = (id, text) => { if (document.getElementById(id)) document.getElementById(id).innerText = text || "N/A"; };
    setText('profile-name', data.name); setText('profile-blood', data.blood_group);
    setText('profile-allergies', data.allergies); setText('profile-conditions', data.conditions); setText('profile-phone', data.phone);

    const setLink = (id, phone) => {
        const el = document.getElementById(id);
        if (el && phone) el.innerHTML = `<a href="tel:${phone}" style="color:#FF003C; font-weight:bold;">${phone}</a>`;
    };
    setLink('profile-em1', data.em1); setLink('profile-em2', data.em2); setLink('profile-em3', data.em3);
    setLink('profile-em4', data.em4); setLink('profile-em5', data.em5); setLink('profile-em6', data.em6);

    const summaryEl = document.getElementById('profile-medical-summary');
    const summaryBox = document.getElementById('medical-history-box');
    if (summaryEl) {
        if (data.medical_summary) {
            summaryEl.innerText = data.medical_summary;
            if (summaryBox) summaryBox.style.display = 'block';
        } else if (summaryBox) summaryBox.style.display = 'none';
    }
}

function populateProfileDOM(data) {
    const setText = (id, text) => { if (document.getElementById(id)) document.getElementById(id).innerText = text || "N/A"; };
    const setInput = (id, text) => { if (document.getElementById(id)) document.getElementById(id).value = text || ""; };
    setText('v-email', data.email); setText('v-name', data.name); setText('v-blood', data.blood_group);
    setText('v-allergies', data.allergies); setText('v-cond', data.conditions); setText('v-phone', data.phone);
    setText('v-em1', data.em1); setText('v-em2', data.em2); setText('v-em3', data.em3);
    setText('v-em4', data.em4); setText('v-em5', data.em5); setText('v-em6', data.em6);

    setInput('e-email', data.email); setInput('e-name', data.name); setInput('e-blood', data.blood_group);
    setInput('e-allergies', data.allergies); setInput('e-cond', data.conditions); setInput('e-phone', data.phone);
    setInput('e-em1', data.em1); setInput('e-em2', data.em2); setInput('e-em3', data.em3);
    setInput('e-em4', data.em4); setInput('e-em5', data.em5); setInput('e-em6', data.em6);
}

// --- FAST BACKEND BALLTREE + OSRM ROUTER ---
function buildFallbackServices(lat, lon) {
    return {
        hospital: {
            name: "Emergency Hospital",
            phone: "112",
            html: `<span style='color:#333; font-weight:bold; font-size:16px;'>Emergency Hospital</span><br>📞 <a href='tel:112' style='color:#FF003C;'>112</a><br>🗺️ <a href='https://www.google.com/maps/search/hospital/@${lat},${lon},15z' target='_blank' rel='noopener' style='color:#0056b3; text-decoration:underline;'>Get Directions</a>`
        },
        police_station: {
            name: "Local Police",
            phone: "100",
            html: `<span style='color:#333; font-weight:bold; font-size:16px;'>Local Police</span><br>📞 <a href='tel:100' style='color:#FF003C;'>100</a><br>🗺️ <a href='https://www.google.com/maps/search/police/@${lat},${lon},15z' target='_blank' rel='noopener' style='color:#0056b3; text-decoration:underline;'>Get Directions</a>`
        },
        ambulance: {
            name: "108 Emergency Ambulance",
            phone: "108",
            html: `<span style='color:#333; font-weight:bold; font-size:16px;'>108 Emergency Ambulance</span><br>📞 <a href='tel:108' style='color:#FF003C;'>108</a>`
        }
    };
}

function normalizeBackendService(svc, defaultName, defaultPhone, lat, lon) {
    if (!svc) {
        return {
            name: defaultName,
            phone: defaultPhone,
            html: `<span style='color:#333; font-weight:bold; font-size:16px;'>${defaultName}</span><br>📞 <a href='tel:${defaultPhone}' style='color:#FF003C;'>${defaultPhone}</a>`
        };
    }
    const phone = svc.sms_mobile || svc.landline || defaultPhone;
    const distLine = svc.road_km != null
        ? `📍 Road: <strong>${svc.road_km} km</strong>${svc.eta_min != null ? ` (~${svc.eta_min} min)` : ""}`
        : `📍 <strong style='color:green;'>Location Locked</strong>`;
    const dirUrl = svc.google_maps_directions || `https://www.google.com/maps/search/${encodeURIComponent(defaultName)}/@${lat},${lon},15z`;

    return {
        ...svc,
        name: svc.name || defaultName,
        phone: phone,
        html: `<span style='color:#333; font-weight:bold; font-size:16px;'>${svc.name || defaultName}</span><br>${distLine}<br>📞 <a href='tel:${phone}' style='color:#FF003C;'>${phone}</a><br>🗺️ <a href='${dirUrl}' target='_blank' rel='noopener' style='color:#0056b3; text-decoration:underline;'>Get Directions</a>`
    };
}

function startPreRouting(lat, lon) {
    if (window.routingPromise) return window.routingPromise;

    window.routingPromise = (async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8000);
        try {
            const res = await fetch(`${API_BASE_URL}/nearest_services`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ lat, lon }),
                signal: controller.signal
            });
            clearTimeout(timer);
            if (res.ok) {
                const data = await res.json();
                if (data.status === "success" && data.services) {
                    const normalized = {
                        hospital: normalizeBackendService(data.services.hospital, "Emergency Hospital", "112", lat, lon),
                        police_station: normalizeBackendService(data.services.police_station, "Local Police", "100", lat, lon),
                        ambulance: normalizeBackendService(data.services.ambulance, "108 Emergency Ambulance", "108", lat, lon)
                    };
                    window.currentRoutedServices = normalized;
                    window.lastDispatchedServices = normalized;
                    return normalized;
                }
            }
        } catch (e) {
            clearTimeout(timer);
            console.warn("Backend router timed out or failed, using instant helpline fallback.", e);
        }
        const fallback = buildFallbackServices(lat, lon);
        window.currentRoutedServices = fallback;
        window.lastDispatchedServices = fallback;
        return fallback;
    })();

    return window.routingPromise;
}

let countdownInterval;
function startCountdown() {
    document.getElementById('main-screen').style.display = 'none';
    document.getElementById('countdown-screen').classList.remove('hidden');
    document.getElementById('countdown-screen').style.display = 'block';
    let timeLeft = 10;
    document.getElementById('timer-display').innerText = timeLeft;
    countdownInterval = setInterval(() => {
        timeLeft--;
        document.getElementById('timer-display').innerText = timeLeft;
        if (timeLeft <= 0) {
            clearInterval(countdownInterval);
            document.getElementById('countdown-screen').style.display = 'none';
            document.getElementById('triage-screen').classList.remove('hidden');
            document.getElementById('triage-screen').style.display = 'block';
        }
    }, 1000);
}

function cancelEmergency() {
    clearInterval(countdownInterval);
    document.getElementById('countdown-screen').style.display = 'none';
    document.getElementById('main-screen').style.display = 'block';
}

async function sendTriage(emergencyType) {
    document.getElementById('triage-screen').style.display = 'none';
    document.getElementById('guidance-screen').classList.remove('hidden');
    document.getElementById('guidance-screen').style.display = 'block';

    const chatBox = document.getElementById('chat-box');
    if (chatBox) chatBox.style.display = 'block';

    const outputDiv = document.getElementById('ai-suggestions');
    outputDiv.innerHTML = "<span style='color:#333;'>Loading nearest hospital, police & ambulance...</span>";

    let lat = window.currentScanLat, lon = window.currentScanLon;
    if (lat == null || lon == null) {
        try {
            const position = await new Promise((resolve, reject) => {
                navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 });
            });
            lat = position.coords.latitude;
            lon = position.coords.longitude;
            window.currentScanLat = lat;
            window.currentScanLon = lon;
        } catch (error) { console.warn("GPS Failed"); }
    }

    const urlParams = new URLSearchParams(window.location.search);
    const userId = urlParams.get('id') || "unknown_scan";

    if (lat != null && lon != null) {
        // Reuse pre-routed result (instant if already resolved during countdown)
        const services = window.currentRoutedServices || await startPreRouting(lat, lon);

        // Render routed services immediately while triage text loads
        outputDiv.innerHTML = [
            `<strong>🏥 ${services.hospital.html}</strong>`,
            `<strong>🚓 ${services.police_station.html}</strong>`,
            `<strong>🚑 ${services.ambulance.html}</strong>`,
            `<br><em style="color:#555;">Loading first-aid steps...</em>`
        ].join("<br><br>");

        // Fire family emergency contacts SMS in background
        fetch(`${API_BASE_URL}/trigger_emergency`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: userId, latitude: lat, longitude: lon, services: services })
        }).catch(() => {});

        if (navigator.geolocation) {
            navigator.geolocation.watchPosition((pos) => {
                window.currentScanLat = pos.coords.latitude;
                window.currentScanLon = pos.coords.longitude;
                fetch(`${API_BASE_URL}/update_location`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ user_id: userId, lat: pos.coords.latitude, lon: pos.coords.longitude })
                }).catch(() => {});
            }, () => {}, { enableHighAccuracy: true, maximumAge: 10000 });
        }

        try {
            let triageRes = await fetch(`${API_BASE_URL}/ai_triage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type: emergencyType, services: services, latitude: lat, longitude: lon })
            });
            let triageData = await triageRes.json();
            if (triageData.suggestions) {
                outputDiv.innerHTML = triageData.suggestions.join("<br><br>");
            }
        } catch (e) {
            console.warn("AI triage request failed:", e);
        }
    } else {
        outputDiv.innerHTML = "<span style='color:red;'>GPS denied. Enable location or call 112 immediately.</span>";
    }
}

// VOICE CHATBOT
function startVoiceRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return alert("Voice input is not supported in this browser.");
    const recognition = new SpeechRecognition();
    recognition.lang = 'en-IN'; recognition.interimResults = false;
    const micBtn = document.getElementById('mic-btn');
    const originalBg = micBtn.style.background;
    micBtn.style.background = '#FF003C';
    recognition.start();
    recognition.onresult = (event) => {
        document.getElementById('chat-input').value = event.results[0][0].transcript;
        sendChatMessage();
    };
    recognition.onend = () => { micBtn.style.background = originalBg; };
}

function speakText(text) {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const cleanText = text.replace(/<\/?[^>]+(>|$)/g, "").replace(/[*_#]/g, "");
    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.lang = 'en-IN'; utterance.rate = 1.05;
    window.speechSynthesis.speak(utterance);
}

window.chatHistory = window.chatHistory || [];
async function sendChatMessage() {
    const inputField = document.getElementById('chat-input');
    const chatOutput = document.getElementById('chat-output');
    if (!inputField || !chatOutput) return;
    const message = inputField.value.trim();
    if (!message) return;

    chatOutput.innerHTML += `<div class="user-msg"><b>You:</b> ${escapeHtml(message)}</div>`;
    inputField.value = ""; chatOutput.scrollTop = chatOutput.scrollHeight;
    window.chatHistory.push({ role: 'user', content: message });

    const typingId = 'typing-' + Date.now();
    chatOutput.innerHTML += `<div class="ai-msg" id="${typingId}"><b>Raksham AI:</b> <em>typing...</em></div>`;
    chatOutput.scrollTop = chatOutput.scrollHeight;

    try {
        let response = await fetch(`${API_BASE_URL}/chat`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: message, services: window.lastDispatchedServices || window.currentRoutedServices || {}, history: window.chatHistory.slice(-6) })
        });
        let data = await response.json();
        document.getElementById(typingId)?.remove();
        chatOutput.innerHTML += `<div class="ai-msg"><b>Raksham AI:</b> ${escapeHtml(data.response)}</div>`;
        chatOutput.scrollTop = chatOutput.scrollHeight;
        speakText(data.response);
        window.chatHistory.push({ role: 'assistant', content: data.response });
        if (window.chatHistory.length > 12) window.chatHistory = window.chatHistory.slice(-12);
    } catch (error) {
        document.getElementById(typingId)?.remove();
        chatOutput.innerHTML += `<div class="ai-msg"><b>Raksham AI:</b> Connection issue. Call 112.</div>`;
    }
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.innerText = str; return div.innerHTML;
}
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('chat-input')?.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendChatMessage(); });
});

// MENU & AUTH
function openMenu() { document.getElementById('edit-menu').style.display = 'block'; }
function closeMenu() { document.getElementById('edit-menu').style.display = 'none'; }

function togglePasswordVisibility(inputId) {
    const passwordInput = document.getElementById(inputId);
    if (passwordInput) {
        passwordInput.type = passwordInput.type === "password" ? "text" : "password";
    }
}

async function saveProfile() {
    const payload = {
        current_email: localStorage.getItem('raksham_user_email'),
        email: document.getElementById('e-email').value.trim(), name: document.getElementById('e-name').value,
        blood_group: document.getElementById('e-blood').value, allergies: document.getElementById('e-allergies').value,
        conditions: document.getElementById('e-cond').value, phone: document.getElementById('e-phone').value,
        em1: document.getElementById('e-em1').value, em2: document.getElementById('e-em2').value,
        em3: document.getElementById('e-em3').value, em4: document.getElementById('e-em4').value,
        em5: document.getElementById('e-em5').value, em6: document.getElementById('e-em6').value
    };
    try {
        let response = await fetch(`${API_BASE_URL}/update_profile`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        let data = await response.json();
        if (!data.error) { localStorage.setItem('raksham_user_email', payload.email); window.location.reload(); } else alert(data.error);
    } catch (error) { alert("Failed to update profile."); }
}

async function attemptLogin() {
    const email = document.getElementById('login-email')?.value.trim().toLowerCase();
    const password = document.getElementById('login-password')?.value.trim();
    if (!email || !password) return alert("Please enter both email and password.");
    try {
        let response = await fetch(`${API_BASE_URL}/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email, password: password }) });
        let data = await response.json();
        if (data.error) alert(data.error);
        else { localStorage.setItem('raksham_user_email', email); window.location.href = 'profile.html'; }
    } catch (error) { alert("Server error."); }
}
function logout() { localStorage.removeItem('raksham_user_email'); window.location.href = 'login.html'; }

// MEDICAL REPORT
function resizeImageClientSide(file, maxWidth = 1200, quality = 0.7) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const scale = Math.min(1, maxWidth / img.width);
                canvas.width = img.width * scale; canvas.height = img.height * scale;
                canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
                resolve(canvas.toDataURL('image/jpeg', quality));
            };
            img.onerror = reject; img.src = e.target.result;
        };
        reader.onerror = reject; reader.readAsDataURL(file);
    });
}
async function uploadMedicalReport() {
    const fileInput = document.getElementById('e-report-upload'), previewDiv = document.getElementById('report-summary-preview'), userEmail = localStorage.getItem('raksham_user_email');
    if (!fileInput || !fileInput.files[0]) return alert("Please choose an image.");
    if (!userEmail) return alert("You must be logged in.");
    if (previewDiv) previewDiv.innerHTML = "<em>Uploading & analyzing report...</em>";
    try {
        const resizedBase64 = await resizeImageClientSide(fileInput.files[0]);
        let response = await fetch(`${API_BASE_URL}/upload_medical_report`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: userEmail, image_base64: resizedBase64 }) });
        let data = await response.json();
        if (data.error && previewDiv) previewDiv.innerHTML = `<span style="color:red;">${data.error}</span>`;
        else if (previewDiv) previewDiv.innerText = data.summary;
    } catch (error) { if (previewDiv) previewDiv.innerHTML = `<span style="color:red;">Upload failed.</span>`; }
}
async function setMedicalVisibility(showSummary) {
    const userEmail = localStorage.getItem('raksham_user_email');
    if (!userEmail) return;
    try { await fetch(`${API_BASE_URL}/set_medical_visibility`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: userEmail, show_medical_summary: showSummary }) }); } catch (error) {}
}

// --- SCAN LOCATION PROMPT ---
function requestScanLocation(onSuccess) {
    if (!("geolocation" in navigator)) {
        alert("Geolocation is not supported on this device.");
        return;
    }
    const showLocationOverlay = (isDenied = false) => {
        if (document.getElementById("raksham-loc-overlay")) return;
        const overlay = document.createElement("div");
        overlay.id = "raksham-loc-overlay";
        overlay.style.cssText =
            "position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;";
        overlay.innerHTML = `
          <div style="background:#fff;color:#111;max-width:360px;width:100%;border-radius:12px;padding:20px;text-align:center;font-family:sans-serif;">
            <h3 style="margin:0 0 8px;color:#d32f2f;">Location Required for Rescue</h3>
            <p style="font-size:14px;margin:0 0 16px;">
              ${
                isDenied
                    ? "Location access is currently blocked. Tap the settings icon in your browser address bar, set Location to Allow, then tap Retry."
                    : "Allow GPS access so Raksham can find the nearest hospital, police station, and share live rescue coordinates."
              }
            </p>
            <button id="raksham-allow-loc-btn" style="background:#d32f2f;color:#fff;border:none;padding:12px 18px;border-radius:8px;font-weight:700;width:100%;cursor:pointer;">
              ${isDenied ? "Retry Location Access" : "Allow Location Access"}
            </button>
          </div>
        `;
        document.body.appendChild(overlay);
        document.getElementById("raksham-allow-loc-btn").addEventListener("click", () => triggerGeo());
    };
    const removeOverlay = () => {
        const el = document.getElementById("raksham-loc-overlay");
        if (el) el.remove();
    };
    const triggerGeo = () => {
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                removeOverlay();
                onSuccess(pos.coords.latitude, pos.coords.longitude);
            },
            (err) => {
                showLocationOverlay(err.code === err.PERMISSION_DENIED);
            },
            { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 }
        );
    };
    if (navigator.permissions) {
        navigator.permissions.query({ name: "geolocation" }).then((status) => {
            if (status.state === "denied") showLocationOverlay(true);
            else if (status.state === "prompt") { showLocationOverlay(false); triggerGeo(); }
            else triggerGeo();
        }).catch(() => triggerGeo());
    } else {
        showLocationOverlay(false);
        triggerGeo();
    }
}

// --- EXPLICIT AUTHORITY DISPATCH BUTTON (IMMEDIATE ACTIONS PAGE) ---
async function alertNearestAuthorities() {
    const params = new URLSearchParams(window.location.search);
    const userId = params.get("id");
    const btn = document.getElementById("btn-alert-authorities");
    const statusEl = document.getElementById("authority-dispatch-status");

    if (!userId) return;

    const confirmed = confirm(
        "This will send live emergency SMS and email alerts to the nearest Hospital, Police Station, and Ambulance. Proceed?"
    );
    if (!confirmed) return;

    btn.disabled = true;
    btn.textContent = "Dispatching Alerts to Authorities...";

    if (window.currentScanLat == null || window.currentScanLon == null) {
        try {
            const pos = await new Promise((resolve, reject) => {
                navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 });
            });
            window.currentScanLat = pos.coords.latitude;
            window.currentScanLon = pos.coords.longitude;
        } catch (e) { console.warn("GPS unavailable during authority dispatch"); }
    }

    try {
        const resp = await fetch(`${API_BASE_URL}/alert_authorities`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                user_id: userId,
                latitude: window.currentScanLat ?? null,
                longitude: window.currentScanLon ?? null,
                services: window.currentRoutedServices || window.lastDispatchedServices || {}
            })
        });
        const data = await resp.json();

        if (data.status === "Authorities Alerted") {
            btn.textContent = "✅ Authorities Alerted";
            btn.style.background = "#2e7d32";

            let lines = [];
            if (data.sms_notified?.length) {
                lines.push("SMS sent to: " + data.sms_notified.map(x => x.name).join(", "));
            }
            if (data.email_notified?.length) {
                lines.push("Email sent to: " + data.email_notified.map(x => x.name).join(", "));
            }
            if (data.call_only?.length) {
                lines.push(
                    "Direct call needed: " +
                    data.call_only.map(x => `${x.name} (<a href="tel:${x.phone}">${x.phone}</a>)`).join(", ")
                );
            }
            statusEl.innerHTML = lines.join("<br>");
        } else {
            throw new Error(data.message || "Dispatch failed");
        }
    } catch (err) {
        btn.disabled = false;
        btn.textContent = "🚨 Retry Alerting Nearest Authorities";
        statusEl.innerHTML = `<span style="color:#ff5252;">Could not alert authorities. Call 112 / 108 directly.</span>`;
    }
}

window.onload = () => {
    const params = new URLSearchParams(window.location.search);
    const isTrackPage = window.location.pathname.includes("track.html");
    const emergencyId = params.get("id");

    if (emergencyId && !isTrackPage) {
        fetchAndDisplayData();
        requestScanLocation((lat, lon) => {
            window.currentScanLat = lat;
            window.currentScanLon = lon;

            // Start BallTree + OSRM routing immediately in background
            startPreRouting(lat, lon);

            fetch(`${API_BASE_URL}/update_location`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ user_id: emergencyId, lat, lon })
            }).catch(() => {});
        });
    } else {
        fetchAndDisplayData();
    }
};
