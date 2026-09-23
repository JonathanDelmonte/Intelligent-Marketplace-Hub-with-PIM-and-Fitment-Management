@echo off
REM ===========================================================================
REM  Sobe o sistema no localhost e abre o navegador. Clique duas vezes.
REM
REM  Na primeira vez demora alguns minutos: instala as dependencias, monta a
REM  versao de uso e, se o banco for o do Docker, baixa a imagem. Nas outras
REM  vezes, alguns segundos. Clicar de novo com tudo rodando so abre o navegador.
REM
REM  Fechar a janela preta desliga o sistema.
REM
REM  A logica mora em scripts\iniciar.mjs, e nao aqui: arquivo de lote quebra
REM  por detalhe invisivel (quebra de linha, acento), e Node nao. Este arquivo
REM  so confere que o Node existe e chama o script.
REM ===========================================================================

REM Acento na janela: sem isto, o texto com acento sai embaralhado.
chcp 65001 >nul

REM A pasta do projeto e a de cima desta. %~dp0 e a pasta deste arquivo, entao
REM o atalho funciona onde quer que o projeto esteja no computador.
cd /d "%~dp0.."

where node >nul 2>nul
if errorlevel 1 (
    echo.
    echo   O Node.js não está instalado neste computador.
    echo   Baixe a versão LTS em https://nodejs.org, instale, e clique de novo.
    echo   Se você acabou de instalar, reinicie o computador antes: o Windows só
    echo   enxerga programa novo depois de reiniciar.
    echo.
    pause
    exit /b 1
)

node scripts\iniciar.mjs
if errorlevel 1 pause
