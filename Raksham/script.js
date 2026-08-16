// =========================================================
// RAKSHAM APP - MAIN JAVASCRIPT
// =========================================================

const API_BASE_URL = "https://raksham-backend.onrender.com";

// =========================================================
// 1. DYNAMIC DATA LOADER (For QR Scanners AND Profile Owners)
// =========================================================
async function fetchAndDisplayData() {
    const urlParams = new URLSearchParams(window.location.search);
    const emergencyId = urlParams.get('id');
    const userEmail = localStorage.getItem('raksham_user_email');
    const isProfilePage = window.location.pathname.includes('profile.html');

    // SCENARIO A: A STRANGER SCANNED THE QR CODE (URL has ?id=...)
    if (emergencyId) {
        try {
            let response = await fetch(`${API_BASE_URL}/profile/${emergencyId}`);
            let data = await response.json();
            
            if (!data.error) {
                populateDOM(data);
            } else {
                console.warn("Emergency profile not found in database.");
            }
        } catch (error) {
            console.error("Error fetching public profile:", error);
        }
    } 
    // SCENARIO B: THE OWNER IS VIEWING THEIR PRIVATE PROFILE PAGE
    else if (userEmail) {
        try {
            let response = await fetch(`${API_BASE_URL}/retrieve_profile_data`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: userEmail })
            });
            let data = await response.json();
            
            if (!data.error) {
                populateDOM(data.user_data);
                // Set QR Image if the image element exists on the page
                const qrImg = document.getElementById('qr-image-display');
                if (qrImg && data.qr_image) {
                    qrImg.src = data.qr_image;
                }
            } else if (isProfilePage) {
                // Only redirect if they are actually on the profile page with invalid data
                window.location.href = 'login.html';
            }
        } catch (error) {
            console.error("Error fetching private profile:", error);
        }
    }
}

// Safely updates text and links on the screen ONLY if the HTML element exists
function populateDOM(data) {
    const setText = (id, text) => {
        const el = document.getElementById(id);
        if (el) el.innerText = text || "N/A";
    };

    setText('profile-name', data.name);
    setText('profile-blood', data.blood_group);
    setText('profile-allergies', data.allergies);
    setText('profile-conditions', data.conditions);

    // Update emergency contacts
    const setLink = (id, phone) => {
        const el = document.getElementById(id);
        if (el && phone) {
            el.href = `tel:${phone}`;
            el.innerText = phone;
        }
    };

    setLink('em1-link', data.em1);
    setLink('em2-link', data.em2);
    setLink('em3-link', data.em3);
    setLink('em4-link', data.em4);
    setLink('em5-link', data.em5);
    setLink('em6-link', data.em6);
}

// =========================================================
// 2. SECURE LOGIN FUNCTION
// =========================================================
async function attemptLogin() {
    const emailInput = document.getElementById('login-email');
    const passwordInput = document.getElementById('login-password');
    
    if (!emailInput || !passwordInput) return;

    // Clean inputs to prevent invisible space errors
    const email = emailInput.value.trim().toLowerCase();
    const password = passwordInput.value.trim();
    
    if (!email || !password) { 
        alert("Please enter both email and password."); 
        return; 
    }
    
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
        console.error("Login error:", error);
    }
}

// =========================================================
// 3. SMART EMERGENCY TRIAGE (Forces GPS wait before calling backend)
// =========================================================
async function triggerEmergencySequence(emergencyType = "general") {
    const outputDiv = document.getElementById('triage-output');
    
    if (outputDiv) {
        outputDiv.innerHTML = "<span style='color:#FF003C; font-weight:bold;'>Acquiring secure GPS lock... Please click 'Allow' on your browser prompt.</span>";
    }
    
    let lat = null;
    let lon = null;
    
    try {
        // Force browser to pause and wait until user clicks "Allow" (times out after 10 seconds)
        const position = await new Promise((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, {
                enableHighAccuracy: true,
                timeout: 10000 
            });
        });
        lat = position.coords.latitude;
        lon = position.coords.longitude;
    } catch (error) {
        console.warn("GPS failed or user denied permission:", error);
        if (outputDiv) outputDiv.innerHTML = "<span style='color:red;'>GPS access denied. Proceeding with national fallback dispatch...</span><br><br>";
    }

    const urlParams = new URLSearchParams(window.location.search);
    const userId = urlParams.get('id') || "unknown_scan";

    try {
        if (outputDiv && lat) {
            outputDiv.innerHTML = "<span style='color:green; font-weight:bold;'>GPS Locked!</span><br>Calculating nearest medical facilities & alerting contacts...";
        }

        // 1. Trigger Python /trigger_emergency route
        let triggerRes = await fetch(`${API_BASE_URL}/trigger_emergency`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: userId, latitude: lat, longitude: lon })
        });
        let triggerData = await triggerRes.json();

        // 2. Trigger Python /ai_triage route for medical suggestions
        let triageRes = await fetch(`${API_BASE_URL}/ai_triage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                type: emergencyType, 
                services: triggerData.services 
            })
        });
        let triageData = await triageRes.json();

        // 3. Output results to the screen
        if (outputDiv) {
            outputDiv.innerHTML = triageData.suggestions.join("<br><br>");
        }
        
    } catch (error) {
        console.error("Emergency trigger failed:", error);
        if (outputDiv) outputDiv.innerHTML = "<strong style='color:red;'>CRITICAL NETWORK ERROR. CALL 112 IMMEDIATELY!</strong>";
    }
}

// =========================================================
// 4. UTILITIES
// =========================================================
function logout() {
    localStorage.removeItem('raksham_user_email');
    window.location.href = 'login.html';
}

// Run data fetcher automatically when the script loads
window.onload = () => {
    fetchAndDisplayData();
};
