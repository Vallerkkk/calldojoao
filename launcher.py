"""Órbita - Launcher para versão empacotada.
Inicia o servidor local e abre o navegador.
"""
import os
import sys
import time
import webbrowser
import threading
from pathlib import Path

# Garante que o .env ao lado do .exe seja carregado
if getattr(sys, 'frozen', False):
    os.chdir(Path(sys.executable).parent)

def open_browser():
    time.sleep(1.8)
    webbrowser.open('http://127.0.0.1:8000')

def main():
    print('Órbita iniciando...')
    print('Servidor local: http://127.0.0.1:8000')
    print('Feche esta janela para encerrar o aplicativo.')
    print('-' * 50)

    # Abre o navegador em background
    threading.Thread(target=open_browser, daemon=True).start()

    # Inicia o servidor
    import uvicorn
    uvicorn.run(
        'app:app',
        host='127.0.0.1',
        port=8000,
        log_level='info',
        reload=False,
    )

if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        print('\nEncerrando Órbita...')
    except Exception as e:
        print(f'Erro ao iniciar: {e}')
        input('Pressione Enter para sair...')
