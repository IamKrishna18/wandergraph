import os
from pathlib import Path
from typing import List, Optional
from pydantic_settings import BaseSettings
from pydantic import Field

BACKEND_DIR = Path(__file__).resolve().parent.parent
ROOT_DIR = BACKEND_DIR.parent
ENV_FILES = [
    str(ROOT_DIR / ".env"),
    str(BACKEND_DIR / ".env"),
    ".env",
]


class Settings(BaseSettings):
    app_name: str = "WanderGraph"
    app_version: str = "1.0.0"
    environment: str = Field(default="development")
    host: str = Field(default="127.0.0.1")
    port: int = Field(default=8000)

    # API Keys - kept strictly server-side
    google_maps_api_key: Optional[str] = Field(default=None, alias="GOOGLE_MAPS_API_KEY")
    gemini_api_key: Optional[str] = Field(default=None, alias="GEMINI_API_KEY")
    # Free OpenStreetMap place search; a Geoapify key (free plan, no card) makes it faster
    geoapify_api_key: Optional[str] = Field(default=None, alias="GEOAPIFY_API_KEY")
    # "auto": Google when its key is set, else OpenStreetMap; or force "google", "osm" or "curated"
    places_provider: str = Field(default="auto", alias="PLACES_PROVIDER")
    overpass_urls: List[str] = [
        "https://overpass-api.de/api/interpreter",
        "https://overpass.kumi.systems/api/interpreter",
    ]
    osm_user_agent: str = "WanderGraph/1.0 (+https://github.com/codeMaster60/wandergraph)"

    # CORS configuration
    cors_origins: List[str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
    ]

    # Google Places API (New) endpoints
    google_places_search_url: str = "https://places.googleapis.com/v1/places:searchText"
    google_places_details_url: str = "https://places.googleapis.com/v1/places"
    google_places_media_url: str = "https://places.googleapis.com/v1/{name}/media"

    # Field mask for cost-conscious, compliant discovery
    places_search_field_mask: str = (
        "places.id,places.displayName,places.formattedAddress,places.location,"
        "places.types,places.priceLevel,places.regularOpeningHours,places.rating,"
        "places.userRatingCount,places.photos,nextPageToken"
    )
    places_details_field_mask: str = (
        "id,displayName,formattedAddress,location,types,priceLevel,"
        "regularOpeningHours,rating,userRatingCount,websiteUri,nationalPhoneNumber,editorialSummary,photos"
    )

    request_timeout_seconds: float = 10.0

    @property
    def google_maps_api_key_live(self) -> Optional[str]:
        if self.google_maps_api_key and len(self.google_maps_api_key.strip()) > 5:
            return self.google_maps_api_key.strip()
        if os.getenv("GOOGLE_MAPS_API_KEY") and len(os.getenv("GOOGLE_MAPS_API_KEY", "").strip()) > 5:
            return os.getenv("GOOGLE_MAPS_API_KEY", "").strip()
        from dotenv import dotenv_values
        for env_file in ENV_FILES:
            p = Path(env_file)
            if p.exists():
                vals = dotenv_values(p)
                val = vals.get("GOOGLE_MAPS_API_KEY")
                if val and len(val.strip()) > 5:
                    return val.strip()
        return None

    @property
    def geoapify_api_key_live(self) -> Optional[str]:
        key = self.geoapify_api_key or os.getenv("GEOAPIFY_API_KEY")
        return key.strip() if key and len(key.strip()) > 5 else None

    @property
    def has_google_places_key(self) -> bool:
        return bool(self.google_maps_api_key_live)

    @property
    def has_gemini_key(self) -> bool:
        key = self.gemini_api_key or os.getenv("GEMINI_API_KEY")
        return bool(key and len(key.strip()) > 5)

    model_config = {
        "env_file": ENV_FILES,
        "env_file_encoding": "utf-8",
        "extra": "ignore",
    }


settings = Settings()
