import requests
import json
import time
import re
import base64
import os
from typing import Optional, List, Dict, Tuple
from interfaces import BuscadorLugaresInterface, AnalizadorImagenesInterface
from config import Config
from analisis_unificador import AnalizadorUnificado

# =================================================================
# UTILIDADES COMPARTIDAS
# =================================================================

def extraer_numeros_telefonicos(texto: str) -> list:
    """Extrae números telefónicos del texto (WhatsApp y fijos)."""
    patrones = [
        r'(?:\+57)?3[0-2]\d{8}',  # WhatsApp
        r'(?:\+57)?(?:604|605)\d{7}',  # Indicativo + 7 dígitos
        r'\((?:604|605)\)\s*\d{3}[-\s]?\d{4}',  # (604) 276-2585
        r'\d{3}\s\d{2}\s\d{2}',  # 276 25 85
    ]

    numeros = []
    for patron in patrones:
        matches = re.findall(patron, texto)
        for match in matches:
            num_limpio = re.sub(r'[^\d]', '', match)
            if len(num_limpio) >= 7 and num_limpio not in numeros:
                numeros.append(num_limpio)

    return list(set(numeros))


def buscar_contacto_en_redes(nombre_negocio: str, municipio: str) -> Dict[str, str]:
    """
    Búsqueda de contacto en Google + Instagram.
    Retorna: {"whatsapp": "", "facebook": "", "instagram": ""}
    """
    resultado = {"whatsapp": "", "facebook": "", "instagram": "", "sitio_web": ""}

    try:
        # Búsqueda en Google
        queries = [
            f"{nombre_negocio} {municipio} whatsapp",
            f"{nombre_negocio} {municipio} contacto",
            f"{nombre_negocio} {municipio} teléfono",
        ]

        for query in queries:
            try:
                url = f"https://www.google.com/search?q={query.replace(' ', '+')}"
                headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}

                response = requests.get(url, headers=headers, timeout=10)
                if response.status_code == 200:
                    html = response.text

                    # Extraer números
                    numeros = extraer_numeros_telefonicos(html)
                    for numero in numeros:
                        if numero.startswith('3') and len(numero) == 10 and not resultado["whatsapp"]:
                            resultado["whatsapp"] = numero
                        elif (numero.startswith('604') or numero.startswith('605')) and len(numero) == 10 and not resultado["telefono"]:
                            resultado["telefono"] = numero

                    # Extraer Facebook e Instagram
                    if not resultado["facebook"]:
                        fb_match = re.search(r'facebook\.com/[^\s"<>]+', html)
                        if fb_match:
                            resultado["facebook"] = fb_match.group(0)

                    if not resultado["instagram"]:
                        ig_match = re.search(r'instagram\.com/[^\s"<>]+', html)
                        if ig_match:
                            resultado["instagram"] = ig_match.group(0)

            except Exception as e:
                pass

        # Búsqueda en Instagram directa
        try:
            nombre_limpio = nombre_negocio.replace(" ", "").lower()
            url = f"https://www.instagram.com/{nombre_limpio}/"
            headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}

            response = requests.get(url, headers=headers, timeout=10)
            if response.status_code == 200:
                if not resultado["instagram"]:
                    resultado["instagram"] = f"https://www.instagram.com/{nombre_limpio}"

                # Buscar WhatsApp en bio
                html = response.text
                numeros = extraer_numeros_telefonicos(html)
                for numero in numeros:
                    if numero.startswith('3') and len(numero) == 10 and not resultado["whatsapp"]:
                        resultado["whatsapp"] = numero

        except Exception as e:
            pass

    except Exception as e:
        print(f"   [!] Error en búsqueda de contacto: {e}")

    return resultado

def clasificar_numero_colombiano(numero: str) -> dict:
    """Clasifica un nmero colombiano como whatsapp, fijo o desconocido."""
    if not numero:
        return {"tipo": "ninguno", "limpio": ""}
    limpio = numero.replace(" ", "").replace("-", "").replace("(", "").replace(")", "")
    if len(limpio) == 10 and limpio.startswith("3"):
        return {"tipo": "whatsapp", "limpio": limpio}
    if len(limpio) == 10 and not limpio.startswith("3"):
        return {"tipo": "fijo", "limpio": limpio}
    if 7 <= len(limpio) <= 8:
        return {"tipo": "fijo", "limpio": limpio}
    if len(limpio) > 10:
        ultimos10 = limpio[-10:]
        if ultimos10.startswith("3"):
            return {"tipo": "whatsapp", "limpio": ultimos10}
        return {"tipo": "fijo", "limpio": ultimos10}
    return {"tipo": "desconocido", "limpio": limpio}


def _es_imagen_defectuosa(imagen_b64: str) -> bool:
    """
    Detecta imágenes defectuosas o con solo watermarks de Google.
    Devuelve True si la imagen debería ser descartada (no tiene contenido real).
    """
    import base64
    try:
        imagen_bytes = base64.b64decode(imagen_b64)
        # Filtro 1: Si es muy pequeña (<15KB), probablemente es placeholder
        if len(imagen_bytes) < 15000:
            return True
        # Filtro 2: Si es solo watermarks de Google (muy pocas etiquetas detectables)
        # Una imagen real tendrá más contenido que solo "Google © Google"
        return False
    except:
        return True


def seleccionar_mejores_imagenes(user_photos: List[str], sv_photos: List[str], max_total: int = 32) -> List[str]:
    """
    Selecciona TODAS las fotos de usuario + múltiples ángulos de Street View válidos.
    max_total = 32:
    - Todas las fotos de usuario (máximo 12-15)
    - Street View múltiples ángulos: 0°, 45°, 90°, 135°, 180°, 225°, 270°, 315°
    - Cada ángulo con 2 FOVs (90° contexto y 25° zoom) = hasta 24 imágenes

    Razón: Máxima cobertura para encontrar letreros, números de teléfono, redes sociales.
    """
    # Prioridad OCR: primero zoom de Street View, luego fotos del lugar.
    seleccionadas = []
    user_photos_agregadas = False

    if sv_photos:
        # Filtrar AGRESIVAMENTE imágenes defectuosas de Street View
        sv_validas = [f for f in sv_photos if not _es_imagen_defectuosa(f)]

        if sv_validas:
            # sv_validas: [8 FOV=90 contexto] + [hasta 16 FOV=25 zoom OCR]
            # Priorizar las FOV=25 (zoom OCR) para que Rekognition lea letreros
            mitad = min(8, len(sv_validas) // 2)
            zoom_sv   = sv_validas[mitad:]   # FOV=25 zoom (segundas N imágenes)
            amplia_sv = sv_validas[:mitad]   # FOV=90 contexto (primeras 8)
            seleccionadas.extend(zoom_sv)
            seleccionadas.extend(user_photos[:max(0, max_total - len(seleccionadas))])
            user_photos_agregadas = True
            espacio = max_total - len(seleccionadas)
            if espacio > 0:
                seleccionadas.extend(amplia_sv[:espacio])

            rechazadas = len(sv_photos) - len(sv_validas)
            if rechazadas > 0:
                print(f"    [SV] Rechazadas {rechazadas}/{len(sv_photos)} imágenes (solo watermarks/basura)")
            if sv_validas:
                print(f"    [SV] {len(sv_validas)}/{len(sv_photos)} imágenes Street View válidas para análisis")
        else:
            print(f"    [SV] ⚠️  Street View no capturó imágenes válidas en esta ubicación")

    if not user_photos_agregadas and len(seleccionadas) < max_total:
        seleccionadas.extend(user_photos[:max_total - len(seleccionadas)])

    return seleccionadas[:max_total]


# =================================================================
# 1. IMPLEMENTACIN DE GOOGLE MAPS
# =================================================================
class GoogleMapsService(BuscadorLugaresInterface):
    def __init__(self):
        self.api_key = Config.GOOGLE_API_KEY
        self.url_nearby = Config.GOOGLE_MAPS_URL
        self.url_textsearch = "https://maps.googleapis.com/maps/api/place/textsearch/json"
        self.url_fotos = "https://maps.googleapis.com/maps/api/place/photo"
        self.url_geocode = Config.GOOGLE_GEOCODING_URL
        self.url_details = "https://maps.googleapis.com/maps/api/place/details/json"
        self.url_sv = Config.GOOGLE_STREET_VIEW_URL
        self.url_sv_metadata = "https://maps.googleapis.com/maps/api/streetview/metadata"

    # ------------------------------------------------------------------
    # GEOCODIFICACIN (nuevo  mismo flujo que Node.js)
    # ------------------------------------------------------------------
    def geocodificar_direccion(self, direccion: str, municipio: str, departamento: str) -> Tuple[float, float, bool]:
        """
        Geocodifica la direccin completa. Si el municipio no coincide en el resultado,
        reintenta solo con municipio+departamento.
        Retorna (lat, lng, exacta).
        """
        def _geocode(query: str):
            try:
                r = requests.get(self.url_geocode, params={"address": query, "key": self.api_key}, timeout=10)
                data = r.json()
                if data.get("status") == "OK" and data.get("results"):
                    result = data["results"][0]
                    loc = result["geometry"]["location"]
                    addr = result.get("formatted_address", "")
                    return loc["lat"], loc["lng"], addr
            except Exception as e:
                print(f"   [!] Error geocode: {e}")
            return None, None, ""

        query_completa = f"{direccion}, {municipio}, {departamento}, Colombia"
        print(f"    Geocodificando: \"{query_completa}\"")
        lat, lng, addr_result = _geocode(query_completa)

        if lat and lng:
            exacta = municipio.lower() in addr_result.lower()
            if not exacta:
                print(f"   [!] Municipio no coincide ({addr_result}), reintentando con {municipio}...")
                lat2, lng2, _ = _geocode(f"{municipio}, {departamento}, Colombia")
                if lat2 and lng2:
                    return lat2, lng2, False
            print(f"    {addr_result}")
            return lat, lng, exacta

        print(f"   [!] Geocode fall")
        return 0.0, 0.0, False

    # ------------------------------------------------------------------
    # BSQUEDA DE LUGAR  Estrategia de 3 pasos (igual que Node.js)
    # ------------------------------------------------------------------
    def buscar_lugar(self, lat: float, lng: float, nombre_negocio: str,
                     email: str = "", radio_maximo: int = 20, municipio: str = "", departamento: str = "") -> Optional[dict]:
        """
        Estrategia ORIGINAL (que funcionaba bien):
        0. Buscar QUE HAY en las coordenadas exactas (sin keyword)
        1. Buscar por NOMBRE_NEGOCIO especifico en radio 150m
        2. Si retorna solo direccion, buscar por "ferreterÃ­a" en radio 20m
        3. Si hay email: intentar nombre extraido del email en radio 150m
        4. Fallback final: buscar "ferreterÃ­a" genÃ©rica en radio 100m

        Cada resultado se filtra por distancia real para descartar los que estÃ¡n lejanos.
        """
        # Paso 0: PRIMERO buscar quÃ© hay en las coordenadas exactas (sin keyword)
        if lat and lng:
            print(f"   [*] Buscando en coordenadas exactas (radio 5-10m)...")
            lugar_exacto = self._buscar_en_coordenadas_exactas(lat, lng)
            if lugar_exacto:
                print(f"   [OK] Encontrado en ubicacion exacta: \"{lugar_exacto.get('name')}\"")
                return lugar_exacto

        # Paso 1: PRIMERO buscar por el NOMBRE_NEGOCIO especifico
        if nombre_negocio and nombre_negocio.strip():
            print(f"   [?] Buscando por NOMBRE_NEGOCIO: '{nombre_negocio}' en radio 150m...")
            resultados = self._buscar_por_texto(lat, lng, nombre_negocio, radio=150)
            if resultados:
                # FILTRAR por distancia real (rechazar los que estan a mas de 100m - mas permisivo en paso 1)
                resultados_validos = []
                for r in resultados:
                    try:
                        loc = r.get('geometry', {}).get('location', {})
                        lat_r, lng_r = loc.get('lat'), loc.get('lng')
                        if lat_r and lng_r:
                            dist = self._calcular_distancia(lat, lng, lat_r, lng_r)
                            if dist <= 100:  # Mas permisivo en paso 1
                                resultados_validos.append((r, dist))
                    except:
                        pass

                if resultados_validos:
                    # Ordenar por proximidad (la mas cercana gana)
                    resultados_validos.sort(key=lambda x: x[1])
                    mejor = resultados_validos[0][0]
                    nombre_retornado = mejor.get('name', '')
                    # Si retorna solo direccion (contiene "Cl.", "Cra.", "Cll"), buscar por ferreteria
                    if any(addr_marker in nombre_retornado.upper() for addr_marker in ['CL.', 'CRA.', 'CLL.', 'AV.']):
                        print(f"   [>>] Resultado es direccion, buscando por 'ferreteria' en radio {radio_maximo}m...")
                        resultados_ferreteria = self._buscar_por_texto(lat, lng, "ferreteria", radio=radio_maximo)
                        if resultados_ferreteria:
                            # FILTRAR por distancia (muy estricto en este paso)
                            ferre_validas = []
                            for r in resultados_ferreteria:
                                try:
                                    loc = r.get('geometry', {}).get('location', {})
                                    lat_r, lng_r = loc.get('lat'), loc.get('lng')
                                    if lat_r and lng_r:
                                        dist = self._calcular_distancia(lat, lng, lat_r, lng_r)
                                        if dist <= radio_maximo:
                                            ferre_validas.append((r, dist))
                                except:
                                    pass

                            if ferre_validas:
                                ferre_validas.sort(key=lambda x: x[1])
                                mejor_resultado = ferre_validas[0][0]
                                dist_real = ferre_validas[0][1]
                                print(f"   [OK] Encontrado a {dist_real:.1f}m: \"{mejor_resultado.get('name')}\" (Rating: {mejor_resultado.get('rating', 'N/A')}, Reviews: {mejor_resultado.get('user_ratings_total', 0)})")
                                return self._enriquecer_lugar(mejor_resultado)
                    else:
                        dist_real = resultados_validos[0][1]
                        print(f"   [OK] Encontrado a {dist_real:.1f}m: \"{nombre_retornado}\"")
                        return self._enriquecer_lugar(mejor)

        # Paso 2: Si no encontro, intentar por nombre del email (fallback)
        if email and "@" in email:
            nombre_email = self._extraer_nombre_email(email)
            if nombre_email and len(nombre_email) > 3:
                print(f"   [?] Buscando por nombre de email: \"{nombre_email}\" en radio 150m...")
                resultados = self._buscar_por_texto(lat, lng, nombre_email, radio=150)
                if resultados:
                    # FILTRAR por distancia (rechazar los que estan a mas de 100m)
                    email_validos = []
                    for r in resultados:
                        try:
                            loc = r.get('geometry', {}).get('location', {})
                            lat_r, lng_r = loc.get('lat'), loc.get('lng')
                            if lat_r and lng_r:
                                dist = self._calcular_distancia(lat, lng, lat_r, lng_r)
                                if dist <= 100:
                                    email_validos.append((r, dist))
                        except:
                            pass

                    if email_validos:
                        email_validos.sort(key=lambda x: x[1])
                        mejor = email_validos[0][0]
                        dist_real = email_validos[0][1]
                        print(f"   [OK] Encontrado por email a {dist_real:.1f}m: \"{mejor.get('name')}\"")
                        return self._enriquecer_lugar(mejor)

        # Paso 3: Fallback final - buscar "ferreteria"
        print(f"   [?] Fallback: buscando 'ferreteria' SOLO en radio {radio_maximo}m...")
        resultados = self._buscar_por_texto(lat, lng, "ferreteria", radio=200)  # Busca en 200m pero filtra estricto

        if resultados:
            # FILTRAR por distancia real (SOLO resultados a menos del radio maximo)
            resultados_cercanos = []
            for r in resultados:
                try:
                    loc = r.get('geometry', {}).get('location', {})
                    lat_r, lng_r = loc.get('lat'), loc.get('lng')
                    if lat_r and lng_r:
                        dist = self._calcular_distancia(lat, lng, lat_r, lng_r)
                        if dist <= radio_maximo:  # SOLO los que estan dentro del radio maximo
                            resultados_cercanos.append((r, dist))
                except:
                    pass

            if resultados_cercanos:
                # Ordenar por distancia (la mas cercana gana)
                resultados_cercanos.sort(key=lambda x: x[1])
                mejor_resultado = resultados_cercanos[0][0]
                distancia_real = resultados_cercanos[0][1]
                print(f"   [OK] Encontrada a {distancia_real:.1f}m: \"{mejor_resultado.get('name')}\" (Rating: {mejor_resultado.get('rating', 'N/A')}, Reviews: {mejor_resultado.get('user_ratings_total', 0)})")
                return self._enriquecer_lugar(mejor_resultado)
            else:
                # Informar que hay resultados pero TODOS estan fuera del rango
                if resultados:
                    print(f"   [!] Resultados encontrados pero todos a > {radio_maximo}m. No escalamos la busqueda.")

        # ESTRATEGIA D: Búsqueda alternativa por nombre + ciudad (sin depender de coordenadas exactas)
        if municipio or departamento:
            print(f"   [4] Búsqueda alternativa: nombre + ciudad/municipio...")
            resultados_ciudad = self._buscar_por_nombre_ciudad(nombre_negocio, municipio, departamento)
            if resultados_ciudad:
                # Filtrar por validación (buscar ferreterías o negocios relevantes)
                for r in resultados_ciudad:
                    nombre_resultado = r.get('name', '').upper()
                    # Filtrar por palabras clave relevantes
                    if any(palabra in nombre_resultado for palabra in ['DEPOSITO', 'FERRETERIA', 'CONSTRUCCION', 'MATERIALES', 'HERRAJES']):
                        print(f"   [OK] Encontrado en búsqueda alternativa: \"{r.get('name')}\"")
                        return self._enriquecer_lugar(r)

                # Si no hay coincidencia exacta pero hay resultados, tomar el primero
                if resultados_ciudad:
                    print(f"   [OK] Encontrado (búsqueda alternativa): \"{resultados_ciudad[0].get('name')}\"")
                    return self._enriquecer_lugar(resultados_ciudad[0])

        print(f"   [!] No se encontro negocio para '{nombre_negocio}' en rango de {radio_maximo}m")
        return None

    # ------------------------------------------------------------------
    # DETALLES DEL LUGAR (telfono + referencias de fotos extra)
    # ------------------------------------------------------------------
    def obtener_detalles_lugar(self, place_id: str) -> dict:
        """
        Llama Place Details para obtener telfono, website y ms fotos.
        Retorna: {name, formatted_phone_number, website, photos, ...}
        """
        try:
            r = requests.get(self.url_details, params={
                "place_id": place_id,
                "fields": "name,formatted_phone_number,international_phone_number,website,photos",
                "key": self.api_key
            }, timeout=10)
            if r.status_code == 200:
                detalles = r.json().get("result", {})
                telefono = detalles.get("formatted_phone_number", "") or detalles.get("international_phone_number", "")
                if telefono:
                    print(f"    Telfono de Google Maps: {telefono}")
                return detalles
        except Exception as e:
            print(f"   [!] Error Place Details: {e}")
        return {}

    # ------------------------------------------------------------------
    # FOTOS DEL LUGAR (hasta 20, usando place_id igual que Node.js)
    # ------------------------------------------------------------------
    def obtener_fotos_base64(self, lugar: dict, max_fotos: int = 20) -> List[str]:
        """
        Usa el place_id para llamar Place Details y descargar hasta 20 fotos.
        Si el lugar ya trae 'photos' desde nearbysearch, las usa directamente.
        Guarda las fotos en disco para debugging.
        """
        place_id = lugar.get("place_id")
        fotos_refs = lugar.get("photos", [])

        # Si tenemos place_id, buscar ms fotos va Details
        if place_id and len(fotos_refs) < 3:
            detalles = self.obtener_detalles_lugar(place_id)
            fotos_refs = detalles.get("photos", fotos_refs)

        print(f"    Total fotos disponibles: {len(fotos_refs)}")

        # Crear carpeta para guardar imágenes de Google Maps
        import time
        timestamp = str(int(time.time()))
        nombre_negocio_limpio = "".join(c for c in lugar.get("name", "negocio")[:30] if c.isalnum() or c in " -")
        carpeta_gmaps = f"./google_maps_imagenes/{nombre_negocio_limpio}_{timestamp}"
        os.makedirs(carpeta_gmaps, exist_ok=True)
        print(f"    [GMAPS] Guardando imágenes en: {carpeta_gmaps}")

        fotos_b64 = []
        for i, foto in enumerate(fotos_refs[:max_fotos]):
            try:
                r = requests.get(self.url_fotos, params={
                    "maxwidth": 1600,
                    "photo_reference": foto.get("photo_reference"),
                    "key": self.api_key
                }, timeout=20)
                if r.status_code == 200 and len(r.content) > 5000:
                    foto_b64 = base64.b64encode(r.content).decode("utf-8")
                    fotos_b64.append(foto_b64)
                    # Guardar en disco
                    ruta_archivo = os.path.join(carpeta_gmaps, f"gmaps_foto_{i+1:02d}.jpg")
                    try:
                        with open(ruta_archivo, "wb") as f:
                            f.write(r.content)
                    except Exception as e:
                        print(f"   [!] Error guardando foto {i+1}: {e}")
                    print(f"    Foto {i+1}/{min(len(fotos_refs), max_fotos)} obtenida")
            except Exception as e:
                print(f"   [!] Error descargando foto {i+1}: {e}")
        return fotos_b64

    # ------------------------------------------------------------------
    # STREET VIEW  8 ngulos  2 pasadas (amplia + zoom letrero)
    # ------------------------------------------------------------------
    def obtener_street_view(self, lat: float, lng: float) -> List[str]:
        """
        Street View en 2 pasadas:
        - Pasada 1: 8 ángulos cada 45°,  FOV=90, pitch=5  → contexto general + materiales
        - Pasada 2: 16 ángulos cada 22°, FOV=25, pitch=15 → zoom OCR para leer letreros

        Por qué FOV=25 con 16 ángulos:
        - Cada imagen cubre ±12.5°. Con headings cada 22°, offset máx = 11°.
        - 11° < 12.5° → el letrero siempre queda DENTRO del encuadre, sin zonas muertas.
        - FOV=25 da texto ~1.6x más grande que FOV=40 (más legible para Rekognition OCR).

        Antes (FOV=40 con 8 ángulos a 45°):
        - Offset máx = 22.5°, FOV cubre ±20° → GAPS de 5° donde el letrero desaparece.
        """
        fotos = []

        # Pasada 1: contexto general (8 ángulos, FOV amplio)
        for h in range(0, 360, 45):
            foto = self._capturar_sv(lat, lng, fov=90, heading=h, pitch=5)
            if foto:
                fotos.append(foto)

        # Pasada 2: zoom OCR sin zonas muertas (16 ángulos cada 22°, FOV estrecho)
        # pitch=40 para alcanzar letreros muy altos (montados hasta 3-4m de altura en fachadas)
        for h in range(0, 360, 22):
            foto = self._capturar_sv(lat, lng, fov=25, heading=h, pitch=40)
            if foto:
                fotos.append(foto)

        n_contexto = min(8, len(fotos))
        n_zoom = len(fotos) - n_contexto
        print(f"    Street View: {len(fotos)} imágenes ({n_contexto} FOV=90 contexto + {n_zoom} FOV=25 OCR)")
        return fotos

    def _guardar_imagen_sv(self, imagen_b64: str, carpeta: str, nombre: str):
        """Guarda una imagen en base64 a disco."""
        try:
            imagen_bytes = base64.b64decode(imagen_b64)
            ruta_archivo = os.path.join(carpeta, nombre)
            with open(ruta_archivo, "wb") as f:
                f.write(imagen_bytes)
        except Exception as e:
            print(f"   [!] Error guardando imagen {nombre}: {e}")

    def _buscar_panoramas_cercanos(self, lat: float, lng: float, direccion: str = "", max_panos: int = 5) -> List[dict]:
        """
        Busca panoramas alrededor del negocio. Prioriza dirección exacta si está disponible.
        Google Street View puede escoger el pano del frente equivocado si usamos solo coordenadas.
        """
        panos = []
        vistos = set()

        # Intentar primero con dirección exacta si está disponible
        if direccion:
            try:
                print(f"    [SV] Buscando por dirección: {direccion}")
                r = requests.get(self.url_sv_metadata, params={
                    "location": direccion,
                    "radius": 30,
                    "source": "outdoor",
                    "key": self.api_key
                }, timeout=8)
                if r.status_code == 200:
                    data = r.json()
                    if data.get("status") == "OK":
                        pano_id = data.get("pano_id")
                        if pano_id:
                            loc = data.get("location", {})
                            pano_lat, pano_lng = loc.get("lat"), loc.get("lng")
                            if pano_lat and pano_lng:
                                distancia = self._calcular_distancia(lat, lng, pano_lat, pano_lng)
                                vistos.add(pano_id)
                                panos.append({
                                    "pano_id": pano_id,
                                    "lat": pano_lat,
                                    "lng": pano_lng,
                                    "distancia_m": distancia
                                })
                                print(f"    [SV] Panorama encontrado por dirección (dist={distancia:.1f}m)")
            except Exception as e:
                print(f"    [!] Error buscando por dirección: {e}")

        # Si no encontró por dirección o no hay dirección, buscar por offset de coordenadas
        offsets = [
            (0.0, 0.0),
            (0.00012, 0.0), (-0.00012, 0.0),
            (0.00024, 0.0), (-0.00024, 0.0),
            (0.0, 0.00012), (0.0, -0.00012),
            (0.00012, 0.00012), (0.00012, -0.00012),
            (-0.00012, 0.00012), (-0.00012, -0.00012),
            (0.00036, 0.0), (-0.00036, 0.0),
        ]

        for dlat, dlng in offsets:
            if len(panos) >= max_panos:
                break
            qlat, qlng = lat + dlat, lng + dlng
            try:
                r = requests.get(self.url_sv_metadata, params={
                    "location": f"{qlat},{qlng}",
                    "radius": 45,
                    "source": "outdoor",
                    "key": self.api_key
                }, timeout=8)
                if r.status_code != 200:
                    continue
                data = r.json()
                if data.get("status") != "OK":
                    continue
                pano_id = data.get("pano_id")
                if not pano_id or pano_id in vistos:
                    continue
                loc = data.get("location", {})
                pano_lat, pano_lng = loc.get("lat"), loc.get("lng")
                if pano_lat is None or pano_lng is None:
                    continue
                distancia = self._calcular_distancia(lat, lng, pano_lat, pano_lng)
                if distancia > 60:
                    continue
                vistos.add(pano_id)
                panos.append({
                    "pano_id": pano_id,
                    "lat": pano_lat,
                    "lng": pano_lng,
                    "distancia_m": distancia
                })
            except Exception as e:
                print(f"   [!] Error metadata Street View: {e}")

        panos.sort(key=lambda p: p["distancia_m"])
        return panos[:max_panos]

    def obtener_street_view(self, lat: float, lng: float, nombre_negocio: str = "", direccion: str = "") -> List[str]:
        """
        Captura Street View SOLO de la fachada del negocio objetivo.
        Usa 1-2 panoramas principales con 4-6 ángulos enfocados (NO 360°).
        Guarda las imágenes en disco para debugging.
        Prioriza la dirección exacta si está disponible.
        """
        fotos = []
        panos = self._buscar_panoramas_cercanos(lat, lng, direccion=direccion, max_panos=2)
        if not panos:
            panos = [{"lat": lat, "lng": lng, "pano_id": None, "distancia_m": 0}]

        # Crear carpeta para guardar imágenes
        import time
        timestamp = str(int(time.time()))
        nombre_negocio_limpio = "".join(c for c in (nombre_negocio or "negocio") if c.isalnum() or c in " -")[:30]
        if not nombre_negocio_limpio:
            nombre_negocio_limpio = "negocio"
        carpeta_sv = f"./street_view_imagenes/{nombre_negocio_limpio}_{timestamp}"
        os.makedirs(carpeta_sv, exist_ok=True)
        print(f"    [SV] Guardando imágenes en: {carpeta_sv}")

        # Ángulos ENFOCADOS hacia la fachada (no capturar 360°)
        headings_contexto = [0, 90, 180, 270]      # 4 ángulos principales
        headings_zoom = [0, 45, 90, 135, 180, 225, 270, 315]  # 8 ángulos para OCR

        contador_global = 0
        for idx, pano in enumerate(panos):
            etiqueta = pano.get("pano_id") or f"{pano['lat']:.7f},{pano['lng']:.7f}"
            print(f"    [SV] Pano {idx+1}/{len(panos)} {etiqueta} dist={pano.get('distancia_m', 0):.1f}m")

            # Contexto: 4 ángulos principales, FOV=90, pitch=-5 para ver fachada
            for h in headings_contexto:
                foto = self._capturar_sv(pano["lat"], pano["lng"], fov=90, heading=h, pitch=-5, pano_id=pano.get("pano_id"))
                if foto:
                    fotos.append(foto)
                    contador_global += 1
                    # Guardar en disco
                    self._guardar_imagen_sv(foto, carpeta_sv, f"pano{idx+1}_heading{h:03d}_fov90_{contador_global}.jpg")

            # Zoom OCR: 8 ángulos enfocados en letrero, FOV=25, pitch=5 para leer signos
            for h in headings_zoom:
                foto = self._capturar_sv(pano["lat"], pano["lng"], fov=25, heading=h, pitch=5, pano_id=pano.get("pano_id"))
                if foto:
                    fotos.append(foto)
                    contador_global += 1
                    # Guardar en disco
                    self._guardar_imagen_sv(foto, carpeta_sv, f"pano{idx+1}_heading{h:03d}_fov25_{contador_global}.jpg")

        print(f"    Street View: {len(fotos)} imagenes desde {len(panos)} panoramas")
        print(f"    [SV] Imágenes guardadas en: {carpeta_sv}/")
        return fotos

    # ------------------------------------------------------------------
    # HELPERS INTERNOS
    # ------------------------------------------------------------------
    def _capturar_sv(self, lat: float, lng: float, fov: int, heading: int, pitch: int, pano_id: str = None) -> Optional[str]:
        try:
            # Intentar con fuente outdoor (evita interiores) y return_error_code (rechaza placeholders)
            params = {
                "size": "1200x800",
                "location": f"{lat},{lng}",
                "fov": fov,
                "heading": heading,
                "pitch": pitch,
                "source": "outdoor",
                "return_error_code": "true",
                "key": self.api_key
            }
            if pano_id:
                params.pop("location", None)
                params["pano"] = pano_id

            r = requests.get(self.url_sv, params=params, timeout=15)

            if r.status_code == 200:
                # Detectar "no image available" - watermarks de Google sin contenido real
                if b"Google" in r.content and len(r.content) < 50000:
                    # Probablemente un placeholder, intentar sin source pero con return_error_code
                    params_retry = {
                        "size": "1200x800",
                        "location": f"{lat},{lng}",
                        "fov": fov,
                        "heading": heading,
                        "pitch": pitch,
                        "return_error_code": "true",
                        "key": self.api_key
                    }
                    if pano_id:
                        params_retry.pop("location", None)
                        params_retry["pano"] = pano_id
                    r = requests.get(self.url_sv, params=params_retry, timeout=15)

                # Aceptar si es una imagen real (> 20KB)
                if r.status_code == 200 and len(r.content) > 20000:
                    return base64.b64encode(r.content).decode("utf-8")
        except Exception as e:
            print(f"   [!] Error Street View heading={heading}: {e}")
        return None

    def _buscar_por_texto(self, lat: float, lng: float, texto: str, radio: int = 100) -> List[dict]:
        try:
            r = requests.get(self.url_nearby, params={
                "location": f"{lat},{lng}",
                "radius": radio,
                "keyword": texto,
                "key": self.api_key
            }, timeout=10)
            if r.status_code == 200:
                return r.json().get("results", [])
        except Exception as e:
            print(f"   [!] Error buscarPorTexto: {e}")
        return []

    def _buscar_por_nombre_ciudad(self, nombre: str, municipio: str, departamento: str = "") -> List[dict]:
        """Búsqueda por texto puro (nombre + ciudad) sin depender de coordenadas exactas."""
        try:
            # Construir query: "NOMBRE DEPOSITOS MEDELLIN EL BAGRE SAS El Bagre Antioquia"
            query = f"{nombre} {municipio}"
            if departamento:
                query += f" {departamento}"

            print(f"   [>>] Búsqueda alternativa (sin coordenadas): '{query}'...")
            r = requests.get(self.url_textsearch, params={
                "query": query,
                "key": self.api_key
            }, timeout=10)
            if r.status_code == 200:
                return r.json().get("results", [])
        except Exception as e:
            print(f"   [!] Error búsqueda alternativa: {e}")
        return []

    def _enriquecer_lugar(self, lugar: dict) -> dict:
        """
        Enriquece un resultado de bsqueda con detalles de Google Maps.
        Agrega: telfono, website, y ms fotos.
        """
        if not lugar or not lugar.get('place_id'):
            return lugar

        try:
            detalles = self.obtener_detalles_lugar(lugar.get('place_id'))
            if detalles:
                # Agregar telfono de Google Maps si est disponible
                telefono = detalles.get('formatted_phone_number') or detalles.get('international_phone_number')
                if telefono:
                    lugar['telefono_maps'] = telefono
                if detalles.get('website'):
                    lugar['website'] = detalles.get('website')
                # Agregar fotos adicionales si estn disponibles
                if detalles.get('photos'):
                    lugar['fotos_adicionales'] = detalles.get('photos')
        except Exception as e:
            print(f"   [!] Error enriqueciendo lugar: {e}")

        return lugar

    def _buscar_cercano(self, lat: float, lng: float, radio: int = 50) -> List[dict]:
        try:
            r = requests.get(self.url_nearby, params={
                "location": f"{lat},{lng}",
                "radius": radio,
                "key": self.api_key
            }, timeout=10)
            if r.status_code == 200:
                return r.json().get("results", [])
        except Exception as e:
            print(f"   [!] Error buscarCercano: {e}")
        return []

    def _buscar_en_coordenadas_exactas(self, lat: float, lng: float) -> Optional[dict]:
        """
        Busca negocios en las coordenadas exactas (sin keyword, radio pequeo).
        til para encontrar el negocio especfico en una direccin exacta.
        Retorna el que sea ferretera legtima con ms reviews.
        Filtra resultados que son solo ciudades/municipios.
        """
        try:
            # Buscar sin keyword en radio pequeo
            resultados = self._buscar_cercano(lat, lng, radio=5)
            if not resultados:
                resultados = self._buscar_cercano(lat, lng, radio=10)

            if resultados:
                # Filtrar ferreteries vlidas (excluir ciudades, municipios)
                ferreterias = [r for r in resultados
                              if self._es_ferreteria_real(r.get('name', ''))]

                # Excluir resultados que son solo nombres de ciudades
                nombres_ciudades = ['bagre', 'entrerrios', 'sabaneta', 'zaragoza', 'medellin', 'estrella']
                ferreterias = [r for r in ferreterias
                              if r.get('name', '').lower() not in nombres_ciudades]

                if ferreterias:
                    mejor = max(ferreterias, key=lambda x: x.get('user_ratings_total', 0))
                    return self._enriquecer_lugar(mejor)

                # Si no hay ferretera vlida, devolver la que sea ferretera (aunque sea ciudad)
                if ferreterias:
                    return ferreterias[0]
        except Exception as e:
            print(f"   [!] Error buscarEnCoordenadas: {e}")
        return None

    def _calcular_distancia(self, lat1: float, lng1: float, lat2: float, lng2: float) -> float:
        """Calcula distancia en metros entre dos coordenadas (Haversine)."""
        from math import radians, cos, sin, asin, sqrt
        lon1, lat1, lon2, lat2 = map(radians, [lng1, lat1, lng2, lat2])
        dlon = lon2 - lon1
        dlat = lat2 - lat1
        a = sin(dlat/2)**2 + cos(lat1) * cos(lat2) * sin(dlon/2)**2
        c = 2 * asin(sqrt(a))
        r = 6371 * 1000  # Radio en metros
        return c * r

    def _similitud_nombres(self, nombre1: str, nombre2: str) -> float:
        """Retorna similitud entre 0-1 usando Levenshtein."""
        from difflib import SequenceMatcher
        s1 = nombre1.lower().strip()
        s2 = nombre2.lower().strip()
        return SequenceMatcher(None, s1, s2).ratio()

    def _es_ferreteria_real(self, nombre: str, lat_ref: float = None, lng_ref: float = None,
                           lat_lugar: float = None, lng_lugar: float = None) -> bool:
        """
        Valida si es ferretera REAL:
        1. Verifica palabras clave en el nombre (normalizando acentos)
        2. Si hay coordenadas, valida que est dentro de 1000m
        3. Rechaza resultados muy lejanos
        """
        if not nombre:
            return False

        # Normalizar acentos y convertir a minusculas
        import unicodedata
        n = unicodedata.normalize('NFKD', nombre).encode('ascii', 'ignore').decode('ascii').lower()
        palabras_si = [
            "ferreteria", "ferretera", "materiales", "construccion", "construccin",
            "deposito", "depsito", "cemento", "argos", "varilla", "tubo", "ladrillo",
            "hierro", "acero", "ferre", "constru", "bloquera", "blockera", "agregados",
            "almacen y ferreteria", "deposito de materiales", "concreto"
        ]
        palabras_no = [
            "repuestos", "autos", "carros", "vehiculos", "galeria", "restaurante",
            "peluqueria", "clinica", "farmacia", "supermercado", "taller", "mecanica",
            "constructora", "pizzeria", "heladeria", "papeleria", "libreria",
            "muebles", "motos", "concesionario", "cooperativa", "lecheria", "leche"
        ]
        for p in palabras_no:
            if p in n:
                return False

        # Validacin de palabras positivas
        tiene_palabra_si = False
        for p in palabras_si:
            if p in n:
                tiene_palabra_si = True
                break

        if not tiene_palabra_si:
            return False

        # Si hay coordenadas, validar que est CERCA (mximo 1000m)
        if lat_ref and lng_ref and lat_lugar and lng_lugar:
            distancia = self._calcular_distancia(lat_ref, lng_ref, lat_lugar, lng_lugar)
            if distancia > 1000:  # Ms de 1000m = rechazar
                print(f"   [!] Lugar '{nombre}' a {distancia:.0f}m de distancia (mx 1000m). RECHAZADO.")
                return False
            elif distancia > 500:
                print(f"   [!] Lugar '{nombre}' a {distancia:.0f}m (lejos pero aceptado)")

        return True

    def _es_email_comercial(self, email: str) -> bool:
        if not email or "@" not in email:
            return False
        email_lower = email.lower()
        palabras_comerciales = [
            "ferreteria", "materiales", "construccion", "deposito", "almacen",
            "tienda", "distribuciones", "industrias", "comercial", "servicios",
            "pinturas", "electricos"
        ]
        nombre_email = email_lower.split("@")[0]
        for p in palabras_comerciales:
            if p in nombre_email:
                return True
        dominios_gratuitos = {
            "gmail.com", "hotmail.com", "yahoo.com", "outlook.com",
            "icloud.com", "aol.com", "mail.com", "protonmail.com",
            "live.com", "msn.com"
        }
        dominio = email_lower.split("@")[1]
        if dominio not in dominios_gratuitos:
            print(f"    Dominio corporativo: {dominio}")
            return True
        return False

    def _extraer_nombre_email(self, email: str) -> Optional[str]:
        if not email or "@" not in email:
            return None
        nombre = email.split("@")[0].lower()
        dominio_base = email.split("@")[1].split(".")[0].lower()
        dominios_gratuitos = {"gmail", "hotmail", "yahoo", "outlook", "icloud", "aol", "mail", "live", "msn"}
        if dominio_base not in dominios_gratuitos:
            return dominio_base.capitalize()
        limpio = nombre.replace(".", " ").replace("_", " ").replace("-", " ")
        limpio = "".join(c for c in limpio if not c.isdigit())
        return " ".join(w.capitalize() for w in limpio.split() if w) or None

    def extraer_contactos_del_website(self, website: str) -> dict:
        """
        Extrae WhatsApp e Instagram del website de Google Places.
        Retorna: {"whatsapp": "", "instagram": ""}
        """
        resultado = {"whatsapp": "", "instagram": ""}

        if not website:
            return resultado

        website_lower = website.lower()

        # WhatsApp: buscar wa.me/XXX o números de 10 dígitos empezando con 3
        if "wa.me" in website_lower or "whatsapp" in website_lower:
            # Extraer número después de wa.me/
            import re
            match = re.search(r'wa\.me/([0-9]+)', website_lower)
            if match:
                num = match.group(1)
                # Si es +57XXX, convertir a XXX (10 dígitos)
                if num.startswith('57') and len(num) == 12:
                    num = num[2:]
                if len(num) == 10 and num.startswith('3'):
                    resultado["whatsapp"] = num

        # Instagram: buscar instagram.com/XXX o instagram.com/@XXX
        if "instagram" in website_lower:
            import re
            # Patrón: instagram.com/[handle]
            match = re.search(r'instagram\.com/([a-zA-Z0-9_.]+)', website_lower)
            if match:
                handle = match.group(1).rstrip('/')
                # Filtrar palabras comunes que no son handles
                if handle not in ['p', 'explore', 'reels', 'stories', 'direct', 'accounts']:
                    resultado["instagram"] = handle

        return resultado


# =================================================================
# 2. IMPLEMENTACIN DE GEMINI AI
# =================================================================
class GeminiService(AnalizadorImagenesInterface):
    def __init__(self):
        self.api_key = Config.GEMINI_API_KEY
        self.modelo = Config.GEMINI_MODEL
        self.temperatura = Config.GEMINI_TEMPERATURE
        self.base_url = Config.GEMINI_BASE_URL
        self.url = f"{self.base_url}{self.modelo}:generateContent?key={self.api_key}"
        self.analizador_unificado = AnalizadorUnificado()

    def generar_respuesta_simple(self, prompt: str, timeout: int = 5) -> Optional[str]:
        """
        Genera respuesta rpida de texto (sin imgenes).
        til para clasificaciones simples.
        Retorna None si falla o timeout.
        """
        try:
            payload = {
                "contents": [{"parts": [{"text": prompt}]}],
                "generationConfig": {"temperature": 0.1}  # Baja temperatura para respuestas consistentes
            }
            r = requests.post(self.url, json=payload, timeout=timeout)
            if r.status_code == 200:
                data = r.json()
                if data.get("candidates"):
                    return data["candidates"][0].get("content", {}).get("parts", [{}])[0].get("text", "")
        except Exception as e:
            print(f"   [!] Error generar_respuesta_simple: {e}")
        return None

    def analizar_fotos(self, fotos_base64: List[str], nombre_negocio: str) -> dict:
        prompt_final = Config.PROMPT_COMPLETO.replace("{nombre_negocio}", nombre_negocio)
        prompt_final = prompt_final.replace("{cantidad_imagenes}", str(len(fotos_base64)))

        parts = [{"text": prompt_final}]
        for foto in fotos_base64:
            parts.append({
                "inline_data": {
                    "mime_type": "image/jpeg",
                    "data": foto
                }
            })

        # SIN response_mime_type  igual que Node.js, ms compatible con todos los modelos
        # safetySettings en BLOCK_NONE para que no rechace imgenes de ferreteras
        safety_settings = [
            {"category": "HARM_CATEGORY_HARASSMENT",        "threshold": "BLOCK_NONE"},
            {"category": "HARM_CATEGORY_HATE_SPEECH",       "threshold": "BLOCK_NONE"},
            {"category": "HARM_CATEGORY_SEXUALLY_EXPLICIT", "threshold": "BLOCK_NONE"},
            {"category": "HARM_CATEGORY_DANGEROUS_CONTENT", "threshold": "BLOCK_NONE"},
        ]
        payload = {
            "contents": [{"parts": parts}],
            "safetySettings": safety_settings,
            "generationConfig": {
                "temperature": self.temperatura
            }
        }

        # gemini-2.5-flash primero  el lite falla silenciosamente en visin
        modelos_fallback = [
            # Rpidos (primer intento)
            "gemini-2.5-flash",
            "gemini-2.0-flash",
            "gemini-2.5-flash-lite",
            "gemini-2.0-flash-lite",

            # Balanceados
            "gemini-1.5-flash",
            "gemini-1.5-pro",

            # Potentes (ltimo recurso)
            "gemini-2.5-pro",
            "gemini-2.0-pro",
        ]
        # Si el modelo del .env no est en la lista, se agrega al inicio
        modelo_env = Config.GEMINI_MODEL
        if modelo_env not in modelos_fallback:
            modelos_fallback.insert(0, modelo_env)

        for modelo in modelos_fallback:
            # Siempre usar v1 (no v1beta)  igual que app.js
            url = f"https://generativelanguage.googleapis.com/v1/models/{modelo}:generateContent?key={self.api_key}"
            try:
                print(f"    Intentando con {modelo} ({len(fotos_base64)} imgenes)...")
                respuesta = requests.post(url, json=payload, timeout=120)

                if respuesta.status_code == 404:
                    print(f"   [!] {modelo} no disponible (404): {respuesta.text[:200]}")
                    continue

                if respuesta.status_code == 429:
                    print(f"   [!] Cuota alcanzada en {modelo}. Esperando 15s...")
                    time.sleep(15)
                    respuesta = requests.post(url, json=payload, timeout=120)

                if respuesta.status_code != 200:
                    print(f"   [X] Error {modelo}: HTTP {respuesta.status_code} - {respuesta.text[:300]}")
                    continue

                datos_ia = respuesta.json()

                # Log completo para depuracin
                print(f"    Respuesta raw Gemini: {json.dumps(datos_ia, ensure_ascii=False)[:500]}")

                texto_respuesta = datos_ia["candidates"][0]["content"]["parts"][0]["text"]

                # Limpiar markdown si Gemini lo envuelve (igual que Node.js)
                texto_limpio = texto_respuesta.strip()
                texto_limpio = texto_limpio.replace("```json", "").replace("```", "").strip()
                json_match = re.search(r"\{[\s\S]*\}", texto_limpio)
                if json_match:
                    texto_limpio = json_match.group(0)

                resultado = json.loads(texto_limpio)
                print(f"   [OK] {modelo} respondi: {json.dumps(resultado, ensure_ascii=False)}")

                # PASO 2: Unificar con Rekognition
                print(f"    Iniciando análisis unificado (Gemini + Rekognition)...")
                resultado_unificado = self.analizador_unificado.analizar_con_unificacion(
                    fotos_base64,
                    nombre_negocio,
                    resultado
                )
                print(f"   [OK] Análisis unificado completado")
                return resultado_unificado

            except Exception as e:
                print(f"   [X] Excepcin con {modelo}: {e}")
                continue

        print("   [X] Todos los modelos fallaron, intentando fallback con Rekognition solo...")
        # Fallback: usar solo Rekognition como último recurso
        try:
            resultado_fallback = self.analizador_unificado._fallback_rekognition_solo(
                self.analizador_unificado._analizar_con_rekognition(fotos_base64)
            )
            print(f"   [FALLBACK] Usando análisis Rekognition: {resultado_fallback}")
            return resultado_fallback
        except Exception as e:
            print(f"   [X] Fallback Rekognition también falló: {e}")
            return self._generar_respuesta_segura()

    def _modelos_fallback_fuentes(self) -> List[str]:
        modelos = [
            "gemini-2.5-flash",
            "gemini-2.0-flash",
            "gemini-2.5-flash-lite",
            "gemini-2.0-flash-lite",
            "gemini-1.5-flash",
            "gemini-1.5-pro",
            "gemini-2.5-pro",
            "gemini-2.0-pro",
        ]
        if Config.GEMINI_MODEL not in modelos:
            modelos.insert(0, Config.GEMINI_MODEL)
        return modelos

    def _analizar_gemini_crudo_fuente(self, fotos_base64: List[str], nombre_negocio: str, fuente: str) -> Optional[dict]:
        if not fotos_base64:
            return None

        prompt_final = Config.PROMPT_COMPLETO.replace("{nombre_negocio}", nombre_negocio)
        prompt_final = prompt_final.replace("{cantidad_imagenes}", str(len(fotos_base64)))
        prompt_final += (
            f"\n\nFUENTE DE ESTAS IMAGENES: {fuente}.\n"
            "Analiza solo esta fuente. No mezcles con otras fuentes y no inventes datos."
        )

        parts = [{"text": prompt_final}]
        for foto in fotos_base64:
            parts.append({"inline_data": {"mime_type": "image/jpeg", "data": foto}})

        payload = {
            "contents": [{"parts": parts}],
            "safetySettings": [
                {"category": "HARM_CATEGORY_HARASSMENT", "threshold": "BLOCK_NONE"},
                {"category": "HARM_CATEGORY_HATE_SPEECH", "threshold": "BLOCK_NONE"},
                {"category": "HARM_CATEGORY_SEXUALLY_EXPLICIT", "threshold": "BLOCK_NONE"},
                {"category": "HARM_CATEGORY_DANGEROUS_CONTENT", "threshold": "BLOCK_NONE"},
            ],
            "generationConfig": {"temperature": self.temperatura}
        }

        for modelo in self._modelos_fallback_fuentes():
            url = f"https://generativelanguage.googleapis.com/v1/models/{modelo}:generateContent?key={self.api_key}"
            try:
                print(f"    Gemini {fuente}: {modelo} ({len(fotos_base64)} imagenes)...")
                respuesta = requests.post(url, json=payload, timeout=120)
                if respuesta.status_code == 429:
                    print(f"   [!] Cuota alcanzada en {modelo}. Esperando 15s...")
                    time.sleep(15)
                    respuesta = requests.post(url, json=payload, timeout=120)
                if respuesta.status_code != 200:
                    print(f"   [X] Gemini {fuente} HTTP {respuesta.status_code}: {respuesta.text[:250]}")
                    continue

                datos_ia = respuesta.json()
                print(f"    Respuesta raw Gemini {fuente}: {json.dumps(datos_ia, ensure_ascii=False)[:500]}")
                texto = datos_ia["candidates"][0]["content"]["parts"][0]["text"]
                texto = texto.strip().replace("```json", "").replace("```", "").strip()
                match = re.search(r"\{[\s\S]*\}", texto)
                if match:
                    texto = match.group(0)
                resultado = json.loads(texto)
                print(f"   [OK] Gemini {fuente}: {json.dumps(resultado, ensure_ascii=False)}")
                return resultado
            except Exception as e:
                print(f"   [X] Excepcion Gemini {fuente} con {modelo}: {e}")
        return None

    def _combinar_rekognition_fuentes(self, resultados: List[Dict]) -> Dict:
        combinado = {
            "etiquetas_totales": {},
            "marcas_cemento": [],
            "marcas_herramientas": [],
            "texto_ocr_concatenado": "",
            "telefonos_encontrados": [],
            "redes_sociales_encontradas": {},
            "imagenes": []
        }
        for resultado in resultados:
            if not resultado:
                continue
            for etiqueta, total in resultado.get("etiquetas_totales", {}).items():
                combinado["etiquetas_totales"][etiqueta] = combinado["etiquetas_totales"].get(etiqueta, 0) + total
            combinado["marcas_cemento"].extend(resultado.get("marcas_cemento", []))
            combinado["marcas_herramientas"].extend(resultado.get("marcas_herramientas", []))
            combinado["texto_ocr_concatenado"] += " " + resultado.get("texto_ocr_concatenado", "")
            combinado["telefonos_encontrados"].extend(resultado.get("telefonos_encontrados", []))
            combinado["redes_sociales_encontradas"].update(resultado.get("redes_sociales_encontradas", {}))
            combinado["imagenes"].extend(resultado.get("imagenes", []))

        combinado["marcas_cemento"] = list(dict.fromkeys(combinado["marcas_cemento"]))
        combinado["marcas_herramientas"] = list(dict.fromkeys(combinado["marcas_herramientas"]))
        return combinado

    def _normalizar_texto_fuente(self, texto: str) -> str:
        import unicodedata
        texto = unicodedata.normalize("NFKD", texto or "")
        texto = texto.encode("ascii", "ignore").decode("ascii")
        return texto.lower()

    def _tokens_negocio_para_ocr(self, nombre_negocio: str) -> List[str]:
        genericos = {
            "almacen", "ferreteria", "ferretera", "materiales", "deposito",
            "construccion", "sas", "sa", "s", "la", "el", "los", "las",
            "del", "de", "y", "para", "comercial"
        }
        normalizado = self._normalizar_texto_fuente(nombre_negocio)
        tokens = re.findall(r"[a-z0-9]{4,}", normalizado)
        return [t for t in tokens if t not in genericos]

    def _filtrar_rekognition_street_view(self, rekognition: Dict, nombre_negocio: str) -> Dict:
        """
        Filtra resultados de Rekognition en Street View.
        Con la nueva captura enfocada, los datos ya deberían ser del negocio objetivo.
        Este filtro solo es seguridad adicional.
        """
        return rekognition

    def _combinar_gemini_fuentes(self, resultados: List[Dict]) -> Dict:
        combinado = {
            "vende_cemento": False,
            "vende_tubos": False,
            "vende_varillas": False,
            "vende_ladrillos": False,
            "vende_agregados": False,
            "materiales_observados": [],
            "whatsapp": "",
            "telefono_fijo": "",
            "instagram": "",
            "facebook": "",
            "nivel_confianza": "bajo",
            "score_confianza": 0
        }
        for resultado in resultados:
            if not isinstance(resultado, dict):
                continue
            for campo in ["vende_cemento", "vende_tubos", "vende_varillas", "vende_ladrillos", "vende_agregados"]:
                combinado[campo] = bool(combinado[campo] or resultado.get(campo))
            materiales = resultado.get("materiales_observados", [])
            if not isinstance(materiales, list):
                materiales = [str(materiales)] if materiales else []
            for material in materiales:
                if material not in combinado["materiales_observados"]:
                    combinado["materiales_observados"].append(material)
            for campo in ["whatsapp", "telefono_fijo", "instagram", "facebook"]:
                if not combinado[campo] and resultado.get(campo):
                    combinado[campo] = str(resultado.get(campo)).strip()

        combinado["nivel_confianza"] = "alto" if combinado["vende_cemento"] else "medio"
        combinado["score_confianza"] = 80 if combinado["vende_cemento"] else 60
        return combinado

    def _sintetizar_fuentes_con_ia(self, nombre_negocio: str, observaciones: Dict) -> Optional[dict]:
        prompt = f"""
Eres un auditor de datos para ferreterias. Unifica observaciones de Google Maps y Street View.
Cada fuente fue analizada por Gemini y por AWS Rekognition.

Reglas:
- WhatsApp: solo un numero colombiano completo de 10 digitos que empieza por 3.
- Telefono fijo: 7 digitos locales o 10 digitos con 604/605. No lo pongas como WhatsApp.
- Cemento: si cualquier fuente ve marcas ARGOS, TEQUENDAMA, ALION, HOLCIM o CEMEX, vende_cemento=true y conserva las marcas.
- No inventes datos. Si una fuente trae fragmentos incompletos, ignoralos.
- Responde solo JSON valido.

Negocio: {nombre_negocio}
Observaciones:
{json.dumps(observaciones, ensure_ascii=False)}

Campos esperados:
vende_cemento, vende_tubos, vende_varillas, vende_ladrillos, vende_agregados,
materiales_observados, whatsapp, telefono_fijo, instagram, facebook,
nivel_confianza, score_confianza.
"""
        payload = {
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {"temperature": 0.0}
        }
        for modelo in self._modelos_fallback_fuentes():
            url = f"https://generativelanguage.googleapis.com/v1/models/{modelo}:generateContent?key={self.api_key}"
            try:
                print(f"    Sintesis final por fuentes con {modelo}...")
                respuesta = requests.post(url, json=payload, timeout=60)
                if respuesta.status_code != 200:
                    continue
                texto = respuesta.json()["candidates"][0]["content"]["parts"][0]["text"]
                texto = texto.strip().replace("```json", "").replace("```", "").strip()
                match = re.search(r"\{[\s\S]*\}", texto)
                if match:
                    texto = match.group(0)
                resultado = json.loads(texto)
                print(f"   [OK] Sintesis final: {json.dumps(resultado, ensure_ascii=False)}")
                return resultado
            except Exception as e:
                print(f"   [!] Sintesis final fallo con {modelo}: {e}")
        return None

    def analizar_fotos_por_fuente(self, fotos_maps: List[str], fotos_sv: List[str], nombre_negocio: str) -> dict:
        print("    Analisis separado por fuente: Google Maps + Street View")
        gemini_maps = self._analizar_gemini_crudo_fuente(fotos_maps, nombre_negocio, "GOOGLE_MAPS_FOTOS")
        gemini_sv = self._analizar_gemini_crudo_fuente(fotos_sv, nombre_negocio, "STREET_VIEW")

        print("    Rekognition GOOGLE_MAPS_FOTOS...")
        rek_maps = self.analizador_unificado._analizar_con_rekognition(fotos_maps)
        print("    Rekognition STREET_VIEW...")
        rek_sv = self.analizador_unificado._analizar_con_rekognition(fotos_sv)
        rek_sv = self._filtrar_rekognition_street_view(rek_sv, nombre_negocio)
        rek_total = self._combinar_rekognition_fuentes([rek_maps, rek_sv])

        observaciones = {
            "google_maps": {"gemini": gemini_maps, "rekognition": rek_maps},
            "street_view": {"gemini": gemini_sv, "rekognition": rek_sv}
        }
        sintesis = self._sintetizar_fuentes_con_ia(nombre_negocio, observaciones)
        if not sintesis:
            sintesis = self._combinar_gemini_fuentes([gemini_maps, gemini_sv])

        resultado = self.analizador_unificado._unificar(sintesis, rek_total, nombre_negocio)
        resultado["fuentes"] = observaciones
        return resultado

    def _generar_respuesta_segura(self) -> dict:
        return {
            "vende_cemento": False,
            "vende_tubos": False,
            "vende_varillas": False,
            "vende_ladrillos": False,
            "vende_agregados": False,
            "productos_observados": [],
            "whatsapp": "",
            "telefono_fijo": "",
            "nivel_confianza": "bajo",
            "error": "No se pudo procesar con la IA"
        }

    # ------------------------------------------------------------------
    # MÉTODOS PARA ANÁLISIS DE RUES (persona natural vs empresa)
    # ------------------------------------------------------------------

    def analizar_razon_social(self, razon_social: str) -> dict:
        """
        Pregunta a Gemini si la razón social es una persona natural o una empresa.
        Retorna: {
            "es_persona_natural": bool,
            "es_empresa": bool,
            "confianza": "alta" | "media" | "baja"
        }
        """
        if not razon_social or len(razon_social.strip()) < 3:
            return {"es_persona_natural": False, "es_empresa": False, "confianza": "baja"}

        prompt = f"""Analiza el siguiente texto y determina si es el nombre de una persona natural o una empresa.

Texto: "{razon_social}"

Responde en JSON:
{{
  "es_persona_natural": true/false,
  "es_empresa": true/false,
  "confianza": "alta" o "media" o "baja"
}}

Criterios:
- Persona natural: Nombres como "JUAN PEREZ GARCIA", "MARIA RODRIGUEZ", patrones de nombre+apellido
- Empresa: Nombres como "FERRETERIA LA PAZ SAS", "DEPOSITO EL CONSTRUCTOR", "COMERCIAL LTDA", etc.
"""
        respuesta = self.generar_respuesta_simple(prompt, timeout=3)
        if not respuesta:
            return {"es_persona_natural": False, "es_empresa": False, "confianza": "baja"}

        try:
            respuesta = respuesta.replace("```json", "").replace("```", "").strip()
            json_match = re.search(r"\{[\s\S]*\}", respuesta)
            if json_match:
                return json.loads(json_match.group(0))
        except:
            pass

        return {"es_persona_natural": False, "es_empresa": False, "confianza": "baja"}

    def extraer_nombre_empresa_de_email(self, email: str) -> Optional[str]:
        """
        Extrae el nombre de la empresa del correo.
        De "ferreteriaydepositolapaz@hotmail.com" retorna "ferreteriaydepositolapaz"
        """
        if not email or "@" not in email:
            return None

        nombre = email.split("@")[0].strip()
        # Limpiar caracteres especiales pero mantener guiones/guiones bajos
        nombre = re.sub(r"[^\w\-]", "", nombre)
        return nombre if len(nombre) > 2 else None

    def validar_dominio_empresarial(self, email: str) -> dict:
        """
        Valida si el dominio del email es empresarial o personal.
        Retorna: {
            "es_dominioempresarial": bool,
            "dominio": str,
            "tipo": "empresa" | "personal" | "desconocido"
        }
        """
        if not email or "@" not in email:
            return {"es_dominio_empresarial": False, "dominio": "", "tipo": "desconocido"}

        dominio = email.split("@")[1].lower()
        dominios_personales = [
            "gmail.com", "hotmail.com", "yahoo.com", "outlook.com", "aol.com",
            "msn.com", "live.com", "mail.com", "protonmail.com", "yandex.com",
            "mailinator.com", "temp-mail.org"
        ]

        es_personal = dominio in dominios_personales
        tipo = "personal" if es_personal else "empresa"

        return {
            "es_dominio_empresarial": not es_personal,
            "dominio": dominio,
            "tipo": tipo
        }

    def validar_empresa_vende_construccion(self, nombre_empresa: str) -> dict:
        """
        Pregunta a Gemini si la empresa (por nombre) vende materiales de construcción.
        Retorna: {
            "vende_materiales_construccion": bool,
            "tipo_materiales": [lista de materiales],
            "confianza": "alta" | "media" | "baja"
        }
        """
        if not nombre_empresa or len(nombre_empresa) < 2:
            return {
                "vende_materiales_construccion": False,
                "tipo_materiales": [],
                "confianza": "baja"
            }

        # Limpiar el nombre (reemplazar guiones/guiones bajos con espacios)
        nombre_limpio = nombre_empresa.replace("_", " ").replace("-", " ")

        prompt = f"""Basado en el nombre de la empresa, determina si probablemente vende materiales para la construcción.

Nombre: "{nombre_limpio}"

Responde en JSON:
{{
  "vende_materiales_construccion": true/false,
  "tipo_materiales": ["cemento", "tubos", "ladrillos", ...],
  "confianza": "alta" o "media" o "baja"
}}

Ejemplos de empresas que VENDEN materiales de construcción:
- "ferreteriaydepositolapaz" → true (ferretería)
- "deposito los londoños" → true (depósito de materiales)
- "almacén de construcción" → true
- "comercial de tubería" → true
- "claudiarojasv" → false (nombre personal)
- "consultora inmobiliaria" → false (no vende materiales)
"""
        respuesta = self.generar_respuesta_simple(prompt, timeout=3)
        if not respuesta:
            return {
                "vende_materiales_construccion": False,
                "tipo_materiales": [],
                "confianza": "baja"
            }

        try:
            respuesta = respuesta.replace("```json", "").replace("```", "").strip()
            json_match = re.search(r"\{[\s\S]*\}", respuesta)
            if json_match:
                return json.loads(json_match.group(0))
        except:
            pass

        return {
            "vende_materiales_construccion": False,
            "tipo_materiales": [],
            "confianza": "baja"
        }
