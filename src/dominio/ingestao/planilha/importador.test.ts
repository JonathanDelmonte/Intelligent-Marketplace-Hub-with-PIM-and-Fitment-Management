import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { PLATAFORMAS } from '@/dominio/precificacao/tipos';
import {
  CAMPOS,
  CAMPOS_OBRIGATORIOS,
  camposObrigatoriosAusentes,
  mapearCabecalho,
  normalizarNomeDeColuna,
  quantidadeReconhecida,
} from './mapeamento';
import {
  ImportadorDePlanilha,
  MAX_LINHAS_ANTES_DO_CABECALHO,
  MIN_COLUNAS_PARA_CABECALHO,
  acharCabecalho,
  interpretarPreco,
} from './importador';
import { lerCsv } from './leitor';

// ─── Normalização de nome de coluna ──────────────────────────────────────────

describe('normalizarNomeDeColuna', () => {
  it('colapsa as variações que aparecem entre uma exportação e a seguinte', () => {
    const esperado = 'preco_unitario';
    for (const variacao of [
      'Preço Unitário',
      'PREÇO UNITÁRIO',
      'preco_unitario',
      'Preço  unitário ',
      'preço-unitário',
    ]) {
      expect(normalizarNomeDeColuna(variacao), variacao).toBe(esperado);
    }
  });

  it('trata pontuação e unidade entre parênteses', () => {
    expect(normalizarNomeDeColuna('Preço (R$)')).toBe('preco_r');
    expect(normalizarNomeDeColuna('Peso (g)')).toBe('peso_g');
  });

  it('não devolve sublinhado nas pontas', () => {
    expect(normalizarNomeDeColuna('  (Preço)  ')).toBe('preco');
  });

  it('devolve vazio para nome só de pontuação', () => {
    expect(normalizarNomeDeColuna('---')).toBe('');
  });
});

// ─── Mapeamento ──────────────────────────────────────────────────────────────

describe('mapearCabecalho', () => {
  it('mapeia um cabeçalho plausível do Mercado Livre', () => {
    const r = mapearCabecalho(
      ['Código MLB', 'Título', 'Preço (R$)', 'Estoque', 'Status', 'Link do anúncio'],
      'ml',
    );
    expect(r.mapeadas.map((m) => m.campo)).toEqual([
      'id_externo',
      'titulo',
      'preco',
      'quantidade',
      'status',
      'url',
    ]);
    expect(r.naoReconhecidas).toEqual([]);
  });

  it('mapeia um cabeçalho plausível da Amazon, em inglês', () => {
    const r = mapearCabecalho(
      ['seller_sku', 'item_name', 'standard_price', 'quantity', 'external_product_id'],
      'amazon',
    );
    expect(r.mapeadas.map((m) => m.campo)).toEqual([
      'sku_vendedor',
      'titulo',
      'preco',
      'quantidade',
      'ean',
    ]);
  });

  it('mapeia um cabeçalho plausível da Shopee', () => {
    const r = mapearCabecalho(
      ['item_id', 'Nome do produto', 'Preço original', 'Estoque total', 'SKU principal'],
      'shopee',
    );
    expect(r.mapeadas.map((m) => m.campo)).toContain('titulo');
    expect(r.mapeadas.map((m) => m.campo)).toContain('preco');
    expect(r.mapeadas.map((m) => m.campo)).toContain('sku_vendedor');
  });

  it('RELATA coluna não reconhecida em vez de descartar em silêncio', () => {
    // É a decisão central do módulo: o palpite errado de nome de coluna aparece
    // como aviso, não como dado faltando que ninguém percebe.
    const r = mapearCabecalho(['Título', 'Preço', 'Coluna Que Eu Não Previ'], 'ml');
    expect(r.naoReconhecidas.map((c) => c.nome)).toEqual(['Coluna Que Eu Não Previ']);
    expect(r.naoReconhecidas[0]?.indice).toBe(2);
  });

  it('coluna sem nome é ignorada sem virar "não reconhecida"', () => {
    // Exportação costuma ter coluna vazia à direita; não é dado perdido.
    const r = mapearCabecalho(['Título', '', '  ', 'Preço'], 'ml');
    expect(r.naoReconhecidas).toEqual([]);
    expect(r.mapeadas).toHaveLength(2);
  });

  it('campo duplicado: a primeira coluna vence e a segunda é relatada', () => {
    // A exportação do ML traz "Preço" e "Preço de venda" na mesma planilha.
    // Escolher em silêncio esconderia qual das duas alimentou a margem.
    const r = mapearCabecalho(['Título', 'Preço', 'Preço de venda (R$)'], 'ml');
    expect(r.duplicados).toContain('preco');
    expect(r.mapeadas.filter((m) => m.campo === 'preco')).toHaveLength(1);
    expect(r.mapeadas.find((m) => m.campo === 'preco')?.indice).toBe(1);
    expect(r.naoReconhecidas.map((c) => c.indice)).toContain(2);
  });

  it('o nome do campo sempre casa, para planilha gerada por este sistema', () => {
    const r = mapearCabecalho([...CAMPOS], 'ml');
    expect(r.mapeadas).toHaveLength(CAMPOS.length);
    expect(r.naoReconhecidas).toEqual([]);
  });

  it('sinônimo de plataforma tem precedência sobre o comum', () => {
    // Na Amazon `item_name` é o título; a lista comum não tem esse nome.
    expect(mapearCabecalho(['item_name'], 'amazon').mapeadas[0]?.campo).toBe('titulo');
    expect(mapearCabecalho(['item_name'], 'ml').naoReconhecidas).toHaveLength(1);
  });

  it('preserva o nome original, para o relatório ser legível', () => {
    const r = mapearCabecalho(['  Preço (R$)  '], 'ml');
    expect(r.mapeadas[0]?.nomeOriginal).toBe('Preço (R$)');
  });

  it('funciona para as três plataformas sem lançar', () => {
    for (const plataforma of PLATAFORMAS) {
      expect(() => mapearCabecalho(['Título', 'Preço'], plataforma), plataforma).not.toThrow();
    }
  });
});

describe('campos obrigatórios', () => {
  it('só o título é indispensável', () => {
    expect(CAMPOS_OBRIGATORIOS).toEqual(['titulo']);
  });

  it('planilha sem preço passa — rascunho não tem preço', () => {
    const r = mapearCabecalho(['Título', 'Estoque'], 'ml');
    expect(camposObrigatoriosAusentes(r)).toEqual([]);
  });

  it('planilha sem título não passa', () => {
    const r = mapearCabecalho(['Preço', 'Estoque'], 'ml');
    expect(camposObrigatoriosAusentes(r)).toEqual(['titulo']);
  });
});

describe('quantidadeReconhecida', () => {
  it('conta as colunas mapeáveis', () => {
    expect(quantidadeReconhecida(['Título', 'Preço', 'lixo'], 'ml')).toBe(2);
    expect(quantidadeReconhecida(['lixo', 'mais lixo'], 'ml')).toBe(0);
  });
});

// ─── Interpretação de preço ──────────────────────────────────────────────────

describe('interpretarPreco', () => {
  it('lê formato brasileiro, com e sem milhar', () => {
    expect(interpretarPreco('69,90')).toEqual({ tipo: 'valor', valor: '69.90' });
    expect(interpretarPreco('1.234,56')).toEqual({ tipo: 'valor', valor: '1234.56' });
    expect(interpretarPreco('R$ 69,90')).toEqual({ tipo: 'valor', valor: '69.90' });
    expect(interpretarPreco('R$1.987,90')).toEqual({ tipo: 'valor', valor: '1987.90' });
  });

  it('lê formato americano', () => {
    expect(interpretarPreco('69.90')).toEqual({ tipo: 'valor', valor: '69.90' });
    expect(interpretarPreco('1,234.56')).toEqual({ tipo: 'valor', valor: '1234.56' });
  });

  it('lê número cru vindo de célula numérica do XLSX', () => {
    expect(interpretarPreco('69.9')).toEqual({ tipo: 'valor', valor: '69.9' });
    expect(interpretarPreco('1234')).toEqual({ tipo: 'valor', valor: '1234' });
  });

  it('desfaz a ambiguidade de separador único pelo tamanho do grupo', () => {
    // `1,50` é um e cinquenta; `1,500` é mil e quinhentos.
    expect(interpretarPreco('1,50')).toEqual({ tipo: 'valor', valor: '1.50' });
    expect(interpretarPreco('1,500')).toEqual({ tipo: 'valor', valor: '1500' });
    expect(interpretarPreco('1.50')).toEqual({ tipo: 'valor', valor: '1.50' });
    expect(interpretarPreco('1.500')).toEqual({ tipo: 'valor', valor: '1500' });
  });

  it('trata espaço normal e espaço inquebrável', () => {
    // Escape, não byte literal: o Excel escreve espaço inquebrável junto do símbolo.
    expect(interpretarPreco('R$\u00A01.234,56')).toEqual({ tipo: 'valor', valor: '1234.56' });
    expect(interpretarPreco(' 69,90 ')).toEqual({ tipo: 'valor', valor: '69.90' });
  });

  it('célula vazia é AUSENTE, não erro — rascunho não tem preço', () => {
    expect(interpretarPreco('')).toEqual({ tipo: 'ausente', valor: null });
    expect(interpretarPreco('   ')).toEqual({ tipo: 'ausente', valor: null });
    expect(interpretarPreco('-')).toEqual({ tipo: 'ausente', valor: null });
    expect(interpretarPreco(undefined)).toEqual({ tipo: 'ausente', valor: null });
  });

  it('marca como ilegível o que não é valor monetário', () => {
    for (const ruim of ['a combinar', '69,90 à vista', '1.2.3', '12,34,56', '69,9a']) {
      expect(interpretarPreco(ruim).tipo, ruim).toBe('ilegivel');
    }
  });

  it('célula só com o símbolo da moeda é ausente, não ilegível', () => {
    // Planilha desleixada às vezes põe o "R$" numa coluna e o número na
    // seguinte. Tratar como ausente importa a linha com preço nulo, e a coluna
    // vizinha aparece no relatório de não reconhecidas — que é onde o número
    // está. Tratar como ilegível rejeitaria a linha inteira sem necessidade.
    expect(interpretarPreco('R$')).toEqual({ tipo: 'ausente', valor: null });
    expect(interpretarPreco('R$ ')).toEqual({ tipo: 'ausente', valor: null });
  });

  it('três dígitos após o separador são milhar, não decimal', () => {
    // Não é tolerância: é a regra. Preço tem duas casas decimais, então um grupo
    // de três dígitos só pode ser milhar. `12,345` é doze mil trezentos e
    // quarenta e cinco, e tratar como 12,34 erraria por mil vezes.
    expect(interpretarPreco('12,345')).toEqual({ tipo: 'valor', valor: '12345' });
    expect(interpretarPreco('12.345')).toEqual({ tipo: 'valor', valor: '12345' });
  });

  it('aceita negativo, que aparece em linha de estorno', () => {
    expect(interpretarPreco('-12,34')).toEqual({ tipo: 'valor', valor: '-12.34' });
  });
});

describe('GTIN da linha', () => {
  const importar = async (linhas: readonly string[]) =>
    new ImportadorDePlanilha().importar({
      conteudo: { formato: 'csv', texto: linhas.join(String.fromCharCode(10)) },
      plataforma: 'ml',
    });

  it('grava o GTIN válido como campo de primeira classe, na forma de 13 dígitos', async () => {
    const r = await importar([
      'Codigo MLB;Titulo;Preco (R$);EAN',
      'MLB1;Refil bom;69,90;789-6541-20012-1',
    ]);
    if (r.tipo !== 'importado') {
      expect(r.tipo).toBe('importado');
      return;
    }

    const captura = r.linhas[0]!.captura;
    expect(captura.ean).toBe('7896541200121');
    const atributos = captura.atributos as Record<string, unknown>;
    expect(atributos['gtinTipo']).toBe('gtin13');
  });

  it('entrega o UPC-A validado como veio; quem canonicaliza é o ingestor', async () => {
    const r = await importar([
      'Codigo MLB;Titulo;Preco (R$);EAN',
      'MLB1;Refil importado;69,90;036000291452',
    ]);
    if (r.tipo !== 'importado') return;

    // A fronteira é deliberada: o importador valida, o ingestor canonicaliza —
    // porque o ingestor é a porta única de toda captura, inclusive de extrator
    // futuro que nunca passe por planilha. Duplicar a canonicalização aqui
    // criaria dois lugares para ela divergir.
    expect(r.linhas[0]!.captura.ean).toBe('036000291452');
  });

  it('GTIN com dígito verificador errado NÃO vira chave, e não é descartado', async () => {
    const r = await importar([
      'Codigo MLB;Titulo;Preco (R$);EAN',
      'MLB1;Refil com ean torto;69,90;7896541200123',
    ]);
    if (r.tipo !== 'importado') {
      expect(r.tipo).toBe('importado');
      return;
    }

    const captura = r.linhas[0]!.captura;
    // A linha continua sendo um produto: EAN errado não invalida o anúncio.
    expect(captura.tituloBruto).toBe('Refil com ean torto');
    expect(captura.ean ?? null).toBeNull();
    // Mas o valor recusado fica visível, para dar para consertar a planilha.
    const atributos = captura.atributos as Record<string, unknown>;
    expect(atributos['eanInvalido']).toBe('7896541200123');
    expect(atributos['ean']).toBeUndefined();
  });

  it('caixa (GTIN-14 com indicador 1) não vira chave de unidade', async () => {
    const r = await importar([
      'Codigo MLB;Titulo;Preco (R$);EAN',
      'MLB1;Caixa com doze refis;699,00;17896541200128',
    ]);
    if (r.tipo !== 'importado') return;

    const captura = r.linhas[0]!.captura;
    // `ean13` é nulo para agrupamento, então o que vai para a coluna são os 14
    // dígitos: a caixa é um item comercial, só não é a unidade.
    expect(captura.ean).toBe('17896541200128');
  });

  it('coluna de EAN vazia não inventa campo nenhum', async () => {
    const r = await importar(['Codigo MLB;Titulo;Preco (R$);EAN', 'MLB1;Refil sem ean;69,90;']);
    if (r.tipo !== 'importado') return;

    const captura = r.linhas[0]!.captura;
    expect(captura.ean ?? null).toBeNull();
    const atributos = captura.atributos as Record<string, unknown>;
    expect(atributos['eanInvalido']).toBeUndefined();
  });
});

// ─── Busca de cabeçalho ──────────────────────────────────────────────────────

describe('acharCabecalho', () => {
  it('acha na primeira linha, no caso simples', () => {
    const grade = lerCsv('Título;Preço\nRefil;69,90');
    expect(acharCabecalho(grade, 'ml')?.indice).toBe(0);
  });

  it('acha depois de linha de título e aviso', () => {
    // O caso real: exportação de painel não começa no cabeçalho.
    const grade = lerCsv(
      [
        'Relatório de anúncios - gerado em 12/09/2026',
        'Este arquivo é válido por 7 dias',
        'Código MLB;Título;Preço (R$);Estoque',
        'MLB123;Refil PA21G;69,90;10',
      ].join('\n'),
    );
    const achado = acharCabecalho(grade, 'ml');
    expect(achado?.indice).toBe(2);
    expect(achado?.mapeamento.mapeadas).toHaveLength(4);
  });

  it('escolhe a MELHOR linha, não a primeira que passa', () => {
    // Uma linha de aviso pode casar duas colunas por coincidência; a linha
    // seguinte casa cinco. Escolher a primeira importaria com duas colunas.
    const grade = lerCsv(
      ['Status;Data', 'Código MLB;Título;Preço;Estoque;Link', 'MLB1;Refil;69,90;10;http://x'].join(
        '\n',
      ),
    );
    expect(acharCabecalho(grade, 'ml')?.indice).toBe(1);
  });

  it('devolve null quando nenhuma linha parece cabeçalho', () => {
    const grade = lerCsv('foo;bar\nbaz;qux');
    expect(acharCabecalho(grade, 'ml')).toBeNull();
  });

  it('exige o mínimo de colunas reconhecidas', () => {
    expect(MIN_COLUNAS_PARA_CABECALHO).toBeGreaterThanOrEqual(2);
    const grade = lerCsv('Título;lixo\nRefil;x');
    expect(acharCabecalho(grade, 'ml')).toBeNull();
  });

  it('não procura além do limite de linhas do topo', () => {
    const lixo = Array.from({ length: MAX_LINHAS_ANTES_DO_CABECALHO + 2 }, () => 'aviso;aviso');
    const grade = lerCsv([...lixo, 'Título;Preço;Estoque'].join('\n'));
    expect(acharCabecalho(grade, 'ml')).toBeNull();
  });

  it('grade vazia devolve null', () => {
    expect(acharCabecalho([], 'ml')).toBeNull();
  });
});

// ─── Importador ──────────────────────────────────────────────────────────────

const importador = new ImportadorDePlanilha();

const csv = (texto: string) => ({ formato: 'csv' as const, texto });

describe('ImportadorDePlanilha', () => {
  it('importa uma exportação plausível do Mercado Livre', async () => {
    const r = await importador.importar({
      conteudo: csv(
        [
          'Código MLB;Título;Preço (R$);Estoque;Link do anúncio',
          'MLB1234567890;Refil Filtro Purificador Electrolux PA21G;69,90;10;https://produto.mercadolivre.com.br/MLB-1234567890-refil',
          'MLB9876543210;Refil Filtro Purificador Electrolux PA26G;74,90;5;https://produto.mercadolivre.com.br/MLB-9876543210-refil',
        ].join('\n'),
      ),
      plataforma: 'ml',
    });

    expect(r.tipo).toBe('importado');
    if (r.tipo !== 'importado') return;

    expect(r.linhas).toHaveLength(2);
    expect(r.rejeitadas).toHaveLength(0);
    expect(r.linhaDoCabecalho).toBe(1);
    expect(r.colunasNaoReconhecidas).toEqual([]);

    const primeira = r.linhas[0]!;
    expect(primeira.numeroDaLinha).toBe(2);
    expect(primeira.captura.tituloBruto).toContain('PA21G');
    expect(primeira.captura.precoReais).toBe('69.90');
    expect(primeira.captura.plataformaOuSite).toBe('ml');
    expect(primeira.captura.fonte).toBe('m1_planilha');
  });

  it('guarda id externo, EAN e SKU do vendedor nos atributos', async () => {
    const r = await importador.importar({
      conteudo: csv(
        [
          'Código MLB;Título;Preço;EAN;SKU',
          'MLB1;Refil Filtro PA21G;69,90;789-6541-20012-1;EF-ELX-21',
        ].join('\n'),
      ),
      plataforma: 'ml',
    });

    expect(r.tipo).toBe('importado');
    if (r.tipo !== 'importado') return;

    const captura = r.linhas[0]!.captura;
    const atributos = captura.atributos as Record<string, unknown>;
    expect(atributos['idExterno']).toBe('MLB1');
    expect(atributos['skuVendedor']).toBe('EF-ELX-21');
    // O GTIN fica nos dois lugares e com propósitos diferentes: em `atributos`
    // como veio (para auditoria), e no campo de primeira classe na forma
    // canônica (para ser chave de consulta do leitor de código de barras).
    expect(atributos['ean']).toBe('7896541200121');
    expect(captura.ean).toBe('7896541200121');
  });

  it('linhas com o mesmo título mas ids diferentes são capturas diferentes', async () => {
    // Sem o id no conteúdo do hash, a segunda seria tratada como recaptura da
    // primeira e desapareceria.
    const r = await importador.importar({
      conteudo: csv(
        [
          'Código MLB;Título;Preço',
          'MLB1;Refil Filtro PA21G;69,90',
          'MLB2;Refil Filtro PA21G;71,90',
        ].join('\n'),
      ),
      plataforma: 'ml',
    });

    expect(r.tipo).toBe('importado');
    if (r.tipo !== 'importado') return;
    expect(r.linhas[0]?.captura.conteudoBruto).not.toBe(r.linhas[1]?.captura.conteudoBruto);
  });

  it('relata coluna não reconhecida, para o mapeamento poder ser corrigido', async () => {
    const r = await importador.importar({
      conteudo: csv('Título;Preço;Campo Exótico Da Plataforma\nRefil Filtro;69,90;x'),
      plataforma: 'ml',
    });

    expect(r.tipo).toBe('importado');
    if (r.tipo !== 'importado') return;
    expect(r.colunasNaoReconhecidas).toEqual(['Campo Exótico Da Plataforma']);
  });

  it('rejeita linha sem título, e preserva o bruto', async () => {
    const r = await importador.importar({
      conteudo: csv(['Título;Preço', 'Refil Filtro PA21G;69,90', ';74,90'].join('\n')),
      plataforma: 'ml',
    });

    expect(r.tipo).toBe('importado');
    if (r.tipo !== 'importado') return;

    expect(r.linhas).toHaveLength(1);
    expect(r.rejeitadas).toHaveLength(1);
    expect(r.rejeitadas[0]?.numeroDaLinha).toBe(3);
    expect(r.rejeitadas[0]?.bruto['preco']).toBe('74,90');
  });

  it('rejeita linha de preço ilegível sem derrubar a importação inteira', async () => {
    const r = await importador.importar({
      conteudo: csv(
        ['Título;Preço', 'Refil Filtro PA21G;69,90', 'Refil Filtro PA26G;a combinar'].join('\n'),
      ),
      plataforma: 'ml',
    });

    expect(r.tipo).toBe('importado');
    if (r.tipo !== 'importado') return;
    expect(r.linhas).toHaveLength(1);
    expect(r.rejeitadas[0]?.motivo).toContain('ilegível');
  });

  it('linha sem preço é importada com preço nulo', async () => {
    const r = await importador.importar({
      conteudo: csv('Título;Preço\nRefil Filtro PA21G;'),
      plataforma: 'ml',
    });

    expect(r.tipo).toBe('importado');
    if (r.tipo !== 'importado') return;
    expect(r.linhas).toHaveLength(1);
    expect(r.linhas[0]?.captura.precoReais).toBeNull();
  });

  it('planilha vazia vira pendente_revisao', async () => {
    const r = await importador.importar({ conteudo: csv(''), plataforma: 'ml' });
    expect(r.tipo).toBe('pendente_revisao');
    if (r.tipo === 'pendente_revisao') expect(r.motivo).toContain('vazia');
  });

  it('cabeçalho irreconhecível vira pendente_revisao com amostra anexada', async () => {
    // Descartar seria o erro; a pessoa precisa ver o que chegou.
    const r = await importador.importar({
      conteudo: csv('foo;bar;baz\n1;2;3\n4;5;6'),
      plataforma: 'ml',
    });

    expect(r.tipo).toBe('pendente_revisao');
    if (r.tipo !== 'pendente_revisao') return;
    expect(r.motivo).toContain('cabeçalho');
    expect(r.amostra.length).toBeGreaterThan(0);
    expect(r.amostra[0]).toEqual(['foo', 'bar', 'baz']);
  });

  it('cabeçalho sem título vira pendente_revisao dizendo o que falta', async () => {
    const r = await importador.importar({
      conteudo: csv('Preço;Estoque;Status\n69,90;10;ativo'),
      plataforma: 'ml',
    });

    expect(r.tipo).toBe('pendente_revisao');
    if (r.tipo === 'pendente_revisao') expect(r.motivo).toContain('titulo');
  });

  it('acha o cabeçalho depois de lixo no topo e numera as linhas certo', async () => {
    const r = await importador.importar({
      conteudo: csv(
        [
          'Relatório de anúncios',
          'Gerado em 12/09/2026',
          '',
          'Código MLB;Título;Preço',
          'MLB1;Refil Filtro PA21G;69,90',
        ].join('\n'),
      ),
      plataforma: 'ml',
    });

    expect(r.tipo).toBe('importado');
    if (r.tipo !== 'importado') return;

    // A linha em branco é descartada pelo leitor, então o cabeçalho fica na 3.
    expect(r.linhaDoCabecalho).toBe(3);
    expect(r.linhas[0]?.numeroDaLinha).toBe(4);
  });

  it('importa TSV da Amazon, com nomes em inglês', async () => {
    const r = await importador.importar({
      conteudo: csv(
        [
          'seller_sku\titem_name\tstandard_price\tquantity',
          'EF-ELX-21\tRefil Filtro Purificador PA21G\t69.90\t10',
        ].join('\n'),
      ),
      plataforma: 'amazon',
    });

    expect(r.tipo).toBe('importado');
    if (r.tipo !== 'importado') return;
    expect(r.linhas[0]?.captura.precoReais).toBe('69.90');
    expect(r.linhas[0]?.captura.plataformaOuSite).toBe('amazon');
  });

  it('importa XLSX de verdade', async () => {
    const pasta = new ExcelJS.Workbook();
    const aba = pasta.addWorksheet('Anúncios');
    aba.addRow(['Código MLB', 'Título', 'Preço (R$)', 'Estoque']);
    aba.addRow(['MLB1', 'Refil Filtro Purificador PA21G', 69.9, 10]);
    aba.addRow(['MLB2', 'Refil Filtro Purificador PA26G', 74.9, 5]);
    const bytes = new Uint8Array(await pasta.xlsx.writeBuffer());

    const r = await importador.importar({
      conteudo: { formato: 'xlsx', bytes },
      plataforma: 'ml',
    });

    expect(r.tipo).toBe('importado');
    if (r.tipo !== 'importado') return;
    expect(r.linhas).toHaveLength(2);
    expect(r.linhas[0]?.captura.precoReais).toBe('69.9');
  });

  it('respeita a procedência declarada', async () => {
    const r = await importador.importar({
      conteudo: csv('Título;Preço\nRefil Filtro;69,90'),
      plataforma: 'ml',
      fonte: 'manual',
    });

    expect(r.tipo).toBe('importado');
    if (r.tipo === 'importado') expect(r.linhas[0]?.captura.fonte).toBe('manual');
  });

  it('usa a data de coleta informada, para importação reproduzível', async () => {
    const em = new Date('2026-09-01T12:00:00Z');
    const r = await importador.importar({
      conteudo: csv('Título;Preço\nRefil Filtro;69,90'),
      plataforma: 'ml',
      coletadoEm: em,
    });

    expect(r.tipo).toBe('importado');
    if (r.tipo === 'importado') expect(r.linhas[0]?.captura.coletadoEm).toEqual(em);
  });

  it('não lança para conteúdo estranho — vira pendente_revisao', async () => {
    for (const texto of ['\n\n\n', ';;;', 'uma linha só']) {
      const r = await importador.importar({ conteudo: csv(texto), plataforma: 'ml' });
      expect(r.tipo, JSON.stringify(texto)).toBe('pendente_revisao');
    }
  });

  it('importa planilha grande sem perder linha', async () => {
    const linhas = Array.from(
      { length: 500 },
      (_, i) => `MLB${String(i)};Refil Filtro modelo ${String(i)};${String(50 + i)},90`,
    );
    const r = await importador.importar({
      conteudo: csv(['Código MLB;Título;Preço', ...linhas].join('\n')),
      plataforma: 'ml',
    });

    expect(r.tipo).toBe('importado');
    if (r.tipo !== 'importado') return;
    expect(r.linhas).toHaveLength(500);
    expect(r.rejeitadas).toHaveLength(0);
  });
});

describe('a linha recusada guarda a linha original do arquivo', () => {
  const CSV = [
    'Codigo MLB;Titulo;Preco (R$);Estoque;Campo Que Eu Nao Previ',
    'MLB111111111;Refil bom;69,90;10;guardar isto',
    'MLB222222222;Refil ruim;1.2.3;7;e isto tambem',
  ].join(String.fromCharCode(10));

  it('traz o nome de coluna do arquivo, na ordem, inclusive a não reconhecida', async () => {
    const r = await new ImportadorDePlanilha().importar({
      conteudo: { formato: 'csv', texto: CSV },
      plataforma: 'ml',
    });
    expect(r.tipo).toBe('importado');
    if (r.tipo !== 'importado') return;

    expect(r.rejeitadas).toHaveLength(1);
    const recusada = r.rejeitadas[0]!;

    expect(recusada.numeroDaLinha).toBe(3);
    expect(recusada.original.map((c) => c.coluna)).toEqual([
      'Codigo MLB',
      'Titulo',
      'Preco (R$)',
      'Estoque',
      'Campo Que Eu Nao Previ',
    ]);
    // O valor da coluna que o mapeamento NÃO reconheceu é justamente o que
    // `bruto` perdia, e é o que permite corrigir à mão sem reimportar.
    expect(recusada.original.at(-1)).toEqual({
      coluna: 'Campo Que Eu Nao Previ',
      valor: 'e isto tambem',
    });
    expect(Object.keys(recusada.bruto)).not.toContain('Campo Que Eu Nao Previ');
  });

  it('coluna sem nome ganha rótulo pela posição, e célula de sobra é descartada', async () => {
    const texto = ['Titulo;;Preco (R$);', 'Refil ruim;valor solto;1.2.3;'].join(
      String.fromCharCode(10),
    );
    const r = await new ImportadorDePlanilha().importar({
      conteudo: { formato: 'csv', texto },
      plataforma: 'ml',
    });
    if (r.tipo !== 'importado') {
      expect(r.tipo).toBe('importado');
      return;
    }

    const recusada = r.rejeitadas[0]!;
    expect(recusada.original).toEqual([
      { coluna: 'Titulo', valor: 'Refil ruim' },
      { coluna: 'coluna 2', valor: 'valor solto' },
      { coluna: 'Preco (R$)', valor: '1.2.3' },
    ]);
  });
});
