/**
 * O investigador que procura na base que já está aqui (M6, ferramenta `base_local`).
 *
 * É o único que roda sem rede e sem chave, e por isso é o primeiro: com ele o
 * prospector deixa de ser máquina parada e passa a responder duas das sete perguntas.
 *
 * ## O que ele mineira, e por que é a base compartilhada
 *
 * `produto_externo` é conhecimento do mundo (CLAUDE.md, seção 3.4): cresce a cada link
 * colado e a cada planilha importada, por qualquer perfil, e nenhuma consulta daqui
 * precisa de `perfil_id` — o que ele afirma ("esta peça também é citada para o modelo
 * X") é verdade independente de quem vende.
 *
 * Duas leituras da mesma varredura:
 *
 * - **em que mais serve**: anúncio que cita o código do alvo e **outros** códigos está
 *   afirmando compatibilidade. É candidato a verificar, não fato — a disciplina de
 *   evidência do M4 é quem decide o que vale.
 * - **que outras peças**: anúncio que cita o mesmo aparelho e descreve **outra** peça é
 *   catálogo adjacente, que é o que a especificação chama de expansão com custo de
 *   aquisição de cliente zero.
 *
 * ## Casa os códigos em TypeScript, e não em SQL
 *
 * `ilike '%PA21G%'` perderia `PA 21 G`, que é como metade das fontes escreve — e a
 * gramática que junta tokens vizinhos vive no domínio, não no Postgres. Então a
 * varredura é **limitada** e o casamento é feito aqui.
 *
 * O limite é a dívida consciente deste arquivo: com a base pequena é irrelevante, e o
 * dia em que doer o conserto é uma coluna de códigos normalizados gravada na ingestão,
 * com índice — não um `ilike` mais esperto.
 *
 * ## Só cita quem tem URL
 *
 * Linha sem `url` (planilha de fornecedor, por exemplo) fica fora da varredura: achado
 * sem fonte não é auditável, e a própria tela marca isso em vermelho. Melhor não
 * afirmar do que afirmar sem poder mostrar de onde veio.
 */
import { isNotNull } from 'drizzle-orm';
import { desc } from 'drizzle-orm';
import { codigosDeModelo, normalizarTexto } from '@/dominio/identidade/canonico';
import type { Banco } from '@/infra/banco/cliente';
import { produtoExterno } from '@/infra/banco/schema';
import { ZERO } from '@/lib/dinheiro';
import type { Achado } from '../fronteira';
import type { Investigador, PedidoDeInvestigacao, RespostaDaInvestigacao } from '../motor';

/**
 * Quantas ocorrências a varredura lê.
 *
 * Duas mil: é o que cabe em uma consulta e em alguns milissegundos de casamento de
 * código, e é muito mais do que a base tem hoje. Número escolhido, não medido.
 */
export const LIMITE_DA_VARREDURA = 2_000;

/**
 * Quantos achados um passo produz, no máximo.
 *
 * Seis. Um passo que devolve quarenta achados não é um passo produtivo: é um dossiê
 * ilegível, e a contagem de achados deixa de significar algo.
 */
export const ACHADOS_POR_PASSO = 6;

/**
 * Palavras que não dizem que peça é.
 *
 * Lista curta e explícita, em vez de "toda palavra com menos de quatro letras": `kit`,
 * `eixo` e `mola` são peça, e cairiam na regra de tamanho.
 */
const LIGACOES = new Set([
  'a',
  'com',
  'da',
  'das',
  'de',
  'do',
  'dos',
  'e',
  'em',
  'na',
  'no',
  'o',
  'para',
  'por',
]);

/**
 * Que peça o título anuncia: a primeira palavra que não é ligação nem código.
 *
 * "Refil de purificador PA21G" é um refil, "Vedação do copo PA21G" é uma vedação, e
 * comparar essas duas palavras é o que separa "outra peça do mesmo aparelho" de "o
 * mesmo item anunciado por outra loja".
 *
 * A comparação é de primeira palavra, e não de conjunto: anúncio é escrito curto, e
 * exigir que ele repita todas as palavras do alvo faria "Refil PA 21 G compatível"
 * passar por peça diferente de "Refil de purificador de água PA21G". Quando o alvo é o
 * **aparelho** em vez da peça, a regra continua certa por acidente útil — a primeira
 * palavra do aparelho não é a primeira palavra de nenhuma peça dele.
 *
 * `null` quando o título é só código e ligação, e aí não há como comparar.
 */
export function pecaDoTitulo(texto: string): string | null {
  const codigos = new Set(codigosDeModelo(texto).map((c) => c.toLowerCase()));

  return (
    normalizarTexto(texto)
      .split(' ')
      .find(
        (palavra) =>
          palavra.length >= 3 &&
          !LIGACOES.has(palavra) &&
          !codigos.has(palavra) &&
          !/^\d+$/.test(palavra),
      ) ?? null
  );
}

interface Ocorrencia {
  readonly id: string;
  readonly url: string;
  readonly titulo: string;
  readonly de: string | null;
}

export class InvestigadorDaBaseLocal implements Investigador {
  readonly ferramenta = 'base_local' as const;

  constructor(
    private readonly db: Banco,
    private readonly agora: () => Date = () => new Date(),
  ) {}

  async investigar(pedido: PedidoDeInvestigacao): Promise<RespostaDaInvestigacao> {
    const codigosDoAlvo = new Set(codigosDeModelo(pedido.alvoDoDossie));

    // Sem código de modelo no alvo não há por onde casar. "refil de purificador" não
    // aponta para aparelho nenhum, e é informação sobre o alvo — não falha.
    if (codigosDoAlvo.size === 0) return { achados: [], custoCentavos: ZERO };

    const ocorrencias = await this.varrer();
    const relacionadas = ocorrencias.filter((o) =>
      codigosDeModelo(o.titulo).some((c) => codigosDoAlvo.has(c)),
    );

    if (pedido.item.familia === 'em_que_mais_serve') {
      // Não confirma a hipótese: a evidência é circunstancial — um anúncio citou os dois
      // códigos juntos, e citar não é servir. A ficha do M4 é quem decide, com segunda
      // fonte, e confirmar aqui seria emprestar certeza que a base local não tem.
      return { achados: this.codigosVizinhos(relacionadas, codigosDoAlvo), custoCentavos: ZERO };
    }

    if (pedido.item.familia === 'que_outras_pecas') {
      const achados = this.outrasPecas(relacionadas, pedido.alvoDoDossie);

      // Aqui a evidência é direta: os anúncios das outras peças existem e estão na mão.
      // O id da hipótese de abertura é o nome da família (ver `abrirAlvo`).
      return {
        achados,
        custoCentavos: ZERO,
        ...(achados.length === 0 ? {} : { confirmadas: ['que_outras_pecas'] }),
      };
    }

    // As outras cinco famílias declaram ferramenta que sai para fora, então a fronteira
    // não encaminha nenhuma delas para cá. Se encaminhar, é um passo sem achado — que a
    // contagem de saturação já sabe tratar — e não uma exceção no meio do laço.
    return { achados: [], custoCentavos: ZERO };
  }

  private async varrer(): Promise<readonly Ocorrencia[]> {
    const linhas = await this.db
      .select({
        id: produtoExterno.id,
        url: produtoExterno.url,
        titulo: produtoExterno.tituloBruto,
        vendedor: produtoExterno.vendedor,
        plataforma: produtoExterno.plataformaOuSite,
      })
      .from(produtoExterno)
      .where(isNotNull(produtoExterno.url))
      .orderBy(desc(produtoExterno.coletadoEm))
      .limit(LIMITE_DA_VARREDURA);

    return linhas.flatMap((l): Ocorrencia[] =>
      l.url === null
        ? []
        : [{ id: l.id, url: l.url, titulo: l.titulo, de: l.vendedor ?? l.plataforma }],
    );
  }

  /**
   * Códigos que aparecem ao lado dos do alvo.
   *
   * Um achado por código novo, com a URL do anúncio que os cita juntos — que é a
   * evidência. O primeiro anúncio a citar cada código é o que fica: dez anúncios
   * dizendo o mesmo não são dez achados.
   */
  private codigosVizinhos(
    relacionadas: readonly Ocorrencia[],
    codigosDoAlvo: ReadonlySet<string>,
  ): readonly Achado[] {
    const achados: Achado[] = [];
    const vistos = new Set<string>();

    for (const ocorrencia of relacionadas) {
      for (const codigo of codigosDeModelo(ocorrencia.titulo)) {
        if (codigosDoAlvo.has(codigo) || vistos.has(codigo)) continue;
        vistos.add(codigo);

        achados.push({
          id: `em_que_mais_serve:${codigo}`,
          familia: 'em_que_mais_serve',
          oQue: `${codigo} é citado no mesmo anúncio que o alvo${ocorrencia.de === null ? '' : `, em ${ocorrencia.de}`}. Candidato a compatível, a confirmar com segunda fonte.`,
          origemUrl: ocorrencia.url,
          achadoEm: this.agora().toISOString(),
        });

        if (achados.length >= ACHADOS_POR_PASSO) return achados;
      }
    }

    return achados;
  }

  /**
   * Outras peças citadas para o mesmo aparelho.
   *
   * Fica de fora o anúncio da **mesma peça** — comparada por `pecaDoTitulo`, não por
   * título inteiro. A primeira versão comparava o texto normalizado, e aí "Refil de
   * purificador de água PA21G PA26G original Electrolux" entrava na lista de "outras
   * peças" do refil: título diferente, mesma peça.
   *
   * O que a peça **é** não é classificado além disso. Quem lê reconhece "vedação" e
   * "torneira" na hora, e inventar taxonomia aqui seria inventar certeza.
   */
  private outrasPecas(relacionadas: readonly Ocorrencia[], alvo: string): readonly Achado[] {
    const pecaDoAlvo = pecaDoTitulo(alvo);
    const achados: Achado[] = [];
    const vistos = new Set<string>();

    for (const ocorrencia of relacionadas) {
      const chave = normalizarTexto(ocorrencia.titulo);
      if (vistos.has(chave)) continue;
      if (pecaDoAlvo !== null && pecaDoTitulo(ocorrencia.titulo) === pecaDoAlvo) continue;
      vistos.add(chave);

      achados.push({
        id: `que_outras_pecas:${chave.slice(0, 80)}`,
        familia: 'que_outras_pecas',
        oQue: `Para o mesmo aparelho: ${ocorrencia.titulo}${ocorrencia.de === null ? '' : ` (${ocorrencia.de})`}`,
        origemUrl: ocorrencia.url,
        achadoEm: this.agora().toISOString(),
      });

      if (achados.length >= ACHADOS_POR_PASSO) return achados;
    }

    return achados;
  }
}
