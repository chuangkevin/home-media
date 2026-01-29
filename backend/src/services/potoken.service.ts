/**
 * PoToken 服務
 * 用於生成 YouTube Proof of Origin Token，繞過機器人偵測
 *
 * PoToken 是 YouTube 用來驗證請求來源的安全參數
 * 沒有它，某些客戶端的請求會收到 HTTP 403 錯誤
 */

import logger from '../utils/logger';
import config from '../config/environment';

interface PoTokenData {
  visitorData: string;
  poToken: string;
  generatedAt: number;
}

class PoTokenService {
  private cachedToken: PoTokenData | null = null;
  private isGenerating: boolean = false;
  private generatePromise: Promise<PoTokenData> | null = null;

  // Token 有效期（預設 30 分鐘，保守估計）
  private readonly TOKEN_TTL = 30 * 60 * 1000;

  // 重試設定
  private readonly MAX_RETRIES = 3;
  private readonly RETRY_DELAY = 2000;

  constructor() {
    if (config.youtube?.poTokenEnabled) {
      logger.info('🔐 PoToken 服務已初始化（已啟用）');
    } else {
      logger.info('🔐 PoToken 服務已初始化（已停用，可透過 YOUTUBE_POTOKEN_ENABLED=true 啟用）');
    }
  }

  /**
   * 檢查 PoToken 功能是否啟用
   */
  isEnabled(): boolean {
    return config.youtube?.poTokenEnabled ?? true;
  }

  /**
   * 獲取有效的 PoToken
   * 如果快取有效則返回快取，否則生成新的
   */
  async getToken(): Promise<PoTokenData | null> {
    // 檢查是否啟用
    if (!this.isEnabled()) {
      logger.debug('PoToken 功能已停用');
      return null;
    }

    // 檢查快取是否有效
    if (this.cachedToken && this.isTokenValid(this.cachedToken)) {
      const ageMinutes = Math.floor((Date.now() - this.cachedToken.generatedAt) / 1000 / 60);
      logger.debug(`✅ 使用快取的 PoToken (已生成 ${ageMinutes} 分鐘)`);
      return this.cachedToken;
    }

    // 如果正在生成，等待現有的 Promise
    if (this.isGenerating && this.generatePromise) {
      logger.debug('⏳ 等待 PoToken 生成中...');
      return this.generatePromise;
    }

    // 生成新的 Token
    return this.generateToken();
  }

  /**
   * 強制重新生成 Token
   */
  async refreshToken(): Promise<PoTokenData | null> {
    this.cachedToken = null;
    return this.generateToken();
  }

  /**
   * 生成新的 PoToken
   */
  private async generateToken(): Promise<PoTokenData | null> {
    this.isGenerating = true;

    this.generatePromise = this.doGenerateToken();

    try {
      const token = await this.generatePromise;
      this.cachedToken = token;
      return token;
    } catch (error) {
      logger.error('❌ PoToken 生成失敗:', error);
      return null;
    } finally {
      this.isGenerating = false;
      this.generatePromise = null;
    }
  }

  /**
   * 實際執行 Token 生成（含重試機制）
   */
  private async doGenerateToken(): Promise<PoTokenData> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
      try {
        logger.info(`🔄 正在生成 PoToken (嘗試 ${attempt}/${this.MAX_RETRIES})...`);
        const startTime = Date.now();

        // 動態載入 youtube-po-token-generator
        // 使用動態 import 避免啟動時就載入
        const { generate } = await import('youtube-po-token-generator');
        const result = await generate();

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

        if (!result.visitorData || !result.poToken) {
          throw new Error('生成結果缺少必要欄位');
        }

        const tokenData: PoTokenData = {
          visitorData: result.visitorData,
          poToken: result.poToken,
          generatedAt: Date.now(),
        };

        logger.info(`✅ PoToken 生成成功 (耗時 ${elapsed}秒)`);
        logger.debug(`   visitorData: ${tokenData.visitorData.substring(0, 20)}...`);
        logger.debug(`   poToken: ${tokenData.poToken.substring(0, 20)}...`);

        return tokenData;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        logger.warn(`⚠️ PoToken 生成失敗 (嘗試 ${attempt}/${this.MAX_RETRIES}): ${lastError.message}`);

        if (attempt < this.MAX_RETRIES) {
          await this.sleep(this.RETRY_DELAY * attempt);
        }
      }
    }

    throw lastError || new Error('PoToken 生成失敗（未知錯誤）');
  }

  /**
   * 檢查 Token 是否仍然有效
   */
  private isTokenValid(token: PoTokenData): boolean {
    const age = Date.now() - token.generatedAt;
    return age < this.TOKEN_TTL;
  }

  /**
   * 獲取 yt-dlp 的 extractor-args 格式
   */
  async getYtDlpArgs(): Promise<string | null> {
    const token = await this.getToken();
    if (!token) {
      return null;
    }

    // 格式：youtube:po_token=web.gvs+TOKEN;visitor_data=DATA
    return `youtube:po_token=web.gvs+${token.poToken};visitor_data=${token.visitorData}`;
  }

  /**
   * 獲取快取狀態
   */
  getStatus(): { hasCachedToken: boolean; tokenAge: number | null; isGenerating: boolean } {
    return {
      hasCachedToken: this.cachedToken !== null && this.isTokenValid(this.cachedToken),
      tokenAge: this.cachedToken ? Date.now() - this.cachedToken.generatedAt : null,
      isGenerating: this.isGenerating,
    };
  }

  /**
   * 清除快取
   */
  clearCache(): void {
    this.cachedToken = null;
    logger.info('🗑️ PoToken 快取已清除');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export default new PoTokenService();
