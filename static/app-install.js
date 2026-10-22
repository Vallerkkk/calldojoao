let deferredPrompt, installed = false, prompting = false;
export const isAppWindow = () => installed || matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const changed = () => window.dispatchEvent(new Event('orbita-install-state'));
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault(); deferredPrompt = event; changed();
});
window.addEventListener('appinstalled', () => { installed = true; deferredPrompt = undefined; changed(); });

export async function requestAppInstall() {
  if (isAppWindow()) return 'installed';
  if (prompting) return 'busy';
  if (!deferredPrompt) return 'unavailable';
  const prompt = deferredPrompt; deferredPrompt = undefined; prompting = true; changed();
  try {
    await prompt.prompt();
    const choice = await prompt.userChoice;
    return choice?.outcome === 'accepted' ? 'accepted' : 'dismissed';
  } catch { return 'unavailable'; }
  finally { prompting = false; changed(); }
}

if (document.body?.dataset.installPage === 'true') {
  const button = document.getElementById('install-app'), status = document.getElementById('install-status');
  function update() {
    button.disabled = prompting || isAppWindow();
    button.textContent = isAppWindow() ? 'Órbita instalado neste navegador' : 'Instalar versão do navegador';
    if (isAppWindow()) status.textContent = 'O aplicativo está pronto. Abra a Órbita pelo ícone ou continue usando o site.';
  }
  window.addEventListener('orbita-install-state', update); update();
  button.onclick = async () => {
    const result = await requestAppInstall();
    status.textContent = ({accepted:'Solicitação aceita. Aguarde o navegador concluir a instalação.',
      dismissed:'Instalação cancelada. Você pode tentar mais tarde pelo menu do navegador.',
      unavailable:'Use a opção de instalar aplicativo no menu do seu navegador. Veja o passo a passo abaixo.',
      installed:'O aplicativo já está instalado neste navegador.'})[result] || 'Aguarde a confirmação do navegador.';
    if (result === 'unavailable') document.getElementById('install-help').focus();
    update();
  };
  if ('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('/sw.js', {scope:'/'}).catch(() => {
    status.textContent = 'O navegador não conseguiu preparar a instalação. Verifique a conexão e use as instruções abaixo.';
  });
}
