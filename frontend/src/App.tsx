import { Box, Container, Typography } from '@mui/material';
import { useEffect, useState } from 'react';

function App() {
  const [apiStatus, setApiStatus] = useState<string>('Checking...');

  useEffect(() => {
    // 測試後端連接
    fetch('/api')
      .then(res => res.json())
      .then(data => {
        setApiStatus(`✅ ${data.message} - v${data.version}`);
      })
      .catch(() => {
        setApiStatus('❌ Backend connection failed');
      });
  }, []);

  return (
    <Container maxWidth="lg">
      <Box
        sx={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          textAlign: 'center',
        }}
      >
        <Typography variant="h2" component="h1" gutterBottom>
          🎵 家用多媒體中心
        </Typography>

        <Typography variant="h5" color="text.secondary" paragraph>
          Home Media Center
        </Typography>

        <Box sx={{ mt: 4 }}>
          <Typography variant="body1" paragraph>
            {apiStatus}
          </Typography>

          <Typography variant="body2" color="text.secondary">
            專案基礎設施已就緒！
          </Typography>
        </Box>

        <Box sx={{ mt: 4, textAlign: 'left' }}>
          <Typography variant="h6" gutterBottom>
            ✨ 即將推出的功能：
          </Typography>
          <Typography variant="body2" component="div">
            • YouTube 音樂搜尋與播放<br/>
            • 無廣告音訊串流<br/>
            • 同步歌詞滾動<br/>
            • 即時音訊視覺化<br/>
            • 曲風主題自動切換<br/>
            • 播放清單管理<br/>
            • 智慧快取系統<br/>
            • 跨平台遠端控制
          </Typography>
        </Box>
      </Box>
    </Container>
  );
}

export default App;
