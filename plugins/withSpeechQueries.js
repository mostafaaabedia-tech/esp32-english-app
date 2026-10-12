// Android 11+ needs a <queries> entry or speech recognition services are invisible to the app.
const { withAndroidManifest } = require('expo/config-plugins');

module.exports = (config) =>
  withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    manifest.queries = manifest.queries || [];
    const exists = manifest.queries.some((q) =>
      (q.intent || []).some((i) =>
        (i.action || []).some((a) => a.$['android:name'] === 'android.speech.RecognitionService')
      )
    );
    if (!exists) {
      manifest.queries.push({
        intent: [{ action: [{ $: { 'android:name': 'android.speech.RecognitionService' } }] }],
      });
    }
    return cfg;
  });
