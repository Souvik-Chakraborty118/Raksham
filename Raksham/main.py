import os
import time
import json
import uuid
import asyncio
import hashlib
import smtplib
from pathlib import Path
from typing import List, Optional
from email.message import EmailMessage
import requests
import httpx
import psycopg2
import numpy as np
import joblib
from sklearn.neighbors import BallTree
from fastapi import FastAPI, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from psycopg2.extras import RealDictCursor

EARTH_RADIUS_KM = 6371.0
MAX_MATCH_RADIUS_KM = 35.0
DATASET_PATH = Path(__file__).resolve().parent / "data" / "emergency_services.json"
def hash_password(password: str):
    return hashlib.sha256(password.encode()).hexdigest()

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
async def root():
    return {"status": "online"}


@app.get("/health")
async def health():
    return {"status": "alive"}


def get_db_connection():
    return psycopg2.connect(os.getenv("DATABASE_URL"), cursor_factory=RealDictCursor)


try:
    ai_model = joblib.load("models/multilingual_rf_model.pkl")
except Exception:
    ai_model = None

live_locations = {}


#TWO-STAGE SPATIAL ROUTER: BALLTREE O(log N) + OSRM ROAD ETA
class SpatialEmergencyRouter:
    def __init__(self, json_path: Path):
        self.by_category = {"hospital": [], "police_station": [], "ambulance": []}
        self.trees = {}

        if not json_path.exists():
            print(f"Dataset not found at {json_path}; spatial router running in fallback mode.")
            return

        with json_path.open("r", encoding="utf-8") as f:
            data = json.load(f)

        for item in data.get("services", []):
            cat = item.get("category")
            if cat in self.by_category and item.get("lat") is not None and item.get("lon") is not None:
                self.by_category[cat].append(item)

        for cat, items in self.by_category.items():
            if items:
                coords_rad = np.radians([[x["lat"], x["lon"]] for x in items])
                self.trees[cat] = BallTree(coords_rad, metric="haversine")

        print(
            "SpatialEmergencyRouter loaded:",
            {k: len(v) for k, v in self.by_category.items()},
        )

    @staticmethod
    def _fallback_service(category: str) -> dict:
        defaults = {
            "hospital": ("Nearest Emergency Hospital (Call 112)", "112"),
            "police_station": ("Local Police Control Room (Call 100 / 112)", "112"),
            "ambulance": ("108 National Emergency Ambulance", "108"),
        }
        name, phone = defaults.get(category, ("Emergency Services", "112"))
        return {
            "id": f"fallback_{category}",
            "name": name,
            "category": category,
            "landline": phone,
            "sms_mobile": None,
            "sms_capable": False,
            "emergency_email": None,
            "email_capable": False,
            "eta_min": None,
            "road_km": None,
            "google_maps_directions": None,
            "osm_link": None,
            "routing_method": "National Helpline Fallback",
            "html": f"{name} — Dial <a href='tel:{phone}'>{phone}</a>",
        }

    @staticmethod
    def _format_html(svc: dict) -> str:
        name = svc.get("name", "Emergency Service")
        dist_parts = []
        if svc.get("road_km") is not None:
            dist_parts.append(f"{svc['road_km']} km")
        if svc.get("eta_min") is not None:
            dist_parts.append(f"~{svc['eta_min']} min")
        dist_text = f" ({', '.join(dist_parts)})" if dist_parts else ""

        phone = svc.get("sms_mobile") or svc.get("landline")
        phone_html = f" | <a href='tel:{phone}'>{phone}</a>" if phone else ""
        maps_url = svc.get("google_maps_directions")
        maps_html = (
            f" | <a href='{maps_url}' target='_blank' rel='noopener'>Directions</a>"
            if maps_url
            else ""
        )
        return f"{name}{dist_text}{phone_html}{maps_html}"

    async def find_fastest(self, user_lat: float, user_lon: float, category: str, k: int = 5) -> dict:
        items = self.by_category.get(category, [])
        tree = self.trees.get(category)
        if not items or not tree:
            return self._fallback_service(category)

        # Stage 1: BallTree O(log N) lookup
        k = min(k, len(items))
        query_rad = np.radians([[user_lat, user_lon]])
        dists_rad, idxs = tree.query(query_rad, k=k)

        candidates = []
        for dist_r, idx in zip(dists_rad[0], idxs[0]):
            km = float(dist_r * EARTH_RADIUS_KM)
            if km <= MAX_MATCH_RADIUS_KM:
                entry = dict(items[idx])
                entry["straight_km"] = round(km, 2)
                candidates.append(entry)

        if not candidates:
            return self._fallback_service(category)

        # Stage 2: OSRM road-network ETA refinement (lon,lat order)
        coords_str = f"{user_lon},{user_lat};" + ";".join(
            f"{c['lon']},{c['lat']}" for c in candidates
        )
        osrm_url = (
            f"https://router.project-osrm.org/table/v1/driving/{coords_str}"
            "?sources=0&annotations=duration,distance"
        )

        winner = None
        try:
            async with httpx.AsyncClient(timeout=2.5) as client:
                resp = await client.get(osrm_url)
                if resp.status_code == 200:
                    body = resp.json()
                    durations = body.get("durations", [[]])[0][1:]
                    distances = body.get("distances", [[]])[0][1:]

                    best_idx, best_eta = None, float("inf")
                    for i, eta in enumerate(durations):
                        if eta is not None and eta < best_eta:
                            best_eta = eta
                            best_idx = i

                    if best_idx is not None:
                        winner = candidates[best_idx]
                        winner["eta_min"] = round(best_eta / 60.0, 1)
                        winner["road_km"] = round((distances[best_idx] or 0) / 1000.0, 2)
                        winner["routing_method"] = "BallTree + OSRM"
        except Exception:
            pass

        if winner is None:
            winner = candidates[0]
            winner["road_km"] = winner["straight_km"]
            winner["eta_min"] = None
            winner["routing_method"] = "BallTree Fallback"

        winner["html"] = self._format_html(winner)
        return winner

    async def find_all_nearest(self, user_lat: float, user_lon: float) -> dict:
        hosp, pol, amb = await asyncio.gather(
            self.find_fastest(user_lat, user_lon, "hospital"),
            self.find_fastest(user_lat, user_lon, "police_station"),
            self.find_fastest(user_lat, user_lon, "ambulance"),
        )
        return {
            "hospital": hosp,
            "police_station": pol,
            "ambulance": amb,
        }


spatial_router = SpatialEmergencyRouter(DATASET_PATH)


#PYDANTIC MODELS
class NewUser(BaseModel):
    email: str; password: str; name: str; blood_group: str; allergies: str; conditions: str
    phone: str; em1: str; em2: str; em3: str; em4: str; em5: str; em6: str
    
class LoginUser(BaseModel): email: str; password: str
class ProfileRequest(BaseModel): email: str


class UpdateUser(BaseModel):
    current_email: str; email: str; name: str; blood_group: str; allergies: str; conditions: str
    phone: str; em1: str; em2: str; em3: str; em4: str; em5: str; em6: str


class LocationUpdate(BaseModel): user_id: str; lat: float; lon: float
class CoordinatesPayload(BaseModel): lat: float; lon: float


class EmergencyPayload(BaseModel):
    user_id: str
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    services: dict = {}


class AuthorityAlertPayload(BaseModel):
    user_id: str
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    services: dict = {}
    categories: List[str] = ["hospital", "police_station", "ambulance"]


class TriagePayload(BaseModel):
    type: Optional[str] = None
    services: dict = {}
    latitude: Optional[float] = None
    longitude: Optional[float] = None


class ChatMessage(BaseModel): role: str; content: str
class ChatPayload(BaseModel): message: str; services: dict = {}; history: List[ChatMessage] = []
class MedicalReportPayload(BaseModel): email: str; image_base64: str
class ProfileVisibilityPayload(BaseModel): email: str; show_medical_summary: bool


# --- MULTI GROQ API KEY FALLBACK PARSER ---
def load_groq_keys() -> List[str]:
    keys = []
    for env_var in ("GROQ_API_KEYS", "GROQ_API_KEY", "GROQ_API_KEY_1", "GROQ_API_KEY_2"):
        raw = os.getenv(env_var, "")
        for k in raw.split(","):
            k = k.strip()
            if k and k not in keys:
                keys.append(k)
    return keys


GROQ_KEYS_LIST = load_groq_keys()

CHAT_MODELS = [
    "openai/gpt-oss-20b",
    "qwen/qwen3.8-27b",
    "openai/gpt-oss-120b",
]
VISION_MODEL = "qwen/qwen3.8-27b"


def clean_llm_output(raw_text: str) -> str:
    if not raw_text:
        return ""
    if "</think>" in raw_text:
        return raw_text.split("</think>")[-1].strip()
    return raw_text.strip()


#INSTANT FAMILY/EMERGENCY CONTACTS SMS ONLY
def send_family_emergency_sms(contacts, services, lat, lon, user_id, victim):
    textbee_key = os.getenv("TEXTBEE_API_KEY")
    textbee_device = os.getenv("TEXTBEE_DEVICE_ID")
    valid_contacts = [c.strip() for c in contacts if c and len(c.strip()) >= 5]

    if not (valid_contacts and textbee_key and textbee_device):
        return

    maps_link = f"https://maps.google.com/?q={lat},{lon}" if lat is not None and lon is not None else "Location unavailable"
    live_link = f"https://raksham-pi.vercel.app/track.html?id={user_id}"

    hosp_name = (services.get("hospital") or {}).get("name", "Nearest Hospital")
    police_name = (services.get("police_station") or {}).get("name", "Local Police")
    amb_name = (services.get("ambulance") or {}).get("name", "108 Emergency Ambulance")

    alert_text = (
        f"🚨 RAKSHAM CRITICAL ALERT 🚨\n\n"
        f"👤 Victim: {victim.get('name') or 'Unknown Victim'}\n"
        f"🩸 Blood Group: {victim.get('blood_group') or 'N/A'}\n"
        f"📍 GPS Location: {maps_link}\n"
        f"📡 Live Tracking: {live_link}\n\n"
        f"🏥 Nearest Hospital: {hosp_name}\n"
        f"🚓 Nearest Police: {police_name}\n"
        f"🚑 Nearest Ambulance: {amb_name}\n\n"
        f"⚠️ Immediate medical assistance is required!"
    )

    url = f"https://api.textbee.dev/api/v1/gateway/devices/{textbee_device}/send-sms"
    try:
        resp = requests.post(
            url,
            json={"recipients": valid_contacts, "message": alert_text},
            headers={"x-api-key": textbee_key, "Content-Type": "application/json"},
            timeout=8,
        )
        if resp.status_code >= 400:
            print(f"TextBee family SMS failed ({resp.status_code}): {resp.text}")
    except Exception as e:
        print(f"TextBee family SMS exception: {e}")


#NEAREST AUTHORITIES SMS + SMTP EMAIL ---
def dispatch_authority_alerts(services: dict, categories: List[str], lat: Optional[float], lon: Optional[float], user_id: str, victim: dict):
    textbee_key = os.getenv("TEXTBEE_API_KEY")
    textbee_device = os.getenv("TEXTBEE_DEVICE_ID")
    sender_email = os.getenv("SENDER_EMAIL")
    sender_password = os.getenv("SENDER_PASSWORD")

    sms_recipients = []
    email_recipients = []

    for cat in categories:
        svc = services.get(cat) or {}
        mob = svc.get("sms_mobile")
        if mob and mob not in sms_recipients:
            sms_recipients.append(mob)
        addr = svc.get("emergency_email")
        if addr and addr not in email_recipients:
            email_recipients.append(addr)

    maps_link = (
        f"https://www.google.com/maps/dir/?api=1&destination={lat},{lon}&travelmode=driving"
        if lat is not None and lon is not None
        else "Location unavailable"
    )
    live_link = f"https://raksham-pi.vercel.app/track.html?id={user_id}"
    medical_summary = victim.get("medical_summary") if victim.get("show_medical_summary", True) else "Hidden by user"

    # 1. Dispatch TextBee SMS to SMS-capable nearest authorities
    if sms_recipients and textbee_key and textbee_device:
        auth_sms = (
            f" RAKSHAM EMERGENCY DISPATCH \n\n"
            f"👤 Victim: {victim.get('name') or 'Unknown'}\n"
            f"🩸 Blood Group: {victim.get('blood_group') or 'N/A'}\n"
            f"⚠️ Allergies: {victim.get('allergies') or 'None'}\n"
            f"🩺 Conditions: {victim.get('conditions') or 'None'}\n"
            f"📍 Directions: {maps_link}\n"
            f"📡 Live Track: {live_link}\n"
            f"Requested via Raksham QR Emergency Alert."
        )
        url = f"https://api.textbee.dev/api/v1/gateway/devices/{textbee_device}/send-sms"
        try:
            resp = requests.post(
                url,
                json={"recipients": sms_recipients, "message": auth_sms},
                headers={"x-api-key": textbee_key, "Content-Type": "application/json"},
                timeout=8,
            )
            if resp.status_code >= 400:
                print(f"TextBee authority SMS failed ({resp.status_code}): {resp.text}")
            else:
                print(f"Authority SMS dispatched to {sms_recipients}")
        except Exception as e:
            print(f"TextBee authority SMS exception: {e}")

    #Gmail SMTP email to email-capable nearest authorities
    if email_recipients and sender_email and sender_password:
        hosp = services.get("hospital") or {}
        pol = services.get("police_station") or {}
        amb = services.get("ambulance") or {}

        body = (
            f"RAKSHAM CRITICAL EMERGENCY DISPATCH\n"
            f"{'=' * 40}\n"
            f"Victim Name: {victim.get('name', 'Unknown')}\n"
            f"Blood Group: {victim.get('blood_group', 'N/A')}\n"
            f"Allergies: {victim.get('allergies', 'None listed')}\n"
            f"Medical Conditions: {victim.get('conditions', 'None listed')}\n"
            f"Medical Report Summary: {medical_summary or 'None uploaded'}\n\n"
            f"LOCATION & LIVE TRACKING\n"
            f"GPS Coordinates: {lat}, {lon}\n"
            f"Google Maps Directions: {maps_link}\n"
            f"Live Responder Tracker: {live_link}\n\n"
            f"ROUTED EMERGENCY AUTHORITIES (BallTree + OSRM)\n"
            f"Hospital: {hosp.get('name', 'N/A')} (ETA: {hosp.get('eta_min', 'N/A')} min)\n"
            f"Police: {pol.get('name', 'N/A')} (ETA: {pol.get('eta_min', 'N/A')} min)\n"
            f"Ambulance: {amb.get('name', 'N/A')} (ETA: {amb.get('eta_min', 'N/A')} min)\n"
        )

        msg = EmailMessage()
        msg["Subject"] = f"RAKSHAM SOS DISPATCH: {victim.get('name', 'Victim')} ({victim.get('blood_group', 'N/A')})"
        msg["From"] = sender_email
        msg["To"] = ", ".join(email_recipients)
        msg.set_content(body)

        try:
            with smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=10) as smtp:
                smtp.login(sender_email, sender_password)
                smtp.send_message(msg)
            print(f"Authority alert email dispatched to {email_recipients}")
        except Exception as e:
            print(f"SMTP authority email dispatch failed: {e}")
    elif email_recipients:
        print("SMTP skipped: SENDER_EMAIL or SENDER_PASSWORD not configured.")


#ROUTES
@app.post("/nearest_services")
async def nearest_services(payload: CoordinatesPayload):
    services = await spatial_router.find_all_nearest(payload.lat, payload.lon)
    return {"status": "success", "services": services}


@app.post("/register")
async def register(user: NewUser):
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        user_id = str(uuid.uuid4())
        qr_link = f"https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=https://raksham-pi.vercel.app/index.html?id={user_id}"
        hashed_password = hash_password(user.password.strip())
        cursor.execute(
            "INSERT INTO users (user_id, email, password, name, blood_group, allergies, conditions, phone, em1, em2, em3, em4, em5, em6, qr_image) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
            (user_id, user.email.strip().lower(), hashed_password, user.name, user.blood_group, user.allergies, user.conditions, user.phone, user.em1, user.em2, user.em3, user.em4, user.em5, user.em6, qr_link),
        )
        conn.commit(); cursor.close(); conn.close()
        return {"message": "User registered"}
    except Exception as e:
        return {"error": str(e)}


@app.post("/login")
async def login(user: LoginUser):
    try:
        conn = get_db_connection(); cursor = conn.cursor()
        cursor.execute(
            "SELECT * FROM users WHERE LOWER(TRIM(email)) = %s AND password = %s",
            (user.email.strip().lower(), hash_password(user.password.strip())),
        )
        row = cursor.fetchone(); cursor.close(); conn.close()
        if row:
            return {"message": "Login successful"}
        return {"error": "Invalid email or password"}
    except Exception as e:
        return {"error": str(e)}


@app.post("/retrieve_profile_data")
async def retrieve_profile(req: ProfileRequest):
    try:
        conn = get_db_connection(); cursor = conn.cursor()
        cursor.execute("SELECT * FROM users WHERE email = %s", (req.email,))
        row = cursor.fetchone(); cursor.close(); conn.close()
        if row:
            return {"user_data": row, "qr_image": row.get("qr_image")}
        return {"error": "Not found"}
    except Exception as e:
        return {"error": str(e)}


@app.get("/profile/{user_id}")
async def get_public_profile(user_id: str):
    try:
        conn = get_db_connection(); cursor = conn.cursor()
        cursor.execute(
            "SELECT name, blood_group, allergies, conditions, phone, em1, em2, em3, em4, em5, em6, medical_summary, show_medical_summary FROM users WHERE user_id = %s",
            (user_id,),
        )
        row = cursor.fetchone(); cursor.close(); conn.close()
        if row:
            if not row.get("show_medical_summary", True):
                row["medical_summary"] = None
            return row
        return {"error": "Not found"}
    except Exception as e:
        return {"error": str(e)}


@app.post("/update_profile")
async def update_profile(user: UpdateUser):
    try:
        conn = get_db_connection(); cursor = conn.cursor()
        cursor.execute(
            "UPDATE users SET email=%s, name=%s, blood_group=%s, allergies=%s, conditions=%s, phone=%s, em1=%s, em2=%s, em3=%s, em4=%s, em5=%s, em6=%s WHERE email=%s",
            (user.email, user.name, user.blood_group, user.allergies, user.conditions, user.phone, user.em1, user.em2, user.em3, user.em4, user.em5, user.em6, user.current_email),
        )
        conn.commit(); cursor.close(); conn.close()
        return {"message": "Updated"}
    except Exception as e:
        return {"error": str(e)}


@app.post("/update_location")
async def update_location(payload: LocationUpdate):
    live_locations[payload.user_id] = {"lat": payload.lat, "lon": payload.lon, "timestamp": time.time()}
    return {"status": "Location updated"}


@app.get("/get_location/{user_id}")
async def get_location(user_id: str):
    loc = live_locations.get(user_id)
    if loc:
        return {"status": "success", "data": {"lat": loc["lat"], "lon": loc["lon"]}}
    return {"status": "error", "message": "Location unavailable."}


@app.post("/trigger_emergency")
async def trigger_emergency(payload: EmergencyPayload, background_tasks: BackgroundTasks):
    """Instant alert fired on QR scan: alerts personal emergency contacts (em1-em6) ONLY."""
    services = payload.services or {}
    if payload.latitude is not None and payload.longitude is not None:
        services = await spatial_router.find_all_nearest(payload.latitude, payload.longitude)

    try:
        conn = get_db_connection(); cursor = conn.cursor()
        cursor.execute(
            "SELECT name, blood_group, em1, em2, em3, em4, em5, em6 FROM users WHERE user_id = %s",
            (payload.user_id,),
        )
        row = cursor.fetchone(); cursor.close(); conn.close()
        if row:
            contacts = [row["em1"], row["em2"], row["em3"], row["em4"], row["em5"], row["em6"]]
            background_tasks.add_task(
                send_family_emergency_sms,
                contacts,
                services,
                payload.latitude,
                payload.longitude,
                payload.user_id,
                dict(row),
            )
    except Exception as e:
        print(f"Trigger emergency error: {e}")

    return {"status": "Family Emergency Alert Triggered", "services": services}


@app.post("/alert_authorities")
async def alert_authorities(payload: AuthorityAlertPayload, background_tasks: BackgroundTasks):
    """Explicit opt-in dispatch when rescuer clicks 'Alert Nearest Authorities'."""
    services = payload.services or {}
    if payload.latitude is not None and payload.longitude is not None:
        services = await spatial_router.find_all_nearest(payload.latitude, payload.longitude)

    valid_categories = [c for c in payload.categories if c in ("hospital", "police_station", "ambulance")]
    if not valid_categories:
        valid_categories = ["hospital", "police_station", "ambulance"]

    sms_notified = []
    email_notified = []
    call_only = []

    for cat in valid_categories:
        svc = services.get(cat) or {}
        name = svc.get("name", cat)
        has_digital = False
        if svc.get("sms_mobile"):
            sms_notified.append({"category": cat, "name": name, "phone": svc["sms_mobile"]})
            has_digital = True
        if svc.get("emergency_email"):
            email_notified.append({"category": cat, "name": name, "email": svc["emergency_email"]})
            has_digital = True
        if not has_digital:
            call_only.append({"category": cat, "name": name, "phone": svc.get("landline") or "112"})

    try:
        conn = get_db_connection(); cursor = conn.cursor()
        cursor.execute(
            "SELECT name, blood_group, allergies, conditions, medical_summary, show_medical_summary FROM users WHERE user_id = %s",
            (payload.user_id,),
        )
        row = cursor.fetchone(); cursor.close(); conn.close()
        if not row:
            return {"status": "error", "message": "User profile not found."}

        background_tasks.add_task(
            dispatch_authority_alerts,
            services,
            valid_categories,
            payload.latitude,
            payload.longitude,
            payload.user_id,
            dict(row),
        )
    except Exception as e:
        print(f"Alert authorities error: {e}")
        return {"status": "error", "message": str(e)}

    return {
        "status": "Authorities Alerted",
        "sms_notified": sms_notified,
        "email_notified": email_notified,
        "call_only": call_only,
        "services": services,
    }


@app.post("/ai_triage")
async def ai_triage(payload: TriagePayload):
    dispatched = payload.services or {}
    if not dispatched and payload.latitude is not None and payload.longitude is not None:
        dispatched = await spatial_router.find_all_nearest(payload.latitude, payload.longitude)

    h = dispatched.get("hospital", {}).get("html", "N/A")
    p = dispatched.get("police_station", {}).get("html", "N/A")
    a = dispatched.get("ambulance", {}).get("html", "N/A")

    guidance = [
        f"<strong>🏥 {h}</strong><br>",
        f"<strong>🚓 {p}</strong><br>",
        f"<strong>🚑 {a}</strong><br>",
        "<br><strong style='color:#FF003C;'>IMMEDIATE ACTIONS:</strong>",
    ]
    situation = (payload.type or "").lower()

    if "heart" in situation:
        guidance.extend(["1. Have the person sit down, rest and try to keep calm.", "2. Loosen any tight clothing.", "3. If unresponsive, begin CPR immediately."])
    elif "accident" in situation:
        guidance.extend(["1. DO NOT move the victim unless they are in immediate danger.", "2. Apply firm, direct pressure to any bleeding wounds.", "3. Keep the victim's head perfectly still."])
    elif "assault" in situation:
        guidance.extend(["1. Move to a safe location immediately.", "2. Apply direct pressure to stop bleeding.", "3. Wait for police and ambulance dispatch."])
    else:
        guidance.extend(["1. Check airway, breathing and circulation.", "2. Do not leave the victim unattended.", "3. Apply pressure to any bleeding."])

    if ai_model:
        try:
            prediction = ai_model.predict(np.zeros((1, ai_model.n_features_in_)))
            guidance.insert(0, f"<span style='color:#FF003C; font-weight:900;'>ML SEVERITY ASSESSMENT: LEVEL {str(prediction[0])}</span><br>")
        except Exception:
            pass
    return {"status": "success", "suggestions": guidance, "services": dispatched}
@app.post("/chat")
async def chat_endpoint(payload: ChatPayload):
    hosp_name = payload.services.get("hospital", {}).get("name", "the nearest hospital")
    if not GROQ_KEYS_LIST:
        return {"response": f"AI missing. Head to {hosp_name} or call 112."}

    msgs = [{
        "role": "system",
        "content": (
            f"You are Raksham AI, an emergency first-aid assistant. "
            f"Give short, direct, step-by-step first-aid instructions in the same language the user writes in. "
            f"Remind them to head to {hosp_name} or call 112 if critical."
        ),
    }]
    for turn in (payload.history or [])[-6:]:
        if turn.role in ("user", "assistant") and turn.content:
            msgs.append({"role": turn.role, "content": turn.content})
    msgs.append({"role": "user", "content": payload.message})
    async with httpx.AsyncClient(timeout=20) as client:
        for model_name in CHAT_MODELS:
            for key in GROQ_KEYS_LIST:
                try:
                    req_body = {
                        "model": model_name,
                        "messages": msgs,
                        "temperature": 0.3,
                        "max_tokens": 1000,
                    }
                    if model_name.startswith("qwen/"):
                        req_body["reasoning_effort"] = "none"

                    resp = await client.post(
                        "https://api.groq.com/openai/v1/chat/completions",
                        headers={"Authorization": f"Bearer {key}"},
                        json=req_body,
                    )
                    if resp.status_code == 200:
                        raw_text = resp.json()["choices"][0]["message"].get("content", "")
                        clean_text = clean_llm_output(raw_text)
                        if not clean_text:
                            clean_text = f"Stay calm and keep the victim stable. Head immediately to {hosp_name} or call 112."
                        return {"response": clean_text}
                    else:
                        print(f"Groq Chat failed [{model_name}] -> {resp.status_code}: {resp.text}")
                except Exception as e:
                    print(f"Groq Chat Exception [{model_name}] -> {e}")
                    continue

    return {"response": f"Connection issue. Call 112 or head to {hosp_name}."}


@app.post("/upload_medical_report")
async def upload_medical_report(payload: MedicalReportPayload):
    if not GROQ_KEYS_LIST:
        return {"error": "AI missing."}

    summary = None
    async with httpx.AsyncClient(timeout=25) as client:
        for key in GROQ_KEYS_LIST:
            try:
                resp = await client.post(
                    "https://api.groq.com/openai/v1/chat/completions",
                    headers={"Authorization": f"Bearer {key}"},
                    json={
                        "model": VISION_MODEL,
                        "reasoning_effort": "none",
                        "messages": [
                            {"role": "system", "content": "Extract ONLY clinical facts: diagnosed conditions, medications, allergies, warnings. Short bulleted list."},
                            {"role": "user", "content": [
                                {"type": "text", "text": "Summarize this report."},
                                {"type": "image_url", "image_url": {"url": payload.image_base64}},
                            ]},
                        ],
                        "max_tokens": 600,
                    },
                )
                if resp.status_code == 200:
                    raw = resp.json()["choices"][0]["message"].get("content", "")
                    summary = clean_llm_output(raw)
                    if summary:
                        break
                else:
                    print(f"Groq Vision failed -> {resp.status_code}: {resp.text}")
            except Exception as e:
                print(f"Groq Vision Exception -> {e}")
                continue

    if not summary:
        return {"error": "Could not analyze the report right now. All AI keys failed."}

    try:
        conn = get_db_connection(); cursor = conn.cursor()
        cursor.execute(
            "UPDATE users SET medical_report_image=%s, medical_summary=%s, medical_summary_updated_at=NOW() WHERE email=%s",
            (payload.image_base64, summary, payload.email),
        )
        conn.commit(); cursor.close(); conn.close()
        return {"message": "Success", "summary": summary}
    except Exception as e:
        return {"error": str(e)}


@app.post("/set_medical_visibility")
async def set_medical_visibility(payload: ProfileVisibilityPayload):
    try:
        conn = get_db_connection(); cursor = conn.cursor()
        cursor.execute(
            "UPDATE users SET show_medical_summary=%s WHERE email=%s",
            (payload.show_medical_summary, payload.email),
        )
        conn.commit(); cursor.close(); conn.close()
        return {"message": "Visibility updated"}
    except Exception as e:
        return {"error": str(e)}
