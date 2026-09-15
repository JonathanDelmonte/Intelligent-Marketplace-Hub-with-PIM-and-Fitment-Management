import { describe, expect, it } from 'vitest';
import { AREAS_REGULADAS, REGRAS, avaliarRegulacao, type ProdutoParaRegulacao } from './regulada';

const produto = (campos: Partial<ProdutoParaRegulacao> = {}): ProdutoParaRegulacao => ({
  categoriaRegulada: null,
  tituloInterno: 'Refil para purificador PA 21',
  ...campos,
});

describe('REGRAS', () => {
  it('toda área tem regra, com exigência acionável e consequência', () => {
    // Aviso que diz "produto regulado" e não diz o que fazer é aviso que a pessoa
    // fecha. O que faz agir é saber o que a plataforma pede e o que acontece se não.
    expect(REGRAS).toHaveLength(AREAS_REGULADAS.length);
    for (const r of REGRAS) {
      expect(r.exigencia.length, r.area).toBeGreaterThan(60);
      expect(r.consequencia.length, r.area).toBeGreaterThan(30);
      expect(r.palavras.length, r.area).toBeGreaterThan(0);
      expect(r.orgao.length, r.area).toBeGreaterThan(2);
    }
  });

  it('cobre o suplemento, que é o caso que a especificação nomeia', () => {
    const suplemento = REGRAS.find((r) => r.area === 'anvisa_suplemento');
    expect(suplemento?.orgao).toBe('ANVISA');
    expect(suplemento?.consequencia).toContain('cancelado');
  });
});

describe('avaliarRegulacao', () => {
  it('produto comum não gera aviso, e não devolve caixa vazia', () => {
    const r = avaliarRegulacao(produto());
    expect(r.area).toBeNull();
    expect(r.origem).toBe('nenhuma');
    expect(r.mensagem).toBeNull();
  });

  it('a palavra no título sugere, e a mensagem diz que é sugestão', () => {
    // Deixar passar um suplemento custa o anúncio cancelado; sugerir onde não há
    // custa uma linha que a pessoa dispensa. A assimetria decide o desenho.
    const r = avaliarRegulacao(produto({ tituloInterno: 'Whey Protein 900g Chocolate' }));
    expect(r.area).toBe('anvisa_suplemento');
    expect(r.origem).toBe('sugerido_por_palavra');
    expect(r.mensagem).toContain('pode ser engano meu');
    expect(r.mensagem).toContain('ANVISA');
  });

  it('a marcação no SKU vence a palavra, porque é onde a pessoa decidiu', () => {
    // Mesma regra da resolução de compatibilidade: decisão humana não é
    // sobrescrita por heurística.
    const r = avaliarRegulacao(
      produto({ tituloInterno: 'Whey Protein 900g', categoriaRegulada: 'inmetro' }),
    );
    expect(r.area).toBe('inmetro');
    expect(r.origem).toBe('marcado_no_sku');
    expect(r.mensagem).toContain('INMETRO');
    expect(r.mensagem).not.toContain('engano meu');
  });

  it('aceita a marcação pelo rótulo legível, não só pelo código da área', () => {
    // Quem preenche à mão escreve "suplemento alimentar", não "anvisa_suplemento".
    const r = avaliarRegulacao(produto({ categoriaRegulada: 'Suplemento Alimentar' }));
    expect(r.area).toBe('anvisa_suplemento');
  });

  it('marcação que eu não conheço não é ignorada', () => {
    // A pessoa marcou por um motivo, e o aviso genérico preserva o motivo.
    const r = avaliarRegulacao(produto({ categoriaRegulada: 'agrotóxico' }));
    expect(r.area).toBeNull();
    expect(r.origem).toBe('marcado_no_sku');
    expect(r.mensagem).toContain('agrotóxico');
    expect(r.mensagem).toContain('Confira a exigência');
  });

  it('marcação em branco não conta como marcação', () => {
    expect(avaliarRegulacao(produto({ categoriaRegulada: '   ' })).origem).toBe('nenhuma');
  });

  it('é indiferente a acento e caixa na detecção', () => {
    expect(avaliarRegulacao(produto({ tituloInterno: 'COLÁGENO hidrolisado' })).area).toBe(
      'anvisa_suplemento',
    );
    expect(avaliarRegulacao(produto({ tituloInterno: 'Vedação de tampa' })).area).toBeNull();
  });

  it('procura também no tipo do produto, não só no título', () => {
    const r = avaliarRegulacao(
      produto({ tituloInterno: 'EF-ELX-21', tipoProduto: 'brinquedo de montar' }),
    );
    expect(r.area).toBe('inmetro');
  });

  it('toda área declarada é alcançável por palavra', () => {
    // Área sem palavra que a alcance é área que nunca dispara — e ninguém
    // descobre, porque o silêncio parece "não se aplica".
    const alcancadas = new Set(
      REGRAS.flatMap((r) =>
        r.palavras.map((palavra) => avaliarRegulacao(produto({ tituloInterno: palavra })).area),
      ),
    );
    expect([...AREAS_REGULADAS].filter((a) => !alcancadas.has(a))).toEqual([]);
  });
});
