/**
 * O estado da tela na URL, sem recarregar a página.
 *
 * Na URL, e não só na memória do navegador: recarregar não perde o que se estava olhando,
 * e o link de uma conta é compartilhável. A escrita espera a pessoa parar de mexer,
 * porque arrastar a régua ou o gráfico dispara dezenas de mudanças por segundo, e o
 * navegador recusa quem troca a URL rápido demais (o Safari passa a lançar erro depois de
 * cem trocas em trinta segundos).
 *
 * Cada chamada escreve o estado inteiro que a tela guarda, e por isso a mais nova pode
 * descartar a anterior sem perder nada.
 */
let pendente: ReturnType<typeof setTimeout> | undefined;

export function gravarNaUrl(mudar: (busca: URLSearchParams) => void): void {
  clearTimeout(pendente);
  pendente = setTimeout(() => {
    const url = new URL(window.location.href);
    mudar(url.searchParams);
    // O aviso da última ação sai junto, para não voltar num recarregamento.
    url.searchParams.delete('r');
    window.history.replaceState(window.history.state, '', url);
  }, 250);
}
