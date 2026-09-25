# ADR 0012 — A conta da Oracle fica no plano gratuito, e o servidor não parece ocioso

**Estado:** Aceito · **Data:** 2026-09-25 · Decisão do dono · Substitui a parte do
ADR 0010 que passava a conta para Pay As You Go

## Contexto

O ADR 0010 mandava passar a conta da Oracle para "Pay As You Go", com alerta de gasto:
os recursos Always Free continuam de graça nesse plano, e a Oracle deixa de recolher
máquina ociosa. Na hora de fazer, o dono viu o outro lado. No Pay As You Go, o que
passar do gratuito é cobrado no cartão — o alarme avisa, mas não impede. E só cadastrar
o meio de pagamento, que a tela exige antes do upgrade, fez uma pré-autorização de mais
de R$ 500 no cartão, devolvida em seguida.

A decisão do dono, em 25/09: **nenhuma possibilidade de cobrança**. "Tudo gratuito
primeiro" (CLAUDE.md, 3.7) vale também para o risco, não só para a conta do mês.

No plano gratuito (_Free Tier_) a Oracle não cobra: o que não é gratuito não funciona.
O que se perde é a proteção contra recolhimento. A regra que a Oracle publica para as
máquinas Always Free: é ociosa a máquina que, durante 7 dias, fica com o processador
(95º percentil), a rede **e** a memória abaixo de 20% — a memória vale para as máquinas
ARM, que é a deste sistema. Um sistema de uso pessoal fica quase parado o dia todo: com
a configuração do ADR 0010, usaria uns 10% da memória, e cairia na regra.

## Decisão

**1. A conta fica no plano gratuito.** Nenhum upgrade, nenhum meio de pagamento além do
que o cadastro pediu. O guia (`docs/hospedagem.md`, passo 2) diz para não clicar em
_Upgrade your account_ nem em _Add Payment Method_, e explica o porquê.

**2. O servidor segura 25% da memória** — o serviço `reserva` da composição de produção
(`servidor/reserva.mjs`). É memória que sobra: a máquina tem 12 GB e o sistema usa uns
10%. A memória é escrita, e não só pedida, para contar como usada, e é tocada de novo a
cada cinco minutos, para o Linux não a mandar para a swap. Não gasta processador nem
rede. A fração está na composição (`RESERVA_FRACAO`), e `'0'` desliga.

**3. O alarme de gasto continua**, como sinal: no plano gratuito ele não deveria
disparar nunca, e se disparar é porque algo mudou na conta.

## Consequências

**A favor.** Custo zero, e sem risco de cobrança — nem por engano, nem por recurso
criado errado. O cartão do cadastro pode até deixar de valer: o plano gratuito não o usa.

**Contra.**

- **A reserva usa a regra da Oracle como ela está publicada**, e a regra pode mudar.
  Se a máquina for recolhida mesmo assim, a cópia no Neon guarda os dados, e recriar o
  servidor pelo guia leva uns 20 minutos. O teste semanal do backup e a publicação
  falham quando o servidor some, e o GitHub avisa por e-mail.
- **Não deu para conferir a regra na documentação da Oracle a partir do ambiente de
  desenvolvimento** (o acesso ao site dela é bloqueado ali). A descrição acima é a que a
  Oracle publica e que a comunidade cita; vale conferir no painel se a Oracle mandar
  aviso de ociosidade.
- **Sem o Pay As You Go, criar a máquina ARM pode dar "Out of capacity"** com mais
  frequência. A saída é tentar de novo em outro horário.
- **Se um dia o sistema precisar de mais do que o gratuito**, o upgrade volta à mesa —
  por decisão do dono, com a reserva desligada e o alarme como limite.

**Obrigação para quem mantém:** a reserva é parte do servidor enquanto a conta for
gratuita. Mudar o tamanho da máquina muda a conta: 25% de outra memória.
