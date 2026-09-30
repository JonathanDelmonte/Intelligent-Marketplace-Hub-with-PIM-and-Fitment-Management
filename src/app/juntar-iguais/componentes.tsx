/**
 * Componentes da tela de juntar iguais.
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
import type { ReactNode } from 'react';
import type { LadoDaFila, ParDaFila, StatusDoPar } from '@/dominio/identidade/pares';
import type { PropostaDeSku } from '@/dominio/identidade/propagacao';
import { FaixaDeNumeros } from '../ui/numeros';
import { SinalCaixa, SinalCerto, SinalFaisca, SinalRelogio } from '../ui/sinais';
import { criarSkuDoPar, decidirPar, resolverAgora } from './acoes';
import {
  cabecalhoDoPar,
  confiancaLegivel,
  fonteLegivel,
  numerosDosPares,
  precoLegivel,
  rotuloDoNivel,
  type Aviso,
  type NumeroDosPares,
} from './apresentacao';
import estilo from './juntar-iguais.module.css';

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

const ICONE_DO_NUMERO: Readonly<Record<NumeroDosPares['chave'], ReactNode>> = {
  voce: <SinalRelogio />,
  sistema: <SinalFaisca />,
  humano: <SinalCerto />,
  ofertas: <SinalCaixa />,
};

/** Os quatro números do alto. O escuro é o de "esperando você", que é o trabalho da tela. */
export function Painel({
  contagem,
  exemplos,
  ocorrencias,
}: {
  readonly contagem: Readonly<Record<StatusDoPar, number>>;
  readonly exemplos: { readonly sim: number; readonly nao: number; readonly incerto: number };
  readonly ocorrencias: number;
}) {
  return (
    <FaixaDeNumeros
      itens={numerosDosPares({ contagem, exemplos, ocorrencias }).map((numero) => ({
        rotulo: numero.rotulo,
        valor: numero.valor.toLocaleString('pt-BR'),
        nota: numero.nota,
        tom: numero.tom,
        icone: ICONE_DO_NUMERO[numero.chave],
        escuro: numero.chave === 'voce',
      }))}
      rotulo="As ofertas e os pares em números"
    />
  );
}

/**
 * "Tentar juntar": compara as ofertas entre si e junta as que dá para provar que são o
 * mesmo produto (código de barras igual, ou marca e código de peça iguais). O que
 * depender de julgamento cai na fila. Roda na hora, sem processo de fundo.
 */
export function BotaoResolverAgora({ limite }: { readonly limite: number }) {
  return (
    <form action={resolverAgora}>
      <button
        className={estilo.botaoSecundario}
        title="Junta as que dá para provar que são o mesmo produto: código de barras igual, ou marca e código de peça iguais. O resto cai na fila."
        type="submit"
      >
        Tentar juntar {limite} automaticamente
      </button>
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
        <dt>Preço</dt>
        <dd>{precoLegivel(lado.preco)}</dd>
        <dt>Vendedor</dt>
        <dd>{lado.vendedor ?? 'não informado'}</dd>
        <dt>Onde</dt>
        <dd>{lado.plataformaOuSite ?? 'não informado'}</dd>
        <dt>De onde veio</dt>
        <dd>{fonteLegivel(lado.fonte)}</dd>
        <dt>Código de barras</dt>
        <dd>{lado.ean ?? 'sem GTIN'}</dd>
        <dt>Como o sistema compara</dt>
        <dd className={estilo.canonico}>
          {lado.formaCanonica === null || lado.formaCanonica === ''
            ? 'não deu para montar: o sistema não achou marca nem modelo'
            : lado.formaCanonica}
        </dd>
        <dt>Produto</dt>
        <dd>{lado.skuId === null ? 'ainda não virou produto' : 'já faz parte de um produto'}</dd>
      </dl>
      {lado.url !== null && (
        <a className={estilo.link} href={lado.url} target="_blank" rel="noreferrer noopener">
          Abrir a fonte
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
export function CartaoDoPar({
  par,
  proposta,
}: {
  readonly par: ParDaFila;
  readonly proposta: PropostaDeSku;
}) {
  const cabecalho = cabecalhoDoPar(par);
  const podeCriarSku = par.a.skuId === null && par.b.skuId === null;
  // Os dois conjuntos de aviso dizem coisas diferentes e às vezes a mesma: a
  // inconsistência é sobre as fontes discordarem, e o aviso da proposta é sobre o que
  // isso custa no SKU. Repetir a frase idêntica seria ruído.
  const avisos = [...new Set([...par.inconsistencias, ...(podeCriarSku ? proposta.avisos : [])])];

  return (
    <li className={estilo.par}>
      <div className={estilo.parCabecalho}>
        <p className={estilo.motivo}>{cabecalho.titulo}</p>
        <p className={estilo.evidencia}>
          Evidência: {rotuloDoNivel(par.nivel)}
          {par.confiancaBp > 0 && ` · confiança ${confiancaLegivel(par.confiancaBp)}`}
          {par.a.skuId === null && par.b.skuId === null
            ? ' · nenhum dos dois virou produto ainda'
            : ' · um dos dois já é produto'}
        </p>
      </div>

      {cabecalho.detalhe !== null && (
        <p className={cabecalho.detalheEhCitacao ? estilo.citacao : estilo.detalhe}>
          {cabecalho.detalheEhCitacao ? `“${cabecalho.detalhe}”` : cabecalho.detalhe}
        </p>
      )}

      {avisos.length > 0 && (
        <ul className={estilo.inconsistencias}>
          {avisos.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}

      <div className={estilo.lados}>
        <Lado lado={par.a} titulo="Oferta A" />
        <Lado lado={par.b} titulo="Oferta B" />
      </div>

      <div className={estilo.acoes}>
        {podeCriarSku ? (
          /*
           * Sem SKU dos dois lados, "é o mesmo produto" daria em nada visível: a
           * decisão ficaria gravada e o valor (comparar preço entre fornecedores)
           * não apareceria, porque não há SKU para receber as duas ocorrências.
           *
           * Então aqui o botão cria o SKU. O título vem preenchido com a proposta e é
           * editável, porque "um SKU é criado por decisão sua" inclui o nome.
           */
          <form action={criarSkuDoPar} className={estilo.formularioDeSku}>
            <input type="hidden" name="parId" value={par.id} />
            <label className={estilo.rotuloDoTitulo} htmlFor={`titulo-${par.id}`}>
              Nome do produto
            </label>
            <input
              className={estilo.campoDeTitulo}
              id={`titulo-${par.id}`}
              name="titulo"
              defaultValue={proposta.tituloInterno}
              minLength={3}
              maxLength={200}
              required
            />
            <button type="submit" className={estilo.botaoSim}>
              É o mesmo: criar o produto
            </button>
          </form>
        ) : (
          <form action={decidirPar}>
            <input type="hidden" name="parId" value={par.id} />
            <input type="hidden" name="escolha" value="mesmo" />
            <button type="submit" className={estilo.botaoSim}>
              É o mesmo produto
            </button>
          </form>
        )}
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

export function Fila({
  pares,
}: {
  readonly pares: readonly { readonly par: ParDaFila; readonly proposta: PropostaDeSku }[];
}) {
  if (pares.length === 0) return null;
  return (
    <ul className={estilo.fila}>
      {pares.map(({ par, proposta }) => (
        <CartaoDoPar key={par.id} par={par} proposta={proposta} />
      ))}
    </ul>
  );
}

/**
 * Pares que o sistema juntou sozinho e que ainda não são um produto.
 *
 * Não tem botão de "é diferente": o par já está decidido, com evidência forte, e
 * reabrir isso aqui só confundiria. A única ação que falta é a que o sistema não
 * pode tomar sozinho — dar nome ao produto.
 *
 * Estava faltando, e o buraco só apareceu seguindo o roteiro do README de ponta a
 * ponta: duas ofertas do mesmo código de barras são ligadas automaticamente, e
 * por isso **não** entram na fila de revisão. O par ficava correto e sem caminho na
 * interface para virar produto — e sem produto não há comparação de preço nem ficha
 * de compatibilidade.
 */
export function ParaCriarProduto({
  pares,
}: {
  readonly pares: readonly { readonly par: ParDaFila; readonly proposta: PropostaDeSku }[];
}) {
  if (pares.length === 0) return null;

  return (
    <ul className={estilo.fila}>
      {pares.map(({ par, proposta }) => (
        <li className={estilo.par} key={par.id}>
          <div className={estilo.parCabecalho}>
            <p className={estilo.motivo}>{cabecalhoDoPar(par).titulo}</p>
            <p className={estilo.evidencia}>
              Evidência: {rotuloDoNivel(par.nivel)}
              {par.confiancaBp > 0 && ` · confiança ${confiancaLegivel(par.confiancaBp)}`}
            </p>
          </div>

          <div className={estilo.lados}>
            <Lado lado={par.a} titulo="Oferta A" />
            <Lado lado={par.b} titulo="Oferta B" />
          </div>

          {proposta.avisos.length > 0 && (
            <ul className={estilo.inconsistencias}>
              {proposta.avisos.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )}

          <div className={estilo.acoes}>
            <form action={criarSkuDoPar} className={estilo.formularioDeSku}>
              <input name="parId" type="hidden" value={par.id} />
              <label className={estilo.rotuloDoTitulo} htmlFor={`novo-titulo-${par.id}`}>
                Nome do produto
              </label>
              <input
                className={estilo.campoDeTitulo}
                defaultValue={proposta.tituloInterno}
                id={`novo-titulo-${par.id}`}
                maxLength={200}
                minLength={3}
                name="titulo"
                required
              />
              <button className={estilo.botaoSim} type="submit">
                Criar produto com as duas
              </button>
            </form>
          </div>
        </li>
      ))}
    </ul>
  );
}
