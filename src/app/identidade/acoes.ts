/**
 * Ações da tela de identidade.
 *
 * Duas: decidir um par e rodar a resolução na hora. Nenhuma faz trabalho de
 * domínio — traduzem formulário em chamada e voltam.
 *
 * `redirect()` do Next sinaliza por exceção (`NEXT_REDIRECT`), então **nenhum
 * `redirect` deste arquivo está dentro de `try`**: o trabalho acontece, o resultado
 * vira código, e o redirecionamento é a última linha, fora de qualquer captura.
 */
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { lerAmbiente } from '@/config/ambiente';
import { RepositorioDeSku } from '@/dominio/catalogo/sku';
import { lerRegistro, type RegistroDeProduto } from '@/dominio/identidade/registro';
import { produtoExterno } from '@/infra/banco/schema';
import { RepositorioDeExemplos } from '@/dominio/identidade/exemplos';
import { RepositorioDePares } from '@/dominio/identidade/pares';
import { propagarSku, propostaDeSku } from '@/dominio/identidade/propagacao';
import { ResolvedorDeIdentidade } from '@/dominio/identidade/resolucao';
import { carregarPerfil } from '@/dominio/perfil';
import { banco } from '@/infra/banco/cliente';
import { criarRegistrador, nivelDoAmbiente } from '@/infra/log';
import type { CodigoDeAviso } from './apresentacao';
import { CAMINHO, LIMITE_DE_RESOLUCAO_MANUAL } from './constantes';

const log = criarRegistrador({
  nivelMinimo: nivelDoAmbiente(process.env['LOG_NIVEL']),
  contexto: { origem: 'tela_de_identidade' },
});

function paraOnde(codigo: CodigoDeAviso, quantidade?: number): string {
  const parametros = new URLSearchParams({ r: codigo });
  if (quantidade !== undefined) parametros.set('n', String(quantidade));
  return `${CAMINHO}?${parametros.toString()}`;
}

/**
 * Registra a decisão humana sobre um par.
 *
 * Faz três coisas, e a ordem importa:
 *
 * 1. Grava a decisão como `humano`, que é a origem mais forte e não será
 *    sobrescrita por nenhuma varredura futura.
 * 2. Guarda o par de formas canônicas como **exemplo**, que é o que faz o sistema
 *    ficar melhor a cada decisão.
 * 3. Se disse "é o mesmo" e um dos lados já pertence a um SKU, propaga — e é aqui
 *    que dois cliques viram comparação de preço entre fornecedores.
 */
export async function decidirPar(dados: FormData): Promise<void> {
  const db = banco();
  const pares = new RepositorioDePares(db);

  const parId = texto(dados.get('parId'));
  const escolha = texto(dados.get('escolha'));

  if (parId === '' || !ehEscolha(escolha)) {
    log.aviso('identidade.decisao_incompleta', { parId, escolha });
    redirect(paraOnde('falha'));
  }

  let destino: CodigoDeAviso = 'decidido';
  let ligadas = 0;

  try {
    const par = await pares.porId(parId);
    if (par === null) {
      redirect(paraOnde('par_sumiu'));
    }

    const decisao =
      escolha === 'mesmo' ? 'mesmo' : escolha === 'diferente' ? 'diferente' : 'indeciso';

    await pares.registrar({
      produtoA: par.a.id,
      produtoB: par.b.id,
      decisao,
      origem: 'humano',
      nivel: par.nivel === '' ? 'nenhum' : (par.nivel as 'gtin'),
      // Decisão humana não tem gradação: quem olhou, olhou.
      confiancaBp: 10_000,
      status: 'resolvido',
      justificativa: 'decidido na tela de revisão',
      inconsistencias: par.inconsistencias,
    });

    const exemplos = new RepositorioDeExemplos(db);
    const canonicoA = par.a.formaCanonica ?? '';
    const canonicoB = par.b.formaCanonica ?? '';
    const temOsDois = canonicoA.trim() !== '' && canonicoB.trim() !== '' && canonicoA !== canonicoB;

    if (temOsDois) {
      await exemplos.registrar({
        canonicoA,
        canonicoB,
        decisao: escolha === 'mesmo' ? 'sim' : escolha === 'diferente' ? 'nao' : 'incerto',
        justificativa: 'decisão humana na fila de revisão',
      });
    } else {
      destino = 'resolvido_sem_exemplo';
    }

    if (decisao === 'mesmo') {
      const skuId = par.a.skuId ?? par.b.skuId;
      if (skuId !== null && skuId !== undefined) {
        // Captura própria, e a razão apareceu usando a tela: a propagação é a
        // **última** etapa e a menos essencial. Quando ela falhava — no caso real,
        // perfil padrão apontando para um slug que não existe —, o `catch` de fora
        // dizia "a decisão não foi gravada", com a decisão gravada e o exemplo
        // gravado. Mentira na direção pior: quem lê clica de novo.
        try {
          const perfil = await carregarPerfil(db, lerAmbiente().BANCADA_PERFIL_PADRAO);
          const propagacao = await propagarSku(db, { perfil: perfil.id, skuId });
          ligadas = propagacao.ligadas.length;
          if (ligadas > 0 && destino === 'decidido') destino = 'decidido_com_ligacao';
          if (propagacao.conflitos.length > 0) {
            log.aviso('identidade.conflito_de_sku', { skuId, conflitos: propagacao.conflitos });
          }
        } catch (erroDaPropagacao) {
          log.erro('identidade.propagacao_falhou', { skuId, erro: erroDaPropagacao });
          destino = 'decidido_sem_propagar';
        }
      }
    }
  } catch (erro) {
    log.erro('identidade.decisao_falhou', { parId, escolha, erro });
    redirect(paraOnde('falha'));
  }

  revalidatePath(CAMINHO);
  redirect(paraOnde(destino, destino === 'decidido_com_ligacao' ? ligadas : undefined));
}

/**
 * Cria um SKU a partir de um par, e liga as duas ocorrências nele.
 *
 * Existe porque sem ela a fila de revisão dava em nada no caso mais comum: duas
 * ocorrências afirmadas como o mesmo produto, **nenhuma** delas em um SKU ainda.
 * A decisão ficava gravada e o valor — comparar preço entre fornecedores — não
 * aparecia, porque não havia SKU para receber as duas.
 *
 * O título vem de um campo preenchido com a proposta, e não de geração automática:
 * "um `sku` é criado por decisão sua" quer dizer que a pessoa confirma o nome.
 */
export async function criarSkuDoPar(dados: FormData): Promise<void> {
  const db = banco();
  const pares = new RepositorioDePares(db);

  const parId = texto(dados.get('parId'));
  const titulo = texto(dados.get('titulo'));

  if (parId === '' || titulo.length < 3) {
    log.aviso('identidade.sku_sem_titulo', { parId, tamanho: titulo.length });
    redirect(paraOnde('titulo_curto'));
  }

  let ligadas = 0;

  try {
    const par = await pares.porId(parId);
    if (par === null) {
      redirect(paraOnde('par_sumiu'));
    }

    const perfil = await carregarPerfil(db, lerAmbiente().BANCADA_PERFIL_PADRAO);
    const [ladoA, ladoB] = await Promise.all([
      registroDaOcorrencia(db, par.a.id),
      registroDaOcorrencia(db, par.b.id),
    ]);
    const proposta = propostaDeSku(ladoA, ladoB);

    const repo = new RepositorioDeSku(db);
    const criado = await repo.criar({
      perfil: perfil.id,
      dados: {
        // O título é o que a pessoa confirmou; o resto vem da proposta.
        tituloInterno: titulo,
        marca: proposta.marca,
        ean: proposta.ean,
      },
      produtosExternosIds: [par.a.id, par.b.id],
    });
    ligadas = 2;

    // A decisão humana fica gravada junto: criar um SKU com as duas **é** dizer que
    // são o mesmo produto, e essa afirmação tem de virar exemplo como qualquer outra.
    await pares.registrar({
      produtoA: par.a.id,
      produtoB: par.b.id,
      decisao: 'mesmo',
      origem: 'humano',
      nivel: par.nivel === '' ? 'nenhum' : (par.nivel as 'gtin'),
      confiancaBp: 10_000,
      status: 'resolvido',
      justificativa: `SKU criado na tela de revisão: ${criado.tituloInterno}`,
      inconsistencias: par.inconsistencias,
    });

    const canonicoA = par.a.formaCanonica ?? '';
    const canonicoB = par.b.formaCanonica ?? '';
    if (canonicoA.trim() !== '' && canonicoB.trim() !== '' && canonicoA !== canonicoB) {
      await new RepositorioDeExemplos(db).registrar({
        canonicoA,
        canonicoB,
        decisao: 'sim',
        justificativa: 'SKU criado com as duas ocorrências na fila de revisão',
      });
    }
  } catch (erro) {
    log.erro('identidade.sku_falhou', { parId, erro });
    redirect(paraOnde('falha'));
  }

  revalidatePath(CAMINHO);
  redirect(paraOnde('sku_criado', ligadas));
}

/** Lê o registro extraído de uma ocorrência, para a proposta de SKU. */
async function registroDaOcorrencia(
  db: ReturnType<typeof banco>,
  id: string,
): Promise<{
  readonly tituloBruto: string;
  readonly ean: string | null;
  readonly registro: RegistroDeProduto;
}> {
  const linhas = await db
    .select({
      tituloBruto: produtoExterno.tituloBruto,
      ean: produtoExterno.ean,
      atributos: produtoExterno.atributosExtraidos,
    })
    .from(produtoExterno)
    .where(eq(produtoExterno.id, id))
    .limit(1);

  const linha = linhas[0];
  if (linha === undefined) throw new Error(`ocorrência ${id} não existe`);

  const leitura = lerRegistro(linha.atributos);
  return {
    tituloBruto: linha.tituloBruto,
    ean: linha.ean,
    registro: leitura.tipo === 'ok' ? leitura.registro : lerRegistroVazio(),
  };
}

function lerRegistroVazio(): RegistroDeProduto {
  const leitura = lerRegistro({});
  if (leitura.tipo !== 'ok') throw new Error('registro vazio não valida');
  return leitura.registro;
}

/**
 * Roda a resolução em algumas ocorrências, na hora.
 *
 * Existe pelo mesmo motivo do botão da tela de jobs: a tela precisa funcionar sem
 * processo de fundo. Sem chave de LLM ela ainda faz trabalho de verdade — GTIN igual
 * e marca com código de peça igual são decididos aqui, de graça.
 */
export async function resolverAgora(): Promise<void> {
  const db = banco();
  const resolvedor = new ResolvedorDeIdentidade(db);

  let avaliadas = 0;
  let precisaramDeLlm = 0;

  try {
    await resolvedor.prepararLote(LIMITE_DE_RESOLUCAO_MANUAL * 5);
    const lote = await resolvedor.resolverLote(LIMITE_DE_RESOLUCAO_MANUAL);
    avaliadas = lote.resolvidos.length;
    precisaramDeLlm = lote.resolvidos.reduce((soma, r) => soma + r.pendenteDeLlm, 0);
  } catch (erro) {
    log.erro('identidade.resolucao_falhou', { erro });
    redirect(paraOnde('falha'));
  }

  revalidatePath(CAMINHO);
  if (avaliadas === 0) {
    redirect(paraOnde('resolucao_vazia'));
  }
  redirect(
    precisaramDeLlm > 0 ? paraOnde('sem_chave_de_llm') : paraOnde('resolucao_feita', avaliadas),
  );
}

function texto(campo: FormDataEntryValue | null): string {
  return typeof campo === 'string' ? campo.trim() : '';
}

function ehEscolha(valor: string): valor is 'mesmo' | 'diferente' | 'incerto' {
  return valor === 'mesmo' || valor === 'diferente' || valor === 'incerto';
}
