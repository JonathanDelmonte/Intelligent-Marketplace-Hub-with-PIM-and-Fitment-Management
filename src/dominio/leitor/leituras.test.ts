/**
 * Testes da sincronização de leituras, contra Postgres de verdade.
 *
 * O caso que importa não é gravar: é **reenviar**. Conexão de loja cai no meio do
 * envio, o dispositivo não sabe se chegou, e reenvia. Se isso duplicar, quarenta
 * leituras de um balcão viram oitenta.
 */
import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { perfilId, type PerfilId } from '@/dominio/catalogo/sku';
import { perfilVendedor } from '@/infra/banco/schema';
import {
  abrirBancoDeTeste,
  limparTabelas,
  temBancoDeTeste,
  type ConexaoDeTeste,
} from '@/infra/banco/teste';
import { DECISOES, MAX_POR_DESCARGA, RepositorioDeLeituras, ROTULO_DA_DECISAO } from './leituras';
import type { LeituraEnviada } from './leituras';

const EAN13 = '7896541200121';
const CAIXA = '17896541200128';
const LIDO_EM = new Date('2026-09-12T10:00:00.000Z');

describe.skipIf(!temBancoDeTeste())('sincronização de leituras', () => {
  let conexao: ConexaoDeTeste;
  let repo: RepositorioDeLeituras;
  let perfilA: PerfilId;
  let perfilB: PerfilId;

  beforeEach(async () => {
    conexao ??= abrirBancoDeTeste();
    repo = new RepositorioDeLeituras(conexao.db);

    await limparTabelas(conexao.db, ['leitura', 'perfil_vendedor']);

    const criados = await conexao.db
      .insert(perfilVendedor)
      .values([
        { slug: 'leitor-a', nome: 'Perfil A', regime: 'mei' },
        { slug: 'leitor-b', nome: 'Perfil B', regime: 'mei' },
      ])
      .returning({ id: perfilVendedor.id });

    perfilA = perfilId(criados[0]!.id);
    perfilB = perfilId(criados[1]!.id);
  });

  afterAll(async () => {
    await conexao.encerrar();
  });

  const leitura = (idLocal: string, extra: Partial<LeituraEnviada> = {}): LeituraEnviada => ({
    idLocal,
    gtin: EAN13,
    custoUnitario: 1200,
    veredito: 'compra',
    precoDeReferencia: 6990,
    margemBp: 5800,
    confiancaBp: 10_000,
    motivos: [{ codigo: 'margem_e_markup_ok', severidade: 'informativo', mensagem: 'ok' }],
    lidoEm: LIDO_EM,
    ...extra,
  });

  it('grava a fila e canonicaliza o GTIN', async () => {
    const r = await repo.sincronizar({
      perfil: perfilA,
      leituras: [leitura('l1'), leitura('l2', { gtin: '036000291452' })],
    });

    expect(r).toEqual({ gravadas: 2, atualizadas: 0, recusadas: [] });

    const ultimas = await repo.ultimas({ perfil: perfilA });
    expect(ultimas).toHaveLength(2);
    expect(ultimas.map((l) => l.gtinCanonico).sort()).toEqual(['0036000291452', EAN13]);
  });

  it('reenviar a mesma fila não duplica — é o caso de sinal ruim', async () => {
    const fila = [leitura('l1'), leitura('l2'), leitura('l3')];

    const primeira = await repo.sincronizar({ perfil: perfilA, leituras: fila });
    const reenvio = await repo.sincronizar({ perfil: perfilA, leituras: fila });

    expect(primeira.gravadas).toBe(3);
    expect(reenvio.gravadas).toBe(0);
    expect(reenvio.atualizadas).toBe(3);
    expect(await repo.ultimas({ perfil: perfilA })).toHaveLength(3);
  });

  it('reenvio com a decisão preenchida atualiza a leitura, não cria outra', async () => {
    await repo.sincronizar({ perfil: perfilA, leituras: [leitura('l1')] });
    await repo.sincronizar({
      perfil: perfilA,
      leituras: [leitura('l1', { decisao: 'comprou', local: 'Saldão da loja X' })],
    });

    const ultimas = await repo.ultimas({ perfil: perfilA });
    expect(ultimas).toHaveLength(1);
    expect(ultimas[0]?.decisao).toBe('comprou');
    expect(ultimas[0]?.local).toBe('Saldão da loja X');
  });

  it('o mesmo idLocal em perfis diferentes são leituras diferentes', async () => {
    await repo.sincronizar({ perfil: perfilA, leituras: [leitura('l1')] });
    await repo.sincronizar({ perfil: perfilB, leituras: [leitura('l1')] });

    expect(await repo.ultimas({ perfil: perfilA })).toHaveLength(1);
    expect(await repo.ultimas({ perfil: perfilB })).toHaveLength(1);
  });

  it('leitura malformada é recusada sem custar as outras', async () => {
    const r = await repo.sincronizar({
      perfil: perfilA,
      leituras: [
        leitura('boa1'),
        { ...leitura('ruim'), veredito: 'talvez' } as unknown as LeituraEnviada,
        { ...leitura('ruim2'), gtin: '123' },
        leitura('boa2'),
      ],
    });

    expect(r.gravadas).toBe(2);
    expect(r.recusadas).toHaveLength(2);
    expect(r.recusadas.map((x) => x.idLocal).sort()).toEqual(['ruim', 'ruim2']);
    expect(r.recusadas[0]?.motivo).not.toBe('');
  });

  it('código de caixa é guardado, mas sem forma canônica de unidade', async () => {
    await repo.sincronizar({ perfil: perfilA, leituras: [leitura('l1', { gtin: CAIXA })] });

    const ultimas = await repo.ultimas({ perfil: perfilA });
    expect(ultimas[0]?.gtin).toBe(CAIXA);
    expect(ultimas[0]?.gtinCanonico).toBeNull();
  });

  it('GTIN inválido não impede o registro: o que aconteceu no balcão aconteceu', async () => {
    await repo.sincronizar({
      perfil: perfilA,
      leituras: [leitura('l1', { gtin: '7896541200123', veredito: 'sem_dado' })],
    });

    const ultimas = await repo.ultimas({ perfil: perfilA });
    expect(ultimas[0]?.gtin).toBe('7896541200123');
    expect(ultimas[0]?.gtinCanonico).toBeNull();
    expect(ultimas[0]?.veredito).toBe('sem_dado');
  });

  it('respeita o teto por descarga', async () => {
    const fila = Array.from({ length: MAX_POR_DESCARGA + 10 }, (_, i) => leitura(`l${String(i)}`));
    const r = await repo.sincronizar({ perfil: perfilA, leituras: fila });

    expect(r.gravadas).toBe(MAX_POR_DESCARGA);
  });

  it('acha o que já foi avaliado do mesmo código', async () => {
    await repo.sincronizar({
      perfil: perfilA,
      leituras: [
        leitura('l1', { custoUnitario: 1200 }),
        leitura('l2', { custoUnitario: 1500 }),
        leitura('l3', { gtin: '036000291452' }),
      ],
    });

    const doEan = await repo.doGtin({ perfil: perfilA, gtinCanonico: EAN13 });
    expect(doEan).toHaveLength(2);
    expect(doEan.map((l) => l.custoUnitario).sort()).toEqual([1200, 1500]);
  });

  it('conta por decisão, inclusive o que ainda não foi decidido', async () => {
    await repo.sincronizar({
      perfil: perfilA,
      leituras: [
        leitura('l1', { decisao: 'comprou' }),
        leitura('l2', { decisao: 'comprou' }),
        leitura('l3', { decisao: 'nao_comprou' }),
        leitura('l4'),
      ],
    });

    expect(await repo.contagemPorDecisao({ perfil: perfilA })).toEqual({
      comprou: 2,
      nao_comprou: 1,
      indeciso: 0,
      sem_decisao: 1,
    });
  });

  it('motivo gravado em formato estranho não impede o histórico de abrir', async () => {
    await repo.sincronizar({ perfil: perfilA, leituras: [leitura('l1')] });
    // Simula leitura gravada por versão anterior do aplicativo.
    await conexao.db.execute(sql`update leitura set motivos = '{"forma":"antiga"}'::jsonb`);

    const ultimas = await repo.ultimas({ perfil: perfilA });
    expect(ultimas).toHaveLength(1);
    expect(ultimas[0]?.motivos).toEqual([]);
  });

  it('toda decisão tem rótulo', () => {
    for (const d of DECISOES) expect(ROTULO_DA_DECISAO[d]).not.toBe('');
  });
});
