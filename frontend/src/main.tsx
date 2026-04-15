import { useState, useEffect, useMemo } from 'react';
import ReactDOM from 'react-dom/client';
import { Provider } from 'react-redux';
import { ThemeProvider, createTheme, CssBaseline, alpha } from '@mui/material';
import App from './App';
import { store } from './store';
import apiService from './services/api.service';

// ============================================================
// Obsidian Gold — Premium dark music player theme
// Deep navy backgrounds · Warm amber accents · Cinzel/Syne/Outfit typography
// ============================================================
function createPremiumTheme(mode: 'light' | 'dark') {
  const isDark = mode === 'dark';

  const amber = {
    main: '#F5A623',
    light: '#FFC846',
    dark: '#C97D0A',
    contrastText: '#000000',
  };

  return createTheme({
    palette: {
      mode,
      primary: amber,
      secondary: {
        main: isDark ? '#40C4FF' : '#0094CC',
        light: '#82D8FF',
        dark: '#0094CC',
        contrastText: '#000000',
      },
      background: isDark
        ? { default: '#080B12', paper: '#0F1220' }
        : { default: '#F2EDE4', paper: '#FFFFFF' },
      text: isDark
        ? { primary: '#EEF0FF', secondary: '#7B7D9E' }
        : { primary: '#1A1A2E', secondary: '#66688A' },
      divider: isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.08)',
      action: {
        hover: alpha(amber.main, 0.08),
        selected: alpha(amber.main, 0.15),
        focus: alpha(amber.main, 0.12),
      },
      error: { main: '#FF5C5C' },
      success: { main: '#4ADE80' },
    },
    typography: {
      fontFamily: '"Outfit", "Noto Sans TC", "Microsoft JhengHei", -apple-system, sans-serif',
      h1: { fontFamily: '"Cinzel", serif', letterSpacing: '0.06em' },
      h2: { fontFamily: '"Cinzel", serif', letterSpacing: '0.05em' },
      h3: { fontFamily: '"Cinzel", serif', letterSpacing: '0.04em', fontWeight: 700 },
      h4: { fontFamily: '"Syne", sans-serif', fontWeight: 700, letterSpacing: '0.02em' },
      h5: { fontFamily: '"Syne", sans-serif', fontWeight: 600, letterSpacing: '0.01em' },
      h6: { fontFamily: '"Syne", sans-serif', fontWeight: 600, letterSpacing: '0.01em' },
      subtitle1: { fontFamily: '"Outfit", sans-serif', fontWeight: 500, letterSpacing: '0.01em' },
      subtitle2: { fontFamily: '"Outfit", sans-serif', fontWeight: 600, letterSpacing: '0.02em' },
      body1: { fontFamily: '"Outfit", sans-serif', letterSpacing: '0.01em' },
      body2: { fontFamily: '"Outfit", sans-serif', letterSpacing: '0.01em' },
      caption: { fontFamily: '"Outfit", sans-serif', letterSpacing: '0.02em' },
      button: { fontFamily: '"Outfit", sans-serif', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'none' },
    },
    shape: { borderRadius: 12 },
    components: {
      MuiCssBaseline: {
        styleOverrides: `
          :root {
            --app-dvh: 100vh;
          }
          html, body, #root {
            height: 100%;
            min-height: 100%;
            overflow: hidden;
          }
          * { box-sizing: border-box; }
          ::-webkit-scrollbar { width: 6px; height: 6px; }
          ::-webkit-scrollbar-track { background: transparent; }
          ::-webkit-scrollbar-thumb { background: rgba(245,166,35,0.22); border-radius: 3px; }
          ::-webkit-scrollbar-thumb:hover { background: rgba(245,166,35,0.42); }
          @keyframes pulse-glow {
            0%, 100% { box-shadow: 0 0 8px rgba(245,166,35,0.3); }
            50% { box-shadow: 0 0 16px rgba(245,166,35,0.55); }
          }
          @keyframes eq-bar1 {
            0%, 100% { height: 4px; } 50% { height: 13px; }
          }
          @keyframes eq-bar2 {
            0%, 100% { height: 9px; } 33% { height: 4px; } 66% { height: 14px; }
          }
          @keyframes eq-bar3 {
            0%, 100% { height: 6px; } 50% { height: 11px; }
          }
        `,
      },
      MuiPaper: {
        styleOverrides: {
          root: {
            backgroundImage: 'none',
            ...(isDark && {
              backgroundColor: '#0F1220',
              border: '1px solid rgba(255, 255, 255, 0.06)',
            }),
          },
        },
        defaultProps: { elevation: 0 },
      },
      MuiCard: {
        styleOverrides: {
          root: {
            backgroundImage: 'none',
            ...(isDark && {
              backgroundColor: '#121526',
              border: '1px solid rgba(255, 255, 255, 0.06)',
            }),
            borderRadius: 16,
            overflow: 'hidden',
            transition: 'transform 0.25s cubic-bezier(0.4,0,0.2,1), box-shadow 0.25s cubic-bezier(0.4,0,0.2,1)',
          },
        },
      },
      MuiSlider: {
        styleOverrides: {
          root: {
            color: amber.main,
            height: 3,
            padding: '12px 0',
            '& .MuiSlider-thumb': {
              width: 12,
              height: 12,
              boxShadow: 'none',
              transition: 'all 0.15s cubic-bezier(.47,1.64,.41,.8)',
              '&::before': { display: 'none' },
              '&:hover, &.Mui-focusVisible': {
                boxShadow: '0 0 0 8px rgba(245,166,35,0.18)',
                width: 14,
                height: 14,
              },
              '&.Mui-active': { width: 16, height: 16 },
            },
            '& .MuiSlider-rail': {
              opacity: 0.14,
              backgroundColor: isDark ? '#EEF0FF' : '#1A1A2E',
            },
            '& .MuiSlider-track': {
              background: 'linear-gradient(90deg, #C97D0A 0%, #F5A623 55%, #FFC846 100%)',
              border: 'none',
              borderRadius: 2,
            },
          },
        },
      },
      MuiBottomNavigation: {
        styleOverrides: {
          root: {
            backgroundColor: 'transparent',
            height: 60,
          },
        },
      },
      MuiBottomNavigationAction: {
        styleOverrides: {
          root: {
            minWidth: 56,
            color: isDark ? '#4A4C6A' : '#999',
            paddingTop: '10px',
            '&.Mui-selected': { color: amber.main },
            '& .MuiSvgIcon-root': {
              transition: 'transform 0.2s ease, filter 0.2s ease',
            },
            '&.Mui-selected .MuiSvgIcon-root': {
              transform: 'scale(1.15)',
              filter: 'drop-shadow(0 0 5px rgba(245,166,35,0.65))',
            },
            '& .MuiBottomNavigationAction-label': {
              fontFamily: '"Outfit", sans-serif',
              fontSize: '0.68rem',
              fontWeight: 500,
              letterSpacing: '0.02em',
              '&.Mui-selected': { fontSize: '0.68rem', fontWeight: 600 },
            },
          },
        },
      },
      MuiIconButton: {
        styleOverrides: {
          root: {
            borderRadius: 8,
            transition: 'all 0.18s ease',
            '&:hover': { backgroundColor: alpha(amber.main, 0.09) },
          },
        },
      },
      MuiTextField: {
        styleOverrides: {
          root: {
            '& .MuiOutlinedInput-root': {
              borderRadius: 28,
              fontFamily: '"Outfit", sans-serif',
              fontSize: '1rem', // 確保不小於 16px 防止 iOS 自動縮放
              ...(isDark && {
                backgroundColor: 'rgba(255, 255, 255, 0.04)',
                '&:hover': { backgroundColor: 'rgba(255, 255, 255, 0.06)' },
              }),
              '& fieldset': {
                borderColor: isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.14)',
                transition: 'border-color 0.2s ease',
              },
              '&:hover fieldset': { borderColor: alpha(amber.main, 0.5) },
              '&.Mui-focused fieldset': { borderColor: amber.main, borderWidth: 1 },
            },
            '& .MuiInputAdornment-root .MuiSvgIcon-root': {
              color: isDark ? '#7B7D9E' : '#999',
              transition: 'color 0.2s ease',
            },
            '& .MuiOutlinedInput-root.Mui-focused .MuiInputAdornment-root .MuiSvgIcon-root': {
              color: amber.main,
            },
          },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: {
            borderRadius: 6,
            fontFamily: '"Outfit", sans-serif',
            fontWeight: 500,
            fontSize: '0.7rem',
            letterSpacing: '0.02em',
          },
        },
      },
      MuiListItemButton: {
        styleOverrides: {
          root: {
            borderRadius: 8,
            margin: '1px 4px',
            '&:hover': { backgroundColor: alpha(amber.main, 0.08) },
            '&.Mui-selected': {
              backgroundColor: alpha(amber.main, 0.14),
              '&:hover': { backgroundColor: alpha(amber.main, 0.2) },
            },
          },
        },
      },
      MuiButton: {
        styleOverrides: {
          root: {
            borderRadius: 24,
            fontFamily: '"Outfit", sans-serif',
            fontWeight: 600,
            letterSpacing: '0.04em',
          },
          outlined: {
            borderColor: isDark ? 'rgba(255,255,255,0.15)' : undefined,
            '&:hover': {
              borderColor: amber.main,
              backgroundColor: alpha(amber.main, 0.06),
            },
          },
        },
      },
      MuiDivider: {
        styleOverrides: {
          root: {
            borderColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)',
          },
        },
      },
      MuiAvatar: {
        styleOverrides: {
          root: {
            border: isDark ? '2px solid rgba(255,255,255,0.08)' : undefined,
          },
        },
      },
      MuiAlert: {
        styleOverrides: {
          root: {
            borderRadius: 12,
            fontFamily: '"Outfit", sans-serif',
          },
        },
      },
    },
  });
}

function ThemedApp() {
  const [themeMode, setThemeMode] = useState<'light' | 'dark'>('dark');

  useEffect(() => {
    apiService.getSettings().then(settings => {
      if (settings.theme_mode) {
        setThemeMode(settings.theme_mode);
      }
    }).catch(err => {
      console.error('Failed to load theme settings:', err);
    });

    const handleThemeChange = (event: CustomEvent) => {
      setThemeMode(event.detail);
    };
    window.addEventListener('themeChanged', handleThemeChange as EventListener);
    return () => window.removeEventListener('themeChanged', handleThemeChange as EventListener);
  }, []);

  const theme = useMemo(() => createPremiumTheme(themeMode), [themeMode]);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <App />
    </ThemeProvider>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <Provider store={store}>
    <ThemedApp />
  </Provider>
);

// 註冊 Service Worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((registration) => {
        console.log('SW registered:', registration.scope);

        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (newWorker) {
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
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
