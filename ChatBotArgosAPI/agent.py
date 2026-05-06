import hashlib
import json
import time
import os
from typing import TypedDict, List, Optional
from langgraph.graph import StateGraph, END
from interfaces import DatabaseInterface, LLMInterface

# Cargar prompts desde archivo externo
def _cargar_prompts():
    ruta_prompts = os.path.join(os.path.dirname(__file__), "prompts.json")
    try:
        with open(ruta_prompts, 'r', encoding='utf-8') as f:
            return json.load(f)
    except FileNotFoundError:
        print(f"⚠️ Archivo prompts.json no encontrado en {ruta_prompts}")
        return {}
    except json.JSONDecodeError:
        print(f"❌ Error al parsear prompts.json")
        return {}

_PROMPTS = _cargar_prompts()

class ChatState(TypedDict):
    messages: List[dict]
    datos_bd: str

class ChatbotAgent:
    _cache: dict = {}
    _CACHE_TTL = 1800  # 30 minutos - optimizado para escala con múltiples usuarios

    def __init__(self, db: DatabaseInterface, llm: LLMInterface):
        self.db = db
        self.llm = llm
        self.grafo = self._construir_grafo()

    FRASES_IDENTIDAD = [
        "quien eres", "quién eres", "qué eres", "que eres",
        "tu nombre", "cómo te llamas", "como te llamas",
        "preséntate", "presentate", "who are you", "what are you"
    ]

    RESPUESTA_IDENTIDAD = (
        "Soy **Panoptes**, el asistente de consultas de bases de datos unificadas "
        "de posibles clientes potenciales. Puedo ayudarte a explorar y analizar "
        "información sobre ferreterías y establecimientos comerciales registrados. "
        "¿En qué puedo ayudarte hoy?"
    )

    # Prompts se cargan desde prompts.json (archivo externo)
    @staticmethod
    def get_system_prompt():
        return _PROMPTS.get("system_prompt", "")

    @staticmethod
    def get_prompt_extraccion():
        return _PROMPTS.get("prompt_extraccion", "")

    def _cache_get(self, key: str) -> Optional[str]:
        if key in self._cache:
            ts, data = self._cache[key]
            if time.time() - ts < self._CACHE_TTL:
                return data
            del self._cache[key]
        return None

    def _cache_set(self, key: str, data: str):
        self._cache[key] = (time.time(), data)

    def _make_cache_key(self, params: dict) -> str:
        # Normalizar parámetros para cache (lowercase, sin espacios extra)
        normalized = {k: str(v).lower().strip() if v else "" for k, v in params.items()}
        return hashlib.md5(json.dumps(normalized, sort_keys=True).encode()).hexdigest()

    def _extraer_parametros(self, pregunta: str, mensajes_previos: List[dict] = None) -> dict:
        # Construir contexto conversacional para entender follow-ups
        contexto = ""
        if mensajes_previos and len(mensajes_previos) > 0:
            # Incluir último exchange para que el LLM entienda el contexto
            ultimas_lineas = mensajes_previos[-4:]  # Últimas 2 exchanges
            for msg in ultimas_lineas:
                rol = msg.get("role", "").upper()
                contenido = msg.get("content", "")[:200]  # Limitar a 200 chars por msg
                contexto += f"{rol}: {contenido}\n"
            contexto = "CONTEXTO CONVERSACIONAL:\n" + contexto + "\nPREGUNTA ACTUAL: "

        prompt = self.get_prompt_extraccion() + contexto + pregunta
        respuesta = self.llm.generar_respuesta([{"role": "user", "content": prompt}])
        try:
            texto = respuesta.strip()
            if "```" in texto:
                partes = texto.split("```")
                texto = partes[1] if len(partes) > 1 else partes[0]
                if texto.startswith("json"):
                    texto = texto[4:]
            resultado = json.loads(texto.strip())
            print(f"✅ Parámetros parseados correctamente: {resultado}")
            return resultado
        except Exception as e:
            print(f"⚠️ No se pudo parsear extracción: {respuesta[:100]}... Error: {e}")
            # Fallback: intenta extraer nombre_tienda manualmente si falla
            pregunta_lower = pregunta.lower()
            if any(palabra in pregunta_lower for palabra in ["ferri punto", "pradito", "bomba", "mina", "roma", "londoño", "corona"]):
                return {"intencion": "buscar_tienda"}
            return {"intencion": "general"}

    def extraer_datos(self, state: ChatState) -> ChatState:
        pregunta = state["messages"][-1]["content"]
        pregunta_lower = pregunta.lower()

        if any(frase in pregunta_lower for frase in self.FRASES_IDENTIDAD):
            state["datos_bd"] = "__IDENTIDAD__"
            return state

        # Pasar historial para que entienda follow-ups
        params = self._extraer_parametros(pregunta, state["messages"][:-1])
        print(f"📋 Parámetros extraídos: {params}")

        cache_key = self._make_cache_key(params)
        cached = self._cache_get(cache_key)
        if cached:
            print(f"✅ Cache hit para: {params}")
            state["datos_bd"] = cached
            return state

        intencion = params.get("intencion", "general")

        if intencion == "contar_departamento":
            datos = self.db.consultar("contar_departamento", {})
        elif any(params.get(k) for k in ["municipio", "departamento", "nombre_tienda", "producto", "marca_cemento"]):
            datos = self.db.consultar("buscar_combinado", params)
        else:
            datos = self.db.consultar("general", {})

        self._cache_set(cache_key, datos)
        state["datos_bd"] = datos
        return state

    def analizar_con_ia(self, state: ChatState) -> ChatState:
        if state["datos_bd"] == "__IDENTIDAD__":
            state["messages"].append({"role": "assistant", "content": self.RESPUESTA_IDENTIDAD})
            return state

        # Usar prompt enriquecido desde archivo externo
        prompt_template = _PROMPTS.get("prompt_enriquecido", "")
        mensaje_enriquecido = prompt_template.format(
            user_question=state['messages'][-1]['content'],
            database_data=state['datos_bd']
        )

        mensajes_ia = state["messages"][:-1].copy()
        mensajes_ia.append({"role": "user", "content": mensaje_enriquecido})

        respuesta = self.llm.generar_respuesta(mensajes_ia, system_prompt=self.get_system_prompt())
        
        state["messages"].append({"role": "assistant", "content": respuesta})
        return state

    def _construir_grafo(self):
        grafo = StateGraph(ChatState)
        grafo.add_node("extraer", self.extraer_datos)
        grafo.add_node("analizar", self.analizar_con_ia)
        
        grafo.set_entry_point("extraer")
        grafo.add_edge("extraer", "analizar")
        grafo.add_edge("analizar", END)
        
        return grafo.compile()

    def procesar_mensaje(self, historial: List[dict], nuevo_mensaje: str) -> str:
        historial.append({"role": "user", "content": nuevo_mensaje})
        estado_inicial = {"messages": historial, "datos_bd": ""}
        
        resultado = self.grafo.invoke(estado_inicial)
        return resultado["messages"][-1]["content"]