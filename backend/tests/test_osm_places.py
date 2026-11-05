"""OpenStreetMap provider, tested with responses shaped like the real Overpass, Photon and Geoapify APIs."""
import asyncio

import httpx
import pytest
from fastapi.testclient import TestClient

from app.services import osm_places
from app.services.osm_places import OpenStreetMapPlacesService, build_overpass_query, plan_query

OVERPASS = {
    "elements": [
        {
            "type": "way",
            "id": 123,
            "center": {"lat": 17.3616, "lon": 78.4747},
            "tags": {
                "name": "Charminar",
                "historic": "monument",
                "tourism": "attraction",
                "wikidata": "Q216546",
                "wikipedia": "en:Charminar",
                "wikimedia_commons": "File:Charminar Hyderabad.jpg",
                "opening_hours": "Mo-Su 09:30-17:30",
            },
        },
        {"type": "node", "id": 9, "lat": 17.3605, "lon": 78.4735, "tags": {"name": "Some Tomb", "historic": "tomb"}},
        # nameless things are skipped
        {"type": "node", "id": 10, "lat": 17.36, "lon": 78.47, "tags": {"historic": "memorial"}},
    ]
}
PHOTON_UPPAL = {"features": [{"geometry": {"coordinates": [78.5591, 17.4058]}, "properties": {"name": "Uppal"}}]}
OVERPASS_PARKS_UPPAL = {
    "elements": [
        {"type": "way", "id": 1, "center": {"lat": 17.4049, "lon": 78.5582}, "tags": {"name": "Uppal Bagayath Park", "leisure": "park"}},
        {"type": "way", "id": 2, "center": {"lat": 17.4300, "lon": 78.5900}, "tags": {"name": "Far Park", "leisure": "park", "addr:suburb": "Boduppal"}},
    ]
}


@pytest.fixture(autouse=True)
def clear_caches():
    osm_places._CACHE.clear()
    osm_places._GEO_CACHE.clear()


def fake_http(monkeypatch, on_post=None, on_get=None, calls=None):
    async def post(self, url, data=None, json=None, headers=None):
        if calls is not None:
            calls.append(("POST", url, data))
        return httpx.Response(200, json=on_post(url, data) if on_post else {}, request=httpx.Request("POST", url))

    async def get(self, url, params=None, headers=None):
        if calls is not None:
            calls.append(("GET", url, params))
        return httpx.Response(200, json=on_get(url, params) if on_get else {}, request=httpx.Request("GET", url))

    monkeypatch.setattr(httpx.AsyncClient, "post", post)
    monkeypatch.setattr(httpx.AsyncClient, "get", get)


def test_plan_query_maps_words_to_kinds_of_place():
    rules, names = plan_query("peaceful parks in uppal with my family", None, "hyderabad", "Uppal")
    assert [r["key"] for r in rules] == ["nature"]
    assert names == []  # mood, company and the area are not name words
    rules, names = plan_query("charminar", None, "hyderabad", None)
    assert rules == [] and names == ["charminar"]


def test_overpass_query_is_well_formed():
    rules, names = plan_query("temples", None, "kyoto", None)
    q = build_overpass_query(rules, names, 35.01, 135.76, 9000)
    assert q.startswith("[out:json]")
    assert 'nwr["amenity"="place_of_worship"]["name"](around:9000,35.010000,135.760000);' in q
    assert q.rstrip().endswith("out center tags 220;")


def test_search_converts_and_ranks(monkeypatch):
    fake_http(monkeypatch, on_post=lambda url, data: OVERPASS)
    svc = OpenStreetMapPlacesService(geoapify_key="")
    page = asyncio.run(svc.search_places("heritage", "hyderabad"))
    assert [p.name for p in page.places] == ["Charminar", "Some Tomb"]
    top = page.places[0]
    assert top.id == "osm:way/123"
    assert top.primary_type == "historical_landmark"
    assert top.opening_hours_text == "Mo-Su 09:30-17:30"
    assert top.provenance["wikipedia"] == "en:Charminar"
    assert top.provenance["source"] == "OpenStreetMap contributors"
    assert top.photos[0].proxy_url.startswith("https://commons.wikimedia.org/wiki/Special:FilePath/Charminar%20Hyderabad.jpg")
    assert top.rating is None and top.currency == "INR"


def test_locality_search_uses_the_area_centre(monkeypatch):
    calls = []
    fake_http(monkeypatch, on_post=lambda url, data: OVERPASS_PARKS_UPPAL, on_get=lambda url, params: PHOTON_UPPAL, calls=calls)
    svc = OpenStreetMapPlacesService(geoapify_key="")
    page = asyncio.run(svc.search_places("peaceful park", "hyderabad", locality="Uppal"))
    query = next(c[2]["data"] for c in calls if c[0] == "POST")
    assert "around:2500,17.405800,78.559100" in query
    by_name = {p.name: p for p in page.places}
    # within 2 km of Uppal's centre counts as Uppal; further out keeps its own area
    assert by_name["Uppal Bagayath Park"].locality == "Uppal"
    assert by_name["Far Park"].locality == "Boduppal"


def test_geocoder_answer_far_outside_the_city_is_ignored(monkeypatch):
    far = {"features": [{"geometry": {"coordinates": [-0.12, 51.5]}, "properties": {}}]}
    fake_http(monkeypatch, on_get=lambda url, params: far if "photon" in url else [])
    svc = OpenStreetMapPlacesService(geoapify_key="")
    assert asyncio.run(svc.locate("Uppal", "hyderabad")) is None


def test_geoapify_is_used_when_a_key_is_set(monkeypatch):
    feature = {
        "properties": {
            "name": "Cafe Niloufer",
            "lat": 17.4,
            "lon": 78.46,
            "formatted": "Red Hills, Hyderabad",
            "suburb": "Red Hills",
            "datasource": {"raw": {"osm_type": "n", "osm_id": 555, "amenity": "cafe", "name": "Cafe Niloufer", "opening_hours": "Mo-Su 05:30-23:00"}},
        }
    }
    calls = []
    fake_http(monkeypatch, on_get=lambda url, params: {"features": [feature]}, calls=calls)
    svc = OpenStreetMapPlacesService(geoapify_key="geo-key-123")
    page = asyncio.run(svc.search_places("cafes", "hyderabad"))
    assert calls[0][1] == "https://api.geoapify.com/v2/places"
    assert "catering.cafe" in calls[0][2]["categories"]
    p = page.places[0]
    assert (p.id, p.primary_type, p.locality, p.opening_hours_text) == ("osm:node/555", "cafe", "Red Hills", "Mo-Su 05:30-23:00")
    assert p.provenance["via"] == "Geoapify"


def test_details_come_from_the_search_cache_or_overpass(monkeypatch):
    fake_http(monkeypatch, on_post=lambda url, data: OVERPASS)
    svc = OpenStreetMapPlacesService(geoapify_key="")
    asyncio.run(svc.search_places("heritage", "hyderabad"))
    d = asyncio.run(svc.get_place_details("osm:way/123"))
    assert d.name == "Charminar" and d.city == "hyderabad"
    osm_places._CACHE.clear()
    d2 = asyncio.run(svc.get_place_details("osm:way/123"))
    assert d2 is not None and d2.name == "Charminar" and d2.city == "hyderabad"


def test_routes_pick_osm_without_a_google_key(monkeypatch):
    from app.api import routes
    from app.config import settings

    monkeypatch.setattr(settings, "places_provider", "auto")
    monkeypatch.setattr(type(settings), "has_google_places_key", property(lambda self: False))
    assert isinstance(routes.get_places_provider(), OpenStreetMapPlacesService)
    assert isinstance(routes.provider_for_id("osm:node/1"), OpenStreetMapPlacesService)


def test_search_endpoint_with_osm(monkeypatch):
    from app.config import settings
    from app.main import app

    monkeypatch.setattr(settings, "places_provider", "osm")
    fake_http(monkeypatch, on_post=lambda url, data: OVERPASS)
    client = TestClient(app)
    res = client.post("/api/search", json={"query": "heritage", "session_id": "osm-t", "city": "hyderabad", "limit": 12})
    assert res.status_code == 200
    names = [r["place"]["name"] for r in res.json()["results"]]
    assert "Charminar" in names
    health = client.get("/api/health").json()
    assert health["provider_status"]["provider_name"] == "OpenStreetMap (free)"


def test_details_endpoint_accepts_osm_ids_with_a_slash(monkeypatch):
    from app.main import app

    fake_http(monkeypatch, on_post=lambda url, data: OVERPASS)
    res = TestClient(app).get("/api/places/osm%3Away%2F123")
    assert res.status_code == 200
    assert res.json()["place"]["name"] == "Charminar"
