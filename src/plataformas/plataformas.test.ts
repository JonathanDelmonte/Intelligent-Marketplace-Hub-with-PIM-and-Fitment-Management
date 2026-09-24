import { describe, expect, it } from 'vitest';
import { reaisParaCentavos } from '@/lib/dinheiro';
import { FONTES } from '@/dominio/procedencia';
import { PLATAFORMAS } from '@/dominio/precificacao/tipos';
import type { Plataforma } from '@/dominio/precificacao/tipos';
import type { AnuncioParaExportar, ArquivoParaImportacao } from './adaptador';
import { AdaptadorBase, VALIDADE_CACHE_CAPACIDADES_MS } from './adaptador-base';
import type { Relogio } from './adaptador-base';
import type { MapaDeCapacidades } from './adaptador';
import {
  CAPACIDADES,
  CAPACIDADE_SEMPRE_SUPORTADA,
  MODOS_ACESSO,
  NaoSuportado,
  ROTULO_DA_CAPACIDADE,
  ROTULO_DO_MODO,
  ehNaoSuportado,
  estaDisponivel,
  modoExigeCredencial,
  motivoDeIndisponibilidade,
} from './capacidades';
import type { Capacidade, EstadoDaCapacidade } from './capacidades';
import { centavosParaCampo, escaparCampo, montarCsv } from './csv';
import { MATRIZ_INICIAL, capacidadesSemEstado, plataformasSemOPiso } from './matriz';
import { Registro, fonteDoModo, registroPadrao } from './registro';
import { AdaptadorAmazon } from './amazon/adaptador';
import { AdaptadorMercadoLivre } from './ml/adaptador';
import { AdaptadorShopee } from './shopee/adaptador';

const r = reaisParaCentavos;

const anuncioDeTeste: AnuncioParaExportar = {
  tituloInterno: 'Refil Filtro Purificador Electrolux PA21G PA26G PE11B',
  preco: r(69),
  ean: '7896541200121',
  categoria: 'MLB1234',
  descricao: 'Compatível com PA21G, PA26G e PE11B.',
  pesoGramas: 250,
  quantidade: 10,
};

// ─── Modo M4 fora de escopo ──────────────────────────────────────────────────

describe('modo de acesso M4 (ADR 0008)', () => {
  it('não existe no conjunto de modos, e não é oversight', () => {
    // Extensão de navegador sob login: ganho marginal sobre planilha, risco de
    // suspensão da conta que é o ativo. Este teste existe para o dia em que
    // alguém for tentado a acrescentar.
    expect(MODOS_ACESSO).not.toContain('m4_extensao');
    expect(MODOS_ACESSO).toHaveLength(4);
  });

  it('só m3_api exige credencial — é o que faz o sistema rodar sem conectar conta', () => {
    expect(modoExigeCredencial('m3_api')).toBe(true);
    for (const modo of MODOS_ACESSO.filter((m) => m !== 'm3_api')) {
      expect(modoExigeCredencial(modo), modo).toBe(false);
    }
  });

  it('todo modo tem rótulo legível, para a UI não inventar texto', () => {
    for (const modo of MODOS_ACESSO) {
      expect(ROTULO_DO_MODO[modo]).toBeTruthy();
    }
  });

  it('todo modo corresponde a uma Fonte de procedência', () => {
    for (const modo of MODOS_ACESSO) {
      expect(FONTES).toContain(fonteDoModo(modo));
    }
  });
});

// ─── Estados de capacidade ───────────────────────────────────────────────────

describe('estados de capacidade', () => {
  it('disponivel e presumido são usáveis; o resto não', () => {
    expect(estaDisponivel({ tipo: 'disponivel', modo: 'm3_api', rotulo: 'x' })).toBe(true);
    expect(estaDisponivel({ tipo: 'presumido', modo: 'm3_api' })).toBe(true);
    expect(estaDisponivel({ tipo: 'sem_credencial', modo: 'm3_api' })).toBe(false);
    expect(estaDisponivel({ tipo: 'bloqueado', desde: null, evidencia: 'x' })).toBe(false);
    expect(estaDisponivel({ tipo: 'inexistente', alternativa: null })).toBe(false);
  });

  it('sem_credencial e bloqueado dão mensagens diferentes — a diferença importa', () => {
    // Em sem_credencial, conectar resolve. Em bloqueado, não adianta.
    const semCred = motivoDeIndisponibilidade({ tipo: 'sem_credencial', modo: 'm3_api' });
    const bloqueado = motivoDeIndisponibilidade({
      tipo: 'bloqueado',
      desde: '2025-12',
      evidencia: 'x',
    });
    expect(semCred).toContain('importe a planilha');
    expect(bloqueado).toContain('bloqueado');
    expect(semCred).not.toBe(bloqueado);
  });

  it('capacidade disponível não tem motivo de indisponibilidade', () => {
    expect(
      motivoDeIndisponibilidade({ tipo: 'disponivel', modo: 'm0_link', rotulo: 'x' }),
    ).toBeNull();
    expect(motivoDeIndisponibilidade({ tipo: 'presumido', modo: 'm0_link' })).toBeNull();
  });

  it('bloqueado sem data ainda produz mensagem utilizável', () => {
    const motivo = motivoDeIndisponibilidade({ tipo: 'bloqueado', desde: null, evidencia: 'x' });
    expect(motivo).toBe('bloqueado pela plataforma');
  });

  it('inexistente cita a alternativa manual quando houver', () => {
    const comAlternativa = motivoDeIndisponibilidade({
      tipo: 'inexistente',
      alternativa: 'gere a etiqueta no painel',
    });
    expect(comAlternativa).toContain('gere a etiqueta no painel');
    expect(motivoDeIndisponibilidade({ tipo: 'inexistente', alternativa: null })).toBe(
      'a plataforma não oferece isso',
    );
  });

  it('toda capacidade tem rótulo legível', () => {
    for (const capacidade of CAPACIDADES) {
      expect(ROTULO_DA_CAPACIDADE[capacidade]).toBeTruthy();
    }
  });
});

describe('NaoSuportado', () => {
  it('a mensagem diz a capacidade e o motivo', () => {
    const erro = new NaoSuportado('ml', 'buscar_terceiros', {
      tipo: 'bloqueado',
      desde: '2025-12',
      evidencia: 'x',
    });
    expect(erro.message).toContain('buscar anúncios de terceiros');
    expect(erro.message).toContain('2025-12');
    expect(erro.name).toBe('NaoSuportado');
  });

  it('é reconhecível, para a UI distinguir estado normal de falha real', () => {
    const naoSuportado = new NaoSuportado('ml', 'ler_taxas', {
      tipo: 'sem_credencial',
      modo: 'm3_api',
    });
    expect(ehNaoSuportado(naoSuportado)).toBe(true);
    expect(ehNaoSuportado(new Error('timeout de rede'))).toBe(false);
    expect(ehNaoSuportado(null)).toBe(false);
  });

  it('carrega o estado, para a UI mostrar o rótulo certo', () => {
    const estado: EstadoDaCapacidade = { tipo: 'sem_credencial', modo: 'm3_api' };
    const erro = new NaoSuportado('ml', 'ler_pedidos', estado);
    expect(erro.estado).toEqual(estado);
    expect(erro.capacidade).toBe('ler_pedidos');
  });
});

// ─── A matriz ────────────────────────────────────────────────────────────────

describe('matriz de capacidades', () => {
  it('toda capacidade de toda plataforma tem estado declarado', () => {
    expect(capacidadesSemEstado(MATRIZ_INICIAL)).toEqual([]);
  });

  it('cobre exatamente as plataformas do domínio', () => {
    expect(Object.keys(MATRIZ_INICIAL).sort()).toEqual([...PLATAFORMAS].sort());
  });

  it('exportar_para_importacao está disponível em TODA plataforma', () => {
    // É o piso do ADR 0002: o sistema funciona 100% com zero credencial.
    expect(plataformasSemOPiso(MATRIZ_INICIAL)).toEqual([]);
  });

  it('a busca de terceiros no ML está marcada como bloqueada, com data e evidência', () => {
    const estado = MATRIZ_INICIAL.ml.buscar_terceiros;
    expect(estado.tipo).toBe('bloqueado');
    if (estado.tipo === 'bloqueado') {
      expect(estado.desde).toBe('2025-12');
      expect(estado.evidencia).toContain('403');
      expect(estado.evidencia).toContain('/sites/MLB/search');
    }
  });

  it('nada além do endpoint de busca do ML está bloqueado', () => {
    // Bloqueio é fato apurado, não suposição. Marcar algo como bloqueado sem
    // evidência esconderia uma capacidade que talvez funcione.
    const bloqueados: string[] = [];
    for (const [plataforma, daPlataforma] of Object.entries(MATRIZ_INICIAL)) {
      for (const capacidade of CAPACIDADES) {
        if (daPlataforma[capacidade].tipo === 'bloqueado') {
          bloqueados.push(`${plataforma}.${capacidade}`);
        }
      }
    }
    expect(bloqueados).toEqual(['ml.buscar_terceiros']);
  });

  it('nenhuma capacidade entra como disponível sem ter sido testada', () => {
    // A especificação é explícita: os valores da seção 2.2 são a expectativa, não
    // o resultado. A única exceção é o piso, que é garantido por contrato.
    for (const [plataforma, daPlataforma] of Object.entries(MATRIZ_INICIAL)) {
      for (const capacidade of CAPACIDADES) {
        if (capacidade === CAPACIDADE_SEMPRE_SUPORTADA) continue;
        expect(daPlataforma[capacidade].tipo, `${plataforma}.${capacidade}`).not.toBe('disponivel');
      }
    }
  });
});

// ─── Cache de capacidades ────────────────────────────────────────────────────

class RelogioFalso implements Relogio {
  constructor(private t = 0) {}
  agora(): number {
    return this.t;
  }
  avancar(ms: number): void {
    this.t += ms;
  }
}

class AdaptadorEspiao extends AdaptadorBase {
  override readonly plataforma: Plataforma = 'ml';
  override readonly comoConectar = 'espião de teste';
  chamadas = 0;

  constructor(
    private readonly mapa: MapaDeCapacidades,
    relogio: Relogio,
  ) {
    super(relogio);
  }

  protected override descobrirCapacidades(): Promise<MapaDeCapacidades> {
    this.chamadas += 1;
    return Promise.resolve(this.mapa);
  }

  override exportarParaImportacao(
    anuncios: readonly AnuncioParaExportar[],
  ): Promise<ArquivoParaImportacao> {
    return Promise.resolve({
      nome: 'x.csv',
      tipoMime: 'text/csv',
      conteudo: new TextEncoder().encode(String(anuncios.length)),
      instrucao: '',
    });
  }
}

function mapaCom(sobrepor: Partial<Record<Capacidade, EstadoDaCapacidade>>): MapaDeCapacidades {
  const base: Partial<Record<Capacidade, EstadoDaCapacidade>> = {};
  for (const c of CAPACIDADES) base[c] = { tipo: 'inexistente', alternativa: null };
  return { ...base, ...sobrepor } as MapaDeCapacidades;
}

describe('cache de capacidades', () => {
  it('descobre uma vez e reusa dentro de 24 h', async () => {
    const relogio = new RelogioFalso();
    const espiao = new AdaptadorEspiao(mapaCom({}), relogio);

    await espiao.capacidades();
    await espiao.capacidades();
    relogio.avancar(VALIDADE_CACHE_CAPACIDADES_MS - 1);
    await espiao.capacidades();

    expect(espiao.chamadas).toBe(1);
  });

  it('redescobre depois de 24 h, porque política de plataforma muda sem aviso', async () => {
    const relogio = new RelogioFalso();
    const espiao = new AdaptadorEspiao(mapaCom({}), relogio);

    await espiao.capacidades();
    relogio.avancar(VALIDADE_CACHE_CAPACIDADES_MS);
    await espiao.capacidades();

    expect(espiao.chamadas).toBe(2);
  });

  it('invalidar o cache força redescoberta, para a sonda poder atualizar', async () => {
    const relogio = new RelogioFalso();
    const espiao = new AdaptadorEspiao(mapaCom({}), relogio);

    await espiao.capacidades();
    espiao.invalidarCacheDeCapacidades();
    await espiao.capacidades();

    expect(espiao.chamadas).toBe(2);
  });
});

describe('exigir() lança NaoSuportado', () => {
  it('lança quando a capacidade não está disponível', async () => {
    const espiao = new AdaptadorEspiao(mapaCom({}), new RelogioFalso());
    await expect(espiao.lerAnuncios({ perfilId: 'p1' })).rejects.toThrow(NaoSuportado);
  });

  it('lança com o estado real, não com um genérico', async () => {
    const espiao = new AdaptadorEspiao(
      mapaCom({ buscar_terceiros: { tipo: 'bloqueado', desde: '2025-12', evidencia: 'e' } }),
      new RelogioFalso(),
    );
    await expect(espiao.buscarTerceiros({ perfilId: 'p1' }, 'refil')).rejects.toThrow(/2025-12/);
  });

  it('cobre todos os métodos que podem não existir', async () => {
    const espiao = new AdaptadorEspiao(mapaCom({}), new RelogioFalso());
    const ctx = { perfilId: 'p1' };

    await expect(espiao.lerAnuncios(ctx)).rejects.toThrow(NaoSuportado);
    await expect(espiao.lerPedidos(ctx, new Date())).rejects.toThrow(NaoSuportado);
    await expect(
      espiao.taxasPara(ctx, { preco: r(69), categoria: 'x', pesoGramas: 250 }),
    ).rejects.toThrow(NaoSuportado);
    await expect(espiao.publicarAnuncio(ctx, anuncioDeTeste)).rejects.toThrow(NaoSuportado);
    await expect(espiao.gerarEtiqueta(ctx, 'p')).rejects.toThrow(NaoSuportado);
    await expect(espiao.buscarTerceiros(ctx, 't')).rejects.toThrow(NaoSuportado);
    await expect(espiao.lerItemTerceiro(ctx, 'u')).rejects.toThrow(NaoSuportado);
    await expect(espiao.responderPergunta(ctx, 'q', 't')).rejects.toThrow(NaoSuportado);
  });

  it('exportarParaImportacao nunca lança NaoSuportado', async () => {
    const espiao = new AdaptadorEspiao(mapaCom({}), new RelogioFalso());
    await expect(espiao.exportarParaImportacao([anuncioDeTeste])).resolves.toBeDefined();
  });
});

// ─── Adaptadores concretos ───────────────────────────────────────────────────

describe('adaptadores concretos', () => {
  it('o ML sem credencial rebaixa capacidades de API para sem_credencial', async () => {
    const mapa = await new AdaptadorMercadoLivre({ temCredencial: false }).capacidades();
    expect(mapa.ler_anuncios.tipo).toBe('sem_credencial');
    expect(mapa.ler_pedidos.tipo).toBe('sem_credencial');
    expect(mapa.ler_taxas.tipo).toBe('sem_credencial');
  });

  it('o ML com credencial mantém as capacidades de API como presumidas', async () => {
    const mapa = await new AdaptadorMercadoLivre({ temCredencial: true }).capacidades();
    expect(mapa.ler_anuncios.tipo).toBe('presumido');
  });

  it('o bloqueio da busca NÃO vira sem_credencial quando há token', async () => {
    // É a distinção central: token não destrava o que a plataforma bloqueou.
    for (const temCredencial of [true, false]) {
      const mapa = await new AdaptadorMercadoLivre({ temCredencial }).capacidades();
      expect(mapa.buscar_terceiros.tipo).toBe('bloqueado');
    }
  });

  it('as três plataformas exportam arquivo de importação', async () => {
    const adaptadores = [
      new AdaptadorMercadoLivre({ temCredencial: false }),
      new AdaptadorShopee(),
      new AdaptadorAmazon(),
    ];

    for (const adaptador of adaptadores) {
      const arquivo = await adaptador.exportarParaImportacao([anuncioDeTeste]);
      expect(arquivo.nome, adaptador.plataforma).toContain(adaptador.plataforma.replace('ml', ''));
      expect(arquivo.conteudo.byteLength, adaptador.plataforma).toBeGreaterThan(0);
      expect(arquivo.instrucao, adaptador.plataforma).not.toBe('');
    }
  });

  it('o arquivo do ML traz o título e o preço com vírgula decimal', async () => {
    const arquivo = await new AdaptadorMercadoLivre({
      temCredencial: false,
    }).exportarParaImportacao([anuncioDeTeste]);
    const texto = new TextDecoder().decode(arquivo.conteudo);
    expect(texto).toContain('PA21G');
    expect(texto).toContain('69,00');
    expect(texto).toContain('7896541200121');
  });

  it('a Amazon exporta TSV, que é o que o carregador dela espera', async () => {
    const arquivo = await new AdaptadorAmazon().exportarParaImportacao([anuncioDeTeste]);
    const texto = new TextDecoder().decode(arquivo.conteudo);
    expect(arquivo.tipoMime).toContain('tab-separated');
    expect(texto).toContain('\t');
    expect(texto.split('\r\n')[0]).toContain('item_name');
  });

  it('a Amazon troca tabulação do conteúdo por espaço, para não quebrar colunas', async () => {
    const arquivo = await new AdaptadorAmazon().exportarParaImportacao([
      { ...anuncioDeTeste, tituloInterno: 'Refil\tcom\ttabulação' },
    ]);
    const texto = new TextDecoder().decode(arquivo.conteudo);
    const linhaDados = texto.split('\r\n')[1] ?? '';
    // Sete colunas, e não dez — a tabulação do título não criou coluna nova.
    expect(linhaDados.split('\t')).toHaveLength(7);
  });

  it('exportar lista vazia gera arquivo só com cabeçalho, sem lançar', async () => {
    const arquivo = await new AdaptadorShopee().exportarParaImportacao([]);
    const texto = new TextDecoder().decode(arquivo.conteudo);
    expect(texto.trim().split('\r\n')).toHaveLength(1);
  });
});

// ─── Registro ────────────────────────────────────────────────────────────────

describe('Registro', () => {
  it('registra as três plataformas na ordem canônica', () => {
    const registro = registroPadrao({ plataformasComCredencial: [] });
    expect(registro.plataformas()).toEqual([...PLATAFORMAS]);
  });

  it('recusa dois adaptadores para a mesma plataforma', () => {
    expect(() => new Registro([new AdaptadorShopee(), new AdaptadorShopee()])).toThrow(
      /mesma plataforma/,
    );
  });

  it('lança ao pedir plataforma não registrada', () => {
    const registro = new Registro([new AdaptadorShopee()]);
    expect(() => registro.de('ml')).toThrow(/nenhum adaptador/);
  });

  it('quemSuporta devolve só o que está realmente disponível', async () => {
    const registro = registroPadrao({ plataformasComCredencial: [] });

    // Sem credencial, nenhuma plataforma lê pedidos por API — mas todas exportam.
    const exportam = await registro.quemSuporta('exportar_para_importacao');
    expect(exportam.map((o) => o.plataforma).sort()).toEqual([...PLATAFORMAS].sort());

    const buscam = await registro.quemSuporta('buscar_terceiros');
    expect(buscam.map((o) => o.plataforma).sort()).toEqual(['amazon', 'shopee']);
  });

  it('a busca de terceiros no ML nunca aparece como suportada', async () => {
    const registro = registroPadrao({ plataformasComCredencial: ['ml'] });
    const buscam = await registro.quemSuporta('buscar_terceiros');
    expect(buscam.map((o) => o.plataforma)).not.toContain('ml');
  });

  it('estadoDe devolve TODAS as plataformas, disponíveis ou não', async () => {
    // É o que a UI usa para mostrar a coluna vazia com rótulo honesto em vez de
    // esconder a plataforma.
    const registro = registroPadrao({ plataformasComCredencial: [] });
    const estados = await registro.estadoDe('gerar_etiqueta');
    expect(estados).toHaveLength(PLATAFORMAS.length);
    expect(estados.every((e) => !estaDisponivel(e.estado))).toBe(true);
  });

  it('a matriz do registro cobre toda plataforma e toda capacidade', async () => {
    const registro = registroPadrao({ plataformasComCredencial: [] });
    const matriz = await registro.matriz();
    for (const plataforma of PLATAFORMAS) {
      for (const capacidade of CAPACIDADES) {
        expect(matriz[plataforma][capacidade], `${plataforma}.${capacidade}`).toBeDefined();
      }
    }
  });

  it('nenhuma tela fica sem opção: toda capacidade tem estado em toda plataforma', async () => {
    const registro = registroPadrao({ plataformasComCredencial: [] });
    for (const capacidade of CAPACIDADES) {
      const estados = await registro.estadoDe(capacidade);
      expect(estados, capacidade).toHaveLength(PLATAFORMAS.length);
      for (const { plataforma, estado } of estados) {
        // Ou está disponível, ou tem motivo legível. Nunca `undefined`.
        const utilizavel = estaDisponivel(estado);
        const motivo = motivoDeIndisponibilidade(estado);
        expect(utilizavel || motivo !== null, `${plataforma}.${capacidade}`).toBe(true);
      }
    }
  });
});

// ─── CSV ─────────────────────────────────────────────────────────────────────

describe('CSV', () => {
  it('escapa campo com separador, aspas e quebra de linha', () => {
    expect(escaparCampo('a;b', ';')).toBe('"a;b"');
    expect(escaparCampo('diz "oi"', ';')).toBe('"diz ""oi"""');
    expect(escaparCampo('linha1\nlinha2', ';')).toBe('"linha1\nlinha2"');
    expect(escaparCampo('simples', ';')).toBe('simples');
  });

  it('não escapa vírgula quando o separador é ponto e vírgula', () => {
    expect(escaparCampo('a,b', ';')).toBe('a,b');
    expect(escaparCampo('a,b', ',')).toBe('"a,b"');
  });

  it('neutraliza injeção de fórmula — título vem de página de terceiro', () => {
    // Um título começando com `=` seria fórmula no Excel e no Sheets.
    expect(escaparCampo('=1+1', ';')).toBe("'=1+1");
    expect(escaparCampo('+55 11 99999', ';')).toBe("'+55 11 99999");
    expect(escaparCampo('-desconto', ';')).toBe("'-desconto");
    expect(escaparCampo('@usuario', ';')).toBe("'@usuario");
  });

  it('o `=` no meio do texto não é neutralizado', () => {
    expect(escaparCampo('largura=20cm', ';')).toBe('largura=20cm');
  });

  it('põe BOM UTF-8, porque sem ele o Excel em pt-BR mostra acento errado', () => {
    const bytes = montarCsv({ cabecalho: ['Título'], linhas: [['Água']] });
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder().decode(bytes.slice(3))).toContain('Água');
  });

  it('pode dispensar o BOM quando o destino não quer', () => {
    const bytes = montarCsv({ cabecalho: ['a'], linhas: [['b']], comBom: false });
    expect(bytes[0]).not.toBe(0xef);
  });

  it('usa CRLF, que é o que planilha de Windows espera', () => {
    const texto = new TextDecoder().decode(
      montarCsv({ cabecalho: ['a', 'b'], linhas: [['1', '2']], comBom: false }),
    );
    expect(texto).toBe('a;b\r\n1;2\r\n');
  });

  it('recusa linha com número de campos diferente do cabeçalho', () => {
    // Sem isto a coluna deslocaria em silêncio, e o erro só apareceria na
    // plataforma rejeitando o arquivo.
    expect(() => montarCsv({ cabecalho: ['a', 'b'], linhas: [['1']] })).toThrow(
      /2 campos|1 campos/,
    );
  });

  it('formata centavos com vírgula decimal e duas casas', () => {
    expect(centavosParaCampo(6900)).toBe('69,00');
    expect(centavosParaCampo(7)).toBe('0,07');
    expect(centavosParaCampo(0)).toBe('0,00');
    expect(centavosParaCampo(198_790)).toBe('1987,90');
    expect(centavosParaCampo(-1234)).toBe('-12,34');
  });
});
