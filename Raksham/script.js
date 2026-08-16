// =========================================================
// RAKSHAM APP - MAIN JAVASCRIPT
// =========================================================

const API_BASE_URL = "https://raksham-backend.onrender.com";

const isProfilePage = window.location.pathname.includes('profile.html');
const isIndexPage = window.location.pathname.includes('index.html') || window.location.pathname === '/' || window.location.pathname === '';

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

// --- CLIENT SIDE MAP SCRAPING (1.5 KM RADIUS STRICT) ---
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon/2) * Math.sin(dLon/2);
    return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
}

async function fetchFacilitiesClientSide(lat, lon) {
    let services = {
        hospital: { html: `<span style='color:#333; font-weight:bold; font-size:16px;'>Emergency Hospital</span><br>📍 <strong style='color:green;'>Location Locked</strong><br>📞 <a href='tel:112' style='color:#FF003C;'>112</a><br>🗺️ <a href='https://www.google.com/maps/search/hospital/@${lat},${lon},15z' target='_blank' style='color:#0056b3; text-decoration:underline;'>Get Directions</a>`, name: "Emergency Hospital", phone: "112" },
        police_station: { html: `<span style='color:#333; font-weight:bold; font-size:16px;'>Local Police</span><br>📍 <strong style='color:green;'>Location Locked</strong><br>📞 <a href='tel:100' style='color:#FF003C;'>100</a><br>🗺️ <a href='https://www.google.com/maps/search/police/@${lat},${lon},15z' target='_blank' style='color:#0056b3; text-decoration:underline;'>Get Directions</a>`, name: "Local Police", phone: "100" },
        ambulance: { html: `<span style='color:#333; font-weight:bold; font-size:16px;'>Ambulance Dispatch</span><br>📍 <strong style='color:green;'>Location Locked</strong><br>📞 <a href='tel:102' style='color:#FF003C;'>102</a><br>🗺️ <a href='https://www.google.com/maps/search/ambulance/@${lat},${lon},15z' target='_blank' style='color:#0056b3; text-decoration:underline;'>Get Directions</a>`, name: "Ambulance Dispatch", phone: "102" }
    };

    // 1. Fast Overpass Query - Strict 1.5km (1500m) Radius
    const query = `[out:json][timeout:5];(nwr["amenity"~"hospital|clinic"](around:1500,${lat},${lon});nwr["healthcare"="hospital"](around:1500,${lat},${lon});nwr["amenity"="police"](around:1500,${lat},${lon}););out center;`;
    const encodedQuery = encodeURIComponent(query);
    
    const mirrors = [
        `https://overpass-api.de/api/interpreter?data=${encodedQuery}`,
        `https://overpass.kumi.systems/api/interpreter?data=${encodedQuery}`
    ];

    let overpassSuccess = false;

    for (let url of mirrors) {
        try {
            let res = await fetch(url, { method: "GET" });
            if (!res.ok) continue;
            let data = await res.json();
            
            if (data && data.elements && data.elements.length > 0) {
                let h_list = [], p_list = [];
                data.elements.forEach(el => {
                    let el_lat = el.lat || (el.center && el.center.lat);
                    let el_lon = el.lon || (el.center && el.center.lon);
                    if(!el_lat || !el_lon) return;
                    
                    let dist = calculateDistance(lat, lon, el_lat, el_lon);
                    let item = { lat: el_lat, lon: el_lon, dist: dist, tags: el.tags || {} };
                    let am = item.tags.amenity || "";
                    let hc = item.tags.healthcare || "";
                    
                    if (am.includes("hospital") || am.includes("clinic") || hc.includes("hospital")) h_list.push(item);
                    else if (am.includes("police")) p_list.push(item);
                });

                function getBest(arr, defName, defPhone) {
                    if(!arr.length) return null;
                    arr.sort((a, b) => a.dist - b.dist);
                    let best = arr[0];
                    let n = best.tags.name || best.tags.operator || defName;
                    let p = best.tags.phone || best.tags['contact:phone'] || defPhone;
                    
                    return { html: `<span style='color:#333; font-weight:bold; font-size:16px;'>${n}</span><br>📍 Distance: <strong>${best.dist.toFixed(1)} km</strong><br>📞 <a href='tel:${p}' style='color:#FF003C;'>${p}</a><br>🗺️ <a href='https://www.google.com/maps/dir/?api=1&origin=${lat},${lon}&destination=${best.lat},${best.lon}' target='_blank' style='color:#0056b3; text-decoration:underline;'>Get Directions</a>`, name: n, phone: p };
                }

                let h = getBest(h_list, "Local Hospital", "112");
                let p = getBest(p_list, "Local Police", "100");

                if(h) services.hospital = h;
                if(p) services.police_station = p;
                overpassSuccess = true;
                break; 
            }
        } catch (e) { 
            console.warn("Overpass Mirror failed, trying next..."); 
        }
    }

    // 2. STRICTLY BOUNDED BACKUP API (Max ~1.5km limit)
    if (!overpassSuccess || services.hospital.name === "Emergency Hospital") {
        try {
            // 0.015 degrees is roughly 1.5 kilometers. It is impossible to search outside this box.
            let viewBox = `${lon-0.015},${lat+0.015},${lon+0.015},${lat-0.015}`;
            
            let nomRes = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=hospital&viewbox=${viewBox}&bounded=1&limit=3`);
            let nomData = await nomRes.json();
            
            if (nomData && nomData.length > 0) {
                let bestNom = nomData[0];
                let hLat = parseFloat(bestNom.lat);
                let hLon = parseFloat(bestNom.lon);
                
                let rawName = bestNom.name || bestNom.display_name.split(',')[0];
                let hName = rawName.replace(/(Hospital|Clinic).*$/i, '$1').trim(); 
                if(hName.length < 3) hName = rawName;
                
                let dist = calculateDistance(lat, lon, hLat, hLon);
                
                services.hospital = {
                    html: `<span style='color:#333; font-weight:bold; font-size:16px;'>${hName}</span><br>📍 Distance: <strong>${dist.toFixed(1)} km</strong><br>📞 <a href='tel:112' style='color:#FF003C;'>112</a><br>🗺️ <a href='https://www.google.com/maps/dir/?api=1&origin=${lat},${lon}&destination=${hLat},${hLon}' target='_blank' style='color:#0056b3; text-decoration:underline;'>Get Directions</a>`,
                    name: hName,
                    phone: "112"
                };
            }
        } catch(e) { console.warn("Backup API failed"); }
    }

    return services;
}

let countdownInterval;
function startCountdown() {
    document.getElementById('main-screen').style.display = 'none';
    document.getElementById('countdown-screen').classList.remove('hidden'); document.getElementById('countdown-screen').style.display = 'block';
    let timeLeft = 10; document.getElementById('timer-display').innerText = timeLeft;
    countdownInterval = setInterval(() => {
        timeLeft--; document.getElementById('timer-display').innerText = timeLeft;
        if (timeLeft <= 0) {
            clearInterval(countdownInterval);
            document.getElementById('countdown-screen').style.display = 'none';
            document.getElementById('triage-screen').classList.remove('hidden'); document.getElementById('triage-screen').style.display = 'block';
        }
    }, 1000);
}

function cancelEmergency() {
    clearInterval(countdownInterval);
    document.getElementById('countdown-screen').style.display = 'none'; document.getElementById('main-screen').style.display = 'block';
}

async function sendTriage(emergencyType) {
    document.getElementById('triage-screen').style.display = 'none';
    document.getElementById('guidance-screen').classList.remove('hidden'); document.getElementById('guidance-screen').style.display = 'block';
    
    const chatBox = document.getElementById('chat-box');
    if (chatBox) chatBox.style.display = 'block';
    
    const outputDiv = document.getElementById('ai-suggestions');
    outputDiv.innerHTML = "<span style='color:#333;'>Acquiring secure GPS lock...</span>";
    
    let lat = null, lon = null;
    try {
        const position = await new Promise((resolve, reject) => { navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }); });
        lat = position.coords.latitude; lon = position.coords.longitude;
    } catch (error) { console.warn("GPS Failed"); }

    const urlParams = new URLSearchParams(window.location.search);
    const userId = urlParams.get('id') || "unknown_scan";

    if (lat) {
        outputDiv.innerHTML = "<span style='color:green;'>GPS Locked! Fetching nearby hospitals...</span>";
        
        let services = await fetchFacilitiesClientSide(lat, lon);
        window.lastDispatchedServices = services;

        const hospPhone = services.hospital.phone.replace(/[^0-9+]/g, '');
        const polPhone = services.police_station.phone.replace(/[^0-9+]/g, '');
        const ambPhone = services.ambulance.phone.replace(/[^0-9+]/g, '');
        
        const gpsLink = `https://maps.google.com/?q=${lat},${lon}`;
        const smsBodyText = encodeURIComponent(`URGENT EMERGENCY! Please send immediate help to my location: ${gpsLink}`);
        
        const allPhones = [...new Set([hospPhone, polPhone, ambPhone])].filter(Boolean).join(',');
        
        const smsActionDiv = document.getElementById('sms-action-buttons');
        if (smsActionDiv) {
            smsActionDiv.innerHTML = `
                <a href="sms:${allPhones}?body=${smsBodyText}" class="btn" style="display:block; text-align:center; background-color:#28a745; color:white; border-radius:12px; margin-bottom: 10px; font-weight:bold; padding: 15px; text-decoration:none; box-shadow: 0 4px 10px rgba(40, 167, 69, 0.4);">
                    🟢 SMS ALL AUTHORITIES (HOSPITAL, POLICE)
                </a>
                <a href="sms:112?body=${smsBodyText}" class="btn" style="display:block; text-align:center; background-color:#ff9800; color:white; border-radius:12px; margin-bottom: 20px; font-weight:bold; padding: 15px; text-decoration:none; box-shadow: 0 4px 10px rgba(255, 152, 0, 0.4);">
                    🚨 SMS 112 DISPATCH
                </a>
            `;
        }

        fetch(`${API_BASE_URL}/trigger_emergency`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: userId, latitude: lat, longitude: lon, services: services }) });
        
        if (navigator.geolocation) {
            navigator.geolocation.watchPosition(async (pos) => {
                fetch(`${API_BASE_URL}/update_location`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: userId, lat: pos.coords.latitude, lon: pos.coords.longitude }) });
            }, () => {}, { enableHighAccuracy: true, maximumAge: 0 });
        }

        let triageRes = await fetch(`${API_BASE_URL}/ai_triage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: emergencyType, services: services }) });
        let triageData = await triageRes.json();
        outputDiv.innerHTML = triageData.suggestions.join("<br><br>");
    } else {
        outputDiv.innerHTML = "<span style='color:red;'>GPS denied. Cannot load map. Call 112.</span>";
    }
}

// --- VOICE & CHATBOT ---
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
            body: JSON.stringify({ message: message, services: window.lastDispatchedServices || {}, history: window.chatHistory.slice(-6) })
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

// --- MENU & LOGIN ---
function openMenu() { document.getElementById('edit-menu').style.display = 'block'; }
function closeMenu() { document.getElementById('edit-menu').style.display = 'none'; }
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
        let response = await fetch(`${API_BASE_URL}/login`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ email: email, password: password }) });
        let data = await response.json();
        if (data.error) alert(data.error); 
        else { localStorage.setItem('raksham_user_email', email); window.location.href = 'profile.html'; }
    } catch (error) { alert("Server error."); }
}
function logout() { localStorage.removeItem('raksham_user_email'); window.location.href = 'login.html'; }

// --- MEDICAL REPORT ---
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

window.onload = fetchAndDisplayData;
