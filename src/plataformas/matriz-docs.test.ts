/**
 * A matriz executável e a documentada não podem divergir.
 *
 * `docs/matriz-capacidades.md` afirma ser a leitura humana de `matriz.ts`, e o
 * README manda o leitor confiar nela. Documentação que diverge do código é pior
 * que documentação ausente, porque induz decisão errada — e neste caso a decisão
 * é "posso construir contando com esta capacidade?".
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CAPACIDADES, CAPACIDADE_SEMPRE_SUPORTADA, MODOS_ACESSO } from './capacidades';
import { MATRIZ_INICIAL } from './matriz';

const DOC = readFileSync(new URL('../../docs/matriz-capacidades.md', import.meta.url), 'utf8');

describe('docs/matriz-capacidades.md acompanha matriz.ts', () => {
  it('documenta todos os quatro modos de acesso', () => {
    for (const modo of MODOS_ACESSO) {
      expect(DOC, modo).toContain(`\`${modo}\``);
    }
  });

  it('marca m4_extensao como fora de escopo, não como opção', () => {
    expect(DOC).toContain('m4_extensao');
    expect(DOC).toContain('fora de escopo');
    expect(DOC).toContain('ADR 0008');
  });

  it('documenta todas as nove capacidades', () => {
    expect(CAPACIDADES).toHaveLength(9);
    // O documento usa os rótulos humanos, então a conferência é por trecho
    // característico de cada linha da tabela.
    const trechos: Record<string, string> = {
      ler_anuncios: 'Ler meus anúncios',
      ler_pedidos: 'Ler meus pedidos',
      ler_taxas: 'Ler taxas reais por preço',
      publicar_anuncio: 'Publicar / editar anúncio',
      gerar_etiqueta: 'Gerar etiqueta de envio',
      buscar_terceiros: 'Buscar anúncios de terceiros',
      ler_item_terceiro: 'Ler item de terceiro por ID/URL',
      responder_pergunta: 'Responder pergunta de comprador',
      exportar_para_importacao: 'Exportar arquivo de importação',
    };
    for (const capacidade of CAPACIDADES) {
      const trecho = trechos[capacidade];
      expect(trecho, `capacidade ${capacidade} sem trecho conhecido no teste`).toBeDefined();
      expect(DOC, capacidade).toContain(trecho!);
    }
  });

  it('registra o bloqueio da busca do ML com a mesma data do código', () => {
    const estado = MATRIZ_INICIAL.ml.buscar_terceiros;
    expect(estado.tipo).toBe('bloqueado');
    expect(DOC).toContain('BLOQUEADO');
    expect(DOC).toContain('/sites/MLB/search');
    expect(DOC).toContain('403');
    // O código diz `2025-12`; o documento diz "dezembro de 2025". Conferir os dois
    // formatos evita que um seja atualizado sem o outro.
    if (estado.tipo === 'bloqueado') {
      expect(estado.desde).toBe('2025-12');
      expect(DOC).toContain('dezembro de 2025');
    }
  });

  it('diz que a sonda nunca rodou, e o código concorda', () => {
    // Enquanto nada foi confirmado, tudo menos o piso é `presumido`, `bloqueado`
    // ou `inexistente`. Se alguém marcar algo como `disponivel` sem rodar a sonda,
    // este teste obriga a atualizar o documento junto.
    const temDisponivelAlemDoPiso = Object.values(MATRIZ_INICIAL).some((daPlataforma) =>
      CAPACIDADES.some(
        (c) => c !== CAPACIDADE_SEMPRE_SUPORTADA && daPlataforma[c].tipo === 'disponivel',
      ),
    );

    if (DOC.includes('nunca executada')) {
      expect(
        temDisponivelAlemDoPiso,
        'o documento diz que a sonda nunca rodou, mas a matriz já marca capacidade como disponível',
      ).toBe(false);
    }
  });

  it('registra que o piso é sempre suportado', () => {
    expect(DOC).toContain('sempre suportado');
    expect(DOC).toContain('ADR 0001');
  });

  it('lista as aprovações pendentes de Shopee e Amazon', () => {
    expect(DOC).toContain('Open Platform');
    expect(DOC).toContain('SP-API');
  });
});
