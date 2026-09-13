/**
 * Componentes da tela de fornecedores.
 *
 * Todos de servidor, sem estado e sem JavaScript no cliente: cada gravação é um
 * `form` com `action` de servidor. A tela funciona com JavaScript desligado — e a
 * mensagem de primeiro contato fica num `textarea` justamente para poder ser
 * copiada sem precisar de script.
 */
import type { FornecedorGravado } from '@/dominio/fornecedores/repositorio';
import { mensagemDePrimeiroContato } from '@/dominio/fornecedores/contato';
import { CANAIS, ORIGENS } from '@/dominio/fornecedores/repositorio';
import { cadastrarFornecedor, responderPerguntas } from './acoes';
import {
  etiquetaDoVeredito,
  pedidoMinimoEmTexto,
  perguntasEmTexto,
  prazoEmTexto,
  respostaEmTexto,
  tomDoVeredito,
  type Aviso,
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

export function Painel({
  contagem,
}: {
  readonly contagem: {
    readonly aprovado: number;
    readonly ressalva: number;
    readonly perguntar: number;
    readonly descartar: number;
  };
}) {
  const cartoes = [
    { rotulo: 'Aprovados', valor: contagem.aprovado, nota: 'passam nas cinco perguntas' },
    { rotulo: 'Com ressalva', valor: contagem.ressalva, nota: 'servem, e custam algo' },
    { rotulo: 'Falta perguntar', valor: contagem.perguntar, nota: 'é tarefa, não reprovação' },
    { rotulo: 'Descartados', valor: contagem.descartar, nota: 'vendem na mesma vitrine' },
  ];
  return (
    <div className={estilo.painel}>
      {cartoes.map((c) => (
        <div className={estilo.cartao} key={c.rotulo}>
          <span className={estilo.cartaoNumero}>{c.valor}</span>
          <span className={estilo.cartaoRotulo}>{c.rotulo}</span>
          <span className={estilo.cartaoNota}>{c.nota}</span>
        </div>
      ))}
    </div>
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
        <option value="">— deixar como está ({respostaEmTexto(atual)})</option>
        <option value="sim">sim</option>
        <option value="nao">não</option>
        <option value="nao_sei">ainda não perguntei</option>
      </select>
    </label>
  );
}

export function CartaoDoFornecedor({
  fornecedor,
  vendedor,
}: {
  readonly fornecedor: FornecedorGravado;
  readonly vendedor: string;
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
            {fornecedor.cnpj === null ? 'sem CNPJ' : `CNPJ ${fornecedor.cnpj}`}
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
          <dd>{respostaEmTexto(fornecedor.vendeDiretoMarketplace)}</dd>
        </div>
      </dl>

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
          <button className={estilo.botaoNeutro} type="submit">
            Gravar respostas
          </button>
          <p className={estilo.dica}>
            Campo em branco fica como está. “Ainda não perguntei” apaga a resposta de propósito — é
            diferente de “não”, e o sistema trata as duas coisas de formas diferentes.
          </p>
        </form>
      </details>

      {fornecedor.triagem.pendentes.length > 0 && (
        <details className={estilo.detalhe}>
          <summary>
            Mensagem de primeiro contato ({String(fornecedor.triagem.pendentes.length)} pergunta(s))
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
}: {
  readonly fornecedores: readonly FornecedorGravado[];
  readonly vendedor: string;
}) {
  if (fornecedores.length === 0) {
    return <p className={estilo.vazio}>Nenhum fornecedor cadastrado.</p>;
  }
  return (
    <ul className={estilo.lista}>
      {fornecedores.map((f) => (
        <CartaoDoFornecedor fornecedor={f} key={f.id} vendedor={vendedor} />
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
            <option value="">—</option>
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
            <option value="">—</option>
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
      <button className={estilo.botaoNeutro} type="submit">
        Cadastrar fornecedor
      </button>
      <p className={estilo.dica}>
        As cinco perguntas ficam em branco no começo, e é isso que você vai perguntar. Em branco não
        é “não”: é “ainda não sei”, e o sistema não decide nada com o que não sabe.
      </p>
    </form>
  );
}
