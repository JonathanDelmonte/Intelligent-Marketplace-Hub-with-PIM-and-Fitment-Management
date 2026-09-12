/**
 * Log estruturado.
 *
 * A especificação pede, na seção 7, "log estruturado e uma tela de últimos 100
 * jobs com erro visível". Este arquivo é a primeira metade: uma linha de JSON por
 * evento, em `stdout`, com nome de evento estável e campos nomeados.
 *
 * Linha de JSON em vez de texto formatado porque o consumidor é `grep`, `jq` ou
 * um coletor — e porque um poller rodando por horas gera log que ninguém lê
 * inteiro, só consulta.
 *
 * ## A regra que este módulo não pode quebrar: nunca lançar
 *
 * Um registrador que lança derruba quem o chamou. E o principal chamador é o
 * poller, cujo laço precisa sobreviver a tudo. Quatro armadilhas reais de
 * `JSON.stringify` que quebrariam exatamente aí:
 *
 * - **`bigint` lança `TypeError`.** O sistema guarda dinheiro em centavos e o
 *   driver devolve `bigint` em algumas colunas (ADR 0004). Registrar um preço
 *   cru derrubaria o laço.
 * - **Referência circular lança.** Objeto de erro de driver costuma apontar de
 *   volta para a conexão.
 * - **`Error` serializa como `{}`.** `message` e `stack` não são enumeráveis, então
 *   o campo mais importante do log de erro desapareceria em silêncio.
 * - **Texto colado tem 8 KB.** Cabe no payload de um job (ver o orquestrador) e
 *   não cabe numa linha de log.
 *
 * Por isso tudo passa por `sanear` antes, e a escrita ainda vai dentro de
 * `try/catch` com linha de recurso. É defesa em duas camadas de propósito: a
 * primeira resolve o que se sabe, a segunda impede que o que não se sabe mate o
 * processo.
 */

export const NIVEIS = ['debug', 'info', 'aviso', 'erro'] as const;
export type Nivel = (typeof NIVEIS)[number];

const ORDEM: Readonly<Record<Nivel, number>> = { debug: 10, info: 20, aviso: 30, erro: 40 };

export type Campos = Readonly<Record<string, unknown>>;

export interface Registrador {
  debug(evento: string, campos?: Campos): void;
  info(evento: string, campos?: Campos): void;
  aviso(evento: string, campos?: Campos): void;
  erro(evento: string, campos?: Campos): void;
  /**
   * Registrador filho que carrega campos fixos.
   *
   * É o que permite ao poller anotar `{ poller: 'ingestao' }` uma vez e não
   * repetir em cada chamada — repetição que sempre acaba divergindo.
   */
  com(campos: Campos): Registrador;
}

/** Limites de tamanho. Log é diagnóstico, não arquivo de dados. */
export const MAX_TEXTO = 300;
export const MAX_ITENS = 20;
export const MAX_PROFUNDIDADE = 4;

/** Marca que substitui valor sensível. */
export const OCULTO = '[oculto]';

/**
 * Pedaços de nome de campo que indicam segredo.
 *
 * Credencial de plataforma mora cifrada na tabela `credencial` (ADR 0007), mas
 * ela passa **em claro** pela memória no momento de usar — e é aí que alguém
 * registra o objeto inteiro para depurar. Redigir por nome de campo é grosseiro
 * de propósito: erra para o lado de esconder.
 */
const PEDACOS_SENSIVEIS = [
  'senha',
  'password',
  'token',
  'secret',
  'segredo',
  'chave',
  'key',
  'authorization',
  'cookie',
  'credencial',
  'credential',
  'assinatura',
  'signature',
] as const;

export function ehCampoSensivel(nome: string): boolean {
  const normalizado = nome.toLowerCase();
  // `chave_idempotencia` e `chaveIdempotencia` não são segredo, e aparecem em
  // quase todo log de fila: esconder a chave do job tiraria a única coisa que
  // liga a linha de log ao registro no banco.
  if (normalizado.includes('idempotencia')) return false;
  return PEDACOS_SENSIVEIS.some((pedaco) => normalizado.includes(pedaco));
}

/**
 * Converte qualquer valor em algo que `JSON.stringify` aceita.
 *
 * Corta profundidade, quantidade e tamanho de texto, redige campo sensível e
 * quebra ciclo. Devolve `unknown` porque a saída é opaca por definição — quem
 * chama só a entrega ao serializador.
 */
export function sanear(valor: unknown, profundidade = 0, vistos = new WeakSet<object>()): unknown {
  if (valor === null || valor === undefined) return null;

  // Cadeia de `if` em vez de `switch (typeof valor)`: cada teste estreita o
  // `unknown` para o tipo certo, então nada precisa de asserção — e asserção para
  // calar o compilador é o que a seção 4 do CLAUDE.md proíbe.
  if (typeof valor === 'string') return recortar(valor);
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : String(valor);
  if (typeof valor === 'boolean') return valor;
  // Texto, não `Number`: centavo em `bigint` pode passar de 2^53 e a conversão
  // perderia precisão silenciosamente, que é o defeito que o ADR 0004 evita.
  if (typeof valor === 'bigint') return valor.toString();
  if (typeof valor === 'symbol') return valor.toString();
  if (typeof valor === 'function') {
    return `[função ${valor.name === '' ? 'anônima' : valor.name}]`;
  }

  if (valor instanceof Error) return saneErro(valor, profundidade, vistos);
  if (valor instanceof Date) return valor.toISOString();
  if (valor instanceof Map) return sanear(Object.fromEntries(valor), profundidade, vistos);
  if (valor instanceof Set) return sanear([...valor], profundidade, vistos);

  if (vistos.has(valor)) return '[circular]';
  if (profundidade >= MAX_PROFUNDIDADE) return '[profundo]';
  vistos.add(valor);

  if (Array.isArray(valor)) {
    const itens = valor.slice(0, MAX_ITENS).map((v) => sanear(v, profundidade + 1, vistos));
    return valor.length > MAX_ITENS ? [...itens, `[+${String(valor.length - MAX_ITENS)}]`] : itens;
  }

  return saneObjeto(valor, profundidade, vistos);
}

/**
 * Campos próprios de um objeto, sem asserção de tipo.
 *
 * O espalhamento copia exatamente o que `Object.keys` enumeraria — propriedade
 * própria e enumerável — e o resultado já tem assinatura de índice, o que dispensa
 * converter `object` para `Record` à força.
 */
function camposProprios(valor: object): Record<string, unknown> {
  return { ...valor };
}

function saneObjeto(valor: object, profundidade: number, vistos: WeakSet<object>): unknown {
  const campos = camposProprios(valor);
  const chaves = Object.keys(campos);
  const saida: Record<string, unknown> = {};

  for (const chave of chaves.slice(0, MAX_ITENS)) {
    saida[chave] = ehCampoSensivel(chave)
      ? OCULTO
      : sanear(campos[chave], profundidade + 1, vistos);
  }
  if (chaves.length > MAX_ITENS) saida['_omitidos'] = chaves.length - MAX_ITENS;
  return saida;
}

/**
 * `Error` com `message` e `stack` visíveis, mais `cause` encadeada.
 *
 * A pilha entra sempre, e não só em `debug`: erro de poller sem pilha custa mais
 * tempo de diagnóstico do que a linha extra custa de espaço.
 */
function saneErro(erro: Error, profundidade: number, vistos: WeakSet<object>): unknown {
  const base: Record<string, unknown> = {
    nome: erro.name,
    mensagem: recortar(erro.message),
  };
  if (typeof erro.stack === 'string')
    base['pilha'] = erro.stack.split(quebraDeLinha()).slice(0, 12);
  if (erro.cause !== undefined && profundidade < MAX_PROFUNDIDADE) {
    base['causa'] = sanear(erro.cause, profundidade + 1, vistos);
  }
  // Campo próprio de erro do domínio (`FilaError.problemas`, `ConteudoNaoEncontrado.hash`)
  // é justamente o que diz o que aconteceu, então não se perde.
  const proprios = camposProprios(erro);
  for (const chave of Object.keys(proprios)) {
    if (chave === 'name' || chave === 'message' || chave === 'stack' || chave === 'cause') continue;
    base[chave] = ehCampoSensivel(chave)
      ? OCULTO
      : sanear(proprios[chave], profundidade + 1, vistos);
  }
  return base;
}

function recortar(texto: string): string {
  if (texto.length <= MAX_TEXTO) return texto;
  return `${texto.slice(0, MAX_TEXTO)}[+${String(texto.length - MAX_TEXTO)}]`;
}

/**
 * Quebra de linha como código, não como literal.
 *
 * `scripts/verificar-fontes-texto.mjs` recusa caractere de controle literal em
 * arquivo-fonte, e o custo de descobrir isso já foi pago uma vez (ver o diário).
 */
function quebraDeLinha(): string {
  return String.fromCharCode(10);
}

export interface OpcoesDoRegistrador {
  /** Abaixo deste nível nada é escrito. Padrão: `info`. */
  readonly nivelMinimo?: Nivel;
  /** Para onde a linha vai. Padrão: `stdout`. Teste passa um coletor. */
  readonly escrever?: (linha: string) => void;
  /** Relógio. Injetável para o teste poder comparar a linha inteira. */
  readonly agora?: () => Date;
  /** Campos fixos em toda linha. */
  readonly contexto?: Campos;
}

/**
 * Nível vindo de ambiente, com padrão seguro.
 *
 * Não entra no schema de `config/ambiente.ts` de propósito: o registrador é usado
 * por script que roda antes de o ambiente ser validado, e ambiente inválido
 * precisa de log para ser diagnosticado.
 */
export function nivelDoAmbiente(bruto: string | undefined, padrao: Nivel = 'info'): Nivel {
  const valor = (bruto ?? '').trim().toLowerCase();
  return (NIVEIS as readonly string[]).includes(valor) ? (valor as Nivel) : padrao;
}

export function criarRegistrador(opcoes: OpcoesDoRegistrador = {}): Registrador {
  const nivelMinimo = opcoes.nivelMinimo ?? 'info';
  const escrever = opcoes.escrever ?? ((linha: string) => process.stdout.write(linha));
  const agora = opcoes.agora ?? (() => new Date());
  const contexto = opcoes.contexto ?? {};

  const emitir = (nivel: Nivel, evento: string, campos?: Campos): void => {
    if (ORDEM[nivel] < ORDEM[nivelMinimo]) return;

    const linha: Record<string, unknown> = {
      t: agora().toISOString(),
      nivel,
      evento,
    };
    for (const [chave, valor] of Object.entries({ ...contexto, ...campos })) {
      if (chave === 't' || chave === 'nivel' || chave === 'evento') continue;
      linha[chave] = ehCampoSensivel(chave) ? OCULTO : sanear(valor);
    }

    try {
      escrever(`${JSON.stringify(linha)}${quebraDeLinha()}`);
    } catch (erro) {
      // Última linha de defesa: `sanear` deveria ter resolvido tudo, e se não
      // resolveu, o registrador ainda não pode derrubar o laço do poller.
      const motivo = erro instanceof Error ? erro.message : String(erro);
      try {
        escrever(
          `${JSON.stringify({
            t: new Date().toISOString(),
            nivel: 'erro',
            evento: 'log.falhou_ao_serializar',
            eventoOriginal: evento,
            motivo: recortar(motivo),
          })}${quebraDeLinha()}`,
        );
      } catch {
        // Se nem isso escreve, o destino do log está quebrado. Perder a linha é
        // preferível a perder o processo.
      }
    }
  };

  return {
    debug: (evento, campos) => emitir('debug', evento, campos),
    info: (evento, campos) => emitir('info', evento, campos),
    aviso: (evento, campos) => emitir('aviso', evento, campos),
    erro: (evento, campos) => emitir('erro', evento, campos),
    com: (novos) =>
      criarRegistrador({
        nivelMinimo,
        escrever,
        agora,
        contexto: { ...contexto, ...novos },
      }),
  };
}

/** Registrador que descarta tudo. Para teste que não quer barulho. */
export const registradorSilencioso: Registrador = {
  debug: () => undefined,
  info: () => undefined,
  aviso: () => undefined,
  erro: () => undefined,
  com: () => registradorSilencioso,
};
