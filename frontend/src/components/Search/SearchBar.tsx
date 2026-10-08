import { useState, useEffect, useRef, useCallback, useId, FormEvent, KeyboardEvent } from 'react'
import {
  Box,
  TextField,
  IconButton,
  InputAdornment,
  CircularProgress,
  Paper,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Button,
  Typography,
} from '@mui/material'
import SearchIcon from '@mui/icons-material/Search'
import ClearIcon from '@mui/icons-material/Clear'
import TrendingUpIcon from '@mui/icons-material/TrendingUp'
import HistoryIcon from '@mui/icons-material/History'
import apiService from '../../services/api.service'

interface SearchBarProps {
  onSearch: (query: string) => void
  query?: string
  onCancel?: () => void
  onClear?: () => void
  loading?: boolean
}

export default function SearchBar({
  onSearch,
  onCancel,
  onClear,
  loading = false,
  query: routeQuery = '',
}: SearchBarProps) {
  const [query, setQuery] = useState(routeQuery)
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(-1)
  const [recentSearches, setRecentSearches] = useState<string[]>([])
  const requestIdRef = useRef(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listId = useId()

  useEffect(() => {
    setQuery(routeQuery)
    setSelectedIndex(-1)
    setShowSuggestions(false)
  }, [routeQuery])

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('recentSearches') || '[]')
      if (Array.isArray(saved))
        setRecentSearches(
          saved.filter((value): value is string => typeof value === 'string').slice(0, 5)
        )
    } catch {
      /* Search remains available when local storage is unavailable. */
    }
  }, [])

  const saveSearch = useCallback((q: string) => {
    setRecentSearches((prev) => {
      const updated = [q, ...prev.filter((s) => s !== q)].slice(0, 8)
      try {
        localStorage.setItem('recentSearches', JSON.stringify(updated))
      } catch {
        /* Optional history. */
      }
      return updated
    })
  }, [])

  useEffect(() => {
    const requestId = ++requestIdRef.current
    setSuggestions([])
    setSelectedIndex(-1)
    if (query.trim().length < 2) return
    const timeout = setTimeout(async () => {
      const results = await apiService.getSearchSuggestions(query.trim())
      if (requestId === requestIdRef.current) setSuggestions(results)
    }, 300)
    return () => {
      clearTimeout(timeout)
      requestIdRef.current += 1
    }
  }, [query])

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node))
        setShowSuggestions(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const search = (text: string) => {
    const value = text.trim()
    if (!value) return
    setQuery(value)
    saveSearch(value)
    setShowSuggestions(false)
    setSelectedIndex(-1)
    onSearch(value)
  }

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    search(query)
  }

  const displayItems =
    query.trim().length >= 2 && suggestions.length > 0
      ? suggestions.map((text) => ({ text, type: 'suggestion' as const }))
      : !query.trim()
        ? recentSearches.map((text) => ({ text, type: 'history' as const }))
        : []
  const expanded = showSuggestions && displayItems.length > 0

  const handleKeyDown = (e: KeyboardEvent) => {
    // Adornment buttons have their own Enter/Space behavior; their events bubble here.
    if (e.target !== inputRef.current) return
    // IME Enter confirms a character, not the search form or a suggestion.
    if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) {
      if (e.key === 'Enter') e.preventDefault()
      return
    }
    if (e.key === 'Escape') {
      setShowSuggestions(false)
      setSelectedIndex(-1)
      if (!expanded && loading) onCancel?.()
      return
    }
    if (!displayItems.length) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setShowSuggestions(true)
      setSelectedIndex((prev) =>
        e.key === 'ArrowDown'
          ? (prev + 1) % displayItems.length
          : prev <= 0
            ? displayItems.length - 1
            : prev - 1
      )
    } else if (e.key === 'Enter' && expanded && selectedIndex >= 0 && displayItems[selectedIndex]) {
      e.preventDefault()
      search(displayItems[selectedIndex].text)
    }
  }

  const handleClear = () => {
    requestIdRef.current += 1
    setQuery('')
    setSuggestions([])
    setSelectedIndex(-1)
    if (onClear) onClear()
    else if (loading) onCancel?.()
    inputRef.current?.focus()
  }

  return (
    <Box ref={containerRef} sx={{ width: '100%', minWidth: 0, position: 'relative' }}>
      <Box
        component="form"
        role="search"
        aria-label="音樂搜尋"
        onSubmit={handleSubmit}
        sx={{ display: 'flex', alignItems: 'center', gap: 1 }}
      >
        <TextField
          fullWidth
          inputRef={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setSelectedIndex(-1)
            setShowSuggestions(true)
          }}
          onFocus={() => setShowSuggestions(true)}
          onBlur={(e) => {
            if (!containerRef.current?.contains(e.relatedTarget as Node)) setShowSuggestions(false)
          }}
          onKeyDown={handleKeyDown}
          placeholder="想聽什麼？搜尋歌曲或歌手"
          autoComplete="off"
          sx={{
            minWidth: 0,
            '& .MuiInputBase-root': { minHeight: 52 },
            '& input': { fontSize: 16, py: 1.5, minWidth: 0 },
          }}
          inputProps={{
            role: 'combobox',
            'aria-label': '搜尋歌曲或歌手',
            'aria-autocomplete': 'list',
            'aria-expanded': expanded,
            'aria-controls': expanded ? listId : undefined,
            'aria-activedescendant':
              expanded && selectedIndex >= 0 ? `${listId}-${selectedIndex}` : undefined,
          }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon sx={{ color: 'text.secondary' }} />
              </InputAdornment>
            ),
            endAdornment: query ? (
              <InputAdornment position="end">
                <IconButton
                  aria-label="清除搜尋文字"
                  title="清除搜尋文字"
                  onClick={handleClear}
                  edge="end"
                  sx={{ width: 44, height: 44 }}
                >
                  <ClearIcon fontSize="small" />
                </IconButton>
              </InputAdornment>
            ) : undefined,
          }}
        />
        <IconButton
          type="submit"
          aria-label="搜尋"
          title="搜尋"
          disabled={!query.trim()}
          sx={{
            width: 52,
            height: 52,
            flexShrink: 0,
            bgcolor: 'primary.main',
            color: 'primary.contrastText',
            borderRadius: 2,
            '&:hover': { bgcolor: 'primary.light' },
            '&.Mui-disabled': { bgcolor: 'action.disabledBackground' },
          }}
        >
          <SearchIcon />
        </IconButton>
      </Box>
      {loading && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1, minHeight: 44 }}>
          <CircularProgress size={16} aria-label="搜尋中" />
          <Typography role="status" variant="body2" color="text.secondary" sx={{ flex: 1 }}>
            正在搜尋，可繼續輸入
          </Typography>
          {onCancel && (
            <Button onClick={onCancel} size="small" sx={{ minHeight: 44, flexShrink: 0 }}>
              取消搜尋
            </Button>
          )}
        </Box>
      )}
      {expanded && (
        <Paper
          sx={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            zIndex: 10,
            mt: 1,
            maxHeight: 'min(360px, 45dvh)',
            overflowY: 'auto',
            border: 1,
            borderColor: 'divider',
            boxShadow: 6,
          }}
        >
          <List
            id={listId}
            role="listbox"
            aria-label={query.trim() ? '搜尋建議' : '最近搜尋'}
            disablePadding
          >
            {displayItems.map((item, i) => (
              <ListItemButton
                key={`${item.type}-${item.text}-${i}`}
                id={`${listId}-${i}`}
                component="li"
                role="option"
                aria-selected={i === selectedIndex}
                tabIndex={-1}
                selected={i === selectedIndex}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => search(item.text)}
                sx={{ minHeight: 48, px: 2, py: 1 }}
              >
                <ListItemIcon sx={{ minWidth: 32, color: 'text.secondary' }}>
                  {item.type === 'history' ? (
                    <HistoryIcon fontSize="small" />
                  ) : (
                    <TrendingUpIcon fontSize="small" />
                  )}
                </ListItemIcon>
                <ListItemText
                  primary={item.text}
                  primaryTypographyProps={{ fontSize: 14, noWrap: true }}
                />
              </ListItemButton>
            ))}
          </List>
        </Paper>
      )}
    </Box>
  )
}
