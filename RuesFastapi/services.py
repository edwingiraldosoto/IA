import requests
import json
import time
import re
import base64
from typing import Optional, List, Dict, Tuple
from interfaces import BuscadorLugaresInterface, AnalizadorImagenesInterface
from config import Config

# =================================================================
# UTILIDADES COMPARTIDAS
# =================================================================

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


def seleccionar_mejores_imagenes(user_photos: List[str], sv_photos: List[str], max_total: int = 16) -> List[str]:
    """
    Enva TODAS las fotos de usuario + Street View zoom para capturar letreros y nmeros.
    max_total = 16: 
    - Todas las fotos de usuario (Google devuelve ~10, mximo 6-8 tiles)
    - Street View FOV=40 (zoom a letreros/nmeros) si cabe
    - Street View FOV=80 (contexto) si cabe
    
    Razn: El letrero con telfono est en una foto de usuario que no podemos descartar.
    """
    # Tomar TODAS las fotos de usuario (no solo las primeras 6)
    seleccionadas = user_photos
    espacio = max_total - len(seleccionadas)
    
    if espacio > 0 and sv_photos:
        zoom_sv   = sv_photos[8:16]   # FOV=40: zoom a letreros
        amplia_sv = sv_photos[:8]     # FOV=80: contexto
        combinado = zoom_sv + amplia_sv
        seleccionadas += combinado[:espacio]
    
    # Limitar a max_total total
    return seleccionadas[:max_total]


# =================================================================
# 1. IMPLEMENTACIN DE GOOGLE MAPS
# =================================================================
class GoogleMapsService(BuscadorLugaresInterface):
    def __init__(self):
        self.api_key = Config.GOOGLE_API_KEY
        self.url_nearby = Config.GOOGLE_MAPS_URL
        self.url_fotos = "https://maps.googleapis.com/maps/api/place/photo"
        self.url_geocode = Config.GOOGLE_GEOCODING_URL
        self.url_details = "https://maps.googleapis.com/maps/api/place/details/json"
        self.url_sv = Config.GOOGLE_STREET_VIEW_URL

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
                     email: str = "") -> Optional[dict]:
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
                        print(f"   [>>] Resultado es direccion, buscando por 'ferreteria' en radio 20m...")
                        resultados_ferreteria = self._buscar_por_texto(lat, lng, "ferreteria", radio=20)
                        if resultados_ferreteria:
                            # FILTRAR por distancia (muy estricto en este paso)
                            ferre_validas = []
                            for r in resultados_ferreteria:
                                try:
                                    loc = r.get('geometry', {}).get('location', {})
                                    lat_r, lng_r = loc.get('lat'), loc.get('lng')
                                    if lat_r and lng_r:
                                        dist = self._calcular_distancia(lat, lng, lat_r, lng_r)
                                        if dist <= 20:
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

        # Paso 3: Fallback final - buscar "ferreteria" SOLO en radio 20m (SIN escalar)
        print(f"   [?] Fallback: buscando 'ferreteria' SOLO en radio 20m...")
        resultados = self._buscar_por_texto(lat, lng, "ferreteria", radio=200)  # Busca en 200m pero filtra estricto

        if resultados:
            # FILTRAR por distancia real (SOLO resultados a menos de 20m)
            resultados_cercanos = []
            for r in resultados:
                try:
                    loc = r.get('geometry', {}).get('location', {})
                    lat_r, lng_r = loc.get('lat'), loc.get('lng')
                    if lat_r and lng_r:
                        dist = self._calcular_distancia(lat, lng, lat_r, lng_r)
                        if dist <= 20:  # SOLO los que estan dentro de 20m
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
                    print(f"   [!] Resultados encontrados pero todos a > 20m. No escalamos la busqueda.")

        print(f"   [!] No se encontro negocio para '{nombre_negocio}' en rango de 20m")
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
        """
        place_id = lugar.get("place_id")
        fotos_refs = lugar.get("photos", [])

        # Si tenemos place_id, buscar ms fotos va Details
        if place_id and len(fotos_refs) < 3:
            detalles = self.obtener_detalles_lugar(place_id)
            fotos_refs = detalles.get("photos", fotos_refs)

        print(f"    Total fotos disponibles: {len(fotos_refs)}")
        fotos_b64 = []
        for i, foto in enumerate(fotos_refs[:max_fotos]):
            try:
                r = requests.get(self.url_fotos, params={
                    "maxwidth": 1600,
                    "photo_reference": foto.get("photo_reference"),
                    "key": self.api_key
                }, timeout=20)
                if r.status_code == 200 and len(r.content) > 5000:
                    fotos_b64.append(base64.b64encode(r.content).decode("utf-8"))
                    print(f"    Foto {i+1}/{min(len(fotos_refs), max_fotos)} obtenida")
            except Exception as e:
                print(f"   [!] Error descargando foto {i+1}: {e}")
        return fotos_b64

    # ------------------------------------------------------------------
    # STREET VIEW  8 ngulos  2 pasadas (amplia + zoom letrero)
    # ------------------------------------------------------------------
    def obtener_street_view(self, lat: float, lng: float) -> List[str]:
        """
        Genera 8 ngulos con FOV=80 (contexto) + 8 ngulos con FOV=40 (zoom letreros).
        """
        headings = [0, 45, 90, 135, 180, 225, 270, 315]
        fotos = []

        # Pasada 1: vista amplia
        for h in headings:
            foto = self._capturar_sv(lat, lng, fov=80, heading=h, pitch=10)
            if foto:
                fotos.append(foto)

        # Pasada 2: zoom a letreros (FOV=40)
        for h in headings:
            foto = self._capturar_sv(lat, lng, fov=40, heading=h, pitch=25)
            if foto:
                fotos.append(foto)

        print(f"    Street View: {len(fotos)} imgenes (8 amplias FOV=80 + 8 zoom FOV=40)")
        return fotos

    # ------------------------------------------------------------------
    # HELPERS INTERNOS
    # ------------------------------------------------------------------
    def _capturar_sv(self, lat: float, lng: float, fov: int, heading: int, pitch: int) -> Optional[str]:
        try:
            r = requests.get(self.url_sv, params={
                "size": "1200x800",
                "location": f"{lat},{lng}",
                "fov": fov,
                "heading": heading,
                "pitch": pitch,
                "key": self.api_key
            }, timeout=15)
            if r.status_code == 200 and len(r.content) > 5000:
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
                return resultado

            except Exception as e:
                print(f"   [X] Excepcin con {modelo}: {e}")
                continue

        print("   [X] Todos los modelos fallaron")
        return self._generar_respuesta_segura()

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
