import asyncio
from typing import Any, Dict, List, Optional
import httpx
from app.services.places_provider import PlacePhoto, PhotoAttribution
from app.utils.logging import logger

# Curated fallback imagery by category (Unsplash CDN with free license)
CATEGORY_FALLBACK_IMAGES: Dict[str, Dict[str, str]] = {
    "cafe": {
        "url": "https://images.unsplash.com/photo-1501339847302-ac426a4a7cbb?auto=format&fit=crop&w=800&q=80",
        "author": "Petr Sevcovic (Unsplash)",
        "author_uri": "https://unsplash.com/@petrsevcovic",
    },
    "restaurant": {
        "url": "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=800&q=80",
        "author": "Jay Wennington (Unsplash)",
        "author_uri": "https://unsplash.com/@jaywennington",
    },
    "bar_nightlife": {
        "url": "https://images.unsplash.com/photo-1514933651103-005eec06c04b?auto=format&fit=crop&w=800&q=80",
        "author": "Kelsey Chance (Unsplash)",
        "author_uri": "https://unsplash.com/@kchance8",
    },
    "park": {
        "url": "https://images.unsplash.com/photo-1519331379826-f10be5486c6f?auto=format&fit=crop&w=800&q=80",
        "author": "Jake Hills (Unsplash)",
        "author_uri": "https://unsplash.com/@jakehills",
    },
    "culture_history": {
        "url": "https://images.unsplash.com/photo-1548013146-72479768bada?auto=format&fit=crop&w=800&q=80",
        "author": "Sylvain Mauroux (Unsplash)",
        "author_uri": "https://unsplash.com/@sylvainm",
    },
    "tourist_attraction": {
        "url": "https://images.unsplash.com/photo-1524492412937-b28074a5d7da?auto=format&fit=crop&w=800&q=80",
        "author": "Annie Spratt (Unsplash)",
        "author_uri": "https://unsplash.com/@anniespratt",
    },
    "shopping": {
        "url": "https://images.unsplash.com/photo-1483985988355-763728e1935b?auto=format&fit=crop&w=800&q=80",
        "author": "Freestocks (Unsplash)",
        "author_uri": "https://unsplash.com/@freestocks",
    },
    "default": {
        "url": "https://images.unsplash.com/photo-1488646953014-85cb44e25828?auto=format&fit=crop&w=800&q=80",
        "author": "Francesca Tirico (Unsplash)",
        "author_uri": "https://unsplash.com/@francesca_tirico",
    },
}


class ImageService:
    def __init__(self):
        self._cache: Dict[str, PlacePhoto] = {}
        self._user_agent = "WanderGraphBot/1.0 (https://wandergraph.org; contact@wandergraph.org)"

    def _get_category_key(self, types: List[str], primary_type: Optional[str]) -> str:
        all_types = " ".join([primary_type or ""] + types).lower()
        if any(t in all_types for t in ["cafe", "coffee", "bakery"]):
            return "cafe"
        if any(t in all_types for t in ["bar", "pub", "night_club", "nightlife", "lounge"]):
            return "bar_nightlife"
        if any(t in all_types for t in ["restaurant", "food", "meal", "dinner"]):
            return "restaurant"
        if any(t in all_types for t in ["park", "garden", "nature", "lake", "zoo", "campground"]):
            return "park"
        if any(t in all_types for t in ["temple", "shrine", "monument", "historic", "museum", "art_gallery", "heritage"]):
            return "culture_history"
        if any(t in all_types for t in ["shopping", "market", "mall", "store"]):
            return "shopping"
        if any(t in all_types for t in ["tourist_attraction", "amusement", "attraction", "landmark"]):
            return "tourist_attraction"
        return "default"

    def get_category_fallback_photo(self, types: List[str], primary_type: Optional[str]) -> PlacePhoto:
        key = self._get_category_key(types, primary_type)
        item = CATEGORY_FALLBACK_IMAGES.get(key, CATEGORY_FALLBACK_IMAGES["default"])
        return PlacePhoto(
            name=f"fallback:{key}",
            width_px=800,
            height_px=600,
            proxy_url=item["url"],
            attributions=[
                PhotoAttribution(
                    display_name=item["author"],
                    uri=item["author_uri"],
                    photo_uri=item["url"],
                )
            ],
        )

    async def fetch_wikipedia_photo(self, place_name: str, city: str) -> Optional[PlacePhoto]:
        cache_key = f"{city}:{place_name}".lower()
        if cache_key in self._cache:
            return self._cache[cache_key]

        # Clean name for search (remove parentheses and secondary notes)
        clean_name = place_name.split("(")[0].strip()

        # Try clean name first, then clean name + city
        queries_to_try = [clean_name, f"{clean_name} {city.capitalize()}"]

        try:
            async with httpx.AsyncClient(timeout=3.5, headers={"User-Agent": self._user_agent}) as client:
                for query in queries_to_try:
                    params = {
                        "action": "query",
                        "generator": "search",
                        "gsrsearch": query,
                        "gsrlimit": 1,
                        "prop": "pageimages",
                        "format": "json",
                        "pithumbsize": 1000,
                    }
                    res = await client.get("https://en.wikipedia.org/w/api.php", params=params)
                    if res.status_code == 200:
                        try:
                            data = res.json()
                        except Exception:
                            continue
                        pages = data.get("query", {}).get("pages", {})
                        for _, pdata in pages.items():
                            thumb = pdata.get("thumbnail", {})
                            img_src = thumb.get("source")
                            if img_src:
                                photo = PlacePhoto(
                                    name=f"wiki:{pdata.get('pageid', 'item')}",
                                    width_px=thumb.get("width", 800),
                                    height_px=thumb.get("height", 600),
                                    proxy_url=img_src,
                                    attributions=[
                                        PhotoAttribution(
                                            display_name=f"{pdata.get('title', place_name)} via Wikimedia Commons",
                                            uri=f"https://en.wikipedia.org/?curid={pdata.get('pageid')}",
                                            photo_uri=img_src,
                                        )
                                    ],
                                )
                                self._cache[cache_key] = photo
                                return photo
        except Exception as e:
            logger.debug(f"Wikipedia photo lookup error for {place_name}: {e}")

        return None

    async def enrich_places_with_photos(self, places: List[Any], city: str) -> None:
        """Asynchronously enrich places lacking photos with authentic Wikipedia or category imagery."""
        places_needing_photos = [
            p for p in places
            if not p.photos or any(getattr(ph, "name", "").startswith("mock_photos") for ph in p.photos)
        ]
        if not places_needing_photos:
            return

        async def _enrich_single(p):
            # 1. Try Wikipedia / Wikimedia Commons first
            wiki_photo = await self.fetch_wikipedia_photo(p.name, city)
            if wiki_photo:
                p.photos = [wiki_photo]
                p.photo_reference = wiki_photo.proxy_url
                return

            # 2. If not on Wikipedia, provide high-quality category photo with attribution
            fallback_photo = self.get_category_fallback_photo(p.types, p.primary_type)
            p.photos = [fallback_photo]
            p.photo_reference = fallback_photo.proxy_url

        await asyncio.gather(*[_enrich_single(p) for p in places_needing_photos], return_exceptions=True)


# Global image service instance
image_service = ImageService()
