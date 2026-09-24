/**
 * A área de uma loja (ADR 0009): o painel só dela, e o que ela pede de você.
 *
 * Uma tela para todas as lojas. O filtro é a plataforma da URL, e o que muda de uma
 * loja para outra — como conecta, o que oferece — vem do adaptador. Nenhuma linha aqui
 * pergunta qual loja é.
 *
 * Loja sem dado nenhum não é erro: o resumo vira os dois caminhos (planilha hoje,
 * integração quando a plataforma deixar), e as outras abas continuam abrindo — dá para
 * colar perguntas e ver o que a loja libera antes do primeiro pedido.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { lerAmbiente } from '@/config/ambiente';
import { estadoDaLoja } from '@/dominio/lojas/estado';
import { DIAS_DO_PAINEL, janelasDoPainel, somarPainel } from '@/dominio/lojas/painel';
import { RepositorioDeLojas } from '@/dominio/lojas/repositorio';
import { RepositorioDePedidos } from '@/dominio/pedidos/repositorio';
import { carregarPerfil } from '@/dominio/perfil';
import { duvidasRecorrentes } from '@/dominio/posvenda/recorrente';
import { RepositorioDePerguntas } from '@/dominio/posvenda/repositorio';
import { ehPlataforma } from '@/dominio/precificacao/tipos';
import { banco } from '@/infra/banco/cliente';
import { registroPadrao } from '@/plataformas/registro';
import { descreverAviso as avisoDaPerguntas, inteiroDaUrl } from '../../perguntas/apresentacao';
import {
  AvisoDaAcao as AvisoDasPerguntas,
  Duvidas,
  FormularioDeColar,
  PerguntasCruas,
} from '../../perguntas/componentes';
import { JANELA_DIAS, LIMITE_DE_PERGUNTAS } from '../../perguntas/constantes';
import { descreverAviso as avisoDaPostagem } from '../../postagem/apresentacao';
import { AvisoDaAcao as AvisoDaPostagem, Fila } from '../../postagem/componentes';
import { LIMITE_DA_FILA, LIMITE_DE_DIVERGENCIAS } from '../../postagem/constantes';
import { ROTULO_DA_PLATAFORMA, daLoja } from '../../ui/rotulos';
import { numerosDoPainel, pendenciasDaLoja } from '../apresentacao';
import { caminhoDaAba, lerAba } from '../caminhos';
import { Abas, CabecalhoDaLoja, Numeros, SemDados } from '../componentes';
import estilo from '../lojas.module.css';
import { AbaAnuncios, AbaConexao, AbaRepasse, AbaResumo } from './abas';

/** Sempre dinâmica: são números de agora, e pré-renderizar os congelaria. */
export const dynamic = 'force-dynamic';

type Parametros = Promise<{ readonly plataforma: string }>;

export async function generateMetadata({
  params,
}: {
  readonly params: Parametros;
}): Promise<Metadata> {
  const { plataforma } = await params;
  return { title: ehPlataforma(plataforma) ? ROTULO_DA_PLATAFORMA[plataforma] : 'Loja' };
}

function primeiro(valor: string | string[] | undefined): string | undefined {
  return Array.isArray(valor) ? valor[0] : valor;
}

export default async function PaginaDaLoja({
  params,
  searchParams,
}: {
  readonly params: Parametros;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { plataforma } = await params;
  if (!ehPlataforma(plataforma)) notFound();

  const busca = await searchParams;
  const aba = lerAba(busca['aba']);
  const codigo = primeiro(busca['r']);

  const db = banco();
  const perfil = await carregarPerfil(db, lerAmbiente().BANCADA_PERFIL_PADRAO);
  // Um `agora` para a tela inteira: a janela, a fila e as perguntas contam o mesmo dia.
  const agora = new Date();
  const janelas = janelasDoPainel(agora);
  const lojas = new RepositorioDeLojas(db);
  const pedidos = new RepositorioDePedidos(db);

  const [numeros, somasAtuais, somasAnteriores, fila, divergencias, perguntas] = await Promise.all([
    lojas.numeros(perfil.id),
    lojas.somas(perfil.id, janelas.atual),
    lojas.somas(perfil.id, janelas.anterior),
    pedidos.filaDoDia(perfil.id, agora, LIMITE_DA_FILA, plataforma),
    pedidos.divergenciasDeRepasse(perfil.id, LIMITE_DE_DIVERGENCIAS, plataforma),
    new RepositorioDePerguntas(db).recentes(perfil.id, {
      dias: JANELA_DIAS,
      limite: LIMITE_DE_PERGUNTAS,
      agora,
      plataforma,
    }),
  ]);

  const numerosDaLoja = numeros.find((n) => n.plataforma === plataforma) ?? {
    plataforma,
    pedidos: 0,
    ultimoPedidoEm: null,
    conectada: false,
  };
  const estado = estadoDaLoja(numerosDaLoja);
  const painel = somarPainel(somasAtuais.filter((s) => s.plataforma === plataforma));
  const anterior = somarPainel(somasAnteriores.filter((s) => s.plataforma === plataforma));
  const duvidas = duvidasRecorrentes(perguntas);

  const paraPostar = fila.porUrgencia.atrasado + fila.porUrgencia.hoje + fila.porUrgencia.sem_prazo;
  const pendencias = pendenciasDaLoja(plataforma, {
    postagem: {
      atrasados: fila.porUrgencia.atrasado,
      hoje: fila.porUrgencia.hoje,
      semPrazo: fila.porUrgencia.sem_prazo,
    },
    divergenciasDeRepasse: divergencias.length,
    pedidosSemCusto: painel.pedidosSemMargem,
    duvidasRecorrentes: duvidas.length,
  });

  const semDados = estado.tipo === 'sem_dados';
  const avisoDePostagem = aba === 'pedidos' || aba === 'repasse' ? avisoDaPostagem(codigo) : null;
  const avisoDePerguntas =
    aba === 'perguntas' ? avisoDaPerguntas(codigo, inteiroDaUrl(busca['n'])) : null;

  return (
    <main className={estilo.pagina}>
      <CabecalhoDaLoja estado={estado} plataforma={plataforma} />

      {!semDados && (
        <Numeros
          numeros={numerosDoPainel(painel, anterior, DIAS_DO_PAINEL)}
          titulo={`Números ${daLoja(plataforma)} nos últimos ${String(DIAS_DO_PAINEL)} dias`}
        />
      )}

      <Abas
        atual={aba}
        contagens={{
          pedidos: paraPostar,
          perguntas: duvidas.length,
          repasse: divergencias.length,
        }}
        plataforma={plataforma}
      />

      {avisoDePostagem !== null && <AvisoDaPostagem aviso={avisoDePostagem} />}
      {avisoDePerguntas !== null && <AvisoDasPerguntas aviso={avisoDePerguntas} />}

      {aba === 'resumo' &&
        (semDados ? (
          <SemDados
            comoConectar={
              registroPadrao({ plataformasComCredencial: [] }).de(plataforma).comoConectar
            }
            plataforma={plataforma}
          />
        ) : (
          <AbaResumo
            janela={janelas.atual}
            pendencias={pendencias}
            perfil={perfil.id}
            plataforma={plataforma}
          />
        ))}

      {aba === 'pedidos' && (
        <section className={estilo.bloco}>
          <div className={estilo.blocoCabecalho}>
            <h2 className={estilo.blocoTitulo}>Para postar</h2>
            <span className={estilo.blocoNota}>
              em ordem de prazo; todas as lojas juntas em Postar hoje
            </span>
          </div>
          <Fila fila={fila} voltar={caminhoDaAba(plataforma, 'pedidos')} />
        </section>
      )}

      {aba === 'anuncios' && <AbaAnuncios perfil={perfil.id} plataforma={plataforma} />}

      {aba === 'perguntas' && (
        <section className={estilo.bloco}>
          <div className={estilo.blocoCabecalho}>
            <h2 className={estilo.blocoTitulo}>O que acrescentar ao anúncio</h2>
            <span className={estilo.blocoNota}>
              dúvidas que se repetem nos últimos {JANELA_DIAS} dias
            </span>
          </div>
          <Duvidas duvidas={duvidas} />
          <h3 className={estilo.secaoTitulo}>Colar perguntas desta loja</h3>
          <FormularioDeColar loja={plataforma} voltar={caminhoDaAba(plataforma, 'perguntas')} />
          <PerguntasCruas agora={agora} perguntas={perguntas} />
          <p className={estilo.legenda}>
            Perguntas coladas sem dizer a loja ficam na lista geral, em{' '}
            <Link href="/perguntas">Perguntas de todas as lojas</Link>.
          </p>
        </section>
      )}

      {aba === 'repasse' && (
        <AbaRepasse divergencias={divergencias} perfil={perfil.id} plataforma={plataforma} />
      )}

      {aba === 'conexao' && (
        <AbaConexao conectada={numerosDaLoja.conectada} plataforma={plataforma} />
      )}
    </main>
  );
}
