@echo off
cd /d "%~dp0"
echo ============================================================
echo   Publicando atualizacoes do LulaDroid no GitHub
echo   Repositorio: https://github.com/Vallerkkk/calldojoao
echo ============================================================

if not exist ".git" (
    echo Inicializando repositorio Git...
    git init
    git branch -M main
    git remote add origin https://github.com/Vallerkkk/calldojoao.git 2>nul
)

echo Sincronizando alteracoes remotas primeiro...
git pull origin main --rebase --allow-unrelated-histories 2>nul

echo Adicionando arquivos...
git add -A

echo Criando commit com as novidades...
git commit -m "feat: transcricao de voz e LulaDroid com Gemini e Puter TTS" 2>nul

echo Enviando para a branch main...
git push -u origin main

if errorlevel 1 (
    echo.
    echo [AVISO] O GitHub recusou o push rapido devido a diferencas remotas.
    echo Sincronizando e mesclando com o GitHub...
    git pull origin main --allow-unrelated-histories --no-edit 2>nul
    git push -u origin main
)

if errorlevel 1 (
    echo.
    echo Forcando atualizacao completa da branch main no GitHub...
    git push -u origin main --force
)

echo.
echo ============================================================
echo   Concluido! Verifique em: https://github.com/Vallerkkk/calldojoao
echo ============================================================
pause
