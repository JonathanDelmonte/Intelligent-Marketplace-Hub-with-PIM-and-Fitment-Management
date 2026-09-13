/**
 * Preparação da suíte: o `.env` entra antes de qualquer teste ser importado.
 *
 * O vitest não lê `.env` por conta própria, e a consequência era a pior possível:
 * com `DATABASE_URL` no `.env`, correto, os testes de banco **pulavam em silêncio**.
 * O resumo dizia "222 skipped", que é exatamente o que ele diz para quem não
 * configurou banco — então o sinal de "não testei" era idêntico ao de "não tenho
 * banco", e ninguém suspeitaria de estar no primeiro caso.
 *
 * Está aqui, e não em `vitest.config.ts`, por um detalhe do carregador de
 * configuração do Vite: o modo nativo que vai virar padrão não aceita import de
 * `.ts` sem extensão dentro do arquivo de configuração, e o aviso saía em **toda**
 * execução da suíte. Arquivo de preparação é referenciado por caminho, não
 * importado pela configuração, então o problema desaparece — e, de passagem, o
 * lugar é mais correto: carregar ambiente é preparação de teste, não configuração
 * de empacotador.
 */
import { carregarEnv } from '@/config/carregar-env';

carregarEnv();
