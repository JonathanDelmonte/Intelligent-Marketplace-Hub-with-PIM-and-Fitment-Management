/**
 * Componentes da tela de identidade.
 *
 * Server Components sem estado: recebem dados prontos e devolvem marcação. O que
 * decide **texto** está em `apresentacao.ts`, que tem teste.
 *
 * A decisão de desenho que manda no arquivo: o par aparece como duas colunas lado a
 * lado, com os mesmos campos na mesma ordem nas duas. Comparar é a tarefa inteira
 * desta tela, e comparar exige que a informação esteja no mesmo lugar dos dois lados
 * — layout diferente por lado obriga a pessoa a procurar, e procurar cansa em vinte
 * pares.
 */
import type { LadoDaFila, ParDaFila, StatusDoPar } from '@/dominio/identidade/pares';
import { decidirPar, resolverAgora } from './acoes';
import {
  cabecalhoDoPar,
  confiancaLegivel,
  fonteLegivel,
  precoLegivel,
  rotuloDoNivel,
  type Aviso,
} from './apresentacao';
import estilo from './identidade.module.css';

const CLASSE_DO_AVISO: Readonly<Record<Aviso['tom'], string>> = {
  ok: estilo.aviso,
  atencao: estilo.avisoAtencao,
  erro: estilo.avisoErro,
};

export function AvisoDaAcao({ aviso }: { readonly aviso: Aviso }) {
  return (
    <div className={CLASSE_DO_AVISO[aviso.tom]} role="status">
      <div className={estilo.avisoTitulo}>{aviso.titulo}</div>
      <p className={estilo.avisoCorpo}>{aviso.corpo}</p>
    </div>
  );
}

const ROTULO_DO_STATUS: Readonly<Record<StatusDoPar, string>> = {
  pendente: 'esperando você',
  automatico: 'decidido pelo sistema',
  resolvido: 'decidido por você',
  descartado: 'descartado',
};

const EXPLICACAO_DO_STATUS: Readonly<Record<StatusDoPar, string>> = {
  pendente:
    'na zona cinzenta: nem confiante o bastante para agrupar, nem improvável o bastante para descartar',
  automatico: 'acima do limiar, ou separado por evidência clara',
  resolvido: 'decisão humana, que nenhuma varredura futura sobrescreve',
  descartado: 'abaixo da zona de revisão; fica gravado para não ser reavaliado à toa',
};

export function Painel({
  contagem,
  exemplos,
  ocorrencias,
}: {
  readonly contagem: Readonly<Record<StatusDoPar, number>>;
  readonly exemplos: { readonly sim: number; readonly nao: number; readonly incerto: number };
  readonly ocorrencias: number;
}) {
  const ordem: readonly StatusDoPar[] = ['pendente', 'automatico', 'resolvido', 'descartado'];

  return (
    <section aria-label="Situação do grafo de identidade">
      <ul className={estilo.painel}>
        <li className={estilo.cartao}>
          <span className={estilo.cartaoNumero}>{ocorrencias}</span>
          <span className={estilo.cartaoRotulo}>ocorrências na base</span>
          <span className={estilo.cartaoNota}>tudo que entrou por link ou planilha</span>
        </li>
        {ordem.map((status) => (
          <li key={status} className={estilo.cartao}>
            <span className={estilo.cartaoNumero}>{contagem[status]}</span>
            <span className={estilo.cartaoRotulo}>{ROTULO_DO_STATUS[status]}</span>
            <span className={estilo.cartaoNota}>{EXPLICACAO_DO_STATUS[status]}</span>
          </li>
        ))}
        <li className={estilo.cartao}>
          <span className={estilo.cartaoNumero}>{exemplos.sim + exemplos.nao}</span>
          <span className={estilo.cartaoRotulo}>exemplos ensinados</span>
          <span className={estilo.cartaoNota}>
            {exemplos.sim} de “é o mesmo”, {exemplos.nao} de “são diferentes” — vão nos julgamentos
            seguintes
          </span>
        </li>
      </ul>
    </section>
  );
}

export function BotaoResolverAgora({ limite }: { readonly limite: number }) {
  return (
    <form action={resolverAgora}>
      <button type="submit" className={estilo.botaoSecundario}>
        Resolver {limite} agora
      </button>
      <p className={estilo.dica}>
        Compara as ocorrências contra os candidatos e decide o que dá para decidir sem julgamento.
        Roda aqui mesmo, sem processo de fundo.
      </p>
    </form>
  );
}

/** Um lado do par. Os dois lados usam este componente, e é por isso que comparam. */
function Lado({ lado, titulo }: { readonly lado: LadoDaFila; readonly titulo: string }) {
  return (
    <div className={estilo.lado}>
      <h3 className={estilo.ladoTitulo}>
        <span className={estilo.ladoEtiqueta}>{titulo}</span>
        {lado.tituloBruto}
      </h3>
      <dl className={estilo.campos}>
        <dt>preço</dt>
        <dd>{precoLegivel(lado.preco)}</dd>
        <dt>vendedor</dt>
        <dd>{lado.vendedor ?? 'não informado'}</dd>
        <dt>onde</dt>
        <dd>{lado.plataformaOuSite ?? 'não informado'}</dd>
        <dt>procedência</dt>
        <dd>{fonteLegivel(lado.fonte)}</dd>
        <dt>código de barras</dt>
        <dd>{lado.ean ?? 'sem GTIN'}</dd>
        <dt>forma canônica</dt>
        <dd className={estilo.canonico}>
          {lado.formaCanonica === null || lado.formaCanonica === ''
            ? 'não foi possível montar: falta marca ou modelo extraídos'
            : lado.formaCanonica}
        </dd>
        <dt>SKU</dt>
        <dd>{lado.skuId === null ? 'ainda não é um SKU' : 'já pertence a um SKU'}</dd>
      </dl>
      {lado.url !== null && (
        <a className={estilo.link} href={lado.url} target="_blank" rel="noreferrer noopener">
          abrir a fonte
        </a>
      )}
    </div>
  );
}

/**
 * Um par da fila, com os três botões.
 *
 * "Não sei" existe e não é preguiça: forçar sim ou não em quem não sabe produz
 * exemplo errado, e exemplo errado é pior que exemplo nenhum porque é ensinado com
 * autoridade. Também é o que impede um par indecidível de travar o topo da fila para
 * sempre.
 */
export function CartaoDoPar({ par }: { readonly par: ParDaFila }) {
  const cabecalho = cabecalhoDoPar(par);

  return (
    <li className={estilo.par}>
      <div className={estilo.parCabecalho}>
        <p className={estilo.motivo}>{cabecalho.titulo}</p>
        <p className={estilo.evidencia}>
          evidência: {rotuloDoNivel(par.nivel)}
          {par.confiancaBp > 0 && ` · confiança ${confiancaLegivel(par.confiancaBp)}`}
          {par.a.skuId === null && par.b.skuId === null
            ? ' · nenhum dos dois é um SKU ainda'
            : ' · um dos dois já é um SKU'}
        </p>
      </div>

      {cabecalho.detalhe !== null && (
        <p className={cabecalho.detalheEhCitacao ? estilo.citacao : estilo.detalhe}>
          {cabecalho.detalheEhCitacao ? `“${cabecalho.detalhe}”` : cabecalho.detalhe}
        </p>
      )}

      {par.inconsistencias.length > 0 && (
        <ul className={estilo.inconsistencias}>
          {par.inconsistencias.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}

      <div className={estilo.lados}>
        <Lado lado={par.a} titulo="ocorrência A" />
        <Lado lado={par.b} titulo="ocorrência B" />
      </div>

      <div className={estilo.acoes}>
        <form action={decidirPar}>
          <input type="hidden" name="parId" value={par.id} />
          <input type="hidden" name="escolha" value="mesmo" />
          <button type="submit" className={estilo.botaoSim}>
            É o mesmo produto
          </button>
        </form>
        <form action={decidirPar}>
          <input type="hidden" name="parId" value={par.id} />
          <input type="hidden" name="escolha" value="diferente" />
          <button type="submit" className={estilo.botaoNao}>
            São produtos diferentes
          </button>
        </form>
        <form action={decidirPar}>
          <input type="hidden" name="parId" value={par.id} />
          <input type="hidden" name="escolha" value="incerto" />
          <button type="submit" className={estilo.botaoNeutro}>
            Não sei dizer
          </button>
        </form>
      </div>
    </li>
  );
}

export function Fila({ pares }: { readonly pares: readonly ParDaFila[] }) {
  if (pares.length === 0) return null;
  return (
    <ul className={estilo.fila}>
      {pares.map((par) => (
        <CartaoDoPar key={par.id} par={par} />
      ))}
    </ul>
  );
}
