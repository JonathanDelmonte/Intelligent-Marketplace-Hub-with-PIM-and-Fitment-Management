/**
 * Os dados do negócio: o que a tela aceita, e o que o banco devolve.
 *
 * A parte do esquema é pura. A do repositório roda contra Postgres de verdade, porque o
 * que ela prova é do banco: que a data do certificado volta no mesmo dia em que foi, que
 * o CNPJ com letras não perde as letras, e que a contagem de vendas respeita perfil e data.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { perfilId, type PerfilId } from '@/dominio/catalogo/sku';
import { TETO_MEI_ANUAL } from '@/dominio/fiscal/teto';
import { pedido, perfilVendedor } from '@/infra/banco/schema';
import {
  abrirBancoDeTeste,
  limparTabelas,
  temBancoDeTeste,
  type ConexaoDeTeste,
} from '@/infra/banco/teste';
import { reaisParaCentavos } from '@/lib/dinheiro';
import { diaDoCampo } from '@/lib/dia';
import { RepositorioDoNegocio, esquemaDoNegocio, type DadosDoNegocio } from './negocio';

const BASE = {
  nome: 'Loja de teste',
  regime: 'mei',
  documento: '12.ABC.345/01DE-35',
  inscricaoEstadual: '',
  uf: 'sp',
  abertoEm: '',
  certificadoValidoAte: '',
  dasMensal: null,
  aliquotaSimplesBp: null,
  tetoAnual: null,
};

function primeiraMensagem(entrada: unknown): string {
  const lido = esquemaDoNegocio.safeParse(entrada);
  return lido.success ? '' : (lido.error.issues[0]?.message ?? '');
}

describe('esquemaDoNegocio', () => {
  it('lê o documento colado com pontuação, e o estado em minúscula', () => {
    const lido = esquemaDoNegocio.parse(BASE);
    expect(lido.documento).toEqual({ tipo: 'cnpj', valor: '12ABC34501DE35' });
    expect(lido.uf).toBe('SP');
    expect(lido.inscricaoEstadual).toBeNull();
  });

  it('MEI com o teto em branco fica com o teto da lei, e não sem teto', () => {
    expect(esquemaDoNegocio.parse(BASE).tetoAnual).toBe(TETO_MEI_ANUAL);
    expect(
      esquemaDoNegocio.parse({ ...BASE, regime: 'simples', documento: '11222333000181' }).tetoAnual,
    ).toBeNull();
  });

  it('recusa o CPF do dono no lugar do CNPJ da empresa', () => {
    expect(primeiraMensagem({ ...BASE, documento: '529.982.247-25' })).toContain(
      'o documento é o CNPJ',
    );
  });

  it('recusa CNPJ em pessoa física, e diz qual regime escolher', () => {
    expect(primeiraMensagem({ ...BASE, regime: 'cpf' })).toContain('MEI ou Simples');
  });

  it('documento em branco é "ainda não tem", e passa', () => {
    expect(esquemaDoNegocio.parse({ ...BASE, documento: '' }).documento).toBeNull();
  });

  it('diz o motivo do documento recusado', () => {
    expect(primeiraMensagem({ ...BASE, documento: '11.222.333/0001-82' })).toContain(
      'dígito verificador',
    );
  });

  it('recusa estado que não existe e data que não existe', () => {
    expect(primeiraMensagem({ ...BASE, uf: 'XX' })).toBe('estado desconhecido');
    expect(primeiraMensagem({ ...BASE, certificadoValidoAte: '2027-02-30' })).toContain(
      'certificado',
    );
  });
});

const TABELAS = ['pedido', 'perfil_vendedor'] as const;

describe.skipIf(!temBancoDeTeste())('RepositorioDoNegocio', () => {
  let conexao: ConexaoDeTeste;
  let repo: RepositorioDoNegocio;
  let perfil: PerfilId;
  let outroPerfil: PerfilId;

  beforeEach(async () => {
    conexao ??= abrirBancoDeTeste();
    await limparTabelas(conexao.db, TABELAS);
    repo = new RepositorioDoNegocio(conexao.db);

    const perfis = await conexao.db
      .insert(perfilVendedor)
      .values([
        { slug: 'negocio', nome: 'Perfil', regime: 'cpf' as const },
        { slug: 'negocio-outro', nome: 'Outro', regime: 'mei' as const },
      ])
      .returning({ id: perfilVendedor.id });
    perfil = perfilId(perfis[0]?.id ?? '');
    outroPerfil = perfilId(perfis[1]?.id ?? '');
  });

  afterAll(async () => {
    await conexao?.encerrar();
  });

  it('grava e lê de volta, com as datas no mesmo dia e o CNPJ com as letras', async () => {
    const dados: DadosDoNegocio = esquemaDoNegocio.parse({
      ...BASE,
      inscricaoEstadual: '123.456.789.110',
      abertoEm: '2026-07-20',
      certificadoValidoAte: '2027-06-30',
      dasMensal: reaisParaCentavos(81.05),
    });

    expect(await repo.gravar(perfil, dados)).toBe(true);
    const lido = await repo.ler(perfil);

    expect(lido?.regime).toBe('mei');
    expect(lido?.documento).toEqual({ tipo: 'cnpj', valor: '12ABC34501DE35' });
    expect(lido?.uf).toBe('SP');
    expect(diaDoCampo(lido?.abertoEm ?? null)).toBe('2026-07-20');
    expect(diaDoCampo(lido?.certificadoValidoAte ?? null)).toBe('2027-06-30');
    expect(lido?.dasMensal).toBe(reaisParaCentavos(81.05));
    expect(lido?.tetoAnual).toBe(TETO_MEI_ANUAL);

    // O outro perfil não foi tocado.
    expect((await repo.ler(outroPerfil))?.nome).toBe('Outro');
  });

  it('perfil que não existe não grava nada, e diz que não gravou', async () => {
    const dados = esquemaDoNegocio.parse(BASE);
    expect(await repo.gravar(perfilId('00000000-0000-4000-8000-000000000000'), dados)).toBe(false);
  });

  it('conta as vendas por plataforma desde a data, só do perfil', async () => {
    const desde = new Date('2026-08-25T00:00:00Z');
    const venda = (dono: PerfilId, plataforma: 'ml' | 'shopee', id: string, dia: string) => ({
      perfilId: dono,
      plataforma,
      idExterno: id,
      data: new Date(`${dia}T12:00:00Z`),
      precoBruto: reaisParaCentavos(50),
      fonte: 'm1_planilha' as const,
    });

    await conexao.db.insert(pedido).values([
      venda(perfil, 'ml', 'A', '2026-09-01'),
      venda(perfil, 'ml', 'B', '2026-09-10'),
      venda(perfil, 'shopee', 'C', '2026-09-11'),
      // Antes da janela: fica de fora.
      venda(perfil, 'ml', 'D', '2026-07-01'),
      // Do outro perfil: fica de fora.
      venda(outroPerfil, 'shopee', 'E', '2026-09-12'),
    ]);

    expect(await repo.vendasPorPlataforma(perfil, desde)).toEqual({
      ml: 2,
      shopee: 1,
      amazon: 0,
    });
  });
});
