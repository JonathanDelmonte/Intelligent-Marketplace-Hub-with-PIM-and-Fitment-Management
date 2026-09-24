/**
 * O texto de um endereço, seja página ou PDF.
 *
 * Para quem precisa do que a fonte **diz**, e não do preço que ela declara: a
 * compatibilidade tirada de manual do fabricante e de página oficial (M4, 6.10 e 6.11).
 * O manual quase sempre é PDF, e o link não avisa — então o endereço é lido como bytes, e
 * o formato vem do tipo da resposta ou da assinatura `%PDF` no começo do arquivo.
 *
 * Página que recusa quem não é navegador (401, 403) ou que não existe (404, 410) é
 * resposta: devolve o motivo, com o caminho que funciona. Rede fora, tempo esgotado e
 * erro do site (5xx) lançam `FalhaDeRede` — tentar de novo mais tarde pode dar certo.
 */
import { PdfIlegivel, textoDoPdf } from '@/infra/pdf/texto';
import { FalhaDeRede, lerBytes, type OpcoesDaRede } from '@/infra/web/rede';
import { linhasVisiveis, tituloDaPagina } from './pagina';

export type TextoDoEndereco =
  | {
      readonly tipo: 'ok';
      readonly texto: string;
      readonly titulo: string | null;
      /** O endereço final, depois de redirecionamento: é ele que a evidência cita. */
      readonly url: string;
      readonly formato: 'pdf' | 'pagina';
    }
  | { readonly tipo: 'recusado'; readonly motivo: string };

/** Os quatro primeiros bytes de todo PDF: `%PDF`. */
function comecaComoPdf(bytes: Uint8Array): boolean {
  return bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
}

export async function lerTextoDoEndereco(
  endereco: string,
  opcoes: OpcoesDaRede = {},
): Promise<TextoDoEndereco> {
  const resposta = await lerBytes(endereco, opcoes);
  if (resposta.status === 404 || resposta.status === 410) {
    return { tipo: 'recusado', motivo: 'a página não existe mais.' };
  }
  if (resposta.status === 401 || resposta.status === 403) {
    return {
      tipo: 'recusado',
      motivo:
        'o site recusou a leitura: ele só abre no navegador. Baixe o PDF e envie o arquivo, ou copie o texto e cole.',
    };
  }
  if (resposta.status >= 400) {
    throw new FalhaDeRede(`o site respondeu ${String(resposta.status)}.`, resposta.status);
  }

  if (/pdf/i.test(resposta.tipo ?? '') || comecaComoPdf(resposta.bytes)) {
    try {
      const texto = await textoDoPdf(resposta.bytes);
      return { tipo: 'ok', texto, titulo: null, url: resposta.url, formato: 'pdf' };
    } catch (erro) {
      if (!(erro instanceof PdfIlegivel)) throw erro;
      return { tipo: 'recusado', motivo: erro.message };
    }
  }

  const html = new TextDecoder('utf-8').decode(resposta.bytes);
  return {
    tipo: 'ok',
    texto: linhasVisiveis(html),
    titulo: tituloDaPagina(html),
    url: resposta.url,
    formato: 'pagina',
  };
}
