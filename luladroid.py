"""Validates call membership before microphone transcription is enabled."""
from uuid import UUID
from fastapi import Depends,HTTPException
from pydantic import BaseModel,Field
from livekit import api
import httpx
from upstream import client_for
class VoiceScope(BaseModel):
    room_name:str=Field(min_length=8,max_length=80,pattern=r'^(channel|direct)-[0-9a-f-]{36}$')

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
        except Exception:raise HTTPException(403,'Entre na chamada antes de ativar a transcrição.')from None

    @app.post('/api/transcription/room')
    @app.post('/api/luladroid/room',include_in_schema=False)
    async def room_info(body:VoiceScope,identity=Depends(current_user)):
        user,headers=identity
        try:return {'room_sid':await room_identity(body.room_name,user,headers),'assistant':False}
        except httpx.HTTPError:raise HTTPException(503,'Não foi possível verificar a sala.')from None
