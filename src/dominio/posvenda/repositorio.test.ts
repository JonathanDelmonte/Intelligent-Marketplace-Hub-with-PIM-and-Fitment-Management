/**
 * Testes do repositório de perguntas, contra Postgres de verdade.
 *
 * O que só o banco prova: que colar a mesma lista duas vezes não duplica, que a
 * duplicata é por texto normalizado (e não por texto idêntico), que a janela corta
 * pergunta velha, e que um perfil não vê a pergunta do outro.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { perfilId, type PerfilId } from '@/dominio/catalogo/sku';
import {
  abrirBancoDeTeste,
  limparTabelas,
  temBancoDeTeste,
  type ConexaoDeTeste,
} from '@/infra/banco/teste';
import { perfilVendedor } from '@/infra/banco/schema';
import { duvidasRecorrentes } from './recorrente';
import { RepositorioDePerguntas, chaveDaPergunta } from './repositorio';

const TABELAS = ['pergunta_recebida', 'perfil_vendedor'];

describe('chaveDaPergunta', () => {
  it('ignora caixa, acento e espaço repetido, que é como a mesma pergunta volta', () => {
    expect(chaveDaPergunta('Serve na PA21G?')).toBe(chaveDaPergunta('serve  na pa21g?'));
    expect(chaveDaPergunta('É bivolt?')).toBe(chaveDaPergunta('e bivolt?'));
  });

  it('pergunta diferente tem chave diferente', () => {
    expect(chaveDaPergunta('Serve na PA21G?')).not.toBe(chaveDaPergunta('Serve na PA26G?'));
  });
});

describe.skipIf(!temBancoDeTeste())('RepositorioDePerguntas', () => {
  let conexao: ConexaoDeTeste;
  let repo: RepositorioDePerguntas;
  let perfil: PerfilId;
  let outro: PerfilId;

  beforeEach(async () => {
    conexao ??= abrirBancoDeTeste();
    await limparTabelas(conexao.db, TABELAS);
    repo = new RepositorioDePerguntas(conexao.db);

    const perfis = await conexao.db
      .insert(perfilVendedor)
      .values([
        { slug: 'posvenda', nome: 'Perfil', regime: 'mei' as const },
        { slug: 'posvenda-outro', nome: 'Outro', regime: 'mei' as const },
      ])
      .returning({ id: perfilVendedor.id });
    perfil = perfilId(perfis[0]?.id ?? '');
    outro = perfilId(perfis[1]?.id ?? '');
  });

  afterAll(async () => {
    await conexao?.encerrar();
  });

  it('grava o lote e conta quantas eram novas', async () => {
    const r = await repo.registrarLote(perfil, [
      { anuncioExterno: 'MLB-1', texto: 'Serve na PA21G?' },
      { anuncioExterno: 'MLB-1', texto: 'É bivolt?' },
    ]);
    expect(r).toEqual({ gravadas: 2, repetidas: 0 });
  });

  it('colar a mesma lista de novo não duplica, e diz quantas já existiam', async () => {
    // É o uso normal: a pessoa cola a lista do painel, e amanhã cola de novo com as
    // de ontem no meio.
    await repo.registrarLote(perfil, [{ anuncioExterno: 'MLB-1', texto: 'Serve na PA21G?' }]);
    const r = await repo.registrarLote(perfil, [
      { anuncioExterno: 'MLB-1', texto: 'serve  NA pa21g?' },
      { anuncioExterno: 'MLB-1', texto: 'Quantos vêm na caixa?' },
    ]);

    expect(r).toEqual({ gravadas: 1, repetidas: 1 });
    expect(await repo.recentes(perfil)).toHaveLength(2);
  });

  it('a mesma pergunta em outro anúncio é outra pergunta', async () => {
    // Agrupar entre anúncios esconderia qual anúncio está furado.
    await repo.registrarLote(perfil, [
      { anuncioExterno: 'MLB-1', texto: 'Serve na PA21G?' },
      { anuncioExterno: 'MLB-2', texto: 'Serve na PA21G?' },
    ]);
    expect(await repo.recentes(perfil)).toHaveLength(2);
  });

  it('a janela corta pergunta velha, porque anúncio já corrigido não pode acusar para sempre', async () => {
    const agora = new Date('2026-09-15T12:00:00Z');
    await repo.registrarLote(perfil, [
      {
        anuncioExterno: 'MLB-1',
        texto: 'É 110 ou 220?',
        recebidaEm: new Date(agora.getTime() - 200 * 86_400_000),
      },
      { anuncioExterno: 'MLB-1', texto: 'Serve na PA21G?', recebidaEm: agora },
    ]);

    expect(await repo.recentes(perfil, { agora, dias: 90 })).toHaveLength(1);
    expect(await repo.contar(perfil, { agora, dias: 90 })).toEqual({ naJanela: 1, total: 2 });
  });

  it('não devolve pergunta de outro perfil', async () => {
    await repo.registrarLote(outro, [{ anuncioExterno: 'MLB-9', texto: 'Serve na PA21G?' }]);
    expect(await repo.recentes(perfil)).toHaveLength(0);
  });

  it('o que sai do banco alimenta o detector sem tradução', async () => {
    // O formato de leitura é o `PerguntaRecebida` que o detector pede, e o teste
    // existe para o dia em que alguém mudar uma das duas pontas.
    await repo.registrarLote(
      perfil,
      Array.from({ length: 5 }, (_, i) => ({
        anuncioExterno: 'MLB-1',
        texto: `Serve na PA21G? (${String(i)})`,
      })),
    );

    const duvidas = duvidasRecorrentes(await repo.recentes(perfil));
    expect(duvidas).toHaveLength(1);
    expect(duvidas[0]?.tema).toBe('compatibilidade');
    expect(duvidas[0]?.vezes).toBe(5);
    expect(duvidas[0]?.oQueAcrescentar).toContain('PA21G');
  });

  it('lote vazio não vai ao banco', async () => {
    expect(await repo.registrarLote(perfil, [])).toEqual({ gravadas: 0, repetidas: 0 });
  });
});
