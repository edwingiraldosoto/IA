"""
Unificador de análisis: Gemini + AWS Rekognition

Estrategia:
1. Gemini: análisis visual (detecta materiales visualmente)
2. Rekognition: OCR (detecta marcas específicas y teléfonos de letreros)
3. Unificación con prioridades:
   - Gemini es la base (análisis visual)
   - Rekognition OCR enriquece/corrige:
     * Marcas de cemento (prioridad sobre Gemini)
     * Teléfonos (prioridad sobre Gemini)
   - Si Gemini falla: usar Rekognition como fallback
"""

from typing import List, Dict, Optional
import json
from rekognition_service import RekognitionService


class AnalizadorUnificado:
    """Unifica resultados de Gemini + Rekognition."""

    def __init__(self):
        self.rekognition = RekognitionService()

    def analizar_con_unificacion(
        self,
        imagenes_base64: List[str],
        nombre_negocio: str,
        analisis_gemini: Dict
    ) -> Dict:
        """
        Realiza análisis unificado:
        1. Toma resultado de Gemini
        2. Analiza imágenes con Rekognition
        3. Unifica con prioridades correctas

        Retorna diccionario con:
        {
            "vende_cemento": bool,
            "vende_tubos": bool,
            "vende_varillas": bool,
            "vende_ladrillos": bool,
            "vende_agregados": bool,
            "materiales_observados": [...],
            "whatsapp": str,
            "telefono_fijo": str,
            "facebook": str,
            "instagram": str,
            "nivel_confianza": "alto/medio/bajo",
            "score_confianza": 0-100,
            "fuentes": {
                "gemini": {...},
                "rekognition": {...}
            }
        }
        """
        # Analizar con Rekognition en paralelo (si es posible)
        analisis_rekognition = self._analizar_con_rekognition(imagenes_base64)

        # Unificar resultados
        resultado_unificado = self._unificar(analisis_gemini, analisis_rekognition, nombre_negocio)

        # Agregar trazabilidad
        resultado_unificado["fuentes"] = {
            "gemini": analisis_gemini,
            "rekognition": analisis_rekognition
        }

        return resultado_unificado

    def _analizar_con_rekognition(self, imagenes_base64: List[str]) -> Dict:
        """
        Analiza todas las imágenes con Rekognition.
        Agrega los resultados para extraer:
        - Marcas de cemento más comunes
        - Teléfono más frecuente
        - Redes sociales
        - Etiquetas de objetos

        NUEVO: Filtrado inteligente de teléfonos con validación contextual.
        """
        resultado = {
            "etiquetas_totales": {},
            "marcas_cemento": [],
            "marcas_herramientas": [],
            "texto_ocr_concatenado": "",
            "telefonos_encontrados": [],
            "redes_sociales_encontradas": {},
            "imagenes": []
        }

        for i, imagen_b64 in enumerate(imagenes_base64):
            try:
                # Convertir base64 a bytes
                imagen_bytes = self._base64_a_bytes(imagen_b64)
                analisis = self.rekognition.analizar_imagen(imagen_bytes)
                texto_ocr = analisis.get("texto_ocr", "")

                resultado["imagenes"].append({
                    "indice": i + 1,
                    "etiquetas": analisis.get("etiquetas", []),
                    "texto_ocr": texto_ocr,
                    "marcas_cemento": analisis.get("marcas_cemento", []),
                    "marcas_herramientas": analisis.get("marcas_herramientas", []),
                    "telefonos_detectados": analisis.get("telefonos_detectados", {}),
                    "redes_sociales": analisis.get("redes_sociales", {})
                })

                # Agregar etiquetas
                for etiqueta in analisis.get("etiquetas", []):
                    resultado["etiquetas_totales"][etiqueta] = resultado["etiquetas_totales"].get(etiqueta, 0) + 1

                # Agregar marcas
                resultado["marcas_cemento"].extend(analisis.get("marcas_cemento", []))
                resultado["marcas_herramientas"].extend(analisis.get("marcas_herramientas", []))

                # Concatenar OCR
                if texto_ocr:
                    resultado["texto_ocr_concatenado"] += " " + texto_ocr

                # --- NUEVO: Filtrado inteligente de teléfonos ---
                telefonos = analisis.get("telefonos_detectados", {})
                telefonos_validos = self._filtrar_telefonos_por_contexto(telefonos, texto_ocr, i + 1)

                if telefonos_validos.get("whatsapp"):
                    resultado["telefonos_encontrados"].append(("whatsapp", telefonos_validos["whatsapp"]))
                if telefonos_validos.get("fijo"):
                    resultado["telefonos_encontrados"].append(("fijo", telefonos_validos["fijo"]))

                # Agregar redes sociales
                redes = analisis.get("redes_sociales", {})
                for red, usuario in redes.items():
                    if usuario and red not in resultado["redes_sociales_encontradas"]:
                        resultado["redes_sociales_encontradas"][red] = usuario

                ocr_preview = texto_ocr[:400].replace('\n', ' | ')
                print(f"    [Rekognition] Img {i+1}: etiq={len(analisis.get('etiquetas', []))}, "
                      f"cem={analisis.get('marcas_cemento', [])}, tel={telefonos_validos}, redes={redes}")
                if ocr_preview:
                    print(f"      OCR: {ocr_preview}")

            except Exception as e:
                print(f"   [!] Error Rekognition imagen {i+1}: {e}")

        # Limpiar duplicados
        resultado["marcas_cemento"] = list(set(resultado["marcas_cemento"]))
        resultado["marcas_herramientas"] = list(set(resultado["marcas_herramientas"]))

        return resultado

    def _filtrar_telefonos_por_contexto(self, telefonos: Dict, ocr_text: str, numero_img: int) -> Dict:
        """
        Valida teléfonos de forma GENÉRICA.

        ESTRATEGIA: Solo acepta números si el OCR contiene palabras clave de
        MATERIALES DE CONSTRUCCIÓN (ferretería, depósito, etc.)

        Si ve palabras de otros tipos de negocios (alimentos, servicios personales, etc.)
        y NO hay materiales de construcción → descarta los números.
        """
        if not telefonos.get("whatsapp") and not telefonos.get("fijo"):
            return {"whatsapp": "", "fijo": ""}

        ocr_lower = ocr_text.lower()

        # PALABRAS CLAVE: Materiales de CONSTRUCCIÓN
        PALABRAS_CONSTRUCCION = {
            'ferretería', 'ferreteria', 'depósito', 'deposito',
            'cemento', 'argos', 'holcim', 'tequendama', 'cemex',
            'tubos', 'pvc', 'tubería', 'tuberia', 'tubo',
            'varillas', 'varilla', 'cabilla', 'cabillas', 'acero', 'hierro',
            'ladrillos', 'ladrillo', 'bloques', 'bloque',
            'arena', 'piedra', 'gravilla', 'agregados', 'agregado',
            'materiales', 'construcción', 'construccion',
            'palas', 'pala', 'picos', 'pico', 'carretillas', 'carretilla',
            'herramientas', 'herramienta', 'herrajes',
            'cables', 'eléctricos', 'electricidad', 'plomería', 'tuberías'
        }

        # PALABRAS CLAVE: Otros TIPOS DE NEGOCIO (no construcción)
        PALABRAS_OTROS_NEGOCIOS = {
            # Alimentos
            'pollo', 'asado', 'comida', 'restaurante', 'café', 'cafetería',
            'pizza', 'panadería', 'panaderia', 'frutas', 'verduras', 'jugos', 'jugo',
            'hamburguesa', 'empanada', 'arepa', 'carne', 'pescado', 'alimentos',
            # Servicios personales
            'peluquería', 'peluqueria', 'barbería', 'barberia', 'spa', 'farmacia',
            'droguería', 'drogueria', 'supermercado', 'colchonería', 'colchoneria',
            'mueblería', 'muebleria', 'hotel', 'hospedaje', 'botica', 'boutique',
            'pastelería', 'pasteleria', 'heladería', 'heladeria', 'cervecería', 'cerveceria',
            'bar', 'discoteca', 'taller', 'mecánica', 'mecanica', 'lavandera', 'lavandería', 'lavanderia'
        }

        # CONTAR palabras clave de cada categoría
        count_construccion = sum(1 for palabra in PALABRAS_CONSTRUCCION if palabra in ocr_lower)
        count_otros_negocios = sum(1 for palabra in PALABRAS_OTROS_NEGOCIOS if palabra in ocr_lower)

        print(f"      [ANÁLISIS] Img {numero_img}: Construcción={count_construccion}, Otros={count_otros_negocios}")

        # LÓGICA DE VALIDACIÓN GENÉRICA:
        # Si hay palabras de CONSTRUCCIÓN → confiar en los números
        if count_construccion >= 1:
            print(f"      [✓] Contexto de CONSTRUCCIÓN detectado. Números válidos.")
            return telefonos

        # Si hay palabras de OTROS NEGOCIOS pero NINGUNA de construcción → descartar números
        if count_otros_negocios >= 2:
            print(f"      [✗] Contexto de OTRO TIPO DE NEGOCIO (no construcción). Descartando números.")
            return {"whatsapp": "", "fijo": ""}

        # Si hay 1 palabra de otro negocio pero también hay construcción → aceptar
        if count_otros_negocios >= 1 and count_construccion >= 1:
            print(f"      [✓] Contexto mixto, pero hay materiales de construcción. Números válidos.")
            return telefonos

        # Si no hay evidencia clara → ser conservador y descartar
        if count_construccion == 0 and count_otros_negocios == 0:
            print(f"      [?] Contexto unclear. Descartando números por falta de evidencia.")
            return {"whatsapp": "", "fijo": ""}

        return telefonos

    def _unificar(self, gemini: Dict, rekognition: Dict, nombre_negocio: str) -> Dict:
        """
        Unifica resultados con estas prioridades:

        1. MATERIALES: Gemini es la base, Rekognition enriquece
        2. CEMENTO: Si Rekognition OCR detecta marca → usar esa información
        3. TELÉFONO: Rekognition OCR tiene PRIORIDAD sobre Gemini
        4. CONFIANZA: Recalcular basado en información unificada
        5. FALLBACK: Si Gemini falló, usar Rekognition como fallback mínimo
        """
        # Validar que Gemini dio resultado
        if not gemini or isinstance(gemini, str):
            print("   [!] Gemini no dio JSON válido, usando fallback Rekognition")
            return self._fallback_rekognition_solo(rekognition)

        # Base: resultados de Gemini
        materiales = gemini.get("materiales_observados", [])
        if not isinstance(materiales, list):
            materiales = [str(materiales)] if materiales else []

        whatsapp = "" if gemini.get("whatsapp") is None else str(gemini.get("whatsapp", "")).strip()
        telefono = "" if gemini.get("telefono_fijo") is None else str(gemini.get("telefono_fijo", "")).strip()

        # --- PRIORIDAD 1: Teléfono de Rekognition OCR ---
        # Rekognition tiene prioridad, pero usar el MÁS FRECUENTE (votación)
        if rekognition.get("telefonos_encontrados"):
            # Agrupar teléfonos por tipo y contar frecuencia
            telefonos_por_tipo = {}
            for tipo, num in rekognition["telefonos_encontrados"]:
                if tipo not in telefonos_por_tipo:
                    telefonos_por_tipo[tipo] = {}
                telefonos_por_tipo[tipo][num] = telefonos_por_tipo[tipo].get(num, 0) + 1

            # WhatsApp: usar el que aparezca más frecuentemente
            if telefonos_por_tipo.get("whatsapp"):
                # Ordenar por frecuencia descendente
                whatsapp_ordenado = sorted(
                    telefonos_por_tipo["whatsapp"].items(),
                    key=lambda x: x[1],
                    reverse=True
                )
                whatsapp_candidato, frecuencia_wa = whatsapp_ordenado[0]
                # Solo aceptar si aparece al menos 2 veces O si es el único
                if frecuencia_wa >= 2 or len(whatsapp_ordenado) == 1:
                    whatsapp = whatsapp_candidato
                    print(f"    [UNIFICADOR] WhatsApp de Rekognition OCR: {whatsapp} (frecuencia: {frecuencia_wa})")
                else:
                    print(f"    [UNIFICADOR] WhatsApp descartado (aparece solo 1 vez, posible ruido)")

            # NO usar Gemini como fallback para teléfonos (puede alucinar números de otros negocios)
            if not whatsapp:
                print(f"    [UNIFICADOR] WhatsApp: No encontrado en Rekognition, descartando (no usar fallback a Gemini)")

            # Fijo: usar el que aparezca más frecuentemente
            if telefonos_por_tipo.get("fijo"):
                fijo_ordenado = sorted(
                    telefonos_por_tipo["fijo"].items(),
                    key=lambda x: x[1],
                    reverse=True
                )
                fijo_candidato, frecuencia_fijo = fijo_ordenado[0]
                # Solo aceptar si aparece al menos 2 veces O si es el único
                if frecuencia_fijo >= 2 or len(fijo_ordenado) == 1:
                    telefono = fijo_candidato
                    print(f"    [UNIFICADOR] Teléfono fijo de Rekognition OCR: {telefono} (frecuencia: {frecuencia_fijo})")
                else:
                    print(f"    [UNIFICADOR] Teléfono fijo descartado (aparece solo 1 vez, posible ruido)")

            # NO usar Gemini como fallback para teléfonos (puede alucinar números de otros negocios)
            if not telefono:
                print(f"    [UNIFICADOR] Teléfono fijo: No encontrado en Rekognition, descartando (no usar fallback a Gemini)")

        # --- PRIORIDAD 2: Marcas de cemento de Rekognition OCR ---
        # Si Rekognition detecta marca específica en OCR, enriquecer el campo de cemento
        if rekognition.get("marcas_cemento"):
            marcas_detectadas = list(rekognition["marcas_cemento"])
            marcas_conocidas = [
                "ARGOS", "ALION", "HOLCIM", "CEMEX", "ULTRACEM",
                "TEQUENDAMA", "SAN MARCOS", "LAFARGE", "ANDINO",
                "PORTLAND", "PACIFICO"
            ]
            materiales_texto_actual = " ".join([str(m).upper() for m in materiales])
            for marca in marcas_conocidas:
                if marca in materiales_texto_actual and marca not in marcas_detectadas:
                    marcas_detectadas.append(marca)
            marcas_str = ", ".join(marcas_detectadas)
            # Si Gemini ya dijo que vende cemento, agregar las marcas detectadas
            if gemini.get("vende_cemento"):
                # Actualizar el ítem de cemento en materiales
                materiales = [m for m in materiales if "cemento" not in str(m).lower()]
                materiales.append(f"cemento ({marcas_str})")
                print(f"    [UNIFICADOR] Cemento enriquecido con marcas: {marcas_str}")
            else:
                # Incluso si Gemini no detectó cemento, si hay marca específica → vende cemento
                if "cemento" not in str(materiales).lower():
                    materiales.append(f"cemento ({marcas_str})")
                gemini["vende_cemento"] = True
                print(f"    [UNIFICADOR] Cemento detectado por marca en OCR: {marcas_str}")

        # --- PRIORIDAD 3: Marcas de herramientas ---
        if rekognition.get("marcas_herramientas"):
            marcas_herr = ", ".join(rekognition["marcas_herramientas"])
            if "herramientas" not in str(materiales).lower():
                materiales.append(f"herramientas ({marcas_herr})")
                print(f"    [UNIFICADOR] Herramientas detectadas: {marcas_herr}")

        # --- PRIORIDAD 4: Redes Sociales ---
        # Rekognition OCR tiene prioridad para redes sociales (extrae de avisos)
        facebook_final = ""
        instagram_final = ""

        if rekognition.get("redes_sociales_encontradas"):
            redes_rek = rekognition["redes_sociales_encontradas"]

            if redes_rek.get("facebook"):
                facebook_final = redes_rek["facebook"]
                print(f"    [UNIFICADOR] Facebook de Rekognition OCR: {facebook_final}")
            elif gemini.get("facebook"):
                facebook_final = "" if gemini.get("facebook") is None else str(gemini.get("facebook", "")).strip()
                print(f"    [UNIFICADOR] Facebook de Gemini (fallback): {facebook_final}")

            if redes_rek.get("instagram"):
                instagram_final = redes_rek["instagram"]
                print(f"    [UNIFICADOR] Instagram de Rekognition OCR: {instagram_final}")
            elif gemini.get("instagram"):
                instagram_final = "" if gemini.get("instagram") is None else str(gemini.get("instagram", "")).strip()
                print(f"    [UNIFICADOR] Instagram de Gemini (fallback): {instagram_final}")
        else:
            # Fallback: usar Gemini si Rekognition no encontró
            facebook_final = "" if gemini.get("facebook") is None else str(gemini.get("facebook", "")).strip()
            instagram_final = "" if gemini.get("instagram") is None else str(gemini.get("instagram", "")).strip()

        # --- Validación cruzada con etiquetas de Rekognition ---
        # Detectar patrones importantes que Gemini haya podido perder
        etiquetas = rekognition.get("etiquetas_totales", {})
        mat_texto = ", ".join([str(m) for m in materiales]).lower()

        # Ejemplo: si Rekognition detecta "Metal" o "Steel" múltiples veces → probablemente varillas
        if etiquetas.get("Steel", 0) >= 2 or etiquetas.get("Metal", 0) >= 3:
            if "varilla" not in mat_texto:
                materiales.append("varillas (detectado por Rekognition)")
                gemini["vende_varillas"] = True

        # --- Recalcular nivel de confianza ---
        cemento = gemini.get("vende_cemento", False)
        tubos = gemini.get("vende_tubos", False)
        varillas = gemini.get("vende_varillas", False)
        ladrillos = gemini.get("vende_ladrillos", False)
        agregados = gemini.get("vende_agregados", False)

        if cemento:
            nivel = "alto"
            score = 80
        elif tubos or varillas or ladrillos or agregados:
            nivel = "medio"
            score = 60
        else:
            nivel = "bajo"
            score = 20

        # Bonus por teléfono
        if whatsapp:
            score += 10
        if telefono:
            score += 5

        score = min(100, score)  # Cap a 100

        # --- Preparar resultado final ---
        resultado = {
            "vende_cemento": 1 if cemento else 0,
            "vende_tubos": 1 if tubos else 0,
            "vende_varillas": 1 if varillas else 0,
            "vende_ladrillos": 1 if ladrillos else 0,
            "vende_agregados": 1 if agregados else 0,
            "materiales_observados": materiales,
            "whatsapp": whatsapp,
            "telefono_fijo": telefono,
            "facebook": facebook_final,
            "instagram": instagram_final,
            "nivel_confianza": nivel,
            "score_confianza": score
        }

        return resultado

    def _fallback_rekognition_solo(self, rekognition: Dict) -> Dict:
        """
        Si Gemini falló completamente, usar Rekognition como fallback.
        Estrategia conservadora: solo detectar si hay evidencia clara.
        """
        cemento = False
        tubos = False
        varillas = False
        ladrillos = False
        agregados = False
        materiales = []

        # Buscar marcas específicas de cemento
        if rekognition.get("marcas_cemento"):
            cemento = True
            marcas_str = ", ".join(rekognition["marcas_cemento"])
            materiales.append(f"cemento ({marcas_str})")

        # Buscar palabras clave en OCR
        texto_ocr = (rekognition.get("texto_ocr_concatenado", "")).lower()

        if "tubo" in texto_ocr or "pvc" in texto_ocr or "tubería" in texto_ocr:
            tubos = True
            materiales.append("tubos")

        if "varilla" in texto_ocr or "cabilla" in texto_ocr or "rebar" in texto_ocr:
            varillas = True
            materiales.append("varillas")

        if "ladrillo" in texto_ocr or "bloque" in texto_ocr:
            ladrillos = True
            materiales.append("ladrillos")

        if "arena" in texto_ocr or "piedra" in texto_ocr or "gravilla" in texto_ocr or "agregado" in texto_ocr:
            agregados = True
            materiales.append("agregados")

        # Teléfono y redes sociales
        whatsapp = ""
        telefono = ""
        facebook = ""
        instagram = ""

        if rekognition.get("telefonos_encontrados"):
            for tipo, num in rekognition["telefonos_encontrados"]:
                if tipo == "whatsapp":
                    whatsapp = num
                elif tipo == "fijo":
                    telefono = num

        if rekognition.get("redes_sociales_encontradas"):
            redes = rekognition["redes_sociales_encontradas"]
            facebook = redes.get("facebook", "")
            instagram = redes.get("instagram", "")

        # Calcular confianza (conservadora)
        if cemento:
            nivel = "medio"
            score = 50
        elif tubos or varillas or ladrillos or agregados:
            nivel = "bajo"
            score = 30
        else:
            nivel = "bajo"
            score = 10

        if whatsapp:
            score += 10
        if telefono:
            score += 5
        if facebook or instagram:
            score += 5

        score = min(100, score)

        return {
            "vende_cemento": 1 if cemento else 0,
            "vende_tubos": 1 if tubos else 0,
            "vende_varillas": 1 if varillas else 0,
            "vende_ladrillos": 1 if ladrillos else 0,
            "vende_agregados": 1 if agregados else 0,
            "materiales_observados": materiales,
            "whatsapp": whatsapp,
            "telefono_fijo": telefono,
            "facebook": facebook,
            "instagram": instagram,
            "nivel_confianza": nivel,
            "score_confianza": score,
            "error": "Gemini falló, usando fallback Rekognition OCR"
        }

    @staticmethod
    def _base64_a_bytes(imagen_b64: str) -> bytes:
        """Convierte base64 a bytes para Rekognition."""
        import base64
        return base64.b64decode(imagen_b64)
