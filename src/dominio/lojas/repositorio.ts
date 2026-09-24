/**
 * Leituras por loja: em que pé cada uma está, e os números dela (ADR 0009).
 *
 * Toda consulta é do perfil (ADR 0003) e agrupa pela coluna `plataforma` do pedido. É
 * o único filtro que a área da loja usa — nenhuma leitura pergunta o nome de uma
 * plataforma, e é isso que faz loja nova não precisar de consulta nova.
 */
import { and, count, eq, max } from 'drizzle-orm';
import type { PerfilId } from '@/dominio/catalogo/sku';
import { PLATAFORMAS, type Plataforma } from '@/dominio/precificacao/tipos';
import type { Banco } from '@/infra/banco/cliente';
import { credencial, pedido } from '@/infra/banco/schema';
import type { NumerosDaLoja } from './estado';

export class RepositorioDeLojas {
  constructor(private readonly db: Banco) {}

  /**
   * Pedidos, pedido mais recente e conexão de cada loja, na ordem do domínio.
   *
   * Loja sem pedido nenhum volta com zero, e não some: a barra mostra todas as lojas
   * que o sistema atende, e "sem dados" é um estado da loja, não a ausência dela.
   *
   * Conectada é credencial OAuth ativa. A validade do token não entra: token vencido
   * com refresh válido continua conectado, e o refresh que falhar desliga a credencial.
   */
  async numeros(perfil: PerfilId): Promise<readonly NumerosDaLoja[]> {
    const [pedidos, conexoes] = await Promise.all([
      this.db
        .select({
          plataforma: pedido.plataforma,
          pedidos: count(),
          ultimo: max(pedido.data),
        })
        .from(pedido)
        .where(eq(pedido.perfilId, perfil))
        .groupBy(pedido.plataforma),
      this.db
        .select({ plataforma: credencial.plataforma })
        .from(credencial)
        .where(
          and(
            eq(credencial.perfilId, perfil),
            eq(credencial.ativo, true),
            eq(credencial.tipo, 'oauth'),
          ),
        ),
    ]);

    const conectadas = new Set<Plataforma>(conexoes.map((c) => c.plataforma));
    return PLATAFORMAS.map((plataforma) => {
      const linha = pedidos.find((p) => p.plataforma === plataforma);
      return {
        plataforma,
        pedidos: linha?.pedidos ?? 0,
        ultimoPedidoEm: linha?.ultimo ?? null,
        conectada: conectadas.has(plataforma),
      };
    });
  }
}
