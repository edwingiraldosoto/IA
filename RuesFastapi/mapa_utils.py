"""
Utilidades para el mapa de calor de ferreteras.
Extrae marcas de cemento de MATERIALES_OBSERVADOS y clasifica
cada negocio segn su relacin comercial con Cementos Argos.
"""
import re
from typing import Optional

# ---------------------------------------------------------------------------
# Catlogo de marcas conocidas
# ---------------------------------------------------------------------------

# Mapeo alias (lowercase)  nombre cannico
ALIAS_MARCAS_CEMENTO: dict[str, str] = {
    "argos":        "Argos",
    "holcim":       "Holcim",
    "alion":        "ALION",
    "ain":         "ALION",
    "aion":         "ALION",
    "tequendama":   "Tequendama",
    "cemex":        "Cemex",
    "ultra":        "Ultra",
    "colclinker":   "Colclinker",
    "boyac":       "Boyac",
    "boyaca":       "Boyac",
    "andino":       "Andino",
    "diamante":     "Diamante",
    "selvalegre":   "Selvalegre",
    "caribe":       "Caribe",
    "nare":         "Nare",
}

# ---------------------------------------------------------------------------
# Extraccin de marcas
# ---------------------------------------------------------------------------

_PATRON_CEMENTO = re.compile(r'cemento\s*\(([^)]+)\)', re.IGNORECASE)
_ALIAS_LOWER = {a: c for a, c in ALIAS_MARCAS_CEMENTO.items()}


def extraer_marcas_cemento(materiales: Optional[str]) -> list[str]:
    """
    Extrae marcas de cemento del texto de MATERIALES_OBSERVADOS.

    Estrategia 1 (principal): busca el patrn  "cemento (Marca1, Marca2, ...)"
    Estrategia 2 (fallback):  busca cualquier marca conocida como palabra completa.

    Retorna lista ordenada con nombres cannicos, vaca si no hay marcas.
    """
    if not materiales:
        return []

    marcas: set[str] = set()

    # Estrategia 1  patrn "cemento ()"
    for match in _PATRON_CEMENTO.finditer(materiales):
        for parte in match.group(1).split(','):
            token = parte.strip()
            canonical = _ALIAS_LOWER.get(token.lower())
            if canonical:
                marcas.add(canonical)
            elif token:
                # Marca desconocida: la guardamos capitalizada para visibilidad
                marcas.add(token.capitalize())

    # Estrategia 2  escaneo de texto completo por marcas conocidas
    if not marcas:
        for alias, canonical in _ALIAS_LOWER.items():
            if re.search(rf'\b{re.escape(alias)}\b', materiales, re.IGNORECASE):
                marcas.add(canonical)

    return sorted(marcas)


# ---------------------------------------------------------------------------
# Clasificacin para heat map
# ---------------------------------------------------------------------------

CATEGORIAS_MAPA: dict[str, dict] = {
    "CLIENTE_ARGOS": {
        "descripcion": "Vende cemento Argos (marca exclusiva)  cliente a retener",
        "color": "#4CAF50",   # Verde
        "prioridad": 1,
    },
    "CLIENTE_MIXTO": {
        "descripcion": "Vende Argos junto con otras marcas  cliente compartido",
        "color": "#2196F3",   # Azul
        "prioridad": 2,
    },
    "COMPETENCIA": {
        "descripcion": "Vende solo cemento de la competencia  prioridad de conversin",
        "color": "#F44336",   # Rojo
        "prioridad": 3,
    },
    "SIN_MARCA": {
        "descripcion": "Vende cemento sin marca identificada  prospecto calificado",
        "color": "#FF9800",   # Naranja
        "prioridad": 4,
    },
    "PROSPECTO": {
        "descripcion": "No vende cemento  ferretera prospecto",
        "color": "#9E9E9E",   # Gris
        "prioridad": 5,
    },
    "SIN_ANALISIS": {
        "descripcion": "Sin anlisis de IA  datos insuficientes para clasificar",
        "color": "#607D8B",   # Gris azul
        "prioridad": 6,
    },
}


def clasificar_negocio(
    vende_cemento,
    marcas_cemento: list[str],
    materiales: Optional[str],
) -> str:
    """
    Clasifica un negocio en una de las categoras del heat map:

      CLIENTE_ARGOS   vende Argos nicamente
      CLIENTE_MIXTO   vende Argos + otras marcas
      COMPETENCIA     vende cemento pero solo marcas distintas a Argos
      SIN_MARCA       vende cemento, no se detect marca
      PROSPECTO       no vende cemento (ferretera genrica)
      SIN_ANALISIS    sin datos de IA (MATERIALES_OBSERVADOS nulo)
    """
    if materiales is None:
        return "SIN_ANALISIS"

    if not bool(vende_cemento):
        return "PROSPECTO"

    tiene_argos  = "Argos" in marcas_cemento
    otras_marcas = [m for m in marcas_cemento if m != "Argos"]

    if tiene_argos and otras_marcas:
        return "CLIENTE_MIXTO"
    if tiene_argos:
        return "CLIENTE_ARGOS"
    if otras_marcas:
        return "COMPETENCIA"

    return "SIN_MARCA"


# ---------------------------------------------------------------------------
# Helpers SQL para filtrar por categora directamente en BD
# ---------------------------------------------------------------------------

def sql_condicion_categoria(categoria: str) -> tuple[str, list]:
    """
    Convierte una categora de mapa en una condicin SQL + lista de parmetros.
    sala para filtrar ANTES de traer datos (evita pull completo de la tabla).
    """
    tabla = "FerreteriasUnificadas"
    condiciones: dict[str, tuple[str, list]] = {
        "CLIENTE_ARGOS": (
            "VENDE_CEMENTO = 1 AND MATERIALES_OBSERVADOS IS NOT NULL "
            "AND MATERIALES_OBSERVADOS LIKE ? "
            "AND MATERIALES_OBSERVADOS NOT LIKE ?",
            ["%Argos%", "%Holcim%"],   # Argos s, Holcim no (aproximacin)
        ),
        "CLIENTE_MIXTO": (
            "VENDE_CEMENTO = 1 AND MATERIALES_OBSERVADOS LIKE ? "
            "AND (MATERIALES_OBSERVADOS LIKE ? OR MATERIALES_OBSERVADOS LIKE ? "
            "     OR MATERIALES_OBSERVADOS LIKE ? OR MATERIALES_OBSERVADOS LIKE ?)",
            ["%Argos%", "%Holcim%", "%ALION%", "%Cemex%", "%Tequendama%"],
        ),
        "COMPETENCIA": (
            "VENDE_CEMENTO = 1 AND MATERIALES_OBSERVADOS IS NOT NULL "
            "AND MATERIALES_OBSERVADOS NOT LIKE ?",
            ["%Argos%"],
        ),
        "SIN_MARCA": (
            "VENDE_CEMENTO = 1 AND (MATERIALES_OBSERVADOS IS NULL "
            "OR MATERIALES_OBSERVADOS NOT LIKE ?)",
            ["%cemento (%"],
        ),
        "PROSPECTO": (
            "VENDE_CEMENTO = 0",
            [],
        ),
        "SIN_ANALISIS": (
            "MATERIALES_OBSERVADOS IS NULL",
            [],
        ),
    }
    if categoria not in condiciones:
        raise ValueError(f"Categora invlida: {categoria}")
    return condiciones[categoria]
