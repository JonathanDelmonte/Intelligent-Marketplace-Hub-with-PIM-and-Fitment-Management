import { describe, expect, it } from 'vitest';
import { pdfComLinhas } from '@/infra/pdf/teste';
import { FalhaDeRede } from '@/infra/web/rede';
import { lerTextoDoEndereco } from './leitura';
import { linhasVisiveis } from './pagina';

/** Um `fetch` que devolve sempre a mesma resposta. */
function responde(resposta: () => Response): { buscar: typeof fetch } {
  return { buscar: () => Promise.resolve(resposta()) };
}

describe('linhasVisiveis', () => {
  it('parágrafo, item e linha de tabela viram linhas; célula vira coluna', () => {
    const html = `<html><head><script>var x = 1;</script><style>p{}</style></head><body>
<h1>Refis compatíveis</h1><p>Troque a cada <b>6 meses</b>.</p>
<ul><li>PA21G</li><li>PA26G</li></ul>
<table><tr><td>PAPPCA40</td><td>PA21G, PA26G</td></tr></table>Fim&nbsp;do texto<br>Última</body></html>`;
    expect(linhasVisiveis(html).split('\n')).toEqual([
      'Refis compatíveis',
      'Troque a cada 6 meses .',
      'PA21G',
      'PA26G',
      'PAPPCA40 | PA21G, PA26G',
      'Fim do texto',
      'Última',
    ]);
  });
});

describe('lerTextoDoEndereco', () => {
  it('página vira texto em linhas, com o título', async () => {
    const lido = await lerTextoDoEndereco(
      'https://fabricante.com.br/refil',
      responde(
        () =>
          new Response('<title>Refil PAPPCA40</title><p>Serve no PA21G</p>', {
            headers: { 'content-type': 'text/html; charset=utf-8' },
          }),
      ),
    );
    expect(lido).toMatchObject({
      tipo: 'ok',
      formato: 'pagina',
      titulo: 'Refil PAPPCA40',
      texto: 'Refil PAPPCA40\nServe no PA21G',
    });
  });

  it('PDF é reconhecido pela assinatura, mesmo sem o tipo certo na resposta', async () => {
    const pdf = pdfComLinhas(['Manual PA21G', 'Refil PAPPCA40']);
    const lido = await lerTextoDoEndereco(
      'https://fabricante.com.br/manual',
      responde(
        () => new Response(pdf, { headers: { 'content-type': 'application/octet-stream' } }),
      ),
    );
    expect(lido.tipo === 'ok' && lido.formato).toBe('pdf');
    expect(lido.tipo === 'ok' && lido.texto).toContain('Refil PAPPCA40');
  });

  it('site que recusa é resposta; site fora do ar é falha, para tentar de novo', async () => {
    const recusado = await lerTextoDoEndereco(
      'https://fabricante.com.br/manual',
      responde(() => new Response('', { status: 403 })),
    );
    expect(recusado.tipo === 'recusado' && recusado.motivo).toContain('só abre no navegador');

    await expect(
      lerTextoDoEndereco(
        'https://fabricante.com.br/manual',
        responde(() => new Response('', { status: 503 })),
      ),
    ).rejects.toThrow(FalhaDeRede);
  });
});
