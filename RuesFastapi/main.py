import hashlib
import uuid
import shutil
import os
import pickle
import logging as _logging
from typing import Optional, List
from fastapi import FastAPI, UploadFile, File, BackgroundTasks, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from config import Config
from database import get_db_connection
from services import GoogleMapsService, GeminiService
from procesador import ProcesadorRUES
from procesador_argos_final import ProcesadorArgos
from sincronizador import encolar_sincronizacion, estado_sincronizacion, garantizar_tablas
from mapa_utils import (
    extraer_marcas_cemento,
    clasificar_negocio,
    sql_condicion_categoria,
    CATEGORIAS_MAPA,
)
import data_access

app = FastAPI(title="Procesador RUES API", version="1.3")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup_event():
    """Crea las tablas de sincronizacin si no existen al arrancar."""
    _logging.basicConfig(
        level=_logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%H:%M:%S",
        force=True,
    )
    try:
        garantizar_tablas()
    except Exception as exc:
        print(f"[!]  No se pudieron garantizar las tablas de sync: {exc}")


buscador_google = GoogleMapsService()
analizador_ia = GeminiService()
procesador = ProcesadorRUES(buscador=buscador_google, analizador=analizador_ia)
procesador_argos = ProcesadorArgos(buscador=buscador_google, analizador=analizador_ia)


def _procesar_rues_con_logs(ruta_excel: str, file_id: str):
    """Wrapper que fuerza captura de stdout/stderr en background tasks"""
    import sys
    import io
    try:
        # Force unbuffered output
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', line_buffering=True)
        sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', line_buffering=True)
        sys.stdout.flush()
        procesador.orquestar_flujo_completo(ruta_excel, file_id)
        sys.stdout.flush()
    except Exception as e:
        _logging.error(f"Error en orquestar_flujo_completo: {e}", exc_info=True)
        sys.stdout.flush()


def _procesar_argos_con_logs(ruta_excel: str, file_id: str):
    """Wrapper que fuerza captura de stdout/stderr en background tasks"""
    import sys
    import io
    try:
        # Force unbuffered output
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', line_buffering=True)
        sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', line_buffering=True)
        sys.stdout.flush()
        procesador_argos.orquestar_flujo_completo(ruta_excel, file_id)
        sys.stdout.flush()
    except Exception as e:
        _logging.error(f"Error en orquestar_flujo_completo (ARGOS): {e}", exc_info=True)
        sys.stdout.flush()

# ==========================================
# FUNCIONES HELPER
# ==========================================

def _filtrar_registros_argos(df, departamentos, municipios):
    """
    Filtra registros por departamento y municipio, manejando correctamente "TODOS".

    Lógica:
    - Si departamentos contiene "TODOS", NO filtrar por departamento
    - Si municipios contiene "TODOS" o está vacío, NO filtrar por municipio
    - Solo filtrar si hay valores específicos (no "TODOS")
    """
    import pandas as pd

    df_filtrado = df.copy()
    registros_antes = len(df_filtrado)

    # Filtro por Departamento
    depto_filtrados = [d for d in (departamentos or []) if d and d != "TODOS"]
    if depto_filtrados and len(depto_filtrados) > 0:
        df_filtrado = df_filtrado[df_filtrado['Departamento'].isin(depto_filtrados)]
        print(f"[*] Filtro Departamento: {registros_antes} -> {len(df_filtrado)}", flush=True)
        registros_antes = len(df_filtrado)

    # Filtro por Municipio
    munic_filtrados = [m for m in (municipios or []) if m and m != "TODOS"]
    if munic_filtrados and len(munic_filtrados) > 0:
        df_filtrado = df_filtrado[df_filtrado['Población: Población'].isin(munic_filtrados)]
        print(f"[*] Filtro Municipio: {registros_antes} -> {len(df_filtrado)}", flush=True)

    return df_filtrado

# ==========================================
# ENDPOINTS DE CONTROL
# ==========================================

@app.get("/")
def read_root():
    return {"mensaje": "API RuesFastapi activa", "puerto": 8001}

@app.get("/test-db")
def test_db():
    conexion = get_db_connection()
    if conexion:
        conexion.close()
        return {"estado": "xito", "mensaje": "Conexin a SQL Server establecida"}
    raise HTTPException(status_code=500, detail="Falla en conexin a BD")

# ==========================================
# ENDPOINT PRINCIPAL
# ==========================================

# ==========================================
# ENDPOINT ARGOS
# ==========================================

@app.post("/procesar-info-argos")
async def procesar_info_argos_endpoint(
    background_tasks: BackgroundTasks,
    archivo: UploadFile = File(...),
    departamentos: Optional[List[str]] = Query(default=None),
    municipios: Optional[List[str]] = Query(default=None)
):
    """
    Procesa archivo ARGOS con filtros opcionales de departamento y municipio.
    """
    import sys
    try:
        # Asegurar que query params son listas vacias si no se proporcionan
        if departamentos is None:
            departamentos = []
        if municipios is None:
            municipios = []

        print(f"[*] Iniciando procesamiento de archivo: {archivo.filename}", flush=True)
        print(f"[DEBUG] Parámetros recibidos:", flush=True)
        print(f"  departamentos: {departamentos} (type: {type(departamentos)})", flush=True)
        print(f"  municipios: {municipios} (type: {type(municipios)})", flush=True)
        sys.stdout.flush()

        # Validar formato
        if not archivo.filename.endswith(('.xlsx', '.xls')):
            print(f"[ERROR] Formato inválido: {archivo.filename}", flush=True)
            raise HTTPException(status_code=400, detail="Formato no vlido. Use Excel.")

        # Leer contenido
        contenido = await archivo.read()
        hash_archivo = hashlib.md5(contenido).hexdigest()
        await archivo.seek(0)
        print(f"[OK] Archivo ledido: {len(contenido)} bytes", flush=True)
        sys.stdout.flush()

        # Registrar upload
        file_id = str(uuid.uuid4())
        print(f"[*] Registrando upload: {file_id}", flush=True)
        sys.stdout.flush()
        try:
            data_access.argos_verificar_y_registrar_upload(file_id, archivo.filename, hash_archivo)
            print(f"[OK] Upload registrado", flush=True)
            sys.stdout.flush()
        except Exception as e:
            print(f"[ERROR] al registrar: {e}", flush=True)
            sys.stdout.flush()
            raise HTTPException(status_code=500, detail=f"Error registrando upload: {str(e)}")

        # Guardar archivo temporal
        ruta_temporal = f"temp_argos_{file_id}.xlsx"
        try:
            with open(ruta_temporal, "wb") as buffer:
                shutil.copyfileobj(archivo.file, buffer)
            print(f"[OK] Archivo temporal guardado: {ruta_temporal}", flush=True)
            sys.stdout.flush()
        except Exception as e:
            print(f"[ERROR] guardando temporal: {e}", flush=True)
            sys.stdout.flush()
            raise HTTPException(status_code=500, detail=f"Error guardando archivo: {str(e)}")

        # Leer y filtrar
        import pandas as pd
        import numpy as np
        try:
            print(f"[*] Leyendo Excel...", flush=True)
            sys.stdout.flush()
            df = pd.read_excel(ruta_temporal, engine='openpyxl')
            df.columns = df.columns.str.strip()
            df = df.replace({np.nan: None})
            print(f"[OK] Excel ledo: {len(df)} registros", flush=True)
            sys.stdout.flush()

            # APLICAR FILTROS
            registros_originales = len(df)
            df = _filtrar_registros_argos(df, departamentos, municipios)
            registros_a_procesar = len(df)
            print(f"[OK] Registros a procesar: {registros_a_procesar}", flush=True)
            sys.stdout.flush()

            # VALIDAR: Si no hay registros después de filtrar, retornar sin procesar
            if registros_a_procesar == 0:
                print(f"[!] AVISO: Los filtros no coinciden con ningún registro", flush=True)
                print(f"    Departamentos: {departamentos}, Municipios: {municipios}", flush=True)
                sys.stdout.flush()

                # Marcar en BD como "sin datos"
                data_access.argos_marcar_sin_datos(file_id, departamentos, municipios)
                print(f"[OK] Upload marcado como 'sin datos' en BD", flush=True)
                sys.stdout.flush()

                # Retornar respuesta clara
                return {
                    "file_id": file_id,
                    "estado": "no_data",
                    "registros_a_procesar": 0,
                    "mensaje": f"No hay registros que coincidan con los filtros especificados.",
                    "detalle": {
                        "total_archivo": registros_originales,
                        "departamentos_filtro": departamentos if departamentos else [],
                        "municipios_filtro": municipios if municipios else []
                    },
                    "url_estado": f"/estado-argos/{file_id}"
                }

        except Exception as e:
            print(f"[ERROR] al filtrar: {e}", flush=True)
            import traceback
            traceback.print_exc()
            sys.stdout.flush()
            raise HTTPException(status_code=400, detail=f"Error al procesar filtros: {str(e)}")

        # GUARDAR ESTADO INICIAL EN BD INMEDIATAMENTE (CRÍTICO para polling del frontend)
        print(f"[*] Guardando estado inicial en BD...", flush=True)
        print(f"    Filtros: Departamentos={departamentos}, Municipios={municipios}", flush=True)
        sys.stdout.flush()
        try:
            data_access.argos_guardar_estado_inicial(
                file_id,
                archivo.filename,
                registros_a_procesar,
                departamentos=departamentos,
                municipios=municipios
            )
            print(f"[OK] Estado inicial guardado en BD", flush=True)
            sys.stdout.flush()
        except Exception as e:
            print(f"[ERROR] guardando estado inicial: {e}", flush=True)
            import traceback
            traceback.print_exc()
            sys.stdout.flush()

        # Agregar tarea en background
        print(f"[*] Agregando tarea en background...", flush=True)
        sys.stdout.flush()
        try:
            # NO pasar DataFrame directamente (no es serializable)
            # En su lugar, guardar DataFrame en temporal y leer en background
            df_temp = f"df_temp_{file_id}.pkl"
            with open(df_temp, "wb") as f:
                pickle.dump(df, f)
            print(f"[OK] DataFrame guardado temporalmente", flush=True)
            sys.stdout.flush()

            background_tasks.add_task(
                procesador_argos.orquestar_flujo_completo_dataframe_desde_archivo,
                file_id,
                ruta_temporal,
                df_temp
            )
            print(f"[OK] Tarea agregada", flush=True)
            sys.stdout.flush()
        except Exception as e:
            print(f"[ERROR] agregando tarea: {e}", flush=True)
            import traceback
            traceback.print_exc()
            sys.stdout.flush()
            raise HTTPException(status_code=500, detail=f"Error iniciando procesamiento: {str(e)}")

        print(f"[OK] Retornando response para file_id: {file_id}", flush=True)
        sys.stdout.flush()
        return {
            "file_id": file_id,
            "estado": "processing",
            "registros_a_procesar": registros_a_procesar,
            "mensaje": f"Archivo Argos recibido. {registros_a_procesar} registros en proceso.",
            "url_estado": f"/estado-argos/{file_id}"
        }

    except HTTPException:
        raise
    except Exception as e:
        print(f"[ERROR FATAL] {e}", flush=True)
        import traceback
        traceback.print_exc()
        sys.stdout.flush()
        raise HTTPException(status_code=500, detail=f"Error inesperado: {str(e)}")

@app.get("/estado-argos/{file_id}")
def consultar_estado_argos(file_id: str):
    status, filename, conteos = data_access.argos_consultar_estado_upload(file_id)

    if not status:
        raise HTTPException(status_code=404, detail=f"No existe ningn proceso con file_id '{file_id}'")

    total = conteos['total'] if conteos else 0
    procesados = conteos['procesados'] if conteos else 0
    pendientes = total - procesados

    return {
        "file_id": file_id,
        "archivo": filename,
        "estado": status,
        "registros": {
            "total": total,
            "procesados": procesados,
            "pendientes": pendientes,
        },
        "mensaje": {
            "processing": f"En proceso... ({procesados}/{total} registros listos)",
            "completed":  f"[OK] Completado  {procesados} registros procesados de {total}",
            "failed":     "[X] El proceso fall. Revisa los logs del servidor.",
            "no_data":    "[!] No hay registros que coincidan con los filtros especificados.",
        }.get(status, "Estado desconocido")
    }

@app.get("/historial-argos")
def obtener_historial_argos():
    """
    Devuelve el historial de todos los archivos ARGOS procesados.
    Usado por el frontend para mostrar la lista de procesamientos.
    """
    try:
        conexion = get_db_connection()
        if not conexion:
            raise HTTPException(status_code=500, detail="Error de conexion a BD")

        cursor = conexion.cursor()
        cursor.execute("""
            SELECT
                ID,
                file_id,
                filename,
                status,
                fecha_upload,
                TOTAL_REGISTROS,
                REGISTROS_PROCESADOS,
                DEPARTAMENTOS,
                MUNICIPIOS,
                MENSAJE,
                FECHA_ACTUALIZACION
            FROM ARGOS_UPLOADS
            ORDER BY fecha_upload DESC
        """)

        columnas = [description[0] for description in cursor.description]
        historiales = []

        for row in cursor.fetchall():
            historial = dict(zip(columnas, row))
            # Convertir strings a listas
            if historial['DEPARTAMENTOS']:
                historial['DEPARTAMENTOS'] = historial['DEPARTAMENTOS'].split(',')
            else:
                historial['DEPARTAMENTOS'] = []

            if historial['MUNICIPIOS']:
                historial['MUNICIPIOS'] = historial['MUNICIPIOS'].split(',')
            else:
                historial['MUNICIPIOS'] = []

            historiales.append(historial)

        conexion.close()

        return {
            "total_procesamientos": len(historiales),
            "historiales": historiales
        }

    except Exception as e:
        print(f"[ERROR] en GET /historial-argos: {str(e)}", flush=True)
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Error obteniendo historial: {str(e)}")

# ==========================================
# FUNCIONES HELPER RUES
# ==========================================

def _filtrar_registros_rues(df, departamentos, municipios):
    """
    Filtra registros RUES por departamento y municipio.

    Estructura del archivo RUES:
    - 'departamento' para departamentos
    - 'municipio' para municipios
    """
    import pandas as pd

    df_filtrado = df.copy()
    registros_antes = len(df_filtrado)

    # Filtro por Departamento
    depto_filtrados = [d for d in (departamentos or []) if d and d.upper() != "TODOS"]
    if depto_filtrados and len(depto_filtrados) > 0:
        df_filtrado = df_filtrado[df_filtrado['departamento'].str.upper().isin([d.upper() for d in depto_filtrados])]
        print(f"[*] Filtro Departamento RUES: {registros_antes} -> {len(df_filtrado)}", flush=True)
        registros_antes = len(df_filtrado)

    # Filtro por Municipio
    munic_filtrados = [m for m in (municipios or []) if m and m.upper() != "TODOS"]
    if munic_filtrados and len(munic_filtrados) > 0:
        df_filtrado = df_filtrado[df_filtrado['municipio'].str.upper().isin([m.upper() for m in munic_filtrados])]
        print(f"[*] Filtro Municipio RUES: {registros_antes} -> {len(df_filtrado)}", flush=True)

    return df_filtrado

# ==========================================
# ENDPOINTS RUES (Carga RUES)
# ==========================================

@app.post("/procesar-RUES")
async def procesar_rues_endpoint(
    background_tasks: BackgroundTasks,
    archivo: UploadFile = File(...),
    departamentos: Optional[List[str]] = Query(default=None),
    municipios: Optional[List[str]] = Query(default=None)
):
    """
    Procesa archivo RUES con filtros opcionales de departamento y municipio.
    Endpoint similar a /procesar-info-argos pero para datos RUES.
    """
    import sys
    try:
        # Asegurar que query params son listas vacias si no se proporcionan
        if departamentos is None:
            departamentos = []
        if municipios is None:
            municipios = []

        print(f"[*] Iniciando procesamiento RUES: {archivo.filename}", flush=True)
        print(f"[DEBUG] Parámetros recibidos:", flush=True)
        print(f"  departamentos: {departamentos} (type: {type(departamentos)})", flush=True)
        print(f"  municipios: {municipios} (type: {type(municipios)})", flush=True)
        sys.stdout.flush()

        # Validar formato
        if not archivo.filename.endswith(('.xlsx', '.xls')):
            print(f"[ERROR] Formato inválido: {archivo.filename}", flush=True)
            raise HTTPException(status_code=400, detail="Formato no válido. Use Excel.")

        # Leer contenido
        contenido = await archivo.read()
        hash_archivo = hashlib.md5(contenido).hexdigest()
        await archivo.seek(0)
        print(f"[OK] Archivo leído: {len(contenido)} bytes", flush=True)
        sys.stdout.flush()

        # Registrar upload
        file_id = str(uuid.uuid4())
        print(f"[*] Registrando upload RUES: {file_id}", flush=True)
        sys.stdout.flush()
        try:
            data_access.rues_verificar_y_registrar_upload(file_id, archivo.filename, hash_archivo)
            print(f"[OK] Upload RUES registrado", flush=True)
            sys.stdout.flush()
        except Exception as e:
            print(f"[ERROR] al registrar RUES: {e}", flush=True)
            sys.stdout.flush()
            raise HTTPException(status_code=500, detail=f"Error registrando upload: {str(e)}")

        # Guardar archivo temporal
        ruta_temporal = f"temp_rues_{file_id}.xlsx"
        try:
            with open(ruta_temporal, "wb") as buffer:
                shutil.copyfileobj(archivo.file, buffer)
            print(f"[OK] Archivo temporal RUES guardado: {ruta_temporal}", flush=True)
            sys.stdout.flush()
        except Exception as e:
            print(f"[ERROR] guardando temporal RUES: {e}", flush=True)
            sys.stdout.flush()
            raise HTTPException(status_code=500, detail=f"Error guardando archivo: {str(e)}")

        # Leer y filtrar
        import pandas as pd
        import numpy as np
        try:
            print(f"[*] Leyendo Excel RUES...", flush=True)
            sys.stdout.flush()
            df = pd.read_excel(ruta_temporal, engine='openpyxl')
            df.columns = df.columns.str.strip()
            df = df.replace({np.nan: None})
            print(f"[OK] Excel RUES leído: {len(df)} registros", flush=True)
            sys.stdout.flush()

            # APLICAR FILTROS
            registros_originales = len(df)
            df = _filtrar_registros_rues(df, departamentos, municipios)
            registros_a_procesar = len(df)
            print(f"[OK] Registros RUES a procesar: {registros_a_procesar}", flush=True)
            sys.stdout.flush()

            # VALIDAR: Si no hay registros después de filtrar, retornar sin procesar
            if registros_a_procesar == 0:
                print(f"[!] AVISO: Los filtros RUES no coinciden con ningún registro", flush=True)
                print(f"    Departamentos: {departamentos}, Municipios: {municipios}", flush=True)
                sys.stdout.flush()

                # Marcar en BD como "sin datos"
                data_access.rues_marcar_sin_datos(file_id, departamentos, municipios)
                print(f"[OK] Upload RUES marcado como 'sin datos' en BD", flush=True)
                sys.stdout.flush()

                # Retornar respuesta clara
                return {
                    "file_id": file_id,
                    "estado": "no_data",
                    "registros_a_procesar": 0,
                    "mensaje": f"No hay registros RUES que coincidan con los filtros especificados.",
                    "detalle": {
                        "total_archivo": registros_originales,
                        "departamentos_filtro": departamentos if departamentos else [],
                        "municipios_filtro": municipios if municipios else []
                    },
                    "url_estado": f"/estado-rues/{file_id}"
                }

        except Exception as e:
            print(f"[ERROR] al filtrar RUES: {e}", flush=True)
            import traceback
            traceback.print_exc()
            sys.stdout.flush()
            raise HTTPException(status_code=400, detail=f"Error al procesar filtros: {str(e)}")

        # GUARDAR ESTADO INICIAL EN BD
        print(f"[*] Guardando estado inicial RUES en BD...", flush=True)
        print(f"    Filtros: Departamentos={departamentos}, Municipios={municipios}", flush=True)
        sys.stdout.flush()
        try:
            data_access.rues_guardar_estado_inicial(
                file_id,
                archivo.filename,
                registros_a_procesar,
                departamentos=departamentos,
                municipios=municipios
            )
            print(f"[OK] Estado inicial RUES guardado en BD", flush=True)
            sys.stdout.flush()
        except Exception as e:
            print(f"[ERROR] guardando estado inicial RUES: {e}", flush=True)
            import traceback
            traceback.print_exc()
            sys.stdout.flush()

        # Agregar tarea en background para procesar
        print(f"[*] Encolando procesamiento en background...", flush=True)
        sys.stdout.flush()
        background_tasks.add_task(_procesar_rues_con_logs, ruta_temporal, file_id)
        print(f"[OK] Archivo RUES recibido y validado correctamente", flush=True)
        sys.stdout.flush()

        return {
            "file_id": file_id,
            "estado": "processing",
            "registros_a_procesar": registros_a_procesar,
            "mensaje": f"Archivo RUES recibido. {registros_a_procesar} registros en proceso.",
            "url_estado": f"/estado-rues/{file_id}"
        }

    except HTTPException:
        raise
    except Exception as e:
        print(f"[ERROR FATAL RUES] {e}", flush=True)
        import traceback
        traceback.print_exc()
        sys.stdout.flush()
        raise HTTPException(status_code=500, detail=f"Error inesperado: {str(e)}")


@app.get("/estado-rues/{file_id}")
def consultar_estado_rues(file_id: str):
    """
    Consulta el estado de un procesamiento RUES por file_id.
    Estados posibles: processing | completed | failed | no_data
    """
    status, filename, conteos = data_access.rues_consultar_estado_upload(file_id)

    if not status:
        raise HTTPException(status_code=404, detail=f"No existe ningún proceso RUES con file_id '{file_id}'")

    total = conteos['total'] if conteos else 0
    procesados = conteos['procesados'] if conteos else 0
    pendientes = total - procesados

    return {
        "file_id": file_id,
        "archivo": filename,
        "estado": status,
        "registros": {
            "total": total,
            "procesados": procesados,
            "pendientes": pendientes,
        },
        "mensaje": {
            "processing": f"En proceso... ({procesados}/{total} registros listos)",
            "completed":  f"[OK] Completado  {procesados} registros procesados de {total}",
            "failed":     "[X] El proceso falló. Revisa los logs del servidor.",
            "no_data":    "[!] No hay registros que coincidan con los filtros especificados.",
        }.get(status, "Estado desconocido")
    }


@app.get("/historial-rues")
def obtener_historial_rues():
    """
    Devuelve el historial de todos los archivos RUES procesados.
    Usado por el frontend para mostrar la lista de procesamientos RUES.
    """
    try:
        conexion = get_db_connection()
        if not conexion:
            raise HTTPException(status_code=500, detail="Error de conexion a BD")

        cursor = conexion.cursor()
        cursor.execute("""
            SELECT
                FILE_ID,
                FILENAME,
                STATUS,
                CREATED_AT,
                TOTAL_RECORDS,
                REGISTROS_PROCESADOS,
                DEPARTAMENTOS,
                MUNICIPIOS,
                MENSAJE,
                FECHA_ACTUALIZACION
            FROM RUES_UPLOADS
            ORDER BY CREATED_AT DESC
        """)

        columnas = [description[0] for description in cursor.description]
        historiales = []

        for row in cursor.fetchall():
            historial = dict(zip(columnas, row))
            # Convertir strings a listas
            if historial['DEPARTAMENTOS']:
                historial['DEPARTAMENTOS'] = historial['DEPARTAMENTOS'].split(',')
            else:
                historial['DEPARTAMENTOS'] = []

            if historial['MUNICIPIOS']:
                historial['MUNICIPIOS'] = historial['MUNICIPIOS'].split(',')
            else:
                historial['MUNICIPIOS'] = []

            historiales.append(historial)

        conexion.close()

        return {
            "total_procesamientos": len(historiales),
            "historiales": historiales
        }

    except Exception as e:
        print(f"[ERROR] en GET /historial-rues: {str(e)}", flush=True)
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Error obteniendo historial RUES: {str(e)}")

# ==========================================
# ENDPOINTS DE SINCRONIZACIN / LIMPIEZA
# ==========================================

@app.post("/sincronizar")
def iniciar_sincronizacion():
    """
    Inicia (o encola) un trabajo de unificacin de FERRETERIASRUES + FerreteriasApify.

    - Si no hay ningn trabajo en curso, el proceso arranca de inmediato en segundo plano.
    - Si ya hay uno procesando, el nuevo trabajo queda en cola y se ejecutar al terminar.
    - Cada llamada recibe un job_id nico para consultar el progreso.
    """
    try:
        info = encolar_sincronizacion()
        return info
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/sincronizar/{job_id}")
def consultar_sincronizacion(job_id: str):
    """
    Consulta el estado de un trabajo de sincronizacin.

    Posibles estados:
      - pendiente    en cola, esperando turno
      - procesando   corriendo ahora
      - completado   termin exitosamente
      - error        fall (ver campo 'MENSAJE' para detalle)
    """
    try:
        info = estado_sincronizacion(job_id)
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    if info is None:
        raise HTTPException(status_code=404, detail=f"No existe ningn trabajo con job_id '{job_id}'")

    estado = info.get('status', '').lower()
    mensajes = {
        'pendiente':  f" En cola (posicin {info.get('posicion_cola', '?')}). Esperando turno.",
        'procesando': "  Procesando... La unificacin est en curso.",
        'completado': f"[OK] Completado  {info.get('mensaje', '')}",
        'error': f"[X] Error: {info.get('mensaje', 'Sin detalle')}",
    }

    return {
        "job_id": job_id,
        "estado": estado,
        "detalle": {
            "total_rues":       info.get('total_rues', 0),
            "total_apify":      info.get('total_apify', 0),
            "total_unificados": info.get('total_unificados', 0),
            "total_solo_rues":  info.get('total_solo_rues', 0),
            "total_solo_apify": info.get('total_solo_apify', 0),
            "total_argos":      info.get('total_argos', 0),
            "total_solo_argos": info.get('total_solo_argos', 0),
            "posicion_cola":    info.get('posicion_cola'),
            "fecha_inicio":     str(info.get('fecha_inicio', '')) if info.get('fecha_inicio') else None,
            "fecha_fin":        str(info.get('fecha_fin', '')) if info.get('fecha_fin') else None,
        },
        "mensaje": mensajes.get(estado, f"Estado desconocido: {estado}"),
    }


@app.get("/sincronizar/{job_id}/descartados")
def consultar_descartados(job_id: str):
    """
    Consulta los registros descartados durante una sincronizacin.
    Retorna lista con NOMBRE, FUENTE, MOTIVO y FECHA_REGISTRO.
    """
    try:
        descartados = data_access.sync_obtener_descartados(job_id)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    return {
        "job_id": job_id,
        "total_descartados": len(descartados),
        "descartados": descartados,
    }


# ==========================================
# ENDPOINTS DE MAPA
# ==========================================

def _enriquecer_negocio(negocio: dict) -> dict:
    """Agrega marcas_cemento y categoria_mapa a un dict de negocio."""
    materiales = negocio.get("materiales_observados")
    marcas     = extraer_marcas_cemento(materiales)
    categoria  = clasificar_negocio(negocio.get("vende_cemento"), marcas, materiales)
    negocio["marcas_cemento"]  = marcas
    negocio["categoria_mapa"]  = categoria
    negocio["color_mapa"]      = CATEGORIAS_MAPA[categoria]["color"]
    negocio["descripcion_cat"] = CATEGORIAS_MAPA[categoria]["descripcion"]
    return negocio


@app.get("/mapa/negocios")
def listar_negocios_mapa(
    departamento:    Optional[str]  = Query(None, description="Filtrar por departamento"),
    municipio:       Optional[str]  = Query(None, description="Filtrar por municipio"),
    fuente:          Optional[str]  = Query(None, description="Separadas por coma: RUES, APIFY, ARGOS (ej: RUES,ARGOS o RUES,APIFY,ARGOS)"),
    nivel_confianza: Optional[str]  = Query(None, description="alto | medio | bajo"),
    categoria_mapa:  Optional[str]  = Query(
        None,
        description="CLIENTE_ARGOS | CLIENTE_MIXTO | COMPETENCIA | SIN_MARCA | PROSPECTO | SIN_ANALISIS",
    ),
    vende_cemento:   Optional[bool] = Query(None),
    vende_tubos:     Optional[bool] = Query(None),
    vende_varillas:  Optional[bool] = Query(None),
    vende_ladrillos: Optional[bool] = Query(None),
    vende_agregados: Optional[bool] = Query(None),
    limite:          int            = Query(2000, ge=1, le=2000, description="Registros por página (máximo 2000)"),
    offset:          int            = Query(0, ge=0, description="Desplazamiento para paginación"),
):
    """
    Retorna negocios con coordenadas vlidas para el mapa de calor.

    Cada registro incluye:
    - `marcas_cemento`: lista de marcas detectadas en MATERIALES_OBSERVADOS
    - `categoria_mapa`: CLIENTE_ARGOS | CLIENTE_MIXTO | COMPETENCIA | SIN_MARCA | PROSPECTO | SIN_ANALISIS
    - `color_mapa`: color HEX sugerido para el pin/marcador
    - `contactos`: lista de contactos asociados a la ferretería (nombre, cargo, teléfono, género)
    """
    if categoria_mapa:
        try:
            sql_condicion_categoria(categoria_mapa.upper())
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))

    # Llamar el SP con filtros opcionales
    negocios_raw, total = data_access.mapa_listar_negocios(
        offset=offset,
        limite=limite,
        departamento=departamento,
        municipio=municipio,
        fuente=fuente,
        nivel_confianza=nivel_confianza,
        vende_cemento=1 if vende_cemento else None,
        vende_tubos=1 if vende_tubos else None,
        vende_varillas=1 if vende_varillas else None,
        vende_ladrillos=1 if vende_ladrillos else None,
        vende_agregados=1 if vende_agregados else None
    )

    negocios = []
    for n in negocios_raw:
        n["lat"]             = float(n["lat"]) if n.get("lat") else None
        n["lng"]             = float(n["lng"]) if n.get("lng") else None
        n["vende_cemento"]   = bool(n.get("vende_cemento", False))
        n["vende_tubos"]     = bool(n.get("vende_tubos", False))
        n["vende_varillas"]  = bool(n.get("vende_varillas", False))
        n["vende_ladrillos"] = bool(n.get("vende_ladrillos", False))
        n["vende_agregados"] = bool(n.get("vende_agregados", False))
        negocio_enriquecido = _enriquecer_negocio(n)
        negocio_enriquecido["contactos"] = data_access.mapa_obtener_contactos(n.get("id"))
        negocios.append(negocio_enriquecido)

    return {
        "total":    total,
        "limite":   limite,
        "offset":   offset,
        "negocios": negocios,
    }


@app.get("/mapa/negocios/{negocio_id}")
def detalle_negocio(negocio_id: int):
    """Retorna todos los campos de un negocio, incluyendo marcas_cemento, categoria_mapa y contactos."""
    n = data_access.mapa_detalle_negocio(negocio_id)

    if not n:
        raise HTTPException(status_code=404, detail=f"Negocio con ID {negocio_id} no encontrado")

    for campo in ("vende_cemento", "vende_tubos", "vende_varillas", "vende_ladrillos", "vende_agregados"):
        if n.get(campo) is not None:
            n[campo] = bool(n[campo])
    for campo in ("lat", "lng", "score_fuzzy"):
        if n.get(campo) is not None:
            n[campo] = float(n[campo])
    for campo in ("fecha_creacion", "fecha_actualizacion", "ultimo_analisis"):
        if n.get(campo) is not None:
            n[campo] = str(n[campo])

    negocio_enriquecido = _enriquecer_negocio(n)
    negocio_enriquecido["contactos"] = data_access.mapa_obtener_contactos(negocio_id)

    return negocio_enriquecido


@app.get("/mapa/filtros")
def opciones_filtros():
    """
    Valores disponibles para poblar los dropdowns del front.
    Incluye el catlogo de categoras con colores para el heat map.
    """
    departamentos, municipios_dict, fuentes, niveles, total = data_access.mapa_opciones_filtros()

    municipios = [{"municipio": mun, "departamento": dep} for dep, muns in municipios_dict.items() for mun in muns]

    return {
        "total_con_coordenadas": total,
        "departamentos":         departamentos,
        "municipios":            municipios,
        "fuentes":               fuentes,
        "niveles_confianza":     niveles,
        "categorias_mapa":       [
            {"id": k, **v}
            for k, v in sorted(CATEGORIAS_MAPA.items(), key=lambda x: x[1]["prioridad"])
        ],
    }


@app.get("/mapa/resumen")
def resumen_mapa(
    departamento: Optional[str] = Query(None),
    municipio:    Optional[str] = Query(None),
):
    """
    Resumen por categora de heat map para el dashboard.
    Retorna el conteo de negocios en cada categora (con coordenadas).
    """
    filas = data_access.mapa_resumen_materiales(departamento=departamento, municipio=municipio)

    conteos: dict[str, int] = {k: 0 for k in CATEGORIAS_MAPA}
    for vende_cemento, materiales in filas:
        marcas    = extraer_marcas_cemento(materiales)
        categoria = clasificar_negocio(vende_cemento, marcas, materiales)
        conteos[categoria] += 1

    total = sum(conteos.values())
    return {
        "total": total,
        "categorias": [
            {
                "id":          cat_id,
                "conteo":      conteos[cat_id],
                "porcentaje":  round(conteos[cat_id] / total * 100, 1) if total else 0,
                "color":       CATEGORIAS_MAPA[cat_id]["color"],
                "descripcion": CATEGORIAS_MAPA[cat_id]["descripcion"],
            }
            for cat_id in sorted(CATEGORIAS_MAPA, key=lambda k: CATEGORIAS_MAPA[k]["prioridad"])
        ],
    }
