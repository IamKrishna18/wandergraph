import httpx
from typing import List, Optional, Dict, Any, Tuple
from urllib.parse import quote
from app.config import settings
from app.services.places_provider import (
    PlacesProvider,
    PlaceSearchResult,
    PlaceDetailResult,
    ProviderStatus,
    Coordinates,
    PlacePhoto,
    PhotoAttribution,
    SearchPageResult,
)
from app.services.price_service import PriceService
from app.graph.schema import VerificationStatus
from app.utils.logging import logger

PRICE_LEVEL_MAP = {
    "PRICE_LEVEL_FREE": 0,
    "PRICE_LEVEL_INEXPENSIVE": 1,
    "PRICE_LEVEL_MODERATE": 2,
    "PRICE_LEVEL_EXPENSIVE": 3,
    "PRICE_LEVEL_VERY_EXPENSIVE": 4,
}


_UNSET = object()


class GooglePlacesService(PlacesProvider):
    """
    Client for Google Places API (New).
    Strictly follows Google Maps Platform terms:
    - Selective field masks to minimize egress and cost
    - Place IDs used for runtime lookups; no bulk caching
    - Preserves provider attributions
    - Provenance recorded as source_returned
    - Photos fetched server-side and proxied to frontend (zero key leakage)
    """

    def __init__(self, api_key: Any = _UNSET):
        if api_key is _UNSET:
            self.api_key = settings.google_maps_api_key_live
        else:
            self.api_key = api_key
        self.timeout = settings.request_timeout_seconds

    def get_status(self) -> ProviderStatus:
        if not self.api_key or len(self.api_key.strip()) < 5:
            return ProviderStatus(
                provider_name="Google Places API (New)",
                is_live=False,
                api_key_configured=False,
                status_message="GOOGLE_MAPS_API_KEY is not configured. Falling back to local development mock provider.",
            )
        return ProviderStatus(
            provider_name="Google Places API (New)",
            is_live=True,
            api_key_configured=True,
            status_message="Google Places API (New) is configured and active.",
        )

    def _headers(self, field_mask: str) -> Dict[str, str]:
        return {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": self.api_key or "",
            "X-Goog-FieldMask": field_mask,
        }

    def _parse_photos(self, raw_photos: List[Dict[str, Any]]) -> List[PlacePhoto]:
        parsed: List[PlacePhoto] = []
        for p in raw_photos[:5]:  # Capture top photos
            name = p.get("name")
            if not name:
                continue
            attributions: List[PhotoAttribution] = []
            for attr in p.get("authorAttributions", []):
                attributions.append(
                    PhotoAttribution(
                        display_name=attr.get("displayName", "Google Maps Contributor"),
                        uri=attr.get("uri"),
                        photo_uri=attr.get("photoUri"),
                    )
                )
            proxy_url = f"/api/places/photo?name={quote(name)}&max_width=800&max_height=600"
            parsed.append(
                PlacePhoto(
                    name=name,
                    width_px=p.get("widthPx"),
                    height_px=p.get("heightPx"),
                    attributions=attributions,
                    proxy_url=proxy_url,
                )
            )
        return parsed

    def _extract_locality_from_address(self, address: Optional[str], city: str) -> Optional[str]:
        if not address:
            return None
        parts = [p.strip() for p in address.split(",")]
        # Usually locality is 1-2 segments before city/pincode
        if len(parts) >= 3:
            candidate = parts[-3]
            if candidate.lower() != city.lower():
                return candidate
        return None

    CITY_CENTERS = {
        "hyderabad": (17.385044, 78.486671),
        "bengaluru": (12.971599, 77.594566),
        "tokyo": (35.676192, 139.650311),
        "kyoto": (35.011564, 135.768149),
    }

    def _parse_places_items(
        self, places_raw: List[Dict[str, Any]], city: str, locality: Optional[str] = None
    ) -> List[PlaceSearchResult]:
        results: List[PlaceSearchResult] = []
        for item in places_raw:
            place_id = item.get("id")
            display_name_obj = item.get("displayName", {})
            name = display_name_obj.get("text", "Unknown Place")
            loc = item.get("location", {})
            coords = None
            if "latitude" in loc and "longitude" in loc:
                coords = Coordinates(latitude=loc["latitude"], longitude=loc["longitude"])

            price_level_str = item.get("priceLevel")
            price_level = PRICE_LEVEL_MAP.get(price_level_str, None)

            types = item.get("types", [])
            primary_type = types[0] if types else "tourist_attraction"

            # Opening hours
            opening_hours_obj = item.get("regularOpeningHours", {})
            is_open_now = opening_hours_obj.get("openNow")
            weekday_desc = opening_hours_obj.get("weekdayDescriptions", [])
            opening_hours_text = "; ".join(weekday_desc[:2]) if weekday_desc else None

            # Attributions
            attributions = []
            if "attributions" in item:
                attributions = [attr.get("provider", "") for attr in item["attributions"]]

            # Photos
            raw_photos = item.get("photos", [])
            parsed_photos = self._parse_photos(raw_photos)
            photo_reference = parsed_photos[0].proxy_url if parsed_photos else None

            # Locality
            formatted_address = item.get("formattedAddress")
            detected_locality = locality or self._extract_locality_from_address(formatted_address, city)

            # Price Estimate
            price_estimate = PriceService.estimate_price(
                place_name=name,
                city=city,
                price_level=price_level,
                types=types,
            )

            results.append(
                PlaceSearchResult(
                    id=f"gplaces:{place_id}",
                    name=name,
                    city=city.lower(),
                    locality=detected_locality,
                    formatted_address=formatted_address,
                    coordinates=coords,
                    primary_type=primary_type,
                    types=types,
                    rating=item.get("rating"),
                    user_ratings_total=item.get("userRatingCount"),
                    price_level=price_level,
                    currency=price_estimate.currency,
                    price_estimate=price_estimate,
                    opening_hours_text=opening_hours_text,
                    is_open_now=is_open_now,
                    attributions=attributions,
                    photo_reference=photo_reference,
                    photos=parsed_photos,
                    provenance={
                        "source": "Google Places API (New)",
                        "verification_status": VerificationStatus.SOURCE_RETURNED.value,
                        "source_place_id": place_id,
                    },
                )
            )
        return results

    async def _search_nearby(
        self,
        city: str,
        query: str,
        limit: int = 12,
        category: Optional[str] = None,
        locality: Optional[str] = None,
    ) -> SearchPageResult:
        """Fallback to Google Places (New) searchNearby which operates on independent quota."""
        lat, lng = self.CITY_CENTERS.get(city.lower(), (17.385044, 78.486671))

        q_lower = (query or "").lower()
        cat_lower = (category or "").lower()

        if any(w in q_lower or w in cat_lower for w in ["cafe", "coffee", "bakery", "tea"]):
            types = ["cafe", "coffee_shop"]
        elif any(w in q_lower or w in cat_lower for w in ["food", "restaurant", "eat", "dining", "biryani", "ramen"]):
            types = ["restaurant", "meal_takeaway"]
        elif any(w in q_lower or w in cat_lower for w in ["bar", "pub", "brewery", "nightlife", "lounge"]):
            types = ["bar", "pub", "night_club"]
        elif any(w in q_lower or w in cat_lower for w in ["park", "nature", "garden", "lake"]):
            types = ["park", "national_park", "botanical_garden"]
        elif any(w in q_lower or w in cat_lower for w in ["museum", "art", "gallery"]):
            types = ["museum", "art_gallery"]
        elif any(w in q_lower or w in cat_lower for w in ["shop", "market", "mall", "bazaar"]):
            types = ["shopping_mall", "market"]
        elif any(w in q_lower or w in cat_lower for w in ["temple", "shrine", "monument", "historic", "heritage", "palace", "fort", "cultural"]):
            types = ["tourist_attraction", "historical_landmark", "hindu_temple", "place_of_worship"]
        else:
            types = ["tourist_attraction", "historical_landmark", "restaurant", "cafe", "museum", "park"]

        payload = {
            "includedTypes": types[:5],
            "maxResultCount": min(max(limit, 1), 20),
            "locationRestriction": {
                "circle": {
                    "center": {"latitude": lat, "longitude": lng},
                    "radius": 15000.0,
                }
            },
        }

        # Note: Google Places (New) searchNearby rejects nextPageToken in field mask
        nearby_mask = ",".join([f for f in settings.places_search_field_mask.split(",") if "nextPageToken" not in f])

        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                res = await client.post(
                    "https://places.googleapis.com/v1/places:searchNearby",
                    headers=self._headers(nearby_mask),
                    json=payload,
                )
                if res.status_code == 200:
                    places_raw = res.json().get("places", [])
                    results = self._parse_places_items(places_raw, city, locality)
                    return SearchPageResult(places=results)
                else:
                    logger.warning(f"Google Places searchNearby returned {res.status_code}: {res.text[:120]}")
        except Exception as e:
            logger.error(f"Google Places searchNearby exception: {e}")

        return SearchPageResult()

    async def search_places(
        self,
        query: str,
        city: str,
        limit: int = 12,
        category: Optional[str] = None,
        page_token: Optional[str] = None,
        locality: Optional[str] = None,
    ) -> SearchPageResult:
        if not self.api_key:
            logger.warning("Attempted Google Places search without API key.")
            return SearchPageResult()

        city_cap = city.capitalize()
        if locality and locality.lower() not in query.lower():
            search_query = f"{query} in {locality}, {city_cap}"
        elif city.lower() not in query.lower():
            search_query = f"{query} in {city_cap}"
        else:
            search_query = query

        payload: Dict[str, Any] = {
            "textQuery": search_query,
            "maxResultCount": min(max(limit, 1), 20),
        }
        if page_token:
            payload["pageToken"] = page_token

        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(
                    settings.google_places_search_url,
                    headers=self._headers(settings.places_search_field_mask),
                    json=payload,
                )

                if response.status_code in [401, 403]:
                    logger.error("Google Places API authorization error. Check GOOGLE_MAPS_API_KEY.")
                    return await self._search_nearby(city=city, query=query, limit=limit, category=category, locality=locality)
                elif response.status_code == 429:
                    logger.warning("Google Places API SearchText quota reached. Seamlessly activating live searchNearby.")
                    return await self._search_nearby(city=city, query=query, limit=limit, category=category, locality=locality)

                response.raise_for_status()
                data = response.json()
                places_raw = data.get("places", [])
                if not places_raw:
                    return await self._search_nearby(city=city, query=query, limit=limit, category=category, locality=locality)

                results = self._parse_places_items(places_raw, city, locality)
                next_page_token = data.get("nextPageToken")
                return SearchPageResult(places=results, next_page_token=next_page_token)

        except httpx.RequestError as exc:
            logger.error(f"HTTP request error communicating with Google Places API: {exc}")
            return await self._search_nearby(city=city, query=query, limit=limit, category=category, locality=locality)
        except Exception as exc:
            logger.error(f"Unexpected error in Google Places service: {exc}")
            return await self._search_nearby(city=city, query=query, limit=limit, category=category, locality=locality)

    async def get_photo_media(
        self,
        photo_name: str,
        max_width: int = 800,
        max_height: int = 600,
    ) -> Optional[Tuple[bytes, str]]:
        """
        Server-side photo media proxy.
        Fetches the binary image directly from Places API, keeping GOOGLE_MAPS_API_KEY secure.
        """
        if not self.api_key:
            return None

        clean_name = photo_name.strip()
        url = f"https://places.googleapis.com/v1/{clean_name}/media"
        params = {
            "maxWidthPx": max_width,
            "maxHeightPx": max_height,
            "key": self.api_key,
        }

        try:
            async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
                res = await client.get(url, params=params)
                if res.status_code == 200:
                    content_type = res.headers.get("content-type", "image/jpeg")
                    return res.content, content_type
                else:
                    logger.warning(f"Failed to fetch photo media for {clean_name}: {res.status_code}")
                    return None
        except Exception as exc:
            logger.error(f"Error fetching photo media for {clean_name}: {exc}")
            return None

    async def get_place_details(self, place_id: str) -> Optional[PlaceDetailResult]:
        if not self.api_key:
            return None

        clean_id = place_id.replace("gplaces:", "")
        url = f"{settings.google_places_details_url}/{clean_id}"

        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.get(
                    url,
                    headers=self._headers(settings.places_details_field_mask),
                )
                if response.status_code != 200:
                    logger.error(f"Google Places Details error: status {response.status_code}")
                    return None

                item = response.json()
                display_name_obj = item.get("displayName", {})
                name = display_name_obj.get("text", "Unknown Place")
                loc = item.get("location", {})
                coords = None
                if "latitude" in loc and "longitude" in loc:
                    coords = Coordinates(latitude=loc["latitude"], longitude=loc["longitude"])

                summary_obj = item.get("editorialSummary", {})
                summary_text = summary_obj.get("text") if summary_obj else None

                price_level_str = item.get("priceLevel")
                price_level = PRICE_LEVEL_MAP.get(price_level_str, None)

                # Photos
                raw_photos = item.get("photos", [])
                parsed_photos = self._parse_photos(raw_photos)

                price_estimate = PriceService.estimate_price(
                    place_name=name,
                    city="",
                    price_level=price_level,
                    types=item.get("types", []),
                )

                return PlaceDetailResult(
                    id=f"gplaces:{clean_id}",
                    name=name,
                    city="",
                    formatted_address=item.get("formattedAddress"),
                    coordinates=coords,
                    types=item.get("types", []),
                    rating=item.get("rating"),
                    user_ratings_total=item.get("userRatingCount"),
                    price_level=price_level,
                    currency=price_estimate.currency,
                    price_estimate=price_estimate,
                    website_uri=item.get("websiteUri"),
                    national_phone_number=item.get("nationalPhoneNumber"),
                    editorial_summary=summary_text,
                    photos=parsed_photos,
                    provenance={
                        "source": "Google Places API (New)",
                        "verification_status": VerificationStatus.SOURCE_RETURNED.value,
                        "source_place_id": clean_id,
                    },
                )
        except Exception as exc:
            logger.error(f"Error fetching place details for {place_id}: {exc}")
            return None

    # ------------------------------------------------------------------
    # Photo lookup for any named place (curated places have no Google ID)
    # ------------------------------------------------------------------

    _GENERIC_WORDS = {
        "the", "of", "and", "a", "an", "in", "at", "temple", "shrine", "park", "garden", "gardens", "lake", "museum",
        "palace", "fort", "market", "street", "road", "restaurant", "cafe", "coffee", "house", "bar", "pub", "hotel",
        "centre", "center", "national", "district", "original", "city", "old", "new", "tower", "castle", "hall",
    }

    @classmethod
    def _distinct_words(cls, text: str) -> List[str]:
        import re
        import unicodedata

        clean = unicodedata.normalize("NFKD", text or "").encode("ascii", "ignore").decode().lower()
        return [w for w in re.split(r"[^a-z0-9]+", clean) if len(w) > 1 and w not in cls._GENERIC_WORDS]

    @classmethod
    def _names_match(cls, wanted: str, found: str) -> bool:
        """True when Google's name for a place is clearly the same place as ours."""
        core = wanted.split("(")[0]
        a = set(cls._distinct_words(core))
        b = set(cls._distinct_words(found))
        if not a or not b:
            return (core or "").strip().lower() == (found or "").strip().lower()
        shared = len(a & b)
        return shared > 0 and shared / len(a) >= 0.5

    @staticmethod
    def _km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
        import math

        r = 6371.0
        p1, p2 = math.radians(lat1), math.radians(lat2)
        dp, dl = p2 - p1, math.radians(lng2 - lng1)
        h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
        return 2 * r * math.asin(math.sqrt(h))

    async def find_place_photos(
        self,
        name: str,
        city: str,
        lat: Optional[float] = None,
        lng: Optional[float] = None,
        max_km: float = 3.0,
    ) -> Tuple[List[PlacePhoto], str]:
        """
        Find a place on Google by name (and position, when known) and return its photos.
        Returns (photos, reason); reason explains an empty result.
        """
        if not self.api_key:
            return [], "no_api_key"

        city_cap = (city or "").capitalize()
        query = name if city_cap.lower() in name.lower() else f"{name}, {city_cap}"
        payload: Dict[str, Any] = {"textQuery": query, "maxResultCount": 5}
        if lat is not None and lng is not None:
            payload["locationBias"] = {"circle": {"center": {"latitude": lat, "longitude": lng}, "radius": 2000.0}}

        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                res = await client.post(
                    settings.google_places_search_url,
                    headers=self._headers("places.id,places.displayName,places.location,places.photos"),
                    json=payload,
                )
        except Exception as exc:  # network trouble
            logger.warning(f"Photo lookup failed for {name}: {exc}")
            return [], "google_unreachable"

        if res.status_code != 200:
            logger.warning(f"Photo lookup for {name} returned {res.status_code}: {res.text[:160]}")
            return [], f"google_status_{res.status_code}"

        places = res.json().get("places", [])
        if not places:
            return [], "no_google_match"
        for item in places:
            found = (item.get("displayName") or {}).get("text", "")
            if not self._names_match(name, found):
                continue
            loc = item.get("location") or {}
            if lat is not None and lng is not None and "latitude" in loc:
                if self._km(lat, lng, loc["latitude"], loc["longitude"]) > max_km:
                    continue
            photos = self._parse_photos(item.get("photos", []))
            if photos:
                return photos, "ok"
            return [], "google_match_has_no_photos"
        return [], "no_google_match"
