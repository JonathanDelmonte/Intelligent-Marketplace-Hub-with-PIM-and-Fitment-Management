/**
 * Testes da lógica da tela de jobs.
 *
 * Todo caso aqui parte da mesma pergunta: **a tela abre mesmo quando o dado está
 * estranho?** Ela é a tela que se consulta quando algo deu errado, então ficar em
 * branco justamente aí seria o pior defeito possível.
 */
import { describe, expect, it } from 'vitest';
import type { JobDetalhado } from '@/infra/fila/fila';
import {
  entradaAndando,
  haEntradaAndando,
  rotuloDoTipoDeJob,
  CODIGOS_DE_AVISO,
  EXPLICACAO_DO_STATUS,
  JANELA_DE_FILA_PARADA_MS,
  MAX_TITULO,
  ROTULO_DO_STATUS,
  avisoDeFilaParada,
  avisoDoPrazoNaNuvem,
  descreverAviso,
  descreverTentativas,
  duracaoDoJob,
  ehStatusConhecido,
  extrairRejeitadas,
  fichaDoJob,
  jsonLegivel,
  MAX_JSON_NA_TELA,
  formatarDuracao,
  formatarRelativo,
  inteiroDaUrl,
  recortar,
  resumirEntrada,
  resumirProgresso,
  resumirResultado,
  rotuloDoTipoDeEntrada,
  ultimoTermino,
} from './apresentacao';

const AGORA = new Date('2026-09-12T12:00:00.000Z');

function job(campos: Partial<JobDetalhado> = {}): JobDetalhado {
  return {
    id: '11111111-2222-3333-4444-555555555555',
    tipo: 'ingestao',
    status: 'concluido',
    entrada: null,
    progresso: null,
    resultado: null,
    tentativas: 1,
    maxTentativas: 3,
    chaveIdempotencia: 'abc',
    erro: null,
    criadoEm: AGORA,
    agendadoPara: AGORA,
    iniciadoEm: null,
    terminadoEm: null,
    ...campos,
  };
}

describe('resumirEntrada', () => {
  it('usa o nome do arquivo como título', () => {
    const resumo = resumirEntrada({
      classificacao: { tipoDeEntrada: 'planilha_exportacao', site: 'ml', confiancaBp: 8500 },
      hashConteudo: 'abc',
      nomeArquivo: 'anuncios_mercadolivre.csv',
      url: null,
      texto: null,
    });

    expect(resumo.titulo).toBe('anuncios_mercadolivre.csv');
    expect(resumo.site).toBe('ml');
    expect(resumo.confiancaBp).toBe(8500);
    expect(resumo.formaInesperada).toBe(false);
  });

  it('cai para a URL, e depois para o texto', () => {
    const porUrl = resumirEntrada({
      classificacao: { tipoDeEntrada: 'anuncio_marketplace' },
      url: 'https://produto.mercadolivre.com.br/MLB-123456',
    });
    expect(porUrl.titulo).toBe('https://produto.mercadolivre.com.br/MLB-123456');

    const porTexto = resumirEntrada({
      classificacao: { tipoDeEntrada: 'texto_colado' },
      texto: 'refil de purificador consul',
    });
    expect(porTexto.titulo).toBe('refil de purificador consul');
  });

  it('conta os links quando a entrada é uma lista', () => {
    const resumo = resumirEntrada({
      classificacao: { tipoDeEntrada: 'lista_de_links', urls: ['a', 'b', 'c'] },
    });
    expect(resumo.titulo).toBe('3 links');
  });

  it('recorta título longo em vez de estourar a coluna', () => {
    const resumo = resumirEntrada({
      classificacao: { tipoDeEntrada: 'texto_colado' },
      texto: 'x'.repeat(MAX_TITULO + 50),
    });
    expect(resumo.titulo.length).toBeLessThanOrEqual(MAX_TITULO);
  });

  it('payload de outra forma não lança: vira aviso de forma inesperada', () => {
    for (const estranho of [null, undefined, 42, 'texto', [], {}, { classificacao: 7 }]) {
      const resumo = resumirEntrada(estranho);
      expect(resumo.formaInesperada, JSON.stringify(estranho)).toBe(true);
      expect(resumo.titulo).toBe('payload em formato não reconhecido');
    }
  });

  it('job de outra tela tem nome próprio, e não parece erro (diário, 26/09)', () => {
    const identidade = resumirEntrada(
      { produtoExternoId: '0b7c6c1e-7d0f-4f5e-9d2a-3a1f2b3c4d5e' },
      'resolver_identidade',
    );
    expect(identidade.titulo).toBe('Reconhecer o produto');
    expect(identidade.formaInesperada).toBe(false);
    expect(rotuloDoTipoDeJob('resolver_identidade')).toBe('junta anúncios do mesmo produto');

    expect(
      resumirEntrada(
        { hashConteudo: 'abc', plataforma: 'shopee', nomeArquivo: 'pedidos.xlsx' },
        'importar_pedidos',
      ).titulo,
    ).toBe('pedidos.xlsx');
    expect(
      resumirEntrada(
        { alvo: 'capinha iPhone 15', tetoCentavos: 500, tetoPassos: 20 },
        'investigar_alvo',
      ).titulo,
    ).toBe('Investigar oportunidade: capinha iPhone 15');
  });

  it('tipo de job desconhecido continua avisando a forma inesperada', () => {
    const resumo = resumirEntrada({ qualquer: 1 }, 'tipo_que_nao_existe');
    expect(resumo.formaInesperada).toBe(true);
    expect(rotuloDoTipoDeJob('tipo_que_nao_existe')).toBe('tipo_que_nao_existe');
  });

  it('payload com campo a mais continua sendo lido — o banco tem job de versão antiga', () => {
    const resumo = resumirEntrada({
      classificacao: { tipoDeEntrada: 'planilha_exportacao', campoNovoQueNaoExistiaAntes: true },
      nomeArquivo: 'x.csv',
      campoDesconhecido: 'ignorado',
    });
    expect(resumo.formaInesperada).toBe(false);
    expect(resumo.titulo).toBe('x.csv');
  });

  it('entrada sem nada identificável ainda produz título legível', () => {
    const resumo = resumirEntrada({ classificacao: { tipoDeEntrada: 'desconhecido' } });
    expect(resumo.titulo).toBe('entrada sem identificação');
  });
});

describe('resumirResultado', () => {
  it('mostra só o que veio, e marca rejeitados como alerta', () => {
    const metricas = resumirResultado({ gravados: 12, duplicados: 0, rejeitados: 3 });

    expect(metricas.map((m) => m.rotulo)).toEqual(['gravados', 'rejeitados']);
    expect(metricas.find((m) => m.rotulo === 'rejeitados')?.alerta).toBe(true);
  });

  it('coluna não reconhecida aparece como alerta — é mapeamento envelhecendo', () => {
    const metricas = resumirResultado({
      gravados: 1,
      colunasNaoReconhecidas: ['Preço promocional', 'Campanha'],
    });

    const alerta = metricas.find((m) => m.rotulo === 'colunas ignoradas');
    expect(alerta?.valor).toBe('Preço promocional, Campanha');
    expect(alerta?.alerta).toBe(true);
  });

  it('resultado de lista de links mostra os filhos', () => {
    expect(resumirResultado({ filhosEnfileirados: 4 })).toEqual([{ rotulo: 'filhos', valor: '4' }]);
  });

  it('resultado ausente ou estranho devolve lista vazia sem lançar', () => {
    expect(resumirResultado(null)).toEqual([]);
    expect(resumirResultado('qualquer coisa')).toEqual([]);
    expect(resumirResultado({ gravados: 'dois' })).toEqual([]);
  });
});

describe('resumirProgresso', () => {
  it('mostra porcentagem quando há total', () => {
    expect(resumirProgresso({ linhasProcessadas: 250, totalDeLinhas: 1000 })).toBe(
      '250 de 1.000 linhas (25%)',
    );
  });

  it('mostra só o contado quando não há total', () => {
    expect(resumirProgresso({ linhasProcessadas: 50 })).toBe('50 linhas');
    expect(resumirProgresso({ linhasProcessadas: 50, totalDeLinhas: 0 })).toBe('50 linhas');
  });

  it('progresso ausente ou de outra forma devolve null', () => {
    expect(resumirProgresso(null)).toBeNull();
    expect(resumirProgresso({ paginaAtual: 7 })).toBeNull();
  });
});

describe('tempo', () => {
  it('trata diferença curta como agora', () => {
    expect(formatarRelativo(new Date(AGORA.getTime() - 10_000), AGORA)).toBe('agora');
  });

  it('usa minuto, hora e dia conforme a distância', () => {
    const atras = (ms: number): string => formatarRelativo(new Date(AGORA.getTime() - ms), AGORA);

    expect(atras(120_000)).toBe('há 2 minutos');
    expect(atras(7_200_000)).toBe('há 2 horas');
    // `numeric: 'auto'` fala como gente fala. Fixado porque é texto que a pessoa lê.
    expect(atras(86_400_000)).toBe('ontem');
    expect(atras(172_800_000)).toBe('anteontem');
    expect(atras(5 * 86_400_000)).toBe('há 5 dias');
  });

  it('instante no futuro não vira texto quebrado — job agendado existe', () => {
    expect(formatarRelativo(new Date(AGORA.getTime() + 600_000), AGORA)).toBe('em 10 minutos');
  });

  it('formata duração de milissegundo a minuto', () => {
    expect(formatarDuracao(23)).toBe('23 ms');
    expect(formatarDuracao(1500)).toBe('1,5 s');
    expect(formatarDuracao(45_000)).toBe('45 s');
    expect(formatarDuracao(65_000)).toBe('1 min 5 s');
    expect(formatarDuracao(120_000)).toBe('2 min');
    expect(formatarDuracao(Number.NaN)).toBe('—');
    expect(formatarDuracao(-5)).toBe('—');
  });

  it('job que não começou não tem duração', () => {
    expect(duracaoDoJob(job({ iniciadoEm: null }), AGORA)).toBeNull();
  });

  it('job rodando mede contra agora, o que expõe job travado', () => {
    const travado = job({
      status: 'rodando',
      iniciadoEm: new Date(AGORA.getTime() - 300_000),
      terminadoEm: null,
    });
    expect(duracaoDoJob(travado, AGORA)).toBe(300_000);
  });

  it('ultimoTermino acha o mais recente e ignora quem não terminou', () => {
    const jobs = [
      job({ terminadoEm: null }),
      job({ terminadoEm: new Date('2026-09-12T11:00:00Z') }),
      job({ terminadoEm: new Date('2026-09-12T11:30:00Z') }),
    ];
    expect(ultimoTermino(jobs)?.toISOString()).toBe('2026-09-12T11:30:00.000Z');
    expect(ultimoTermino([])).toBeNull();
    expect(ultimoTermino([job({ terminadoEm: null })])).toBeNull();
  });
});

describe('tentativas', () => {
  it('primeira tentativa não polui a coluna', () => {
    expect(descreverTentativas(job({ tentativas: 1 }))).toBeNull();
    expect(descreverTentativas(job({ tentativas: 0 }))).toBeNull();
  });

  it('última tentativa vira alerta — a próxima falha encerra o job', () => {
    expect(descreverTentativas(job({ tentativas: 2, maxTentativas: 3 }))).toEqual({
      texto: '2/3',
      alerta: false,
    });
    expect(descreverTentativas(job({ tentativas: 3, maxTentativas: 3 }))).toEqual({
      texto: '3/3',
      alerta: true,
    });
  });
});

describe('rótulos', () => {
  it('todo status tem rótulo e explicação', () => {
    for (const [status, rotulo] of Object.entries(ROTULO_DO_STATUS)) {
      expect(rotulo).not.toBe('');
      expect(EXPLICACAO_DO_STATUS[status as keyof typeof EXPLICACAO_DO_STATUS]).not.toBe('');
    }
  });

  it('status desconhecido é reconhecido como desconhecido', () => {
    expect(ehStatusConhecido('pendente_revisao')).toBe(true);
    expect(ehStatusConhecido('inventado')).toBe(false);
  });

  it('tipo de entrada desconhecido cai no próprio valor em vez de sumir', () => {
    expect(rotuloDoTipoDeEntrada('planilha_exportacao')).toBe('planilha de exportação');
    expect(rotuloDoTipoDeEntrada('tipo_que_nao_existe')).toBe('tipo_que_nao_existe');
  });
});

describe('avisos de ação', () => {
  it('todo código previsto tem texto', () => {
    for (const codigo of CODIGOS_DE_AVISO) {
      const aviso = descreverAviso(codigo, 1);
      expect(aviso, codigo).not.toBeNull();
      expect(aviso?.titulo, codigo).not.toBe('');
      expect(aviso?.corpo, codigo).not.toBe('');
    }
  });

  it('código de fora da lista não vira mensagem — a URL não dita o texto da tela', () => {
    expect(descreverAviso('tudo_foi_apagado')).toBeNull();
    expect(descreverAviso('<script>')).toBeNull();
    expect(descreverAviso(undefined)).toBeNull();
  });

  it('plural acompanha a quantidade', () => {
    expect(descreverAviso('processado', 1)?.titulo).toBe('1 entrada processada');
    expect(descreverAviso('processado', 4)?.titulo).toBe('4 entradas processadas');
    expect(descreverAviso('devolvido', 1)?.titulo).toBe('1 entrada voltou para a fila');
    expect(descreverAviso('devolvido', 2)?.titulo).toBe('2 entradas voltaram para a fila');
  });

  it('quantidade inválida na URL não vira texto estranho', () => {
    expect(descreverAviso('processado', -3)?.titulo).toBe('0 entradas processadas');
    expect(inteiroDaUrl('abc')).toBeNull();
    expect(inteiroDaUrl('-1')).toBeNull();
    expect(inteiroDaUrl('12')).toBe(12);
    expect(inteiroDaUrl(undefined)).toBeNull();
  });
});

describe('aviso do prazo na nuvem', () => {
  it('na nuvem, diz o prazo, onde está o original e o que fazer depois', () => {
    const texto = avisoDoPrazoNaNuvem(7);
    expect(texto).toContain('fica 7 dias depois de processado');
    expect(texto).toContain('o original continua no seu computador');
    expect(texto).toContain('envie o mesmo arquivo');
  });

  it('no computador de quem usa, o arquivo fica, e não há o que avisar', () => {
    expect(avisoDoPrazoNaNuvem(null)).toBeNull();
  });
});

describe('aviso de fila parada', () => {
  it('cala quando não há nada pronto', () => {
    expect(avisoDeFilaParada({ prontos: 0, ultimoTermino: null, agora: AGORA })).toBeNull();
  });

  it('cala quando algo terminou há pouco — alguém está consumindo', () => {
    expect(
      avisoDeFilaParada({
        prontos: 3,
        ultimoTermino: new Date(AGORA.getTime() - 5_000),
        agora: AGORA,
      }),
    ).toBeNull();
  });

  it('avisa quando há trabalho pronto e nada terminou na janela', () => {
    const aviso = avisoDeFilaParada({
      prontos: 3,
      ultimoTermino: new Date(AGORA.getTime() - JANELA_DE_FILA_PARADA_MS - 1),
      agora: AGORA,
    });
    expect(aviso).toContain('3 entradas estão prontas');
    expect(aviso).toContain('Processar agora');
  });

  it('avisa também quando nada terminou nunca', () => {
    expect(avisoDeFilaParada({ prontos: 1, ultimoTermino: null, agora: AGORA })).toContain(
      '1 entrada está pronta',
    );
  });
});

describe('recortar', () => {
  it('colapsa espaço', () => {
    expect(recortar('  a   b  ', 10)).toBe('a b');
  });

  it('nunca devolve mais que o máximo pedido, marca de corte inclusa', () => {
    for (const maximo of [1, 3, 4, 5, 10, 90]) {
      const saida = recortar('x'.repeat(200), maximo);
      expect(saida.length, `máximo ${String(maximo)}`).toBeLessThanOrEqual(maximo);
    }
  });

  it('corta com marca quando há espaço para ela', () => {
    expect(recortar('abcdefghij', 5)).toBe('ab...');
  });
});

describe('linhas recusadas', () => {
  const REJEITADA = {
    numeroDaLinha: 12,
    motivo: 'preço ilegível: "1.2.3"',
    problemas: ['preco: formato não reconhecido'],
    bruto: { 'Código MLB': 'MLB123', Título: 'Refil', 'Preço (R$)': '1.2.3', Sobra: '' },
  };

  it('prefere a linha original, com o nome de coluna do arquivo', () => {
    const linhas = extrairRejeitadas({
      rejeitadas: [
        {
          ...REJEITADA,
          original: [
            { coluna: 'Codigo MLB', valor: 'MLB123' },
            { coluna: 'Preco (R$)', valor: '1.2.3' },
            { coluna: 'Campo Que Eu Nao Previ', valor: 'guardado' },
          ],
        },
      ],
    });

    expect(linhas[0]?.temColunasOriginais).toBe(true);
    expect(linhas[0]?.campos.map((c) => c.coluna)).toEqual([
      'Codigo MLB',
      'Preco (R$)',
      'Campo Que Eu Nao Previ',
    ]);
  });

  it('sem a linha original, cai na forma mapeada e avisa que é ela', () => {
    const linhas = extrairRejeitadas({ rejeitadas: [REJEITADA] });
    expect(linhas[0]?.temColunasOriginais).toBe(false);
  });

  it('extrai a linha mapeada, o motivo e os problemas', () => {
    const linhas = extrairRejeitadas({ gravados: 3, rejeitadas: [REJEITADA] });

    expect(linhas).toHaveLength(1);
    expect(linhas[0]?.numeroDaLinha).toBe(12);
    expect(linhas[0]?.motivo).toBe('preço ilegível: "1.2.3"');
    expect(linhas[0]?.problemas).toEqual(['preco: formato não reconhecido']);
    expect(linhas[0]?.campos).toEqual([
      { coluna: 'Código MLB', valor: 'MLB123' },
      { coluna: 'Título', valor: 'Refil' },
      { coluna: 'Preço (R$)', valor: '1.2.3' },
      // A coluna "Sobra" tinha nome e valor vazios? Não: nome sim, valor não —
      // então fica, porque coluna nomeada e vazia é informação.
      { coluna: 'Sobra', valor: '' },
    ]);
  });

  it('descarta coluna sem nome e sem valor, que é célula de sobra da planilha', () => {
    const linhas = extrairRejeitadas({
      rejeitadas: [{ ...REJEITADA, bruto: { Título: 'Refil', '': '', '  ': '  ' } }],
    });
    expect(linhas[0]?.campos).toEqual([{ coluna: 'Título', valor: 'Refil' }]);
  });

  it('resultado sem rejeitadas devolve lista vazia', () => {
    expect(extrairRejeitadas({ gravados: 3 })).toEqual([]);
    expect(extrairRejeitadas(null)).toEqual([]);
    expect(extrairRejeitadas('nada')).toEqual([]);
  });

  it('linha rejeitada de forma inesperada é pulada, não derruba a tela', () => {
    const linhas = extrairRejeitadas({
      rejeitadas: [42, null, 'texto', REJEITADA, { bruto: { a: 1 } }],
    });
    expect(linhas).toHaveLength(1);
    expect(linhas[0]?.numeroDaLinha).toBe(12);
  });

  it('campos ausentes têm recurso legível em vez de undefined na tela', () => {
    const linhas = extrairRejeitadas({ rejeitadas: [{}] });
    expect(linhas[0]).toEqual({
      numeroDaLinha: null,
      motivo: 'sem motivo registrado',
      problemas: [],
      campos: [],
      temColunasOriginais: false,
    });
  });
});

describe('jsonLegivel', () => {
  it('formata com indentação', () => {
    expect(jsonLegivel({ a: 1 })).toBe('{\n  "a": 1\n}');
  });

  it('null e undefined não viram a string "null" na tela', () => {
    expect(jsonLegivel(null)).toBeNull();
    expect(jsonLegivel(undefined)).toBeNull();
  });

  it('corta valor gigante e diz que cortou', () => {
    const grande = { texto: 'x'.repeat(MAX_JSON_NA_TELA * 2) };
    const saida = jsonLegivel(grande);

    expect(saida).not.toBeNull();
    expect(saida?.length).toBeLessThan(MAX_JSON_NA_TELA + 200);
    expect(saida).toContain('cortado em');
  });

  it('valor que não serializa devolve recurso em vez de lançar', () => {
    const ciclo: Record<string, unknown> = {};
    ciclo['eu'] = ciclo;
    expect(jsonLegivel(ciclo)).toBe('[não foi possível serializar o valor gravado]');
  });
});

describe('fichaDoJob', () => {
  it('traz identificador, chave de idempotência e os quatro instantes', () => {
    const ficha = fichaDoJob(
      job({
        iniciadoEm: new Date('2026-09-12T11:59:00Z'),
        terminadoEm: new Date('2026-09-12T11:59:02Z'),
      }),
      AGORA,
    );
    const rotulos = ficha.map((f) => f.rotulo);

    expect(rotulos).toContain('identificador');
    expect(rotulos).toContain('chave de idempotência');
    expect(rotulos).toContain('duração');
    expect(ficha.find((f) => f.rotulo === 'duração')?.valor).toBe('2 s');
  });

  it('job que nunca rodou diz "nunca" em vez de deixar vazio', () => {
    const ficha = fichaDoJob(job({ iniciadoEm: null, terminadoEm: null }), AGORA);
    expect(ficha.find((f) => f.rotulo === 'iniciado')?.valor).toBe('nunca');
    expect(ficha.find((f) => f.rotulo === 'duração')?.valor).toBe('—');
  });
});

describe('a tela se atualiza sozinha só com entrada andando', () => {
  it('com entrada pronta ou rodando, atualiza', () => {
    expect(haEntradaAndando({ prontos: 1, rodando: 0 })).toBe(true);
    expect(haEntradaAndando({ prontos: 0, rodando: 2 })).toBe(true);
  });

  it('com a fila parada, não — a aba esquecida não consulta o banco', () => {
    expect(haEntradaAndando({ prontos: 0, rodando: 0 })).toBe(false);
  });

  it('uma entrada: rodando, ou pendente com a hora vencida', () => {
    const agora = new Date('2026-09-26T12:00:00.000Z');
    const antes = new Date('2026-09-26T11:59:59.000Z');
    const depois = new Date('2026-09-26T12:30:00.000Z');
    expect(entradaAndando({ status: 'rodando', agendadoPara: depois }, agora)).toBe(true);
    expect(entradaAndando({ status: 'pendente', agendadoPara: antes }, agora)).toBe(true);
    expect(entradaAndando({ status: 'pendente', agendadoPara: depois }, agora)).toBe(false);
    expect(entradaAndando({ status: 'concluido', agendadoPara: antes }, agora)).toBe(false);
  });
});
