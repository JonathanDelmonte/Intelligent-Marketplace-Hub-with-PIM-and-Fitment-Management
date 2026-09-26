/**
 * O código de cadastro (ADR 0011 e 0015): o que a tela de criar conta pede, quando há
 * um configurado. Para gerar um: `node scripts/gerar-codigo.mjs`.
 *
 * Doze caracteres de um alfabeto sem letra ambígua (sem 0/O, 1/I/L), em três grupos —
 * é para ser digitado por gente, do papel ou de outra tela, sem confundir. São 32^12
 * combinações, e a tela limita as tentativas: adivinhar não é caminho.
 */
import { randomInt } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function gerarCodigoDeCadastro() {
  const grupos = [];
  for (let g = 0; g < 3; g += 1) {
    let grupo = '';
    for (let i = 0; i < 4; i += 1) grupo += ALFABETO[randomInt(ALFABETO.length)];
    grupos.push(grupo);
  }
  return grupos.join('-');
}

// Rodado direto, imprime um código novo para pôr em CADASTRO_CODIGO.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(gerarCodigoDeCadastro());
}
