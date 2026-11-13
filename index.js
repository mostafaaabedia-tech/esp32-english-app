import { I18nManager } from 'react-native';
import { registerRootComponent } from 'expo';
import App from './App';

// Keep the app left-to-right on every phone language (also enforced natively by plugins/withForceLTR.js)
I18nManager.allowRTL(false);
I18nManager.forceRTL(false);

registerRootComponent(App);
