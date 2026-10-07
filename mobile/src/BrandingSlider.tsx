import React,{useEffect,useMemo,useRef,useState} from 'react';
import {MediaImage} from './MediaImage';
import {AccessibilityInfo,Animated,AppState,Easing,Image,Linking,PanResponder,Platform,Pressable,StyleSheet,View,type LayoutChangeEvent,type StyleProp,type ViewStyle} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import {Text,colors,raised,rgba,tint,typeScale} from './Design';
import type {Workspace,BrandingBanner} from '../shared/domain';
import type {Connection} from './api';

// Personal / political branding slider shown on Home after the splash and after sign-in.
// Slides sit on a track keyed by absolute position, so swiping, the arrow buttons and auto-rotation all wrap around smoothly.

const NAVY=colors.navy,GREEN=colors.green,SAFFRON=colors.saffron;
const ADVANCE_MS=6000;   // dwell time per slide while auto-rotating
const RESUME_MS=11000;   // auto-rotation resumes this long after the last manual tap or swipe
const SLIDE_MS=360;
const ART_HEIGHT=198;
// The bundled default banner is a tall 2:3 poster: show it full width, focused on the faces at the top instead of a centre crop.
const POSTER=require('../assets/splash-default.jpg');
const POSTER_RATIO=1.5;
const POSTER_FOCUS=0.07;
const DEFAULT_SLIDES:BrandingBanner[]=[{id:'supplied',imageId:'',title:'SAMADHAN',enabled:true},{id:'community',imageId:'',title:'जनता की बात, समाधान के साथ',enabled:true}];
// Web needs a hint so horizontal drags reach the responder while vertical drags still scroll the page; text/image selection would fight mouse swipes.
// react-native-web accepts these CSS props; RN's ViewStyle type does not declare them, so widen the type once here.
type WebGestureStyle={touchAction:string;userSelect:string;cursor:string};
const webGesture:StyleProp<ViewStyle>=Platform.OS==='web'?({touchAction:'pan-y',userSelect:'none',cursor:'grab'} satisfies WebGestureStyle as ViewStyle):null;
const mod=(n:number,m:number)=>((n%m)+m)%m;
// Banner caption in the active language; the English caption when no Hindi one was written.
const captionOf=(b:BrandingBanner,hindi:boolean)=>hindi&&b.captionHi?b.captionHi:b.caption;
const now=()=>Date.now();
// Server-side validation already restricts links to https; re-check here so a tampered payload can never open another scheme.
const safeLink=(value?:string)=>{if(typeof value!=='string')return;const raw=value.trim();if(raw.length>1000||!/^https:\/\/[^/\\?#]/i.test(raw)||/[\s\u0000-\u001f\u007f\\]/u.test(raw))return;try{const url=new URL(raw);if(url.protocol==='https:'&&url.hostname&&!url.username&&!url.password)return raw;}catch{}};
// Older banners carry the uploaded file name as their label; only use a label as screen-reader text when it reads like a human title.
const readableLabel=(title:string)=>/\s|[^\x00-\x7F]/.test(title)?title:undefined;

export default function BrandingSlider({settings,connection,hindi}:{settings:Workspace['settings'];connection:Connection;hindi:boolean}){
 const published=settings.brandingBanners;
 const slides=useMemo(()=>published?published.filter(b=>b.enabled):DEFAULT_SLIDES,[published]);
 const signature=slides.map(b=>[b.id,b.imageId,b.caption??'',b.captionHi??'',b.linkUrl??''].join(':')).join('|');
 return <Slider key={signature} slides={slides} connection={connection} hindi={hindi}/>;
}

type Live={width:number;count:number;pos:number;settle:(target:number)=>void;grant:()=>void;move:(dx:number)=>void;end:(dx:number,vx:number,cancelled:boolean)=>void};

function Slider({slides,connection,hindi}:{slides:BrandingBanner[];connection:Connection;hindi:boolean}){
 const count=slides.length;
 const [pos,setPos]=useState(0);                       // absolute position of the committed slide; slide index = pos mod count
 const [width,setWidth]=useState(0);
 const [reduced,setReduced]=useState(true);
 const [screenReader,setScreenReader]=useState(false);
 const [appActive,setAppActive]=useState(AppState.currentState==='active');
 const [manualTick,setManualTick]=useState(0);
 const [failed,setFailed]=useState<string[]>([]);
 const [scroll]=useState(()=>new Animated.Value(0));  // track offset in px: -pos * width, plus any drag in progress
 const [fade]=useState(()=>new Animated.Value(1));    // only used to hide a non-adjacent jump
 const scrollValue=useRef(0);
 const lastManual=useRef(0);
 const swipedAt=useRef(0);
 const transition=useRef<Animated.CompositeAnimation|null>(null);
 const busy=useRef(false);
 const dragging=useRef(false);
 const dragStart=useRef(0);
 const live=useRef<Live>({width:0,count,pos:0,settle:()=>{},grant:()=>{},move:()=>{},end:()=>{}});

 useEffect(()=>{
  let mounted=true;
  AccessibilityInfo.isReduceMotionEnabled().then(v=>{if(mounted)setReduced(v);}).catch(()=>{});
  // react-native-web cannot detect screen readers (it always answers true), so only trust the signal on native.
  if(Platform.OS!=='web')AccessibilityInfo.isScreenReaderEnabled().then(v=>{if(mounted)setScreenReader(v);}).catch(()=>{});
  const motion=AccessibilityInfo.addEventListener('reduceMotionChanged',setReduced);
  const reader=AccessibilityInfo.addEventListener('screenReaderChanged',setScreenReader);
  const app=AppState.addEventListener('change',v=>setAppActive(v==='active'));
  return()=>{mounted=false;motion?.remove();reader?.remove();app.remove();};
 },[]);
 useEffect(()=>{const id=scroll.addListener(({value})=>{scrollValue.current=value;});return()=>scroll.removeListener(id);},[scroll]);
 // Keep the track aligned with the committed slide (also after a resize) and reveal it again after a jump.
 useEffect(()=>{
  if(!width)return;
  scroll.setValue(-pos*width);busy.current=false;
  const reveal=Animated.timing(fade,{toValue:1,duration:reduced?0:200,useNativeDriver:false});
  reveal.start();
  return()=>reveal.stop();
 },[pos,width,reduced,scroll,fade]);

 const auto=count>1&&width>0&&!reduced&&!screenReader&&appActive;
 useEffect(()=>{
  if(!auto)return;
  const wait=Math.max(ADVANCE_MS,lastManual.current+RESUME_MS-now());
  const timer=setTimeout(()=>{
   if(busy.current||dragging.current){setManualTick(t=>t+1);return;}
   live.current.settle(live.current.pos+1);
  },wait);
  return()=>clearTimeout(timer);
 },[auto,pos,manualTick]);

 const markManual=()=>{lastManual.current=now();setManualTick(t=>t+1);};
 // Animate the track to `target` (within one slide of the committed position) and commit it.
 const settle=(target:number)=>{
  transition.current?.stop();
  const to=-target*width;
  const done=()=>{busy.current=false;setPos(target);};
  if(reduced||Math.abs(scrollValue.current-to)<.5){scroll.setValue(to);done();return;}
  busy.current=true;
  const animation=Animated.timing(scroll,{toValue:to,duration:SLIDE_MS,easing:Easing.out(Easing.cubic),useNativeDriver:false});
  transition.current=animation;
  animation.start(({finished})=>{if(finished)done();else if(transition.current===animation)busy.current=false;});
 };
 const announce=(target:number)=>{if(!screenReader)return;const b=slides[mod(target,count)];AccessibilityInfo.announceForAccessibility(`${hindi?'बैनर':'Banner'} ${mod(target,count)+1} / ${count}${captionOf(b,hindi)?': '+captionOf(b,hindi):''}`);};
 const jump=(index:number)=>{
  markManual();if(busy.current||count<2||!width)return;
  const forward=mod(index-pos,count),delta=forward>count/2?forward-count:forward;
  if(delta===0)return;
  announce(pos+delta);
  if(Math.abs(delta)===1){settle(pos+delta);return;}
  // Non-adjacent dot: fade out, move, and let the alignment effect fade back in.
  busy.current=true;
  const out=Animated.timing(fade,{toValue:0,duration:reduced?0:130,useNativeDriver:false});
  transition.current=out;
  out.start(({finished})=>{if(finished)setPos(pos+delta);else busy.current=false;});
 };
 const grant=()=>{transition.current?.stop();busy.current=false;dragging.current=true;dragStart.current=scrollValue.current;markManual();};
 const move=(dx:number)=>{const w=live.current.width,p=live.current.pos;scroll.setValue(Math.min(-(p-1)*w,Math.max(-(p+1)*w,dragStart.current+dx)));};
 const end=(dx:number,vx:number,cancelled:boolean)=>{
  dragging.current=false;swipedAt.current=now();markManual();
  const from=-(cancelled?scrollValue.current:dragStart.current)/width,threshold=Math.min(64,width*.2);
  let target=Math.round(from);
  if(!cancelled&&(dx<-threshold||(dx<-12&&vx<-.45)))target=Math.floor(from+.001)+1;
  else if(!cancelled&&(dx>threshold||(dx>12&&vx>.45)))target=Math.ceil(from-.001)-1;
  target=Math.max(pos-1,Math.min(pos+1,target));
  if(target!==pos)announce(target);
  settle(target);
 };
 useEffect(()=>{live.current={width,count,pos,settle,grant,move,end};});
 // eslint-disable-next-line react-hooks/refs -- the responder callbacks only read `live` when a touch event fires, never during render
 const pan=useMemo(()=>PanResponder.create({
  // Claim the gesture only for clearly horizontal drags so vertical drags keep scrolling the page.
  onMoveShouldSetPanResponder:(_e,g)=>live.current.count>1&&Math.abs(g.dx)>8&&Math.abs(g.dx)>Math.abs(g.dy)*1.4,
  onPanResponderTerminationRequest:()=>false,
  onPanResponderGrant:()=>live.current.grant(),
  onPanResponderMove:(_e,g)=>live.current.move(g.dx),
  onPanResponderRelease:(_e,g)=>live.current.end(g.dx,g.vx,false),
  onPanResponderTerminate:()=>live.current.end(0,0,true),
 }),[]);
 const openLink=(url:string)=>{
  // A mouse drag on web still ends in a click on the slide: never treat the end of a swipe as a tap.
  if(dragging.current||now()-swipedAt.current<400)return;
  markManual();Linking.openURL(url).catch(()=>{});
 };

 if(!count)return null;
 const index=mod(pos,count);
 const anyText=slides.some(b=>!!captionOf(b,hindi)||!!safeLink(b.linkUrl));
 const t=(en:string,hi:string)=>hindi?hi:en;
 const positions=count>1?[pos-1,pos,pos+1]:[pos];
 const onLayout=(e:LayoutChangeEvent)=>{const w=Math.round(e.nativeEvent.layout.width);if(w>0&&w!==width)setWidth(w);};
 return <View role="region" aria-label={`${t('Branding banners','ब्रांडिंग बैनर')}, ${index+1} / ${count}`} style={s.wrap}>
  <View onLayout={onLayout} style={[s.viewport,{height:ART_HEIGHT},webGesture]} {...pan.panHandlers}>
   {width>0&&<Animated.View style={[s.track,{opacity:fade,transform:[{translateX:scroll}]}]}>
    {positions.map(p=>{const i=mod(p,count),slide=slides[i];return <Pane key={p} slide={slide} position={p} width={width} current={p===pos} showCaption={anyText} total={count} order={i} connection={connection} hindi={hindi} broken={failed.includes(slide.id)} animate={p===pos&&!reduced&&appActive} onBroken={()=>setFailed(ids=>ids.includes(slide.id)?ids:[...ids,slide.id])} onOpen={openLink}/>;})}
   </Animated.View>}
   {count>1&&<View pointerEvents="box-none" style={s.dotsWrap}><View style={s.dots}><View style={s.dots}>{slides.map((b,i)=><Pressable key={b.id} accessibilityRole="button" accessibilityLabel={`${t('Banner','बैनर')} ${i+1} / ${count}${captionOf(b,hindi)?': '+captionOf(b,hindi):''}`} accessibilityState={{selected:i===index}} hitSlop={{top:12,bottom:12,left:4,right:4}} onPress={()=>jump(i)} style={s.dotTarget}><View style={[s.dot,i===index&&s.dotActive]}/></Pressable>)}</View></View></View>}
  </View>
 </View>;
}

type PaneProps={slide:BrandingBanner;position:number;width:number;current:boolean;showCaption:boolean;total:number;order:number;connection:Connection;hindi:boolean;broken:boolean;animate:boolean;onBroken:()=>void;onOpen:(url:string)=>void};
function Pane({slide,position,width,current,showCaption,total,order,connection,hindi,broken,animate,onBroken,onOpen}:PaneProps){
 const link=safeLink(slide.linkUrl);
 const civic=slide.id==='community'||broken;
 const generic=`${hindi?'बैनर':'Banner'} ${order+1} / ${total}`;
 const caption=captionOf(slide,hindi);
 const alt=caption||(slide.imageId?readableLabel(slide.title):slide.title)||generic;
 const source=slide.imageId?{uri:`${connection.url}/api/media?id=${encodeURIComponent(slide.imageId)}`,headers:connection.token?{Authorization:`Bearer ${connection.token}`}:undefined}:require('../assets/splash-default.jpg');
 const body=<>
  <View style={s.art}>{civic?<CivicArt hindi={hindi} animate={animate}/>:slide.imageId?<MediaImage accessible accessibilityLabel={alt} style={s.image} resizeMode="cover" source={source} onError={onBroken}/>:<Image accessible accessibilityLabel={alt} source={POSTER} resizeMode="stretch" style={{position:'absolute',left:0,top:-POSTER_FOCUS*width*POSTER_RATIO,width,height:width*POSTER_RATIO}}/>}</View>
  {(caption||link)?<View style={s.captionRow}>
   <Text numberOfLines={2} style={s.captionText}>{caption||(hindi?'अधिक जानकारी के लिए टैप करें':'Tap to learn more')}</Text>
   {link&&<View style={s.cta}><Text style={s.ctaText}>{hindi?'और जानें':'Learn more'}</Text><Ionicons name="open-outline" size={14} color={NAVY}/></View>}
  </View>:null}
 </>;
 const placement=[s.pane,{left:position*width,width}];
 const hidden={'aria-hidden':!current,accessibilityElementsHidden:!current,importantForAccessibility:current?'auto' as const:'no-hide-descendants' as const};
 if(!link)return <View style={placement} {...hidden}>{body}</View>;
 return <Pressable accessibilityRole="link" accessibilityLabel={`${alt}. ${hindi?'लिंक खोलें':'Opens a link'}`} focusable={current} tabIndex={current?0:-1} disabled={!current} onPress={()=>onOpen(link)} style={({pressed})=>[placement,pressed&&s.panePressed]} {...hidden}>{body}</Pressable>;
}

// Default slide when no custom banners were published: tricolour-toned brand art with a gently floating logo and a slowly turning chakra ring.
function CivicArt({hindi,animate}:{hindi:boolean;animate:boolean}){
 const [float]=useState(()=>new Animated.Value(0));
 const [spin]=useState(()=>new Animated.Value(0));
 useEffect(()=>{
  if(!animate)return;
  const native=Platform.OS!=='web';
  const ease=Easing.inOut(Easing.sin);
  const bob=Animated.loop(Animated.sequence([Animated.timing(float,{toValue:1,duration:2600,easing:ease,useNativeDriver:native}),Animated.timing(float,{toValue:0,duration:2600,easing:ease,useNativeDriver:native})]));
  const turn=Animated.loop(Animated.timing(spin,{toValue:1,duration:36000,easing:Easing.linear,useNativeDriver:native}));
  bob.start();turn.start();
  return()=>{bob.stop();turn.stop();};
 },[animate,float,spin]);
 const lift=float.interpolate({inputRange:[0,1],outputRange:[0,-7]});
 const drift=float.interpolate({inputRange:[0,1],outputRange:[0,-12]});
 const rotate=spin.interpolate({inputRange:[0,1],outputRange:['0deg','360deg']});
 return <View style={s.civic}>
  <Animated.View style={[s.sun,{transform:[{translateY:drift}]}]}/>
  <Animated.View style={[s.leaf,{transform:[{translateX:drift}]}]}/>
  <View style={s.logoWrap}><Animated.View style={[s.ring,{transform:[{rotate}]}]}/><Animated.Image source={require('../assets/samadhan-logo.png')} resizeMode="contain" style={[s.logo,{transform:[{translateY:lift}]}]}/></View>
  <View style={{flex:1}}>
   <Text style={s.brand}>SAMADHAN</Text>
   <Text style={s.tagline}>{hindi?'जनता की बात,\nसमाधान के साथ':'Your voice.\nOur responsibility.'}</Text>
   <Text style={s.civicNote}>{hindi?'अपने शहर से जुड़ें।':'Connected to your community.'}</Text>
  </View>
  <View style={s.civicStripe}><View style={{flex:1,backgroundColor:SAFFRON}}/><View style={{flex:1,backgroundColor:colors.white}}/><View style={{flex:1,backgroundColor:colors.flagGreen}}/></View>
 </View>;
}

const s=StyleSheet.create({
 // Raised card: translucent so the civic watermark shows faintly around it; per-fill lip and layered shadow.
 wrap:{marginTop:2,marginBottom:18},
 viewport:{borderRadius:22,overflow:'hidden',backgroundColor:colors.saffronSoft,boxShadow:[{offsetX:0,offsetY:4,blurRadius:14,spreadDistance:-4,color:rgba(colors.navy,.14)}]},
 track:{...StyleSheet.absoluteFill},
 pane:{position:'absolute',top:0,bottom:0},
 panePressed:{opacity:.94},
 art:{height:ART_HEIGHT,backgroundColor:colors.saffronSoft},
 image:{width:'100%',height:'100%'},
 captionRow:{position:'absolute',left:0,right:0,bottom:0,flexDirection:'row',alignItems:'center',gap:10,paddingTop:10,paddingBottom:30,paddingHorizontal:16,backgroundColor:rgba(NAVY,.72)},
 captionText:{flex:1,fontSize:13,lineHeight:18,fontWeight:'600',color:colors.white},
 // Saffron is the highlight / call-to-action colour: raised pill with a darker lip.
 cta:{...raised(SAFFRON,{lip:3,level:'flat'}),flexDirection:'row',alignItems:'center',gap:5,paddingHorizontal:12,height:34,borderRadius:17},
 ctaText:{fontSize:12,fontWeight:'700',color:colors.ink},
 dotsWrap:{position:'absolute',left:0,right:0,bottom:8,alignItems:'center'},
 dots:{flexDirection:'row',alignItems:'center',backgroundColor:rgba(NAVY,.36),borderRadius:12,paddingHorizontal:6,height:20},
 dotTarget:{height:20,minWidth:14,paddingHorizontal:3,alignItems:'center',justifyContent:'center'},
 dot:{width:6,height:6,borderRadius:3,backgroundColor:rgba(colors.white,.65)},
 dotActive:{width:18,backgroundColor:colors.white},
 civic:{flex:1,flexDirection:'row',alignItems:'center',gap:14,paddingLeft:20,paddingRight:16,paddingBottom:6,backgroundColor:tint(colors.saffronSoft,.55),overflow:'hidden'},
 sun:{position:'absolute',width:200,height:200,borderRadius:100,right:-70,top:-95,backgroundColor:tint(SAFFRON,.62),opacity:.85},
 leaf:{position:'absolute',width:170,height:170,borderRadius:85,left:-85,bottom:-95,backgroundColor:tint(GREEN,.8),opacity:.9},
 logoWrap:{width:104,height:124,alignItems:'center',justifyContent:'center'},
 ring:{position:'absolute',width:118,height:118,borderRadius:59,borderWidth:2,borderStyle:'dashed',borderColor:rgba(colors.navy,.22)},
 logo:{width:88,height:106},
 brand:{fontSize:typeScale.titleSm.fontSize,fontWeight:'700',letterSpacing:1.4,color:NAVY},
 tagline:{fontSize:typeScale.bodyMd.fontSize,lineHeight:24,fontWeight:'500',marginTop:7,color:NAVY},
 civicNote:{fontSize:12,color:colors.greenText,marginTop:9},
 civicStripe:{position:'absolute',left:0,right:0,bottom:0,height:5,flexDirection:'row'},
});
