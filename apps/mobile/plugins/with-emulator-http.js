const { withAndroidManifest } = require('expo/config-plugins');

// Android release builds otherwise block the HTTP endpoint of the SSH tunnel.
// Only the explicit emulator build profile opts into cleartext traffic.
module.exports = function withEmulatorHttp(config) {
  if (process.env.ALLOW_EMULATOR_HTTP !== '1') return config;
  return withAndroidManifest(config, (result) => {
    const application = result.modResults.manifest.application?.[0];
    if (!application) throw new Error('Android application manifest is missing');
    application.$ = application.$ || {};
    application.$['android:usesCleartextTraffic'] = 'true';
    return result;
  });
};
