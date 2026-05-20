import pyodbc
from config import Config

def get_db_connection():
    """
    Establece y retorna la conexion a SQL Server.
    Retorna None si hay un error de conexion.
    """
    try:
        # Usamos el Driver 18 y agregamos la configuracin de certificados
        conn_str = (
            f"DRIVER={{ODBC Driver 18 for SQL Server}};"
            f"SERVER={Config.DB_SERVER};"
            f"DATABASE={Config.DB_DATABASE};"
            f"UID={Config.DB_USER};"
            f"PWD={Config.DB_PASSWORD};"
            f"TrustServerCertificate=yes;"
            f"Encrypt=yes;"
        )
        
        conexion = pyodbc.connect(conn_str)
        return conexion
        
    except pyodbc.Error as e:
        print(f"[X] Error al conectar a la base de datos: {e}")
        return None