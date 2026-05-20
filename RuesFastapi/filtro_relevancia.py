"""
Filtro de relevancia para registros de ferreteras.
Determina si un registro debe ser incluido en la BD basado en campos crticos.
"""

import unicodedata


def _normalizar_nombre_para_busqueda(texto: str) -> str:
    """Normaliza caracteres especiales (ñ, tildes) para búsqueda."""
    if not texto:
        return ""
    # Descomponemos los caracteres acentuados
    nfd = unicodedata.normalize('NFD', texto.lower())
    # Eliminamos los acentos
    sin_acentos = ''.join(c for c in nfd if unicodedata.category(c) != 'Mn')
    return sin_acentos


def _tiene_palabra_construccion(nombre: str) -> bool:
    """Verifica si el nombre contiene palabras relacionadas con construcción."""
    if not nombre:
        return False

    # Palabras clave de construcción (sin acentos para búsqueda)
    palabras_construccion = [
        'cemento',
        'materiales',
        'construccion',
        'ferreteria',
        'ferretería',
        'deposito',
        'depósito',
        'agregados',
        'arena',
        'grava',
        'hormigon',
        'hormigón',
        'ladrillo',
        'bloque',
        'tubos',
        'tuberias',
        'tuberías',
        'varillas',
        'acero',
        'concreto',
        'obra',
        'construcciones',
        'materiales constructivos',
    ]

    nombre_normalizado = _normalizar_nombre_para_busqueda(nombre)

    # Buscar cualquiera de las palabras clave
    for palabra in palabras_construccion:
        if palabra in nombre_normalizado:
            return True

    return False


def es_relevante(rec: dict) -> tuple[bool, str]:
    """
    Valida si un registro es relevante para insertar en la BD.

    Returns:
        (bool, str): (Incluir, Motivo)
        - (True, "") si el registro es vlido
        - (False, "motivo") si debe descartarse
    """

    # 1. Nombre es obligatorio
    nombre = rec.get('NOMBRE')
    if not nombre or (isinstance(nombre, str) and not nombre.strip()):
        return False, "sin_nombre"

    # 2. Coordenadas son obligatorias para negocio de ubicacin
    lat = rec.get('LAT')
    lng = rec.get('LNG')

    if lat is None or lng is None:
        return False, "sin_coordenadas"

    try:
        lat = float(lat)
        lng = float(lng)
        if lat == 0 or lng == 0:
            return False, "coordenadas_nulas"
    except (ValueError, TypeError):
        return False, "coordenadas_invalidas"

    fuente = rec.get('FUENTE', '').upper()

    # REGLA ESPECIAL: ARGOS NUNCA se descarta (es base de datos de confianza de Argos)
    if fuente == 'ARGOS':
        return True, ""

    # 3. Debe tener al menos un telfono de contacto O estar en RUES
    telefono = rec.get('TELEFONO')
    whatsapp = rec.get('WHATSAPP')
    id_rues = rec.get('ID_RUES')

    tiene_telefono = (telefono and str(telefono).strip()) or (whatsapp and str(whatsapp).strip())

    # Para RUES y APIFY: si no tiene teléfono pero tiene palabra construcción, lo permitimos
    tiene_palabra_construccion = _tiene_palabra_construccion(nombre)

    if not tiene_telefono and not id_rues and not tiene_palabra_construccion:
        return False, "sin_telefono_y_sin_rues"

    # 4. Debe vender al menos uno de los materiales o tener datos de RUES
    vende_algo = (
        rec.get('VENDE_CEMENTO') or
        rec.get('VENDE_TUBOS') or
        rec.get('VENDE_VARILLAS') or
        rec.get('VENDE_LADRILLOS') or
        rec.get('VENDE_AGREGADOS')
    )

    # Si tiene palabra de construcción en el nombre, no descartamos por falta de materiales
    if tiene_palabra_construccion:
        return True, ""

    # Si no tiene palabra construcción y no vende nada y no está en RUES, descartamos
    if not vende_algo and not id_rues:
        return False, "sin_materiales_y_sin_rues"

    # Si llegamos aqu, el registro es vlido
    return True, ""
