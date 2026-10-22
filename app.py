"""Órbita: comunidade com texto e chamadas. Execute: python -m uvicorn app:app --reload."""
import os
from contextlib import asynccontextmanager
from datetime import timedelta
from pathlib import Path
from uuid import UUID

import httpx
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from fastapi.staticfiles import StaticFiles
from starlette.middleware.gzip import GZipMiddleware
from livekit import api
from integrations import install
from community_features import install_features
from upstream import client_for, new_client, read_json
from videochamada import configured as videochamada_configured

ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / '.env')
@asynccontextmanager
async def lifespan(application):
    async with new_client() as client:
        application.state.upstream = client
        try:
            yield
        finally:
            application.state.upstream = None


app = FastAPI(title='Órbita', docs_url=None, redoc_url=None, lifespan=lifespan)
app.add_middleware(GZipMiddleware, minimum_size=800)
bearer = HTTPBearer(auto_error=False)


def settings():
    return {key: os.getenv(key, '').strip() for key in (
        'SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'LIVEKIT_URL',
        'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET')}


@app.middleware('http')
async def headers(request, call_next):
    response = await call_next(request)
    response.headers['X-Content-Type-Options'] = 'nosniff'
    # YouTube requires the embedding site's origin (error 153 without Referer).
    response.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "frame-ancestors 'none'; object-src 'none'; base-uri 'self'"
    response.headers['Permissions-Policy'] = 'camera=(self), microphone=(self), display-capture=(self)'
    if request.url.path.startswith('/api/') or request.url.path in ('/', '/sw.js', '/healthz'):
        response.headers['Cache-Control'] = 'no-store'
    return response


@app.get('/api/config')
def config():
    s = settings()
    ready = bool(s['SUPABASE_URL'] and s['SUPABASE_PUBLISHABLE_KEY'])
    return {'supabaseUrl': s['SUPABASE_URL'],
            'supabaseKey': s['SUPABASE_PUBLISHABLE_KEY'],
            'configured': ready,
            'videochamadaConfigured': videochamada_configured(),
            'storageConfigured': True, 'uploadLimit': 26214400,
            'pushPublicKey': os.getenv('VAPID_PUBLIC_KEY',''),
            'pushConfigured': all(os.getenv(k) for k in ('VAPID_PUBLIC_KEY','VAPID_PRIVATE_KEY','PUSH_TRANSPORT_KEY')),
            'callsConfigured': all(s[k] for k in ('LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET')),
            'geminiApiKey': os.getenv('GEMINI_API_KEY', 'AQ.Ab8RN6LwIVMnELQD7LmloIbFn9gK3bu5MAgVV8Lmc1T6xOsRPA'),
            'geminiProject': os.getenv('GEMINI_PROJECT', '735777445484'),
            'luladroidEnabled': True}


async def current_user(credentials: HTTPAuthorizationCredentials | None = Depends(bearer)):
    if credentials is None:
        raise HTTPException(401, 'Entre na sua conta para continuar.')
    s = settings()
    if not s['SUPABASE_URL'] or not s['SUPABASE_PUBLISHABLE_KEY']:
        raise HTTPException(503, 'Configure o Supabase no arquivo .env.')
    auth_headers = {'apikey': s['SUPABASE_PUBLISHABLE_KEY'],
                    'Authorization': f'Bearer {credentials.credentials}'}
    try:
        async with client_for(app) as client:
            response = await client.get(s['SUPABASE_URL'] + '/auth/v1/user', headers=auth_headers)
    except httpx.HTTPError:
        raise HTTPException(503, 'Não foi possível consultar a autenticação.')
    if response.status_code >= 500 or response.status_code == 429:
        raise HTTPException(503, 'A autenticação está temporariamente indisponível.')
    if response.status_code != 200:
        raise HTTPException(401, 'Sua sessão expirou. Entre novamente.')
    user = read_json(response, dict)
    if not isinstance(user.get('id'), str) or not user['id']:
        raise HTTPException(401, 'Sessão inválida.')
    return user, auth_headers


@app.post('/api/channels/{channel_id}/join')
async def join(channel_id: UUID, identity=Depends(current_user)):
    user, auth_headers = identity
    s = settings()
    if not all(s[k] for k in ('LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET')):
        raise HTTPException(503, 'Configure as três variáveis LIVEKIT no arquivo .env.')
    # Consulta com o JWT do usuário: as políticas RLS continuam sendo aplicadas.
    try:
        async with client_for(app) as client:
            response = await client.get(s['SUPABASE_URL'] + '/rest/v1/channels',
                headers=auth_headers, params={'id': f'eq.{channel_id}', 'select': 'id,kind'})
    except httpx.HTTPError:
        raise HTTPException(503, 'Não foi possível consultar o canal.')
    if response.status_code != 200:
        raise HTTPException(503, 'Verifique se o SQL do Supabase foi executado.')
    channels = read_json(response, list)
    if not channels:
        raise HTTPException(404, 'Canal inexistente ou sem acesso.')
    if not isinstance(channels[0], dict):
        raise HTTPException(503, 'O serviço de dados retornou uma sala inválida.')
    if channels[0].get('kind') != 'voice':
        raise HTTPException(400, 'Este canal é de texto.')
    try:
        async with client_for(app) as client:
            permissions = await client.post(s['SUPABASE_URL'] + '/rest/v1/rpc/call_permissions', headers=auth_headers, json={'target': str(channel_id)})
        if permissions.status_code >= 500 or permissions.status_code == 429:
            raise HTTPException(503, 'Não foi possível verificar as permissões da sala.')
        if permissions.is_error:
            raise HTTPException(403, 'Você não tem acesso a esta sala.')
        rights = read_json(permissions, dict)
        if any(type(rights.get(key)) is not bool for key in ('can_publish', 'stage', 'moderator')):
            raise HTTPException(503, 'O serviço de dados retornou permissões inválidas.')
    except httpx.HTTPError:
        raise HTTPException(503, 'Não foi possível verificar as permissões da sala.')
    return make_token(user, f'channel-{channel_id}', can_publish=rights['can_publish'], stage=rights['stage'], moderator=rights['moderator'])


def make_token(user, room_name, can_publish=True, stage=False, moderator=False):
    s = settings()
    if not all(s[k] for k in ('LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET')):
        raise HTTPException(503, 'As chamadas ainda não foram configuradas.')
    metadata = user.get('user_metadata') or {}
    name = str(metadata.get('display_name') or 'Participante')[:50]
    token = (api.AccessToken(s['LIVEKIT_API_KEY'], s['LIVEKIT_API_SECRET'])
        .with_identity(user['id']).with_name(name).with_ttl(timedelta(minutes=10))
        .with_grants(api.VideoGrants(room_join=True, room=room_name,
            can_publish=can_publish, can_subscribe=True, can_publish_data=True)).to_jwt())
    return JSONResponse({'url': s['LIVEKIT_URL'], 'token': token, 'canPublish':can_publish, 'stage':stage, 'moderator':moderator})


@app.api_route('/healthz', methods=['GET','HEAD'])
async def healthz():
    return {'status':'ok', 'service':'orbita'}


@app.get('/sw.js')
async def service_worker():
    return FileResponse(ROOT / 'static' / 'service-worker.js', media_type='application/javascript', headers={'Service-Worker-Allowed':'/'})


@app.get('/')
def index():
    return FileResponse(ROOT / 'static' / 'index.html')


@app.get('/instalar')
def install_page():
    return FileResponse(ROOT / 'static' / 'install.html', headers={'Cache-Control':'no-store'})


@app.get('/baixar/Orbita-Windows.zip')
def download_launcher():
    return RedirectResponse('https://github.com/Vallerkkk/calldojoao/releases/download/v1.0.2/Orbita-1.0.2-x64.zip',
        status_code=302, headers={'Cache-Control':'no-store'})


@app.get('/baixar/Orbita-Setup.exe')
def download_desktop_installer():
    return RedirectResponse('https://github.com/Vallerkkk/calldojoao/releases/download/v1.0.2/Orbita-Setup-1.0.2-x64.exe',
        status_code=302, headers={'Cache-Control':'no-store'})


install(app, current_user, settings, make_token)
install_features(app, current_user, settings)

app.mount('/static', StaticFiles(directory=ROOT / 'static'), name='static')
