/**
 * Cifragem de credencial em repouso.
 *
 * AES-256-GCM com AAD ligando o texto cifrado ao `(perfilId, plataforma, campo)`.
 * O AAD é o detalhe que importa: **texto cifrado movido de uma linha para outra
 * não decifra**. Sem ele, copiar o `token_cifrado` do perfil A para a linha do
 * perfil B funcionaria, e um bug de `UPDATE` viraria uso de credencial alheia.
 *
 * Ver ADR 0007 para por que credencial é dado em tabela e não variável de ambiente.
 */
import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Plataforma } from '@/dominio/precificacao/tipos';

const ALGORITMO = 'aes-256-gcm';
const TAMANHO_CHAVE = 32;
const TAMANHO_IV = 12;
const TAMANHO_TAG = 16;
/** Prefixo de versão, para rotação de esquema sem ambiguidade. */
const VERSAO = 'v1';

export class CredencialCriptografiaInvalida extends Error {
  override readonly name = 'CredencialCriptografiaInvalida';
}

/** Identifica univocamente onde o segredo mora. Entra no AAD. */
export interface EnderecoDoSegredo {
  readonly perfilId: string;
  readonly plataforma: Plataforma;
  /** Qual campo da linha: `token` ou `refresh_token`. */
  readonly campo: 'token' | 'refresh_token';
}

function chaveDe(chaveMestraBase64: string): Buffer {
  const chave = Buffer.from(chaveMestraBase64, 'base64');
  if (chave.length !== TAMANHO_CHAVE) {
    throw new CredencialCriptografiaInvalida(
      `chave mestra precisa ter ${String(TAMANHO_CHAVE)} bytes, tem ${String(chave.length)}`,
    );
  }
  return chave;
}

function aadDe(endereco: EnderecoDoSegredo): Buffer {
  return Buffer.from(`${endereco.perfilId}:${endereco.plataforma}:${endereco.campo}`, 'utf8');
}

/**
 * Cifra um segredo. Devolve `v1.<iv>.<tag>.<cifrado>`, tudo em base64url.
 *
 * O IV é aleatório por chamada: cifrar o mesmo token duas vezes produz saídas
 * diferentes, que é o que se quer — saída determinística permitiria descobrir por
 * comparação que dois perfis usam o mesmo token.
 */
export function cifrar(params: {
  readonly segredo: string;
  readonly endereco: EnderecoDoSegredo;
  readonly chaveMestraBase64: string;
}): string {
  if (params.segredo === '') {
    throw new CredencialCriptografiaInvalida('não há segredo vazio a cifrar');
  }

  const chave = chaveDe(params.chaveMestraBase64);
  const iv = randomBytes(TAMANHO_IV);
  const cifrador = createCipheriv(ALGORITMO, chave, iv, { authTagLength: TAMANHO_TAG });
  cifrador.setAAD(aadDe(params.endereco));

  const cifrado = Buffer.concat([cifrador.update(params.segredo, 'utf8'), cifrador.final()]);
  const tag = cifrador.getAuthTag();

  return [
    VERSAO,
    iv.toString('base64url'),
    tag.toString('base64url'),
    cifrado.toString('base64url'),
  ].join('.');
}

/**
 * Decifra um segredo.
 *
 * Lança quando o endereço não corresponde ao usado na cifragem — é o AAD fazendo
 * o trabalho dele. Também lança quando a tag de autenticação não fecha, que é
 * adulteração ou chave errada; a mensagem não distingue os dois casos de
 * propósito.
 */
export function decifrar(params: {
  readonly cifrado: string;
  readonly endereco: EnderecoDoSegredo;
  readonly chaveMestraBase64: string;
}): string {
  const partes = params.cifrado.split('.');
  if (partes.length !== 4) {
    throw new CredencialCriptografiaInvalida('formato de texto cifrado irreconhecível');
  }

  const [versao, ivB64, tagB64, dadosB64] = partes as [string, string, string, string];
  if (versao !== VERSAO) {
    throw new CredencialCriptografiaInvalida(`versão de cifragem desconhecida: ${versao}`);
  }

  const chave = chaveDe(params.chaveMestraBase64);
  const iv = Buffer.from(ivB64, 'base64url');
  const tag = Buffer.from(tagB64, 'base64url');

  if (iv.length !== TAMANHO_IV || tag.length !== TAMANHO_TAG) {
    throw new CredencialCriptografiaInvalida('IV ou tag de autenticação com tamanho inválido');
  }

  try {
    const decifrador = createDecipheriv(ALGORITMO, chave, iv, { authTagLength: TAMANHO_TAG });
    decifrador.setAAD(aadDe(params.endereco));
    decifrador.setAuthTag(tag);
    return Buffer.concat([
      decifrador.update(Buffer.from(dadosB64, 'base64url')),
      decifrador.final(),
    ]).toString('utf8');
  } catch {
    throw new CredencialCriptografiaInvalida(
      'não foi possível decifrar: chave errada, endereço diferente do usado ao cifrar, ou dado adulterado',
    );
  }
}

/**
 * Gera uma chave mestra nova, em base64.
 *
 * Usada pelo setup inicial e pela rotação de chave. A rotação em si é decifrar com
 * a antiga e cifrar com a nova, dentro de uma transação por linha.
 */
export function gerarChaveMestra(): string {
  return randomBytes(TAMANHO_CHAVE).toString('base64');
}

/**
 * Compara dois segredos em tempo constante.
 *
 * Existe para o fluxo de verificação de token não vazar informação por tempo de
 * resposta. Comparar com `===` seria suficiente para a maioria dos usos, mas o
 * hábito de usar isto em segredo é o que evita o caso em que não é.
 */
export function segredosIguais(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  // `timingSafeEqual` exige tamanhos iguais, e o tamanho já é informação pública
  // o suficiente para não valer esconder.
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
