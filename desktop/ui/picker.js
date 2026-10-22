'use strict';
let selected;
const status=document.getElementById('status'),share=document.getElementById('share');
document.getElementById('cancel').onclick=()=>window.orbitaScreenPicker.choose(null);
share.onclick=()=>{if(selected)window.orbitaScreenPicker.choose({id:selected,audio:document.getElementById('audio').checked});};
window.orbitaScreenPicker.list().then(({sources,audioAvailable})=>{
  for(const source of sources){const button=document.createElement('button'),image=document.createElement('img'),name=document.createElement('span');button.type='button';button.className='source';button.setAttribute('aria-pressed','false');image.src=source.thumbnail;image.alt='';name.textContent=source.name;button.append(image,name);button.onclick=()=>{selected=source.id;for(const other of document.querySelectorAll('.source'))other.setAttribute('aria-pressed',String(other===button));share.disabled=false;status.textContent='Selecionado: '+source.name;};document.getElementById('sources').append(button);}
  document.getElementById('audio-row').hidden=!audioAvailable;status.textContent='Escolha uma tela ou janela.';
}).catch(()=>{status.textContent='Não foi possível listar as telas. Cancele e tente novamente.';});
