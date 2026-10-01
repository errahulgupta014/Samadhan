import React,{useState} from 'react';
import {View,Text,Image,Pressable,StyleSheet,Linking} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import type {Workspace} from '../shared/domain';
import {visibleClassified} from '../shared/community';
import type {Connection} from './api';

export default function CommunityDetail({kind,id,data,connection,hindi}:{kind:'ad'|'place';id?:string;data:Workspace;connection:Connection;hindi:boolean}){
 const [error,setError]=useState('');
 const t=(en:string,hi:string)=>hindi?hi:en;
 const ad=kind==='ad'?data.classifieds?.find(a=>a.id===id&&visibleClassified(a)):undefined;
 const place=kind==='place'?data.places?.find(p=>p.id===id&&p.published):undefined;
 const item=ad??place;
 if(!item)return <View style={s.empty}><Ionicons name="information-circle-outline" size={40} color="#677489"/><Text accessibilityRole="header" style={s.title}>{t('No longer available','अब उपलब्ध नहीं है')}</Text><Text style={s.body}>{t('This item may have expired or been unpublished. Go back to browse the latest listings.','यह सामग्री समाप्त हो गई है या हटा दी गई है। नवीनतम सूची देखने के लिए वापस जाएं।')}</Text></View>;
 const title=ad?(hindi&&ad.titleHi?ad.titleHi:ad.title):(hindi&&place!.nameHi?place!.nameHi:place!.name);
 const description=hindi&&item.descriptionHi?item.descriptionHi:item.description;
 const date=(value:string)=>new Date(value).toLocaleDateString(hindi?'hi-IN':'en-IN',{day:'numeric',month:'long',year:'numeric'});
 const external=(label:string,url:string)=> <Pressable accessibilityRole="button" style={s.button} onPress={async()=>{setError('');try{if(!url.startsWith('https://'))throw new Error();await Linking.openURL(url);}catch{setError(t('Unable to open this link. Please try again.','लिंक नहीं खुला। कृपया फिर से प्रयास करें।'));}}}><Text style={s.buttonText}>{label}</Text><Ionicons name="open-outline" size={19} color="#fff"/></Pressable>;
 return <>
  {item.imageId?<Image accessibilityLabel={title} resizeMode="contain" style={s.photo} source={{uri:`${connection.url}/api/media?id=${encodeURIComponent(item.imageId)}`,headers:connection.token?{Authorization:`Bearer ${connection.token}`}:undefined}}/>:<View style={[s.hero,kind==='place'&&{backgroundColor:'#EAF3EB'}]}><Ionicons name={kind==='ad'?'pricetags-outline':'compass-outline'} size={48} color={kind==='ad'?'#A66024':'#167347'}/><Text style={s.heroText}>{kind==='ad'?t('FROM YOUR COMMUNITY','आपके समुदाय से'):t('EXPLORE YOUR CITY','अपना शहर जानें')}</Text></View>}
  <Text style={s.eyebrow}>{kind==='ad'?t('ADVERTISEMENT DETAILS','विज्ञापन का विवरण'):t('PLACE DETAILS','स्थान का विवरण')}</Text>
  <Text accessibilityRole="header" style={s.title}>{title}</Text>
  {ad&&<Text style={s.publisher}>{t('Published by','प्रकाशक')} · {ad.advertiser}</Text>}
  <Text selectable style={s.body}>{description}</Text>
  <View style={s.info}>
   {ad?<><Text style={s.label}>{t('Valid from','प्रारंभ तिथि')}</Text><Text style={s.value}>{date(ad.startsAt)}</Text><Text style={s.label}>{t('Valid until','अंतिम तिथि')}</Text><Text style={s.value}>{date(ad.endsAt)}</Text>{!!ad.contactPhone&&<><Text style={s.label}>{t('Contact number','संपर्क नंबर')}</Text><Text selectable style={s.value}>{ad.contactPhone}</Text></>}</>:<><Text style={s.label}>{t('Address','पता')}</Text><Text selectable style={s.value}>{place!.address}</Text>{!!place!.hours&&<><Text style={s.label}>{t('Visiting hours','खुलने का समय')}</Text><Text style={s.value}>{place!.hours}</Text></>}</>}
  </View>
  {ad?.url&&external(t('Visit advertiser website','विज्ञापनदाता की वेबसाइट देखें'),ad.url)}
  {place?.mapUrl&&external(t('Get directions','रास्ता देखें'),place.mapUrl)}
  {place?.sourceUrl&&external(t('More information','और जानकारी'),place.sourceUrl)}
  {!!error&&<Text accessibilityRole="alert" style={s.error}>{error}</Text>}
 </>;
}
const s=StyleSheet.create({photo:{height:260,width:'100%',borderRadius:20,backgroundColor:'#F0F2EE',marginBottom:24},hero:{height:150,borderRadius:22,backgroundColor:'#FFF0DD',alignItems:'center',justifyContent:'center',gap:15,marginBottom:22},heroText:{fontSize:10,letterSpacing:1.4,fontWeight:'700',color:'#526174'},eyebrow:{fontSize:10,letterSpacing:1.7,color:'#167347',fontWeight:'700',marginBottom:12},title:{fontSize:28,lineHeight:36,fontWeight:'700',color:'#152B50',marginBottom:12},publisher:{fontSize:13,color:'#677489',marginBottom:18},body:{fontSize:16,lineHeight:27,color:'#45566C',marginBottom:20},info:{backgroundColor:'#fff',borderWidth:1,borderColor:'#E3E8E1',borderRadius:20,padding:20,marginVertical:8},label:{fontSize:12,color:'#68768A',marginBottom:7},value:{fontSize:16,lineHeight:25,color:'#152B50',marginBottom:15},button:{minHeight:50,padding:16,borderRadius:14,backgroundColor:'#167347',flexDirection:'row',justifyContent:'space-between',alignItems:'center',gap:10,marginTop:12},buttonText:{fontSize:14,fontWeight:'600',color:'#fff',flex:1},empty:{paddingVertical:40,gap:16},error:{color:'#A3372C',padding:14,backgroundColor:'#FFF2EF',marginTop:12,borderRadius:10}});
