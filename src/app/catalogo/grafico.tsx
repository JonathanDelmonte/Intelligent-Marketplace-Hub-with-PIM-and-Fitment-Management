'use client';

/**
 * Quanto se ganha em cada preço: a curva do simulador, que também escolhe o preço.
 *
 * O eixo de baixo é o preço, o da esquerda é o que sobra por venda. Acima da linha do
 * zero a curva é verde, e abaixo é vermelha: a criança da regra do dono lê "verde ganha,
 * vermelho perde" sem legenda. Os degraus de taxa e de frete aparecem como queda de
 * verdade, que é o que nenhuma tabela mostra: o ponto em que subir o preço faz ganhar
 * menos.
 *
 * O gráfico é um controle, e não só uma figura: clicar ou arrastar escolhe o preço, e as
 * setas do teclado andam de dez em dez centavos (com Shift, de real em real). Passar o
 * mouse mostra a conta de qualquer ponto sem mudar nada.
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { PontoDaCurva } from '@/dominio/precificacao/simulador';
import { centavos, formatarBRL, type Centavos } from '@/lib/dinheiro';
import estilo from './catalogo.module.css';
import { reaisCurtos, type FaixaDoGrafico } from './conta';

const ALTURA = 256;
const MARGEM = { esquerda: 64, direita: 20, topo: 40, base: 30 } as const;
/** Largura antes de medir a caixa: a do cartão do simulador no computador. */
const LARGURA_INICIAL = 720;

/**
 * Passo "redondo" de marcação (1, 2, 2,5 ou 5 vezes uma potência de dez), em centavos: o
 * que dá o número de marcas mais perto do pedido. Arredondar sempre para cima dobrava o
 * passo quando a conta passava um fio da potência, e o eixo ficava com duas marcas.
 */
function passoRedondo(amplitude: number, quantas: number): number {
  const bruto = Math.max(amplitude / quantas, 1);
  const potencia = 10 ** Math.floor(Math.log10(bruto));
  const candidatos = [0.5, 1, 2, 2.5, 5, 10]
    .map((fator) => fator * potencia)
    .filter((passo) => passo >= 1);
  return candidatos.reduce((melhor, passo) =>
    Math.abs(amplitude / passo - quantas) < Math.abs(amplitude / melhor - quantas) ? passo : melhor,
  );
}

function marcas(de: number, ate: number, quantas: number): readonly number[] {
  const passo = passoRedondo(ate - de, quantas);
  const lista: number[] = [];
  for (let valor = Math.ceil(de / passo) * passo; valor <= ate; valor += passo) {
    lista.push(Math.round(valor));
  }
  return lista;
}

/** Reais curtos, com o sinal de menos tipográfico: "R$ 10", "−R$ 5". */
function rotuloDeReais(valor: number): string {
  const texto = reaisCurtos(centavos(Math.abs(valor)));
  return valor < 0 ? `−${texto}` : texto;
}

export interface ContaDoPonto {
  readonly margemReais: Centavos;
  readonly margemPontosBase: number;
}

export function GraficoDeLucro({
  pontos,
  faixa,
  preco,
  precoDaMeta,
  empate,
  contaEm,
  aoEscolher,
}: {
  readonly pontos: readonly PontoDaCurva[];
  readonly faixa: FaixaDoGrafico;
  /** O preço escolhido. `null` enquanto o campo não tem um preço que se leia. */
  readonly preco: Centavos | null;
  readonly precoDaMeta: Centavos | null;
  readonly empate: Centavos | null;
  /** A conta exata de um preço: a curva é amostrada, a dica e a alça não. */
  readonly contaEm: (preco: Centavos) => ContaDoPonto | null;
  readonly aoEscolher: (preco: Centavos) => void;
}) {
  const caixa = useRef<HTMLDivElement>(null);
  const prefixo = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const [largura, setLargura] = useState(LARGURA_INICIAL);
  const [arrastando, setArrastando] = useState(false);
  const [sobre, setSobre] = useState<Centavos | null>(null);

  useEffect(() => {
    const elemento = caixa.current;
    if (elemento === null) return;
    const observador = new ResizeObserver(([entrada]) => {
      if (entrada !== undefined) setLargura(Math.max(320, Math.round(entrada.contentRect.width)));
    });
    observador.observe(elemento);
    return () => observador.disconnect();
  }, []);

  const primeiro = pontos[0];
  const ultimo = pontos.at(-1);
  // A caixa existe mesmo sem curva: é nela que a largura é medida, desde a primeira vez.
  if (primeiro === undefined || ultimo === undefined) {
    return <div className={estilo.grafico} ref={caixa} />;
  }

  const { de, ate } = faixa;
  const larguraUtil = largura - MARGEM.esquerda - MARGEM.direita;
  const alturaUtil = ALTURA - MARGEM.topo - MARGEM.base;

  const valores = pontos.map((p) => p.margemReais);
  const menorBruto = Math.min(0, ...valores);
  const maiorBruto = Math.max(0, ...valores);
  const folga = Math.max((maiorBruto - menorBruto) * 0.12, 100);
  const menor = menorBruto < 0 ? menorBruto - folga : 0;
  const maior = maiorBruto + folga;

  const x = (valor: number): number => MARGEM.esquerda + ((valor - de) / (ate - de)) * larguraUtil;
  const y = (valor: number): number =>
    MARGEM.topo + ((maior - valor) / (maior - menor)) * alturaUtil;
  const zeroY = y(0);

  const linha = pontos
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.preco).toFixed(1)} ${y(p.margemReais).toFixed(1)}`)
    .join(' ');
  const area = `${linha} L${x(ultimo.preco).toFixed(1)} ${zeroY.toFixed(1)} L${x(primeiro.preco).toFixed(1)} ${zeroY.toFixed(1)} Z`;

  const marcasY = marcas(menor, maior, 5);
  const marcasX = marcas(de, ate, Math.max(4, Math.floor(larguraUtil / 90)));

  const precoDoPonteiro = (evento: PointerEvent<SVGSVGElement>): Centavos => {
    const retangulo = evento.currentTarget.getBoundingClientRect();
    const naCaixa = ((evento.clientX - retangulo.left) / retangulo.width) * largura;
    const fracao = Math.min(1, Math.max(0, (naCaixa - MARGEM.esquerda) / larguraUtil));
    // De dez em dez centavos: arrastar escolhe preço de etiqueta, e não R$ 41,37.
    return centavos(Math.round((de + fracao * (ate - de)) / 10) * 10);
  };

  const aoApertar = (evento: PointerEvent<SVGSVGElement>) => {
    evento.currentTarget.setPointerCapture(evento.pointerId);
    setArrastando(true);
    aoEscolher(precoDoPonteiro(evento));
  };

  const aoMover = (evento: PointerEvent<SVGSVGElement>) => {
    const agora = precoDoPonteiro(evento);
    if (arrastando) aoEscolher(agora);
    else setSobre(agora);
  };

  const aoSoltar = (evento: PointerEvent<SVGSVGElement>) => {
    if (evento.currentTarget.hasPointerCapture(evento.pointerId)) {
      evento.currentTarget.releasePointerCapture(evento.pointerId);
    }
    setArrastando(false);
  };

  const aoTeclar = (evento: KeyboardEvent<SVGSVGElement>) => {
    const atual = preco ?? precoDaMeta ?? de;
    const passo = evento.shiftKey || evento.key.startsWith('Page') ? 100 : 10;
    const destino: Record<string, number> = {
      ArrowRight: atual + passo,
      ArrowUp: atual + passo,
      PageUp: atual + passo,
      ArrowLeft: atual - passo,
      ArrowDown: atual - passo,
      PageDown: atual - passo,
      Home: de,
      End: ate,
    };
    const novo = destino[evento.key];
    if (novo === undefined) return;
    evento.preventDefault();
    aoEscolher(centavos(Math.min(ate, Math.max(de, Math.round(novo)))));
  };

  const contaDoPreco = preco === null ? null : contaEm(preco);
  const dentro = (valor: number | null): valor is number =>
    valor !== null && valor >= de && valor <= ate;

  // A alça: a linha do preço escolhido, o ponto na curva, e o preço numa etiqueta escura
  // em cima, fora da área do desenho, para nunca cobrir a curva.
  const alca =
    preco !== null && dentro(preco) && contaDoPreco !== null
      ? {
          x: x(preco),
          y: y(Math.min(maior, Math.max(menor, contaDoPreco.margemReais))),
          texto: formatarBRL(preco),
        }
      : null;
  const larguraDaEtiqueta = alca === null ? 0 : alca.texto.length * 7.2 + 18;
  const etiquetaX =
    alca === null
      ? 0
      : Math.min(
          largura - MARGEM.direita - larguraDaEtiqueta,
          Math.max(MARGEM.esquerda, alca.x - larguraDaEtiqueta / 2),
        );

  const dica = sobre === null || arrastando ? null : contaEm(sobre);
  const dicaX = sobre === null ? 0 : x(sobre);
  const dicaY = dica === null ? 0 : y(Math.min(maior, Math.max(menor, dica.margemReais)));
  // A dica fica dentro da área do desenho, abaixo da etiqueta do preço, e vira para a
  // esquerda perto da borda da direita.
  const dicaEsquerda = dicaX > largura - 190;
  const dicaTopo = Math.min(ALTURA - MARGEM.base - 72, Math.max(MARGEM.topo, dicaY - 80));

  const descricao =
    contaDoPreco === null || preco === null
      ? 'Escolha um preço'
      : `${formatarBRL(preco)}: você ${contaDoPreco.margemReais < 0 ? 'perde' : 'ganha'} ${formatarBRL(centavos(Math.abs(contaDoPreco.margemReais)))} por venda`;

  return (
    <div className={estilo.grafico} ref={caixa}>
      <svg
        aria-label="Preço de venda, no gráfico de quanto você ganha em cada preço"
        aria-valuemax={ate / 100}
        aria-valuemin={de / 100}
        aria-valuenow={preco === null ? undefined : preco / 100}
        aria-valuetext={descricao}
        className={arrastando ? estilo.graficoArrastando : estilo.graficoDesenho}
        height={ALTURA}
        onKeyDown={aoTeclar}
        onPointerDown={aoApertar}
        onPointerLeave={() => setSobre(null)}
        onPointerMove={aoMover}
        onPointerUp={aoSoltar}
        role="slider"
        tabIndex={0}
        viewBox={`0 0 ${String(largura)} ${String(ALTURA)}`}
        width={largura}
      >
        <defs>
          <clipPath id={`${prefixo}-acima`}>
            <rect height={Math.max(0, zeroY)} width={largura} x={0} y={0} />
          </clipPath>
          <clipPath id={`${prefixo}-abaixo`}>
            <rect height={Math.max(0, ALTURA - zeroY)} width={largura} x={0} y={zeroY} />
          </clipPath>
        </defs>

        {marcasY.map((valor) => (
          <g key={`y${String(valor)}`}>
            {valor === 0 ? null : (
              <line
                className={estilo.graficoGrade}
                x1={MARGEM.esquerda}
                x2={largura - MARGEM.direita}
                y1={y(valor)}
                y2={y(valor)}
              />
            )}
            <text
              className={estilo.graficoRotulo}
              dominantBaseline="middle"
              textAnchor="end"
              x={MARGEM.esquerda - 12}
              y={y(valor)}
            >
              {rotuloDeReais(valor)}
            </text>
          </g>
        ))}
        {marcasX.map((valor) => (
          <text
            className={estilo.graficoRotulo}
            key={`x${String(valor)}`}
            textAnchor="middle"
            x={x(valor)}
            y={ALTURA - 8}
          >
            {reaisCurtos(centavos(valor))}
          </text>
        ))}

        <path className={estilo.graficoAreaGanha} clipPath={`url(#${prefixo}-acima)`} d={area} />
        <path className={estilo.graficoAreaPerde} clipPath={`url(#${prefixo}-abaixo)`} d={area} />
        <line
          className={estilo.graficoZero}
          x1={MARGEM.esquerda}
          x2={largura - MARGEM.direita}
          y1={zeroY}
          y2={zeroY}
        />
        <path className={estilo.graficoLinhaGanha} clipPath={`url(#${prefixo}-acima)`} d={linha} />
        <path className={estilo.graficoLinhaPerde} clipPath={`url(#${prefixo}-abaixo)`} d={linha} />

        {dentro(empate) ? (
          <g>
            <circle className={estilo.graficoEmpate} cx={x(empate)} cy={zeroY} r={4.5} />
            <text
              className={estilo.graficoNota}
              textAnchor={x(empate) > largura - 180 ? 'end' : 'start'}
              x={x(empate) > largura - 180 ? x(empate) - 10 : x(empate) + 10}
              y={zeroY + 16}
            >
              empata em {formatarBRL(empate)}
            </text>
          </g>
        ) : null}

        {dentro(precoDaMeta) ? (
          <g>
            <line
              className={estilo.graficoMeta}
              x1={x(precoDaMeta)}
              x2={x(precoDaMeta)}
              y1={MARGEM.topo}
              y2={ALTURA - MARGEM.base}
            />
            <text
              className={estilo.graficoNota}
              textAnchor="end"
              x={x(precoDaMeta) - 8}
              y={MARGEM.topo + 12}
            >
              preço da meta
            </text>
          </g>
        ) : null}

        {dica === null ? null : (
          <g>
            <line
              className={estilo.graficoMira}
              x1={dicaX}
              x2={dicaX}
              y1={MARGEM.topo}
              y2={ALTURA - MARGEM.base}
            />
            <circle className={estilo.graficoMiraPonto} cx={dicaX} cy={dicaY} r={4} />
          </g>
        )}

        {alca === null ? null : (
          <g>
            <line
              className={estilo.graficoAlcaLinha}
              x1={alca.x}
              x2={alca.x}
              y1={MARGEM.topo - 8}
              y2={ALTURA - MARGEM.base}
            />
            <circle className={estilo.graficoAlcaPonto} cx={alca.x} cy={alca.y} r={7} />
            <rect
              className={estilo.graficoEtiqueta}
              height={24}
              rx={3}
              width={larguraDaEtiqueta}
              x={etiquetaX}
              y={MARGEM.topo - 34}
            />
            <text
              className={estilo.graficoEtiquetaTexto}
              dominantBaseline="middle"
              textAnchor="middle"
              x={etiquetaX + larguraDaEtiqueta / 2}
              y={MARGEM.topo - 22}
            >
              {alca.texto}
            </text>
          </g>
        )}
      </svg>

      {dica === null || sobre === null ? null : (
        <div
          aria-hidden="true"
          className={estilo.graficoDica}
          style={{
            left: `${String(dicaX + (dicaEsquerda ? -14 : 14))}px`,
            top: `${String(dicaTopo)}px`,
            transform: dicaEsquerda ? 'translateX(-100%)' : undefined,
          }}
        >
          <span className={estilo.graficoDicaPreco}>A {formatarBRL(sobre)}</span>
          <span
            className={dica.margemReais < 0 ? estilo.graficoDicaPerde : estilo.graficoDicaGanha}
          >
            {dica.margemReais < 0 ? 'você perde ' : 'você ganha '}
            {formatarBRL(centavos(Math.abs(dica.margemReais)))}
          </span>
          <span className={estilo.graficoDicaNota}>
            {(dica.margemPontosBase / 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%
            do preço
          </span>
        </div>
      )}
    </div>
  );
}
