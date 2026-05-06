"""
Capa de acceso a datos - Encapsula todas las llamadas a Procedimientos Almacenados.
"""

import sys
from database import get_db_connection
import logging

logger = logging.getLogger(__name__)


def _normalize_dict_keys(d: dict) -> dict:
    """Convierte todas las claves a minsculas para compatibilidad"""
    if not d:
        return d
    return {k.lower(): v for k, v in d.items()}


# ============================================================
# ARGOS - OPERACIONES DE BASE DE DATOS
# ============================================================

def argos_insertar_registro(file_id, canal, codigo_cliente, nombre_cuenta, nombre_obra,
                            nombre_completo, cargo, rol, genero, movil,
                            direccion, municipio, departamento, es_punto_venta_publico,
                            habeas_data, medio_autorizacion_habeas, fecha_autorizacion_habeas,
                            habeas_data_firmado):
    """Inserta un registro en ARGOS_RECORDS"""
    conn = get_db_connection()
    if not conn:
        return False

    try:
        cursor = conn.cursor()
        cursor.execute("""{CALL SP_ARGOS_INSERTAR_REGISTROS
            (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        }""", (
            file_id, canal, codigo_cliente, nombre_cuenta, nombre_obra,
            nombre_completo, cargo, rol, genero, movil,
            direccion, municipio, departamento, es_punto_venta_publico,
            habeas_data, medio_autorizacion_habeas, fecha_autorizacion_habeas,
            habeas_data_firmado
        ))
        conn.commit()
        return True
    except Exception as e:
        logger.error(f"Error inserting ARGOS_RECORDS: {e}")
        return False
    finally:
        if conn:
            conn.close()


def argos_obtener_pendientes(file_id):
    """Obtiene registros no procesados de un archivo"""
    conn = get_db_connection()
    if not conn:
        return []

    try:
        cursor = conn.cursor()
        cursor.execute("{CALL SP_ARGOS_OBTENER_PENDIENTES(?)}", (file_id,))

        # Obtiene columnas
        columns = [description[0] for description in cursor.description]
        rows = []
        for row in cursor.fetchall():
            row_dict = dict(zip(columns, row))
            rows.append(_normalize_dict_keys(row_dict))

        return rows
    except Exception as e:
        logger.error(f"Error fetching ARGOS_RECORDS: {e}")
        return []
    finally:
        if conn:
            conn.close()


def argos_marcar_procesado(record_id):
    """Marca un registro como procesado"""
    conn = get_db_connection()
    if not conn:
        return False

    try:
        cursor = conn.cursor()
        cursor.execute("{CALL SP_ARGOS_MARCAR_PROCESADO(?)}", (record_id,))
        conn.commit()
        return True
    except Exception as e:
        logger.error(f"Error marking ARGOS_RECORDS as processed: {e}")
        return False
    finally:
        if conn:
            conn.close()


def argos_upsert_negocio(codigo_cliente, canal, nombre_cuenta, nombre_obra,
                         nombre, direccion, municipio, departamento,
                         es_punto_venta_publico, lat, lng, telefono, whatsapp,
                         vende_cemento, vende_tubos, vende_varillas,
                         vende_ladrillos, vende_agregados, score,
                         materiales_observados, nivel_confianza,
                         url_google, ultimo_analisis):
    """UPSERT en FERRETERIASARGOS - retorna el ID del negocio"""
    conn = get_db_connection()
    if not conn:
        return None

    try:
        cursor = conn.cursor()

        cursor.execute("""{CALL SP_ARGOS_UPSERT_NEGOCIO
            (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        }""", (
            codigo_cliente, canal, nombre_cuenta, nombre_obra,
            nombre, direccion, municipio, departamento,
            es_punto_venta_publico, lat, lng, telefono, whatsapp,
            vende_cemento, vende_tubos, vende_varillas,
            vende_ladrillos, vende_agregados, score,
            materiales_observados, nivel_confianza,
            url_google, ultimo_analisis
        ))

        # El SP retorna el ID va SELECT
        row = cursor.fetchone()
        negocio_id = row[0] if row else None

        conn.commit()
        return negocio_id
    except Exception as e:
        logger.error(f"Error upserting FERRETERIASARGOS: {e}")
        return None
    finally:
        if conn:
            conn.close()


def argos_borrar_contactos(ferreteria_id):
    """Elimina todos los contactos de una ferretera"""
    conn = get_db_connection()
    if not conn:
        return False

    try:
        cursor = conn.cursor()
        cursor.execute("{CALL SP_ARGOS_BORRAR_CONTACTOS(?)}", (ferreteria_id,))
        conn.commit()
        return True
    except Exception as e:
        logger.error(f"Error deleting ARGOS contacts: {e}")
        return False
    finally:
        if conn:
            conn.close()


def argos_insertar_contacto(ferreteria_id, codigo_cliente, nombre_completo, cargo, rol,
                            genero, movil, habeas_data, medio_autorizacion_habeas,
                            fecha_autorizacion_habeas, habeas_data_firmado):
    """Inserta un contacto sin eliminar anteriores"""
    conn = get_db_connection()
    if not conn:
        return False

    try:
        cursor = conn.cursor()
        cursor.execute("""{CALL SP_ARGOS_INSERTAR_CONTACTO
            (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        }""", (
            ferreteria_id, codigo_cliente, nombre_completo, cargo, rol,
            genero, movil, habeas_data, medio_autorizacion_habeas,
            fecha_autorizacion_habeas, habeas_data_firmado
        ))
        conn.commit()
        return True
    except Exception as e:
        logger.error(f"Error inserting ARGOS contact: {e}")
        return False
    finally:
        if conn:
            conn.close()


def argos_reemplazar_contactos(ferreteria_id, codigo_cliente, nombre_completo, cargo, rol,
                               genero, movil, habeas_data, medio_autorizacion_habeas,
                               fecha_autorizacion_habeas, habeas_data_firmado):
    """Deprecated: use argos_borrar_contactos + argos_insertar_contacto instead"""
    return argos_insertar_contacto(ferreteria_id, codigo_cliente, nombre_completo, cargo, rol,
                                   genero, movil, habeas_data, medio_autorizacion_habeas,
                                   fecha_autorizacion_habeas, habeas_data_firmado)


def argos_actualizar_estado_upload(file_id, status):
    """Actualiza el estado de un upload"""
    conn = get_db_connection()
    if not conn:
        return False

    try:
        cursor = conn.cursor()
        cursor.execute("{CALL SP_ARGOS_ACTUALIZAR_ESTADO_UPLOAD(?, ?)}", (file_id, status))
        conn.commit()
        return True
    except Exception as e:
        logger.error(f"Error updating ARGOS_UPLOADS status: {e}")
        return False
    finally:
        if conn:
            conn.close()


def argos_guardar_estado_inicial(file_id, filename, total_registros, departamentos=None, municipios=None):
    """
    Guarda el estado inicial INMEDIATAMENTE después de recibir el archivo.
    Se ejecuta ANTES del procesamiento en background.
    También guarda los filtros aplicados para el historial.
    """
    conn = get_db_connection()
    if not conn:
        return False

    try:
        cursor = conn.cursor()

        # Convertir listas a string para guardar en BD
        depto_str = None
        munic_str = None

        if departamentos and len(departamentos) > 0:
            # Guardar tal cual, incluyendo "TODOS"
            depto_filtrados = [d for d in departamentos if d]
            depto_str = ",".join(depto_filtrados) if depto_filtrados else None

        if municipios and len(municipios) > 0:
            # Guardar tal cual, incluyendo "TODOS"
            munic_filtrados = [m for m in municipios if m]
            munic_str = ",".join(munic_filtrados) if munic_filtrados else None

        print(f"[DEBUG] Guardando en BD: depto_str={depto_str}, munic_str={munic_str}", flush=True)

        cursor.execute("""
            UPDATE ARGOS_UPLOADS
            SET STATUS = 'processing',
                TOTAL_REGISTROS = ?,
                REGISTROS_PROCESADOS = 0,
                MENSAJE = ?,
                DEPARTAMENTOS = ?,
                MUNICIPIOS = ?,
                FECHA_ACTUALIZACION = GETDATE()
            WHERE file_id = ?
        """, (total_registros, f"Archivo recibido. {total_registros} registros en proceso.", depto_str, munic_str, file_id))
        conn.commit()
        logger.info(f"[BD] Estado inicial guardado: {file_id} ({total_registros} registros) - Depto: {depto_str}, Municipios: {munic_str}")
        return True
    except Exception as e:
        logger.error(f"Error guardando estado inicial {file_id}: {e}")
        return False
    finally:
        if conn:
            conn.close()


def argos_registrar_progreso(file_id, procesados, total):
    """
    Registra el progreso durante el procesamiento.
    Actualiza REGISTROS_PROCESADOS cada 5-10 registros.
    """
    conn = get_db_connection()
    if not conn:
        return False

    try:
        cursor = conn.cursor()
        mensaje = f"En proceso... ({procesados}/{total} registros listos)" if procesados < total else \
                  f"Completado {total}/{total} registros procesados"

        cursor.execute("""
            UPDATE ARGOS_UPLOADS
            SET STATUS = 'processing',
                REGISTROS_PROCESADOS = ?,
                MENSAJE = ?,
                FECHA_ACTUALIZACION = GETDATE()
            WHERE file_id = ?
        """, (procesados, mensaje, file_id))
        conn.commit()
        logger.debug(f"[BD] Progreso actualizado: {file_id} -> {procesados}/{total}")
        return True
    except Exception as e:
        logger.error(f"Error registrando progreso {file_id}: {e}")
        return False
    finally:
        if conn:
            conn.close()


def argos_marcar_como_completado(file_id, total_registros):
    """
    Marca el upload como completado con éxito.
    Se ejecuta al final del procesamiento.
    """
    conn = get_db_connection()
    if not conn:
        return False

    try:
        cursor = conn.cursor()
        cursor.execute("""
            UPDATE ARGOS_UPLOADS
            SET STATUS = 'completed',
                REGISTROS_PROCESADOS = ?,
                MENSAJE = ?,
                FECHA_ACTUALIZACION = GETDATE()
            WHERE file_id = ?
        """, (total_registros, f"[OK] Completado {total_registros}/{total_registros} registros procesados exitosamente", file_id))
        conn.commit()
        logger.info(f"[BD] Procesamiento completado: {file_id}")
        return True
    except Exception as e:
        logger.error(f"Error marcando como completado {file_id}: {e}")
        return False
    finally:
        if conn:
            conn.close()


def argos_marcar_como_fallido(file_id, mensaje_error):
    """
    Marca el upload como fallido cuando ocurre un error fatal.
    """
    conn = get_db_connection()
    if not conn:
        return False

    try:
        cursor = conn.cursor()
        cursor.execute("""
            UPDATE ARGOS_UPLOADS
            SET STATUS = 'failed',
                MENSAJE = ?,
                FECHA_ACTUALIZACION = GETDATE()
            WHERE file_id = ?
        """, (f"[X] El proceso falló: {mensaje_error}", file_id))
        conn.commit()
        logger.error(f"[BD] Procesamiento fallido: {file_id} - {mensaje_error}")
        return True
    except Exception as e:
        logger.error(f"Error marcando como fallido {file_id}: {e}")
        return False
    finally:
        if conn:
            conn.close()


def argos_marcar_sin_datos(file_id, departamentos=None, municipios=None):
    """
    Marca el upload como completado sin datos cuando los filtros no coinciden con ningún registro.
    También guarda los filtros para el historial.
    """
    conn = get_db_connection()
    if not conn:
        return False

    try:
        cursor = conn.cursor()

        # Generar mensaje descriptivo y preparar strings de filtros
        filtros = []
        depto_str = None
        munic_str = None

        if departamentos and len(departamentos) > 0:
            # Guardar tal cual, incluyendo "TODOS"
            depto_filtrados = [d for d in departamentos if d]
            depto_str = ",".join(depto_filtrados) if depto_filtrados else None
            if depto_str:
                filtros.append(f"Departamentos: {depto_str.replace(',', ', ')}")

        if municipios and len(municipios) > 0:
            # Guardar tal cual, incluyendo "TODOS"
            munic_filtrados = [m for m in municipios if m]
            munic_str = ",".join(munic_filtrados) if munic_filtrados else None
            if munic_str:
                filtros.append(f"Municipios: {munic_str.replace(',', ', ')}")

        filtro_texto = " | ".join(filtros) if filtros else "Departamentos/Municipios especificados"
        mensaje = f"[!] No hay registros que cumplan con los filtros: {filtro_texto}"

        print(f"[DEBUG] Marcando como no_data: depto_str={depto_str}, munic_str={munic_str}", flush=True)

        cursor.execute("""
            UPDATE ARGOS_UPLOADS
            SET STATUS = 'no_data',
                TOTAL_REGISTROS = 0,
                REGISTROS_PROCESADOS = 0,
                MENSAJE = ?,
                DEPARTAMENTOS = ?,
                MUNICIPIOS = ?,
                FECHA_ACTUALIZACION = GETDATE()
            WHERE file_id = ?
        """, (mensaje, depto_str, munic_str, file_id))
        conn.commit()
        logger.info(f"[BD] Upload marcado sin datos: {file_id} - {mensaje}")
        return True
    except Exception as e:
        logger.error(f"Error marcando como sin datos {file_id}: {e}")
        return False
    finally:
        if conn:
            conn.close()


# ============================================================
# UPLOADS/ESTADO - OPERACIONES DE BASE DE DATOS
# ============================================================

def rues_verificar_y_registrar_upload(file_id, filename, hash_archivo):
    """Verifica duplicado por hash y registra nuevo upload"""
    conn = get_db_connection()
    if not conn:
        return None, None

    try:
        cursor = conn.cursor()
        cursor.execute("""{CALL SP_RUES_VERIFICAR_Y_REGISTRAR_UPLOAD(?, ?, ?, NULL, NULL)}""",
                      (file_id, filename, hash_archivo))

        # Obtiene el valor output
        conn.commit()
        return None, None
    except Exception as e:
        logger.error(f"Error in rues_verificar_y_registrar: {e}")
        return None, None
    finally:
        if conn:
            conn.close()


def rues_consultar_estado(file_id):
    """Consulta estado de un upload y cuenta de registros"""
    conn = get_db_connection()
    if not conn:
        return None, None, None

    try:
        cursor = conn.cursor()
        cursor.execute("{CALL SP_RUES_CONSULTAR_ESTADO(?)}", (file_id,))

        # Resultado 1: Estado del upload
        upload_row = cursor.fetchone()
        status = upload_row[0] if upload_row else None
        filename = upload_row[1] if upload_row else None
        fecha = upload_row[2] if upload_row else None

        # Resultado 2: Conteos
        cursor.nextset()
        count_row = cursor.fetchone()
        total = count_row[0] if count_row else 0
        procesados = count_row[1] if count_row else 0

        return status, filename, {'total': total, 'procesados': procesados}
    except Exception as e:
        logger.error(f"Error consulting RUES status: {e}")
        return None, None, None
    finally:
        if conn:
            conn.close()


def argos_verificar_y_registrar_upload(file_id, filename, hash_archivo):
    """
    Registra un nuevo procesamiento en ARGOS_UPLOADS.
    Cada file_id es único, permitiendo múltiples procesamientos del mismo archivo con diferentes filtros.
    """
    conn = get_db_connection()
    if not conn:
        return None, None

    try:
        cursor = conn.cursor()
        # Insertar un nuevo registro para este file_id
        # Permite procesar el mismo archivo varias veces con diferentes filtros
        cursor.execute("""
            INSERT INTO argos_uploads (file_id, filename, hash_archivo, status, fecha_upload)
            VALUES (?, ?, ?, 'processing', GETDATE())
        """, (file_id, filename, hash_archivo))
        conn.commit()
        logger.info(f"[BD] Nuevo procesamiento registrado: {file_id} - {filename}")
        return None, None
    except Exception as e:
        logger.error(f"Error registrando nuevo procesamiento {file_id}: {e}")
        raise  # Re-raise para que el endpoint vea el error
    finally:
        if conn:
            conn.close()


def argos_consultar_estado_upload(file_id):
    """Consulta estado de un upload ARGOS y cuenta de registros"""
    conn = get_db_connection()
    if not conn:
        logger.error("No database connection available")
        return None, None, None

    cursor = None
    try:
        cursor = conn.cursor()

        # Paso 1: Obtener estado desde ARGOS_UPLOADS
        print(f"[DEBUG] Consultando ARGOS_UPLOADS para file_id={file_id}", flush=True)
        cursor.execute("""
            SELECT status, filename, TOTAL_REGISTROS, REGISTROS_PROCESADOS
            FROM ARGOS_UPLOADS
            WHERE file_id = ?
        """, (file_id,))

        upload_row = cursor.fetchone()
        if not upload_row:
            print(f"[DEBUG] No se encontró upload para file_id={file_id}", flush=True)
            return None, None, None

        status = upload_row[0]
        filename = upload_row[1]
        total_bd = upload_row[2] if upload_row[2] else 0
        procesados_bd = upload_row[3] if upload_row[3] else 0

        print(f"[DEBUG] Status={status}, Filename={filename}, Total={total_bd}, Procesados={procesados_bd}", flush=True)

        # Si el estado es "no_data", retornar inmediatamente
        if status == "no_data":
            print(f"[DEBUG] Estado es 'no_data', retornando 0 registros", flush=True)
            return status, filename, {'total': 0, 'procesados': 0}

        # Paso 2: Contar registros reales en ARGOS_RECORDS
        print(f"[DEBUG] Contando registros en ARGOS_RECORDS para file_id={file_id}", flush=True)
        cursor.execute("""
            SELECT COUNT(*) FROM ARGOS_RECORDS WHERE file_id = ?
        """, (file_id,))

        count_result = cursor.fetchone()
        total_real = count_result[0] if count_result and count_result[0] else total_bd

        # Contar procesados
        cursor.execute("""
            SELECT COUNT(*) FROM ARGOS_RECORDS WHERE file_id = ? AND processed = 1
        """, (file_id,))

        proc_result = cursor.fetchone()
        procesados_real = proc_result[0] if proc_result and proc_result[0] else procesados_bd

        print(f"[DEBUG] Total={total_real}, Procesados={procesados_real}", flush=True)

        return status, filename, {'total': total_real, 'procesados': procesados_real}

    except Exception as e:
        logger.error(f"Error en argos_consultar_estado_upload: {e}")
        print(f"[ERROR] argos_consultar_estado_upload: {e}", flush=True)
        import traceback
        traceback.print_exc(file=sys.stdout)
        return None, None, None
    finally:
        if conn:
            conn.close()


# ============================================================
# MAPA/NEGOCIOS - OPERACIONES DE BASE DE DATOS
# ============================================================

def mapa_listar_negocios(offset=0, limite=20, departamento=None, municipio=None,
                         fuente=None, nivel_confianza=None, vende_cemento=None,
                         vende_tubos=None, vende_varillas=None, vende_ladrillos=None,
                         vende_agregados=None):
    """Listado paginado de negocios con filtros opcionales"""
    conn = get_db_connection()
    if not conn:
        return [], 0

    try:
        cursor = conn.cursor()

        # Procesar fuente - si contiene comas, dividir en múltiples valores
        fuentes = None
        if fuente:
            fuentes = [f.strip().upper() for f in fuente.split(',')]

        # Construir cláusula WHERE dinámicamente
        where_parts = []
        params = []

        if departamento:
            where_parts.append("DEPARTAMENTO = ?")
            params.append(departamento)

        if municipio:
            where_parts.append("MUNICIPIO = ?")
            params.append(municipio)

        if fuentes:
            placeholders = ','.join(['?' for _ in fuentes])
            where_parts.append(f"FUENTE IN ({placeholders})")
            params.extend(fuentes)

        if nivel_confianza:
            where_parts.append("NIVEL_CONFIANZA = ?")
            params.append(nivel_confianza)

        if vende_cemento:
            where_parts.append("VENDE_CEMENTO = 1")

        if vende_tubos:
            where_parts.append("VENDE_TUBOS = 1")

        if vende_varillas:
            where_parts.append("VENDE_VARILLAS = 1")

        if vende_ladrillos:
            where_parts.append("VENDE_LADRILLOS = 1")

        if vende_agregados:
            where_parts.append("VENDE_AGREGADOS = 1")

        where_clause = " AND ".join(where_parts) if where_parts else "1=1"

        # Obtener total
        count_sql = f"SELECT COUNT(*) as total FROM FerreteriasUnificadas WHERE {where_clause}"
        cursor.execute(count_sql, params)
        total_row = cursor.fetchone()
        total = total_row[0] if total_row else 0

        # Obtener registros paginados
        select_sql = f"""
            SELECT ID, NOMBRE, LAT, LNG, TELEFONO, WHATSAPP, MUNICIPIO, DEPARTAMENTO,
                   DIRECCION_COMERCIAL, VENDE_CEMENTO, VENDE_TUBOS, VENDE_VARILLAS,
                   VENDE_LADRILLOS, VENDE_AGREGADOS, SCORE, NIVEL_CONFIANZA,
                   MATERIALES_OBSERVADOS, URL_GOOGLE, FUENTE,
                   ID_RUES, ID_APIFY, ID_ARGOS, CODIGO_CLIENTE_ARGOS, CANAL,
                   NOMBRE_CUENTA, NOMBRE_OBRA, ES_PUNTO_VENTA_PUBLICO
            FROM FerreteriasUnificadas
            WHERE {where_clause}
            ORDER BY SCORE DESC, ID
            OFFSET ? ROWS FETCH NEXT ? ROWS ONLY
        """
        cursor.execute(select_sql, params + [offset, limite])

        columns = [description[0] for description in cursor.description]
        rows = []
        for row in cursor.fetchall():
            row_dict = dict(zip(columns, row))
            rows.append(_normalize_dict_keys(row_dict))

        return rows, total
    except Exception as e:
        logger.error(f"Error listing negocios: {e}")
        import traceback
        traceback.print_exc()
        return [], 0
    finally:
        if conn:
            conn.close()


def mapa_detalle_negocio(negocio_id):
    """Obtiene detalles completos de un negocio"""
    conn = get_db_connection()
    if not conn:
        return None

    try:
        cursor = conn.cursor()
        cursor.execute("{CALL SP_MAPA_DETALLE_NEGOCIO(?)}", (negocio_id,))

        columns = [description[0] for description in cursor.description]
        row = cursor.fetchone()

        if row:
            row_dict = dict(zip(columns, row))
            return _normalize_dict_keys(row_dict)
        return None
    except Exception as e:
        logger.error(f"Error getting negocio details: {e}")
        return None
    finally:
        if conn:
            conn.close()


def mapa_opciones_filtros():
    """Obtiene opciones distintas para todos los filtros"""
    conn = get_db_connection()
    if not conn:
        return {}, {}, {}, {}, 0

    try:
        cursor = conn.cursor()
        cursor.execute("{CALL SP_MAPA_OPCIONES_FILTROS()}")

        # Resultado 1: Departamentos
        departamentos = [row[0] for row in cursor.fetchall() if row[0]]

        # Resultado 2: Municipios
        cursor.nextset()
        municipios = {}
        for row in cursor.fetchall():
            mun, dep = row[0], row[1]
            if dep not in municipios:
                municipios[dep] = []
            municipios[dep].append(mun)

        # Resultado 3: Fuentes
        cursor.nextset()
        fuentes = [row[0] for row in cursor.fetchall() if row[0]]

        # Resultado 4: Niveles de confianza
        cursor.nextset()
        niveles = [row[0] for row in cursor.fetchall() if row[0]]

        # Resultado 5: Total
        cursor.nextset()
        total_row = cursor.fetchone()
        total = total_row[0] if total_row else 0

        return departamentos, municipios, fuentes, niveles, total
    except Exception as e:
        logger.error(f"Error getting filter options: {e}")
        return {}, {}, {}, {}, 0
    finally:
        if conn:
            conn.close()


def mapa_resumen_materiales(departamento=None, municipio=None):
    """Resumen de materiales con filtros opcionales"""
    conn = get_db_connection()
    if not conn:
        return []

    try:
        cursor = conn.cursor()
        cursor.execute("{CALL SP_MAPA_RESUMEN_MATERIALES(?, ?)}", (departamento, municipio))

        columns = [description[0] for description in cursor.description]
        rows = []
        for row in cursor.fetchall():
            row_dict = dict(zip(columns, row))
            rows.append(_normalize_dict_keys(row_dict))

        return rows
    except Exception as e:
        logger.error(f"Error getting materials summary: {e}")
        return []
    finally:
        if conn:
            conn.close()


# ============================================================
# SINCRONIZACION - OPERACIONES DE BASE DE DATOS
# ============================================================

def sync_insertar_job(job_id, posicion):
    """Inserta un nuevo job en SyncJobs"""
    conn = get_db_connection()
    if not conn:
        return False

    try:
        cursor = conn.cursor()
        cursor.execute("{CALL SP_SYNC_INSERTAR_JOB(?, ?)}", (job_id, posicion))
        conn.commit()
        return True
    except Exception as e:
        logger.error(f"Error inserting sync job: {e}")
        return False
    finally:
        if conn:
            conn.close()


def sync_actualizar_job(job_id, status, total_rues=None, total_apify=None,
                        total_unificados=None, total_solo_rues=None,
                        total_solo_apify=None, total_argos=None, total_solo_argos=None,
                        mensaje=None):
    """Actualiza un job con mltiples campos opcionales"""
    conn = get_db_connection()
    if not conn:
        return False

    try:
        cursor = conn.cursor()
        cursor.execute("""{CALL SP_SYNC_ACTUALIZAR_JOB
            (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        }""", (
            job_id, status, total_rues, total_apify, total_unificados,
            total_solo_rues, total_solo_apify, total_argos, total_solo_argos, mensaje
        ))
        conn.commit()
        return True
    except Exception as e:
        logger.error(f"Error updating sync job: {e}")
        return False
    finally:
        if conn:
            conn.close()


def sync_obtener_job(job_id):
    """Obtiene estado actual de un job"""
    conn = get_db_connection()
    if not conn:
        return None

    try:
        cursor = conn.cursor()
        cursor.execute("{CALL SP_SYNC_OBTENER_JOB(?)}", (job_id,))

        columns = [description[0] for description in cursor.description]
        row = cursor.fetchone()

        if row:
            row_dict = dict(zip(columns, row))
            return _normalize_dict_keys(row_dict)
        return None
    except Exception as e:
        logger.error(f"Error getting sync job: {e}")
        return None
    finally:
        if conn:
            conn.close()


# ============================================================
# CONTACTOS - OPERACIONES DE BASE DE DATOS
# ============================================================

def mapa_obtener_contactos(ferreteria_id: int):
    """Obtiene contactos asociados a una ferretería"""
    conn = get_db_connection()
    if not conn:
        return []

    try:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT ID, NOMBRE_COMPLETO, CARGO, MOVIL, GENERO, HABEAS_DATA, CODIGO_CLIENTE_ARGOS
            FROM FerreteriasUnificadas_Contactos
            WHERE FERRETERIA_UNIFICADA_ID = ?
            ORDER BY ID
        """, (ferreteria_id,))

        columns = [description[0] for description in cursor.description]
        rows = []
        for row in cursor.fetchall():
            row_dict = dict(zip(columns, row))
            rows.append(_normalize_dict_keys(row_dict))

        return rows
    except Exception as e:
        logger.error(f"Error getting contacts: {e}")
        return []
    finally:
        if conn:
            conn.close()

# ============================================================
# RUES - OPERACIONES DE BASE DE DATOS (Similar a ARGOS)
# ============================================================

def rues_verificar_y_registrar_upload(file_id, filename, hash_archivo):
    """
    Registra un nuevo procesamiento en RUES_UPLOADS.
    Cada file_id es único, permitiendo múltiples procesamientos del mismo archivo con diferentes filtros.
    """
    conn = get_db_connection()
    if not conn:
        return None, None

    try:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO rues_uploads (FILE_ID, FILENAME, HASH_ARCHIVO, STATUS, CREATED_AT)
            VALUES (?, ?, ?, 'processing', GETDATE())
        """, (file_id, filename, hash_archivo))
        conn.commit()
        logger.info(f"[BD] Nuevo procesamiento RUES registrado: {file_id} - {filename}")
        return None, None
    except Exception as e:
        logger.error(f"Error registrando nuevo procesamiento RUES {file_id}: {e}")
        raise
    finally:
        if conn:
            conn.close()


def rues_guardar_estado_inicial(file_id, filename, total_registros, departamentos=None, municipios=None):
    """
    Guarda el estado inicial INMEDIATAMENTE después de recibir el archivo RUES.
    Se ejecuta ANTES del procesamiento en background.
    También guarda los filtros aplicados para el historial.
    """
    conn = get_db_connection()
    if not conn:
        return False

    try:
        cursor = conn.cursor()

        # Convertir listas a string para guardar en BD
        depto_str = None
        munic_str = None

        if departamentos and len(departamentos) > 0:
            # Guardar tal cual, incluyendo "TODOS"
            depto_filtrados = [d for d in departamentos if d]
            depto_str = ",".join(depto_filtrados) if depto_filtrados else None

        if municipios and len(municipios) > 0:
            # Guardar tal cual, incluyendo "TODOS"
            munic_filtrados = [m for m in municipios if m]
            munic_str = ",".join(munic_filtrados) if munic_filtrados else None

        print(f"[DEBUG] Guardando RUES en BD: depto_str={depto_str}, munic_str={munic_str}", flush=True)

        cursor.execute("""
            UPDATE RUES_UPLOADS
            SET STATUS = 'processing',
                TOTAL_RECORDS = ?,
                REGISTROS_PROCESADOS = 0,
                MENSAJE = ?,
                DEPARTAMENTOS = ?,
                MUNICIPIOS = ?,
                FECHA_ACTUALIZACION = GETDATE()
            WHERE FILE_ID = ?
        """, (total_registros, f"Archivo recibido. {total_registros} registros en proceso.", depto_str, munic_str, file_id))
        conn.commit()
        logger.info(f"[BD] Estado inicial RUES guardado: {file_id} ({total_registros} registros) - Depto: {depto_str}, Municipios: {munic_str}")
        return True
    except Exception as e:
        logger.error(f"Error guardando estado inicial RUES {file_id}: {e}")
        return False
    finally:
        if conn:
            conn.close()


def rues_marcar_sin_datos(file_id, departamentos=None, municipios=None):
    """
    Marca el upload RUES como completado sin datos cuando los filtros no coinciden con ningún registro.
    También guarda los filtros para el historial.
    """
    conn = get_db_connection()
    if not conn:
        return False

    try:
        cursor = conn.cursor()

        # Generar mensaje descriptivo y preparar strings de filtros
        filtros = []
        depto_str = None
        munic_str = None

        if departamentos and len(departamentos) > 0:
            # Guardar tal cual, incluyendo "TODOS"
            depto_filtrados = [d for d in departamentos if d]
            depto_str = ",".join(depto_filtrados) if depto_filtrados else None
            if depto_str:
                filtros.append(f"Departamentos: {depto_str.replace(',', ', ')}")

        if municipios and len(municipios) > 0:
            # Guardar tal cual, incluyendo "TODOS"
            munic_filtrados = [m for m in municipios if m]
            munic_str = ",".join(munic_filtrados) if munic_filtrados else None
            if munic_str:
                filtros.append(f"Municipios: {munic_str.replace(',', ', ')}")

        filtro_texto = " | ".join(filtros) if filtros else "Departamentos/Municipios especificados"
        mensaje = f"[!] No hay registros que cumplan con los filtros: {filtro_texto}"

        print(f"[DEBUG] Marcando RUES como no_data: depto_str={depto_str}, munic_str={munic_str}", flush=True)

        cursor.execute("""
            UPDATE RUES_UPLOADS
            SET STATUS = 'no_data',
                TOTAL_RECORDS = 0,
                REGISTROS_PROCESADOS = 0,
                MENSAJE = ?,
                DEPARTAMENTOS = ?,
                MUNICIPIOS = ?,
                FECHA_ACTUALIZACION = GETDATE()
            WHERE FILE_ID = ?
        """, (mensaje, depto_str, munic_str, file_id))
        conn.commit()
        logger.info(f"[BD] Upload RUES marcado sin datos: {file_id} - {mensaje}")
        return True
    except Exception as e:
        logger.error(f"Error marcando RUES como sin datos {file_id}: {e}")
        return False
    finally:
        if conn:
            conn.close()


def rues_marcar_como_completado(file_id, total_registros):
    """
    Marca el upload RUES como completado con éxito.
    Se ejecuta al final del procesamiento.
    """
    conn = get_db_connection()
    if not conn:
        return False

    try:
        cursor = conn.cursor()
        cursor.execute("""
            UPDATE RUES_UPLOADS
            SET STATUS = 'completed',
                REGISTROS_PROCESADOS = ?,
                MENSAJE = ?,
                FECHA_ACTUALIZACION = GETDATE()
            WHERE FILE_ID = ?
        """, (total_registros, f"[OK] Completado {total_registros}/{total_registros} registros procesados exitosamente", file_id))
        conn.commit()
        logger.info(f"[BD] Procesamiento RUES completado: {file_id}")
        return True
    except Exception as e:
        logger.error(f"Error marcando RUES como completado {file_id}: {e}")
        return False
    finally:
        if conn:
            conn.close()


def rues_marcar_como_fallido(file_id, mensaje_error):
    """
    Marca el upload RUES como fallido cuando ocurre un error fatal.
    """
    conn = get_db_connection()
    if not conn:
        return False

    try:
        cursor = conn.cursor()
        cursor.execute("""
            UPDATE RUES_UPLOADS
            SET STATUS = 'failed',
                MENSAJE = ?,
                FECHA_ACTUALIZACION = GETDATE()
            WHERE FILE_ID = ?
        """, (f"[X] El proceso falló: {mensaje_error}", file_id))
        conn.commit()
        logger.error(f"[BD] Procesamiento RUES fallido: {file_id} - {mensaje_error}")
        return True
    except Exception as e:
        logger.error(f"Error marcando RUES como fallido {file_id}: {e}")
        return False
    finally:
        if conn:
            conn.close()


def rues_consultar_estado_upload(file_id):
    """Consulta estado de un upload RUES y cuenta de registros"""
    conn = get_db_connection()
    if not conn:
        return None, None, None

    cursor = None
    try:
        cursor = conn.cursor()

        # Paso 1: Obtener estado desde RUES_UPLOADS
        print(f"[DEBUG] Consultando RUES_UPLOADS para file_id={file_id}", flush=True)
        cursor.execute("""
            SELECT STATUS, FILENAME, TOTAL_RECORDS, REGISTROS_PROCESADOS
            FROM RUES_UPLOADS
            WHERE FILE_ID = ?
        """, (file_id,))

        upload_row = cursor.fetchone()
        if not upload_row:
            print(f"[DEBUG] No se encontró upload RUES para file_id={file_id}", flush=True)
            return None, None, None

        status = upload_row[0]
        filename = upload_row[1]
        total_bd = upload_row[2] if upload_row[2] else 0
        procesados_bd = upload_row[3] if upload_row[3] else 0

        print(f"[DEBUG] Status={status}, Filename={filename}, Total={total_bd}, Procesados={procesados_bd}", flush=True)

        # Si el estado es "no_data", retornar inmediatamente
        if status == "no_data":
            print(f"[DEBUG] Estado es 'no_data', retornando 0 registros", flush=True)
            return status, filename, {'total': 0, 'procesados': 0}

        # Paso 2: Contar registros reales en RUES_RECORDS
        print(f"[DEBUG] Contando registros en RUES_RECORDS para file_id={file_id}", flush=True)
        cursor.execute("""
            SELECT COUNT(*) FROM RUES_RECORDS WHERE FILE_ID = ?
        """, (file_id,))

        count_result = cursor.fetchone()
        total_real = count_result[0] if count_result and count_result[0] else total_bd

        # Contar procesados
        cursor.execute("""
            SELECT COUNT(*) FROM RUES_RECORDS WHERE FILE_ID = ? AND PROCESSED = 1
        """, (file_id,))

        proc_result = cursor.fetchone()
        procesados_real = proc_result[0] if proc_result and proc_result[0] else procesados_bd

        print(f"[DEBUG] Total={total_real}, Procesados={procesados_real}", flush=True)

        return status, filename, {'total': total_real, 'procesados': procesados_real}

    except Exception as e:
        logger.error(f"Error en rues_consultar_estado_upload: {e}")
        print(f"[ERROR] rues_consultar_estado_upload: {e}", flush=True)
        import traceback
        traceback.print_exc(file=sys.stdout)
        return None, None, None
    finally:
        if conn:
            conn.close()


def sync_obtener_descartados(job_id: str) -> list[dict]:
    """Obtiene los registros descartados durante una sincronizacin."""
    conn = get_db_connection()
    if not conn:
        return []

    try:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT NOMBRE, FUENTE, MOTIVO, FECHA_REGISTRO
            FROM SyncJobs_Descartados
            WHERE JOB_ID = ?
            ORDER BY FECHA_REGISTRO DESC
        """, (job_id,))

        result = []
        for row in cursor.fetchall():
            result.append({
                'nombre': row[0],
                'fuente': row[1],
                'motivo': row[2],
                'fecha_registro': str(row[3]) if row[3] else None,
            })
        return result
    except Exception as e:
        logger.error(f"Error obteniendo descartados para {job_id}: {e}")
        return []
    finally:
        if conn:
            conn.close()
