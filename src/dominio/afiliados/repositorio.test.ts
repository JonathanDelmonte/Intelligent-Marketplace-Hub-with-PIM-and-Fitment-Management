/**
 * Testes do repositório de ofertas de afiliado, contra Postgres de verdade.
 *
 * O que só o banco prova: que a fila devolve publicadas e pendentes juntas (a decisão
 * de publicar depende das duas), que marcar publicada duas vezes não reescreve a hora,
 * e que informar desempenho substitui o total em vez de somar.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  abrirBancoDeTeste,
  limparTabelas,
  temBancoDeTeste,
  type ConexaoDeTeste,
} from '@/infra/banco/teste';
import { pontosBase, reaisParaCentavos } from '@/lib/dinheiro';
import { medirDesempenho, proximaPublicacao } from './publicacao';
import { RepositorioDeOfertas } from './repositorio';

describe.skipIf(!temBancoDeTeste())('RepositorioDeOfertas', () => {
  let conexao: ConexaoDeTeste;
  let repo: RepositorioDeOfertas;

  beforeEach(async () => {
    conexao ??= abrirBancoDeTeste();
    await limparTabelas(conexao.db, ['afiliado_oferta']);
    repo = new RepositorioDeOfertas(conexao.db);
  });

  afterAll(async () => {
    await conexao?.encerrar();
  });

  const gravar = (desconto: number, preco = 50) =>
    repo.registrar({
      plataforma: 'ml',
      urlAfiliado: `https://produto.mercadolivre.com.br/MLB-${String(desconto)}?matt_word=tag`,
      preco: reaisParaCentavos(preco),
      medianaNoventaDias: reaisParaCentavos(preco * 2),
      scoreDescontoBp: pontosBase(desconto),
    });

  it('grava e devolve na fila, com o score que ordena', async () => {
    await gravar(1_000);
    await gravar(3_000);

    const fila = await repo.fila();
    expect(fila.map((o) => o.scoreDescontoBp)).toEqual([3_000, 1_000]);
    expect(fila[0]?.publicadoEmGrupo).toBeNull();
  });

  it('a fila devolve publicadas e pendentes, porque a decisão precisa das duas', async () => {
    const publicada = await gravar(3_000);
    await gravar(1_000);
    await repo.marcarPublicada(publicada, new Date());

    const fila = await repo.fila();
    expect(fila).toHaveLength(2);
    expect(fila.filter((o) => o.publicadoEmGrupo !== null)).toHaveLength(1);
  });

  it('marcar publicada duas vezes não reescreve a hora', async () => {
    // A hora da última publicação é de onde sai o espaçamento de 45 minutos: sobrescrevê-la
    // com um clique repetido liberaria a publicação seguinte antes da hora.
    const id = await gravar(2_000);
    const primeira = new Date('2026-09-15T12:00:00Z');

    expect(await repo.marcarPublicada(id, primeira)).toBe(true);
    expect(await repo.marcarPublicada(id, new Date('2026-09-15T18:00:00Z'))).toBe(false);

    const fila = await repo.fila();
    expect(fila[0]?.publicadoEmGrupo?.toISOString()).toBe(primeira.toISOString());
  });

  it('informar desempenho substitui o total, e não soma', async () => {
    // O painel de afiliado dá o acumulado. Somar o total de hoje ao de ontem contaria
    // tudo duas vezes.
    const id = await gravar(2_000);
    await repo.informarDesempenho(id, { cliques: 10, conversoes: 1 });
    await repo.informarDesempenho(id, { cliques: 14, conversoes: 2 });

    const fila = await repo.fila();
    expect(fila[0]?.cliques).toBe(14);
    expect(fila[0]?.conversoes).toBe(2);
  });

  it('número negativo de clique não entra', async () => {
    const id = await gravar(2_000);
    await repo.informarDesempenho(id, { cliques: -5, conversoes: -1 });
    const fila = await repo.fila();
    expect(fila[0]?.cliques).toBe(0);
    expect(fila[0]?.conversoes).toBe(0);
  });

  it('a fila alimenta a decisão de publicar sem tradução', async () => {
    await gravar(3_000);
    await gravar(1_000);

    const decisao = proximaPublicacao(await repo.fila());
    expect(decisao.tipo).toBe('publicar');
    if (decisao.tipo === 'publicar') expect(decisao.oferta.scoreDescontoBp).toBe(3_000);
  });

  it('o desempenho de fila sem publicação é nulo, e não zero', async () => {
    await gravar(3_000);
    const desempenho = medirDesempenho(await repo.fila());
    expect(desempenho.publicadas).toBe(0);
    expect(desempenho.conversaoBp).toBeNull();
  });

  it('conta quantas esperam publicação', async () => {
    const id = await gravar(3_000);
    await gravar(1_000);
    expect(await repo.pendentes()).toBe(2);

    await repo.marcarPublicada(id, new Date());
    expect(await repo.pendentes()).toBe(1);
  });
});
