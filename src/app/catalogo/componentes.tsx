/**
 * As peças de servidor da Catálogo e preço: o que não precisa mudar enquanto a pessoa
 * mexe. A tabela de preços e o cupom, que mudam, estão em `tabela-de-precos.tsx` e
 * `conta-da-venda.tsx`.
 *
 * Formulário é ação de servidor, e funciona sem JavaScript no navegador.
 */
import Link from 'next/link';
import type { ReactNode } from 'react';
import type { SkuGravado } from '@/dominio/catalogo/sku';
import { ROTULO_DO_CAMPO, estadoFiscal } from '@/dominio/fiscal/codigos';
import type { Plataforma } from '@/dominio/precificacao/tipos';
import { centavos, centavosParaDigitar, formatarBRL } from '@/lib/dinheiro';
import { contagem } from '@/lib/texto';
import { CAMINHO as CAMINHO_FISCAL } from '../fiscal/constantes';
import { CAMINHO as CAMINHO_DE_JUNTAR } from '../juntar-iguais/constantes';
import { criarProduto, desativarProduto, reativarProduto, salvarCusto, salvarFicha } from './acoes';
import {
  alvoEmPercentual,
  PERGUNTA_DO_CUSTO_VELHO,
  textoDoCusto,
  type Aviso,
} from './apresentacao';
import estilo from './catalogo.module.css';
import { CAMINHO, CAMINHO_DO_NOVO } from './constantes';
import { SinalAlerta, SinalCerto, SinalVoltar } from './sinais';

/** O aviso depois de uma ação: uma linha, com o sinal do tom. */
export function AvisoDaAcao({ aviso }: { readonly aviso: Aviso }) {
  const classe =
    aviso.tom === 'erro'
      ? estilo.avisoErro
      : aviso.tom === 'atencao'
        ? estilo.avisoAtencao
        : estilo.aviso;
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

/** "‹ Catálogo e preço", o caminho de volta das telas de dentro. */
export function Voltar() {
  return (
    <Link className={estilo.voltar} href={CAMINHO}>
      <SinalVoltar />
      Catálogo e preço
    </Link>
  );
}

/** Um bloco da página do produto: título curto e o conteúdo, sem caixa em volta. */
export function Bloco({
  id,
  titulo,
  children,
  destaque = false,
}: {
  readonly id: string;
  readonly titulo: string;
  readonly children: ReactNode;
  readonly destaque?: boolean;
}) {
  return (
    <section aria-labelledby={id} className={destaque ? estilo.blocoDestaque : estilo.bloco}>
      <h2 className={estilo.blocoTitulo} id={id}>
        {titulo}
      </h2>
      {children}
    </section>
  );
}

// ─── A lista ─────────────────────────────────────────────────────────────────

/**
 * O catálogo vazio: a primeira pergunta, e não uma explicação.
 *
 * É o que o dono vê no primeiro dia. Em vez de dizer como o catálogo funciona, a tela
 * pergunta o que ele vende, com o campo ali mesmo.
 */
export function CatalogoVazio() {
  return (
    <section aria-labelledby="primeiro-titulo" className={estilo.vazio}>
      <h2 className={estilo.vazioTitulo} id="primeiro-titulo">
        Qual é o primeiro produto que você vende?
      </h2>
      <p className={estilo.vazioTexto}>
        Comece por um. Depois você diz quanto paga, e a tabela mostra quanto cobrar em cada loja.
      </p>
      <FormularioDeProduto />
      <p className={estilo.vazioRodape}>
        Já importou planilha de anúncios? Os anúncios parecidos viram produto em{' '}
        <Link className={estilo.link} href={CAMINHO_DE_JUNTAR}>
          Juntar iguais
        </Link>
        .
      </p>
    </section>
  );
}

/** Os desativados, recolhidos no pé da lista: estão lá para voltar, não para trabalhar. */
export function Desativados({ produtos }: { readonly produtos: readonly SkuGravado[] }) {
  if (produtos.length === 0) return null;
  return (
    <details className={estilo.desativados}>
      <summary className={estilo.desativadosResumo}>
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
        <span className={estilo.rotulo}>Nome do produto</span>
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

      <div className={estilo.linhaDeCampos}>
        <label className={estilo.campo}>
          <span className={estilo.rotulo}>
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
          <span className={estilo.rotulo}>
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

/** O botão do alto da lista, para a tela de cadastro. */
export function BotaoDeCadastrar() {
  return (
    <Link className={estilo.botao} href={CAMINHO_DO_NOVO}>
      Cadastrar produto
    </Link>
  );
}

// ─── O produto ───────────────────────────────────────────────────────────────

/**
 * Quanto a pessoa paga por uma unidade: a primeira pergunta da página do produto.
 *
 * Sem custo, ela vem em destaque e com o cursor no campo, porque sem ela a conta não sai.
 * A loja e o alvo escolhidos vão junto no formulário, para a página voltar do jeito que
 * estava depois de salvar.
 */
export function PerguntaDoCusto({
  sku,
  agora,
  plataforma,
  alvoBp,
}: {
  readonly sku: SkuGravado;
  readonly agora: Date;
  readonly plataforma: Plataforma;
  readonly alvoBp: number;
}) {
  const idade = textoDoCusto(sku.custoAtualizadoEm, agora);
  const semCusto = sku.custoAtual === null;
  return (
    <Bloco destaque={semCusto} id="custo" titulo="Você paga">
      <form action={salvarCusto} className={estilo.perguntaDoCusto}>
        <input name="id" type="hidden" value={sku.id} />
        <input name="plataforma" type="hidden" value={plataforma} />
        <input name="alvo" type="hidden" value={alvoEmPercentual(alvoBp)} />
        <label className={estilo.campoPergunta} htmlFor="custo-campo">
          Quanto você paga por uma unidade?
        </label>
        <span className={estilo.linhaDaPergunta}>
          <span className={estilo.campoDinheiro}>
            <span aria-hidden="true" className={estilo.moeda}>
              R$
            </span>
            <input
              autoFocus={semCusto}
              className={estilo.entradaDinheiro}
              defaultValue={
                sku.custoAtual === null ? '' : centavosParaDigitar(centavos(sku.custoAtual))
              }
              id="custo-campo"
              inputMode="decimal"
              name="custo"
              placeholder="0,00"
              required
              type="text"
            />
          </span>
          <button className={estilo.botao} type="submit">
            Salvar
          </button>
        </span>
        <span className={idade?.velho === true ? estilo.custoVelho : estilo.ajuda}>
          {idade === null
            ? 'Com o frete do fornecedor, se você paga. Sem isso, não dá para saber quanto sobra.'
            : `Valor ${idade.texto}.${idade.velho ? ` ${PERGUNTA_DO_CUSTO_VELHO}` : ''}`}
        </span>
      </form>
    </Bloco>
  );
}

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
    <Bloco id="ficha" titulo="Ficha">
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
        <summary className={estilo.mudarResumo}>Mudar a ficha</summary>
        <FormularioDaFicha sku={sku} />
      </details>
    </Bloco>
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
        <span className={estilo.rotulo}>Marca</span>
        <input
          className={estilo.entrada}
          defaultValue={sku.marca ?? ''}
          maxLength={80}
          name="marca"
          type="text"
        />
      </label>
      <label className={estilo.campo}>
        <span className={estilo.rotulo}>Peso com embalagem, em gramas</span>
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
        <legend className={estilo.rotulo}>Caixa, em milímetros: os três lados, ou nenhum</legend>
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
        <span className={estilo.rotulo}>Voltagem</span>
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
        <span className={estilo.rotulo}>Medida que decide se encaixa</span>
        <input
          className={estilo.entrada}
          defaultValue={sku.medida ?? ''}
          maxLength={120}
          name="medida"
          placeholder="Rosca de 1/2 polegada"
          type="text"
        />
      </label>
      <div className={estilo.linhaDeCampos}>
        <label className={estilo.campo}>
          <span className={estilo.rotulo}>Peças na embalagem</span>
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
          <span className={estilo.rotulo}>Devolução, de cada 100 vendas</span>
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
    <Bloco id="fiscal" titulo="Nota fiscal">
      <dl className={estilo.ficha}>
        {campos.map(([campo, valor]) => (
          <LinhaDaFicha
            key={campo}
            rotulo={ROTULO_DO_CAMPO[campo]}
            valor={valor === null || valor.trim() === '' ? null : valor}
          />
        ))}
      </dl>
      <p className={estado.prontoPara2027 ? estilo.ajuda : estilo.fichaAviso}>
        {estado.prontoPara2027
          ? 'Pronto para a nota de 2027.'
          : 'A partir de janeiro de 2027, nota sem esses códigos é recusada.'}
      </p>
      {sku.ativo ? (
        <p className={estilo.acoesDoBloco}>
          <Link
            className={estilo.botaoSecundario}
            href={`${CAMINHO_FISCAL}?${new URLSearchParams({ produto: sku.id }).toString()}`}
          >
            Preencher na tela Fiscal
          </Link>
        </p>
      ) : null}
    </Bloco>
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
    <details className={estilo.vistoEm}>
      <summary className={estilo.mudarResumo}>
        Visto em {contagem(ocorrencias.length, 'anúncio', 'anúncios')}
      </summary>
      <ul className={estilo.vistoEmLista}>
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
    <form action={reativarProduto} className={estilo.desativadoAviso}>
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
