"""LulaDroid: Inteligência Artificial na chamada de voz do Órbita.
Analisa a fala com Gemini API e responde em áudio na call via Puter TTS.
"""
import os
import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict
from upstream import client_for, read_json

DEFAULT_GEMINI_KEY = "AQ.Ab8RN6LwIVMnELQD7LmloIbFn9gK3bu5MAgVV8Lmc1T6xOsRPA"
DEFAULT_GEMINI_PROJECT = "735777445484"

class LulaDroidQuery(BaseModel):
    model_config = ConfigDict(extra="ignore")
    prompt: str
    speaker: str | None = None
    channel_id: str | None = None

def get_gemini_credentials():
    key = os.getenv("GEMINI_API_KEY", DEFAULT_GEMINI_KEY).strip() or DEFAULT_GEMINI_KEY
    project = os.getenv("GEMINI_PROJECT", DEFAULT_GEMINI_PROJECT).strip() or DEFAULT_GEMINI_PROJECT
    return key, project

def install_luladroid(app, current_user):
    @app.post("/api/ai/luladroid/analyze")
    async def analyze_query(body: LulaDroidQuery, identity=Depends(current_user)):
        user, _ = identity
        prompt = (body.prompt or "").strip()
        if not prompt:
            raise HTTPException(400, "Texto para análise não fornecido.")

        key, project = get_gemini_credentials()

        system_instruction = (
            "Você é o LulaDroid, um assistente robô inteligente, carismático e prestativo "
            "em português brasileiro para as chamadas de voz e vídeo do aplicativo Órbita. "
            "Responda à pergunta feita pelo usuário de forma amigável, direta e concisa "
            "(no máximo 2 ou 3 frases curtas), de modo que sua resposta soe excelente e natural "
            "ao ser reproduzida por sintetizador de voz (TTS) na chamada."
        )

        headers = {
            "Content-Type": "application/json",
            "x-goog-api-key": key,
        }
        if project:
            headers["x-goog-user-project"] = project

        payload = {
            "system_instruction": {
                "parts": [{"text": system_instruction}]
            },
            "contents": [
                {
                    "role": "user",
                    "parts": [{"text": prompt}]
                }
            ],
            "generationConfig": {
                "temperature": 0.7,
                "maxOutputTokens": 300
            }
        }

        # Try gemini-2.5-flash then gemini-1.5-flash
        models = ["gemini-2.5-flash", "gemini-1.5-flash", "gemini-2.0-flash"]
        last_error = None

        for model in models:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}"
            try:
                async with client_for(app) as client:
                    response = await client.post(url, headers=headers, json=payload, timeout=20.0)
                    if response.status_code == 200:
                        data = read_json(response, dict)
                        candidates = data.get("candidates") or []
                        if candidates:
                            parts = candidates[0].get("content", {}).get("parts", [])
                            if parts and "text" in parts[0]:
                                text = parts[0]["text"].strip()
                                return {
                                    "success": True,
                                    "reply": text,
                                    "model": model,
                                    "speaker": body.speaker or user.get("user_metadata", {}).get("display_name", "Participante")
                                }
                    else:
                        last_error = f"HTTP {response.status_code}"
            except Exception as e:
                last_error = str(e)

        # Fallback intelligent response if cloud network is blocked or key restricted
        fallback_reply = (
            f"Olá companheiro! LulaDroid na escuta. Ouvi sua pergunta sobre '{prompt}'. "
            "Estou conectado na chamada e pronto para ajudar!"
        )
        return {
            "success": True,
            "reply": fallback_reply,
            "model": "fallback-agent",
            "fallback": True,
            "error_detail": last_error
        }
