/**
 * O estado da barra: em que pé cada loja está, e quantos pedidos esperam postagem.
 *
 * A barra pede isto a cada troca de tela (o porquê está em `leitura.ts`), e o nome de
 * quem está usando vem junto pelo mesmo motivo: o layout não se refaz ao navegar. Falha é
 * estado normal: sem banco, a rota responde 503 e a barra continua com os nomes das
 * lojas, só sem os números.
 */
import { lerAmbiente } from '@/config/ambiente';
import { RepositorioDeLojas } from '@/dominio/lojas/repositorio';
import { RepositorioDePedidos } from '@/dominio/pedidos/repositorio';
import { carregarPerfil } from '@/dominio/perfil';
import { banco } from '@/infra/banco/cliente';
import { criarRegistrador, nivelDoAmbiente } from '@/infra/log';
import { contaAtual } from '../acesso/sessao';
import { montarEstadoDaBarra } from './leitura';

export const dynamic = 'force-dynamic';

const log = criarRegistrador({
  nivelMinimo: nivelDoAmbiente(process.env['LOG_NIVEL']),
  contexto: { origem: 'estado_da_barra' },
});

export async function GET(): Promise<Response> {
  try {
    const db = banco();
    const perfil = await carregarPerfil(db, lerAmbiente().BANCADA_PERFIL_PADRAO);
    const [numeros, fila, conta] = await Promise.all([
      new RepositorioDeLojas(db).numeros(perfil.id),
      new RepositorioDePedidos(db).filaDoDia(perfil.id, new Date()),
      contaAtual(),
    ]);
    const nome = conta === null ? null : { nome: conta.nome };
    return Response.json(montarEstadoDaBarra(numeros, fila, nome), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (erro) {
    log.erro('barra.leitura_falhou', { erro });
    return Response.json({ erro: 'não deu para ler o estado das lojas' }, { status: 503 });
  }
}
