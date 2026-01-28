# Home Media 穩定性優化計畫

## 問題總覽

根據深度程式碼分析，發現以下三大類問題：

| 類別 | 關鍵問題數 | 嚴重度 |
|------|-----------|--------|
| 播放器（無聲音/停止） | 8 | 🔴 高 |
| 歌詞服務（獲取失敗） | 6 | 🟡 中 |
| 電台同步（聽眾體驗差） | 10 | 🔴 高 |

---

## 一、播放器問題分析

### 1.1 最常導致無聲音的情況

| 原因 | 發生機率 | 檔案位置 |
|------|---------|---------|
| 手機瀏覽器音訊事件不觸發 | 高 | AudioPlayer.tsx:207-235 |
| YouTube 連線中斷（ECONNRESET） | 中 | youtube.controller.ts:173-177 |
| 假播放（進度條動但無聲） | 中 | AudioPlayer.tsx:465-477 |
| 自動播放被瀏覽器阻擋 | 低 | AudioPlayer.tsx:198-204 |
| displayMode 切換狀態不同步 | 低 | AudioPlayer.tsx:355-358 |

### 1.2 關鍵問題詳解

#### 問題 A：音訊事件 5 秒超時強制播放
```
現況：等待 canplay/canplaythrough 事件，5 秒後強制確認
問題：網路慢時音訊未準備好就開始播放 → 無聲音
```

#### 問題 B：YouTube 403 只重試 1 次
```
現況：URL 過期收到 403 後只重試 1 次
問題：IP 被封鎖時無法恢復，且沒有指數退避
```

#### 問題 C：假播放恢復策略不足
```
現況：5 秒檢查一次，嘗試 seek 恢復
問題：seek 不一定能恢復，需要多種策略
```

#### 問題 D：兩層快取邏輯複雜
```
前端：IndexedDB（2GB、200首、30天）
後端：檔案系統快取
問題：同步複雜、容易不一致、前端快取可能過期但 UI 顯示為已快取
```

### 1.3 播放器優化建議

#### 🔴 P0 - 立即修復

**1. 改進音訊事件超時機制**
```typescript
// AudioPlayer.tsx
// 舊：5 秒後強制確認
// 新：10 秒 + 檢查 readyState
fallbackTimeoutId = setTimeout(() => {
  if (!hasConfirmed && audio.readyState >= 2) {
    confirmAndPlay('force-timeout');
  } else if (audio.readyState < 2) {
    // 再等 5 秒
    setTimeout(() => confirmAndPlay('delayed-check'), 5000);
  }
}, 10000);
```

**2. 後端重試機制改進**
```typescript
// youtube.controller.ts
const RETRY_DELAYS = [1000, 3000, 5000]; // 指數退避
const MAX_RETRIES = 3;

// 403 和網路錯誤都重試
if ((status === 403 || isNetworkError) && retryCount < MAX_RETRIES) {
  setTimeout(() => attemptStream(retryCount + 1), RETRY_DELAYS[retryCount]);
}
```

**3. 假播放多策略恢復**
```typescript
// AudioPlayer.tsx
const recoveryStrategies = [
  () => { audio.currentTime = audio.currentTime; audio.play(); },
  () => { audio.pause(); setTimeout(() => audio.play(), 100); },
  () => { const src = audio.src; audio.src = ''; audio.src = src; audio.play(); }
];

// 依序嘗試每個策略
for (const strategy of recoveryStrategies) {
  try { await strategy(); break; } catch {}
}
```

**4. 修復 displayMode 狀態同步**
```typescript
// AudioPlayer.tsx
useEffect(() => {
  if (displayMode === 'video') {
    audioRef.current?.pause();
    dispatch(setIsPlaying(false)); // 同步更新 Redux
  }
}, [displayMode]);
```

---

## 二、歌詞服務問題分析

### 2.1 歌詞獲取失敗原因

| 原因 | 嚴重度 | 檔案位置 |
|------|--------|---------|
| 無重試機制 | 🔴 高 | lyrics.service.ts:99-112 |
| 超時設定不統一 | 🟡 中 | 各處 15-30 秒不等 |
| 搜尋關鍵字處理不完善 | 🟡 中 | lyrics.service.ts:570-606 |
| Unicode 正規化缺失 | 🟡 中 | cleanSongTitle() |
| 多語言標題處理差 | 🟠 低 | 搜尋邏輯 |

### 2.2 歌詞來源優先級

```
1️⃣  快取（SQLite）
2️⃣  YouTube CC（yt-dlp）
3️⃣  網易雲音樂（華語最全）
4️⃣  LRCLIB（時間戳最準）
5️⃣  Genius（無時間戳）
```

### 2.3 歌詞服務優化建議

#### 🔴 P0 - 立即修復

**1. 加入指數退避重試**
```typescript
// lyrics.service.ts
async function retryWithBackoff<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T | null> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch {
      const delay = 1000 * Math.pow(2, i) + Math.random() * 1000;
      await new Promise(r => setTimeout(r, delay));
    }
  }
  return null;
}
```

**2. 統一超時配置**
```typescript
const TIMEOUTS = {
  YT_DLP: 45000,      // yt-dlp 首次較慢
  NETEASE: 30000,     // 網易雲
  LRCLIB: 25000,      // LRCLIB
  GENIUS: 20000,      // Genius
};
```

**3. 加入 Unicode 正規化**
```typescript
private cleanSongTitle(title: string): string {
  title = title.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  title = title.replace(/[【】]/g, '[]').replace(/[《》]/g, '<>');
  title = title.replace(/[\u200b\u200c\u200d]/g, ''); // 移除零寬字符
  // ... 現有邏輯
}
```

#### 🟡 P1 - 重要改進

**4. 搜尋結果相似度評分**
```typescript
private scoreSongMatch(song: SongResult, title: string, artist?: string): number {
  const titleSimilarity = this.calculateSimilarity(song.name, title);
  const artistSimilarity = artist ? this.calculateSimilarity(song.artist, artist) : 0;
  return titleSimilarity * 0.7 + artistSimilarity * 0.3;
}

// 選擇最匹配的結果
const bestMatch = results.sort((a, b) =>
  scoreSongMatch(b, title, artist) - scoreSongMatch(a, title, artist)
)[0];
```

**5. 並行化歌詞來源查詢**
```typescript
async getLyricsOptimized() {
  // 快速來源並行
  const [youtube, netease] = await Promise.allSettled([
    this.fetchYouTubeCaptions(videoId),
    this.fetchNeteaseLyrics(title, artist),
  ]);

  if (youtube.status === 'fulfilled' && youtube.value) return youtube.value;
  if (netease.status === 'fulfilled' && netease.value) return netease.value;

  // 慢速來源
  // ...
}
```

---

## 三、電台同步問題分析

### 3.1 聽眾體驗差的原因

| 原因 | 嚴重度 | 影響 |
|------|--------|------|
| pendingTrack 未確認 | 🔴 高 | 聽眾卡在載入中無法播放 |
| 時間同步間隔 5 秒 | 🔴 高 | 與主播進度差可達 5+ 秒 |
| 曲目切換競態條件 | 🔴 高 | 可能播放錯誤曲目 |
| 無載入超時機制 | 🟡 中 | 載入失敗無法恢復 |
| 聽眾斷線無重連機制 | 🟡 中 | 網路抖動被踢出 |
| 主播寬限期 30 秒太長 | 🟡 中 | 等待太久才知道掉線 |
| 無延遲補償 | 🟠 低 | 實時同步不夠精確 |

### 3.2 同步機制現況

```
主播端：
- 每 5 秒發送 time-sync
- 曲目變更立即發送 track-change
- 播放/暫停立即發送 play-state

聽眾端：
- 收到 sync → 檢查 3 個條件 → seekTo
- 條件：不在載入中、冷卻 5 秒、時間差 > 3 秒
```

### 3.3 電台優化建議

#### 🔴 P0 - 立即修復

**1. 修復 confirmPendingTrack 機制**
```typescript
// useRadioSync.ts - 聽眾端載入完成後確認
useEffect(() => {
  if (isListener && pendingTrack && !isLoadingTrack) {
    dispatch(confirmPendingTrack());
  }
}, [isListener, pendingTrack, isLoadingTrack]);
```

**2. 加入載入超時機制**
```typescript
// playerSlice.ts
const LOAD_TIMEOUT_MS = 15000;

setPendingTrack(state, action) {
  state.pendingTrack = action.payload;
  state.isLoadingTrack = true;

  // 設定超時
  state.loadTimeout = setTimeout(() => {
    dispatch(cancelPendingTrack());
    dispatch(showError('載入超時，請重試'));
  }, LOAD_TIMEOUT_MS);
}
```

**3. 縮短時間同步間隔**
```typescript
// useRadioSync.ts
// 主播端：改為 3 秒
setInterval(() => socketService.radioTimeSync(currentTime), 3000);

// 聽眾端：容忍度改為 2 秒
const timeDiff = Math.abs(currentTime - syncTime);
if (timeDiff > 2) {
  dispatch(seekTo(syncTime));
}

// 冷卻時間改為 3 秒
const syncCooldownMs = 3000;
```

**4. 解決曲目切換競態條件**
```typescript
// 使用版本號區分同步批次
interface RadioSyncPayload {
  syncVersion: number; // 時間戳或遞增計數器
  type: 'track-change' | 'play-state' | 'time-sync';
  // ...
}

// 聽眾端檢查版本
if (syncVersion < lastProcessedVersion) return; // 丟棄舊事件
```

#### 🟡 P1 - 重要改進

**5. 縮短主播寬限期 + 倒計時通知**
```typescript
// radio.service.ts
const GRACE_PERIOD_MS = 10000; // 改為 10 秒

// 每 2 秒通知剩餘時間
const warningInterval = setInterval(() => {
  io.to(`radio:${station.id}`).emit('radio:host-disconnected', {
    stationId: station.id,
    remainingSeconds: Math.ceil(remaining / 1000),
  });
}, 2000);
```

**6. 加入聽眾斷線重連機制**
```typescript
// radio.service.ts
// 聽眾也有 30 秒寬限期
private listenerGracePeriod = new Map<string, NodeJS.Timeout>();

handleListenerDisconnect(socketId: string) {
  const timer = setTimeout(() => {
    this.removeListener(socketId);
  }, 30000);
  this.listenerGracePeriod.set(socketId, timer);
}
```

**7. 加入 RTT 延遲補償**
```typescript
// socket.service.ts
private rtt = 0;

measureRTT() {
  const start = Date.now();
  this.socket?.emit('ping', {}, () => {
    this.rtt = (Date.now() - start) / 2;
  });
}

// 聽眾端補償
const compensatedTime = syncTime + (rtt / 1000);
```

---

## 四、實施優先級

### Phase 1 - 緊急修復（1-2 天）

| 項目 | 檔案 | 預估時間 |
|------|------|---------|
| 音訊事件超時改進 | AudioPlayer.tsx | 2h |
| 後端重試機制 | youtube.controller.ts | 2h |
| 假播放多策略恢復 | AudioPlayer.tsx | 1h |
| 歌詞重試機制 | lyrics.service.ts | 2h |
| 電台 confirmPendingTrack | useRadioSync.ts | 1h |
| 電台載入超時 | playerSlice.ts | 1h |

### Phase 2 - 重要改進（3-5 天）

| 項目 | 檔案 | 預估時間 |
|------|------|---------|
| displayMode 狀態同步 | AudioPlayer.tsx | 2h |
| 歌詞 Unicode 正規化 | lyrics.service.ts | 2h |
| 歌詞相似度評分 | lyrics.service.ts | 4h |
| 電台時間同步優化 | useRadioSync.ts | 3h |
| 電台競態條件修復 | radio.handler.ts, useRadioSync.ts | 4h |
| 主播寬限期 + 倒計時 | radio.service.ts | 2h |

### Phase 3 - 優化提升（持續）

| 項目 | 檔案 | 預估時間 |
|------|------|---------|
| 前端快取策略優化 | audio-cache.service.ts | 4h |
| 歌詞並行查詢 | lyrics.service.ts | 3h |
| 電台延遲補償 | socket.service.ts, useRadioSync.ts | 4h |
| 聽眾斷線重連 | radio.service.ts | 3h |
| 播放器診斷工具 | 新增 diagnostics.ts | 4h |

---

## 五、測試重點

### 播放器測試

- [ ] 網路慢時能否正常播放
- [ ] YouTube 403 後能否自動恢復
- [ ] 假播放能否被檢測並恢復
- [ ] 音訊/影片模式切換是否同步
- [ ] 手機瀏覽器自動播放

### 歌詞測試

- [ ] 網路超時後重試
- [ ] 中文/日文/英文歌曲搜尋
- [ ] 特殊字符標題處理
- [ ] 快取一致性

### 電台測試

- [ ] 聽眾加入後能否正常播放
- [ ] 主播快速切歌時聽眾是否同步
- [ ] 主播斷線後聽眾體驗
- [ ] 聽眾網路抖動後能否恢復
- [ ] 多聽眾同時加入

---

## 六、檔案索引

### 播放器相關
- `frontend/src/components/Player/AudioPlayer.tsx` - 核心播放邏輯
- `frontend/src/store/playerSlice.ts` - 播放器狀態
- `backend/src/controllers/youtube.controller.ts` - 音訊代理
- `backend/src/services/audio-cache.service.ts` - 後端快取

### 歌詞相關
- `backend/src/services/lyrics.service.ts` - 歌詞核心邏輯
- `backend/src/controllers/lyrics.controller.ts` - API 端點
- `frontend/src/components/Player/LyricsView.tsx` - 歌詞顯示
- `frontend/src/services/lyrics-cache.service.ts` - 前端快取

### 電台相關
- `frontend/src/hooks/useRadioSync.ts` - 同步邏輯
- `frontend/src/hooks/useRadio.ts` - 電台操作
- `backend/src/handlers/radio.handler.ts` - Socket 處理
- `backend/src/services/radio.service.ts` - 電台服務
