/// <reference types="vite/client" />

import type { DesktopApi } from '../electron/shared'

declare global {
  interface Window {
    desktop: DesktopApi
  }
}

export {}

