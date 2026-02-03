import cors from 'cors';
import config from '../config/environment';

export const corsMiddleware = cors({
  origin: (origin, callback) => {
    // 允許無 origin 的請求（例如：mobile apps, curl）
    if (!origin) return callback(null, true);

    // 檢查是否使用萬用字元 '*' 允許所有來源
    const allowAll = config.cors.allowedOrigins.includes('*');

    // 開發環境允許所有 localhost 來源（5173, 5174, 3001 等）
    const isLocalhost = origin.includes('localhost') || origin.includes('127.0.0.1') || origin.includes('[::1]');
    
    if (allowAll || config.cors.allowedOrigins.includes(origin) || config.env === 'development' || isLocalhost) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
});
