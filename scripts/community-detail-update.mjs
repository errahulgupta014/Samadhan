import fs from 'node:fs';
const edit=(path,fn)=>fs.writeFileSync(path,fn(fs.readFileSync(path,'utf8')));
edit('mobile/src/CommunityScreens.tsx',s=>s
 .replace('navigate:(page:string)=>void','navigate:(page:string,id?:string)=>void')
 .replace('function Classifieds({data,connection,hindi}:Props)','function Classifieds({data,connection,hindi,navigate}:Props)')
 .replace('function City({data,connection,hindi}:Props)','function City({data,connection,hindi,navigate}:Props)')
 .replace('<View key={ad.id} style={s.card}>','<Pressable key={ad.id} accessibilityRole="button" accessibilityLabel={`${hindi?\'विवरण देखें\':\'View details\'}: ${hindi&&ad.titleHi?ad.titleHi:ad.title}`} onPress={()=>navigate(\'ad-detail\',ad.id)} style={({pressed})=>[s.card,pressed&&{backgroundColor:\'#FFF3E7\'}]}>')
 .replace('<Text style={s.body}>{hindi&&ad.descriptionHi?ad.descriptionHi:ad.description}</Text>','<Text numberOfLines={2} style={s.body}>{hindi&&ad.descriptionHi?ad.descriptionHi:ad.description}</Text>')
 .replace(/{ad.contactPhone&&<Text selectable[\s\S]*?<\/View>\)\}/,"<Text style={s.link}>{hindi?'पूरा विवरण देखें →':'View details →'}</Text></Pressable>)}")
 .replace('<View style={s.card} key={place.id}>','<Pressable key={place.id} accessibilityRole="button" accessibilityLabel={`${hindi?\'स्थान देखें\':\'Explore place\'}: ${hindi&&place.nameHi?place.nameHi:place.name}`} onPress={()=>navigate(\'place-detail\',place.id)} style={({pressed})=>[s.card,pressed&&{backgroundColor:\'#EDF6EC\'}]}>')
 .replace('<Text style={s.body}>{hindi&&place.descriptionHi?place.descriptionHi:place.description}</Text>','<Text numberOfLines={2} style={s.body}>{hindi&&place.descriptionHi?place.descriptionHi:place.description}</Text>')
 .replace(/{place.hours&&<Text[\s\S]*?<\/View>\)\}/,"<Text style={s.link}>{hindi?'स्थान का विवरण देखें →':'Explore this place →'}</Text></Pressable>)}")
 .replace("navigate('classifieds');","navigate('ad-detail',n.classifiedId);"));
edit('mobile/src/App.tsx',s=>s
 .replace("import BackHome", "import CommunityDetail from './CommunityDetail';\nimport BackHome")
 .replace("const navigationHistory=useRef<string[]>([]);const setPage=(screen:string)=>{if(screen===page)return;if(screen==='home')navigationHistory.current=[];else navigationHistory.current.push(page);router.setParams({section:screen});};const goBack=()=>{const previous=navigationHistory.current.pop()??'home';router.setParams({section:previous});setError('');};", "const navigationHistory=useRef<{section:string;id:string}[]>([]);const setPage=(screen:string,id='')=>{if(screen===page&&id===(params.id??''))return;if(screen==='home')navigationHistory.current=[];else navigationHistory.current.push({section:page,id:params.id??''});router.setParams({section:screen,id});};const goBack=()=>{const previous=navigationHistory.current.pop()??{section:page==='ad-detail'?'classifieds':page==='place-detail'?'city':'home',id:''};router.setParams(previous);setError('');};const activeTab=page==='ad-detail'?'classifieds':page==='place-detail'?'city':page;")
 .replace('p=>p!==\'report\'',"p=>p.section!=='report'")
 .replace('<ScrollView contentContainerStyle={s.content}', '<ScrollView key={`${page}:${params.id??\'\'}`} contentContainerStyle={s.content}')
 .replace("{['profile','classifieds','city','notifications'].includes(page)","{(page==='ad-detail'||page==='place-detail')&&<CommunityDetail key={`${page}:${params.id}`} kind={page==='ad-detail'?'ad':'place'} id={params.id} data={data} connection={connection!} hindi={hindi}/>}\n {['profile','classifieds','city','notifications'].includes(page)")
 .replaceAll('page===key','activeTab===key'));
