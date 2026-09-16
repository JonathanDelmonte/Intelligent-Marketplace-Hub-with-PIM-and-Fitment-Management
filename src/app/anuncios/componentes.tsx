/**
 * Componentes da tela de anúncio.
 *
 * Todos de servidor e sem JavaScript no cliente. O formulário é **GET**, não ação de
 * servidor, e isso é a decisão central da tela: a montagem vira URL, então o link é
 * compartilhável, o botão de voltar funciona, e a rota que devolve o arquivo monta o
 * mesmo anúncio que a tela mostrou porque recebe os mesmos parâmetros.
 */
import type { Conferencia, ItemDaConferencia } from '@/dominio/anuncios/atributos';
import type { AnuncioMontado } from '@/dominio/anuncios/anuncio';
import type { AvaliacaoDeCatalogo } from '@/dominio/anuncios/catalogo';
import type { CandidatoAAnuncio } from '@/dominio/anuncios/repositorio';
import type { Ficha } from '@/dominio/compatibilidade/ficha';
import { PLATAFORMAS } from '@/dominio/precificacao/tipos';
import type { Plataforma } from '@/dominio/precificacao/tipos';
import { formatarBRL, type Centavos } from '@/lib/dinheiro';
import {
  descreverCandidato,
  resumoDaConferencia,
  resumoDoTitulo,
  rotuloDaExigencia,
  rotuloDoAtributo,
  textoDoCatalogo,
  tomDaExigencia,
  tomDoCatalogo,
  type Aviso,
} from './apresentacao';
import { salvarCategoria } from './acoes';
import { CAMINHO, CAMINHO_DO_ARQUIVO, QUANTIDADE_PADRAO } from './constantes';
import { ROTULO_DA_PLATAFORMA } from '../ui/rotulos';
import estilo from './anuncios.module.css';

/** Rótulo de cada plataforma. Nome de plataforma não é marca do sistema (ADR 0003). */
export function AvisoDaAcao({ aviso }: { readonly aviso: Aviso }) {
  const classe =
    aviso.tom === 'erro'
      ? `${estilo.aviso} ${estilo.avisoErro}`
      : aviso.tom === 'atencao'
        ? `${estilo.aviso} ${estilo.avisoAtencao}`
        : estilo.aviso;
  return (
    <div className={classe} role="status">
      <strong className={estilo.avisoTitulo}>{aviso.titulo}</strong>
      <span className={estilo.avisoCorpo}>{aviso.corpo}</span>
    </div>
  );
}

export interface ValoresDoFormulario {
  readonly skuId: string | null;
  readonly plataforma: Plataforma;
  readonly preco: string;
  readonly quantidade: number;
  readonly tipoProduto: string;
}

export function Formulario({
  candidatos,
  valores,
}: {
  readonly candidatos: readonly CandidatoAAnuncio[];
  readonly valores: ValoresDoFormulario;
}) {
  if (candidatos.length === 0) {
    return (
      <p className={estilo.vazio}>
        Nenhum produto no catálogo ainda. O anúncio é montado a partir de um SKU — com o título, o
        código de barras e a ficha de compatibilidade dele.
      </p>
    );
  }

  return (
    <form action={CAMINHO} className={estilo.formulario} method="get">
      <label className={estilo.campo}>
        Produto
        <select className={estilo.entrada} defaultValue={valores.skuId ?? ''} name="sku" required>
          {candidatos.map((c) => (
            <option key={c.id} value={c.id}>
              {descreverCandidato(c)}
            </option>
          ))}
        </select>
      </label>
      <label className={estilo.campo}>
        Plataforma
        <select className={estilo.entrada} defaultValue={valores.plataforma} name="plataforma">
          {PLATAFORMAS.map((p) => (
            <option key={p} value={p}>
              {ROTULO_DA_PLATAFORMA[p]}
            </option>
          ))}
        </select>
      </label>
      <label className={estilo.campo}>
        Preço, em reais
        <input
          className={estilo.entrada}
          defaultValue={valores.preco}
          inputMode="decimal"
          name="preco"
          placeholder="89,90"
          required
          type="text"
        />
      </label>
      <label className={estilo.campo}>
        Quantidade
        <input
          className={estilo.entrada}
          defaultValue={valores.quantidade}
          min={1}
          name="qtd"
          step={1}
          type="number"
        />
      </label>
      {/*
        Tipo do produto é editável porque `sku` não tem coluna para ele: o valor vem do
        registro extraído das ocorrências, e às vezes está errado ou ausente. Quem monta
        o anúncio corrige aqui, sem mexer no catálogo.
      */}
      <label className={estilo.campoLargo}>
        Tipo do produto, como o comprador diria
        <input
          className={estilo.entrada}
          defaultValue={valores.tipoProduto}
          name="tipo"
          placeholder="refil de purificador de água"
          type="text"
        />
      </label>
      <button className={estilo.botao} type="submit">
        Montar
      </button>
    </form>
  );
}

function ItemDoChecklist({ item }: { readonly item: ItemDaConferencia }) {
  const tom = tomDaExigencia(item.exigencia);
  const classe =
    tom === 'alerta'
      ? `${estilo.etiqueta} ${estilo.etiquetaAlerta}`
      : tom === 'atencao'
        ? `${estilo.etiqueta} ${estilo.etiquetaAtencao}`
        : estilo.etiqueta;

  return (
    <li className={item.preenchido ? estilo.itemFeito : estilo.itemFalta}>
      <div className={estilo.itemCabecalho}>
        <span className={estilo.itemTitulo}>
          {item.preenchido ? '✓' : '—'} {rotuloDoAtributo(item.atributo)}
        </span>
        {!item.preenchido && <span className={classe}>{rotuloDaExigencia(item.exigencia)}</span>}
      </div>
      {!item.preenchido && <p className={estilo.itemSub}>{item.porque}</p>}
    </li>
  );
}

/**
 * O conserto do único atributo que impede exportar.
 *
 * Aparece só quando falta, e junto do item que aponta a falta: checklist que diz o
 * problema e manda procurar a tela onde se resolve é checklist que a pessoa fecha.
 * Grava no catálogo e volta para **esta** montagem, porque ela preencheu a categoria
 * para ver o anúncio sair.
 */
export function ConsertarCategoria({
  skuId,
  voltarPara,
}: {
  readonly skuId: string;
  readonly voltarPara: string;
}) {
  return (
    <form action={salvarCategoria} className={estilo.formularioMagro}>
      <input name="skuId" type="hidden" value={skuId} />
      <input name="voltarPara" type="hidden" value={voltarPara} />
      <label className={estilo.campo}>
        Código da categoria na plataforma
        <input
          className={estilo.entrada}
          name="categoria"
          placeholder="MLB1234"
          required
          type="text"
        />
      </label>
      <button className={estilo.botao} type="submit">
        Gravar no produto
      </button>
    </form>
  );
}

export function Checklist({ conferencia }: { readonly conferencia: Conferencia }) {
  return (
    <>
      <p className={estilo.resumo}>{resumoDaConferencia(conferencia)}</p>
      <ul className={estilo.lista}>
        {conferencia.itens.map((i) => (
          <ItemDoChecklist item={i} key={i.atributo} />
        ))}
      </ul>
    </>
  );
}

export function Catalogo({ avaliacao }: { readonly avaliacao: AvaliacaoDeCatalogo }) {
  const texto = textoDoCatalogo(avaliacao);
  if (texto === null) {
    return (
      <p className={estilo.vazio}>
        Nenhum sinal de ficha de catálogo neste produto. Sem ficha, o anúncio disputa a vitrine por
        conta própria — que é a situação boa para conta sem reputação verde.
      </p>
    );
  }

  const tom = tomDoCatalogo(avaliacao);
  const classe =
    tom === 'alerta'
      ? `${estilo.aviso} ${estilo.avisoErro}`
      : tom === 'atencao'
        ? `${estilo.aviso} ${estilo.avisoAtencao}`
        : estilo.aviso;

  return (
    <div className={classe}>
      <strong className={estilo.avisoTitulo}>
        {avaliacao.presenca === 'confirmada'
          ? 'Tem ficha de catálogo'
          : 'Provável ficha de catálogo'}
      </strong>
      <span className={estilo.avisoCorpo}>{texto}</span>
    </div>
  );
}

export function Ficha({ ficha }: { readonly ficha: Ficha }) {
  if (ficha.publicaveis.length === 0 && ficha.retidas.length === 0) {
    return <p className={estilo.vazio}>Nenhuma compatibilidade registrada para este produto.</p>;
  }

  return (
    <>
      <p className={estilo.resumo}>
        {ficha.publicaveis.length} modelo(s) publicável(is) e {ficha.retidas.length} retido(s). Só o
        publicável entra no título e na descrição — afirmar na vitrine o que está abaixo do corte é
        o caminho curto para a devolução.
      </p>
      {ficha.retidas.length > 0 && (
        <ul className={estilo.listaFraca}>
          {ficha.retidas.map((r) => (
            <li key={`${r.marca}-${r.modelo}-${r.variante ?? ''}`}>
              {r.marca} {r.modelo} — retido: {r.motivo.replace(/_/g, ' ')}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export function Resultado({
  montado,
  preco,
  linkDoArquivo,
  instrucao,
}: {
  readonly montado: AnuncioMontado;
  readonly preco: Centavos;
  readonly linkDoArquivo: string;
  /** Onde subir o arquivo, do adaptador da plataforma. `null` quando não sai arquivo. */
  readonly instrucao: string | null;
}) {
  return (
    <>
      <p className={estilo.tituloGerado}>{montado.titulo.titulo}</p>
      <p className={estilo.dica}>{resumoDoTitulo(montado.titulo)}</p>

      <p className={estilo.resumo}>
        Preço: {formatarBRL(preco)} · Quantidade: {montado.anuncio.quantidade}
      </p>

      <h3 className={estilo.subtitulo}>Descrição</h3>
      <pre className={estilo.descricao}>{montado.anuncio.descricao ?? '(sem descrição)'}</pre>

      {/*
        O link só aparece quando o arquivo sai. Botão que existe e recusa é pior que
        botão que não existe: o primeiro promete e o segundo explica.
      */}
      {montado.conferencia.podeExportar ? (
        <>
          <p>
            <a className={estilo.botaoBaixar} href={linkDoArquivo}>
              Baixar o arquivo de importação
            </a>
          </p>
          {/*
            Onde subir vem do adaptador, não de texto nesta tela: cada plataforma põe
            a importação em massa num lugar diferente, e é o adaptador que sabe qual.
          */}
          {instrucao !== null && <p className={estilo.dica}>{instrucao}</p>}
        </>
      ) : (
        <p className={estilo.dica}>
          O arquivo de importação aparece aqui quando o que impede exportar estiver preenchido.
        </p>
      )}
    </>
  );
}

export const VALORES_PADRAO: ValoresDoFormulario = {
  skuId: null,
  plataforma: 'ml',
  preco: '',
  quantidade: QUANTIDADE_PADRAO,
  tipoProduto: '',
};

/** O link de baixar, montado num lugar só. */
export function linkDoArquivo(queryString: string): string {
  return `${CAMINHO_DO_ARQUIVO}?${queryString}`;
}
