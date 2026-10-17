// Expo config plugin: release builds are signed with the key in
// ~/.config/noted-android/signing.properties (outside the repo; read by Gradle at build time).
// Without that file the release build falls back to the debug key.
const { withAppBuildGradle } = require('expo/config-plugins');

const RELEASE_CONFIG = `
        release {
            def notedSigning = new Properties()
            def notedSigningFile = new File(System.getProperty("user.home"), ".config/noted-android/signing.properties")
            if (notedSigningFile.exists()) {
                notedSigningFile.withInputStream { notedSigning.load(it) }
                storeFile file(notedSigning['NOTED_RELEASE_STORE_FILE'])
                storePassword notedSigning['NOTED_RELEASE_STORE_PASSWORD']
                keyAlias notedSigning['NOTED_RELEASE_KEY_ALIAS']
                keyPassword notedSigning['NOTED_RELEASE_KEY_PASSWORD']
            }
        }`;

module.exports = (config) => withAppBuildGradle(config, (cfg) => {
  let gradle = cfg.modResults.contents;
  if (!gradle.includes('noted-android/signing.properties')) {
    gradle = gradle.replace(/signingConfigs \{/, `signingConfigs {${RELEASE_CONFIG}`);
    gradle = gradle.replace(
      /(release \{\s*\/\/ Caution![^\n]*\n\s*\/\/ see[^\n]*\n\s*)signingConfig signingConfigs\.debug/,
      '$1signingConfig new File(System.getProperty("user.home"), ".config/noted-android/signing.properties").exists() ? signingConfigs.release : signingConfigs.debug',
    );
  }
  cfg.modResults.contents = gradle;
  return cfg;
});
