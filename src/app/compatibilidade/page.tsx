/**
 * Tela de compatibilidade — "em que aparelhos esta peça serve, e o quanto está
 * provado".
 *
 * É a tela do que a especificação chama de fosso. O que ela existe para não deixar
 * acontecer é o oposto do que parece: não é a ficha vazia, é a **ficha cheia de
 * palpite**. Compatibilidade errada em peça de reposição gera devolução, frete de
 * volta e reclamação — que em marketplace custa mais que a venda perdida. Então a
 * tela mostra, para cada linha, de onde veio a afirmação e o quanto ela vale, e o
 * corte de publicação é visível em vez de escondido num número.
 *
 * O vocabulário aqui é o de quem vende, não o do código: nenhum "job", nenhuma
 * "inferência", nenhum "ponto-base". Quem quiser os termos internos abre
 * `src/dominio/compatibilidade`.
 */
import type { Metadata } from 'next';
import { and, eq, sql } from 'drizzle-orm';
import { descreverAnalise, analisarModelo } from '@/dominio/compatibilidade/gramatica';
import { GRAMATICAS_SEMENTE } from '@/dominio/compatibilidade/gramaticas';
import { montarFicha, responder } from '@/dominio/compatibilidade/ficha';
import {
  RepositorioDeCompatibilidade,
  rotuloDoAparelho,
} from '@/dominio/compatibilidade/repositorio';
import { LIMIAR_PUBLICACAO_BP } from '@/dominio/compatibilidade/resolucao';
import { carregarPerfil } from '@/dominio/perfil';
import { lerAmbiente } from '@/config/ambiente';
import { banco } from '@/infra/banco/cliente';
import { sku } from '@/infra/banco/schema';
import { descreverAviso, emPorcento, estadoDaBase } from './apresentacao';
import {
  AvisoDaAcao,
  BotaoProcurar,
  Fila,
  FichaPublicavel,
  FormularioDeAparelho,
  ListaDeAparelhos,
  Painel,
  ResponderComprador,
  type LinhaDaFila,
} from './componentes';
import { LIMITE_DA_FILA, LIMITE_DE_APARELHOS } from './constantes';
import estilo from './compatibilidade.module.css';

export const metadata: Metadata = { title: 'Compatibilidade' };

/** Sempre dinâmica: pré-renderizar exigiria banco durante o `build`. */
export const dynamic = 'force-dynamic';

function inteiroDaUrl(valor: string | string[] | undefined): number | undefined {
  const texto = Array.isArray(valor) ? valor[0] : valor;
  if (texto === undefined) return undefined;
  const n = Number.parseInt(texto, 10);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

export default async function PaginaDeCompatibilidade({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const parametros = await searchParams;
  const db = banco();
  const perfil = await carregarPerfil(db, lerAmbiente().BANCADA_PERFIL_PADRAO);
  const repo = new RepositorioDeCompatibilidade(db);

  const [estado, fila, aparelhos, skus, emFoco] = await Promise.all([
    repo.estado(perfil.id),
    repo.fila(perfil.id, LIMITE_DA_FILA),
    repo.aparelhos(LIMITE_DE_APARELHOS),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(sku)
      .where(and(eq(sku.perfilId, perfil.id), eq(sku.ativo, true)))
      .then((linhas) => linhas[0]?.n ?? 0),
    repo.skuEmFoco(perfil.id),
  ]);

  // Uma ficha por tela, do produto com mais compatibilidade registrada. Seletor de
  // produto entra junto com a tela de catálogo, que é onde escolher vai fazer
  // sentido — está nas pendências.
  const linhasDaFicha = emFoco === null ? [] : await repo.doSku(emFoco.id);
  const ficha = montarFicha(linhasDaFicha);

  const bruta = Array.isArray(parametros['p']) ? parametros['p'][0] : parametros['p'];
  const pergunta = (bruta ?? '').trim();
  const resposta =
    pergunta === '' ? null : responder({ pergunta, compatibilidades: linhasDaFicha });

  const codigo = Array.isArray(parametros['r']) ? parametros['r'][0] : parametros['r'];
  const aviso = descreverAviso(codigo, inteiroDaUrl(parametros['n']));
  const diagnostico = estadoDaBase({
    aparelhos: estado.aparelhos,
    publicaveis: estado.publicaveis,
    emRevisao: estado.emRevisao,
    skus,
  });

  const linhas: readonly LinhaDaFila[] = fila.map((l) => ({
    skuId: l.skuId,
    aparelhoId: l.aparelhoId,
    skuTitulo: l.skuTitulo,
    aparelhoRotulo: rotuloDoAparelho(l.aparelho),
    aparelhoTipo: l.aparelho.tipo,
    decisao: l.decisao,
    confiancaBp: l.confiancaBp,
    conflito: l.conflito,
    evidencias: l.evidencias,
  }));

  const aparelhosNaTela = aparelhos.map((a) => {
    const analise = analisarModelo(a.marca, a.modelo, GRAMATICAS_SEMENTE);
    return {
      id: a.id,
      rotulo: rotuloDoAparelho(a),
      tipo: a.tipo,
      explicacao: analise.ok ? descreverAnalise(analise.analise) : null,
    };
  });

  return (
    <main className={estilo.pagina}>
      <header className={estilo.cabecalho}>
        <h1 className={estilo.titulo}>Em que aparelhos a peça serve</h1>
        <p className={estilo.subtitulo}>
          Na peça de reposição o comprador não pergunta preço, pergunta “serve no meu modelo?”. Quem
          responde certo vende sem disputar centavo — e quem responde errado paga frete de volta.
          Então aqui cada afirmação vem com a fonte, e só vai para o anúncio o que tem{' '}
          {emPorcento(LIMIAR_PUBLICACAO_BP)} ou mais de evidência e nenhuma fonte discordando.
        </p>
      </header>

      {aviso !== null && <AvisoDaAcao aviso={aviso} />}

      <Painel numeros={estado} />

      <section className={estilo.secao} aria-label="Procurar evidência">
        <BotaoProcurar />
      </section>

      <section className={estilo.secao} aria-labelledby="fila-titulo">
        <h2 className={estilo.secaoTitulo} id="fila-titulo">
          Esperando sua conferência
        </h2>
        {diagnostico !== null && <AvisoDaAcao aviso={diagnostico} />}
        <Fila linhas={linhas} />
      </section>

      {emFoco !== null && (
        <section aria-labelledby="ficha-titulo" className={estilo.secao}>
          <h2 className={estilo.secaoTitulo} id="ficha-titulo">
            Ficha de {emFoco.titulo}
          </h2>
          <FichaPublicavel ficha={ficha} />
        </section>
      )}

      {emFoco !== null && (
        <section aria-labelledby="responder-titulo" className={estilo.secao}>
          <h2 className={estilo.secaoTitulo} id="responder-titulo">
            Responder um comprador
          </h2>
          <ResponderComprador pergunta={pergunta} produto={emFoco.titulo} resposta={resposta} />
        </section>
      )}

      <section className={estilo.secao} aria-labelledby="aparelhos-titulo">
        <h2 className={estilo.secaoTitulo} id="aparelhos-titulo">
          Aparelhos que o sistema conhece
        </h2>
        <FormularioDeAparelho />
        <ListaDeAparelhos aparelhos={aparelhosNaTela} />
      </section>
    </main>
  );
}
