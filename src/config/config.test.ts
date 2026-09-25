import { describe, expect, it } from 'vitest';
import { AmbienteInvalido, PAPEIS, validarAmbiente } from './ambiente';
import { esquemaMarcaVisual, montarMarca, variaveisCssDaMarca } from './marca';

const CHAVE_VALIDA = Buffer.alloc(32, 7).toString('base64');

const minimo = {
  DATABASE_URL: 'postgres://localhost:5432/bancada',
  CREDENCIAL_CHAVE_MESTRA: CHAVE_VALIDA,
  BANCADA_PERFIL_PADRAO: 'perfil-de-teste',
};

describe('validarAmbiente', () => {
  it('aceita o mínimo e aplica os padrões', () => {
    const a = validarAmbiente(minimo);
    expect(a.BANCADA_PAPEL).toBe('interno');
    expect(a.NODE_ENV).toBe('development');
    expect(a.LLM_ORCAMENTO_PADRAO_CENTAVOS).toBe(500);
    expect(a.EXTRACAO_RPS_MAX).toBe(1);
  });

  it('exige DATABASE_URL', () => {
    expect(() => validarAmbiente({ ...minimo, DATABASE_URL: undefined })).toThrow(AmbienteInvalido);
  });

  it('exige chave mestra de exatamente 32 bytes', () => {
    expect(() =>
      validarAmbiente({ ...minimo, CREDENCIAL_CHAVE_MESTRA: Buffer.alloc(16).toString('base64') }),
    ).toThrow(/32 bytes/);
  });

  it('recusa chave mestra que não é base64', () => {
    expect(() => validarAmbiente({ ...minimo, CREDENCIAL_CHAVE_MESTRA: 'não é base64!' })).toThrow(
      /base64/,
    );
  });

  it('exige perfil padrão — sem ele não há query operacional possível', () => {
    expect(() => validarAmbiente({ ...minimo, BANCADA_PERFIL_PADRAO: undefined })).toThrow(
      AmbienteInvalido,
    );
  });

  it('recusa papel desconhecido', () => {
    expect(() => validarAmbiente({ ...minimo, BANCADA_PAPEL: 'revendedor' })).toThrow(
      AmbienteInvalido,
    );
  });

  it('lista todos os problemas de uma vez, não só o primeiro', () => {
    try {
      validarAmbiente({ BANCADA_PAPEL: 'errado' });
      expect.unreachable('deveria ter lançado');
    } catch (erro) {
      expect(erro).toBeInstanceOf(AmbienteInvalido);
      expect((erro as AmbienteInvalido).problemas.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('não guarda nenhuma credencial de plataforma — ADR 0007', () => {
    const a = validarAmbiente({
      ...minimo,
      ML_ACCESS_TOKEN: 'não deve aparecer',
      SHOPEE_PARTNER_KEY: 'não deve aparecer',
    });
    expect(JSON.stringify(a)).not.toContain('não deve aparecer');
  });

  it('coage números vindos de string, como ambiente sempre entrega', () => {
    const a = validarAmbiente({ ...minimo, LLM_ORCAMENTO_PADRAO_CENTAVOS: '1500' });
    expect(a.LLM_ORCAMENTO_PADRAO_CENTAVOS).toBe(1500);
  });

  it('código de cadastro vazio fecha o cadastro; curto demais é recusado (ADR 0011)', () => {
    expect(validarAmbiente(minimo).CADASTRO_CODIGO).toBeUndefined();
    expect(validarAmbiente({ ...minimo, CADASTRO_CODIGO: '' }).CADASTRO_CODIGO).toBeUndefined();
    expect(
      validarAmbiente({ ...minimo, CADASTRO_CODIGO: ' ABCD-EFGH-JKMN ' }).CADASTRO_CODIGO,
    ).toBe('ABCD-EFGH-JKMN');
    expect(() => validarAmbiente({ ...minimo, CADASTRO_CODIGO: 'abc' })).toThrow(/8 caracteres/);
  });

  it('versão publicada: hash de commit e hora ISO, ou nada (ADR 0010)', () => {
    const a = validarAmbiente({
      ...minimo,
      VERSAO: '3f9c2a1b7e4d5c6a8b9f0e1d2c3b4a5f6e7d8c9b',
      VERSAO_EM: '2026-09-25T14:05:00-03:00',
    });
    expect(a.VERSAO).toBe('3f9c2a1b7e4d5c6a8b9f0e1d2c3b4a5f6e7d8c9b');
    expect(a.VERSAO_EM).toBe('2026-09-25T14:05:00-03:00');
    const vazio = validarAmbiente({ ...minimo, VERSAO: '', VERSAO_EM: '' });
    expect(vazio.VERSAO).toBeUndefined();
    expect(vazio.VERSAO_EM).toBeUndefined();
    expect(() => validarAmbiente({ ...minimo, VERSAO: 'main; rm -rf /' })).toThrow(/hash/);
  });

  it('aceita a chave mestra em base64 de URL, que é o que alguns geradores dão', () => {
    const urlSegura = Buffer.alloc(32, 0xfb).toString('base64url');
    expect(urlSegura).toMatch(/[-_]/);
    expect(validarAmbiente({ ...minimo, CREDENCIAL_CHAVE_MESTRA: urlSegura })).toBeDefined();
  });

  it('sem endereço S3, o conteúdo fica em disco e as chaves não são pedidas', () => {
    const a = validarAmbiente({ ...minimo, ARMAZENAMENTO_S3_ENDPOINT: '' });
    expect(a.ARMAZENAMENTO_S3_ENDPOINT).toBeUndefined();
    expect(a.ARMAZENAMENTO_S3_BALDE).toBe('conteudo');
    expect(a.ARMAZENAMENTO_S3_REGIAO).toBe('us-east-1');
  });

  it('com endereço S3, chave e segredo são obrigatórios — na subida, não no primeiro envio', () => {
    const endereco = { ARMAZENAMENTO_S3_ENDPOINT: 'https://ref.supabase.co/storage/v1/s3' };
    expect(() => validarAmbiente({ ...minimo, ...endereco })).toThrow(/ARMAZENAMENTO_S3_CHAVE/);
    expect(() => validarAmbiente({ ...minimo, ...endereco, ARMAZENAMENTO_S3_CHAVE: 'k' })).toThrow(
      /ARMAZENAMENTO_S3_SEGREDO/,
    );
    const a = validarAmbiente({
      ...minimo,
      ...endereco,
      ARMAZENAMENTO_S3_CHAVE: 'k',
      ARMAZENAMENTO_S3_SEGREDO: 's',
    });
    expect(a.ARMAZENAMENTO_S3_ENDPOINT).toBe(endereco.ARMAZENAMENTO_S3_ENDPOINT);
  });

  it('o limite de conexões por processo tem padrão e teto', () => {
    expect(validarAmbiente(minimo).BANCO_CONEXOES).toBe(10);
    expect(validarAmbiente({ ...minimo, BANCO_CONEXOES: '5' }).BANCO_CONEXOES).toBe(5);
    expect(() => validarAmbiente({ ...minimo, BANCO_CONEXOES: '0' })).toThrow(AmbienteInvalido);
  });
});

describe('montarMarca', () => {
  it('usa o nome configurado, não um literal', () => {
    const m = montarMarca(
      validarAmbiente({
        ...minimo,
        BANCADA_NOME_SISTEMA: 'Outro Nome',
        BANCADA_CONSTRUTOR: 'Outra Empresa',
        BANCADA_ANO_COPYRIGHT: '2030',
      }),
    );
    expect(m.nomeSistema).toBe('Outro Nome');
    expect(m.construtor).toBe('Outra Empresa');
    expect(m.copyright).toBe('© 2030 Outra Empresa');
    expect(m.metaAutor).toBe('Outra Empresa');
  });

  it('no papel interno não há crédito de rodapé — não há leitor externo', () => {
    const m = montarMarca(validarAmbiente({ ...minimo, BANCADA_PAPEL: 'interno' }));
    expect(m.creditoRodape).toBeNull();
  });

  it('no papel cliente o crédito é captação', () => {
    const m = montarMarca(
      validarAmbiente({ ...minimo, BANCADA_PAPEL: 'cliente', BANCADA_CONSTRUTOR: 'Zirtuno' }),
    );
    expect(m.creditoRodape).toBe('desenvolvido por Zirtuno');
  });

  it('no papel produto o construtor é fabricante', () => {
    const m = montarMarca(
      validarAmbiente({ ...minimo, BANCADA_PAPEL: 'produto', BANCADA_CONSTRUTOR: 'Zirtuno' }),
    );
    expect(m.creditoRodape).toBe('um produto Zirtuno');
  });

  it('cobre os três papéis sem cair em caso não tratado', () => {
    for (const papel of PAPEIS) {
      const m = montarMarca(validarAmbiente({ ...minimo, BANCADA_PAPEL: papel }));
      expect(m.papel).toBe(papel);
    }
  });

  it('funciona sem perfil carregado', () => {
    const m = montarMarca(validarAmbiente(minimo));
    expect(m.visual).toBeNull();
    expect(variaveisCssDaMarca(null)).toEqual({});
  });
});

describe('marca visual do perfil', () => {
  it('valida hex de seis dígitos', () => {
    const v = esquemaMarcaVisual.parse({ nomeExibicao: 'Perfil A', corPrimaria: '#ab12cd' });
    expect(v.corPrimaria).toBe('#ab12cd');
    expect(v.corAcento).toBe('#0f766e');
    expect(v.logoUrl).toBeNull();
  });

  it('recusa cor em formato inválido', () => {
    expect(() => esquemaMarcaVisual.parse({ nomeExibicao: 'x', corPrimaria: 'azul' })).toThrow();
    expect(() => esquemaMarcaVisual.parse({ nomeExibicao: 'x', corPrimaria: '#abc' })).toThrow();
  });

  it('exige nome de exibição — é o que a UI mostra no lugar de um literal', () => {
    expect(() => esquemaMarcaVisual.parse({})).toThrow();
  });

  it('vira variável CSS, para trocar tema sem rebuild', () => {
    const v = esquemaMarcaVisual.parse({
      nomeExibicao: 'Perfil A',
      corPrimaria: '#111111',
      corAcento: '#222222',
    });
    expect(variaveisCssDaMarca(v)).toEqual({
      '--cor-primaria': '#111111',
      '--cor-acento': '#222222',
    });
  });
});
