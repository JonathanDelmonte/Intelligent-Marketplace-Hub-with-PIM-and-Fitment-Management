/**
 * Texto que a interface mostra: as regras que não são de dinheiro nem de data.
 *
 * Nasceu com uma função só, e nasceu porque a segunda cópia dela apareceu — a mesma
 * história de `ui/tempo.ts` e de `--fonte-mono`. Aqui a cópia era de plural.
 */

/**
 * Conta com o substantivo conjugado: `contagem(1, 'clique', 'cliques')` → `1 clique`.
 *
 * Existe porque `${n} clique(s)` é texto de sistema, e este sistema mostra as frases
 * do domínio inteiras na tela. Apareceu duas vezes em telas diferentes no mesmo dia,
 * e numa delas o parêntese escondia um erro de verdade: "a última saiu há 0 minuto(s)"
 * passava por desleixo de conjugação quando o certo era "agora".
 *
 * Os dois substantivos são parâmetro, e não uma regra de `+s`: em português a regra
 * erraria "conversão/conversões", "mês/meses" e "real/reais" — e errar plural em texto
 * que o dono lê todo dia é o tipo de detalhe que faz duvidar do resto.
 *
 * Zero vai para o plural, que é como se fala: "nenhum achado", "0 achados".
 */
export function contagem(quantidade: number, singular: string, plural: string): string {
  return `${String(quantidade)} ${quantidade === 1 ? singular : plural}`;
}
