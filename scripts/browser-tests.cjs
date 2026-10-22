const {spawnSync}=require('node:child_process'),path=require('node:path');
const groups={
 navigation:['friends_layout_browser.cjs','browser_smoke.cjs','navigation_browser.cjs','community_ux_browser.cjs','identity_browser.cjs','install_browser.cjs','videochamada_browser.cjs'],
 calls:['call_layout_browser.cjs','call_controls_browser.cjs','call_session_browser.cjs','auth_recovery_browser.cjs','youtube_watch_browser.cjs','audio_experience_browser.cjs','call_media_browser.cjs','jesus9_browser.cjs','luladroid_browser.cjs'],
 media:['feed_browser.cjs','media_autoplay_browser.cjs','jesus11_browser.cjs'],
 quality:['diagnostics_browser.cjs','accessibility_browser.cjs','performance_browser.cjs','social_tools_browser.cjs','oauth_browser.cjs']
};
const selection=process.argv[2],files=selection?groups[selection]:Object.values(groups).flat();if(!files)throw Error('Unknown test group');
for(const file of files){const location=path.join(__dirname,'../tests',file);if(!require('fs').existsSync(location))throw Error('Missing test: '+file);console.log('Browser test:',file);const result=spawnSync(process.execPath,[location],{stdio:'inherit',env:process.env,timeout:180000});if(result.status!==0)process.exit(result.status||1);}
