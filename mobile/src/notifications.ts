import {Platform} from 'react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import {request,type Connection} from './api';
export async function registerDeviceNotifications(connection:Connection){
 if(Platform.OS==='web')return 'Notifications are available in your in-app inbox.';
 const projectId=Constants.expoConfig?.extra?.eas?.projectId??Constants.easConfig?.projectId;
 if(!projectId)throw new Error('Phone push is awaiting Expo project configuration. Your in-app inbox is available now.');
 if(!Device.isDevice)throw new Error('Use a physical phone to register push notifications.');
 if(Platform.OS==='android')await Notifications.setNotificationChannelAsync('classifieds',{name:'Community classifieds',importance:Notifications.AndroidImportance.DEFAULT});
 let permission=await Notifications.getPermissionsAsync();if(permission.status!=='granted')permission=await Notifications.requestPermissionsAsync();
 if(permission.status!=='granted')throw new Error('Phone notification permission was not granted. Your in-app inbox remains available.');
 const token=(await Notifications.getExpoPushTokenAsync({projectId})).data;
 await request(connection,{action:'register-push',token});
 return 'This phone is registered for classified notifications.';
}
