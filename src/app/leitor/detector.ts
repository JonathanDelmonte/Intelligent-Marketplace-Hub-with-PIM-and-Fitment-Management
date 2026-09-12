/**
 * Detecção de código de barras no navegador, por capacidade.
 *
 * É a filosofia da seção 2 do projeto aplicada ao navegador: **pergunta-se por
 * capacidade, nunca por plataforma**. O código não pergunta "é Android?", pergunta
 * "existe `BarcodeDetector`?" — e trata a ausência como estado normal, com um
 * caminho alternativo, não como erro.
 *
 * Duas implementações:
 *
 * - **Nativa** (`BarcodeDetector`): usa o decodificador do sistema. Rápida, sem
 *   download. Existe no Chrome de Android, no macOS e no ChromeOS.
 * - **`zxing-wasm`**: decodificador compilado para WebAssembly. É o caminho no
 *   Safari de iPhone, que não tem `BarcodeDetector` — e iPhone é metade do
 *   mercado. Não é um plano B exótico: para boa parte dos usuários é o único
 *   plano.
 *
 * O wasm vem do **próprio domínio**, não de CDN. Requisito de offline, não
 * conforto: CDN é exatamente o que não responde numa loja com sinal ruim, e o
 * service worker só consegue cachear o que é servido daqui.
 *
 * Nada aqui roda no servidor. O módulo é importado só por componente de cliente.
 */

export const FORMATOS_NATIVOS = [
  'ean_13',
  'ean_8',
  'upc_a',
  'upc_e',
  // ITF-14 é a simbologia do código de caixa. Ler e **saber** que é caixa é o que
  // evita comparar custo de fardo com preço de peça.
  'itf14',
  'code_128',
] as const;

export const FORMATOS_ZXING = ['EAN-13', 'EAN-8', 'UPC-A', 'UPC-E', 'ITF', 'Code128'] as const;

export const CAMINHO_DO_WASM = '/wasm/zxing_reader.wasm';

export type NomeDoDetector = 'nativo' | 'zxing';

export interface DetectorDeCodigo {
  readonly nome: NomeDoDetector;
  /** Dígitos encontrados no quadro. Vazio quando não achou nada. */
  detectar(video: HTMLVideoElement): Promise<readonly string[]>;
}

// ─── Tipos mínimos do BarcodeDetector ────────────────────────────────────────
//
// A API não está na `lib.dom` do TypeScript. Declarar o mínimo aqui é melhor que
// um `.d.ts` global: mantém a suposição perto de quem depende dela, e nenhum
// `any` entra no projeto.

interface CodigoDetectado {
  readonly rawValue: string;
  readonly format?: string;
}

interface InstanciaDeBarcodeDetector {
  detect(fonte: HTMLVideoElement): Promise<readonly CodigoDetectado[]>;
}

interface ConstrutorDeBarcodeDetector {
  new (opcoes?: { formats?: readonly string[] }): InstanciaDeBarcodeDetector;
  getSupportedFormats?: () => Promise<readonly string[]>;
}

interface GlobalComDetector {
  BarcodeDetector?: ConstrutorDeBarcodeDetector;
}

/** O navegador tem decodificador nativo? */
export function temDetectorNativo(): boolean {
  return typeof (globalThis as GlobalComDetector).BarcodeDetector === 'function';
}

/**
 * Quais formatos o decodificador nativo suporta de fato.
 *
 * Existir não é suportar: há navegador com `BarcodeDetector` que não conhece
 * `itf14`. Perguntar antes evita construir um detector que nunca acha nada — o
 * pior modo de falha possível, porque parece que a câmera está funcionando.
 */
export async function formatosNativosDisponiveis(): Promise<readonly string[]> {
  const construtor = (globalThis as GlobalComDetector).BarcodeDetector;
  if (construtor === undefined || construtor.getSupportedFormats === undefined) return [];
  try {
    return await construtor.getSupportedFormats();
  } catch {
    return [];
  }
}

function criarNativo(formatos: readonly string[]): DetectorDeCodigo {
  const construtor = (globalThis as GlobalComDetector).BarcodeDetector;
  if (construtor === undefined) throw new Error('BarcodeDetector não existe neste navegador');

  const detector = new construtor({ formats: [...formatos] });

  return {
    nome: 'nativo',
    async detectar(video) {
      const achados = await detector.detect(video);
      return achados.map((a) => a.rawValue);
    },
  };
}

/**
 * Detector por WebAssembly.
 *
 * O quadro do vídeo vai para um canvas fora de tela e de lá para `ImageData`,
 * que é o que o decodificador aceita. O canvas é criado **uma vez** e reusado: um
 * canvas por quadro, a quatro quadros por segundo, é lixo de memória suficiente
 * para travar o celular no meio de uma sessão de quarenta leituras.
 */
async function criarZxing(): Promise<DetectorDeCodigo> {
  const { prepareZXingModule, readBarcodes } = await import('zxing-wasm/reader');

  prepareZXingModule({
    overrides: { locateFile: () => CAMINHO_DO_WASM },
  });

  let canvas: HTMLCanvasElement | null = null;
  let contexto: CanvasRenderingContext2D | null = null;

  return {
    nome: 'zxing',
    async detectar(video) {
      const largura = video.videoWidth;
      const altura = video.videoHeight;
      if (largura === 0 || altura === 0) return [];

      if (canvas === null) canvas = document.createElement('canvas');
      if (canvas.width !== largura || canvas.height !== altura) {
        canvas.width = largura;
        canvas.height = altura;
        contexto = null;
      }
      contexto ??= canvas.getContext('2d', { willReadFrequently: true });
      if (contexto === null) return [];

      contexto.drawImage(video, 0, 0, largura, altura);
      const quadro = contexto.getImageData(0, 0, largura, altura);

      const achados = await readBarcodes(quadro, {
        formats: [...FORMATOS_ZXING],
        tryHarder: false,
        maxNumberOfSymbols: 1,
      });

      return achados.filter((a) => a.isValid).map((a) => a.text);
    },
  };
}

/**
 * Escolhe o detector disponível, preferindo o nativo.
 *
 * Nativo primeiro porque é mais rápido e não custa 900 KB de download. O wasm
 * entra quando o nativo não existe ou não conhece nenhum formato de código de
 * barras linear — o caso do iPhone.
 */
export async function escolherDetector(): Promise<DetectorDeCodigo> {
  if (temDetectorNativo()) {
    const suportados = await formatosNativosDisponiveis();
    const uteis = FORMATOS_NATIVOS.filter((f) => suportados.includes(f));
    if (uteis.length > 0) return criarNativo(uteis);
  }
  return criarZxing();
}
