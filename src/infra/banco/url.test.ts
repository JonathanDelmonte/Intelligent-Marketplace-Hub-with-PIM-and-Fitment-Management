import postgres from 'postgres';
import { describe, expect, it } from 'vitest';
import { urlParaODriver } from './url';

/** O formato em que o painel do Neon entrega a string de conexão. */
const DO_PAINEL =
  'postgresql://dono:npg_segredo@ep-exemplo-pooler.sa-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require';

describe('urlParaODriver', () => {
  it('tira o channel_binding da string como o painel do Neon entrega', () => {
    expect(urlParaODriver(DO_PAINEL)).toBe(
      'postgresql://dono:npg_segredo@ep-exemplo-pooler.sa-east-1.aws.neon.tech/neondb?sslmode=require',
    );
  });

  it('mantém o resto da consulta quando o channel_binding vem primeiro', () => {
    // O caso que a expressão regular do `preparar:env` quebrava: levava o `?` junto, e o
    // `sslmode` virava parte do nome do banco.
    expect(
      urlParaODriver('postgresql://u:s@host/banco?channel_binding=require&sslmode=require'),
    ).toBe('postgresql://u:s@host/banco?sslmode=require');
  });

  it('tira o `?` quando o channel_binding era o único parâmetro', () => {
    expect(urlParaODriver('postgresql://u:s@host/banco?channel_binding=require')).toBe(
      'postgresql://u:s@host/banco',
    );
  });

  it('devolve sem mudança nenhuma a URL que não tem o que tirar', () => {
    // Senha e parâmetro codificados de propósito: reescrever a URL inteira os recodificaria.
    const url =
      'postgres://u:p%40ss@localhost:5433/banco?options=-c%20search_path%3Dx&&sslmode=disable';
    expect(urlParaODriver(url)).toBe(url);
    expect(urlParaODriver('postgres://u:s@localhost:5432/banco')).toBe(
      'postgres://u:s@localhost:5432/banco',
    );
  });

  it('compara o nome inteiro do parâmetro, e não um pedaço dele', () => {
    const url = 'postgresql://u:s@host/banco?x_channel_binding=1&channel_binding_x=2';
    expect(urlParaODriver(url)).toBe(url);
  });

  it('tira o parâmetro que o driver repassaria ao servidor', async () => {
    // A razão da função, dita pelo próprio driver: sem ela, `channel_binding` vira
    // parâmetro de inicialização da sessão, e o Postgres recusa a conexão. Se uma versão
    // futura do `postgres.js` passar a entender o parâmetro, o primeiro `expect` avisa.
    const cru = postgres(DO_PAINEL, { max: 1 });
    const limpo = postgres(urlParaODriver(DO_PAINEL), { max: 1 });
    try {
      expect(Object.keys(cru.options.connection)).toContain('channel_binding');
      expect(Object.keys(limpo.options.connection)).not.toContain('channel_binding');
      expect(limpo.options.ssl).toBe('require');
    } finally {
      await Promise.all([cru.end({ timeout: 0 }), limpo.end({ timeout: 0 })]);
    }
  });
});
