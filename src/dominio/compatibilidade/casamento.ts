/**
 * O casamento de códigos citados num texto contra os aparelhos cadastrados.
 *
 * Mora aqui, e não no coletor, porque duas leituras o usam: a do título de anúncio
 * (`coletor.ts`) e a de fonte de fora — manual, página, catálogo, fórum (`fonte.ts`).
 * Comparação de texto normalizado, sem IA: o reconhecedor de código é o de
 * `canonico.ts`, escrito para a resolução de identidade.
 */
import {
  codigosDeModelo,
  normalizarCodigoDeModelo,
  normalizarMarca,
  normalizarTexto,
} from '@/dominio/identidade/canonico';
import type { AparelhoGravado } from './repositorio';

/** Aparelho reduzido ao que o casamento precisa. */
export interface AparelhoIndexado {
  readonly id: string;
  readonly codigo: string;
  readonly marca: string;
}

export type IndiceDeAparelhos = ReadonlyMap<string, readonly AparelhoIndexado[]>;

/**
 * Indexa aparelhos pelo código de modelo normalizado.
 *
 * Aparelho cujo modelo não tem forma de código fica fora: casar `Purificador
 * Master` por texto livre casaria com qualquer anúncio que tivesse a palavra, e
 * compatibilidade errada aqui custa devolução.
 */
export function indexarPorCodigo(
  aparelhos: readonly Pick<AparelhoGravado, 'id' | 'marca' | 'modelo'>[],
): IndiceDeAparelhos {
  const indice = new Map<string, AparelhoIndexado[]>();
  for (const a of aparelhos) {
    const codigo = normalizarCodigoDeModelo(a.modelo);
    if (codigo === null) continue;
    const entrada: AparelhoIndexado = { id: a.id, codigo, marca: normalizarMarca(a.marca) };
    const atual = indice.get(codigo);
    if (atual === undefined) indice.set(codigo, [entrada]);
    else atual.push(entrada);
  }
  return indice;
}

export interface AchadoNoAnuncio {
  readonly aparelhoId: string;
  readonly codigo: string;
  /** `true` quando veio do registro extraído, não do título. */
  readonly doRegistro: boolean;
}

export interface CasamentoDoAnuncio {
  readonly achados: readonly AchadoNoAnuncio[];
  /** Códigos que existem em mais de uma marca e o anúncio não desambiguou. */
  readonly ambiguos: readonly string[];
  /** Todos os códigos que o anúncio cita, casados ou não. Para a tela explicar. */
  readonly codigos: readonly string[];
}

export interface EntradaDoCasamento {
  readonly titulo: string;
  /** `modelosCompativeis` do registro extraído, quando a extração já rodou. */
  readonly modelosCompativeis?: readonly string[];
  readonly indice: IndiceDeAparelhos;
}

/**
 * Casa os códigos citados por um anúncio contra os aparelhos cadastrados.
 *
 * Quando o mesmo código existe em duas marcas, exige que o anúncio nomeie a marca.
 * Duas marcas podem usar `XP21A` para aparelhos diferentes, e escolher uma no
 * escuro seria inventar compatibilidade — então fica registrado como ambíguo e
 * ninguém decide por palpite.
 */
export function casarAnuncio(entrada: EntradaDoCasamento): CasamentoDoAnuncio {
  const doTitulo = new Set(codigosDeModelo(entrada.titulo));
  const doRegistro = new Set<string>();
  for (const m of entrada.modelosCompativeis ?? []) {
    const c = normalizarCodigoDeModelo(m);
    if (c !== null) doRegistro.add(c);
  }

  const tituloNormalizado = normalizarTexto(entrada.titulo);
  const achados: AchadoNoAnuncio[] = [];
  const ambiguos: string[] = [];
  const codigos = [...new Set([...doTitulo, ...doRegistro])].sort();

  for (const codigo of codigos) {
    const candidatos = entrada.indice.get(codigo);
    if (candidatos === undefined || candidatos.length === 0) continue;

    const marcas = new Set(candidatos.map((c) => c.marca));
    let escolhidos = candidatos;
    if (marcas.size > 1) {
      escolhidos = candidatos.filter((c) => tituloNormalizado.includes(c.marca));
      if (new Set(escolhidos.map((c) => c.marca)).size !== 1) {
        ambiguos.push(codigo);
        continue;
      }
    }

    for (const c of escolhidos) {
      achados.push({ aparelhoId: c.id, codigo, doRegistro: !doTitulo.has(codigo) });
    }
  }

  return { achados, ambiguos, codigos };
}
