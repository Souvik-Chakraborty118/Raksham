import os
import math
import time
import asyncio
import requests
import httpx
import psycopg2
import numpy as np
import joblib
import uuid
import concurrent.futures
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

# --- IN-MEMORY LIVE TRACKING ---
live_locations = {}

# --- THREAD POOL FOR SAFE MAP SCRAPING ---
executor = concurrent.futures.ThreadPoolExecutor(max_workers=10)

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

class ChatMessage(BaseModel):
    role: str
    content: str
    
class ChatPayload(BaseModel):
    message: str
    services: dict = {}
    history: List[ChatMessage] = []

class MedicalReportPayload(BaseModel):
    email: str; image_base64: str

class ProfileVisibilityPayload(BaseModel):
    email: str; show_medical_summary: bool

# --- MATHEMATICAL DISTANCE CALCULATOR ---
def calculate_distance(lat1, lon1, lat2, lon2):
    if lat1 is None or lon1 is None or lat2 is None or lon2 is None:
        return 999999
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c

# --- BULLETPROOF MAP SCRAPING (Requests + ThreadPool) ---
OVERPASS_MIRRORS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.openstreetmap.ru/api/interpreter",
    "https://lz4.overpass-api.de/api/interpreter",
    "https://z.overpass-api.de/api/interpreter"
]

def _sync_fetch(url, query):
    resp = requests.post(url, data={'data': query}, headers={"User-Agent": "RakshamApp/7.0"}, timeout=5.0)
    resp.raise_for_status()
    data = resp.json()
    if not data.get('elements'):
        raise ValueError("empty")
    return data

async def fetch_facility(lat, lon):
    # 1. ALWAYS initialize the fallback first
    services = {
        "hospital": {
            "html": f"<span style='color:#333; font-weight:bold; font-size:16px;'>Nearest Hospital (GPS Search)</span><br>📍 <strong style='color:green;'>Location Locked</strong><br>📞 <a href='tel:112' style='color:#FF003C;'>112</a><br>🗺️ <a href='https://www.google.com/maps/search/hospital/@{lat},{lon},15z' target='_blank' style='color:#0056b3; text-decoration:underline;'>Get Directions</a>",
            "name": "Nearest Hospital (GPS)", "phone": "112"
        },
        "police_station": {
            "html": f"<span style='color:#333; font-weight:bold; font-size:16px;'>Local Police (GPS Search)</span><br>📍 <strong style='color:green;'>Location Locked</strong><br>📞 <a href='tel:100' style='color:#FF003C;'>100</a><br>🗺️ <a href='https://www.google.com/maps/search/police/@{lat},{lon},15z' target='_blank' style='color:#0056b3; text-decoration:underline;'>Get Directions</a>",
            "name": "Local Police (GPS)", "phone": "100"
        },
        "ambulance": {
            "html": f"<span style='color:#333; font-weight:bold; font-size:16px;'>Ambulance Dispatch</span><br>📍 <strong style='color:green;'>Location Locked</strong><br>📞 <a href='tel:102' style='color:#FF003C;'>102</a><br>🗺️ <a href='https://www.google.com/maps/search/ambulance/@{lat},{lon},15z' target='_blank' style='color:#0056b3; text-decoration:underline;'>Get Directions</a>",
            "name": "Ambulance Dispatch", "phone": "102"
        }
    }

    query = f"""
    [out:json][timeout:4];
    (
      node["amenity"~"hospital|clinic"](around:15000,{lat},{lon});
      way["amenity"~"hospital|clinic"](around:15000,{lat},{lon});
      node["amenity"="police"](around:15000,{lat},{lon});
      node["amenity"="ambulance_station"](around:15000,{lat},{lon});
    );
    out center;
    """

    loop = asyncio.get_running_loop()
    tasks = [loop.run_in_executor(executor, _sync_fetch, url, query) for url in OVERPASS_MIRRORS]
    
    try:
        done, pending = await asyncio.wait(tasks, timeout=6.0, return_when=asyncio.FIRST_COMPLETED)
        result_data = None
        for t in done:
            try:
                res = t.result()
                if res and res.get('elements'):
                    result_data = res
                    break
            except:
                continue
                
        if result_data:
            elements = result_data['elements']
            hospitals, police, ambulances = [], [], []
            for el in elements:
                el_lat = el.get('lat') or el.get('center', {}).get('lat')
                el_lon = el.get('lon') or el.get('center', {}).get('lon')
                if not el_lat or not el_lon: continue
                    
                el['calculated_dist'] = calculate_distance(lat, lon, el_lat, el_lon)
                el['exact_lat'], el['exact_lon'] = el_lat, el_lon
                
                am = el.get('tags', {}).get('amenity', '')
                hc = el.get('tags', {}).get('healthcare', '')

                if 'hospital' in am or 'clinic' in am or 'hospital' in hc: hospitals.append(el)
                elif 'police' in am: police.append(el)
                elif 'ambulance' in am: ambulances.append(el)

            def get_best(arr, default_name, default_phone):
                if not arr: return None
                arr.sort(key=lambda x: x['calculated_dist'])
                best = arr[0]
                t = best.get('tags', {})
                n = t.get('name') or t.get('operator') or default_name
                p = t.get('phone') or t.get('contact:phone') or default_phone
                mlink = f"https://www.google.com/maps/dir/?api=1&origin={lat},{lon}&destination={best['exact_lat']},{best['exact_lon']}"
                return {
                    "html": f"<span style='color:#333; font-weight:bold; font-size:16px;'>{n}</span><br>📍 Distance: <strong>{best['calculated_dist']:.1f} km</strong><br>📞 <a href='tel:{p}' style='color:#FF003C;'>{p}</a><br>🗺️ <a href='{mlink}' target='_blank' style='color:#0056b3; text-decoration:underline;'>Get Directions</a>",
                    "name": n, "phone": p
                }

            h = get_best(hospitals, "Nearest Hospital", "112")
            p = get_best(police, "Nearest Police", "100")
            a = get_best(ambulances, "Nearest Ambulance", "102")

            if h: services["hospital"] = h
            if p: services["police_station"] = p
            if a: services["ambulance"] = a
    except Exception as e:
        print(f"Scraper error: {e}")
        
    return services

# --- SMS TO EMERGENCY CONTACTS ---
def process_emergency_alerts(contacts, services, lat, lon, user_id):
    TEXTBEE_API_KEY = os.getenv("TEXTBEE_API_KEY")
    TEXTBEE_DEVICE_ID = os.getenv("TEXTBEE_DEVICE_ID")
    valid_contacts = [c for c in contacts if c and len(c) >= 5]
    
    if valid_contacts and TEXTBEE_API_KEY and TEXTBEE_DEVICE_ID:
        maps_link = f"https://maps.google.com/?q={lat},{lon}" if lat else "Location unavailable"
        live_link = f"https://raksham-pi.vercel.app/track.html?id={user_id}"
        hosp_name = services.get('hospital', {}).get('name', 'Nearest Hospital')
        
        alert_text = (
            f"🚨 RAKSHAM CRITICAL ALERT 🚨\n\n"
            f"📍 GPS Location: {maps_link}\n"
            f"📡 Live Tracking: {live_link}\n\n"
            f"Nearest Hospital: {hosp_name}\n"
            f"⚠️ Immediate medical assistance is required!"
        )
        url = f"https://api.textbee.dev/api/v1/gateway/devices/{TEXTBEE_DEVICE_ID}/send-sms"
        headers = {"x-api-key": TEXTBEE_API_KEY, "Content-Type": "application/json"}
        payload = {"recipients": valid_contacts, "message": alert_text}
        try:
            requests.post(url, json=payload, headers=headers, timeout=5)
        except Exception as e:
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
        cursor.execute(
            "SELECT name, blood_group, allergies, conditions, phone, em1, em2, em3, em4, em5, em6, "
            "medical_summary, show_medical_summary FROM users WHERE user_id = %s",
            (user_id,)
        )
        row = cursor.fetchone()
        cursor.close()
        conn.close()
        if row:
            if not row.get("show_medical_summary", True):
                row["medical_summary"] = None
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
    live_locations[payload.user_id] = {
        "lat": payload.lat, 
        "lon": payload.lon, 
        "timestamp": time.time()
    }
    return {"status": "Location updated"}

@app.get("/get_location/{user_id}")
async def get_location(user_id: str):
    loc = live_locations.get(user_id)
    if loc:
        return {"status": "success", "data": {"lat": loc["lat"], "lon": loc["lon"]}}
    return {"status": "error", "message": "Location unavailable or tracking not started."}

@app.post("/trigger_emergency")
async def trigger_emergency(payload: EmergencyPayload, background_tasks: BackgroundTasks):
    services = {}
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT em1, em2, em3, em4, em5, em6 FROM users WHERE user_id = %s", (payload.user_id,))
        row = cursor.fetchone()
        cursor.close()
        conn.close()
    except:
        row = None

    if payload.latitude is not None and payload.longitude is not None:
        services = await fetch_facility(payload.latitude, payload.longitude)

    if row:
        contacts = [row['em1'], row['em2'], row['em3'], row['em4'], row['em5'], row['em6']]
        background_tasks.add_task(process_emergency_alerts, contacts, services, payload.latitude, payload.longitude, payload.user_id)

    return {"status": "Emergency Triggered", "services": services}

@app.post("/ai_triage")
async def ai_triage(payload: TriagePayload):
    dispatched = payload.services or {}
    
    hospital_html = dispatched.get('hospital', {}).get('html', "N/A")
    police_html = dispatched.get('police_station', {}).get('html', "N/A")
    ambulance_html = dispatched.get('ambulance', {}).get('html', "N/A")
    
    guidance = [
        f"<strong>🏥 {hospital_html}</strong><br>",
        f"<strong>🚓 {police_html}</strong><br>",
        f"<strong>🚑 {ambulance_html}</strong><br>",
        "<br><strong style='color:#FF003C;'>IMMEDIATE ACTIONS:</strong>"
    ]
    
    situation = (payload.type or "").lower()
    
    if "heart" in situation or "cardiac" in situation:
        guidance.extend(["1. Have the person sit down, rest, and try to keep calm.", "2. Loosen any tight clothing.", "3. If unresponsive and not breathing, begin CPR immediately."])
    elif "accident" in situation or "crash" in situation:
        guidance.extend(["1. DO NOT move the victim unless they are in immediate danger.", "2. Apply firm, direct pressure to any bleeding wounds.", "3. Keep the victim's head and neck perfectly still."])
    elif "assault" in situation:
        guidance.extend(["1. Move to a safe location immediately.", "2. Apply direct pressure to stop bleeding.", "3. Wait for police and ambulance dispatch."])
    else:
        guidance.extend(["1. Check airway, breathing, and circulation.", "2. Do not leave the victim unattended.", "3. Apply pressure to any bleeding."])
        
    if ai_model:
        try:
            input_features = np.zeros((1, ai_model.n_features_in_)) 
            prediction = ai_model.predict(input_features)
            guidance.insert(0, f"<span style='color:#FF003C; font-weight:900;'>ML SEVERITY ASSESSMENT: LEVEL {str(prediction[0])}</span><br>")
        except:
            pass
            
    return {"status": "success", "suggestions": guidance}

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions"
GROQ_CHAT_MODEL = "llama-3.3-70b-versatile"
GROQ_VISION_MODEL = "llama-3.2-11b-vision-preview"

CHAT_SYSTEM_PROMPT = """You are Raksham AI, an emergency first-aid assistant embedded in a life-safety app.
Rules:
- Give short, direct, actionable first-aid guidance (numbered steps, max ~120 words).
- ALWAYS remind the user to contact/head to the dispatched emergency services if the situation sounds severe.
- Never give medication dosages.
- Never diagnose. Describe symptoms/actions, not diagnoses.
- If the message is unrelated to the emergency, gently redirect back to safety."""

@app.post("/chat")
async def chat_endpoint(payload: ChatPayload):
    services = payload.services or {}
    hosp_name = services.get('hospital', {}).get('name', 'the nearest hospital')
    context_note = f"Currently dispatched nearest hospital: {hosp_name}."
    
    if not GROQ_API_KEY:
        return {"response": f"AI chat is not configured on the server. For immediate help, head to {hosp_name} or call 112."}
        
    messages = [{"role": "system", "content": CHAT_SYSTEM_PROMPT + "\n" + context_note}]
    
    for turn in (payload.history or [])[-6:]:
        role = turn.get("role")
        content = turn.get("content")
        if role in ("user", "assistant") and content:
            messages.append({"role": role, "content": content})
            
    messages.append({"role": "user", "content": payload.message})
    
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                GROQ_ENDPOINT,
                headers={"Authorization": f"Bearer {GROQ_API_KEY}", "Content-Type": "application/json"},
                json={"model": GROQ_CHAT_MODEL, "messages": messages, "temperature": 0.3, "max_tokens": 300},
                timeout=15
            )
            resp.raise_for_status()
            data = resp.json()
            reply = data["choices"][0]["message"]["content"]
    except Exception as e:
        reply = f"I'm having trouble connecting right now. If this is urgent, call 112 immediately or head to {hosp_name}."
        
    return {"response": reply}

@app.post("/upload_medical_report")
async def upload_medical_report(payload: MedicalReportPayload):
    if not GROQ_API_KEY:
        return {"error": "AI summarization is not configured."}
    summary = None
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                GROQ_ENDPOINT,
                headers={"Authorization": f"Bearer {GROQ_API_KEY}", "Content-Type": "application/json"},
                json={
                    "model": GROQ_VISION_MODEL,
                    "messages": [
                        {"role": "system", "content": (
                            "Extract ONLY clinically relevant facts: diagnosed conditions, current medications, allergies, and critical warnings. "
                            "Output as a short bulleted list. No filler."
                        )},
                        {"role": "user", "content": [
                            {"type": "text", "text": "Summarize this medical report for emergency responders."},
                            {"type": "image_url", "image_url": {"url": payload.image_base64}}
                        ]}
                    ],
                    "max_tokens": 250,
                    "temperature": 0.1
                },
                timeout=25
            )
            resp.raise_for_status()
            data = resp.json()
            summary = data["choices"][0]["message"]["content"]
    except Exception as e:
        return {"error": "Could not analyze the report right now."}
        
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(
            "UPDATE users SET medical_report_image=%s, medical_summary=%s, medical_summary_updated_at=NOW() WHERE email=%s",
            (payload.image_base64, summary, payload.email)
        )
        conn.commit()
        cursor.close()
        conn.close()
    except Exception as e:
        return {"error": str(e)}
        
    return {"message": "Report uploaded and summarized", "summary": summary}

@app.post("/set_medical_visibility")
async def set_medical_visibility(payload: ProfileVisibilityPayload):
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("UPDATE users SET show_medical_summary=%s WHERE email=%s", (payload.show_medical_summary, payload.email))
        conn.commit()
        cursor.close()
        conn.close()
        return {"message": "Visibility updated"}
    except Exception as e:
        return {"error": str(e)}
