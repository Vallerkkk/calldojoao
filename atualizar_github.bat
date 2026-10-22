@echo off
chcp 65001 >nul
title Atualizar Repositório GitHub - calldojoao

echo ========================================================
echo   Atualizando https://github.com/Vallerkkk/calldojoao
echo ========================================================
echo.

:: Navega para a pasta do script (C:\Users\João Pedro\Desktop\calldojoao\calldojoao)
cd /d "%~dp0"

:: Verifica se o Git está instalado
where git >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERRO] O Git nao foi encontrado no seu computador!
    echo Instale o Git em: https://git-scm.com/downloads
    echo.
    pause
    exit /b
)

:: Inicializa o Git se ainda não for um repositório
if not exist ".git" (
    echo [*] Inicializando repositorio Git local...
    git init
    git branch -M main
)

:: Configura o repositório remoto oficial
echo [*] Conectando ao repositorio remoto...
git remote remove origin >nul 2>nul
git remote add origin https://github.com/Vallerkkk/calldojoao.git

:: Adiciona todos os arquivos da pasta
echo [*] Adicionando arquivos da pasta...
git add .

:: Cria o commit
echo [*] Criando commit...
git commit -m "Atualiza arquivos do projeto e adiciona API de tratamento de audio"

:: Envia para o GitHub na branch main
echo.
echo [*] Enviando arquivos para o GitHub...
echo (Se o GitHub solicitar login no navegador, conclua a autenticacao na janela que abrir)
echo.
git push -u origin main

echo.
if %errorlevel% equ 0 (
    echo ========================================================
    echo   SUCESSO! O repositorio foi atualizado com sucesso.
    echo   Acesse: https://github.com/Vallerkkk/calldojoao
    echo ========================================================
) else (
    echo ========================================================
    echo   [AVISO] Se o push falhou, tente puxar alteracoes antes:
    echo   git pull origin main --rebase
    echo   git push -u origin main
    echo ========================================================
)

echo.
pause
