import os
import math
import requests
import psycopg2
import numpy as np
import joblib
import uuid
from fastapi import FastAPI, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from psycopg2.extras import RealDictCursor
import hashlib

def hash_password(password: str):
    return hashlib.sha256(password.encode()).hexdigest()

app = FastAPI()
@app.get("/")
async def root():
    return {"status": "online", "message": "Raksham Emergency API is active and running"}

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- DATABASE CONNECTION ---
def get_db_connection():
    return psycopg2.connect(os.getenv("DATABASE_URL"), cursor_factory=RealDictCursor)

# --- ML MODEL LOADING ---
try:
    ai_model = joblib.load("models/multilingual_rf_model.pkl")
except Exception as e:
    print("ML Model not found or failed to load:", e)
    ai_model = None

# --- PYDANTIC MODELS ---
class NewUser(BaseModel):
    email: str; password: str; name: str; blood_group: str; allergies: str; conditions: str
    phone: str; em1: str; em2: str; em3: str; em4: str; em5: str; em6: str

class LoginUser(BaseModel):
    email: str; password: str

class ProfileRequest(BaseModel):
    email: str

class UpdateUser(BaseModel):
    current_email: str; email: str; name: str; blood_group: str; allergies: str; conditions: str
    phone: str; em1: str; em2: str; em3: str; em4: str; em5: str; em6: str

class LocationUpdate(BaseModel):
    user_id: str; lat: float; lon: float

class EmergencyPayload(BaseModel):
    user_id: str; latitude: float = None; longitude: float = None

class TriagePayload(BaseModel):
    type: str = None; services: dict = {}
    
class AlertPayload(BaseModel):
    services: dict = {}

class ChatPayload(BaseModel):
    message: str; services: dict = {}

# --- MATHEMATICAL DISTANCE CALCULATOR (Haversine Formula) ---
def calculate_distance(lat1, lon1, lat2, lon2):
    if lat1 is None or lon1 is None or lat2 is None or lon2 is None:
        return 999999
    R = 6371.0 # Earth radius in kilometers
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c

# --- MAP SCRAPING WITH DISTANCE SORTING ---
def fetch_facility(lat, lon):
    overpass_url = "http://overpass-api.de/api/interpreter"
    
    # Combined query to fetch hospital, police, and ambulance all at once in 1 HTTP request
    query = f"""
    [out:json][timeout:6];
    (
      nwr["amenity"="hospital"](around:10000,{lat},{lon});
      nwr["healthcare"="hospital"](around:10000,{lat},{lon});
      nwr["amenity"="police"](around:10000,{lat},{lon});
      nwr["amenity"="ambulance_station"](around:10000,{lat},{lon});
    );
    out center;
    """
    
    services = {}
    try:
        response = requests.post(overpass_url, data={'data': query}, headers={"User-Agent": "RakshamApp/5.1"}, timeout=7)
        elements = response.json().get('elements', [])
        
        if not elements:
            return services

        # Separate and sort categories locally
        hospitals, police, ambulances = [], [], []

        for el in elements:
            el_lat = el.get('lat') or el.get('center', {}).get('lat')
            el_lon = el.get('lon') or el.get('center', {}).get('lon')
            if el_lat is None or el_lon is None:
                continue
                
            dist = calculate_distance(lat, lon, el_lat, el_lon)
            el['calculated_dist'] = dist
            el['exact_lat'] = el_lat
            el['exact_lon'] = el_lon
            
            tags = el.get('tags', {})
            amenity = tags.get('amenity', '')
            healthcare = tags.get('healthcare', '')

            if amenity == 'hospital' or healthcare == 'hospital':
                hospitals.append(el)
            elif amenity == 'police':
                police.append(el)
            elif 'ambulance' in amenity:
                ambulances.append(el)

        # Helper to process the closest item
        def process_closest(arr, key_name, default_phone):
            if not arr: return None
            arr.sort(key=lambda x: x['calculated_dist'])
            best = arr[0]
            tags = best.get('tags', {})
            name = tags.get('name') or tags.get('operator') or f'Nearest {key_name.title()}'
            dist_km = best['calculated_dist']
            phone = tags.get('phone') or tags.get('contact:phone') or default_phone
            maps_link = f"https://www.google.com/maps/dir/?api=1&origin={lat},{lon}&destination={best['exact_lat']},{best['exact_lon']}"
            
            return {
                "html": f"<span style='color:#333; font-weight:bold; font-size:16px;'>{name}</span><br>📍 Distance: <strong>{dist_km:.1f} km</strong><br>📞 <a href='tel:{phone}' style='color:#FF003C;'>{phone}</a><br>🗺️ <a href='{maps_link}' target='_blank' style='color:#0056b3; text-decoration:underline;'>Get Directions</a>",
                "name": name,
                "phone": phone
            }

        hosp = process_closest(hospitals, "hospital", "112")
        pol = process_closest(police, "police station", "100")
        amb = process_closest(ambulances, "ambulance", "102")

        if hosp: services["hospital"] = hosp
        if pol: services["police_station"] = pol
        if amb: services["ambulance"] = amb

    except Exception as e:
        print(f"Overpass Error: {e}")
        
    return services

# --- SMS TO EMERGENCY CONTACTS ONLY (WhatsApp Removed) ---
def process_emergency_alerts(contacts, services, lat, lon, user_id):
    TEXTBEE_API_KEY = os.getenv("TEXTBEE_API_KEY")
    TEXTBEE_DEVICE_ID = os.getenv("TEXTBEE_DEVICE_ID")

    # Filter out empty or invalid contacts
    valid_contacts = [c for c in contacts if c and len(c) >= 5]
    
    if valid_contacts and TEXTBEE_API_KEY and TEXTBEE_DEVICE_ID:
        maps_link = f"https://maps.google.com/?q={lat},{lon}" if lat else "Location unavailable"
        live_link = f"https://raksham-pi.vercel.app/track.html?id={user_id}"
        
        alert_text = (
            f"🚨 RAKSHAM CRITICAL ALERT 🚨\n\n"
            f"📍 GPS Location: {maps_link}\n"
            f"📡 Live Tracking: {live_link}\n\n"
            f"Nearest Hospital: {services.get('hospital', {}).get('name', 'N/A')}\n"
            f"⚠️ Immediate medical assistance is required!"
        )

        url = f"https://api.textbee.dev/api/v1/gateway/devices/{TEXTBEE_DEVICE_ID}/send-sms"
        headers = {"x-api-key": TEXTBEE_API_KEY, "Content-Type": "application/json"}
        payload = {"recipients": valid_contacts, "message": alert_text}

        try:
            requests.post(url, json=payload, headers=headers, timeout=5)
        except Exception as e:
            print(f"SMS Gateway Error: {e}")

# --- ROUTES ---
@app.post("/register")
async def register(user: NewUser):
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        user_id = str(uuid.uuid4())
        qr_link = f"https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=https://raksham-pi.vercel.app/index.html?id={user_id}"
        
        clean_email = user.email.strip().lower()
        hashed_password = hash_password(user.password.strip()) # <-- WE HASH IT BEFORE SAVING
        
        cursor.execute('''
            INSERT INTO users (user_id, email, password, name, blood_group, allergies, conditions, phone, em1, em2, em3, em4, em5, em6, qr_image)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        ''', (user_id, clean_email, hashed_password, user.name, user.blood_group, user.allergies, user.conditions, user.phone, user.em1, user.em2, user.em3, user.em4, user.em5, user.em6, qr_link))
        conn.commit()
        cursor.close()
        conn.close()
        return {"message": "User registered successfully"}
    except Exception as e:
        return {"error": str(e)}

@app.post("/login")
async def login(user: LoginUser):
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        clean_email = user.email.strip().lower()
        hashed_input = hash_password(user.password.strip()) # <-- WE HASH IT HERE NOW
        
        cursor.execute("SELECT * FROM users WHERE LOWER(TRIM(email)) = %s AND password = %s", (clean_email, hashed_input))
        row = cursor.fetchone()
        
        cursor.close()
        conn.close()
        
        if row:
            return {"message": "Login successful"}
        return {"error": "Invalid email or password"}
    except Exception as e:
        return {"error": str(e)}

@app.post("/retrieve_profile_data")
async def retrieve_profile(req: ProfileRequest):
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM users WHERE email = %s", (req.email,))
        row = cursor.fetchone()
        cursor.close()
        conn.close()
        if row:
            return {"user_data": row, "qr_image": row.get('qr_image')}
        return {"error": "User not found"}
    except Exception as e:
        return {"error": str(e)}

@app.get("/profile/{user_id}")
async def get_public_profile(user_id: str):
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT name, blood_group, allergies, conditions, phone, em1, em2, em3, em4, em5, em6 FROM users WHERE user_id = %s", (user_id,))
        row = cursor.fetchone()
        cursor.close()
        conn.close()
        if row:
            return row
        return {"error": "User not found"}
    except Exception as e:
        return {"error": str(e)}

@app.post("/update_profile")
async def update_profile(user: UpdateUser):
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute('''
            UPDATE users SET email=%s, name=%s, blood_group=%s, allergies=%s, conditions=%s, phone=%s, em1=%s, em2=%s, em3=%s, em4=%s, em5=%s, em6=%s
            WHERE email=%s
        ''', (user.email, user.name, user.blood_group, user.allergies, user.conditions, user.phone, user.em1, user.em2, user.em3, user.em4, user.em5, user.em6, user.current_email))
        conn.commit()
        cursor.close()
        conn.close()
        return {"message": "Profile updated successfully"}
    except Exception as e:
        return {"error": str(e)}

@app.post("/update_location")
async def update_location(payload: LocationUpdate):
    return {"status": "Location updated"}

@app.post("/trigger_emergency")
async def trigger_emergency(payload: EmergencyPayload, background_tasks: BackgroundTasks):
    services = {}
    if payload.latitude and payload.longitude:
        services = fetch_facility(payload.latitude, payload.longitude)

    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT em1, em2, em3, em4, em5, em6 FROM users WHERE user_id = %s", (payload.user_id,))
        row = cursor.fetchone()
        cursor.close()
        conn.close()
        
        if row:
            contacts = [row['em1'], row['em2'], row['em3'], row['em4'], row['em5'], row['em6']]
            background_tasks.add_task(process_emergency_alerts, contacts, services, payload.latitude, payload.longitude, payload.user_id)
    except:
        pass

    return {"status": "Emergency Triggered", "services": services}
@app.post("/chat")
async def chat_endpoint(payload: ChatPayload):
    user_message = (payload.message or "").lower()
    services = payload.services or {}
    
    # Extract nearest facility info if available
    hosp_name = services.get('hospital', {}).get('name', 'the nearest hospital')
    
    # Intelligent emergency responses based on user queries
    if "bleed" in user_message or "blood" in user_message:
        reply = "Apply firm, direct pressure to the wound using a clean cloth or bandage. Do not remove the cloth if it becomes soaked; place another one on top."
    elif "breath" in user_message or "cpr" in user_message:
        reply = "Check if the airway is clear. If the person is unresponsive and not breathing normally, begin chest compressions immediately (100-120 bpm)."
    elif "hospital" in user_message or "where" in user_message:
        reply = f"The closest emergency facility dispatched for you is {hosp_name}. Follow the map directions provided on your screen."
    elif "pain" in user_message or "hurt" in user_message:
        reply = "Keep the victim as still and comfortable as possible. Do not give them anything to eat or drink until emergency responders arrive."
    else:
        reply = f"Stay calm. Help is being coordinated. For immediate assistance regarding your situation, please contact emergency services or head to {hosp_name}."

    return {"response": reply}
@app.post("/ai_triage")
async def ai_triage(payload: TriagePayload):
    dispatched = payload.services or {}
    
    # Fallbacks in case GPS completely fails
    default_hospital = {"html": "<span style='color:#333; font-weight:bold; font-size:16px;'>Emergency Medical Center</span><br>📞 <a href='tel:112' style='color:#FF003C;'>112</a>"}
    default_police = {"html": "<span style='color:#333; font-weight:bold; font-size:16px;'>Police Control Room</span><br>📞 <a href='tel:100' style='color:#FF003C;'>100</a>"}
    default_ambulance = {"html": "<span style='color:#333; font-weight:bold; font-size:16px;'>Ambulance Dispatch</span><br>📞 <a href='tel:102' style='color:#FF003C;'>102</a>"}

    hospital_html = dispatched.get('hospital', {}).get('html') or default_hospital['html']
    police_html = dispatched.get('police_station', {}).get('html') or default_police['html']
    ambulance_html = dispatched.get('ambulance', {}).get('html') or default_ambulance['html']

    guidance = [
        f"<strong>🏥 Nearest Hospital:</strong><br>{hospital_html}",
        f"<strong>🚓 Nearest Police:</strong><br>{police_html}",
        f"<strong>🚑 Nearest Ambulance:</strong><br>{ambulance_html}",
        "<br><strong style='color:#FF003C;'>IMMEDIATE ACTIONS:</strong>"
    ]

    # --- DYNAMIC MEDICAL SUGGESTIONS BASED ON SITUATION ---
    situation = (payload.type or "").lower()
    
    if "heart" in situation or "cardiac" in situation:
        guidance.extend([
            "1. Have the person sit down, rest, and try to keep calm.",
            "2. Loosen any tight clothing.",
            "3. Ask if they take chest pain medicine (like nitroglycerin) and help them take it.",
            "4. If unresponsive and not breathing, begin CPR immediately."
        ])
    elif "accident" in situation or "crash" in situation or "trauma" in situation:
        guidance.extend([
            "1. DO NOT move the victim unless they are in immediate life-threatening danger (e.g., fire).",
            "2. Apply firm, direct pressure to any bleeding wounds with a clean cloth.",
            "3. Keep the victim's head and neck perfectly still.",
            "4. Keep them warm with a coat or blanket to prevent shock."
        ])
    elif "chok" in situation:
        guidance.extend([
            "1. Ask 'Are you choking?' If they cannot cough, speak, or breathe, act immediately.",
            "2. Give 5 back blows between the shoulder blades with the heel of your hand.",
            "3. Give 5 abdominal thrusts (Heimlich maneuver).",
            "4. Alternate blows and thrusts until the blockage is dislodged."
        ])
    elif "burn" in situation or "fire" in situation:
        guidance.extend([
            "1. Stop the burning process. Extinguish flames.",
            "2. Cool the burn IMMEDIATELY with cool (not ice-cold) running water for at least 10 minutes.",
            "3. Remove restrictive items (rings, watches) near the burn area before it swells.",
            "4. Loosely cover the burn with a sterile, non-fluffy dressing or plastic wrap."
        ])
    else:
        # Generic Severe Medical Fallback
        guidance.extend([
            "1. Check the victim's airway, breathing, and circulation (ABCs).",
            "2. Do not leave the victim unattended.",
            "3. Keep them breathing and conscious.",
            "4. If bleeding, apply direct pressure. If unresponsive, begin CPR."
        ])

    # ML Severity assessment
    if ai_model:
        try:
            input_features = np.zeros((1, ai_model.n_features_in_)) 
            prediction = ai_model.predict(input_features)
            guidance.insert(0, f"<span style='color:#FF003C; font-weight:900;'>ML SEVERITY ASSESSMENT: LEVEL {str(prediction[0])}</span><br>")
        except:
            pass

    return {"status": "success", "suggestions": guidance}
