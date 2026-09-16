/**
 * Testes do investigador de base local, contra Postgres de verdade.
 *
 * Com banco porque o que ele faz **é** a consulta: um dublê provaria que a função casa
 * códigos, e não que a varredura lê as linhas certas e ignora as que não têm URL.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { produtoExterno } from '@/infra/banco/schema';
import {
  abrirBancoDeTeste,
  limparTabelas,
  temBancoDeTeste,
  type ConexaoDeTeste,
} from '@/infra/banco/teste';
import { itemDaFamilia } from '../fronteira';
import type { FamiliaDeHipotese } from '../hipoteses';
import { ACHADOS_POR_PASSO, InvestigadorDaBaseLocal, pecaDoTitulo } from './base-local';
import { ZERO } from '@/lib/dinheiro';

const ALVO = 'Refil de purificador de água PA21G';

describe.skipIf(!temBancoDeTeste())('InvestigadorDaBaseLocal', () => {
  let conexao: ConexaoDeTeste;
  let investigador: InvestigadorDaBaseLocal;

  beforeEach(async () => {
    conexao ??= abrirBancoDeTeste();
    await limparTabelas(conexao.db, ['produto_externo']);
    investigador = new InvestigadorDaBaseLocal(conexao.db, () => new Date('2026-09-16T00:00:00Z'));
  });

  afterAll(async () => {
    await conexao?.encerrar();
  });

  let sequencia = 0;
  async function ocorrencia(titulo: string, campos: Record<string, unknown> = {}) {
    sequencia += 1;
    await conexao.db.insert(produtoExterno).values({
      tituloBruto: titulo,
      hashConteudo: `h${String(sequencia)}`,
      fonte: 'm2_publico' as const,
      url: `https://loja.invalid/${String(sequencia)}`,
      ...campos,
    });
  }

  const investigar = (familia: FamiliaDeHipotese, alvo = ALVO) =>
    investigador.investigar({
      item: itemDaFamilia({ id: familia, familia, alvo, ferramenta: 'base_local' }),
      alvoDoDossie: alvo,
      restanteCentavos: ZERO,
    });

  it('sem código de modelo no alvo não há por onde casar, e isso não é falha', async () => {
    // "refil de purificador" não aponta para aparelho nenhum.
    await ocorrencia('Refil PA21G original');
    const r = await investigar('em_que_mais_serve', 'refil de purificador');

    expect(r.achados).toEqual([]);
    expect(r.custoCentavos).toBe(ZERO);
  });

  it('acha o código vizinho citado no mesmo anúncio, com a URL como fonte', async () => {
    await ocorrencia('Refil compativel PA21G PA26G PE11');
    const r = await investigar('em_que_mais_serve');

    expect(r.achados.map((a) => a.id).sort()).toEqual([
      'em_que_mais_serve:PA26G',
      'em_que_mais_serve:PE11',
    ]);
    expect(r.achados[0]?.origemUrl).toContain('https://loja.invalid/');
    // Candidato, e não fato: a disciplina de evidência do M4 é quem decide.
    expect(r.achados[0]?.oQue).toContain('a confirmar');
  });

  it('o código do próprio alvo não é achado', async () => {
    await ocorrencia('Refil PA21G');
    expect((await investigar('em_que_mais_serve')).achados).toEqual([]);
  });

  it('anúncio que não cita o código do alvo fica fora', async () => {
    await ocorrencia('Correia de máquina de lavar BWL11');
    expect((await investigar('em_que_mais_serve')).achados).toEqual([]);
  });

  it('casa código escrito com espaço, que é como metade das fontes escreve', async () => {
    // `ilike '%PA21G%'` em SQL perderia este anúncio, e é por isso que o casamento é
    // feito aqui e não no banco.
    await ocorrencia('Refil PA 21 G serve tambem no PA26G');
    const r = await investigar('em_que_mais_serve');

    expect(r.achados.map((a) => a.id)).toEqual(['em_que_mais_serve:PA26G']);
  });

  it('a mesma peça anunciada por outra loja não é "outra peça"', async () => {
    // Comparar título inteiro deixava passar: "Refil de purificador de agua PA21G PA26G
    // original Electrolux" é título diferente e peça igual.
    await ocorrencia('Refil de purificador de agua PA21G PA26G original Electrolux');
    await ocorrencia('Refil PA 21 G compativel');
    expect((await investigar('que_outras_pecas')).achados).toEqual([]);
  });

  it('acha outra peça para o mesmo aparelho, e não repete o próprio alvo', async () => {
    await ocorrencia(ALVO);
    await ocorrencia('Vedação do copo PA21G', { vendedor: 'Peças Sul' });
    const r = await investigar('que_outras_pecas');

    expect(r.achados).toHaveLength(1);
    expect(r.achados[0]?.oQue).toContain('Vedação do copo');
    expect(r.achados[0]?.oQue).toContain('Peças Sul');
  });

  it('outra peça confirma a hipótese; código vizinho não', async () => {
    // Evidência direta contra circunstancial: o anúncio da vedação existe e está na
    // mão; "o mesmo anúncio cita PA26G" é citação, e citar não é servir.
    await ocorrencia('Vedação do copo PA21G');
    await ocorrencia('Refil PA21G PA26G');

    expect((await investigar('que_outras_pecas')).confirmadas).toEqual(['que_outras_pecas']);
    expect((await investigar('em_que_mais_serve')).confirmadas).toBeUndefined();
  });

  it('sem achado não confirma nada', async () => {
    await ocorrencia('Refil PA21G');
    expect((await investigar('que_outras_pecas')).confirmadas).toBeUndefined();
  });

  it('a mesma peça em duas lojas é um achado, e não dois', async () => {
    await ocorrencia('Vedação do copo PA21G');
    await ocorrencia('vedacao do copo pa21g');
    expect((await investigar('que_outras_pecas')).achados).toHaveLength(1);
  });

  it('ocorrência sem URL fica fora, porque achado sem fonte não é auditável', async () => {
    await ocorrencia('Vedação do copo PA21G', { url: null, fonte: 'm1_planilha' as const });
    expect((await investigar('que_outras_pecas')).achados).toEqual([]);
  });

  it('um passo não devolve mais achados do que o teto', async () => {
    for (let i = 0; i < ACHADOS_POR_PASSO + 3; i += 1) {
      await ocorrencia(`Peça número ${String(i)} para PA21G`);
    }
    expect((await investigar('que_outras_pecas')).achados).toHaveLength(ACHADOS_POR_PASSO);
  });

  it('família que a base local não responde devolve passo sem achado', async () => {
    await ocorrencia('Refil PA21G PA26G');
    expect((await investigar('onde_e_mais_barato')).achados).toEqual([]);
  });
});

describe('pecaDoTitulo', () => {
  it('a peça é a primeira palavra que não é ligação nem código', () => {
    expect(pecaDoTitulo('Refil de purificador de água PA21G')).toBe('refil');
    expect(pecaDoTitulo('Vedação do copo PA21G')).toBe('vedacao');
    expect(pecaDoTitulo('PA21G kit de reparo')).toBe('kit');
  });

  it('não confunde número de medida com peça', () => {
    expect(pecaDoTitulo('21 cm mangueira')).toBe('mangueira');
  });

  it('título só de código não tem peça para comparar', () => {
    expect(pecaDoTitulo('PA21G PA26G')).toBeNull();
  });

  it('a mesma peça escrita de dois jeitos dá a mesma palavra', () => {
    expect(pecaDoTitulo('REFIL PA 21 G')).toBe(pecaDoTitulo('Refil de purificador PA21G'));
  });
});
