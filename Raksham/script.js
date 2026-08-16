// =========================================================
// RAKSHAM APP - MAIN JAVASCRIPT
// =========================================================

const API_BASE_URL = "https://raksham-backend.onrender.com";

const isProfilePage = window.location.pathname.includes('profile.html');
const isIndexPage = window.location.pathname.includes('index.html') || window.location.pathname === '/' || window.location.pathname === '';

// --- GLOBAL STATE ---
window.lastDispatchedServices = {};
let chatHistory = []; 

// =========================================================
// 1. DATA LOADER
// =========================================================
async function fetchAndDisplayData() {
    const urlParams = new URLSearchParams(window.location.search);
    const emergencyId = urlParams.get('id');
    const userEmail = localStorage.getItem('raksham_user_email');

    if (isIndexPage && emergencyId) {
        try {
            let response = await fetch(`${API_BASE_URL}/profile/${emergencyId}`);
            let data = await response.json();
            if (!data.error) populateIndexDOM(data);
        } catch (error) { console.error("Error fetching public profile:", error); }
    } 
    else if (isProfilePage && userEmail) {
        try {
            let response = await fetch(`${API_BASE_URL}/retrieve_profile_data`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: userEmail })
            });
            let data = await response.json();
            
            if (!data.error) {
                populateProfileDOM(data.user_data);
                const qrImg = document.getElementById('qr-image');
                const dlLink = document.getElementById('download-link');
                const dlBtn = document.getElementById('download-btn');
                
                if (qrImg && data.qr_image) {
                    qrImg.src = data.qr_image;
                    qrImg.style.display = 'block';
                    dlLink.href = data.qr_image;
                    dlBtn.style.display = 'inline-block';
                }
            } else {
                window.location.href = 'login.html';
            }
        } catch (error) { console.error("Error fetching private profile:", error); }
    } 
    else if (isProfilePage && !userEmail) {
        window.location.href = 'login.html';
    }
}

function populateIndexDOM(data) {
    const setText = (id, text) => { if (document.getElementById(id)) document.getElementById(id).innerText = text || "N/A"; };
    setText('profile-name', data.name);
    setText('profile-blood', data.blood_group);
    setText('profile-allergies', data.allergies);
    setText('profile-conditions', data.conditions);
    setText('profile-phone', data.phone);

    const setLink = (id, phone) => {
        const el = document.getElementById(id);
        if (el && phone) el.innerHTML = `<a href="tel:${phone}" style="color:#FF003C; font-weight:bold;">${phone}</a>`;
    };
    setLink('profile-em1', data.em1);
    setLink('profile-em2', data.em2);
    setLink('profile-em3', data.em3);
    setLink('profile-em4', data.em4);
    setLink('profile-em5', data.em5);
    setLink('profile-em6', data.em6);
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

// =========================================================
// 2. EMERGENCY TRIGGER SEQUENCE
// =========================================================
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
    
    const outputDiv = document.getElementById('ai-suggestions');
    outputDiv.innerHTML = "<span style='color:#333;'>Searching for nearest services...</span>";
    
    let lat = null, lon = null;
    try {
        const position = await new Promise((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 10000 });
        });
        lat = position.coords.latitude;
        lon = position.coords.longitude;
    } catch (error) { console.warn("GPS Failed:", error); }

    const urlParams = new URLSearchParams(window.location.search);
    const userId = urlParams.get('id') || "unknown_scan";

    // DO NOT BLOCK UI - Graceful Degradation
    let triggerData = { services: {} };
    try {
        let triggerRes = await fetch(`${API_BASE_URL}/trigger_emergency`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: userId, latitude: lat, longitude: lon })
        });
        triggerData = await triggerRes.json();
        window.lastDispatchedServices = triggerData.services || {};
    } catch (error) {
        console.error("Emergency trigger API failed, using defaults", error);
    }

    // Get Triage Guidance
    try {
        let triageRes = await fetch(`${API_BASE_URL}/ai_triage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: emergencyType, services: window.lastDispatchedServices })
        });
        let triageData = await triageRes.json();
        outputDiv.innerHTML = triageData.suggestions.join("<br><br>");
    } catch(err) {
        outputDiv.innerHTML = "<strong style='color:red;'>Call 112 immediately. Keep the victim breathing and conscious.</strong>";
    }
}

// =========================================================
// 3. AI CHATBOT FUNCTIONALITY
// =========================================================
async function sendChatMessage() {
    const inputField = document.getElementById('chat-input');
    const chatOutput = document.getElementById('chat-output');
    if (!inputField || !chatOutput) return;
    
    const message = inputField.value.trim();
    if (!message) return;

    chatHistory.push({role: 'user', content: message});
    chatOutput.innerHTML += `<div style="margin: 5px 0; text-align: right;"><b style="color: #0056b3;">You:</b> ${message}</div>`;
    inputField.value = "";
    chatOutput.scrollTop = chatOutput.scrollHeight;

    try {
        let response = await fetch(`${API_BASE_URL}/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                message: message, 
                services: window.lastDispatchedServices || {},
                history: chatHistory
            })
        });
        let data = await response.json();
        
        chatHistory.push({role: 'assistant', content: data.response});
        if (chatHistory.length > 12) { chatHistory = chatHistory.slice(-12); } // Cap history length

        chatOutput.innerHTML += `<div style="margin: 5px 0; text-align: left;"><b style="color: #FF003C;">Raksham AI:</b> ${data.response}</div>`;
        chatOutput.scrollTop = chatOutput.scrollHeight;
    } catch (error) {
        console.error("Chat error:", error);
        chatOutput.innerHTML += `<div style="color: red; font-size: 12px;">Network error. Cannot reach AI.</div>`;
    }
}

// =========================================================
// 4. PROFILE MANAGEMENT & LOGIN
// =========================================================
function openMenu() { document.getElementById('edit-menu').style.display = 'block'; }
function closeMenu() { document.getElementById('edit-menu').style.display = 'none'; }

async function saveProfile() {
    const userEmail = localStorage.getItem('raksham_user_email');
    const payload = {
        current_email: userEmail,
        email: document.getElementById('e-email').value.trim(),
        name: document.getElementById('e-name').value,
        blood_group: document.getElementById('e-blood').value,
        allergies: document.getElementById('e-allergies').value,
        conditions: document.getElementById('e-cond').value,
        phone: document.getElementById('e-phone').value,
        em1: document.getElementById('e-em1').value, em2: document.getElementById('e-em2').value,
        em3: document.getElementById('e-em3').value, em4: document.getElementById('e-em4').value,
        em5: document.getElementById('e-em5').value, em6: document.getElementById('e-em6').value
    };

    try {
        let response = await fetch(`${API_BASE_URL}/update_profile`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        let data = await response.json();
        if (!data.error) {
            localStorage.setItem('raksham_user_email', payload.email); 
            window.location.reload();
        } else { alert(data.error); }
    } catch (error) { alert("Failed to update profile."); }
}

async function attemptLogin() {
    const emailInput = document.getElementById('login-email');
    const passwordInput = document.getElementById('login-password');
    if (!emailInput || !passwordInput) return;

    const email = emailInput.value.trim().toLowerCase();
    const password = passwordInput.value.trim();
    if (!email || !password) return alert("Please enter both email and password."); 
    
    try {
        let response = await fetch(`${API_BASE_URL}/login`, { 
            method: 'POST', headers: {'Content-Type': 'application/json'}, 
            body: JSON.stringify({ email: email, password: password }) 
        });
        let data = await response.json();
        if (data.error) { alert(data.error); } 
        else { 
            localStorage.setItem('raksham_user_email', email); 
            window.location.href = 'profile.html'; 
        }
    } catch (error) { alert("Server error. Please try again."); }
}

function logout() {
    localStorage.removeItem('raksham_user_email');
    window.location.href = 'login.html';
}

window.onload = fetchAndDisplayData;
