/**
 * Contas e sessões contra Postgres de verdade: a unicidade do e-mail e o encerramento
 * de sessões são do banco, e é o banco que precisa ser testado.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  abrirBancoDeTeste,
  limparTabelas,
  temBancoDeTeste,
  type ConexaoDeTeste,
} from '@/infra/banco/teste';
import { normalizarEmail, RepositorioDeAcesso } from './repositorio';

const AGORA = new Date('2026-09-25T12:00:00.000Z');
const EM_30_DIAS = new Date('2026-10-25T12:00:00.000Z');

describe('normalizarEmail', () => {
  it('apara e deixa minúsculo', () => {
    expect(normalizarEmail('  Fulano@Loja.COM ')).toBe('fulano@loja.com');
  });
});

describe.skipIf(!temBancoDeTeste())('RepositorioDeAcesso', () => {
  let conexao: ConexaoDeTeste;
  let repo: RepositorioDeAcesso;

  beforeEach(async () => {
    conexao ??= abrirBancoDeTeste();
    repo = new RepositorioDeAcesso(conexao.db);
    await limparTabelas(conexao.db, ['sessao', 'usuario']);
  });

  afterAll(async () => {
    await conexao?.encerrar();
  });

  const criar = async (email = 'Eu@Loja.com') => {
    const r = await repo.criarUsuario({ nome: ' Eu ', email, senhaHash: 'scrypt$hash' });
    if (r.tipo !== 'criado') throw new Error('esperava conta criada');
    return r.usuario;
  };

  it('cria a conta com o e-mail normalizado, e recusa o mesmo e-mail escrito de outro jeito', async () => {
    const conta = await criar();
    expect(conta).toMatchObject({ nome: 'Eu', email: 'eu@loja.com' });
    expect(await repo.quantasContas()).toBe(1);

    const repetido = await repo.criarUsuario({
      nome: 'Outro',
      email: ' EU@loja.com',
      senhaHash: 'scrypt$x',
    });
    expect(repetido).toEqual({ tipo: 'email_em_uso' });
  });

  it('a sessão aberta vale até vencer ou ser encerrada', async () => {
    const conta = await criar();
    const id = await repo.abrirSessao({
      usuarioId: conta.id,
      expiraEm: EM_30_DIAS,
      agente: 'navegador de teste',
      agora: AGORA,
    });

    expect(await repo.usuarioDaSessao(id, AGORA)).toEqual(conta);
    expect(await repo.usuarioDaSessao(id, EM_30_DIAS)).toBeNull();

    await repo.encerrarSessao(id, AGORA);
    expect(await repo.usuarioDaSessao(id, AGORA)).toBeNull();
  });

  it('trocar a senha encerra todas as sessões da conta', async () => {
    const conta = await criar();
    const abrir = () =>
      repo.abrirSessao({ usuarioId: conta.id, expiraEm: EM_30_DIAS, agente: null, agora: AGORA });
    const [celular, computador] = [await abrir(), await abrir()];

    const trocada = await repo.trocarSenha('EU@loja.com', 'scrypt$nova', AGORA);
    expect(trocada?.id).toBe(conta.id);
    expect(await repo.usuarioDaSessao(celular, AGORA)).toBeNull();
    expect(await repo.usuarioDaSessao(computador, AGORA)).toBeNull();
    expect((await repo.paraEntrar('eu@loja.com'))?.senhaHash).toBe('scrypt$nova');
  });

  it('e-mail sem conta não troca senha nem entra', async () => {
    expect(await repo.trocarSenha('ninguem@loja.com', 'scrypt$x', AGORA)).toBeNull();
    expect(await repo.paraEntrar('ninguem@loja.com')).toBeNull();
  });

  it('limpa só as sessões antigas', async () => {
    const conta = await criar();
    const antiga = await repo.abrirSessao({
      usuarioId: conta.id,
      expiraEm: new Date('2026-07-01T00:00:00.000Z'),
      agente: null,
      agora: AGORA,
    });
    const atual = await repo.abrirSessao({
      usuarioId: conta.id,
      expiraEm: EM_30_DIAS,
      agente: null,
      agora: AGORA,
    });
    expect(await repo.limparSessoesAntigas(AGORA)).toBe(1);
    expect(await repo.usuarioDaSessao(atual, AGORA)).not.toBeNull();
    expect(await repo.usuarioDaSessao(antiga, AGORA)).toBeNull();
  });
});
