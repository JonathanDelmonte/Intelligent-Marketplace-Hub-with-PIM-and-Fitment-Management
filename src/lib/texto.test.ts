import { describe, expect, it } from 'vitest';
import { contagem } from './texto';

describe('contagem', () => {
  it('conjuga o singular e o plural', () => {
    expect(contagem(1, 'clique', 'cliques')).toBe('1 clique');
    expect(contagem(3, 'clique', 'cliques')).toBe('3 cliques');
  });

  it('zero vai para o plural, que é como se fala', () => {
    expect(contagem(0, 'achado', 'achados')).toBe('0 achados');
  });

  it('os dois substantivos são parâmetro, porque a regra do +s erraria', () => {
    expect(contagem(2, 'conversão', 'conversões')).toBe('2 conversões');
    expect(contagem(2, 'mês', 'meses')).toBe('2 meses');
  });
});
