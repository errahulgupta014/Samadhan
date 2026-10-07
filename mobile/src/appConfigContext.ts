import {createContext, useContext} from 'react';
import {defaultAppConfig, type AppConfig} from '../shared/domain';

/** The app configuration in effect: the workspace copy once signed in, the public / cached copy before (App.tsx provides it). */
export const AppConfigContext = createContext<AppConfig>(defaultAppConfig());

export const useAppConfig = () => useContext(AppConfigContext);
