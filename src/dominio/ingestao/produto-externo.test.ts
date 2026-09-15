import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  abrirBancoDeTeste,
  limparTabelas,
  temBancoDeTeste,
  type ConexaoDeTeste,
} from '@/infra/banco/teste';
import type { Evento } from '@/dominio/monitor/eventos';
import {
  IngestorDeProdutoExterno,
  calcularHashConteudo,
  esquemaProdutoExternoCapturado,
  normalizarTitulo,
} from './produto-externo';

describe('normalizarTitulo', () => {
  it('remove acento, caixa e espaço repetido', () => {
    expect(normalizarTitulo('  Refil   Purificador de ÁGUA  ')).toBe('refil purificador de agua');
  });

  it('NÃO remove palavra-chave de SEO nem reordena', () => {
    // Isso é trabalho do M3, que decide identidade com julgamento. Fazer aqui
    // colapsaria produtos diferentes no mesmo hash.
    const a = normalizarTitulo('Refil Filtro Purificador Electrolux PA21G Original Promoção');
    const b = normalizarTitulo('Refil Filtro Purificador Electrolux PA21G');
    expect(a).not.toBe(b);
  });

  it('é idempotente', () => {
    const uma = normalizarTitulo('Refil  ÁGUA');
    expect(normalizarTitulo(uma)).toBe(uma);
  });
});

describe('calcularHashConteudo', () => {
  it('é estável para a mesma entrada', () => {
    const params = { tituloBruto: 'Refil PA21G', url: 'https://a.com/1' };
    expect(calcularHashConteudo(params)).toBe(calcularHashConteudo(params));
  });

  it('o mesmo título em URLs diferentes são ocorrências diferentes', () => {
    // É exatamente isso que o grafo precisa saber: o mesmo produto em dois
    // vendedores são duas ocorrências, com dois preços.
    const a = calcularHashConteudo({ tituloBruto: 'Refil PA21G', url: 'https://a.com/1' });
    const b = calcularHashConteudo({ tituloBruto: 'Refil PA21G', url: 'https://b.com/1' });
    expect(a).not.toBe(b);
  });

  it('sem conteúdo bruto, usa o título normalizado', () => {
    const a = calcularHashConteudo({ tituloBruto: 'Refil  PA21G' });
    const b = calcularHashConteudo({ tituloBruto: 'REFIL PA21G' });
    expect(a).toBe(b);
  });

  it('com conteúdo bruto, o conteúdo manda', () => {
    const a = calcularHashConteudo({ tituloBruto: 'Refil', conteudoBruto: '<html>v1</html>' });
    const b = calcularHashConteudo({ tituloBruto: 'Refil', conteudoBruto: '<html>v2</html>' });
    expect(a).not.toBe(b);
  });

  it('devolve hex de sha256', () => {
    expect(calcularHashConteudo({ tituloBruto: 'x' })).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('schema de captura', () => {
  it('exige só título e fonte — o mínimo que serve ao grafo', () => {
    const r = esquemaProdutoExternoCapturado.safeParse({
      tituloBruto: 'Refil Filtro PA21G',
      fonte: 'm0_link',
    });
    expect(r.success).toBe(true);
    if (r.success) {
      // Uma ocorrência sem preço ainda alimenta o grafo de identidade.
      expect(r.data.precoReais).toBeNull();
      expect(r.data.moeda).toBe('BRL');
    }
  });

  it('recusa título curto demais para identificar produto', () => {
    expect(
      esquemaProdutoExternoCapturado.safeParse({ tituloBruto: 'ab', fonte: 'm0_link' }).success,
    ).toBe(false);
  });

  it('recusa fonte desconhecida', () => {
    expect(
      esquemaProdutoExternoCapturado.safeParse({ tituloBruto: 'Refil PA21G', fonte: 'chute' })
        .success,
    ).toBe(false);
  });

  it('recusa URL malformada', () => {
    expect(
      esquemaProdutoExternoCapturado.safeParse({
        tituloBruto: 'Refil PA21G',
        fonte: 'm0_link',
        url: 'não é url',
      }).success,
    ).toBe(false);
  });

  it('aceita atributo nulo, que é o que o extrator devolve quando não acha', () => {
    const r = esquemaProdutoExternoCapturado.safeParse({
      tituloBruto: 'Refil PA21G',
      fonte: 'm0_link',
      atributos: { marca: 'Electrolux', voltagem: null },
    });
    expect(r.success).toBe(true);
  });
});

describe.skipIf(!temBancoDeTeste())('IngestorDeProdutoExterno (contra Postgres real)', () => {
  let conexao: ConexaoDeTeste;
  let ingestor: IngestorDeProdutoExterno;

  const captura = (sobrepor: Record<string, unknown> = {}) => ({
    tituloBruto: 'Refil Filtro Purificador Electrolux PA21G PA26G Original',
    url: 'https://produto.mercadolivre.com.br/MLB-1234567890-refil',
    plataformaOuSite: 'ml',
    precoReais: 69.9,
    vendedor: 'Loja Exemplo',
    fonte: 'm0_link',
    ...sobrepor,
  });

  beforeEach(async () => {
    conexao ??= abrirBancoDeTeste();
    ingestor = new IngestorDeProdutoExterno(conexao.db);
    await limparTabelas(conexao.db, ['produto_externo', 'preco_historico']);
  });

  afterAll(async () => {
    if (conexao !== undefined) await conexao.encerrar();
  });

  it('grava uma captura válida', async () => {
    const r = await ingestor.gravar(captura());
    expect(r.tipo).toBe('gravado');
  });

  it('converte preço para centavos sem erro de ponto flutuante', async () => {
    const r = await ingestor.gravar(captura({ precoReais: 19.99 }));
    expect(r.tipo).toBe('gravado');
    if (r.tipo === 'gravado') {
      const existente = await ingestor.buscarPorHash(r.hashConteudo);
      expect(existente?.preco).toBe(1999);
    }
  });

  it('recapturar a mesma página não grava de novo — não paga extração duas vezes', async () => {
    const primeira = await ingestor.gravar(captura());
    const segunda = await ingestor.gravar(captura());

    expect(primeira.tipo).toBe('gravado');
    expect(segunda.tipo).toBe('duplicado');
    if (primeira.tipo === 'gravado' && segunda.tipo === 'duplicado') {
      expect(segunda.id).toBe(primeira.id);
      expect(segunda.precoAtualizado).toBe(false);
    }
  });

  it('recaptura com preço novo atualiza e acrescenta ao histórico', async () => {
    // A série histórica é o que alimenta o detector de queda real de preço e o de
    // aumento silencioso de fornecedor.
    const primeira = await ingestor.gravar(captura({ precoReais: 69.9 }));
    expect(primeira.tipo).toBe('gravado');
    if (primeira.tipo !== 'gravado') return;

    const segunda = await ingestor.gravar(captura({ precoReais: 59.9 }));
    expect(segunda.tipo).toBe('duplicado');
    if (segunda.tipo === 'duplicado') expect(segunda.precoAtualizado).toBe(true);

    const historico = await ingestor.historicoDePreco(primeira.id);
    expect(historico.map((h) => h.preco)).toEqual([6990, 5990]);
  });

  it('recaptura com preço novo avisa o monitor, e o evento diz de quem é', async () => {
    // É a única ligação entre a fase 3 e a fase 11: este é o único ponto do sistema
    // que sabe o preço anterior. Sem isto, a tela do monitor mostra sempre zero.
    const avisados: Evento[] = [];
    const comMonitor = new IngestorDeProdutoExterno(conexao.db, {
      // eslint-disable-next-line @typescript-eslint/require-await
      async registrar(evento) {
        avisados.push(evento);
      },
    });

    await comMonitor.gravar(captura({ precoReais: 69.9 }));
    await comMonitor.gravar(captura({ precoReais: 59.9 }));

    expect(avisados).toHaveLength(1);
    expect(avisados[0]?.tipo).toBe('preco_concorrente_caiu');
    expect(avisados[0]?.sobre).toBe('Loja Exemplo');
    expect(avisados[0]?.entidadeTipo).toBe('produto_externo');
  });

  it('oscilação abaixo do piso atualiza o preço e não avisa ninguém', async () => {
    // Um centavo de diferença é arredondamento, e monitor que avisa de tudo é
    // monitor desligado na segunda semana.
    const avisados: Evento[] = [];
    const comMonitor = new IngestorDeProdutoExterno(conexao.db, {
      // eslint-disable-next-line @typescript-eslint/require-await
      async registrar(evento) {
        avisados.push(evento);
      },
    });

    const primeira = await comMonitor.gravar(captura({ precoReais: 69.9 }));
    if (primeira.tipo !== 'gravado') throw new Error('esperava gravado');
    const segunda = await comMonitor.gravar(captura({ precoReais: 69.8 }));

    if (segunda.tipo === 'duplicado') expect(segunda.precoAtualizado).toBe(true);
    expect(await ingestor.historicoDePreco(primeira.id)).toHaveLength(2);
    expect(avisados).toEqual([]);
  });

  it('recaptura com o mesmo preço não infla o histórico', async () => {
    const primeira = await ingestor.gravar(captura({ precoReais: 69.9 }));
    if (primeira.tipo !== 'gravado') throw new Error('esperava gravado');

    await ingestor.gravar(captura({ precoReais: 69.9 }));
    await ingestor.gravar(captura({ precoReais: 69.9 }));

    expect(await ingestor.historicoDePreco(primeira.id)).toHaveLength(1);
  });

  it('o mesmo produto em dois vendedores são dois registros', async () => {
    const a = await ingestor.gravar(captura({ url: 'https://a.com/1', vendedor: 'A' }));
    const b = await ingestor.gravar(captura({ url: 'https://b.com/1', vendedor: 'B' }));

    expect(a.tipo).toBe('gravado');
    expect(b.tipo).toBe('gravado');
    if (a.tipo === 'gravado' && b.tipo === 'gravado') {
      expect(b.id).not.toBe(a.id);
    }
  });

  it('captura sem preço é gravada, e sem linha de histórico', async () => {
    const r = await ingestor.gravar(captura({ precoReais: null }));
    expect(r.tipo).toBe('gravado');
    if (r.tipo === 'gravado') {
      expect(await ingestor.historicoDePreco(r.id)).toHaveLength(0);
    }
  });

  describe('pendente_revisao em vez de descarte', () => {
    it('schema que falha preserva o bruto', async () => {
      // Descartar registro é o erro que a especificação proíbe: o registro ruim
      // é mais valioso que registro nenhum.
      const bruto = { tituloBruto: 'x', fonte: 'm0_link', lixo: true };
      const r = await ingestor.gravar(bruto);

      expect(r.tipo).toBe('pendente_revisao');
      if (r.tipo === 'pendente_revisao') {
        expect(r.bruto).toEqual(bruto);
        expect(r.problemas.length).toBeGreaterThan(0);
        expect(r.problemas[0]).toContain('tituloBruto');
      }
    });

    it('preço ilegível vira revisão, com o valor original preservado', async () => {
      const r = await ingestor.gravar(captura({ precoReais: 'R$ 69,90 à vista' }));
      expect(r.tipo).toBe('pendente_revisao');
      if (r.tipo === 'pendente_revisao') {
        expect(r.motivo).toContain('ilegível');
        expect(JSON.stringify(r.bruto)).toContain('à vista');
      }
    });

    it('entrada totalmente fora de forma não lança', async () => {
      for (const lixo of [null, undefined, 42, 'texto', [], {}]) {
        const r = await ingestor.gravar(lixo);
        expect(r.tipo).toBe('pendente_revisao');
      }
    });

    it('nada é gravado quando vai para revisão', async () => {
      await ingestor.gravar({ tituloBruto: 'x', fonte: 'm0_link' });
      const linhas = await conexao.db.execute('select count(*)::int as n from produto_externo');
      const n =
        (linhas as unknown as { rows?: { n: number }[] }).rows?.[0]?.n ??
        (linhas as unknown as { n: number }[])[0]?.n;
      expect(n).toBe(0);
    });
  });

  it('aceita preço em string com vírgula, como vem de página brasileira', async () => {
    const r = await ingestor.gravar(captura({ precoReais: '69,90' }));
    expect(r.tipo).toBe('gravado');
    if (r.tipo === 'gravado') {
      expect((await ingestor.buscarPorHash(r.hashConteudo))?.preco).toBe(6990);
    }
  });

  it('grava a procedência que o chamador declarou', async () => {
    for (const fonte of ['m0_link', 'm1_planilha', 'm2_publico', 'manual'] as const) {
      const r = await ingestor.gravar(captura({ url: `https://x.com/${fonte}`, fonte }));
      expect(r.tipo, fonte).toBe('gravado');
    }
  });

  it('capturas simultâneas da mesma página colapsam numa só', async () => {
    const resultados = await Promise.all(
      Array.from({ length: 8 }, () => ingestor.gravar(captura())),
    );
    const gravados = resultados.filter((r) => r.tipo === 'gravado');
    expect(gravados).toHaveLength(1);
    expect(resultados.filter((r) => r.tipo === 'duplicado')).toHaveLength(7);
  });
});
