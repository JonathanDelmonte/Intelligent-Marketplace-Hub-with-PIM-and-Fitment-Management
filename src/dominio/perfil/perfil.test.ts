/**
 * Testes do perfil ativo.
 *
 * A parte que tem regra é a tradução para o contexto do M8, e a regra que mais
 * importa é sobre **ausência**: campo que não se sabe fica de fora, e não vira
 * zero. Zero é uma afirmação; ausente é a verdade.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { perfilVendedor } from '@/infra/banco/schema';
import {
  abrirBancoDeTeste,
  limparTabelas,
  temBancoDeTeste,
  type ConexaoDeTeste,
} from '@/infra/banco/teste';
import {
  PerfilNaoEncontrado,
  carregarPerfil,
  contextoDoVendedorDe,
  nomeLegivelDoSlug,
} from './index';

describe('tradução para o contexto do M8', () => {
  it('CPF não tem CNPJ, e isso muda a tabela de comissão', () => {
    expect(
      contextoDoVendedorDe({ regime: 'cpf', dasMensal: 7500, aliquotaSimplesBp: 600 }),
    ).toEqual({ regimeFiscal: 'cpf', temCnpj: false });
  });

  it('MEI leva o DAS quando ele existe', () => {
    expect(
      contextoDoVendedorDe({ regime: 'mei', dasMensal: 7500, aliquotaSimplesBp: null }),
    ).toEqual({ regimeFiscal: 'mei', temCnpj: true, dasMensal: 7500 });
  });

  it('DAS ausente fica de fora em vez de virar zero', () => {
    // Zero afirmaria "não pago DAS". Ausente diz "não sei quanto", e é o que o
    // M8 precisa saber para avisar em vez de calcular errado.
    const contexto = contextoDoVendedorDe({
      regime: 'mei',
      dasMensal: null,
      aliquotaSimplesBp: null,
    });

    expect(contexto).toEqual({ regimeFiscal: 'mei', temCnpj: true });
    expect('dasMensal' in contexto).toBe(false);
  });

  it('Simples leva a alíquota, e não leva o DAS mesmo que esteja gravado', () => {
    const contexto = contextoDoVendedorDe({
      regime: 'simples',
      dasMensal: 7500,
      aliquotaSimplesBp: 600,
    });

    expect(contexto).toEqual({ regimeFiscal: 'simples', temCnpj: true, aliquotaSimples: 600 });
    expect('dasMensal' in contexto).toBe(false);
  });

  it('nunca inventa unidades previstas no mês', () => {
    // Não existe na tabela, e virá do M10 quando houver histórico de pedido.
    // Inventar faria o M8 ratear o DAS sobre um número imaginário.
    for (const regime of ['cpf', 'mei', 'simples'] as const) {
      const contexto = contextoDoVendedorDe({ regime, dasMensal: 7500, aliquotaSimplesBp: 600 });
      expect('unidadesPrevistasNoMes' in contexto, regime).toBe(false);
    }
  });
});

describe.skipIf(!temBancoDeTeste())('carregamento do perfil', () => {
  let conexao: ConexaoDeTeste;

  beforeEach(async () => {
    conexao ??= abrirBancoDeTeste();
    await limparTabelas(conexao.db, ['perfil_vendedor']);
  });

  afterAll(async () => {
    await conexao.encerrar();
  });

  it('carrega pelo slug, com o contexto do M8 pronto', async () => {
    await conexao.db.insert(perfilVendedor).values({
      slug: 'essencial',
      nome: 'Loja Teste',
      regime: 'mei',
      dasMensal: 7500,
    });

    const perfil = await carregarPerfil(conexao.db, 'essencial');

    expect(perfil.slug).toBe('essencial');
    expect(perfil.nome).toBe('Loja Teste');
    expect(perfil.contextoDoVendedor).toEqual({
      regimeFiscal: 'mei',
      temCnpj: true,
      dasMensal: 7500,
    });
  });

  it('slug que não existe lança dizendo o que fazer', async () => {
    await expect(carregarPerfil(conexao.db, 'nao-existe')).rejects.toThrow(PerfilNaoEncontrado);
    await expect(carregarPerfil(conexao.db, 'nao-existe')).rejects.toThrow(/db:seed/u);
  });

  it('lê o tema quando ele está válido', async () => {
    await conexao.db.insert(perfilVendedor).values({
      slug: 'com-tema',
      nome: 'Com tema',
      regime: 'cpf',
      marcaVisual: {
        corPrimaria: '#123456',
        corAcento: '#654321',
        logoUrl: null,
        nomeExibicao: 'Com tema',
      },
    });

    const perfil = await carregarPerfil(conexao.db, 'com-tema');
    expect(perfil.visual?.corPrimaria).toBe('#123456');
  });

  it('tema em formato estranho não impede o perfil de carregar', async () => {
    await conexao.db.insert(perfilVendedor).values({
      slug: 'tema-torto',
      nome: 'Tema torto',
      regime: 'cpf',
      // Formato de uma versão anterior. Cai no padrão do CSS em vez de derrubar.
      marcaVisual: { cor: 'azul' } as never,
    });

    const perfil = await carregarPerfil(conexao.db, 'tema-torto');
    expect(perfil.visual).toBeNull();
    expect(perfil.nome).toBe('Tema torto');
  });
});

describe('nomeLegivelDoSlug', () => {
  it('transforma o slug em nome apresentável', () => {
    // Apareceu na tela: sem `--nome`, a mensagem a fornecedor saía como "Sou
    // essencial-emporium e vendo em marketplace".
    expect(nomeLegivelDoSlug('essencial-emporium')).toBe('Essencial Emporium');
  });

  it('aceita underscore e espaço como separador', () => {
    expect(nomeLegivelDoSlug('minha_loja')).toBe('Minha Loja');
    expect(nomeLegivelDoSlug('minha loja')).toBe('Minha Loja');
  });

  it('ignora separador repetido e nas pontas', () => {
    expect(nomeLegivelDoSlug('--minha--loja--')).toBe('Minha Loja');
  });

  it('não mexe no resto da palavra, porque não sabe de marca', () => {
    expect(nomeLegivelDoSlug('acme-ltda')).toBe('Acme Ltda');
  });

  it('slug vazio devolve vazio, em vez de inventar nome', () => {
    expect(nomeLegivelDoSlug('')).toBe('');
  });
});
