/**
 * Ação da tela "Meu negócio": gravar os dados do negócio.
 *
 * Validada com Zod, porque formulário é fronteira externa (convenções, seção 4). Um
 * campo recusado recusa o formulário inteiro e não grava o resto — gravar metade deixaria
 * a pessoa achando que o regime mudou quando só o nome mudou.
 *
 * Diferente das outras telas, a recusa não redireciona: volta como estado, com o que foi
 * digitado, para o formulário não apagar nove campos certos por causa de um errado. O
 * sucesso redireciona como sempre, e o `redirect` fica fora do `try`.
 */
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { lerAmbiente } from '@/config/ambiente';
import { carregarPerfil } from '@/dominio/perfil';
import { RepositorioDoNegocio } from '@/dominio/perfil/negocio';
import { banco } from '@/infra/banco/cliente';
import { criarRegistrador, nivelDoAmbiente } from '@/infra/log';
import type { CodigoDeAviso, EstadoDoFormulario } from './apresentacao';
import { CAMINHO } from './constantes';
import { lerFormularioDoNegocio, valoresDoFormulario } from './leitura';

const log = criarRegistrador({
  nivelMinimo: nivelDoAmbiente(process.env['LOG_NIVEL']),
  contexto: { origem: 'tela_negocio' },
});

export async function gravarNegocio(
  _anterior: EstadoDoFormulario,
  dados: FormData,
): Promise<EstadoDoFormulario> {
  const valores = valoresDoFormulario(dados);
  const lido = lerFormularioDoNegocio(valores);
  if (lido.tipo === 'invalido') {
    // O motivo vai para o log, e os valores não: CPF é dado pessoal, e o motivo diz o
    // que estava errado sem repetir o documento.
    log.aviso('negocio.formulario_recusado', { motivo: lido.motivo });
    return { tipo: 'recusado', motivo: lido.motivo, valores, vez: Date.now() };
  }

  let gravou = false;
  try {
    const db = banco();
    const perfil = await carregarPerfil(db, lerAmbiente().BANCADA_PERFIL_PADRAO);
    gravou = await new RepositorioDoNegocio(db).gravar(perfil.id, lido.dados);
  } catch (erro) {
    log.erro('negocio.gravacao_falhou', { erro });
  }
  if (!gravou) return { tipo: 'falhou', valores, vez: Date.now() };

  // O regime muda a margem do catálogo, o teto da tela fiscal e o emissor recomendado:
  // tudo que foi desenhado com o dado antigo sai do cache.
  revalidatePath('/', 'layout');
  redirect(`${CAMINHO}?r=${'gravado' satisfies CodigoDeAviso}`);
}
