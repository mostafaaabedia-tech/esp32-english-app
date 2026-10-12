// Makes sure the color referenced by the generated splash screen always exists.
const { withAndroidColors, AndroidConfig } = require('expo/config-plugins');

module.exports = (config) =>
  withAndroidColors(config, (cfg) => {
    cfg.modResults = AndroidConfig.Colors.setColorItem(
      AndroidConfig.Resources.buildResourceItem({
        name: 'splashscreen_background',
        value: '#FFFFFF',
      }),
      cfg.modResults
    );
    return cfg;
  });
