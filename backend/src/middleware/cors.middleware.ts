import cors from 'cors';
import config from '../config/environment';

export const corsMiddleware = cors({
  origin: (origin, callback) => {
    // 允許無 origin 的請求（例如：mobile apps, curl）
    if (!origin) return callback(null, true);

    // 檢查是否使用萬用字元 '*' 允許所有來源
    const allowAll = config.cors.allowedOrigins.includes('*');

    if (allowAll || config.cors.allowedOrigins.includes(origin) || config.env === 'development') {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
});
