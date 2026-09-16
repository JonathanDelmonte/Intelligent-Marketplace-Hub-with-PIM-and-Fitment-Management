/**
 * Testes da escolha de produto da ficha, contra Postgres de verdade.
 *
 * O que só o banco prova: a ordem (mais compatibilidade primeiro, empate pelo
 * título), que id de outro perfil não abre a ficha alheia, e que a lista inclui
 * produto sem nenhuma linha — porque escolher entre os que já têm ficha seria
 * esconder justamente o que está faltando preencher.
 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { perfilId, type PerfilId } from '@/dominio/catalogo/sku';
import { perfilVendedor, sku } from '@/infra/banco/schema';
import {
  abrirBancoDeTeste,
  limparTabelas,
  temBancoDeTeste,
  type ConexaoDeTeste,
} from '@/infra/banco/teste';
import { RepositorioDeCompatibilidade } from './repositorio';

const TABELAS = ['compatibilidade', 'aparelho', 'sku', 'perfil_vendedor'] as const;

describe.skipIf(!temBancoDeTeste())('escolha de produto para a ficha', () => {
  let conexao: ConexaoDeTeste;
  let repo: RepositorioDeCompatibilidade;
  let perfil: PerfilId;
  let outroPerfil: PerfilId;

  beforeEach(async () => {
    conexao ??= abrirBancoDeTeste();
    await limparTabelas(conexao.db, TABELAS);
    repo = new RepositorioDeCompatibilidade(conexao.db);

    const perfis = await conexao.db
      .insert(perfilVendedor)
      .values([
        { slug: 'escolha', nome: 'Perfil', regime: 'mei' as const },
        { slug: 'escolha-outro', nome: 'Outro', regime: 'mei' as const },
      ])
      .returning({ id: perfilVendedor.id });
    perfil = perfilId(perfis[0]?.id ?? '');
    outroPerfil = perfilId(perfis[1]?.id ?? '');
  });

  afterAll(async () => {
    await conexao?.encerrar();
  });

  const criarSku = async (titulo: string, dono: PerfilId = perfil): Promise<string> => {
    const linhas = await conexao.db
      .insert(sku)
      .values({ perfilId: dono, tituloInterno: titulo })
      .returning({ id: sku.id });
    return linhas[0]?.id ?? '';
  };

  /** Uma linha de compatibilidade publicável para o SKU, com aparelho próprio. */
  const compatibilizar = async (skuId: string, modelo: string) => {
    const aparelho = await repo.garantirAparelho({
      tipo: 'purificador de agua',
      marca: 'Electrolux',
      modelo,
      fonte: 'manual',
    });
    await repo.registrarEvidencia({
      skuId,
      aparelhoId: aparelho.id,
      evidencia: {
        tipo: 'manual_fabricante',
        url: null,
        trecho: null,
        em: new Date('2026-09-01T12:00:00Z').toISOString(),
        negativa: false,
        forcaBp: null,
      },
    });
  };

  it('ordena pelo que tem mais compatibilidade, e o primeiro é o que a tela abre', async () => {
    const pobre = await criarSku('Aaa refil sem ficha');
    const rico = await criarSku('Zzz refil com ficha');
    await compatibilizar(rico, 'PA21G');
    await compatibilizar(rico, 'PA26G');

    const escolha = await repo.skuParaFicha(perfil, undefined);
    expect(escolha.lista.map((s) => s.id)).toEqual([rico, pobre]);
    expect(escolha.lista[0]?.linhas).toBe(2);
    expect(escolha.escolhido?.id).toBe(rico);
    expect(escolha.pedidoInvalido).toBe(false);
  });

  it('produto sem nenhuma linha entra na lista, e com zero declarado', async () => {
    // Esconder quem não tem ficha esconderia o que falta preencher.
    const vazio = await criarSku('Refil recém-criado');
    const lista = await repo.skusParaFicha(perfil);
    expect(lista.map((s) => s.id)).toEqual([vazio]);
    expect(lista[0]?.linhas).toBe(0);
  });

  it('empate de quantidade é desfeito pelo título, para a tela não trocar de produto', async () => {
    const b = await criarSku('B refil');
    const a = await criarSku('A refil');
    const lista = await repo.skusParaFicha(perfil);
    expect(lista.map((s) => s.id)).toEqual([a, b]);
  });

  it('id de outro perfil não abre a ficha alheia, e a tela sabe que foi recusado', async () => {
    const meu = await criarSku('Meu refil');
    const dele = await criarSku('Refil do outro', outroPerfil);

    const escolha = await repo.skuParaFicha(perfil, dele);
    expect(escolha.pedidoInvalido).toBe(true);
    expect(escolha.escolhido?.id).toBe(meu);
  });

  it('id que não existe é recusado do mesmo jeito', async () => {
    await criarSku('Meu refil');
    const escolha = await repo.skuParaFicha(perfil, '00000000-0000-0000-0000-000000000000');
    expect(escolha.pedidoInvalido).toBe(true);
  });

  it('produto inativo sai da escolha, porque não se anuncia produto desativado', async () => {
    const ativo = await criarSku('Refil ativo');
    const inativo = await criarSku('Refil desativado');
    await conexao.db.update(sku).set({ ativo: false }).where(eq(sku.id, inativo));

    expect((await repo.skusParaFicha(perfil)).map((s) => s.id)).toEqual([ativo]);
  });

  it('perfil sem produto nenhum devolve lista vazia e nada escolhido', async () => {
    const escolha = await repo.skuParaFicha(perfil, undefined);
    expect(escolha.lista).toEqual([]);
    expect(escolha.escolhido).toBeNull();
  });
});
