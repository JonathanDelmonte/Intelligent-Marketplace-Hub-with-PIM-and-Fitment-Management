import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { reaisParaCentavos } from '@/lib/dinheiro';
import { IngestorDeProdutoExterno } from '@/dominio/ingestao/produto-externo';
import {
  abrirBancoDeTeste,
  limparTabelas,
  temBancoDeTeste,
  type ConexaoDeTeste,
} from '@/infra/banco/teste';
import { perfilVendedor } from '@/infra/banco/schema';
import {
  CatalogoError,
  RepositorioDeSku,
  TIPOS_SKU,
  esquemaNovoSku,
  perfilId,
  type PerfilId,
} from './sku';

const r = reaisParaCentavos;

describe('perfilId', () => {
  it('aceita UUID', () => {
    const id = perfilId('7364972a-45a3-40a9-b77c-e3fa75ed13fb');
    expect(id).toBe('7364972a-45a3-40a9-b77c-e3fa75ed13fb');
  });

  it('recusa o que não é UUID — id errado não passa por acidente', () => {
    for (const ruim of ['', 'essencial-emporium', '123', 'not-a-uuid']) {
      expect(() => perfilId(ruim), ruim).toThrow(CatalogoError);
    }
  });
});

describe('esquemaNovoSku', () => {
  it('exige só o título e aplica os padrões', () => {
    const v = esquemaNovoSku.parse({ tituloInterno: 'Refil PA21G' });
    expect(v.tipo).toBe('revenda');
    expect(v.ean).toBeNull();
  });

  it('valida EAN de 8, 12, 13 e 14 dígitos', () => {
    for (const ean of ['12345670', '123456789012', '7896541200121', '12345678901231']) {
      expect(esquemaNovoSku.safeParse({ tituloInterno: 'Refil', ean }).success, ean).toBe(true);
    }
  });

  it('recusa EAN de tamanho inválido ou com letra', () => {
    for (const ean of ['1234', '123456789', '789654120012A']) {
      expect(esquemaNovoSku.safeParse({ tituloInterno: 'Refil', ean }).success, ean).toBe(false);
    }
  });

  it('valida NCM com 8 dígitos e CEST com 7', () => {
    expect(esquemaNovoSku.safeParse({ tituloInterno: 'Refil', ncm: '84219999' }).success).toBe(
      true,
    );
    expect(esquemaNovoSku.safeParse({ tituloInterno: 'Refil', ncm: '8421' }).success).toBe(false);
    expect(esquemaNovoSku.safeParse({ tituloInterno: 'Refil', cest: '1234567' }).success).toBe(
      true,
    );
    expect(esquemaNovoSku.safeParse({ tituloInterno: 'Refil', cest: '12345' }).success).toBe(false);
  });

  it('recusa taxa de devolução fora de 0 a 10 000 pontos-base', () => {
    expect(
      esquemaNovoSku.safeParse({ tituloInterno: 'Refil', taxaDevolucaoEsperadaBp: 10_001 }).success,
    ).toBe(false);
    expect(
      esquemaNovoSku.safeParse({ tituloInterno: 'Refil', taxaDevolucaoEsperadaBp: -1 }).success,
    ).toBe(false);
  });

  it('recusa peso zero ou negativo', () => {
    expect(esquemaNovoSku.safeParse({ tituloInterno: 'Refil', pesoG: 0 }).success).toBe(false);
    expect(esquemaNovoSku.safeParse({ tituloInterno: 'Refil', pesoG: -5 }).success).toBe(false);
  });

  it('aceita os três tipos de SKU', () => {
    for (const tipo of TIPOS_SKU) {
      expect(esquemaNovoSku.safeParse({ tituloInterno: 'Refil', tipo }).success, tipo).toBe(true);
    }
  });
});

describe.skipIf(!temBancoDeTeste())('RepositorioDeSku (contra Postgres real)', () => {
  let conexao: ConexaoDeTeste;
  let repo: RepositorioDeSku;
  let ingestor: IngestorDeProdutoExterno;
  let perfilA: PerfilId;
  let perfilB: PerfilId;

  beforeEach(async () => {
    conexao ??= abrirBancoDeTeste();
    repo = new RepositorioDeSku(conexao.db);
    ingestor = new IngestorDeProdutoExterno(conexao.db);

    await limparTabelas(conexao.db, [
      'perfil_vendedor',
      'produto_externo',
      'sku',
      'preco_historico',
    ]);

    // Dois perfis, porque o isolamento entre eles é o que mais importa testar.
    const criados = await conexao.db
      .insert(perfilVendedor)
      .values([
        { slug: 'perfil-a', nome: 'Perfil A', regime: 'cpf' },
        { slug: 'perfil-b', nome: 'Perfil B', regime: 'mei' },
      ])
      .returning({ id: perfilVendedor.id, slug: perfilVendedor.slug });

    perfilA = perfilId(criados.find((c) => c.slug === 'perfil-a')!.id);
    perfilB = perfilId(criados.find((c) => c.slug === 'perfil-b')!.id);
  });

  afterAll(async () => {
    if (conexao !== undefined) await conexao.encerrar();
  });

  describe('isolamento entre perfis (ADR 0003)', () => {
    it('SKU de um perfil não é visível no outro', async () => {
      const criado = await repo.criar({
        perfil: perfilA,
        dados: { tituloInterno: 'Refil PA21G' },
      });

      expect(await repo.buscarPorId(perfilA, criado.id)).not.toBeNull();
      // Sem o filtro de perfil isto devolveria o SKU do perfil A — bug silencioso.
      expect(await repo.buscarPorId(perfilB, criado.id)).toBeNull();
    });

    it('listar devolve só o do perfil pedido', async () => {
      await repo.criar({ perfil: perfilA, dados: { tituloInterno: 'Refil do A' } });
      await repo.criar({ perfil: perfilB, dados: { tituloInterno: 'Refil do B' } });

      const doA = await repo.listar(perfilA);
      expect(doA).toHaveLength(1);
      expect(doA[0]?.tituloInterno).toBe('Refil do A');
    });

    it('buscar por EAN respeita o perfil', async () => {
      await repo.criar({
        perfil: perfilA,
        dados: { tituloInterno: 'Refil', ean: '7896541200121' },
      });
      expect(await repo.buscarPorEan(perfilA, '7896541200121')).not.toBeNull();
      expect(await repo.buscarPorEan(perfilB, '7896541200121')).toBeNull();
    });

    it('o mesmo EAN pode existir nos dois perfis', async () => {
      // São dois negócios diferentes vendendo o mesmo produto: legítimo.
      await repo.criar({
        perfil: perfilA,
        dados: { tituloInterno: 'Refil', ean: '7896541200121' },
      });
      await expect(
        repo.criar({ perfil: perfilB, dados: { tituloInterno: 'Refil', ean: '7896541200121' } }),
      ).resolves.toBeDefined();
    });

    it('não atualiza custo de SKU de outro perfil', async () => {
      const criado = await repo.criar({ perfil: perfilA, dados: { tituloInterno: 'Refil' } });
      expect(await repo.atualizarCusto({ perfil: perfilB, skuId: criado.id, custo: r(15) })).toBe(
        false,
      );
      expect((await repo.buscarPorId(perfilA, criado.id))?.custoAtual).toBeNull();
    });

    it('não desativa SKU de outro perfil', async () => {
      const criado = await repo.criar({ perfil: perfilA, dados: { tituloInterno: 'Refil' } });
      expect(await repo.desativar(perfilB, criado.id)).toBe(false);
      expect((await repo.buscarPorId(perfilA, criado.id))?.ativo).toBe(true);
    });

    it('recusa ligar ocorrência a SKU de outro perfil', async () => {
      const criado = await repo.criar({ perfil: perfilA, dados: { tituloInterno: 'Refil' } });
      const capturado = await ingestor.gravar({
        tituloBruto: 'Refil Filtro PA21G',
        url: 'https://a.com/1',
        fonte: 'm0_link',
      });
      if (capturado.tipo !== 'gravado') throw new Error('esperava gravado');

      await expect(
        repo.ligarProdutosExternos({
          perfil: perfilB,
          skuId: criado.id,
          produtosExternosIds: [capturado.id],
        }),
      ).rejects.toThrow(/não existe neste perfil/);
    });

    it('ocorrências de SKU de outro perfil vêm vazias', async () => {
      const criado = await repo.criar({ perfil: perfilA, dados: { tituloInterno: 'Refil' } });
      expect(await repo.ocorrencias(perfilB, criado.id)).toEqual([]);
    });
  });

  describe('ficha do produto', () => {
    async function skuNovo(titulo = 'Refil PA21G') {
      const criado = await repo.criar({ perfil: perfilA, dados: { tituloInterno: titulo } });
      return criado.id;
    }

    it('grava peso, dimensões, devolução e marca de uma vez', async () => {
      // Quem preenche preenche de uma vez, com a peça na mão: peso na balança, medida
      // na régua.
      const id = await skuNovo();
      expect(
        await repo.atualizarFicha({
          perfil: perfilA,
          skuId: id,
          pesoG: 420,
          dimMm: { comprimento: 120, largura: 80, altura: 60 },
          taxaDevolucaoEsperadaBp: 350,
          marca: 'Electrolux',
        }),
      ).toBe(true);

      const lido = await repo.buscarPorId(perfilA, id);
      expect(lido?.pesoG).toBe(420);
      expect(lido?.dimMm).toEqual({ comprimento: 120, largura: 80, altura: 60 });
      expect(lido?.taxaDevolucaoEsperadaBp).toBe(350);
      expect(lido?.marca).toBe('Electrolux');
    });

    it('campo ausente do objeto não é tocado', async () => {
      // "Não informei agora" é diferente de "apaguei o que tinha".
      const id = await skuNovo();
      await repo.atualizarFicha({ perfil: perfilA, skuId: id, pesoG: 420 });
      await repo.atualizarFicha({ perfil: perfilA, skuId: id, taxaDevolucaoEsperadaBp: 100 });

      const lido = await repo.buscarPorId(perfilA, id);
      expect(lido?.pesoG).toBe(420);
      expect(lido?.taxaDevolucaoEsperadaBp).toBe(100);
    });

    it('nulo explícito apaga o que tinha', async () => {
      const id = await skuNovo();
      await repo.atualizarFicha({ perfil: perfilA, skuId: id, pesoG: 420 });
      await repo.atualizarFicha({ perfil: perfilA, skuId: id, pesoG: null });
      expect((await repo.buscarPorId(perfilA, id))?.pesoG).toBeNull();
    });

    it('formulário sem alteração nenhuma não escreve', async () => {
      const id = await skuNovo();
      expect(await repo.atualizarFicha({ perfil: perfilA, skuId: id })).toBe(false);
    });

    it('recusa número que não faz sentido, com o campo na mensagem', async () => {
      const id = await skuNovo();
      await expect(repo.atualizarFicha({ perfil: perfilA, skuId: id, pesoG: 0 })).rejects.toThrow(
        /peso/,
      );
      await expect(
        repo.atualizarFicha({ perfil: perfilA, skuId: id, taxaDevolucaoEsperadaBp: 20_000 }),
      ).rejects.toThrow(/devolução/);
      await expect(
        repo.atualizarFicha({
          perfil: perfilA,
          skuId: id,
          dimMm: { comprimento: 10, largura: 0, altura: 5 },
        }),
      ).rejects.toThrow(/dimensão/);
    });

    it('grava voltagem, medida e quantidade da embalagem', async () => {
      // Os três atributos que o checklist de anúncio cobra no nível `devolucao` e que
      // até a migração 0010 não tinham onde ser preenchidos.
      const id = await skuNovo();
      expect(
        await repo.atualizarFicha({
          perfil: perfilA,
          skuId: id,
          voltagem: 'Bivolt',
          medida: 'Rosca 1/2 polegada',
          quantidadeEmbalagem: 2,
        }),
      ).toBe(true);

      const lido = await repo.buscarPorId(perfilA, id);
      expect(lido?.voltagem).toBe('Bivolt');
      expect(lido?.medida).toBe('Rosca 1/2 polegada');
      expect(lido?.quantidadeEmbalagem).toBe(2);
    });

    it('recusa quantidade de embalagem que não é inteiro positivo', async () => {
      // Zero não vira "não informado": aceitar esconderia erro de digitação num campo
      // que decide devolução.
      const id = await skuNovo();
      await expect(
        repo.atualizarFicha({ perfil: perfilA, skuId: id, quantidadeEmbalagem: 0 }),
      ).rejects.toThrow(/quantidade/);
      await expect(
        repo.atualizarFicha({ perfil: perfilA, skuId: id, quantidadeEmbalagem: 2.5 }),
      ).rejects.toThrow(/quantidade/);
      expect((await repo.buscarPorId(perfilA, id))?.quantidadeEmbalagem).toBeNull();
    });

    it('não atualiza ficha de SKU de outro perfil', async () => {
      const id = await skuNovo();
      expect(await repo.atualizarFicha({ perfil: perfilB, skuId: id, pesoG: 999 })).toBe(false);
      expect((await repo.buscarPorId(perfilA, id))?.pesoG).toBeNull();
    });

    it('a data do custo vem na leitura, e é ela que diz se o custo ainda vale', async () => {
      const id = await skuNovo();
      expect((await repo.buscarPorId(perfilA, id))?.custoAtualizadoEm).toBeNull();

      await repo.atualizarCusto({ perfil: perfilA, skuId: id, custo: reaisParaCentavos(18.4) });
      const lido = await repo.buscarPorId(perfilA, id);
      expect(lido?.custoAtual).toBe(reaisParaCentavos(18.4));
      expect(lido?.custoAtualizadoEm).toBeInstanceOf(Date);
    });

    it('salvar a ficha não mexe na data do custo', async () => {
      // Se mexesse, um salvamento de peso reescreveria a data — e a data do custo é o
      // que responde se ele ainda vale.
      const id = await skuNovo();
      await repo.atualizarCusto({ perfil: perfilA, skuId: id, custo: reaisParaCentavos(10) });
      const antes = (await repo.buscarPorId(perfilA, id))?.custoAtualizadoEm;

      await repo.atualizarFicha({ perfil: perfilA, skuId: id, pesoG: 300 });
      const depois = (await repo.buscarPorId(perfilA, id))?.custoAtualizadoEm;

      expect(depois?.toISOString()).toBe(antes?.toISOString());
    });
  });

  describe('criação', () => {
    it('grava os campos informados', async () => {
      const criado = await repo.criar({
        perfil: perfilA,
        dados: {
          tituloInterno: 'Refil Filtro Purificador Electrolux PA21G',
          ean: '7896541200121',
          marca: 'Electrolux',
          pesoG: 250,
          custoAtual: r(15),
          tipo: 'revenda',
          ncm: '84219999',
        },
      });

      expect(criado.tituloInterno).toContain('PA21G');
      expect(criado.custoAtual).toBe(1500);
      expect(criado.pesoG).toBe(250);
      expect(criado.ativo).toBe(true);
    });

    it('rejeita dados inválidos com mensagem que diz o campo', async () => {
      await expect(
        repo.criar({ perfil: perfilA, dados: { tituloInterno: 'x', ean: '123' } }),
      ).rejects.toThrow(/tituloInterno|ean/);
    });
  });

  describe('grafo de identidade', () => {
    it('liga ocorrências ao SKU na criação', async () => {
      const a = await ingestor.gravar({
        tituloBruto: 'Refil Filtro Purificador Electrolux PA21G Original',
        url: 'https://ml.com/1',
        plataformaOuSite: 'ml',
        precoReais: 69.9,
        fonte: 'm0_link',
      });
      const b = await ingestor.gravar({
        tituloBruto: 'Elemento Filtrante Acquaclean p/ purificador Electrolux',
        url: 'https://distribuidor.com/ef-elx-21',
        plataformaOuSite: 'distribuidor',
        precoReais: 15,
        fonte: 'm0_link',
      });
      if (a.tipo !== 'gravado' || b.tipo !== 'gravado') throw new Error('esperava gravado');

      const criado = await repo.criar({
        perfil: perfilA,
        dados: { tituloInterno: 'Refil Electrolux PA21G' },
        produtosExternosIds: [a.id, b.id],
      });

      const ocorrencias = await repo.ocorrencias(perfilA, criado.id);
      expect(ocorrencias).toHaveLength(2);
      // É o que dá margem: o preço de mercado e o do fornecedor no mesmo lugar.
      expect(ocorrencias.map((o) => o.preco).sort((x, y) => (x ?? 0) - (y ?? 0))).toEqual([
        1500, 6990,
      ]);
    });

    it('a ligação é revisável — desligar volta a ocorrência para a fila', async () => {
      const capturado = await ingestor.gravar({
        tituloBruto: 'Refil Filtro PA21G',
        url: 'https://a.com/1',
        fonte: 'm0_link',
      });
      if (capturado.tipo !== 'gravado') throw new Error('esperava gravado');

      const criado = await repo.criar({
        perfil: perfilA,
        dados: { tituloInterno: 'Refil PA21G' },
        produtosExternosIds: [capturado.id],
      });

      expect(await repo.naoResolvidos()).toHaveLength(0);

      const desligou = await repo.desligarProdutoExterno({
        perfil: perfilA,
        produtoExternoId: capturado.id,
      });
      expect(desligou).toBe(true);
      expect(await repo.ocorrencias(perfilA, criado.id)).toHaveLength(0);
      expect(await repo.naoResolvidos()).toHaveLength(1);
    });

    it('desligar ocorrência já solta devolve false, sem lançar', async () => {
      const capturado = await ingestor.gravar({
        tituloBruto: 'Refil Filtro PA21G',
        url: 'https://a.com/1',
        fonte: 'm0_link',
      });
      if (capturado.tipo !== 'gravado') throw new Error('esperava gravado');

      expect(
        await repo.desligarProdutoExterno({ perfil: perfilA, produtoExternoId: capturado.id }),
      ).toBe(false);
    });

    it('naoResolvidos é a fila de trabalho do M3', async () => {
      for (let i = 0; i < 3; i += 1) {
        await ingestor.gravar({
          tituloBruto: `Refil Filtro modelo ${String(i)}`,
          url: `https://a.com/${String(i)}`,
          fonte: 'm0_link',
        });
      }
      expect(await repo.naoResolvidos()).toHaveLength(3);
    });
  });

  describe('custo', () => {
    it('atualizar marca quando foi atualizado', async () => {
      // Custo velho é a causa mais comum de margem otimista.
      const criado = await repo.criar({ perfil: perfilA, dados: { tituloInterno: 'Refil' } });
      expect(await repo.atualizarCusto({ perfil: perfilA, skuId: criado.id, custo: r(15) })).toBe(
        true,
      );
      expect((await repo.buscarPorId(perfilA, criado.id))?.custoAtual).toBe(1500);
    });

    it('recusa custo negativo', async () => {
      const criado = await repo.criar({ perfil: perfilA, dados: { tituloInterno: 'Refil' } });
      await expect(
        repo.atualizarCusto({ perfil: perfilA, skuId: criado.id, custo: r(-1) }),
      ).rejects.toThrow(CatalogoError);
    });

    it('aceita custo zero, que é diferente de custo ausente', async () => {
      const criado = await repo.criar({ perfil: perfilA, dados: { tituloInterno: 'Refil' } });
      expect(await repo.atualizarCusto({ perfil: perfilA, skuId: criado.id, custo: r(0) })).toBe(
        true,
      );
      expect((await repo.buscarPorId(perfilA, criado.id))?.custoAtual).toBe(0);
    });
  });

  describe('desativação', () => {
    it('desativa em vez de apagar — pedido antigo ainda resolve para o SKU', async () => {
      const criado = await repo.criar({ perfil: perfilA, dados: { tituloInterno: 'Refil' } });
      expect(await repo.desativar(perfilA, criado.id)).toBe(true);

      expect(await repo.listar(perfilA)).toHaveLength(0);
      expect(await repo.listar(perfilA, { apenasAtivos: false })).toHaveLength(1);
      expect(await repo.buscarPorId(perfilA, criado.id)).not.toBeNull();
    });

    it('reativar desfaz a desativação, com o mesmo custo de um clique', async () => {
      const criado = await repo.criar({ perfil: perfilA, dados: { tituloInterno: 'Refil' } });
      await repo.desativar(perfilA, criado.id);

      expect(await repo.reativar(perfilA, criado.id)).toBe(true);
      expect((await repo.listar(perfilA)).map((s) => s.id)).toEqual([criado.id]);
      expect(await repo.desativados(perfilA)).toHaveLength(0);
    });

    it('a lista de desativados tem só os desativados, do perfil, o mais recente primeiro', async () => {
      const antigo = await repo.criar({ perfil: perfilA, dados: { tituloInterno: 'Antigo' } });
      const recente = await repo.criar({ perfil: perfilA, dados: { tituloInterno: 'Recente' } });
      await repo.criar({ perfil: perfilA, dados: { tituloInterno: 'Ativo' } });
      const doOutro = await repo.criar({ perfil: perfilB, dados: { tituloInterno: 'Do B' } });

      await repo.desativar(perfilA, antigo.id);
      // A ordem sai do instante da desativação, que tem milissegundo como resolução:
      // sem a pausa, as duas podem cair no mesmo milissegundo e a ordem vira sorteio.
      await new Promise((resolver) => setTimeout(resolver, 5));
      await repo.desativar(perfilA, recente.id);
      await repo.desativar(perfilB, doOutro.id);

      expect((await repo.desativados(perfilA)).map((s) => s.tituloInterno)).toEqual([
        'Recente',
        'Antigo',
      ]);
    });

    it('não reativa produto de outro perfil', async () => {
      const doB = await repo.criar({ perfil: perfilB, dados: { tituloInterno: 'Do B' } });
      await repo.desativar(perfilB, doB.id);

      expect(await repo.reativar(perfilA, doB.id)).toBe(false);
      expect(await repo.desativados(perfilB)).toHaveLength(1);
    });
  });

  describe('pendências fiscais — prazo de 04/01/2027', () => {
    it('lista o que falta por SKU', async () => {
      await repo.criar({ perfil: perfilA, dados: { tituloInterno: 'Sem nada fiscal' } });
      await repo.criar({
        perfil: perfilA,
        dados: { tituloInterno: 'Só com NCM', ncm: '84219999' },
      });
      await repo.criar({
        perfil: perfilA,
        dados: {
          tituloInterno: 'Completo',
          ncm: '84219999',
          cst: '00',
          cclasstrib: '000001',
        },
      });

      const pendencias = await repo.pendenciasFiscais(perfilA);
      expect(pendencias).toHaveLength(2);

      const semNada = pendencias.find((p) => p.tituloInterno === 'Sem nada fiscal');
      expect([...(semNada?.faltando ?? [])].sort()).toEqual(['cclasstrib', 'cst', 'ncm']);

      const soNcm = pendencias.find((p) => p.tituloInterno === 'Só com NCM');
      expect([...(soNcm?.faltando ?? [])].sort()).toEqual(['cclasstrib', 'cst']);
    });

    it('SKU completo não aparece como pendência', async () => {
      await repo.criar({
        perfil: perfilA,
        dados: { tituloInterno: 'Completo', ncm: '84219999', cst: '00', cclasstrib: '000001' },
      });
      expect(await repo.pendenciasFiscais(perfilA)).toHaveLength(0);
    });

    it('SKU desativado não entra na dívida fiscal', async () => {
      const criado = await repo.criar({ perfil: perfilA, dados: { tituloInterno: 'Antigo' } });
      await repo.desativar(perfilA, criado.id);
      expect(await repo.pendenciasFiscais(perfilA)).toHaveLength(0);
    });

    it('pendência de um perfil não aparece no outro', async () => {
      await repo.criar({ perfil: perfilA, dados: { tituloInterno: 'Do A' } });
      expect(await repo.pendenciasFiscais(perfilB)).toHaveLength(0);
    });
  });
});
