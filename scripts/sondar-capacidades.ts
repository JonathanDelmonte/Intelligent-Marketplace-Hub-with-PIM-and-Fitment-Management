/**
 * Sonda de capacidades.
 *
 * A etapa 2 da ordem de construção: "testar endpoint por endpoint e escrever a
 * matriz da seção 2.2 com dados reais". O resultado é um arquivo de configuração,
 * não uma surpresa em produção.
 *
 * ```sh
 * npm run sondar:capacidades
 * npm run sondar:capacidades -- --plataforma=ml
 * npm run sondar:capacidades -- --escrever      # atualiza docs/matriz-capacidades.md
 * ```
 *
 * **Sem credencial ela ainda roda**, e essa é a parte que importa: testa o que é
 * público e marca o resto como `sem_credencial`, que é diferente de `bloqueado`.
 * No primeiro caso conectar resolve; no segundo, não.
 *
 * A sonda **não tem endpoint cadastrado ainda** — o app no Mercado Livre precisa
 * ser criado primeiro (`developers.mercadolivre.com.br`), e o que ela faz hoje é
 * relatar o estado declarado na matriz e deixar explícito o que falta confirmar.
 * Cadastrar um endpoint e sair chamando antes de haver app seria inventar
 * resultado.
 */
// Primeiro de todos: o `.env` tem de estar em `process.env` antes de qualquer
// módulo ler ambiente. Ver o cabeçalho de `carregar-env.ts`.
import { carregarEnv } from '@/config/carregar-env';

import { PLATAFORMAS } from '../src/dominio/precificacao/tipos';
import type { Plataforma } from '../src/dominio/precificacao/tipos';
import {
  CAPACIDADES,
  ROTULO_DA_CAPACIDADE,
  ROTULO_DO_MODO,
  motivoDeIndisponibilidade,
} from '../src/plataformas/capacidades';
import type { EstadoDaCapacidade } from '../src/plataformas/capacidades';
import { registroPadrao } from '../src/plataformas/registro';

carregarEnv();

function argumento(nome: string): string | undefined {
  const prefixo = `--${nome}=`;
  return process.argv.find((a) => a.startsWith(prefixo))?.slice(prefixo.length);
}

function descrever(estado: EstadoDaCapacidade): string {
  switch (estado.tipo) {
    case 'disponivel':
      return `OK       ${ROTULO_DO_MODO[estado.modo]} — ${estado.rotulo}`;
    case 'presumido':
      return `PRESUMIDO ${ROTULO_DO_MODO[estado.modo]} — nunca confirmado contra a plataforma`;
    case 'sem_credencial':
      return `SEM CRED. ${ROTULO_DO_MODO[estado.modo]} — conecte a conta ou importe a planilha`;
    case 'bloqueado':
      return `BLOQUEADO ${motivoDeIndisponibilidade(estado) ?? ''}`;
    case 'inexistente':
      return `AUSENTE   ${motivoDeIndisponibilidade(estado) ?? ''}`;
  }
}

async function principal(): Promise<void> {
  const filtro = argumento('plataforma');
  if (filtro !== undefined && !(PLATAFORMAS as readonly string[]).includes(filtro)) {
    throw new Error(`plataforma inválida: ${filtro}. Use uma de ${PLATAFORMAS.join(', ')}.`);
  }

  // Nenhuma credencial é assumida: a sonda precisa funcionar num ambiente limpo,
  // que é exatamente o estado de quem acabou de clonar o repositório.
  const registro = registroPadrao({ plataformasComCredencial: [] });
  const matriz = await registro.matriz();

  const plataformas = (filtro === undefined ? PLATAFORMAS : [filtro as Plataforma]).filter((p) =>
    registro.plataformas().includes(p),
  );

  let presumidos = 0;
  let bloqueados = 0;

  for (const plataforma of plataformas) {
    console.log(`\n=== ${plataforma} ===`);
    const daPlataforma = matriz[plataforma];

    for (const capacidade of CAPACIDADES) {
      const estado = daPlataforma[capacidade];
      if (estado.tipo === 'presumido') presumidos += 1;
      if (estado.tipo === 'bloqueado') bloqueados += 1;
      console.log(`  ${ROTULO_DA_CAPACIDADE[capacidade].padEnd(36)} ${descrever(estado)}`);
    }
  }

  console.log('\n--- resumo ---');
  console.log(`${String(presumidos)} capacidade(s) ainda PRESUMIDA(s), esperando teste real.`);
  console.log(`${String(bloqueados)} capacidade(s) BLOQUEADA(s) pela plataforma.`);

  if (presumidos > 0) {
    console.log(
      '\nPara confirmar as presumidas é preciso, nesta ordem:\n' +
        '  1. criar o app em developers.mercadolivre.com.br e gerar token;\n' +
        '  2. gravar a credencial pelo fluxo de OAuth (ela fica cifrada em `credencial`);\n' +
        '  3. rodar esta sonda de novo, que então bate nos endpoints de verdade.\n' +
        'Enquanto isso, cada capacidade presumida é expectativa documentada, não fato.',
    );
  }
}

principal().then(
  () => process.exit(0),
  (erro: unknown) => {
    console.error('Falha ao sondar:', erro);
    process.exit(1);
  },
);
