/**
 * A consulta de CNPJ do garimpo (M6, ferramenta `cnpj`), pela BrasilAPI.
 *
 * Gratuita e sem chave (CLAUDE.md, 3.7): a BrasilAPI republica o cadastro da Receita.
 * É a pergunta que elimina a maioria dos candidatos a fornecedor na primeira passada:
 * a empresa **existe**, está **ativa**, e é **atacadista** ou **fabricante** — ou é uma
 * loja de varejo com página bonita?
 *
 * ## O que vira achado
 *
 * - CNPJ ativo: razão social, desde quando, onde, e a atividade principal. Se alguma
 *   atividade é comércio atacadista, a hipótese "quem distribui" é confirmada; se é
 *   fabricação, "quem fabrica".
 * - CNPJ que não está ativo: achado também, e o mais útil de todos — fornecedor com
 *   CNPJ baixado ou inapto é descartado antes da primeira conversa.
 * - CNPJ que a Receita não conhece (404): achado, pelo mesmo motivo.
 *
 * Cota e falha do serviço viram `FalhaDeRede`: o passo não aconteceu, e o job espera.
 */
import { lerDocumento } from '@/dominio/documento';
import { ZERO } from '@/lib/dinheiro';
import type { Achado } from '../fronteira';
import type { FamiliaDeHipotese } from '../hipoteses';
import type { Investigador, PedidoDeInvestigacao, RespostaDaInvestigacao } from '../motor';
import {
  consultarCnpj,
  fraseDeInexistente,
  lerCadastro,
  type OpcoesDaReceita,
} from '@/dominio/web/receita';

export interface OpcoesDaConsultaDeCnpj extends OpcoesDaReceita {
  readonly agora?: (() => Date) | undefined;
}

export class InvestigadorDeCnpj implements Investigador {
  readonly ferramenta = 'cnpj' as const;

  constructor(private readonly opcoes: OpcoesDaConsultaDeCnpj = {}) {}

  async investigar(pedido: PedidoDeInvestigacao): Promise<RespostaDaInvestigacao> {
    // O item de CNPJ carrega o número; qualquer outra coisa — o alvo do dossiê, se a
    // fronteira mandar para cá — não tem o que consultar.
    const lido = lerDocumento(pedido.item.alvo);
    if (lido.tipo !== 'ok' || lido.documento.tipo !== 'cnpj') {
      return { achados: [], custoCentavos: ZERO };
    }
    const cnpj = lido.documento.valor;
    const consulta = await consultarCnpj(cnpj, this.opcoes);
    const agora = (this.opcoes.agora?.() ?? new Date()).toISOString();

    if (consulta.tipo === 'inexistente') {
      const achado: Achado = {
        id: `cnpj:${cnpj}`,
        familia: pedido.item.familia,
        oQue: `${fraseDeInexistente(cnpj)} Quem o apresenta não é fornecedor.`,
        origemUrl: consulta.fonte,
        achadoEm: agora,
      };
      return { achados: [achado], custoCentavos: ZERO };
    }

    const leitura = lerCadastro(cnpj, consulta.cadastro);
    const frase = leitura.frase;
    const confirma: FamiliaDeHipotese[] = [
      ...(leitura.atacadista ? (['quem_distribui'] as const) : []),
      ...(leitura.fabricante ? (['quem_fabrica'] as const) : []),
    ];
    return {
      achados: [
        {
          id: `cnpj:${cnpj}`,
          familia: confirma[0] ?? pedido.item.familia,
          oQue: frase,
          origemUrl: consulta.fonte,
          achadoEm: agora,
        },
      ],
      custoCentavos: ZERO,
      ...(confirma.length === 0 ? {} : { confirmadas: [...confirma] }),
    };
  }
}
