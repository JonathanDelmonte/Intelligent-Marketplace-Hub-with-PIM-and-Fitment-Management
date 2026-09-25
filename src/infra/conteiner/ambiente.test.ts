import { describe, expect, it } from 'vitest';
import { comTls, prepararAmbienteDoConteiner } from './ambiente';

const AGORA = new Date('2026-09-25T18:30:00.000Z');
/** Um ambiente como o `process.env`: qualquer chave, com valor ou sem. */
const ambiente = (variaveis: Record<string, string | undefined>) => variaveis;
const COMMIT = '5bba3e6a1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f';
/** O formato em que o painel do Supabase entrega o endereço do "Session pooler". */
const DO_SUPABASE =
  'postgresql://postgres.abcdefghijkl:s3nh@-c0m%2Fbarra@aws-0-us-east-1.pooler.supabase.com:5432/postgres';

describe('prepararAmbienteDoConteiner', () => {
  it('a versão vem do commit que o Render informa, e a hora é a da subida', () => {
    const preparado = prepararAmbienteDoConteiner(ambiente({ RENDER_GIT_COMMIT: COMMIT }), AGORA);
    expect(preparado['VERSAO']).toBe(COMMIT);
    expect(preparado['VERSAO_EM']).toBe('2026-09-25T18:30:00.000Z');
  });

  it('versão dada explicitamente vence a do Render', () => {
    const preparado = prepararAmbienteDoConteiner(
      ambiente({ VERSAO: 'abc1234', VERSAO_EM: '2026-09-01T10:00:00Z', RENDER_GIT_COMMIT: COMMIT }),
      AGORA,
    );
    expect(preparado['VERSAO']).toBe('abc1234');
    expect(preparado['VERSAO_EM']).toBe('2026-09-01T10:00:00Z');
  });

  it('commit que não é hash não vira versão (a validação do ambiente recusaria)', () => {
    const preparado = prepararAmbienteDoConteiner(ambiente({ RENDER_GIT_COMMIT: 'main' }), AGORA);
    expect(preparado['VERSAO']).toBeUndefined();
  });

  it('o resto do ambiente passa intacto, e o original não é tocado', () => {
    const original = ambiente({ CADASTRO_CODIGO: 'codigo', DATABASE_URL: DO_SUPABASE });
    const preparado = prepararAmbienteDoConteiner(original, AGORA);
    expect(preparado['CADASTRO_CODIGO']).toBe('codigo');
    expect(preparado['DATABASE_URL']).toBe(`${DO_SUPABASE}?sslmode=require`);
    expect(original['DATABASE_URL']).toBe(DO_SUPABASE);
  });
});

describe('comTls', () => {
  it('o endereço do Supabase ganha sslmode=require, com a senha como veio', () => {
    expect(comTls(DO_SUPABASE)).toBe(`${DO_SUPABASE}?sslmode=require`);
  });

  it('com parâmetros, entra com &', () => {
    expect(comTls('postgres://u:s@db.exemplo.com/banco?application_name=hub')).toBe(
      'postgres://u:s@db.exemplo.com/banco?application_name=hub&sslmode=require',
    );
  });

  it('quem já escolheu o sslmode fica com a escolha', () => {
    const url = 'postgres://u:s@db.exemplo.com/banco?sslmode=disable';
    expect(comTls(url)).toBe(url);
  });

  it('banco na própria máquina fica sem TLS', () => {
    expect(comTls('postgres://u:s@localhost:5432/banco')).toBe(
      'postgres://u:s@localhost:5432/banco',
    );
    expect(comTls('postgres://u:s@127.0.0.1/banco')).toBe('postgres://u:s@127.0.0.1/banco');
  });

  it('endereço que não se deixa ler volta como veio', () => {
    expect(comTls('isto não é url')).toBe('isto não é url');
  });
});
