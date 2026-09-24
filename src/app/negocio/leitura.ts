/**
 * Do formulário "Meu negócio" para os dados que o domínio valida.
 *
 * A tela manda texto, e o esquema do domínio quer centavos e pontos-base. A conversão
 * mora aqui, e não na ação: módulo `'use server'` só exporta função assíncrona, e a
 * regra do que se aceita digitar merece teste.
 *
 * A recusa diz o campo e o motivo. "Dados inválidos" sozinho manda a pessoa reler dez
 * campos procurando o erro.
 */
import { esquemaDoNegocio, type DadosDoNegocio } from '@/dominio/perfil/negocio';
import { lerPercentualDigitado, lerReaisDigitados } from '@/lib/dinheiro';
import {
  CAMPOS_DO_FORMULARIO,
  ROTULO_DO_CAMPO,
  type CampoDoFormulario,
  type ValoresDoFormulario,
} from './apresentacao';

export type LeituraDoFormulario =
  | { readonly tipo: 'ok'; readonly dados: DadosDoNegocio }
  | { readonly tipo: 'invalido'; readonly motivo: string };

function ehCampo(valor: unknown): valor is CampoDoFormulario {
  return typeof valor === 'string' && (CAMPOS_DO_FORMULARIO as readonly string[]).includes(valor);
}

/** O texto de cada campo, aparado. Campo ausente é vazio. */
export function valoresDoFormulario(dados: FormData): ValoresDoFormulario {
  const texto = (campo: CampoDoFormulario): string => {
    const valor = dados.get(campo);
    return typeof valor === 'string' ? valor.trim() : '';
  };
  return {
    nome: texto('nome'),
    regime: texto('regime'),
    documento: texto('documento'),
    inscricaoEstadual: texto('inscricaoEstadual'),
    uf: texto('uf'),
    abertoEm: texto('abertoEm'),
    certificadoValidoAte: texto('certificadoValidoAte'),
    dasMensal: texto('dasMensal'),
    aliquotaSimples: texto('aliquotaSimples'),
    tetoAnual: texto('tetoAnual'),
  };
}

function recusa(campo: CampoDoFormulario, motivo: string): LeituraDoFormulario {
  return { tipo: 'invalido', motivo: `${ROTULO_DO_CAMPO[campo]} — ${motivo}` };
}

const REAIS = 'use um valor como 81,05, sem ponto de milhar.';

export function lerFormularioDoNegocio(valores: ValoresDoFormulario): LeituraDoFormulario {
  const dasMensal = valores.dasMensal === '' ? null : lerReaisDigitados(valores.dasMensal);
  if (valores.dasMensal !== '' && dasMensal === null) return recusa('dasMensal', REAIS);

  const tetoAnual = valores.tetoAnual === '' ? null : lerReaisDigitados(valores.tetoAnual);
  if (valores.tetoAnual !== '' && tetoAnual === null) return recusa('tetoAnual', REAIS);

  const aliquotaSimplesBp =
    valores.aliquotaSimples === '' ? null : lerPercentualDigitado(valores.aliquotaSimples);
  if (valores.aliquotaSimples !== '' && aliquotaSimplesBp === null) {
    return recusa('aliquotaSimples', 'use um percentual como 6 ou 6,5, até 100.');
  }

  const lido = esquemaDoNegocio.safeParse({
    nome: valores.nome,
    regime: valores.regime,
    documento: valores.documento,
    inscricaoEstadual: valores.inscricaoEstadual,
    uf: valores.uf,
    abertoEm: valores.abertoEm,
    certificadoValidoAte: valores.certificadoValidoAte,
    dasMensal,
    aliquotaSimplesBp,
    tetoAnual,
  });
  if (lido.success) return { tipo: 'ok', dados: lido.data };

  const problema = lido.error.issues[0];
  const caminho = problema?.path[0];
  const campo = caminho === 'aliquotaSimplesBp' ? 'aliquotaSimples' : caminho;
  const motivo = problema?.message ?? 'não deu para ler.';
  return ehCampo(campo) ? recusa(campo, motivo) : { tipo: 'invalido', motivo };
}
