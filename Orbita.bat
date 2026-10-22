@echo off
title Orbita - Comunidade
setlocal
cd /d "%~dp0"

echo.
echo  ========================================
echo   ORBITA - Iniciando...
echo  ========================================
echo.

where python >nul 2>&1
if errorlevel 1 (
  echo [ERRO] Python nao encontrado.
  echo Instale Python 3.11+ em https://python.org e marque "Add to PATH".
  pause
  exit /b 1
)

if not exist ".venv\Scripts\python.exe" (
  echo Criando ambiente virtual...
  python -m venv .venv
  if errorlevel 1 goto erro
)

echo Instalando/atualizando dependencias...
".venv\Scripts\python.exe" -m pip install -q -r requirements.txt
if errorlevel 1 goto erro

if not exist ".env" (
  copy ".env.example" ".env" >nul
  echo.
  echo [ATENCAO] Arquivo .env criado a partir do exemplo.
  echo Preencha SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY
  echo e as 3 variaveis LIVEKIT antes de usar chamadas.
  echo.
  notepad .env
  echo Pressione qualquer tecla depois de salvar o .env...
  pause >nul
)

echo.
echo  Servidor: http://127.0.0.1:8000
echo  Abrindo navegador em alguns segundos...
echo  Feche esta janela para encerrar o Orbita.
echo.

start "" timeout /t 2 /nobreak >nul && start http://127.0.0.1:8000

".venv\Scripts\python.exe" -m uvicorn app:app --host 127.0.0.1 --port 8000 --log-level info
goto fim

:erro
echo.
echo [ERRO] Nao foi possivel iniciar. Verifique o Python e a conexao com a internet.
pause
exit /b 1

:fim
echo Orbita encerrado.
