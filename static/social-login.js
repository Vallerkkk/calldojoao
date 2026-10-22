export function initSocialLogin({toast}) {
  const form=document.getElementById('auth-form'),group=document.createElement('div'),hint=document.createElement('p');
  group.className='social-login';hint.className='muted';hint.setAttribute('role','status');
  hint.textContent='Verificando opções de login social…';form.after(group,hint);
  let client,busy=false;
  const buttons=['google','discord'].map(provider=>{
    const button=document.createElement('button');button.type='button';button.className='soft-button';button.disabled=true;
    button.textContent='Continuar com '+(provider==='google'?'Google':'Discord');group.append(button);
    button.onclick=async()=>{
      if(busy||!client)return;busy=true;buttons.forEach(item=>item.disabled=true);
      try {
        const destination=new URLSearchParams();for(const key of ['invite','post','profile','channel','dm','message','story']){const value=new URL(location.href).searchParams.get(key);if(value&&(key==='invite'?/^[A-Za-z0-9_-]{32,128}$/.test(value):/^[0-9a-f-]{36}$/i.test(value)))destination.set(key,value);}if(destination.size)sessionStorage.setItem('orbita-oauth-return',destination.toString());
        const {error}=await client.auth.signInWithOAuth({provider,options:{redirectTo:new URL('/',location.origin).href}});
        if(error)throw error;
      }catch{toast('Não foi possível iniciar esse login. Tente novamente ou entre com e-mail.');busy=false;buttons.forEach(item=>item.disabled=item.dataset.enabled!=='true');}
    };return button;
  });
  return {ready(db,config){
    client=db;
    // The current native launcher intentionally blocks navigation to external origins.
    // Do not strand a desktop user in an unrelated browser session.
    if(/Electron\//.test(navigator.userAgent)){hint.textContent='No aplicativo Windows, entre com e-mail. O login social está disponível no navegador.';return;}
    const url=new URL('/auth/v1/settings',config.supabaseUrl);
    fetch(url,{headers:{apikey:config.supabaseKey},signal:AbortSignal.timeout(5000)}).then(response=>{
      if(!response.ok)throw Error();return response.json();
    }).then(settings=>{
      let enabled=0;buttons.forEach((button,index)=>{const available=settings.external?.[['google','discord'][index]]===true;button.dataset.enabled=String(available);button.disabled=!available;if(available)enabled++;});
      hint.textContent=enabled?'Escolha uma opção ou entre com seu e-mail.':'Google e Discord estarão disponíveis quando os provedores forem configurados.';
    }).catch(()=>{hint.textContent='Entre com e-mail enquanto as opções de login social estão indisponíveis.';});
  }};
}
