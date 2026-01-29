import { Box, Typography, Container } from '@mui/material';
import SettingsIcon from '@mui/icons-material/Settings';
import CacheManagementSection from './CacheManagementSection';

const SettingsPage: React.FC = () => {
  return (
    <Container maxWidth="md" sx={{ py: 3 }}>
      <Box sx={{ mb: 4 }}>
        <Typography variant="h4" sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          <SettingsIcon />
          系統設定
        </Typography>
        <Typography variant="body1" color="text.secondary">
          管理應用程式的設定和快取。
        </Typography>
      </Box>

      <CacheManagementSection />
    </Container>
  );
};

export default SettingsPage;
