"""Unauthenticated, explicit opt-in profile and post previews."""
from html import escape
import re
from uuid import UUID
import httpx
from fastapi.responses import HTMLResponse
from upstream import client_for

def install_public_pages(app, settings):
    async def data(name, args):
        s = settings()
        if not s['SUPABASE_URL'] or not s['SUPABASE_PUBLISHABLE_KEY']:
            return None
        try:
            async with client_for(app) as client:
                response = await client.post(s['SUPABASE_URL']+'/rest/v1/rpc/'+name,
                    headers={'apikey':s['SUPABASE_PUBLISHABLE_KEY']},json=args)
            return response.json() if response.status_code == 200 else None
        except (httpx.HTTPError,ValueError):
            return None

    def page(title, description, body, destination='/', available=True):
        title,description=escape(title),escape(description[:300])
        return HTMLResponse(f'''<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{title} · Órbita</title><meta name="description" content="{description}"><meta property="og:type" content="website"><meta property="og:title" content="{title} · Órbita"><meta property="og:description" content="{description}"><meta property="og:image" content="https://orbita-8nwu.onrender.com/static/icons/icon-512.png"><meta name="theme-color" content="#10101b"><style>body{{margin:0;background:#10101b;color:#f4f4ff;font:17px system-ui;line-height:1.6}}main{{max-width:720px;margin:40px auto;padding:24px}}article{{padding:20px;border:1px solid #414154;border-radius:16px;margin:16px 0;white-space:pre-wrap;overflow-wrap:anywhere}}a{{color:#c4b5ff;display:inline-block;padding:12px 0}}h1{{line-height:1.2}}img{{width:64px}}</style></head><body><main><img src="/static/icons/icon.svg" alt="Órbita"><h1>{title}</h1><p>{description}</p>{body}<a href="{escape(destination,quote=True)}">Abrir na Órbita →</a></main></body></html>''',status_code=200 if available else 404,headers={'Cache-Control':'no-store'})

    @app.get('/@{username}',response_class=HTMLResponse)
    async def public_profile(username: str):
        profile=await data('public_profile',{'handle':username}) if re.fullmatch(r'[A-Za-z0-9_]{3,24}',username) else None
        if not isinstance(profile,dict):
            return page('Perfil indisponível','Este perfil não está publicado ou exige uma conta.','',available=False)
        body=''.join('<article>'+escape(str(post.get('content','')))+'<br><a href="/p/'+str(UUID(post['id']))+'">Ver publicação</a></article>' for post in profile.get('posts',[]))
        return page(str(profile.get('display_name','Perfil')),str(profile.get('bio','')),body,'/?profile='+str(UUID(profile['id'])))

    @app.get('/p/{post_id}',response_class=HTMLResponse)
    async def public_post(post_id: UUID):
        post=await data('public_post',{'post_key':str(post_id)})
        if not isinstance(post,dict):
            return page('Publicação na Órbita','Entre na sua conta para verificar se você tem acesso.','',destination='/?post='+str(post_id),available=False)
        return page(str(post.get('author','Publicação')),str(post.get('content',''))[:300],'<article>'+escape(str(post.get('content','')))+'</article>','/?post='+str(post_id))
