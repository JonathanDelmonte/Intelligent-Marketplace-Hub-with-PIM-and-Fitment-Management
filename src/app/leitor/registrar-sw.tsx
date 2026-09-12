'use client';

/**
 * Registra o service worker, que é o que faz a tela abrir offline.
 *
 * Componente de cliente sem marcação: só o efeito. Fica separado para a página do
 * leitor continuar sendo Server Component — registrar o worker não precisa de
 * estado nem de interatividade, e transformar a página inteira em cliente por
 * causa disto custaria a consulta ao banco no servidor.
 *
 * Falha de registro **não** é erro visível. O leitor funciona sem service worker;
 * o que se perde é abrir a tela com o aparelho já sem rede. Tratar isso como erro
 * assustaria a pessoa por causa de uma degradação que ela não pode resolver.
 */
import { useEffect } from 'react';

export const CAMINHO_DO_WORKER = '/sw.js';

export function RegistrarServiceWorker() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    navigator.serviceWorker.register(CAMINHO_DO_WORKER).catch(() => {
      // Contexto não seguro, modo privado ou permissão negada. Segue sem.
    });
  }, []);

  return null;
}
