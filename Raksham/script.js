const API_BASE_URL = "https://raksham-api-zdv4.onrender.com";

const isProfilePage = window.location.pathname.includes('profile.html');
const isIndexPage = window.location.pathname.includes('index.html') || window.location.pathname === '/' || window.location.pathname === '';

window.currentScanLat = null;
window.currentScanLon = null;
window.currentScanAccuracy = Infinity;
window._geoWatchId = null;
window.currentRoutedServices = null;
window.lastDispatchedServices = null;
window.routingPromise = null;
window._localDatasetCache = null;
window.currentProfileData = null;
window.currentLang = localStorage.getItem('raksham_lang') || 'en';
window.lastEmergencyType = null;
window.lastMlSeverityText = null;
window.capturedScenePhotoBase64 = null;

// Wake Render backend immediately on page load
fetch(`${API_BASE_URL}/health`).catch(() => {});

// --- MULTILINGUAL DICTIONARY (EN | বাংলা | हिन्दी) ---
const I18N = {
    en: {
        medical_profile: "Medical Profile",
        lbl_name: "Name:",
        lbl_blood: "Blood Group:",
        lbl_allergies: "Allergies:",
        lbl_conditions: "Conditions:",
        contact_info: "Contact Info",
        lbl_primary: "Primary:",
        lbl_em1: "Emergency 1:",
        lbl_em2: "Emergency 2:",
        lbl_em3: "Emergency 3:",
        lbl_em4: "Emergency 4:",
        lbl_em5: "Emergency 5:",
        lbl_em6: "Emergency 6:",
        med_history: "Medical History Summary",
        btn_report: "REPORT EMERGENCY",
        countdown_title: "ALERTING EMERGENCY CONTACTS IN:",
        prank_warning: "WARNING: Prank alerts are traced by IP Address.",
        btn_cancel: "CANCEL ALARM",
        triage_title: "EMERGENCY TRIGGERED",
        triage_sub: "Select the situation below to get immediate first-aid instructions:",
        btn_crash: "CAR CRASH",
        btn_assault: "PHYSICAL ASSAULT",
        guidance_title: "IMMEDIATE ACTIONS",
        btn_authorities: "🚨 ALERT NEAREST AUTHORITIES (HOSPITAL, POLICE & AMBULANCE)",
        guidance_sub: "Emergency contacts alerted. Stay with the victim.",
        ai_title: "Raksham AI Assistant",
        chat_placeholder: "Ask Raksham AI...",
        btn_send: "Send",
        offline_title: "Weak/No Internet! Send SOS via 2G Cellular SMS:",
        btn_offline_sms: "📩 SEND OFFLINE SMS TO FAMILY",
        btn_call_112: "📞 CALL 112 EMERGENCY",
        verify_title: "Verify & Dispatch Authorities",
        verify_desc: "Snap a live photo of the scene (anti-prank verification & visual triage for doctors), then confirm dispatch.",
        btn_snap_photo: "📸 Snap Live Scene Photo (Camera Only)",
        btn_confirm_dispatch: "🚨 Confirm & Alert Authorities Now",
        btn_close_modal: "Cancel",
        immediate_header: "IMMEDIATE ACTIONS:",
        speech_lang: "en-IN",
        steps_crash: [
            "1. DO NOT move the victim unless they are in immediate danger.",
            "2. Apply firm, direct pressure to any bleeding wounds.",
            "3. Keep the victim's head and neck still."
        ],
        steps_assault: [
            "1. Move to a safe location immediately.",
            "2. Apply direct pressure to stop any bleeding.",
            "3. Wait for police and ambulance dispatch."
        ],
        steps_default: [
            "1. Check airway, breathing, and circulation.",
            "2. Do not leave the victim unattended.",
            "3. Apply firm pressure to any bleeding."
        ]
    },
    bn: {
        medical_profile: "চিকিৎসা তথ্য",
        lbl_name: "নাম:",
        lbl_blood: "রক্তের গ্রুপ:",
        lbl_allergies: "অ্যালার্জি:",
        lbl_conditions: "শারীরিক সমস্যা:",
        contact_info: "জরুরি যোগাযোগ",
        lbl_primary: "নিজের নম্বর:",
        lbl_em1: "জরুরি নম্বর ১:",
        lbl_em2: "জরুরি নম্বর ২:",
        lbl_em3: "জরুরি নম্বর ৩:",
        lbl_em4: "জরুরি নম্বর ৪:",
        lbl_em5: "জরুরি নম্বর ৫:",
        lbl_em6: "জরুরি নম্বর ৬:",
        med_history: "মেডিকেল রিপোর্ট সারসংক্ষেপ",
        btn_report: "জরুরি অবস্থা জানান",
        countdown_title: "পরিবারকে সতর্ক করা হচ্ছে:",
        prank_warning: "সতর্কতা: ভুয়া অ্যালার্ট আইপি অ্যাড্রেসের মাধ্যমে শনাক্ত করা হয়।",
        btn_cancel: "অ্যালার্ম বাতিল করুন",
        triage_title: "জরুরি অ্যালার্ট চালু হয়েছে",
        triage_sub: "তাৎক্ষণিক প্রাথমিক চিকিৎসার জন্য পরিস্থিতি বেছে নিন:",
        btn_crash: "সড়ক দুর্ঘটনা",
        btn_assault: "শারীরিক আক্রমণ",
        guidance_title: "তাৎক্ষণিক করণীয়",
        btn_authorities: "🚨 নিকটতম হাসপাতাল, পুলিশ ও অ্যাম্বুলেন্সকে জানান",
        guidance_sub: "পরিবারকে জানানো হয়েছে। আহত ব্যক্তির পাশে থাকুন।",
        ai_title: "রক্ষম এআই সহায়ক",
        chat_placeholder: "রক্ষম এআই-কে জিজ্ঞাসা করুন...",
        btn_send: "পাঠান",
        offline_title: "নেটওয়ার্ক দুর্বল! ইন্টারনেট ছাড়াই SMS পাঠান:",
        btn_offline_sms: "📩 অফলাইন SMS অ্যালার্ট পাঠান (2G)",
        btn_call_112: "📞 ১১২ জরুরি নম্বরে কল করুন",
        verify_title: "যাচাই করে কর্তৃপক্ষকে জানান",
        verify_desc: "ভুয়া অ্যালার্ট রোধে এবং ডাক্তারের সহায়তার জন্য ঘটনাস্থলের লাইভ ছবি তুলুন, তারপর নিশ্চিত করুন।",
        btn_snap_photo: "📸 লাইভ ছবি তুলুন (শুধু ক্যামেরা)",
        btn_confirm_dispatch: "🚨 নিশ্চিত করুন ও অ্যালার্ট পাঠান",
        btn_close_modal: "বাতিল",
        immediate_header: "তাৎক্ষণিক করণীয়:",
        speech_lang: "bn-IN",
        steps_crash: [
            "১. বড় বিপদ না থাকলে আহত ব্যক্তিকে নড়াবেন না।",
            "২. রক্তপাত হলে পরিষ্কার কাপড় দিয়ে জোরে চেপে ধরুন।",
            "৩. আহত ব্যক্তির মাথা ও ঘাড় স্থির রাখুন।"
        ],
        steps_assault: [
            "১. অবিলম্বে নিরাপদ স্থানে সরে যান।",
            "২. রক্তপাত বন্ধ করতে ক্ষতস্থানে সরাসরি চাপ দিন।",
            "৩. পুলিশ ও অ্যাম্বুলেন্স আসা পর্যন্ত অপেক্ষা করুন।"
        ],
        steps_default: [
            "১. শ্বাস-প্রশ্বাস ও জ্ঞান আছে কিনা পরীক্ষা করুন।",
            "২. আহত ব্যক্তিকে একা ছেড়ে যাবেন না।",
            "৩. রক্তপাত হলে সরাসরি চাপ দিয়ে ধরে রাখুন।"
        ]
    },
    hi: {
        medical_profile: "मेडिकल प्रोफ़ाइल",
        lbl_name: "नाम:",
        lbl_blood: "ब्लड ग्रुप:",
        lbl_allergies: "एलर्जी:",
        lbl_conditions: "बीमारियाँ / स्थितियाँ:",
        contact_info: "आपातकालीन संपर्क",
        lbl_primary: "प्राथमिक नंबर:",
        lbl_em1: "इमरजेंसी 1:",
        lbl_em2: "इमरजेंसी 2:",
        lbl_em3: "इमरजेंसी 3:",
        lbl_em4: "इमरजेंसी 4:",
        lbl_em5: "इमरजेंसी 5:",
        lbl_em6: "इमरजेंसी 6:",
        med_history: "मेडिकल रिपोर्ट सारांश",
        btn_report: "इमरजेंसी रिपोर्ट करें",
        countdown_title: "परिवार को अलर्ट भेजा जा रहा है:",
        prank_warning: "चेतावनी: फ़र्ज़ी अलर्ट IP एड्रेस से ट्रैक किए जाते हैं।",
        btn_cancel: "अलार्म रद्द करें",
        triage_title: "इमरजेंसी अलर्ट सक्रिय",
        triage_sub: "तुरंत प्राथमिक उपचार (First-Aid) के लिए स्थिति चुनें:",
        btn_crash: "सड़क दुर्घटना",
        btn_assault: "शारीरिक हमला",
        guidance_title: "तुरंत करने योग्य कदम",
        btn_authorities: "🚨 नज़दीकी अस्पताल, पुलिस और एम्बुलेंस को अलर्ट करें",
        guidance_sub: "आपातकालीन संपर्कों को सूचित कर दिया गया है। पीड़ित के साथ रहें।",
        ai_title: "रक्षम AI सहायक",
        chat_placeholder: "रक्षम AI से पूछें...",
        btn_send: "भेजें",
        offline_title: "कमज़ोर नेटवर्क! बिना इंटरनेट SMS भेजें:",
        btn_offline_sms: "📩 ऑफ़लाइन SMS SOS भेजें (2G)",
        btn_call_112: "📞 112 पर कॉल करें",
        verify_title: "सत्यापित करें और अलर्ट भेजें",
        verify_desc: "फ़र्ज़ी अलर्ट रोकने और डॉक्टरों की मदद के लिए घटनास्थल की लाइव फ़ोटो लें, फिर पुष्टि करें।",
        btn_snap_photo: "📸 लाइव फ़ोटो लें (केवल कैमरा)",
        btn_confirm_dispatch: "🚨 पुष्टि करें और अलर्ट भेजें",
        btn_close_modal: "रद्द करें",
        immediate_header: "तुरंत करने योग्य कदम:",
        speech_lang: "hi-IN",
        steps_crash: [
            "1. जब तक कोई बड़ा ख़तरा न हो, घायल को न हिलाएं।",
            "2. खून बहने पर साफ़ कपड़े से सीधा दबाव डालें।",
            "3. घायल का सिर और गर्दन बिल्कुल स्थिर रखें।"
        ],
        steps_assault: [
            "1. तुरंत किसी सुरक्षित स्थान पर जाएं।",
            "2. खून रोकने के लिए घाव पर सीधा दबाव डालें।",
            "3. पुलिस और एम्बुलेंस के आने तक इंतज़ार करें।"
        ],
        steps_default: [
            "1. सांस और होश की जांच करें।",
            "2. पीड़ित को अकेला न छोड़ें।",
            "3. खून बहने पर सीधा दबाव बनाए रखें।"
        ]
    }
};

function setLanguage(lang) {
    if (!I18N[lang]) lang = 'en';
    window.currentLang = lang;
    localStorage.setItem('raksham_lang', lang);

    const dict = I18N[lang];
    document.querySelectorAll('.lang-btn').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.lang === lang);
    });
    document.querySelectorAll('[data-i18n]').forEach((el) => {
        const key = el.getAttribute('data-i18n');
        if (dict[key]) el.innerText = dict[key];
    });

    const chatInput = document.getElementById('chat-input');
    if (chatInput && dict.chat_placeholder) chatInput.placeholder = dict.chat_placeholder;

    // Re-render guidance card immediately if already on guidance screen
    if (window.currentRoutedServices && window.lastEmergencyType) {
        renderInstantGuidance(window.currentRoutedServices, window.lastEmergencyType);
    }
}

async function fetchAndDisplayData() {
    const urlParams = new URLSearchParams(window.location.search);
    const emergencyId = urlParams.get('id');
    const userEmail = localStorage.getItem('raksham_user_email');

    if (isIndexPage && emergencyId) {
        const cacheKey = `raksham_cached_profile_${emergencyId}`;
        try {
            let response = await fetch(`${API_BASE_URL}/profile/${emergencyId}`);
            let data = await response.json();
            if (!data.error) {
                window.currentProfileData = data;
                localStorage.setItem(cacheKey, JSON.stringify(data));
                populateIndexDOM(data);
            }
        } catch (error) {
            // Load cached victim data if opened in low-signal area
            const cached = localStorage.getItem(cacheKey);
            if (cached) {
                window.currentProfileData = JSON.parse(cached);
                populateIndexDOM(window.currentProfileData);
            }
            console.error(error);
        }
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

// --- OFFLINE 2G CELLULAR SMS SOS FALLBACK ---
function showOfflineSmsFallback(lat, lon) {
    const box = document.getElementById('offline-sos-box');
    const smsLink = document.getElementById('offline-sms-link');
    if (!box || !smsLink) return;

    const p = window.currentProfileData || {};
    const contacts = [p.em1, p.em2, p.em3, p.em4, p.em5, p.em6]
        .map((c) => (c || '').replace(/[^0-9+]/g, ''))
        .filter((c) => c.length >= 5);

    const recipients = contacts.length ? contacts.join(',') : '112';
    const gpsText = (lat != null && lon != null)
        ? `https://maps.google.com/?q=${lat},${lon}`
        : "GPS unavailable";
    const body = encodeURIComponent(
        `RAKSHAM EMERGENCY SOS! Victim: ${p.name || 'Unknown'} (Blood: ${p.blood_group || 'N/A'}). Needs urgent help at: ${gpsText}`
    );

    const sep = /iPhone|iPad|iPod/i.test(navigator.userAgent) ? '&' : '?';
    smsLink.href = `sms:${recipients}${sep}body=${body}`;
    box.classList.remove('hidden');
}

// --- FAST ROUTER: RENDER BALLTREE+OSRM (3.5s CAP) + INSTANT VERCEL EDGE FALLBACK ---
function haversineKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function buildFallbackServices(lat, lon) {
    return {
        hospital: {
            name: "Emergency Hospital", phone: "112",
            html: `<span style='color:#333; font-weight:bold; font-size:16px;'>Emergency Hospital</span><br>📞 <a href='tel:112' style='color:#FF003C;'>112</a><br>🗺️ <a href='https://www.google.com/maps/search/hospital/@${lat},${lon},15z' target='_blank' rel='noopener' style='color:#0056b3; text-decoration:underline;'>Get Directions</a>`
        },
        police_station: {
            name: "Local Police", phone: "100",
            html: `<span style='color:#333; font-weight:bold; font-size:16px;'>Local Police</span><br>📞 <a href='tel:100' style='color:#FF003C;'>100</a><br>🗺️ <a href='https://www.google.com/maps/search/police/@${lat},${lon},15z' target='_blank' rel='noopener' style='color:#0056b3; text-decoration:underline;'>Get Directions</a>`
        },
        ambulance: {
            name: "108 Emergency Ambulance", phone: "108",
            html: `<span style='color:#333; font-weight:bold; font-size:16px;'>108 Emergency Ambulance</span><br>📞 <a href='tel:108' style='color:#FF003C;'>108</a>`
        }
    };
}

function normalizeBackendService(svc, defaultName, defaultPhone, lat, lon) {
    if (!svc) {
        return {
            name: defaultName, phone: defaultPhone,
            html: `<span style='color:#333; font-weight:bold; font-size:16px;'>${defaultName}</span><br>📞 <a href='tel:${defaultPhone}' style='color:#FF003C;'>${defaultPhone}</a>`
        };
    }
    const phone = svc.sms_mobile || svc.landline || defaultPhone;
    const distLine = svc.road_km != null
        ? `📍 Distance: <strong>${svc.road_km} km</strong>${svc.eta_min != null ? ` (~${svc.eta_min} min)` : ""}`
        : `📍 <strong style='color:green;'>Location Locked</strong>`;
    const dirUrl = svc.google_maps_directions || `https://www.google.com/maps/dir/?api=1&destination=${svc.lat},${svc.lon}&travelmode=driving`;

    return {
        ...svc,
        name: svc.name || defaultName,
        phone: phone,
        html: `<span style='color:#333; font-weight:bold; font-size:16px;'>${svc.name || defaultName}</span><br>${distLine}<br>📞 <a href='tel:${phone}' style='color:#FF003C;'>${phone}</a><br>🗺️ <a href='${dirUrl}' target='_blank' rel='noopener' style='color:#0056b3; text-decoration:underline;'>Get Directions</a>`
    };
}

async function routeFromVercelEdgeDataset(lat, lon) {
    try {
        if (!window._localDatasetCache) {
            const res = await fetch(`./data/emergency_services.json?v=3`);
            if (!res.ok) return null;
            const json = await res.json();
            window._localDatasetCache = json.services || [];
        }
        const items = window._localDatasetCache;
        const findClosest = (cat) => {
            let best = null, bestKm = 35.0;
            for (const s of items) {
                if (s.category !== cat || s.lat == null || s.lon == null) continue;
                const km = haversineKm(lat, lon, s.lat, s.lon);
                if (km < bestKm) { bestKm = km; best = s; }
            }
            if (!best) return null;
            return { ...best, road_km: Number(bestKm.toFixed(2)), eta_min: null, routing_method: "Edge Spatial Cache" };
        };

        const h = findClosest("hospital");
        const p = findClosest("police_station");
        const a = findClosest("ambulance");
        if (!h && !p && !a) return null;

        return {
            hospital: normalizeBackendService(h, "Emergency Hospital", "112", lat, lon),
            police_station: normalizeBackendService(p, "Local Police", "100", lat, lon),
            ambulance: normalizeBackendService(a, "108 Emergency Ambulance", "108", lat, lon)
        };
    } catch (e) {
        return null;
    }
}

function startPreRouting(lat, lon) {
    if (window.routingPromise) return window.routingPromise;

    window.routingPromise = (async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 3500);
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
        }

        const edgeResult = await routeFromVercelEdgeDataset(lat, lon);
        if (edgeResult) {
            window.currentRoutedServices = edgeResult;
            window.lastDispatchedServices = edgeResult;
            return edgeResult;
        }

        const fallback = buildFallbackServices(lat, lon);
        window.currentRoutedServices = fallback;
        window.lastDispatchedServices = fallback;
        return fallback;
    })();

    return window.routingPromise;
}

function getLocalFirstAidSteps(emergencyType) {
    const dict = I18N[window.currentLang] || I18N.en;
    const s = (emergencyType || "").toLowerCase();
    if (s.includes("crash") || s.includes("accident")) return dict.steps_crash;
    if (s.includes("assault")) return dict.steps_assault;
    return dict.steps_default;
}

function formatStepNumeral(index) {
    if (window.currentLang === 'bn') {
        const bnDigits = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];
        return String(index).replace(/\d/g, (d) => bnDigits[Number(d)]);
    }
    return String(index);
}

function renderInstantGuidance(services, emergencyType) {
    const outputDiv = document.getElementById('ai-suggestions');
    if (!outputDiv) return;
    const dict = I18N[window.currentLang] || I18N.en;
    const steps = getLocalFirstAidSteps(emergencyType);

    const severityHtml = window.lastMlSeverityText
        ? `<div class="severity-pill">${escapeHtml(window.lastMlSeverityText)}</div>`
        : '';

    const stepsHtml = steps.map((step, idx) => {
        const cleanStep = step.replace(/^[0-9০-৯]+[.)]\s*/, '');
        return `
            <div class="first-aid-step-card">
                <span class="step-num-badge">${formatStepNumeral(idx + 1)}</span>
                <span class="step-text">${escapeHtml(cleanStep)}</span>
            </div>`;
    }).join('');

    outputDiv.innerHTML = `
        ${severityHtml}
        <div class="service-entry-item"> ${services.hospital.html}</div>
        <div class="service-entry-item"> ${services.police_station.html}</div>
        <div class="service-entry-item"> ${services.ambulance.html}</div>
        <div class="first-aid-heading">${escapeHtml(dict.immediate_header)}</div>
        <div class="first-aid-steps">${stepsHtml}</div>
    `;
}

let countdownInterval;
const COUNTDOWN_RING_CIRCUMFERENCE = 377;

function startCountdown() {
    clearInterval(countdownInterval);
    document.getElementById('main-screen').style.display = 'none';
    document.getElementById('countdown-screen').classList.remove('hidden');
    document.getElementById('countdown-screen').style.display = 'block';

    let timeLeft = 5;
    document.getElementById('timer-display').innerText = timeLeft;

    const ring = document.getElementById('countdown-ring-progress');
    if (ring) {
        ring.style.transition = 'none';
        ring.style.strokeDasharray = String(COUNTDOWN_RING_CIRCUMFERENCE);
        ring.style.strokeDashoffset = '0';
        ring.getBoundingClientRect(); // Force reset before animating
        requestAnimationFrame(() => {
            ring.style.transition = 'stroke-dashoffset 5s linear';
            ring.style.strokeDashoffset = String(COUNTDOWN_RING_CIRCUMFERENCE);
        });
    }

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
    const ring = document.getElementById('countdown-ring-progress');
    if (ring) {
        ring.style.transition = 'none';
        ring.style.strokeDashoffset = '0';
    }
    document.getElementById('countdown-screen').style.display = 'none';
    document.getElementById('main-screen').style.display = 'block';
}

async function sendTriage(emergencyType) {
    window.lastEmergencyType = emergencyType;
    document.getElementById('triage-screen').style.display = 'none';
    document.getElementById('guidance-screen').classList.remove('hidden');
    document.getElementById('guidance-screen').style.display = 'block';

    const chatBox = document.getElementById('chat-box');
    if (chatBox) chatBox.style.display = 'block';

    const outputDiv = document.getElementById('ai-suggestions');
    outputDiv.innerHTML = "<span style='color:#333;'>Finding nearest hospital, police & ambulance...</span>";

    let lat = window.currentScanLat, lon = window.currentScanLon;
    if (lat == null || lon == null || window.currentScanAccuracy > 80) {
        try {
            const position = await new Promise((resolve, reject) => {
                navigator.geolocation.getCurrentPosition(resolve, reject, {
                    enableHighAccuracy: true,
                    timeout: 3000,
                    maximumAge: 0
                });
            });
            const acc = position.coords.accuracy ?? 9999;
            if (lat == null || acc < window.currentScanAccuracy) {
                lat = position.coords.latitude;
                lon = position.coords.longitude;
                window.currentScanLat = lat;
                window.currentScanLon = lon;
                window.currentScanAccuracy = acc;
                window.routingPromise = null;
                window.currentRoutedServices = null;
            }
        } catch (error) { console.warn("Keeping best available GPS fix"); }
    }

    const urlParams = new URLSearchParams(window.location.search);
    const userId = urlParams.get('id') || "unknown_scan";

    if (lat != null && lon != null) {
        const services = window.currentRoutedServices || await startPreRouting(lat, lon);
        renderInstantGuidance(services, emergencyType);

        // Trigger family + Victim Kill-Switch SMS; if Render fails/offline, reveal 2G Offline SMS button
        if (!navigator.onLine) {
            showOfflineSmsFallback(lat, lon);
        } else {
            const triggerController = new AbortController();
            const triggerTimer = setTimeout(() => triggerController.abort(), 4500);
            fetch(`${API_BASE_URL}/trigger_emergency`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ user_id: userId, latitude: lat, longitude: lon, services: services }),
                signal: triggerController.signal
            })
                .then((r) => {
                    clearTimeout(triggerTimer);
                    if (!r.ok) showOfflineSmsFallback(lat, lon);
                })
                .catch(() => {
                    clearTimeout(triggerTimer);
                    showOfflineSmsFallback(lat, lon);
                });
        }

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

        const triageController = new AbortController();
        const triageTimer = setTimeout(() => triageController.abort(), 3000);
        try {
            let triageRes = await fetch(`${API_BASE_URL}/ai_triage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type: emergencyType, services: services, latitude: lat, longitude: lon, lang: window.currentLang }),
                signal: triageController.signal
            });
            clearTimeout(triageTimer);
            let triageData = await triageRes.json();
            if (triageData.suggestions) {
                outputDiv.innerHTML = triageData.suggestions.join("<br><br>");
            }
        } catch (e) {
            clearTimeout(triageTimer);
        }
    } else {
        showOfflineSmsFallback(null, null);
        outputDiv.innerHTML = "<span style='color:red;'>GPS denied. Use the Offline SMS button above or call 112 immediately.</span>";
    }
}

// --- VOICE CHATBOT (SYNCED WITH ACTIVE LANGUAGE) ---
function startVoiceRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return alert("Voice input is not supported in this browser.");
    const recognition = new SpeechRecognition();
    recognition.lang = (I18N[window.currentLang] || I18N.en).speech_lang;
    recognition.interimResults = false;
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
    utterance.lang = (I18N[window.currentLang] || I18N.en).speech_lang;
    utterance.rate = 1.05;
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
    if (passwordInput) passwordInput.type = passwordInput.type === "password" ? "text" : "password";
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

// IMAGE COMPRESSION & MEDICAL REPORT
function resizeImageClientSide(file, maxWidth = 1000, quality = 0.65) {
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
        const resizedBase64 = await resizeImageClientSide(fileInput.files[0], 1200, 0.7);
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
    if (!("geolocation" in navigator)) return;
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
        if (window._geoWatchId !== null) {
            navigator.geolocation.clearWatch(window._geoWatchId);
        }
        window._geoWatchId = navigator.geolocation.watchPosition(
            (pos) => {
                removeOverlay();
                const acc = pos.coords.accuracy ?? 9999;
                const prevAcc = window.currentScanAccuracy;
                if (window.currentScanLat == null || acc <= prevAcc + 25) {
                    const prevLat = window.currentScanLat;
                    const prevLon = window.currentScanLon;
                    window.currentScanLat = pos.coords.latitude;
                    window.currentScanLon = pos.coords.longitude;
                    window.currentScanAccuracy = acc;
                    if (prevLat != null && prevLon != null && haversineKm(prevLat, prevLon, pos.coords.latitude, pos.coords.longitude) > 0.15) {
                        window.routingPromise = null;
                        window.currentRoutedServices = null;
                    }
                    onSuccess(pos.coords.latitude, pos.coords.longitude, acc);
                }
            },
            (err) => {
                if (window.currentScanLat == null) {
                    showLocationOverlay(err.code === err.PERMISSION_DENIED);
                }
            },
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
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

// --- BYSTANDER LIVE-CAMERA VERIFICATION & AUTHORITY DISPATCH ---
function openAuthorityVerifyModal() {
    window.capturedScenePhotoBase64 = null;
    const preview = document.getElementById("scene-photo-preview");
    const fileInput = document.getElementById("live-scene-camera");
    const confirmBtn = document.getElementById("btn-confirm-auth-dispatch");
    if (preview) { preview.src = ""; preview.classList.add("hidden"); }
    if (fileInput) fileInput.value = "";
    if (confirmBtn) confirmBtn.disabled = true;
    document.getElementById("authority-verify-modal")?.classList.remove("hidden");
}

function closeAuthorityVerifyModal() {
    document.getElementById("authority-verify-modal")?.classList.add("hidden");
}

async function handleScenePhotoCapture(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
        const compressed = await resizeImageClientSide(file, 800, 0.6);
        window.capturedScenePhotoBase64 = compressed;
        const preview = document.getElementById("scene-photo-preview");
        const confirmBtn = document.getElementById("btn-confirm-auth-dispatch");
        if (preview) {
            preview.src = compressed;
            preview.classList.remove("hidden");
        }
        if (confirmBtn) confirmBtn.disabled = false;
    } catch (e) {
        console.warn("Could not compress scene photo:", e);
    }
}

async function confirmAuthorityDispatch() {
    if (!window.capturedScenePhotoBase64) {
        alert("Please snap a live camera photo first to verify this emergency.");
        return;
    }
    closeAuthorityVerifyModal();
    await alertNearestAuthorities(window.capturedScenePhotoBase64);
}

async function alertNearestAuthorities(scenePhotoBase64 = null) {
    const params = new URLSearchParams(window.location.search);
    const userId = params.get("id");
    const btn = document.getElementById("btn-alert-authorities");
    const statusEl = document.getElementById("authority-dispatch-status");

    if (!userId) return;

    btn.disabled = true;
    btn.textContent = "Dispatching Alerts to Authorities...";

    if (window.currentScanLat == null || window.currentScanLon == null) {
        try {
            const pos = await new Promise((resolve, reject) => {
                navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: false, timeout: 5000, maximumAge: 120000 });
            });
            window.currentScanLat = pos.coords.latitude;
            window.currentScanLon = pos.coords.longitude;
        } catch (e) {}
    }

    try {
        const resp = await fetch(`${API_BASE_URL}/alert_authorities`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                user_id: userId,
                latitude: window.currentScanLat ?? null,
                longitude: window.currentScanLon ?? null,
                services: window.currentRoutedServices || window.lastDispatchedServices || {},
                scene_photo_base64: scenePhotoBase64 || null
            })
        });
        const data = await resp.json();

        if (data.status === "Authorities Alerted") {
            btn.textContent = data.photo_attached ? "✅ Authorities Alerted (Scene Photo Sent)" : "✅ Authorities Alerted";
            btn.style.background = "#2e7d32";

            let lines = [];
            if (data.sms_notified?.length) lines.push("SMS sent to: " + data.sms_notified.map(x => x.name).join(", "));
            if (data.email_notified?.length) lines.push("Email sent to: " + data.email_notified.map(x => x.name).join(", "));
            if (data.call_only?.length) {
                lines.push("Direct call needed: " + data.call_only.map(x => `${x.name} (<a href="tel:${x.phone}">${x.phone}</a>)`).join(", "));
            }
            statusEl.innerHTML = lines.join("<br>");
        } else {
            throw new Error(data.message || "Dispatch failed");
        }
    } catch (err) {
        btn.disabled = false;
        btn.textContent = "Retry Alerting Nearest Authorities";
        showOfflineSmsFallback(window.currentScanLat, window.currentScanLon);
        statusEl.innerHTML = `<span style="color:#ff5252;">Network weak. Use Offline SMS above or call 112 / 108 directly.</span>`;
    }
}

window.onload = () => {
    setLanguage(window.currentLang);

    const params = new URLSearchParams(window.location.search);
    const isTrackPage = window.location.pathname.includes("track.html");
    const emergencyId = params.get("id");

    if (emergencyId && !isTrackPage) {
        fetchAndDisplayData();
        requestScanLocation((lat, lon) => {
            window.currentScanLat = lat;
            window.currentScanLon = lon;
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
// === LIVE EMERGENCY TRACKING PAGE (track.html) ===
document.addEventListener("DOMContentLoaded", () => {
    if (!window.location.pathname.includes("track.html")) return;

    const trackApiBase = typeof API_BASE_URL !== "undefined"
        ? API_BASE_URL
        : "https://raksham-api-zdv4.onrender.com";

    const params = new URLSearchParams(window.location.search);
    const userId = params.get("id");
    const initialLat = parseFloat(params.get("lat"));
    const initialLon = parseFloat(params.get("lon"));

    const statusMain = document.getElementById("track-status-main");
    const statusSub = document.getElementById("track-status-sub");
    const mapBox = document.getElementById("track-map-box");
    const coordsDisplay = document.getElementById("track-coords-display");
    const mapsNavBtn = document.getElementById("track-maps-btn");

    let trackMap = null;
    let trackMarker = null;
    let hasAnyFix = false;
    let pollAttempts = 0;

    function renderTrackedLocation(lat, lon, sourceLabel) {
        hasAnyFix = true;
        const latFixed = Number(lat).toFixed(6);
        const lonFixed = Number(lon).toFixed(6);
        const nowStr = new Date().toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit"
        });

        if (statusMain) statusMain.textContent = "🟢 Victim GPS Signal Locked";
        if (statusSub) statusSub.textContent = `${sourceLabel} • Last updated: ${nowStr}`;

        if (mapBox) mapBox.classList.remove("track-hidden");
        if (coordsDisplay) coordsDisplay.textContent = `📍 Lat: ${latFixed}, Lon: ${lonFixed}`;

        if (mapsNavBtn) {
            mapsNavBtn.href = `https://www.google.com/maps/dir/?api=1&destination=${latFixed},${lonFixed}&travelmode=driving`;
            mapsNavBtn.classList.remove("track-hidden");
        }

        if (typeof L !== "undefined") {
            try {
                if (!trackMap) {
                    trackMap = L.map("live-map").setView([lat, lon], 16);
                    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
                        maxZoom: 19,
                        attribution: "&copy; OpenStreetMap"
                    }).addTo(trackMap);
                    trackMarker = L.marker([lat, lon]).addTo(trackMap).bindPopup(" Victim Location").openPopup();
                } else {
                    trackMarker.setLatLng([lat, lon]);
                    trackMap.panTo([lat, lon], { animate: true });
                }
                setTimeout(() => trackMap && trackMap.invalidateSize(), 150);
            } catch (err) {
                console.warn("Map render error:", err);
            }
        }
    }

    async function pollLiveLocation() {
        if (!userId) {
            if (statusMain) statusMain.textContent = "🔴 Invalid Tracking Link";
            if (statusSub) statusSub.textContent = "No Raksham emergency ID found in URL.";
            return;
        }

        pollAttempts++;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        try {
            const res = await fetch(`${trackApiBase}/get_location/${encodeURIComponent(userId)}`, {
                signal: controller.signal,
                cache: "no-store"
            });
            clearTimeout(timeoutId);

            if (res.ok) {
                const payload = await res.json();
                const loc = payload.data || payload;
                if (payload.status === "success" && loc && loc.lat != null && loc.lon != null) {
                    renderTrackedLocation(loc.lat, loc.lon, "Live GPS stream active");
                } else if (!hasAnyFix) {
                    if (statusMain) statusMain.textContent = "🟡 Waiting for active GPS stream...";
                    if (statusSub) statusSub.textContent = "Server online — waiting for victim's device to send coordinates.";
                }
            }
        } catch (err) {
            clearTimeout(timeoutId);
            if (!hasAnyFix) {
                if (statusMain) statusMain.textContent = "🟡 Waking live tracking server...";
                if (statusSub) {
                    statusSub.textContent = pollAttempts <= 2
                        ? "Connecting to Raksham cloud (may take a few seconds)..."
                        : "Still reconnecting — keep this page open or use the Incident Pin link in the SMS.";
                }
            }
        }

        setTimeout(pollLiveLocation, 4000);
    }

    // 1. Instant <1s map render from URL coordinates (zero wait on Render)
    if (Number.isFinite(initialLat) && Number.isFinite(initialLon)) {
        renderTrackedLocation(initialLat, initialLon, "Exact scan pin loaded instantly (syncing live updates...)");
    }

    // 2. Poll Render every 4s for live movement updates
    pollLiveLocation();
});
