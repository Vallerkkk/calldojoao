import {DECORATIONS} from './profile-decoration-catalog.js';
export function initProfileAppearance(ctx){const {el,button,showDialog,loadProfilePrefs,saveProfilePrefs,applyDecorations,toast}=ctx,$=id=>document.getElementById(id);
function openProfileCustomizer() {
  showDialog('Personalizar perfil', container => {
    const card = el('div', 'profile-edit-card'); container.append(card); const inner = el('div','profile-edit-content'); card.append(inner); container = inner;
    const prefs = loadProfilePrefs();
    const font = el('select');
    font.innerHTML = '<option value="">Padrão</option><option value="inter">Inter</option><option value="mono">Monospace</option><option value="serif">Serif</option><option value="display">Display</option>';
    font.value = prefs.font || '';
    const effect = el('select');
    effect.innerHTML = '<option value="">Nenhum</option><option value="glow">Glow</option><option value="shimmer">Shimmer</option><option value="rainbow">Rainbow</option>';
    effect.value = prefs.effect || '';
    const preview=el('div','profile-color-preview',ctx.state().profile?.display_name||'Sua capa');
    const bannerColor = el('input'); bannerColor.type = 'color'; bannerColor.value = prefs.bannerColor || '#7c5cff';
    preview.style.backgroundColor=bannerColor.value;bannerColor.oninput=()=>preview.style.backgroundColor=bannerColor.value;
    const fontLabel = el('label','field','Fonte do nome'); fontLabel.append(font);
    const effectLabel = el('label','field','Efeito do nome'); effectLabel.append(effect);
    const colorLabel = el('label','field','Cor da capa'); colorLabel.append(bannerColor);
    container.append(preview,el('p','muted','Personalização local do seu perfil neste dispositivo.'),fontLabel, effectLabel, colorLabel,
      button('Salvar', () => {
        saveProfilePrefs({ ...loadProfilePrefs(),font: font.value, effect: effect.value, bannerColor: bannerColor.value });
        $('app-dialog').close();
        toast('Personalização salva.');
      }, 'primary')
    );
  });
}

function openDecorationGallery() {
  showDialog('Profile Decoration', container => {
    const card = el('div', 'profile-edit-card'); container.append(card); const inner = el('div','profile-edit-content'); card.append(inner); container = inner;
    let prefs = loadProfilePrefs();
    const categories = [
      { id: 'frame', label: 'Bordas de avatar' },
      { id: 'effect', label: 'Efeitos de perfil' },
      { id: 'banner', label: 'Capas' },
    ];
    let current = 'frame';
    const tabs = el('div', 'shop-tabs');
    const grid = el('div', 'shop-grid');
    function render() {
      grid.replaceChildren();
      DECORATIONS.filter(d => d.type === current).forEach(d => {
        const item = el('button', 'shop-item', d.name);item.type='button';item.setAttribute('aria-pressed',String((current==='frame'?prefs.frame:current==='effect'?prefs.profileEffect:prefs.bannerStyle)===d.id));
        if ((current === 'frame' && prefs.frame === d.id) || (current === 'effect' && prefs.profileEffect === d.id) || (current === 'banner' && prefs.bannerStyle === d.id)) {
          item.classList.add('selected');
        }
        item.onclick = () => {
          const next = { ...loadProfilePrefs() };
          if (current === 'frame') next.frame = d.id;
          else if (current === 'effect') next.profileEffect = d.id;
          else next.bannerStyle = d.id;
          saveProfilePrefs(next);prefs=next;
          applyDecorations();
          render();
          toast(d.name + ' aplicado');
        };
        grid.append(item);
      });
    }
    categories.forEach(cat => {
      const tab = el('button', 'shop-tab' + (cat.id === current ? ' active' : ''), cat.label);
      tab.onclick = () => {
        current = cat.id;
        tabs.querySelectorAll('.shop-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        render();
      };
      tabs.append(tab);
    });
    container.append(tabs,grid,button('Remover efeito de perfil',()=>{saveProfilePrefs({...loadProfilePrefs(),profileEffect:''});prefs=loadProfilePrefs();applyDecorations();render();}));
    container.append(el('p', 'muted', 'Escolha bordas, efeitos e estilos de capa. As mudanças são aplicadas no seu perfil e salvas localmente. Capas animadas (GIF) podem ser enviadas em Editar perfil.'));
    render();
  });
}


return {openProfileCustomizer,openDecorationGallery};}
