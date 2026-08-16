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
    
    const outputDiv = document.getElementById('ai-suggestions');
    outputDiv.innerHTML = "<span style='color:#333;'>Acquiring secure GPS lock... Please click 'Allow' on your browser prompt.</span>";
    
    let lat = null;
    let lon = null;
    
    try {
        // FORCE BROWSER TO WAIT FOR GPS PERMISSION
        const position = await new Promise((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true, 
            timeout: 20000, // Increased to 20 seconds
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
            outputDiv.innerHTML = "<span style='color:green;'>GPS Locked! Finding exact closest hospitals and alerting contacts...</span>";
        } else {
            outputDiv.innerHTML = "<span style='color:red;'>GPS denied. Proceeding with national dispatch...</span>";
        }

        // Trigger SMS and get nearest hospitals
        let triggerRes = await fetch(`${API_BASE_URL}/trigger_emergency`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: userId, latitude: lat, longitude: lon })
        });
        let triggerData = await triggerRes.json();

        // Get AI Medical Guidance based on situation
        let triageRes = await fetch(`${API_BASE_URL}/ai_triage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: emergencyType, services: triggerData.services })
        });
        let triageData = await triageRes.json();

        // The python backend already packages the exact direction links and contact info.
        outputDiv.innerHTML = triageData.suggestions.join("<br><br>");
        
    } catch (error) {
        console.error("Emergency trigger failed:", error);
        outputDiv.innerHTML = "<strong style='color:red;'>CRITICAL NETWORK ERROR. CALL 112 IMMEDIATELY!</strong>";
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
async function sendChatMessage() {
    const inputField = document.getElementById('chat-input'); // Update to your chat input ID
    const chatOutput = document.getElementById('chat-output'); // Update to your chat display ID
    
    if (!inputField || !chatOutput) return;
    
    const message = inputField.value.trim();
    if (!message) return;

    // Display user message in chat UI
    chatOutput.innerHTML += `<div class="user-msg"><b>You:</b> ${message}</div>`;
    inputField.value = "";

    try {
        let response = await fetch(`${API_BASE_URL}/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                message: message, 
                services: window.lastDispatchedServices || {} // Passes current hospital context if stored
            })
        });
        let data = await response.json();
        
        // Display AI response in chat UI
        chatOutput.innerHTML += `<div class="ai-msg"><b>Raksham AI:</b> ${data.response}</div>`;
        chatOutput.scrollTop = chatOutput.scrollHeight;
    } catch (error) {
        console.error("Chat error:", error);
    }
}

// =========================================================
// 4. LOGIN LOGIC
// =========================================================
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
}

function logout() {
    localStorage.removeItem('raksham_user_email');
    window.location.href = 'login.html';
}

// Execute data fetching on page load
window.onload = fetchAndDisplayData;
