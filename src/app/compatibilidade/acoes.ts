/**
 * Ações da tela de compatibilidade.
 *
 * Quatro: confirmar (ou negar) uma linha, cadastrar um aparelho, procurar evidência
 * nos anúncios já capturados, e ler uma fonte de fora — manual, página oficial,
 * catálogo, fórum. Nenhuma faz trabalho de domínio — traduzem formulário em chamada e
 * voltam.
 *
 * `redirect()` do Next sinaliza por exceção (`NEXT_REDIRECT`), então **nenhum
 * `redirect` deste arquivo está dentro de `try`**: o trabalho acontece, o resultado
 * vira código, e o redirecionamento é a última linha, fora de qualquer captura.
 */
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { lerAmbiente } from '@/config/ambiente';
import { MAX_UPLOAD_BYTES } from '@/config/limites';
import { ColetorDeCompatibilidade } from '@/dominio/compatibilidade/coletor';
import { TIPOS_DE_FONTE } from '@/dominio/compatibilidade/fonte';
import { RepositorioDeCompatibilidade } from '@/dominio/compatibilidade/repositorio';
import { carregarPerfil } from '@/dominio/perfil';
import { lerTextoDoEndereco } from '@/dominio/web/leitura';
import { linhasVisiveis } from '@/dominio/web/pagina';
import { banco } from '@/infra/banco/cliente';
import { sku } from '@/infra/banco/schema';
import { criarRegistrador, nivelDoAmbiente } from '@/infra/log';
import { PdfIlegivel, textoDoPdf } from '@/infra/pdf/texto';
import { FalhaDeRede } from '@/infra/web/rede';
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

      // Confirmação humana é evidência forte nova, então a propagação por família
      // acontece **agora**: quem confirmou o PA21G acabou de autorizar a hipótese
      // sobre o PA21X, e mandar a pessoa clicar em "Procurar" de novo para ver isso
      // seria esconder o efeito da própria decisão dela.
      //
      // Captura própria, como na propagação de SKU da fase 5: este é o passo
      // opcional, e um erro nele não pode fazer a tela dizer que a decisão não foi
      // gravada quando ela foi.
      try {
        await new ColetorDeCompatibilidade(db, repo).propagarPorFamilia(skuId);
      } catch (erroDaPropagacao) {
        log.erro('compatibilidade.propagacao_falhou', { skuId, erro: erroDaPropagacao });
      }
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

/** A volta da leitura de fonte: para a ficha do mesmo produto, onde o formulário está. */
function paraAFicha(skuId: string, codigo: CodigoDeAviso, n?: number, m?: number): string {
  const numeros = `${n === undefined ? '' : `&n=${String(n)}`}${m === undefined ? '' : `&m=${String(m)}`}`;
  return `${CAMINHO}?sku=${encodeURIComponent(skuId)}&r=${codigo}${numeros}#ficha-titulo`;
}

const esquemaDoTipoDeFonte = z.enum(TIPOS_DE_FONTE);

type TextoDaFonte =
  | {
      readonly tipo: 'ok';
      readonly texto: string;
      readonly url: string | null;
      readonly origem: string | null;
    }
  | { readonly tipo: 'erro'; readonly codigo: CodigoDeAviso };

/** Os quatro primeiros bytes de todo PDF: `%PDF`. */
function ehPdf(arquivo: File, bytes: Uint8Array): boolean {
  return (
    arquivo.type === 'application/pdf' ||
    /\.pdf$/i.test(arquivo.name) ||
    (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)
  );
}

/**
 * O texto da fonte, do jeito que ela chegou. O arquivo vem antes do link e o link antes
 * do texto, como na importação: quem escolheu um arquivo e deixou algo na caixa quis o
 * arquivo.
 */
async function textoDaFonte(dados: FormData): Promise<TextoDaFonte> {
  const arquivo = dados.get('arquivo');
  if (arquivo instanceof File && arquivo.size > 0) {
    if (arquivo.size > MAX_UPLOAD_BYTES) return { tipo: 'erro', codigo: 'fonte_grande' };
    const bytes = new Uint8Array(await arquivo.arrayBuffer());
    if (ehPdf(arquivo, bytes)) {
      try {
        return { tipo: 'ok', texto: await textoDoPdf(bytes), url: null, origem: arquivo.name };
      } catch (erro) {
        if (!(erro instanceof PdfIlegivel)) throw erro;
        return { tipo: 'erro', codigo: 'fonte_recusada' };
      }
    }
    const conteudo = new TextDecoder('utf-8').decode(bytes);
    const texto = /\.html?$/i.test(arquivo.name) ? linhasVisiveis(conteudo) : conteudo;
    return { tipo: 'ok', texto, url: null, origem: arquivo.name };
  }

  const url = texto(dados.get('url'));
  if (url !== '') {
    try {
      const lido = await lerTextoDoEndereco(url);
      return lido.tipo === 'ok'
        ? { tipo: 'ok', texto: lido.texto, url: lido.url, origem: null }
        : { tipo: 'erro', codigo: 'fonte_recusada' };
    } catch (erro) {
      if (!(erro instanceof FalhaDeRede)) throw erro;
      // Endereço recusado — da rede local, ou que nem é endereço — não melhora tentando
      // de novo; rede fora, sim.
      return {
        tipo: 'erro',
        codigo: erro.message.startsWith('endereço recusado') ? 'fonte_recusada' : 'fonte_sem_rede',
      };
    }
  }

  const colado = texto(dados.get('texto'));
  return colado === ''
    ? { tipo: 'erro', codigo: 'fonte_vazia' }
    : { tipo: 'ok', texto: colado, url: null, origem: null };
}

/**
 * Lê uma fonte de fora — o manual em PDF, a página do fabricante, a tabela do
 * distribuidor, o post do grupo — e registra em que aparelhos ela diz que este produto
 * serve. As regras de força estão em `dominio/compatibilidade/fonte.ts`: manual e página
 * que citam o código do produto publicam; o resto vai para a fila, com o trecho.
 */
export async function trazerDaFonte(dados: FormData): Promise<void> {
  const db = banco();
  const skuId = texto(dados.get('skuId'));
  const tipo = esquemaDoTipoDeFonte.safeParse(texto(dados.get('tipo')));
  if (skuId === '' || !tipo.success) redirect(paraOnde('falha'));

  let destino: string;
  try {
    const perfil = await carregarPerfil(db, lerAmbiente().BANCADA_PERFIL_PADRAO);
    const produto = await db
      .select({ id: sku.id, titulo: sku.tituloInterno })
      .from(sku)
      .where(and(eq(sku.id, skuId), eq(sku.perfilId, perfil.id)))
      .limit(1);
    const escolhido = produto[0];

    if (escolhido === undefined) {
      destino = paraOnde('produto_de_outro_perfil');
    } else {
      const fonte = await textoDaFonte(dados);
      if (fonte.tipo === 'erro') {
        destino = paraAFicha(skuId, fonte.codigo);
      } else {
        const repo = new RepositorioDeCompatibilidade(db);
        const r = await new ColetorDeCompatibilidade(db, repo).coletarDaFonte({
          skuId,
          tituloDoProduto: escolhido.titulo,
          tipo: tipo.data,
          texto: fonte.texto,
          url: fonte.url,
          origem: fonte.origem,
          agora: new Date(),
        });
        log.info('compatibilidade.fonte_lida', { skuId, tipo: tipo.data, ...r });
        destino =
          r.paraConferir > 0
            ? paraAFicha(skuId, 'fonte_para_conferir', r.paraConferir, r.comForca)
            : r.comForca > 0
              ? paraAFicha(skuId, 'fonte_lida', r.comForca)
              : !r.produtoTemCodigo && r.longeDoProduto > 0
                ? paraAFicha(skuId, 'fonte_sem_codigo_do_produto')
                : r.longeDoProduto > 0
                  ? paraAFicha(skuId, 'fonte_longe_do_produto', r.longeDoProduto)
                  : r.ambiguos.length > 0
                    ? paraAFicha(skuId, 'fonte_ambigua', r.ambiguos.length)
                    : paraAFicha(skuId, 'fonte_sem_aparelho');
      }
    }
  } catch (erro) {
    log.erro('compatibilidade.fonte_falhou', { skuId, erro });
    redirect(paraOnde('falha'));
  }

  revalidatePath(CAMINHO);
  redirect(destino);
}
