/**
 * Ações da tela do leitor.
 *
 * Duas: avaliar um código e sincronizar a fila. Nenhuma decide nada — a decisão é
 * do `dominio/leitor`, que é função pura. Aqui é só a costura entre o navegador e
 * o domínio, mais a resolução do perfil ativo.
 *
 * As duas devolvem valor em vez de redirecionar, ao contrário das ações da tela
 * de importação. É consequência do uso: a pessoa está com o celular na mão, apontando
 * para um código de barras, e navegação a cada leitura perderia o estado da câmera
 * e da fila local.
 */
'use server';

import { normalizarGtin } from '@/dominio/gtin';
import { ConsultaDeGtin } from '@/dominio/leitor/consulta';
import { RepositorioDeLeituras, esquemaLeituraEnviada } from '@/dominio/leitor/leituras';
import type { LeituraEnviada, ResultadoDaSincronizacao } from '@/dominio/leitor/leituras';
import { decidirCompra } from '@/dominio/leitor/veredito';
import type { ResultadoDoVeredito } from '@/dominio/leitor/veredito';
import { carregarPerfil } from '@/dominio/perfil';
import { banco } from '@/infra/banco/cliente';
import { lerAmbiente } from '@/config/ambiente';
import { centavos, pontosBase } from '@/lib/dinheiro';
import { criarRegistrador, nivelDoAmbiente } from '@/infra/log';
import {
  DEVOLUCAO_PRESUMIDA_BP,
  EMBALAGEM_PRESUMIDA_CENTAVOS,
  PESO_PRESUMIDO_GRAMAS,
} from './constantes';

const log = criarRegistrador({
  nivelMinimo: nivelDoAmbiente(process.env['LOG_NIVEL']),
  contexto: { origem: 'leitor' },
});

export interface AvaliacaoDeGtin {
  readonly gtinLido: string;
  /** `null` quando o código não é um GTIN válido. */
  readonly gtinValido: {
    readonly digitos: string;
    readonly tipo: string;
    readonly canonico: string | null;
    readonly nivelDeEmbalagem: string;
    readonly formatado: string;
    readonly prefixo: string | null;
  } | null;
  readonly veredito: ResultadoDoVeredito | null;
  /** O produto já é do perfil? Muda a pergunta que a tela faz. */
  readonly skuProprio: { readonly titulo: string; readonly custoAtual: number | null } | null;
  readonly ocorrencias: number;
  /** Quantas vezes este perfil já avaliou este código. */
  readonly avaliacoesAnteriores: number;
  /** Presunções que entraram no cálculo, para a tela poder dizer. */
  readonly presumido: {
    readonly pesoGramas: number;
    readonly embalagemCentavos: number;
    readonly devolucaoBp: number;
  };
}

/**
 * Avalia um código de barras com um custo.
 *
 * Devolve avaliação mesmo quando o código é inválido ou não há evidência: a tela
 * precisa mostrar **o quê** falta, e "sem dado" é resposta, não erro.
 */
export async function avaliarGtin(params: {
  readonly gtin: string;
  readonly custoCentavos: number;
  readonly unidadesNoLote?: number;
}): Promise<AvaliacaoDeGtin> {
  const db = banco();
  const ambiente = lerAmbiente();
  const perfil = await carregarPerfil(db, ambiente.BANCADA_PERFIL_PADRAO);

  const presumido = {
    pesoGramas: PESO_PRESUMIDO_GRAMAS,
    embalagemCentavos: EMBALAGEM_PRESUMIDA_CENTAVOS,
    devolucaoBp: DEVOLUCAO_PRESUMIDA_BP,
  };

  const gtin = normalizarGtin(params.gtin);
  if (gtin === null) {
    log.aviso('leitor.gtin_invalido', { lido: params.gtin });
    return {
      gtinLido: params.gtin,
      gtinValido: null,
      veredito: null,
      skuProprio: null,
      ocorrencias: 0,
      avaliacoesAnteriores: 0,
      presumido,
    };
  }

  const { formatarGtin, prefixoGs1, ROTULO_DO_TIPO } = await import('@/dominio/gtin');
  const consulta = new ConsultaDeGtin(db);
  const repoLeituras = new RepositorioDeLeituras(db);

  const [evidencia, anteriores] = await Promise.all([
    consulta.buscar({ perfil: perfil.id, gtin }),
    gtin.ean13 === null
      ? Promise.resolve([])
      : repoLeituras.doGtin({ perfil: perfil.id, gtinCanonico: gtin.ean13 }),
  ]);

  const unidades = params.unidadesNoLote ?? 1;
  const custoUnitario = centavos(
    unidades > 1 ? Math.round(params.custoCentavos / unidades) : params.custoCentavos,
  );

  const veredito = decidirCompra({
    custoUnitario,
    ...(unidades > 1 ? { unidadesNoLote: unidades } : {}),
    ...(gtin.nivelDeEmbalagem === 'agrupamento' ? { codigoDeAgrupamento: true } : {}),
    evidencias: evidencia.evidencias,
    base: {
      plataforma: 'ml',
      tipoAnuncioML: 'classico',
      pesoGramas: presumido.pesoGramas,
      embalagem: centavos(presumido.embalagemCentavos),
      modoFrete: 'comprador_paga',
      taxaDevolucaoEsperada: pontosBase(presumido.devolucaoBp),
      vendedor: perfil.contextoDoVendedor,
    },
  });

  log.info('leitor.avaliou', {
    gtin: gtin.digitos,
    veredito: veredito.veredito,
    ocorrencias: evidencia.ocorrencias.length,
    confiancaBp: veredito.confiancaBp,
  });

  return {
    gtinLido: params.gtin,
    gtinValido: {
      digitos: gtin.digitos,
      tipo: ROTULO_DO_TIPO[gtin.tipo],
      canonico: gtin.ean13,
      nivelDeEmbalagem: gtin.nivelDeEmbalagem,
      formatado: formatarGtin(gtin),
      prefixo: prefixoGs1(gtin)?.rotulo ?? null,
    },
    veredito,
    skuProprio:
      evidencia.skuProprio === null
        ? null
        : {
            titulo: evidencia.skuProprio.tituloInterno,
            custoAtual: evidencia.skuProprio.custoAtual,
          },
    ocorrencias: evidencia.ocorrencias.length,
    avaliacoesAnteriores: anteriores.length,
    presumido,
  };
}

/**
 * Recebe a fila do dispositivo.
 *
 * Idempotente por `idLocal`, o que é o requisito inteiro desta ação: o dispositivo
 * reenvia quando não tem certeza de que chegou, e isso é o normal numa loja.
 */
export async function sincronizarLeituras(
  leituras: readonly LeituraEnviada[],
): Promise<ResultadoDaSincronizacao> {
  const db = banco();
  const ambiente = lerAmbiente();
  const perfil = await carregarPerfil(db, ambiente.BANCADA_PERFIL_PADRAO);

  // Valida a forma antes de gastar transação. O repositório valida de novo — é
  // fronteira externa, e a segunda validação é a que conta.
  const aceitas = leituras.filter((l) => esquemaLeituraEnviada.safeParse(l).success);
  if (aceitas.length !== leituras.length) {
    log.aviso('leitor.fila_com_forma_invalida', {
      recebidas: leituras.length,
      aceitas: aceitas.length,
    });
  }

  const resultado = await new RepositorioDeLeituras(db).sincronizar({
    perfil: perfil.id,
    leituras,
  });

  log.info('leitor.fila_sincronizada', {
    gravadas: resultado.gravadas,
    atualizadas: resultado.atualizadas,
    recusadas: resultado.recusadas.length,
  });

  return resultado;
}
