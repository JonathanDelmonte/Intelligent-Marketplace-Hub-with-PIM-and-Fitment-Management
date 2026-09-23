@echo off
REM ===========================================================================
REM  Sobe o sistema no localhost e abre o navegador. Clique duas vezes.
REM
REM  A janela SEMPRE espera uma tecla no fim. Com o sistema no ar ela fica
REM  aberta, e fechar a janela desliga tudo. Se algo der errado, a mensagem
REM  fica na tela - e tambem no arquivo Atalhos\iniciar.log.
REM
REM  Este arquivo e so ASCII, sem chcp, sem bloco de varias linhas e sem
REM  rotulo, de proposito. A primeira versao tinha acento dentro de um bloco
REM  "if ( ... )" depois de "chcp 65001", e no Windows a janela abria e fechava
REM  sem fazer nada: o cmd.exe morria lendo o bloco. Todo texto com acento e
REM  escrito pelo Node, em scripts\iniciar.mjs, que nao tem esse problema.
REM ===========================================================================

cd /d "%~dp0.."
echo.
echo  Pasta do projeto: "%CD%"
echo.

if not exist "scripts\iniciar.mjs" echo  ERRO: nao achei scripts\iniciar.mjs. Este arquivo precisa ficar na pasta Atalhos, dentro do projeto.
where node >nul 2>nul || echo  ERRO: o Node.js nao foi encontrado. Instale a versao LTS de https://nodejs.org e reinicie o computador.

where node >nul 2>nul && if exist "scripts\iniciar.mjs" node scripts\iniciar.mjs

echo.
pause
