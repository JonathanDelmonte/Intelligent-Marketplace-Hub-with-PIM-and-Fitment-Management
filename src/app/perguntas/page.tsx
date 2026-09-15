/**
 * Tela de perguntas de comprador (M16).
 *
 * A pergunta que ela responde: **qual anúncio está pedindo conserto?** Uma pergunta
 * respondida no privado ensina uma pessoa; a mesma dúvida repetida cinco vezes é o
 * anúncio informando o que falta nele.
 *
 * As perguntas ficam guardadas de propósito. A conta de repetição precisa de
 * histórico — cinco não chegam de uma vez, chegam ao longo de semanas —, e é por isso
 * que a tela tem caixa de colar em vez de processar e esquecer.
 *
 * O envio da resposta continua manual (é o que a especificação pede no começo): esta
 * tela diz o que escrever na descrição, e a de compatibilidade monta a resposta de uma
 * pergunta específica.
 */
import type { Metadata } from 'next';
import { lerAmbiente } from '@/config/ambiente';
import { carregarPerfil } from '@/dominio/perfil';
import { duvidasRecorrentes } from '@/dominio/posvenda/recorrente';
import { RepositorioDePerguntas } from '@/dominio/posvenda/repositorio';
import { banco } from '@/infra/banco/cliente';
import { descreverAviso, inteiroDaUrl, resumoDasDuvidas } from './apresentacao';
import { AvisoDaAcao, Duvidas, FormularioDeColar, PerguntasCruas } from './componentes';
import { JANELA_DIAS, LIMITE_DE_PERGUNTAS } from './constantes';
import estilo from './perguntas.module.css';

export const metadata: Metadata = { title: 'Perguntas de comprador' };

/** Sempre dinâmica: pré-renderizar exigiria banco durante o `build`. */
export const dynamic = 'force-dynamic';

export default async function PaginaDePerguntas({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const parametros = await searchParams;
  const db = banco();
  const perfil = await carregarPerfil(db, lerAmbiente().BANCADA_PERFIL_PADRAO);

  const agora = new Date();
  const perguntas = await new RepositorioDePerguntas(db).recentes(perfil.id, {
    dias: JANELA_DIAS,
    limite: LIMITE_DE_PERGUNTAS,
    agora,
  });

  const duvidas = duvidasRecorrentes(perguntas);

  const codigo = Array.isArray(parametros['r']) ? parametros['r'][0] : parametros['r'];
  const aviso = descreverAviso(codigo, inteiroDaUrl(parametros['n']));

  return (
    <main className={estilo.pagina}>
      <header className={estilo.cabecalho}>
        <h1 className={estilo.titulo}>Perguntas de comprador</h1>
        <p className={estilo.subtitulo}>
          A mesma dúvida repetida não é falta de atenção de quem pergunta: é o anúncio dizendo o que
          falta nele. Aqui as perguntas ficam guardadas, e a que repetir cinco vezes nos últimos{' '}
          {JANELA_DIAS} dias vira uma linha para acrescentar na descrição.
        </p>
        <p className={estilo.resumo}>
          {resumoDasDuvidas({ duvidas, perguntasNaJanela: perguntas.length })}
        </p>
      </header>

      {aviso !== null && <AvisoDaAcao aviso={aviso} />}

      <section aria-labelledby="duvidas-titulo" className={estilo.secao}>
        <h2 className={estilo.secaoTitulo} id="duvidas-titulo">
          O que acrescentar ao anúncio
        </h2>
        <Duvidas duvidas={duvidas} />
      </section>

      <section aria-labelledby="colar-titulo" className={estilo.secao}>
        <h2 className={estilo.secaoTitulo} id="colar-titulo">
          Colar perguntas
        </h2>
        <FormularioDeColar />
        <PerguntasCruas agora={agora} perguntas={perguntas} />
      </section>
    </main>
  );
}
