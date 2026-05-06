import os
import pandas as pd
import numpy as np
from typing import Optional
from interfaces import BuscadorLugaresInterface, AnalizadorImagenesInterface
from database import get_db_connection
from services import clasificar_numero_colombiano, seleccionar_mejores_imagenes

class ProcesadorRUES:
    def __init__(self, buscador: BuscadorLugaresInterface, analizador: AnalizadorImagenesInterface):
        self.buscador = buscador
        self.analizador = analizador

    def orquestar_flujo_completo(self, ruta_excel: str, file_id: str):
        print(f"\n[>] Iniciando orquestacin dinmica. ID de proceso: {file_id}")

        carga_exitosa = self._cargar_excel_masivo(ruta_excel, file_id)

        if os.path.exists(ruta_excel):
            os.remove(ruta_excel)
            print(f" Archivo temporal eliminado del servidor.")

        if not carga_exitosa:
            self._actualizar_estado_upload(file_id, "failed")
            return

        self._procesar_por_batch(file_id)

    # ------------------------------------------------------------------
    # CARGA MASIVA (sin cambios respecto al original)
    # ------------------------------------------------------------------
    def _cargar_excel_masivo(self, ruta_excel: str, file_id: str) -> bool:
        try:
            df = pd.read_excel(ruta_excel)
            df.columns = df.columns.str.strip().str.lower()
            if len(df) == 0:
                print("[!] El archivo Excel no contiene registros.")
                return False
            df = df.replace({np.nan: None})
        except Exception as e:
            print(f"[X] Error al procesar el archivo Excel: {e}")
            return False

        conexion = get_db_connection()
        if not conexion:
            return False

        cursor = conexion.cursor()
        sql_call = "{CALL SP_INSERTARREGISTRORUES (?,?,?,?,?,?,?,?,?,?,?)}"

        def safe_str(val, max_len):
            return str(val).strip()[:max_len] if val is not None else ""

        valores_masivos = []
        for _, row in df.iterrows():
            valores_masivos.append((
                file_id,
                safe_str(row.get("razon_social"), 500),
                safe_str(row.get("numero_identificacion"), 50),
                safe_str(row.get("tipo_identificacion"), 50),
                safe_str(row.get("departamento"), 100),
                safe_str(row.get("municipio"), 100),
                safe_str(row.get("direccion_comercial"), 500),
                safe_str(row.get("correo_comercial"), 255),
                safe_str(row.get("rep_legal"), 255),
                float(row.get("latitud")) if row.get("latitud") else None,
                float(row.get("longitud")) if row.get("longitud") else None
            ))

        try:
            print(f"[DEBUG] Ejecutando {sql_call} con {len(valores_masivos)} registros")
            cursor.fast_executemany = True
            cursor.executemany(sql_call, valores_masivos)
            conexion.commit()
            print(f"[OK] Carga masiva exitosa: {len(valores_masivos)} registros en RUES_RECORDS.")
            return True
        except Exception as e:
            print(f"[X] Error ejecutando SP_INSERTARREGISTRORUES: {e}")
            print(f"[X] Tipo de error: {type(e).__name__}")
            import traceback
            traceback.print_exc()
            conexion.rollback()
            return False
        finally:
            conexion.close()

    # ------------------------------------------------------------------
    # ANÁLISIS DE PERSONA NATURAL VS EMPRESA (para RUES)
    # ------------------------------------------------------------------
    def _extraer_nombre_empresa_de_rues(self, fila: dict) -> Optional[str]:
        """
        Estrategia mejorada para RUES:
        1. Analizar razon_social con IA para determinar si es persona natural
        2. Si es persona natural:
           a. Si email tiene dominio empresarial: usar nombre del email
           b. Si email es personal (gmail, hotmail): RETORNAR NONE para buscar por direccion
        3. Si es empresa: usar razon_social

        Retorna el nombre de la empresa a buscar en Google Maps, o None para buscar por direccion.
        """
        razon_social = (fila.get("razon_social") or "").strip()
        email = (fila.get("correo_comercial") or "").strip()

        print(f"   [*] Analizando razon_social con IA: '{razon_social}'", flush=True)

        # Paso 1: Determinar si es persona natural
        analisis = self.analizador.analizar_razon_social(razon_social)
        es_persona_natural = analisis.get("es_persona_natural", False)
        confianza = analisis.get("confianza", "baja")

        print(f"      > Es persona natural: {es_persona_natural} (confianza: {confianza})", flush=True)

        # Si es empresa directamente, usar la razon_social
        if analisis.get("es_empresa") and confianza in ["alta", "media"]:
            print(f"      > Es empresa por razon_social, usandola como nombre: '{razon_social}'", flush=True)
            return razon_social

        # Si es persona natural, validar email
        if es_persona_natural:
            if not email:
                print(f"      > Persona natural sin email. Buscara por direccion+municipio", flush=True)
                return None

            print(f"      > Analizando email: '{email}'", flush=True)

            # Validar dominio
            validacion_dominio = self.analizador.validar_dominio_empresarial(email)
            es_dominio_empresarial = validacion_dominio.get("es_dominio_empresarial", False)
            dominio = validacion_dominio.get("dominio", "")

            if es_dominio_empresarial:
                print(f"      > Dominio empresarial detectado: '{dominio}'", flush=True)

                # Extraer nombre antes del @
                nombre_empresa = self.analizador.extraer_nombre_empresa_de_email(email)
                if nombre_empresa:
                    print(f"      > Nombre extraido del email: '{nombre_empresa}'", flush=True)

                    # Validar que la empresa venda materiales de construcción
                    validacion = self.analizador.validar_empresa_vende_construccion(nombre_empresa)
                    vende_construccion = validacion.get("vende_materiales_construccion", False)
                    confianza_empresa = validacion.get("confianza", "baja")
                    tipos = validacion.get("tipo_materiales", [])

                    print(f"      > Vende construccion: {vende_construccion} (confianza: {confianza_empresa}, tipos: {tipos})", flush=True)

                    if vende_construccion and confianza_empresa in ["alta", "media"]:
                        return nombre_empresa

            # Dominio personal (gmail, hotmail, etc.) - BUSCAR POR DIRECCION, NO POR NOMBRE
            print(f"      > Dominio personal ('{dominio}') o email invalido. Buscara por direccion+municipio+radio", flush=True)
            print(f"      > [ESTRATEGIA] Nearby search por palabras clave: ferreteria, deposito, materiales construccion", flush=True)
            return None

        return None

    # ------------------------------------------------------------------
    # PROCESAMIENTO POR BATCH  flujo completo igual al Node.js
    # ------------------------------------------------------------------
    def _procesar_por_batch(self, file_id: str):
        print("\n Arrancando motor de bsqueda y anlisis de IA...")
        conexion = get_db_connection()
        if not conexion:
            return
        cursor = conexion.cursor()

        cursor.execute(
            "SELECT * FROM RUES_RECORDS WHERE FILE_ID = ? AND PROCESSED = 0", (file_id,)
        )
        columns = [col[0].lower() for col in cursor.description]
        filas_raw = cursor.fetchall()

        for row in filas_raw:
            fila = dict(zip(columns, row))
            print(f"\n[!] Analizando: {fila['razon_social']} ({fila['municipio']})")

            # --- Validaciones mnimas (igual que Node.js) ---
            dir_comercial = (fila.get("direccion_comercial") or "").strip()
            municipio = (fila.get("municipio") or "").strip()
            departamento = (fila.get("departamento") or "").strip()

            if not dir_comercial or len(dir_comercial) < 5:
                print("   [!] Sin direccin comercial vlida, saltando...")
                self._marcar_como_procesado(cursor, fila["record_id"])
                conexion.commit()
                continue

            if not municipio:
                print("   [!] Sin municipio, saltando...")
                self._marcar_como_procesado(cursor, fila["record_id"])
                conexion.commit()
                continue

            # NUEVO: Intenta extraer nombre de empresa si es persona natural
            nombre_para_buscar = self._extraer_nombre_empresa_de_rues(fila)
            buscar_por_keywords = False  # Flag para indicar si buscar por keywords en lugar de nombre

            if nombre_para_buscar:
                print(f"   [*] Usará nombre para búsqueda en Google Maps: '{nombre_para_buscar}'")
            else:
                # Persona natural con dominio personal: buscar por keywords de construcción
                # en lugar de por nombre (que es el nombre de la persona, no del negocio)
                nombre_para_buscar = "ferretería depósito materiales construcción"
                buscar_por_keywords = True
                print(f"   [*] Persona natural con email personal. Buscará por keywords de construcción en dirección")

            # --- Geocodificacion si no hay coordenadas ---
            lat = fila.get("latitud")
            lng = fila.get("longitud")

            if not lat or not lng or lat == 0.0 or lng == 0.0:
                # Intento 1: Geocodificar la direccion exacta
                lat, lng, exacta = self.buscador.geocodificar_direccion(
                    dir_comercial, municipio, departamento
                )

                # Si falla, intento 2: Geocodificar solo municipio + departamento
                if not lat or not lng:
                    print("   [!] Geocodificacion de direccion fallo, intentando geocodificar municipio...")
                    lat, lng, exacta = self.buscador.geocodificar_direccion(
                        "", municipio, departamento
                    )
                    if lat and lng:
                        print(f"   [*] Usando coordenadas del municipio: {lat}, {lng}")

                if not lat or not lng:
                    print("   [!] No se pudo geocodificar, saltando...")
                    self._marcar_como_procesado(cursor, fila["record_id"])
                    conexion.commit()
                    continue

                if not exacta:
                    print(f"   [!] Ubicacion aproximada (municipio/departamento)")
                # Actualizar fila con las coords obtenidas para que el SP las reciba
                fila["latitud"] = lat
                fila["longitud"] = lng

            print(f"    {lat}, {lng}")

            # --- Busqueda del negocio (estrategia 3 pasos) ---
            email = fila.get("correo_comercial") or ""
            lugar = self.buscador.buscar_lugar(lat, lng, nombre_para_buscar, email=email)

            if not lugar:
                print("   [!] No se encontro negocio en ubicacion exacta, registrando con confianza baja...")
                # Guardar registro con confianza BAJA indicando que no se encontró nada
                analisis_sin_datos = {
                    "vende_cemento": False,
                    "vende_tubos": False,
                    "vende_varillas": False,
                    "vende_ladrillos": False,
                    "vende_agregados": False,
                    "materiales_observados": [],
                    "nivel_confianza": "bajo",
                    "whatsapp": "",
                    "telefono_fijo": ""
                }
                lugar_sin_datos = {
                    "name": fila["razon_social"],  # Usar el nombre de RUES
                    "geometry": {"location": {"lat": lat, "lng": lng}}
                }
                self._guardar_resultado_final(cursor, fila, lugar_sin_datos, analisis_sin_datos)
                self._marcar_como_procesado(cursor, fila["record_id"])
                conexion.commit()
                continue

            print(f"   [*] {lugar.get('name')}")

            # --- Obtener detalles del lugar (telfono) ---
            place_id = lugar.get("place_id", "")
            detalles = self.buscador.obtener_detalles_lugar(place_id) if place_id else {}
            telefono_google = detalles.get("formatted_phone_number", "")

            # --- Obtener fotos del usuario (hasta 20) ---
            fotos_usuario = self.buscador.obtener_fotos_base64(lugar, max_fotos=20)

            # --- Obtener Street View (8 ngulos  2 pasadas) ---
            fotos_sv = self.buscador.obtener_street_view(lat, lng)

            # --- Seleccionar las mejores 10 imgenes ---
            imagenes_finales = seleccionar_mejores_imagenes(fotos_usuario, fotos_sv, max_total=10)
            print(f"    {len(fotos_usuario)} fotos usuario + {len(fotos_sv)} Street View  enviando {len(imagenes_finales)} a Gemini")

            if not imagenes_finales:
                print("   [!] Sin imgenes para analizar, saltando...")
                self._marcar_como_procesado(cursor, fila["record_id"])
                conexion.commit()
                continue

            # --- Anlisis con Gemini ---
            analisis_ia = self.analizador.analizar_fotos(imagenes_finales, lugar.get("name", fila["razon_social"]))

            # --- Estrategia de 2 niveles: Google > Gemini ---
            # Nivel 1: Google Places (máxima confianza)
            telefono_final = ""
            whatsapp_final = ""

            if telefono_google:
                clasificado = clasificar_numero_colombiano(telefono_google)
                if clasificado["tipo"] == "whatsapp":
                    whatsapp_final = clasificado["limpio"]
                    print(f"    WhatsApp (Google Places): {whatsapp_final}")
                elif clasificado["tipo"] == "fijo":
                    telefono_final = clasificado["limpio"]
                    print(f"    Telfono (Google Places): {telefono_final}")

            # Nivel 2: Si Google no tiene, intentar Gemini (analizó Street View + fotos propias)
            # Pero con validación ESTRICTA - solo números realmente visibles
            if not whatsapp_final and analisis_ia.get("whatsapp"):
                gemini_wa = str(analisis_ia["whatsapp"]).strip()
                # Validar: EXACTAMENTE 10 dígitos, empieza con 3, todos dígitos
                if gemini_wa and len(gemini_wa) == 10 and gemini_wa[0] == '3' and gemini_wa.isdigit():
                    # Validación adicional: no aceptar si parece alucinación (ej: números secuenciales)
                    if gemini_wa not in ["3111111111", "3222222222", "3333333333", "3444444444", "3555555555", "3666666666", "3777777777", "3888888888", "3999999999"]:
                        whatsapp_final = gemini_wa
                        print(f"    WhatsApp (Gemini desde fotos): {whatsapp_final}")

            if not telefono_final and analisis_ia.get("telefono_fijo"):
                gemini_tel = str(analisis_ia["telefono_fijo"]).strip()
                # Validar: 7-8 dígitos (fijo local) O 10 con indicativo 604/605
                if gemini_tel and gemini_tel.isdigit():
                    if 7 <= len(gemini_tel) <= 8:
                        # Rechazar si parece alucinación
                        if gemini_tel not in ["1111111", "2222222", "3333333", "4444444", "5555555", "6666666", "7777777", "8888888", "9999999"]:
                            telefono_final = gemini_tel
                            print(f"    Telfono (Gemini desde fotos): {telefono_final}")
                    elif len(gemini_tel) == 10 and gemini_tel[:3] in ["604", "605"]:
                        telefono_final = gemini_tel
                        print(f"    Telfono (Gemini desde fotos, con indicativo): {telefono_final}")

            # Inyectar en el dict de IA para que _guardar_resultado_final lo use
            analisis_ia["whatsapp"] = whatsapp_final
            analisis_ia["telefono_fijo"] = telefono_final

            # --- Guardar resultado ---
            self._guardar_resultado_final(cursor, fila, lugar, analisis_ia)
            self._marcar_como_procesado(cursor, fila["record_id"])
            conexion.commit()

        self._actualizar_estado_upload(file_id, "completed")
        conexion.close()
        print("\n PROCESO COMPLETO FINALIZADO EXITOSAMENTE")

    # ------------------------------------------------------------------
    # GUARDAR RESULTADO FINAL (sin cambios)
    # ------------------------------------------------------------------
    def _guardar_resultado_final(self, cursor, fila, lugar: dict, analisis_ia: dict):
        nombre_google = lugar.get("name", "")[:255]
        telefono = str(analisis_ia.get("telefono_fijo", ""))[:50]
        whatsapp = str(analisis_ia.get("whatsapp", ""))[:50]

        # Gemini devuelve "materiales_observados", no "productos_observados"
        productos = analisis_ia.get("materiales_observados", analisis_ia.get("productos_observados", []))
        if not isinstance(productos, list):
            productos = [str(productos)] if productos else []

        # Texto de materiales para validacin cruzada (igual que Node.js)
        mat_texto = ", ".join([str(p) for p in productos]).lower()

        # Validacin cruzada: si el material aparece en el texto, fuerza el flag a true
        v_tub = 1 if (analisis_ia.get("vende_tubos") or "tubo" in mat_texto) else 0
        # Varillas: igual, solo boolean  fcil de confundir con tubos o barras
        v_var = 1 if analisis_ia.get("vende_varillas") else 0
        # Ladrillos: SOLO el boolean de Gemini  la validacin cruzada da falsos positivos
        v_lad = 1 if analisis_ia.get("vende_ladrillos") else 0
        v_agr = 1 if (analisis_ia.get("vende_agregados") or "agregado" in mat_texto
                      or "arena" in mat_texto or "piedra" in mat_texto or "gravilla" in mat_texto) else 0

        # Cemento: flag IA + validacin cruzada + fallback por nombre del negocio
        nombre_lower = nombre_google.lower()
        # Palabras en el nombre que confirman venta de cemento
        palabras_cemento_fuerte = ["cemento", "argos", "holcim", "tequendama", "cemex", "colclinker",
                                   "materiales de construccion", "materiales de construccin", "concreto"]
        # Palabras dbiles: solo aplican si Gemini detect ALGO (no nivel bajo)
        palabras_cemento_debil = ["ferreteria", "ferretera", "materiales", "deposito", "depsito",
                                  "construccion", "construccin"]

        cemento_en_materiales = "cemento" in mat_texto
        cemento_por_nombre_fuerte = any(p in nombre_lower for p in palabras_cemento_fuerte)

        # Fallback dbil: si no hay fotos propias, aplicar igual (Street View puede ser ciego)
        tiene_fotos_propias = len(fotos_usuario) > 0 if hasattr(self, '_fotos_usuario_count') else False
        nivel_ia = str(analisis_ia.get("nivel_confianza", "bajo")).lower()
        sin_materiales = len(productos) == 0
        cemento_por_nombre_debil = (
            (nivel_ia != "bajo" or sin_materiales)  # ciego o detect algo
            and any(p in nombre_lower for p in palabras_cemento_debil)
        )

        v_cem = 1 if (analisis_ia.get("vende_cemento") or analisis_ia.get("vende_lo_que_buscamos")
                      or cemento_en_materiales or cemento_por_nombre_fuerte or cemento_por_nombre_debil) else 0

        if not analisis_ia.get("vende_cemento") and not cemento_en_materiales:
            if cemento_por_nombre_fuerte:
                print(f"    Cemento detectado por nombre (fuerte): '{nombre_google}'")
                productos.append("cemento_por_nombre")
            elif cemento_por_nombre_debil:
                print(f"    Cemento detectado por nombre + IA vio algo: '{nombre_google}'")
                productos.append("cemento_por_nombre")

        # Recalcular nivel_confianza basado en flags corregidos
        # IMPORTANTE: leer confianza DESPUS del recalculo
        if v_cem:
            confianza = "alto"
        elif v_tub or v_var or v_lad or v_agr:
            confianza = "medio"
        else:
            confianza = str(analisis_ia.get("nivel_confianza", "bajo"))[:20]

        # Limpiar materiales que Gemini alucin (contradicen los flags finales)
        materiales_falsos = []
        if not v_lad:
            materiales_falsos += ["ladrillo", "ladrillos", "bloque", "bloques"]
        if not v_var:
            materiales_falsos += ["varilla", "varillas", "cabilla", "cabillas"]
        if not v_tub:
            materiales_falsos += ["tubo", "tubos", "tubera", "tuberia", "tubos pvc"]
        if not v_agr:
            materiales_falsos += ["arena", "piedra", "gravilla", "agregado", "agregados", "recebo", "triturado"]

        productos_limpios = [
            p for p in productos
            if not any(falso in str(p).lower() for falso in materiales_falsos)
        ]
        mat_obs = ", ".join([str(p) for p in productos_limpios])[:500]

        score = 20
        if v_cem: score += 40
        if whatsapp: score += 15
        if telefono: score += 10
        if confianza.lower() == "alto": score += 10

        parametros = (
            nombre_google, telefono, whatsapp,
            fila["numero_identificacion"], fila["latitud"], fila["longitud"],
            v_cem, v_tub, v_var, v_lad, v_agr,
            score, mat_obs, confianza,
            fila["razon_social"], fila["tipo_identificacion"], fila["numero_identificacion"],
            fila["departamento"], fila["municipio"], fila["direccion_comercial"],
            fila["correo_comercial"], fila["rep_legal"]
        )

        try:
            sql_final = "{CALL SP_GUARDARRESULTADOFINAL (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)}"
            cursor.execute(sql_final, parametros)
            print(f"   [OK] Guardado: {nombre_google} | Cem:{v_cem} | WA:{whatsapp or 'NO'} | Tel:{telefono or 'NO'} | Score:{score}")
        except Exception as e:
            print(f"   [X] Error en SP_GUARDARRESULTADOFINAL: {e}")

    def _marcar_como_procesado(self, cursor, record_id: int):
        cursor.execute("{CALL SP_MARCARREGISTROPROCESADO (?)}", (record_id,))

    def _actualizar_estado_upload(self, file_id: str, estado: str):
        conexion = get_db_connection()
        if conexion:
            cursor = conexion.cursor()

            # Contar registros procesados
            cursor.execute(
                "SELECT COUNT(*) FROM RUES_RECORDS WHERE FILE_ID = ? AND PROCESSED = 1", (file_id,)
            )
            registros_procesados = cursor.fetchone()[0]

            # Actualizar estado y contador
            cursor.execute(
                "UPDATE RUES_UPLOADS SET STATUS = ?, REGISTROS_PROCESADOS = ?, FECHA_ACTUALIZACION = GETDATE(), MENSAJE = ? WHERE FILE_ID = ?",
                (estado, registros_procesados, f"[OK] Completado {registros_procesados} registros procesados", file_id)
            )
            conexion.commit()
            conexion.close()
