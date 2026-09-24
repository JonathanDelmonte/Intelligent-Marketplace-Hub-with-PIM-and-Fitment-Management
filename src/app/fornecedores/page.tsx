/**
 * Tela de fornecedores — as cinco perguntas que eliminam 90% dos candidatos.
 *
 * O que esta tela existe para não deixar acontecer: perder três semanas negociando
 * com um fornecedor que vende na mesma vitrine. A especificação é explícita sobre
 * isso ser o erro que custou a primeira tentativa no Mercado Livre, e pede que o
 * sistema lembre disso pelo operador.
 *
 * O veredito **não é gravado**: é recalculado a cada carregamento a partir das
 * cinco respostas. Então mudar o critério de prazo vale para o cadastro antigo, em
 * vez de deixar a base com dois vereditos conforme a data.
 */
import type { Metadata } from 'next';
import { lerAmbiente } from '@/config/ambiente';
import { RepositorioDeFornecedores } from '@/dominio/fornecedores/repositorio';
import { carregarPerfil } from '@/dominio/perfil';
import { banco } from '@/infra/banco/cliente';
import { descreverAviso, estadoDaBase } from './apresentacao';
import { AvisoDaAcao, FormularioDeCadastro, Lista, Painel } from './componentes';
import { LIMITE_DA_LISTA } from './constantes';
import estilo from './fornecedores.module.css';

export const metadata: Metadata = { title: 'Fornecedores' };

/** Sempre dinâmica: pré-renderizar exigiria banco durante o `build`. */
export const dynamic = 'force-dynamic';

export default async function PaginaDeFornecedores({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const parametros = await searchParams;
  const db = banco();
  const repo = new RepositorioDeFornecedores(db);

  const perfil = await carregarPerfil(db, lerAmbiente().BANCADA_PERFIL_PADRAO);
  const [fornecedores, contagem, confiabilidades] = await Promise.all([
    repo.listar(LIMITE_DA_LISTA),
    repo.contarPorVeredito(),
    // Medida nos pedidos deste perfil: fornecedor é compartilhado, pedido não.
    repo.confiabilidades(perfil.id, new Date()),
  ]);

  const codigo = Array.isArray(parametros['r']) ? parametros['r'][0] : parametros['r'];
  const aviso = descreverAviso(codigo);
  const diagnostico = estadoDaBase(contagem);

  // Quem fala na mensagem de contato é o **vendedor**, e o nome dele é dado:
  // vem de `perfil_vendedor`, não de literal no componente e nem do nome do
  // sistema (ADR 0003). A ferramenta não se apresenta ao fornecedor.
  const vendedor = perfil.nome;

  return (
    <main className={estilo.pagina}>
      <header className={estilo.cabecalho}>
        <h1 className={estilo.titulo}>Fornecedores</h1>
        <p className={estilo.subtitulo}>
          Cinco perguntas eliminam a maioria dos candidatos antes de você perder tempo. Uma delas
          descarta sozinha: quem vende direto na mesma vitrine tem preço de fábrica e você tem o
          preço dele — não há margem a disputar. Em branco não é “não”: é “ainda não sei”, e o
          sistema não decide nada com o que não sabe.
        </p>
      </header>

      {aviso !== null && <AvisoDaAcao aviso={aviso} />}

      <Painel contagem={contagem} />

      <section aria-labelledby="lista-titulo" className={estilo.secao}>
        <h2 className={estilo.secaoTitulo} id="lista-titulo">
          Cadastrados
        </h2>
        {diagnostico !== null && <AvisoDaAcao aviso={diagnostico} />}
        <Lista confiabilidades={confiabilidades} fornecedores={fornecedores} vendedor={vendedor} />
      </section>

      <section aria-labelledby="cadastro-titulo" className={estilo.secao}>
        <h2 className={estilo.secaoTitulo} id="cadastro-titulo">
          Cadastrar fornecedor
        </h2>
        <FormularioDeCadastro />
      </section>
    </main>
  );
}
