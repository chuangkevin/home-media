/**
 * 測試 Range 請求是否正常工作
 */

async function testRangeRequest() {
  const videoId = 'n-hy9MswmcA'; // 使用快取中的一個 video ID
  const streamUrl = `http://localhost:3001/api/stream/${videoId}`;

  console.log('🧪 開始測試 Range 請求...\n');

  try {
    // 1. 先取得完整檔案大小
    console.log('1️⃣ 獲取檔案信息...');
    const headResponse = await fetch(streamUrl, {
      method: 'HEAD',
    });

    if (!headResponse.ok) {
      console.error('❌ HEAD 請求失敗:', headResponse.status);
      return;
    }

    const contentLength = headResponse.headers.get('Content-Length');
    const acceptRanges = headResponse.headers.get('Accept-Ranges');
    
    console.log(`✅ 檔案大小: ${contentLength} bytes (${(parseInt(contentLength) / 1024 / 1024).toFixed(2)} MB)`);
    console.log(`✅ Accept-Ranges: ${acceptRanges}`);
    console.log();

    // 2. 測試 Range 請求（只取前 1MB）
    console.log('2️⃣ 測試 Range 請求 (bytes=0-1048575)...');
    const rangeResponse = await fetch(streamUrl, {
      headers: {
        'Range': 'bytes=0-1048575',
      },
    });

    console.log(`✅ 狀態碼: ${rangeResponse.status}`);
    console.log(`✅ Content-Range: ${rangeResponse.headers.get('Content-Range')}`);
    console.log(`✅ Content-Length: ${rangeResponse.headers.get('Content-Length')}`);
    
    if (rangeResponse.status === 206) {
      console.log('✅ 部分內容請求成功 (206 Partial Content)');
      const chunk = await rangeResponse.blob();
      console.log(`✅ 接收到 ${chunk.size} bytes`);
    } else if (rangeResponse.status === 200) {
      console.log('⚠️ 收到完整檔案而非部分內容 (200 OK)');
    } else {
      console.error(`❌ 意外的狀態碼: ${rangeResponse.status}`);
    }
    console.log();

    // 3. 測試多個 Range 請求（模擬尋找位置）
    console.log('3️⃣ 測試多個 Range 請求（模擬進度條拖曳）...');
    const fileSize = parseInt(contentLength);
    const positions = [
      { start: 0, end: 1048575, label: '起始' },
      { start: Math.floor(fileSize / 2), end: Math.floor(fileSize / 2) + 1048575, label: '中間' },
      { start: Math.max(0, fileSize - 1048576), end: fileSize - 1, label: '結尾' },
    ];

    for (const pos of positions) {
      try {
        const res = await fetch(streamUrl, {
          headers: {
            'Range': `bytes=${pos.start}-${pos.end}`,
          },
        });
        console.log(`✅ ${pos.label}: ${res.status} (${res.headers.get('Content-Length')} bytes)`);
      } catch (err) {
        console.error(`❌ ${pos.label}: ${err.message}`);
      }
    }

    console.log('\n✅ 所有測試完成！');

  } catch (error) {
    console.error('❌ 測試失敗:', error);
  }
}

// 運行測試
testRangeRequest();
