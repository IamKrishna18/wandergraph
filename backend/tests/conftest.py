import os

# Tests run against the curated dataset; live providers are tested with recorded responses.
os.environ.setdefault("PLACES_PROVIDER", "curated")
