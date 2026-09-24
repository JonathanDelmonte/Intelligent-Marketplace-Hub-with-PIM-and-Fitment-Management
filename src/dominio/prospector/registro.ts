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
import { InvestigadorDeBuscaWeb } from './investigadores/busca-web';
import { InvestigadorDeCnpj } from './investigadores/cnpj';
import { InvestigadorDeDemandaPublica, SensorDePncpHttp } from './investigadores/demanda-publica';
import { InvestigadorDePagina } from './investigadores/leitor-de-pagina';
import type { OpcoesDaRede } from '@/infra/web/rede';

interface EntradaDoRegistro {
  readonly ferramenta: Ferramenta;
  /** Sai para a internet. Quem monta sem rede — o teste — fica sem ela. */
  readonly usaRede: boolean;
  readonly criar: (db: Banco, rede: OpcoesDaRede) => Investigador;
}

/**
 * O registro.
 *
 * Cinco das seis ferramentas, todas gratuitas e sem chave (CLAUDE.md, 3.7): a base
 * local, o buscador (DuckDuckGo em HTML), o leitor de página, a consulta de CNPJ
 * (BrasilAPI) e a demanda pública (PNCP). Falta a visão, que precisa de imagem — e o
 * garimpo ainda não tem de onde recebê-la.
 */
const REGISTRO: readonly EntradaDoRegistro[] = [
  { ferramenta: 'base_local', usaRede: false, criar: (db) => new InvestigadorDaBaseLocal(db) },
  {
    ferramenta: 'busca_web',
    usaRede: true,
    criar: (_db, rede) => new InvestigadorDeBuscaWeb(rede),
  },
  { ferramenta: 'ler_pagina', usaRede: true, criar: (_db, rede) => new InvestigadorDePagina(rede) },
  { ferramenta: 'cnpj', usaRede: true, criar: (_db, rede) => new InvestigadorDeCnpj(rede) },
  {
    ferramenta: 'pncp',
    usaRede: true,
    criar: (_db, rede) => new InvestigadorDeDemandaPublica(new SensorDePncpHttp(rede)),
  },
];

/** As ferramentas que a instalação sabe chamar. Entra direto em `LimitesDaBusca`. */
export const FERRAMENTAS_PRONTAS: readonly Ferramenta[] = REGISTRO.map((e) => e.ferramenta);

/**
 * Os investigadores, montados sobre um banco.
 *
 * `rede: false` monta só os que não saem da máquina — é o que o teste usa, para a suíte
 * não depender de internet nem bater em serviço de terceiro. Sem a opção, todos, com a
 * rede padrão.
 */
export function investigadoresDaInstalacao(
  db: Banco,
  opcoes: { readonly rede?: OpcoesDaRede | false } = {},
): readonly Investigador[] {
  const rede = opcoes.rede;
  return REGISTRO.filter((e) => rede !== false || !e.usaRede).map((e) =>
    e.criar(db, rede === false || rede === undefined ? {} : rede),
  );
}
