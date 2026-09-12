/**
 * Testes de arquitetura do schema.
 *
 * Estes testes não verificam comportamento: verificam que as decisões dos ADRs
 * continuam valendo depois de cada alteração no schema. São eles que impedem que
 * uma tabela nova entre do lado errado da fronteira de `perfil_id` — o tipo de
 * erro que não quebra nada hoje e custa uma migração dolorosa em um ano.
 */
import { describe, expect, it } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';
import type { PgTable } from 'drizzle-orm/pg-core';
import * as schema from './index';

/**
 * Tabelas **operacionais**: são de um vendedor, e toda leitura filtra por perfil.
 * Ver ADR 0003.
 */
const OPERACIONAIS = [
  'credencial',
  'sku',
  'anuncio',
  'pedido',
  'consignacao',
  'acumulado_anual',
  // Leitura de código de barras é operacional: é o que ESTE vendedor avaliou no
  // balcão, com o que ele decidiu. Não é conhecimento do mundo — o preço
  // praticado que embasou o veredito é, e mora em `produto_externo`.
  'leitura',
] as const;

/**
 * Tabelas de **conhecimento do mundo**: base compartilhada entre perfis. É o que
 * faz o sistema ficar mais valioso a cada perfil que entra, e é o que permite
 * vender o sistema depois.
 */
const CONHECIMENTO = [
  'produto_externo',
  'preco_historico',
  'fornecedor',
  'fornecedor_sku',
  'fornecedor_preco_historico',
  'aparelho',
  'compatibilidade',
  'oportunidade',
  'dossie',
  'afiliado_oferta',
  'monitor_evento',
] as const;

/** Infraestrutura: nem operacional nem conhecimento. */
const INFRAESTRUTURA = ['job', 'llm_call', 'embedding', 'exemplo_identidade'] as const;

/** A raiz do multi-perfil. Não carrega `perfil_id` porque *é* o perfil. */
const RAIZ = ['perfil_vendedor'] as const;

function tabelas(): Map<string, PgTable> {
  const encontradas = new Map<string, PgTable>();
  for (const valor of Object.values(schema)) {
    // Um objeto de tabela do Drizzle responde a `getTableConfig`; enum, helper e
    // constante não. Testar assim evita manter uma lista à mão.
    try {
      const config = getTableConfig(valor as PgTable);
      encontradas.set(config.name, valor as PgTable);
    } catch {
      continue;
    }
  }
  return encontradas;
}

function colunas(tabela: PgTable): Set<string> {
  return new Set(getTableConfig(tabela).columns.map((c) => c.name));
}

describe('fronteira do multi-perfil (ADR 0003)', () => {
  const todas = tabelas();

  it('toda tabela está classificada em exatamente um grupo', () => {
    const classificadas = [...OPERACIONAIS, ...CONHECIMENTO, ...INFRAESTRUTURA, ...RAIZ];
    expect(new Set(classificadas).size).toBe(classificadas.length);
    expect([...todas.keys()].sort()).toEqual([...classificadas].sort());
  });

  it('toda tabela operacional carrega perfil_id', () => {
    for (const nome of OPERACIONAIS) {
      const tabela = todas.get(nome);
      expect(tabela, `tabela ${nome} não existe no schema`).toBeDefined();
      expect(colunas(tabela!).has('perfil_id'), `${nome} precisa de perfil_id`).toBe(true);
    }
  });

  it('nenhuma tabela de conhecimento carrega perfil_id', () => {
    // Se uma delas carregasse, o grafo de identidade e o de compatibilidade
    // deixariam de ser compartilhados — e é exatamente esse compartilhamento que
    // faz o sistema valer mais a cada perfil.
    for (const nome of CONHECIMENTO) {
      const tabela = todas.get(nome);
      expect(tabela, `tabela ${nome} não existe no schema`).toBeDefined();
      expect(colunas(tabela!).has('perfil_id'), `${nome} não deve ter perfil_id`).toBe(false);
    }
  });

  it('nenhuma tabela de infraestrutura carrega perfil_id', () => {
    for (const nome of INFRAESTRUTURA) {
      expect(colunas(todas.get(nome)!).has('perfil_id'), nome).toBe(false);
    }
  });

  it('toda coluna perfil_id referencia perfil_vendedor com cascade', () => {
    for (const nome of OPERACIONAIS) {
      const config = getTableConfig(todas.get(nome)!);
      const fk = config.foreignKeys.find((f) =>
        f.reference().columns.some((c) => c.name === 'perfil_id'),
      );
      expect(fk, `${nome} precisa de FK em perfil_id`).toBeDefined();
      expect(fk!.reference().foreignTable, nome).toBeDefined();
      expect(fk!.onDelete, `${nome} deve cascatear`).toBe('cascade');
    }
  });
});

describe('dinheiro em centavos inteiros (ADR 0004)', () => {
  const todas = tabelas();

  /** Colunas que guardam dinheiro, por nome. */
  const PADRAO_MONETARIO =
    /^(preco|preco_anterior|preco_bruto|custo_atual|custo_na_venda|custo_centavos|margem_realizada|repasse_liquido|taxa_comissao|taxa_fixa|frete_pago|teto_anual|das_mensal|ticket_medio|pedido_minimo_reais|preco_acordado_repasse|receita_bruta|receita_externa|orcamento_centavos|gasto_centavos|mediana_noventa_dias)$/;

  it('nenhuma coluna monetária é numeric, real ou double precision', () => {
    for (const [nome, tabela] of todas) {
      for (const coluna of getTableConfig(tabela).columns) {
        if (!PADRAO_MONETARIO.test(coluna.name)) continue;
        expect(
          coluna.getSQLType(),
          `${nome}.${coluna.name} guarda dinheiro e precisa ser inteiro`,
        ).toBe('bigint');
      }
    }
  });

  it('toda coluna terminada em _bp é inteira, porque ponto-base é inteiro', () => {
    for (const [nome, tabela] of todas) {
      for (const coluna of getTableConfig(tabela).columns) {
        if (!coluna.name.endsWith('_bp')) continue;
        expect(coluna.getSQLType(), `${nome}.${coluna.name}`).toMatch(/^(integer|bigint)$/);
      }
    }
  });
});

describe('procedência de dado do mundo (ADR 0002)', () => {
  const todas = tabelas();

  /**
   * Tabelas que guardam afirmação vinda de fora e por isso precisam declarar de
   * onde veio. `compatibilidade` é a exceção deliberada: ela guarda procedência
   * por *afirmação*, dentro de `evidencias`, porque uma mesma compatibilidade é
   * sustentada por várias fontes de forças diferentes — uma coluna `fonte` única
   * perderia justamente isso.
   */
  const EXIGEM_PROCEDENCIA = [
    'produto_externo',
    'preco_historico',
    'fornecedor',
    'fornecedor_sku',
    'fornecedor_preco_historico',
    'aparelho',
    'afiliado_oferta',
  ] as const;

  it('toda tabela de dado externo declara fonte e coletado_em', () => {
    for (const nome of EXIGEM_PROCEDENCIA) {
      const cols = colunas(todas.get(nome)!);
      expect(cols.has('fonte'), `${nome} precisa de fonte`).toBe(true);
      expect(cols.has('coletado_em'), `${nome} precisa de coletado_em`).toBe(true);
    }
  });

  it('compatibilidade guarda procedência por afirmação, em evidencias', () => {
    const cols = colunas(todas.get('compatibilidade')!);
    expect(cols.has('evidencias')).toBe(true);
    // Uma coluna `fonte` única aqui seria um erro de modelagem, não um esquecimento.
    expect(cols.has('fonte')).toBe(false);
  });

  it('anúncio e pedido registram como o dado entrou', () => {
    for (const nome of ['anuncio', 'pedido'] as const) {
      expect(colunas(todas.get(nome)!).has('fonte'), nome).toBe(true);
    }
  });
});

describe('disciplina de custo de LLM (ADR 0005)', () => {
  const todas = tabelas();

  it('llm_call registra entrada, saída, custo, modelo e latência', () => {
    const cols = colunas(todas.get('llm_call')!);
    for (const esperada of [
      'proposito',
      'modelo',
      'hash_entrada',
      'entrada',
      'saida',
      'custo_centavos',
      'latencia_ms',
    ]) {
      expect(cols.has(esperada), `llm_call.${esperada}`).toBe(true);
    }
  });

  it('llm_call tem chave única de cache, para a mesma entrada não pagar duas vezes', () => {
    const config = getTableConfig(todas.get('llm_call')!);
    const unica = config.uniqueConstraints.find((u) => u.name === 'unq_llm_call_cache');
    expect(unica).toBeDefined();
    expect(unica!.columns.map((c) => c.name).sort()).toEqual(
      ['hash_entrada', 'modelo', 'proposito'].sort(),
    );
  });

  it('produto_externo tem hash_conteudo único, que é a chave de cache de M3', () => {
    const config = getTableConfig(todas.get('produto_externo')!);
    expect(config.uniqueConstraints.some((u) => u.name === 'unq_produto_externo_hash')).toBe(true);
  });

  it('dossie exige orçamento — agente sem teto de gasto não roda', () => {
    const config = getTableConfig(todas.get('dossie')!);
    for (const nome of ['orcamento_centavos', 'orcamento_passos']) {
      const coluna = config.columns.find((c) => c.name === nome);
      expect(coluna, `dossie.${nome}`).toBeDefined();
      expect(coluna!.notNull, `dossie.${nome} precisa ser NOT NULL`).toBe(true);
    }
  });
});

describe('robustez de job (ADR 0006)', () => {
  const todas = tabelas();

  it('job é idempotente por tipo e chave', () => {
    const config = getTableConfig(todas.get('job')!);
    const unica = config.uniqueConstraints.find((u) => u.name === 'unq_job_idempotencia');
    expect(unica).toBeDefined();
    expect(unica!.columns.map((c) => c.name).sort()).toEqual(['chave_idempotencia', 'tipo']);
  });

  it('job é retomável: guarda progresso parcial', () => {
    expect(colunas(todas.get('job')!).has('progresso')).toBe(true);
  });

  it('pendente_revisao é status de primeira classe, não erro', () => {
    // Quando o schema de saída falha, o registro entra para revisão em vez de ser
    // descartado.
    expect(schema.statusJobEnum.enumValues).toContain('pendente_revisao');
  });
});

describe('auditoria', () => {
  const todas = tabelas();

  it('toda tabela registra quando foi criada', () => {
    for (const [nome, tabela] of todas) {
      expect(colunas(tabela).has('criado_em'), `${nome} precisa de criado_em`).toBe(true);
    }
  });
});
