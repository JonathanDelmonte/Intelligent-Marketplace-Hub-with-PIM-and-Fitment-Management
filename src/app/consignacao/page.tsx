/**
 * Tela de consignação (M11) — estoque que não é seu.
 *
 * A tela existe por causa de uma frase da especificação: "o risco é a loja vender
 * no balcão o que você tem anunciado". Então ela lidera pelo número que decide o
 * que fazer agora — unidades anunciadas sem conferência —, e não pela lista de
 * itens.
 *
 * ## Por que não é uma seção da tela de postagem
 *
 * A conferência de repasse mora em `/postagem` porque é a mesma pessoa no mesmo
 * momento: quem confere a postagem do dia é quem nota o repasse diferente.
 * Consignação é outra atividade, com outra cadência — semanal, e feita no balcão do
 * parceiro. Seção permanente na tela diária seria ruído todo dia para um trabalho
 * de toda semana.
 *
 * O que vai para a tela diária é só o aviso, e só quando há unidade em risco.
 */
import type { Metadata } from 'next';
import { lerAmbiente } from '@/config/ambiente';
import { RepositorioDeConsignacao } from '@/dominio/consignacao/repositorio';
import { mesDe } from '@/dominio/consignacao/fechamento';
import { RepositorioDeSku } from '@/dominio/catalogo/sku';
import { carregarPerfil } from '@/dominio/perfil';
import { banco } from '@/infra/banco/cliente';
import { descreverAviso, resumoDoQuadro } from './apresentacao';
import { AvisoDaAcao, Cadastro, FechamentoDoMes, Painel, Quadro } from './componentes';
import { LIMITE_DO_QUADRO } from './constantes';
import estilo from './consignacao.module.css';

export const metadata: Metadata = { title: 'Consignação' };

/** Sempre dinâmica: o estado da conferência depende da hora. */
export const dynamic = 'force-dynamic';

export default async function PaginaDeConsignacao({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const parametros = await searchParams;
  const db = banco();
  const perfil = await carregarPerfil(db, lerAmbiente().BANCADA_PERFIL_PADRAO);
  const repo = new RepositorioDeConsignacao(db);

  // A hora é lida uma vez e passada adiante: duas leituras de relógio na mesma
  // renderização podem cair em lados diferentes da virada do dia, e aí a contagem do
  // painel não fecha com a lista.
  const agora = new Date();
  const mes = mesDe(agora);

  const [quadro, fechamento, skus] = await Promise.all([
    repo.quadroDeConferencia(perfil.id, { agora }),
    repo.fechamento(perfil.id, mes.de, mes.ate),
    new RepositorioDeSku(db).listar(perfil.id, { limite: LIMITE_DO_QUADRO }),
  ]);

  const codigo = Array.isArray(parametros['r']) ? parametros['r'][0] : parametros['r'];
  const aviso = descreverAviso(codigo);

  return (
    <main className={estilo.pagina}>
      <header className={estilo.cabecalho}>
        <h1 className={estilo.titulo}>Consignação</h1>
        <p className={estilo.subtitulo}>
          Peça de parceiro que você anuncia como sua. O risco é a loja vender no balcão o que está
          anunciado aqui — daí a conferência, e daí ela ser por unidade exposta e não por data.
        </p>
        <p className={estilo.resumo}>{resumoDoQuadro(quadro)}</p>
      </header>

      {aviso !== null && <AvisoDaAcao aviso={aviso} />}

      <Painel quadro={quadro} />

      <section aria-labelledby="quadro-titulo" className={estilo.secao}>
        <h2 className={estilo.secaoTitulo} id="quadro-titulo">
          Conferir
        </h2>
        <Quadro quadro={quadro} />
      </section>

      <section aria-labelledby="fechamento-titulo" className={estilo.secao}>
        <h2 className={estilo.secaoTitulo} id="fechamento-titulo">
          Fechamento do mês
        </h2>
        <FechamentoDoMes fechamento={fechamento} />
        <p className={estilo.dica}>
          O repasse por unidade sai do acordo atual de cada linha. Não há histórico de preço
          acordado ainda, então mudar o acordo hoje muda este número — por isso a conta aparece
          aberta, parceiro por parceiro, em vez de só o total.
        </p>
      </section>

      <section aria-labelledby="cadastro-titulo" className={estilo.secao}>
        <h2 className={estilo.secaoTitulo} id="cadastro-titulo">
          Cadastrar item em consignação
        </h2>
        <Cadastro skus={skus.map((s) => ({ id: s.id, titulo: s.tituloInterno }))} />
      </section>
    </main>
  );
}
