"""LulaDroid: Transcrição e Assistente de Voz 100% via Google Gemini API.
Realiza transcrição de áudio multimodal e análise de texto diretamente com Gemini.
"""
import os
import json
import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict
from upstream import client_for, read_json

DEFAULT_GEMINI_KEY = ""
DEFAULT_GEMINI_PROJECT = "735777445484"

class LulaDroidQuery(BaseModel):
    model_config = ConfigDict(extra="ignore")
    prompt: str | None = None
    audio_base64: str | None = None
    mime_type: str | None = "audio/webm"
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
        audio_b64 = (body.audio_base64 or "").strip()

        if not prompt and not audio_b64:
            raise HTTPException(400, "Forneça um texto ou áudio para o Gemini processar.")

        key, project = get_gemini_credentials()

        system_instruction = (
            "Você é o LulaDroid, um assistente robô inteligente, carismático e prestativo "
            "em português brasileiro para as chamadas de voz e vídeo do aplicativo Órbita. "
            "Você realiza a transcrição precisa da fala e responde às dúvidas de forma amigável, direta e concisa "
            "(no máximo 2 ou 3 frases curtas), de modo que sua resposta soe excelente ao ser falada na chamada."
        )

        headers = {
            "Content-Type": "application/json",
            "x-goog-api-key": key,
        }
        if project:
            headers["x-goog-user-project"] = project

        parts = []
        if audio_b64:
            clean_b64 = audio_b64.split(",")[-1]
            parts.append({
                "inlineData": {
                    "mimeType": body.mime_type or "audio/webm",
                    "data": clean_b64
                }
            })
            inst = (
                "Transcreva com precisão o que foi falado no áudio em português brasileiro. "
                "Em seguida, verifique se a fala ativou o comando 'eai LulaDroid' (ou 'e aí LulaDroid'). "
                "Se ativou, responda com gentileza à pergunta ou saudação (em 2 ou 3 frases curtas). "
                "Retorne estritamente um JSON no seguinte formato: "
                '{"transcricao": "texto transcrito aqui", "ativou": true ou false, "resposta": "sua resposta aqui ou vazio"}'
            )
            parts.append({"text": inst})
        else:
            parts.append({"text": prompt})

        payload = {
            "system_instruction": {"parts": [{"text": system_instruction}]},
            "contents": [{"role": "user", "parts": parts}],
            "generationConfig": {"temperature": 0.7, "maxOutputTokens": 400}
        }

        last_error = None
        for model in ("gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"):
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}"
            try:
                async with client_for(app) as client:
                    response = await client.post(url, headers=headers, json=payload, timeout=20.0)
                    if response.status_code == 200:
                        data = read_json(response, dict)
                        candidates = data.get("candidates") or []
                        if candidates:
                            c_parts = candidates[0].get("content", {}).get("parts", [])
                            if c_parts and "text" in c_parts[0]:
                                raw_out = c_parts[0]["text"].strip()
                                if audio_b64:
                                    try:
                                        clean_json = raw_out.strip("`").replace("json\n", "", 1).strip()
                                        parsed = json.loads(clean_json)
                                        return {
                                            "success": True,
                                            "transcription": parsed.get("transcricao", ""),
                                            "triggered": bool(parsed.get("ativou")),
                                            "reply": parsed.get("resposta", ""),
                                            "model": model,
                                            "speaker": body.speaker or user.get("user_metadata", {}).get("display_name", "Participante")
                                        }
                                    except Exception:
                                        return {
                                            "success": True,
                                            "transcription": raw_out,
                                            "triggered": "eai luladroid" in raw_out.lower() or "e aí luladroid" in raw_out.lower(),
                                            "reply": raw_out,
                                            "model": model
                                        }
                                return {
                                    "success": True,
                                    "reply": raw_out,
                                    "model": model,
                                    "speaker": body.speaker or user.get("user_metadata", {}).get("display_name", "Participante")
                                }
                    else:
                        last_error = f"HTTP {response.status_code}"
            except Exception as e:
                last_error = str(e)

        fallback_reply = (
            f"Olá companheiro! LulaDroid na escuta com Gemini. "
            f"Ouvi sua mensagem: '{prompt or 'áudio recebido'}' e estou ativo na chamada!"
        )
        return {
            "success": True,
            "transcription": prompt or "Áudio processado pelo Gemini",
            "triggered": False,
            "reply": fallback_reply,
            "model": "fallback-gemini",
            "fallback": True,
            "error_detail": last_error
        }
