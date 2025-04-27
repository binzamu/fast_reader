document.addEventListener('DOMContentLoaded', () => {
    console.log('DOMが読み込まれました');
    
    const textInput = document.getElementById('textInput');
    const chunkSizeInput = document.getElementById('chunkSize');
    const durationInput = document.getElementById('duration');
    const startButton = document.getElementById('startButton');
    const wordDisplay = document.getElementById('wordDisplay');
    const errorMessage = document.getElementById('errorMessage');
    const statusMessage = document.getElementById('statusMessage'); // ステータス要素
    // const analysisOutput = document.getElementById('analysisOutput'); // 不要
    const originalTextContent = document.getElementById('originalTextContent'); // 元の文章表示要素を取得
    const originalTextDisplayArea = document.querySelector('.original-text-area'); // 元の文章エリア全体を取得
    const autoScrollToggle = document.getElementById('autoScrollToggle'); // 自動スクロールのトグル
    const toggleOriginalTextDisplay = document.getElementById('toggleOriginalTextDisplay'); // 元の文章表示トグル
    
    let words = []; // { chunk: string, originalLineNumber: number } の配列
    let originalTokens = []; // 全ての解析済みトークンを格納 (行番号付き)
    let currentIndex = 0;
    let intervalId = null;
    let currentHighlightedLineElement = null; // ハイライト中の行要素を再度宣言
    let analysisInProgress = false; 
    let analysisComplete = false; 

    let worker = null; // Workerインスタンス

    // エラーメッセージを表示する関数
    function showError(message) {
        console.error('エラー:', message);
        errorMessage.textContent = message;
        errorMessage.classList.add('show');
        hideStatus(); // エラー時はステータス非表示
    }

    // エラーメッセージを非表示にする関数
    function hideError() {
        errorMessage.classList.remove('show');
    }

    function showStatus(message) {
        statusMessage.textContent = message;
        statusMessage.classList.add('show');
    }

    function hideStatus() {
        statusMessage.classList.remove('show');
    }

    // 解析結果と元のテキスト表示をクリアする関数
    function clearResults() {
        // analysisOutput.textContent = ''; // 不要
        originalTextContent.innerHTML = ''; 
        words = []; 
        originalTokens = [];
        currentIndex = 0; 
        wordDisplay.textContent = ''; 
        analysisInProgress = false; 
        analysisComplete = false;
        hideStatus();
        hideError();
    }

    // 元の文章を行ごとに表示する関数
    function displayOriginalTextByLines(fullText) {
        originalTextContent.innerHTML = ''; // クリア
        const lines = fullText.split('\n');
        lines.forEach((lineText, index) => {
            const lineDiv = document.createElement('div');
            lineDiv.id = `line-${index}`; // 行番号(0-based)でID付け
            lineDiv.textContent = lineText || ' '; // 空行も高さを保つためにスペース
            originalTextContent.appendChild(lineDiv);
        });
    }

    // 元の文章エリアの表示/非表示を切り替える関数
    function toggleOriginalTextVisibility() {
        if (toggleOriginalTextDisplay.checked) {
            originalTextDisplayArea.classList.add('visible');
        } else {
            originalTextDisplayArea.classList.remove('visible');
        }
    }

    // トグルスイッチの初期状態を反映
    toggleOriginalTextVisibility();

    // トグルスイッチの変更イベントにリスナーを追加
    toggleOriginalTextDisplay.addEventListener('change', toggleOriginalTextVisibility);

    // テキストを形態素解析して適切な長さの塊に分割する関数
    function splitText(text, targetChunkSize) {
        console.log(`テキストの分割を開始 (目標文字数: ${targetChunkSize}):`, text);
        
        if (!tokenizer) {
            showError('形態素解析エンジンが初期化されていません');
            return { tokens: [], chunks: [] };
        }
        if (targetChunkSize <= 0) {
             showError('表示文字数は1以上に設定してください');
            return { tokens: [], chunks: [] };
        }

        try {
            const tokens = tokenizer.tokenize(text);
            console.log('トークン化結果:', tokens);
            // originalTokens = tokens; // ここで更新しない (開始ボタンで分析時に更新)

            // 解析結果を表示エリアに出力
            const analysisResultText = tokens.map(token => {
                return `${token.surface_form}\t${token.pos}, ${token.pos_detail_1}, ${token.pos_detail_2}, ${token.pos_detail_3} (${token.basic_form})`;
            }).join('\n');
            // analysisOutput.textContent = analysisResultText;
            
            const chunks = [];
            let currentChunk = '';
            let currentLength = 0;
            let prefixForNextToken = ''; 

            for (let i = 0; i < tokens.length; i++) {
                const token = tokens[i];
                const tokenSurface = token.surface_form;
                const tokenLength = tokenSurface.length;
                const tokenPos = token.pos;

                // 1. 区切り文字 (、。) の処理
                if (tokenSurface === '、' || tokenSurface === '。') {
                    if (currentChunk) {
                        chunks.push(currentChunk);
                    }
                    currentChunk = '';
                    currentLength = 0;
                    prefixForNextToken = ''; 
                    continue; 
                }

                // 2. 終わり括弧 (」) ） の処理
                if (tokenSurface === '」' || tokenSurface === '）') {
                    if (currentChunk) {
                        currentChunk += tokenSurface;
                        currentLength += tokenLength;
                        chunks.push(currentChunk);
                    }
                    currentChunk = '';
                    currentLength = 0;
                    prefixForNextToken = '';
                    continue;
                }

                // 3. 始め括弧 (「) （ の処理
                if (tokenSurface === '「' || tokenSurface === '（') {
                    if (currentChunk) {
                        chunks.push(currentChunk); 
                    }
                    currentChunk = ''; 
                    currentLength = 0;
                    prefixForNextToken = tokenSurface; 
                    continue;
                }

                // 4. 助詞の処理 (ただし直前にチャンクがある場合のみ)
                if (tokenPos === '助詞' && currentChunk !== '') {
                    const surfaceWithPrefix = prefixForNextToken + tokenSurface;
                    const lengthWithPrefix = surfaceWithPrefix.length;
                    prefixForNextToken = ''; 

                    if (currentLength + lengthWithPrefix <= targetChunkSize || currentLength < targetChunkSize / 2) {
                        currentChunk += surfaceWithPrefix;
                        currentLength += lengthWithPrefix;
                        continue; 
                    } else {
                         if (currentChunk) {
                             chunks.push(currentChunk);
                         }
                         currentChunk = surfaceWithPrefix;
                         currentLength = lengthWithPrefix;
                    }
                }

                // 5. 通常トークン 
                const currentSurfaceWithPrefix = prefixForNextToken + (tokenPos !== '助詞' ? tokenSurface : '');
                let processingPrefix = prefixForNextToken; // このトークン処理で使うprefix
                prefixForNextToken = ''; // prefixはここで消費(または使われなかった)
                
                const lengthWithPrefix = currentSurfaceWithPrefix.length;

                if (tokenPos === '助詞' && currentChunk === processingPrefix + tokenSurface) {
                    // 助詞処理で新しいチャンクとして確定され、ここに来た場合
                     // surfaceWithPrefixは使わないので lengthWithPrefix もリセット
                    // lengthWithPrefix = 0; // これは不要か？ currentChunkに値はある
                } 

                if (currentChunk !== '' && (currentLength + lengthWithPrefix > targetChunkSize || lengthWithPrefix > targetChunkSize)) {
                    if (currentChunk) { 
                        chunks.push(currentChunk);
                    }
                    currentChunk = currentSurfaceWithPrefix;
                    currentLength = lengthWithPrefix;
                } else {
                     // currentChunkが助詞処理で設定されたばかりの場合、追加しない
                    if(currentChunk === currentSurfaceWithPrefix && tokenPos === '助詞'){
                         // 何もしない
                    } else {
                        currentChunk += currentSurfaceWithPrefix;
                        currentLength += lengthWithPrefix;
                    }
                }

                if (lengthWithPrefix > targetChunkSize && currentChunk === currentSurfaceWithPrefix && currentLength === lengthWithPrefix) {
                    chunks.push(currentChunk);
                    currentChunk = '';
                    currentLength = 0;
                }
            }
            
            if (currentChunk) {
                chunks.push(currentChunk);
            }

            const finalChunks = chunks.filter(chunk => chunk.length > 0);
            console.log('分割結果 (句読点・括弧・助詞結合後):', finalChunks);
            displayOriginalTextByLines(textInput.value); // 元のテキスト表示関数を呼び出し
            return { tokens, chunks: finalChunks };
        } catch (err) {
            showError('テキストの解析中にエラーが発生しました: ' + err.message);
            clearResults(); // ここでもクリア
            return { tokens: [], chunks: [] };
        }
    }

    // 次の単語を表示する関数
    function displayNextWord() {
        if (currentIndex < words.length) {
            const currentChunkData = words[currentIndex];
            console.log('次の単語を表示:', currentIndex, currentChunkData.chunk);
            wordDisplay.textContent = currentChunkData.chunk;

            // --- 対応する元のテキスト行をハイライト & スクロール --- 
            // 以前のハイライトを削除
            if (currentHighlightedLineElement) {
                currentHighlightedLineElement.classList.remove('selected-line');
            }
            // 現在のチャンクデータから行番号を取得
            const targetLineNumber = currentChunkData.originalLineNumber;
            const targetLineElement = document.getElementById(`line-${targetLineNumber}`);

            if (targetLineElement) {
                targetLineElement.classList.add('selected-line');
                currentHighlightedLineElement = targetLineElement;
                
                // 自動スクロールが有効な場合のみスクロール
                if (autoScrollToggle.checked) {
                    targetLineElement.scrollIntoView({
                        behavior: 'smooth', 
                        block: 'nearest'   
                    });
                }
            } else {
                 currentHighlightedLineElement = null; 
            }
            // --- ハイライト & スクロール ここまで ---

            currentIndex++;
        } else {
            console.log('最後のチャンクを表示しました。');
            stopDisplay(); // 完全に停止
             // 最後のハイライトを消す (任意)
             if (currentHighlightedLineElement) {
                 currentHighlightedLineElement.classList.remove('selected-line');
                 currentHighlightedLineElement = null;
             }
        }
    }

    // 表示を停止する関数
    function stopDisplay() {
        console.log('表示を停止します');
        if (intervalId) {
            clearInterval(intervalId);
            intervalId = null;
        }
        startButton.textContent = '開始'; 
        hideStatus(); 
         // 停止時にハイライト解除 (任意)
         if (currentHighlightedLineElement) {
             currentHighlightedLineElement.classList.remove('selected-line');
             currentHighlightedLineElement = null;
         }
    }

    // 開始ボタンのクリックイベント
    startButton.addEventListener('click', () => {
        console.log('開始ボタンがクリックされました');
        hideError();

        if (intervalId) { 
            stopDisplay();
            return;
        }
        
        if (analysisInProgress) {
            showStatus('現在解析中です...');
            return;
        }
        
        if (analysisComplete) {
            console.log('解析済みテキストの表示を開始/再開します。');
             // クリックで開始位置が変更されている可能性があるので、
             // stopDisplayでハイライト解除した後に再度ハイライトする (またはクリック機能を削除)
             // 現状はクリック機能を一旦コメントアウトするため、単純に開始する
              if (currentIndex >= words.length) {
                 currentIndex = 0; // 末尾まで行ってたら最初から
                  if (currentHighlightedLineElement) { // クリック選択が残っていたら消す
                      currentHighlightedLineElement.classList.remove('selected-line');
                      currentHighlightedLineElement = null;
                  }
             }
            startRsvpDisplay(); 
        } else {
             console.log('新規解析を開始します。');
             const text = textInput.value.trim();
             const targetChunkSize = parseInt(chunkSizeInput.value);
             
             if (!text) {
                 showError('テキストを入力してください');
                 return;
             }
              if (isNaN(targetChunkSize) || targetChunkSize < 1 || targetChunkSize > 30) {
                  showError('表示文字数は1から30の間で設定してください');
                  return;
              }
               if (!worker) { 
                  showError('バックグラウンド処理が利用できません。');
                  return;
              }
 
             clearResults(); 
             analysisInProgress = true;
             analysisComplete = false;
             currentIndex = 0; 
             showStatus('形態素解析を開始しました... (0%)');
             startButton.textContent = '解析中'; 
             worker.postMessage({ text, targetChunkSize }); 
             console.log('Workerにテキストを送信しました。完了待ち...');
        }
    });

    // --- Workerの初期化 --- 
    function initializeWorker() {
        if (window.Worker) {
            try {
                worker = new Worker('worker.js');
                console.log('Worker created');

                // Workerからのメッセージを処理
                worker.onmessage = function(event) {
                    // chunkData を追加
                    const { type, data, message, tokens, chunkData, processed, total } = event.data; 

                    switch (type) {
                        case 'initialized':
                            console.log('Workerから初期化完了通知');
                            hideStatus(); 
                            break;
                        case 'progress':
                            if (total > 0 && analysisInProgress) {
                                const percent = Math.round((processed / total) * 100);
                                showStatus(`形態素解析中... (${percent}%)`);
                            }
                            break;
                        case 'done':
                            if (!analysisInProgress) return; 
                            console.log('Main: 全解析完了');
                            originalTokens = tokens || []; 
                            words = chunkData || []; // チャンクデータ配列を受け取る
                            analysisInProgress = false;
                            analysisComplete = true;
                            hideStatus();
                            // 元のテキストを行ごとに表示
                            displayOriginalTextByLines(textInput.value); 
                            startButton.textContent = '開始'; 
                            console.log('解析が完了し、開始ボタンで表示を開始できます。');
                            break;
                        case 'error':
                            console.error('Worker Error:', message);
                            showError(message || 'Workerでエラーが発生しました。');
                            analysisInProgress = false;
                            analysisComplete = false; // エラー時は完了としない
                            hideStatus();
                            startButton.textContent = '開始'; // 開始ボタンを元に戻す
                            if (intervalId) stopDisplay();
                            break;
                        default:
                            console.warn('Workerから未知のメッセージタイプ:', type);
                    }
                };

                worker.onerror = function(error) {
                    console.error('Worker自体でエラー発生:', error);
                    showError(`Workerエラー: ${error.message || '不明なエラー'}`);
                    analysisInProgress = false;
                    analysisComplete = false;
                    hideStatus();
                    startButton.textContent = '開始';
                     if (intervalId) stopDisplay();
                };

                showStatus('形態素解析エンジンの準備中...'); 

            } catch (e) {
                console.error('Workerの作成に失敗:', e);
                showError('バックグラウンド処理の初期化に失敗しました。ページを再読み込みしてください。');
            }
        } else {
            showError('お使いのブラウザはWeb Workerをサポートしていません。');
        }
    }

    initializeWorker(); // アプリケーション読み込み時にWorkerを準備

    // --- RSVP表示関連 --- 
    function startRsvpDisplay() {
        if (intervalId) return; 
        if (!analysisComplete || words.length === 0 || currentIndex >= words.length) {
             console.log('表示を開始できません。解析未完了、チャンクがない、またはインデックスが範囲外です。');
             startButton.textContent = '開始'; 
             return; 
        }

        const displayDuration = parseInt(durationInput.value);
        if (isNaN(displayDuration) || displayDuration < 50 || displayDuration > 2000) {
            showError('表示時間は50から2000msの間で設定してください');
             if (intervalId) clearInterval(intervalId); 
             intervalId = null;
             startButton.textContent = '開始';
            return;
        }
        
        hideStatus(); 
        const interval = displayDuration;
        console.log('表示間隔:', interval, 'ms');
        startButton.textContent = '停止';
        intervalId = setInterval(displayNextWord, interval);
        console.log('表示を開始/再開しました');
        displayNextWord(); 
    }

    // --- Worker連携 --- 
    // function sendNextUnitToWorker() { ... } // 不要
    // function updateProgress() { ... } // Workerメッセージハンドラ内で直接更新
}); 