import { describe, expect, it } from 'vitest';
import { CAMPOS_FISCAIS } from '@/dominio/fiscal/codigos';
import { URGENCIAS_DO_PRAZO, avaliarPrazos } from '@/dominio/fiscal/prazos';
import type { ResumoFiscal, SkuFiscal } from '@/dominio/fiscal/repositorio';
import { SITUACOES_DO_TETO, avaliarTeto } from '@/dominio/fiscal/teto';
import { reaisParaCentavos } from '@/lib/dinheiro';
import {
  CODIGOS_DE_AVISO,
  ROTULO_DA_SITUACAO,
  ROTULO_DA_SITUACAO_DO_EMISSOR,
  descreverAviso,
  diaEmTexto,
  prazoEmTexto,
  resumoDoCadastro,
  resumoDoTeto,
  rotuloDoCampo,
  tomDoEmissor,
  tomDoPrazo,
  tomDoTeto,
} from './apresentacao';

const SETEMBRO = new Date('2026-09-15T12:00:00-03:00');

const skuFiscal = (campos: Partial<SkuFiscal> = {}): SkuFiscal => ({
  id: 's1',
  tituloInterno: 'Refil PA21G',
  ncm: '84212100',
  cest: null,
  cst: '000',
  cclasstrib: '000001',
  categoriaRegulada: null,
  estado: { faltando: [], prontoPara2027: true, mensagem: 'ok' },
  regulacao: { area: null, origem: 'nenhuma', regra: null, mensagem: null },
  ...campos,
});

const resumo = (campos: Partial<ResumoFiscal> = {}): ResumoFiscal => ({
  skus: [],
  pendentes: 0,
  regulados: 0,
  regime: 'mei',
  ...campos,
});

describe('emissor', () => {
  it('sem CNPJ é neutro: o prazo que muda isso já está no painel de prazos', () => {
    expect(tomDoEmissor('sem_cnpj')).toBe('neutro');
    expect(tomDoEmissor('falta_dado')).toBe('atencao');
    expect(tomDoEmissor('pronto')).toBe('ok');
  });

  it('toda situação tem rótulo', () => {
    for (const situacao of ['sem_cnpj', 'falta_dado', 'pronto'] as const) {
      expect(ROTULO_DA_SITUACAO_DO_EMISSOR[situacao]).not.toBe('');
    }
  });
});

describe('tons', () => {
  it('prazo a trinta dias é alerta; prazo vencido não é', () => {
    // Ou foi feito, e não é alerta, ou não foi — e aí o alerta de verdade é a nota
    // rejeitada, não a data no painel.
    expect(tomDoPrazo('agora')).toBe('alerta');
    expect(tomDoPrazo('este_mes')).toBe('atencao');
    expect(tomDoPrazo('tem_tempo')).toBe('neutro');
    expect(tomDoPrazo('passou')).toBe('neutro');
  });

  it('toda urgência e toda situação têm tom', () => {
    for (const u of URGENCIAS_DO_PRAZO) expect(tomDoPrazo(u)).toBeTruthy();
    for (const s of SITUACOES_DO_TETO) {
      expect(tomDoTeto(s), s).toBeTruthy();
      expect(ROTULO_DA_SITUACAO[s].length, s).toBeGreaterThan(5);
    }
  });

  it('85% do teto já é alerta, não só o estouro', () => {
    // Avisar só no estouro é avisar depois do desenquadramento.
    expect(tomDoTeto('perto')).toBe('alerta');
    expect(tomDoTeto('estourou')).toBe('alerta');
  });
});

describe('prazoEmTexto', () => {
  it('fala em dias perto e em meses longe', () => {
    const prazos = avaliarPrazos({ agora: SETEMBRO });
    expect(prazoEmTexto(prazos[0] ?? ({} as never))).toContain('meses');
  });

  it('hoje, amanhã e ontem têm palavra própria', () => {
    const base = avaliarPrazos({ agora: SETEMBRO })[0];
    if (base === undefined) throw new Error('esperava prazo');
    expect(prazoEmTexto({ ...base, diasRestantes: 0 })).toBe('é hoje');
    expect(prazoEmTexto({ ...base, diasRestantes: 1 })).toBe('é amanhã');
    expect(prazoEmTexto({ ...base, diasRestantes: -1 })).toBe('foi ontem');
    expect(prazoEmTexto({ ...base, diasRestantes: -5 })).toBe('foi há 5 dias');
  });
});

describe('diaEmTexto', () => {
  it('escreve a data como se lê no Brasil', () => {
    expect(diaEmTexto('2027-01-04')).toBe('04/01/2027');
  });

  it('entrada estranha não quebra a tela', () => {
    expect(diaEmTexto('xx')).toBe('xx');
  });
});

describe('resumoDoTeto', () => {
  it('lidera pelo que decide a ação: quanto cabe por mês', () => {
    // "83% do teto" não diz se dá para vender mais este mês.
    const teto = avaliarTeto(
      { receitaBruta: reaisParaCentavos(40_000), receitaExterna: reaisParaCentavos(0) },
      { agora: SETEMBRO },
    );
    const r = resumoDoTeto(teto);
    expect(r.startsWith('Cabem')).toBe(true);
    expect(r).toContain('por mês até dezembro');
  });

  it('em dezembro não promete média mensal, diz o que resta', () => {
    const teto = avaliarTeto(
      { receitaBruta: reaisParaCentavos(40_000), receitaExterna: reaisParaCentavos(0) },
      { agora: new Date('2026-12-10T12:00:00-03:00') },
    );
    expect(resumoDoTeto(teto)).toContain('Restam');
  });

  it('estourado não fala de quanto cabe, porque não cabe nada', () => {
    const teto = avaliarTeto(
      { receitaBruta: reaisParaCentavos(90_000), receitaExterna: reaisParaCentavos(0) },
      { agora: SETEMBRO },
    );
    const r = resumoDoTeto(teto);
    expect(r).not.toContain('Cabem');
    // Passa de 100% em vez de parar em 100%: quanto se passou do teto é o número
    // que a contabilidade vai pedir.
    expect(r).toContain('111%');
    expect(teto.usadoBp).toBeGreaterThan(10_000);
  });
});

describe('resumoDoCadastro', () => {
  it('catálogo vazio explica quando o cadastro começa', () => {
    expect(resumoDoCadastro(resumo())).toContain('por item');
  });

  it('conta pendentes, não totais, e diz o que acontece na data', () => {
    // O número que muda comportamento é quantos itens ainda impedem a nota.
    const r = resumoDoCadastro(
      resumo({ skus: [skuFiscal(), skuFiscal({ id: 's2' })], pendentes: 1 }),
    );
    expect(r).toContain('1 de 2');
    expect(r).toContain('04/01/2027');
    expect(r).toContain('rejeitada');
  });

  it('tudo completo diz que a nota sai, sem alarme residual', () => {
    const r = resumoDoCadastro(
      resumo({ skus: [skuFiscal(), skuFiscal({ id: 's2' })], pendentes: 0 }),
    );
    expect(r).toContain('Os 2 produtos ativos estão');
    expect(r).toContain('A nota de 2027 sai');
  });

  it('concorda no singular com um produto só', () => {
    // "Os 1 produtos ativos estão" apareceu na tela, e um produto só é justamente o
    // caso de quem está começando.
    const r = resumoDoCadastro(resumo({ skus: [skuFiscal()], pendentes: 0 }));
    expect(r).toContain('O único produto ativo está');
    expect(r).not.toContain('Os 1');
  });
});

describe('avisos e rótulos', () => {
  it('todo campo fiscal tem rótulo', () => {
    for (const c of CAMPOS_FISCAIS) expect(rotuloDoCampo(c).length, c).toBeGreaterThan(2);
  });

  it('código desconhecido não vira caixa vazia', () => {
    expect(descreverAviso(undefined)).toBeNull();
    expect(descreverAviso('inventado')).toBeNull();
  });

  it('todo código declarado tem título e corpo', () => {
    for (const c of CODIGOS_DE_AVISO) {
      const aviso = descreverAviso(c);
      expect(aviso, c).not.toBeNull();
      expect(aviso?.corpo.length ?? 0, c).toBeGreaterThan(30);
    }
  });

  it('a confirmação avisa que campo em branco apaga', () => {
    // É o comportamento que surpreende, então é o que a mensagem diz.
    expect(descreverAviso('gravado')?.corpo).toContain('apaga');
  });

  it('erro de formato diz o formato de cada campo e que nada foi gravado', () => {
    const aviso = descreverAviso('formato');
    expect(aviso?.corpo).toContain('oito dígitos');
    expect(aviso?.corpo).toContain('Nada foi gravado');
  });

  it('falha da sugestão mostra o motivo, que é o que diz o que fazer', () => {
    const aviso = descreverAviso(
      'sugestao_falhou',
      'o OpenRouter recusou a chave (401). Confira a linha LLM_API_KEY do .env.',
    );
    expect(aviso?.tom).toBe('erro');
    expect(aviso?.corpo).toContain('LLM_API_KEY');
    // E não é confundida com falha de gravação, que era o aviso usado antes.
    expect(aviso?.titulo).not.toContain('gravar');
  });

  it('falha da sugestão sem motivo ainda diz que o campo segue editável', () => {
    expect(descreverAviso('sugestao_falhou')?.corpo).toContain('preenchível à mão');
    expect(descreverAviso('sugestao_falhou', '   ')?.corpo).not.toContain('Motivo');
  });

  it('o motivo é cortado: a URL não pode virar um parágrafo na tela', () => {
    const corpo = descreverAviso('sugestao_falhou', 'x'.repeat(2_000))?.corpo ?? '';
    expect(corpo.length).toBeLessThan(450);
  });
});
