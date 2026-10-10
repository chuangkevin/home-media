import {
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  useCallback,
  lazy,
  Suspense,
  Component,
} from 'react'
import type { ReactNode } from 'react'
import { useDispatch, useSelector, shallowEqual } from 'react-redux'
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Link,
  useNavigate,
  useLocation,
  useSearchParams,
} from 'react-router-dom'
import {
  Box,
  Container,
  Typography,
  Alert,
  Button,
  BottomNavigation,
  BottomNavigationAction,
  Paper,
  Skeleton,
  Snackbar,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  useMediaQuery,
} from '@mui/material'
import HomeIcon from '@mui/icons-material/Home'
import QueueMusicIcon from '@mui/icons-material/QueueMusic'
import SettingsIcon from '@mui/icons-material/Settings'
import SearchBar from './components/Search/SearchBar'
import SearchResults from './components/Search/SearchResults'
import AudioPlayer from './components/Player/AudioPlayer'
import HomeRecommendations from './components/Home/HomeRecommendations'
import PlaylistSection from './components/Playlist/PlaylistSection'
import RadioButton from './components/Radio/RadioButton'
import RadioIndicator from './components/Radio/RadioIndicator'
import { addToQueue, playNow, clearPlaybackSession } from './store/playerSlice'
import { fetchBlocked } from './store/blockSlice'
import { fetchFavorites } from './store/favoritesSlice'
import { RootState, AppDispatch } from './store'
import apiService from './services/api.service'
import audioCacheService from './services/audio-cache.service'
import playbackStateService from './services/playback-state.service'
import type { Track } from './types/track.types'
import { useSocketConnection } from './hooks/useSocketConnection'
import { useRadioSync } from './hooks/useRadioSync'
import { version } from '../package.json'
import { getAppViewportHeight } from './utils/appViewport'
import { getResponsiveLayout, type AppLayout } from './utils/responsiveLayout'
import './responsiveLayout.css'

const VideoPlayer = lazy(() => import('./components/Player/VideoPlayer'))
const FullscreenLyrics = lazy(() => import('./components/Player/FullscreenLyrics'))
const AdminSettings = lazy(() => import('./components/Admin/AdminSettings'))

class LazyContentBoundary extends Component<
  { children: ReactNode; label: string; open?: boolean; onClose?: () => void },
  { failed: boolean }
> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (!this.state.failed) return this.props.children

    // React.lazy retains rejected imports. A full reload is the explicit recovery path.
    const reload = () => window.location.reload()
    const recoveryMessage = '您仍可使用播放控制與導覽。重新載入頁面會停止目前播放。'

    if (this.props.onClose) {
      return (
        <Dialog
          open={this.props.open ?? true}
          onClose={this.props.onClose}
          aria-labelledby="lazy-content-error-title"
          fullWidth
          maxWidth="sm"
        >
          <DialogTitle id="lazy-content-error-title">無法開啟{this.props.label}</DialogTitle>
          <DialogContent>
            <Alert severity="error">內容暫時無法載入，請稍後重新載入頁面。</Alert>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
              {recoveryMessage}
            </Typography>
          </DialogContent>
          <DialogActions>
            <Button onClick={this.props.onClose} autoFocus>
              先關閉
            </Button>
            <Button onClick={reload} variant="outlined">
              重新載入頁面
            </Button>
          </DialogActions>
        </Dialog>
      )
    }

    return (
      <Alert severity="error" sx={{ mb: 2 }}>
        <Typography component="p" variant="subtitle2">
          {this.props.label}暫時無法載入。
        </Typography>
        <Typography variant="body2" sx={{ mt: 1 }}>
          {recoveryMessage}
        </Typography>
        <Button color="inherit" variant="outlined" onClick={reload} sx={{ mt: 2 }}>
          重新載入頁面
        </Button>
      </Alert>
    )
  }
}

const navigationItems = [
  { path: '/', label: '首頁', icon: <HomeIcon /> },
  { path: '/playlists', label: '播放清單', icon: <QueueMusicIcon /> },
  { path: '/admin', label: '設定', icon: <SettingsIcon /> },
]

function BottomNav({
  desktop = false,
  scrollToTop,
}: {
  desktop?: boolean
  scrollToTop: () => void
}) {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const activePath = navigationItems.some((item) => item.path === location.pathname)
    ? location.pathname
    : '/'

  const handleClick = (path: string) => {
    if (location.pathname === path) {
      scrollToTop()
      return
    }
    const params = new URLSearchParams()
    const playing = searchParams.get('playing')
    if (playing) params.set('playing', playing)
    navigate({ pathname: path, search: params.toString() })
  }

  if (desktop) {
    return (
      <Box
        component="nav"
        aria-label="主要導覽"
        sx={{ display: 'flex', alignItems: 'center', gap: 1 }}
      >
        {navigationItems.map((item) => (
          <Button
            key={item.path}
            onClick={() => handleClick(item.path)}
            startIcon={item.icon}
            aria-current={activePath === item.path ? 'page' : undefined}
            sx={{
              color: activePath === item.path ? 'primary.main' : 'text.secondary',
              bgcolor: activePath === item.path ? 'action.selected' : 'transparent',
            }}
          >
            {item.label}
          </Button>
        ))}
      </Box>
    )
  }

  return (
    <Paper
      component="nav"
      aria-label="主要導覽"
      square
      className="mobile-navigation"
      sx={{
        flexShrink: 0,
        borderTop: 1,
        borderColor: 'divider',
        pb: 'env(safe-area-inset-bottom, 0px)',
      }}
    >
      <BottomNavigation value={activePath} showLabels sx={{ height: 64 }}>
        {navigationItems.map((item) => (
          <BottomNavigationAction
            key={item.path}
            label={item.label}
            value={item.path}
            icon={item.icon}
            aria-current={activePath === item.path ? 'page' : undefined}
            onClick={() => handleClick(item.path)}
          />
        ))}
      </BottomNavigation>
    </Paper>
  )
}

function ContentSkeleton({ label = '正在載入內容' }: { label?: string }) {
  return (
    <Box role="status" aria-label={label} aria-busy="true" sx={{ py: 1 }}>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {label}…
      </Typography>
      <Box
        aria-hidden="true"
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
          gap: 2,
        }}
      >
        {[0, 1, 2, 3].map((item) => (
          <Box key={item} sx={{ display: 'flex', gap: 2, alignItems: 'center', minWidth: 0 }}>
            <Skeleton variant="rounded" width={64} height={64} sx={{ flexShrink: 0 }} />
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Skeleton width="80%" height={24} />
              <Skeleton width="55%" height={20} />
            </Box>
          </Box>
        ))}
      </Box>
    </Box>
  )
}

type SearchState = {
  query: string
  status: 'idle' | 'loading' | 'ready' | 'error' | 'cancelled'
  results: Track[]
}

function AppContent() {
  const dispatch = useDispatch<AppDispatch>()
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const isDesktop = useMediaQuery('(min-width: 1024px)')
  const [responsiveLayout, setResponsiveLayout] = useState<AppLayout>(() =>
    getResponsiveLayout(window.innerWidth, window.innerHeight)
  )
  // Short landscape has room for a horizontal header navigation, but not
  // a second fixed navigation row competing with the content for height.
  const headerNavigation = isDesktop || responsiveLayout === 'compact-landscape'
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  const { currentTrack, displayMode, playlist } = useSelector(
    (state: RootState) => ({
      currentTrack: state.player.currentTrack,
      displayMode: state.player.displayMode,
      playlist: state.player.playlist,
    }),
    shallowEqual
  )
  const isHome = location.pathname === '/'
  const isSearchPage = location.pathname === '/search'
  const routeQuery = isSearchPage ? (searchParams.get('q') || '').trim() : ''
  const [searchState, setSearchState] = useState<SearchState>({
    query: '',
    status: 'idle',
    results: [],
  })
  const [searchRevision, setSearchRevision] = useState(0)
  const searchRequestRef = useRef(0)
  const searchAbortRef = useRef<AbortController | null>(null)
  const [lyricsDrawerOpen, setLyricsDrawerOpen] = useState(false)
  const [hasOpenedLyrics, setHasOpenedLyrics] = useState(false)
  const [siteTitle, setSiteTitle] = useState('Home Media')
  const [queueNotice, setQueueNotice] = useState<{
    message: string
    severity: 'success' | 'info'
  } | null>(null)
  const scrollContainerRef = useRef<HTMLElement>(null)
  const scrollToTop = useCallback(() => {
    scrollContainerRef.current?.scrollTo({ top: 0, behavior: reducedMotion ? 'auto' : 'smooth' })
  }, [reducedMotion])
  const loading =
    isSearchPage &&
    Boolean(routeQuery) &&
    (searchState.query !== routeQuery || searchState.status === 'loading')

  useSocketConnection()
  useRadioSync()

  useEffect(() => {
    setLyricsDrawerOpen(false)
    scrollContainerRef.current?.scrollTo({ top: 0, behavior: 'auto' })
  }, [location.pathname, routeQuery])

  // Refresh starts a new playback session, while keeping the search URL usable.
  useEffect(() => {
    dispatch(clearPlaybackSession())
    playbackStateService.clear()
    if (searchParams.has('playing')) {
      const params = new URLSearchParams(searchParams)
      params.delete('playing')
      setSearchParams(params, { replace: true })
    }
  }, [])

  // Track changes update the shareable location without opening the lyrics view.
  useEffect(() => {
    if (!currentTrack) return
    const params = new URLSearchParams(location.search)
    if (params.get('playing') === currentTrack.videoId) return
    params.set('playing', currentTrack.videoId)
    setSearchParams(params, { replace: true })
  }, [currentTrack?.videoId, location.search, setSearchParams])

  // This effect is the single search request owner. Playing-state URL updates do not rerun it.
  useEffect(() => {
    const requestId = ++searchRequestRef.current
    searchAbortRef.current?.abort()
    if (!isSearchPage || !routeQuery) {
      searchAbortRef.current = null
      setSearchState({ query: routeQuery, status: 'idle', results: [] })
      return
    }
    const controller = new AbortController()
    searchAbortRef.current = controller
    setSearchState({ query: routeQuery, status: 'loading', results: [] })
    apiService
      .searchTracks(routeQuery, 24, controller.signal)
      .then((results) => {
        if (controller.signal.aborted || searchRequestRef.current !== requestId) return
        setSearchState({ query: routeQuery, status: 'ready', results })
        apiService.recordSearch(routeQuery, results.length)
      })
      .catch(() => {
        if (controller.signal.aborted || searchRequestRef.current !== requestId) return
        setSearchState({ query: routeQuery, status: 'error', results: [] })
      })
      .finally(() => {
        if (searchAbortRef.current === controller) searchAbortRef.current = null
      })
    return () => controller.abort()
  }, [isSearchPage, routeQuery, searchRevision])

  useEffect(() => {
    audioCacheService
      .init()
      .then(() => {
        audioCacheService.getStats().then((stats) => {
          console.log(
            `Audio Cache: ${stats.count}/${stats.maxCount} files, ${stats.totalSizeMB}/${stats.maxSizeMB}MB`
          )
        })
      })
      .catch((err) => console.error('Failed to initialize audio cache:', err))
  }, [])

  useEffect(() => {
    apiService
      .getSettings()
      .then((settings) => {
        if (settings.site_title) {
          setSiteTitle(settings.site_title)
          document.title = settings.site_title
        }
      })
      .catch((err) => console.error('Failed to load settings:', err))
    dispatch(fetchBlocked())
    dispatch(fetchFavorites())
  }, [dispatch])

  // iPhone Safari/PWA 鎖屏回前景後，100dvh/100% 有時不會立刻重算。
  // 改用 visualViewport 驅動 CSS 變數，避免內容頂到靈動島或高度錯亂。
  useLayoutEffect(() => {
    const pendingTimers = new Set<number>()

    const applyViewportHeight = () => {
      const activeElement = document.activeElement as HTMLElement | null
      const isEditableFocused =
        Boolean(activeElement) &&
        (activeElement?.tagName === 'INPUT' ||
          activeElement?.tagName === 'TEXTAREA' ||
          activeElement?.isContentEditable)
      // 鍵盤彈出時 visualViewport.height 會大幅縮小，此時不更新高度
      // 避免整個佈局被壓縮、播放器跑位
      const stableHeight = getAppViewportHeight({
        innerHeight: window.innerHeight,
        clientHeight: document.documentElement.clientHeight,
        visualHeight: window.visualViewport?.height,
        visualScale: window.visualViewport?.scale,
        editableFocused: Boolean(isEditableFocused),
      })
      if (stableHeight === null) return
      document.documentElement.style.setProperty('--app-dvh', `${stableHeight}px`)
      setResponsiveLayout(
        getResponsiveLayout(document.documentElement.clientWidth || window.innerWidth, stableHeight)
      )
    }

    const clearPendingTimers = () => {
      pendingTimers.forEach((timerId) => window.clearTimeout(timerId))
      pendingTimers.clear()
    }

    const scheduleViewportSync = () => {
      clearPendingTimers()
      const delays = [0, 60, 120, 240, 500, 900, 1400, 2000, 2800]
      delays.forEach((delay) => {
        const timerId = window.setTimeout(() => {
          pendingTimers.delete(timerId)
          requestAnimationFrame(applyViewportHeight)
        }, delay)
        pendingTimers.add(timerId)
      })
    }

    const handleVisibilitySync = () => {
      if (document.visibilityState === 'visible') {
        scheduleViewportSync()
      }
    }

    scheduleViewportSync()
    window.addEventListener('resize', scheduleViewportSync)
    window.visualViewport?.addEventListener('resize', scheduleViewportSync)
    window.addEventListener('orientationchange', scheduleViewportSync)
    window.addEventListener('pageshow', scheduleViewportSync)
    window.addEventListener('load', scheduleViewportSync)
    window.addEventListener('focus', scheduleViewportSync)
    document.addEventListener('visibilitychange', handleVisibilitySync)

    return () => {
      clearPendingTimers()
      window.removeEventListener('resize', scheduleViewportSync)
      window.visualViewport?.removeEventListener('resize', scheduleViewportSync)
      window.removeEventListener('orientationchange', scheduleViewportSync)
      window.removeEventListener('pageshow', scheduleViewportSync)
      window.removeEventListener('load', scheduleViewportSync)
      window.removeEventListener('focus', scheduleViewportSync)
      document.removeEventListener('visibilitychange', handleVisibilitySync)
    }
  }, [])

  const handleSearch = (value: string) => {
    const query = value.trim()
    if (!query) return
    searchAbortRef.current?.abort()
    setLyricsDrawerOpen(false)
    if (isSearchPage && query === routeQuery) {
      setSearchRevision((revision) => revision + 1)
      scrollToTop()
      return
    }
    const params = new URLSearchParams()
    params.set('q', query)
    const playing = searchParams.get('playing')
    if (playing) params.set('playing', playing)
    navigate({ pathname: '/search', search: params.toString() })
  }

  const handleCancelSearch = () => {
    searchRequestRef.current += 1
    searchAbortRef.current?.abort()
    searchAbortRef.current = null
    setSearchState({ query: routeQuery, status: 'cancelled', results: [] })
  }

  const handleClearSearch = () => {
    searchRequestRef.current += 1
    searchAbortRef.current?.abort()
    searchAbortRef.current = null
    setSearchState({ query: '', status: 'idle', results: [] })
    if (isSearchPage) {
      const params = new URLSearchParams()
      const playing = searchParams.get('playing')
      if (playing) params.set('playing', playing)
      navigate({ pathname: '/search', search: params.toString() })
    }
  }

  const handlePlay = (track: Track) => {
    apiService.recordChannelWatch(track.channel, track.thumbnail)
    dispatch(playNow(track))
  }

  const handleAddToQueue = (track: Track) => {
    if (playlist.some((item) => item.videoId === track.videoId)) {
      setQueueNotice({ message: `「${track.title}」已在待播清單`, severity: 'info' })
      return
    }
    dispatch(addToQueue(track))
    setQueueNotice({ message: `已將「${track.title}」加入待播清單`, severity: 'success' })
  }

  const openLyrics = () => {
    setHasOpenedLyrics(true)
    setLyricsDrawerOpen(true)
  }
  const homeParams = new URLSearchParams()
  if (searchParams.get('playing')) homeParams.set('playing', searchParams.get('playing')!)

  const searchContent = !routeQuery ? (
    <Alert severity="info">輸入歌名、藝人或關鍵字，尋找想聽的音樂。</Alert>
  ) : loading ? (
    <ContentSkeleton label={`正在搜尋「${routeQuery}」`} />
  ) : searchState.status === 'error' ? (
    <Alert
      severity="error"
      action={
        <Button color="inherit" onClick={() => setSearchRevision((revision) => revision + 1)}>
          重試
        </Button>
      }
    >
      搜尋暫時無法完成，請檢查連線或稍後重試。
    </Alert>
  ) : searchState.status === 'cancelled' ? (
    <Alert
      severity="info"
      action={
        <Button color="inherit" onClick={() => setSearchRevision((revision) => revision + 1)}>
          重新搜尋
        </Button>
      }
    >
      已取消搜尋。您可以修改關鍵字或重新搜尋。
    </Alert>
  ) : searchState.status === 'ready' ? (
    <SearchResults
      results={searchState.results}
      onPlay={handlePlay}
      onAddToQueue={handleAddToQueue}
      currentTrackId={currentTrack?.videoId}
    />
  ) : null

  return (
    <Box
      className="app-shell"
      data-layout={responsiveLayout}
      data-testid="app-layout"
      sx={{
        display: 'flex',
        flexDirection: 'column',
        height: 'var(--app-dvh, 100dvh)',
        overflow: 'hidden',
        bgcolor: 'background.default',
      }}
    >
      <Box
        component="a"
        href="#main-content"
        sx={{
          position: 'absolute',
          left: 16,
          top: 8,
          zIndex: 1500,
          transform: 'translateY(-200%)',
          '&:focus': { transform: 'none' },
          bgcolor: 'background.paper',
          color: 'text.primary',
          p: 1.5,
          borderRadius: 1,
        }}
      >
        跳到主要內容
      </Box>
      <Box
        component="header"
        className="app-header"
        sx={{
          flexShrink: 0,
          bgcolor: 'background.paper',
          borderBottom: 1,
          borderColor: 'divider',
          pt: 'env(safe-area-inset-top, 0px)',
        }}
      >
        <Container maxWidth={false} sx={{ maxWidth: 1280, px: { xs: 2, md: 4 } }}>
          <Box
            className="header-inner"
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: { xs: 1, md: 3 },
              minHeight: { xs: 64, md: 80 },
            }}
          >
            <Box
              component={Link}
              to={{ pathname: '/', search: homeParams.toString() }}
              onClick={() => {
                if (isHome) scrollToTop()
              }}
              aria-label={`${siteTitle}，返回首頁`}
              sx={{
                display: 'flex',
                alignItems: 'center',
                minHeight: 44,
                minWidth: 0,
                flex: 1,
                color: 'text.primary',
                textDecoration: 'none',
              }}
            >
              <Typography
                component="span"
                noWrap
                sx={{
                  fontFamily: '\"Cinzel\", \"PingFang TC\", serif',
                  fontSize: { xs: 20, sm: 24 },
                  fontWeight: 600,
                  letterSpacing: '0.02em',
                  lineHeight: 1.3,
                }}
              >
                {siteTitle}
              </Typography>
            </Box>
            {headerNavigation && <BottomNav desktop scrollToTop={scrollToTop} />}
            <RadioButton />
          </Box>
        </Container>
      </Box>

      <Box
        component="main"
        id="main-content"
        className="app-main"
        tabIndex={-1}
        ref={scrollContainerRef}
        sx={{
          flex: 1,
          minHeight: 0,
          minWidth: 0,
          overflowY: 'auto',
          overflowX: 'hidden',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        <Container
          maxWidth={false}
          className="main-inner"
          sx={{ maxWidth: 1280, px: { xs: 2, md: 4 }, py: { xs: 2, md: 3 } }}
        >
          <RadioIndicator />
          {(isHome || isSearchPage) && (
            <>
              <Typography
                variant="h5"
                component="h1"
                sx={{ fontSize: { xs: 22, md: 28 }, lineHeight: 1.3, mb: 1 }}
              >
                {isHome ? '今天，想聽什麼？' : '搜尋音樂'}
              </Typography>
              <Box
                className="search-dock"
                sx={{
                  position: 'sticky',
                  // The dock stays within the scrolling content, not over the player.
                  top: 0,
                  zIndex: 5,
                  bgcolor: 'background.default',
                  pb: 1,
                  mb: 2,
                }}
              >
                <SearchBar
                  query={routeQuery}
                  onSearch={handleSearch}
                  onCancel={handleCancelSearch}
                  onClear={handleClearSearch}
                  loading={loading}
                />
              </Box>
            </>
          )}
          {currentTrack && displayMode === 'video' && !lyricsDrawerOpen && (
            <LazyContentBoundary label="影片畫面">
              <Suspense
                fallback={
                  <Skeleton
                    variant="rounded"
                    sx={{ width: '100%', aspectRatio: '16 / 9', height: 'auto', mb: 3 }}
                  />
                }
              >
                <VideoPlayer track={currentTrack} />
              </Suspense>
            </LazyContentBoundary>
          )}
          <Routes>
            <Route path="/" element={<HomeRecommendations onSearch={handleSearch} />} />
            <Route path="/search" element={searchContent} />
            <Route path="/playlists" element={<PlaylistSection />} />
            <Route
              path="/admin"
              element={
                <LazyContentBoundary label="設定頁面">
                  <Suspense fallback={<ContentSkeleton label="正在載入設定" />}>
                    <AdminSettings />
                  </Suspense>
                </LazyContentBoundary>
              }
            />
            <Route
              path="*"
              element={
                <Alert
                  severity="info"
                  action={
                    <Button component={Link} to="/">
                      回首頁
                    </Button>
                  }
                >
                  找不到這個頁面。
                </Alert>
              }
            />
          </Routes>
          <Box component="footer" sx={{ mt: 4, pt: 2, borderTop: 1, borderColor: 'divider' }}>
            <Typography variant="caption" color="text.secondary">
              {siteTitle} · v{version}
            </Typography>
          </Box>
        </Container>
      </Box>

      <Box className="player-dock" data-testid="player-dock" sx={{ flexShrink: 0, minWidth: 0 }}>
        <AudioPlayer onOpenLyrics={openLyrics} />
        {!currentTrack && responsiveLayout === 'wide-landscape' && (
          <Box className="player-idle" sx={{ p: 3, color: 'text.secondary' }}>
            <Typography variant="overline" sx={{ letterSpacing: '0.15em' }}>
              你的聆聽空間
            </Typography>
            <Typography variant="h5" color="text.primary" sx={{ mt: 2, mb: 1 }}>
              從一首歌開始
            </Typography>
            <Typography variant="body2" sx={{ lineHeight: 1.8 }}>
              選擇推薦歌曲，或搜尋喜歡的藝人。播放控制會留在這裡，陪你繼續探索。
            </Typography>
          </Box>
        )}
      </Box>
      {!headerNavigation && <BottomNav scrollToTop={scrollToTop} />}
      {currentTrack && hasOpenedLyrics && (
        <LazyContentBoundary
          label="歌詞畫面"
          open={lyricsDrawerOpen}
          onClose={() => setLyricsDrawerOpen(false)}
        >
          <Suspense
            fallback={
              <Dialog
                open={lyricsDrawerOpen}
                onClose={() => setLyricsDrawerOpen(false)}
                fullWidth
                maxWidth="sm"
              >
                <DialogTitle>正在開啟播放畫面</DialogTitle>
                <DialogContent>
                  <ContentSkeleton label="正在載入歌詞介面" />
                </DialogContent>
                <DialogActions>
                  <Button onClick={() => setLyricsDrawerOpen(false)}>取消</Button>
                </DialogActions>
              </Dialog>
            }
          >
            <FullscreenLyrics
              open={lyricsDrawerOpen}
              onClose={() => setLyricsDrawerOpen(false)}
              track={currentTrack}
            />
          </Suspense>
        </LazyContentBoundary>
      )}
      <Snackbar
        open={Boolean(queueNotice)}
        autoHideDuration={4000}
        onClose={() => setQueueNotice(null)}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
        sx={{
          top: { xs: 'calc(72px + env(safe-area-inset-top, 0px))', md: 88 },
          maxWidth: 'calc(100% - 32px)',
        }}
      >
        <Alert
          severity={queueNotice?.severity || 'success'}
          onClose={() => setQueueNotice(null)}
          sx={{ width: '100%', overflowWrap: 'anywhere' }}
        >
          {queueNotice?.message}
        </Alert>
      </Snackbar>
    </Box>
  )
}

export default function App() {
  return (
    <Router>
      <AppContent />
    </Router>
  )
}
