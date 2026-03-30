import { useState, useEffect, useRef, useCallback, FormEvent, KeyboardEvent } from 'react';
import { Box, TextField, IconButton, InputAdornment, CircularProgress, Paper, List, ListItemButton, ListItemIcon, ListItemText } from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import ClearIcon from '@mui/icons-material/Clear';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import HistoryIcon from '@mui/icons-material/History';
import apiService from '../../services/api.service';

interface SearchBarProps {
  onSearch: (query: string) => void;
  loading?: boolean;
}

export default function SearchBar({ onSearch, loading = false }: SearchBarProps) {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // 載入搜尋歷史
  useEffect(() => {
    const saved = localStorage.getItem('recentSearches');
    if (saved) {
      try { setRecentSearches(JSON.parse(saved).slice(0, 5)); } catch {}
    }
  }, []);

  // 保存搜尋歷史
  const saveSearch = useCallback((q: string) => {
    setRecentSearches(prev => {
      const updated = [q, ...prev.filter(s => s !== q)].slice(0, 8);
      localStorage.setItem('recentSearches', JSON.stringify(updated));
      return updated;
    });
  }, []);

  // Debounced YouTube suggestions
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!query.trim() || query.trim().length < 2) {
      setSuggestions([]);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      const results = await apiService.getSearchSuggestions(query.trim());
      setSuggestions(results);
    }, 300);

    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

  // 點擊外部關閉
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      saveSearch(query.trim());
      onSearch(query.trim());
      setShowSuggestions(false);
    }
  };

  const handleSelect = (text: string) => {
    setQuery(text);
    saveSearch(text);
    onSearch(text);
    setShowSuggestions(false);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    const items = displayItems;
    if (!showSuggestions || items.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => (prev + 1) % items.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => (prev - 1 + items.length) % items.length);
    } else if (e.key === 'Enter' && selectedIndex >= 0) {
      e.preventDefault();
      handleSelect(items[selectedIndex].text);
    } else if (e.key === 'Escape') {
      setShowSuggestions(false);
    }
  };

  const handleClear = () => {
    setQuery('');
    setSuggestions([]);
    inputRef.current?.focus();
  };

  // 合併顯示項目：有輸入時用 YouTube suggestions，沒輸入時用搜尋歷史
  const displayItems = query.trim().length >= 2 && suggestions.length > 0
    ? suggestions.map(s => ({ text: s, type: 'suggestion' as const }))
    : !query.trim() && recentSearches.length > 0
      ? recentSearches.map(s => ({ text: s, type: 'history' as const }))
      : [];

  return (
    <Box ref={containerRef} sx={{ width: '100%', maxWidth: 800, position: 'relative' }}>
      <Box component="form" onSubmit={handleSubmit}>
        <TextField
          fullWidth
          inputRef={inputRef}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setSelectedIndex(-1); }}
          onFocus={() => setShowSuggestions(true)}
          onKeyDown={handleKeyDown}
          placeholder="搜尋音樂..."
          variant="outlined"
          disabled={loading}
          autoComplete="off"
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon />
              </InputAdornment>
            ),
            endAdornment: (
              <InputAdornment position="end">
                {loading ? (
                  <CircularProgress size={24} />
                ) : query ? (
                  <IconButton onClick={handleClear} edge="end" size="small">
                    <ClearIcon />
                  </IconButton>
                ) : null}
              </InputAdornment>
            ),
          }}
        />
      </Box>

      {/* Autocomplete dropdown */}
      {showSuggestions && displayItems.length > 0 && (
        <Paper
          elevation={8}
          sx={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            zIndex: 1300,
            mt: 0.5,
            maxHeight: 400,
            overflow: 'auto',
            borderRadius: 2,
          }}
        >
          <List dense disablePadding>
            {displayItems.map((item, i) => (
              <ListItemButton
                key={`${item.type}-${i}`}
                selected={i === selectedIndex}
                onClick={() => handleSelect(item.text)}
                sx={{ py: 1 }}
              >
                <ListItemIcon sx={{ minWidth: 36 }}>
                  {item.type === 'history' ? (
                    <HistoryIcon fontSize="small" sx={{ opacity: 0.6 }} />
                  ) : (
                    <TrendingUpIcon fontSize="small" sx={{ opacity: 0.6 }} />
                  )}
                </ListItemIcon>
                <ListItemText
                  primary={item.text}
                  primaryTypographyProps={{ noWrap: true }}
                />
              </ListItemButton>
            ))}
          </List>
        </Paper>
      )}
    </Box>
  );
}
