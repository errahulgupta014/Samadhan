import * as ImagePicker from 'expo-image-picker';
import type {Translate} from './labels';

export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

/**
 * Lets the resident take a picture or choose one from the gallery. Resolves null when they cancel; throws an Error with a
 * resident-facing message (in the active language) when access is declined or the photo is too large.
 * `square` asks for a square crop (profile photos).
 */
export async function pickPhoto(camera: boolean, t: Translate, square = false): Promise<{uri: string; mimeType?: string} | null> {
  if (camera) {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) throw new Error(t('Camera access was declined. You can choose a photo from the gallery instead.', 'कैमरे की अनुमति नहीं मिली। आप गैलरी से फोटो चुन सकते हैं।'));
  }
  const options = {
    mediaTypes: ['images'] as ImagePicker.MediaType[],
    quality: 0.7,
    ...(square ? {allowsEditing: true, aspect: [1, 1] as [number, number]} : {}),
  };
  const result = camera ? await ImagePicker.launchCameraAsync({...options, ...(square ? {cameraType: ImagePicker.CameraType.front} : {})}) : await ImagePicker.launchImageLibraryAsync(options);
  if (result.canceled || !result.assets?.length) return null;
  const asset = result.assets[0];
  if ((asset.fileSize ?? 0) > MAX_PHOTO_BYTES) throw new Error(t('Please choose a photo smaller than 5 MB.', 'कृपया 5 MB से छोटी फोटो चुनें।'));
  return {uri: asset.uri, mimeType: asset.mimeType ?? undefined};
}
