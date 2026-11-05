import asyncio

import httpx
from fastapi.testclient import TestClient

from app.main import app
from app.services.google_places import GooglePlacesService

client = TestClient(app)


def test_lookup_without_key_returns_empty_with_reason(monkeypatch):
    from app.config import settings

    monkeypatch.setattr(type(settings), "has_google_places_key", property(lambda self: False))
    res = client.get("/api/places/photo-lookup", params={"name": "Charminar", "city": "hyderabad"})
    assert res.status_code == 200
    assert res.json() == {"photos": [], "source": None, "reason": "no_api_key"}


def test_names_match():
    m = GooglePlacesService._names_match
    assert m("Charminar", "Charminar")
    assert m("Paradise Biryani (Original)", "Paradise Biryani")
    assert m("Cafe Niloufer Himayatnagar", "Niloufer Cafe")
    assert not m("Bawarchi Restaurant", "Shah Ghouse Restaurant")
    assert m("Tokyo Tower", "Tokyo Tower")


def _fake_post(payload):
    async def post(self, url, headers=None, json=None):
        return httpx.Response(200, json=payload, request=httpx.Request("POST", url))

    return post


def test_find_place_photos_picks_matching_nearby_place(monkeypatch):
    places = {
        "places": [
            # same name but in another part of the world
            {"displayName": {"text": "Charminar"}, "location": {"latitude": 51.5, "longitude": -0.1}, "photos": [{"name": "places/far/photos/1"}]},
            {"displayName": {"text": "Charminar"}, "location": {"latitude": 17.3616, "longitude": 78.4747}, "photos": [{"name": "places/abc/photos/2", "authorAttributions": [{"displayName": "Ravi"}]}]},
        ]
    }
    monkeypatch.setattr(httpx.AsyncClient, "post", _fake_post(places))
    svc = GooglePlacesService(api_key="test-key-123")
    photos, reason = asyncio.run(svc.find_place_photos("Charminar", "hyderabad", 17.3616, 78.4747))
    assert reason == "ok"
    assert photos[0].name == "places/abc/photos/2"
    assert photos[0].proxy_url.startswith("/api/places/photo?name=places/abc/photos/2")
    assert photos[0].attributions[0].display_name == "Ravi"


def test_find_place_photos_rejects_other_places(monkeypatch):
    monkeypatch.setattr(httpx.AsyncClient, "post", _fake_post({"places": [{"displayName": {"text": "Hotel Shadab"}, "photos": [{"name": "places/x/photos/1"}]}]}))
    svc = GooglePlacesService(api_key="test-key-123")
    photos, reason = asyncio.run(svc.find_place_photos("Bawarchi Restaurant", "hyderabad"))
    assert photos == [] and reason == "no_google_match"
