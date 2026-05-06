from abc import ABC, abstractmethod
from typing import List, Optional, Tuple

class BuscadorLugaresInterface(ABC):

    @abstractmethod
    def geocodificar_direccion(self, direccion: str, municipio: str, departamento: str) -> Tuple[float, float, bool]:
        """Geocodifica una direccin colombiana. Retorna (lat, lng, exacta)."""
        pass

    @abstractmethod
    def buscar_lugar(self, lat: float, lng: float, nombre_negocio: str,
                     email: str = "") -> Optional[dict]:
        """
        Busca el negocio con estrategia de 3 pasos:
        1. Email comercial, 2. Radio 50m filtrando ferreteras, 3. Texto "ferretera"
        """
        pass

    @abstractmethod
    def obtener_detalles_lugar(self, place_id: str) -> dict:
        """Retorna name, formatted_phone_number, photos, website del lugar."""
        pass

    @abstractmethod
    def obtener_fotos_base64(self, lugar: dict, max_fotos: int = 20) -> List[str]:
        """Descarga hasta max_fotos del lugar y las retorna en base64."""
        pass

    @abstractmethod
    def obtener_street_view(self, lat: float, lng: float) -> List[str]:
        """Captura 8 ngulos  2 pasadas (amplia + zoom) de Street View en base64."""
        pass


class AnalizadorImagenesInterface(ABC):

    @abstractmethod
    def analizar_fotos(self, fotos_base64: List[str], nombre_negocio: str) -> dict:
        """Analiza las imgenes con IA y retorna el diccionario de resultados."""
        pass
