import pyodbc
import time
import requests
from interfaces import DatabaseInterface, LLMInterface
from config import settings
from typing import List, Dict

class SQLServerService(DatabaseInterface):
    def __init__(self):
        self.conn_str = (
            f"Driver={{ODBC Driver 18 for SQL Server}};"
            f"Server={settings.db_server};"
            f"Database={settings.db_database};"
            f"UID={settings.db_username};"
            f"PWD={settings.db_password};"
            f"TrustServerCertificate=yes;"
            f"Encrypt=yes;"
        )

    def _ejecutar_query(self, query: str, params: tuple = ()) -> str:
        conn = None
        try:
            conn = pyodbc.connect(self.conn_str)
            cursor = conn.cursor()
            cursor.execute(query, params)

            column_names = [desc[0] for desc in cursor.description]
            results = cursor.fetchall()

            if not results:
                print("⚠️ SQL Server: No se encontraron registros.")
                return "No se encontraron resultados en la base de datos."

            output = []
            for row in results:
                row_dict = dict(zip(column_names, row))
                line = " | ".join([f"{k}: {v}" for k, v in row_dict.items() if v is not None])
                output.append(f"- {line}")

            texto_final = "\n".join(output)

            print(f"✅ SQL Server devolvió {len(results)} registros.")
            if output:
                print(f"📊 Primer registro: {output[0][:150]}...")

            return texto_final

        except Exception as e:
            print(f"❌ Error real en SQL: {e}")
            return f"Error técnico al consultar BD: {e}"
        finally:
            if conn:
                conn.close()

    def consultar(self, intencion: str, parametros: dict) -> str:
        print(f"🔍 Ejecutando consulta real para intención: {intencion}")

        if intencion == "buscar_municipio":
            municipio = parametros.get('municipio', '')
            query = """
                SELECT ID, NOMBRE, TELEFONO, WHATSAPP, NIT, LAT, LNG, URL_GOOGLE, URLS_IMAGENES, FACEBOOK, INSTAGRAM, FECHA_CREACION, FECHA_ACTUALIZACION, VENDE_CEMENTO, VENDE_TUBOS, VENDE_VARILLAS, VENDE_LADRILLOS, VENDE_AGREGADOS, SCORE, MATERIALES_OBSERVADOS, NIVEL_CONFIANZA, ULTIMO_ANALISIS, DEPARTAMENTO, MUNICIPIO, DIRECCION_COMERCIAL, CORREO_COMERCIAL, SITIO_WEB
                FROM FerreteriasUnificadas
                WHERE MUNICIPIO LIKE ?
            """
            return self._ejecutar_query(query, (f"%{municipio}%",))

        if intencion == "contar_departamento":
            query = """
                SELECT DEPARTAMENTO, COUNT(*) as TotalFerreterias
                FROM FerreteriasUnificadas
                GROUP BY DEPARTAMENTO
                ORDER BY TotalFerreterias DESC
            """
            return self._ejecutar_query(query)

        if intencion == "buscar_producto":
            producto = parametros.get('producto', '').lower()
            columnas = {
                "cemento": "VENDE_CEMENTO",
                "tubos": "VENDE_TUBOS",
                "varillas": "VENDE_VARILLAS",
                "ladrillos": "VENDE_LADRILLOS",
                "agregados": "VENDE_AGREGADOS"
            }
            columna = columnas.get(producto)
            if columna:
                query = f"""
                    SELECT ID, NOMBRE, TELEFONO, WHATSAPP, NIT, LAT, LNG, URL_GOOGLE, URLS_IMAGENES, FACEBOOK, INSTAGRAM, FECHA_CREACION, FECHA_ACTUALIZACION, VENDE_CEMENTO, VENDE_TUBOS, VENDE_VARILLAS, VENDE_LADRILLOS, VENDE_AGREGADOS, SCORE, MATERIALES_OBSERVADOS, NIVEL_CONFIANZA, ULTIMO_ANALISIS, DEPARTAMENTO, MUNICIPIO, DIRECCION_COMERCIAL, CORREO_COMERCIAL, SITIO_WEB
                    FROM FerreteriasUnificadas
                    WHERE {columna} = 1
                """
                return self._ejecutar_query(query)

        if intencion == "buscar_combinado":
            conditions = []
            query_params = []

            if parametros.get("municipio"):
                conditions.append("(MUNICIPIO LIKE ? OR DIRECCION_COMERCIAL LIKE ?)")
                query_params.append(f"%{parametros['municipio']}%")
                query_params.append(f"%{parametros['municipio']}%")

            if parametros.get("departamento"):
                conditions.append("DEPARTAMENTO LIKE ?")
                query_params.append(f"%{parametros['departamento']}%")

            if parametros.get("nombre_tienda"):
                # Búsqueda robusta: remover espacios, guiones, caracteres especiales + case-insensitive
                nombre_busqueda = parametros['nombre_tienda']
                # Remover espacios, guiones, acentos
                nombre_limpio = nombre_busqueda.replace(" ", "").replace("-", "").lower()
                # En SQL Server: remover espacios Y guiones de ambos lados para búsqueda flexible
                conditions.append("LOWER(REPLACE(REPLACE(NOMBRE, ' ', ''), '-', '')) LIKE ?")
                query_params.append(f"%{nombre_limpio}%")

            if parametros.get("producto"):
                producto = parametros["producto"].lower()
                columnas_producto = {
                    "cemento": "VENDE_CEMENTO",
                    "tubos": "VENDE_TUBOS",
                    "varillas": "VENDE_VARILLAS",
                    "ladrillos": "VENDE_LADRILLOS",
                    "agregados": "VENDE_AGREGADOS"
                }
                columna = columnas_producto.get(producto)
                if columna:
                    conditions.append(f"{columna} = 1")

            if parametros.get("marca_cemento"):
                conditions.append("MATERIALES_OBSERVADOS LIKE ?")
                query_params.append(f"%{parametros['marca_cemento']}%")

            where_clause = " AND ".join(conditions) if conditions else "1=1"

            query = f"""
                SELECT TOP 20 ID, NOMBRE, TELEFONO, WHATSAPP, MUNICIPIO, DEPARTAMENTO,
                       DIRECCION_COMERCIAL, VENDE_CEMENTO, VENDE_TUBOS, VENDE_VARILLAS,
                       VENDE_LADRILLOS, VENDE_AGREGADOS, SCORE, MATERIALES_OBSERVADOS,
                       NIVEL_CONFIANZA, URL_GOOGLE, SITIO_WEB, CORREO_COMERCIAL, RAZON_SOCIAL_RUES
                FROM FerreteriasUnificadas
                WHERE {where_clause}
                ORDER BY SCORE DESC
            """
            return self._ejecutar_query(query, tuple(query_params))

        query = """
            SELECT TOP 5 ID, NOMBRE, TELEFONO, WHATSAPP, MUNICIPIO, DEPARTAMENTO,
                   DIRECCION_COMERCIAL, VENDE_CEMENTO, VENDE_TUBOS, VENDE_VARILLAS,
                   VENDE_LADRILLOS, VENDE_AGREGADOS, SCORE, MATERIALES_OBSERVADOS,
                   NIVEL_CONFIANZA, URL_GOOGLE, SITIO_WEB, CORREO_COMERCIAL, RAZON_SOCIAL_RUES
            FROM FerreteriasUnificadas
        """
        return self._ejecutar_query(query)


class GeminiService(LLMInterface):
    def generar_respuesta(self, mensajes: List[Dict], system_prompt: str = "") -> str:
        # Lista de modelos a probar en orden (del más nuevo al más antiguo/estable)
        modelos_a_probar = [
            settings.gemini_model,  # Primera opción: la configurada
            "gemini-2.0-flash",     # Fallback: versión anterior (más estable)
            "gemini-1.5-flash-001", # Fallback: modelo antiguo pero estable
            "gemini-1.5-pro",       # Fallback: model pro (más lento pero confiable)
        ]

        max_reintentos_por_modelo = 2
        delay_reintento = 2

        contents = [
            {
                "role": "user" if m["role"] == "user" else "model",
                "parts": [{"text": m["content"]}]
            }
            for m in mensajes
        ]

        payload = {
            "contents": contents,
            "generationConfig": {
                "temperature": settings.gemini_temperature,
                "maxOutputTokens": 2000
            }
        }

        if system_prompt:
            payload["systemInstruction"] = {"parts": [{"text": system_prompt}]}

        # Intenta cada modelo en la lista
        for modelo in modelos_a_probar:
            print(f"\n📋 Probando modelo: {modelo}")

            for intento in range(max_reintentos_por_modelo):
                url = f"https://generativelanguage.googleapis.com/v1beta/models/{modelo}:generateContent?key={settings.gemini_api_key}"

                try:
                    print(f"🧠 Intento {intento + 1}/{max_reintentos_por_modelo}...")
                    response = requests.post(url, json=payload, timeout=60)

                    if response.status_code == 200:
                        data = response.json()

                        try:
                            candidatos = data.get("candidates", [])
                            texto = ""
                            if candidatos:
                                texto = candidatos[0].get("content", {}).get("parts", [{}])[0].get("text", "")
                            if texto:
                                print(f"✅ Éxito con {modelo}")
                                return texto
                            else:
                                print(f"⚠️ {modelo} respondió sin texto. Probando siguiente...")
                                break  # Pasar al siguiente modelo
                        except Exception as parse_error:
                            print(f"❌ Error leyendo respuesta: {parse_error}")
                            break  # Pasar al siguiente modelo

                    elif response.status_code in [429, 503]:
                        # Rate limit o saturado - reintentar mismo modelo
                        print(f"⚠️ {modelo} saturado ({response.status_code}). Esperando {delay_reintento}s...")
                        time.sleep(delay_reintento)
                        continue

                    elif response.status_code == 404:
                        # Modelo no disponible - pasar al siguiente
                        print(f"⚠️ {modelo} no disponible (404). Probando siguiente modelo...")
                        break

                    else:
                        print(f"❌ Error {response.status_code}. Probando siguiente modelo...")
                        break

                except Exception as e:
                    print(f"❌ Error de conexión: {e}")
                    break  # Pasar al siguiente modelo

        return "❌ Error: No hay modelos disponibles. Verifica tu API key de Gemini o intenta más tarde."