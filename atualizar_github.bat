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
    git remote add origin https://github.com/Vallerkkk/calldojoao.git
)

echo Adicionando arquivos modificados...
git add -A

echo Criando commit...
git commit -m "feat: transcricao ao vivo da call e assistente de voz LulaDroid com Gemini e Puter TTS"

echo Enviando para o GitHub...
git push -u origin main
if errorlevel 1 (
    echo.
    echo Tentando enviar na branch master...
    git push -u origin master
)

echo.
echo ============================================================
echo   Concluido! Verifique seu repositorio no GitHub:
echo   https://github.com/Vallerkkk/calldojoao
echo ============================================================
pause
