// Reserva de memória (ADR 0012).
//
// A conta da Oracle fica no plano gratuito, sem "Pay As You Go" — decisão do dono:
// nenhuma chance de cobrança. Nesse plano, a Oracle pode recolher a máquina que
// considera ociosa, e a regra que ela publica é: durante 7 dias, processador (95º
// percentil), rede **e** memória abaixo de 20%. Um sistema de uso pessoal passa o dia
// quase parado, e cairia na regra.
//
// Este processo segura uma fração da memória da máquina (25% por padrão) e fica
// dormindo: a memória conta como usada, e a máquina deixa de se encaixar na regra. Não
// gasta processador nem rede, e a máquina tem sobra — o sistema usa uns 10% dela.
//
// Dois cuidados, e os dois estão aqui:
//
// - A memória é **escrita**, não só pedida. Memória pedida e nunca tocada o Linux nem
//   entrega de verdade, e não contaria como usada.
// - A cada cinco minutos, a memória é tocada de novo. Página parada muito tempo é a
//   primeira que o Linux manda para a swap quando aperta, e aí ela deixaria de contar.
//
// RESERVA_FRACAO=0 desliga (por exemplo, numa conta paga, onde a regra não vale).

import { totalmem } from 'node:os';

const PAGINA = 4096;
const PEDACO = 256 * 1024 * 1024;
const MINUTOS_ENTRE_TOQUES = 5;

const fracao = Number(process.env.RESERVA_FRACAO ?? '0.25');
if (!Number.isFinite(fracao) || fracao < 0 || fracao > 0.5) {
  console.error(
    `reserva: RESERVA_FRACAO inválida (${String(process.env.RESERVA_FRACAO)}); use de 0 a 0.5`,
  );
  process.exit(1);
}

const sair = () => process.exit(0);
process.on('SIGTERM', sair);
process.on('SIGINT', sair);

// Um pedaço de cada vez, com uma volta do laço de eventos entre eles: encher gigabytes
// leva segundos, e um pedido para parar que chegue no meio tem de ser atendido.
const pedacos = [];
const alvo = Math.floor(totalmem() * fracao);
for (let reservado = 0; reservado < alvo; reservado += PEDACO) {
  pedacos.push(Buffer.alloc(Math.min(PEDACO, alvo - reservado), 1));
  await new Promise((pronto) => setImmediate(pronto));
}

const gb = (bytes) => (bytes / 1024 ** 3).toFixed(1);
console.log(
  fracao === 0
    ? 'reserva: desligada (RESERVA_FRACAO=0)'
    : `reserva: ${gb(alvo)} GB de ${gb(totalmem())} GB seguros (${Math.round(fracao * 100)}%)`,
);

let volta = 0;
setInterval(
  () => {
    volta = (volta + 1) % 251;
    for (const pedaco of pedacos) {
      for (let i = 0; i < pedaco.length; i += PAGINA) pedaco[i] = volta + 1;
    }
  },
  MINUTOS_ENTRE_TOQUES * 60 * 1000,
);
