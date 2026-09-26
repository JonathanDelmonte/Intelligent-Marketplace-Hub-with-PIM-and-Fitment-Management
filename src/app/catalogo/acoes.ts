/**
 * Ações da tela de catálogo.
 *
 * Criar produto, informar **custo**, salvar o **resto da ficha**, e desativar ou
 * reativar. Custo é separado da ficha porque tem data própria — é ela que responde se o
 * número ainda vale —, e um salvamento de peso não pode reescrever a data do custo.
 *
 * Não há ação de apagar produto: pedido antigo ainda precisa resolver para o SKU, e o
 * repositório desativa em vez de apagar. Desativar é um clique e tem volta com o mesmo
 * custo, por isso não pede confirmação.
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
import { ehPlataforma } from '@/dominio/precificacao/tipos';
import { banco } from '@/infra/banco/cliente';
import { criarRegistrador, nivelDoAmbiente } from '@/infra/log';
import { lerReaisDigitados } from '@/lib/dinheiro';
import {
  alvoEmPercentual,
  caminhoDoProdutoCriado,
  lerAlvo,
  type CodigoDeAviso,
} from './apresentacao';
import { CAMINHO, CAMINHO_DO_NOVO, MARGEM_ALVO_PADRAO_BP } from './constantes';

const log = criarRegistrador({
  nivelMinimo: nivelDoAmbiente(process.env['LOG_NIVEL']),
  contexto: { origem: 'tela_catalogo' },
});

function paraLista(codigo: CodigoDeAviso): string {
  return `${CAMINHO}?${new URLSearchParams({ r: codigo }).toString()}`;
}

/**
 * A loja e o alvo que a tela mandava, para ela voltar do jeito que estava.
 *
 * Os dois vêm do formulário como texto, e só voltam se forem de verdade uma loja e um
 * alvo: é endereço de redirecionamento montado com o que chegou de fora.
 */
function contextoDaTela(dados: FormData | undefined): URLSearchParams {
  const busca = new URLSearchParams();
  const loja = dados?.get('plataforma');
  if (typeof loja === 'string' && ehPlataforma(loja)) busca.set('plataforma', loja);
  const alvoBruto = dados?.get('alvo');
  const alvo = typeof alvoBruto === 'string' ? lerAlvo(alvoBruto) : null;
  if (alvo !== null && alvo !== MARGEM_ALVO_PADRAO_BP) busca.set('alvo', alvoEmPercentual(alvo));
  return busca;
}

function paraProduto(id: string, codigo: CodigoDeAviso, dados?: FormData): string {
  const busca = contextoDaTela(dados);
  busca.set('r', codigo);
  return `${CAMINHO}/${id}?${busca.toString()}`;
}

/** A linha do produto na tabela de preços, com o alvo que estava escolhido. */
function paraLinha(id: string, codigo: CodigoDeAviso, dados: FormData): string {
  const busca = contextoDaTela(dados);
  busca.delete('plataforma');
  busca.set('r', codigo);
  return `${CAMINHO}?${busca.toString()}#p-${id}`;
}

/** O cadastro de novo, com o nome e a loja que vinham, para ninguém redigitar. */
function paraCadastro(codigo: CodigoDeAviso, dados: FormData): string {
  const busca = new URLSearchParams({ r: codigo });
  const titulo = dados.get('titulo');
  if (typeof titulo === 'string' && titulo.trim().length >= 3) busca.set('novo', titulo.trim());
  const loja = dados.get('plataforma');
  if (typeof loja === 'string' && ehPlataforma(loja)) busca.set('plataforma', loja);
  return `${CAMINHO_DO_NOVO}?${busca.toString()}`;
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
    redirect(paraCadastro('produto_invalido', dados));
  }

  // O EAN passa pelo dígito verificador do domínio, e é lá que a mensagem certa mora.
  const novo = esquemaNovoSku.safeParse({
    tituloInterno: lido.data.tituloInterno,
    ean: lido.data.ean === '' ? null : lido.data.ean,
    marca: lido.data.marca === '' ? null : lido.data.marca,
  });

  if (!novo.success) {
    log.aviso('catalogo.sku_invalido', { erro: novo.error.message });
    redirect(paraCadastro('produto_invalido', dados));
  }

  let id: string;
  try {
    const { repo, perfil } = await repositorio();
    const criado = await repo.criar({ perfil: perfil.id, dados: novo.data });
    id = criado.id;
  } catch (erro) {
    log.erro('catalogo.criacao_falhou', { erro });
    redirect(paraCadastro('falha', dados));
  }

  revalidatePath(CAMINHO);
  // Leva para o produto: o passo seguinte é informar o custo, e ele é lá. Quando o
  // cadastro veio do "Publicar em" do garimpo, a loja escolhida vai junto, e a conta
  // abre nela (ADR 0009).
  const loja = dados.get('plataforma');
  redirect(caminhoDoProdutoCriado(id, ehPlataforma(loja) ? loja : undefined, 'criado'));
}

const esquemaDoId = z.string().trim().uuid();

/**
 * Salva o custo, da tabela ou da página do produto.
 *
 * `volta=lista` é a tabela de preços: o custo é perguntado na própria linha, e salvar
 * devolve para ela. Sem isso, volta para o produto, na loja e no alvo que estavam na tela.
 */
export async function salvarCusto(dados: FormData): Promise<void> {
  const id = esquemaDoId.safeParse(dados.get('id') ?? '');
  if (!id.success) {
    log.aviso('catalogo.id_invalido', {});
    redirect(paraLista('falha'));
  }

  const naLista = dados.get('volta') === 'lista';
  const destino = (codigo: CodigoDeAviso): string =>
    naLista ? paraLinha(id.data, codigo, dados) : paraProduto(id.data, codigo, dados);

  // `FormData.get` devolve `File` ou string, e `String(File)` viraria
  // "[object Object]", que o leitor de reais recusaria por acidente, com a mensagem
  // certa pelo motivo errado.
  const bruto = dados.get('custo');
  const custo = lerReaisDigitados(typeof bruto === 'string' ? bruto : '');
  if (custo === null) redirect(destino('custo_invalido'));

  let salvou = false;
  try {
    const { repo, perfil } = await repositorio();
    salvou = await repo.atualizarCusto({ perfil: perfil.id, skuId: id.data, custo });
  } catch (erro) {
    log.erro('catalogo.custo_falhou', { erro });
    redirect(destino('falha'));
  }

  revalidatePath(CAMINHO);
  revalidatePath(`${CAMINHO}/${id.data}`);
  redirect(destino(salvou ? 'custo' : 'nada'));
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
  voltagem: z.string().trim().max(60),
  medida: z.string().trim().max(120),
  quantidade: numeroOuNulo,
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
    voltagem: dados.get('voltagem') ?? '',
    medida: dados.get('medida') ?? '',
    quantidade: dados.get('quantidade') ?? '',
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

  // Quantidade é contagem, e "2,5 peças na caixa" é digitação errada. Arredondar em
  // silêncio gravaria 2 ou 3 sem ninguém saber qual — num campo que decide devolução.
  // A recusa é aqui, e não só no repositório, para a pessoa voltar ao produto com o
  // aviso em vez de cair na lista.
  const quantidade = lido.data.quantidade;
  if (quantidade !== null && (!Number.isInteger(quantidade) || quantidade <= 0)) {
    redirect(paraProduto(lido.data.id, 'ficha_invalida'));
  }

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
      voltagem: lido.data.voltagem === '' ? null : lido.data.voltagem,
      medida: lido.data.medida === '' ? null : lido.data.medida,
      quantidadeEmbalagem: quantidade,
    });
  } catch (erro) {
    log.aviso('catalogo.ficha_recusada', { erro });
    redirect(paraProduto(lido.data.id, 'ficha_invalida'));
  }

  revalidatePath(`${CAMINHO}/${lido.data.id}`);
  redirect(paraProduto(lido.data.id, salvou ? 'ficha' : 'nada'));
}

/**
 * Desativa ou reativa, pelo botão do detalhe do produto.
 *
 * Volta para o próprio produto, e não para a lista: é lá que está o botão de desfazer,
 * e é lá que o aviso diz de onde o produto saiu.
 */
async function definirAtivo(dados: FormData, ativo: boolean): Promise<void> {
  const id = esquemaDoId.safeParse(dados.get('id') ?? '');
  if (!id.success) {
    log.aviso('catalogo.id_invalido', {});
    redirect(paraLista('falha'));
  }

  let mudou = false;
  try {
    const { repo, perfil } = await repositorio();
    mudou = ativo
      ? await repo.reativar(perfil.id, id.data)
      : await repo.desativar(perfil.id, id.data);
  } catch (erro) {
    log.erro(ativo ? 'catalogo.reativacao_falhou' : 'catalogo.desativacao_falhou', { erro });
    redirect(paraProduto(id.data, 'falha'));
  }

  // Produto de outro perfil, ou apagado no meio: nada mudou, e a lista é o lugar certo.
  if (!mudou) redirect(paraLista('nada'));

  revalidatePath(CAMINHO);
  revalidatePath(`${CAMINHO}/${id.data}`);
  redirect(paraProduto(id.data, ativo ? 'reativado' : 'desativado'));
}

export async function desativarProduto(dados: FormData): Promise<void> {
  await definirAtivo(dados, false);
}

export async function reativarProduto(dados: FormData): Promise<void> {
  await definirAtivo(dados, true);
}
