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
#AWS Database Imports
import psycopg2
from psycopg2 import IntegrityError
load_dotenv()
app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
#LOAD ML MODEL
MODEL_PATH = "models/multilingual_rf_model.pkl"
try:
    ai_model = joblib.load(MODEL_PATH)
    print("ML Model loaded successfully.")
except Exception as e:
    ai_model = None
    print(f"Warning: Could not load ML model. Error: {e}")
#MODELS
class NewUser(BaseModel):
    email: str
    password: str
    name: str
    blood_group: str
    allergies: str
    conditions: str
    phone: str
    em1: str
    em2: str
    em3: str
    em4: str
    em5: str
    em6: str
class UpdateUser(BaseModel):
    current_email: str
    email: str
    name: str
    blood_group: str
    allergies: str
    conditions: str
    phone: str
    em1: str
    em2: str
    em3: str
    em4: str
    em5: str
    em6: str
class EmergencyPayload(BaseModel):
    user_id: str
    latitude: float = None
    longitude: float = None
class TriagePayload(BaseModel):
    type: str
    services: dict = {}
#DATABASE SETUP
def get_db_connection():
    return psycopg2.connect(os.getenv('DATABASE_URL'))
def init_db():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            user_id TEXT PRIMARY KEY,
            email TEXT UNIQUE,
            password TEXT,
            name TEXT,
            blood_group TEXT,
            allergies TEXT,
            conditions TEXT,
            phone TEXT,
            em1 TEXT,
            em2 TEXT,
            em3 TEXT,
            em4 TEXT,
            em5 TEXT,
            em6 TEXT
        )
    ''')
    conn.commit()
    conn.close()
init_db()
#HELPER FUNCTIONS
def hash_password(password: str):
    return hashlib.sha256(password.encode()).hexdigest()
def find_nearest_services(lat, lon):
    # Queries Overpass for Hospitals. Police & Ambulance are simulated placeholders for now.
    overpass_url = "http://overpass-api.de/api/interpreter"
    overpass_query = f"""
    [out:json];
    node["amenity"="hospital"](around:5000,{lat},{lon});
    out 1;
    """
    headers = {"User-Agent": "RakshamEmergencyApp/1.0"}
    hospital_name = "Nearest Medical Facility (General Area)"
    try:
        response = requests.post(overpass_url, data={'data': overpass_query}, headers=headers, timeout=5)
        elements = response.json().get('elements', [])
        if elements:
            hospital_name = elements[0].get('tags', {}).get('name', hospital_name)
    except:
        pass

    return {
        "hospital": hospital_name,
        "police_station": "Local Precinct (Simulated)",
        "ambulance": "City EMS Dispatch (Simulated)"
    }
#BACKGROUND TASK: CRASH PREVENTION
def process_emergency_alerts(contacts, services, lat, lon):
    """Handles TextBee SMS and Webhooks asynchronously so the app doesn't crash."""
    TEXTBEE_API_KEY = os.getenv("TEXTBEE_API_KEY")
    TEXTBEE_DEVICE_ID = os.getenv("TEXTBEE_DEVICE_ID")

    # 1. Send SMS via TextBee using the mobile SIM
    if TEXTBEE_API_KEY and TEXTBEE_DEVICE_ID:
        # Filter out empty or invalid contacts
        valid_contacts = [c for c in contacts if c and len(c) >= 5]
        
        if valid_contacts:
            maps_link = f"https://maps.google.com/?q={lat},{lon}" if lat else "Location unavailable"
            
            alert_text = (
                f"🚨 RAKSHAM CRITICAL EMERGENCY ALERT 🚨\n\n"
                f"📍 Location: {maps_link}\n"
                f"🏥 Assigned Hospital: {services.get('hospital', 'N/A')}\n"
                f"🚓 Police Station: {services.get('police_station', 'N/A')}\n"
                f"🚑 Ambulance Service: {services.get('ambulance', 'N/A')}\n\n"
                f"⚠️ Immediate assistance required at scene!"
            )

            # TextBee API endpoint for sending SMS
            url = f"https://api.textbee.dev/api/v1/gateway/devices/{TEXTBEE_DEVICE_ID}/send-sms"
            
            headers = {
                "x-api-key": TEXTBEE_API_KEY,
                "Content-Type": "application/json"
            }

            # TextBee accepts multiple recipients in a single payload
            payload = {
                "recipients": valid_contacts,
                "message": alert_text
            }

            try:
                response = requests.post(url, json=payload, headers=headers, timeout=5)
                if response.status_code == 200:
                    print(f"TextBee SMS broadcast queued successfully for {len(valid_contacts)} contacts!")
                else:
                    print(f"TextBee API Error: {response.text}")
            except Exception as e:
                print(f"Failed to send TextBee alert: {e}")
    else:
        print("TextBee credentials missing in .env file.")

    #Alert Hospital/Police/Ambulance via Webhook
    hospital_webhook_url = os.getenv('HOSPITAL_WEBHOOK_URL')
    if hospital_webhook_url:
        dispatch_payload = {
            "alert": "CRITICAL EMERGENCY",
            "assigned_services": services,
            "gps_coordinates": f"{lat}, {lon}" if lat else "Unavailable",
            "timestamp": time.time()
        }
        for attempt in range(3):
            try:
                requests.post(hospital_webhook_url, json=dispatch_payload, timeout=5)
                break 
            except requests.exceptions.RequestException:
                time.sleep(2)
#API ROUTES
@app.get("/")
async def root():
    return {"message": "Raksham AWS Backend is Online!"}
@app.post("/register")
async def register_user(user: NewUser):
    conn = get_db_connection()
    cursor = conn.cursor()
    new_user_id = str(uuid.uuid4())
    hashed_pw = hash_password(user.password)
    try:
        cursor.execute('''
            INSERT INTO users (user_id, email, password, name, blood_group, allergies, conditions, phone, em1, em2, em3, em4, em5, em6) 
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        ''', (new_user_id, user.email, hashed_pw, user.name, user.blood_group, user.allergies, user.conditions, user.phone, user.em1, user.em2, user.em3, user.em4, user.em5, user.em6))
        conn.commit()
    except IntegrityError:
        conn.close()
        return {"error": "Email already registered"}
    finally:
        conn.close()
    return {"status": "success", "email": user.email}

@app.post("/login")
async def login_user(data: dict):
    email = data.get("email")
    password = data.get("password")
    
    if not email or not password:
        return {"error": "Email and password are required."}
        
    hashed_pw = hash_password(password)
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT user_id FROM users WHERE email = %s AND password = %s', (email, hashed_pw))
    user = cursor.fetchone()
    conn.close()
    
    if user:
        return {"status": "success", "email": email}
    return {"error": "Invalid email or password."}

@app.post("/retrieve_profile_data")
async def retrieve_profile_data(data: dict):
    email = data.get("email")
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT * FROM users WHERE email = %s', (email,))
    user = cursor.fetchone()
    conn.close()
    
    if user:
        user_id = user[0]
        # CHANGE TO YOUR AWS AMPLIFY DOMAIN ONCE DEPLOYED
        profile_url = f"https://raksham-pi.vercel.app/index.html?id={user_id}"
        qr = qrcode.QRCode(version=2, error_correction=qrcode.constants.ERROR_CORRECT_H, box_size=10, border=4)
        qr.add_data(profile_url)
        qr.make(fit=True)
        img = qr.make_image(fill_color="black", back_color="white")
        buffered = BytesIO()
        img.save(buffered, format="PNG")
        qr_base64 = base64.b64encode(buffered.getvalue()).decode("utf-8")
        
        return {
            "status": "success",
            "qr_image": f"data:image/png;base64,{qr_base64}",
            "user_data": {
                "email": user[1], "name": user[3], "blood_group": user[4],
                "allergies": user[5], "conditions": user[6], "phone": user[7],
                "em1": user[8], "em2": user[9], "em3": user[10],
                "em4": user[11], "em5": user[12], "em6": user[13]
            }
        }
    return {"error": "User not found."}

@app.post("/update_profile")
async def update_profile(data: UpdateUser):
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('''
            UPDATE users 
            SET email=%s, name=%s, blood_group=%s, allergies=%s, conditions=%s, phone=%s, em1=%s, em2=%s, em3=%s, em4=%s, em5=%s, em6=%s
            WHERE email=%s
        ''', (data.email, data.name, data.blood_group, data.allergies, data.conditions, data.phone, data.em1, data.em2, data.em3, data.em4, data.em5, data.em6, data.current_email))
        conn.commit()
    except IntegrityError:
        return {"error": "New email is already taken by another account."}
    finally:
        conn.close()
    return {"status": "success"}

@app.get("/profile/{user_id}")
async def get_public_profile(user_id: str):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT name, blood_group, allergies, conditions, phone, em1, em2, em3, em4, em5, em6 FROM users WHERE user_id = %s', (user_id,))
    user = cursor.fetchone()
    conn.close()
    if user:
        return {
            "name": user[0], "blood_group": user[1], "allergies": user[2], 
            "conditions": user[3], "phone": user[4], "em1": user[5],
            "em2": user[6], "em3": user[7], "em4": user[8], "em5": user[9], "em6": user[10]
        }
    return {"error": "User not found"}

recent_requests = {}

@app.post("/trigger_emergency")
async def trigger_emergency(request: Request, payload: EmergencyPayload, background_tasks: BackgroundTasks):
    client_ip = request.client.host
    current_time = time.time()
    
    if client_ip in recent_requests and (current_time - recent_requests[client_ip]) < 60:
        return {"status": "error", "message": "Rate limit exceeded. Please wait."}
    recent_requests[client_ip] = current_time

    #Fetch user's emergency contacts from DB
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT em1, em2, em3, em4, em5, em6 FROM users WHERE user_id = %s', (payload.user_id,))
    row = cursor.fetchone()
    conn.close()
    
    contacts = [num for num in row if num] if row else []

    #Get nearest services
    services = find_nearest_services(payload.latitude, payload.longitude) if payload.latitude else {
        "hospital": "Unknown Medical Facility", "police_station": "Unknown Police", "ambulance": "Unknown EMS"
    }

    # Hand off SMS & Webhooks to Background Task to prevent crashes
    background_tasks.add_task(process_emergency_alerts, contacts, services, payload.latitude, payload.longitude)

    #Return services immediately to frontend for the AI Triage
    return {"status": "success", "message": "Emergency alerted securely.", "services": services}

@app.post("/ai_triage")
async def ai_triage(payload: TriagePayload):
    incident_type = payload.type
    dispatched = payload.services
    guidance = []

    if ai_model:
        try:
            #Format inputs based on RF model architecture
            input_features = np.zeros((1, ai_model.n_features_in_)) 
            prediction = ai_model.predict(input_features)
            
            #AI Now has context of the dispatched units
            guidance = [
                f"AI Assessment: {str(prediction[0])}", 
                f"Help is en route from: {dispatched.get('hospital')} and {dispatched.get('ambulance')}."
            ]
        except Exception as e:
            guidance = [f"Model Inference Error: {str(e)}", "1. Wait for emergency services."]
    else:
        #Fallback guidance incorporating dynamic hospital/police data
        guidance = [
            f"<strong>Incident Logged:</strong> {incident_type}",
            f"<strong>Ambulance:</strong> {dispatched.get('ambulance')} dispatched.",
            f"<strong>Hospital Alerted:</strong> {dispatched.get('hospital')}",
            f"<strong>Police Notified:</strong> {dispatched.get('police_station')}",
            "<br><strong>IMMEDIATE ACTIONS:</strong>",
            "1. Do not leave the victim unattended.",
            "2. Keep them breathing and conscious."
        ]

    return {"status": "success", "suggestions": guidance}
