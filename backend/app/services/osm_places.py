"""
Free live place search from OpenStreetMap.

* With GEOAPIFY_API_KEY set (free plan, no card): Geoapify Places API, which serves
  OpenStreetMap data quickly.
* Without any key: the public Overpass API, queried directly.

Neighbourhood names ("Uppal", "Gion") are located with Geoapify's geocoder when a key is
set, otherwise with Photon (komoot) and then Nominatim, all free.

OpenStreetMap has no ratings or review counts; places are ranked by how well-known they
are (a Wikipedia / Wikidata entry, a tourist-attraction tag, how completely they are
mapped), by whether their name matches the search, and by distance.
Data © OpenStreetMap contributors, ODbL.
"""
from __future__ import annotations

import math
import re
import time
import unicodedata
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import quote

import httpx

from app.config import settings
from app.services.places_provider import (
    Coordinates,
    PhotoAttribution,
    PlaceDetailResult,
    PlacePhoto,
    PlaceSearchResult,
    PlacesProvider,
    ProviderStatus,
    SearchPageResult,
)
from app.services.price_service import PriceService
from app.utils.logging import logger

CITY_CENTERS: Dict[str, Tuple[float, float, float]] = {
    # lat, lng, search radius in metres for a city-wide search
    "hyderabad": (17.385044, 78.486671, 12000),
    "bengaluru": (12.971599, 77.594566, 12000),
    "tokyo": (35.681236, 139.767125, 14000),
    "kyoto": (35.011636, 135.768029, 9000),
}
LOCALITY_RADIUS_M = 2500
# a place this close to a neighbourhood's centre is treated as being in it
INSIDE_LOCALITY_KM = 2.0

# Search words → OpenStreetMap tags (Overpass), Geoapify categories, and a Google-style type
# so the rest of the app (ranking, filters, icons) treats these places like any other.
RULES: List[Dict[str, Any]] = [
    {
        "key": "spiritual",
        "words": ["temple", "temples", "shrine", "shrines", "mosque", "church", "mandir", "dargah", "worship", "spiritual", "pagoda", "gurudwara"],
        "osm": ['["amenity"="place_of_worship"]'],
        "geoapify": ["religion.place_of_worship"],
    },
    {
        "key": "nature",
        "words": ["park", "parks", "garden", "gardens", "lake", "nature", "green", "greenery", "walk", "bamboo", "forest", "river", "hill", "hills", "view", "views", "viewpoint", "sunset", "scenic"],
        "osm": ['["leisure"~"^(park|garden|nature_reserve)$"]', '["tourism"="viewpoint"]', '["natural"="water"]["water"~"^(lake|reservoir)$"]'],
        "geoapify": ["leisure.park", "national_park", "tourism.sights.viewpoint", "natural.water"],
    },
    {
        "key": "cafe",
        "words": ["cafe", "cafes", "coffee", "tea", "bakery", "dessert", "espresso"],
        "osm": ['["amenity"="cafe"]', '["shop"="bakery"]'],
        "geoapify": ["catering.cafe", "commercial.food_and_drink.bakery"],
    },
    {
        "key": "food",
        "words": ["restaurant", "restaurants", "food", "eat", "dinner", "lunch", "breakfast", "biryani", "ramen", "sushi", "tiffin", "dosa", "dining", "street"],
        "osm": ['["amenity"~"^(restaurant|fast_food|food_court)$"]'],
        "geoapify": ["catering.restaurant", "catering.fast_food", "catering.food_court"],
    },
    {
        "key": "nightlife",
        "words": ["bar", "bars", "pub", "pubs", "brewery", "brewpub", "beer", "cocktail", "cocktails", "nightlife", "club", "lounge"],
        "osm": ['["amenity"~"^(bar|pub|biergarten|nightclub)$"]', '["craft"="brewery"]'],
        "geoapify": ["catering.bar", "catering.pub", "catering.biergarten", "adult.nightclub"],
    },
    {
        "key": "heritage",
        "words": ["heritage", "historic", "history", "historical", "monument", "monuments", "fort", "palace", "tomb", "tombs", "castle", "ruins", "museum", "museums", "gallery"],
        "osm": ['["historic"~"^(monument|castle|fort|palace|memorial|ruins|tomb|archaeological_site|building|city_gate)$"]', '["tourism"~"^(museum|gallery)$"]'],
        "geoapify": ["heritage", "tourism.sights.castle", "tourism.sights.fort", "tourism.sights.memorial", "entertainment.museum", "entertainment.culture.gallery"],
    },
    {
        "key": "shopping",
        "words": ["market", "markets", "shopping", "shop", "shops", "mall", "bazaar", "souvenir", "crafts"],
        "osm": ['["shop"~"^(mall|department_store|gift|craft)$"]', '["amenity"="marketplace"]'],
        "geoapify": ["commercial.shopping_mall", "commercial.marketplace", "commercial.department_store", "commercial.gift_and_souvenir"],
    },
    {
        "key": "fun",
        "words": ["fun", "amusement", "zoo", "aquarium", "theme", "kids", "games", "arcade", "cinema"],
        "osm": ['["tourism"~"^(theme_park|zoo|aquarium)$"]', '["leisure"~"^(water_park|amusement_arcade)$"]'],
        "geoapify": ["entertainment.theme_park", "entertainment.zoo", "entertainment.aquarium", "entertainment.water_park"],
    },
]
POPULAR = {
    "osm": [
        '["tourism"~"^(attraction|museum|gallery|viewpoint|zoo|theme_park)$"]["wikidata"]',
        '["historic"]["wikidata"]',
        '["leisure"~"^(park|garden)$"]["wikidata"]',
        '["amenity"="place_of_worship"]["wikidata"]',
    ],
    "geoapify": ["tourism.attraction", "tourism.sights", "heritage", "entertainment.museum", "leisure.park"],
}
# words that describe a mood or the company rather than a kind of place
SOFT_WORDS = {
    "peaceful", "quiet", "calm", "serene", "romantic", "lively", "cozy", "cosy", "family", "friends", "couple", "couples", "solo",
    "kids", "parents", "date", "morning", "evening", "night", "tonight", "afternoon", "cheap", "free", "best", "good", "nice",
    "popular", "places", "place", "things", "to", "do", "in", "with", "my", "for", "the", "a", "an", "and", "of", "near", "around",
    "under", "budget", "visit", "see", "top", "famous", "hidden", "gems", "spots", "spot", "authentic", "local", "tourist", "attractions",
}


def _norm(text: str) -> str:
    return unicodedata.normalize("NFKD", text or "").encode("ascii", "ignore").decode().lower()


def _words(text: str) -> List[str]:
    return [w for w in re.split(r"[^a-z0-9]+", _norm(text)) if w]


def _km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lng2 - lng1)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * 6371.0 * math.asin(math.sqrt(h))


def nearest_city(lat: float, lng: float) -> str:
    return min(CITY_CENTERS, key=lambda c: _km(lat, lng, CITY_CENTERS[c][0], CITY_CENTERS[c][1]))


def plan_query(query: str, category: Optional[str], city: str, locality: Optional[str]) -> Tuple[List[Dict[str, Any]], List[str]]:
    """Which kinds of place the search asks for, and which leftover words could be part of a name."""
    words = _words(f"{query or ''} {category or ''}")
    skip = set(_words(city)) | set(_words(locality or "")) | {"bangalore", "bengaluru", "hyderabad", "tokyo", "kyoto", "secunderabad"}
    rules = [r for r in RULES if any(w in r["words"] for w in words)]
    known = {w for r in RULES for w in r["words"]}
    name_words = [w for w in words if len(w) >= 4 and w not in known and w not in SOFT_WORDS and w not in skip and not w.isdigit()]
    return rules, name_words[:3]


def build_overpass_query(rules: List[Dict[str, Any]], name_words: List[str], lat: float, lng: float, radius: float, limit: int = 220) -> str:
    around = f"(around:{int(radius)},{lat:.6f},{lng:.6f})"
    clauses: List[str] = []
    filters = [f for r in rules for f in r["osm"]] or POPULAR["osm"]
    for f in filters:
        clauses.append(f'nwr{f}["name"]{around};')
    for w in name_words:
        # a specific name ("charminar", "niloufer")
        clauses.append(f'nwr["name"~"{re.escape(w)}",i]{around};')
    body = "\n  ".join(clauses)
    return f"[out:json][timeout:20];\n(\n  {body}\n);\nout center tags {limit};"


def _google_like_type(tags: Dict[str, str]) -> Tuple[str, List[str]]:
    a, t, l, h, s = tags.get("amenity"), tags.get("tourism"), tags.get("leisure"), tags.get("historic"), tags.get("shop")
    if a == "place_of_worship":
        rel = tags.get("religion", "")
        kind = {"hindu": "hindu_temple", "muslim": "mosque", "christian": "church", "buddhist": "buddhist_temple", "shinto": "shinto_shrine", "sikh": "place_of_worship", "jain": "hindu_temple"}.get(rel, "place_of_worship")
        return kind, [kind, "place_of_worship", "tourist_attraction"]
    if a == "cafe":
        return "cafe", ["cafe", "food"]
    if s == "bakery":
        return "bakery", ["bakery", "food"]
    if a in ("restaurant", "food_court"):
        return "restaurant", ["restaurant", "food"]
    if a == "fast_food":
        return "restaurant", ["restaurant", "meal_takeaway", "food"]
    if a in ("bar", "pub", "biergarten") or tags.get("craft") == "brewery":
        return "bar", ["bar", "pub" if a == "pub" else "bar"]
    if a == "nightclub":
        return "night_club", ["night_club", "bar"]
    if t == "museum":
        return "museum", ["museum", "tourist_attraction"]
    if t == "gallery":
        return "art_gallery", ["art_gallery", "tourist_attraction"]
    if t == "zoo":
        return "zoo", ["zoo", "tourist_attraction"]
    if t == "aquarium":
        return "aquarium", ["aquarium", "tourist_attraction"]
    if t == "theme_park" or l == "water_park":
        return "amusement_park", ["amusement_park", "tourist_attraction"]
    if t == "viewpoint":
        return "observation_deck", ["observation_deck", "tourist_attraction"]
    if l in ("park", "nature_reserve") or tags.get("natural") == "water":
        return "park", ["park", "tourist_attraction"]
    if l == "garden":
        return "botanical_garden" if tags.get("garden:type") == "botanical" else "garden", ["garden", "park"]
    if h in ("castle", "fort", "palace"):
        return "historical_landmark", ["historical_landmark", "castle", "tourist_attraction"]
    if h:
        return "historical_landmark", ["historical_landmark", "monument", "tourist_attraction"]
    if s in ("mall", "department_store"):
        return "shopping_mall", ["shopping_mall", "store"]
    if a == "marketplace":
        return "market", ["market", "store"]
    if s:
        return "store", ["store"]
    return "tourist_attraction", ["tourist_attraction"]


def _address(tags: Dict[str, str]) -> Optional[str]:
    street = " ".join(x for x in [tags.get("addr:housenumber"), tags.get("addr:street")] if x)
    parts = [street, tags.get("addr:suburb") or tags.get("addr:neighbourhood"), tags.get("addr:city"), tags.get("addr:postcode")]
    line = ", ".join(p for p in parts if p)
    return line or tags.get("addr:full")


def _photos(tags: Dict[str, str]) -> List[PlacePhoto]:
    """Photos tagged on the object itself, so they show this exact place."""
    out: List[PlacePhoto] = []
    commons = tags.get("wikimedia_commons", "")
    if commons.startswith("File:"):
        file = commons[len("File:"):]
        out.append(
            PlacePhoto(
                name=f"osm-photo:{commons}",
                proxy_url=f"https://commons.wikimedia.org/wiki/Special:FilePath/{quote(file)}?width=900",
                attributions=[PhotoAttribution(display_name="Wikimedia Commons", uri=f"https://commons.wikimedia.org/wiki/{quote(commons)}")],
            )
        )
    image = tags.get("image", "")
    if re.match(r"^https://(upload\.wikimedia\.org|commons\.wikimedia\.org)/", image) and re.search(r"\.(jpe?g|png|webp)$", image, re.I):
        out.append(PlacePhoto(name="osm-photo:image", proxy_url=image, attributions=[PhotoAttribution(display_name="Wikimedia Commons", uri=image)]))
    return out[:2]


def _notability(tags: Dict[str, str]) -> float:
    score = 0.0
    if tags.get("wikidata"):
        score += 3
    if tags.get("wikipedia"):
        score += 2
    if tags.get("tourism") in ("attraction", "museum", "zoo", "theme_park") or tags.get("historic"):
        score += 1
    if tags.get("heritage"):
        score += 1
    # well-mapped places tend to be well-known ones
    score += min(len(tags), 25) / 25
    return score


_CACHE: Dict[str, Tuple[float, PlaceSearchResult]] = {}
_GEO_CACHE: Dict[str, Tuple[float, Optional[Tuple[float, float]]]] = {}
CACHE_SECONDS = 6 * 3600


class OpenStreetMapPlacesService(PlacesProvider):
    def __init__(self, geoapify_key: Optional[str] = None, client_timeout: float = 15.0):
        self.geoapify_key = geoapify_key if geoapify_key is not None else settings.geoapify_api_key_live
        self.timeout = client_timeout
        self.headers = {"User-Agent": settings.osm_user_agent, "Accept": "application/json"}

    def get_status(self) -> ProviderStatus:
        via = "Geoapify" if self.geoapify_key else "the Overpass API"
        return ProviderStatus(
            provider_name="OpenStreetMap (free)",
            is_live=True,
            api_key_configured=bool(self.geoapify_key),
            status_message=f"Live places from OpenStreetMap via {via}. No ratings; ranked by how well-known places are. © OpenStreetMap contributors.",
        )

    # ---------------- locating neighbourhoods ----------------

    async def locate(self, locality: str, city: str) -> Optional[Tuple[float, float]]:
        key = f"{city}|{_norm(locality)}"
        hit = _GEO_CACHE.get(key)
        if hit and time.time() - hit[0] < 7 * 24 * 3600:
            return hit[1]
        lat0, lng0, radius = CITY_CENTERS.get(city, CITY_CENTERS["hyderabad"])
        found: Optional[Tuple[float, float]] = None
        q = f"{locality}, {city.capitalize()}"
        try:
            async with httpx.AsyncClient(timeout=8.0, headers=self.headers) as client:
                if self.geoapify_key:
                    r = await client.get("https://api.geoapify.com/v1/geocode/search", params={"text": q, "bias": f"proximity:{lng0},{lat0}", "limit": 1, "apiKey": self.geoapify_key})
                    if r.status_code == 200 and r.json().get("features"):
                        lng, lat = r.json()["features"][0]["geometry"]["coordinates"][:2]
                        found = (lat, lng)
                if not found:
                    r = await client.get("https://photon.komoot.io/api/", params={"q": q, "limit": 1, "lat": lat0, "lon": lng0})
                    if r.status_code == 200 and r.json().get("features"):
                        lng, lat = r.json()["features"][0]["geometry"]["coordinates"][:2]
                        found = (lat, lng)
                if not found:
                    r = await client.get("https://nominatim.openstreetmap.org/search", params={"q": q, "format": "json", "limit": 1})
                    if r.status_code == 200 and r.json():
                        found = (float(r.json()[0]["lat"]), float(r.json()[0]["lon"]))
        except Exception as exc:
            logger.warning(f"Could not locate {q}: {exc}")
            return None
        # a geocoder answer far outside the city is a different place with the same name
        if found and _km(found[0], found[1], lat0, lng0) > radius / 1000 * 2.5:
            found = None
        _GEO_CACHE[key] = (time.time(), found)
        return found

    # ---------------- fetching ----------------

    async def _overpass(self, query: str) -> List[Dict[str, Any]]:
        last = ""
        async with httpx.AsyncClient(timeout=self.timeout, headers=self.headers) as client:
            for url in settings.overpass_urls:
                try:
                    r = await client.post(url, data={"data": query})
                except Exception as exc:
                    last = str(exc)
                    continue
                if r.status_code == 200:
                    return r.json().get("elements", [])
                last = f"{url} {r.status_code}"
        logger.warning(f"Overpass failed: {last}")
        return []

    async def _geoapify(self, rules, lat: float, lng: float, radius: float, name_words: List[str]) -> List[Dict[str, Any]]:
        cats = sorted({c for r in rules for c in r["geoapify"]}) or POPULAR["geoapify"]
        params = {
            "categories": ",".join(cats),
            "filter": f"circle:{lng},{lat},{int(radius)}",
            "bias": f"proximity:{lng},{lat}",
            "limit": 80,
            "apiKey": self.geoapify_key,
        }
        if name_words:
            params["name"] = " ".join(name_words)
        async with httpx.AsyncClient(timeout=self.timeout, headers=self.headers) as client:
            r = await client.get("https://api.geoapify.com/v2/places", params=params)
        if r.status_code != 200:
            logger.warning(f"Geoapify returned {r.status_code}: {r.text[:160]}")
            return []
        out = []
        for f in r.json().get("features", []):
            p = f.get("properties", {})
            raw = (p.get("datasource") or {}).get("raw") or {}
            tags = {k: str(v) for k, v in raw.items() if isinstance(v, (str, int, float))}
            tags.setdefault("name", p.get("name") or "")
            if p.get("opening_hours"):
                tags.setdefault("opening_hours", p["opening_hours"])
            if p.get("suburb") or p.get("district"):
                tags.setdefault("addr:suburb", p.get("suburb") or p.get("district"))
            osm_type = {"n": "node", "w": "way", "r": "relation"}.get(str(raw.get("osm_type", "")), str(raw.get("osm_type", "node")))
            out.append({"type": osm_type, "id": raw.get("osm_id") or p.get("place_id"), "lat": p.get("lat"), "lon": p.get("lon"), "tags": tags, "formatted": p.get("formatted")})
        return out

    # ---------------- converting ----------------

    def _to_result(self, el: Dict[str, Any], city: str, locality: Optional[str], centre: Optional[Tuple[float, float]], via: str) -> Optional[PlaceSearchResult]:
        tags = el.get("tags") or {}
        name = tags.get("name:en") or tags.get("name")
        if not name:
            return None
        lat = el.get("lat") or (el.get("center") or {}).get("lat")
        lng = el.get("lon") or (el.get("center") or {}).get("lon")
        if lat is None or lng is None:
            return None
        primary, types = _google_like_type(tags)
        area = tags.get("addr:suburb") or tags.get("addr:neighbourhood") or tags.get("addr:district")
        if locality and centre and _km(centre[0], centre[1], lat, lng) <= INSIDE_LOCALITY_KM:
            area = locality
        price = PriceService.estimate_price(place_name=name, city=city, price_level=None, types=types)
        osm_id = f"{el.get('type', 'node')}/{el.get('id')}"
        provenance = {
            "source": "OpenStreetMap contributors",
            "via": via,
            "license": "ODbL",
            "verification_status": "source_returned",
            "osm_id": osm_id,
        }
        if tags.get("wikipedia"):
            provenance["wikipedia"] = tags["wikipedia"]
        if tags.get("wikidata"):
            provenance["wikidata"] = tags["wikidata"]
        return PlaceSearchResult(
            id=f"osm:{osm_id}",
            name=name,
            city=city,
            locality=area,
            formatted_address=el.get("formatted") or _address(tags),
            coordinates=Coordinates(latitude=float(lat), longitude=float(lng)),
            primary_type=primary,
            types=types,
            currency=price.currency,
            price_estimate=price,
            opening_hours_text=tags.get("opening_hours"),
            is_open_now=None,
            attributions=["© OpenStreetMap contributors"],
            photos=_photos(tags),
            provenance=provenance,
        )

    def rank(self, results: List[Tuple[PlaceSearchResult, Dict[str, str]]], name_words: List[str], centre: Tuple[float, float], radius_km: float) -> List[PlaceSearchResult]:
        def score(item) -> float:
            res, tags = item
            s = _notability(tags)
            nm = _norm(res.name)
            s += sum(2.5 for w in name_words if w in nm)
            d = _km(centre[0], centre[1], res.coordinates.latitude, res.coordinates.longitude)
            s -= 1.5 * d / max(radius_km, 0.5)
            return s

        seen = set()
        out = []
        for res, tags in sorted(results, key=score, reverse=True):
            key = (_norm(res.name), round(res.coordinates.latitude, 3), round(res.coordinates.longitude, 3))
            if key in seen:
                continue
            seen.add(key)
            out.append(res)
        return out

    # ---------------- provider interface ----------------

    async def search_places(
        self,
        query: str,
        city: str,
        limit: int = 12,
        category: Optional[str] = None,
        page_token: Optional[str] = None,
        locality: Optional[str] = None,
    ) -> SearchPageResult:
        city = (city or "hyderabad").lower()
        lat, lng, radius = CITY_CENTERS.get(city, CITY_CENTERS["hyderabad"])
        centre: Optional[Tuple[float, float]] = None
        if locality:
            centre = await self.locate(locality, city)
            if centre:
                lat, lng, radius = centre[0], centre[1], LOCALITY_RADIUS_M
        rules, name_words = plan_query(query, category, city, locality)
        try:
            if self.geoapify_key:
                elements = await self._geoapify(rules, lat, lng, radius, name_words)
                via = "Geoapify"
            else:
                elements = await self._overpass(build_overpass_query(rules, name_words, lat, lng, radius))
                via = "Overpass API"
        except Exception as exc:
            logger.warning(f"OpenStreetMap search failed: {exc}")
            return SearchPageResult()

        pairs = []
        for el in elements:
            res = self._to_result(el, city, locality, centre, via)
            if res:
                pairs.append((res, el.get("tags") or {}))
        ranked = self.rank(pairs, name_words, (lat, lng), radius / 1000)
        now = time.time()
        for r in ranked:
            _CACHE[r.id] = (now, r)
        return SearchPageResult(places=ranked[: max(limit, 1)])

    async def get_place_details(self, place_id: str) -> Optional[PlaceDetailResult]:
        if not place_id.startswith("osm:"):
            return None
        hit = _CACHE.get(place_id)
        res: Optional[PlaceSearchResult] = hit[1] if hit and time.time() - hit[0] < CACHE_SECONDS else None
        if res is None:
            m = re.match(r"^osm:(node|way|relation)/(\d+)$", place_id)
            if not m:
                return None
            elements = await self._overpass(f"[out:json][timeout:15];\n{m.group(1)}({m.group(2)});\nout center tags;")
            if not elements:
                return None
            el = elements[0]
            lat = el.get("lat") or (el.get("center") or {}).get("lat")
            lng = el.get("lon") or (el.get("center") or {}).get("lon")
            city = nearest_city(float(lat), float(lng)) if lat is not None else "hyderabad"
            res = self._to_result(el, city, None, None, "Overpass API")
            if res is None:
                return None
        data = res.model_dump() if hasattr(res, "model_dump") else res.dict()
        allowed = PlaceDetailResult.model_fields if hasattr(PlaceDetailResult, "model_fields") else PlaceDetailResult.__fields__
        return PlaceDetailResult(**{k: v for k, v in data.items() if k in allowed})
