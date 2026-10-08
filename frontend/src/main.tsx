import { useState, useEffect, useMemo } from 'react'
import ReactDOM from 'react-dom/client'
import { Provider } from 'react-redux'
import { ThemeProvider, createTheme, CssBaseline, alpha } from '@mui/material'
import App from './App'
import { store } from './store'
import apiService from './services/api.service'

// A quiet listening room: warm amber, readable surfaces, and familiar controls.
const bodyFont =
  '"Outfit", -apple-system, BlinkMacSystemFont, "PingFang TC", "Microsoft JhengHei", sans-serif'

function createPremiumTheme(mode: 'light' | 'dark') {
  const isDark = mode === 'dark'
  const primary = isDark
    ? { main: '#E9B45A', light: '#F2CF92', dark: '#C38A35', contrastText: '#19130A' }
    : { main: '#87520E', light: '#A66914', dark: '#653904', contrastText: '#FFFCF7' }
  const foreground = isDark ? '#F5F1E9' : '#252A32'
  const secondaryText = isDark ? '#AFB8C5' : '#5A6370'
  const divider = isDark ? '#35404B' : '#D8D3C9'

  return createTheme({
    spacing: 8,
    palette: {
      mode,
      primary,
      secondary: {
        main: isDark ? '#82C5BA' : '#226B60',
        contrastText: isDark ? '#0D1117' : '#FFFCF7',
      },
      background: isDark
        ? { default: '#0D1117', paper: '#151B23' }
        : { default: '#F5F1E9', paper: '#FFFCF7' },
      text: { primary: foreground, secondary: secondaryText },
      divider,
      action: {
        active: secondaryText,
        hover: alpha(primary.main, 0.08),
        selected: alpha(primary.main, isDark ? 0.14 : 0.1),
        focus: alpha(primary.main, 0.16),
      },
      error: { main: isDark ? '#FF938F' : '#AA3430' },
      success: { main: isDark ? '#91D1A6' : '#27663D' },
      warning: { main: isDark ? '#EDBC69' : '#83510B' },
      info: { main: isDark ? '#9DBFF0' : '#315F98' },
    },
    typography: {
      fontFamily: bodyFont,
      h1: {
        fontFamily: '"Cinzel", "PingFang TC", serif',
        fontWeight: 600,
        letterSpacing: '0.02em',
        lineHeight: 1.2,
      },
      h2: { fontSize: '2rem', fontWeight: 600, letterSpacing: '-0.02em', lineHeight: 1.25 },
      h3: { fontSize: '1.75rem', fontWeight: 600, letterSpacing: '-0.02em', lineHeight: 1.3 },
      h4: { fontSize: '1.5rem', fontWeight: 600, letterSpacing: '-0.01em', lineHeight: 1.35 },
      h5: { fontSize: '1.25rem', fontWeight: 600, letterSpacing: '-0.01em', lineHeight: 1.4 },
      h6: { fontSize: '1.125rem', fontWeight: 600, lineHeight: 1.45 },
      subtitle1: { fontSize: '1rem', fontWeight: 500, lineHeight: 1.6 },
      subtitle2: { fontSize: '0.875rem', fontWeight: 600, lineHeight: 1.5 },
      body1: { fontSize: '1rem', lineHeight: 1.65 },
      body2: { fontSize: '0.875rem', lineHeight: 1.6 },
      caption: { fontSize: '0.75rem', lineHeight: 1.5 },
      overline: { fontSize: '0.75rem', fontWeight: 600, lineHeight: 1.5, letterSpacing: '0.06em' },
      button: { fontSize: '0.875rem', fontWeight: 600, lineHeight: 1.5, textTransform: 'none' },
    },
    shape: { borderRadius: 8 },
    components: {
      MuiCssBaseline: {
        styleOverrides: `
          :root { --app-dvh: 100vh; color-scheme: ${mode}; }
          html, body, #root { height: 100%; min-height: 100%; overflow: hidden; }
          * { box-sizing: border-box; }
          :focus-visible, .Mui-focusVisible { outline: 2px solid ${primary.main}; outline-offset: 3px; }
          ::selection { background: ${alpha(primary.main, 0.28)}; }
          input::placeholder, textarea::placeholder { color: ${secondaryText}; opacity: 1; }
          ::-webkit-scrollbar { width: 6px; height: 6px; }
          ::-webkit-scrollbar-track { background: transparent; }
          ::-webkit-scrollbar-thumb { background: ${alpha(secondaryText, 0.45)}; border-radius: 3px; }
          ::-webkit-scrollbar-thumb:hover { background: ${secondaryText}; }
          @keyframes pulse-glow {
            0%, 100% { box-shadow: 0 0 0 1px ${alpha(primary.main, 0.16)}; }
            50% { box-shadow: 0 0 0 1px ${alpha(primary.main, 0.3)}; }
          }
          @keyframes eq-bar1 { 0%, 100% { height: 4px; } 50% { height: 13px; } }
          @keyframes eq-bar2 { 0%, 100% { height: 9px; } 33% { height: 4px; } 66% { height: 14px; } }
          @keyframes eq-bar3 { 0%, 100% { height: 6px; } 50% { height: 11px; } }
          @media (prefers-reduced-motion: reduce) {
            *, *::before, *::after {
              animation-duration: 0.01ms !important;
              animation-iteration-count: 1 !important;
              transition-duration: 0.01ms !important;
              scroll-behavior: auto !important;
            }
          }
        `,
      },
      MuiPaper: {
        defaultProps: { elevation: 0 },
        styleOverrides: { root: { backgroundImage: 'none' } },
      },
      MuiButtonBase: {
        styleOverrides: {
          root: {
            '&.Mui-focusVisible, &:focus-visible': {
              outline: `2px solid ${primary.main}`,
              outlineOffset: 3,
            },
          },
        },
      },
      MuiCard: {
        styleOverrides: {
          root: {
            backgroundImage: 'none',
            backgroundColor: isDark ? '#19212B' : '#FFFCF7',
            border: `1px solid ${divider}`,
            borderRadius: 12,
            boxShadow: 'none',
            overflow: 'hidden',
            transition: 'border-color 160ms ease, background-color 160ms ease',
          },
        },
      },
      MuiCardActionArea: {
        styleOverrides: { root: { '&.Mui-focusVisible': { outlineOffset: -3 } } },
      },
      MuiSlider: {
        styleOverrides: {
          root: { height: 4, padding: '20px 0', color: primary.main },
          thumb: {
            width: 16,
            height: 16,
            boxShadow: 'none',
            '&::before': { display: 'none' },
            '&:hover, &.Mui-focusVisible': { boxShadow: `0 0 0 6px ${alpha(primary.main, 0.16)}` },
          },
          rail: { opacity: 1, backgroundColor: isDark ? '#657181' : '#93999F' },
          track: { border: 'none' },
        },
      },
      MuiBottomNavigation: {
        styleOverrides: { root: { backgroundColor: 'transparent', height: 64 } },
      },
      MuiBottomNavigationAction: {
        styleOverrides: {
          root: {
            minWidth: 64,
            minHeight: 56,
            padding: '8px 12px',
            color: secondaryText,
            '&.Mui-selected': { color: primary.main },
            '& .MuiSvgIcon-root': { fontSize: 24 },
          },
          label: {
            fontFamily: bodyFont,
            fontSize: '0.75rem',
            fontWeight: 500,
            lineHeight: 1.5,
            marginTop: 4,
            '&.Mui-selected': { fontSize: '0.75rem', fontWeight: 600 },
          },
        },
      },
      MuiIconButton: {
        styleOverrides: {
          root: {
            minWidth: 44,
            minHeight: 44,
            borderRadius: 8,
            transition: 'color 160ms ease, background-color 160ms ease',
            '&:hover': { backgroundColor: alpha(primary.main, 0.1) },
          },
        },
      },
      MuiTextField: {
        styleOverrides: {
          root: {
            '& .MuiOutlinedInput-root': {
              borderRadius: 8,
              fontFamily: bodyFont,
              fontSize: '1rem',
              minHeight: 48,
              backgroundColor: isDark ? '#10161E' : '#FFFCF7',
              '& fieldset': { borderColor: isDark ? '#697585' : '#808A97' },
              '&:hover fieldset': { borderColor: secondaryText },
              '&.Mui-focused fieldset': { borderColor: primary.main, borderWidth: 2 },
            },
            '& .MuiInputAdornment-root .MuiSvgIcon-root': { color: secondaryText },
          },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: { borderRadius: 6, fontFamily: bodyFont, fontWeight: 500, fontSize: '0.75rem' },
        },
      },
      MuiListItemButton: {
        styleOverrides: {
          root: {
            minHeight: 44,
            borderRadius: 8,
            margin: '2px 4px',
            '&:hover': { backgroundColor: alpha(primary.main, 0.08) },
            '&.Mui-selected': {
              backgroundColor: alpha(primary.main, 0.14),
              '&:hover': { backgroundColor: alpha(primary.main, 0.2) },
            },
          },
        },
      },
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: {
            minHeight: 44,
            borderRadius: 8,
            padding: '10px 16px',
            fontFamily: bodyFont,
            whiteSpace: 'nowrap',
          },
          outlined: {
            borderColor: isDark ? '#697585' : '#808A97',
            '&:hover': { borderColor: primary.main, backgroundColor: alpha(primary.main, 0.06) },
          },
        },
      },
      MuiToggleButton: {
        styleOverrides: {
          root: {
            minHeight: 44,
            padding: '8px 12px',
            fontSize: '0.875rem',
            color: secondaryText,
            whiteSpace: 'nowrap',
            wordBreak: 'keep-all',
            '&.Mui-selected': { color: primary.main, backgroundColor: alpha(primary.main, 0.12) },
          },
        },
      },
      MuiTab: {
        styleOverrides: {
          root: {
            minHeight: 44,
            fontSize: '0.875rem',
            whiteSpace: 'nowrap',
            textTransform: 'none',
          },
        },
      },
      MuiDialog: {
        styleOverrides: {
          paper: {
            borderRadius: 16,
            margin: 24,
            width: 'calc(100% - 48px)',
            overflowX: 'hidden',
            maxHeight: 'calc(var(--app-dvh, 100dvh) - 48px)',
            '@media (max-width: 599px)': {
              margin: 12,
              width: 'calc(100% - 24px)',
              maxHeight: 'calc(var(--app-dvh, 100dvh) - 24px)',
            },
          },
          paperFullScreen: {
            margin: 0,
            borderRadius: 0,
            width: '100%',
            maxHeight: '100%',
            '@media (max-width: 599px)': { margin: 0, width: '100%', maxHeight: '100%' },
          },
        },
      },
      MuiDialogTitle: {
        styleOverrides: {
          root: {
            padding: '24px 24px 16px',
            fontSize: '1.125rem',
            lineHeight: 1.5,
            '@media (max-width: 599px)': { padding: '16px 16px 12px' },
          },
        },
      },
      MuiDialogContent: {
        styleOverrides: {
          root: {
            padding: '8px 24px 24px',
            overflowWrap: 'anywhere',
            '@media (max-width: 599px)': { padding: '8px 16px 16px' },
          },
        },
      },
      MuiDialogActions: {
        styleOverrides: {
          root: {
            padding: '16px 24px',
            flexWrap: 'wrap',
            gap: 8,
            '& > :not(style) ~ :not(style)': { marginLeft: 0 },
            '@media (max-width: 599px)': { padding: 16, '& .MuiButton-root': { flexGrow: 1 } },
          },
        },
      },
      MuiAlert: {
        defaultProps: { closeText: '關閉提示' },
        styleOverrides: { root: { borderRadius: 8, fontFamily: bodyFont, alignItems: 'center' } },
      },
      MuiTooltip: { styleOverrides: { tooltip: { fontSize: '0.75rem', lineHeight: 1.5 } } },
    },
  })
}

function ThemedApp() {
  const [themeMode, setThemeMode] = useState<'light' | 'dark'>('dark')

  useEffect(() => {
    apiService
      .getSettings()
      .then((settings) => {
        if (settings.theme_mode) {
          setThemeMode(settings.theme_mode)
        }
      })
      .catch((err) => {
        console.error('Failed to load theme settings:', err)
      })

    const handleThemeChange = (event: CustomEvent) => {
      setThemeMode(event.detail)
    }
    window.addEventListener('themeChanged', handleThemeChange as EventListener)
    return () => window.removeEventListener('themeChanged', handleThemeChange as EventListener)
  }, [])

  const theme = useMemo(() => createPremiumTheme(themeMode), [themeMode])

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <App />
    </ThemeProvider>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <Provider store={store}>
    <ThemedApp />
  </Provider>
)

// 註冊 Service Worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((registration) => {
        console.log('SW registered:', registration.scope)

        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing
          if (newWorker) {
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                console.log('New version available!')
              }
            })
          }
        })
      })
      .catch((error) => {
        console.error('SW registration failed:', error)
      })
  })
}
