/**
 * Senha de conta de acesso (ADR 0011): como se guarda e como se confere.
 *
 * A senha nunca é gravada. O banco guarda o resultado do `scrypt` — função feita para
 * ser cara de calcular, de propósito: quem roubar o banco precisa gastar esse custo a
 * cada palpite, em vez de testar bilhões de senhas por segundo. Os parâmetros são os
 * mínimos que a OWASP indica para `scrypt` (N = 2^17, r = 8, p = 1), e vão gravados
 * junto do hash: subir o custo no futuro não invalida a senha de ninguém, porque cada
 * hash diz com que custo foi feito.
 *
 * `scrypt` e não `argon2` porque vem no Node, sem dependência nativa — que teria de ser
 * compilada para o processador do servidor (ARM) e para o de quem desenvolve.
 */
import { randomBytes, scrypt as scryptComCallback, timingSafeEqual } from 'node:crypto';
import type { ScryptOptions } from 'node:crypto';

export interface CustoDoScrypt {
  /** Custo de CPU e memória. Potência de 2. */
  readonly N: number;
  readonly r: number;
  readonly p: number;
}

/** O custo das senhas novas. Mínimo da OWASP para `scrypt`. */
export const CUSTO_PADRAO: CustoDoScrypt = { N: 2 ** 17, r: 8, p: 1 };

const BYTES_DO_SAL = 16;
const BYTES_DO_HASH = 64;

/** Senha menor que isto é recusada no cadastro e na troca. */
export const TAMANHO_MINIMO_DA_SENHA = 10;
/** Acima disto é colagem acidental, e só custaria CPU. */
export const TAMANHO_MAXIMO_DA_SENHA = 200;

/** Memória que o `scrypt` pode usar: 128 · N · r, com folga. O padrão do Node é 32 MB. */
function memoriaPara(custo: CustoDoScrypt): number {
  return 128 * custo.N * custo.r * 2;
}

function scrypt(senha: string, sal: Buffer, custo: CustoDoScrypt): Promise<Buffer> {
  const opcoes: ScryptOptions = {
    N: custo.N,
    r: custo.r,
    p: custo.p,
    maxmem: memoriaPara(custo),
  };
  return new Promise((resolver, rejeitar) => {
    scryptComCallback(senha.normalize('NFKC'), sal, BYTES_DO_HASH, opcoes, (erro, chave) => {
      if (erro === null) resolver(chave);
      else rejeitar(erro);
    });
  });
}

/**
 * O hash que vai para o banco: `scrypt$N$r$p$sal$hash`, sal e hash em base64url.
 *
 * A senha é normalizada (NFKC) antes: "é" digitado no celular e no computador pode
 * chegar em duas formas Unicode, e a mesma senha não pode deixar de entrar por isso.
 */
export async function criarHashDeSenha(
  senha: string,
  custo: CustoDoScrypt = CUSTO_PADRAO,
): Promise<string> {
  const sal = randomBytes(BYTES_DO_SAL);
  const hash = await scrypt(senha, sal, custo);
  return [
    'scrypt',
    String(custo.N),
    String(custo.r),
    String(custo.p),
    sal.toString('base64url'),
    hash.toString('base64url'),
  ].join('$');
}

/** Lê o hash gravado. `null` para formato que não é deste módulo. */
function lerHash(
  gravado: string,
): { readonly custo: CustoDoScrypt; readonly sal: Buffer; readonly hash: Buffer } | null {
  const partes = gravado.split('$');
  if (partes.length !== 6 || partes[0] !== 'scrypt') return null;
  const [, n, r, p, sal, hash] = partes;
  const custo = { N: Number(n), r: Number(r), p: Number(p) };
  const inteiros = [custo.N, custo.r, custo.p].every((v) => Number.isInteger(v) && v > 0);
  if (!inteiros || sal === undefined || hash === undefined) return null;
  return {
    custo,
    sal: Buffer.from(sal, 'base64url'),
    hash: Buffer.from(hash, 'base64url'),
  };
}

/**
 * A senha confere com o hash gravado?
 *
 * Comparação em tempo constante: a resposta não pode demorar mais quando os primeiros
 * bytes batem, senão o tempo de resposta vira pista. Hash em formato desconhecido é
 * "não confere", e não erro — a tela diz o mesmo "e-mail ou senha não conferem" de
 * sempre.
 */
export async function conferirSenha(senha: string, gravado: string): Promise<boolean> {
  const lido = lerHash(gravado);
  if (lido === null || lido.hash.length !== BYTES_DO_HASH) return false;
  const calculado = await scrypt(senha, lido.sal, lido.custo);
  return timingSafeEqual(calculado, lido.hash);
}

/**
 * O que há de errado com uma senha nova, em palavras. Vazio é aceita.
 *
 * Tamanho, e não regra de composição: "exige maiúscula, número e símbolo" produz
 * `Senha@123`, e frase longa é mais forte e mais fácil de lembrar (NIST 800-63B).
 */
export function problemasDaSenhaNova(senha: string, email: string): readonly string[] {
  const problemas: string[] = [];
  if (senha.length < TAMANHO_MINIMO_DA_SENHA) {
    problemas.push(`a senha precisa de pelo menos ${String(TAMANHO_MINIMO_DA_SENHA)} caracteres`);
  }
  if (senha.length > TAMANHO_MAXIMO_DA_SENHA) {
    problemas.push(`a senha pode ter no máximo ${String(TAMANHO_MAXIMO_DA_SENHA)} caracteres`);
  }
  if (senha.trim().toLowerCase() === email.trim().toLowerCase()) {
    problemas.push('a senha não pode ser o próprio e-mail');
  }
  return problemas;
}
