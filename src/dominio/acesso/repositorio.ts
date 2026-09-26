/**
 * Contas e sessões no banco (ADR 0011).
 *
 * O banco é quem diz se uma sessão ainda vale: o cookie assinado prova que foi este
 * servidor que a abriu, mas sair e trocar a senha encerram sessões — e isso só o banco
 * sabe. A conferência completa mora aqui, e é chamada junto do acesso aos dados.
 */
import { and, count, eq, gt, isNull, sql } from 'drizzle-orm';
import type { Banco } from '@/infra/banco/cliente';
import { sessao, usuario } from '@/infra/banco/schema';

/** Quem está usando o sistema. Nunca leva o hash da senha para fora deste arquivo. */
export interface Usuario {
  readonly id: string;
  readonly nome: string;
  readonly email: string;
}

/** O e-mail como chave: aparado e minúsculo. "Fulano@Loja.com " e "fulano@loja.com" são um. */
export function normalizarEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Código de violação de unicidade do Postgres. */
const VIOLACAO_DE_UNICIDADE = '23505';

function ehViolacaoDeUnicidade(erro: unknown): boolean {
  if (typeof erro !== 'object' || erro === null) return false;
  const causa = 'cause' in erro ? erro.cause : undefined;
  const codigo = (alvo: unknown): unknown =>
    typeof alvo === 'object' && alvo !== null && 'code' in alvo ? alvo.code : undefined;
  return codigo(erro) === VIOLACAO_DE_UNICIDADE || codigo(causa) === VIOLACAO_DE_UNICIDADE;
}

export type ResultadoDoCadastro =
  { readonly tipo: 'criado'; readonly usuario: Usuario } | { readonly tipo: 'email_em_uso' };

export class RepositorioDeAcesso {
  constructor(private readonly db: Banco) {}

  /**
   * Cria uma conta. E-mail repetido não é erro: é resposta, e a tela diz qual.
   *
   * A unicidade é do banco (`unique` na coluna), e não de uma consulta antes do
   * `insert`: dois cadastros ao mesmo tempo passariam pela consulta juntos.
   */
  async criarUsuario(dados: {
    readonly nome: string;
    readonly email: string;
    readonly senhaHash: string;
  }): Promise<ResultadoDoCadastro> {
    try {
      const [criado] = await this.db
        .insert(usuario)
        .values({
          nome: dados.nome.trim(),
          email: normalizarEmail(dados.email),
          senhaHash: dados.senhaHash,
        })
        .returning({ id: usuario.id, nome: usuario.nome, email: usuario.email });
      if (criado === undefined) throw new Error('o banco não devolveu a conta criada');
      return { tipo: 'criado', usuario: criado };
    } catch (erro) {
      if (ehViolacaoDeUnicidade(erro)) return { tipo: 'email_em_uso' };
      throw erro;
    }
  }

  /** A conta ativa do e-mail, com o hash — só para conferir a senha na entrada. */
  async paraEntrar(email: string): Promise<(Usuario & { readonly senhaHash: string }) | null> {
    const [linha] = await this.db
      .select({
        id: usuario.id,
        nome: usuario.nome,
        email: usuario.email,
        senhaHash: usuario.senhaHash,
      })
      .from(usuario)
      .where(and(eq(usuario.email, normalizarEmail(email)), eq(usuario.ativo, true)))
      .limit(1);
    return linha ?? null;
  }

  async quantasContas(): Promise<number> {
    const [linha] = await this.db.select({ n: count() }).from(usuario);
    return linha?.n ?? 0;
  }

  /**
   * Troca a senha e encerra todas as sessões da conta.
   *
   * Encerrar é a razão de trocar: quem troca a senha porque desconfia de alguém quer esse
   * alguém fora, inclusive do aparelho em que ele já estava. Devolve a conta, ou `null`
   * quando o e-mail não é de conta ativa.
   */
  async trocarSenha(email: string, senhaHash: string, agora: Date): Promise<Usuario | null> {
    return this.db.transaction(async (tx) => {
      const [conta] = await tx
        .update(usuario)
        .set({ senhaHash, atualizadoEm: agora })
        .where(and(eq(usuario.email, normalizarEmail(email)), eq(usuario.ativo, true)))
        .returning({ id: usuario.id, nome: usuario.nome, email: usuario.email });
      if (conta === undefined) return null;
      await tx
        .update(sessao)
        .set({ encerradaEm: agora, atualizadoEm: agora })
        .where(and(eq(sessao.usuarioId, conta.id), isNull(sessao.encerradaEm)));
      return conta;
    });
  }

  /** Abre uma sessão e marca o acesso. Devolve o id, que vai assinado no cookie. */
  async abrirSessao(params: {
    readonly usuarioId: string;
    readonly expiraEm: Date;
    readonly agente: string | null;
    readonly agora: Date;
  }): Promise<string> {
    return this.db.transaction(async (tx) => {
      const [aberta] = await tx
        .insert(sessao)
        .values({
          usuarioId: params.usuarioId,
          expiraEm: params.expiraEm,
          agente: params.agente === null ? null : params.agente.slice(0, 300),
        })
        .returning({ id: sessao.id });
      if (aberta === undefined) throw new Error('o banco não devolveu a sessão aberta');
      await tx
        .update(usuario)
        .set({ ultimoAcessoEm: params.agora })
        .where(eq(usuario.id, params.usuarioId));
      return aberta.id;
    });
  }

  /**
   * A conta de uma sessão que ainda vale: não encerrada, não vencida, de conta ativa.
   * Qualquer outra coisa é `null`, e quem chama manda para a tela de entrar.
   */
  async usuarioDaSessao(sessaoId: string, agora: Date): Promise<Usuario | null> {
    const [linha] = await this.db
      .select({ id: usuario.id, nome: usuario.nome, email: usuario.email })
      .from(sessao)
      .innerJoin(usuario, eq(usuario.id, sessao.usuarioId))
      .where(
        and(
          eq(sessao.id, sessaoId),
          isNull(sessao.encerradaEm),
          gt(sessao.expiraEm, agora),
          eq(usuario.ativo, true),
        ),
      )
      .limit(1);
    return linha ?? null;
  }

  async encerrarSessao(sessaoId: string, agora: Date): Promise<void> {
    await this.db
      .update(sessao)
      .set({ encerradaEm: agora, atualizadoEm: agora })
      .where(and(eq(sessao.id, sessaoId), isNull(sessao.encerradaEm)));
  }

  /**
   * Apaga sessões vencidas ou encerradas há mais de 30 dias. A tabela não cresce para
   * sempre, e o que ainda é recente fica, para a pessoa ver de onde saiu.
   */
  async limparSessoesAntigas(agora: Date): Promise<number> {
    const limite = new Date(agora.getTime() - 30 * 24 * 60 * 60 * 1000);
    const apagadas = await this.db
      .delete(sessao)
      .where(sql`coalesce(${sessao.encerradaEm}, ${sessao.expiraEm}) < ${limite.toISOString()}`)
      .returning({ id: sessao.id });
    return apagadas.length;
  }
}
