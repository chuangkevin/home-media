import React, { useState, useEffect, useMemo } from 'react';
import ReactDOM from 'react-dom/client';
import { Provider } from 'react-redux';
import { ThemeProvider, createTheme, CssBaseline } from '@mui/material';
import App from './App';
import { store } from './store';
import apiService from './services/api.service';

function ThemedApp() {
  const [themeMode, setThemeMode] = useState<'light' | 'dark'>('dark');

  // 載入主題設定
  useEffect(() => {
    apiService.getSettings().then(settings => {
      if (settings.theme_mode) {
        setThemeMode(settings.theme_mode);
      }
    }).catch(err => {
      console.error('Failed to load theme settings:', err);
    });

    // 監聽設定變更事件（當 AdminSettings 儲存時觸發）
    const handleThemeChange = (event: CustomEvent) => {
      setThemeMode(event.detail);
    };
    window.addEventListener('themeChanged', handleThemeChange as EventListener);
    return () => window.removeEventListener('themeChanged', handleThemeChange as EventListener);
  }, []);

  const theme = useMemo(
    () => createTheme({
      palette: {
        mode: themeMode,
      },
    }),
    [themeMode]
  );

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <App />
    </ThemeProvider>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Provider store={store}>
      <ThemedApp />
    </Provider>
  </React.StrictMode>
);

// 註冊 Service Worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((registration) => {
        console.log('SW registered:', registration.scope);

        // 檢查更新
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (newWorker) {
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                // 有新版本可用，可以通知用戶刷新
                console.log('New version available!');
              }
            });
          }
        });
      })
      .catch((error) => {
        console.error('SW registration failed:', error);
      });
  });
}
