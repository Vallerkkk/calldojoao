"""Opt-in technical diagnostics: finite counters, never conversation contents."""
import asyncio
import csv
import io
import json
import os
import time
from collections import Counter
from datetime import datetime, timezone

import httpx
from fastapi import Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field
from typing import Literal
from upstream import client_for, read_json

SCREENS = ('messages', 'voice', 'feed', 'friends', 'settings', 'other')
SIGNALS = ('view', 'javascript_error', 'promise_error', 'resource_error', 'navigation_slow', 'long_task', 'api_error')
MODEL = 'gemini-2.5-flash-lite'
SUGGESTIONS = {
    'view': 'Uso observado; acompanhar as outras métricas antes de propor uma mudança.',
    'javascript_error': 'Reproduzir a navegação e verificar erros de JavaScript nesta tela.',
    'promise_error': 'Revisar falhas assíncronas e o tratamento de erros nesta tela.',
    'resource_error': 'Verificar carregamento e cache dos recursos da tela.',
    'navigation_slow': 'Medir o caminho de navegação e reduzir trabalho antes da primeira resposta visual.',
    'long_task': 'Medir tarefas longas e dividir trabalho que bloqueia a interface.',
    'api_error': 'Verificar disponibilidade e tratamento de falhas dos serviços usados pela tela.',
}


def configured():
    # A token budget is not a billing cap. Require a separately verified free project.
    return (os.getenv('GEMINI_DIAGNOSTICS_ENABLED', '').lower() == 'true'
            and os.getenv('GEMINI_FREE_TIER_CONFIRMED', '').lower() == 'true'
            and bool(os.getenv('GEMINI_API_KEY', '').strip()))


class Signal(BaseModel):
    model_config = ConfigDict(extra='forbid')
    screen: Literal['messages', 'voice', 'feed', 'friends', 'settings', 'other']
    signal: Literal['view', 'javascript_error', 'promise_error', 'resource_error', 'navigation_slow', 'long_task', 'api_error']
    count: int = Field(ge=1, le=20, strict=True)


class Batch(BaseModel):
    model_config = ConfigDict(extra='forbid')
    events: list[Signal] = Field(min_length=1, max_length=12)


def csv_cell(value):
    text = str(value).replace('\x00', '')
    # Excel/LibreOffice must never execute model output as a formula.
    return "'" + text if text.lstrip().startswith(('=', '+', '-', '@')) or text.startswith(('\t', '\r', '\n')) else text


def csv_report(rows, findings):
    output = io.StringIO(newline='')
    writer = csv.writer(output, delimiter=';')
    writer.writerow(['Data UTC', 'Tela', 'Sinal observado', 'Ocorrências', 'Prioridade', 'Origem', 'Sugestão (requer revisão humana)'])
    for row in rows:
        screen, signal = row.get('screen'), row.get('signal')
        if screen not in SCREENS or signal not in SIGNALS:
            continue
        advice = findings.get((screen, signal), {})
        writer.writerow([csv_cell(x) for x in [row.get('day', ''), screen, signal,
            row.get('count', 0), advice.get('priority', 'baixa' if signal == 'view' else 'média'),
            'Gemini · hipótese' if advice else 'Regra técnica · observação',
            advice.get('suggestion', SUGGESTIONS[signal])]])
    return ('\ufeff' + output.getvalue()).encode('utf-8')


def parse_findings(payload, snapshot):
    try:
        candidates = payload['candidates']
        if candidates[0].get('finishReason') != 'STOP':
            return {}
        parts = candidates[0]['content']['parts']
        raw = ''.join(p.get('text', '') for p in parts if not p.get('thought'))
        if len(raw) > 12000:
            return {}
        values = json.loads(raw)
        result = {}
        if not isinstance(values, list):
            return {}
        for item in values[:12]:
            if not isinstance(item, dict):
                continue
            key = (item.get('screen'), item.get('signal'))
            suggestion = item.get('suggestion')
            if key not in snapshot or key[1] == 'view' or not isinstance(suggestion, str):
                continue
            if not 5 <= len(suggestion.strip()) <= 600 or any(ord(c) < 32 for c in suggestion):
                continue
            if item.get('priority') not in ('baixa', 'média', 'alta'):
                continue
            result[key] = {'screen': key[0], 'signal': key[1], 'suggestion': suggestion.strip(), 'priority': item['priority'], 'model': MODEL}
        return result
    except (KeyError, IndexError, TypeError, ValueError):
        return {}


def install_diagnostics(app, current_user, settings):
    counters = Counter()
    findings = {}
    task = None
    next_attempt = 0.0
    status = 'awaiting_usage'

    async def rpc(name, payload, headers):
        async with client_for(app) as client:
            response = await client.post(settings()['SUPABASE_URL'] + '/rest/v1/rpc/' + name, headers=headers, json=payload)
        if response.is_error:
            raise HTTPException(503, 'O diagnóstico técnico está temporariamente indisponível.')
        return response

    async def analyze(headers, snapshot):
        nonlocal status
        try:
            reserved = await rpc('reserve_diagnostic_analysis', {}, headers)
            if reserved.json() is not True:
                status = 'daily_or_hourly_limit'
                return
            # Only allowlisted category counts. No IDs, message/error text, URLs or traces.
            summary = [{'screen': k[0], 'signal': k[1], 'count': min(v, 100000)} for k, v in sorted(snapshot.items())]
            schema = {'type': 'ARRAY', 'maxItems': 12, 'items': {'type': 'OBJECT', 'properties': {
                'screen': {'type': 'STRING', 'enum': list(SCREENS)},
                'signal': {'type': 'STRING', 'enum': list(SIGNALS)},
                'priority': {'type': 'STRING', 'enum': ['baixa', 'média', 'alta']},
                'suggestion': {'type': 'STRING'}}, 'required': ['screen', 'signal', 'priority', 'suggestion']}}
            body = {'systemInstruction': {'parts': [{'text':
                'Você revisa a qualidade da Órbita. Recebe apenas contagens técnicas agregadas, sem código ou conteúdo de usuários. '
                'Escreva sugestões curtas em português, como hipóteses a investigar. Não invente causas, bugs confirmados ou taxas sem denominador. '
                'Não analise view isoladamente. Use somente combinações screen/signal presentes. Nunca proponha coletar conversas ou dados pessoais.'}]},
                'contents': [{'role': 'user', 'parts': [{'text': json.dumps(summary, separators=(',', ':'))}]}],
                'generationConfig': {'responseMimeType': 'application/json', 'responseSchema': schema,
                    'maxOutputTokens': 1400, 'temperature': 0.2, 'thinkingConfig': {'thinkingBudget': 0}}}
            async with client_for(app) as client:
                response = await client.post('https://generativelanguage.googleapis.com/v1beta/models/' + MODEL + ':generateContent',
                    headers={'x-goog-api-key': os.environ['GEMINI_API_KEY'].strip()}, json=body, timeout=25)
            if response.is_error:
                status = 'quota_or_provider_unavailable'
                return  # No retries, no paid fallback, no response-body logging.
            result = parse_findings(read_json(response, dict), snapshot)
            findings.update(result)
            # Consume only the analyzed snapshot; events arriving during inference remain pending.
            for key, count in snapshot.items():
                counters[key] = max(0, counters[key] - count)
            status = 'analyzed' if result else 'no_suggestions'
        except (httpx.HTTPError, HTTPException, ValueError, KeyError):
            status = 'temporarily_unavailable'

    @app.post('/api/diagnostics/events', status_code=202)
    async def collect(batch: Batch, identity=Depends(current_user)):
        nonlocal task, next_attempt
        _, headers = identity
        # Persistence and throttling are transactional, shared across processes/restarts.
        response = await rpc('record_app_diagnostics', {'events': [x.model_dump() for x in batch.events]}, headers)
        if response.json() is not True:
            return {'accepted': False}
        for event in batch.events:
            key = (event.screen, event.signal)
            counters[key] = min(100000, counters[key] + event.count)
        if (configured() and time.monotonic() >= next_attempt and (task is None or task.done())
                and sum(v for k, v in counters.items() if k[1] != 'view') >= 3):
            next_attempt = time.monotonic() + 3600
            task = asyncio.create_task(analyze(dict(headers), dict(counters)))
            app.state.diagnostic_task = task
        return {'accepted': True}

    async def admin_data(identity):
        user, headers = identity
        async with client_for(app) as client:
            response = await client.get(settings()['SUPABASE_URL'] + '/rest/v1/site_roles', headers=headers,
                params={'user_id': 'eq.' + user['id'], 'select': 'role'})
            if response.is_error:
                raise HTTPException(503, 'Não foi possível verificar a administração.')
            roles = read_json(response, list)
            if not any(r.get('role') in ('admin', 'creator') for r in roles if isinstance(r, dict)):
                raise HTTPException(403, 'Relatório disponível somente aos administradores do site.')
            if findings:
                # Persist validated pending findings under a freshly verified admin JWT.
                saved = await client.post(settings()['SUPABASE_URL'] + '/rest/v1/app_diagnostic_findings',
                    headers={**headers, 'Prefer': 'resolution=merge-duplicates'},
                    json=[{**r, 'updated_at': datetime.now(timezone.utc).isoformat()} for r in findings.values()])
                if saved.is_error:
                    raise HTTPException(503, 'Não foi possível consolidar as sugestões.')
            base = settings()['SUPABASE_URL'] + '/rest/v1/'
            stats, advice = await asyncio.gather(
                client.get(base + 'app_diagnostic_counts', headers=headers, params={'select': 'day,screen,signal,count', 'order': 'day.desc,screen,signal', 'limit': 1300}),
                client.get(base + 'app_diagnostic_findings', headers=headers, params={'select': 'screen,signal,priority,suggestion,model,updated_at', 'limit': 42}))
        if stats.is_error or advice.is_error:
            raise HTTPException(503, 'Não foi possível carregar o relatório.')
        return read_json(stats, list), read_json(advice, list)

    @app.get('/api/admin/diagnostics')
    async def overview(identity=Depends(current_user)):
        rows, advice = await admin_data(identity)
        return {'geminiConfigured': configured(), 'status': status, 'rows': len(rows), 'suggestions': len(advice),
            'maxAnalysesPerDay': 4, 'retentionDays': 30}

    @app.get('/api/admin/diagnostics.csv')
    async def download(identity=Depends(current_user)):
        rows, advice = await admin_data(identity)
        mapping = {(r['screen'], r['signal']): r for r in advice if r.get('model') == MODEL}
        return Response(csv_report(rows, mapping), media_type='text/csv; charset=utf-8',
            headers={'Content-Disposition': 'attachment; filename="orbita-diagnostico.csv"'})
