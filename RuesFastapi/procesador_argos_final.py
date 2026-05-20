import os
import sys
import json
import pandas as pd
import numpy as np
from interfaces import BuscadorLugaresInterface, AnalizadorImagenesInterface
from database import get_db_connection
from services import clasificar_numero_colombiano
import data_access

class ProcesadorArgos:
    def __init__(self, buscador: BuscadorLugaresInterface, analizador: AnalizadorImagenesInterface):
        self.buscador = buscador
        self.analizador = analizador

    def _clasificar_nombre(self, nombre: str) -> str:
        """
        Clasifica si un nombre es EMPRESA o PERSONA.
        Intenta con Gemini primero, fallback a palabras clave si falla.
        Retorna: "empresa" o "persona"
        """
        if not nombre or not nombre.strip():
            return "desconocido"

        # Lista de palabras clave para detectar empresas
        palabras_empresa = [
            'sas', 's.a.s.', 'ltda', 'ltda.', 's.a.', 'empresa', 'deposito', 'depsito',
            'ferreteria', 'ferretera', 'tienda', 'comercial', 'distribuidora', 'distribuidor',
            'centro', 'almacen', 'almacn', 'plaza', 'spa', 'cafe', 'restaurant', 'taller',
            'inc.', 'corp', 'sociedad', 'cooperativa', 'grupo', 'compaa'
        ]

        nombre_lower = nombre.lower().strip()

        # PRIMERO intentar con Gemini (rpido)
        try:
            prompt = f"Es '{nombre}' un nombre de EMPRESA o de PERSONA NATURAL? Responde solo: 'empresa' o 'persona'"
            resultado = self.analizador.generar_respuesta_simple(prompt)
            if resultado and ('empresa' in resultado.lower() or 'person' in resultado.lower()):
                if 'empresa' in resultado.lower():
                    return "empresa"
                else:
                    return "persona"
        except Exception as e:
            print(f"   [!] Gemini clasificacin fall, usando palabras clave: {e}")

        # FALLBACK: Palabras clave
        for palabra in palabras_empresa:
            if palabra in nombre_lower:
                return "empresa"

        # Si no tiene palabras clave, probablemente es persona
        return "persona"

    def _determinar_giro_negocio(self, nombre: str) -> str:
        """
        Determina el giro del negocio basado en palabras clave del nombre.
        Retorna: "construccion", "alimentos", "farmacia", "desconocido", etc.
        """
        if not nombre or not nombre.strip():
            return "desconocido"

        nombre_lower = nombre.lower()

        # Palabras clave por categora
        palabras_construccion = [
            'ferreteria', 'ferretera', 'deposito', 'depsito', 'construccion', 'construccin',
            'materiales', 'cemento', 'tubos', 'varilla', 'ladrillo', 'herrajes', 'hardware'
        ]
        palabras_alimentos = [
            'colanta', 'cooperativa', 'lecheria', 'lechera', 'leche', 'alimentos',
            'distribuidor', 'alimento', 'carne', 'queso', 'yogur', 'lcteos'
        ]
        palabras_farmacia = [
            'farmacia', 'drogueria', 'droguera', 'medicinas', 'medicamento', 'farmacutica'
        ]
        palabras_retail = [
            'supermercado', 'tienda', 'mercado', 'comercio', 'almacn', 'almacen'
        ]

        # Buscar en orden de prioridad
        for palabra in palabras_construccion:
            if palabra in nombre_lower:
                return "construccion"

        for palabra in palabras_alimentos:
            if palabra in nombre_lower:
                return "alimentos"

        for palabra in palabras_farmacia:
            if palabra in nombre_lower:
                return "farmacia"

        for palabra in palabras_retail:
            if palabra in nombre_lower:
                return "retail"

        return "desconocido"

    def _obtener_productos_por_gemini(self, nombre_empresa: str) -> dict:
        """
        Para empresas que NO son construccion (alimentos, farmacia, retail),
        usa Gemini para obtener lista de productos que vende.
        Retorna dict con materiales_observados listos para guardar en BD.
        """
        try:
            prompt = f"""Eres un experto clasificador de empresas colombianas.
Basándote SOLO en el nombre de la empresa: "{nombre_empresa}"

1. Identifica el ramo/sector específico (lechería, farmacia, restaurante, etc.)
2. Lista 5-8 productos ESPECÍFICOS que vende (NO genéricos)

IMPORTANTE:
- Si ves "Colanta", "Cooperativa", "Lechería" → productos lácteos específicos
- Si ves "Droguería", "Farmacia" → medicinas, vitaminas
- Si ves "Café", "Restaurant", "Panadería" → alimentos específicos
- Nunca respondas "Productos diversos"

Responde SOLO con una lista de productos específicos en español, separados por comas.
Ejemplo correcto: "Leche entera, Queso campesino, Mantequilla, Yogur natural, Crema"
Ejemplo INCORRECTO: "Productos diversos del ramo"
"""

            respuesta = self.analizador.generar_respuesta_simple(prompt)

            if respuesta and respuesta.strip() and "productos diversos" not in respuesta.lower():
                # Convertir string a lista
                productos = [p.strip() for p in respuesta.split(',') if p.strip()]
                if productos:
                    print(f"   [OK] Productos obtenidos: {productos}")
                    return {
                        'materiales_observados': productos,
                        'nivel_confianza': 'bajo',
                        'score_confianza': 30
                    }
        except Exception as e:
            print(f"   [!] Error al obtener productos: {e}")

        # Si falla o respuesta es genérica, retornar vacío
        return {}

    def orquestar_flujo_completo(self, ruta_excel: str, file_id: str):
        """Versin clsica: lee archivo Excel desde ruta."""
        print(f"\n[>] Iniciando orquestacin Argos. ID de proceso: {file_id}")

        carga_exitosa = self._cargar_excel_masivo(ruta_excel, file_id)

        if os.path.exists(ruta_excel):
            os.remove(ruta_excel)
            print(f" Archivo temporal eliminado del servidor.")

        if not carga_exitosa:
            data_access.argos_marcar_como_fallido(file_id, "Error en la carga masiva del archivo Excel")
            return

        self._procesar_por_batch_deduplicado(file_id)

    def orquestar_flujo_completo_dataframe_desde_archivo(self, file_id: str, ruta_temporal: str, df_temp: str):
        """Lee DataFrame desde archivo pickle (para background tasks)."""
        try:
            import pickle
            with open(df_temp, "rb") as f:
                df = pickle.load(f)
            print(f"[OK] DataFrame cargado desde {df_temp}")
            self.orquestar_flujo_completo_dataframe(df, file_id, ruta_temporal)
        except Exception as e:
            print(f"[ERROR] cargando DataFrame: {e}")
            data_access.argos_marcar_como_fallido(file_id, f"Error cargando DataFrame: {str(e)}")
        finally:
            # Limpiar archivo temporal
            try:
                if os.path.exists(df_temp):
                    os.remove(df_temp)
            except:
                pass

    def orquestar_flujo_completo_dataframe(self, df: pd.DataFrame, file_id: str, ruta_temporal: str = None):
        """Versin mejorada: recibe DataFrame ya filtrado desde el endpoint."""
        print(f"\n[>] Iniciando orquestacin Argos. ID de proceso: {file_id}")

        carga_exitosa = self._cargar_dataframe_masivo(df, file_id)

        if ruta_temporal and os.path.exists(ruta_temporal):
            os.remove(ruta_temporal)
            print(f" Archivo temporal eliminado del servidor.")

        if not carga_exitosa:
            data_access.argos_marcar_como_fallido(file_id, "Error en la carga masiva del DataFrame")
            return

        self._procesar_por_batch_deduplicado(file_id)

    # ------------------------------------------------------------------
    # CARGA MASIVA
    # ------------------------------------------------------------------
    def _cargar_excel_masivo(self, ruta_excel: str, file_id: str) -> bool:
        try:
            df = pd.read_excel(ruta_excel)
            df.columns = df.columns.str.strip()
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
        sql_call = """
            INSERT INTO ARGOS_RECORDS (
                FILE_ID, CANAL, CODIGO_CLIENTE, NOMBRE_CUENTA, NOMBRE_OBRA,
                NOMBRE_COMPLETO, CARGO, ROL, GENERO, MOVIL,
                DIRECCION, MUNICIPIO, DEPARTAMENTO, ES_PUNTO_VENTA_PUBLICO,
                HABEAS_DATA, MEDIO_AUTORIZACION_HABEAS, FECHA_AUTORIZACION_HABEAS, HABEAS_DATA_FIRMADO
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """

        def safe_str(val, max_len):
            return str(val).strip()[:max_len] if val is not None else ""

        def safe_date(val):
            if pd.isna(val):
                return None
            if isinstance(val, str):
                try:
                    return pd.to_datetime(val).date()
                except:
                    return None
            return val

        def safe_bool(val):
            if pd.isna(val):
                return None
            if isinstance(val, bool):
                return val
            if isinstance(val, (int, float)):
                return bool(val)
            if isinstance(val, str):
                return val.lower() in ('1', 'si', 's', 'true', 'yes', 'y')
            return None

        try:
            exito_count = 0
            for _, row in df.iterrows():
                result = data_access.argos_insertar_registro(
                    file_id,
                    safe_str(row.get("Canal"), 50),
                    safe_str(row.get("Código de cliente"), 50),
                    safe_str(row.get("Nombre de la cuenta"), 255),
                    safe_str(row.get("Nombre de la obra/Nombre 2"), 255),
                    safe_str(row.get("Nombre completo"), 255),
                    safe_str(row.get("Cargo"), 100),
                    safe_str(row.get("Rol"), 100),
                    safe_str(row.get("Género"), 20),
                    safe_str(row.get("Móvil"), 50),
                    safe_str(row.get("Dirección"), 500),
                    safe_str(row.get("Población: Población"), 100),
                    safe_str(row.get("Departamento"), 100),
                    safe_bool(row.get("Es punto de Venta al Público")),
                    safe_bool(row.get("Habeas data")),
                    safe_str(row.get("Medio de autorizacion de habeas data"), 255),
                    safe_date(row.get("Fecha de autorización habeas data")),
                    safe_bool(row.get("HABEAS DATA FIRMADO SI / NO"))
                )
                if result:
                    exito_count += 1

            print(f"[OK] Carga masiva: {exito_count} registros insertados")
            return exito_count > 0
        except Exception as e:
            print(f"[X] Error en carga masiva: {e}")
            import traceback
            traceback.print_exc()
            return False

    def _cargar_dataframe_masivo(self, df: pd.DataFrame, file_id: str) -> bool:
        """
        Carga un DataFrame ya filtrado (sin leer archivo).
        Usada cuando el endpoint pre-filtra por departamento/municipio.
        """
        try:
            if len(df) == 0:
                print(f"[!] El DataFrame filtrado no contiene registros.", flush=True)
                print(f"[ARGOS] Marcando file_id={file_id} como 'sin datos'", flush=True)
                # Esto no debería suceder si el endpoint validó correctamente
                # pero si pasa, marcar como no_data en lugar de failed
                data_access.argos_marcar_sin_datos(file_id)
                return False
            print(f"[OK] Carga masiva: {len(df)} registros a insertar en ARGOS_RECORDS.", flush=True)
            df = df.replace({np.nan: None})
        except Exception as e:
            print(f"[X] Error al procesar DataFrame: {e}", flush=True)
            import traceback
            traceback.print_exc(file=sys.stdout)
            return False

        def safe_str(val, max_len):
            return str(val).strip()[:max_len] if val is not None else ""

        def safe_date(val):
            if pd.isna(val):
                return None
            if isinstance(val, str):
                try:
                    return pd.to_datetime(val).date()
                except:
                    return None
            return val

        def safe_bool(val):
            if pd.isna(val):
                return None
            if isinstance(val, bool):
                return val
            if isinstance(val, (int, float)):
                return bool(val)
            if isinstance(val, str):
                return val.lower() in ('1', 'si', 's', 'true', 'yes', 'y')
            return None

        try:
            exito_count = 0
            for _, row in df.iterrows():
                result = data_access.argos_insertar_registro(
                    file_id,
                    safe_str(row.get("Canal"), 50),
                    safe_str(row.get("Código de cliente"), 50),
                    safe_str(row.get("Nombre de la cuenta"), 255),
                    safe_str(row.get("Nombre de la obra/Nombre 2"), 255),
                    safe_str(row.get("Nombre completo"), 255),
                    safe_str(row.get("Cargo"), 100),
                    safe_str(row.get("Rol"), 100),
                    safe_str(row.get("Género"), 20),
                    safe_str(row.get("Móvil"), 50),
                    safe_str(row.get("Dirección"), 500),
                    safe_str(row.get("Población: Población"), 100),
                    safe_str(row.get("Departamento"), 100),
                    safe_bool(row.get("Es punto de Venta al Público")),
                    safe_bool(row.get("Habeas data")),
                    safe_str(row.get("Medio de autorizacion de habeas data"), 255),
                    safe_date(row.get("Fecha de autorización habeas data")),
                    safe_bool(row.get("HABEAS DATA FIRMADO SI / NO"))
                )
                if result:
                    exito_count += 1

            print(f"[OK] Carga masiva: {exito_count} registros insertados")
            return exito_count > 0
        except Exception as e:
            print(f"[X] Error en carga masiva: {e}")
            import traceback
            traceback.print_exc()
            return False

    # ------------------------------------------------------------------
    # PROCESAMIENTO POR BATCH CON DEDUPLICACIN
    # ------------------------------------------------------------------
    def _procesar_por_batch_deduplicado(self, file_id: str):
        """
        Procesa registros ARGOS de forma incremental.
        Actualiza estado en BD cada 5 registros.
        Maneja errores fatales marcando como fallido.
        """
        try:
            print(f"\n[ARGOS] Iniciando procesamiento: file_id={file_id}", flush=True)
            print(f"[ARGOS] Arrancando deduplicacion y analisis...", flush=True)

            # Obtener registros sin procesar via SP
            filas_raw = data_access.argos_obtener_pendientes(file_id)

            if not filas_raw:
                print(f"[!] No hay registros pendientes para procesar (file_id={file_id})", flush=True)
                return

            # Agrupar por CODIGO_CLIENTE (deduplicacion)
            negocios = {}
            for fila in filas_raw:
                codigo = fila['codigo_cliente']

                if codigo not in negocios:
                    negocios[codigo] = {
                        'negocio': fila,
                        'contactos': []
                    }
                negocios[codigo]['contactos'].append(fila)

            print(f"[ARGOS] Se encontraron {len(negocios)} negocios unicos (deduplicados) a procesar", flush=True)

            # Procesar SOLO UNA VEZ por negocio
            total_negocios = len(negocios)
            print(f"[ARGOS] Iniciando procesamiento de {total_negocios} negocios...", flush=True)
            for idx, (codigo, data) in enumerate(negocios.items(), 1):
                negocio_principal = data['negocio']
                contactos = data['contactos']

                print(f"\n[ARGOS] [{idx}/{total_negocios}] Procesando: {negocio_principal.get('nombre_cuenta', 'N/A')} ({len(contactos)} contactos)", flush=True)

                # 1. GEOCODIFICAR
                lat, lng, exacta = self.buscador.geocodificar_direccion(
                    negocio_principal['direccion'] or "",
                    negocio_principal['municipio'] or "",
                    negocio_principal['departamento'] or ""
                )

                # 1.5 DETERMINAR GIRO DEL NEGOCIO (NUEVO)
                giro_negocio = self._determinar_giro_negocio(negocio_principal['nombre_cuenta'])
                print(f"   [!] Giro del negocio: {giro_negocio}")

                # Si NO es construccin/ferretera, saltar bsqueda en Google Maps
                if giro_negocio not in ['construccion', 'desconocido']:
                    print(f"   [>>] No es negocio de construccin ({giro_negocio}), saltando Google Maps")
                    lugar = None
                    # NUEVO: Obtener info de productos para alimentos/farmacia/retail
                    resultado_ia = self._obtener_productos_por_gemini(negocio_principal['nombre_cuenta'])
                else:
                    # 2. BUSCAR LUGAR EN GOOGLE MAPS (ESTRATEGIA MEJORADA)
                    lugar = self._buscar_lugar_mejorado(
                        lat, lng,
                        negocio_principal['direccion'],
                        negocio_principal['nombre_cuenta'],
                        negocio_principal['nombre_obra'],
                        negocio_principal['municipio'],
                        negocio_principal.get('departamento', '')
                    )

                    # 3. OBTENER FOTOS Y ANALIZAR CON IA
                    resultado_ia = {}
                    if lugar:
                        fotos_b64 = self.buscador.obtener_fotos_base64(lugar)
                        if fotos_b64:
                            nombre_para_maps = lugar.get('name', negocio_principal['nombre_cuenta'])
                            resultado_ia = self.analizador.analizar_fotos(fotos_b64, nombre_para_maps)

                # Asegurar que materiales_observados sea una lista, no string JSON
                if resultado_ia and 'materiales_observados' in resultado_ia:
                    mat_obs = resultado_ia.get('materiales_observados')
                    if isinstance(mat_obs, str) and mat_obs.startswith('['):
                        try:
                            resultado_ia['materiales_observados'] = json.loads(mat_obs)
                        except:
                            resultado_ia['materiales_observados'] = []

                # 4. GUARDAR NEGOCIO EN FERRETERIASARGOS (UNA SOLA VEZ)
                ferreteria_id = self._guardar_negocio(
                    file_id=file_id,
                    negocio=negocio_principal,
                    lat=lat,
                    lng=lng,
                    geocodificacion_exacta=exacta,
                    lugar=lugar,
                    resultado_ia=resultado_ia,
                    contacto_principal=contactos[0]  # Pasar el primer contacto para telfono principal
                )

                # 5. GUARDAR TODOS LOS CONTACTOS
                if ferreteria_id:
                    self._guardar_contactos(ferreteria_id, contactos)

                # 6. MARCAR TODOS LOS REGISTROS DE ESTE NEGOCIO COMO PROCESADOS
                for contacto in contactos:
                    data_access.argos_marcar_procesado(contacto['id'])

                # 7. REGISTRAR PROGRESO CADA 5 NEGOCIOS (para monitoreo en tiempo real)
                if idx % 5 == 0 or idx == total_negocios:
                    data_access.argos_registrar_progreso(file_id, idx, total_negocios)
                    print(f"[ARGOS] [PROGRESO] {idx}/{total_negocios} negocios procesados", flush=True)

            # MARCAR COMO COMPLETADO (FUERA DEL BUCLE)
            data_access.argos_marcar_como_completado(file_id, total_negocios)
            print(f"\n[ARGOS] [OK] Procesamiento completado: {total_negocios}/{total_negocios} registros procesados exitosamente", flush=True)

        except Exception as e:
            # Error fatal: marcar como fallido
            print(f"\n[ARGOS] [ERROR FATAL] en procesamiento: {str(e)}", flush=True)
            import traceback
            traceback.print_exc()
            sys.stdout.flush()
            data_access.argos_marcar_como_fallido(file_id, str(e))

    # ------------------------------------------------------------------
    # BSQUEDA MEJORADA (NOMBRE PRIMERO)
    # ------------------------------------------------------------------
    def _buscar_lugar_mejorado(self, lat: float, lng: float, direccion: str,
                               nombre_cuenta: str, nombre_obra: str, municipio: str, departamento: str = ""):
        """
        Estrategia inteligente con clasificacin IA:
        1. Clasificar si NOMBRE_CUENTA es EMPRESA o PERSONA
        2. Si EMPRESA: Buscar por NOMBRE_CUENTA + ubicacin
        3. Si PERSONA: Buscar por NOMBRE_OBRA (si existe) o DIRECCIN
        4. Fallback: Bsqueda por coordenadas exactas
        """
        print(f"   [?] Bsqueda estratgica inteligente...")

        if not lat or not lng:
            print(f"   [!] No hay coordenadas vlidas")
            return None

        # Clasificar si NOMBRE_CUENTA es empresa o persona
        tipo_cuenta = self._clasificar_nombre(nombre_cuenta) if nombre_cuenta else "desconocido"
        print(f"    NOMBRE_CUENTA clasificado como: {tipo_cuenta}")

        # ESTRATEGIA A: Si es EMPRESA, buscar por NOMBRE_CUENTA (con variaciones)
        if tipo_cuenta == "empresa" and nombre_cuenta and nombre_cuenta.strip():
            # Limpiar el nombre de sufijos legales
            nombre_limpio = nombre_cuenta.replace(" SAS", "").replace(" LTDA", "").replace(" S.A.S.", "").replace(" S.A.", "").strip()

            # Intentar maxximo 2 variaciones: nombre original y nombre limpio
            intentos = [nombre_cuenta]
            if nombre_limpio != nombre_cuenta:
                intentos.append(nombre_limpio)

            for intento in intentos:
                print(f"   1 Buscando por NOMBRE_CUENTA (empresa): {intento}")
                lugar = self.buscador.buscar_lugar(lat, lng, intento, radio_maximo=50, municipio=municipio, departamento=departamento)
                if lugar:
                    lugar_lat = lugar.get('lat')
                    lugar_lng = lugar.get('lng')
                    es_valido = self.buscador._es_ferreteria_real(lugar.get('name', ''), lat, lng, lugar_lat, lugar_lng)
                    if es_valido:
                        print(f"   [OK] Encontrado y validado: {lugar.get('name')}")
                        return lugar
                    else:
                        print(f"   [!] Encontrado pero no validado: {lugar.get('name')}")

            # Si no encontro por nombre_cuenta, intentar FALLBACK con NOMBRE_OBRA
            if nombre_obra and nombre_obra.strip():
                print(f"   1B EMPRESA FALLBACK: Intentando NOMBRE_OBRA: {nombre_obra}")
                lugar = self.buscador.buscar_lugar(lat, lng, nombre_obra, radio_maximo=50, municipio=municipio, departamento=departamento)
                lugar_lat = lugar.get('lat') if lugar else None
                lugar_lng = lugar.get('lng') if lugar else None
                if lugar and self.buscador._es_ferreteria_real(lugar.get('name', ''), lat, lng, lugar_lat, lugar_lng):
                    print(f"   [OK] Encontrado en fallback por NOMBRE_OBRA: {lugar.get('name')}")
                    return lugar
                else:
                    print(f"   [!] NOMBRE_OBRA no validado, continuando...")
            else:
                print(f"   1B EMPRESA: No encontre por nombre exacto, sin NOMBRE_OBRA para fallback.")

        # ESTRATEGIA B: Si es PERSONA, buscar por NOMBRE_OBRA (igual a fallback anterior)
        if tipo_cuenta == "persona":
            if nombre_obra and nombre_obra.strip():
                print(f"   2 PERSONA: Buscando por NOMBRE_OBRA: {nombre_obra}")
                lugar = self.buscador.buscar_lugar(lat, lng, nombre_obra, radio_maximo=50, municipio=municipio, departamento=departamento)
                lugar_lat = lugar.get('lat') if lugar else None
                lugar_lng = lugar.get('lng') if lugar else None
                if lugar and self.buscador._es_ferreteria_real(lugar.get('name', ''), lat, lng, lugar_lat, lugar_lng):
                    print(f"   [OK] Encontrado: {lugar.get('name')}")
                    return lugar
            else:
                print(f"   2 PERSONA: No hay NOMBRE_OBRA, saltando a DIRECCIN...")

        # ESTRATEGIA C: Buscar por DIRECCION (radio 50m solamente - como street view)
        if direccion and direccion.strip():
            print(f"   3 Buscando por DIRECCION en radio 50m: {direccion}")
            # Buscar cercano sin keyword, solo por coordenadas exactas
            resultados = self.buscador._buscar_cercano(lat, lng, radio=50)

            if resultados:
                # Filtrar ferreterias validas
                for resultado in resultados:
                    if self.buscador._es_ferreteria_real(resultado.get('name', ''), lat, lng,
                                                         resultado.get('geometry', {}).get('location', {}).get('lat'),
                                                         resultado.get('geometry', {}).get('location', {}).get('lng')):
                        lugar = self.buscador._enriquecer_lugar(resultado)
                        print(f"   [OK] Encontrado en 50m: {lugar.get('name')}")
                        return lugar

            print(f"   [!] No hay ferreteria valida en radio 50m")

        print(f"   [!] No encontrado en ningun paso")
        return None

    # ------------------------------------------------------------------
    # GUARDAR NEGOCIO (UPSERT por CODIGO_CLIENTE)
    # ------------------------------------------------------------------
    def _guardar_negocio(self, file_id: str, negocio: dict, lat: float, lng: float,
                         geocodificacion_exacta: bool, lugar: dict, resultado_ia: dict,
                         contacto_principal: dict):
        print(f"   [OK] DENTRO _guardar_negocio: resultado_ia = {resultado_ia}")

        try:
            codigo_cliente = negocio.get('codigo_cliente')
            # Si encontr un lugar, usar ese nombre. Si no, SIEMPRE usar NOMBRE_CUENTA
            if lugar:
                nombre_lugar = lugar.get('name', '').lower()
                nombre_cuenta = negocio.get('nombre_cuenta', '').lower()

                # Detectar si NOMBRE_CUENTA es un nombre de PERSONA o de NEGOCIO
                palabras_negocio = ['ferreteria', 'tienda', 'deposito', 'distribuidor', 'centro', 'plaza',
                                  'comercial', 'empresa', 'spa', 'cafe', 'restaurant', 'almacen', 'taller']
                es_negocio = any(palabra in nombre_cuenta for palabra in palabras_negocio)

                # Si NOMBRE_CUENTA es una PERSONA (no tiene palabras de negocio),
                # confiar 100% en el nombre del lugar encontrado
                # Si es un NEGOCIO, validar que el lugar encontrado tenga palabras clave de NOMBRE_CUENTA
                if not es_negocio:
                    # Es un nombre de persona, usar lugar encontrado sin validacin
                    nombre_negocio = lugar.get('name')
                else:
                    # Es un nombre de negocio, validar coherencia
                    palabras_cuenta = nombre_cuenta.split()
                    if any(palabra in nombre_lugar for palabra in palabras_cuenta if len(palabra) > 3):
                        nombre_negocio = lugar.get('name')
                    else:
                        nombre_negocio = negocio.get('nombre_cuenta')
            else:
                nombre_negocio = negocio.get('nombre_cuenta')

            # Estrategia de telfono: Google Maps primero, Gemini como fallback
            # 1. Intentar obtener de Google Maps
            telefono = lugar.get('telefono_maps') if lugar else None

            # 2. Si Google Maps no tiene, intentar Gemini
            if not telefono:
                telefono = resultado_ia.get('telefono_fijo') or None
                if telefono:
                    print(f"    Telfono de Gemini (no en Maps): {telefono}")

            # WhatsApp solo de Gemini (Google Maps no lo proporciona)
            whatsapp = resultado_ia.get('whatsapp') or None

            # Formatear materiales observados
            materiales_str = (", ".join([str(m) for m in resultado_ia.get('materiales_observados', [])])[:500]
                            if resultado_ia.get('materiales_observados') else None)

            # Llamar el SP UPSERT
            ferreteria_id = data_access.argos_upsert_negocio(
                codigo_cliente=codigo_cliente,
                canal=negocio.get('canal'),
                nombre_cuenta=negocio.get('nombre_cuenta'),
                nombre_obra=negocio.get('nombre_obra'),
                nombre=nombre_negocio,
                direccion=negocio.get('direccion'),
                municipio=negocio.get('municipio'),
                departamento=negocio.get('departamento'),
                es_punto_venta_publico=negocio.get('es_punto_venta_publico'),
                lat=lat,
                lng=lng,
                telefono=telefono,
                whatsapp=whatsapp,
                vende_cemento=resultado_ia.get('vende_cemento', False),
                vende_tubos=resultado_ia.get('vende_tubos', False),
                vende_varillas=resultado_ia.get('vende_varillas', False),
                vende_ladrillos=resultado_ia.get('vende_ladrillos', False),
                vende_agregados=resultado_ia.get('vende_agregados', False),
                score=int(resultado_ia.get('score_confianza', 0) or 0),
                materiales_observados=materiales_str,
                nivel_confianza=resultado_ia.get('nivel_confianza', 'bajo'),
                url_google=lugar.get('url') if lugar else None,
                ultimo_analisis=pd.Timestamp.now()
            )

            if ferreteria_id:
                print(f"   [+] Negocio guardado (ID: {ferreteria_id})")
            else:
                print(f"   [X] Error al guardar negocio")

            return ferreteria_id

        except Exception as e:
            print(f"   [X] Error guardando negocio: {e}")
            return None

    # ------------------------------------------------------------------
    # GUARDAR CONTACTOS
    # ------------------------------------------------------------------
    def _guardar_contactos(self, ferreteria_id: int, contactos: list):
        try:
            print(f"    Reemplazando contactos para ferretera {ferreteria_id}...")

            # Primero, borra todos los contactos anteriores
            data_access.argos_borrar_contactos(ferreteria_id)

            # Luego, inserta cada contacto
            for contacto in contactos:
                result = data_access.argos_insertar_contacto(
                    ferreteria_id=ferreteria_id,
                    codigo_cliente=contacto.get('codigo_cliente'),
                    nombre_completo=contacto.get('nombre_completo'),
                    cargo=contacto.get('cargo'),
                    rol=contacto.get('rol'),
                    genero=contacto.get('genero'),
                    movil=contacto.get('movil'),
                    habeas_data=contacto.get('habeas_data'),
                    medio_autorizacion_habeas=contacto.get('medio_autorizacion_habeas'),
                    fecha_autorizacion_habeas=contacto.get('fecha_autorizacion_habeas'),
                    habeas_data_firmado=contacto.get('habeas_data_firmado')
                )

            print(f"    {len(contactos)} contactos guardados")

        except Exception as e:
            print(f"   [X] Error guardando contactos: {e}")

    # ------------------------------------------------------------------
    # ACTUALIZAR ESTADO
    # ------------------------------------------------------------------
    def _actualizar_estado_upload(self, file_id: str, estado: str):
        try:
            data_access.argos_actualizar_estado_upload(file_id, estado)
        except Exception as e:
            print(f"[!] Error actualizando estado: {e}")
