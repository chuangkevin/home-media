import { Box, Typography, Container } from '@mui/material'
import SettingsIcon from '@mui/icons-material/Settings'
import CacheManagementSection from './CacheManagementSection'

const SettingsPage: React.FC = () => {
  return (
    <Container maxWidth="md" sx={{ minWidth: 0, py: { xs: 2, sm: 3 }, px: { xs: 2, sm: 3 } }}>
      <Box component="header" sx={{ mb: 3, pb: 3, borderBottom: 1, borderColor: 'divider' }}>
        <Typography
          component="h1"
          variant="h4"
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1.5,
            mb: 1,
            fontSize: { xs: 24, sm: 28 },
            lineHeight: 1.4,
          }}
        >
          <SettingsIcon sx={{ color: 'primary.main', fontSize: 28, flexShrink: 0 }} />
          系統設定
        </Typography>
        <Typography variant="body1" color="text.secondary" sx={{ fontSize: 14, lineHeight: 1.7 }}>
          查看本機與伺服器的快取，管理已儲存的音訊和歌詞。
        </Typography>
      </Box>

      <CacheManagementSection />
    </Container>
  )
}

export default SettingsPage
