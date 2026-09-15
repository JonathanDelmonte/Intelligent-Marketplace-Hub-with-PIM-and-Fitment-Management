/**
 * Forma canônica e código de modelo (M3, etapa 5.2).
 *
 * A forma canônica é `tipo + marca + modelo normalizado`, e é ela — não o título
 * bruto — que gera o embedding. O motivo é direto: título de marketplace é escrito
 * para buscador, não para identificar produto. "Refil Filtro Purificador
 * Electrolux PA21G PA26G PE11B Original Pronta Entrega Frete Grátis" e "Elemento
 * Filtrante p/ purificador Electrolux PA21G" são o mesmo produto, e a similaridade
 * entre os dois títulos mede sobretudo quanta palavra-chave cada vendedor usou.
 *
 * **Tudo aqui é determinístico e auditável, por decisão do ADR 0005.** Parsing de
 * nomenclatura de modelo é o exemplo que o próprio ADR usa para dizer onde LLM
 * seria pior e mais caro: `PA21G`, `PA26G` e `PE11B` seguem gramática de
 * fabricante, e gramática se lê com código.
 */
import type { RegistroDeProduto } from './registro';

/**
 * Normaliza texto para comparação.
 *
 * Remove só o que não muda o produto: caixa, acento, pontuação e espaço repetido.
 * Não remove palavra nenhuma — filtrar "original" ou "kit" aqui apagaria
 * informação que às vezes é o produto inteiro ("kit" muda a quantidade, e
 * quantidade diferente é produto diferente).
 */
export function normalizarTexto(bruto: string): string {
  return bruto
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Sufixos de razão social que não fazem parte da marca.
 *
 * `Electrolux do Brasil S/A` e `Electrolux` são a mesma marca, e a diferença
 * aparece porque uma das fontes é nota fiscal e a outra é anúncio.
 */
const SUFIXOS_DE_RAZAO_SOCIAL: readonly string[] = [
  'ltda',
  'me',
  'epp',
  'eireli',
  'sa',
  's a',
  'as',
  'inc',
  'llc',
  'gmbh',
  'co',
  'cia',
  'industria e comercio',
  'comercio',
  'do brasil',
  'brasil',
];

/**
 * Normaliza marca.
 *
 * Não há tabela de sinônimos de marca, e não vai haver por palpite: afirmar que
 * duas grafias são a mesma marca é conhecimento sobre o mundo, e conhecimento sobre
 * o mundo entra por decisão humana registrada, não por lista escrita de memória
 * dentro de uma função pura.
 */
export function normalizarMarca(bruto: string): string {
  let texto = normalizarTexto(bruto);
  // Aparar em laço, porque "Acme Comercio Ltda" tem dois sufixos.
  let mudou = true;
  while (mudou) {
    mudou = false;
    for (const sufixo of SUFIXOS_DE_RAZAO_SOCIAL) {
      if (texto.endsWith(` ${sufixo}`)) {
        texto = texto.slice(0, -(sufixo.length + 1)).trim();
        mudou = true;
      }
    }
  }
  return texto;
}

/**
 * Unidades de medida, que fazem um token **não** ser código de modelo.
 *
 * `500ml`, `12v` e `3x` têm a mesma forma de um código de modelo — letra e dígito
 * no mesmo token — e não identificam nada. Sem esta lista, "Refil 500ml" e
 * "Mangueira 500ml" compartilhariam um "código de modelo".
 */
const UNIDADES: ReadonlySet<string> = new Set([
  'ml',
  'l',
  'lt',
  'lts',
  'litro',
  'litros',
  'g',
  'gr',
  'kg',
  'mg',
  'mm',
  'cm',
  'm',
  'km',
  'pol',
  'v',
  'vt',
  'w',
  'kw',
  'cv',
  'hp',
  'a',
  'ma',
  'ah',
  'mah',
  'hz',
  'khz',
  'mhz',
  'un',
  'und',
  'unid',
  'pc',
  'pcs',
  'pe',
  'pcas',
  'x',
  'p',
  'rpm',
  'bar',
  'psi',
  'btu',
  'mpa',
  'nm',
  'ohm',
  'bwg',
  'awg',
]);

const MIN_CODIGO = 3;
const MAX_CODIGO = 24;

/**
 * O token parece um código de modelo de fabricante?
 *
 * Os critérios, e a razão de cada um:
 *
 * - **letra e dígito no mesmo token**: é o que distingue `PA21G` de `purificador`
 *   e de `2024`.
 * - **3 a 24 caracteres**: `A3` é curto o bastante para aparecer por acidente em
 *   qualquer texto, e nada acima de 24 é código.
 * - **não é medida**: `500ml` e `12v` têm a forma e não são identificador.
 * - **não é ano isolado nem preço**: `r$ 89,90` já perdeu a pontuação na
 *   normalização e chegaria como `8990`, que não tem letra e cai no primeiro
 *   critério.
 */
export function ehCodigoDeModelo(token: string): boolean {
  const limpo = token.replace(/[^a-z0-9]/gi, '').toUpperCase();
  if (limpo.length < MIN_CODIGO || limpo.length > MAX_CODIGO) return false;
  if (!/[A-Z]/.test(limpo) || !/[0-9]/.test(limpo)) return false;

  // Medida é **dígito seguido de unidade**, nessa ordem: `500ml`, `12v`, `3x`.
  //
  // A ordem inversa não vale, e a razão custou um teste: `W10295370` é o número de
  // peça de uma Whirlpool, e `W` é o símbolo de watt. Recusar `letra + dígito` por
  // coincidir com unidade jogaria fora justamente os códigos de fabricante que este
  // módulo existe para reconhecer — e são muitos, porque prefixo de uma letra é o
  // padrão de várias marcas de linha branca.
  const comoMedida = /^(\d+)([A-Z]+)$/.exec(limpo);
  if (comoMedida !== null && UNIDADES.has((comoMedida[2] ?? '').toLowerCase())) return false;

  // Nenhuma corrida de letras longa. É o que separa `EF-ELX-21` de
  // `purificador-PA21G`: os dois têm letra e dígito e caberiam no tamanho, e só o
  // segundo tem uma palavra dentro. O limite é 5 e é uma escolha consciente —
  // `TURBO500` passa, `FILTRO21` não. O custo de errar para o lado permissivo é
  // agrupar produtos diferentes, que é o dano que não se desfaz sozinho.
  const corridaDeLetras = /[A-Z]{6,}/.test(limpo);
  if (corridaDeLetras) return false;

  return true;
}

/**
 * Normaliza um código de modelo para comparação.
 *
 * `pa-21-g`, `PA 21 G` e `PA21G` são o mesmo código escrito por três fontes
 * diferentes, e a comparação tem que enxergar isso. Devolve `null` quando o texto
 * não é um código, para o chamador não guardar `"REFILORIGINAL"` como modelo.
 */
export function normalizarCodigoDeModelo(bruto: string): string | null {
  const limpo = bruto.replace(/[^a-z0-9]/gi, '').toUpperCase();
  return ehCodigoDeModelo(limpo) ? limpo : null;
}

const MAX_FRAGMENTO = 4;

/**
 * Palavras curtas do português que **não** são fragmento de código.
 *
 * Todas cabem no limite de quatro caracteres e alternam classe com um número vizinho,
 * então sem esta lista elas entram em junção: `110 ou 220` produz `110OU220`, e `de 21
 * cm` produz `DE21`. A lista é curta de propósito — palavra que aparece entre números
 * numa pergunta de comprador, e nada mais.
 */
const PALAVRAS_QUE_NAO_SAO_FRAGMENTO = new Set([
  'a',
  'ao',
  'as',
  'com',
  'da',
  'das',
  'de',
  'do',
  'dos',
  'e',
  'em',
  'na',
  'nas',
  'no',
  'nos',
  'ou',
  'os',
  'por',
  'pra',
  'sem',
  'um',
  'uma',
]);

/**
 * A sequência de tokens tem a forma de um código partido por espaço?
 *
 * Sem esta guarda, juntar tokens vizinhos produz código onde não há nenhum, e o
 * teste pegou os dois casos: `Refil PA 21` virava `REFILPA21`, e `R$ 89,90` virava
 * `R89`. As regras, cada uma atrás de um desses:
 *
 * - **Cada fragmento é só letra ou só dígito, e curto** (≤ 4). `Refil` tem cinco
 *   letras e não é fragmento de código; `PA`, `21` e `G` são.
 * - **Classe alterna.** `por R 89` tem duas palavras seguidas, então não é código.
 * - **O primeiro fragmento tem 2 caracteres ou mais.** É o que recusa `R 89`, que
 *   é o que sobra de `R$ 89,90` depois da pontuação.
 * - **Nenhum fragmento é palavra comum do português.** Foi o terceiro caso, e ele
 *   veio de pergunta de comprador: `é 110 ou 220?` virava o código `110OU220`, e a
 *   resposta automática tratava uma dúvida de voltagem como pergunta sobre um modelo
 *   inexistente. `PA 21 G` não tem palavra no meio; `110 ou 220` tem.
 */
function ehCodigoPartido(janela: readonly string[]): boolean {
  const primeiro = janela[0] ?? '';
  if (primeiro.length < 2) return false;

  let classeAnterior: 'letra' | 'digito' | null = null;
  for (const fragmento of janela) {
    if (fragmento.length > MAX_FRAGMENTO) return false;
    if (PALAVRAS_QUE_NAO_SAO_FRAGMENTO.has(fragmento.toLowerCase())) return false;
    const classe = /^[a-z]+$/i.test(fragmento)
      ? 'letra'
      : /^\d+$/.test(fragmento)
        ? 'digito'
        : null;
    if (classe === null || classe === classeAnterior) return false;
    classeAnterior = classe;
  }
  return true;
}

/**
 * Todos os códigos de modelo de um texto livre, na ordem em que aparecem.
 *
 * Considera também a junção de tokens vizinhos, porque `PA 21 G` chega separado por
 * espaço em metade das fontes. A junção é tentada em janelas de até três tokens,
 * e só é aceita quando o resultado é um código válido e os tokens sozinhos não são.
 */
export function codigosDeModelo(texto: string): readonly string[] {
  // `-`, `.` e `_` ficam **dentro** do token, porque código de fabricante os usa
  // como parte do nome: `EF-ELX-21`, `DA29-00020B`. Barra, vírgula e parêntese
  // separam, porque `PA21G/PA26G` são dois códigos e não um de dez caracteres.
  const tokens = texto
    .replace(/[^a-z0-9\-._]+/gi, ' ')
    .split(' ')
    .filter((t) => t !== '');
  const achados: string[] = [];
  const vistos = new Set<string>();

  const registrar = (codigo: string): void => {
    if (vistos.has(codigo)) return;
    vistos.add(codigo);
    achados.push(codigo);
  };

  for (let i = 0; i < tokens.length; i += 1) {
    const isolado = normalizarCodigoDeModelo(tokens[i] ?? '');
    if (isolado !== null) {
      registrar(isolado);
      continue;
    }
    // `PA 21 G`: o mesmo código, partido por espaço, que é como metade das fontes
    // escreve. Da janela **maior** para a menor, senão `PA 21 G` viraria `PA21` e o
    // sufixo — que é a variação de cor ou voltagem — se perderia.
    for (let tamanho = 3; tamanho >= 2; tamanho -= 1) {
      if (i + tamanho > tokens.length) continue;
      const janela = tokens.slice(i, i + tamanho);
      // Token que já é código sozinho não entra em junção: `PA21G PE11B` são dois.
      if (janela.some((t) => normalizarCodigoDeModelo(t) !== null)) break;
      if (!ehCodigoPartido(janela)) continue;
      const junto = normalizarCodigoDeModelo(janela.join(''));
      if (junto !== null) {
        registrar(junto);
        i += tamanho - 1;
        break;
      }
    }
  }

  return achados;
}

/**
 * A forma canônica que gera o embedding: `tipo + marca + modelo normalizado`.
 *
 * Devolve `''` quando o registro não tem nenhum dos três — e `''` é uma resposta
 * honesta, que o chamador precisa tratar: gerar embedding de string vazia custaria
 * token para produzir um vetor que é vizinho de todos os outros vetores vazios.
 */
export function formaCanonica(registro: RegistroDeProduto): string {
  const partes: string[] = [];

  if (registro.tipoProduto !== null) {
    const tipo = normalizarTexto(registro.tipoProduto);
    if (tipo !== '') partes.push(tipo);
  }
  if (registro.marca !== null) {
    const marca = normalizarMarca(registro.marca);
    if (marca !== '') partes.push(marca);
  }
  if (registro.modeloPeca !== null) {
    const codigo = normalizarCodigoDeModelo(registro.modeloPeca);
    partes.push(codigo !== null ? codigo.toLowerCase() : normalizarTexto(registro.modeloPeca));
  }

  return partes.filter((p) => p !== '').join(' ');
}

/**
 * Chave determinística de agrupamento: `marca|modelo`.
 *
 * `null` quando falta marca **ou** modelo, e essa é a parte que importa. Com
 * `''` no lugar de `null`, todo registro sem marca teria a mesma chave de todo
 * outro registro sem marca, e o casamento determinístico fundiria a base inteira
 * em um SKU só. Já aconteceu em sistema de gente grande; o tipo evita aqui.
 */
export function chaveDeAgrupamento(registro: RegistroDeProduto): string | null {
  if (registro.marca === null || registro.modeloPeca === null) return null;

  const marca = normalizarMarca(registro.marca);
  const modelo =
    normalizarCodigoDeModelo(registro.modeloPeca) ?? normalizarTexto(registro.modeloPeca);
  if (marca === '' || modelo === '') return null;

  return `${marca}|${modelo.toLowerCase()}`;
}

/**
 * Códigos que servem de pista de identidade em um registro.
 *
 * Reúne o modelo da peça e os modelos compatíveis declarados. Serve para **gerar
 * candidato**, não para decidir: compartilhar um código de aparelho compatível diz
 * que os dois podem ser a mesma peça, não que são.
 */
export function codigosDoRegistro(registro: RegistroDeProduto): readonly string[] {
  const fonte = [registro.modeloPeca ?? '', ...registro.modelosCompativeis].join(' ');
  return codigosDeModelo(fonte);
}
