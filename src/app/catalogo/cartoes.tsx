/**
 * As peças dos cartões de número, iguais na lista e no produto.
 *
 * Sem estado e sem diretiva: servem ao painel da lista e ao do produto, que rodam no
 * navegador, e a qualquer peça de servidor que um dia precise delas.
 */
import type { ReactNode } from 'react';
import { PLATAFORMAS, type Plataforma } from '@/dominio/precificacao/tipos';
import { centavos } from '@/lib/dinheiro';
import { IDENTIDADE_DA_LOJA } from '../lojas/identidade';
import { Selo } from '../lojas/selo';
import { ROTULO_DA_PLATAFORMA } from '../ui/rotulos';
import estilo from './catalogo.module.css';
import { percentual, reaisCurtos, type Meta } from './conta';

/** O alto de um cartão: o ícone num quadrado e o nome do número. */
export function TopoDoCartao({
  icone,
  rotulo,
  escuro = false,
}: {
  readonly icone: ReactNode;
  readonly rotulo: string;
  readonly escuro?: boolean;
}) {
  return (
    <header className={estilo.topoDoNumero}>
      <span className={escuro ? estilo.iconeEscuro : estilo.icone}>{icone}</span>
      <h2 className={escuro ? estilo.rotuloEscuro : estilo.rotuloDoNumero}>{rotulo}</h2>
    </header>
  );
}

/**
 * A régua do cartão escuro: o que se ganha, até a meta.
 *
 * A barra enche até o valor de verdade, e um traço marca a meta. A escala vai até uma
 * vez e meia a meta, para a meta nunca ficar colada na ponta e passar dela ser visível.
 *
 * `valor` está na unidade da meta: pontos-base, quando a meta é percentual; centavos,
 * quando é em reais.
 */
export function ReguaDaMeta({
  valor,
  meta,
}: {
  readonly valor: number | null;
  readonly meta: Meta;
}) {
  const alvo = meta.tipo === 'percentual' ? meta.bp : meta.centavos;
  const escala = Math.max(alvo * 1.5, (valor ?? 0) * 1.1, 1);
  const cheio = valor === null ? 0 : Math.min(1, Math.max(0, valor / escala));
  const marca = Math.min(1, alvo / escala);
  const chegou = valor !== null && valor >= alvo;
  return (
    <div className={estilo.reguaEscura}>
      <span aria-hidden="true" className={estilo.trilhoEscuro}>
        <span
          className={chegou ? estilo.cheioEscuroNaMeta : estilo.cheioEscuro}
          style={{ width: `${String(cheio * 100)}%` }}
        />
        <span className={estilo.marcaDaMeta} style={{ left: `${String(marca * 100)}%` }} />
      </span>
      <span className={estilo.legendaEscura}>
        <span>
          {valor === null ? 'Sem conta ainda' : chegou ? 'Chegou na meta' : 'Abaixo da meta'}
        </span>
        <span>
          Meta{' '}
          {meta.tipo === 'percentual' ? percentual(meta.bp) : reaisCurtos(centavos(meta.centavos))}
        </span>
      </span>
    </div>
  );
}

/** Quanto cada loja vendeu, em barras na cor dela, com o número na ponta. */
export function VendasPorLoja({
  unidades,
  destaque,
}: {
  readonly unidades: Readonly<Record<Plataforma, number>>;
  /** A loja escolhida na tela, que ganha o nome em negrito. */
  readonly destaque?: Plataforma;
}) {
  const maior = Math.max(1, ...PLATAFORMAS.map((p) => unidades[p]));
  return (
    <ul className={estilo.lojasDoNumero}>
      {PLATAFORMAS.map((plataforma) => {
        const identidade = IDENTIDADE_DA_LOJA[plataforma];
        return (
          <li className={estilo.lojaDoNumero} key={plataforma}>
            <Selo identidade={identidade} tamanho={14} />
            <span
              className={
                plataforma === destaque ? estilo.lojaDoNumeroNomeForte : estilo.lojaDoNumeroNome
              }
            >
              {ROTULO_DA_PLATAFORMA[plataforma]}
            </span>
            <span aria-hidden="true" className={estilo.trilhoDaLoja}>
              <span
                className={estilo.barraDaLoja}
                style={{
                  background: identidade.fundo,
                  width: `${String((unidades[plataforma] / maior) * 100)}%`,
                }}
              />
            </span>
            <span className={estilo.lojaDoNumeroValor}>{unidades[plataforma]}</span>
          </li>
        );
      })}
    </ul>
  );
}
