import threading
import queue as queue_module
import uuid
import logging
import unicodedata
from database import get_db_connection
from thefuzz import fuzz
from filtro_relevancia import es_relevante
import data_access

logger = logging.getLogger(__name__)

FUZZY_THRESHOLD = 80  # Mnimo de similitud para considerar un emparejamiento

_job_queue: queue_module.Queue = queue_module.Queue()
_worker_lock = threading.Lock()
_worker_thread: threading.Thread | None = None

_CONFIDENCE_ORDER = {'alto': 3, 'medio': 2, 'bajo': 1}


# 
# Helpers de fusin de campos
# 

def _coalesce(*values):
    """Primer valor no nulo y no vaco."""
    for v in values:
        if v is not None and str(v).strip() != '':
            return v
    return None


def _prefer_longer(*values):
    """Cadena ms larga entre los valores no vacos."""
    valid = [v for v in values if v is not None and str(v).strip() != '']
    return max(valid, key=lambda x: len(str(x))) if valid else None


def _prefer_bit_or(*values):
    """True si alguna fuente lo reporta como True."""
    return any(bool(v) for v in values if v is not None)


def _prefer_higher_score(*values):
    """Mximo numrico."""
    valid = [v for v in values if v is not None]
    return max(valid) if valid else 0


def _prefer_higher_confidence(*values):
    """Nivel de confianza ms alto: alto > medio > bajo."""
    valid = [v for v in values if v and str(v).lower() in _CONFIDENCE_ORDER]
    if not valid:
        return _coalesce(*values)
    return max(valid, key=lambda x: _CONFIDENCE_ORDER.get(str(x).lower(), 0))


def _prefer_most_recent(*values):
    valid = [v for v in values if v is not None]
    return max(valid) if valid else None


# 
# Limpieza de telfonos
# 

def limpiar_telefono(valor: str) -> str | None:
    """
    Retorna el telfono limpio o None si es invlido.

    Se descarta si:
      - Contiene letras  (ej: "56A97", "N/A")
      - Tiene menos de 7 dgitos despus de quitar +, espacios y guiones
        (ej: "42407"  5 dgitos  None)

    Se conserva tal cual si pasa la validacin, para no perder
    el formato original (+57, espacios, etc.).
    """
    if not valor or str(valor).strip() == '':
        return None

    v = str(valor).strip()

    # Rechazar si contiene alguna letra
    if any(c.isalpha() for c in v):
        return None

    # Contar solo dgitos (ignorar +, espacios, guiones, parntesis)
    solo_digitos = ''.join(c for c in v if c.isdigit())

    # Mnimo 7 dgitos para ser un nmero de telfono vlido
    if len(solo_digitos) < 7:
        return None

    return v


# 
# Limpieza de municipio
# 

def _sin_tildes(s: str) -> str:
    return ''.join(c for c in unicodedata.normalize('NFD', s) if unicodedata.category(c) != 'Mn')


def _ciudad_desde_direccion(direccion: str) -> str | None:
    """
    Extrae el municipio desde una direccin completa de Google Maps Colombia.
    Formato tpico: "Calle X, Barrio, Ciudad, Departamento, Colombia"
    El municipio es el ltimo elemento antes del departamento.
    """
    if not direccion:
        return None
    partes = [p.strip() for p in direccion.split(',') if p.strip()]
    # Necesitamos al menos: algo, ciudad, depto, Colombia
    if len(partes) < 3:
        return None
    if partes[-1].upper() != 'COLOMBIA':
        return None

    # partes[-2] = Departamento, partes[-3] = Ciudad (o posible duplicado)
    ciudad = partes[-3]

    # Si partes[-3] y partes[-4] son fuzzy-similares (duplicado con/sin tilde),
    # preferir el que tenga tildes (ms caracteres no-ASCII)
    if len(partes) >= 4:
        anterior = partes[-4]
        if fuzz.ratio(_sin_tildes(ciudad).upper(), _sin_tildes(anterior).upper()) >= 85:
            # Son el mismo nombre: elegir el que tenga ms letras con tilde
            tildes_ciudad   = sum(1 for c in ciudad   if unicodedata.category(c) == 'Ll' and c != _sin_tildes(c))
            tildes_anterior = sum(1 for c in anterior if unicodedata.category(c) == 'Ll' and c != _sin_tildes(c))
            ciudad = ciudad if tildes_ciudad >= tildes_anterior else anterior

    # Ignorar si parece ser un tramo de direccin (empieza con dgito o es muy corto)
    if ciudad[0].isdigit() or len(ciudad) < 3:
        return None

    return ciudad


def limpiar_municipio(municipio: str, direccion: str = None) -> str:
    """
    Normaliza el campo MUNICIPIO eliminando duplicados y extrayendo
    la ciudad real cuando viene en formato 'Barrio, Ciudad'.

    Casos que maneja:
      - "Itag, Itagi"                "Itag"   (duplicado con/sin tilde)
      - "Eduardo Santos, Barranquilla"   "Barranquilla" (barrio + ciudad)
      - "Vda. El Penasco, Envigado"      "Envigado"  (vereda + municipio)
      - "Itag"                         "Itag"   (ya limpio, sin cambio)
    """
    if not municipio:
        return municipio

    partes = [p.strip() for p in municipio.split(',') if p.strip()]

    if len(partes) == 1:
        return partes[0]

    p0_norm = _sin_tildes(partes[0]).upper()
    p1_norm = _sin_tildes(partes[1]).upper()

    # Caso 1: duplicado con variante de tilde/mayscula  conservar el que tiene tildes
    if fuzz.ratio(p0_norm, p1_norm) >= 85:
        tildes_0 = sum(1 for c in partes[0] if unicodedata.category(c) == 'Ll' and c != _sin_tildes(c))
        tildes_1 = sum(1 for c in partes[1] if unicodedata.category(c) == 'Ll' and c != _sin_tildes(c))
        return partes[0] if tildes_0 >= tildes_1 else partes[1]

    # Caso 2: alguna parte es vereda  retornar la otra
    prefijos_no_ciudad = ('VDA.', 'VEREDA ', 'CORREGIMIENTO ')
    for i, parte in enumerate(partes):
        if any(parte.upper().startswith(p) for p in prefijos_no_ciudad):
            otras = [partes[j] for j in range(len(partes)) if j != i]
            return otras[-1]

    # Caso 3: extraer desde la direccin completa (ms confiable)
    ciudad_dir = _ciudad_desde_direccion(direccion)
    if ciudad_dir:
        return ciudad_dir

    # Caso 4: tomar el ltimo elemento
    # En Colombia Google Maps usa "Barrio, Ciudad" con la ciudad al final
    return partes[-1]


# 
# Normalizacin de nombres para fuzzy matching
# 

_NOISE_WORDS = [
    'FERRETERIA', 'FERRETERA', 'DEPOSITO', 'DEPSITO',
    'ALMACEN', 'ALMACN', 'MATERIALES', 'DISTRIBUCIONES',
    'DISTRIBUIDOR', 'AGROCONSTRUCCION', 'AGROCONSTRUCCIN',
    'FERROCEMENTO', 'DEPOSITO Y FERRETERIA', 'FERRETERIA Y DEPOSITO',
    'S.A.S', 'S.A', 'LTDA', 'E.U',
]


def _normalizar_nombre(nombre: str) -> str:
    if not nombre:
        return ''
    n = nombre.upper().strip()
    for word in _NOISE_WORDS:
        n = n.replace(word, ' ')
    return ' '.join(n.split())  # colapsar espacios mltiples


# 
# Reglas de fusin por registro
# 

def _merge(rues: dict, apify: dict, score_fuzzy: float) -> dict:
    """Une RUES + Apify conservando el mximo de informacin."""
    return {
        'NOMBRE':                    _prefer_longer(rues.get('NOMBRE'), apify.get('NOMBRE')),
        'TELEFONO':                  limpiar_telefono(_coalesce(rues.get('TELEFONO'), apify.get('TELEFONO'))),
        'WHATSAPP':                  limpiar_telefono(_coalesce(rues.get('WHATSAPP'), apify.get('WHATSAPP'))),
        # NIT: RUES es la fuente oficial (nmero de identificacin registrado)
        'NIT':                       _coalesce(rues.get('NUMERO_IDENTIFICACION_RUES'), rues.get('NIT'), apify.get('NIT')),
        # Coordenadas: Apify (Google Maps) es ms preciso
        'LAT':                       _coalesce(apify.get('LAT'), rues.get('LAT')),
        'LNG':                       _coalesce(apify.get('LNG'), rues.get('LNG')),
        # Campos exclusivos Apify
        'URL_GOOGLE':                apify.get('URL_GOOGLE'),
        'URLS_IMAGENES':             apify.get('URLS_IMAGENES'),
        'FACEBOOK':                  _coalesce(apify.get('FACEBOOK'), rues.get('FACEBOOK')),
        'INSTAGRAM':                 _coalesce(apify.get('INSTAGRAM'), rues.get('INSTAGRAM')),
        'SITIO_WEB':                 apify.get('SITIO_WEB'),
        # Productos: OR lgico (si cualquier fuente lo detect, es verdadero)
        'VENDE_CEMENTO':             _prefer_bit_or(rues.get('VENDE_CEMENTO'), apify.get('VENDE_CEMENTO')),
        'VENDE_TUBOS':               _prefer_bit_or(rues.get('VENDE_TUBOS'), apify.get('VENDE_TUBOS')),
        'VENDE_VARILLAS':            _prefer_bit_or(rues.get('VENDE_VARILLAS'), apify.get('VENDE_VARILLAS')),
        'VENDE_LADRILLOS':           _prefer_bit_or(rues.get('VENDE_LADRILLOS'), apify.get('VENDE_LADRILLOS')),
        'VENDE_AGREGADOS':           _prefer_bit_or(rues.get('VENDE_AGREGADOS'), apify.get('VENDE_AGREGADOS')),
        # Anlisis IA: mejor score, mayor confianza, materiales ms detallados
        'SCORE':                     _prefer_higher_score(rues.get('SCORE'), apify.get('SCORE')),
        'MATERIALES_OBSERVADOS':     _prefer_longer(rues.get('MATERIALES_OBSERVADOS'), apify.get('MATERIALES_OBSERVADOS')),
        'NIVEL_CONFIANZA':           _prefer_higher_confidence(rues.get('NIVEL_CONFIANZA'), apify.get('NIVEL_CONFIANZA')),
        'ULTIMO_ANALISIS':           _prefer_most_recent(rues.get('ULTIMO_ANALISIS'), apify.get('ULTIMO_ANALISIS')),
        # Localizacin: Apify tiene direcciones Google (ms completas); RUES como fallback
        'DEPARTAMENTO':              _coalesce(apify.get('DEPARTAMENTO'), rues.get('DEPARTAMENTO_RUES')),
        'MUNICIPIO':                 limpiar_municipio(
                                         _coalesce(apify.get('MUNICIPIO'), rues.get('MUNICIPIO_RUES')),
                                         _prefer_longer(apify.get('DIRECCION_COMERCIAL'), rues.get('DIRECCION_COMERCIAL_RUES')),
                                     ),
        'DIRECCION_COMERCIAL':       _prefer_longer(apify.get('DIRECCION_COMERCIAL'), rues.get('DIRECCION_COMERCIAL_RUES')),
        'CORREO_COMERCIAL':          _coalesce(rues.get('CORREO_COMERCIAL_RUES'), apify.get('CORREO_COMERCIAL')),
        # Campos exclusivos RUES
        'REP_LEGAL_RUES':            rues.get('REP_LEGAL_RUES'),
        'RAZON_SOCIAL_RUES':         rues.get('RAZON_SOCIAL_RUES'),
        'TIPO_IDENTIFICACION_RUES':  rues.get('TIPO_IDENTIFICACION_RUES'),
        'NUMERO_IDENTIFICACION_RUES':rues.get('NUMERO_IDENTIFICACION_RUES'),
        # Trazabilidad
        'ID_RUES':                   rues.get('ID'),
        'ID_APIFY':                  apify.get('ID'),
        'FUENTE':                    'AMBAS',
        'SCORE_FUZZY':               float(score_fuzzy),
    }


def _from_rues(rues: dict) -> dict:
    return {
        'NOMBRE': rues.get('NOMBRE'),
        'TELEFONO': limpiar_telefono(rues.get('TELEFONO')),
        'WHATSAPP': limpiar_telefono(rues.get('WHATSAPP')),
        'NIT': _coalesce(rues.get('NUMERO_IDENTIFICACION_RUES'), rues.get('NIT')),
        'LAT': rues.get('LAT'), 'LNG': rues.get('LNG'),
        'URL_GOOGLE': None, 'URLS_IMAGENES': None,
        'FACEBOOK': rues.get('FACEBOOK'),
        'INSTAGRAM': rues.get('INSTAGRAM'),
        'SITIO_WEB': None,
        'VENDE_CEMENTO': bool(rues.get('VENDE_CEMENTO')),
        'VENDE_TUBOS': bool(rues.get('VENDE_TUBOS')),
        'VENDE_VARILLAS': bool(rues.get('VENDE_VARILLAS')),
        'VENDE_LADRILLOS': bool(rues.get('VENDE_LADRILLOS')),
        'VENDE_AGREGADOS': bool(rues.get('VENDE_AGREGADOS')),
        'SCORE': rues.get('SCORE', 0),
        'MATERIALES_OBSERVADOS': rues.get('MATERIALES_OBSERVADOS'),
        'NIVEL_CONFIANZA': rues.get('NIVEL_CONFIANZA'),
        'ULTIMO_ANALISIS': rues.get('ULTIMO_ANALISIS'),
        'DEPARTAMENTO': rues.get('DEPARTAMENTO_RUES'),
        'MUNICIPIO': rues.get('MUNICIPIO_RUES'),
        'DIRECCION_COMERCIAL': rues.get('DIRECCION_COMERCIAL_RUES'),
        'CORREO_COMERCIAL': rues.get('CORREO_COMERCIAL_RUES'),
        'REP_LEGAL_RUES': rues.get('REP_LEGAL_RUES'),
        'RAZON_SOCIAL_RUES': rues.get('RAZON_SOCIAL_RUES'),
        'TIPO_IDENTIFICACION_RUES': rues.get('TIPO_IDENTIFICACION_RUES'),
        'NUMERO_IDENTIFICACION_RUES': rues.get('NUMERO_IDENTIFICACION_RUES'),
        'ID_RUES': rues.get('ID'), 'ID_APIFY': None, 'FUENTE': 'RUES', 'SCORE_FUZZY': None,
    }


def _from_apify(apify: dict) -> dict:
    return {
        'NOMBRE': apify.get('NOMBRE'),
        'TELEFONO': limpiar_telefono(apify.get('TELEFONO')),
        'WHATSAPP': limpiar_telefono(apify.get('WHATSAPP')),
        'NIT': apify.get('NIT'),
        'LAT': apify.get('LAT'), 'LNG': apify.get('LNG'),
        'URL_GOOGLE': apify.get('URL_GOOGLE'), 'URLS_IMAGENES': apify.get('URLS_IMAGENES'),
        'FACEBOOK': apify.get('FACEBOOK'), 'INSTAGRAM': apify.get('INSTAGRAM'),
        'SITIO_WEB': apify.get('SITIO_WEB'),
        'VENDE_CEMENTO': bool(apify.get('VENDE_CEMENTO')),
        'VENDE_TUBOS': bool(apify.get('VENDE_TUBOS')),
        'VENDE_VARILLAS': bool(apify.get('VENDE_VARILLAS')),
        'VENDE_LADRILLOS': bool(apify.get('VENDE_LADRILLOS')),
        'VENDE_AGREGADOS': bool(apify.get('VENDE_AGREGADOS')),
        'SCORE': apify.get('SCORE', 0),
        'MATERIALES_OBSERVADOS': apify.get('MATERIALES_OBSERVADOS'),
        'NIVEL_CONFIANZA': apify.get('NIVEL_CONFIANZA'),
        'ULTIMO_ANALISIS': apify.get('ULTIMO_ANALISIS'),
        'DEPARTAMENTO': apify.get('DEPARTAMENTO'),
        'MUNICIPIO': limpiar_municipio(apify.get('MUNICIPIO'), apify.get('DIRECCION_COMERCIAL')),
        'DIRECCION_COMERCIAL': apify.get('DIRECCION_COMERCIAL'),
        'CORREO_COMERCIAL': apify.get('CORREO_COMERCIAL'),
        'REP_LEGAL_RUES': None, 'RAZON_SOCIAL_RUES': None,
        'TIPO_IDENTIFICACION_RUES': None, 'NUMERO_IDENTIFICACION_RUES': None,
        'ID_RUES': None, 'ID_APIFY': apify.get('ID'), 'ID_ARGOS': None,
        'CODIGO_CLIENTE_ARGOS': None, 'CANAL': None, 'NOMBRE_CUENTA': None, 'NOMBRE_OBRA': None,
        'ES_PUNTO_VENTA_PUBLICO': None,
        'FUENTE': 'APIFY', 'SCORE_FUZZY': None,
    }


def _from_argos(argos: dict) -> dict:
    """Convierte registro de FERRETERIASARGOS a formato unificado."""
    return {
        'NOMBRE': argos.get('NOMBRE'),
        'TELEFONO': limpiar_telefono(argos.get('TELEFONO')),
        'WHATSAPP': limpiar_telefono(argos.get('WHATSAPP')),
        'NIT': argos.get('NIT'),
        'LAT': argos.get('LAT'), 'LNG': argos.get('LNG'),
        'URL_GOOGLE': argos.get('URL_GOOGLE'), 'URLS_IMAGENES': None,
        'FACEBOOK': None, 'INSTAGRAM': None, 'SITIO_WEB': None,
        'VENDE_CEMENTO': bool(argos.get('VENDE_CEMENTO')),
        'VENDE_TUBOS': bool(argos.get('VENDE_TUBOS')),
        'VENDE_VARILLAS': bool(argos.get('VENDE_VARILLAS')),
        'VENDE_LADRILLOS': bool(argos.get('VENDE_LADRILLOS')),
        'VENDE_AGREGADOS': bool(argos.get('VENDE_AGREGADOS')),
        'SCORE': argos.get('SCORE', 0),
        'MATERIALES_OBSERVADOS': argos.get('MATERIALES_OBSERVADOS'),
        'NIVEL_CONFIANZA': argos.get('NIVEL_CONFIANZA'),
        'ULTIMO_ANALISIS': argos.get('ULTIMO_ANALISIS'),
        'DEPARTAMENTO': argos.get('DEPARTAMENTO'),
        'MUNICIPIO': limpiar_municipio(argos.get('MUNICIPIO'), argos.get('DIRECCION')),
        'DIRECCION_COMERCIAL': argos.get('DIRECCION'),
        'CORREO_COMERCIAL': None,
        'REP_LEGAL_RUES': None, 'RAZON_SOCIAL_RUES': None,
        'TIPO_IDENTIFICACION_RUES': None, 'NUMERO_IDENTIFICACION_RUES': None,
        'ID_RUES': None, 'ID_APIFY': None, 'ID_ARGOS': argos.get('ID'),
        'CODIGO_CLIENTE_ARGOS': argos.get('CODIGO_CLIENTE'),
        'CANAL': argos.get('CANAL'),
        'NOMBRE_CUENTA': argos.get('NOMBRE_CUENTA'),
        'NOMBRE_OBRA': argos.get('NOMBRE_OBRA'),
        'ES_PUNTO_VENTA_PUBLICO': bool(argos.get('ES_PUNTO_VENTA_PUBLICO')),
        'FUENTE': 'ARGOS', 'SCORE_FUZZY': None,
    }


#
# Gestin de tablas en BD
# 

def garantizar_tablas():
    """Crea las tablas de control si no existen. Llamar una vez al inicio."""
    conn = get_db_connection()
    if not conn:
        raise RuntimeError("Sin conexin a BD para garantizar tablas")
    cursor = conn.cursor()

    cursor.execute("""
        IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='SyncJobs' AND xtype='U')
        CREATE TABLE [dbo].[SyncJobs](
            [ID]                INT            IDENTITY(1,1) NOT NULL,
            [JOB_ID]            NVARCHAR(50)   NOT NULL,
            [STATUS]            NVARCHAR(20)   NULL DEFAULT ('pendiente'),
            [TOTAL_RUES]        INT            NULL DEFAULT (0),
            [TOTAL_APIFY]       INT            NULL DEFAULT (0),
            [TOTAL_UNIFICADOS]  INT            NULL DEFAULT (0),
            [TOTAL_SOLO_RUES]   INT            NULL DEFAULT (0),
            [TOTAL_SOLO_APIFY]  INT            NULL DEFAULT (0),
            [POSICION_COLA]     INT            NULL DEFAULT (0),
            [FECHA_INICIO]      DATETIME       NULL DEFAULT (GETDATE()),
            [FECHA_FIN]         DATETIME       NULL,
            [MENSAJE]           NVARCHAR(500)  NULL,
            CONSTRAINT [PK_SyncJobs] PRIMARY KEY CLUSTERED ([ID] ASC)
        )
    """)

    cursor.execute("""
        IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='FerreteriasUnificadas' AND xtype='U')
        CREATE TABLE [dbo].[FerreteriasUnificadas](
            [ID]                        INT            IDENTITY(1,1) NOT NULL,
            [NOMBRE]                    NVARCHAR(255)  NULL,
            [TELEFONO]                  NVARCHAR(50)   NULL,
            [WHATSAPP]                  NVARCHAR(50)   NULL,
            [NIT]                       NVARCHAR(50)   NULL,
            [LAT]                       DECIMAL(10,7)  NULL,
            [LNG]                       DECIMAL(10,7)  NULL,
            [URL_GOOGLE]                NVARCHAR(MAX)  NULL,
            [URLS_IMAGENES]             NVARCHAR(MAX)  NULL,
            [FACEBOOK]                  NVARCHAR(255)  NULL,
            [INSTAGRAM]                 NVARCHAR(255)  NULL,
            [SITIO_WEB]                 NVARCHAR(255)  NULL,
            [FECHA_CREACION]            DATETIME       NULL DEFAULT (GETDATE()),
            [FECHA_ACTUALIZACION]       DATETIME       NULL DEFAULT (GETDATE()),
            [VENDE_CEMENTO]             BIT            NULL DEFAULT (0),
            [VENDE_TUBOS]               BIT            NULL DEFAULT (0),
            [VENDE_VARILLAS]            BIT            NULL DEFAULT (0),
            [VENDE_LADRILLOS]           BIT            NULL DEFAULT (0),
            [VENDE_AGREGADOS]           BIT            NULL DEFAULT (0),
            [SCORE]                     INT            NULL DEFAULT (0),
            [MATERIALES_OBSERVADOS]     NVARCHAR(500)  NULL,
            [NIVEL_CONFIANZA]           NVARCHAR(20)   NULL,
            [ULTIMO_ANALISIS]           DATETIME       NULL,
            [DEPARTAMENTO]              NVARCHAR(100)  NULL,
            [MUNICIPIO]                 NVARCHAR(100)  NULL,
            [DIRECCION_COMERCIAL]       NVARCHAR(500)  NULL,
            [CORREO_COMERCIAL]          NVARCHAR(255)  NULL,
            [REP_LEGAL_RUES]            NVARCHAR(255)  NULL,
            [RAZON_SOCIAL_RUES]         NVARCHAR(500)  NULL,
            [TIPO_IDENTIFICACION_RUES]  NVARCHAR(100)  NULL,
            [NUMERO_IDENTIFICACION_RUES]NVARCHAR(50)   NULL,
            [ID_RUES]                   INT            NULL,
            [ID_APIFY]                  INT            NULL,
            [FUENTE]                    NVARCHAR(20)   NULL,
            [SCORE_FUZZY]               DECIMAL(5,2)   NULL,
            CONSTRAINT [PK_FerreteriasUnificadas] PRIMARY KEY CLUSTERED ([ID] ASC)
        )
    """)
    conn.commit()
    conn.close()


# 
# Lgica principal de sincronizacin
# 

_INSERT_SQL = """
    INSERT INTO FerreteriasUnificadas
    (NOMBRE, TELEFONO, WHATSAPP, NIT, LAT, LNG,
     URL_GOOGLE, URLS_IMAGENES, FACEBOOK, INSTAGRAM, SITIO_WEB,
     VENDE_CEMENTO, VENDE_TUBOS, VENDE_VARILLAS, VENDE_LADRILLOS, VENDE_AGREGADOS,
     SCORE, MATERIALES_OBSERVADOS, NIVEL_CONFIANZA, ULTIMO_ANALISIS,
     DEPARTAMENTO, MUNICIPIO, DIRECCION_COMERCIAL, CORREO_COMERCIAL,
     REP_LEGAL_RUES, RAZON_SOCIAL_RUES, TIPO_IDENTIFICACION_RUES, NUMERO_IDENTIFICACION_RUES,
     ID_RUES, ID_APIFY, ID_ARGOS, CODIGO_CLIENTE_ARGOS, CANAL, NOMBRE_CUENTA, NOMBRE_OBRA,
     ES_PUNTO_VENTA_PUBLICO, FUENTE, SCORE_FUZZY)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
"""


def _fetch_dicts(cursor, query: str) -> list[dict]:
    cursor.execute(query)
    cols = [d[0] for d in cursor.description]
    return [dict(zip(cols, row)) for row in cursor.fetchall()]


def _update_job(conn, job_id: str, status: str, **fields):
    # Usar el SP para actualizar el job
    data_access.sync_actualizar_job(job_id, status, **fields)


def _ejecutar_sincronizacion(job_id: str):
    """Carga RUES, Apify y ARGOS, aplica fuzzy matching y escribe FerreteriasUnificadas."""
    conn = get_db_connection()
    if not conn:
        logger.error('[%s] Sin conexin a BD', job_id)
        return

    try:
        _update_job(conn, job_id, 'procesando')
        cursor = conn.cursor()

        rues_rows = _fetch_dicts(cursor, 'SELECT * FROM FERRETERIASRUES')
        apify_rows = _fetch_dicts(cursor, 'SELECT * FROM FerreteriasApify')
        argos_rows = _fetch_dicts(cursor, 'SELECT * FROM FERRETERIASARGOS')

        total_rues = len(rues_rows)
        total_apify = len(apify_rows)
        total_argos = len(argos_rows)
        logger.info('[%s] RUES=%d  Apify=%d  ARGOS=%d', job_id, total_rues, total_apify, total_argos)

        # Vaciar tabla destino antes de repoblarla
        cursor.execute('DELETE FROM FerreteriasUnificadas_Contactos')
        cursor.execute('DELETE FROM FerreteriasUnificadas')
        conn.commit()

        # Pre-calcular nombres normalizados de Apify para comparacin eficiente
        apify_norm = [_normalizar_nombre(r.get('NOMBRE', '')) for r in apify_rows]
        apify_usados: set[int] = set()
        resultados: list[dict] = []

        for rues in rues_rows:
            rues_norm = _normalizar_nombre(rues.get('NOMBRE', ''))
            mejor_score = 0
            mejor_idx = -1

            for i, apify_nombre in enumerate(apify_norm):
                if i in apify_usados:
                    continue
                score = fuzz.token_sort_ratio(rues_norm, apify_nombre)
                if score > mejor_score:
                    mejor_score = score
                    mejor_idx = i

            if mejor_score >= FUZZY_THRESHOLD and mejor_idx >= 0:
                apify_usados.add(mejor_idx)
                logger.debug('[%s] Match "%s" <-> "%s"  score=%d',
                             job_id, rues.get('NOMBRE'), apify_rows[mejor_idx].get('NOMBRE'), mejor_score)
                resultados.append(_merge(rues, apify_rows[mejor_idx], mejor_score))
            else:
                resultados.append(_from_rues(rues))

        # Apify sin pareja  incluir como registros propios
        apify_sin_pareja = []
        for i, apify in enumerate(apify_rows):
            if i not in apify_usados:
                apify_sin_pareja.append(_from_apify(apify))
                resultados.append(apify_sin_pareja[-1])

        # ARGOS - fuzzy matching contra resultados existentes
        argos_usados: set[int] = set()
        resultados_norm = [_normalizar_nombre(r.get('NOMBRE', '')) for r in resultados]

        for argos in argos_rows:
            argos_norm = _normalizar_nombre(argos.get('NOMBRE', ''))
            mejor_score = 0
            mejor_idx = -1

            # Buscar coincidencia con algn registro existente
            for i, res_norm in enumerate(resultados_norm):
                score = fuzz.token_sort_ratio(argos_norm, res_norm)
                if score > mejor_score:
                    mejor_score = score
                    mejor_idx = i

            if mejor_score >= FUZZY_THRESHOLD and mejor_idx >= 0:
                # Fusionar ARGOS con el registro existente
                argos_usados.add(mejor_idx)
                argos_dict = _from_argos(argos)
                resultado_existente = resultados[mejor_idx]

                # Actualizar resultado existente con info de ARGOS
                resultado_existente['ID_ARGOS'] = argos_dict['ID_ARGOS']
                resultado_existente['CODIGO_CLIENTE_ARGOS'] = argos_dict['CODIGO_CLIENTE_ARGOS']
                resultado_existente['CANAL'] = argos_dict['CANAL']
                resultado_existente['NOMBRE_CUENTA'] = argos_dict['NOMBRE_CUENTA']
                resultado_existente['NOMBRE_OBRA'] = argos_dict['NOMBRE_OBRA']
                resultado_existente['ES_PUNTO_VENTA_PUBLICO'] = argos_dict['ES_PUNTO_VENTA_PUBLICO']

                # Actualizar FUENTE si era RUES o APIFY
                if resultado_existente.get('FUENTE') in ['RUES', 'APIFY']:
                    resultado_existente['FUENTE'] = 'AMBAS'

                logger.debug('[%s] Match ARGOS "%s" <-> "%s"  score=%d',
                             job_id, argos.get('NOMBRE'), resultado_existente.get('NOMBRE'), mejor_score)
            else:
                # ARGOS sin pareja - agregar como nuevo
                resultados.append(_from_argos(argos))
                logger.debug('[%s] ARGOS "%s" sin coincidencia (score=%d)',
                             job_id, argos.get('NOMBRE'), mejor_score)

        # Filtro de relevancia + insercin masiva
        insertados   = 0
        descartados  = 0
        for rec in resultados:
            incluir, motivo = es_relevante(rec)
            if not incluir:
                logger.debug(
                    '[%s] DESCARTADO "%s"  %s',
                    job_id, rec.get('NOMBRE', '?'), motivo,
                )
                descartados += 1
                # Registrar en tabla de descartados
                cursor.execute(
                    'INSERT INTO SyncJobs_Descartados (JOB_ID, NOMBRE, FUENTE, MOTIVO) VALUES (?, ?, ?, ?)',
                    (job_id, rec.get('NOMBRE'), rec.get('FUENTE'), motivo)
                )
                continue

            try:
                cursor.execute(_INSERT_SQL, (
                    rec.get('NOMBRE'), rec.get('TELEFONO'), rec.get('WHATSAPP'),
                    rec.get('NIT'), rec.get('LAT'), rec.get('LNG'),
                    rec.get('URL_GOOGLE'), rec.get('URLS_IMAGENES'),
                    rec.get('FACEBOOK'), rec.get('INSTAGRAM'), rec.get('SITIO_WEB'),
                    rec.get('VENDE_CEMENTO', False), rec.get('VENDE_TUBOS', False),
                    rec.get('VENDE_VARILLAS', False), rec.get('VENDE_LADRILLOS', False),
                    rec.get('VENDE_AGREGADOS', False),
                    rec.get('SCORE', 0), rec.get('MATERIALES_OBSERVADOS'),
                    rec.get('NIVEL_CONFIANZA'), rec.get('ULTIMO_ANALISIS'),
                    rec.get('DEPARTAMENTO'), rec.get('MUNICIPIO'),
                    rec.get('DIRECCION_COMERCIAL'), rec.get('CORREO_COMERCIAL'),
                    rec.get('REP_LEGAL_RUES'), rec.get('RAZON_SOCIAL_RUES'),
                    rec.get('TIPO_IDENTIFICACION_RUES'), rec.get('NUMERO_IDENTIFICACION_RUES'),
                    rec.get('ID_RUES'), rec.get('ID_APIFY'), rec.get('ID_ARGOS'),
                    rec.get('CODIGO_CLIENTE_ARGOS'), rec.get('CANAL'), rec.get('NOMBRE_CUENTA'),
                    rec.get('NOMBRE_OBRA'), rec.get('ES_PUNTO_VENTA_PUBLICO'),
                    rec.get('FUENTE'), rec.get('SCORE_FUZZY'),
                ))
                insertados += 1

                # Insertar contactos de ARGOS si existen
                if rec.get('ID_ARGOS'):
                    cursor.execute("""
                        INSERT INTO FerreteriasUnificadas_Contactos
                        (FERRETERIA_UNIFICADA_ID, FERRETERIA_ARGOS_CONTACTO_ID, NOMBRE_COMPLETO, CARGO, GENERO, MOVIL, HABEAS_DATA, CODIGO_CLIENTE_ARGOS)
                        SELECT (SELECT MAX(ID) FROM FerreteriasUnificadas), ID, NOMBRE_COMPLETO, CARGO, GENERO, MOVIL, HABEAS_DATA, CODIGO_CLIENTE
                        FROM FERRETERIASARGOS_CONTACTOS
                        WHERE FERRETERIA_ID = ?
                    """, (rec.get('ID_ARGOS'),))

            except Exception as e:
                logger.error('[%s] Error insertando negocio/contactos: %s', job_id, e)
                import traceback
                traceback.print_exc()

        conn.commit()

        total_ambas  = sum(1 for r in resultados if r.get('FUENTE') == 'AMBAS')
        total_solo_r = sum(1 for r in resultados if r.get('FUENTE') == 'RUES')
        total_solo_a = sum(1 for r in resultados if r.get('FUENTE') == 'APIFY')
        total_argos  = sum(1 for r in resultados if r.get('FUENTE') == 'ARGOS')

        _update_job(
            conn, job_id, 'completado',
            total_rues=total_rues, total_apify=total_apify, total_argos=total_argos,
            total_unificados=insertados,
            total_solo_rues=total_solo_r, total_solo_apify=total_solo_a, total_solo_argos=total_argos,
            mensaje=(
                f'{total_ambas} emparejados RUES+Apify | {total_solo_r} solo RUES | '
                f'{total_solo_a} solo Apify | {total_argos} de ARGOS | {descartados} descartados'
            ),
        )
        logger.info(
            '[%s] Completado. Insertados=%d  Descartados=%d',
            job_id, insertados, descartados,
        )

    except Exception as exc:
        logger.exception('[%s] Error en sincronizacin', job_id)
        try:
            _update_job(conn, job_id, 'error', MENSAJE=str(exc)[:490])
        except Exception:
            pass
    finally:
        conn.close()


# 
# Worker en hilo: procesa trabajos de a uno
# 

def _worker_loop():
    """Hilo daemon que vaca la cola de trabajos secuencialmente."""
    logger.info('Worker de sincronizacin iniciado')
    while True:
        try:
            job_id = _job_queue.get(timeout=120)
        except queue_module.Empty:
            logger.info('Worker inactivo 120s  terminando hilo')
            break
        try:
            _ejecutar_sincronizacion(job_id)
        except Exception:
            logger.exception('Error no controlado en worker para job %s', job_id)
        finally:
            _job_queue.task_done()
    logger.info('Worker de sincronizacin finalizado')


def _asegurar_worker():
    global _worker_thread
    with _worker_lock:
        if _worker_thread is None or not _worker_thread.is_alive():
            _worker_thread = threading.Thread(target=_worker_loop, daemon=True, name='sync-worker')
            _worker_thread.start()


# 
# API pblica del mdulo
# 

def encolar_sincronizacion() -> dict:
    """
    Crea un trabajo de sincronizacin, lo encola y devuelve su estado inicial.
    Si hay otro en curso, este queda en cola hasta que termine el anterior.
    """
    job_id = str(uuid.uuid4())
    posicion = _job_queue.qsize() + 1  # posicin estimada en cola

    # Usar el SP para insertar el job
    data_access.sync_insertar_job(job_id, posicion)

    _job_queue.put(job_id)
    _asegurar_worker()

    return {
        'job_id': job_id,
        'posicion_cola': posicion,
        'estado': 'pendiente',
        'mensaje': 'Trabajo encolado. Consulta el estado en GET /sincronizar/{job_id}',
        'url_estado': f'/sincronizar/{job_id}',
    }


def estado_sincronizacion(job_id: str) -> dict | None:
    """Devuelve el estado de un trabajo de sincronizacin o None si no existe."""
    return data_access.sync_obtener_job(job_id)
