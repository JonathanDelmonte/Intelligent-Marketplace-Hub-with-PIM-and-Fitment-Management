/**
 * Copia o wasm do decodificador para `public/`.
 *
 * Existe por causa de offline, que é requisito e não conforto: a especificação
 * pede que o leitor funcione em loja com sinal ruim. O `zxing-wasm` busca o
 * binário de um CDN por padrão, e CDN é exatamente o que não responde lá. Servido
 * do próprio domínio, o service worker consegue cacheá-lo junto com o resto.
 *
 * Roda no `build` e no `prepare`. Não versionamos o binário: ele é artefato de
 * dependência, e versioná-lo faria o repositório carregar 1,5 MB que o
 * `npm install` já traz.
 */
import { copyFile, mkdir, stat } from 'node:fs/promises';
import { dirname } from 'node:path';

const ORIGEM = 'node_modules/zxing-wasm/dist/reader/zxing_reader.wasm';
const DESTINO = 'public/wasm/zxing_reader.wasm';

async function principal() {
  try {
    await stat(ORIGEM);
  } catch {
    console.error(`Não achei ${ORIGEM}. Rode npm install antes.`);
    process.exitCode = 1;
    return;
  }

  await mkdir(dirname(DESTINO), { recursive: true });
  await copyFile(ORIGEM, DESTINO);

  const { size } = await stat(DESTINO);
  console.log(`wasm do leitor copiado para ${DESTINO} (${String(Math.round(size / 1024))} KB)`);
}

await principal();
