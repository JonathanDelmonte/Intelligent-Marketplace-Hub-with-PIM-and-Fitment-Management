/**
 * Ações da tela de afiliados.
 *
 * Três: pôr oferta na fila, marcar que ela saiu no grupo, e informar o que o grupo
 * respondeu. Não há ação de publicar de verdade — quem posta no grupo é a pessoa, no
 * aplicativo dela, e o sistema registra a hora para saber quando a próxima pode sair.
 *
 * Também não há ação de apagar oferta publicada: a hora da publicação é de onde sai o
 * espaçamento e o teto do dia, e apagar o registro liberaria a próxima antes da hora.
 *
 * `redirect()` do Next sinaliza por exceção, então nenhum `redirect` daqui está dentro
 * de `try`.
 */
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { lerAmbiente } from '@/config/ambiente';
import { linkDeAfiliado } from '@/dominio/afiliados/publicacao';
import { RepositorioDeOfertas } from '@/dominio/afiliados/repositorio';
import { PLATAFORMAS, type Plataforma } from '@/dominio/precificacao/tipos';
import { banco } from '@/infra/banco/cliente';
import { criarRegistrador, nivelDoAmbiente } from '@/infra/log';
import { pontosBase } from '@/lib/dinheiro';
import {
  descontoContra,
  lerPreco,
  tagsDoAmbiente,
  VARIAVEL_DA_TAG,
  type CodigoDeAviso,
} from './apresentacao';
import { CAMINHO } from './constantes';

const log = criarRegistrador({
  nivelMinimo: nivelDoAmbiente(process.env['LOG_NIVEL']),
  contexto: { origem: 'tela_afiliados' },
});

function paraOnde(codigo: CodigoDeAviso): string {
  return `${CAMINHO}?${new URLSearchParams({ r: codigo }).toString()}`;
}

/**
 * A oferta como o formulário a manda.
 *
 * A referência é opcional e o preço não: sem preço não há oferta, e sem referência há
 * oferta sem desconto medido — que entra na fila no fim, e não é erro.
 *
 * Não há campo de "preço de antes". É de propósito: o módulo inteiro existe para medir
 * desconto contra a **mediana de 90 dias**, e um campo de preço de ontem convidaria
 * exatamente a comparação que ele recusa.
 */
const esquemaDaOferta = z.object({
  plataforma: z.enum(PLATAFORMAS),
  url: z.string().trim().min(1).max(2_000),
  preco: z.string().trim().min(1).max(24),
  referencia: z.string().trim().max(24),
});

export async function cadastrarOferta(dados: FormData): Promise<void> {
  const lido = esquemaDaOferta.safeParse({
    plataforma: dados.get('plataforma') ?? '',
    url: dados.get('url') ?? '',
    preco: dados.get('preco') ?? '',
    referencia: dados.get('referencia') ?? '',
  });

  if (!lido.success) {
    log.aviso('afiliados.formulario_invalido', { erro: lido.error.message });
    redirect(paraOnde('url_invalida'));
  }

  // A tag primeiro: é problema de configuração, e sem ela nada do resto importa.
  const tag = tagsDoAmbiente(lerAmbiente())[lido.data.plataforma];
  if (tag === null) {
    log.aviso('afiliados.sem_tag', { variavel: VARIAVEL_DA_TAG[lido.data.plataforma] });
    redirect(paraOnde('sem_tag'));
  }

  const preco = lerPreco(lido.data.preco);
  if (preco === null) redirect(paraOnde('preco_invalido'));

  const referencia = lido.data.referencia === '' ? null : lerPreco(lido.data.referencia);
  if (lido.data.referencia !== '' && referencia === null) redirect(paraOnde('preco_invalido'));

  const link = montarLink(lido.data.url, lido.data.plataforma, tag);
  if (link === null) redirect(paraOnde('url_invalida'));

  try {
    await new RepositorioDeOfertas(banco()).registrar({
      plataforma: lido.data.plataforma,
      urlAfiliado: link,
      preco,
      medianaNoventaDias: referencia,
      scoreDescontoBp: descontoContra(preco, referencia) ?? pontosBase(0),
    });
  } catch (erro) {
    log.erro('afiliados.gravacao_falhou', { erro });
    redirect(paraOnde('falha'));
  }

  revalidatePath(CAMINHO);
  redirect(paraOnde('gravada'));
}

/**
 * Monta o link, ou `null`.
 *
 * `linkDeAfiliado` lança para URL inválida, e aqui isso é estado previsto — quem
 * digita cola o endereço à mão. O `try` fica nesta função para nenhum `redirect`
 * acontecer dentro dele.
 */
function montarLink(url: string, plataforma: Plataforma, tag: string): string | null {
  try {
    return linkDeAfiliado(url, plataforma, tag);
  } catch (erro) {
    log.aviso('afiliados.url_invalida', { erro });
    return null;
  }
}

const esquemaDeId = z.string().trim().uuid();

/**
 * Marca que a oferta saiu no grupo.
 *
 * Duas vezes não reescreve a hora, e a tela diz isso em vez de fingir sucesso: a hora
 * da primeira publicação é a que conta o intervalo até a próxima.
 */
export async function marcarPublicada(dados: FormData): Promise<void> {
  const id = esquemaDeId.safeParse(dados.get('id') ?? '');
  if (!id.success) {
    log.aviso('afiliados.id_invalido', {});
    redirect(paraOnde('falha'));
  }

  let marcou = false;
  try {
    marcou = await new RepositorioDeOfertas(banco()).marcarPublicada(id.data, new Date());
  } catch (erro) {
    log.erro('afiliados.publicar_falhou', { erro });
    redirect(paraOnde('falha'));
  }

  revalidatePath(CAMINHO);
  redirect(paraOnde(marcou ? 'publicada' : 'ja_publicada'));
}

/**
 * Os números do painel de afiliado.
 *
 * Conversão não passa de clique porque ninguém compra sem clicar: número assim é erro
 * de digitação, e aceitá-lo produziria conversão acima de 100% na tela — que é o tipo
 * de número que faz desconfiar da tela inteira, e com razão.
 */
const esquemaDosNumeros = z
  .object({
    id: esquemaDeId,
    cliques: z.coerce.number().int().min(0).max(10_000_000),
    conversoes: z.coerce.number().int().min(0).max(10_000_000),
  })
  .refine((n) => n.conversoes <= n.cliques, {
    message: 'conversão não pode passar de clique',
  });

export async function informarDesempenho(dados: FormData): Promise<void> {
  const lido = esquemaDosNumeros.safeParse({
    id: dados.get('id') ?? '',
    cliques: dados.get('cliques') ?? '',
    conversoes: dados.get('conversoes') ?? '',
  });

  if (!lido.success) {
    log.aviso('afiliados.numeros_invalidos', { erro: lido.error.message });
    redirect(paraOnde('numero_invalido'));
  }

  try {
    await new RepositorioDeOfertas(banco()).informarDesempenho(lido.data.id, {
      cliques: lido.data.cliques,
      conversoes: lido.data.conversoes,
    });
  } catch (erro) {
    log.erro('afiliados.desempenho_falhou', { erro });
    redirect(paraOnde('falha'));
  }

  revalidatePath(CAMINHO);
  redirect(paraOnde('desempenho'));
}
