/**
 * Cadastrar produto: uma tela só para isso.
 *
 * Morava no pé da lista, depois da tabela, e cadastrar era rolar até o fim. Com tela
 * própria, o botão do alto da lista leva direto a ela, e a pessoa faz uma coisa por vez.
 *
 * Quando o pedido vem de outra tela (o "Publicar em" do garimpo), o nome chega
 * preenchido. Se já existe produto com esse nome, a tela leva a ele em vez de deixar
 * cadastrar de novo.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { lerAmbiente } from '@/config/ambiente';
import { RepositorioDeSku, type SkuGravado } from '@/dominio/catalogo/sku';
import { carregarPerfil } from '@/dominio/perfil';
import { banco } from '@/infra/banco/cliente';
import { naLoja } from '../../ui/rotulos';
import { caminhoDoProduto, descreverAviso, lerProdutoNovo } from '../apresentacao';
import estilo from '../catalogo.module.css';
import { AvisoDaAcao, FormularioDeProduto, Voltar } from '../componentes';

export const metadata: Metadata = { title: 'Cadastrar produto' };

export const dynamic = 'force-dynamic';

export default async function PaginaDoCadastro({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const parametros = await searchParams;
  const pedido = lerProdutoNovo(parametros);
  const codigo = Array.isArray(parametros['r']) ? parametros['r'][0] : parametros['r'];
  const aviso = descreverAviso(codigo);

  let jaExiste: SkuGravado | null = null;
  if (pedido !== null) {
    const db = banco();
    const perfil = await carregarPerfil(db, lerAmbiente().BANCADA_PERFIL_PADRAO);
    jaExiste = await new RepositorioDeSku(db).buscarPorTitulo(perfil.id, pedido.titulo);
  }

  return (
    <main className={estilo.pagina}>
      <Voltar />
      <header className={estilo.cabecalhoDoProduto}>
        <h1 className={estilo.titulo}>Cadastrar produto</h1>
        <p className={estilo.subtitulo}>
          {pedido === null
            ? 'Um por vez. Depois você diz quanto paga, e a tabela mostra quanto cobrar.'
            : `Veio do garimpo${pedido.plataforma === undefined ? '' : `, para vender ${naLoja(pedido.plataforma)}`}. Confira o nome: ele não muda depois.`}
        </p>
      </header>

      {aviso === null ? null : <AvisoDaAcao aviso={aviso} />}

      {jaExiste === null ? null : (
        <p className={estilo.jaExiste} role="status">
          Já existe um produto com esse nome:{' '}
          <Link
            className={estilo.link}
            href={caminhoDoProduto(jaExiste.id, {
              ...(pedido?.plataforma === undefined ? {} : { plataforma: pedido.plataforma }),
              ancora: 'preco-titulo',
            })}
          >
            {jaExiste.tituloInterno}
          </Link>
          . Abra ele, em vez de cadastrar de novo.
        </p>
      )}

      <div className={estilo.folhaDoCadastro}>
        <FormularioDeProduto plataforma={pedido?.plataforma} tituloInicial={pedido?.titulo ?? ''} />
      </div>
    </main>
  );
}
