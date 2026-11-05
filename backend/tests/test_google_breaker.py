"""A refused Google key is skipped for a while, and searches use OpenStreetMap instead."""
import asyncio

import httpx
import pytest

from app.services import google_places
from app.services.google_places import GooglePlacesService, google_blocked, unblock_google


@pytest.fixture(autouse=True)
def reset():
    unblock_google()
    yield
    unblock_google()


def test_quota_error_pauses_google_and_switches_provider(monkeypatch):
    calls = []

    async def post(self, url, headers=None, json=None, data=None):
        calls.append(url)
        return httpx.Response(429, json={"error": {"status": "RESOURCE_EXHAUSTED"}}, request=httpx.Request("POST", url))

    monkeypatch.setattr(httpx.AsyncClient, "post", post)
    svc = GooglePlacesService(api_key="test-key-123")
    page = asyncio.run(svc.search_places("temples", "hyderabad"))
    assert page.places == [] and google_blocked()
    assert len(calls) == 1  # no second Google call (searchNearby) once refused

    # while paused, nothing more is sent to Google
    assert asyncio.run(svc.search_places("cafes", "hyderabad")).places == []
    assert asyncio.run(svc.find_place_photos("Charminar", "hyderabad")) == ([], "google_paused")
    assert asyncio.run(svc.get_place_details("gplaces:abc")) is None and svc.last_error == 429
    assert len(calls) == 1

    from app.api import routes
    from app.config import settings
    from app.services.osm_places import OpenStreetMapPlacesService

    monkeypatch.setattr(settings, "places_provider", "auto")
    monkeypatch.setattr(type(settings), "has_google_places_key", property(lambda self: True))
    assert isinstance(routes.get_places_provider(), OpenStreetMapPlacesService)


def test_pause_ends(monkeypatch):
    google_places.block_google(429, seconds=-1)
    assert not google_blocked()
