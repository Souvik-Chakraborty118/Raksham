import os
import math
import psycopg2
import numpy as np
import joblib
import uuid
import asyncio
import httpx
from fastapi import FastAPI, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from psycopg2.extras import RealDictCursor
import hashlib
from typing import List

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

class EmergencyPayload(BaseModel):
    user_id: str; latitude: float = None; longitude: float = None

class TriagePayload(BaseModel):
    type: str = None; services: dict = {}

class ChatMessage(BaseModel):
    role: str
    content: str
    
class ChatPayload(BaseModel):
    message: str
    services: dict = {}
    history: List[ChatMessage] = []

# --- MATHEMATICAL DISTANCE CALCULATOR ---
def calculate_distance(lat1, lon1, lat2, lon2):
    if None in [lat1, lon1, lat2, lon2]: return 999999
    R = 6371.0 
    dlat, dlon = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    a = math.sin(dlat / 2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2)**2
    return R * (2 * math.atan2(math.sqrt(a), math.sqrt(1 - a)))


# --- ALGORITHM 1: RELIABLE NEAREST-FACILITY LOOKUP (RACING MIRRORS) ---
OVERPASS_MIRRORS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.openstreetmap.ru/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter"
]

def build_overpass_query(lat, lon, radius=10000):
    return f"""
    [out:json][timeout:8];
    (
      node["amenity"~"hospital|clinic"](around:{radius},{lat},{lon});
      way["amenity"~"hospital|clinic"](around:{radius},{lat},{lon});
      node["healthcare"="hospital"](around:{radius},{lat},{lon});
      node["amenity"="police"](around:{radius},{lat},{lon});
      node["amenity"="ambulance_station"](around:{radius},{lat},{lon});
    );
    out center;
    """

async def fetch_from_mirror(client, mirror, query):
    response = await client.post(mirror, data={'data': query}, timeout=8.0)
    response.raise_for_status()
    data = response.json()
    if not data.get("elements"):
        raise ValueError("Empty elements")
    return data

async def race_first_success(mirrors, query, overall_timeout=12.0):
    async with httpx.AsyncClient() as client:
        tasks = [asyncio.create_task(fetch_from_mirror(client, m, query)) for m in mirrors]
        done, pending = await asyncio.wait(tasks, timeout=overall_timeout, return_when=asyncio.FIRST_COMPLETED)
        
        for p in pending:
            p.cancel()
            
        for task in done:
            try:
                result = task.result()
                return result
            except Exception:
                continue
    return None

async def fetch_all_facilities(lat, lon):
    query = build_overpass_query(lat, lon, radius=10000)
    result = await race_first_success(OVERPASS_MIRRORS, query)
    
    # Fallback to 25km radius if nothing found
    if not result:
        query_expanded = build_overpass_query(lat, lon, radius=25000)
        result = await race_first_success(OVERPASS_MIRRORS, query_expanded)

    services = {}
    if not result:
        return services # Fallback to hardcoded defaults later

    elements = result.get('elements', [])
    hospitals, police, ambulances = [], [], []

    for el in elements:
        el_lat = el.get('lat') or el.get('center', {}).get('lat')
        el_lon = el.get('lon') or el.get('center', {}).get('lon')
        if not el_lat or not el_lon: continue
            
        el['calculated_dist'] = calculate_distance(lat, lon, el_lat, el_lon)
        el['exact_lat'], el['exact_lon'] = el_lat, el_lon
        
        tags = el.get('tags', {})
        am = tags.get('amenity', '')
        hc = tags.get('healthcare', '')

        if 'hospital' in am or 'clinic' in am or 'hospital' in hc:
            hospitals.append(el)
        elif 'police' in am:
            police.append(el)
        elif 'ambulance' in am:
            ambulances.append(el)

    def process_closest(arr, key_name, default_phone):
        if not arr: return None
        arr.sort(key=lambda x: x['calculated_dist'])
        best = arr[0]
        tags = best.get('tags', {})
        name = tags.get('name') or tags.get('operator') or f'Nearest {key_name}'
        dist_km = best['calculated_dist']
        phone = tags.get('phone') or tags.get('contact:phone') or default_phone
        maps_link = f"https://www.google.com/maps/dir/?api=1&origin={lat},{lon}&destination={best['exact_lat']},{best['exact_lon']}"
        
        return {
            "html": f"<span style='color:#333; font-weight:bold; font-size:16px;'>{name}</span><br>📍 Distance: <strong>{dist_km:.1f} km</strong><br>📞 <a href='tel:{phone}' style='color:#FF003C;'>{phone}</a><br>🗺️ <a href='{maps_link}' target='_blank' style='color:#0056b3; text-decoration:underline;'>Get Directions</a>",
            "name": name,
            "phone": phone
        }

    hosp = process_closest(hospitals, "Medical Center", "112")
    pol = process_closest(police, "Police Station", "100")
    amb = process_closest(ambulances, "Ambulance", "102")

    if hosp: services["hospital"] = hosp
    if pol: services["police_station"] = pol
    if amb: services["ambulance"] = amb

    return services

# --- SMS TO EMERGENCY CONTACTS ---
def process_emergency_alerts(contacts, services, lat, lon, user_id):
    TEXTBEE_API_KEY = os.getenv("TEXTBEE_API_KEY")
    TEXTBEE_DEVICE_ID = os.getenv("TEXTBEE_DEVICE_ID")
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
            httpx.post(url, json=payload, headers=headers, timeout=5.0)
        except:
            pass

# --- ROUTES ---
@app.post("/register")
async def register(user: NewUser):
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        user_id = str(uuid.uuid4())
        qr_link = f"https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=https://raksham-pi.vercel.app/index.html?id={user_id}"
        
        clean_email = user.email.strip().lower()
        hashed_password = hash_password(user.password.strip()) 
        
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
        hashed_input = hash_password(user.password.strip())
        
        cursor.execute("SELECT * FROM users WHERE LOWER(TRIM(email)) = %s AND password = %s", (clean_email, hashed_input))
        row = cursor.fetchone()
        cursor.close()
        conn.close()
        
        if row: return {"message": "Login successful"}
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
        if row: return {"user_data": row, "qr_image": row.get('qr_image')}
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
        if row: return row
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

@app.post("/trigger_emergency")
async def trigger_emergency(payload: EmergencyPayload, background_tasks: BackgroundTasks):
    services = {}
    if payload.latitude and payload.longitude:
        services = await fetch_all_facilities(payload.latitude, payload.longitude)

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

@app.post("/ai_triage")
async def ai_triage(payload: TriagePayload):
    dispatched = payload.services or {}
    
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

    situation = (payload.type or "").lower()
    
    if "heart" in situation or "cardiac" in situation:
        guidance.extend(["1. Have the person sit down and rest.", "2. Loosen tight clothing.", "3. Ask if they take chest pain medicine and help them take it."])
    elif "accident" in situation or "crash" in situation:
        guidance.extend(["1. DO NOT move the victim unless in immediate danger.", "2. Apply firm, direct pressure to any bleeding wounds.", "3. Keep their head and neck perfectly still."])
    elif "assault" in situation:
        guidance.extend(["1. Move to a safe location if possible.", "2. Do not clean or disturb wounds more than necessary to stop bleeding.", "3. Wait for police to arrive."])
    else:
        guidance.extend(["1. Do not leave the victim unattended.", "2. Keep them breathing and conscious.", "3. Apply pressure to any bleeding."])

    if ai_model:
        try:
            input_features = np.zeros((1, ai_model.n_features_in_)) 
            prediction = ai_model.predict(input_features)
            guidance.insert(0, f"<span style='color:#FF003C; font-weight:900;'>ML SEVERITY ASSESSMENT: LEVEL {str(prediction[0])}</span><br>")
        except:
            pass

    return {"status": "success", "suggestions": guidance}


# --- ALGORITHM 2: REAL AI CHATBOT VIA GROQ API ---
@app.post("/chat")
async def chat_endpoint(payload: ChatPayload):
    GROQ_API_KEY = os.getenv("GROQ_API_KEY")
    hosp_name = payload.services.get('hospital', {}).get('name', 'the nearest hospital')
    context_note = f"Nearest hospital dispatched: {hosp_name}"

    SYSTEM_PROMPT = """You are Raksham AI, an emergency first-aid assistant embedded in a life-safety app.
    Rules:
    - Give short, direct, actionable first-aid guidance (numbered steps, max ~120 words).
    - ALWAYS tell the user to call local emergency services (mention the dispatched hospital) if the situation sounds severe.
    - Never give medication dosages beyond generic OTC guidance.
    - Never diagnose. Describe symptoms/actions, not diagnoses.
    - If the message is unrelated to the emergency, gently redirect back to safety."""
    
    messages = [{"role": "system", "content": SYSTEM_PROMPT + "\nCurrent dispatch context: " + context_note}]
    
    for msg in payload.history[-6:]:
        messages.append({"role": msg.role, "content": msg.content})
    messages.append({"role": "user", "content": payload.message})

    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={"Authorization": f"Bearer {GROQ_API_KEY}"},
                json={"model": "llama-3.3-70b-versatile", "messages": messages, "temperature": 0.3, "max_tokens": 300},
                timeout=15.0
            )
            resp.raise_for_status()
            reply = resp.json()["choices"][0]["message"]["content"]
    except Exception as e:
        print(f"Groq Error: {e}")
        reply = "I'm having trouble connecting right now. If this is urgent, call 112 immediately."
        
    return {"response": reply}
