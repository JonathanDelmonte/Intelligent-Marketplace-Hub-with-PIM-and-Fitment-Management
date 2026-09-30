/**
 * Componentes da tela de fornecedores.
 *
 * Todos de servidor, sem estado e sem JavaScript no cliente: cada gravação é um
 * `form` com `action` de servidor. A tela funciona com JavaScript desligado — e a
 * mensagem de primeiro contato fica num `textarea` justamente para poder ser
 * copiada sem precisar de script.
 */
import type { ReactNode } from 'react';
import type { Confiabilidade } from '@/dominio/fornecedores/confiabilidade';
import type { FornecedorGravado } from '@/dominio/fornecedores/repositorio';
import { mensagemDePrimeiroContato } from '@/dominio/fornecedores/contato';
import { CANAIS, ORIGENS } from '@/dominio/fornecedores/repositorio';
import { contagem } from '@/lib/texto';
import { FaixaDeNumeros, type TomDoNumero } from '../ui/numeros';
import { SinalAlerta, SinalCerto, SinalFechar, SinalRelogio } from '../ui/sinais';
import { cadastrarFornecedor, conferirAgora, responderPerguntas } from './acoes';
import {
  COMO_SE_MEDE_A_CONFIABILIDADE,
  conferenciaNaTela,
  confiabilidadeEmTexto,
  documentoEmTexto,
  etiquetaDoVeredito,
  pedidoMinimoEmTexto,
  perguntasEmTexto,
  prazoEmTexto,
  respostaEmTexto,
  tomDoVeredito,
  vitrineEmTexto,
  type Aviso,
  type LinkDaConferencia,
} from './apresentacao';
import estilo from './fornecedores.module.css';

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

/** Os quatro números do alto. O escuro é o dos aprovados, que é de quem se compra. */
export function Painel({
  contagem: porVeredito,
}: {
  readonly contagem: {
    readonly aprovado: number;
    readonly ressalva: number;
    readonly perguntar: number;
    readonly descartar: number;
  };
}) {
  const cartoes: readonly {
    readonly rotulo: string;
    readonly valor: number;
    readonly nota: string;
    readonly tom: TomDoNumero;
    readonly icone: ReactNode;
  }[] = [
    {
      rotulo: 'Aprovados',
      valor: porVeredito.aprovado,
      nota: 'passam nas cinco perguntas',
      tom: porVeredito.aprovado === 0 ? 'neutro' : 'alta',
      icone: <SinalCerto />,
    },
    {
      rotulo: 'Com ressalva',
      valor: porVeredito.ressalva,
      nota: 'servem, e custam algo',
      tom: porVeredito.ressalva === 0 ? 'neutro' : 'atencao',
      icone: <SinalAlerta />,
    },
    {
      rotulo: 'Falta perguntar',
      valor: porVeredito.perguntar,
      nota: 'é tarefa, não reprovação',
      tom: 'neutro',
      icone: <SinalRelogio />,
    },
    {
      rotulo: 'Descartados',
      valor: porVeredito.descartar,
      nota: 'vendem na mesma vitrine',
      tom: porVeredito.descartar === 0 ? 'neutro' : 'baixa',
      icone: <SinalFechar />,
    },
  ];
  return (
    <FaixaDeNumeros
      itens={cartoes.map((c, indice) => ({
        rotulo: c.rotulo,
        valor: c.valor.toLocaleString('pt-BR'),
        nota: c.nota,
        tom: c.tom,
        icone: c.icone,
        escuro: indice === 0,
      }))}
      rotulo="Os fornecedores em números"
    />
  );
}

/**
 * As cinco perguntas, com o porquê de cada uma. Mora ao lado do cadastro: é o que vai ser
 * perguntado a quem entrar, e a pessoa decide melhor sabendo o que pesa.
 */
export function CincoPerguntas() {
  const perguntas = [
    ['Posta com a etiqueta do marketplace?', 'Sem isso, cada venda vira um envio seu.'],
    ['Emite nota fiscal de venda?', 'A nota é o que deixa a venda sair da plataforma.'],
    ['Em quantos dias posta?', 'O prazo dele entra no seu prazo de postagem.'],
    ['Qual é o pedido mínimo?', 'Mínimo alto prende dinheiro em estoque parado.'],
    ['Vende direto na mesma vitrine?', 'Se vende, tem preço de fábrica: descarta sozinho.'],
  ] as const;
  return (
    <ol className={estilo.perguntas}>
      {perguntas.map(([pergunta, porque]) => (
        <li key={pergunta}>
          <span className={estilo.perguntaTexto}>{pergunta}</span>
          <span className={estilo.perguntaPorque}>{porque}</span>
        </li>
      ))}
    </ol>
  );
}

/** Um sim/não/não sei, com "não mexi" como valor inicial. */
function TresEstados({
  nome,
  rotulo,
  atual,
}: {
  readonly nome: string;
  readonly rotulo: string;
  readonly atual: boolean | null;
}) {
  return (
    <label className={estilo.campo}>
      <span>{rotulo}</span>
      <select className={estilo.entrada} defaultValue="" name={nome}>
        <option value="">Deixar como está ({respostaEmTexto(atual)})</option>
        <option value="sim">sim</option>
        <option value="nao">não</option>
        <option value="nao_sei">ainda não perguntei</option>
      </select>
    </label>
  );
}

function Enderecos({ links }: { readonly links: readonly LinkDaConferencia[] }) {
  return (
    <ul className={estilo.enderecos}>
      {links.map((l) => (
        <li key={l.url}>
          <a href={l.url} rel="noopener noreferrer" target="_blank">
            {l.rotulo}
          </a>
        </li>
      ))}
    </ul>
  );
}

/**
 * A conferência de CNPJ e vitrine (7.3): o que a Receita disse, o que a busca achou, e o
 * botão que confere agora. Aberta quando achou algo que descarta ou preocupa.
 */
function ConferenciaDoFornecedor({ fornecedor }: { readonly fornecedor: FornecedorGravado }) {
  const tela = fornecedor.conferencia === null ? null : conferenciaNaTela(fornecedor.conferencia);
  return (
    <details className={estilo.detalhe} open={tela?.tom === 'alerta'}>
      <summary>
        {tela === null
          ? 'CNPJ e vitrine: ainda não conferidos'
          : `CNPJ e vitrine: conferidos em ${tela.quando}`}
      </summary>
      {tela === null ? (
        <p className={estilo.dica}>
          A conferência olha o CNPJ na Receita e procura loja com esse nome no Mercado Livre, na
          Shopee e na Amazon. Ela roda sozinha, um fornecedor por vez; o botão confere agora.
        </p>
      ) : (
        <>
          <p className={tela.cadastroPreocupa ? estilo.conferenciaAlerta : estilo.conferencia}>
            {tela.cadastro}
          </p>
          <p className={tela.lojas.length > 0 ? estilo.conferenciaAlerta : estilo.conferencia}>
            {tela.vitrine}
          </p>
          {tela.lojas.length > 0 && <Enderecos links={tela.lojas} />}
          {tela.lojas.length > 0 && tela.indicios.length > 0 && (
            <p className={estilo.conferencia}>Também citam o nome, sem ser loja própria certa:</p>
          )}
          {tela.indicios.length > 0 && <Enderecos links={tela.indicios} />}
        </>
      )}
      <form action={conferirAgora} className={estilo.formulario}>
        <input name="id" type="hidden" value={fornecedor.id} />
        <button className={estilo.botao} type="submit">
          Conferir CNPJ e vitrine agora
        </button>
        <p className={estilo.dica}>
          Leva alguns segundos: são três buscas e uma consulta, todas gratuitas.
        </p>
      </form>
    </details>
  );
}

export function CartaoDoFornecedor({
  fornecedor,
  vendedor,
  confiabilidade,
}: {
  readonly fornecedor: FornecedorGravado;
  readonly vendedor: string;
  /** Medida nos pedidos do perfil; ausente quando ele não tem pedido deste fornecedor. */
  readonly confiabilidade: Confiabilidade | undefined;
}) {
  const tom = tomDoVeredito(fornecedor.triagem.veredito);
  const classeDaEtiqueta =
    tom === 'alerta'
      ? `${estilo.etiqueta} ${estilo.etiquetaAlerta}`
      : tom === 'atencao'
        ? `${estilo.etiqueta} ${estilo.etiquetaAtencao}`
        : estilo.etiqueta;

  const mensagem = mensagemDePrimeiroContato({
    vendedor,
    fornecedor: fornecedor.nome,
    produto: { descricao: 'peça de reposição que eu revendo' },
    pendentes: fornecedor.triagem.pendentes,
  });

  return (
    <li className={estilo.item}>
      <div className={estilo.itemCabecalho}>
        <div>
          <h3 className={estilo.itemTitulo}>{fornecedor.nome}</h3>
          <p className={estilo.itemSub}>
            {documentoEmTexto(fornecedor.cnpj)}
            {fornecedor.contato === null ? '' : ` · ${fornecedor.contato}`}
          </p>
        </div>
        <span className={classeDaEtiqueta}>{etiquetaDoVeredito(fornecedor.triagem.veredito)}</span>
      </div>

      <ul className={estilo.motivos}>
        {fornecedor.triagem.motivos.map((m) => (
          <li key={m}>{m}</li>
        ))}
      </ul>

      <dl className={estilo.respostas}>
        <div>
          <dt>Posta com etiqueta</dt>
          <dd>{respostaEmTexto(fornecedor.postaComEtiqueta)}</dd>
        </div>
        <div>
          <dt>Emite nota</dt>
          <dd>{respostaEmTexto(fornecedor.emiteNf)}</dd>
        </div>
        <div>
          <dt>Prazo de postagem</dt>
          <dd>{prazoEmTexto(fornecedor.prazoPostagemDias)}</dd>
        </div>
        <div>
          <dt>Pedido mínimo</dt>
          <dd>{pedidoMinimoEmTexto(fornecedor.pedidoMinimoReais, fornecedor.pedidoMinimoUn)}</dd>
        </div>
        <div>
          <dt>Vende na mesma vitrine</dt>
          <dd>{vitrineEmTexto(fornecedor.vendeDiretoMarketplace, fornecedor.vendeDiretoFonte)}</dd>
        </div>
        <div>
          <dt>Confiabilidade</dt>
          <dd title={COMO_SE_MEDE_A_CONFIABILIDADE}>{confiabilidadeEmTexto(confiabilidade)}</dd>
        </div>
      </dl>

      <ConferenciaDoFornecedor fornecedor={fornecedor} />

      <details className={estilo.detalhe}>
        <summary>Responder as perguntas</summary>
        <form action={responderPerguntas} className={estilo.formulario}>
          <input name="id" type="hidden" value={fornecedor.id} />
          <div className={estilo.campos}>
            <TresEstados
              atual={fornecedor.postaComEtiqueta}
              nome="postaComEtiqueta"
              rotulo="Posta com a etiqueta do marketplace?"
            />
            <TresEstados
              atual={fornecedor.emiteNf}
              nome="emiteNf"
              rotulo="Emite nota fiscal de venda?"
            />
            <TresEstados
              atual={fornecedor.vendeDiretoMarketplace}
              nome="vendeDiretoMarketplace"
              rotulo="Vende direto no marketplace?"
            />
            <label className={estilo.campo}>
              <span>Prazo de postagem, em dias úteis</span>
              <input
                className={estilo.entrada}
                inputMode="numeric"
                min={0}
                name="prazoPostagemDias"
                placeholder={prazoEmTexto(fornecedor.prazoPostagemDias)}
                type="number"
              />
            </label>
            <label className={estilo.campo}>
              <span>Pedido mínimo em reais</span>
              <input
                className={estilo.entrada}
                name="pedidoMinimoReais"
                placeholder="300,00"
                type="text"
              />
            </label>
            <label className={estilo.campo}>
              <span>Pedido mínimo em unidades</span>
              <input
                className={estilo.entrada}
                inputMode="numeric"
                min={0}
                name="pedidoMinimoUn"
                placeholder="12"
                type="number"
              />
            </label>
          </div>
          <button className={estilo.botao} type="submit">
            Gravar respostas
          </button>
          <p className={estilo.dica}>
            Campo em branco fica como está. “Ainda não perguntei” apaga a resposta de propósito: é
            diferente de “não”, e o sistema trata as duas coisas de formas diferentes.
          </p>
        </form>
      </details>

      {fornecedor.triagem.pendentes.length > 0 && (
        <details className={estilo.detalhe}>
          <summary>
            Mensagem de primeiro contato (
            {contagem(fornecedor.triagem.pendentes.length, 'pergunta', 'perguntas')})
          </summary>
          <ul className={estilo.motivos}>
            {perguntasEmTexto(fornecedor.triagem.pendentes).map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
          <textarea className={estilo.mensagem} readOnly rows={14} value={mensagem} />
          <p className={estilo.dica}>
            Troque “peça de reposição que eu revendo” pelo item específico antes de mandar: pergunta
            genérica recebe resposta genérica, e item nomeado com quantidade recebe preço.
          </p>
        </details>
      )}
    </li>
  );
}

export function Lista({
  fornecedores,
  vendedor,
  confiabilidades,
}: {
  readonly fornecedores: readonly FornecedorGravado[];
  readonly vendedor: string;
  readonly confiabilidades: ReadonlyMap<string, Confiabilidade>;
}) {
  // Lista vazia não diz nada aqui: o aviso do estado da base, logo acima, já diz o que
  // falta e onde cadastrar.
  if (fornecedores.length === 0) return null;
  return (
    <ul className={estilo.lista}>
      {fornecedores.map((f) => (
        <CartaoDoFornecedor
          confiabilidade={confiabilidades.get(f.id)}
          fornecedor={f}
          key={f.id}
          vendedor={vendedor}
        />
      ))}
    </ul>
  );
}

export function FormularioDeCadastro() {
  return (
    <form action={cadastrarFornecedor} className={estilo.formulario}>
      <div className={estilo.campos}>
        <label className={estilo.campo}>
          <span>Nome</span>
          <input className={estilo.entrada} name="nome" placeholder="Acme Distribuidora" required />
        </label>
        <label className={estilo.campo}>
          <span>CNPJ (opcional)</span>
          <input className={estilo.entrada} name="cnpj" placeholder="00.000.000/0001-00" />
        </label>
        <label className={estilo.campo}>
          <span>Contato (opcional)</span>
          <input className={estilo.entrada} name="contato" placeholder="(11) 90000-0000" />
        </label>
        <label className={estilo.campo}>
          <span>Canal</span>
          <select className={estilo.entrada} defaultValue="" name="canal">
            <option value="">Não informado</option>
            {CANAIS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className={estilo.campo}>
          <span>Origem</span>
          <select className={estilo.entrada} defaultValue="" name="origem">
            <option value="">Não informada</option>
            {ORIGENS.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </label>
        <label className={estilo.campo}>
          <span>Site (opcional)</span>
          <input className={estilo.entrada} name="site" placeholder="acme.com.br" />
        </label>
      </div>
      <button className={estilo.botao} type="submit">
        Cadastrar fornecedor
      </button>
    </form>
  );
}
