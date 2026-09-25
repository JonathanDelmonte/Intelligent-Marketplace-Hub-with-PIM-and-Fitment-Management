/**
 * Verificação de saúde (ADR 0010).
 *
 * A publicação pergunta aqui se a versão nova está de pé antes de dar a troca por
 * encerrada, e desfaz a troca quando não está. Responde 200 só quando o sistema **e** o
 * banco respondem, e diz qual versão está no ar — é assim que a publicação sabe que quem
 * respondeu é a versão nova, e não a velha que ainda não saiu.
 *
 * É uma das quatro rotas públicas (ADR 0011), e por isso não mostra dado nenhum.
 */
import { sql } from 'drizzle-orm';
import { lerAmbiente } from '@/config/ambiente';
import { banco } from '@/infra/banco/cliente';
import { criarRegistrador, nivelDoAmbiente } from '@/infra/log';

export const dynamic = 'force-dynamic';

const log = criarRegistrador({
  nivelMinimo: nivelDoAmbiente(process.env['LOG_NIVEL']),
  contexto: { origem: 'saude' },
});

const SEM_CACHE = { 'Cache-Control': 'no-store' } as const;

export async function GET(): Promise<Response> {
  const versao = lerAmbiente().VERSAO ?? null;
  try {
    await banco().execute(sql`select 1`);
    return Response.json({ situacao: 'funcionando', versao }, { headers: SEM_CACHE });
  } catch (erro) {
    log.erro('saude.banco_nao_respondeu', { erro });
    return Response.json({ situacao: 'sem banco', versao }, { status: 503, headers: SEM_CACHE });
  }
}
