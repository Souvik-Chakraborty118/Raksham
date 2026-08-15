let countdownTimer;
let timeLeft = 10;
let isEditMode = false;
let dispatchedServices = {}; 
let liveWatchId = null;
let emergencyPromise = null; 

const API_BASE_URL = 'https://raksham-backend.onrender.com';

window.onload = async () => {
    const publicProfileName = document.getElementById('profile-name');
    if (publicProfileName) {
        const urlParams = new URLSearchParams(window.location.search);
        const userId = urlParams.get('id');
        if (userId) {
            await loadUserProfile(userId);
        } else {
            publicProfileName.innerText = "Scan a valid QR code.";
        }
    }

    const viewEmailField = document.getElementById('v-email');
    if (viewEmailField) {
        await loadProfileData();
    }
};

async function loadUserProfile(userId) {
    try {
        let response = await fetch(`${API_BASE_URL}/profile/${userId}`);
        let data = await response.json();
        if (data.error) {
            document.getElementById('profile-name').innerText = "User not found";
            return;
        }
        document.getElementById('profile-name').innerText = data.name || 'N/A';
        document.getElementById('profile-blood').innerText = data.blood_group || 'N/A';
        document.getElementById('profile-allergies').innerText = data.allergies || 'N/A';
        document.getElementById('profile-conditions').innerText = data.conditions || 'N/A';
        document.getElementById('profile-phone').innerText = data.phone || 'N/A';
        document.getElementById('profile-em1').innerText = data.em1 || 'N/A';
        document.getElementById('profile-em2').innerText = data.em2 || 'N/A';
        document.getElementById('profile-em3').innerText = data.em3 || 'N/A';
        document.getElementById('profile-em4').innerText = data.em4 || 'N/A';
        document.getElementById('profile-em5').innerText = data.em5 || 'N/A';
        document.getElementById('profile-em6').innerText = data.em6 || 'N/A';
    } catch (error) {
        document.getElementById('profile-name').innerText = "Connection Error";
    }
}

function startCountdown() {
    document.getElementById('main-screen').classList.add('hidden');
    document.getElementById('countdown-screen').classList.remove('hidden');
    countdownTimer = setInterval(() => {
        timeLeft--;
        document.getElementById('timer-display').innerText = timeLeft;
        if (timeLeft <= 0) {
            clearInterval(countdownTimer);
            triggerBackendAlert();
        }
    }, 1000);
}

function cancelEmergency() {
    clearInterval(countdownTimer);
    timeLeft = 10;
    document.getElementById('timer-display').innerText = timeLeft;
    document.getElementById('countdown-screen').classList.add('hidden');
    document.getElementById('main-screen').classList.remove('hidden');
}

async function triggerBackendAlert() {
    document.getElementById('countdown-screen').classList.add('hidden');
    document.getElementById('triage-screen').classList.remove('hidden');
    const urlParams = new URLSearchParams(window.location.search);
    const userId = urlParams.get('id');
    
    emergencyPromise = new Promise((resolve) => {
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
                async (position) => {
                    liveWatchId = navigator.geolocation.watchPosition((pos) => {
                        fetch(`${API_BASE_URL}/update_location`, {
                            method: 'POST',
                            headers: {'Content-Type': 'application/json'},
                            body: JSON.stringify({ user_id: userId, lat: pos.coords.latitude, lon: pos.coords.longitude })
                        });
                    }, (err) => console.log(err), { enableHighAccuracy: true });

                    await sendEmergencyPayload({ user_id: userId, latitude: position.coords.latitude, longitude: position.coords.longitude });
                    resolve();
                },
                async (error) => {
                    if (error.code === error.PERMISSION_DENIED) {
                        alert("⚠️ LOCATION ACCESS DENIED!\n\nPlease allow location permissions so rescue services can find you.");
                    }
                    await sendEmergencyPayload({ user_id: userId });
                    resolve();
                },
                { timeout: 10000 } 
            );
        } else {
            sendEmergencyPayload({ user_id: userId }).then(resolve);
        }
    });
}

async function sendEmergencyPayload(payload) {
    try {
        let response = await fetch(`${API_BASE_URL}/trigger_emergency`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(payload)
        });
        let data = await response.json();
        if (data.services) {
            dispatchedServices = data.services;
        }
    } catch (error) {
        console.log("Backend not connected yet.");
    }
}

async function sendTriage(type) {
    if (!emergencyPromise) {
        clearInterval(countdownTimer);
        triggerBackendAlert(); 
    }

    document.getElementById('triage-screen').classList.add('hidden');
    document.getElementById('guidance-screen').classList.remove('hidden');
    document.getElementById('ai-suggestions').innerHTML = "<h3 style='color:#FF003C;'>Connecting to satellites and dispatching services...</h3><p>Please wait up to 5 seconds for GPS to lock on.</p>";
    
    await emergencyPromise;
    
    try {
        let response = await fetch(`${API_BASE_URL}/ai_triage`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ type: type, services: dispatchedServices })
        });
        let data = await response.json();
        
        let formattedText = Array.isArray(data.suggestions) ? data.suggestions.join('<br><br>') : data.suggestions;
        
        document.getElementById('ai-suggestions').innerHTML = `
            ${formattedText}
            <br><br>
            <button onclick="readAloud()" style="background:#000; color:#fff; padding:12px; border:none; width:100%; border-radius:8px; margin-bottom:15px; font-weight:bold; font-size:14px; cursor:pointer;">🔊 READ ALOUD</button>
            <button onclick="alertAuthorities()" style="background:#FF003C; color:#fff; padding:15px; border:none; width:100%; border-radius:8px; font-weight:900; font-size:16px; cursor:pointer; box-shadow: 0px 4px 10px rgba(255,0,60,0.4);">🚨 ALERT NEAREST AUTHORITIES</button>
            <div id="chat-container" style="margin-top:25px; border:2px solid #eee; border-radius:8px; padding:10px; background:#fff;">
                <div id="chat-log" style="height:150px; overflow-y:auto; font-size:14px; margin-bottom:10px; padding:5px; text-align:left;">
                    <em style="color:#888;">Raksham AI Assistant: Ask me anything regarding first-aid.</em><br>
                </div>
                <div style="display:flex; gap:5px;">
                    <input type="text" id="chat-input" placeholder="Type a medical question..." style="width:75%; padding:10px; border:1px solid #ccc; border-radius:5px;">
                    <button onclick="sendChatMessage()" style="width:25%; padding:10px; background:#FF003C; color:white; border:none; border-radius:5px; font-weight:bold; cursor:pointer;">ASK</button>
                </div>
            </div>
        `;
    } catch (error) {
        document.getElementById('ai-suggestions').innerHTML = "Emergency logged. Please wait for the ambulance.";
    }
}

async function alertAuthorities() {
    alert("Dispatching coordinates to local authorities. Please hold.");
    try {
        let res = await fetch(`${API_BASE_URL}/alert_authorities`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({services: dispatchedServices})
        });
        let data = await res.json();
        alert(data.message);
    } catch (e) {
        alert("Failed to connect to local dispatch.");
    }
}

async function sendChatMessage() {
    const input = document.getElementById('chat-input');
    const log = document.getElementById('chat-log');
    const msg = input.value;
    if (!msg) return;

    log.innerHTML += `<div style="margin-top:8px;"><strong>You:</strong> ${msg}</div>`;
    input.value = '';
    log.scrollTop = log.scrollHeight;

    try {
        let res = await fetch(`${API_BASE_URL}/chat`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({message: msg})
        });
        let data = await res.json();
        log.innerHTML += `<div style="margin-top:8px;"><strong style='color:#FF003C;'>AI:</strong> ${data.reply}</div>`;
        log.scrollTop = log.scrollHeight;
    } catch(e) {
        log.innerHTML += `<div style="margin-top:8px;"><strong style='color:#FF003C;'>AI:</strong> Network error. Cannot reach servers.</div>`;
    }
}

function readAloud() {
    let rawHtml = document.getElementById('ai-suggestions').innerHTML;
    let cleanText = rawHtml.replace(/<[^>]*>?/gm, ' ');
    cleanText = cleanText.replace(/READ ALOUD/g, '').replace(/ALERT NEAREST AUTHORITIES/g, '').replace(/Raksham AI Assistant.*/g, '');
    
    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.rate = 0.9; 
    window.speechSynthesis.speak(utterance);
}

async function registerUser() {
    const userData = {
        email: document.getElementById('email').value, password: document.getElementById('password').value,
        name: document.getElementById('name').value, blood_group: document.getElementById('blood').value,
        allergies: document.getElementById('allergies').value || 'None', conditions: document.getElementById('conditions').value || 'None',
        phone: document.getElementById('phone').value, em1: document.getElementById('em1').value,
        em2: document.getElementById('em2').value, em3: document.getElementById('em3').value,
        em4: document.getElementById('em4').value, em5: document.getElementById('em5').value,
        em6: document.getElementById('em6').value
    };
    try {
        let response = await fetch(`${API_BASE_URL}/register`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(userData) });
        let data = await response.json();
        if (data.error) { alert(data.error); } 
        else { localStorage.setItem('raksham_user_email', userData.email); window.location.href = 'profile.html'; }
    } catch (error) { alert("Server error."); }
}

async function attemptLogin() {
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    if (!email || !password) { alert("Enter your email and password."); return; }
    try {
        let response = await fetch(`${API_BASE_URL}/login`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({email: email, password: password}) });
        let data = await response.json();
        if (data.error) { alert(data.error); } 
        else { localStorage.setItem('raksham_user_email', email); window.location.href = 'profile.html'; }
    } catch (error) { alert("Server error."); }
}

async function loadProfileData() {
    const userEmail = localStorage.getItem('raksham_user_email');
    if (!userEmail) { window.location.href = 'login.html'; return; }
    try {
        let response = await fetch(`${API_BASE_URL}/retrieve_profile_data`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({email: userEmail}) });
        let data = await response.json();
        if (data.error) { alert("Error loading data."); } 
        else {
            const u = data.user_data;
            document.getElementById('v-email').innerText = u.email; document.getElementById('v-name').innerText = u.name;
            document.getElementById('v-blood').innerText = u.blood_group; document.getElementById('v-allergies').innerText = u.allergies;
            document.getElementById('v-cond').innerText = u.conditions; document.getElementById('v-phone').innerText = u.phone;
            document.getElementById('v-em1').innerText = u.em1; document.getElementById('v-em2').innerText = u.em2;
            document.getElementById('v-em3').innerText = u.em3; document.getElementById('v-em4').innerText = u.em4;
            document.getElementById('v-em5').innerText = u.em5; document.getElementById('v-em6').innerText = u.em6;

            if (document.getElementById('e-email')) {
                document.getElementById('e-email').value = u.email; document.getElementById('e-name').value = u.name;
                document.getElementById('e-blood').value = u.blood_group; document.getElementById('e-allergies').value = u.allergies;
                document.getElementById('e-cond').value = u.conditions; document.getElementById('e-phone').value = u.phone;
                document.getElementById('e-em1').value = u.em1; document.getElementById('e-em2').value = u.em2;
                document.getElementById('e-em3').value = u.em3; document.getElementById('e-em4').value = u.em4;
                document.getElementById('e-em5').value = u.em5; document.getElementById('e-em6').value = u.em6;
            }

            if (document.getElementById('qr-image')) {
                document.getElementById('qr-image').src = data.qr_image;
                document.getElementById('qr-image').style.display = "block";
                document.getElementById('download-link').href = data.qr_image;
                document.getElementById('download-btn').style.display = "inline-block";
            }
        }
    } catch (error) { console.error("Error retrieving profile data:", error); }
}

function openMenu() { document.getElementById('edit-menu').style.display = "block"; }
function closeMenu() { document.getElementById('edit-menu').style.display = "none"; }

async function saveProfile() {
    const payload = {
        current_email: localStorage.getItem('raksham_user_email'), email: document.getElementById('e-email').value,
        name: document.getElementById('e-name').value, blood_group: document.getElementById('e-blood').value,
        allergies: document.getElementById('e-allergies').value, conditions: document.getElementById('e-cond').value,
        phone: document.getElementById('e-phone').value, em1: document.getElementById('e-em1').value,
        em2: document.getElementById('e-em2').value, em3: document.getElementById('e-em3').value,
        em4: document.getElementById('e-em4').value, em5: document.getElementById('e-em5').value,
        em6: document.getElementById('e-em6').value
    };
    try {
        let response = await fetch(`${API_BASE_URL}/update_profile`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload) });
        let data = await response.json();
        if (data.error) { alert(data.error); } 
        else {
            localStorage.setItem('raksham_user_email', payload.email);
            closeMenu(); await loadProfileData(); alert("Updated successfully.");
        }
    } catch (error) { alert("Error updating profile details."); }
}

function logout() { localStorage.removeItem('raksham_user_email'); window.location.href = 'login.html'; }
