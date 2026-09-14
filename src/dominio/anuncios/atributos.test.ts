import { describe, expect, it } from 'vitest';
import { montarFicha, type CompatibilidadeParaFicha } from '@/dominio/compatibilidade/ficha';
import { LIMIAR_PUBLICACAO_BP, TOTAL_BP } from '@/dominio/compatibilidade/resolucao';
import type { Evidencia } from '@/dominio/compatibilidade/evidencia';
import {
  ATRIBUTOS,
  EXIGENCIAS,
  PESO_DA_EXIGENCIA,
  avisosDaConferencia,
  conferirAtributos,
  tracosDoProduto,
  type ProdutoParaConferir,
} from './atributos';

const evidencia: Evidencia = {
  tipo: 'manual_fabricante',
  url: 'https://exemplo.invalid/manual',
  trecho: null,
  em: '2026-09-01T00:00:00.000Z',
  negativa: false,
  forcaBp: null,
};

const compat = (modelo: string, confiancaBp = TOTAL_BP): CompatibilidadeParaFicha => ({
  decisao: 'serve',
  confiancaBp,
  conflito: null,
  evidencias: [evidencia],
  aparelho: {
    tipo: 'purificador de agua',
    marca: 'Electrolux',
    modelo,
    variante: null,
    familia: 'electrolux:pa21',
  },
});

/** Cadastro completo: é a referência da qual cada teste tira uma coisa. */
const COMPLETO: ProdutoParaConferir = {
  tipoProduto: 'refil de purificador de água',
  marca: 'Electrolux',
  modeloPeca: 'EF-ELX-21',
  ean: '7896541200909',
  categoria: 'MLB1234',
  pesoGramas: 300,
  dimensoesMm: { comprimento: 200, largura: 90, altura: 90 },
  descricao: 'Refil compatível com PA21G.',
  voltagem: '110 V e 220 V',
  medida: null,
  quantidadeEmbalagem: 1,
  ficha: montarFicha([compat('PA21G')]),
};

const conferir = (campos: Partial<ProdutoParaConferir> = {}) =>
  conferirAtributos({ ...COMPLETO, ...campos });

describe('tracosDoProduto', () => {
  it('reposição vem da ficha, não de palavra no nome', () => {
    // Estrutura em vez de palpite: se há linha de compatibilidade, o produto serve
    // em outro produto, e é isso que peça de reposição quer dizer.
    expect(tracosDoProduto({ ...COMPLETO, tipoProduto: 'coisa' })).toContain('reposicao');
    expect(
      tracosDoProduto({ ...COMPLETO, tipoProduto: 'coisa', ficha: montarFicha([]) }),
    ).not.toContain('reposicao');
  });

  it('conta a linha retida também: peça de reposição é peça de reposição', () => {
    // A compatibilidade está abaixo do corte, então não publica — mas o produto não
    // deixa de ser peça por isso, e continua devendo voltagem e medida.
    const soRetida = montarFicha([compat('PA21G', LIMIAR_PUBLICACAO_BP - 1)]);
    expect(soRetida.publicaveis).toHaveLength(0);
    expect(tracosDoProduto({ ...COMPLETO, ficha: soRetida })).toContain('reposicao');
  });

  it('acumula traços em vez de escolher um', () => {
    // Um refil de purificador é consumível e elétrico ao mesmo tempo, e deve os
    // atributos dos dois. Classificar em família única perderia um.
    const tracos = tracosDoProduto(COMPLETO);
    expect(tracos).toContain('consumivel');
    expect(tracos).toContain('eletrico');
    expect(tracos).toContain('reposicao');
  });

  it('é indiferente a acento e caixa', () => {
    expect(tracosDoProduto({ ...COMPLETO, tipoProduto: 'VEDAÇÃO de porta' })).toContain(
      'medida_critica',
    );
  });

  it('devolve na ordem declarada, não na de descoberta', () => {
    const a = tracosDoProduto({ ...COMPLETO, tipoProduto: 'correia de purificador' });
    const b = tracosDoProduto({ ...COMPLETO, tipoProduto: 'purificador com correia' });
    expect(a).toEqual(b);
  });

  it('produto que não casa com palavra nenhuma não ganha exigência inventada', () => {
    const tracos = tracosDoProduto({ ...COMPLETO, tipoProduto: 'objeto', ficha: montarFicha([]) });
    expect(tracos).toEqual([]);
  });
});

describe('conferirAtributos', () => {
  it('cadastro completo preenche tudo que foi cobrado', () => {
    const c = conferir();
    expect(c.faltando).toEqual([]);
    expect(c.preenchimentoBp).toBe(10_000);
    expect(c.podeExportar).toBe(true);
  });

  it('separa o que bloqueia a exportação do que gera devolução', () => {
    // A ação é outra: um manda preencher antes de gerar o arquivo, o outro manda
    // preencher antes de alguém comprar.
    const c = conferir({ categoria: null, voltagem: null });
    expect(c.bloqueiam.map((i) => i.atributo)).toEqual(['categoria']);
    expect(c.devolvem.map((i) => i.atributo)).toEqual(['voltagem']);
    expect(c.podeExportar).toBe(false);
  });

  it('preenchimento não é nota de pronto: cai sem bloquear a exportação', () => {
    const c = conferir({ marca: null, descricao: null });
    expect(c.podeExportar).toBe(true);
    expect(c.preenchimentoBp).toBeLessThan(10_000);
  });

  it('preenchimento alto convive com bloqueio aberto, e por isso não decide nada', () => {
    // O caso que dá nome ao campo: 90% preenchido e o arquivo não sai.
    const c = conferir({ categoria: null });
    expect(c.preenchimentoBp).toBeGreaterThan(8000);
    expect(c.podeExportar).toBe(false);
  });

  it('trunca o preenchimento: item aberto nunca fecha em 100%', () => {
    const c = conferir({ modeloPeca: null });
    expect(c.faltando).toHaveLength(1);
    expect(c.preenchimentoBp).toBeLessThan(10_000);
  });

  it('só cobra voltagem de produto elétrico', () => {
    const semEletrico = conferir({
      tipoProduto: 'vedação de tampa',
      voltagem: null,
      medida: '30 cm',
    });
    expect(semEletrico.itens.map((i) => i.atributo)).not.toContain('voltagem');
    expect(semEletrico.faltando).toEqual([]);
  });

  it('cobra medida de peça em que a medida decide o encaixe', () => {
    const c = conferir({ tipoProduto: 'correia de secadora', medida: null });
    expect(c.devolvem.map((i) => i.atributo)).toContain('medida');
  });

  it('compatibilidade retida não conta como preenchida', () => {
    // Para o comprador, o que não está na vitrine não existe.
    const c = conferir({ ficha: montarFicha([compat('PA21G', LIMIAR_PUBLICACAO_BP - 1)]) });
    expect(c.faltando.map((i) => i.atributo)).toContain('compatibilidade');
  });

  it('produto que não é peça não deve compatibilidade', () => {
    const c = conferir({ tipoProduto: 'caixa de papelão', ficha: montarFicha([]) });
    expect(c.itens.map((i) => i.atributo)).not.toContain('compatibilidade');
  });

  it('ordena por gravidade, para a tela não precisar reordenar', () => {
    const c = conferir({ categoria: null, marca: null, voltagem: null, modeloPeca: null });
    const indices = c.itens.map((i) => EXIGENCIAS.indexOf(i.exigencia));
    expect(indices).toEqual([...indices].sort((a, b) => a - b));
  });

  it('campo em branco conta como ausente, não como preenchido', () => {
    // Cadastro real tem string vazia e espaço, e "  " preenchido seria mentira.
    expect(conferir({ marca: '   ' }).faltando.map((i) => i.atributo)).toContain('marca');
    expect(conferir({ ean: '' }).bloqueiam.map((i) => i.atributo)).toContain('ean');
  });

  it('zero e dimensão incompleta contam como ausentes', () => {
    expect(conferir({ pesoGramas: 0 }).faltando.map((i) => i.atributo)).toContain('peso');
    expect(conferir({ quantidadeEmbalagem: 0 }).faltando.map((i) => i.atributo)).toContain(
      'quantidade_embalagem',
    );
    expect(
      conferir({ dimensoesMm: { comprimento: 200, largura: 0, altura: 90 } }).faltando.map(
        (i) => i.atributo,
      ),
    ).toContain('dimensoes');
  });

  it('todo atributo cobrado tem um porquê que diz a consequência', () => {
    const c = conferir({
      ean: null,
      categoria: null,
      marca: null,
      pesoGramas: null,
      dimensoesMm: null,
      descricao: null,
      voltagem: null,
      modeloPeca: null,
      quantidadeEmbalagem: null,
      ficha: montarFicha([compat('PA21G', LIMIAR_PUBLICACAO_BP - 1)]),
    });
    for (const item of c.itens) {
      expect(item.porque.length).toBeGreaterThan(30);
    }
    expect(avisosDaConferencia(c)).toHaveLength(c.faltando.length);
  });

  it('o peso nunca cresce à medida que a exigência afrouxa', () => {
    // `EXIGENCIAS` está em ordem de gravidade e os pesos têm de acompanhar, senão
    // faltar algo leve derrubaria o preenchimento mais que faltar algo grave.
    // (`bloqueia` e `devolucao` empatam de propósito — ver o cabeçalho do módulo.)
    const pesos = EXIGENCIAS.map((e) => PESO_DA_EXIGENCIA[e]);
    expect(pesos).toEqual([...pesos].sort((a, b) => b - a));
  });

  it('nenhum atributo declarado fica sem poder ser conferido', () => {
    // Se alguém acrescentar um atributo em `ATRIBUTOS` e esquecer de cobrá-lo em
    // lugar nenhum, ele nunca aparece — e é bug silencioso.
    const cobrados = new Set(
      [
        conferir(),
        conferir({ tipoProduto: 'correia de secadora' }),
        conferir({ tipoProduto: 'refil de purificador' }),
      ].flatMap((c) => c.itens.map((i) => i.atributo)),
    );
    expect([...ATRIBUTOS].filter((a) => !cobrados.has(a))).toEqual([]);
  });
});
