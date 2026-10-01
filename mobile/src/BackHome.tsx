import {Pressable,Text,View,StyleSheet} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
export default function BackHome({back,home,hindi=false,disabled=false}:{back:()=>void;home:()=>void;hindi?:boolean;disabled?:boolean}){
 return <View style={s.bar}><Pressable disabled={disabled} accessibilityRole="button" accessibilityLabel={hindi?'वापस जाएं':'Go back'} onPress={back} style={s.back}><Ionicons name="arrow-back" size={22} color="#152B50"/><Text style={s.text}>{hindi?'वापस':'Back'}</Text></Pressable><Pressable disabled={disabled} accessibilityRole="button" accessibilityLabel={hindi?'होम पर जाएं':'Go to home'} onPress={home} style={s.home}><Ionicons name="home-outline" size={22} color="#152B50"/></Pressable></View>;
}
const s=StyleSheet.create({bar:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',marginBottom:12},back:{minHeight:44,flexDirection:'row',alignItems:'center',gap:8,paddingRight:16},home:{width:44,height:44,borderRadius:14,backgroundColor:'#FFF0DD',alignItems:'center',justifyContent:'center'},text:{fontSize:14,fontWeight:'600',color:'#152B50'}});
