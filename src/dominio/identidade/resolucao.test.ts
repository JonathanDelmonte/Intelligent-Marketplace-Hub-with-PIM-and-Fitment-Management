/**
 * Testes da resolução de identidade de ponta a ponta, contra Postgres de verdade.
 *
 * Dois cenários, e os dois importam:
 *
 * - **Sem chave de LLM**, que é a situação de hoje: o que o determinístico resolve
 *   tem de sair resolvido, e o que depende de julgamento tem de ficar na fila com o
 *   motivo escrito — nunca sumir e nunca virar palpite.
 * - **Com um chamador falso**, que prova o roteamento por limiar, o cache, o
 *   orçamento e a regra de que decisão humana não é sobrescrita.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { parIdentidade, perfilVendedor, produtoExterno } from '@/infra/banco/schema';
import {
  Orcamento,
  ServicoDeLlm,
  type Chamador,
  type PedidoAoModelo,
  type RespostaDoModelo,
} from '@/infra/llm';
import {
  abrirBancoDeTeste,
  limparTabelas,
  temBancoDeTeste,
  type ConexaoDeTeste,
} from '@/infra/banco/teste';
import { RepositorioDeExemplos } from './exemplos';
import { RepositorioDePares } from './pares';
import { esquemaRegistroDeProduto } from './registro';
import { DIMENSAO_EMBEDDING, RepositorioDeEmbeddings } from './vizinhos';
import {
  CONFIANCA_POR_CERTEZA,
  ResolvedorDeIdentidade,
  perguntaDeIdentidade,
  semResolucao,
} from './resolucao';

const MODELO = 'julgador-de-teste';
const EAN_A = '7896541200121';

type Resposta = RespostaDoModelo | ((pedido: PedidoAoModelo) => RespostaDoModelo);

class ChamadorFalso implements Chamador {
  readonly nome = 'falso';
  chamadas: PedidoAoModelo[] = [];
  constructor(private readonly resposta: Resposta) {}
  async chamar(pedido: PedidoAoModelo): Promise<RespostaDoModelo> {
    this.chamadas.push(pedido);
    const resposta = typeof this.resposta === 'function' ? this.resposta(pedido) : this.resposta;
    return await Promise.resolve(resposta);
  }
}

const esquemaDoPedido = z.object({ pares: z.array(z.object({ id: z.string() })) });

/** Julga todos os pares do pedido do mesmo jeito, como um modelo que concorda consigo. */
const julga =
  (mesmoProduto: boolean, certeza: 'alta' | 'media' | 'baixa') =>
  (pedido: PedidoAoModelo): RespostaDoModelo => ({
    saida: {
      julgamentos: esquemaDoPedido.parse(pedido.entrada).pares.map((par) => ({
        id: par.id,
        mesmoProduto,
        certeza,
        justificativa: 'mesmo elemento filtrante, nomes diferentes',
      })),
    },
    custoCentavos: 1,
  });

const TABELAS = [
  'par_identidade',
  'exemplo_identidade',
  'llm_call',
  'embedding',
  'preco_historico',
  'produto_externo',
  'sku',
  'perfil_vendedor',
] as const;

describe.skipIf(!temBancoDeTeste())('resolução de identidade', () => {
  let conexao: ConexaoDeTeste;
  let pares: RepositorioDePares;

  beforeEach(async () => {
    conexao ??= abrirBancoDeTeste();
    pares = new RepositorioDePares(conexao.db);
    await limparTabelas(conexao.db, TABELAS);

    await conexao.db
      .insert(perfilVendedor)
      .values({ slug: 'identidade', nome: 'Perfil', regime: 'mei' });
  });

  afterAll(async () => {
    await conexao?.encerrar();
  });

  /** Cria uma ocorrência com o registro já extraído. */
  async function ocorrencia(
    hash: string,
    campos: {
      titulo?: string;
      ean?: string | null;
      atributos?: Record<string, unknown> | null;
      preco?: number | null;
      vendedor?: string;
    } = {},
  ): Promise<string> {
    const criados = await conexao.db
      .insert(produtoExterno)
      .values({
        tituloBruto: campos.titulo ?? `ocorrência ${hash}`,
        hashConteudo: hash,
        fonte: 'm0_link',
        ean: campos.ean ?? null,
        atributosExtraidos: campos.atributos ?? null,
        preco: campos.preco ?? null,
        vendedor: campos.vendedor ?? null,
      })
      .returning({ id: produtoExterno.id });
    const id = criados[0]?.id;
    if (id === undefined) throw new Error('não criou a ocorrência');
    return id;
  }

  const REFIL_ANUNCIO = {
    tipoProduto: 'refil de filtro',
    marca: 'Electrolux',
    modeloPeca: 'PA21G',
  };
  const REFIL_DISTRIBUIDOR = {
    tipoProduto: 'elemento filtrante',
    marca: 'electrolux do brasil s/a',
    modeloPeca: 'pa 21 g',
  };

  describe('preparação, que roda sem chave de LLM', () => {
    it('grava forma canônica e chave de agrupamento', async () => {
      const id = await ocorrencia('h1', { atributos: REFIL_ANUNCIO });
      const resolvedor = new ResolvedorDeIdentidade(conexao.db);

      const preparo = await resolvedor.preparar(id);
      expect(preparo.formaCanonica).toBe('refil de filtro electrolux pa21g');
      expect(preparo.chaveAgrupamento).toBe('electrolux|pa21g');
      expect(preparo.registroInvalido).toBe(false);
    });

    it('sem marca nem modelo, a chave é nula e não vazia', async () => {
      const id = await ocorrencia('h2', { atributos: { tipoProduto: 'refil' } });
      const preparo = await new ResolvedorDeIdentidade(conexao.db).preparar(id);
      expect(preparo.chaveAgrupamento).toBeNull();
      expect(preparo.formaCanonica).toBe('refil');
    });

    it('atributos que não validam não impedem a preparação', async () => {
      const id = await ocorrencia('h3', { atributos: { quantidadeEmbalagem: 'duas' } });
      const preparo = await new ResolvedorDeIdentidade(conexao.db).preparar(id);
      expect(preparo.registroInvalido).toBe(true);
      expect(preparo.formaCanonica).toBe('');
    });

    it('prepara em lote e é idempotente', async () => {
      await ocorrencia('h4', { atributos: REFIL_ANUNCIO });
      await ocorrencia('h5', { atributos: REFIL_DISTRIBUIDOR });
      const resolvedor = new ResolvedorDeIdentidade(conexao.db);

      expect(await resolvedor.prepararLote()).toBe(2);
      expect(await resolvedor.prepararLote()).toBe(0);
    });
  });

  describe('sem chave de LLM', () => {
    it('agrupa por marca e modelo sozinho, sem gastar nada', async () => {
      const a = await ocorrencia('h1', { atributos: REFIL_ANUNCIO });
      const b = await ocorrencia('h2', { atributos: REFIL_DISTRIBUIDOR });
      const resolvedor = new ResolvedorDeIdentidade(conexao.db);
      await resolvedor.preparar(b);

      const r = await resolvedor.resolver(a);
      expect(r.candidatos).toBe(1);
      expect(r.agrupados).toBe(1);
      expect(r.julgamentos).toBe(0);

      const par = await pares.buscar(a, b);
      expect(par?.decisao).toBe('mesmo');
      expect(par?.origem).toBe('deterministico');
      expect(par?.status).toBe('automatico');
    });

    it('agrupa por GTIN igual mesmo sem atributo nenhum', async () => {
      const a = await ocorrencia('h1', { ean: EAN_A });
      const b = await ocorrencia('h2', { ean: EAN_A });
      const resolvedor = new ResolvedorDeIdentidade(conexao.db);
      await resolvedor.preparar(b);

      const r = await resolvedor.resolver(a);
      expect(r.agrupados).toBe(1);
      const par = await pares.buscar(a, b);
      expect(par?.confiancaBp).toBe(10_000);
    });

    it('separa mesma marca com código diferente', async () => {
      const a = await ocorrencia('h1', { atributos: REFIL_ANUNCIO });
      const b = await ocorrencia('h2', {
        atributos: { ...REFIL_ANUNCIO, modeloPeca: 'PA26G', ean: null },
        ean: null,
      });
      const resolvedor = new ResolvedorDeIdentidade(conexao.db);
      await resolvedor.preparar(b);

      // Chave de agrupamento diferente, então o candidato nem é gerado por essa
      // via; com embedding ele viria. Aqui o que se prova é que não agrupa.
      const r = await resolvedor.resolver(a);
      expect(r.agrupados).toBe(0);
      expect(await pares.buscar(a, b)).toBeNull();
    });

    it('o par que só o LLM resolveria fica na fila com o motivo escrito', async () => {
      // Mesma chave de agrupamento, quantidade divergente: o determinístico manda
      // para revisão de propósito, e sem chave ninguém julga.
      const a = await ocorrencia('h1', { atributos: { ...REFIL_ANUNCIO, quantidadeEmbalagem: 1 } });
      const b = await ocorrencia('h2', {
        atributos: { ...REFIL_DISTRIBUIDOR, quantidadeEmbalagem: 3 },
      });
      const resolvedor = new ResolvedorDeIdentidade(conexao.db);
      await resolvedor.preparar(b);

      const r = await resolvedor.resolver(a);
      expect(r.pendenteDeLlm).toBe(1);
      expect(r.julgamentos).toBe(0);

      const fila = await pares.fila();
      expect(fila).toHaveLength(1);
      expect(fila[0]?.justificativa).toContain('sem chave de LLM');
      expect(fila[0]?.justificativa).toContain('quantidade');
    });

    it('o nível determinístico chega à fila, para a tela não dizer "sem evidência"', async () => {
      // O par fica pendente por quantidade divergente, mas a evidência que o trouxe
      // foi marca e código de peça — e é isso que o revisor precisa ler.
      const a = await ocorrencia('h1', { atributos: { ...REFIL_ANUNCIO, quantidadeEmbalagem: 1 } });
      await ocorrencia('h2', { atributos: { ...REFIL_DISTRIBUIDOR, quantidadeEmbalagem: 3 } });
      const resolvedor = new ResolvedorDeIdentidade(conexao.db);
      await resolvedor.prepararLote();
      await resolvedor.resolver(a);

      const fila = await pares.fila();
      expect(fila[0]?.nivel).toBe('marca_modelo');
    });

    it('não reconsidera par já avaliado', async () => {
      const a = await ocorrencia('h1', { atributos: REFIL_ANUNCIO });
      const b = await ocorrencia('h2', { atributos: REFIL_DISTRIBUIDOR });
      const resolvedor = new ResolvedorDeIdentidade(conexao.db);
      await resolvedor.preparar(b);

      await resolvedor.resolver(a);
      const segunda = await resolvedor.resolver(a);
      expect(segunda.candidatos).toBe(0);
    });

    it('a fila da resolução lista quem não tem par nenhum', async () => {
      const a = await ocorrencia('h1', { atributos: REFIL_ANUNCIO });
      const b = await ocorrencia('h2', { atributos: REFIL_DISTRIBUIDOR });
      const resolvedor = new ResolvedorDeIdentidade(conexao.db);
      await resolvedor.prepararLote();

      expect([...(await semResolucao(conexao.db))].sort()).toEqual([a, b].sort());
      await resolvedor.resolver(a);
      expect(await semResolucao(conexao.db)).toEqual([]);
    });
  });

  /**
   * O caminho da especificação para o par que o determinístico não decide.
   *
   * Sem código de peça dos dois lados não há chave de agrupamento, então o único
   * gerador de candidato é a **vizinhança de embedding** — que é exatamente o
   * desenho do M3: forma canônica, embedding, vizinhos, e só então julgamento.
   *
   * O vetor é sintético. O que se prova aqui é o roteamento por limiar, não a
   * qualidade de um embedding de verdade.
   */
  describe('com julgamento por LLM, pela via do embedding', () => {
    const MODELO_EMBEDDING = 'embedding-de-teste';

    const comLlm = (chamador: Chamador, orcamento = new Orcamento(100, 10)) =>
      new ResolvedorDeIdentidade(conexao.db, {
        llm: new ServicoDeLlm(conexao.db, chamador, orcamento),
        modeloDeJulgamento: MODELO,
        modeloDeEmbedding: MODELO_EMBEDDING,
      });

    /** Vetor quase no eixo 0: todos ficam a distância pequena entre si. */
    function vetorProximo(desvio: number): number[] {
      const v = new Array<number>(DIMENSAO_EMBEDDING).fill(0);
      v[0] = 1;
      v[1] = desvio;
      return v;
    }

    /**
     * Dois registros sem código de peça: mesmo tipo de coisa, marca igual, nomes
     * diferentes. É o caso de "Refil Filtro Electrolux" contra "Elemento Filtrante
     * p/ purificador Electrolux" — o exemplo da especificação.
     */
    async function parPorEmbedding(): Promise<readonly [string, string]> {
      const a = await ocorrencia('h1', {
        atributos: { tipoProduto: 'refil de filtro', marca: 'Electrolux' },
      });
      const b = await ocorrencia('h2', {
        atributos: { tipoProduto: 'elemento filtrante', marca: 'Electrolux' },
      });

      const resolvedor = new ResolvedorDeIdentidade(conexao.db);
      await resolvedor.prepararLote();

      const embeddings = new RepositorioDeEmbeddings(conexao.db);
      await embeddings.gravar({
        produtoExternoId: a,
        textoCanonico: 'refil de filtro electrolux',
        modelo: MODELO_EMBEDDING,
        vetor: vetorProximo(0),
      });
      await embeddings.gravar({
        produtoExternoId: b,
        textoCanonico: 'elemento filtrante electrolux',
        modelo: MODELO_EMBEDDING,
        vetor: vetorProximo(0.05),
      });

      return [a, b];
    }

    it('certeza alta agrupa automaticamente, e guarda a distância que gerou o par', async () => {
      const [a, b] = await parPorEmbedding();
      const chamador = new ChamadorFalso(julga(true, 'alta'));

      const r = await comLlm(chamador).resolver(a);
      expect(r.candidatos).toBe(1);
      expect(r.julgamentos).toBe(1);
      expect(r.agrupados).toBe(1);

      const par = await pares.buscar(a, b);
      expect(par?.origem).toBe('llm');
      expect(par?.confiancaBp).toBe(CONFIANCA_POR_CERTEZA.alta);
      expect(par?.status).toBe('automatico');

      const [linha] = await conexao.db
        .select({ distanciaBp: parIdentidade.distanciaBp, nivel: parIdentidade.nivel })
        .from(parIdentidade);
      expect(linha?.nivel).toBe('embedding');
      expect(linha?.distanciaBp).toBeGreaterThan(0);
    });

    it('certeza média vai para a fila de revisão', async () => {
      const [a, b] = await parPorEmbedding();
      const r = await comLlm(new ChamadorFalso(julga(true, 'media'))).resolver(a);
      expect(r.paraRevisao).toBe(1);
      expect((await pares.buscar(a, b))?.status).toBe('pendente');
    });

    it('certeza baixa é descartada, e fica gravada para não pagar de novo', async () => {
      const [a, b] = await parPorEmbedding();
      const chamador = new ChamadorFalso(julga(true, 'baixa'));
      const resolvedor = comLlm(chamador);

      const r = await resolvedor.resolver(a);
      expect(r.descartados).toBe(1);
      expect((await pares.buscar(a, b))?.status).toBe('descartado');

      await resolvedor.resolver(a);
      expect(chamador.chamadas).toHaveLength(1);
    });

    it('"não são o mesmo" separa com a justificativa do modelo', async () => {
      const [a, b] = await parPorEmbedding();
      const r = await comLlm(new ChamadorFalso(julga(false, 'alta'))).resolver(a);
      expect(r.separados).toBe(1);
      const par = await pares.buscar(a, b);
      expect(par?.decisao).toBe('diferente');
      expect(par?.status).toBe('automatico');
    });

    it('saída fora do schema vira revisão, não gravação de lixo', async () => {
      const [a, b] = await parPorEmbedding();
      const chamador = new ChamadorFalso({
        saida: { julgamentos: [{ id: 'q1', mesmoProduto: 'talvez' }] },
      });
      const r = await comLlm(chamador).resolver(a);

      expect(r.paraRevisao).toBe(1);
      const par = await pares.buscar(a, b);
      expect(par?.decisao).toBe('indeciso');
      expect(par?.status).toBe('pendente');
    });

    it('o par vai ordenado ao modelo, então (A,B) e (B,A) são uma chamada só', () => {
      const ladoA = {
        ean: null,
        formaCanonica: 'refil electrolux pa21g',
        registro: esquemaRegistroDeProduto.parse(REFIL_ANUNCIO),
      };
      const ladoB = {
        ean: null,
        formaCanonica: 'elemento filtrante electrolux',
        registro: esquemaRegistroDeProduto.parse(REFIL_DISTRIBUIDOR),
      };
      expect(perguntaDeIdentidade(ladoA, ladoB)).toEqual(perguntaDeIdentidade(ladoB, ladoA));
    });

    it('exemplos humanos vão como contexto, fora do hash de cache', async () => {
      const [a] = await parPorEmbedding();
      const exemplos = new RepositorioDeExemplos(conexao.db);
      await exemplos.registrar({
        canonicoA: 'refil electrolux pa21g',
        canonicoB: 'elemento filtrante electrolux pa21g',
        decisao: 'sim',
        justificativa: 'mesmo código de peça, nomes de catálogo diferentes',
      });

      const chamador = new ChamadorFalso(julga(true, 'alta'));
      await comLlm(chamador).resolver(a);

      expect(chamador.chamadas[0]?.contexto).toMatchObject({
        exemplos: [{ mesmoProduto: 'sim' }],
      });
    });

    it('os pares de um produto vão num pedido só, e o par que o modelo pulou vai para revisão', async () => {
      const ids: string[] = [];
      for (let i = 0; i < 3; i += 1) {
        ids.push(
          await ocorrencia(`h${String(i)}`, {
            atributos: { tipoProduto: `tipo ${String(i)}`, marca: 'Electrolux' },
          }),
        );
      }
      await new ResolvedorDeIdentidade(conexao.db).prepararLote();
      const embeddings = new RepositorioDeEmbeddings(conexao.db);
      for (const [i, id] of ids.entries()) {
        await embeddings.gravar({
          produtoExternoId: id,
          textoCanonico: `tipo ${String(i)} electrolux`,
          modelo: MODELO_EMBEDDING,
          vetor: vetorProximo(i * 0.01),
        });
      }

      // O modelo responde só o primeiro par.
      const chamador = new ChamadorFalso((pedido) => {
        const [primeiro] = esquemaDoPedido.parse(pedido.entrada).pares;
        return {
          saida: {
            julgamentos: [
              {
                id: primeiro?.id,
                mesmoProduto: true,
                certeza: 'alta',
                justificativa: 'mesma peça',
              },
            ],
          },
        };
      });
      const r = await comLlm(chamador).resolver(ids[0] ?? '');

      expect(chamador.chamadas).toHaveLength(1);
      expect(r).toMatchObject({ candidatos: 2, julgamentos: 2, agrupados: 1, paraRevisao: 1 });
      const fila = await pares.fila();
      expect(fila[0]?.justificativa).toBe('o modelo não julgou este par');
    });

    it('orçamento estourado interrompe o lote sem perder o que já resolveu', async () => {
      // Quatro ocorrências próximas: cada produto julga os seus pares num pedido, e o
      // terceiro produto estoura um teto de dois pedidos.
      const ids: string[] = [];
      for (let i = 0; i < 4; i += 1) {
        ids.push(
          await ocorrencia(`h${String(i)}`, {
            atributos: { tipoProduto: `tipo ${String(i)}`, marca: 'Electrolux' },
          }),
        );
      }
      await new ResolvedorDeIdentidade(conexao.db).prepararLote();

      const embeddings = new RepositorioDeEmbeddings(conexao.db);
      for (const [i, id] of ids.entries()) {
        await embeddings.gravar({
          produtoExternoId: id,
          textoCanonico: `tipo ${String(i)} electrolux`,
          modelo: MODELO_EMBEDDING,
          vetor: vetorProximo(i * 0.01),
        });
      }

      const chamador = new ChamadorFalso(julga(true, 'media'));
      const resolvedor = comLlm(chamador, new Orcamento(100, 2));

      const lote = await resolvedor.resolverLote();
      expect(lote.pararamPorOrcamento).toBe(true);
      expect(lote.resolvidos).toHaveLength(2);
      expect(chamador.chamadas).toHaveLength(2);

      // O que foi decidido antes do estouro continua decidido: o lote é retomável.
      const contagem = await pares.contarPorStatus();
      expect(contagem.pendente).toBeGreaterThan(0);
    });
  });

  describe('decisão humana', () => {
    it('não é sobrescrita pela varredura automática seguinte', async () => {
      const a = await ocorrencia('h1', { atributos: REFIL_ANUNCIO });
      const b = await ocorrencia('h2', { atributos: REFIL_DISTRIBUIDOR });
      const resolvedor = new ResolvedorDeIdentidade(conexao.db);
      await resolvedor.prepararLote();

      // Uma pessoa diz que NÃO são o mesmo produto, contra o determinístico.
      await pares.registrar({
        produtoA: a,
        produtoB: b,
        decisao: 'diferente',
        origem: 'humano',
        nivel: 'marca_modelo',
        confiancaBp: 10_000,
        status: 'resolvido',
        justificativa: 'o do distribuidor é a versão antiga, com rosca diferente',
      });

      // A resolução roda de novo e discorda. A decisão humana fica.
      await pares.registrar({
        produtoA: a,
        produtoB: b,
        decisao: 'mesmo',
        origem: 'deterministico',
        nivel: 'marca_modelo',
        confiancaBp: 8_500,
        status: 'automatico',
      });

      const par = await pares.buscar(a, b);
      expect(par?.origem).toBe('humano');
      expect(par?.decisao).toBe('diferente');
      expect(par?.status).toBe('resolvido');
    });
  });
});
