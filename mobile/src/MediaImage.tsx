import React, {useEffect, useState} from 'react';
import {Image, Platform, View, type ImageProps, type ImageSourcePropType, type StyleProp, type ViewStyle} from 'react-native';

type RemoteSource = {uri: string; headers: Record<string, string>};

// Web only: authorised requests -> blob: URL, so each private picture is downloaded once per session.
const blobs = new Map<string, string>();

/** Drops every downloaded private picture (called when the session ends, so nothing outlives it). */
export function clearMediaCache() {
  for (const url of blobs.values()) URL.revokeObjectURL(url);
  blobs.clear();
}

const isRemote = (source: ImageSourcePropType | undefined): source is RemoteSource =>
  !!source && typeof source === 'object' && !Array.isArray(source) && 'uri' in source && !!source.headers && Object.keys(source.headers).length > 0;

/**
 * Image for private media (resident photo, complaint evidence, ad pictures). Native passes the Authorization header straight to
 * the image loader. react-native-web ignores `source.headers`, and a browser <img> cannot send a bearer token, so on web the
 * picture is fetched with the header and shown from a blob: URL. Public pictures (no headers) use a plain Image everywhere.
 */
export function MediaImage({source, onError, ...rest}: ImageProps) {
  const remote = Platform.OS === 'web' && isRemote(source) ? source : null;
  const key = remote ? `${remote.uri}|${remote.headers.Authorization ?? ''}` : '';
  const [fetched, setFetched] = useState<{key: string; uri: string} | null>(null);
  const cached = key ? blobs.get(key) : undefined;

  useEffect(() => {
    if (!remote || blobs.has(key)) return;
    let alive = true;
    fetch(remote.uri, {headers: remote.headers})
      .then(response => {
        if (!response.ok) throw new Error(`Image request failed (${response.status}).`);
        return response.blob();
      })
      .then(blob => {
        const url = URL.createObjectURL(blob);
        blobs.set(key, url);
        if (alive) setFetched({key, uri: url});
      })
      .catch(error => {
        if (alive) onError?.({nativeEvent: {error: String(error)}} as Parameters<NonNullable<ImageProps['onError']>>[0]);
      });
    return () => {
      alive = false;
    };
    // The request depends on the address and token only (`key`); onError identity changes must not refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (!remote) return <Image {...rest} source={source} onError={onError} />;
  const uri = cached ?? (fetched?.key === key ? fetched.uri : undefined);
  return uri ? <Image {...rest} source={{uri}} onError={onError} /> : <View style={rest.style as StyleProp<ViewStyle>} />;
}
