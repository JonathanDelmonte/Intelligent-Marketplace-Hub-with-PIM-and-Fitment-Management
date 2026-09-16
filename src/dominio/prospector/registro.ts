/**
 * Quais investigadores esta instalação tem (M6).
 *
 * Uma lista, duas leituras: o **conjunto de ferramentas** (que a tela mostra e a
 * fronteira usa para filtrar) e as **instâncias** (que o executor chama). Derivadas da
 * mesma linha, porque a constante escrita à mão ao lado da fábrica é a constante que
 * divergiria na primeira ferramenta nova.
 *
 * É aqui que se responde "o que dá para investigar hoje", e a resposta é de código, não
 * de configuração: ter chave de LLM no ambiente não faz a visão rodar se ninguém a
 * chama. Foi o que a tela do garimpo dizia errado no primeiro dia.
 */
import type { Banco } from '@/infra/banco/cliente';
import type { Investigador } from './motor';
import type { Ferramenta } from './hipoteses';
import { InvestigadorDaBaseLocal } from './investigadores/base-local';

interface EntradaDoRegistro {
  readonly ferramenta: Ferramenta;
  readonly criar: (db: Banco) => Investigador;
}

/**
 * O registro.
 *
 * Só a base local por enquanto, e é o suficiente para duas das sete perguntas — "em que
 * mais serve" e "que outras peças". As outras cinco precisam de rede: buscador, leitor
 * de página, consulta de CNPJ, sensor de PNCP.
 */
const REGISTRO: readonly EntradaDoRegistro[] = [
  { ferramenta: 'base_local', criar: (db) => new InvestigadorDaBaseLocal(db) },
];

/** As ferramentas que a instalação sabe chamar. Entra direto em `LimitesDaBusca`. */
export const FERRAMENTAS_PRONTAS: readonly Ferramenta[] = REGISTRO.map((e) => e.ferramenta);

/** Os investigadores, montados sobre um banco. */
export function investigadoresDaInstalacao(db: Banco): readonly Investigador[] {
  return REGISTRO.map((e) => e.criar(db));
}
