import {compressImage, relativeTime} from './media-utils.js?v=fluency-20261020-2';

// Feed requests always carry the existing authenticated Supabase client.
export function initSocialFeed(ctx) {
  const {el, toast, checked, showDialog} = ctx;
  const root=el('div','social-feed');root.id='feed-view';root.hidden=true;
  document.querySelector('.main').append(root);
  const nav=el('button','server-icon action-rail','◈');nav.id='feed-nav';nav.title='Feed da Órbita';nav.setAttribute('aria-label','Feed da Órbita');
  document.querySelector('#friends-nav').after(nav);
  let epoch=0, scope='explore', query='', author=null, parent=null, rows=[], loading=false, more=false, observer, draft='', draftId, files=[], quote=null, busy=false, uid=null;
  let scroll, list, status, composer, input, previews, send, counter, peopleBox, tabs, search, accountEpoch=0, uncertain=false;
  const urls=new Map(), drafts=new Map();let realtime, latest;const draftKey=()=>scope==='thread'?'reply:'+parent:'post';const validId=value=>/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value||'');
  const state=()=>ctx.state(), alive=(version,user)=>version===epoch&&state().session?.user.id===user&&!root.hidden;
  const b=(label,action,cls='sf-button')=>{const node=el('button',cls,label);node.type='button';node.onclick=async()=>{if(node.disabled)return;node.disabled=true;try{await action(node);}catch(error){toast(error.message||'Não foi possível concluir.');}finally{node.disabled=false;}};return node;};
  const closeDialog=()=>document.querySelector('#app-dialog').close();
  function confirm(title,copy,action){showDialog(title,box=>{box.append(el('p','',copy),b('Cancelar',closeDialog),b('Confirmar',async()=>{await action();closeDialog();},'sf-button danger'));});}
  async function rpc(name,args){return await checked(state().db.rpc(name,args));}
  function clearMedia(){for(const file of files)URL.revokeObjectURL(file.preview);files=[];}
  function stopRealtime(){if(realtime){const prior=realtime;realtime=null;state().db?.removeChannel(prior).catch(()=>{});}}
  function reset(){epoch++;accountEpoch++;stopRealtime();root.hidden=true;nav.classList.remove('active');observer?.disconnect();for(const item of drafts.values())for(const file of item.files)URL.revokeObjectURL(file.preview);drafts.clear();clearMedia();urls.clear();rows=[];draft='';draftId=null;quote=null;busy=false;uncertain=false;loading=false;uid=null;input=null;root.replaceChildren();}
  function hide(){if(!root.hidden){draft=input?.value||draft;epoch++;root.hidden=true;observer?.disconnect();stopRealtime();nav.classList.remove('active');for(const video of root.querySelectorAll('video'))video.pause();}loading=false;}
  function rich(text){
    const node=el('div','sf-content');const pattern=/(https?:\/\/[^\s<>]+|#[\p{L}\p{N}_]{1,60}|@[a-zA-Z0-9_]{2,32})/gu;let offset=0;
    for(const match of String(text||'').matchAll(pattern)){node.append(document.createTextNode(text.slice(offset,match.index)));const token=match[0];
      if(token.startsWith('http')){const a=el('a','',token);a.href=token;a.target='_blank';a.rel='noopener noreferrer nofollow';node.append(a);}
      else node.append(b(token,async()=>{if(token[0]==='#')open('explore',{query:token});else {const found=await rpc('social_people',{search_text:token.slice(1)});const p=found.find(p=>p.username?.toLowerCase()===token.slice(1).toLowerCase());if(p)open('profile',{author:p.id});else toast('Perfil não encontrado.');}},'sf-inline'));
      offset=match.index+token.length;
    }node.append(document.createTextNode(String(text||'').slice(offset)));return node;
  }
  async function signed(path,bucket='orbita-feed'){
    if(!path)return '';const key=bucket+':'+path,user=state().session?.user.id,cached=urls.get(key);if(cached&&cached.until>Date.now())return cached.url;
    const result=await state().db.storage.from(bucket).createSignedUrl(path,300);if(result.error)return '';
    if(user!==state().session?.user.id)return '';const url=result.data?.signedUrl||'';if(url)urls.set(key,{url,until:Date.now()+240000});while(urls.size>300)urls.delete(urls.keys().next().value);return url;
  }
  function avatar(p){const node=b((p?.display_name||'?').slice(0,2).toUpperCase(),()=>open('profile',{author:p.id}),'sf-avatar');node.setAttribute('aria-label','Perfil de '+(p?.display_name||'Participante'));
    if(/^#[0-9a-f]{6}$/i.test(p?.avatar_color))node.style.backgroundColor=p.avatar_color;
    if(p?.avatar_url){const current=accountEpoch;signed(p.avatar_url,'orbita-files').then(src=>{if(src&&current===accountEpoch&&node.isConnected){const img=el('img');img.src=src;img.alt='';img.loading='lazy';node.replaceChildren(img);}});}return node;
  }
  function menu(post){const details=el('details','sf-menu'),summary=el('summary','','•••');summary.setAttribute('aria-label','Opções da publicação');details.append(summary);const box=el('div','sf-menu-items');details.append(box);
    box.append(b('Copiar link',async()=>{await copy(post.id);details.open=false;}));
    if(post.author_id===uid){box.append(b('Editar',()=>edit(post)));
    }else{box.append(b('Denunciar',()=>report(post)),b('Bloquear autor',()=>confirm('Bloquear perfil','As publicações ficam ocultas para vocês dois.',async()=>{await checked(state().db.from('social_blocks').insert({blocker_id:uid,blocked_id:post.author_id}));open('explore');})));}
    if(post.author_id===uid||state().moderator)box.append(b('Apagar publicação',()=>confirm('Apagar publicação','Esta publicação será apagada permanentemente.',async()=>{
      const user=uid;await checked(state().db.from('social_posts').delete().eq('id',post.id).select('id').single());
      // Storage failures do not undo a confirmed post deletion.
      if(post.media?.length){const result=await state().db.storage.from('orbita-feed').remove(post.media);if(result.error&&state().session?.user.id===user)toast('Publicação apagada; os anexos não puderam ser removidos.');}
      if(state().session?.user.id===user)open(scope==='thread'?'explore':scope,{author,query});
    })));return details;
  }
  function card(post,compact=false){
    const article=el('article','sf-post');article.dataset.postId=post.id;const head=el('div','sf-post-head'),p=post.author||{id:post.author_id,display_name:'Participante'};
    const names=b(p.display_name||'Participante',()=>open('profile',{author:post.author_id}),'sf-name'),meta=el('div','sf-author');meta.append(names,el('span','sf-muted','@'+(p.username||'participante')));
    const time=el('time','sf-time',relativeTime(post.created_at));time.dateTime=post.created_at;time.title=new Date(post.created_at).toLocaleString('pt-BR');
    head.append(avatar(p),meta,time,menu(post));article.append(head);
    if(post.is_reply)article.append(el('small','sf-muted','Em resposta a uma publicação'));
    article.append(rich(post.content));
    if(post.updated_at)article.append(el('small','sf-muted','Editado'));
    if(post.media?.length){const media=el('div','sf-media');media.dataset.count=post.media.length;article.append(media);
      for(const path of post.media){const video=/\.(mp4|webm)$/i.test(path),node=el(video?'video':'img');node.setAttribute('aria-label',video?'Vídeo da publicação':'Imagem da publicação');if(video){node.controls=true;node.preload='metadata';node.playsInline=true;node.muted=true;
  node.addEventListener('loadeddata',()=>{try{if(node.videoWidth){const c=document.createElement('canvas');const scale=Math.min(1,640/node.videoWidth,360/node.videoHeight);c.width=Math.max(1,Math.round(node.videoWidth*scale));c.height=Math.max(1,Math.round(node.videoHeight*scale));c.getContext('2d').drawImage(node,0,0,c.width,c.height);node.poster=c.toDataURL('image/jpeg',0.7);}}catch(e){}});
}else{node.alt='Imagem da publicação';node.loading='lazy';node.decoding='async';}media.append(node);
        const account=accountEpoch;signed(path).then(src=>{if(src&&account===accountEpoch&&node.isConnected)node.src=src;else if(node.isConnected)node.replaceWith(el('p','sf-muted','Anexo indisponível. Atualize o feed para tentar novamente.'));});
      }
    }
    if(post.is_quote){const q=post.quote;if(q){const quoted=b('',()=>open('thread',{parent:q.id}),'sf-quote');quoted.append(el('strong','',q.author),el('p','',q.content||'Publicação com mídia'));article.append(quoted);}else article.append(el('p','sf-quote sf-muted','A publicação citada não está disponível.'));}
    if(!compact){const actions=el('div','sf-actions');const reply=b('◯ '+post.replies,()=>open('thread',{parent:post.id}));reply.setAttribute('aria-label',`Responder · ${post.replies} respostas`);
      const like=b('♡ '+post.likes,async node=>toggle(post,'likes','liked',node,'♡'));like.setAttribute('aria-label','Curtir');like.setAttribute('aria-pressed',String(post.liked));
      const repost=b('↻ '+post.reposts,async node=>toggle(post,'reposts','reposted',node,'↻'));repost.setAttribute('aria-label','Republicar');repost.setAttribute('aria-pressed',String(post.reposted));
      const saved=b(post.saved?'◆':'◇',async node=>toggle(post,'bookmarks','saved',node));saved.setAttribute('aria-label','Salvar publicação');saved.setAttribute('aria-pressed',String(post.saved));
      const cite=b('❞',()=>{open('explore',{quotePost:post});input.focus();});cite.setAttribute('aria-label','Citar publicação');
      const share=b('↗',()=>copy(post.id));share.setAttribute('aria-label','Compartilhar publicação');actions.append(reply,repost,like,cite,saved,share);article.append(actions);
    }return article;
  }
  async function toggle(post,table,flag,node,symbol){
    const user=uid,version=epoch,old=post[flag],db=state().db;const q=db.from('social_'+table);
    await checked(old?q.delete().eq('post_id',post.id).eq('user_id',user):q.insert({post_id:post.id,user_id:user}));
    if(!alive(version,user))return;post[flag]=!old;if(symbol){post[table]=Math.max(0,Number(post[table]||0)+(old?-1:1));node.textContent=symbol+' '+post[table];}else node.textContent=post[flag]?'◆':'◇';node.setAttribute('aria-pressed',String(post[flag]));
  }
  async function copy(id){const url=new URL('/',location.origin);url.searchParams.set('post',id);if(navigator.clipboard?.writeText){try{await navigator.clipboard.writeText(url.href);toast('Link copiado.');return;}catch{}}
    showDialog('Link da publicação',box=>{const field=el('input');field.value=url.href;field.readOnly=true;field.setAttribute('aria-label','Link da publicação');box.append(field);field.select();});
  }
  function edit(post){showDialog('Editar publicação',box=>{const form=el('form'),text=el('textarea');text.value=post.content;text.setAttribute('aria-label','Texto da publicação');text.rows=5;const count=el('p','sf-muted'),submit=el('button','primary','Salvar alterações');submit.type='submit';text.oninput=()=>{count.textContent=[...text.value].length+'/280';submit.disabled=[...text.value].length>280||(!text.value.trim()&&!post.media?.length&&!post.is_quote);};text.oninput();form.append(text,count,submit);box.append(form);
    form.onsubmit=async event=>{event.preventDefault();submit.disabled=true;const user=uid,version=epoch;try{const changed=await checked(state().db.from('social_posts').update({content:text.value.trim()}).eq('id',post.id).select('id,content,updated_at').single());if(!alive(version,user))return;Object.assign(post,changed);const node=root.querySelector(`[data-post-id="${post.id}"]`);node?.replaceWith(card(post));closeDialog();}catch(error){toast(error.message);}finally{submit.disabled=false;}};
  });}
  function report(post){showDialog('Denunciar publicação',box=>{const text=el('textarea');text.placeholder='Descreva o problema (5–500 caracteres)';text.maxLength=500;text.setAttribute('aria-label','Motivo da denúncia');box.append(text,b('Enviar denúncia',async()=>{if(text.value.trim().length<5)throw Error('Descreva o motivo com pelo menos 5 caracteres.');await checked(state().db.from('social_reports').insert({post_id:post.id,reporter_id:uid,reason:text.value.trim()}));closeDialog();toast('Denúncia enviada à administração.');}));});}
  function updateComposer(){if(!input)return;draft=input.value;const length=[...draft].length;counter.textContent=length+'/280';counter.classList.toggle('sf-over',length>280);send.disabled=busy||length>280||(!draft.trim()&&!files.length&&!quote)||!navigator.onLine;
    input.disabled=busy||uncertain;send.textContent=uncertain?'Verificar envio':scope==='thread'?'Responder':'Publicar';
    previews.replaceChildren();for(const [index,file] of files.entries()){const tile=el('div','sf-preview'),image=el(file.file.type.startsWith('video/')?'video':'img');image.src=file.preview;if(image.tagName==='VIDEO'){image.muted=true;image.preload='metadata';}else image.alt=file.file.name;const remove=b('×',()=>{URL.revokeObjectURL(files[index].preview);files.splice(index,1);updateComposer();});remove.setAttribute('aria-label','Remover anexo '+file.file.name);remove.disabled=busy||uncertain;tile.append(image,remove);previews.append(tile);}
    if(quote){const tile=el('div','sf-quote'),remove=b('Remover citação',()=>{quote=null;updateComposer();});remove.disabled=busy||uncertain;tile.append(el('strong','','Citando '+(quote.author?.display_name||'uma publicação')),el('p','',quote.content||'Mídia'),remove);previews.append(tile);}
  }
  async function addFiles(selected){const account=accountEpoch;if(busy||uncertain)return;busy=true;updateComposer();try{for(const original of selected){if(files.length>=4)throw Error('Adicione até 4 anexos por publicação.');if(!/^image\/(jpeg|png|webp|gif)$|^video\/(mp4|webm)$/.test(original.type))throw Error('Use JPG, PNG, WebP, GIF, MP4 ou WebM.');const file=await compressImage(original);if(account!==accountEpoch)return;
      if(file.size>(file.type.startsWith('video/')?25:2)*1024*1024)throw Error('Limite de 2 MB por imagem/GIF e 25 MB por vídeo.');files.push({file,preview:URL.createObjectURL(file),path:null});
    }}finally{if(account===accountEpoch){busy=false;updateComposer();}}}
  async function publish(){
    if(send.disabled)return;const account=accountEpoch,user=uid,db=state().db,value=input.value.trim(),reply=scope==='thread'?parent:null,citation=quote?.id||null,snapshot=[...files];draftId||=crypto.randomUUID();const id=draftId;busy=true;updateComposer();input.disabled=true;
    let submitted=false;try{
      // A retry first checks the stable ID. A lost response must not create a second post.
      const existing=await checked(db.from('social_posts').select('id').eq('id',id).maybeSingle());
      if(!existing){for(const item of snapshot){if(!item.path){const ext=({ 'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif','video/mp4':'mp4','video/webm':'webm'})[item.file.type];const path=`${user}/${id}/${crypto.randomUUID()}.${ext}`;await checked(db.storage.from('orbita-feed').upload(path,item.file,{contentType:item.file.type,upsert:false}));item.path=path;}if(account!==accountEpoch)return;}
        submitted=true;await checked(db.from('social_posts').insert({id,author_id:user,content:value,media:snapshot.map(x=>x.path),reply_to:reply,quote_id:citation}));
      }
      if(account!==accountEpoch)return;draft='';if(input)input.value='';draftId=null;quote=null;uncertain=false;clearMedia();busy=false;toast('Publicado!');if(!root.hidden)open(scope,{author,parent,query});
    }catch(error){if(account===accountEpoch){if(submitted&&!error.code)uncertain=true;toast('Não foi possível confirmar a publicação. Seu rascunho foi mantido. '+(error.message||''));}}
    finally{if(account===accountEpoch){busy=false;if(input){input.disabled=false;updateComposer();}}}
  }
  function makeComposer(){const form=el('form','sf-composer'),top=el('div','sf-compose-top');input=el('textarea');input.id='feed-compose';input.placeholder=scope==='thread'?'Escreva sua resposta…':'O que está acontecendo na sua órbita?';input.setAttribute('aria-label',scope==='thread'?'Sua resposta':'Nova publicação');input.rows=3;input.value=draft;input.oninput=()=>updateComposer();
    top.append(avatar(state().profile||{id:uid,display_name:'Você'}),input);previews=el('div','sf-previews');const bar=el('div','sf-compose-bar'),pick=el('input');pick.type='file';pick.accept='image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm';pick.multiple=true;pick.hidden=true;pick.onchange=async()=>{try{await addFiles([...pick.files]);}catch(error){toast(error.message);}pick.value='';};
    const media=b('＋ Mídia',()=>pick.click());counter=el('span','sf-muted');send=el('button','primary',scope==='thread'?'Responder':'Publicar');send.type='submit';bar.append(media,pick,el('span','sf-media-hint','Imagens, GIFs e vídeos'),counter,send);form.append(top,previews,bar);form.onsubmit=event=>{event.preventDefault();publish();};
    form.addEventListener('paste',event=>{const images=[...event.clipboardData.files].filter(f=>f.type.startsWith('image/'));if(images.length){event.preventDefault();addFiles(images).catch(error=>toast(error.message));}});
    form.addEventListener('dragover',event=>{if(event.dataTransfer.types.includes('Files')){event.preventDefault();form.classList.add('sf-drag');}});form.addEventListener('dragleave',()=>form.classList.remove('sf-drag'));form.addEventListener('drop',event=>{event.preventDefault();form.classList.remove('sf-drag');addFiles([...event.dataTransfer.files]).catch(error=>toast(error.message));});return form;
  }
  async function load(append=false){if(loading||root.hidden||busy)return;loading=true;const version=epoch,user=uid;status.textContent='Carregando…';status.disabled=true;
    try{const last=append?rows.at(-1):null;const result=await rpc('social_timeline',{scope,before_at:last?.created_at||null,before_id:last?.id||null,search_text:query,author_filter:author,parent_filter:parent});if(!alive(version,user))return;
      if(!append){rows=[];list.replaceChildren();}const ids=new Set(rows.map(p=>p.id));for(const post of result){if(!ids.has(post.id)){rows.push(post);list.append(card(post));}}
      more=result.length===25;status.textContent=more?'Carregar mais':rows.length?'Você está em dia.':'Nenhuma publicação por aqui ainda.';status.disabled=!more;observer?.disconnect();if(more)observer?.observe(status);
    }catch(error){if(alive(version,user)){status.textContent='Não foi possível carregar. Toque para tentar novamente.';status.disabled=false;toast(error.message);}}
    finally{if(version===epoch)loading=false;}
  }
  async function people(version,user){try{const result=await rpc('social_people',{search_text:query.replace(/^@/,''),profile_id:scope==='profile'?author:null});if(!alive(version,user))return;peopleBox.replaceChildren(el('h3','',scope==='profile'?'Perfil':query?'Pessoas encontradas':'Quem está na Órbita'));
    for(const p of result){const row=el('div','sf-person');row.append(avatar(p));const info=el('div','sf-person-info');info.append(b(p.display_name,()=>open('profile',{author:p.id}),'sf-name'),el('small','sf-muted',`@${p.username||'participante'} · ${p.followers} seguidores`));row.append(info);
      if(p.id!==user){const follow=b(p.following?'Seguindo':'Seguir',async node=>{await checked(p.following?state().db.from('social_follows').delete().eq('follower_id',user).eq('following_id',p.id):state().db.from('social_follows').insert({follower_id:user,following_id:p.id}));if(!alive(version,user))return;p.following=!p.following;node.textContent=p.following?'Seguindo':'Seguir';node.setAttribute('aria-pressed',String(p.following));for(const related of root.querySelectorAll('[data-follow-user="'+p.id+'"]')){related.textContent=node.textContent;related.setAttribute('aria-pressed',String(p.following));}});follow.dataset.followUser=p.id;follow.setAttribute('aria-pressed',String(p.following));row.append(follow);}peopleBox.append(row);
      if(scope==='profile'&&p.id===author){const bio=el('div','sf-profile-bio');if(p.banner_url){const img=el('img','sf-banner');img.alt='Banner de '+p.display_name;signed(p.banner_url,'orbita-files').then(src=>{if(alive(version,user)&&src)img.src=src;});bio.append(img);}bio.append(el('h2','',p.display_name),el('p','sf-muted','@'+p.username+(p.pronouns?' · '+p.pronouns:'')),el('p','',p.bio||'Ainda sem biografia.'),el('p','sf-muted',`${p.followers} seguidores · ${p.following_count} seguindo`));if(p.custom_status)bio.append(el('p','',p.custom_status));bio.append(b(p.id===user?'Editar perfil':'Ver perfil e amizade',()=>ctx.profile(p)));if(p.id!==user){const follow=row.querySelector('.sf-button').cloneNode(true);follow.onclick=()=>row.querySelector('.sf-button').click();bio.append(follow);}list.before(bio);}
    }
    if(!result.length)peopleBox.append(el('p','sf-muted','Nenhum perfil encontrado.'));
  }catch(error){if(alive(version,user))peopleBox.replaceChildren(el('p','sf-muted','Não foi possível carregar os perfis.'),b('Tentar novamente',()=>people(version,user)));}}
  async function thread(version,user){try{const result=await rpc('social_timeline',{scope:'single',parent_filter:parent});if(!alive(version,user))return;if(!result.length){composer.hidden=true;list.before(el('p','sf-empty','Esta publicação foi apagada ou está indisponível.'));return;}list.before(card(result[0]));await load();}catch(error){if(alive(version,user)){status.textContent='Falha ao abrir conversa. Tentar novamente';status.disabled=false;status.onclick=()=>thread(version,user);}}}
  async function activity(version,user){status.textContent='Carregando notificações…';try{const events=await rpc('social_activity',{});if(!alive(version,user))return;list.replaceChildren();for(const event of events){const row=el('article','sf-notification');row.append(avatar(event.actor||{id:event.actor_id,display_name:'Participante'}));const copy=el('div');copy.append(el('strong','',event.actor?.display_name||'Participante'),el('p','',({like:'curtiu sua publicação',repost:'republicou sua publicação',reply:'respondeu à sua publicação',quote:'citou sua publicação',follow:'começou a seguir você'})[event.kind]||'interagiu com você'),el('small','sf-muted',relativeTime(event.created_at)));row.append(copy,b(event.post_id?'Ver publicação':'Ver perfil',()=>event.post_id?open('thread',{parent:event.post_id}):open('profile',{author:event.actor_id})));list.append(row);}status.textContent=events.length?'Últimas 50 interações.':'Suas notificações aparecerão aqui.';status.disabled=true;}catch(error){if(alive(version,user)){status.textContent='Falha ao carregar notificações. Tentar novamente';status.disabled=false;status.onclick=()=>activity(version,user);}}}
  async function blocked(){showDialog('Perfis bloqueados',async box=>{box.append(el('p','sf-muted','Carregando…'));const user=uid,version=accountEpoch;try{const blocks=await checked(state().db.from('social_blocks').select('blocked_id').eq('blocker_id',user));if(version!==accountEpoch||!box.isConnected)return;box.replaceChildren();if(!blocks.length)box.append(el('p','','Você não bloqueou nenhum perfil.'));for(const item of blocks){const row=el('div','sf-person');row.append(el('span','','Perfil '+item.blocked_id.slice(0,8)),b('Desbloquear',async()=>{await checked(state().db.from('social_blocks').delete().eq('blocker_id',user).eq('blocked_id',item.blocked_id));row.remove();}));box.append(row);}}catch(error){if(version===accountEpoch)box.replaceChildren(el('p','',error.message));}});}
  async function moderation(){showDialog('Denúncias do feed',async box=>{const version=accountEpoch;try{const reports=await checked(state().db.from('social_reports').select('*').order('created_at',{ascending:false}).limit(50));if(version!==accountEpoch||!box.isConnected)return;if(!reports.length)box.append(el('p','','Nenhuma denúncia pendente.'));for(const r of reports){const row=el('div','sf-report');row.append(el('p','',r.reason),b('Ver publicação',()=>{closeDialog();open('thread',{parent:r.post_id});}),b('Resolver denúncia',async()=>{await checked(state().db.from('social_reports').delete().eq('id',r.id));row.remove();}));box.append(row);}}catch(error){if(version===accountEpoch)box.append(el('p','',error.message));}});}
  function open(next='explore',options={}){
    if(!state().session)return;if(busy){toast('Aguarde o envio terminar antes de mudar o feed.');return;}if(uncertain){next=scope;options={author,parent,query};}
    if(uid&&uid!==state().session.user.id)reset();uid=state().session.user.id;draft=input?.value??draft;drafts.set(draftKey(),{text:draft,files,quote,id:draftId});
    scope=next;author=options.author||null;parent=options.parent||null;query=options.query||'';const saved=drafts.get(draftKey());draft=saved?.text||'';files=saved?.files||[];quote=options.quotePost||saved?.quote||null;draftId=saved?.id||null;
    ctx.open();epoch++;const version=epoch,user=uid;loading=false;more=false;rows=[];observer?.disconnect();root.hidden=false;nav.classList.add('active');root.replaceChildren();
    const head=el('header','sf-header'),menu=b('☰',()=>ctx.menu(),'mobile-nav-btn sf-button');menu.setAttribute('aria-label','Abrir menu');menu.setAttribute('aria-expanded','false');
    head.append(menu,el('div','sf-heading'));head.lastChild.append(el('h1','','Feed da Órbita'),el('small','sf-muted','Ideias, novidades e pessoas da sua comunidade.'));
    head.append(b('Meu perfil',()=>open('profile',{author:uid})),b('Bloqueados',blocked));if(state().moderator)head.append(b('Denúncias',moderation));root.append(head);
    const layout=el('div','sf-layout'),center=el('div','sf-center');tabs=el('nav','sf-tabs');tabs.setAttribute('aria-label','Seções do feed');
    for(const [key,label] of [['explore','Explorar'],['following','Seguindo'],['saved','Salvos'],['people','Pessoas'],['activity','Notificações']]){const tab=b(label,()=>open(key));tab.setAttribute('aria-current',scope===key?'page':'false');tabs.append(tab);}
    tabs.append(b('Atualizar',()=>open(scope,{author,parent,query})));center.append(tabs);
    const form=el('form','sf-search');search=el('input');search.type='search';search.placeholder='Buscar publicações, pessoas ou #assuntos';search.setAttribute('aria-label','Buscar no feed');search.value=query;const submit=el('button','sf-button','Buscar');submit.type='submit';form.append(search,submit);form.onsubmit=event=>{event.preventDefault();open('explore',{query:search.value.trim().slice(0,100)});};center.append(form);
    scroll=el('div','sf-scroll');if(scope==='profile'||scope==='thread')scroll.append(b('← Voltar ao feed',()=>open()));latest=b('Novas publicações — atualizar',()=>open(scope,{author,parent,query}));latest.hidden=true;latest.classList.add('sf-latest');scroll.append(latest);composer=makeComposer();composer.hidden=!['explore','following','thread'].includes(scope)||!!query;scroll.append(composer);list=el('div','sf-list');list.setAttribute('aria-label','Publicações');status=b('Carregando…',()=>load(more));status.classList.add('sf-load');status.setAttribute('aria-live','polite');scroll.append(list,status);center.append(scroll);
    peopleBox=el('aside','sf-people');peopleBox.setAttribute('aria-label','Perfis do feed');layout.append(center);if(scope==='people'||query&&matchMedia('(max-width:1000px)').matches){peopleBox.classList.add('sf-people-inline');list.before(peopleBox);}else layout.append(peopleBox);root.append(layout);updateComposer();
    observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)&&more&&!loading)load(true);},{root:scroll,rootMargin:'100px'});
    if(scope==='thread')thread(version,user);else if(scope==='activity')activity(version,user);else if(scope!=='people')load();else status.hidden=true;people(version,user);ctx.closeMenu();
    stopRealtime();realtime=state().db.channel('social-feed:'+user).on('postgres_changes',{event:'*',schema:'public',table:'social_posts'},()=>{if(alive(version,user))latest.hidden=false;}).subscribe();
  }
  root.addEventListener('keydown',event=>{if(event.key==='Escape'){const details=root.querySelector('.sf-menu[open]');if(details){event.stopPropagation();details.open=false;details.querySelector('summary').focus();}}});
  root.addEventListener('dragover',event=>{if(event.dataTransfer?.types.includes('Files'))event.preventDefault();});
  root.addEventListener('drop',event=>{if(event.target.closest('.sf-composer'))return;event.preventDefault();addFiles([...event.dataTransfer.files]).catch(error=>toast(error.message));});
  nav.onclick=()=>open();window.addEventListener('online',()=>{if(!root.hidden)updateComposer();});window.addEventListener('offline',()=>{if(!root.hidden)updateComposer();});
  return {open,hide,sessionChanged:reset,deepLink(){const id=new URL(location.href).searchParams.get('post');if(validId(id)){open('thread',{parent:id});const url=new URL(location.href);url.searchParams.delete('post');history.replaceState(null,'',url);}}};
}
