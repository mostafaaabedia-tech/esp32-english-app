// Keeps the whole app left-to-right, even when the phone language is Persian, Arabic, etc.
//  1. AndroidManifest: android:supportsRtl="false"  -> Android never mirrors the layout
//  2. MainApplication:  I18nUtil.allowRTL(false)     -> React Native never mirrors it either,
//     set before the first screen is drawn so it already works on the very first launch.
const { withAndroidManifest, withMainApplication } = require('expo/config-plugins');

const MARKER = 'I18nUtil.instance.allowRTL(this, false)';

module.exports = (config) => {
  config = withAndroidManifest(config, (cfg) => {
    const app = cfg.modResults.manifest.application?.[0];
    if (app) app.$['android:supportsRtl'] = 'false';
    return cfg;
  });

  config = withMainApplication(config, (cfg) => {
    let src = cfg.modResults.contents;
    if (cfg.modResults.language !== 'kt') {
      throw new Error('withForceLTR: expected a Kotlin MainApplication');
    }
    if (!src.includes(MARKER)) {
      const hook = /super\.onCreate\(\)\s*\n/;
      if (!hook.test(src)) throw new Error('withForceLTR: could not find super.onCreate() in MainApplication');
      src = src.replace(
        hook,
        (m) =>
          m +
          '    // Force left-to-right layout for every phone language\n' +
          '    com.facebook.react.modules.i18nmanager.I18nUtil.instance.allowRTL(this, false)\n' +
          '    com.facebook.react.modules.i18nmanager.I18nUtil.instance.forceRTL(this, false)\n'
      );
    }
    cfg.modResults.contents = src;
    return cfg;
  });

  return config;
};
