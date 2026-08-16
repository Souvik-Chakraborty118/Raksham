import os
import math
import time
import requests
import httpx
import psycopg2
import numpy as np
import joblib
import uuid
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
    return {"status": "online"}

app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"],
)

def get_db_connection():
    return psycopg2.connect(os.getenv("DATABASE_URL"), cursor_factory=RealDictCursor)

try: ai_model = joblib.load("models/multilingual_rf_model.pkl")
except Exception: ai_model = None

live_locations = {}

class NewUser(BaseModel):
    email: str; password: str; name: str; blood_group: str; allergies: str; conditions: str
    phone: str; em1: str; em2: str; em3: str; em4: str; em5: str; em6: str

class LoginUser(BaseModel): email: str; password: str
class ProfileRequest(BaseModel): email: str
class UpdateUser(BaseModel):
    current_email: str; email: str; name: str; blood_group: str; allergies: str; conditions: str
    phone: str; em1: str; em2: str; em3: str; em4: str; em5: str; em6: str

class LocationUpdate(BaseModel): user_id: str; lat: float; lon: float
class EmergencyPayload(BaseModel): user_id: str; latitude: float = None; longitude: float = None; services: dict = {}
class TriagePayload(BaseModel): type: str = None; services: dict = {}
class ChatMessage(BaseModel): role: str; content: str
class ChatPayload(BaseModel): message: str; services: dict = {}; history: List[ChatMessage] = []
class MedicalReportPayload(BaseModel): email: str; image_base64: str
class ProfileVisibilityPayload(BaseModel): email: str; show_medical_summary: bool

# --- SMS TO EMERGENCY CONTACTS ---
def process_emergency_alerts(contacts, services, lat, lon, user_id):
    TEXTBEE_API_KEY = os.getenv("TEXTBEE_API_KEY")
    TEXTBEE_DEVICE_ID = os.getenv("TEXTBEE_DEVICE_ID")
    valid_contacts = [c for c in contacts if c and len(c) >= 5]
    
    if valid_contacts and TEXTBEE_API_KEY and TEXTBEE_DEVICE_ID:
        maps_link = f"https://maps.google.com/?q={lat},{lon}" if lat else "Location unavailable"
        live_link = f"https://raksham-pi.vercel.app/track.html?id={user_id}"
        
        # EXTRACT BOTH HOSPITAL AND POLICE NAMES
        hosp_name = services.get('hospital', {}).get('name', 'Nearest Hospital')
        police_name = services.get('police_station', {}).get('name', 'Local Police')
        
        alert_text = (
            f"🚨 RAKSHAM CRITICAL ALERT 🚨\n\n"
            f"📍 GPS Location: {maps_link}\n"
            f"📡 Live Tracking: {live_link}\n\n"
            f"🏥 Hospital: {hosp_name}\n"
            f"🚓 Police: {police_name}\n\n"
            f"⚠️ Immediate medical assistance is required!"
        )
        url = f"https://api.textbee.dev/api/v1/gateway/devices/{TEXTBEE_DEVICE_ID}/send-sms"
        try:
            requests.post(url, json={"recipients": valid_contacts, "message": alert_text}, headers={"x-api-key": TEXTBEE_API_KEY, "Content-Type": "application/json"}, timeout=5)
        except Exception:
            pass

@app.post("/register")
async def register(user: NewUser):
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        user_id = str(uuid.uuid4())
        qr_link = f"https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=https://raksham-pi.vercel.app/index.html?id={user_id}"
        hashed_password = hash_password(user.password.strip())
        cursor.execute('INSERT INTO users (user_id, email, password, name, blood_group, allergies, conditions, phone, em1, em2, em3, em4, em5, em6, qr_image) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)', 
                       (user_id, user.email.strip().lower(), hashed_password, user.name, user.blood_group, user.allergies, user.conditions, user.phone, user.em1, user.em2, user.em3, user.em4, user.em5, user.em6, qr_link))
        conn.commit(); cursor.close(); conn.close()
        return {"message": "User registered"}
    except Exception as e: return {"error": str(e)}

@app.post("/login")
async def login(user: LoginUser):
    try:
        conn = get_db_connection(); cursor = conn.cursor()
        cursor.execute("SELECT * FROM users WHERE LOWER(TRIM(email)) = %s AND password = %s", (user.email.strip().lower(), hash_password(user.password.strip())))
        row = cursor.fetchone(); cursor.close(); conn.close()
        if row: return {"message": "Login successful"}
        return {"error": "Invalid email or password"}
    except Exception as e: return {"error": str(e)}

@app.post("/retrieve_profile_data")
async def retrieve_profile(req: ProfileRequest):
    try:
        conn = get_db_connection(); cursor = conn.cursor()
        cursor.execute("SELECT * FROM users WHERE email = %s", (req.email,))
        row = cursor.fetchone(); cursor.close(); conn.close()
        if row: return {"user_data": row, "qr_image": row.get('qr_image')}
        return {"error": "Not found"}
    except Exception as e: return {"error": str(e)}

@app.get("/profile/{user_id}")
async def get_public_profile(user_id: str):
    try:
        conn = get_db_connection(); cursor = conn.cursor()
        cursor.execute("SELECT name, blood_group, allergies, conditions, phone, em1, em2, em3, em4, em5, em6, medical_summary, show_medical_summary FROM users WHERE user_id = %s", (user_id,))
        row = cursor.fetchone(); cursor.close(); conn.close()
        if row:
            if not row.get("show_medical_summary", True): row["medical_summary"] = None
            return row
        return {"error": "Not found"}
    except Exception as e: return {"error": str(e)}

@app.post("/update_profile")
async def update_profile(user: UpdateUser):
    try:
        conn = get_db_connection(); cursor = conn.cursor()
        cursor.execute('UPDATE users SET email=%s, name=%s, blood_group=%s, allergies=%s, conditions=%s, phone=%s, em1=%s, em2=%s, em3=%s, em4=%s, em5=%s, em6=%s WHERE email=%s', 
                       (user.email, user.name, user.blood_group, user.allergies, user.conditions, user.phone, user.em1, user.em2, user.em3, user.em4, user.em5, user.em6, user.current_email))
        conn.commit(); cursor.close(); conn.close()
        return {"message": "Updated"}
    except Exception as e: return {"error": str(e)}

@app.post("/update_location")
async def update_location(payload: LocationUpdate):
    live_locations[payload.user_id] = {"lat": payload.lat, "lon": payload.lon, "timestamp": time.time()}
    return {"status": "Location updated"}

@app.get("/get_location/{user_id}")
async def get_location(user_id: str):
    loc = live_locations.get(user_id)
    if loc: return {"status": "success", "data": {"lat": loc["lat"], "lon": loc["lon"]}}
    return {"status": "error", "message": "Location unavailable."}

@app.post("/trigger_emergency")
async def trigger_emergency(payload: EmergencyPayload, background_tasks: BackgroundTasks):
    try:
        conn = get_db_connection(); cursor = conn.cursor()
        cursor.execute("SELECT em1, em2, em3, em4, em5, em6 FROM users WHERE user_id = %s", (payload.user_id,))
        row = cursor.fetchone(); cursor.close(); conn.close()
        if row:
            contacts = [row['em1'], row['em2'], row['em3'], row['em4'], row['em5'], row['em6']]
            # Pass the services payload received from the frontend into the background task
            background_tasks.add_task(process_emergency_alerts, contacts, payload.services, payload.latitude, payload.longitude, payload.user_id)
    except: pass
    return {"status": "Emergency Triggered"}

@app.post("/ai_triage")
async def ai_triage(payload: TriagePayload):
    dispatched = payload.services or {}
    h = dispatched.get('hospital', {}).get('html', "N/A")
    p = dispatched.get('police_station', {}).get('html', "N/A")
    a = dispatched.get('ambulance', {}).get('html', "N/A")
    
    guidance = [f"<strong>🏥 {h}</strong><br>", f"<strong>🚓 {p}</strong><br>", f"<strong>🚑 {a}</strong><br>", "<br><strong style='color:#FF003C;'>IMMEDIATE ACTIONS:</strong>"]
    situation = (payload.type or "").lower()
    
    if "heart" in situation: guidance.extend(["1. Have the person sit down, rest, and try to keep calm.", "2. Loosen any tight clothing.", "3. If unresponsive, begin CPR immediately."])
    elif "accident" in situation: guidance.extend(["1. DO NOT move the victim unless they are in immediate danger.", "2. Apply firm, direct pressure to any bleeding wounds.", "3. Keep the victim's head perfectly still."])
    elif "assault" in situation: guidance.extend(["1. Move to a safe location immediately.", "2. Apply direct pressure to stop bleeding.", "3. Wait for police and ambulance dispatch."])
    else: guidance.extend(["1. Check airway, breathing, and circulation.", "2. Do not leave the victim unattended.", "3. Apply pressure to any bleeding."])
        
    if ai_model:
        try:
            prediction = ai_model.predict(np.zeros((1, ai_model.n_features_in_)))
            guidance.insert(0, f"<span style='color:#FF003C; font-weight:900;'>ML SEVERITY ASSESSMENT: LEVEL {str(prediction[0])}</span><br>")
        except: pass
    return {"status": "success", "suggestions": guidance}

GROQ_API_KEY = os.getenv("GROQ_API_KEY")

@app.post("/chat")
async def chat_endpoint(payload: ChatPayload):
    hosp_name = payload.services.get('hospital', {}).get('name', 'the nearest hospital')
    if not GROQ_API_KEY: return {"response": f"AI missing. Head to {hosp_name} or call 112."}
    
    msgs = [{"role": "system", "content": f"You are Raksham AI. Give short, direct, actionable first-aid guidance. Remind them to head to {hosp_name}."}]
    for turn in (payload.history or [])[-6:]:
        if turn.role in ("user", "assistant") and turn.content: msgs.append({"role": turn.role, "content": turn.content})
    msgs.append({"role": "user", "content": payload.message})
    
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post("https://api.groq.com/openai/v1/chat/completions", headers={"Authorization": f"Bearer {GROQ_API_KEY}"}, json={"model": "llama-3.3-70b-versatile", "messages": msgs, "temperature": 0.3, "max_tokens": 300}, timeout=15)
            return {"response": resp.json()["choices"][0]["message"]["content"]}
    except: return {"response": f"Connection issue. Call 112 or head to {hosp_name}."}

@app.post("/upload_medical_report")
async def upload_medical_report(payload: MedicalReportPayload):
    if not GROQ_API_KEY: return {"error": "AI missing."}
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post("https://api.groq.com/openai/v1/chat/completions", headers={"Authorization": f"Bearer {GROQ_API_KEY}"}, json={"model": "llama-3.2-11b-vision-preview", "messages": [{"role": "system", "content": "Extract ONLY clinical facts: diagnosed conditions, medications, allergies, warnings. Short bulleted list."}, {"role": "user", "content": [{"type": "text", "text": "Summarize this report."}, {"type": "image_url", "image_url": {"url": payload.image_base64}}]}], "max_tokens": 250}, timeout=25)
            summary = resp.json()["choices"][0]["message"]["content"]
        
        conn = get_db_connection(); cursor = conn.cursor()
        cursor.execute("UPDATE users SET medical_report_image=%s, medical_summary=%s, medical_summary_updated_at=NOW() WHERE email=%s", (payload.image_base64, summary, payload.email))
        conn.commit(); cursor.close(); conn.close()
        return {"message": "Success", "summary": summary}
    except Exception as e: return {"error": str(e)}

@app.post("/set_medical_visibility")
async def set_medical_visibility(payload: ProfileVisibilityPayload):
    try:
        conn = get_db_connection(); cursor = conn.cursor()
        cursor.execute("UPDATE users SET show_medical_summary=%s WHERE email=%s", (payload.show_medical_summary, payload.email))
        conn.commit(); cursor.close(); conn.close()
        return {"message": "Visibility updated"}
    except Exception as e: return {"error": str(e)}
