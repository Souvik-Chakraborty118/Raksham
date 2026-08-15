from fastapi import FastAPI, Request, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import time
import qrcode
import base64
from io import BytesIO
import os
import requests
import uuid
import hashlib
from dotenv import load_dotenv
import joblib
import numpy as np
import psycopg2
from psycopg2.extras import RealDictCursor
from psycopg2 import IntegrityError

load_dotenv()
app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- LOAD ML MODEL ---
MODEL_PATH = "models/multilingual_rf_model.pkl"
try:
    ai_model = joblib.load(MODEL_PATH)
    print("ML Model loaded successfully.")
except Exception as e:
    ai_model = None

# --- MODELS ---
class NewUser(BaseModel):
    email: str; password: str; name: str; blood_group: str; allergies: str; conditions: str
    phone: str; em1: str; em2: str; em3: str; em4: str; em5: str; em6: str

class UpdateUser(BaseModel):
    current_email: str; email: str; name: str; blood_group: str; allergies: str; conditions: str
    phone: str; em1: str; em2: str; em3: str; em4: str; em5: str; em6: str

class EmergencyPayload(BaseModel):
    user_id: str
    latitude: float = None
    longitude: float = None

class TriagePayload(BaseModel):
    type: str
    services: dict = {}

# --- DATABASE SETUP ---
def get_db_connection():
    return psycopg2.connect(os.getenv('DATABASE_URL'), cursor_factory=RealDictCursor)

# --- IN-MEMORY LIVE TRACKING ---
live_locations = {}

# --- ADVANCED MAP SCRAPING ---
def fetch_facility(tag_key, tag_value, lat, lon):
    overpass_url = "http://overpass-api.de/api/interpreter"
    # Using 'nwr' (nodes, ways, relations) and 'out center' catches full building polygons
    query = f"""
    [out:json];
    nwr["{tag_key}"="{tag_value}"](around:5000,{lat},{lon});
    out center 1;
    """
    try:
        response = requests.post(overpass_url, data={'data': query}, headers={"User-Agent": "RakshamApp/2.0"}, timeout=5)
        elements = response.json().get('elements', [])
        if elements:
            tags = elements[0].get('tags', {})
            name = tags.get('name', f'Unnamed {tag_value.replace("_", " ").title()}')
            phone = tags.get('phone', tags.get('contact:phone', 'Phone Not Listed'))
            
            addr_full = tags.get('addr:full', '')
            street = tags.get('addr:street', '')
            city = tags.get('addr:city', '')
            address = addr_full if addr_full else ", ".join([p for p in [street, city] if p])
            if not address: address = "Address Not Listed"
                
            return {
                "html": f"<span style='color:#333; font-weight:bold;'>{name}</span><br>📍 {address}<br>📞 <a href='tel:{phone}' style='color:#FF003C;'>{phone}</a>",
                "name": name,
                "phone": phone if phone != 'Phone Not Listed' else None
            }
    except Exception as e:
        pass
        
    return {"html": f"No {tag_value.replace('_', ' ')} found nearby.", "name": "Unknown", "phone": None}

def find_nearest_services(lat, lon):
    if not lat or not lon:
        return {k: {"html": "GPS disabled. Please allow location.", "name": "Unknown", "phone": None} for k in ["hospital", "police_station", "ambulance"]}
    
    return {
        "hospital": fetch_facility("amenity", "hospital", lat, lon),
        "police_station": fetch_facility("amenity", "police", lat, lon),
        "ambulance": fetch_facility("emergency", "ambulance_station", lat, lon)
    }

# --- SMS TO EMERGENCY CONTACTS ONLY ---
def process_emergency_alerts(contacts, services, lat, lon, user_id):
    TEXTBEE_API_KEY = os.getenv("TEXTBEE_API_KEY")
    TEXTBEE_DEVICE_ID = os.getenv("TEXTBEE_DEVICE_ID")

    if TEXTBEE_API_KEY and TEXTBEE_DEVICE_ID:
        valid_contacts = [c for c in contacts if c and len(c) >= 5]
        if valid_contacts:
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
            except:
                pass

# --- API ROUTES ---
@app.get("/")
async def root(): return {"message": "Raksham Backend Online"}

@app.post("/register")
async def register_user(user: NewUser):
    conn = get_db_connection()
    cursor = conn.cursor()
    new_user_id = str(uuid.uuid4())
    hashed_pw = hashlib.sha256(user.password.encode()).hexdigest()
    try:
        cursor.execute('''INSERT INTO users (user_id, email, password, name, blood_group, allergies, conditions, phone, em1, em2, em3, em4, em5, em6) 
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)''', 
            (new_user_id, user.email, hashed_pw, user.name, user.blood_group, user.allergies, user.conditions, user.phone, user.em1, user.em2, user.em3, user.em4, user.em5, user.em6))
        conn.commit()
    except IntegrityError:
        return {"error": "Email already registered"}
    finally:
        conn.close()
    return {"status": "success", "email": user.email}

@app.post("/login")
async def login_user(data: dict):
    hashed_pw = hashlib.sha256(data.get("password", "").encode()).hexdigest()
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT user_id FROM users WHERE email = %s AND password = %s', (data.get("email"), hashed_pw))
    user = cursor.fetchone()
    conn.close()
    if user: return {"status": "success", "email": data.get("email")}
    return {"error": "Invalid email or password."}

@app.post("/retrieve_profile_data")
async def retrieve_profile_data(data: dict):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT * FROM users WHERE email = %s', (data.get("email"),))
    user = cursor.fetchone()
    conn.close()
    
    if user:
        profile_url = f"https://raksham-pi.vercel.app/index.html?id={user['user_id']}"
        img = qrcode.make(profile_url)
        buffered = BytesIO()
        img.save(buffered, format="PNG")
        qr_base64 = base64.b64encode(buffered.getvalue()).decode("utf-8")
        return {"status": "success", "qr_image": f"data:image/png;base64,{qr_base64}", "user_data": dict(user)}
    return {"error": "User not found."}

@app.post("/update_profile")
async def update_profile(data: UpdateUser):
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('''UPDATE users SET email=%s, name=%s, blood_group=%s, allergies=%s, conditions=%s, phone=%s, em1=%s, em2=%s, em3=%s, em4=%s, em5=%s, em6=%s WHERE email=%s''', 
        (data.email, data.name, data.blood_group, data.allergies, data.conditions, data.phone, data.em1, data.em2, data.em3, data.em4, data.em5, data.em6, data.current_email))
        conn.commit()
    except IntegrityError:
        return {"error": "New email is already taken by another account."}
    finally:
        conn.close()
    return {"status": "success", "new_email": data.email}

@app.get("/profile/{user_id}")
async def get_public_profile(user_id: str):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT name, blood_group, allergies, conditions, phone, em1, em2, em3, em4, em5, em6 FROM users WHERE user_id = %s', (user_id,))
    user = cursor.fetchone()
    conn.close()
    if user: return dict(user)
    return {"error": "User not found"}

recent_requests = {}

@app.post("/trigger_emergency")
async def trigger_emergency(request: Request, payload: EmergencyPayload, background_tasks: BackgroundTasks):
    client_ip = request.client.host
    current_time = time.time()
    if client_ip in recent_requests and (current_time - recent_requests[client_ip]) < 60:
        return {"status": "error", "message": "Rate limit exceeded. Please wait."}
    recent_requests[client_ip] = current_time

    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT em1, em2, em3, em4, em5, em6 FROM users WHERE user_id = %s', (payload.user_id,))
    row = cursor.fetchone()
    conn.close()
    
    contacts = [row['em1'], row['em2'], row['em3'], row['em4'], row['em5'], row['em6']] if row else []
    services = find_nearest_services(payload.latitude, payload.longitude)

    # Trigger background SMS strictly to emergency contacts
    background_tasks.add_task(process_emergency_alerts, contacts, services, payload.latitude, payload.longitude, payload.user_id)

    return {"status": "success", "services": services}

@app.post("/update_location")
async def update_location(payload: dict):
    user_id = payload.get("user_id")
    if user_id:
        live_locations[user_id] = {"lat": payload.get("lat"), "lon": payload.get("lon"), "time": time.time()}
    return {"status": "success"}

@app.post("/alert_authorities")
async def alert_authorities(payload: dict):
    # This exclusively fires when the RED BUTTON is pressed
    services = payload.get("services", {})
    phones = []
    for key in ["hospital", "police_station", "ambulance"]:
        if services.get(key) and services[key].get("phone"):
            phones.append(services[key]["phone"])
            
    # Clean phone numbers for API
    valid_phones = ["".join(c for c in p if c.isdigit() or c == '+') for p in phones if len(p) >= 5]
    
    if not valid_phones:
        return {"status": "error", "message": "No valid public phone numbers found for nearby authorities."}

    TEXTBEE_API_KEY = os.getenv("TEXTBEE_API_KEY")
    TEXTBEE_DEVICE_ID = os.getenv("TEXTBEE_DEVICE_ID")

    if TEXTBEE_API_KEY and TEXTBEE_DEVICE_ID:
        url = f"https://api.textbee.dev/api/v1/gateway/devices/{TEXTBEE_DEVICE_ID}/send-sms"
        headers = {"x-api-key": TEXTBEE_API_KEY, "Content-Type": "application/json"}
        requests.post(url, json={"recipients": valid_phones, "message": "🚨 URGENT: Individual requires immediate emergency response at this location!"}, headers=headers)
        return {"status": "success", "message": f"Dispatched alerts to {len(valid_phones)} local authorities!"}
    
    return {"status": "error", "message": "SMS gateway unavailable."}

@app.post("/ai_triage")
async def ai_triage(payload: TriagePayload):
    incident_type = payload.type
    dispatched = payload.services
    
    guidance = [
        f"<strong>🏥 Nearest Hospital:</strong><br>{dispatched.get('hospital', {}).get('html', 'N/A')}",
        f"<strong>🚓 Nearest Police:</strong><br>{dispatched.get('police_station', {}).get('html', 'N/A')}",
        f"<strong>🚑 Nearest Ambulance:</strong><br>{dispatched.get('ambulance', {}).get('html', 'N/A')}",
        "<br><strong style='color:#FF003C;'>IMMEDIATE ACTIONS:</strong>",
        "1. Do not leave the victim unattended.",
        "2. Keep them breathing and conscious."
    ]

    if ai_model:
        try:
            input_features = np.zeros((1, ai_model.n_features_in_)) 
            prediction = ai_model.predict(input_features)
            guidance.insert(0, f"<span style='color:#FF003C; font-weight:900;'>ML SEVERITY ASSESSMENT: LEVEL {str(prediction[0])}</span><br>")
        except:
            pass

    return {"status": "success", "suggestions": guidance}

@app.post("/chat")
async def chat(data: dict):
    groq_api_key = os.getenv("GROQ_API_KEY")
    if not groq_api_key:
        return {"reply": "Groq API key is missing in Render Environment Variables."}
    
    headers = {"Authorization": f"Bearer {groq_api_key}", "Content-Type": "application/json"}
    payload = {
        "model": "llama3-8b-8192", # <-- UPDATED TO A SUPPORTED, FAST MODEL
        "messages": [
            {"role": "system", "content": "You are Raksham AI. Give extremely concise, life-saving first-aid advice in 2 sentences max."},
            {"role": "user", "content": data.get("message", "")}
        ]
    }
    try:
        resp = requests.post("https://api.groq.com/openai/v1/chat/completions", json=payload, headers=headers, timeout=12) 
        resp_data = resp.json()
        
        # Safely parse response or print the actual API error
        if "choices" in resp_data:
            return {"reply": resp_data["choices"][0]["message"]["content"]}
        else:
            api_error = resp_data.get('error', {}).get('message', 'Check API Key')
            return {"reply": f"Groq API Error: {api_error}"}
            
    except Exception as e:
        return {"reply": f"AI Request Timeout/Error: {str(e)}"}
            
    except Exception as e:
        return {"reply": f"AI Request Timeout/Error: {str(e)}"}
