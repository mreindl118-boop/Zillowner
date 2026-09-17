import type { CapacitorConfig } from '@capacitor/cli'

// The Android shell renders the live GitHub Pages deployment, so every push
// to main updates the app content without shipping a new APK. The `shell/`
// webDir only holds a tiny offline fallback page.
const config: CapacitorConfig = {
  appId: 'com.mattlabs.costlab',
  appName: 'costLAB',
  webDir: 'shell',
  server: {
    url: 'https://mreindl118-boop.github.io/Zillowner/',
  },
}

export default config
