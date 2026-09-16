/**
 * Ações da tela de catálogo.
 *
 * Três, e a divisão entre elas não é arbitrária: criar produto, informar **custo** e
 * salvar o **resto da ficha**. Custo é separado porque tem data própria — é ela que
 * responde se o número ainda vale —, e um salvamento de peso não pode reescrever a data
 * do custo.
 *
 * Não há ação de apagar produto: pedido antigo ainda precisa resolver para o SKU, e o
 * repositório desativa em vez de apagar. Desativar pela tela entra quando houver
 * produto para desativar; hoje seria botão à procura de uso.
 *
 * `redirect()` do Next sinaliza por exceção, então nenhum `redirect` daqui está dentro
 * de `try`.
 */
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { lerAmbiente } from '@/config/ambiente';
import { RepositorioDeSku, esquemaNovoSku } from '@/dominio/catalogo/sku';
import { carregarPerfil } from '@/dominio/perfil';
import { banco } from '@/infra/banco/cliente';
import { criarRegistrador, nivelDoAmbiente } from '@/infra/log';
import { lerReaisDigitados } from '@/lib/dinheiro';
import type { CodigoDeAviso } from './apresentacao';
import { CAMINHO } from './constantes';

const log = criarRegistrador({
  nivelMinimo: nivelDoAmbiente(process.env['LOG_NIVEL']),
  contexto: { origem: 'tela_catalogo' },
});

function paraLista(codigo: CodigoDeAviso): string {
  return `${CAMINHO}?${new URLSearchParams({ r: codigo }).toString()}`;
}

function paraProduto(id: string, codigo: CodigoDeAviso): string {
  return `${CAMINHO}/${id}?${new URLSearchParams({ r: codigo }).toString()}`;
}

async function repositorio(): Promise<{
  readonly repo: RepositorioDeSku;
  readonly perfil: Awaited<ReturnType<typeof carregarPerfil>>;
}> {
  const db = banco();
  const perfil = await carregarPerfil(db, lerAmbiente().BANCADA_PERFIL_PADRAO);
  return { repo: new RepositorioDeSku(db), perfil };
}

/**
 * Cria um produto.
 *
 * Campo vazio vira `null` e não string vazia: "não informei a marca" é diferente de
 * "a marca é vazia", e o esquema do domínio já trata `null` como ausente.
 */
const esquemaDoFormulario = z.object({
  tituloInterno: z.string().trim().min(3).max(200),
  ean: z.string().trim().max(20),
  marca: z.string().trim().max(80),
});

export async function criarProduto(dados: FormData): Promise<void> {
  const lido = esquemaDoFormulario.safeParse({
    tituloInterno: dados.get('titulo') ?? '',
    ean: dados.get('ean') ?? '',
    marca: dados.get('marca') ?? '',
  });

  if (!lido.success) {
    log.aviso('catalogo.formulario_invalido', { erro: lido.error.message });
    redirect(paraLista('produto_invalido'));
  }

  // O EAN passa pelo dígito verificador do domínio, e é lá que a mensagem certa mora.
  const novo = esquemaNovoSku.safeParse({
    tituloInterno: lido.data.tituloInterno,
    ean: lido.data.ean === '' ? null : lido.data.ean,
    marca: lido.data.marca === '' ? null : lido.data.marca,
  });

  if (!novo.success) {
    log.aviso('catalogo.sku_invalido', { erro: novo.error.message });
    redirect(paraLista('produto_invalido'));
  }

  let id: string;
  try {
    const { repo, perfil } = await repositorio();
    const criado = await repo.criar({ perfil: perfil.id, dados: novo.data });
    id = criado.id;
  } catch (erro) {
    log.erro('catalogo.criacao_falhou', { erro });
    redirect(paraLista('falha'));
  }

  revalidatePath(CAMINHO);
  // Leva para o produto: o passo seguinte é informar o custo, e ele é lá.
  redirect(paraProduto(id, 'criado'));
}

const esquemaDoId = z.string().trim().uuid();

export async function salvarCusto(dados: FormData): Promise<void> {
  const id = esquemaDoId.safeParse(dados.get('id') ?? '');
  if (!id.success) {
    log.aviso('catalogo.id_invalido', {});
    redirect(paraLista('falha'));
  }

  // `FormData.get` devolve `File` ou string, e `String(File)` viraria
  // "[object Object]" — que o leitor de reais recusaria por acidente, com a mensagem
  // certa pelo motivo errado.
  const bruto = dados.get('custo');
  const custo = lerReaisDigitados(typeof bruto === 'string' ? bruto : '');
  if (custo === null) redirect(paraProduto(id.data, 'custo_invalido'));

  let salvou = false;
  try {
    const { repo, perfil } = await repositorio();
    salvou = await repo.atualizarCusto({ perfil: perfil.id, skuId: id.data, custo });
  } catch (erro) {
    log.erro('catalogo.custo_falhou', { erro });
    redirect(paraProduto(id.data, 'falha'));
  }

  revalidatePath(`${CAMINHO}/${id.data}`);
  redirect(paraProduto(id.data, salvou ? 'custo' : 'nada'));
}

/**
 * Campo em branco apaga, campo ausente não muda.
 *
 * O formulário manda todos os campos sempre, então em branco só pode significar uma
 * coisa: apagar o que tinha. Quem quer manter deixa o valor lá — e é o que o
 * `defaultValue` da tela garante.
 */
const numeroOuNulo = z
  .string()
  .trim()
  .transform((v) => (v === '' ? null : Number.parseFloat(v.replace(',', '.'))))
  .refine((v) => v === null || Number.isFinite(v), 'número inválido');

const esquemaDaFicha = z.object({
  id: esquemaDoId,
  pesoG: numeroOuNulo,
  comprimento: numeroOuNulo,
  largura: numeroOuNulo,
  altura: numeroOuNulo,
  devolucaoPct: numeroOuNulo,
  marca: z.string().trim().max(80),
});

export async function salvarFicha(dados: FormData): Promise<void> {
  const lido = esquemaDaFicha.safeParse({
    id: dados.get('id') ?? '',
    pesoG: dados.get('pesoG') ?? '',
    comprimento: dados.get('comprimento') ?? '',
    largura: dados.get('largura') ?? '',
    altura: dados.get('altura') ?? '',
    devolucaoPct: dados.get('devolucao') ?? '',
    marca: dados.get('marca') ?? '',
  });

  if (!lido.success) {
    log.aviso('catalogo.ficha_invalida', { erro: lido.error.message });
    redirect(paraLista('ficha_invalida'));
  }

  const { comprimento, largura, altura } = lido.data;
  const lados = [comprimento, largura, altura];

  // Dimensão é uma coisa só: dois lados preenchidos e um em branco não é medida, é
  // medida pela metade — e gravar isso viraria frete calculado sobre nada.
  const algumLado = lados.some((l) => l !== null);
  const todosOsLados = lados.every((l) => l !== null);
  if (algumLado && !todosOsLados) redirect(paraProduto(lido.data.id, 'ficha_invalida'));

  let salvou = false;
  try {
    const { repo, perfil } = await repositorio();
    salvou = await repo.atualizarFicha({
      perfil: perfil.id,
      skuId: lido.data.id,
      pesoG: lido.data.pesoG === null ? null : Math.round(lido.data.pesoG),
      dimMm:
        comprimento === null || largura === null || altura === null
          ? null
          : { comprimento, largura, altura },
      taxaDevolucaoEsperadaBp:
        lido.data.devolucaoPct === null ? null : Math.round(lido.data.devolucaoPct * 100),
      marca: lido.data.marca === '' ? null : lido.data.marca,
    });
  } catch (erro) {
    log.aviso('catalogo.ficha_recusada', { erro });
    redirect(paraProduto(lido.data.id, 'ficha_invalida'));
  }

  revalidatePath(`${CAMINHO}/${lido.data.id}`);
  redirect(paraProduto(lido.data.id, salvou ? 'ficha' : 'nada'));
}
