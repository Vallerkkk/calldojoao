const {stub,USER,OTHER}=require('./supabase_fixture.cjs');
const POST='abababab-abab-4bab-8bab-abababababab';
const setup=`
data.social_posts=[{id:'${POST}',author_id:'${OTHER}',content:'Uma nova órbita de ideias. #novidades',media:[],created_at:'2026-10-20T12:00:00Z',is_reply:false,is_quote:false,reply_to:null,quote_id:null}];
for(const table of ['social_follows','social_likes','social_reposts','social_bookmarks','social_blocks','social_reports'])data[table]=[];
window.__qaFeedRpc=async(name,args={})=>{
 if(window.__qaFeedDelay)await new Promise(resolve=>setTimeout(resolve,window.__qaFeedDelay));
 if(window.__qaFeedFail){window.__qaFeedFail=false;return {data:null,error:{message:'falha simulada no feed'}};}
 const current=window.__qaSession.user.id;if(name==='social_activity')return {data:[{kind:'like',actor_id:'${OTHER}',post_id:'${POST}',created_at:new Date().toISOString(),actor:data.profiles.find(p=>p.id==='${OTHER}')}],error:null};
 const visible=p=>!data.social_blocks.some(b=>(b.blocker_id===current&&b.blocked_id===p.author_id)||(b.blocked_id===current&&b.blocker_id===p.author_id));
 if(name==='social_people')return {error:null,data:data.profiles.filter(p=>(!args.profile_id||p.id===args.profile_id)&&(!args.search_text||(p.username+' '+p.display_name).toLowerCase().includes(args.search_text.toLowerCase()))).map(p=>({...p,followers:data.social_follows.filter(f=>f.following_id===p.id).length,following_count:0,following:data.social_follows.some(f=>f.follower_id===current&&f.following_id===p.id)}))};
 let posts=data.social_posts.filter(visible);
 if(args.scope==='thread')posts=posts.filter(p=>p.reply_to===args.parent_filter);
 else if(args.scope==='single')posts=posts.filter(p=>p.id===args.parent_filter);
 else if(args.scope==='profile')posts=posts.filter(p=>p.author_id===args.author_filter);
 else if(args.scope==='saved')posts=posts.filter(p=>data.social_bookmarks.some(b=>b.user_id===current&&b.post_id===p.id));
 else posts=posts.filter(p=>!p.reply_to&&(args.scope!=='following'||p.author_id===current||data.social_follows.some(f=>f.follower_id===current&&f.following_id===p.author_id)));
 if(args.search_text)posts=posts.filter(p=>p.content.includes(args.search_text));
 if(args.before_at)posts=posts.filter(p=>p.created_at<args.before_at||(p.created_at===args.before_at&&p.id<args.before_id));
 posts.sort((a,b)=>b.created_at.localeCompare(a.created_at)||b.id.localeCompare(a.id));
 return {error:null,data:posts.slice(0,25).map(p=>({...p,author:data.profiles.find(u=>u.id===p.author_id),quote:p.quote_id?{...data.social_posts.find(q=>q.id===p.quote_id),author:'Outra pessoa'}:null,is_reply:!!p.reply_to,is_quote:!!p.quote_id,likes:data.social_likes.filter(r=>r.post_id===p.id).length,reposts:data.social_reposts.filter(r=>r.post_id===p.id).length,replies:data.social_posts.filter(r=>r.reply_to===p.id).length,liked:data.social_likes.some(r=>r.post_id===p.id&&r.user_id===current),reposted:data.social_reposts.some(r=>r.post_id===p.id&&r.user_id===current),saved:data.social_bookmarks.some(r=>r.post_id===p.id&&r.user_id===current)}))};
};`;
const withLostResponse=stub.replace("data[table].push(...rows);}","data[table].push(...rows);}if(operation==='insert'&&table==='social_posts'&&window.__qaFeedLoseNext){window.__qaFeedLoseNext=false;return {data:null,error:{message:'Resposta perdida'}};}");
module.exports={POST,USER,OTHER,stub:withLostResponse.replace("rpc:async(name)=>({data:name==='ensure_default_community'?", "rpc:async(name,args)=>name.startsWith('social_')?window.__qaFeedRpc(name,args):({data:name==='ensure_default_community'?")+setup};
