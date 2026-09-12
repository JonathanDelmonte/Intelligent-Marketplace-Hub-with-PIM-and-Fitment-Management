/**
 * Testes da busca de vizinhos, contra Postgres com `pgvector` de verdade.
 *
 * **Nenhum embedding real é gerado aqui**, e não precisa ser: a busca é uma
 * operação do banco, e vetor sintético exercita exatamente o que se quer provar —
 * que a ordenação é por distância, que o corte filtra, que o próprio produto não
 * aparece como vizinho de si mesmo, e que dimensão errada é recusada antes de virar
 * erro obscuro do Postgres.
 *
 * Isso também é o que torna a etapa 5.3 fechável sem chave de LLM.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { produtoExterno } from '@/infra/banco/schema';
import {
  abrirBancoDeTeste,
  limparTabelas,
  temBancoDeTeste,
  type ConexaoDeTeste,
} from '@/infra/banco/teste';
import {
  DIMENSAO_EMBEDDING,
  EmbeddingInvalido,
  RepositorioDeEmbeddings,
  validarVetor,
} from './vizinhos';

const MODELO = 'embedding-de-teste';

/** Vetor unitário no eixo `eixo`. Distância de cosseno 1 entre eixos distintos. */
function eixo(indice: number): number[] {
  const v = new Array<number>(DIMENSAO_EMBEDDING).fill(0);
  v[indice] = 1;
  return v;
}

/**
 * Vetor a um ângulo controlado do eixo 0, no plano dos eixos 0 e 1.
 *
 * `distanciaAlvo` é a distância de cosseno desejada: `cos(θ) = 1 - d`.
 */
function aDistancia(distanciaAlvo: number): number[] {
  const cos = 1 - distanciaAlvo;
  const sen = Math.sqrt(Math.max(0, 1 - cos * cos));
  const v = new Array<number>(DIMENSAO_EMBEDDING).fill(0);
  v[0] = cos;
  v[1] = sen;
  return v;
}

describe('validarVetor', () => {
  it('recusa dimensão errada antes de o Postgres reclamar', () => {
    expect(() => validarVetor([1, 2, 3])).toThrow(EmbeddingInvalido);
    expect(() => validarVetor(eixo(0))).not.toThrow();
  });

  it('recusa NaN e Infinity, que contaminariam toda distância em silêncio', () => {
    const comNaN = eixo(0);
    comNaN[5] = Number.NaN;
    expect(() => validarVetor(comNaN)).toThrow(/NaN/);

    const comInfinito = eixo(0);
    comInfinito[5] = Number.POSITIVE_INFINITY;
    expect(() => validarVetor(comInfinito)).toThrow(EmbeddingInvalido);
  });

  it('recusa vetor nulo, porque cosseno dividiria por zero', () => {
    expect(() => validarVetor(new Array<number>(DIMENSAO_EMBEDDING).fill(0))).toThrow(/indefinida/);
  });
});

describe.skipIf(!temBancoDeTeste())('RepositorioDeEmbeddings', () => {
  let conexao: ConexaoDeTeste;
  let repo: RepositorioDeEmbeddings;
  let ids: string[];

  beforeEach(async () => {
    conexao ??= abrirBancoDeTeste();
    repo = new RepositorioDeEmbeddings(conexao.db);
    await limparTabelas(conexao.db, ['embedding', 'preco_historico', 'produto_externo']);

    const criados = await conexao.db
      .insert(produtoExterno)
      .values([
        { tituloBruto: 'A', hashConteudo: 'h-a', fonte: 'm0_link', formaCanonica: 'refil a' },
        { tituloBruto: 'B', hashConteudo: 'h-b', fonte: 'm0_link', formaCanonica: 'refil b' },
        { tituloBruto: 'C', hashConteudo: 'h-c', fonte: 'm0_link', formaCanonica: 'refil c' },
      ])
      .returning({ id: produtoExterno.id });
    ids = criados.map((c) => c.id);
  });

  afterAll(async () => {
    await conexao?.encerrar();
  });

  const id = (i: number): string => {
    const valor = ids[i];
    if (valor === undefined) throw new Error(`produto ${String(i)} não criado`);
    return valor;
  };

  it('devolve os vizinhos do mais parecido para o menos', async () => {
    await repo.gravar({
      produtoExternoId: id(0),
      textoCanonico: 'a',
      modelo: MODELO,
      vetor: eixo(0),
    });
    await repo.gravar({
      produtoExternoId: id(1),
      textoCanonico: 'b',
      modelo: MODELO,
      vetor: aDistancia(0.3),
    });
    await repo.gravar({
      produtoExternoId: id(2),
      textoCanonico: 'c',
      modelo: MODELO,
      vetor: aDistancia(0.1),
    });

    const vizinhos = await repo.vizinhosDe({ produtoExternoId: id(0), modelo: MODELO });
    expect(vizinhos).not.toBeNull();
    expect(vizinhos?.map((v) => v.produtoExternoId)).toEqual([id(2), id(1)]);
    expect(vizinhos?.[0]?.distancia).toBeCloseTo(0.1, 5);
  });

  it('não devolve o próprio produto como vizinho de si mesmo', async () => {
    await repo.gravar({
      produtoExternoId: id(0),
      textoCanonico: 'a',
      modelo: MODELO,
      vetor: eixo(0),
    });
    const vizinhos = await repo.vizinhosDe({ produtoExternoId: id(0), modelo: MODELO });
    expect(vizinhos).toEqual([]);
  });

  it('corta pela distância máxima', async () => {
    await repo.gravar({
      produtoExternoId: id(0),
      textoCanonico: 'a',
      modelo: MODELO,
      vetor: eixo(0),
    });
    await repo.gravar({
      produtoExternoId: id(1),
      textoCanonico: 'b',
      modelo: MODELO,
      vetor: aDistancia(0.5),
    });

    expect(await repo.vizinhosDe({ produtoExternoId: id(0), modelo: MODELO })).toEqual([]);
    const comCorteFolgado = await repo.vizinhosDe({
      produtoExternoId: id(0),
      modelo: MODELO,
      distanciaMaxima: 0.6,
    });
    expect(comCorteFolgado).toHaveLength(1);
  });

  it('vetor ortogonal fica fora do corte padrão', async () => {
    await repo.gravar({
      produtoExternoId: id(0),
      textoCanonico: 'a',
      modelo: MODELO,
      vetor: eixo(0),
    });
    await repo.gravar({
      produtoExternoId: id(1),
      textoCanonico: 'b',
      modelo: MODELO,
      vetor: eixo(7),
    });
    expect(await repo.vizinhosDe({ produtoExternoId: id(0), modelo: MODELO })).toEqual([]);
  });

  it('respeita o limite de vizinhos', async () => {
    await repo.gravar({
      produtoExternoId: id(0),
      textoCanonico: 'a',
      modelo: MODELO,
      vetor: eixo(0),
    });
    await repo.gravar({
      produtoExternoId: id(1),
      textoCanonico: 'b',
      modelo: MODELO,
      vetor: aDistancia(0.05),
    });
    await repo.gravar({
      produtoExternoId: id(2),
      textoCanonico: 'c',
      modelo: MODELO,
      vetor: aDistancia(0.06),
    });

    const um = await repo.vizinhosDe({ produtoExternoId: id(0), modelo: MODELO, limite: 1 });
    expect(um).toHaveLength(1);
    expect(um?.[0]?.produtoExternoId).toBe(id(1));
  });

  it('não mistura modelos de embedding diferentes', async () => {
    await repo.gravar({
      produtoExternoId: id(0),
      textoCanonico: 'a',
      modelo: MODELO,
      vetor: eixo(0),
    });
    await repo.gravar({
      produtoExternoId: id(1),
      textoCanonico: 'b',
      modelo: 'outro',
      vetor: eixo(0),
    });
    expect(await repo.vizinhosDe({ produtoExternoId: id(0), modelo: MODELO })).toEqual([]);
  });

  it('distingue "não pude procurar" de "procurei e não achei"', async () => {
    // `null` quando o produto não tem embedding; `[]` quando tem e não há vizinho.
    expect(await repo.vizinhosDe({ produtoExternoId: id(0), modelo: MODELO })).toBeNull();
    await repo.gravar({
      produtoExternoId: id(0),
      textoCanonico: 'a',
      modelo: MODELO,
      vetor: eixo(0),
    });
    expect(await repo.vizinhosDe({ produtoExternoId: id(0), modelo: MODELO })).toEqual([]);
  });

  it('regravar o mesmo modelo atualiza; modelo novo acrescenta linha', async () => {
    await repo.gravar({
      produtoExternoId: id(0),
      textoCanonico: 'a',
      modelo: MODELO,
      vetor: eixo(0),
    });
    await repo.gravar({
      produtoExternoId: id(0),
      textoCanonico: 'a2',
      modelo: MODELO,
      vetor: eixo(3),
    });
    await repo.gravar({
      produtoExternoId: id(0),
      textoCanonico: 'a',
      modelo: 'outro',
      vetor: eixo(0),
    });

    await repo.gravar({
      produtoExternoId: id(1),
      textoCanonico: 'b',
      modelo: MODELO,
      vetor: eixo(3),
    });
    const vizinhos = await repo.vizinhosDe({ produtoExternoId: id(0), modelo: MODELO });
    // Se a regravação tivesse acrescentado em vez de atualizar, o vetor antigo
    // ainda estaria lá e este produto não seria vizinho.
    expect(vizinhos?.map((v) => v.produtoExternoId)).toEqual([id(1)]);
  });

  it('a fila de embedding lista quem tem forma canônica e ainda não tem vetor', async () => {
    await repo.gravar({
      produtoExternoId: id(0),
      textoCanonico: 'a',
      modelo: MODELO,
      vetor: eixo(0),
    });
    const fila = await repo.semEmbedding({ modelo: MODELO });
    expect(fila.map((f) => f.id).sort()).toEqual([id(1), id(2)].sort());
  });

  it('a fila de embedding ignora forma canônica vazia, que custaria token por nada', async () => {
    await conexao.db.insert(produtoExterno).values({
      tituloBruto: 'D',
      hashConteudo: 'h-d',
      fonte: 'm0_link',
      formaCanonica: '',
    });
    const fila = await repo.semEmbedding({ modelo: MODELO });
    expect(fila.map((f) => f.formaCanonica)).not.toContain('');
  });

  it('a fila de forma canônica roda sem chave de LLM', async () => {
    await conexao.db.insert(produtoExterno).values({
      tituloBruto: 'E',
      hashConteudo: 'h-e',
      fonte: 'm0_link',
    });
    const pendentes = await repo.semFormaCanonica();
    expect(pendentes).toHaveLength(1);

    await repo.gravarFormaCanonica(pendentes[0] ?? '', 'refil electrolux pa21g');
    expect(await repo.semFormaCanonica()).toHaveLength(0);
  });
});
