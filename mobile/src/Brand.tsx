import {Text,colors,rgba,tricolour} from './Design';
import React,{useCallback,useEffect,useRef,useState} from 'react';
import {View,Image,StyleSheet,Animated,Easing,AccessibilityInfo,ActivityIndicator,Platform,type ImageSourcePropType,type LayoutChangeEvent,type ViewStyle} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import * as SplashScreen from 'expo-splash-screen';
import {isRunningInExpoGo} from 'expo';
export const palette={navy:colors.navy,green:colors.green,saffron:colors.saffron,paper:colors.paper,muted:colors.textSecondary};
export function TirangaBand(){return <View accessibilityLabel="Saffron, white and green" style={{height:5,flexDirection:'row',boxShadow:[{offsetX:0,offsetY:1,blurRadius:3,color:rgba(colors.navy,.12)}]}}>{tricolour.map(color=><View key={color} style={{flex:1,backgroundColor:color}}/>)}</View>;}
export function Chakra({size=36}:{size?:number}){return <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{height:size,width:size,borderWidth:1.5,borderColor:colors.navy,borderRadius:size/2,alignItems:'center',justifyContent:'center'}}>{Array.from({length:12},(_,i)=><View key={i} style={{position:'absolute',width:1,height:size-4,backgroundColor:colors.navy,transform:[{rotate:`${i*15}deg`}]}}/>)}<View style={{width:6,height:6,borderRadius:3,backgroundColor:colors.navy}}/></View>;}

/*
 * Launch splash
 * -------------
 * 1. The native splash (expo-splash-screen plugin in app.config.js) shows the logo centred on SPLASH_BG at SPLASH_LOGO_SIZE.
 *    It is held with preventAutoHideAsync() (App.tsx, module load) and released by hideNativeSplash() once the first
 *    BrandedSplash frame - the very same logo on the very same background - has laid out and the logo has loaded.
 * 2. BrandedSplash then animates away from that frame: logo spring, rotating Ashoka Chakra, tagline reveal, tricolour progress
 *    bar, and finally the branding artwork cross-fades in over the logo.
 * 3. It exits (fade + scale out, while App cross-fades the app in underneath) once the minimum animation time has passed AND App
 *    reports ready. App always reports ready by SPLASH_INIT_CAP_MS, so slow networks can never strand a resident here.
 * The animation plays exactly once per mounted launch splash; later changes of imageUrl only cross-fade the artwork layer.
 */
export const SPLASH_BG=colors.paper;    // keep identical to backgroundColor of the expo-splash-screen plugin in app.config.js
export const SPLASH_LOGO_SIZE=160;       // keep identical to imageWidth of the expo-splash-screen plugin in app.config.js
export const SPLASH_MIN_MS=2400;         // shortest time the launch animation stays on screen
export const SPLASH_INIT_CAP_MS=3500;    // App releases its ready gate by then even if fonts/network are still pending
export const SPLASH_EXIT_MS=420;         // fade/scale-out of the splash, and the cross-fade into the app
const ART_AT_MS=1100;                    // the brand intro gets this long before the artwork may cross-fade in
const ART_WAIT_MS=3000;                  // exit waits for a still-loading artwork only until here
const CROSSFADE_MS=520;                  // artwork layer swap (cached -> fresh branding image)
const FIRST_FRAME_WAIT_MS=1200;          // never keep the native splash up longer than this waiting for the logo to load
const NATIVE_FADE_MS=120;                // native splash fade-out (iOS cross-dissolve / Android alpha)
const HANDOFF_MS=NATIVE_FADE_MS+30;      // in-app motion starts after the native splash is gone, so no double logo is visible
const BAR_W=132;
const native=Platform.OS!=='web';        // the native driver does not exist on web
const LOGO=require('../assets/splash-logo.png');
const DEFAULT_ART=require('../assets/splash-artwork.jpg');

let nativeSplashHidden=false;
let nativeSplashHiding=false;
/** Releases the native launch screen. Safe to call repeatedly and on web. */
export function hideNativeSplash(){
 if(nativeSplashHidden||nativeSplashHiding||Platform.OS==='web')return;
 nativeSplashHiding=true;
 try{if(!isRunningInExpoGo())SplashScreen.setOptions({duration:NATIVE_FADE_MS,fade:true});}catch{}
 SplashScreen.hideAsync().then(()=>{nativeSplashHidden=true;}).catch(()=>{}).finally(()=>{nativeSplashHiding=false;});
}

const timing=(value:Animated.Value,toValue:number,duration:number,easing:(t:number)=>number=Easing.out(Easing.cubic))=>Animated.timing(value,{toValue,duration,easing,useNativeDriver:native});
const after=(ms:number,animation:Animated.CompositeAnimation)=>ms>0?Animated.sequence([Animated.delay(ms),animation]):animation;
// scripts/mobile-web.mjs injects an inline CSS splash (#samadhan-splash) into the web page; carry its look over seamlessly.
const inlineWebSplashPresent=()=>Platform.OS==='web'&&typeof document!=='undefined'&&!!document.getElementById('samadhan-splash');

type ArtLayerState={key:string;source:ImageSourcePropType;instant:boolean;loaded:boolean;failed:boolean};
type SplashProps={
 /** Branding artwork: undefined = bundled artwork, null = still being resolved (artwork waits), string = admin artwork URL. */
 imageUrl?:string|null;
 /** App has settled fonts and workspace/branding (or hit its cap). The splash never exits before this. */
 ready?:boolean;
 /** Fonts are loaded or failed, so text can be revealed without a font swap. */
 fontsSettled?:boolean;
 /** Driven 0 -> 1 during the exit so App can cross-fade its content in underneath. */
 reveal?:Animated.Value;
 /** Called once, after the exit animation has finished. */
 onFinish?:()=>void;
};

function ArtLayer({layer,onLoad,onError}:{layer:ArtLayerState;onLoad:(key:string)=>void;onError:(key:string)=>void}){
 const [opacity]=useState(()=>new Animated.Value(0));
 const animation=useRef<Animated.CompositeAnimation|null>(null);
 useEffect(()=>()=>{animation.current?.stop();},[]);
 // The first layer is revealed by the artwork card itself; later layers cross-fade over the one they replace.
 const handleLoad=()=>{animation.current?.stop();if(layer.instant)opacity.setValue(1);else{animation.current=timing(opacity,1,CROSSFADE_MS,Easing.inOut(Easing.quad));animation.current.start();}onLoad(layer.key);};
 return <Animated.View style={[StyleSheet.absoluteFill,{opacity}]}><Image accessibilityLabel="Admin configured personal branding" source={layer.source} style={s.artImage} resizeMode="contain" fadeDuration={0} onLoad={handleLoad} onError={()=>onError(layer.key)}/></Animated.View>;
}

export function BrandedSplash({imageUrl,ready=true,fontsSettled=true,reveal,onFinish}:SplashProps){
 const insets=useSafeAreaInsets();
 const [size,setSize]=useState({w:0,h:0});
 const [logoLoaded,setLogoLoaded]=useState(false),[waited,setWaited]=useState(false);
 const [reduced,setReduced]=useState<boolean|null>(null);
 const [artDue,setArtDue]=useState(false);
 const [layers,setLayers]=useState<ArtLayerState[]>([]);
 const [v]=useState(()=>({
  logoScale:new Animated.Value(1),logoOpacity:new Animated.Value(1),
  chakraOpacity:new Animated.Value(0),chakraScale:new Animated.Value(.82),spin:new Animated.Value(0),spinSmall:new Animated.Value(0),
  band:new Animated.Value(inlineWebSplashPresent()?1:0),
  tag:new Animated.Value(0),tagShift:new Animated.Value(14),
  bar:new Animated.Value(0),barFill:new Animated.Value(0),pulse:new Animated.Value(1),
  art:new Animated.Value(0),artScale:new Animated.Value(.96),
  exitOpacity:new Animated.Value(1),exitScale:new Animated.Value(1),
 }));
 const running=useRef<Animated.CompositeAnimation[]>([]);
 const flags=useRef({intro:false,tag:false,art:false,min:false,artWait:false,exiting:false});
 const latest=useRef<{ready:boolean;artSettled:boolean;reduced:boolean|null;reveal?:Animated.Value;onFinish?:()=>void}>({ready,artSettled:false,reduced:null});
 const run=useCallback((animation:Animated.CompositeAnimation,done?:(finished:boolean)=>void)=>{running.current.push(animation);animation.start(({finished})=>done?.(finished));},[]);

 // ---- first frame -> native hand-off ------------------------------------------------------------------------------
 const laidOut=size.w>0;
 const started=laidOut&&(logoLoaded||waited);
 const go=started&&reduced!==null;
 const lead=native?HANDOFF_MS:0;
 const onLayout=(e:LayoutChangeEvent)=>{const {width,height}=e.nativeEvent.layout;setSize(p=>p.w===width&&p.h===height?p:{w:width,h:height});};
 useEffect(()=>{if(!laidOut)return;const timer=setTimeout(()=>setWaited(true),FIRST_FRAME_WAIT_MS);return()=>clearTimeout(timer);},[laidOut]);
 useEffect(()=>{if(!started)return;const id=requestAnimationFrame(()=>hideNativeSplash());return()=>cancelAnimationFrame(id);},[started]);
 // Reduce-motion keeps a subtle opacity-only animation instead of skipping it. Read once: the animation is not restarted.
 useEffect(()=>{
  let alive=true;
  AccessibilityInfo.isReduceMotionEnabled().then(r=>{if(alive)setReduced(previous=>previous??r);}).catch(()=>{if(alive)setReduced(previous=>previous??true);});
  // Resolve once; a late platform response cannot change the timeline mid-animation.
  // When preference lookup stalls, opacity-only is the conservative fallback.
  const timer=setTimeout(()=>{if(alive)setReduced(r=>r??true);},400);
  return()=>{alive=false;clearTimeout(timer);};
 },[]);

 // ---- artwork layers: only this layer reacts to imageUrl changes (cached -> fresh), nothing restarts ------------------
 // Derived while rendering (React's "adjust state when a prop changes" pattern), so there is no extra effect pass.
 const artKey=imageUrl===null?null:imageUrl??'bundled';
 const [seenArtKey,setSeenArtKey]=useState<string|null>(null);
 if(artKey!==null&&artKey!==seenArtKey){
  setSeenArtKey(artKey);
  setLayers(ls=>{
   if(ls.length&&ls[ls.length-1].key===artKey)return ls;
   const keep=ls.filter(l=>l.loaded&&l.key!==artKey);
   return [...keep,{key:artKey,source:imageUrl?{uri:imageUrl}:DEFAULT_ART,instant:keep.length===0,loaded:false,failed:false}];
  });
 }
 useEffect(()=>{
  const newest=layers[layers.length-1];
  if(!newest?.loaded||layers.length<2)return;
  const timer=setTimeout(()=>setLayers(ls=>ls.filter(l=>l.key===newest.key)),CROSSFADE_MS+80);
  return()=>clearTimeout(timer);
 },[layers]);
 const markLoaded=useCallback((key:string)=>setLayers(ls=>ls.map(l=>l.key===key?{...l,loaded:true}:l)),[]);
 const markFailed=useCallback((key:string)=>setLayers(ls=>ls.map(l=>l.key===key?{...l,failed:true}:l)),[]);
 const anyLoaded=layers.some(l=>l.loaded);
 const artSettled=imageUrl!==null&&layers.length>0&&layers.every(l=>l.loaded||l.failed);

 // ---- exit: fade/scale the splash out while App cross-fades the app in --------------------------------------------
 const tryExit=useCallback(()=>{
  const f=flags.current,l=latest.current;
  if(f.exiting||!f.min||!l.ready||!(l.artSettled||f.artWait))return;
  f.exiting=true;
  const motion=!l.reduced;
  const fade=Animated.parallel([
   timing(v.exitOpacity,0,SPLASH_EXIT_MS,Easing.in(Easing.quad)),
   ...(motion?[timing(v.exitScale,1.06,SPLASH_EXIT_MS)]:[]),
   ...(l.reveal?[timing(l.reveal,1,SPLASH_EXIT_MS,Easing.out(Easing.quad))]:[]),
  ]);
  const finish=l.onFinish;
  run(Animated.parallel([motion?timing(v.barFill,1,200):Animated.delay(0),after(motion?140:0,fade)]),finished=>{if(finished)finish?.();});
 },[run,v]);
 useEffect(()=>{const l=latest.current;l.ready=ready;l.artSettled=artSettled;l.reduced=reduced;l.reveal=reveal;l.onFinish=onFinish;tryExit();});

 // ---- timeline: starts once, at hand-off ------------------------------------------------------------------------------
 useEffect(()=>{
  if(!go||flags.current.intro)return;
  flags.current.intro=true;
  const barSpan=Math.max(900,SPLASH_MIN_MS-600-lead);
  if(reduced){
   v.tagShift.setValue(0);v.artScale.setValue(1);v.barFill.setValue(1);
   run(after(lead+120,timing(v.band,1,600)));
   run(after(lead+250,timing(v.chakraOpacity,.11,900)));
   run(after(lead+500,timing(v.bar,1,500)));
   run(Animated.loop(Animated.sequence([timing(v.pulse,.45,1100,Easing.inOut(Easing.sin)),timing(v.pulse,1,1100,Easing.inOut(Easing.sin))])));
   return;
  }
  // The logo starts exactly as the native splash drew it (scale 1), dips, then springs.
  run(after(lead,Animated.sequence([timing(v.logoScale,.92,140,Easing.out(Easing.quad)),Animated.spring(v.logoScale,{toValue:1,friction:5,tension:120,useNativeDriver:native})])));
  run(after(lead+120,timing(v.band,1,600)));
  run(after(lead+250,Animated.parallel([timing(v.chakraOpacity,.11,900),Animated.spring(v.chakraScale,{toValue:1,friction:8,tension:40,useNativeDriver:native})])));
  run(after(lead+250,Animated.loop(timing(v.spin,1,18000,Easing.linear))));
  run(Animated.loop(timing(v.spinSmall,1,2600,Easing.linear)));
  run(after(lead+500,timing(v.bar,1,400)));
  run(after(lead+600,timing(v.barFill,.88,barSpan)));
 },[go,reduced,lead,run,v]);
 // Text waits for the fonts so the tagline never swaps typeface mid-reveal.
 useEffect(()=>{
  if(!go||!fontsSettled||flags.current.tag)return;
  flags.current.tag=true;
  run(after(lead+(reduced?250:450),Animated.parallel([timing(v.tag,1,650),timing(v.tagShift,0,650)])));
 },[go,fontsSettled,reduced,lead,run,v]);
 // Clock: artwork may appear after the brand intro; the minimum on-screen time and the artwork wait are measured from hand-off.
 useEffect(()=>{
  if(!go)return;
  const f=flags.current;
  const timers=[
   setTimeout(()=>setArtDue(true),lead+ART_AT_MS),
   setTimeout(()=>{f.min=true;tryExit();},SPLASH_MIN_MS),
   setTimeout(()=>{f.artWait=true;tryExit();},ART_WAIT_MS),
  ];
  return()=>timers.forEach(clearTimeout);
 },[go,lead,run,tryExit,v]);
 // Branding artwork cross-fades in over the logo stage once it has loaded (and the brand intro has had its moment).
 useEffect(()=>{
  if(!go||!artDue||!anyLoaded||flags.current.art)return;
  flags.current.art=true;
  const motion=!reduced;
  run(Animated.parallel([
   timing(v.art,1,650,Easing.inOut(Easing.cubic)),
   timing(v.logoOpacity,0,450,Easing.in(Easing.quad)),
   timing(v.chakraOpacity,0,450),
   ...(motion?[Animated.spring(v.artScale,{toValue:1,friction:8,tension:50,useNativeDriver:native}),timing(v.logoScale,.9,450)]:[]),
  ]));
 },[go,artDue,anyLoaded,reduced,run,v]);
 useEffect(()=>{
  const list=running.current,f=flags.current;
  return()=>{list.forEach(a=>a.stop());list.length=0;Object.assign(f,{intro:false,tag:false,art:false,min:false,artWait:false,exiting:false});};
 },[]);

 const chakraSize=Math.round(Math.min(360,Math.min(size.w,size.h)*.82));
 const rootStyle:ViewStyle={position:'absolute',top:-insets.top,bottom:-insets.bottom,left:-insets.left,right:-insets.right};
 const pad:ViewStyle={paddingTop:insets.top,paddingBottom:insets.bottom,paddingLeft:insets.left,paddingRight:insets.right};
 const spin=v.spin.interpolate({inputRange:[0,1],outputRange:['0deg','360deg']});
 const spinSmall=v.spinSmall.interpolate({inputRange:[0,1],outputRange:['0deg','360deg']});
 return <View style={rootStyle} onLayout={onLayout} accessible accessibilityRole="progressbar" accessibilityLabel="SAMADHAN. Connecting you to your city.">
  <Animated.View style={[s.splash,{opacity:v.exitOpacity,transform:[{scale:v.exitScale}]}]}>
   <View style={[s.column,pad]}>
    <Animated.View style={{opacity:v.band}}><TirangaBand/></Animated.View>
    <View style={s.stage}>
     <Animated.View style={[s.art,{opacity:v.art,transform:[{scale:v.artScale}]}]}>
      {layers.filter(l=>!l.failed).map(l=><ArtLayer key={l.key} layer={l} onLoad={markLoaded} onError={markFailed}/>)}
     </Animated.View>
    </View>
    <View style={s.loading}>
     <Animated.View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[s.barTrack,{opacity:v.bar}]}>
      <Animated.View style={[s.barFill,{opacity:v.pulse,transform:[{translateX:v.barFill.interpolate({inputRange:[0,1],outputRange:[-BAR_W,0]})}]}]}>{[colors.saffron,colors.border,colors.green].map(color=><View key={color} style={{flex:1,backgroundColor:color}}/>)}</Animated.View>
     </Animated.View>
     <Animated.View style={[s.status,{opacity:v.tag}]}><Animated.View style={{transform:[{rotate:spinSmall}]}}><Chakra size={18}/></Animated.View><Text style={s.loadingText}>Connecting you to your city…</Text></Animated.View>
     <Animated.View style={{opacity:v.tag,transform:[{translateY:v.tagShift}]}}><Text style={s.footer}>YOUR VOICE. OUR RESPONSIBILITY.</Text></Animated.View>
    </View>
    <Animated.View style={{opacity:v.band}}><TirangaBand/></Animated.View>
   </View>
   <View style={s.center}>
    {laidOut&&<Animated.View style={{position:'absolute',left:(size.w-chakraSize)/2,top:(size.h-chakraSize)/2,opacity:v.chakraOpacity,transform:[{scale:v.chakraScale},{rotate:spin}]}}><Chakra size={chakraSize}/></Animated.View>}
    <Animated.View style={{opacity:v.logoOpacity,transform:[{scale:v.logoScale}]}}><Image accessibilityLabel="SAMADHAN" source={LOGO} style={s.logo} resizeMode="contain" fadeDuration={0} onLoad={()=>setLogoLoaded(true)}/></Animated.View>
   </View>
  </Animated.View>
 </View>;
}

/** Shown (under the splash, or right after it) while a saved session is still loading, so slow networks never flash the login screen. */
export function WorkspaceLoading(){
 return <View accessibilityRole="progressbar" accessibilityLabel="Loading SAMADHAN" style={s.waiting}>
  <Image source={LOGO} style={s.logo} resizeMode="contain" fadeDuration={0}/>
  <ActivityIndicator color={palette.green}/>
  <Text style={s.loadingText}>Getting things ready…</Text>
  <Text style={s.loadingText}>सब कुछ तैयार हो रहा है…</Text>
 </View>;
}

const s=StyleSheet.create({
 splash:{...StyleSheet.absoluteFill,backgroundColor:SPLASH_BG},
 column:{flex:1},
 stage:{flex:1},
 art:{...StyleSheet.absoluteFill,pointerEvents:'none',margin:8,borderRadius:20,overflow:'hidden',backgroundColor:colors.saffronSoft},
 // Explicit size: a static asset's natural size would otherwise win over the absolute insets.
 artImage:{width:'100%',height:'100%'},
 center:{...StyleSheet.absoluteFill,pointerEvents:'none',alignItems:'center',justifyContent:'center'},
 logo:{width:SPLASH_LOGO_SIZE,height:SPLASH_LOGO_SIZE},
 loading:{paddingHorizontal:20,paddingTop:14,paddingBottom:20,alignItems:'center',gap:12},
 barTrack:{height:5,width:BAR_W,borderRadius:4,overflow:'hidden',backgroundColor:colors.divider},
 barFill:{height:5,width:BAR_W,flexDirection:'row'},
 status:{flexDirection:'row',alignItems:'center',gap:8},
 loadingText:{fontSize:12,color:palette.muted,textAlign:'center'},
 footer:{fontSize:12,letterSpacing:1.5,color:colors.textSecondary},
 waiting:{flex:1,alignItems:'center',justifyContent:'center',gap:14},
});

/**
 * Branding artwork card for sign-in/onboarding/connect screens: the admin-published branding image
 * when there is one (same image as the splash), otherwise the bundled artwork.
 */
export function BrandingArt({imageUrl,height=200,style}:{imageUrl?:string|null;height?:number;style?:ViewStyle}){
  const [failed,setFailed]=useState(false);
  const source:ImageSourcePropType=imageUrl&&!failed?{uri:imageUrl}:DEFAULT_ART;
  return <View accessible accessibilityRole="image" accessibilityLabel="SAMADHAN" style={[{height,borderRadius:18,overflow:'hidden',backgroundColor:colors.paper,borderWidth:1,borderColor:colors.border,alignSelf:'stretch',boxShadow:[{offsetX:0,offsetY:6,blurRadius:16,color:rgba(colors.navy,.08)}]},style]}>
    <Image source={source} resizeMode="cover" onError={()=>setFailed(true)} style={{width:'100%',height:'100%'}}/>
  </View>;
}
