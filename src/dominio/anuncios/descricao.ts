/**
 * Descrição do anúncio, com a tabela de compatibilidade vinda de M4 (8.2).
 *
 * A descrição existe para responder, antes da pergunta, a única coisa que o
 * comprador de peça quer saber: **serve no meu modelo?** E existe para responder
 * isso do mesmo lugar de onde sai a resposta na pergunta — a ficha publicável.
 * Publicar na descrição uma lista diferente da que o sistema usa para responder
 * comprador é a forma mais barata de prometer o que não se sustenta.
 *
 * ## O nome do produto é limpo; o texto do vendedor não
 *
 * A mesma limpeza de palavra promocional do título vale para a linha de
 * identificação, e a razão é consistência: título e descrição saem do mesmo
 * `tipoProduto`, e um limpando e o outro não fazia "promoção" desaparecer da
 * vitrine e reaparecer três linhas abaixo. Apareceu em teste.
 *
 * Já `observacoes` é texto do vendedor e passa intacto. Se ele quer escrever
 * "promoção de lançamento" ali, é decisão dele — o sistema limpa o que **gera**,
 * não o que a pessoa escreveu.
 *
 * ## O convite a perguntar não é enfeite
 *
 * Quando há modelo retido — deduzido, ou com evidência fraca —, a descrição diz
 * que a lista não é exaustiva e convida a perguntar. Isso faz duas coisas: evita a
 * devolução de quem assumiu que o silêncio era "não serve", e gera a pergunta que
 * alimenta o grafo de compatibilidade, porque cada resposta conferida vira
 * evidência humana.
 */
import { textoParaDescricao, type Ficha } from '@/dominio/compatibilidade/ficha';
import { normalizarCodigoDeModelo } from '@/dominio/identidade/canonico';
import { limparTermos } from './titulo';

export interface DadosDaDescricao {
  readonly tipoProduto: string;
  readonly marca: string | null;
  readonly modeloPeca: string | null;
  readonly quantidadeEmbalagem: number | null;
  /** A ficha de M4. O bloco de compatibilidade sai dela, não de texto à mão. */
  readonly ficha: Ficha;
  /** Texto do vendedor, quando houver. Entra no fim, sem alteração. */
  readonly observacoes?: string | null;
}

export interface DescricaoGerada {
  readonly texto: string;
  readonly avisos: readonly string[];
}

/** Junta blocos com uma linha em branco entre eles, descartando os vazios. */
function juntarBlocos(blocos: readonly string[]): string {
  return blocos.filter((b) => b.trim() !== '').join('\n\n');
}

export function gerarDescricao(dados: DadosDaDescricao): DescricaoGerada {
  const avisos: string[] = [];

  const { limpo, tiradas } = limparTermos(dados.tipoProduto);
  if (tiradas.length > 0) {
    avisos.push(`Tirei da descrição: ${tiradas.join(', ')}.`);
  }

  const identificacao: string[] = [];
  if (limpo.trim() !== '') identificacao.push(limpo.trim());
  if (dados.marca !== null && dados.marca.trim() !== '') {
    identificacao.push(`Marca: ${dados.marca.trim()}`);
  }
  const codigo = dados.modeloPeca === null ? null : normalizarCodigoDeModelo(dados.modeloPeca);
  if (codigo !== null) identificacao.push(`Código: ${codigo}`);
  if (dados.quantidadeEmbalagem !== null && dados.quantidadeEmbalagem > 1) {
    identificacao.push(`Embalagem: ${String(dados.quantidadeEmbalagem)} unidades`);
  }

  const compatibilidade = textoParaDescricao(dados.ficha);
  if (compatibilidade === '') {
    avisos.push(
      'A descrição sai sem tabela de compatibilidade: nada na ficha passou do corte de publicação. É o que mais pesa em peça de reposição.',
    );
  }

  const retidas = dados.ficha.retidas.length;
  const convite =
    retidas > 0
      ? 'Não achou o seu modelo na lista? Pergunte aqui com o modelo do aparelho — a lista tem só o que está confirmado, e eu confiro o resto na hora.'
      : compatibilidade === ''
        ? ''
        : 'Tem dúvida sobre o seu modelo? Pergunte aqui com o modelo do aparelho.';

  const texto = juntarBlocos([
    identificacao.length === 0 ? '' : identificacao.join('\n'),
    compatibilidade,
    convite,
    dados.observacoes ?? '',
  ]);

  return { texto, avisos };
}
