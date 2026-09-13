/**
 * Ações da tela de compatibilidade.
 *
 * Três: confirmar (ou negar) uma linha, cadastrar um aparelho, e procurar evidência
 * nos anúncios já capturados. Nenhuma faz trabalho de domínio — traduzem formulário
 * em chamada e voltam.
 *
 * `redirect()` do Next sinaliza por exceção (`NEXT_REDIRECT`), então **nenhum
 * `redirect` deste arquivo está dentro de `try`**: o trabalho acontece, o resultado
 * vira código, e o redirecionamento é a última linha, fora de qualquer captura.
 */
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { lerAmbiente } from '@/config/ambiente';
import { ColetorDeCompatibilidade } from '@/dominio/compatibilidade/coletor';
import { RepositorioDeCompatibilidade } from '@/dominio/compatibilidade/repositorio';
import { carregarPerfil } from '@/dominio/perfil';
import { banco } from '@/infra/banco/cliente';
import { sku } from '@/infra/banco/schema';
import { criarRegistrador, nivelDoAmbiente } from '@/infra/log';
import type { CodigoDeAviso } from './apresentacao';
import { CAMINHO } from './constantes';

const log = criarRegistrador({
  nivelMinimo: nivelDoAmbiente(process.env['LOG_NIVEL']),
  contexto: { origem: 'tela_de_compatibilidade' },
});

function paraOnde(codigo: CodigoDeAviso, quantidade?: number): string {
  const n = quantidade === undefined ? '' : `&n=${String(quantidade)}`;
  return `${CAMINHO}?r=${codigo}${n}`;
}

function texto(valor: FormDataEntryValue | null): string {
  return typeof valor === 'string' ? valor.trim() : '';
}

/**
 * Teto de SKUs por clique.
 *
 * Não é limite de segurança: é limite de tempo de requisição. Sem `export` porque
 * módulo `'use server'` só exporta função assíncrona.
 */
const LIMITE_DE_SKUS_POR_CLIQUE = 50;

/**
 * Confirma ou nega uma linha, gravando a decisão como evidência humana.
 *
 * Não grava uma coluna "conferido": grava **evidência do tipo `humano`**, que é o
 * que faz a decisão atravessar a resolução em vez de ser sobrescrita por ela. A
 * próxima varredura recalcula a linha e a decisão humana continua ganhando, porque
 * essa precedência está na regra de resolução e não numa convenção de tela.
 */
export async function decidirLinha(dados: FormData): Promise<void> {
  const db = banco();
  const skuId = texto(dados.get('skuId'));
  const aparelhoId = texto(dados.get('aparelhoId'));
  const escolha = texto(dados.get('escolha'));

  if (skuId === '' || aparelhoId === '' || (escolha !== 'serve' && escolha !== 'nao_serve')) {
    log.aviso('compatibilidade.decisao_invalida', { skuId, aparelhoId, escolha });
    redirect(paraOnde('falha'));
  }

  let destino: CodigoDeAviso = escolha === 'serve' ? 'confirmado' : 'descartado';

  try {
    const perfil = await carregarPerfil(db, lerAmbiente().BANCADA_PERFIL_PADRAO);
    // Confere que o SKU é do perfil antes de gravar: a linha vem de um formulário,
    // e formulário é fronteira externa mesmo quando a tela é de uma pessoa só.
    const doPerfil = await db
      .select({ id: sku.id })
      .from(sku)
      .where(and(eq(sku.id, skuId), eq(sku.perfilId, perfil.id)))
      .limit(1);
    if (doPerfil.length === 0) {
      destino = 'linha_sumiu';
    } else {
      const repo = new RepositorioDeCompatibilidade(db);
      await repo.registrarEvidencia({
        skuId,
        aparelhoId,
        evidencia: {
          tipo: 'humano',
          url: null,
          trecho: 'conferido na tela de compatibilidade',
          em: new Date().toISOString(),
          negativa: escolha === 'nao_serve',
          forcaBp: null,
        },
      });
    }
  } catch (erro) {
    log.erro('compatibilidade.decisao_falhou', { skuId, aparelhoId, escolha, erro });
    redirect(paraOnde('falha'));
  }

  revalidatePath(CAMINHO);
  redirect(paraOnde(destino));
}

/**
 * Cadastra um aparelho.
 *
 * É o único cadastro manual desta tela, e é o que destrava todo o resto: sem
 * aparelho cadastrado não há o que casar com os títulos dos anúncios. Família e
 * linhagem saem da gramática, sem a pessoa precisar saber que existem.
 */
export async function cadastrarAparelho(dados: FormData): Promise<void> {
  const db = banco();
  const tipo = texto(dados.get('tipo'));
  const marca = texto(dados.get('marca'));
  const modelo = texto(dados.get('modelo'));
  const variante = texto(dados.get('variante'));

  if (tipo === '' || marca === '' || modelo === '') {
    redirect(paraOnde('aparelho_incompleto'));
  }

  let destino: CodigoDeAviso = 'aparelho_criado';

  try {
    const repo = new RepositorioDeCompatibilidade(db);
    const jaExistia = await repo.buscarAparelho({
      tipo,
      marca,
      modelo,
      ...(variante === '' ? {} : { variante }),
    });
    if (jaExistia !== null) destino = 'aparelho_repetido';
    await repo.garantirAparelho({
      tipo,
      marca,
      modelo,
      fonte: 'manual',
      ...(variante === '' ? {} : { variante }),
    });
  } catch (erro) {
    log.erro('compatibilidade.aparelho_falhou', { tipo, marca, modelo, erro });
    redirect(paraOnde('falha'));
  }

  revalidatePath(CAMINHO);
  redirect(paraOnde(destino));
}

/**
 * Procura evidência nos anúncios já capturados, para todos os SKUs do perfil.
 *
 * Roda **dentro da requisição**, e por isso é limitada: a varredura é barata (uma
 * consulta por SKU e comparação de texto em memória), mas catálogo grande em rede
 * lenta daria tempo limite de gateway no meio do trabalho. O caminho de volume é a
 * fila, que já faz isso sozinha a cada ocorrência nova.
 */
export async function procurarNosAnuncios(): Promise<void> {
  const db = banco();
  let novas = 0;
  let anunciosLidos = 0;

  try {
    const perfil = await carregarPerfil(db, lerAmbiente().BANCADA_PERFIL_PADRAO);
    const repo = new RepositorioDeCompatibilidade(db);
    const coletor = new ColetorDeCompatibilidade(db, repo);

    const skus = await db
      .select({ id: sku.id })
      .from(sku)
      .where(and(eq(sku.perfilId, perfil.id), eq(sku.ativo, true)))
      .limit(LIMITE_DE_SKUS_POR_CLIQUE);

    for (const s of skus) {
      const resultado = await coletor.coletarDoSku(s.id);
      novas += resultado.evidenciasNovas + resultado.inferencias;
      anunciosLidos += resultado.anuncios;
    }
    log.info('compatibilidade.procura_concluida', {
      skus: skus.length,
      anuncios: anunciosLidos,
      novas,
    });
  } catch (erro) {
    log.erro('compatibilidade.procura_falhou', { erro });
    redirect(paraOnde('falha'));
  }

  revalidatePath(CAMINHO);
  if (novas > 0) redirect(paraOnde('coletado', novas));
  redirect(anunciosLidos === 0 ? paraOnde('sem_anuncio') : paraOnde('sem_coleta'));
}
