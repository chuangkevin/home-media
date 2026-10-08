import { useState, useEffect } from 'react'
import { useSelector, useDispatch } from 'react-redux'
import {
  Box,
  Card,
  CardContent,
  Typography,
  TextField,
  Button,
  Switch,
  FormControlLabel,
  Grid,
  Divider,
  Alert,
  CircularProgress,
  List,
  ListItem,
  ListItemAvatar,
  Avatar,
  ListItemText,
  IconButton,
  Collapse,
  Tabs,
  Tab,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from '@mui/material'
import SaveIcon from '@mui/icons-material/Save'
import RefreshIcon from '@mui/icons-material/Refresh'
import DeleteIcon from '@mui/icons-material/Delete'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import ExpandLessIcon from '@mui/icons-material/ExpandLess'
import SmartToyIcon from '@mui/icons-material/SmartToy'
import AddIcon from '@mui/icons-material/Add'
import KeyIcon from '@mui/icons-material/Key'
import BlockIcon from '@mui/icons-material/Block'
import apiService from '../../services/api.service'
import audioCacheService, { type CacheListItem } from '../../services/audio-cache.service'
import lyricsCacheService from '../../services/lyrics-cache.service'
import { RootState, AppDispatch } from '../../store'
import { unblockItem } from '../../store/blockSlice'

interface Settings {
  site_title: string
  cache_duration: number
  enable_lyrics: boolean
  auto_play: boolean
  theme_mode: string
  audio_cache_ttl_days: number
  audio_cache_max_size_gb: number
  audio_cache_max_entries: number
}

export default function AdminSettings() {
  const dispatch = useDispatch<AppDispatch>()
  const { items: blockedItems } = useSelector((state: RootState) => state.block)
  const blockedSongs = blockedItems.filter((b) => b.type === 'song')
  const blockedChannels = blockedItems.filter((b) => b.type === 'channel')

  const [unblockingId, setUnblockingId] = useState<number | null>(null)
  const handleUnblock = async (id: number) => {
    setUnblockingId(id)
    try {
      await dispatch(unblockItem(id)).unwrap()
      setMessage({ type: 'success', text: '已解除封鎖' })
    } catch {
      setMessage({ type: 'error', text: '解除封鎖失敗，請再試一次。' })
    } finally {
      setUnblockingId(null)
    }
  }

  const [settings, setSettings] = useState<Settings>({
    site_title: 'Home Media',
    cache_duration: 86400000,
    enable_lyrics: true,
    auto_play: true,
    theme_mode: 'dark',
    audio_cache_ttl_days: 30,
    audio_cache_max_size_gb: 2,
    audio_cache_max_entries: 200,
  })
  const [loading, setLoading] = useState(true)
  const [settingsLoaded, setSettingsLoaded] = useState(false)
  const [activeTab, setActiveTab] = useState(0)
  const [confirmAction, setConfirmAction] = useState<{
    title: string
    description: string
    run: () => Promise<void>
  } | null>(null)
  const [confirmBusy, setConfirmBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [clearing, setClearing] = useState<string | null>(null)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [cachedTracks, setCachedTracks] = useState<CacheListItem[]>([])
  const [showCacheList, setShowCacheList] = useState(false)
  const [cacheListLoading, setCacheListLoading] = useState(false)
  const [cacheListError, setCacheListError] = useState(false)
  const [deletingTrack, setDeletingTrack] = useState<string | null>(null)

  // Gemini API Key 管理
  const [geminiKeys, setGeminiKeys] = useState<Array<{ suffix: string; fromEnv: boolean }>>([])
  const [geminiConfigured, setGeminiConfigured] = useState(false)
  const [geminiKeyInput, setGeminiKeyInput] = useState('')
  const [geminiSaving, setGeminiSaving] = useState(false)
  const [geminiStatusError, setGeminiStatusError] = useState(false)
  const [geminiStatusLoaded, setGeminiStatusLoaded] = useState(false)
  const [ocStatusError, setOcStatusError] = useState(false)
  const [ocModelsError, setOcModelsError] = useState(false)

  // OpenCode 設定
  type OcVariant = 'default' | 'medium' | 'high' | ''
  interface OcModel {
    id: string
    name: string
    provider: string
  }
  interface OcStatus {
    servers: Array<{ id: string; label: string; baseUrl: string }>
    serversSource: string
    textModel: string
    textModelSource: string
    visionModel: string
    visionModelSource: string
    textVariant: string
    textVariantSource: string
    visionVariant: string
    visionVariantSource: string
  }
  const [ocStatus, setOcStatus] = useState<OcStatus | null>(null)
  const [ocModels, setOcModels] = useState<OcModel[]>([])
  const [ocModelSearch, setOcModelSearch] = useState('')
  const [ocServersInput, setOcServersInput] = useState('')
  const [ocTextModel, setOcTextModel] = useState('')
  const [ocVisionModel, setOcVisionModel] = useState('')
  const [ocTextVariant, setOcTextVariant] = useState<OcVariant>('')
  const [ocVisionVariant, setOcVisionVariant] = useState<OcVariant>('')
  const [ocSaving, setOcSaving] = useState(false)
  const [ocModelsLoading, setOcModelsLoading] = useState(false)

  // 載入設定
  const loadSettings = async () => {
    try {
      setLoading(true)
      const data = await apiService.getSettings()
      setSettings(data)
      setSettingsLoaded(true)
      setMessage(null)
    } catch (error) {
      console.error('Failed to load settings:', error)
      setMessage({ type: 'error', text: '載入設定失敗' })
    } finally {
      setLoading(false)
    }
  }

  const loadGeminiStatus = async () => {
    try {
      const data = await apiService.getGeminiStatus()
      setGeminiConfigured(data.configured)
      setGeminiKeys(data.keys)
      setGeminiStatusError(false)
      setGeminiStatusLoaded(true)
    } catch {
      setGeminiStatusError(true)
    }
  }

  const loadOpenCode = async () => {
    try {
      const data = await apiService.getOpenCodeStatus()
      const st: OcStatus = data.openCode
      setOcStatus(st)
      setOcStatusError(false)
      setOcServersInput(st.servers.map((s: { baseUrl: string }) => s.baseUrl).join('\n'))
      setOcTextModel(st.textModelSource === 'setting' ? st.textModel : '')
      setOcVisionModel(st.visionModelSource === 'setting' ? st.visionModel : '')
      setOcTextVariant(st.textVariantSource === 'setting' ? (st.textVariant as OcVariant) : '')
      setOcVisionVariant(
        st.visionVariantSource === 'setting' ? (st.visionVariant as OcVariant) : ''
      )
    } catch {
      setOcStatusError(true)
    }
  }

  const loadOpenCodeModels = async () => {
    setOcModelsLoading(true)
    try {
      const data = await apiService.getOpenCodeModels()
      setOcModels(data.models)
      setOcModelsError(false)
    } catch {
      setOcModelsError(true)
    } finally {
      setOcModelsLoading(false)
    }
  }

  const handleSaveOpenCode = async () => {
    setOcSaving(true)
    setMessage(null)
    try {
      await apiService.saveOpenCodeSettings({
        servers: ocServersInput,
        textModel: ocTextModel,
        visionModel: ocVisionModel,
        textVariant: ocTextVariant,
        visionVariant: ocVisionVariant,
      })
      setMessage({ type: 'success', text: 'OpenCode 設定已儲存' })
      await loadOpenCode()
    } catch {
      setMessage({ type: 'error', text: 'OpenCode 設定儲存失敗' })
    } finally {
      setOcSaving(false)
    }
  }

  const handleClearOpenCode = async () => {
    setOcSaving(true)
    setMessage(null)
    try {
      await apiService.clearOpenCodeSettings()
      setMessage({ type: 'success', text: 'OpenCode DB 設定已清除' })
      await loadOpenCode()
    } catch {
      setMessage({ type: 'error', text: 'OpenCode 清除失敗' })
    } finally {
      setOcSaving(false)
    }
  }

  const handleAddGeminiKeys = async () => {
    if (!geminiKeyInput.trim()) return
    setGeminiSaving(true)
    try {
      const data = await apiService.addGeminiKeys(geminiKeyInput)
      setMessage({ type: 'success', text: `新增 ${data.added} 把 Key（跳過 ${data.skipped} 把）` })
      setGeminiKeyInput('')
      loadGeminiStatus()
    } catch (err: any) {
      setMessage({ type: 'error', text: err.response?.data?.error || '新增失敗' })
    } finally {
      setGeminiSaving(false)
    }
  }

  const handleRemoveGeminiKey = async (suffix: string) => {
    setGeminiSaving(true)
    try {
      await apiService.removeGeminiKey(suffix)
      setMessage({ type: 'success', text: '金鑰已移除' })
      await loadGeminiStatus()
    } catch {
      setMessage({ type: 'error', text: '移除失敗' })
    } finally {
      setGeminiSaving(false)
    }
  }

  useEffect(() => {
    loadSettings()
    loadGeminiStatus()
    loadOpenCode()
    loadOpenCodeModels()
  }, [])

  // 儲存設定
  const handleSave = async () => {
    try {
      if (!settingsLoaded) return
      if (
        ![
          settings.cache_duration,
          settings.audio_cache_ttl_days,
          settings.audio_cache_max_size_gb,
          settings.audio_cache_max_entries,
        ].every(Number.isFinite)
      ) {
        setMessage({ type: 'error', text: '請填入有效的快取數值後再儲存。' })
        return
      }
      setSaving(true)
      setMessage(null)
      await apiService.updateSettings(settings)
      setMessage({ type: 'success', text: '設定已儲存' })

      // 更新頁面標題
      document.title = settings.site_title

      // 觸發主題變更事件
      window.dispatchEvent(new CustomEvent('themeChanged', { detail: settings.theme_mode }))
    } catch (error) {
      console.error('Failed to save settings:', error)
      setMessage({ type: 'error', text: '儲存設定失敗，輸入內容已保留，請再試一次。' })
    } finally {
      setSaving(false)
    }
  }

  // 清除本地音訊快取
  const handleClearLocalCache = async () => {
    try {
      setClearing('local')
      await audioCacheService.clear()
      setCachedTracks([])
      setMessage({ type: 'success', text: '本地音訊快取已清除' })
      setClearing(null)
    } catch (error) {
      console.error('Failed to clear local cache:', error)
      setMessage({ type: 'error', text: '清除本地快取失敗' })
      setClearing(null)
    }
  }

  // 載入快取列表
  const loadCacheList = async () => {
    setCacheListLoading(true)
    setCacheListError(false)
    try {
      const list = await audioCacheService.getCacheList()
      setCachedTracks(list)
    } catch (error) {
      console.error('Failed to load cache list:', error)
      setCacheListError(true)
    } finally {
      setCacheListLoading(false)
    }
  }

  // 刪除單首音樂快取
  const handleDeleteTrack = async (videoId: string) => {
    try {
      setDeletingTrack(videoId)
      await audioCacheService.delete(videoId)
      await loadCacheList()
      setMessage({ type: 'success', text: '快取已刪除' })
    } catch (error) {
      console.error('Failed to delete track cache:', error)
      setMessage({ type: 'error', text: '刪除快取失敗' })
    } finally {
      setDeletingTrack(null)
    }
  }

  // 切換快取列表顯示
  const handleToggleCacheList = async () => {
    if (!showCacheList) {
      await loadCacheList()
    }
    setShowCacheList(!showCacheList)
  }

  // 清除歌詞快取
  const handleClearLyricsCache = async () => {
    try {
      setClearing('lyrics')
      await lyricsCacheService.clear()
      setMessage({ type: 'success', text: '歌詞快取已清除' })
      setClearing(null)
    } catch (error) {
      console.error('Failed to clear lyrics cache:', error)
      setMessage({ type: 'error', text: '清除歌詞快取失敗' })
      setClearing(null)
    }
  }

  // 清除伺服器快取
  const handleClearServerCache = async () => {
    try {
      setClearing('server')
      const result = await apiService.clearServerCache()
      if (!result.success) throw new Error(result.message || '清除失敗')
      setMessage({ type: 'success', text: '伺服器快取已清除' })
      setClearing(null)
    } catch (error) {
      console.error('Failed to clear server cache:', error)
      setMessage({ type: 'error', text: '清除伺服器快取失敗' })
      setClearing(null)
    }
  }

  if (loading && !settingsLoaded) {
    return (
      <Box
        role="status"
        sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2, py: 8 }}
      >
        <CircularProgress size={24} />
        <Typography color="text.secondary">正在載入設定…</Typography>
      </Box>
    )
  }

  return (
    <Box
      sx={{
        maxWidth: 1120,
        mx: 'auto',
        minWidth: 0,
        '& .MuiCard-root': { border: 1, borderColor: 'divider', boxShadow: 'none' },
        '& .MuiCardContent-root': { p: { xs: 2, sm: 3 }, '&:last-child': { pb: { xs: 2, sm: 3 } } },
        '& .MuiButton-root': { minHeight: 44, whiteSpace: 'nowrap', fontSize: 14 },
        '& .MuiIconButton-root': { minWidth: 44, minHeight: 44 },
        '& .MuiTypography-h6': { fontSize: 20, lineHeight: 1.4, fontWeight: 600 },
        '& .MuiTypography-body2': { fontSize: 14 },
        '& .MuiInputBase-root': { fontSize: 16 },
        '& .MuiFormHelperText-root': { fontSize: 12 },
        '& .MuiTextField-root, & .MuiGrid-item': { minWidth: 0 },
        '& .MuiAlert-message': { minWidth: 0, overflowWrap: 'anywhere' },
        '& .MuiSelect-select': { textOverflow: 'ellipsis' },
      }}
    >
      <Box sx={{ mb: 3 }}>
        <Typography component="h2" sx={{ fontSize: { xs: 24, sm: 28 }, fontWeight: 600, mb: 1 }}>
          設定
        </Typography>
        <Typography variant="body1" color="text.secondary">
          調整聆聽方式，讓每次播放都更合心意。
        </Typography>
      </Box>
      {message && (
        <Alert severity={message.type} sx={{ mb: 3 }} onClose={() => setMessage(null)}>
          {message.text}
        </Alert>
      )}
      <Tabs
        value={activeTab}
        onChange={(_, value) => setActiveTab(value)}
        variant="scrollable"
        scrollButtons="auto"
        allowScrollButtonsMobile
        aria-label="設定分類"
        sx={{
          mb: 3,
          borderBottom: 1,
          borderColor: 'divider',
          '& .MuiTab-root': { minHeight: 48, px: 2, fontSize: 14, whiteSpace: 'nowrap' },
        }}
      >
        {['使用偏好', '快取管理', '封鎖管理', '進階設定'].map((label, index) => (
          <Tab
            key={label}
            id={`settings-tab-${index}`}
            aria-controls={`settings-panel-${index}`}
            label={label}
          />
        ))}
      </Tabs>
      {!settingsLoaded && activeTab < 2 ? (
        <Alert
          severity="error"
          action={
            <Button color="inherit" onClick={loadSettings}>
              重新載入
            </Button>
          }
        >
          目前無法讀取設定，請重新載入後再修改。
        </Alert>
      ) : (
        <>
          <Box
            role="tabpanel"
            id="settings-panel-0"
            aria-labelledby="settings-tab-0"
            hidden={activeTab !== 0}
          >
            <Grid container spacing={3}>
              {/* 基本設定 */}
              <Grid item xs={12} md={6}>
                <Card>
                  <CardContent>
                    <Typography variant="h6" component="h3" gutterBottom>
                      基本設定
                    </Typography>
                    <Divider sx={{ mb: 2 }} />

                    <TextField
                      fullWidth
                      label="網站標題"
                      value={settings.site_title}
                      onChange={(e) => setSettings({ ...settings, site_title: e.target.value })}
                      sx={{ mb: 2 }}
                      helperText="顯示在瀏覽器標籤的標題"
                    />

                    <TextField
                      fullWidth
                      label="主題模式"
                      value={settings.theme_mode}
                      onChange={(e) => setSettings({ ...settings, theme_mode: e.target.value })}
                      select
                      SelectProps={{ native: true }}
                      sx={{ mb: 2 }}
                    >
                      <option value="dark">深色模式</option>
                      <option value="light">淺色模式</option>
                      <option value="auto">自動</option>
                    </TextField>
                  </CardContent>
                </Card>
              </Grid>

              {/* 功能設定 */}
              <Grid item xs={12} md={6}>
                <Card>
                  <CardContent>
                    <Typography variant="h6" component="h3" gutterBottom>
                      功能設定
                    </Typography>
                    <Divider sx={{ mb: 2 }} />

                    <FormControlLabel
                      control={
                        <Switch
                          checked={settings.enable_lyrics}
                          onChange={(e) =>
                            setSettings({ ...settings, enable_lyrics: e.target.checked })
                          }
                        />
                      }
                      label="啟用歌詞功能"
                      sx={{ mb: 2, display: 'block' }}
                    />

                    <FormControlLabel
                      control={
                        <Switch
                          checked={settings.auto_play}
                          onChange={(e) =>
                            setSettings({ ...settings, auto_play: e.target.checked })
                          }
                        />
                      }
                      label="自動播放下一首"
                      sx={{ mb: 2, display: 'block' }}
                    />
                  </CardContent>
                </Card>
              </Grid>
            </Grid>

            <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', mt: 3 }}>
              <Button
                variant="contained"
                startIcon={saving ? <CircularProgress size={18} color="inherit" /> : <SaveIcon />}
                onClick={handleSave}
                disabled={saving || loading || !settingsLoaded}
              >
                {saving ? '儲存中…' : '儲存設定'}
              </Button>
              <Button
                variant="outlined"
                startIcon={<RefreshIcon />}
                onClick={loadSettings}
                disabled={saving || loading}
              >
                {loading ? '載入中…' : '重新載入'}
              </Button>
            </Box>
          </Box>
          <Box
            role="tabpanel"
            id="settings-panel-1"
            aria-labelledby="settings-tab-1"
            hidden={activeTab !== 1}
          >
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              管理裝置儲存空間。清除快取後，下次播放會重新下載音訊或歌詞。
            </Typography>
            <Grid container spacing={3}>
              {/* 快取設定 */}
              <Grid item xs={12}>
                <Card>
                  <CardContent>
                    <Typography variant="h6" component="h3" gutterBottom>
                      推薦快取設定
                    </Typography>
                    <Divider sx={{ mb: 2 }} />

                    <TextField
                      fullWidth
                      label="推薦快取時間（小時）"
                      type="number"
                      value={settings.cache_duration / 3600000}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          cache_duration: parseFloat(e.target.value) * 3600000,
                        })
                      }
                      helperText="推薦結果每隔多久重新取得"
                      sx={{ maxWidth: 400 }}
                    />
                  </CardContent>
                </Card>
              </Grid>

              {/* 音樂快取設定 */}
              <Grid item xs={12}>
                <Card>
                  <CardContent>
                    <Typography variant="h6" component="h3" gutterBottom>
                      音樂快取設定
                    </Typography>
                    <Divider sx={{ mb: 2 }} />

                    <Grid container spacing={2}>
                      <Grid item xs={12} sm={4}>
                        <TextField
                          fullWidth
                          label="快取期限 (天)"
                          type="number"
                          value={settings.audio_cache_ttl_days}
                          onChange={(e) =>
                            setSettings({
                              ...settings,
                              audio_cache_ttl_days: parseInt(e.target.value),
                            })
                          }
                          helperText="預設: 30 天"
                        />
                      </Grid>
                      <Grid item xs={12} sm={4}>
                        <TextField
                          fullWidth
                          label="最大容量 (GB)"
                          type="number"
                          value={settings.audio_cache_max_size_gb}
                          onChange={(e) =>
                            setSettings({
                              ...settings,
                              audio_cache_max_size_gb: parseInt(e.target.value),
                            })
                          }
                          helperText="預設: 2 GB"
                        />
                      </Grid>
                      <Grid item xs={12} sm={4}>
                        <TextField
                          fullWidth
                          label="最多歌曲數"
                          type="number"
                          value={settings.audio_cache_max_entries}
                          onChange={(e) =>
                            setSettings({
                              ...settings,
                              audio_cache_max_entries: parseInt(e.target.value),
                            })
                          }
                          helperText="預設: 200 首"
                        />
                      </Grid>
                    </Grid>

                    {/* 快取列表 */}
                    <Box sx={{ mt: 3 }}>
                      <Button
                        variant="outlined"
                        startIcon={showCacheList ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                        onClick={handleToggleCacheList}
                        disabled={cacheListLoading}
                        aria-expanded={showCacheList}
                        fullWidth
                      >
                        {showCacheList ? '隱藏快取列表' : '顯示快取列表'}
                      </Button>

                      <Collapse in={showCacheList}>
                        <Box sx={{ mt: 2 }}>
                          {cacheListLoading ? (
                            <Box
                              role="status"
                              sx={{ display: 'flex', gap: 1.5, alignItems: 'center', py: 3 }}
                            >
                              <CircularProgress size={20} />
                              <Typography variant="body2">正在載入快取…</Typography>
                            </Box>
                          ) : cacheListError ? (
                            <Alert
                              severity="error"
                              action={
                                <Button color="inherit" onClick={loadCacheList}>
                                  重試
                                </Button>
                              }
                            >
                              快取列表載入失敗
                            </Alert>
                          ) : cachedTracks.length === 0 ? (
                            <Typography color="text.secondary" align="center" sx={{ py: 2 }}>
                              目前沒有快取
                            </Typography>
                          ) : (
                            <List sx={{ bgcolor: 'background.paper', borderRadius: 1 }}>
                              {cachedTracks.map((track) => (
                                <ListItem
                                  key={track.videoId}
                                  divider
                                  secondaryAction={
                                    <IconButton
                                      edge="end"
                                      aria-label={`刪除 ${track.title} 的快取`}
                                      onClick={() =>
                                        setConfirmAction({
                                          title: '刪除歌曲快取',
                                          description: `將移除「${track.title}」在此裝置的快取，下次播放會重新下載。`,
                                          run: () => handleDeleteTrack(track.videoId),
                                        })
                                      }
                                      disabled={deletingTrack === track.videoId}
                                      color="error"
                                    >
                                      {deletingTrack === track.videoId ? (
                                        <CircularProgress size={24} />
                                      ) : (
                                        <DeleteIcon />
                                      )}
                                    </IconButton>
                                  }
                                >
                                  <ListItemAvatar>
                                    <Avatar src={track.thumbnail} variant="rounded" />
                                  </ListItemAvatar>
                                  <ListItemText
                                    primary={track.title}
                                    primaryTypographyProps={{
                                      fontSize: 14,
                                      sx: { overflowWrap: 'anywhere' },
                                    }}
                                    secondaryTypographyProps={{ fontSize: 12 }}
                                    secondary={
                                      <>
                                        {track.channel && `${track.channel} • `}
                                        {(track.size / 1024 / 1024).toFixed(1)} MB
                                        {track.duration &&
                                          ` • ${Math.floor(track.duration / 60)}:${String(Math.floor(track.duration % 60)).padStart(2, '0')}`}
                                      </>
                                    }
                                  />
                                </ListItem>
                              ))}
                            </List>
                          )}
                        </Box>
                      </Collapse>
                    </Box>
                  </CardContent>
                </Card>
              </Grid>
            </Grid>

            <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', mt: 3 }}>
              <Button
                variant="contained"
                startIcon={saving ? <CircularProgress size={18} color="inherit" /> : <SaveIcon />}
                onClick={handleSave}
                disabled={saving || loading || !settingsLoaded}
              >
                {saving ? '儲存中…' : '儲存設定'}
              </Button>
              <Button
                variant="outlined"
                startIcon={<RefreshIcon />}
                onClick={loadSettings}
                disabled={saving || loading}
              >
                {loading ? '載入中…' : '重新載入'}
              </Button>
            </Box>

            <Card sx={{ mt: 3 }}>
              <CardContent>
                <Typography variant="h6" component="h3" sx={{ mb: 1 }}>
                  清理快取
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  這些操作只清除快取，不會移除你的播放清單。
                </Typography>
                <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
                  <Button
                    variant="outlined"
                    color="warning"
                    startIcon={<DeleteIcon />}
                    disabled={clearing !== null}
                    onClick={() =>
                      setConfirmAction({
                        title: '清除本地音訊快取',
                        description: '移除此裝置已下載的音訊，下次播放會重新下載。',
                        run: handleClearLocalCache,
                      })
                    }
                  >
                    本地音訊快取
                  </Button>
                  <Button
                    variant="outlined"
                    color="warning"
                    startIcon={<DeleteIcon />}
                    disabled={clearing !== null}
                    onClick={() =>
                      setConfirmAction({
                        title: '清除歌詞快取',
                        description: '移除此裝置儲存的歌詞，下次開啟歌詞時會重新載入。',
                        run: handleClearLyricsCache,
                      })
                    }
                  >
                    歌詞快取
                  </Button>
                  <Button
                    variant="outlined"
                    color="error"
                    startIcon={<DeleteIcon />}
                    disabled={clearing !== null}
                    onClick={() =>
                      setConfirmAction({
                        title: '清除伺服器快取',
                        description: '使用此伺服器的裝置可能需要重新下載音訊。確定要繼續嗎？',
                        run: handleClearServerCache,
                      })
                    }
                  >
                    伺服器快取
                  </Button>
                </Box>
              </CardContent>
            </Card>
          </Box>
        </>
      )}
      <Box
        role="tabpanel"
        id="settings-panel-2"
        aria-labelledby="settings-tab-2"
        hidden={activeTab !== 2}
      >
        {/* 封鎖管理 */}
        <Card sx={{ mt: 3 }}>
          <CardContent>
            <Typography
              variant="h6"
              component="h3"
              gutterBottom
              sx={{ display: 'flex', alignItems: 'center', gap: 1 }}
            >
              <BlockIcon /> 封鎖管理
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              被封鎖的歌曲和頻道不會出現在自動推薦中。
            </Typography>

            {/* 封鎖的歌曲 */}
            <Typography variant="subtitle1" sx={{ fontWeight: 600, mt: 2, mb: 1 }}>
              封鎖的歌曲（{blockedSongs.length}）
            </Typography>
            {blockedSongs.length === 0 ? (
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                目前沒有封鎖的歌曲
              </Typography>
            ) : (
              <List sx={{ bgcolor: 'background.paper', borderRadius: 1, mb: 2 }}>
                {blockedSongs.map((item) => (
                  <ListItem
                    key={item.id}
                    divider
                    sx={{
                      pr: { xs: 2, sm: 15 },
                      pb: { xs: 7, sm: 2 },
                      alignItems: 'flex-start',
                      '& .MuiListItemSecondaryAction-root': {
                        top: { xs: 'auto', sm: '50%' },
                        bottom: { xs: 8, sm: 'auto' },
                        transform: { xs: 'none', sm: 'translateY(-50%)' },
                      },
                    }}
                    secondaryAction={
                      <Button
                        size="small"
                        variant="outlined"
                        disabled={unblockingId !== null}
                        onClick={() => handleUnblock(item.id)}
                      >
                        解除封鎖
                      </Button>
                    }
                  >
                    <ListItemAvatar>
                      <Avatar src={item.thumbnail || undefined} variant="rounded" />
                    </ListItemAvatar>
                    <ListItemText
                      primary={item.title}
                      primaryTypographyProps={{ fontSize: 14, sx: { overflowWrap: 'anywhere' } }}
                      secondaryTypographyProps={{ fontSize: 12 }}
                      secondary={`封鎖於 ${new Date(item.blocked_at).toLocaleDateString('zh-TW')}`}
                    />
                  </ListItem>
                ))}
              </List>
            )}

            <Divider sx={{ my: 2 }} />

            {/* 封鎖的頻道 */}
            <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
              封鎖的頻道（{blockedChannels.length}）
            </Typography>
            {blockedChannels.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                目前沒有封鎖的頻道
              </Typography>
            ) : (
              <List sx={{ bgcolor: 'background.paper', borderRadius: 1 }}>
                {blockedChannels.map((item) => (
                  <ListItem
                    key={item.id}
                    divider
                    sx={{
                      pr: { xs: 2, sm: 15 },
                      pb: { xs: 7, sm: 2 },
                      alignItems: 'flex-start',
                      '& .MuiListItemSecondaryAction-root': {
                        top: { xs: 'auto', sm: '50%' },
                        bottom: { xs: 8, sm: 'auto' },
                        transform: { xs: 'none', sm: 'translateY(-50%)' },
                      },
                    }}
                    secondaryAction={
                      <Button
                        size="small"
                        variant="outlined"
                        disabled={unblockingId !== null}
                        onClick={() => handleUnblock(item.id)}
                      >
                        解除封鎖
                      </Button>
                    }
                  >
                    <ListItemAvatar>
                      <Avatar src={item.thumbnail || undefined} variant="rounded" />
                    </ListItemAvatar>
                    <ListItemText
                      primary={item.title}
                      primaryTypographyProps={{ fontSize: 14, sx: { overflowWrap: 'anywhere' } }}
                      secondaryTypographyProps={{ fontSize: 12 }}
                      secondary={`封鎖於 ${new Date(item.blocked_at).toLocaleDateString('zh-TW')}`}
                    />
                  </ListItem>
                ))}
              </List>
            )}
          </CardContent>
        </Card>
      </Box>
      <Box
        role="tabpanel"
        id="settings-panel-3"
        aria-labelledby="settings-tab-3"
        hidden={activeTab !== 3}
      >
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          管理歌詞辨識與 AI 服務。一般播放不需要在這裡調整設定。
        </Typography>

        {/* Gemini AI 歌詞提取 */}
        <Card sx={{ mt: 3 }}>
          <CardContent>
            <Typography
              variant="h6"
              component="h3"
              gutterBottom
              sx={{ display: 'flex', alignItems: 'center', gap: 1 }}
            >
              <SmartToyIcon /> Gemini AI 歌詞提取
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              使用已設定的 AI 服務整理歌名與藝人，協助搜尋歌詞。
              {geminiStatusError
                ? ' 目前無法確認設定狀態。'
                : !geminiStatusLoaded
                  ? ' 正在讀取設定…'
                  : geminiConfigured
                    ? ` 已設定 ${geminiKeys.length} 把 Key。`
                    : ' 尚未設定，將使用基本歌名辨識。'}
            </Typography>

            {geminiStatusError && (
              <Alert
                severity="warning"
                sx={{ mb: 2 }}
                action={
                  <Button color="inherit" onClick={loadGeminiStatus}>
                    重試
                  </Button>
                }
              >
                金鑰狀態載入失敗
              </Alert>
            )}
            {geminiKeys.length > 0 && (
              <Box sx={{ mb: 2, display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                {geminiKeys.map((k) => (
                  <Box
                    key={k.suffix}
                    sx={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      px: 1.5,
                      py: 0.5,
                      bgcolor: 'action.hover',
                      borderRadius: 1,
                    }}
                  >
                    <KeyIcon sx={{ fontSize: 16, mr: 0.5 }} />
                    <Typography variant="body2" sx={{ mr: 0.5, fontFamily: 'monospace' }}>
                      ...{k.suffix} {k.fromEnv ? '(env)' : ''}
                    </Typography>
                    {!k.fromEnv && (
                      <IconButton
                        aria-label={`移除尾碼 ${k.suffix} 的金鑰`}
                        size="small"
                        onClick={() => handleRemoveGeminiKey(k.suffix)}
                        disabled={geminiStatusError || geminiSaving}
                      >
                        <DeleteIcon sx={{ fontSize: 14 }} />
                      </IconButton>
                    )}
                  </Box>
                ))}
              </Box>
            )}

            <TextField
              multiline
              minRows={2}
              maxRows={6}
              fullWidth
              label="API Key"
              helperText="每行一個，可一次新增多個金鑰。"
              placeholder={'AIzaSy...\nAIzaSy...'}
              value={geminiKeyInput}
              onChange={(e) => setGeminiKeyInput(e.target.value)}
              sx={{ mb: 1.5 }}
            />
            <Button
              variant="contained"
              startIcon={geminiSaving ? <CircularProgress size={20} /> : <AddIcon />}
              onClick={handleAddGeminiKeys}
              disabled={
                geminiSaving || geminiStatusError || !geminiStatusLoaded || !geminiKeyInput.trim()
              }
              size="small"
            >
              {geminiSaving ? '驗證中...' : '新增 API Key'}
            </Button>
          </CardContent>
        </Card>

        {/* OpenCode AI 設定 */}
        <Card sx={{ mt: 3 }}>
          <CardContent>
            <Typography
              variant="h6"
              component="h3"
              gutterBottom
              sx={{ display: 'flex', alignItems: 'center', gap: 1 }}
            >
              <SmartToyIcon /> OpenCode AI 設定
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              設定 OpenCode 伺服器與文字模型。文字 AI（分析/翻譯/推薦）優先使用
              OpenCode，語音轉錄維持 Gemini。
            </Typography>

            {ocStatusError && (
              <Alert
                severity="warning"
                sx={{ mb: 2 }}
                action={
                  <Button color="inherit" onClick={loadOpenCode}>
                    重試
                  </Button>
                }
              >
                進階設定載入失敗，請重試後再儲存。
              </Alert>
            )}
            {ocStatus && (
              <Alert severity="info" sx={{ mb: 2 }}>
                文字：{ocStatus.textModel} ({ocStatus.textVariant}) [{ocStatus.textModelSource}] ·
                視覺：{ocStatus.visionModel} ({ocStatus.visionVariant}) [
                {ocStatus.visionModelSource}]
              </Alert>
            )}

            <TextField
              multiline
              minRows={2}
              maxRows={5}
              fullWidth
              label="OpenCode 伺服器（每行一個 URL）"
              placeholder="https://provider-amd.sisihome.org"
              value={ocServersInput}
              onChange={(e) => setOcServersInput(e.target.value)}
              sx={{ mb: 2 }}
            />

            <TextField
              fullWidth
              size="small"
              label="模型搜尋"
              placeholder="輸入關鍵字過濾..."
              value={ocModelSearch}
              onChange={(e) => setOcModelSearch(e.target.value)}
              sx={{ mb: 1.5 }}
              InputProps={{
                endAdornment: ocModelsLoading ? (
                  <CircularProgress size={16} />
                ) : (
                  <IconButton
                    aria-label="重新載入模型清單"
                    size="small"
                    onClick={loadOpenCodeModels}
                  >
                    <RefreshIcon fontSize="small" />
                  </IconButton>
                ),
              }}
            />

            {ocModelsError && (
              <Alert
                severity="warning"
                sx={{ mb: 2 }}
                action={
                  <Button color="inherit" onClick={loadOpenCodeModels}>
                    重試
                  </Button>
                }
              >
                模型清單載入失敗
              </Alert>
            )}
            {(() => {
              const search = ocModelSearch.toLowerCase()
              const filtered = ocModels.filter(
                (m) =>
                  !search ||
                  m.id.toLowerCase().includes(search) ||
                  m.name.toLowerCase().includes(search)
              )
              const providers = [...new Set(filtered.map((m) => m.provider))].sort()
              return (
                <Grid container spacing={2} sx={{ mb: 2 }}>
                  <Grid item xs={12} sm={6}>
                    <TextField
                      select
                      fullWidth
                      label="文字模型"
                      value={ocTextModel}
                      onChange={(e) => setOcTextModel(e.target.value)}
                      SelectProps={{ native: true }}
                    >
                      <option value="">
                        — 使用預設（{ocStatus?.textModel ?? 'opencode/mimo-v2.5-free'}）—
                      </option>
                      {providers.map((p) => (
                        <optgroup key={p} label={p}>
                          {filtered
                            .filter((m) => m.provider === p)
                            .map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.name} ({m.id})
                              </option>
                            ))}
                        </optgroup>
                      ))}
                    </TextField>
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <TextField
                      select
                      fullWidth
                      label="視覺模型"
                      value={ocVisionModel}
                      onChange={(e) => setOcVisionModel(e.target.value)}
                      SelectProps={{ native: true }}
                    >
                      <option value="">
                        — 使用預設（{ocStatus?.visionModel ?? 'opencode/mimo-v2.5-free'}）—
                      </option>
                      {providers.map((p) => (
                        <optgroup key={p} label={p}>
                          {filtered
                            .filter((m) => m.provider === p)
                            .map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.name} ({m.id})
                              </option>
                            ))}
                        </optgroup>
                      ))}
                    </TextField>
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <TextField
                      select
                      fullWidth
                      label="文字 Variant"
                      value={ocTextVariant}
                      onChange={(e) => setOcTextVariant(e.target.value as OcVariant)}
                      SelectProps={{ native: true }}
                    >
                      <option value="">— 使用預設（{ocStatus?.textVariant ?? 'medium'}）—</option>
                      <option value="default">default</option>
                      <option value="medium">medium</option>
                      <option value="high">high</option>
                    </TextField>
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <TextField
                      select
                      fullWidth
                      label="視覺 Variant"
                      value={ocVisionVariant}
                      onChange={(e) => setOcVisionVariant(e.target.value as OcVariant)}
                      SelectProps={{ native: true }}
                    >
                      <option value="">— 使用預設（{ocStatus?.visionVariant ?? 'medium'}）—</option>
                      <option value="default">default</option>
                      <option value="medium">medium</option>
                      <option value="high">high</option>
                    </TextField>
                  </Grid>
                </Grid>
              )
            })()}

            <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
              <Button
                variant="contained"
                startIcon={ocSaving ? <CircularProgress size={20} /> : <SaveIcon />}
                onClick={handleSaveOpenCode}
                disabled={ocSaving || ocStatusError || !ocStatus}
              >
                {ocSaving ? '儲存中...' : '儲存 OpenCode 設定'}
              </Button>
              <Button
                variant="outlined"
                color="warning"
                disabled={ocSaving || ocStatusError || !ocStatus}
                onClick={() =>
                  setConfirmAction({
                    title: '還原進階設定',
                    description: '清除已儲存的 OpenCode 設定，改用伺服器預設值。',
                    run: handleClearOpenCode,
                  })
                }
              >
                還原預設設定
              </Button>
            </Box>
          </CardContent>
        </Card>
      </Box>
      <Dialog
        open={!!confirmAction}
        onClose={() => {
          if (!confirmBusy) setConfirmAction(null)
        }}
        aria-labelledby="settings-confirm-title"
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle id="settings-confirm-title">{confirmAction?.title}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            {confirmAction?.description}
          </Typography>
        </DialogContent>
        <DialogActions sx={{ p: 2, gap: 1, '& .MuiButton-root': { minHeight: 44 } }}>
          <Button autoFocus disabled={confirmBusy} onClick={() => setConfirmAction(null)}>
            取消
          </Button>
          <Button
            variant="contained"
            color="error"
            disabled={confirmBusy}
            onClick={async () => {
              if (!confirmAction || confirmBusy) return
              setConfirmBusy(true)
              try {
                await confirmAction.run()
                setConfirmAction(null)
              } finally {
                setConfirmBusy(false)
              }
            }}
          >
            {confirmBusy ? '處理中…' : '確認'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
