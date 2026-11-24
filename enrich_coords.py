"""Fill lat/lon, Google Maps and OSM links from OpenStreetMap (Overpass).

Run on your own machine (needs internet). Usage:
    pip install requests
    python enrich_coords.py raksham_batch1_kharagpur_verified.json

For every service with null coordinates it looks for the nearest OSM feature of the
right type (hospital / police / ambulance_station) whose name matches, inside a bbox
around the city. Matches are written only when the name similarity is high; anything
else is left null and printed so you can check it by hand on openstreetmap.org.
"""
import json, sys, time, difflib, requests

OVERPASS = "https://overpass-api.de/api/interpreter"
BBOX = {"Kharagpur": (22.25, 87.20, 22.42, 87.40), "Kolkata": (22.40, 88.20, 22.75, 88.52)}
AMENITY = {"hospital": ["hospital", "clinic"], "police_station": ["police"], "ambulance": ["ambulance_station"]}

def fetch(city, category):
    s, w, n, e = BBOX[city]
    kinds = "|".join(AMENITY[category])
    q = f'[out:json][timeout:60];(nwr["amenity"~"^({kinds})$"]({s},{w},{n},{e}););out center tags;'
    r = requests.post(OVERPASS, data={"data": q}, timeout=90)
    r.raise_for_status()
    return r.json()["elements"]

def coords(el):
    if "lat" in el:
        return el["lat"], el["lon"]
    c = el.get("center")
    return (c["lat"], c["lon"]) if c else (None, None)

def main(path):
    data = json.load(open(path))
    cache = {}
    for svc in data["services"]:
        if svc.get("lat") is not None:
            continue
        key = (svc["city"], svc["category"])
        if key not in cache:
            cache[key] = fetch(*key)
            time.sleep(2)
        best, score = None, 0
        for el in cache[key]:
            name = el.get("tags", {}).get("name", "")
            sc = difflib.SequenceMatcher(None, svc["name"].lower(), name.lower()).ratio()
            if sc > score:
                best, score = el, sc
        if best and score >= 0.75:
            lat, lon = coords(best)
            svc["lat"], svc["lon"] = round(lat, 6), round(lon, 6)
            svc["google_maps_directions"] = f"https://www.google.com/maps/dir/?api=1&destination={lat:.6f},{lon:.6f}&travelmode=driving"
            svc["osm_link"] = f"https://www.openstreetmap.org/?mlat={lat:.6f}&mlon={lon:.6f}#map=17/{lat:.6f}/{lon:.6f}"
            print(f"OK    {svc['id']} -> {best['type']}/{best['id']} (match {score:.2f})")
        else:
            print(f"CHECK {svc['id']} {svc['name']}: no confident OSM match (best {score:.2f})")
    out = path.replace(".json", "_geocoded.json")
    json.dump(data, open(out, "w"), indent=2, ensure_ascii=False)
    print("wrote", out)

if __name__ == "__main__":
    main(sys.argv[1])
