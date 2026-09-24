/**
 * Tela de postagem — "o que postar hoje, ordenado por prazo restante".
 *
 * A especificação chama esta de a tela mais usada do sistema, e o critério dela é
 * uma frase só. Então ela não tem filtro, não tem busca e não tem coluna de valor:
 * tem a lista na ordem em que o trabalho precisa ser feito, e um botão por pedido.
 *
 * No fim, quanto repasse espera conferência em cada loja. A conferência em si mora na
 * aba Repasse da área de cada loja desde a navegação por loja (ADR 0009): o extrato que
 * se confere é o de uma loja, e lá a lista é só dela. Aqui fica o número, porque quem
 * posta o dia é quem nota que o repasse veio diferente.
 */
import type { Metadata } from 'next';
import { lerAmbiente } from '@/config/ambiente';
import { resumoDaFila } from '@/dominio/pedidos/fila-do-dia';
import { RepositorioDePedidos } from '@/dominio/pedidos/repositorio';
import { carregarPerfil } from '@/dominio/perfil';
import { PLATAFORMAS } from '@/dominio/precificacao/tipos';
import { banco } from '@/infra/banco/cliente';
import { RepositorioDeConsignacao } from '@/dominio/consignacao/repositorio';
import { avisoDeConsignacao, descreverAviso } from './apresentacao';
import { AvisoDaAcao, AvisoDeConsignacao, Fila, Painel, RepasseNasLojas } from './componentes';
import { LIMITE_DA_FILA, LIMITE_DE_DIVERGENCIAS } from './constantes';
import estilo from './postagem.module.css';

export const metadata: Metadata = { title: 'Postagem' };

/** Sempre dinâmica: a fila depende da hora, e pré-renderizar a congelaria. */
export const dynamic = 'force-dynamic';

export default async function PaginaDePostagem({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const parametros = await searchParams;
  const db = banco();
  const perfil = await carregarPerfil(db, lerAmbiente().BANCADA_PERFIL_PADRAO);
  const repo = new RepositorioDePedidos(db);

  // A hora é lida uma vez e passada adiante: duas leituras de relógio na mesma
  // renderização podem cair em lados diferentes da virada do dia, e aí a contagem
  // do painel não fecha com a lista.
  const agora = new Date();

  const [fila, repassePorLoja, consignacao] = await Promise.all([
    repo.filaDoDia(perfil.id, agora, LIMITE_DA_FILA),
    Promise.all(
      PLATAFORMAS.map(async (plataforma) => ({
        plataforma,
        paraConferir: (
          await repo.divergenciasDeRepasse(perfil.id, LIMITE_DE_DIVERGENCIAS, plataforma)
        ).length,
      })),
    ),
    new RepositorioDeConsignacao(db).quadroDeConferencia(perfil.id, { agora }),
  ]);

  const codigo = Array.isArray(parametros['r']) ? parametros['r'][0] : parametros['r'];
  const aviso = descreverAviso(codigo);
  const avisoDeEstoqueDeTerceiro = avisoDeConsignacao(consignacao.unidadesEmRisco);

  return (
    <main className={estilo.pagina}>
      <header className={estilo.cabecalho}>
        <h1 className={estilo.titulo}>Postar hoje</h1>
        <p className={estilo.subtitulo}>
          Em ordem de prazo, não de data da venda: atraso em conta nova é o que mais custa em
          reputação. Pedido sem prazo aparece no topo, porque não saber se atrasou é o problema.
        </p>
        <p className={estilo.resumo}>{resumoDaFila(fila)}</p>
      </header>

      {aviso !== null && <AvisoDaAcao aviso={aviso} />}
      {avisoDeEstoqueDeTerceiro !== null && <AvisoDeConsignacao texto={avisoDeEstoqueDeTerceiro} />}

      <Painel fila={fila} />

      <section aria-labelledby="fila-titulo" className={estilo.secao}>
        <h2 className={estilo.secaoTitulo} id="fila-titulo">
          Fila
        </h2>
        <Fila fila={fila} />
      </section>

      <section aria-labelledby="repasse-titulo" className={estilo.secao}>
        <h2 className={estilo.secaoTitulo} id="repasse-titulo">
          Repasse de cada loja
        </h2>
        <p className={estilo.dica}>
          A conferência mora na aba Repasse de cada loja, com o extrato daquela loja do lado.
        </p>
        <RepasseNasLojas lojas={repassePorLoja} />
      </section>
    </main>
  );
}
