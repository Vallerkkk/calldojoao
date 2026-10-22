"""Compatibility tombstones: old clients must stop speech recognition."""
from fastapi import HTTPException

def install_luladroid(app, current_user, settings):
    @app.post('/api/transcription/room')
    @app.post('/api/luladroid/room', include_in_schema=False)
    async def removed():
        raise HTTPException(410, 'A transcrição de chamadas foi removida. Atualize a Órbita.')
