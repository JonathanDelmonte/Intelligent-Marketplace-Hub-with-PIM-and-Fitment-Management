'use client';

/**
 * O formulário de "Meu negócio".
 *
 * Componente de cliente por um motivo só: quando a gravação é recusada, o que foi
 * digitado volta nos campos. As outras telas redirecionam com um código de aviso e
 * recarregam do banco — o que, num formulário de dez campos, apagaria nove campos certos
 * por causa de um errado.
 *
 * Os campos são agrupados pelo que decidem: quem vende (a tabela de comissão), a nota
 * fiscal (o emissor e o que falta para ele), e o imposto e o teto (a margem e o limite
 * do MEI). Campo de um regime que não é o seu fica visível, com a dica dizendo de qual
 * regime ele é — esconder exigiria JavaScript só para isso, e trocar de regime é raro.
 */
import { useActionState } from 'react';
import { UFS } from '@/dominio/perfil/uf';
import { REGIMES_FISCAIS } from '@/dominio/precificacao/tipos';
import { gravarNegocio } from './acoes';
import {
  ROTULO_DO_CAMPO,
  ROTULO_DO_REGIME,
  type CampoDoFormulario,
  type EstadoDoFormulario,
  type ValoresDoFormulario,
} from './apresentacao';
import estilo from './negocio.module.css';

const INICIAL: EstadoDoFormulario = { tipo: 'inicial' };

function Dica({
  campo,
  children,
}: {
  readonly campo: CampoDoFormulario;
  readonly children: string;
}) {
  return (
    <span className={estilo.dica} id={`${campo}-dica`}>
      {children}
    </span>
  );
}

function Campo({
  campo,
  valores,
  dica,
  tipo = 'text',
  decimal = false,
  marcador,
}: {
  readonly campo: CampoDoFormulario;
  readonly valores: ValoresDoFormulario;
  readonly dica: string;
  readonly tipo?: 'text' | 'date';
  readonly decimal?: boolean;
  readonly marcador?: string;
}) {
  return (
    <label className={estilo.campo}>
      {ROTULO_DO_CAMPO[campo]}
      <input
        aria-describedby={`${campo}-dica`}
        className={estilo.entrada}
        defaultValue={valores[campo]}
        inputMode={decimal ? 'decimal' : undefined}
        name={campo}
        placeholder={marcador}
        type={tipo}
      />
      <Dica campo={campo}>{dica}</Dica>
    </label>
  );
}

export function FormularioDoNegocio({
  gravados,
  tetoDoMei,
}: {
  /** O que está gravado, como texto de campo. */
  readonly gravados: ValoresDoFormulario;
  /** O teto da lei, já formatado, para a dica do campo de teto. */
  readonly tetoDoMei: string;
}) {
  const [estado, acao, enviando] = useActionState(gravarNegocio, INICIAL);
  const valores = estado.tipo === 'inicial' ? gravados : estado.valores;

  return (
    <form
      action={acao}
      className={estilo.formulario}
      key={estado.tipo === 'inicial' ? 0 : estado.vez}
    >
      {estado.tipo === 'recusado' && (
        <div className={`${estilo.aviso} ${estilo.avisoAtencao}`} role="alert">
          <strong className={estilo.avisoTitulo}>Nada foi gravado</strong>
          <span className={estilo.avisoCorpo}>{estado.motivo}</span>
        </div>
      )}
      {estado.tipo === 'falhou' && (
        <div className={`${estilo.aviso} ${estilo.avisoErro}`} role="alert">
          <strong className={estilo.avisoTitulo}>Não deu para gravar</strong>
          <span className={estilo.avisoCorpo}>
            Nada foi alterado, e o que você digitou continua nos campos. Tente de novo; se repetir,
            o log do servidor tem o motivo.
          </span>
        </div>
      )}

      <fieldset className={estilo.grupo}>
        <legend className={estilo.grupoTitulo}>Quem vende</legend>
        <Campo campo="nome" dica="Como o negócio aparece para você no sistema." valores={valores} />
        <label className={estilo.campo}>
          {ROTULO_DO_CAMPO.regime}
          <select
            aria-describedby="regime-dica"
            className={estilo.entrada}
            defaultValue={valores.regime}
            name="regime"
          >
            {REGIMES_FISCAIS.map((regime) => (
              <option key={regime} value={regime}>
                {ROTULO_DO_REGIME[regime]}
              </option>
            ))}
          </select>
          <Dica campo="regime">
            Decide a comissão de cada plataforma e o imposto que entra na margem.
          </Dica>
        </label>
        <Campo
          campo="documento"
          dica="MEI e Simples usam o CNPJ; pessoa física, o CPF. Pode colar com ponto e traço, e o CNPJ com letras também vale. Em branco se ainda não tem."
          marcador="00.000.000/0000-00"
          valores={valores}
        />
      </fieldset>

      <fieldset className={estilo.grupo}>
        <legend className={estilo.grupoTitulo}>Nota fiscal</legend>
        <label className={estilo.campo}>
          {ROTULO_DO_CAMPO.uf}
          <select
            aria-describedby="uf-dica"
            className={estilo.entrada}
            defaultValue={valores.uf}
            name="uf"
          >
            <option value="">Não informado</option>
            {UFS.map((uf) => (
              <option key={uf} value={uf}>
                {uf}
              </option>
            ))}
          </select>
          <Dica campo="uf">
            A nota vai para a SEFAZ deste estado, e há estado em que o emissor do Mercado Livre pede
            credenciamento antes.
          </Dica>
        </label>
        <Campo
          campo="inscricaoEstadual"
          dica="A inscrição na SEFAZ, que nota de mercadoria exige. Em branco se ainda não tem."
          valores={valores}
        />
        <Campo
          campo="abertoEm"
          dica="No ano em que o CNPJ abre, o teto do MEI é proporcional aos meses de atividade."
          tipo="date"
          valores={valores}
        />
        <Campo
          campo="certificadoValidoAte"
          dica="O certificado digital A1 (e-CNPJ), que assina a nota. Em branco se não tem; vencido, ele aparece no que falta para emitir."
          tipo="date"
          valores={valores}
        />
      </fieldset>

      <fieldset className={estilo.grupo}>
        <legend className={estilo.grupoTitulo}>Imposto e teto</legend>
        <Campo
          campo="dasMensal"
          decimal
          dica="Só no MEI: o valor fixo do mês, rateado pelas unidades vendidas na margem de cada peça."
          marcador="0,00"
          valores={valores}
        />
        <Campo
          campo="aliquotaSimples"
          decimal
          dica="Só no Simples: a alíquota efetiva da sua faixa, aplicada sobre o preço."
          marcador="0"
          valores={valores}
        />
        <Campo
          campo="tetoAnual"
          decimal
          dica={`Em branco, no MEI, vale o teto da lei: ${tetoDoMei} por ano.`}
          valores={valores}
        />
      </fieldset>

      <button className={estilo.botao} disabled={enviando} type="submit">
        {enviando ? 'Gravando…' : 'Gravar'}
      </button>
    </form>
  );
}
