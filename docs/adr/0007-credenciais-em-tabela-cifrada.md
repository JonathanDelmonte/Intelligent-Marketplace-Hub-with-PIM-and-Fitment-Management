# ADR 0007 — Credenciais em tabela cifrada, não em `.env`

**Estado:** Aceito · **Data:** 2026-09-12 · Especificação, seção 3

## Contexto

O caminho padrão de qualquer tutorial é `ML_ACCESS_TOKEN` e `ML_REFRESH_TOKEN` no
`.env`. Funciona no primeiro dia e cria dois problemas que só aparecem depois.

1. Credencial em variável de ambiente **amarra uma conta ao deploy**. No dia do
   segundo perfil (ADR 0003) não há onde colocar a segunda: `ML_ACCESS_TOKEN_2`
   não é uma solução, é um sintoma.
2. Token OAuth do ML tem refresh, ou seja, **muda em runtime**. Variável de
   ambiente não é escrita por processo; ou se reimplanta a cada refresh, ou se
   guarda o token novo em outro lugar — e aí já existem duas fontes de verdade.

Parece detalhe de arrumação. É de modelagem.

## Decisão

Credencial é **dado**, e mora na tabela `credencial`, por perfil e por plataforma:

```
credencial
  id, perfil_id, plataforma, tipo (oauth|planilha|nenhuma),
  token_cifrado, refresh_token_cifrado, expira_em, escopos, ativo
```

- Cifragem **AES-256-GCM** em repouso, com AAD ligando o texto cifrado ao
  `(perfil_id, plataforma, campo)` — texto cifrado movido de linha não decifra.
- O `.env` guarda **uma** coisa: `CREDENCIAL_CHAVE_MESTRA`. É chave de cifragem,
  não credencial de plataforma, e é a única que pode morar lá.
- Refresh de token é uma escrita na tabela, dentro de transação, com o `expira_em`
  novo.
- O tipo `Credencial` nunca sai da camada de acesso com o token decifrado por
  padrão: decifrar é chamada explícita, para o segredo não vazar em log ou em
  serialização acidental de Server Component.

## Consequências

**A favor.** Segundo perfil é `INSERT`. Refresh não exige redeploy. Rotação de
chave mestra é um script sobre a tabela. Revogar acesso é `ativo = false`, sem
tocar em infraestrutura.

**Contra.** Uma chave mestra que, perdida, invalida todas as credenciais — que
então precisam ser reautorizadas. Aceito: reautorizar OAuth é minutos, e o risco
de vazar `.env` com token de produção é permanente.

**Não faz parte desta decisão** gerenciamento de segredo em cofre externo (Vault,
KMS). É a evolução natural da chave mestra quando houver mais de um ambiente.
