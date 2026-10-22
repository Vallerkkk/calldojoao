"""Opt-in call assistant. No raw audio or transcript is sent to Gemini."""
import os,re,unicodedata,json
from uuid import UUID
from fastapi import Depends,HTTPException
from pydantic import BaseModel,Field
from livekit import api
import httpx
from upstream import client_for

def question_from_speech(text):
    normalized=''.join(c for c in unicodedata.normalize('NFD',text.lower())if unicodedata.category(c)!='Mn')
    match=re.search(r'\b(?:e\s*ai)\s+lula\s*droid\b[\s,:!?;.-]*(.*)',normalized,re.S)
    return match.group(1).strip() if match else ''

def configured():return bool(os.getenv('GEMINI_API_KEY'))and os.getenv('GEMINI_FREE_TIER_CONFIRMED')=='true'

class VoiceScope(BaseModel):
    room_name:str=Field(min_length=8,max_length=80,pattern=r'^(channel|direct)-[0-9a-f-]{36}$')
class VoiceAsk(VoiceScope):
    speech:str=Field(min_length=1,max_length=1200)

def install_luladroid(app,current_user,settings):
    async def room_identity(name,user,headers):
        # Both RLS room access and actual LiveKit presence are required.
        target=name.split('-',1)[1]
        try:UUID(target)
        except ValueError:raise HTTPException(400,'Sala inválida')from None
        table='channels'if name.startswith('channel-')else'conversations'
        async with client_for(app)as client:
            result=await client.get(settings()['SUPABASE_URL']+'/rest/v1/'+table,headers=headers,params={'id':'eq.'+target,'select':'id'})
        if result.status_code!=200 or not result.json():raise HTTPException(403,'Você não tem acesso à sala.')
        s=settings()
        if not all(s.get(k)for k in('LIVEKIT_URL','LIVEKIT_API_KEY','LIVEKIT_API_SECRET')):raise HTTPException(503,'Chamadas indisponíveis.')
        try:
            async with api.LiveKitAPI(s['LIVEKIT_URL'],s['LIVEKIT_API_KEY'],s['LIVEKIT_API_SECRET'])as lk:
                await lk.room.get_participant(api.RoomParticipantIdentity(room=name,identity=user['id']))
                rooms=await lk.room.list_rooms(api.ListRoomsRequest(names=[name]))
                if not rooms.rooms:raise ValueError()
                return rooms.rooms[0].sid
        except Exception:raise HTTPException(403,'Entre na chamada antes de usar o assistente.')from None

    @app.post('/api/luladroid/room')
    async def room_info(body:VoiceScope,identity=Depends(current_user)):
        user,headers=identity
        try:return {'room_sid':await room_identity(body.room_name,user,headers),'assistant':configured()}
        except httpx.HTTPError:raise HTTPException(503,'Não foi possível verificar a sala.')from None

    @app.post('/api/luladroid/ask')
    async def ask(body:VoiceAsk,identity=Depends(current_user)):
        question=question_from_speech(body.speech)
        if not question:raise HTTPException(400,'Diga eai LulaDroid e a pergunta.')
        if not configured():raise HTTPException(503,'Gemini ainda não foi habilitado no plano gratuito.')
        user,headers=identity
        try:
            sid=await room_identity(body.room_name,user,headers)
            async with client_for(app)as client:
                reserved=await client.post(settings()['SUPABASE_URL']+'/rest/v1/rpc/reserve_luladroid',headers=headers,json={'room_key':sid,'room_name':body.room_name})
                if reserved.status_code!=200:raise HTTPException(429,'Consentimento ausente ou limite gratuito atingido. Aguarde para tentar novamente.')
                result=await client.post('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',headers={'X-goog-api-key':os.environ['GEMINI_API_KEY']},json={'systemInstruction':{'parts':[{'text':'Você é LulaDroid, assistente da chamada Órbita. Responda em português brasileiro, em até 60 palavras. Você não tem acesso ao histórico, dados privados, ferramentas nem administração do site. Não afirme executar ações.'}]},'contents':[{'parts':[{'text':question[:1000]}]}],'generationConfig':{'maxOutputTokens':192,'thinkingConfig':{'thinkingBudget':0}}},timeout=20)
            if result.status_code==429:raise HTTPException(429,'A cota gratuita do Gemini acabou. Tente mais tarde.')
            if result.status_code!=200:raise HTTPException(503,'O Gemini não conseguiu responder. Confira a configuração do servidor.')
            parts=result.json().get('candidates',[{}])[0].get('content',{}).get('parts',[])
            answer=' '.join(p.get('text','')for p in parts if not p.get('thought')).strip()[:800]
            if not answer:raise HTTPException(503,'Não foi possível gerar uma resposta.')
            s=settings();packet=json.dumps({'id':reserved.json(),'text':answer},ensure_ascii=False).encode()
            async with api.LiveKitAPI(s['LIVEKIT_URL'],s['LIVEKIT_API_KEY'],s['LIVEKIT_API_SECRET'])as lk:
                await lk.room.send_data(api.SendDataRequest(room=body.room_name,data=packet,kind=1,topic='orbita.luladroid'))
            return {'sent':True}
        except HTTPException:raise
        except (httpx.HTTPError,ValueError,KeyError,IndexError):raise HTTPException(503,'O assistente está temporariamente indisponível.')from None
        except Exception:raise HTTPException(503,'Não foi possível entregar a resposta na chamada.')from None
