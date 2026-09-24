/**
 * Ações da tela de perguntas.
 *
 * Uma: guardar o que foi colado. Não há ação de apagar pergunta — o histórico é o que
 * faz a conta de repetição existir, e apagar o incômodo apaga a evidência.
 *
 * A leitura do texto colado é pura e está em `apresentacao.ts`, com teste. Aqui só há
 * validação de fronteira (Zod, convenções seção 4) e gravação.
 *
 * `redirect()` do Next sinaliza por exceção, então nenhum `redirect` daqui está dentro
 * de `try`.
 */
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { lerAmbiente } from '@/config/ambiente';
import { PLATAFORMAS } from '@/dominio/precificacao/tipos';
import { carregarPerfil } from '@/dominio/perfil';
import { RepositorioDePerguntas } from '@/dominio/posvenda/repositorio';
import { banco } from '@/infra/banco/cliente';
import { criarRegistrador, nivelDoAmbiente } from '@/infra/log';
import { destinoComAviso, lerVolta, type Volta } from '../lojas/caminhos';
import { caminhoDaLoja } from '../navegacao';
import { lerPerguntas, type CodigoDeAviso } from './apresentacao';
import { CAMINHO } from './constantes';

const log = criarRegistrador({
  nivelMinimo: nivelDoAmbiente(process.env['LOG_NIVEL']),
  contexto: { origem: 'tela_perguntas' },
});

/** De volta à aba de perguntas da loja, quando o formulário veio dela; senão, a esta tela. */
function paraOnde(codigo: CodigoDeAviso, volta: Volta | null, quantidade?: number): string {
  return destinoComAviso(volta, CAMINHO, {
    r: codigo,
    ...(quantidade === undefined ? {} : { n: String(quantidade) }),
  });
}

/**
 * O anúncio é texto livre porque vem do painel da plataforma.
 *
 * Exigir que o anúncio exista no catálogo daqui perderia a pergunta — que é justamente
 * o dado que ensina o que falta no anúncio.
 */
const esquema = z.object({
  anuncio: z.string().trim().min(1).max(120),
  texto: z.string().min(1).max(20_000),
  // A loja é opcional: "não sei dizer" é resposta válida, e a pergunta fica na lista
  // geral em vez de ir para a loja errada (ADR 0009).
  plataforma: z.enum(PLATAFORMAS).optional(),
});

/** Campo vazio do formulário é "não informado", e não texto vazio. */
function opcional(valor: FormDataEntryValue | null): FormDataEntryValue | undefined {
  return valor === null || valor === '' ? undefined : valor;
}

export async function guardarPerguntas(dados: FormData): Promise<void> {
  const volta = lerVolta(dados.get('voltar'));
  const lido = esquema.safeParse({
    anuncio: dados.get('anuncio') ?? '',
    texto: dados.get('texto') ?? '',
    plataforma: opcional(dados.get('plataforma')),
  });

  if (!lido.success) {
    log.aviso('perguntas.formulario_invalido', { erro: lido.error.message });
    redirect(paraOnde('nada', volta));
  }

  const leitura = lerPerguntas(lido.data.texto);
  if (leitura.perguntas.length === 0) {
    log.aviso('perguntas.lote_vazio', { curtas: leitura.curtas });
    redirect(paraOnde('nada', volta));
  }

  let gravadas = 0;
  try {
    const db = banco();
    const perfil = await carregarPerfil(db, lerAmbiente().BANCADA_PERFIL_PADRAO);
    const resultado = await new RepositorioDePerguntas(db).registrarLote(
      perfil.id,
      leitura.perguntas.map((texto) => ({
        anuncioExterno: lido.data.anuncio,
        texto,
        plataforma: lido.data.plataforma ?? null,
      })),
    );
    gravadas = resultado.gravadas;
  } catch (erro) {
    log.erro('perguntas.gravacao_falhou', { erro });
    redirect(paraOnde('falha', volta));
  }

  revalidatePath(CAMINHO);
  if (lido.data.plataforma !== undefined) revalidatePath(caminhoDaLoja(lido.data.plataforma));
  redirect(gravadas === 0 ? paraOnde('so_repetidas', volta) : paraOnde('gravado', volta, gravadas));
}
