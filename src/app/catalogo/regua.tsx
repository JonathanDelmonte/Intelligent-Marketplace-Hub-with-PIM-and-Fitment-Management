/**
 * A régua do dinheiro: o preço de uma venda partido no que fica com você e no que sai.
 *
 * Uma barra só, e só uma parte com cor: a que fica com você, encostada no começo. O resto
 * é cinza em três tons, porque o que a pessoa precisa ver de relance é quanto da barra é
 * dela, e não distinguir imposto de embalagem (isso o cupom logo abaixo diz, linha por
 * linha, e é a legenda da régua). Com prejuízo, a barra são os custos, e o trecho que
 * passa do preço aparece riscado em vermelho.
 */
import { formatarBRL } from '@/lib/dinheiro';
import estilo from './catalogo.module.css';
import { ROTULO_DA_PARTE, type ChaveDaParte, type Regua } from './conta';

/** A cor de cada parte, para a régua e para a amostra ao lado de cada linha do cupom. */
export const COR_DA_PARTE: Readonly<Record<ChaveDaParte, string>> = {
  fica: estilo.parteFica,
  produto: estilo.parteProduto,
  loja: estilo.parteLoja,
  resto: estilo.parteResto,
};

export function ReguaDoDinheiro({ regua }: { readonly regua: Regua }) {
  if (regua.partes.length === 0) return null;

  const descricao = [
    ...regua.partes.map((p) => `${ROTULO_DA_PARTE[p.chave]}: ${formatarBRL(p.valor)}`),
    ...(regua.perde > 0 ? [`você perde ${formatarBRL(regua.perde)}`] : []),
  ].join('; ');

  return (
    <div aria-label={descricao} className={estilo.regua} role="img">
      {regua.partes.map((parte) => (
        <span
          className={`${estilo.reguaParte} ${COR_DA_PARTE[parte.chave]}`}
          key={parte.chave}
          style={{ flexGrow: parte.fracao }}
          title={`${ROTULO_DA_PARTE[parte.chave]}: ${formatarBRL(parte.valor)}`}
        />
      ))}
      {regua.perde > 0 ? (
        <span
          className={estilo.reguaPerde}
          style={{ left: `${String(regua.fimDoPreco * 100)}%` }}
          title={`Você perde ${formatarBRL(regua.perde)}`}
        />
      ) : null}
    </div>
  );
}
