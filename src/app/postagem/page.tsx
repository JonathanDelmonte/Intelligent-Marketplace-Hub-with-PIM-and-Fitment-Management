/**
 * Tela de postagem — "o que postar hoje, ordenado por prazo restante".
 *
 * A especificação chama esta de a tela mais usada do sistema, e o critério dela é
 * uma frase só. Então ela não tem filtro, não tem busca e não tem coluna de valor:
 * tem a lista na ordem em que o trabalho precisa ser feito, e um botão por pedido.
 *
 * No fim, colapsada, a conferência de repasse — que é onde aparecem as taxas que
 * não estavam na conta. Fica aqui, e não em tela própria, porque é a mesma pessoa
 * no mesmo momento: quem confere a postagem do dia é quem nota que o repasse veio
 * diferente.
 */
import type { Metadata } from 'next';
import { lerAmbiente } from '@/config/ambiente';
import { resumoDaFila } from '@/dominio/pedidos/fila-do-dia';
import { RepositorioDePedidos } from '@/dominio/pedidos/repositorio';
import { carregarPerfil } from '@/dominio/perfil';
import { banco } from '@/infra/banco/cliente';
import { descreverAviso } from './apresentacao';
import { AvisoDaAcao, Divergencias, Fila, Painel } from './componentes';
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

  const [fila, divergencias] = await Promise.all([
    repo.filaDoDia(perfil.id, agora, LIMITE_DA_FILA),
    repo.divergenciasDeRepasse(perfil.id, LIMITE_DE_DIVERGENCIAS),
  ]);

  const codigo = Array.isArray(parametros['r']) ? parametros['r'][0] : parametros['r'];
  const aviso = descreverAviso(codigo);

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

      <Painel fila={fila} />

      <section aria-labelledby="fila-titulo" className={estilo.secao}>
        <h2 className={estilo.secaoTitulo} id="fila-titulo">
          Fila
        </h2>
        <Fila fila={fila} />
      </section>

      <section aria-labelledby="repasse-titulo" className={estilo.secao}>
        <h2 className={estilo.secaoTitulo} id="repasse-titulo">
          Conferência de repasse
        </h2>
        <Divergencias divergencias={divergencias} />
      </section>
    </main>
  );
}
