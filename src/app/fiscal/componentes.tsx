/**
 * Componentes da tela fiscal.
 *
 * Todos de servidor e sem JavaScript no cliente. O cadastro fiscal é trabalho de
 * mesa, feito uma vez por item, com a tabela de NCM aberta em outra aba — então cada
 * SKU tem o formulário aberto ao lado do que falta nele, e não atrás de um clique.
 */
import { CAMPOS_FISCAIS, PARA_QUE_SERVE, VALORES_COMUNS } from '@/dominio/fiscal/codigos';
import type { CampoFiscal } from '@/dominio/fiscal/codigos';
import { AREAS_REGULADAS, REGRAS } from '@/dominio/fiscal/regulada';
import type { PrazoAvaliado } from '@/dominio/fiscal/prazos';
import type { ResumoFiscal, SkuFiscal } from '@/dominio/fiscal/repositorio';
import type { AvaliacaoDoTeto } from '@/dominio/fiscal/teto';
import type { RegimeFiscal } from '@/dominio/precificacao/tipos';
import { gravarCodigos, informarReceitaExterna, sugerirCodigos } from './acoes';
import {
  ROTULO_DA_SITUACAO,
  diaEmTexto,
  prazoEmTexto,
  resumoDoTeto,
  rotuloDoCampo,
  tomDoPrazo,
  tomDoTeto,
  type Aviso,
} from './apresentacao';
import estilo from './fiscal.module.css';

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

export function Prazos({ prazos }: { readonly prazos: readonly PrazoAvaliado[] }) {
  return (
    <ul className={estilo.lista}>
      {prazos.map((p) => {
        const tom = tomDoPrazo(p.urgencia);
        const classe =
          tom === 'alerta'
            ? `${estilo.etiqueta} ${estilo.etiquetaAlerta}`
            : tom === 'atencao'
              ? `${estilo.etiqueta} ${estilo.etiquetaAtencao}`
              : estilo.etiqueta;

        return (
          <li className={p.meAtinge ? estilo.item : estilo.itemFraco} key={p.id}>
            <div className={estilo.itemCabecalho}>
              <div>
                <h3 className={estilo.itemTitulo}>{p.titulo}</h3>
                <p className={estilo.itemSub}>
                  {diaEmTexto(p.dia)} · {prazoEmTexto(p)}
                  {!p.meAtinge && ' · não é do seu regime hoje'}
                </p>
              </div>
              <span className={classe}>{p.diasRestantes < 0 ? 'passou' : prazoEmTexto(p)}</span>
            </div>
            <p className={estilo.itemCorpo}>{p.consequencia}</p>
            <p className={estilo.itemAcao}>{p.oQueFazer}</p>
            <p className={estilo.itemFonte}>Base: {p.base}</p>
          </li>
        );
      })}
    </ul>
  );
}

export function Teto({
  teto,
  ano,
  regime,
}: {
  readonly teto: AvaliacaoDoTeto;
  readonly ano: number;
  readonly regime: RegimeFiscal;
}) {
  if (regime !== 'mei') {
    return (
      <p className={estilo.vazio}>
        O teto anual vale para o regime MEI. Este perfil está como {regime.toUpperCase()}, então não
        há teto a controlar aqui — o que não quer dizer que não haja obrigação.
      </p>
    );
  }

  const tom = tomDoTeto(teto.situacao);
  const classe =
    tom === 'alerta'
      ? `${estilo.etiqueta} ${estilo.etiquetaAlerta}`
      : tom === 'atencao'
        ? `${estilo.etiqueta} ${estilo.etiquetaAtencao}`
        : estilo.etiqueta;

  return (
    <>
      <div className={estilo.itemCabecalho}>
        <p className={estilo.resumo}>{resumoDoTeto(teto)}</p>
        <span className={classe}>{ROTULO_DA_SITUACAO[teto.situacao]}</span>
      </div>
      <p className={estilo.itemCorpo}>{teto.mensagem}</p>

      {/*
        A receita de fora entra à mão porque o sistema só conhece o que passou pelas
        planilhas. Sem ela o controle de teto dá folga que não existe.
      */}
      <form action={informarReceitaExterna} className={estilo.formularioMagro}>
        <input name="ano" type="hidden" value={ano} />
        <label className={estilo.campo}>
          Receita de {ano} fora das plataformas, em reais
          <input
            className={estilo.entrada}
            inputMode="decimal"
            name="valor"
            placeholder="0"
            required
            type="text"
          />
        </label>
        <button className={estilo.botao} type="submit">
          Informar
        </button>
      </form>
    </>
  );
}

/**
 * A sugestão que voltou da classificação, para **este** item.
 *
 * Vem da URL, e só se aplica ao item que foi classificado: pré-preencher o campo de
 * outro produto com o NCM de um produto diferente seria a pior coisa que esta tela
 * poderia fazer.
 */
export interface SugestaoNaTela {
  readonly skuId: string;
  readonly ncm: string | null;
  readonly cest: string | null;
  readonly porque: string | null;
}

function valorAtual(item: SkuFiscal, campo: CampoFiscal, sugestao: SugestaoNaTela | null): string {
  if (sugestao !== null && sugestao.skuId === item.id) {
    if (campo === 'ncm' && sugestao.ncm !== null) return sugestao.ncm;
    if (campo === 'cest' && sugestao.cest !== null) return sugestao.cest;
  }
  return item[campo] ?? '';
}

function CartaoDoSku({
  item,
  regime,
  sugestao,
}: {
  readonly item: SkuFiscal;
  readonly regime: RegimeFiscal;
  readonly sugestao: SugestaoNaTela | null;
}) {
  const comuns = VALORES_COMUNS[regime];
  const daSugestao = sugestao !== null && sugestao.skuId === item.id;

  return (
    <li className={item.estado.prontoPara2027 ? estilo.itemFeito : estilo.item}>
      <div className={estilo.itemCabecalho}>
        <h3 className={estilo.itemTitulo}>{item.tituloInterno}</h3>
        <span
          className={
            item.estado.prontoPara2027
              ? estilo.etiqueta
              : `${estilo.etiqueta} ${estilo.etiquetaAlerta}`
          }
        >
          {item.estado.prontoPara2027 ? 'completo' : `falta ${String(item.estado.faltando.length)}`}
        </span>
      </div>

      {!item.estado.prontoPara2027 && <p className={estilo.itemCorpo}>{item.estado.mensagem}</p>}
      {item.regulacao.mensagem !== null && (
        <p className={estilo.itemAcao}>{item.regulacao.mensagem}</p>
      )}

      {/*
        Pedir sugestão é um formulário próprio, separado do de gravar: são ações
        diferentes, e um botão que às vezes sugere e às vezes grava seria a forma mais
        rápida de alguém gravar um NCM que não conferiu.
      */}
      <form action={sugerirCodigos}>
        <input name="skuId" type="hidden" value={item.id} />
        <button className={estilo.botao} type="submit">
          Sugerir NCM
        </button>
      </form>

      {daSugestao && sugestao?.porque !== null && sugestao?.porque !== undefined && (
        <p className={estilo.itemAcao}>
          Por que esse NCM: {sugestao.porque} — confira e grave, ou apague e preencha à mão.
        </p>
      )}

      <form action={gravarCodigos} className={estilo.formulario}>
        <input name="skuId" type="hidden" value={item.id} />
        {CAMPOS_FISCAIS.map((campo) => (
          <label className={estilo.campo} key={campo}>
            {rotuloDoCampo(campo)}
            <input
              className={estilo.entrada}
              defaultValue={valorAtual(item, campo, sugestao)}
              inputMode="numeric"
              name={campo}
              placeholder={(comuns[campo] ?? [])[0] ?? ''}
              type="text"
            />
            <span className={estilo.itemFonte}>{PARA_QUE_SERVE[campo]}</span>
          </label>
        ))}

        <label className={estilo.campo}>
          Categoria regulada
          <select
            className={estilo.entrada}
            defaultValue={item.categoriaRegulada ?? ''}
            name="categoriaRegulada"
          >
            <option value="">não é regulada</option>
            {AREAS_REGULADAS.map((area) => (
              <option key={area} value={area}>
                {REGRAS.find((r) => r.area === area)?.rotulo ?? area}
              </option>
            ))}
          </select>
          <span className={estilo.itemFonte}>
            O que você marcar aqui manda: a detecção pelo título é só sugestão.
          </span>
        </label>

        <button className={estilo.botao} type="submit">
          Gravar
        </button>
      </form>
    </li>
  );
}

export function Cadastro({
  resumo,
  sugestao,
}: {
  readonly resumo: ResumoFiscal;
  readonly sugestao: SugestaoNaTela | null;
}) {
  if (resumo.skus.length === 0) {
    return (
      <p className={estilo.vazio}>
        Nenhum produto ativo no catálogo. O cadastro fiscal é por item, então começa quando o
        primeiro produto existir.
      </p>
    );
  }
  return (
    <ul className={estilo.lista}>
      {resumo.skus.map((s) => (
        <CartaoDoSku item={s} key={s.id} regime={resumo.regime} sugestao={sugestao} />
      ))}
    </ul>
  );
}
