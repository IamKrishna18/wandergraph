from fastapi import APIRouter, HTTPException, Depends, Query, Response
from typing import Dict, Any, Optional

from app.config import settings
from app.api.schemas import (
    SearchRequest,
    SearchResponse,
    PreferenceUpdateRequest,
    GraphResponse,
    HealthResponse,
    ItineraryResponse,
    ItineraryMessageRequest,
    ReplaceStopRequest,
)
from app.services.places_provider import PlacesProvider
from app.services.google_places import GooglePlacesService
from app.services.mock_places import MockPlacesService
from app.services.preference_service import PreferenceService, PreferenceState
from app.services.recommendation_service import RecommendationService
from app.services.graph_service import GraphService
from app.services.itinerary_service import ItineraryService
from app.services.image_service import image_service
from app.graph.builder import load_json_file
from app.utils.logging import logger

router = APIRouter()

# Singletons initialized for app runtime
graph_service = GraphService()
preference_service = PreferenceService()
itinerary_service = ItineraryService(graph_service=graph_service)

# Dynamic provider resolver
def get_places_provider() -> PlacesProvider:
    if settings.has_google_places_key:
        return GooglePlacesService()
    return MockPlacesService()

recommendation_service = RecommendationService(graph_service=graph_service)


@router.get("/health", response_model=HealthResponse)
async def health_check():
    provider = get_places_provider()
    provider_status = provider.get_status()
    return HealthResponse(
        status="healthy",
        app_name=settings.app_name,
        version=settings.app_version,
        environment=settings.environment,
        provider_status=provider_status,
    )


@router.get("/cities")
async def get_cities():
    """Return supported cities metadata."""
    cities_data = load_json_file("cities.json")
    return cities_data


@router.get("/categories")
async def get_categories():
    """Return category taxonomy."""
    categories_data = load_json_file("categories.json")
    return categories_data


@router.post("/search", response_model=SearchResponse)
async def search_places(request: SearchRequest):
    """
    Search places and score with recommendation engine using conversational preferences.
    Supports dynamic pagination via page_token, typo-tolerant natural language search,
    and precise locality filtering.
    """
    # 1. Retrieve or update preference session
    session = preference_service.get_or_create_session(
        session_id=request.session_id,
        initial_city=request.city or "hyderabad",
    )

    interpreted_criteria = None

    # Parse search query with typo tolerance & intelligent normalization if query given
    if request.query and request.query != "tourist attractions" and request.query != "popular places":
        updates, interpreted_criteria = preference_service.parse_text_query(request.query, current_city=session.city)
        if updates:
            session = preference_service.update_preferences(
                session_id=session.session_id,
                direct_updates=updates,
            )

    # Apply explicit overrides if provided in request
    explicit_updates = {}
    if request.city and request.city.lower() != session.city:
        explicit_updates["city"] = request.city.lower()
    if request.locality is not None:
        explicit_updates["locality"] = request.locality

    if explicit_updates:
        session = preference_service.update_preferences(
            session_id=session.session_id,
            direct_updates=explicit_updates,
        )

    # 2. Search places from provider (runtime discovery)
    provider = get_places_provider()
    search_query = request.query or "popular places"
    target_locality = request.locality or session.locality

    paged_result = await provider.search_places(
        query=search_query,
        city=session.city,
        limit=max(request.limit, 6),
        category=request.category,
        page_token=request.page_token,
        locality=target_locality,
    )

    # If live provider returned empty (or failed), fallback to mock dataset for resilience
    if not paged_result.places and isinstance(provider, GooglePlacesService):
        logger.warning("Live provider returned no results. Falling back to local dataset for resilience.")
        fallback = MockPlacesService()
        paged_result = await fallback.search_places(
            query=search_query,
            city=session.city,
            limit=request.limit,
            category=request.category,
            page_token=request.page_token,
            locality=target_locality,
        )

    # 2.5 Ensure authentic photos for every venue (Google Places photos or Wikimedia/Unsplash fallback)
    await image_service.enrich_places_with_photos(paged_result.places, session.city)

    # 3. Score & rank candidates via knowledge graph & preference constraints
    scored_results = recommendation_service.rank_and_explain(
        candidates=paged_result.places,
        preferences=session,
    )

    # 4. Check locality coverage
    locality_expansion_suggested = False
    if target_locality:
        loc_lower = target_locality.lower()
        exact_loc_count = sum(
            1 for r in scored_results
            if (r.place.locality and loc_lower in r.place.locality.lower())
            or (r.place.formatted_address and loc_lower in r.place.formatted_address.lower())
        )
        if exact_loc_count < 2:
            locality_expansion_suggested = True

    return SearchResponse(
        session_id=session.session_id,
        preferences=session,
        results=scored_results,
        total_found=len(scored_results),
        next_page_token=paged_result.next_page_token,
        interpreted_criteria=interpreted_criteria,
        locality_expansion_suggested=locality_expansion_suggested,
        provider_status=provider.get_status(),
    )


@router.get("/places/photo")
async def get_place_photo(
    name: str = Query(..., description="Google Places photo name identifier"),
    max_width: int = Query(default=800, ge=100, le=1600),
    max_height: int = Query(default=600, ge=100, le=1600),
):
    """
    Server-side photo proxy. Keeps GOOGLE_MAPS_API_KEY secure on the server.
    Streams image bytes directly with caching headers.
    """
    if settings.has_google_places_key:
        service = GooglePlacesService()
        media = await service.get_photo_media(photo_name=name, max_width=max_width, max_height=max_height)
        if media:
            img_bytes, content_type = media
            return Response(
                content=img_bytes,
                media_type=content_type,
                headers={"Cache-Control": "public, max-age=86400, s-maxage=86400"},
            )

    # Fallback SVG placeholder if photo cannot be fetched
    svg = f"""<svg width="{max_width}" height="{max_height}" xmlns="http://www.w3.org/2000/svg">
        <rect width="100%" height="100%" fill="#1e293b"/>
        <text x="50%" y="50%" fill="#94a3b8" font-family="sans-serif" font-size="20" text-anchor="middle" dy=".3em">
            WanderGraph Place Photo
        </text>
    </svg>"""
    return Response(
        content=svg,
        media_type="image/svg+xml",
        headers={"Cache-Control": "public, max-age=3600"},
    )


@router.get("/places/photo-lookup")
async def lookup_place_photos(
    response: Response,
    name: str = Query(..., min_length=2, max_length=160, description="Place name"),
    city: str = Query(..., min_length=2, max_length=40),
    lat: Optional[float] = Query(default=None, ge=-90, le=90),
    lng: Optional[float] = Query(default=None, ge=-180, le=180),
):
    """
    Google photos for a place found by name (and position), so curated places can show
    real photos of themselves. Photos are served through /places/photo, keeping the key secret.
    """
    if not settings.has_google_places_key:
        response.headers["Cache-Control"] = "public, max-age=600"
        return {"photos": [], "source": None, "reason": "no_api_key"}
    photos, reason = await GooglePlacesService().find_place_photos(name=name, city=city.lower(), lat=lat, lng=lng)
    # found photos are stable for a day; misses are retried sooner
    response.headers["Cache-Control"] = "public, max-age=3600, s-maxage=86400" if photos else "public, max-age=600, s-maxage=1800"
    return {"photos": [p.model_dump() if hasattr(p, "model_dump") else p.dict() for p in photos], "source": "google" if photos else None, "reason": reason}


@router.post("/preferences/update")
async def update_preferences(req: PreferenceUpdateRequest):
    """
    Partially update session preferences using natural language query or direct overrides.
    Compatible constraints are preserved.
    """
    updated = preference_service.update_preferences(
        session_id=req.session_id,
        user_message=req.user_message,
        direct_updates=req.direct_updates,
    )
    return {
        "session_id": req.session_id,
        "preferences": updated,
        "interpreted_criteria": updated.interpreted_criteria,
    }


@router.get("/preferences/{session_id}")
async def get_preferences(session_id: str):
    """Retrieve active session preferences."""
    session = preference_service.get_or_create_session(session_id)
    return {"session_id": session_id, "preferences": session}


@router.delete("/preferences/{session_id}")
async def reset_preferences(session_id: str):
    """Reset session preferences to clean state."""
    reset_state = preference_service.reset_session(session_id)
    return {"session_id": session_id, "preferences": reset_state, "message": "Preferences reset successfully"}


@router.delete("/preferences/{session_id}/field/{field_name}")
async def remove_preference_field(session_id: str, field_name: str):
    """Remove a specific preference constraint chip."""
    updated = preference_service.remove_field(session_id, field_name)
    return {"session_id": session_id, "preferences": updated}


@router.get("/graph", response_model=GraphResponse)
async def get_graph(city: Optional[str] = Query(default=None)):
    """
    Retrieve knowledge graph elements formatted for Cytoscape.js.
    """
    city_to_fetch = city or "hyderabad"
    subgraph = graph_service.get_subgraph_for_city(city_to_fetch, max_places=15)
    stats = graph_service.get_stats()
    return GraphResponse(
        nodes=subgraph["nodes"],
        edges=subgraph["edges"],
        stats=stats,
    )


@router.get("/graph/node/{node_id:path}")
async def get_node_neighborhood(node_id: str, depth: int = Query(default=1, ge=1, le=2)):
    """Retrieve neighborhood subgraph around a specific node."""
    subgraph = graph_service.get_neighborhood_subgraph(node_id=node_id, depth=depth)
    return subgraph


@router.get("/places/{place_id}")
async def get_place_details(place_id: str):
    """Fetch place details with attributes and provenance."""
    provider = get_places_provider()
    details = await provider.get_place_details(place_id)
    if not details:
        fallback = MockPlacesService()
        details = await fallback.get_place_details(place_id)

    if not details:
        raise HTTPException(status_code=404, detail=f"Place not found: {place_id}")

    graph_attrs = graph_service.get_place_attributes(place_id)
    return {
        "place": details,
        "graph_connections": graph_attrs,
    }


# ==========================================
# ITINERARY CHATBOT ENDPOINTS
# ==========================================

@router.post("/itinerary/message", response_model=ItineraryResponse)
async def create_or_refine_itinerary(req: ItineraryMessageRequest):
    """
    Conversational AI itinerary assistant.
    Generates realistic, sequenced daily plans grounded with real retrieved places.
    """
    provider = get_places_provider()
    session = preference_service.get_or_create_session(req.session_id, initial_city=req.city or "hyderabad")
    target_city = req.city or session.city

    itinerary = await itinerary_service.generate_itinerary(
        session_id=req.session_id,
        user_message=req.message,
        city=target_city,
        places_provider=provider,
    )
    return itinerary


@router.post("/itinerary/replace-stop", response_model=ItineraryResponse)
async def replace_itinerary_stop(req: ReplaceStopRequest):
    """
    Replace an itinerary stop with an alternative candidate.
    """
    try:
        updated = await itinerary_service.replace_stop(
            session_id=req.session_id,
            stop_index=req.stop_index,
            replacement_place_id=req.replacement_place_id,
            preference_note=req.preference_note,
        )
        return updated
    except (ValueError, IndexError) as err:
        raise HTTPException(status_code=400, detail=str(err))


@router.delete("/itinerary/{session_id}")
async def reset_itinerary_session(session_id: str):
    """Reset itinerary conversation session."""
    itinerary_service.reset_session(session_id)
    return {"message": "Itinerary session reset successfully", "session_id": session_id}
