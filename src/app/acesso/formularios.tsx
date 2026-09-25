'use client';

/**
 * Os formulários de acesso: entrar, criar conta, trocar a senha esquecida.
 *
 * Componente de cliente só pelo `useActionState`: o erro volta da ação e aparece no
 * próprio formulário, com o e-mail preenchido, sem ir para a URL. Tudo o mais é
 * formulário comum, que funciona até antes do JavaScript carregar.
 */
import Link from 'next/link';
import { useActionState, useId, type InputHTMLAttributes } from 'react';
import { cadastrar, entrar, recuperar } from './acoes';
import { CAMINHO_DE_CADASTRO, CAMINHO_DE_ENTRAR, CAMINHO_DE_RECUPERAR } from './constantes';
import { ESTADO_INICIAL } from './estado';
import estilo from './acesso.module.css';

function Erro({ texto }: { readonly texto: string | null }) {
  if (texto === null) return null;
  return (
    <p className={estilo.erro} role="alert">
      {texto}
    </p>
  );
}

/**
 * Rótulo, entrada e ajuda. A ajuda fica fora do rótulo e é ligada por
 * `aria-describedby`: dentro dele, o leitor de tela anunciaria o campo como
 * "Senha Dez caracteres ou mais…", e o nome do campo é só "Senha".
 */
function Campo({
  rotulo,
  ajuda,
  ...entrada
}: InputHTMLAttributes<HTMLInputElement> & {
  readonly rotulo: string;
  readonly ajuda?: string;
}) {
  const id = useId();
  const idDaAjuda = `${id}-ajuda`;
  return (
    <div className={estilo.campo}>
      <label htmlFor={id}>{rotulo}</label>
      <input
        {...entrada}
        aria-describedby={ajuda === undefined ? undefined : idDaAjuda}
        className={estilo.entrada}
        id={id}
      />
      {ajuda === undefined ? null : (
        <span className={estilo.ajuda} id={idDaAjuda}>
          {ajuda}
        </span>
      )}
    </div>
  );
}

function CampoDeEmail({ rotulo, valor }: { readonly rotulo: string; readonly valor: string }) {
  return (
    <Campo
      autoComplete="email"
      defaultValue={valor}
      inputMode="email"
      maxLength={200}
      name="email"
      required
      rotulo={rotulo}
      type="email"
    />
  );
}

function CampoDeSenha({
  nome,
  rotulo,
  nova,
  ajuda,
}: {
  readonly nome: string;
  readonly rotulo: string;
  readonly nova: boolean;
  readonly ajuda?: string;
}) {
  return (
    <Campo
      {...(ajuda === undefined ? {} : { ajuda })}
      autoComplete={nova ? 'new-password' : 'current-password'}
      maxLength={200}
      minLength={nova ? 10 : undefined}
      name={nome}
      required
      rotulo={rotulo}
      type="password"
    />
  );
}

function CampoDeCodigo() {
  return (
    <Campo
      ajuda="O código que protege este sistema. Ele fica nos segredos do GitHub (CADASTRO_CODIGO) ou, no seu computador, no arquivo .env."
      autoCapitalize="characters"
      autoComplete="off"
      name="codigo"
      placeholder="XXXX-XXXX-XXXX"
      required
      rotulo="Código de cadastro"
      spellCheck={false}
      type="text"
    />
  );
}

export function FormularioDeEntrar({ volta }: { readonly volta: string }) {
  const [estado, acao, enviando] = useActionState(entrar, ESTADO_INICIAL);
  return (
    <form action={acao} className={estilo.formulario}>
      <input name="volta" type="hidden" value={volta} />
      <CampoDeEmail rotulo="E-mail" valor={estado.email} />
      <CampoDeSenha nome="senha" nova={false} rotulo="Senha" />
      <Erro texto={estado.erro} />
      <button className={estilo.botao} disabled={enviando} type="submit">
        {enviando ? 'Entrando…' : 'Entrar'}
      </button>
      <p className={estilo.alternativas}>
        <Link href={CAMINHO_DE_CADASTRO}>Criar conta</Link>
        <Link href={CAMINHO_DE_RECUPERAR}>Esqueci a senha</Link>
      </p>
    </form>
  );
}

export function FormularioDeCadastro() {
  const [estado, acao, enviando] = useActionState(cadastrar, ESTADO_INICIAL);
  return (
    <form action={acao} className={estilo.formulario}>
      <Campo
        autoComplete="name"
        defaultValue={estado.nome}
        maxLength={80}
        name="nome"
        required
        rotulo="Seu nome"
        type="text"
      />
      <CampoDeEmail rotulo="E-mail" valor={estado.email} />
      <CampoDeSenha
        ajuda="Dez caracteres ou mais. Uma frase que só você sabe é mais forte que símbolos."
        nome="senha"
        nova
        rotulo="Senha"
      />
      <CampoDeSenha nome="confirmacao" nova rotulo="Repita a senha" />
      <CampoDeCodigo />
      <Erro texto={estado.erro} />
      <button className={estilo.botao} disabled={enviando} type="submit">
        {enviando ? 'Criando…' : 'Criar conta'}
      </button>
      <p className={estilo.alternativas}>
        <Link href={CAMINHO_DE_ENTRAR}>Já tenho conta</Link>
      </p>
    </form>
  );
}

export function FormularioDeRecuperar() {
  const [estado, acao, enviando] = useActionState(recuperar, ESTADO_INICIAL);
  return (
    <form action={acao} className={estilo.formulario}>
      <CampoDeEmail rotulo="E-mail da conta" valor={estado.email} />
      <CampoDeSenha nome="senha" nova rotulo="Senha nova" />
      <CampoDeSenha nome="confirmacao" nova rotulo="Repita a senha nova" />
      <CampoDeCodigo />
      <Erro texto={estado.erro} />
      <button className={estilo.botao} disabled={enviando} type="submit">
        {enviando ? 'Trocando…' : 'Trocar a senha e entrar'}
      </button>
      <p className={estilo.alternativas}>
        <Link href={CAMINHO_DE_ENTRAR}>Voltar para entrar</Link>
      </p>
    </form>
  );
}
