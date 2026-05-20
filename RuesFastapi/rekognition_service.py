import re
import base64
from typing import List, Dict, Optional, Tuple
import boto3
from config import Config

class RekognitionService:
    """
    Servicio para AWS Rekognition (OCR + detección de objetos).
    Extrae:
    - Etiquetas de objetos (DetectLabels)
    - Texto visible (DetectText con OCR)
    - Marcas de cemento por regex en OCR
    - Teléfonos por regex en OCR
    """

    # Marcas de cemento en Colombia
    MARCAS_CEMENTO = {
        "ARGOS": r"\bARGOS\b",
        "ALION": r"\bALI[O0]N\b(?!\s+JARA)",  # No detectar si va seguido de "JARA"
        "HOLCIM": r"\bHOLCIM\b",
        "CEMEX": r"\bCEMEX\b",
        "ULTRACEM": r"\bULTRACEM\b|\bULTRA\b",  # También detectar si está cortado
        "TEQUENDAMA": r"\bTEQUENDAMA\b|\bTEQUEN\b",  # También detectar si está cortado
        "TEQUENDAMA": r"\bTEQUENDAMA\b|\bTEQUEN\b|\bTEQUEND\b",
        "SAN MARCOS": r"\bSAN\b.*?\bMARCOS\b",  # Ambas palabras deben estar presentes
        "LAFARGE": r"\bLAFARGE\b",
        "ANDINO": r"\bANDINO\b(?!\s+JARA)",
        "PORTLAND": r"\bPORTLAND\b",
        "PACIFICO": r"\bPAC[ÍI]FICO\b",
    }

    # Marcas de herramientas
    MARCAS_HERRAMIENTAS = {
        "DEWALT": r"\bDEWALT\b",
        "MAKITA": r"\bMAKITA\b",
        "BOSCH": r"\bBOSCH\b",
        "STANLEY": r"\bSTANLEY\b",
        "TRUPER": r"\bTRUPER\b",
    }

    # Otras marcas conocidas
    OTRAS_MARCAS = {
        "MAPEI": r"\bMAPEI\b",
        "CORONA": r"\bCORONA\b",
        "PAVCO": r"\bPAVCO\b",
        "BLACK+DECKER": r"\bBLACK\s*\+\s*DECKER\b",
        "CONCOLOR": r"\bCONCOLOR\b",
        "PINTUCO": r"\bPINTUCO\b",
    }

    # Redes sociales
    REDES_SOCIALES = {
        "facebook": r"(?:facebook|fb\.com|facebook\.com|@\w+_fb)",
        "instagram": r"(?:instagram|ig:|@\w+|instagram\.com)",
        "tiktok": r"(?:tiktok|tik\s*tok|@\w+_tt|tiktok\.com)",
        "youtube": r"(?:youtube|youtube\.com|canal\s*youtube|@\w+_yt)",
        "twitter": r"(?:twitter|x\.com|@\w+_tw)",
        "whatsapp": r"(?:whatsapp|whats\s*app|wa:|\+\d{1,3}\s*\d{1,14})",
    }

    def __init__(self):
        self.client = boto3.client(
            "rekognition",
            region_name=Config.AWS_REGION,
            aws_access_key_id=Config.AWS_ACCESS_KEY_ID,
            aws_secret_access_key=Config.AWS_SECRET_ACCESS_KEY
        )

    def analizar_imagen(self, imagen_bytes: bytes) -> Dict:
        """
        Analiza una imagen con Rekognition (OCR + detección de objetos).
        Retorna:
        {
            "etiquetas": ["label1", "label2", ...],
            "texto_ocr": "texto detectado",
            "marcas_cemento": ["ARGOS", "HOLCIM"],
            "marcas_herramientas": ["DEWALT"],
            "redes_sociales": {"facebook": "...", "instagram": "..."},
            "telefonos_detectados": {
                "whatsapp": "3001234567",
                "fijo": "2705025"
            }
        }
        """
        resultado = {
            "etiquetas": [],
            "texto_ocr": "",
            "marcas_cemento": [],
            "marcas_herramientas": [],
            "redes_sociales": {},
            "telefonos_detectados": {
                "whatsapp": "",
                "fijo": ""
            }
        }

        try:
            # Paso 1: Detectar etiquetas de objetos
            etiquetas = self._detectar_etiquetas(imagen_bytes)
            resultado["etiquetas"] = etiquetas

            # Paso 2: Detectar texto OCR
            texto_ocr = self._detectar_texto_ocr(imagen_bytes)
            resultado["texto_ocr"] = texto_ocr

            # Paso 3: Procesar texto OCR para extraer marcas, teléfonos y redes sociales
            if texto_ocr:
                marcas_cem = self._extraer_marcas_cemento(texto_ocr)
                resultado["marcas_cemento"] = marcas_cem

                marcas_herr = self._extraer_marcas_herramientas(texto_ocr)
                resultado["marcas_herramientas"] = marcas_herr

                telefonos = self._extraer_telefonos(texto_ocr)
                resultado["telefonos_detectados"] = telefonos

                redes = self._extraer_redes_sociales(texto_ocr)
                resultado["redes_sociales"] = redes

        except Exception as e:
            print(f"   [!] Error en Rekognition: {e}")
            import traceback
            traceback.print_exc()

        return resultado

    def _detectar_etiquetas(self, imagen_bytes: bytes) -> List[str]:
        """Llama DetectLabels de Rekognition (máx 20 etiquetas, confianza >50%)."""
        try:
            response = self.client.detect_labels(
                Image={"Bytes": imagen_bytes},
                MaxLabels=20,
                MinConfidence=50
            )
            etiquetas = []
            for label in response.get("Labels", []):
                etiquetas.append(label["Name"])
            return etiquetas
        except Exception as e:
            print(f"   [!] Error DetectLabels: {e}")
            return []

    def _detectar_texto_ocr(self, imagen_bytes: bytes) -> str:
        """Llama DetectText de Rekognition (OCR). Solo LINE para evitar duplicados."""
        try:
            response = self.client.detect_text(
                Image={"Bytes": imagen_bytes}
            )
            lineas = []
            for item in response.get("TextDetections", []):
                if item["Type"] == "LINE" and item.get("Confidence", 0) > 35:
                    lineas.append(item["DetectedText"])
            return "\n".join(lineas)
        except Exception as e:
            print(f"   [!] Error DetectText: {e}")
            return ""

    def _extraer_marcas_cemento(self, texto: str) -> List[str]:
        """
        Busca marcas de cemento en el texto OCR usando regex.
        Retorna lista de marcas encontradas.
        """
        marcas = []
        texto_upper = texto.upper()

        for nombre_marca, patron_regex in self.MARCAS_CEMENTO.items():
            if re.search(patron_regex, texto_upper, re.IGNORECASE):
                marcas.append(nombre_marca)

        return list(set(marcas))  # Eliminar duplicados

    def _extraer_marcas_herramientas(self, texto: str) -> List[str]:
        """Busca marcas de herramientas en el texto OCR."""
        marcas = []
        texto_upper = texto.upper()

        for nombre_marca, patron_regex in self.MARCAS_HERRAMIENTAS.items():
            if re.search(patron_regex, texto_upper, re.IGNORECASE):
                marcas.append(nombre_marca)

        return list(set(marcas))

    def _extraer_redes_sociales(self, texto: str) -> Dict[str, str]:
        """
        Extrae Instagram y Facebook del texto OCR de letreros.

        Los letreros muestran el handle directamente (ej: 'flabombaenvigado')
        junto al ícono de red social. Rekognition no lee íconos pero sí el texto.

        Estrategia:
          1. @handle explícito → máxima confianza
          2. Handle después de palabra clave 'instagram'/'ig' o 'facebook'/'fb'
          3. Línea con teléfono/WhatsApp + palabra que parece handle → Instagram
             (emails se eliminan primero para no confundir 'flabomba' de flabomba@gmail.com)
        """
        redes = {}
        PALABRAS_EXCLUIR = {'gmail', 'com', 'hotmail', 'yahoo', 'outlook', 'info',
                            'ventas', 'contacto', 'correo', 'mail', 'email',
                            'instagram', 'facebook', 'whatsapp', 'telefono'}

        # --- 1. @handles explícitos en el texto ---
        for h in re.findall(r'@([a-zA-Z0-9_.]{3,30})', texto):
            h_low = h.lower()
            if 'facebook' in h_low or h_low == 'fb':
                redes.setdefault("facebook", h_low)
            else:
                redes.setdefault("instagram", h_low)

        # --- 2. Handle después de palabra clave por línea ---
        for linea in texto.split('\n'):
            linea_l = linea.lower()

            if "instagram" not in redes:
                if re.search(r'\binstagram\b|\big\b', linea_l):
                    m = re.search(r'(?:instagram\.com/|instagram\s*[:\-]?\s*|ig\s*[:\-]?\s*)@?([a-zA-Z0-9_.]{3,30})', linea_l)
                    if m and m.group(1) not in PALABRAS_EXCLUIR:
                        redes["instagram"] = m.group(1)

            if "facebook" not in redes:
                if re.search(r'\bfacebook\b|\bfb\.com\b', linea_l):
                    m = re.search(r'(?:facebook\.com/|fb\.com/|facebook\s*[:\-]?\s*)@?([a-zA-Z0-9_.]{3,50})', linea_l)
                    if m and m.group(1) not in PALABRAS_EXCLUIR:
                        redes["facebook"] = m.group(1)

        # --- 3. Contexto: línea con teléfono tiene handle al final → Instagram ---
        if "instagram" not in redes:
            patron_tel = r'3[0-2]\d[\s\-]?\d{3}[\s\-]?\d{2}[\s\-]?\d{2}|(?:604|605)[\s\-]?\d{3}[\s\-]?\d{4}'
            for linea in texto.split('\n'):
                if re.search(patron_tel, linea):
                    # Eliminar emails (ej: flabomba@gmail.com) antes de buscar handle
                    linea_limpia = re.sub(r'\S+@\S+', '', linea.lower())
                    handles_linea = re.findall(r'\b([a-z][a-z0-9_]{4,29})\b', linea_limpia)
                    for h in handles_linea:
                        if h not in PALABRAS_EXCLUIR:
                            redes["instagram"] = h
                            break

        return redes

    def _extraer_telefonos(self, texto: str) -> Dict[str, str]:
        """
        Extrae teléfonos del texto OCR. Maneja formatos con espacios como
        '317 368 01 07' o '604 2762585' tal como aparecen en letreros.

        Estrategia:
        1. Intentar patrones completos y validados (estricto)
        2. Si no encuentra, buscar fragmentos y reconstruir (permisivo)
        3. Fragmentos conocidos: "604"/"605" (indicativo Medellín), "3XX" (celular)
        """
        telefonos = {"whatsapp": "", "fijo": ""}
        texto_normalizado = texto.replace("\n", " ")

        # Avisos como "270 50 25 - 317 368 01 03": extraer ambos
        # numeros antes de caer en los patrones historicos.
        match_celular = re.search(r'3[0-2]\d[\s\-]?\d{3}[\s\-]?\d{2}[\s\-]?\d{2}', texto_normalizado)
        if match_celular:
            celular = re.sub(r'\D', '', match_celular.group(0))
            if len(celular) == 10 and not self._es_numero_alucinacion(celular):
                telefonos["whatsapp"] = celular

        match_fijo_ind = re.search(r'(?:604|605)[\s\-]?\d{3}[\s\-]?\d{4}', texto_normalizado)
        if match_fijo_ind:
            fijo = re.sub(r'\D', '', match_fijo_ind.group(0))
            if len(fijo) == 10:
                telefonos["fijo"] = fijo

        if not telefonos["fijo"]:
            match_fijo_local = re.search(r'\b[2-9]\d{2}[\s\-]?\d{2}[\s\-]?\d{2}\b', texto_normalizado)
            if match_fijo_local:
                fijo = re.sub(r'\D', '', match_fijo_local.group(0))
                if len(fijo) == 7 and not self._es_numero_alucinacion(fijo):
                    telefonos["fijo"] = fijo

        if telefonos["whatsapp"]:
            return telefonos

        # PASO 1: Patrones completos y estrictos
        # WhatsApp: 3XX con espacios o sin espacios (ej: '317 368 01 07' o '3173680107')
        patron_celular = r'3[0-2]\d[\s\-]?\d{3}[\s\-]?\d{2}[\s\-]?\d{2}'
        match = re.search(patron_celular, texto)
        if match:
            celular = re.sub(r'\D', '', match.group(0))
            if len(celular) == 10 and not self._es_numero_alucinacion(celular):
                telefonos["whatsapp"] = celular
                return telefonos

        # Fijo con indicativo: '604 2762585' o '6042762585'
        patron_indicativo = r'(?:604|605)[\s\-]?\d{3}[\s\-]?\d{4}'
        match = re.search(patron_indicativo, texto)
        if match:
            fijo = re.sub(r'\D', '', match.group(0))
            if len(fijo) == 10:
                telefonos["fijo"] = fijo
                return telefonos

        # Fijo local sin indicativo: 7-8 dígitos que deben ser validos (no números alucinación)
        for linea in texto.split('\n'):
            m = re.search(r'\b(\d{7,8})\b', linea)
            if m:
                fijo = m.group(1)
                # Validar que no sea una alucinación y que tenga estructura válida
                if not self._es_numero_alucinacion(fijo) and fijo[0] in '2346789':
                    telefonos["fijo"] = fijo
                    return telefonos

        # PASO 2: Si no encontró números válidos, buscar fragmentos y reconstruir
        # Buscar "604" o "605" (indicativo) seguido de dígitos
        fijos_candidatos = re.findall(r'(?:604|605)\s*[\s\-]?\d+', texto)
        if fijos_candidatos:
            for candidato in fijos_candidatos:
                fijo_limpio = re.sub(r'\D', '', candidato)
                if 7 <= len(fijo_limpio) <= 10:
                    # Validar: si tiene 10 dígitos, es válido; si tiene 7-9, completar con 604
                    if len(fijo_limpio) == 10 and fijo_limpio.startswith(('604', '605')):
                        telefonos["fijo"] = fijo_limpio
                        return telefonos
                    elif len(fijo_limpio) < 10 and fijo_limpio.startswith(('604', '605')):
                        # Incompleto pero tiene indicativo
                        if len(fijo_limpio) >= 7:
                            telefonos["fijo"] = fijo_limpio
                            return telefonos

        # Buscar "3" seguido de múltiples dígitos (posible celular fragmentado)
        celulares_candidatos = re.findall(r'3[0-2]\d[\s\-]?\d+', texto)
        if celulares_candidatos:
            for candidato in celulares_candidatos:
                celular_limpio = re.sub(r'\D', '', candidato)
                if 7 <= len(celular_limpio) <= 10:
                    if len(celular_limpio) == 10 and not self._es_numero_alucinacion(celular_limpio):
                        telefonos["whatsapp"] = celular_limpio
                        return telefonos
                    elif len(celular_limpio) >= 7:
                        # Incompleto pero parece válido
                        telefonos["whatsapp"] = celular_limpio
                        return telefonos

        return telefonos

    @staticmethod
    def _es_numero_alucinacion(numero: str) -> bool:
        """
        Detecta si el número parece ser una alucinación de IA.
        Rechaza números secuenciales o repetitivos.
        """
        # Números secuenciales: 3111111111, 3222222222, etc.
        patrones_sospechosos = [
            r"^3([1-9])\1{7}$",  # 3111111111, 3222222222, etc.
            r"^(\d)\1{9}$",      # 1111111111, 2222222222, etc.
            r"^(\d)\1{7}$",      # 11111111, 22222222, etc. (para fijos)
        ]

        for patron in patrones_sospechosos:
            if re.match(patron, numero):
                return True

        return False

    def extraer_marcas_cemento_ocr(self, imagen_bytes: bytes) -> List[str]:
        """
        Conveniencia: solo extrae marcas de cemento del OCR.
        """
        texto_ocr = self._detectar_texto_ocr(imagen_bytes)
        if texto_ocr:
            return self._extraer_marcas_cemento(texto_ocr)
        return []

    def extraer_telefonos_ocr(self, imagen_bytes: bytes) -> Dict[str, str]:
        """
        Conveniencia: solo extrae teléfonos del OCR.
        """
        texto_ocr = self._detectar_texto_ocr(imagen_bytes)
        if texto_ocr:
            return self._extraer_telefonos(texto_ocr)
        return {"whatsapp": "", "fijo": ""}
