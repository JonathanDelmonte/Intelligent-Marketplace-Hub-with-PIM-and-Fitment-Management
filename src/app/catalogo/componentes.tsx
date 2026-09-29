/**
 * As peças de servidor da Catálogo e preço: o que não muda enquanto a pessoa mexe. O que
 * muda (os números, a tabela, o simulador) roda no navegador, em `painel.tsx` e
 * `simulador.tsx`.
 *
 * Formulário é ação de servidor, e funciona sem JavaScript no navegador.
 */
import Link from 'next/link';
import type { ReactNode } from 'react';
import type { SkuGravado } from '@/dominio/catalogo/sku';
import { ROTULO_DO_CAMPO, estadoFiscal } from '@/dominio/fiscal/codigos';
import { PLATAFORMAS, type Plataforma } from '@/dominio/precificacao/tipos';
import { centavos, formatarBRL } from '@/lib/dinheiro';
import { contagem } from '@/lib/texto';
import { CAMINHO as CAMINHO_FISCAL } from '../fiscal/constantes';
import { CAMINHO as CAMINHO_DE_JUNTAR } from '../juntar-iguais/constantes';
import { IDENTIDADE_DA_LOJA } from '../lojas/identidade';
import { Selo } from '../lojas/selo';
import { ROTULO_DA_PLATAFORMA } from '../ui/rotulos';
import { criarProduto, desativarProduto, reativarProduto, salvarFicha } from './acoes';
import type { Aviso } from './apresentacao';
import estilo from './catalogo.module.css';
import { CAMINHO, CAMINHO_DO_NOVO } from './constantes';
import {
  SinalAlerta,
  SinalAvancar,
  SinalCaixa,
  SinalCerto,
  SinalEtiqueta,
  SinalMais,
  SinalMoedas,
} from '../ui/sinais';

// ─── Peças de toda a tela ────────────────────────────────────────────────────

/** O aviso depois de uma ação: uma faixa, com o sinal do tom. */
export function AvisoDaAcao({ aviso }: { readonly aviso: Aviso }) {
  const classe =
    aviso.tom === 'erro'
      ? estilo.avisoErro
      : aviso.tom === 'atencao'
        ? estilo.avisoAtencao
        : estilo.avisoOk;
  return (
    <p className={classe} role="status">
      <span className={estilo.avisoSinal}>
        {aviso.tom === 'ok' ? <SinalCerto /> : <SinalAlerta />}
      </span>
      <span>
        <strong className={estilo.avisoTitulo}>{aviso.titulo}</strong>
        {aviso.corpo === null ? null : <> {aviso.corpo}</>}
      </span>
    </p>
  );
}

/** O caminho até aqui, das telas de dentro: "Catálogo e preço › Refil…". */
export function Migalha({ atual }: { readonly atual: string }) {
  return (
    <nav aria-label="Caminho" className={estilo.migalha}>
      <Link className={estilo.migalhaLink} href={CAMINHO}>
        Catálogo e preço
      </Link>
      <SinalAvancar tamanho={12} />
      <span aria-current="page" className={estilo.migalhaAtual}>
        {atual}
      </span>
    </nav>
  );
}

/** O lugar da foto do produto, enquanto o sistema não guarda foto. */
export function Miniatura({ grande = false }: { readonly grande?: boolean }) {
  return (
    <span aria-hidden="true" className={grande ? estilo.miniaturaGrande : estilo.miniatura}>
      <SinalCaixa tamanho={grande ? 26 : 18} />
    </span>
  );
}

/** Um cartão da coluna do produto: título curto e o conteúdo. */
export function Cartao({
  id,
  titulo,
  children,
}: {
  readonly id: string;
  readonly titulo: string;
  readonly children: ReactNode;
}) {
  return (
    <section aria-labelledby={`${id}-titulo`} className={estilo.cartao} id={id}>
      <h2 className={estilo.tituloDoCartao} id={`${id}-titulo`}>
        {titulo}
      </h2>
      {children}
    </section>
  );
}

// ─── A lista ─────────────────────────────────────────────────────────────────

/** O botão do alto da lista, para a tela de cadastro. */
export function BotaoDeCadastrar() {
  return (
    <Link className={estilo.botao} href={CAMINHO_DO_NOVO}>
      <SinalMais tamanho={14} />
      Cadastrar produto
    </Link>
  );
}

/** Os três passos do começo, com o ícone de cada um. */
const PASSOS: readonly {
  readonly icone: ReactNode;
  readonly titulo: string;
  readonly texto: string;
}[] = [
  {
    icone: <SinalCaixa />,
    titulo: 'Cadastre o produto',
    texto: 'O nome que você usa no dia a dia para reconhecer a peça.',
  },
  {
    icone: <SinalMoedas />,
    titulo: 'Diga quanto paga',
    texto: 'O custo de uma unidade, com o frete do fornecedor, se você paga.',
  },
  {
    icone: <SinalEtiqueta />,
    titulo: 'Veja quanto cobrar',
    texto: 'O preço de cada loja para você ganhar a meta que escolher.',
  },
];

/** O exemplo da tabela pronta, desenhado: mostra o que vem, em vez de explicar. */
const EXEMPLO: readonly { readonly loja: Plataforma; readonly preco: string }[] = [
  { loja: 'ml', preco: 'R$ 39,90' },
  { loja: 'shopee', preco: 'R$ 37,50' },
  { loja: 'amazon', preco: 'R$ 41,20' },
];

/**
 * O catálogo vazio: a primeira pergunta, com o campo ali mesmo, e ao lado o desenho da
 * tabela que ela vai virar.
 *
 * É o que o dono vê no primeiro dia. Mostrar a tabela pronta, com um produto de exemplo,
 * explica em um olhar o que três parágrafos explicariam mal.
 */
export function CatalogoVazio() {
  return (
    <>
      <section aria-labelledby="primeiro-titulo" className={estilo.vazio}>
        <div className={estilo.vazioPergunta}>
          <p className={estilo.sobretitulo}>Primeiro passo</p>
          <h2 className={estilo.vazioTitulo} id="primeiro-titulo">
            Qual é o primeiro produto que você vende?
          </h2>
          <p className={estilo.vazioTexto}>
            Comece por um. Depois você diz quanto paga, e a tabela mostra quanto cobrar em cada
            loja.
          </p>
          <FormularioDeProduto />
        </div>
        <div aria-hidden="true" className={estilo.vazioDesenho}>
          <div className={estilo.exemplo}>
            <div className={estilo.exemploCabeca}>
              <span>Produto</span>
              <span className={estilo.exemploNumero}>Você paga</span>
              {EXEMPLO.map(({ loja }) => (
                <span className={estilo.exemploLoja} key={loja}>
                  <Selo identidade={IDENTIDADE_DA_LOJA[loja]} tamanho={14} />
                  {ROTULO_DA_PLATAFORMA[loja]}
                </span>
              ))}
            </div>
            <div className={estilo.exemploLinha}>
              <span className={estilo.exemploProduto}>
                <Miniatura />
                <span className={estilo.exemploNome}>
                  Refil de purificador
                  <span className={estilo.exemploDetalhe}>Seu produto aqui</span>
                </span>
              </span>
              <span className={estilo.exemploNumero}>R$ 18,40</span>
              {EXEMPLO.map(({ loja, preco }) => (
                <span className={estilo.exemploPreco} key={loja}>
                  {preco}
                </span>
              ))}
            </div>
            {[0, 1].map((fantasma) => (
              <div className={estilo.exemploFantasma} key={fantasma}>
                <span className={estilo.exemploProduto}>
                  <span className={estilo.exemploQuadro} />
                  <span className={estilo.exemploRisco} />
                </span>
                <span className={estilo.exemploRiscoCurto} />
                {PLATAFORMAS.map((loja) => (
                  <span className={estilo.exemploRiscoCurto} key={loja} />
                ))}
              </div>
            ))}
          </div>
          <p className={estilo.exemploLegenda}>
            Assim fica a sua tabela: o preço de cada loja para você ganhar o que quer.
          </p>
        </div>
      </section>

      <ol className={estilo.passos}>
        {PASSOS.map((passo, indice) => (
          <li className={estilo.passo} key={passo.titulo}>
            <span className={estilo.passoTopo}>
              <span className={estilo.icone}>{passo.icone}</span>
              <span className={estilo.passoNumero}>{indice + 1}</span>
            </span>
            <strong className={estilo.passoTitulo}>{passo.titulo}</strong>
            <span className={estilo.passoTexto}>{passo.texto}</span>
          </li>
        ))}
      </ol>

      <p className={estilo.vazioRodape}>
        Já importou planilha de anúncios? Os anúncios parecidos viram produto em{' '}
        <Link className={estilo.link} href={CAMINHO_DE_JUNTAR}>
          Juntar iguais
        </Link>
        .
      </p>
    </>
  );
}

/** Os desativados, recolhidos no pé da lista: estão lá para voltar, não para trabalhar. */
export function Desativados({ produtos }: { readonly produtos: readonly SkuGravado[] }) {
  if (produtos.length === 0) return null;
  return (
    <details className={estilo.desativados}>
      <summary className={estilo.resumo}>
        {contagem(produtos.length, 'produto desativado', 'produtos desativados')}
      </summary>
      <ul className={estilo.desativadosLista}>
        {produtos.map((produto) => (
          <li key={produto.id}>
            <Link className={estilo.link} href={`${CAMINHO}/${produto.id}`}>
              {produto.tituloInterno}
            </Link>
          </li>
        ))}
      </ul>
    </details>
  );
}

/** Pares esperando decisão em Juntar iguais. Nada quando não há, para o pé ficar quieto. */
export function ParesEsperando({ pendentes }: { readonly pendentes: number | null }) {
  if (pendentes === null || pendentes === 0) return null;
  return (
    <p className={estilo.pares}>
      {pendentes === 1
        ? '1 par de anúncios pode ser o mesmo produto. '
        : `${String(pendentes)} pares de anúncios podem ser o mesmo produto. `}
      <Link className={estilo.link} href={CAMINHO_DE_JUNTAR}>
        Decidir em Juntar iguais
      </Link>
    </p>
  );
}

// ─── Cadastrar ───────────────────────────────────────────────────────────────

/**
 * O cadastro: o nome é a pergunta, e o resto é opcional e diz que é.
 *
 * `tituloInicial` e `plataforma` chegam quando outra tela pede o cadastro (o "Publicar
 * em" do garimpo). A loja vai escondida e volta na conta do produto criado.
 */
export function FormularioDeProduto({
  tituloInicial = '',
  plataforma,
}: {
  readonly tituloInicial?: string;
  readonly plataforma?: Plataforma | undefined;
} = {}) {
  return (
    <form action={criarProduto} className={estilo.formulario}>
      {plataforma === undefined ? null : (
        <input name="plataforma" type="hidden" value={plataforma} />
      )}
      <label className={estilo.campo}>
        <span className={estilo.rotuloDoCampo}>Nome do produto</span>
        <input
          className={estilo.entradaGrande}
          defaultValue={tituloInicial}
          maxLength={200}
          name="titulo"
          placeholder="Refil de purificador de água PA21G"
          required
          type="text"
        />
        <span className={estilo.ajuda}>
          O nome que você usa para reconhecer a peça. O título do anúncio é feito depois.
        </span>
      </label>

      <div className={estilo.doisCampos}>
        <label className={estilo.campo}>
          <span className={estilo.rotuloDoCampo}>
            Código de barras <span className={estilo.opcional}>se tiver</span>
          </span>
          <input
            className={estilo.entrada}
            inputMode="numeric"
            name="ean"
            placeholder="7898123456789"
            type="text"
          />
        </label>
        <label className={estilo.campo}>
          <span className={estilo.rotuloDoCampo}>
            Marca <span className={estilo.opcional}>se tiver</span>
          </span>
          <input className={estilo.entrada} maxLength={80} name="marca" type="text" />
        </label>
      </div>

      <p className={estilo.acoesDoFormulario}>
        <button className={estilo.botao} type="submit">
          Cadastrar produto
        </button>
      </p>
    </form>
  );
}

/** Ao lado do cadastro: os mesmos três passos do catálogo vazio, com o primeiro marcado. */
export function ComoFunciona() {
  return (
    <aside aria-labelledby="passos-titulo" className={estilo.cartao}>
      <h2 className={estilo.tituloDoCartao} id="passos-titulo">
        Como funciona
      </h2>
      <ol className={estilo.passosEmPe}>
        {PASSOS.map((passo, indice) => (
          <li
            aria-current={indice === 0 ? 'step' : undefined}
            className={estilo.passoEmPe}
            key={passo.titulo}
          >
            <span className={indice === 0 ? estilo.passoNumeroAtual : estilo.passoNumero}>
              {indice + 1}
            </span>
            <span className={estilo.passoTextos}>
              <strong className={estilo.passoTitulo}>{passo.titulo}</strong>
              <span className={estilo.passoTexto}>
                {indice === 0 ? 'Você está aqui.' : passo.texto}
              </span>
            </span>
          </li>
        ))}
      </ol>
    </aside>
  );
}

// ─── O produto ───────────────────────────────────────────────────────────────

/** Uma linha da ficha: o nome do campo e o valor, ou "não informado". */
function LinhaDaFicha({
  rotulo,
  valor,
}: {
  readonly rotulo: string;
  readonly valor: string | null;
}) {
  return (
    <div className={estilo.fichaLinha}>
      <dt className={estilo.fichaRotulo}>{rotulo}</dt>
      <dd className={valor === null ? estilo.fichaFalta : estilo.fichaValor}>
        {valor ?? 'não informado'}
      </dd>
    </div>
  );
}

function milimetrosEmCentimetros(mm: number): string {
  return (mm / 10).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
}

/**
 * A ficha, para ler, e o formulário, para mudar.
 *
 * Ler é o que se faz quase sempre, então a ficha aparece como lista, e o formulário fica
 * atrás de "Mudar a ficha". Abre sozinho quando a última tentativa de salvar voltou com
 * erro, para a pessoa não ter de achar onde estava.
 */
export function FichaDoProduto({
  sku,
  abrirFormulario,
}: {
  readonly sku: SkuGravado;
  readonly abrirFormulario: boolean;
}) {
  const caixa =
    sku.dimMm === null
      ? null
      : `${milimetrosEmCentimetros(sku.dimMm.comprimento)} × ${milimetrosEmCentimetros(sku.dimMm.largura)} × ${milimetrosEmCentimetros(sku.dimMm.altura)} cm`;
  return (
    <Cartao id="ficha" titulo="Ficha">
      <dl className={estilo.ficha}>
        <LinhaDaFicha rotulo="Marca" valor={sku.marca} />
        <LinhaDaFicha rotulo="Código de barras" valor={sku.ean} />
        <LinhaDaFicha
          rotulo="Peso com embalagem"
          valor={sku.pesoG === null ? null : `${String(sku.pesoG)} g`}
        />
        <LinhaDaFicha rotulo="Caixa" valor={caixa} />
        <LinhaDaFicha rotulo="Voltagem" valor={sku.voltagem} />
        <LinhaDaFicha rotulo="Medida que decide se encaixa" valor={sku.medida} />
        <LinhaDaFicha
          rotulo="Peças na embalagem"
          valor={sku.quantidadeEmbalagem === null ? null : String(sku.quantidadeEmbalagem)}
        />
        <LinhaDaFicha
          rotulo="Devolução esperada"
          valor={
            sku.taxaDevolucaoEsperadaBp === null
              ? null
              : `${(sku.taxaDevolucaoEsperadaBp / 100).toLocaleString('pt-BR')} de cada 100 vendas`
          }
        />
      </dl>
      <details className={estilo.mudar} open={abrirFormulario}>
        <summary className={estilo.resumo}>Mudar a ficha</summary>
        <FormularioDaFicha sku={sku} />
      </details>
    </Cartao>
  );
}

/**
 * O formulário da ficha. Número é `type="text"` com `inputMode`: `type="number"` não
 * aceita vírgula, e 2,5 é como se escreve em português.
 */
function FormularioDaFicha({ sku }: { readonly sku: SkuGravado }) {
  return (
    <form action={salvarFicha} className={estilo.formularioDaFicha}>
      <input name="id" type="hidden" value={sku.id} />
      <label className={estilo.campo}>
        <span className={estilo.rotuloDoCampo}>Marca</span>
        <input
          className={estilo.entrada}
          defaultValue={sku.marca ?? ''}
          maxLength={80}
          name="marca"
          type="text"
        />
      </label>
      <label className={estilo.campo}>
        <span className={estilo.rotuloDoCampo}>Peso com embalagem, em gramas</span>
        <input
          className={estilo.entrada}
          defaultValue={sku.pesoG ?? ''}
          inputMode="numeric"
          name="pesoG"
          placeholder="420"
          type="text"
        />
      </label>
      <fieldset className={estilo.grupoDeCampos}>
        <legend className={estilo.rotuloDoCampo}>
          Caixa, em milímetros: os três lados, ou nenhum
        </legend>
        <div className={estilo.tresCampos}>
          {(
            [
              ['comprimento', 'Comprimento'],
              ['largura', 'Largura'],
              ['altura', 'Altura'],
            ] as const
          ).map(([nome, rotulo]) => (
            <label className={estilo.campo} key={nome}>
              <span className={estilo.rotuloMiudo}>{rotulo}</span>
              <input
                className={estilo.entrada}
                defaultValue={sku.dimMm?.[nome] ?? ''}
                inputMode="decimal"
                name={nome}
                type="text"
              />
            </label>
          ))}
        </div>
      </fieldset>
      <label className={estilo.campo}>
        <span className={estilo.rotuloDoCampo}>Voltagem</span>
        <input
          className={estilo.entrada}
          defaultValue={sku.voltagem ?? ''}
          maxLength={60}
          name="voltagem"
          placeholder="Bivolt"
          type="text"
        />
      </label>
      <label className={estilo.campo}>
        <span className={estilo.rotuloDoCampo}>Medida que decide se encaixa</span>
        <input
          className={estilo.entrada}
          defaultValue={sku.medida ?? ''}
          maxLength={120}
          name="medida"
          placeholder="Rosca de 1/2 polegada"
          type="text"
        />
      </label>
      <div className={estilo.doisCampos}>
        <label className={estilo.campo}>
          <span className={estilo.rotuloDoCampo}>Peças na embalagem</span>
          <input
            className={estilo.entrada}
            defaultValue={sku.quantidadeEmbalagem ?? ''}
            inputMode="numeric"
            name="quantidade"
            placeholder="1"
            type="text"
          />
        </label>
        <label className={estilo.campo}>
          <span className={estilo.rotuloDoCampo}>Devolução, de cada 100 vendas</span>
          <input
            className={estilo.entrada}
            defaultValue={
              sku.taxaDevolucaoEsperadaBp === null
                ? ''
                : String(sku.taxaDevolucaoEsperadaBp / 100).replace('.', ',')
            }
            inputMode="decimal"
            name="devolucao"
            placeholder="2"
            type="text"
          />
        </label>
      </div>
      <p className={estilo.acoesDoFormulario}>
        <button className={estilo.botao} type="submit">
          Salvar a ficha
        </button>
      </p>
    </form>
  );
}

/** Os três códigos da nota, e o que falta, com o caminho para a tela Fiscal. */
export function NotaFiscal({ sku }: { readonly sku: SkuGravado }) {
  const estado = estadoFiscal({
    ncm: sku.ncm,
    cest: null,
    cst: sku.cst,
    cclasstrib: sku.cclasstrib,
  });
  const campos = [
    ['ncm', sku.ncm],
    ['cst', sku.cst],
    ['cclasstrib', sku.cclasstrib],
  ] as const;
  return (
    <Cartao id="fiscal" titulo="Nota fiscal">
      <dl className={estilo.ficha}>
        {campos.map(([campo, valor]) => (
          <LinhaDaFicha
            key={campo}
            rotulo={ROTULO_DO_CAMPO[campo]}
            valor={valor === null || valor.trim() === '' ? null : valor}
          />
        ))}
      </dl>
      <p className={estado.prontoPara2027 ? estilo.fiscalPronto : estilo.fiscalFalta}>
        <span className={estilo.fiscalSinal}>
          {estado.prontoPara2027 ? <SinalCerto tamanho={14} /> : <SinalAlerta tamanho={14} />}
        </span>
        {estado.prontoPara2027
          ? 'Pronto para a nota de 2027.'
          : 'A partir de janeiro de 2027, nota sem esses códigos é recusada.'}
      </p>
      {sku.ativo ? (
        <Link
          className={estilo.botaoSecundario}
          href={`${CAMINHO_FISCAL}?${new URLSearchParams({ produto: sku.id }).toString()}`}
        >
          Preencher na tela Fiscal
        </Link>
      ) : null}
    </Cartao>
  );
}

/** Onde este produto apareceu em anúncios e planilhas. Recolhido: é consulta, não trabalho. */
export function VistoEm({
  ocorrencias,
}: {
  readonly ocorrencias: readonly {
    readonly id: string;
    readonly tituloBruto: string;
    readonly preco: number | null;
    readonly plataformaOuSite: string | null;
    readonly url: string | null;
  }[];
}) {
  if (ocorrencias.length === 0) return null;
  return (
    <details className={estilo.cartaoRecolhido}>
      <summary className={estilo.resumoDoCartao}>
        Visto em {contagem(ocorrencias.length, 'anúncio', 'anúncios')}
      </summary>
      <ul className={estilo.vistoEm}>
        {ocorrencias.map((o) => (
          <li className={estilo.vistoEmItem} key={o.id}>
            {o.url === null ? (
              <span>{o.tituloBruto}</span>
            ) : (
              <a className={estilo.link} href={o.url} rel="noreferrer nofollow" target="_blank">
                {o.tituloBruto}
              </a>
            )}
            <span className={estilo.vistoEmDetalhe}>
              {o.plataformaOuSite ?? 'origem não informada'}
              {o.preco === null ? '' : ` · ${formatarBRL(centavos(o.preco))}`}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

/**
 * Parar de vender. Sem confirmação, de propósito: voltar custa o mesmo clique, e fica no
 * alto da página seguinte.
 */
export function PararDeVender({ id }: { readonly id: string }) {
  return (
    <form action={desativarProduto} className={estilo.parar}>
      <input name="id" type="hidden" value={id} />
      <button className={estilo.botaoDiscreto} type="submit">
        Parar de vender este produto
      </button>
      <span className={estilo.ajuda}>Ele sai das listas e volta quando você quiser.</span>
    </form>
  );
}

/** O aviso de produto desativado, com a volta no mesmo lugar. */
export function ProdutoDesativado({ id }: { readonly id: string }) {
  return (
    <form action={reativarProduto} className={estilo.desativado}>
      <input name="id" type="hidden" value={id} />
      <span>
        <strong>Este produto está desativado.</strong> Não aparece na tabela, nos anúncios nem na
        nota fiscal.
      </span>
      <button className={estilo.botao} type="submit">
        Reativar
      </button>
    </form>
  );
}
