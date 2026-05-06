import os
from dotenv import load_dotenv

load_dotenv()

def _cargar_prompt() -> str:
    """Lee prompt.txt si existe; si no, cae al .env como fallback."""
    ruta = os.path.join(os.path.dirname(os.path.abspath(__file__)), "prompt.txt")
    if os.path.exists(ruta):
        with open(ruta, "r", encoding="utf-8") as f:
            return f.read()
    return os.getenv("PROMPT_COMPLETO", "")

class Config:
    DB_USER = os.getenv("DB_USER")
    DB_PASSWORD = os.getenv("DB_PASSWORD")
    DB_SERVER = os.getenv("DB_SERVER")
    DB_DATABASE = os.getenv("DB_DATABASE")
    GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")
    GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

    PROMPT_COMPLETO = _cargar_prompt()

    GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.0-flash")
    GEMINI_TEMPERATURE = float(os.getenv("GEMINI_TEMPERATURE", "0.1"))

    # URLs de APIs de Google
    GOOGLE_MAPS_URL = os.getenv("GOOGLE_MAPS_URL", "https://maps.googleapis.com/maps/api/place/nearbysearch/json")
    GOOGLE_GEOCODING_URL = os.getenv("GOOGLE_GEOCODING_URL", "https://maps.googleapis.com/maps/api/geocode/json")
    GOOGLE_STREET_VIEW_URL = os.getenv("GOOGLE_STREET_VIEW_URL", "https://maps.googleapis.com/maps/api/streetview")
    GEMINI_BASE_URL = os.getenv("GEMINI_BASE_URL", "https://generativelanguage.googleapis.com/v1/models/")
