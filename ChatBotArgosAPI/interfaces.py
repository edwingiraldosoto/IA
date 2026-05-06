from abc import ABC, abstractmethod
from typing import List, Dict

class DatabaseInterface(ABC):
    @abstractmethod
    def consultar(self, intencion: str, parametros: dict) -> str:
        """Debe retornar un string con los datos encontrados"""
        pass

class LLMInterface(ABC):
    @abstractmethod
    def generar_respuesta(self, mensajes: List[Dict], system_prompt: str = "") -> str:
        """Debe recibir un historial y retornar el texto de la IA"""
        pass