/*
 * Service worker do leitor.
 *
 * Escrito à mão, sem biblioteca de geração. São sessenta linhas, e uma
 * dependência que gera service worker traria configuração, um passo de build e um
 * arquivo que ninguém lê — para resolver um problema que caberia nestas sessenta.
 *
 * ## O que ele precisa garantir
 *
 * Abrir `/leitor` com o aparelho já sem rede. Sem isso, "funciona offline" é
 * mentira: a pessoa chega na loja, o sinal cai, ela abre a tela e vê o dinossauro.
 *
 * ## Duas estratégias, e a diferença importa
 *
 * - **Navegação e recurso da aplicação:** rede primeiro, cache como rede de
 *   segurança. Assim uma versão nova chega sem precisar limpar cache, e a versão
 *   guardada só aparece quando não há rede.
 * - **O wasm do decodificador:** cache primeiro. São 900 KB que nunca mudam
 *   dentro de uma versão, e baixar de novo num 3G de loja é o que faz a câmera
 *   parecer travada.
 *
 * Requisição que não é `GET` nunca é interceptada. Sincronização de leitura é
 * `POST` de Server Action, e servir isso de cache seria inventar resposta para
 * uma gravação que não aconteceu.
 */

const VERSAO = 'bancada-leitor-v1';
const ESSENCIAIS = ['/leitor', '/wasm/zxing_reader.wasm', '/icone.svg', '/manifest.webmanifest'];

self.addEventListener('install', (evento) => {
  evento.waitUntil(
    (async () => {
      const cache = await caches.open(VERSAO);
      // `Promise.allSettled` e não `cache.addAll`: se UM recurso falhar,
      // `addAll` rejeita e o worker não instala — e aí nada fica offline por
      // causa de um ícone.
      await Promise.allSettled(ESSENCIAIS.map((url) => cache.add(new Request(url))));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    (async () => {
      const nomes = await caches.keys();
      await Promise.all(nomes.filter((n) => n !== VERSAO).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (evento) => {
  const pedido = evento.request;

  if (pedido.method !== 'GET') return;

  const url = new URL(pedido.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith('/wasm/')) {
    evento.respondWith(cachePrimeiro(pedido));
    return;
  }

  evento.respondWith(redePrimeiro(pedido));
});

async function cachePrimeiro(pedido) {
  const cache = await caches.open(VERSAO);
  const guardado = await cache.match(pedido);
  if (guardado) return guardado;

  const resposta = await fetch(pedido);
  if (resposta.ok) await cache.put(pedido, resposta.clone());
  return resposta;
}

async function redePrimeiro(pedido) {
  const cache = await caches.open(VERSAO);
  try {
    const resposta = await fetch(pedido);
    if (resposta.ok) await cache.put(pedido, resposta.clone());
    return resposta;
  } catch (erro) {
    const guardado = await cache.match(pedido);
    if (guardado) return guardado;

    // Navegação sem rede e sem cache: devolve a tela do leitor, que é a que a
    // pessoa quer. Melhor que a página de erro do navegador.
    if (pedido.mode === 'navigate') {
      const leitor = await cache.match('/leitor');
      if (leitor) return leitor;
    }
    throw erro;
  }
}
