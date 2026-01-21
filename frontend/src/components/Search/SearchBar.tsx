import { useState, FormEvent } from 'react';
import { Box, TextField, IconButton, InputAdornment, CircularProgress } from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import ClearIcon from '@mui/icons-material/Clear';

interface SearchBarProps {
  onSearch: (query: string) => void;
  loading?: boolean;
}

export default function SearchBar({ onSearch, loading = false }: SearchBarProps) {
  const [query, setQuery] = useState('');

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      onSearch(query.trim());
    }
  };

  const handleClear = () => {
    setQuery('');
  };

  return (
    <Box component="form" onSubmit={handleSubmit} sx={{ width: '100%', maxWidth: 800 }}>
      <TextField
        fullWidth
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="搜尋音樂... (例如: 周杰倫 晴天)"
        variant="outlined"
        disabled={loading}
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
  );
}
