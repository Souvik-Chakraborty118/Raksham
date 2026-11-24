#!/usr/bin/env python3
"""
build_emergency_dataset.py
==========================
Builds a hyper-local emergency-services dataset (hospitals/clinics, police,
ambulance stations) for Kharagpur and Kolkata from free, key-less sources:

  * OpenStreetMap via the Overpass API  (data (c) OpenStreetMap contributors, ODbL)
  * The facility's OWN website (homepage + /contact, /contact-us) for e-mail enrichment

Outputs (default directory: Raksham/data/)
  * emergency_services.json
  * missing_contacts_review.csv

Install & run:
    pip install requests beautifulsoup4
    export RAKSHAM_CONTACT="you@yourdomain.in"      # put a real contact in the User-Agent
    python build_emergency_dataset.py
    python build_emergency_dataset.py --no-email          # skip website scraping
    python build_emergency_dataset.py --refresh           # ignore cached Overpass responses

Notes on data quality
  * Nothing is guessed. A phone is kept only if it parses as an Indian mobile or an
    STD landline with an explicit area code. Bare local numbers (no STD) are dropped.
  * An e-mail is "scraped from the facility's own website", not proof that anyone
    monitors it. Treat `emergency_email` as a candidate until you have confirmed it,
    which is what missing_contacts_review.csv is for.
  * `open_24x7` is True only when OSM says 24/7; otherwise null (unknown), never False.
"""
from __future__ import annotations

import argparse
import csv
import difflib
import json
import math
import os
import random
import re
import sys
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date
from pathlib import Path
from typing import Optional
from urllib.parse import unquote, urljoin, urlparse

import requests
from bs4 import BeautifulSoup

# --------------------------------------------------------------------------- config
REGIONS = [
    {"city": "Kharagpur", "prefix": "kgp", "bbox": (22.27, 87.24, 22.38, 87.37)},   # S, W, N, E
    {"city": "Kolkata", "prefix": "kol", "bbox": (22.42, 88.24, 22.68, 88.52)},
]

OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]
RETRYABLE_STATUS = {429, 502, 503, 504}
MAX_RETRIES = 7
BACKOFF_BASE_S = 5
BACKOFF_CAP_S = 180

CONTACT = os.environ.get("RAKSHAM_CONTACT", "unset-contact")
HEADERS = {"User-Agent": f"RakshamDatasetBuilder/1.0 (emergency-services research; contact: {CONTACT})"}

WEB_TIMEOUT = (4, 4)            # (connect, read) seconds: the strict 4 s budget
WEB_MAX_BYTES = 1_000_000
CONTACT_PATHS = ["/contact", "/contact-us"]
DEDUP_RADIUS_M = 100
NAME_SIMILARITY = 0.88
GRID_CELL_DEG = 0.002           # ~220 m, bigger than the dedup radius

CATEGORY_CODE = {"hospital": "hosp", "police_station": "pol", "ambulance": "amb"}

JUNK_EMAIL_SUBSTRINGS = (
    "example.com", "sentry.io", "sentry-next", "wixpress.com", "domain.com",
    "yourdomain", "email.com", "test.com", "u003e", "sampleemail",
)
IMAGE_EXTS = (".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".ico", ".css", ".js")
DEPRIORITISED_LOCALS = ("noreply", "no-reply", "donotreply", "privacy", "career", "jobs",
                        "recruit", "hr", "webmaster", "press", "marketing", "billing", "feedback")
PREFERRED_LOCALS = ("emergency", "casualty", "ambulance", "info", "contact", "enquiry",
                    "inquiry", "care", "helpdesk", "reception", "admin")
EMAIL_RE = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9\-]+(?:\.[A-Za-z0-9\-]+)*\.[A-Za-z]{2,}")
STOPWORDS = {"the", "and", "of", "pvt", "ltd", "private", "limited"}


# --------------------------------------------------------------------------- overpass
def build_query(bbox) -> str:
    s, w, n, e = bbox
    b = f"({s},{w},{n},{e})"
    return f"""[out:json][timeout:180];
(
  nwr["amenity"="hospital"]{b};
  nwr["amenity"="clinic"]{b};
  nwr["healthcare"="hospital"]{b};
  nwr["amenity"="police"]{b};
  nwr["emergency"="ambulance_station"]{b};
);
out center;"""


def overpass_fetch(query: str) -> list[dict]:
    """POST the query, rotating mirrors and backing off exponentially on failures."""
    last_err: object = None
    for attempt in range(MAX_RETRIES):
        url = OVERPASS_ENDPOINTS[attempt % len(OVERPASS_ENDPOINTS)]
        wait = None
        try:
            r = requests.post(url, data={"data": query}, headers=HEADERS, timeout=240)
            if r.status_code == 200:
                payload = r.json()
                remark = payload.get("remark", "")
                if "runtime error" in remark and not payload.get("elements"):
                    last_err = remark
                else:
                    return payload.get("elements", [])
            elif r.status_code in RETRYABLE_STATUS:
                last_err = f"HTTP {r.status_code} from {url}"
                retry_after = r.headers.get("Retry-After", "")
                if retry_after.isdigit():
                    wait = int(retry_after)
            else:
                r.raise_for_status()
        except (requests.RequestException, ValueError) as exc:
            last_err = exc
        if wait is None:
            wait = min(BACKOFF_CAP_S, BACKOFF_BASE_S * 2 ** attempt)
        wait += random.uniform(0, 2)
        print(f"  Overpass attempt {attempt + 1}/{MAX_RETRIES} failed ({last_err}); retrying in {wait:.0f}s",
              file=sys.stderr)
        time.sleep(wait)
    raise SystemExit(f"Overpass failed after {MAX_RETRIES} attempts: {last_err}")


def load_elements(region: dict, out_dir: Path, refresh: bool) -> list[dict]:
    cache = out_dir / f".overpass_cache_{region['prefix']}.json"
    if cache.exists() and not refresh:
        print(f"[{region['city']}] using cached Overpass response ({cache.name})")
        return json.loads(cache.read_text(encoding="utf-8"))
    print(f"[{region['city']}] querying Overpass ...")
    elements = overpass_fetch(build_query(region["bbox"]))
    cache.write_text(json.dumps(elements), encoding="utf-8")
    return elements


# --------------------------------------------------------------------------- phones
def classify_number(raw: str) -> Optional[tuple[str, str]]:
    """Return ("mobile", "+91XXXXXXXXXX") or ("landline", "033-XXXXXXXX"/"03222-XXXXXX"), else None."""
    raw = raw.strip()
    if not raw:
        return None
    digits = re.sub(r"\D", "", raw)
    if raw.startswith("+") and not digits.startswith("91"):
        return None                                   # foreign number
    if digits.startswith("0091"):
        digits = digits[4:]
    elif digits.startswith("91") and len(digits) == 12:
        digits = digits[2:]
    if len(digits) == 11 and digits[0] == "0" and digits[1] in "6789":
        digits = digits[1:]                           # 09XXXXXXXXX -> mobile
    if len(digits) == 10 and digits[0] in "6789":
        return "mobile", "+91" + digits
    if len(digits) == 10 and digits[0] == "3":        # STD without its leading 0 (+91 33 ...)
        digits = "0" + digits
    if len(digits) == 11 and digits.startswith("03"):  # West Bengal STD codes start with 03
        if digits.startswith("033"):
            return "landline", f"033-{digits[3:]}"
        return "landline", f"{digits[:5]}-{digits[5:]}"
    return None                                       # bare local number or unknown: never guess


def pick_phones(tags: dict) -> tuple[Optional[str], Optional[str]]:
    mobile = landline = None
    for key in ("emergency:phone", "phone", "contact:phone", "contact:mobile", "mobile"):
        for part in re.split(r"[;,|/]", tags.get(key, "")):
            res = classify_number(part)
            if not res:
                continue
            kind, value = res
            if kind == "mobile" and mobile is None:
                mobile = value
            elif kind == "landline" and landline is None:
                landline = value
    return mobile, landline


# --------------------------------------------------------------------------- email
def is_junk_email(email: str) -> bool:
    e = email.lower()
    if any(s in e for s in JUNK_EMAIL_SUBSTRINGS):
        return True
    if e.endswith(IMAGE_EXTS):
        return True
    return not EMAIL_RE.fullmatch(email)


def first_valid_email(*values: Optional[str]) -> Optional[str]:
    for value in values:
        for part in re.split(r"[;,\s]+", value or ""):
            part = part.strip().removeprefix("mailto:").strip("<>.")
            if part and not is_junk_email(part):
                return part.lower()
    return None


def normalise_site(url: str) -> Optional[str]:
    url = url.strip().split(";")[0].strip()
    if not url:
        return None
    if not re.match(r"^https?://", url, re.I):
        url = "https://" + url
    return url if urlparse(url).netloc else None


def emails_from_page(html: str) -> list[str]:
    found: list[str] = []
    soup = BeautifulSoup(html, "html.parser")
    for a in soup.select('a[href^="mailto:"]'):
        addr = unquote(a["href"].split(":", 1)[1].split("?")[0]).strip()
        if addr and not is_junk_email(addr):
            found.append(addr.lower())
    for m in EMAIL_RE.findall(soup.get_text(" ")):
        if not is_junk_email(m):
            found.append(m.lower())
    return list(dict.fromkeys(found))


def score_email(email: str, site_domain: str) -> int:
    local, domain = email.split("@", 1)
    score = 0
    if site_domain and (domain == site_domain or domain.endswith("." + site_domain)
                        or site_domain.endswith("." + domain)):
        score += 10
    score += sum(3 for k in PREFERRED_LOCALS if k in local)
    score -= sum(6 for k in DEPRIORITISED_LOCALS if k in local)
    return score


def scrape_email(website: str) -> Optional[str]:
    base = normalise_site(website)
    if not base:
        return None
    site_domain = urlparse(base).netloc.lower().removeprefix("www.")
    candidates: list[str] = []
    for url in [base] + [urljoin(base, p) for p in CONTACT_PATHS]:
        try:
            r = requests.get(url, headers=HEADERS, timeout=WEB_TIMEOUT, allow_redirects=True)
            if r.status_code != 200 or "html" not in r.headers.get("Content-Type", "html").lower():
                continue
            html = r.content[:WEB_MAX_BYTES].decode(r.encoding or "utf-8", errors="replace")
            candidates += emails_from_page(html)
        except requests.RequestException:
            continue
        if candidates:                       # homepage was enough, skip the contact pages
            break
    if not candidates:
        return None
    return max(dict.fromkeys(candidates), key=lambda e: score_email(e, site_domain))


# --------------------------------------------------------------------------- parsing
def classify(tags: dict) -> Optional[str]:
    if tags.get("amenity") == "police":
        return "police_station"
    if tags.get("emergency") == "ambulance_station":
        return "ambulance"
    if tags.get("amenity") in ("hospital", "clinic") or tags.get("healthcare") == "hospital":
        return "hospital"
    return None


def build_address(tags: dict) -> Optional[str]:
    if tags.get("addr:full"):
        return tags["addr:full"].strip()
    street = " ".join(x for x in (tags.get("addr:housenumber"), tags.get("addr:street")) if x)
    parts = [tags.get("addr:housename"), street, tags.get("addr:place"), tags.get("addr:suburb"),
             tags.get("addr:neighbourhood"), tags.get("addr:city"), tags.get("addr:district"),
             tags.get("addr:state"), tags.get("addr:postcode")]
    out: list[str] = []
    for p in parts:
        if p and p.strip() and p.strip() not in out:
            out.append(p.strip())
    return ", ".join(out) or None


def is_24x7(hours: Optional[str]) -> Optional[bool]:
    if not hours:
        return None
    h = hours.strip().lower()
    if h in ("24/7", "24x7", "24 hours") or ("mo-su" in h and "00:00-24:00" in h):
        return True
    return None                              # never claim False from partial OPD hours


def parse_element(el: dict, region: dict) -> Optional[dict]:
    tags = el.get("tags", {})
    category = classify(tags)
    if not category or "veterinary" in tags.get("healthcare:speciality", "").lower():
        return None
    name = (tags.get("name") or tags.get("name:en") or "").strip()
    if not name:
        return None
    if "lat" in el and "lon" in el:
        lat, lon = el["lat"], el["lon"]
    elif el.get("center"):
        lat, lon = el["center"]["lat"], el["center"]["lon"]
    else:
        return None
    mobile, landline = pick_phones(tags)
    locality = next((tags[k] for k in ("addr:suburb", "addr:neighbourhood", "addr:quarter",
                                       "addr:locality", "addr:place", "addr:village") if tags.get(k)), None)
    website = tags.get("website") or tags.get("contact:website")
    hours = tags.get("opening_hours")
    return {
        "city": region["city"], "prefix": region["prefix"], "category": category, "name": name,
        "locality": locality, "address": build_address(tags),
        "lat": round(float(lat), 6), "lon": round(float(lon), 6),
        "landline": landline, "sms_mobile": mobile,
        "emergency_email": first_valid_email(tags.get("email"), tags.get("contact:email")),
        "_website": normalise_site(website) if website else None,
        "_hours": hours,
        "_major": category != "hospital" or tags.get("amenity") == "hospital" or tags.get("healthcare") == "hospital",
        "_osm": [f"{el['type']}/{el['id']}"],
    }


# --------------------------------------------------------------------------- dedup
def haversine_m(lat1, lon1, lat2, lon2) -> float:
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def norm_name(name: str) -> str:
    tokens = re.sub(r"[^a-z0-9 ]", " ", name.lower()).split()
    return " ".join(t for t in tokens if t not in STOPWORDS)


def names_similar(a: str, b: str) -> bool:
    na, nb = norm_name(a), norm_name(b)
    return na == nb or difflib.SequenceMatcher(None, na, nb).ratio() >= NAME_SIMILARITY


FILL_FIELDS = ["locality", "address", "landline", "sms_mobile", "emergency_email", "_website", "_hours"]


def dedupe(records: list[dict]) -> list[dict]:
    n = len(records)
    parent = list(range(n))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    grid: dict[tuple, list[int]] = defaultdict(list)
    for i, r in enumerate(records):
        grid[(r["city"], r["category"], int(r["lat"] / GRID_CELL_DEG), int(r["lon"] / GRID_CELL_DEG))].append(i)

    for i, r in enumerate(records):
        ci, cj = int(r["lat"] / GRID_CELL_DEG), int(r["lon"] / GRID_CELL_DEG)
        for di in (-1, 0, 1):
            for dj in (-1, 0, 1):
                for j in grid.get((r["city"], r["category"], ci + di, cj + dj), ()):
                    if j <= i or find(i) == find(j):
                        continue
                    o = records[j]
                    if (haversine_m(r["lat"], r["lon"], o["lat"], o["lon"]) <= DEDUP_RADIUS_M
                            and names_similar(r["name"], o["name"])):
                        parent[find(j)] = find(i)

    groups: dict[int, list[dict]] = defaultdict(list)
    for i, r in enumerate(records):
        groups[find(i)].append(r)

    merged = []
    for group in groups.values():
        group.sort(key=lambda r: -sum(r[k] is not None for k in FILL_FIELDS))   # richest record wins
        primary = dict(group[0])
        primary["_osm"] = list(group[0]["_osm"])
        for other in group[1:]:
            for k in FILL_FIELDS:
                if primary[k] is None and other[k] is not None:
                    primary[k] = other[k]
            primary["_major"] = primary["_major"] or other["_major"]
            primary["_osm"] += other["_osm"]
        merged.append(primary)
    return merged


# --------------------------------------------------------------------------- output
def enrich_emails(records: list[dict], workers: int) -> None:
    todo = [r for r in records if not r["emergency_email"] and r["_website"]]
    print(f"Scraping {len(todo)} facility websites for e-mail (4 s timeout each) ...")
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(scrape_email, r["_website"]): r for r in todo}
        for done, fut in enumerate(as_completed(futures), 1):
            try:
                futures[fut]["emergency_email"] = fut.result()
            except Exception:                                   # one bad site must not kill the run
                pass
            if done % 25 == 0:
                print(f"  {done}/{len(todo)}")


def finalise(records: list[dict]) -> list[dict]:
    records.sort(key=lambda r: (r["city"] != "Kharagpur", r["category"], r["name"].lower()))
    counters: dict[tuple, int] = defaultdict(int)
    out = []
    for r in records:
        key = (r["prefix"], r["category"])
        counters[key] += 1
        lat, lon = r["lat"], r["lon"]
        out.append({
            "id": f"{r['prefix']}_{CATEGORY_CODE[r['category']]}_{counters[key]:03d}",
            "name": r["name"], "category": r["category"], "city": r["city"],
            "locality": r["locality"], "address": r["address"],
            "lat": lat, "lon": lon,
            "landline": r["landline"],
            "sms_mobile": r["sms_mobile"], "sms_capable": r["sms_mobile"] is not None,
            "emergency_email": r["emergency_email"], "email_capable": r["emergency_email"] is not None,
            "open_24x7": is_24x7(r["_hours"]),
            "google_maps_directions": f"https://www.google.com/maps/dir/?api=1&destination={lat:.6f},{lon:.6f}&travelmode=driving",
            "osm_link": f"https://www.openstreetmap.org/?mlat={lat:.6f}&mlon={lon:.6f}#map=17/{lat:.6f}/{lon:.6f}",
        })
        r["_id"] = out[-1]["id"]
    return out


def write_review_csv(path: Path, records: list[dict], services: list[dict]) -> int:
    rows = 0
    with path.open("w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(["id", "city", "category", "name", "address", "landline", "sms_mobile", "emergency_email",
                    "website", "missing", "osm_ref", "osm_link", "fill_sms_mobile", "fill_emergency_email",
                    "verified_source_url"])
        for r, s in zip(records, services):
            if not (r["city"] == "Kharagpur" or r["_major"]):
                continue
            missing = [k for k in ("sms_mobile", "emergency_email") if s[k] is None]
            if not missing:
                continue
            w.writerow([s["id"], s["city"], s["category"], s["name"], s["address"] or "", s["landline"] or "",
                        s["sms_mobile"] or "", s["emergency_email"] or "", r["_website"] or "", "+".join(missing), ";".join(r["_osm"]), s["osm_link"],
                        "", "", ""])
            rows += 1
    return rows


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out-dir", default="Raksham/data")
    ap.add_argument("--no-email", action="store_true", help="skip website e-mail scraping")
    ap.add_argument("--refresh", action="store_true", help="ignore cached Overpass responses")
    ap.add_argument("--workers", type=int, default=8)
    args = ap.parse_args()

    if CONTACT == "unset-contact":
        print("Tip: set RAKSHAM_CONTACT so Overpass operators can reach you.", file=sys.stderr)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    records: list[dict] = []
    for region in REGIONS:
        elements = load_elements(region, out_dir, args.refresh)
        parsed = [p for p in (parse_element(e, region) for e in elements) if p]
        print(f"[{region['city']}] {len(elements)} OSM elements -> {len(parsed)} named facilities")
        records += parsed

    before = len(records)
    records = dedupe(records)
    print(f"Deduplicated {before} -> {len(records)} (<= {DEDUP_RADIUS_M} m, name similarity >= {NAME_SIMILARITY})")

    if not args.no_email:
        enrich_emails(records, args.workers)

    services = finalise(records)
    # finalise() sorted `records` in place, so zip(records, services) stays aligned
    dataset = {
        "metadata": {
            "regions": [r["city"] for r in REGIONS],
            "last_updated": date.today().isoformat(),
            "national_fallbacks": {"emergency": "112", "ambulance": "108", "police": "100"},
            "source": "OpenStreetMap contributors (ODbL) via Overpass API; e-mails scraped from facility websites",
            "license_note": "Derived from OpenStreetMap data; attribution required: (c) OpenStreetMap contributors",
        },
        "services": services,
    }
    json_path = out_dir / "emergency_services.json"
    json_path.write_text(json.dumps(dataset, indent=2, ensure_ascii=False), encoding="utf-8")

    csv_path = out_dir / "missing_contacts_review.csv"
    n_review = write_review_csv(csv_path, records, services)

    print(f"\nWrote {len(services)} services -> {json_path}")
    print(f"Wrote {n_review} rows needing manual contacts -> {csv_path}")
    for city in (r["city"] for r in REGIONS):
        city_s = [s for s in services if s["city"] == city]
        print(f"  {city}: {len(city_s)} total, "
              f"{sum(s['sms_capable'] for s in city_s)} with SMS mobile, "
              f"{sum(s['email_capable'] for s in city_s)} with e-mail")


if __name__ == "__main__":
    main()
