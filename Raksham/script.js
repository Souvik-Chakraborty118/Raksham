// =========================================================
// RAKSHAM APP - MAIN JAVASCRIPT
// =========================================================

// ⚠️ IMPORTANT: Replace with your actual Render backend URL
const API_BASE_URL = "https://raksham-backend.onrender.com";

// Determine which page the user is currently on
const isProfilePage = window.location.pathname.includes('profile.html');
const isIndexPage = window.location.pathname.includes('index.html') || window.location.pathname === '/' || window.location.pathname === '';

// =========================================================
// 1. DATA LOADER (Handles both QR Scanners & Owners)
// =========================================================
async function fetchAndDisplayData() {
    const urlParams = new URLSearchParams(window.location.search);
    const emergencyId = urlParams.get('id');
    const userEmail = localStorage.getItem('raksham_user_email');

    // 🚨 SCANNED BY STRANGER (Index Page with ?id=...)
    if (isIndexPage && emergencyId) {
        try {
            let response = await fetch(`${API_BASE_URL}/profile/${emergencyId}`);
            let data = await response.json();
            if (!data.error) {
                populateIndexDOM(data);
            } else {
                console.warn("Emergency profile not found.");
            }
        } catch (error) {
            console.error("Error fetching public profile:", error);
        }
    } 
    // 👤 OWNER LOGGED IN (Profile Page)
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
                
                // Show QR Code and Download Button
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
                window.location.href = 'login.html'; // Invalid data, kick to login
            }
        } catch (error) {
            console.error("Error fetching private profile:", error);
        }
    } 
    // 👤 UNAUTHENTICATED ON PROFILE PAGE -> KICK TO LOGIN
    else if (isProfilePage && !userEmail) {
        window.location.href = 'login.html';
    }
}

// --- FILLS DATA ON INDEX.HTML (Public View) ---
function populateIndexDOM(data) {
    const setText = (id, text) => { if (document.getElementById(id)) document.getElementById(id).innerText = text || "N/A"; };
    
    setText('profile-name', data.name);
    setText('profile-blood', data.blood_group);
    setText('profile-allergies', data.allergies);
    setText('profile-conditions', data.conditions);
    setText('profile-phone', data.phone);

    // Make Emergency Contacts clickable
    const setLink = (id, phone) => {
        const el = document.getElementById(id);
        if (el && phone) {
            el.innerHTML = `<a href="tel:${phone}" style="color:#FF003C; font-weight:bold;">${phone}</a>`;
        }
    };
    setLink('profile-em1', data.em1);
    setLink('profile-em2', data.em2);
    setLink('profile-em3', data.em3);
    setLink('profile-em4', data.em4);
    setLink('profile-em5', data.em5);
    setLink('profile-em6', data.em6);

    // 🔧 NEW: show AI-summarized medical history if present and not hidden by the user
    const summaryEl = document.getElementById('profile-medical-summary');
    const summaryBox = document.getElementById('medical-history-box');
    if (summaryEl) {
        if (data.medical_summary) {
            summaryEl.innerText = data.medical_summary;
            if (summaryBox) summaryBox.style.display = 'block';
        } else if (summaryBox) {
            summaryBox.style.display = 'none';
        }
    }
}

// --- FILLS DATA ON PROFILE.HTML (Owner View) ---
function populateProfileDOM(data) {
    const setText = (id, text) => { if (document.getElementById(id)) document.getElementById(id).innerText = text || "N/A"; };
    const setInput = (id, text) => { if (document.getElementById(id)) document.getElementById(id).value = text || ""; };

    // Fill Display Data
    setText('v-email', data.email);
    setText('v-name', data.name);
    setText('v-blood', data.blood_group);
    setText('v-allergies', data.allergies);
    setText('v-cond', data.conditions);
    setText('v-phone', data.phone);
    setText('v-em1', data.em1);
    setText('v-em2', data.em2);
    setText('v-em3', data.em3);
    setText('v-em4', data.em4);
    setText('v-em5', data.em5);
    setText('v-em6', data.em6);

    // Pre-fill Edit Menu
    setInput('e-email', data.email);
    setInput('e-name', data.name);
    setInput('e-blood', data.blood_group);
    setInput('e-allergies', data.allergies);
    setInput('e-cond', data.conditions);
    setInput('e-phone', data.phone);
    setInput('e-em1', data.em1);
    setInput('e-em2', data.em2);
    setInput('e-em3', data.em3);
    setInput('e-em4', data.em4);
    setInput('e-em5', data.em5);
    setInput('e-em6', data.em6);
}

// --- VOICE TO TEXT (Listen to User) ---
function startVoiceRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        alert("Voice input is not supported in this browser. Please type your message.");
        return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'en-IN'; // Set to India English (can use en-US too)
    recognition.interimResults = false;
    
    const micBtn = document.getElementById('mic-btn');
    const originalBg = micBtn.style.background;
    
    // Turn button red while recording
    micBtn.style.background = '#FF003C'; 

    recognition.start();

    recognition.onresult = (event) => {
        const speechResult = event.results[0][0].transcript;
        document.getElementById('chat-input').value = speechResult;
        
        // Auto-send the message immediately to save time in an emergency
        sendChatMessage(); 
    };

    recognition.onerror = (event) => {
        console.error("Speech recognition error:", event.error);
    };

    recognition.onend = () => {
        // Revert button color when done
        micBtn.style.background = originalBg; 
    };
}

// --- TEXT TO VOICE (Read AI Response Aloud) ---
function speakText(text) {
    if (!('speechSynthesis' in window)) return;
    
    // Stop any current audio before starting a new one
    window.speechSynthesis.cancel(); 
    
    // Strip out HTML tags (like <b> or <br>) and markdown so it sounds natural
    const cleanText = text.replace(/<\/?[^>]+(>|$)/g, "").replace(/[*_#]/g, "");
    
    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.lang = 'en-IN'; // Set voice accent
    utterance.rate = 1.05;    // Speak slightly faster for emergencies
    
    window.speechSynthesis.speak(utterance);
}
// =========================================================
// 2. EMERGENCY TRIGGER SEQUENCE (Index.html Logic)
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
    
    // 👇 FIX: Reveal the chatbot IMMEDIATELY so it never gets stuck hidden
    const chatBox = document.getElementById('chat-box');
    if (chatBox) chatBox.style.display = 'block';
    
    const outputDiv = document.getElementById('ai-suggestions');
    outputDiv.innerHTML = "<span style='color:#333;'>Acquiring secure GPS lock... Please click 'Allow' on your browser prompt.</span>";
    
    let lat = null;
    let lon = null;
    
    try {
        // FORCE BROWSER TO WAIT FOR GPS PERMISSION
        const position = await new Promise((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true, 
            timeout: 20000, 
            maximumAge: 0
        });
    });
        lat = position.coords.latitude;
        lon = position.coords.longitude;
    } catch (error) {
        console.warn("GPS Failed:", error);
    }

    const urlParams = new URLSearchParams(window.location.search);
    const userId = urlParams.get('id') || "unknown_scan";

    try {
        if (lat) {
            outputDiv.innerHTML = "<span style='color:green;'>GPS Locked! Waking up dispatch servers...</span>";
        } else {
            outputDiv.innerHTML = "<span style='color:red;'>GPS denied. Proceeding with national dispatch...</span>";
        }

        // Trigger SMS and get nearest hospitals
        let triggerRes = await fetch(`${API_BASE_URL}/trigger_emergency`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: userId, latitude: lat, longitude: lon })
        });
        
        // If backend is sleeping/returns 502 HTML, catch it before it breaks the JSON parser
        if (!triggerRes.ok) throw new Error("Backend waking up or network error");
        
        let triggerData = await triggerRes.json();
        window.lastDispatchedServices = triggerData.services || {};

        // START LIVE GPS TRACKING
        if (navigator.geolocation) {
            navigator.geolocation.watchPosition(async (pos) => {
                try {
                    await fetch(`${API_BASE_URL}/update_location`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ user_id: userId, lat: pos.coords.latitude, lon: pos.coords.longitude })
                    });
                } catch (e) {
                    console.error("Live tracking update failed", e);
                }
            }, (err) => {
                console.warn("Live tracking lost:", err);
            }, { enableHighAccuracy: true, maximumAge: 0 });
        }

        // Get AI Medical Guidance
        let triageRes = await fetch(`${API_BASE_URL}/ai_triage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: emergencyType, services: triggerData.services })
        });
        let triageData = await triageRes.json();

        outputDiv.innerHTML = triageData.suggestions.join("<br><br>");

    } catch (error) {
        console.error("Emergency trigger failed:", error);
        window.lastDispatchedServices = {};
        outputDiv.innerHTML = `
            <strong style='color:red;'>Network timeout (Server waking up). Showing default emergency numbers:</strong><br><br>
            🏥 Hospital: <a href='tel:112' style='color:#FF003C;'>112</a><br>
            🚓 Police: <a href='tel:100' style='color:#FF003C;'>100</a><br>
            🚑 Ambulance: <a href='tel:102' style='color:#FF003C;'>102</a>
        `;
    }
}


// =========================================================
// 3. PROFILE MANAGEMENT (Profile.html Logic)
// =========================================================
function openMenu() {
    document.getElementById('edit-menu').style.display = 'block';
}

function closeMenu() {
    document.getElementById('edit-menu').style.display = 'none';
}

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
        em1: document.getElementById('e-em1').value,
        em2: document.getElementById('e-em2').value,
        em3: document.getElementById('e-em3').value,
        em4: document.getElementById('e-em4').value,
        em5: document.getElementById('e-em5').value,
        em6: document.getElementById('e-em6').value
    };

    try {
        let response = await fetch(`${API_BASE_URL}/update_profile`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        let data = await response.json();
        
        if (!data.error) {
            localStorage.setItem('raksham_user_email', payload.email); // Update local storage if email changed
            window.location.reload(); // Refresh to show new data
        } else {
            alert(data.error);
        }
    } catch (error) {
        alert("Failed to update profile. Please try again.");
    }
}
// 🔧 FIX: rolling chat history so the AI has conversational context
window.chatHistory = window.chatHistory || [];

async function sendChatMessage() {
    const inputField = document.getElementById('chat-input');
    const chatOutput = document.getElementById('chat-output');

    if (!inputField || !chatOutput) return;

    const message = inputField.value.trim();
    if (!message) return;

    chatOutput.innerHTML += `<div class="user-msg"><b>You:</b> ${escapeHtml(message)}</div>`;
    inputField.value = "";
    chatOutput.scrollTop = chatOutput.scrollHeight;

    window.chatHistory.push({ role: 'user', content: message });

    // typing indicator
    const typingId = 'typing-' + Date.now();
    chatOutput.innerHTML += `<div class="ai-msg" id="${typingId}"><b>Raksham AI:</b> <em>typing...</em></div>`;
    chatOutput.scrollTop = chatOutput.scrollHeight;

    try {
        let response = await fetch(`${API_BASE_URL}/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                message: message, 
                services: window.lastDispatchedServices || {},
                history: window.chatHistory.slice(-6)
            })
        });
        let data = await response.json();
        
        const typingEl = document.getElementById(typingId);
        if (typingEl) typingEl.remove();
        
        chatOutput.innerHTML += `<div class="ai-msg"><b>Raksham AI:</b> ${escapeHtml(data.response)}</div>`;
        chatOutput.scrollTop = chatOutput.scrollHeight;
        
        speakText(data.response); 
        
        window.chatHistory.push({ role: 'assistant', content: data.response });
        if (window.chatHistory.length > 12) {
            window.chatHistory = window.chatHistory.slice(-12);
        }
    } catch (error) { // <-- CORRECTED: Removed the extra bracket here
        console.error("Chat error:", error);
        const typingEl = document.getElementById(typingId);
        if (typingEl) typingEl.remove();
        chatOutput.innerHTML += `<div class="ai-msg"><b>Raksham AI:</b> Connection issue. If this is urgent, call 112.</div>`;
    }
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.innerText = str;
    return div.innerHTML;
}

// Allow pressing Enter in chat input
document.addEventListener('DOMContentLoaded', () => {
    const chatInput = document.getElementById('chat-input');
    if (chatInput) {
        chatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') sendChatMessage();
        });
    }
});

// =========================================================
// 3B. MEDICAL REPORT UPLOAD + AI SUMMARIZATION
// =========================================================

// Resizes/compresses an image client-side before sending to the backend,
// so we don't ship multi-MB photos to the DB.
function resizeImageClientSide(file, maxWidth = 1200, quality = 0.7) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const scale = Math.min(1, maxWidth / img.width);
                const canvas = document.createElement('canvas');
                canvas.width = img.width * scale;
                canvas.height = img.height * scale;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                resolve(canvas.toDataURL('image/jpeg', quality));
            };
            img.onerror = reject;
            img.src = e.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

async function uploadMedicalReport() {
    const fileInput = document.getElementById('e-report-upload');
    const previewDiv = document.getElementById('report-summary-preview');
    const userEmail = localStorage.getItem('raksham_user_email');

    if (!fileInput || !fileInput.files[0]) {
        alert("Please choose an image of your medical report first.");
        return;
    }
    if (!userEmail) {
        alert("You must be logged in.");
        return;
    }

    if (previewDiv) previewDiv.innerHTML = "<em>Uploading & analyzing report... this can take a few seconds.</em>";

    try {
        const resizedBase64 = await resizeImageClientSide(fileInput.files[0]);

        let response = await fetch(`${API_BASE_URL}/upload_medical_report`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: userEmail, image_base64: resizedBase64 })
        });
        let data = await response.json();

        if (data.error) {
            if (previewDiv) previewDiv.innerHTML = `<span style="color:red;">${data.error}</span>`;
        } else {
            if (previewDiv) previewDiv.innerText = data.summary;
        }
    } catch (error) {
        console.error("Report upload failed:", error);
        if (previewDiv) previewDiv.innerHTML = `<span style="color:red;">Upload failed. Please try again.</span>`;
    }
}

async function setMedicalVisibility(showSummary) {
    const userEmail = localStorage.getItem('raksham_user_email');
    if (!userEmail) return;
    try {
        await fetch(`${API_BASE_URL}/set_medical_visibility`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: userEmail, show_medical_summary: showSummary })
        });
    } catch (error) {
        console.error("Failed to update visibility:", error);
    }
}

// =========================================================
// 4. LOGIN LOGIC
// ========================================================
async function attemptLogin() {
    const emailInput = document.getElementById('login-email');
    const passwordInput = document.getElementById('login-password');
    
    if (!emailInput || !passwordInput) return;
    
    const email = emailInput.value.trim().toLowerCase();
    const password = passwordInput.value.trim();
    
    if (!email || !password) return alert("Please enter both email and password."); 
          
    try {
        let response = await fetch(`${API_BASE_URL}/login`, { 
             method: 'POST', 
             headers: {'Content-Type': 'application/json'}, 
             body: JSON.stringify({ email: email, password: password }) 
         });
        let data = await response.json();
                 
        if (data.error) { 
             alert(data.error); 
         } else { 
             localStorage.setItem('raksham_user_email', email); 
             window.location.href = 'profile.html'; 
         }
    } catch (error) { 
         alert("Server error. Please try again."); 
    }
} // <-- THIS BRACKET WAS MISSING

function logout() {
    localStorage.removeItem('raksham_user_email');
    window.location.href = 'login.html';
} // <-- THIS BRACKET WAS ALSO MISSING

// Execute data fetching on page load
window.onload = fetchAndDisplayData;
