"""Shared outbound connections, with per-request authorization headers."""
from contextlib import asynccontextmanager

import httpx
from fastapi import HTTPException


def new_client():
    return httpx.AsyncClient(
        timeout=httpx.Timeout(15, connect=5, pool=5),
        limits=httpx.Limits(max_connections=30, max_keepalive_connections=15),
        follow_redirects=False,
    )


@asynccontextmanager
async def client_for(app):
    client = getattr(app.state, 'upstream', None)
    if client is not None:
        yield client
    else:
        # Also supports tests and ASGI clients that don't run the lifespan.
        async with new_client() as temporary:
            yield temporary


def read_json(response, expected_type):
    try:
        value = response.json()
    except (ValueError, UnicodeDecodeError):
        raise HTTPException(503, 'O serviço de dados retornou uma resposta inválida.') from None
    if not isinstance(value, expected_type):
        raise HTTPException(503, 'O serviço de dados retornou uma resposta inválida.')
    return value
