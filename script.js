// ============================================
// Quiet File Transfer - 音響通信ファイル転送
// ============================================

let currentMode = 'ultrasonic';
let rxMode = 'ultrasonic';
let selectedFile = null;
let fileBase64 = '';
let packets = [];
let sendInterval = null;
let currentPacketIndex = 0;
let transmitter = null;
let receiver = null;
let isSending = false;
let isReceiving = false;

let receivedPackets = {};
let receivedMeta = null;
let totalExpected = 0;

// パケットサイズ設定（Base64後の文字数）
const PACKET_SIZES = {
  ultrasonic: 80,
  audible: 120
};

// Quiet.js 初期化
Quiet.setProfilesPrefix("https://quiet.github.io/quiet-js/profiles/");
Quiet.setLibfecPrefix("https://quiet.github.io/quiet-js/");

function log(id, msg, type='info') {
  const el = document.getElementById(id);
  const span = document.createElement('div');
  span.className = type;
  const time = new Date().toLocaleTimeString('ja-JP', {hour12:false});
  span.textContent = `[${time}] ${msg}`;
  el.appendChild(span);
  el.scrollTop = el.scrollHeight;
}

function switchTab(tab) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  event.target.classList.add('active');
  document.getElementById('panel-' + tab).classList.add('active');
}

function setMode(mode) {
  currentMode = mode;
  document.querySelectorAll('#panel-send .mode-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('mode-' + mode).classList.add('active');
  document.getElementById('pktSize').textContent = PACKET_SIZES[mode];
  if (selectedFile) updatePacketCount();
}

function setRxMode(mode) {
  rxMode = mode;
  document.querySelectorAll('#panel-receive .mode-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('rxmode-' + mode).classList.add('active');
}

function onFileSelected(e) {
  const file = e.target.files[0];
  if (!file) return;
  selectedFile = file;
  
  const info = document.getElementById('fileInfo');
  info.innerHTML = `
    <div class="file-item">
      <div>
        <div class="name">${file.name}</div>
        <div class="size">${formatBytes(file.size)}</div>
      </div>
    </div>
  `;
  
  log('sendLog', `ファイル選択: ${file.name} (${formatBytes(file.size)})`, 'ok');
  
  const reader = new FileReader();
  reader.onload = function(evt) {
    const arrayBuffer = evt.target.result;
    const bytes = new Uint8Array(arrayBuffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    fileBase64 = btoa(binary);
    updatePacketCount();
    document.getElementById('sendBtn').disabled = false;
    log('sendLog', `Base64変換完了: ${fileBase64.length} 文字`, 'ok');
  };
  reader.readAsArrayBuffer(file);
}

function updatePacketCount() {
  const size = PACKET_SIZES[currentMode];
  // ヘッダー分を考慮（実際のペイロードは少し小さく）
  const payloadSize = size - 40; // ヘッダー用に余裕を持たせる
  const count = Math.ceil(fileBase64.length / payloadSize);
  document.getElementById('pktCount').textContent = count;
}

function formatBytes(b) {
  if (b < 1024) return b + ' B';
  if (b < 1024*1024) return (b/1024).toFixed(1) + ' KB';
  return (b/(1024*1024)).toFixed(1) + ' MB';
}

// ============================================
// 送信処理
// ============================================
function buildPackets() {
  const payloadSize = PACKET_SIZES[currentMode] - 40;
  const filename = selectedFile.name;
  const total = Math.ceil(fileBase64.length / payloadSize);
  packets = [];
  
  // メタデータパケット（先頭）
  const meta = {
    type: 'META',
    filename: filename,
    filesize: selectedFile.size,
    total: total,
    mode: currentMode
  };
  packets.push(JSON.stringify(meta));
  
  // データパケット
  for (let i = 0; i < total; i++) {
    const chunk = fileBase64.substring(i * payloadSize, (i + 1) * payloadSize);
    const pkt = {
      type: 'DATA',
      seq: i,
      total: total,
      data: chunk
    };
    packets.push(JSON.stringify(pkt));
  }
  
  // EOFパケット（終了マーカー）
  packets.push(JSON.stringify({type: 'EOF'}));
  
  log('sendLog', `パケット生成完了: ${packets.length}個（データ${total}個 + メタ・EOF）`, 'ok');
}

function startSend() {
  if (!fileBase64) return;
  
  buildPackets();
  isSending = true;
  currentPacketIndex = 0;
  
  document.getElementById('sendBtn').style.display = 'none';
  document.getElementById('stopBtn').style.display = 'block';
  
  log('sendLog', `Quietモード「${currentMode}」で送信開始...`, 'info');
  
  Quiet.addReadyCallback(function() {
    transmitter = Quiet.transmitter({
      profile: currentMode,
      onFinish: function() {
        // 1パケット送信完了 → 次へ
        if (!isSending) return;
        currentPacketIndex++;
        updateSendProgress();
        
        if (currentPacketIndex >= packets.length) {
          log('sendLog', 'すべてのパケットを送信しました！', 'ok');
          stopSend();
          return;
        }
        
        // インターバル（パケット間の間隔）
        setTimeout(sendNextPacket, 800);
      },
      onCreateFailed: function(reason) {
        log('sendLog', '送信器の作成に失敗: ' + reason, 'err');
        stopSend();
      }
    });
    
    // 最初のパケットを送信
    setTimeout(sendNextPacket, 500);
  });
}

function sendNextPacket() {
  if (!isSending || !transmitter) return;
  const pkt = packets[currentPacketIndex];
  const textEncoder = new TextEncoder();
  const payload = textEncoder.encode(pkt);
  
  log('sendLog', `送信 [${currentPacketIndex + 1}/${packets.length}] ${pkt.length}文字`, 'info');
  transmitter.transmit(Quiet.transmitterPayload({payload: payload}));
}

function updateSendProgress() {
  const pct = Math.round((currentPacketIndex / packets.length) * 100);
  const bar = document.getElementById('sendProgress');
  bar.style.width = pct + '%';
  bar.textContent = pct + '%';
}

function stopSend() {
  isSending = false;
  if (transmitter) {
    transmitter.destroy();
    transmitter = null;
  }
  document.getElementById('sendBtn').style.display = 'block';
  document.getElementById('stopBtn').style.display = 'none';
  document.getElementById('sendProgress').style.width = '0%';
  document.getElementById('sendProgress').textContent = '0%';
}

// ============================================
// 受信処理
// ============================================
function startReceive() {
  receivedPackets = {};
  receivedMeta = null;
  totalExpected = 0;
  isReceiving = true;
  
  document.getElementById('recvBtn').style.display = 'none';
  document.getElementById('stopRecvBtn').style.display = 'block';
  document.getElementById('downloadCard').style.display = 'none';
  document.getElementById('rxPackets').textContent = '0';
  document.getElementById('rxTotal').textContent = '-';
  document.getElementById('recvProgress').style.width = '0%';
  document.getElementById('recvProgress').textContent = '0%';
  document.getElementById('recvLog').innerHTML = '';
  
  log('recvLog', `Quietモード「${rxMode}」で受信開始...`, 'info');
  log('recvLog', 'マイクへのアクセスを許可してください。', 'warn');
  
  Quiet.addReadyCallback(function() {
    receiver = Quiet.receiver({
      profile: rxMode,
      onReceive: function(payload) {
        if (!isReceiving) return;
        handleReceive(payload);
      },
      onCreateFailed: function(reason) {
        log('recvLog', '受信器の作成に失敗: ' + reason, 'err');
        stopReceive();
      },
      onReceiveFailed: function(num_fails) {
        // デコード失敗（ノイズなど）— 無視
      }
    });
    
    log('recvLog', '受信器を起動しました。音を待っています...', 'ok');
  });
}

function handleReceive(payload) {
  const textDecoder = new TextDecoder('utf-8');
  let text;
  try {
    text = textDecoder.decode(payload);
  } catch(e) {
    return; // デコード失敗
  }
  
  let pkt;
  try {
    pkt = JSON.parse(text);
  } catch(e) {
    return; // JSONパース失敗
  }
  
  if (pkt.type === 'META') {
    receivedMeta = pkt;
    totalExpected = pkt.total;
    document.getElementById('rxTotal').textContent = totalExpected;
    log('recvLog', `メタデータ受信: ${pkt.filename} (${formatBytes(pkt.filesize)})`, 'ok');
    return;
  }
  
  if (pkt.type === 'EOF') {
    log('recvLog', 'EOFパケット受信。ファイルを復元します...', 'info');
    tryReconstruct();
    return;
  }
  
  if (pkt.type === 'DATA') {
    if (receivedPackets[pkt.seq] === undefined) {
      receivedPackets[pkt.seq] = pkt.data;
      const count = Object.keys(receivedPackets).length;
      document.getElementById('rxPackets').textContent = count;
      
      if (totalExpected > 0) {
        const pct = Math.round((count / totalExpected) * 100);
        const bar = document.getElementById('recvProgress');
        bar.style.width = pct + '%';
        bar.textContent = pct + '%';
      }
      
      if (count % 10 === 0) {
        log('recvLog', `進捗: ${count}/${totalExpected} パケット`, 'info');
      }
    }
    return;
  }
}

function tryReconstruct() {
  if (!receivedMeta) {
    log('recvLog', 'メタデータが未受信です。ファイルを復元できません。', 'err');
    return;
  }
  
  const count = Object.keys(receivedPackets).length;
  if (count < totalExpected) {
    log('recvLog', `パケット不足: ${count}/${totalExpected}。再送信を待機中...`, 'warn');
    // 自動停止はせず、残りを待つ
    return;
  }
  
  // 復元
  let base64 = '';
  for (let i = 0; i < totalExpected; i++) {
    if (receivedPackets[i] === undefined) {
      log('recvLog', `パケット ${i} が欠落しています。`, 'err');
      return;
    }
    base64 += receivedPackets[i];
  }
  
  // Base64 → バイナリ
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    
    window.reconstructedBlob = new Blob([bytes]);
    window.reconstructedFilename = receivedMeta.filename;
    
    const info = document.getElementById('recvFileInfo');
    info.innerHTML = `
      <div class="file-item">
        <div>
          <div class="name">${receivedMeta.filename}</div>
          <div class="size">${formatBytes(receivedMeta.filesize)} → ${formatBytes(window.reconstructedBlob.size)}</div>
        </div>
      </div>
    `;
    
    document.getElementById('downloadCard').style.display = 'block';
    log('recvLog', 'ファイル復元完了！ダウンロード可能です。', 'ok');
    
  } catch(e) {
    log('recvLog', '復元エラー: ' + e.message, 'err');
  }
}

function downloadFile() {
  if (!window.reconstructedBlob) return;
  const url = URL.createObjectURL(window.reconstructedBlob);
  const a = document.createElement('a');
  a.href = url;
  a.download = window.reconstructedFilename || 'received_file';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  log('recvLog', 'ダウンロードを開始しました。', 'ok');
}

function stopReceive() {
  isReceiving = false;
  if (receiver) {
    receiver.destroy();
    receiver = null;
  }
  document.getElementById('recvBtn').style.display = 'block';
  document.getElementById('stopRecvBtn').style.display = 'none';
}

// 初期ログ
log('sendLog', 'Quiet.js を読み込み中...', 'info');
