#!/usr/bin/env node
/**
 * Liga os hooks de `.githooks/` neste clone — os que barram commit com autor errado
 * (CLAUDE.md, seção 1). Roda no `prepare`, ou seja, em todo `npm install` e `npm ci`.
 *
 * Existe, em vez do `git config core.hooksPath .githooks` direto no `package.json`,
 * porque aquele comando **derrubava a instalação** fora de um clone do git: no projeto
 * baixado como ZIP (sem `.git`) ou no computador sem git, ele sai com erro, o `npm ci`
 * falha junto, e o atalho `Atalhos/Iniciar.bat` para no passo das dependências. Quem
 * baixou o ZIP não vai commitar; não há hook para ligar, e isso não é erro.
 *
 * Num clone de verdade, falha do `git config` continua sendo falha.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

if (!existsSync('.git')) {
  console.log('Sem .git nesta pasta (projeto baixado como ZIP?): hooks do git não ligados.');
  process.exit(0);
}

const resultado = spawnSync('git', ['config', 'core.hooksPath', '.githooks'], {
  stdio: 'inherit',
});
if (resultado.error !== undefined) {
  console.log('git não encontrado neste computador: hooks do git não ligados.');
  process.exit(0);
}
process.exit(resultado.status ?? 1);
