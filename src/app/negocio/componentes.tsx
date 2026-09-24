/**
 * Componentes de servidor da tela "Meu negócio".
 *
 * O formulário é de cliente e mora em `formulario-do-negocio.tsx`; aqui fica o que não
 * precisa de JavaScript no navegador.
 */
import type { Aviso } from './apresentacao';
import estilo from './negocio.module.css';

export function AvisoDaAcao({ aviso }: { readonly aviso: Aviso }) {
  const classe =
    aviso.tom === 'erro'
      ? `${estilo.aviso} ${estilo.avisoErro}`
      : aviso.tom === 'atencao'
        ? `${estilo.aviso} ${estilo.avisoAtencao}`
        : estilo.aviso;
  return (
    <div className={classe} role="status">
      <strong className={estilo.avisoTitulo}>{aviso.titulo}</strong>
      <span className={estilo.avisoCorpo}>{aviso.corpo}</span>
    </div>
  );
}
