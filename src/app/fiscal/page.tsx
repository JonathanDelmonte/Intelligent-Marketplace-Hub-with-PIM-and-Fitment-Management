/**
 * Tela fiscal (M12) — o que a virada de janeiro vai exigir.
 *
 * Cinco entregas numa tela, e a razão de estarem juntas é que são o mesmo trabalho
 * com o mesmo prazo: os prazos de 2027 (9.4), o teto do MEI (9.3), o emissor de nota
 * recomendado, o cadastro de NCM/CST/cClassTrib item por item (9.2) e a marcação de
 * categoria regulada (9.6).
 *
 * ## A ordem da tela é a ordem da urgência
 *
 * Prazo primeiro, porque é o que dá contexto a todo o resto — sem a data, "falta
 * cClassTrib em 12 produtos" é uma pendência sem prazo, e pendência sem prazo não é
 * feita. Depois o teto, que é o único item aqui que pode mudar o regime no meio do
 * ano. Depois o emissor, que é uma decisão só e um bloco curto — no fim, ficaria
 * enterrado embaixo de duzentos cartões de produto. Por último o cadastro, que é o
 * trabalho em si.
 *
 * ## O formulário de cada item fica aberto
 *
 * Não atrás de um clique. O cadastro fiscal é feito de uma vez, item por item, com a
 * tabela de NCM aberta em outra aba — e um clique por item, vezes duzentos itens, é o
 * que faz a pessoa fechar a tela e deixar para janeiro.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { z } from 'zod';
import { lerAmbiente } from '@/config/ambiente';
import { recomendarEmissor } from '@/dominio/fiscal/emissor';
import { avaliarPrazos } from '@/dominio/fiscal/prazos';
import { RepositorioFiscal } from '@/dominio/fiscal/repositorio';
import { carregarPerfil } from '@/dominio/perfil';
import { RepositorioDoNegocio, inicioDaJanelaDoMes } from '@/dominio/perfil/negocio';
import { banco } from '@/infra/banco/cliente';
import { descreverAviso, resumoDoCadastro } from './apresentacao';
import { AvisoDaAcao, Cadastro, Emissor, Prazos, Teto, type SugestaoNaTela } from './componentes';
import { CAMINHO as CAMINHO_DO_CATALOGO } from '../catalogo/constantes';
import { CAMINHO } from './constantes';
import estilo from './fiscal.module.css';

export const metadata: Metadata = { title: 'Fiscal' };

/** Sempre dinâmica: prazo e teto dependem da data de hoje. */
export const dynamic = 'force-dynamic';

export default async function PaginaFiscal({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const parametros = await searchParams;
  const db = banco();
  const perfil = await carregarPerfil(db, lerAmbiente().BANCADA_PERFIL_PADRAO);
  const repo = new RepositorioFiscal(db);

  // A hora é lida uma vez: duas leituras na mesma renderização podem cair em lados
  // diferentes da virada do dia, e aí o prazo do painel não fecha com o do teto.
  const agora = new Date();
  const ano = agora.getFullYear();

  const negocio = new RepositorioDoNegocio(db);
  const [resumo, teto, dadosDoNegocio, vendasNoMes] = await Promise.all([
    repo.resumo(perfil.id),
    repo.teto(perfil.id, ano, agora),
    negocio.ler(perfil.id),
    negocio.vendasPorPlataforma(perfil.id, inicioDaJanelaDoMes(agora)),
  ]);
  const prazos = avaliarPrazos({ agora, regime: resumo.regime });
  const emissor = recomendarEmissor({
    regime: resumo.regime,
    documento: dadosDoNegocio?.documento ?? null,
    inscricaoEstadual: dadosDoNegocio?.inscricaoEstadual ?? null,
    uf: dadosDoNegocio?.uf ?? null,
    certificadoValidoAte: dadosDoNegocio?.certificadoValidoAte ?? null,
    vendasNoMes,
    agora,
  });

  const um = (chave: string): string | undefined => {
    const valor = parametros[chave];
    return Array.isArray(valor) ? valor[0] : valor;
  };

  const aviso = descreverAviso(um('r'), um('motivo'));

  // Focada num produto: é como a ficha do catálogo abre esta tela. Só o cartão dele e o
  // caminho de volta — prazo e teto continuam na tela inteira, a um clique. Produto
  // desativado não está no resumo, e aí o foco é ignorado em vez de mostrar tela vazia.
  const idDoFoco = z.string().uuid().safeParse(um('produto'));
  const focado = idDoFoco.success ? resumo.skus.find((s) => s.id === idDoFoco.data) : undefined;

  // A sugestão vem da URL e vale só para o item classificado. Pré-preencher o campo
  // de outro produto com o NCM de um produto diferente seria a pior coisa que esta
  // tela poderia fazer.
  const skuSugerido = um('sugerido');
  const sugestao: SugestaoNaTela | null =
    skuSugerido === undefined
      ? null
      : {
          skuId: skuSugerido,
          ncm: um('ncm') ?? null,
          cest: um('cest') ?? null,
          porque: um('porque') ?? null,
        };

  return (
    <main className={estilo.pagina}>
      <header className={estilo.cabecalho}>
        <h1 className={estilo.titulo}>Fiscal</h1>
        <p className={estilo.subtitulo}>
          O que a virada de janeiro de 2027 vai exigir, e o que dá para fazer com calma agora. Esse
          cadastro com 20 produtos é uma tarde; com 200 no meio da operação é uma semana perdida.
        </p>
      </header>

      {aviso !== null && <AvisoDaAcao aviso={aviso} />}

      {focado !== undefined && (
        <section aria-labelledby="cadastro-titulo" className={estilo.secao}>
          <h2 className={estilo.secaoTitulo} id="cadastro-titulo">
            Cadastro fiscal deste produto
          </h2>
          <p className={estilo.resumo}>
            <Link className={estilo.link} href={`${CAMINHO_DO_CATALOGO}/${focado.id}`}>
              ← Voltar ao produto
            </Link>
            {' · '}
            <Link className={estilo.link} href={CAMINHO}>
              Ver todos, com prazos e teto
            </Link>
          </p>
          <Cadastro foco={focado.id} resumo={{ ...resumo, skus: [focado] }} sugestao={sugestao} />
        </section>
      )}

      {focado === undefined && (
        <>
          <section aria-labelledby="prazos-titulo" className={estilo.secao}>
            <h2 className={estilo.secaoTitulo} id="prazos-titulo">
              Prazos
            </h2>
            <Prazos prazos={prazos} />
          </section>

          <section aria-labelledby="teto-titulo" className={estilo.secao}>
            <h2 className={estilo.secaoTitulo} id="teto-titulo">
              Teto do ano
            </h2>
            <Teto ano={ano} regime={resumo.regime} teto={teto} />
          </section>

          <section aria-labelledby="emissor-titulo" className={estilo.secao} id="emissor">
            <h2 className={estilo.secaoTitulo} id="emissor-titulo">
              Emissor de nota fiscal
            </h2>
            <Emissor recomendacao={emissor} />
          </section>

          <section aria-labelledby="cadastro-titulo" className={estilo.secao}>
            <h2 className={estilo.secaoTitulo} id="cadastro-titulo">
              Cadastro fiscal por produto
            </h2>
            <p className={estilo.resumo}>{resumoDoCadastro(resumo)}</p>
            <Cadastro resumo={resumo} sugestao={sugestao} />
          </section>
        </>
      )}
    </main>
  );
}
