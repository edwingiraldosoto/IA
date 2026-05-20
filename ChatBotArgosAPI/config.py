from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    # Base de Datos
    db_server: str
    db_database: str
    db_username: str
    db_password: str
    
    # IA
    gemini_api_key: str
    gemini_model: str = "gemini-2.5-flash"
    gemini_temperature: float = 0.3

    # Esta línea es la magia: lee el .env pero ignora las variables que sobren
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

settings = Settings()