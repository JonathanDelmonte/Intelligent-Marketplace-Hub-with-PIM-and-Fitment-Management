import { lerAmbiente } from '@/config/ambiente';
import { montarMarca } from '@/config/marca';

/**
 * Página inicial provisória.
 *
 * Existe para o shell do App Router ser verificável desde a fase 0; a tela de
 * verdade entra na fase 3, quando há base para mostrar. Não tem gate de
 * conexão, e nenhuma tela do sistema pode ter — ver ADR 0002, regra 1.
 */
export default function Pagina() {
  const marca = montarMarca(lerAmbiente());

  return (
    <main style={{ margin: '0 auto', maxWidth: '48rem', padding: '3rem 1.5rem' }}>
      <h1 style={{ fontSize: '1.5rem', margin: 0 }}>{marca.nomeSistema}</h1>
      <p style={{ color: 'var(--cor-texto-fraco)', marginTop: '0.5rem' }}>
        Hub de operação e inteligência para venda em marketplaces.
      </p>
    </main>
  );
}
