# Watchlog Vue RUM

📊 A lightweight, production-ready **Real User Monitoring (RUM)** SDK for Vue 3 apps — powered by [**Watchlog**](https://watchlog.io/products/rum).

Automatically track SPA route changes, session durations, page views, custom events, and JavaScript errors with zero configuration.

---

## ✨ Features

* 📍 **Normalized dynamic routes**: automatically transforms routes like `/users/123` into `/users/:id`.
* 🔁 **SPA route tracking**: emits `page_view` on every Vue Router navigation.
* 🧠 **Event types**: `session_start`, `page_view`, `session_end`, `custom`, and `error`.
* ⚠️ **Error monitoring**: auto-captures `window.onerror` and `unhandledrejection`.
* 🔄 **Minimal API**: setup via one composable or a global Vue plugin.

---

## 🛠 Installation

```bash
npm install @watchlog/rum-vue
```

---

## ⚙️ Usage

### Option 1: Plugin-based setup (recommended)

Use the `createWatchlogRUMPlugin` helper in your `main.js` to initialize tracking globally.

```js
// src/main.js
import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import { createWatchlogRUMPlugin } from '@watchlog/rum-vue'

const app = createApp(App)

app.use(router)
app.use(createWatchlogRUMPlugin({
  router,
  apiKey: 'YOUR_API_KEY',
  endpoint: 'https://your-endpoint.com/rum',
  app: 'your-app-name',
  debug: false,
  flushInterval: 10000, // ms
}))

app.mount('#app')
```

This automatically sends:

1. `session_start` on first load (with normalized path)  
2. `page_view` on every route change  
3. `session_end` on unload  
4. `error` for uncaught JS errors and unhandled promise rejections  

---

### Option 2: Composable setup (per-app control)

If you prefer to initialize RUM manually in your root component:

```js
// App.vue (script setup)
import { useWatchlogRUM } from '@watchlog/rum-vue'

useWatchlogRUM({
  apiKey: 'YOUR_API_KEY',
  endpoint: 'https://your-endpoint.com/rum',
  app: 'your-app-name',
  debug: true,
  flushInterval: 5000,
})
```

---

### Option 3: Manual SDK API (advanced)

```js
import WatchlogRUM from '@watchlog/rum-vue'

// Initialize once at app startup
WatchlogRUM.init({
  apiKey: 'YOUR_API_KEY',
  endpoint: 'https://your-endpoint.com/rum',
  app: 'your-app-name',
  debug: true,
  flushInterval: 10000,
})

// Send custom metric
WatchlogRUM.custom('button_clicked', 1)

// Flush buffered events (e.g. before manual unload)
WatchlogRUM.flush(true)
```

---

## 📦 Exports

| Module                                                   | Description                                          |
| -------------------------------------------------------- | ---------------------------------------------------- |
| `import WatchlogRUM from '@watchlog/rum-vue'`            | Core SDK: `init`, `bufferEvent`, `custom`, `flush`   |
| `import { useWatchlogRUM } from '@watchlog/rum-vue'`     | Vue composable for SPA auto-tracking                 |
| `import { createWatchlogRUMPlugin } from '@watchlog/rum-vue'` | Vue plugin for global initialization                |

---

## 🔗 Learn more

📘 Full product documentation: [https://watchlog.io/products/rum](https://watchlog.io/products/rum)

Made with ❤️ by the **Watchlog** team | [watchlog.io](https://watchlog.io)
