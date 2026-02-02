/**
 * 測試音訊元素播放
 */

async function testAudioPlayback() {
  const videoId = 'n-hy9MswmcA';
  const streamUrl = `http://localhost:3001/api/stream/${videoId}`;

  console.log('🧪 開始測試音訊播放...\n');

  // 創建 audio 元素
  const audio = new Audio();
  audio.crossOrigin = 'anonymous';

  // 監聽事件
  const events = {};
  ['loadstart', 'progress', 'loadedmetadata', 'loadeddata', 'canplay', 'canplaythrough', 'play', 'playing', 'pause', 'ended', 'error'].forEach(event => {
    audio.addEventListener(event, () => {
      events[event] = true;
      console.log(`📍 Event: ${event}`);
      console.log(`   readyState: ${audio.readyState}, networkState: ${audio.networkState}`);
      if (audio.duration) {
        console.log(`   duration: ${audio.duration.toFixed(2)}s`);
      }
    });
  });

  audio.addEventListener('error', () => {
    console.error(`❌ 錯誤: ${audio.error?.message}`);
  });

  // 設置音訊源
  console.log(`🔗 設置音訊源: ${streamUrl}\n`);
  audio.src = streamUrl;
  
  // 載入
  audio.load();

  // 等待一段時間
  await new Promise(resolve => setTimeout(resolve, 5000));

  console.log('\n📊 播放状態統計:');
  console.log(`✅ 觸發的事件: ${Object.keys(events).join(', ')}`);
  console.log(`✅ readyState: ${audio.readyState} (0=未初始化, 1=metadata, 2=當前, 3=未來, 4=夠用)`);
  console.log(`✅ networkState: ${audio.networkState} (0=未使用, 1=未激活, 2=下載中, 3=暫停下載)`);
  console.log(`✅ duration: ${audio.duration}s`);
  console.log(`✅ currentTime: ${audio.currentTime}s`);
  console.log(`✅ buffered: ${audio.buffered.length} 段`);
  if (audio.buffered.length > 0) {
    for (let i = 0; i < audio.buffered.length; i++) {
      console.log(`   段 ${i}: ${audio.buffered.start(i).toFixed(2)}s - ${audio.buffered.end(i).toFixed(2)}s`);
    }
  }

  // 嘗試播放
  console.log('\n▶️ 嘗試播放...');
  try {
    const playPromise = audio.play();
    if (playPromise) {
      await playPromise;
      console.log('✅ 播放成功');
      
      // 播放 2 秒後暫停
      await new Promise(resolve => setTimeout(resolve, 2000));
      audio.pause();
      console.log(`✅ 暫停在 ${audio.currentTime.toFixed(2)}s`);

      // 測試尋找位置（模擬拖曳進度條）
      console.log('\n⏩ 測試尋找位置...');
      if (audio.duration) {
        const seekPos = Math.floor(audio.duration / 2);
        console.log(`尋找到 ${seekPos}s...`);
        audio.currentTime = seekPos;
        await new Promise(resolve => setTimeout(resolve, 1000));
        console.log(`✅ 成功尋找到 ${audio.currentTime.toFixed(2)}s`);
      }
    }
  } catch (error) {
    console.error(`❌ 播放失敗: ${error.message}`);
  }

  console.log('\n✅ 音訊播放測試完成！');
}

// 運行測試
testAudioPlayback().catch(console.error);
