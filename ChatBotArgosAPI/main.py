from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List

from services import SQLServerService, GeminiService
from agent import ChatbotAgent

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class Mensaje(BaseModel):
    role: str
    content: str

class ChatRequest(BaseModel):
    historial: List[Mensaje] = []
    mensaje: str

# INYECCIÓN DE DEPENDENCIAS:
# Aquí es donde le pasamos las herramientas al Agente.
db_service = SQLServerService()
llm_service = GeminiService()
chatbot = ChatbotAgent(db=db_service, llm=llm_service)

@app.post("/api/chat")
async def chat_endpoint(req: ChatRequest):
    # Convertimos el historial de Pydantic a diccionarios
    historial_dict = [{"role": m.role, "content": m.content} for m in req.historial]
    
    # Procesamos
    respuesta = chatbot.procesar_mensaje(historial_dict, req.mensaje)
    
    return {"respuesta": respuesta}