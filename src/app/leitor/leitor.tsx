'use client';

/**
 * O leitor de código de barras (M14).
 *
 * Componente de cliente porque precisa de câmera, de armazenamento local e de
 * saber se há rede — três coisas que só existem no navegador.
 *
 * ## A ordem das coisas é a ordem da loja
 *
 * A pessoa está de pé, com o celular na mão, e o produto na outra. Então:
 *
 * 1. **O campo de custo vem primeiro e fica sempre visível.** É o único dado que
 *    só ela tem, e sem ele não existe veredito. Pedir depois de ler o código
 *    obrigaria a guardar o produto para digitar.
 * 2. **Entrada manual do código funciona sempre.** Câmera falha: código rasgado,
 *    embalagem amassada, luz ruim, permissão negada. Digitar treze dígitos é pior
 *    que apontar a câmera e é infinitamente melhor que não ter resposta.
 * 3. **A leitura é gravada antes de qualquer rede.** Loja tem sinal ruim, e a
 *    informação não pode depender disso.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { Veredito } from '@/dominio/leitor/veredito';
import { avaliarGtin, sincronizarLeituras, type AvaliacaoDeGtin } from './acoes';
import {
  DEVOLUCAO_PRESUMIDA_BP,
  EMBALAGEM_PRESUMIDA_CENTAVOS,
  INTERVALO_DE_LEITURA_MS,
  PESO_PRESUMIDO_GRAMAS,
} from './constantes';
import { escolherDetector, temDetectorNativo, type DetectorDeCodigo } from './detector';
import { FilaDeLeituras, escolherArmazenamento, type LeituraLocal } from './fila-local';
import {
  AVISO_SEM_PERSISTENCIA,
  CHAMADA_DO_VEREDITO,
  avaliarLocalmente,
  contarCodigos,
  COR_DO_VEREDITO,
  custoPorUnidade,
  descreverConfianca,
  descreverFila,
  formatarMarkup,
  formatarPercentual,
  formatarReais,
  interpretarCusto,
  novoIdLocal,
} from './apresentacao';
import estilo from './leitor.module.css';

type EstadoDaCamera = 'desligada' | 'pedindo' | 'ligada' | 'negada' | 'sem_camera';

const CLASSE_DO_MOTIVO: Readonly<Record<string, string>> = {
  vermelho: estilo.motivoVermelho,
  amarelo: estilo.motivoAmarelo,
  informativo: estilo.motivoInformativo,
};

/**
 * Se há rede, por `useSyncExternalStore`.
 *
 * O prefixo `use` é exigência mecânica do React, não escolha de idioma — é como
 * o compilador e o lint reconhecem um hook. A seção 4 do CLAUDE.md já prevê o
 * caso: primitiva de infraestrutura fica no idioma da biblioteca.
 *
 * É a ferramenta certa para ler estado que vive fora do React, e evita o padrão
 * de `useEffect` mais `setState` — que aqui não seria só estilo: `setState`
 * síncrono dentro de efeito provoca render em cascata, e o instantâneo de
 * servidor resolve a divergência de hidratação sem `montado` nem bandeira.
 */
function useRede(): boolean {
  return useSyncExternalStore(
    (aoMudar) => {
      window.addEventListener('online', aoMudar);
      window.addEventListener('offline', aoMudar);
      return () => {
        window.removeEventListener('online', aoMudar);
        window.removeEventListener('offline', aoMudar);
      };
    },
    () => navigator.onLine,
    // No servidor presume-se rede: é o caso comum, e o cliente corrige no
    // primeiro render sem piscar rótulo errado.
    () => true,
  );
}

export function Leitor({ quantidadeNaBase }: { readonly quantidadeNaBase: number }) {
  const [custoTexto, setCustoTexto] = useState('');
  const [unidadesTexto, setUnidadesTexto] = useState('1');
  const [codigoTexto, setCodigoTexto] = useState('');
  const [avaliacao, setAvaliacao] = useState<AvaliacaoDeGtin | null>(null);
  const [avaliando, setAvaliando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [camera, setCamera] = useState<EstadoDaCamera>('desligada');
  const [detectorUsado, setDetectorUsado] = useState<string | null>(null);
  const [pendentes, setPendentes] = useState(0);
  const [travadas, setTravadas] = useState(0);
  const [persistente, setPersistente] = useState(true);

  const online = useRede();

  const video = useRef<HTMLVideoElement | null>(null);
  const fluxo = useRef<MediaStream | null>(null);
  const detector = useRef<DetectorDeCodigo | null>(null);
  const fila = useRef<FilaDeLeituras | null>(null);
  const ultimoIdLocal = useRef<string | null>(null);

  /**
   * A fila é construída no primeiro uso, não num efeito de montagem.
   *
   * Duas razões. A primeira é de regra: detectar IndexedDB e guardar o resultado
   * em estado dentro de um efeito é `setState` síncrono em efeito. A segunda é de
   * uso, e é melhor — o aviso de "pode perder leitura" só faz sentido quando
   * existe leitura, e antes da primeira não há nada a perder.
   */
  function obterFila(): FilaDeLeituras {
    if (fila.current === null) {
      const escolhido = escolherArmazenamento();
      if (!escolhido.persistente) setPersistente(false);
      fila.current = new FilaDeLeituras(escolhido.armazenamento, (leituras) =>
        sincronizarLeituras(leituras.map(paraEnviada)),
      );
    }
    return fila.current;
  }

  async function atualizarContadores(): Promise<void> {
    const f = obterFila();
    setPendentes(await f.quantidadePendente());
    setTravadas((await f.travadas()).length);
  }

  async function descarregar(): Promise<void> {
    await obterFila().descarregar();
    await atualizarContadores();
  }

  // Quando a rede volta, descarrega. É o momento em que a fila existe para ser
  // usada, e esperar a pessoa apertar um botão seria transferir para ela um
  // trabalho que o navegador avisa sozinho.
  //
  // A descarga acontece no CALLBACK do evento, não no corpo do efeito: efeito que
  // chama `setState` de forma síncrona provoca render em cascata. Aqui o efeito só
  // assina, que é para o que ele serve.
  useEffect(() => {
    const aoVoltar = (): void => {
      void descarregar();
    };
    window.addEventListener('online', aoVoltar);
    return () => {
      window.removeEventListener('online', aoVoltar);
    };
    // `descarregar` só toca em `ref` e em função de `setState`, que são estáveis,
    // então a lista vazia está correta e a dependência seria ruído.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Desliga a câmera ao sair da tela. Lê o fluxo do ref, então não depende de
  // nenhuma função e roda uma vez só.
  useEffect(
    () => () => {
      fluxo.current?.getTracks().forEach((t) => {
        t.stop();
      });
      fluxo.current = null;
    },
    [],
  );

  function pararCamera(): void {
    fluxo.current?.getTracks().forEach((t) => {
      t.stop();
    });
    fluxo.current = null;
    if (video.current !== null) video.current.srcObject = null;
    setCamera('desligada');
  }

  async function ligarCamera(): Promise<void> {
    if (navigator.mediaDevices === undefined) {
      setCamera('sem_camera');
      return;
    }

    setCamera('pedindo');
    try {
      const obtido = await navigator.mediaDevices.getUserMedia({
        // `environment` é a câmera de trás. A da frente não serve para ler o
        // código de um produto que está na sua outra mão.
        video: { facingMode: { ideal: 'environment' } },
      });
      fluxo.current = obtido;
      if (video.current !== null) {
        video.current.srcObject = obtido;
        await video.current.play();
      }
      detector.current ??= await escolherDetector();
      setDetectorUsado(detector.current.nome);
      setCamera('ligada');
    } catch {
      // Permissão negada e ausência de câmera chegam como o mesmo erro em alguns
      // navegadores. A tela trata as duas como "use a entrada manual".
      setCamera('negada');
    }
  }

  async function avaliar(codigo: string): Promise<void> {
    const custo = interpretarCusto(custoTexto);
    if (custo === null) {
      setErro('informe o custo antes de ler o código');
      return;
    }

    const unidades = Number.parseInt(unidadesTexto, 10);
    const { unitario } = custoPorUnidade(custo, Number.isFinite(unidades) ? unidades : 1);

    setAvaliando(true);
    setErro(null);

    const idLocal = novoIdLocal();
    ultimoIdLocal.current = idLocal;
    const lidoEm = new Date().toISOString();

    const registrar = async (veredito: string, avaliado: AvaliacaoDeGtin | null) =>
      obterFila().enfileirar({
        idLocal,
        gtin: codigo,
        custoUnitario: unitario,
        unidadesNoLote: Number.isFinite(unidades) && unidades > 1 ? unidades : null,
        veredito,
        precoDeReferencia: avaliado?.veredito?.precoDeReferencia ?? null,
        margemBp: avaliado?.veredito?.margem?.margemPontosBase ?? null,
        confiancaBp: avaliado?.veredito?.confiancaBp ?? null,
        motivos: avaliado?.veredito?.motivos.map((m) => ({ ...m })) ?? null,
        decisao: null,
        local: null,
        lidoEm,
      });

    /*
     * A leitura é gravada ANTES de qualquer rede, e essa ordem é o requisito
     * inteiro do modo offline.
     *
     * A primeira versão chamava o servidor primeiro e gravava depois, dentro do
     * `try`. Sem rede, a chamada falhava, o `catch` assumia, e a leitura nunca
     * era gravada — "funciona offline" era falso, e falso do jeito pior: a tela
     * dizia "tudo sincronizado" com a leitura perdida. Achado testando com a rede
     * desligada no navegador, não lendo o código.
     *
     * Grava com `sem_dado`; se a avaliação vier, o mesmo `idLocal` ATUALIZA a
     * leitura em vez de duplicar — é para isso que a chave de idempotência existe
     * nas duas pontas.
     */
    await registrar('sem_dado', null);
    await atualizarContadores();

    try {
      const resultado = await avaliarGtin({
        gtin: codigo,
        custoCentavos: custo,
        ...(Number.isFinite(unidades) && unidades > 1 ? { unidadesNoLote: unidades } : {}),
      });
      setAvaliacao(resultado);
      await registrar(resultado.veredito?.veredito ?? 'sem_dado', resultado);
      await descarregar();
    } catch {
      // Sem rede não há preço praticado, porque ele mora no banco. O que dá para
      // saber é o que o módulo de GTIN sabe sozinho — e descobrir na hora que o
      // código foi lido errado vale mais que um veredito que não vem.
      const local = avaliarLocalmente(codigo);
      setAvaliacao({
        gtinLido: codigo,
        gtinValido: local.gtinValido,
        veredito: null,
        skuProprio: null,
        ocorrencias: 0,
        avaliacoesAnteriores: 0,
        presumido: {
          pesoGramas: PESO_PRESUMIDO_GRAMAS,
          embalagemCentavos: EMBALAGEM_PRESUMIDA_CENTAVOS,
          devolucaoBp: DEVOLUCAO_PRESUMIDA_BP,
        },
      });
      setErro(
        local.gtinValido === null
          ? 'sem rede, e este código não passa no dígito verificador. Confira os dígitos.'
          : 'sem rede: guardei a leitura e avalio quando a conexão voltar.',
      );
    } finally {
      setAvaliando(false);
    }
  }

  async function registrarDecisao(decisao: 'comprou' | 'nao_comprou'): Promise<void> {
    const idLocal = ultimoIdLocal.current;
    const atual = avaliacao;
    if (idLocal === null || atual === null) return;

    await obterFila().enfileirar({
      idLocal,
      gtin: atual.gtinLido,
      custoUnitario: interpretarCusto(custoTexto),
      unidadesNoLote: null,
      veredito: atual.veredito?.veredito ?? 'sem_dado',
      precoDeReferencia: atual.veredito?.precoDeReferencia ?? null,
      margemBp: atual.veredito?.margem?.margemPontosBase ?? null,
      confiancaBp: atual.veredito?.confiancaBp ?? null,
      motivos: atual.veredito?.motivos.map((m) => ({ ...m })) ?? null,
      decisao,
      local: null,
      lidoEm: new Date().toISOString(),
    });
    await descarregar();

    // Limpa o código, não o custo: no saldão o item seguinte costuma ter o mesmo
    // preço, e apagar obrigaria a redigitar quarenta vezes.
    setCodigoTexto('');
    setAvaliacao(null);
    ultimoIdLocal.current = null;
  }

  // O laço de leitura. Intervalo, e não `requestAnimationFrame`: quatro
  // tentativas por segundo bastam e poupam bateria, que é recurso escasso numa
  // sessão de quarenta itens no balcão.
  useEffect(() => {
    if (camera !== 'ligada') return undefined;

    let ativo = true;
    const temporizador = setInterval(() => {
      const v = video.current;
      const d = detector.current;
      if (!ativo || v === null || d === null || avaliando) return;

      void d
        .detectar(v)
        .then((achados) => {
          const primeiro = achados[0];
          if (primeiro === undefined || !ativo) return;
          setCodigoTexto(primeiro);
          void avaliar(primeiro);
        })
        .catch(() => {
          // Quadro que não decodifica é o caso normal, não erro.
        });
    }, INTERVALO_DE_LEITURA_MS);

    return () => {
      ativo = false;
      clearInterval(temporizador);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera, avaliando, custoTexto, unidadesTexto]);

  const custoValido = interpretarCusto(custoTexto) !== null;
  const estadoDaFila = descreverFila({ pendentes, travadas, online, persistente });

  return (
    <div>
      <section className={estilo.secao}>
        <div className={estilo.formulario}>
          <label className={estilo.rotulo} htmlFor="custo">
            Quanto custa, por unidade
          </label>
          <input
            id="custo"
            className={
              custoTexto !== '' && !custoValido
                ? `${estilo.campo} ${estilo.campoInvalido}`
                : estilo.campo
            }
            inputMode="decimal"
            autoComplete="off"
            placeholder="12,50"
            value={custoTexto}
            onChange={(e) => {
              setCustoTexto(e.target.value);
            }}
          />
          {custoTexto !== '' && !custoValido ? (
            <p className={estilo.ajudaErro}>
              não entendi esse valor. Use vírgula para centavos, sem separador de milhar.
            </p>
          ) : (
            <p className={estilo.ajuda}>
              fica preenchido entre leituras, para o saldão de preço único.
            </p>
          )}

          <div className={estilo.linha}>
            <div>
              <label className={estilo.rotulo} htmlFor="unidades">
                Unidades no lote
              </label>
              <input
                id="unidades"
                className={estilo.campo}
                inputMode="numeric"
                value={unidadesTexto}
                onChange={(e) => {
                  setUnidadesTexto(e.target.value);
                }}
              />
            </div>
            <div>
              <label className={estilo.rotulo} htmlFor="codigo">
                Código
              </label>
              <input
                id="codigo"
                className={estilo.campo}
                inputMode="numeric"
                autoComplete="off"
                placeholder="7896541200121"
                value={codigoTexto}
                onChange={(e) => {
                  setCodigoTexto(e.target.value);
                }}
              />
            </div>
          </div>

          <button
            type="button"
            className={estilo.botao}
            disabled={avaliando || codigoTexto.trim() === '' || !custoValido}
            onClick={() => {
              void avaliar(codigoTexto.trim());
            }}
          >
            {avaliando ? 'avaliando...' : 'Avaliar'}
          </button>

          <div className={estilo.linhaDeBotoes}>
            {camera === 'ligada' ? (
              <button type="button" className={estilo.botaoSecundario} onClick={pararCamera}>
                desligar câmera
              </button>
            ) : (
              <button
                type="button"
                className={estilo.botaoSecundario}
                onClick={() => {
                  void ligarCamera();
                }}
              >
                {camera === 'pedindo' ? 'pedindo acesso...' : 'ler com a câmera'}
              </button>
            )}
            {detectorUsado === null ? null : (
              <span className={estilo.leituraDetalhe}>
                decodificador: {detectorUsado === 'nativo' ? 'do sistema' : 'WebAssembly'}
              </span>
            )}
          </div>

          {erro === null ? null : <div className={estilo.aviso}>{erro}</div>}
        </div>
      </section>

      {camera === 'ligada' || camera === 'pedindo' ? (
        <section className={estilo.secao}>
          <div className={estilo.envelopeDaCamera}>
            <video ref={video} className={estilo.camera} muted playsInline />
            <div className={estilo.alvo} />
          </div>
        </section>
      ) : null}

      {camera === 'negada' || camera === 'sem_camera' ? (
        <div className={estilo.aviso}>
          sem acesso à câmera. Digite o código no campo acima — a avaliação é a mesma.
        </div>
      ) : null}

      {camera === 'desligada' && !temDetectorNativo() ? (
        <p className={estilo.ajuda}>
          este navegador não tem decodificador nativo: ao ligar a câmera, o leitor baixa um
          decodificador de 900 KB uma única vez, e depois funciona offline.
        </p>
      ) : null}

      {avaliacao === null ? null : <PainelDoVeredito avaliacao={avaliacao} />}

      {avaliacao?.veredito === null || avaliacao === null ? null : (
        <div className={estilo.linhaDeBotoes}>
          <button
            type="button"
            className={estilo.botaoSecundario}
            onClick={() => {
              void registrarDecisao('comprou');
            }}
          >
            comprei
          </button>
          <button
            type="button"
            className={estilo.botaoSecundario}
            onClick={() => {
              void registrarDecisao('nao_comprou');
            }}
          >
            não comprei
          </button>
        </div>
      )}

      <div
        className={
          estadoDaFila.alerta
            ? `${estilo.barraDeEstado} ${estilo.barraDeEstadoAlerta}`
            : estilo.barraDeEstado
        }
      >
        <span>
          <span className={estilo.etiqueta}>{online ? 'com rede' : 'sem rede'}</span>{' '}
          {estadoDaFila.texto}
        </span>
        <span>{contarCodigos(quantidadeNaBase)}</span>
      </div>

      {travadas > 0 ? (
        <button
          type="button"
          className={estilo.botaoSecundario}
          onClick={() => {
            void (async () => {
              await fila.current?.destravar();
              await descarregar();
            })();
          }}
        >
          tentar enviar de novo
        </button>
      ) : null}

      {persistente ? null : <div className={estilo.aviso}>{AVISO_SEM_PERSISTENCIA}</div>}
    </div>
  );
}

function PainelDoVeredito({ avaliacao }: { readonly avaliacao: AvaliacaoDeGtin }) {
  if (avaliacao.gtinValido === null) {
    return (
      <section className={estilo.secao}>
        <div className={estilo.veredito} style={{ borderLeftColor: 'var(--cor-erro)' }}>
          <div className={estilo.chamada} style={{ color: 'var(--cor-erro)' }}>
            Código inválido
          </div>
          <p className={estilo.chamadaApoio}>
            {avaliacao.gtinLido} não passa no dígito verificador. Provavelmente foi lido ou digitado
            errado — confira antes de decidir, porque código errado acha o produto errado.
          </p>
        </div>
      </section>
    );
  }

  const v = avaliacao.veredito;
  const veredito: Veredito = v?.veredito ?? 'sem_dado';
  // Sem veredito é o caso offline: o código é válido, mas o preço praticado mora
  // no banco. A tela mostra o que sabe e não finge o resto.
  const semAvaliacao = v === null;
  const confianca = descreverConfianca(v?.confiancaBp ?? 0);

  return (
    <section className={estilo.secao}>
      <div className={estilo.veredito} style={{ borderLeftColor: COR_DO_VEREDITO[veredito] }}>
        <div className={estilo.chamada} style={{ color: COR_DO_VEREDITO[veredito] }}>
          {CHAMADA_DO_VEREDITO[veredito]}
        </div>
        <p className={estilo.chamadaApoio}>
          {semAvaliacao ? 'código válido · ' : ''}
          {avaliacao.gtinValido.formatado} · {avaliacao.gtinValido.tipo}
          {avaliacao.gtinValido.nivelDeEmbalagem === 'agrupamento' ? ' · caixa' : ''} ·{' '}
          {confianca.rotulo}
          {avaliacao.gtinValido.prefixo === null ? '' : ` · ${avaliacao.gtinValido.prefixo}`}
        </p>

        {v?.custoMaximoParaComprar === null || v === null ? null : (
          <p style={{ marginTop: '0.75rem', marginBottom: 0 }}>
            pago até{' '}
            <span className={estilo.numeroDestaque} style={{ color: COR_DO_VEREDITO[veredito] }}>
              {formatarReais(v.custoMaximoParaComprar)}
            </span>{' '}
            por unidade
          </p>
        )}

        <div className={estilo.grade}>
          <Item rotulo="preço praticado" valor={formatarReais(v?.precoDeReferencia ?? null)} />
          <Item rotulo="margem" valor={formatarReais(v?.margem?.margemReais ?? null)} />
          <Item rotulo="margem %" valor={formatarPercentual(v?.margem?.margemPontosBase ?? null)} />
          <Item rotulo="markup" valor={formatarMarkup(v?.margem?.markupSobreCusto ?? null)} />
          <Item rotulo="anúncios vistos" valor={String(avaliacao.ocorrencias)} />
          <Item
            rotulo="já avaliei"
            valor={
              avaliacao.avaliacoesAnteriores === 0
                ? 'primeira vez'
                : `${String(avaliacao.avaliacoesAnteriores)}x`
            }
          />
        </div>

        {avaliacao.skuProprio === null ? null : (
          <p className={estilo.chamadaApoio} style={{ marginTop: '0.75rem' }}>
            já é seu: {avaliacao.skuProprio.titulo}
            {avaliacao.skuProprio.custoAtual === null
              ? ''
              : ` · custo atual ${formatarReais(avaliacao.skuProprio.custoAtual)}`}
          </p>
        )}

        {v === null ? null : (
          <ul className={estilo.motivos}>
            {v.motivos.map((m) => (
              <li
                key={m.codigo}
                className={`${estilo.motivo} ${CLASSE_DO_MOTIVO[m.severidade] ?? ''}`}
              >
                {m.mensagem}
              </li>
            ))}
          </ul>
        )}

        <p className={estilo.ajuda} style={{ marginTop: '0.75rem' }}>
          presumindo {String(avaliacao.presumido.pesoGramas)} g de peso,{' '}
          {formatarReais(avaliacao.presumido.embalagemCentavos)} de embalagem e{' '}
          {formatarPercentual(avaliacao.presumido.devolucaoBp)} de devolução. Peso errado muda a
          faixa de frete e portanto a margem.
        </p>
      </div>
    </section>
  );
}

function Item({ rotulo, valor }: { readonly rotulo: string; readonly valor: string }) {
  return (
    <div className={estilo.item}>
      <div className={estilo.itemRotulo}>{rotulo}</div>
      <div className={estilo.itemValor}>{valor}</div>
    </div>
  );
}

/** Converte a leitura local para a forma que a ação do servidor aceita. */
function paraEnviada(l: LeituraLocal) {
  return {
    idLocal: l.idLocal,
    gtin: l.gtin,
    custoUnitario: l.custoUnitario,
    unidadesNoLote: l.unidadesNoLote,
    veredito: l.veredito as Veredito,
    precoDeReferencia: l.precoDeReferencia,
    margemBp: l.margemBp,
    confiancaBp: l.confiancaBp,
    motivos: l.motivos === null ? null : l.motivos.map((m) => ({ ...m })),
    decisao: l.decisao as 'comprou' | 'nao_comprou' | 'indeciso' | null,
    local: l.local,
    lidoEm: l.lidoEm,
  };
}
