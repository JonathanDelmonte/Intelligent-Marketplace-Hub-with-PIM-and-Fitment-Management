/**
 * Ações da tela de anúncio.
 *
 * Uma só, e ela existe por causa de um buraco que a tela revelou ao ser usada:
 * `categoria` é o único atributo que **impede exportar**, e nenhuma tela do sistema
 * escrevia `categoria_ml`. O checklist apontava o problema e não havia caminho de
 * conserto — que é meio checklist, e a metade inútil.
 *
 * A montagem em si não é ação de servidor: é formulário GET, porque precisa virar
 * URL (ver `parametros.ts`). Esta é diferente — grava no catálogo.
 *
 * `redirect()` do Next sinaliza por exceção, então nenhum `redirect` daqui está
 * dentro de `try`.
 */
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { lerAmbiente } from '@/config/ambiente';
import { RepositorioDeAnuncios } from '@/dominio/anuncios/repositorio';
import { carregarPerfil } from '@/dominio/perfil';
import { banco } from '@/infra/banco/cliente';
import { criarRegistrador, nivelDoAmbiente } from '@/infra/log';
import { CAMINHO } from './constantes';

const log = criarRegistrador({
  nivelMinimo: nivelDoAmbiente(process.env['LOG_NIVEL']),
  contexto: { origem: 'tela_de_anuncios' },
});

const esquema = z.object({
  skuId: z.string().trim().uuid(),
  categoria: z.string().trim().min(1).max(200),
  /**
   * Para onde voltar depois de gravar.
   *
   * **Só caminho interno desta tela.** Aceitar URL qualquer daqui seria
   * redirecionamento aberto: um link montado por terceiro levaria a pessoa para
   * fora com a aparência de ter saído do sistema. O guarda é o formato, não a
   * confiança em quem enviou.
   */
  voltarPara: z
    .string()
    .trim()
    .refine((v) => v === CAMINHO || v.startsWith(`${CAMINHO}?`), {
      message: 'destino fora da tela de anúncio',
    })
    .default(CAMINHO),
});

export async function salvarCategoria(dados: FormData): Promise<void> {
  const lido = esquema.safeParse({
    skuId: dados.get('skuId') ?? '',
    categoria: dados.get('categoria') ?? '',
    ...(typeof dados.get('voltarPara') === 'string' && dados.get('voltarPara') !== ''
      ? { voltarPara: dados.get('voltarPara') }
      : {}),
  });

  if (!lido.success) {
    log.aviso('anuncio.categoria_invalida', { erro: lido.error.message });
    redirect(`${CAMINHO}?r=parametros`);
  }

  const { skuId, categoria, voltarPara } = lido.data;
  let gravou = false;

  try {
    const db = banco();
    const perfil = await carregarPerfil(db, lerAmbiente().BANCADA_PERFIL_PADRAO);
    gravou = await new RepositorioDeAnuncios(db).definirCategoriaMl(perfil.id, skuId, categoria);
  } catch (erro) {
    log.erro('anuncio.categoria_falhou', { skuId, erro });
    redirect(`${CAMINHO}?r=parametros`);
  }

  if (!gravou) redirect(`${CAMINHO}?r=sku_inexistente`);

  revalidatePath(CAMINHO);
  // Volta para a montagem que estava na tela, não para a tela vazia: a pessoa
  // preencheu a categoria **para** ver o anúncio sair, e perder a escolha aqui
  // faria ela refazer tudo.
  redirect(voltarPara);
}
