/**
 * A tabela de fornecedor que chega como imagem — o print do WhatsApp (M1, etapa 3.6).
 *
 * A IA faz **só** o que só ela faz: ler o texto que está na imagem. Transcreve linha por
 * linha, como está escrito, e para aí. Separar título de preço, reconhecer código de peça
 * e deixar de fora saudação e condição de pagamento continua sendo o código que já lê a
 * tabela colada (`linhasDeCatalogo`) — determinístico e testado (CLAUDE.md, 3.5). Uma
 * leitura de imagem é um pedido só, gratuito (3.7), e a mesma foto não é lida duas vezes:
 * a imagem entra no cache pelo hash.
 */
import { z } from 'zod';
import type { ServicoDeLlm } from '@/infra/llm';

export const PROPOSITO_DA_IMAGEM = 'extracao' as const;

/** Linhas transcritas por imagem, no máximo. Print de WhatsApp tem dezenas. */
export const MAX_LINHAS_DA_IMAGEM = 400;

export const INSTRUCOES_DA_IMAGEM = `A imagem é uma tabela de preços de fornecedor de peças de reposição — quase sempre o print de uma conversa de WhatsApp, de uma planilha ou de um PDF.
Transcreva o texto da imagem, uma linha de texto por item de "linhas", na ordem em que aparece, exatamente como está escrito: códigos, marcas, medidas e preços com a vírgula e o "R$" como estão.
Não resuma, não traduza, não corrija e não complete o que está cortado ou ilegível — deixe de fora o que não dá para ler.
Se a imagem não tiver texto, devolva "linhas" vazio.`;

export const esquemaDaTranscricao = z.object({
  linhas: z.array(z.string()).max(MAX_LINHAS_DA_IMAGEM),
});

/** Os tipos de imagem que os modelos de visão aceitam. */
export const TIPOS_DE_IMAGEM = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;
export type TipoDeImagem = (typeof TIPOS_DE_IMAGEM)[number];

/**
 * O tipo da imagem pela assinatura dos primeiros bytes — e não pelo nome, que o
 * WhatsApp troca. `null` para o que não é um dos quatro: HEIC da câmera do iPhone, por
 * exemplo, que os modelos não leem.
 */
export function tipoDaImagem(bytes: Uint8Array): TipoDeImagem | null {
  const b = (i: number) => bytes[i] ?? -1;
  if (b(0) === 0x89 && b(1) === 0x50 && b(2) === 0x4e && b(3) === 0x47) return 'image/png';
  if (b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) return 'image/jpeg';
  if (b(0) === 0x47 && b(1) === 0x49 && b(2) === 0x46 && b(3) === 0x38) return 'image/gif';
  const riff = b(0) === 0x52 && b(1) === 0x49 && b(2) === 0x46 && b(3) === 0x46;
  const webp = b(8) === 0x57 && b(9) === 0x45 && b(10) === 0x42 && b(11) === 0x50;
  return riff && webp ? 'image/webp' : null;
}

export type LeituraDaImagem =
  | { readonly tipo: 'ok'; readonly texto: string }
  | { readonly tipo: 'sem_chave' }
  /** Não é imagem que se leia, ou o modelo não devolveu leitura: revisão, com o motivo. */
  | { readonly tipo: 'ilegivel'; readonly motivo: string }
  /** Provedor fora: não é da imagem, e tentar de novo mais tarde pode dar certo. */
  | { readonly tipo: 'provedor_falhou'; readonly motivo: string };

/**
 * Lê o texto de uma imagem. Lança só `ExecucaoInterrompida` — cota e teto. A tentativa do
 * job entra na pergunta a partir da segunda: leitura fora do formato também vira cache, e
 * reler a mesma imagem com a mesma pergunta devolveria a mesma leitura ruim.
 */
export type LeitorDeImagem = (bytes: Uint8Array, tentativa?: number) => Promise<LeituraDaImagem>;

/** O leitor de imagem com um serviço de IA e um modelo com visão. */
export function leitorDeImagemCom(llm: ServicoDeLlm, modelo: string): LeitorDeImagem {
  return async (bytes, tentativa = 1) => {
    const tipo = tipoDaImagem(bytes);
    if (tipo === null) {
      return {
        tipo: 'ilegivel',
        motivo:
          'o arquivo não é PNG, JPG, WEBP nem GIF — foto de iPhone vem em HEIC, que os modelos não leem. Tire um print da tela e envie o print.',
      };
    }

    const resultado = await llm.pedir({
      proposito: PROPOSITO_DA_IMAGEM,
      modelo,
      instrucoes: INSTRUCOES_DA_IMAGEM,
      entrada: {
        pedido: 'transcrever a tabela da imagem',
        ...(tentativa > 1 ? { tentativa } : {}),
      },
      imagens: [{ tipo, base64: Buffer.from(bytes).toString('base64') }],
      esquema: esquemaDaTranscricao,
    });

    switch (resultado.tipo) {
      case 'ok':
        return { tipo: 'ok', texto: resultado.valor.linhas.join('\n') };
      case 'sem_chave':
        return { tipo: 'sem_chave' };
      case 'pendente_revisao':
        return {
          tipo: 'ilegivel',
          motivo: `a leitura da imagem voltou fora do formato (${resultado.problemas.slice(0, 2).join('; ')}).`,
        };
      case 'erro':
        return resultado.natureza === 'provedor'
          ? { tipo: 'provedor_falhou', motivo: resultado.mensagem }
          : {
              tipo: 'ilegivel',
              motivo: `o modelo não devolveu uma leitura da imagem: ${resultado.mensagem}. Se o modelo configurado não lê imagem, escolha um com visão em LLM_MODELO_VISAO.`,
            };
    }
  };
}
