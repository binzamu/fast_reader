document.addEventListener('DOMContentLoaded', () => {
    console.log('DOMが読み込まれました');
    
    const textInput = document.getElementById('textInput');
    const chunkSizeInput = document.getElementById('chunkSize');
    const durationInput = document.getElementById('duration');
    const startButton = document.getElementById('startButton');
    const analyzeButton = document.getElementById('analyzeButton'); // 解析ボタンの参照を追加
    const wordDisplay = document.getElementById('wordDisplay');
    const errorMessage = document.getElementById('errorMessage');
    const statusMessage = document.getElementById('statusMessage'); // ステータス要素
    // const analysisOutput = document.getElementById('analysisOutput'); // 不要
    const originalTextContent = document.getElementById('originalTextContent'); // 元の文章表示要素を取得
    const originalTextDisplayArea = document.querySelector('.original-text-area'); // 元の文章エリア全体を取得
    const autoScrollToggle = document.getElementById('autoScrollToggle'); // 自動スクロールのトグル
    const toggleOriginalTextDisplay = document.getElementById('toggleOriginalTextDisplay'); // 元の文章表示トグル
    const fileInput = document.getElementById('fileInput'); // ファイル入力要素を追加
    const bookmarkButton = document.getElementById('bookmarkButton'); // しおり保存ボタン
    const bookmarkList = document.getElementById('bookmarkList'); // しおりリスト
    
    let words = []; // { chunk: string, originalLineNumber: number } の配列
    let originalTokens = []; // 全ての解析済みトークンを格納 (行番号付き)
    let currentIndex = 0;
    let intervalId = null;
    let currentHighlightedLineElement = null; // ハイライト中の行要素を再度宣言
    let analysisInProgress = false; 
    let analysisComplete = false; 
    let currentClickedWordSpan = null; // クリックされた単語のspanを保持

    let worker = null; // Workerインスタンス
    let dbPromise = null; // IndexedDB の初期化 Promise

    // ============================================================
    // IndexedDB しおり機能
    // ============================================================
    const DB_NAME = 'rsvpAppDB';
    const STORE_NAME = 'bookmarks';

    function initDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, 3);

            request.onerror = (event) => {
                console.error('IndexedDB のオープンに失敗しました:', event.target.error);
                reject('IndexedDB error: ' + event.target.errorCode);
            };

            request.onsuccess = (event) => {
                db = event.target.result;
                console.log('IndexedDB のオープンに成功しました');
                resolve(db);
            };

            request.onupgradeneeded = (event) => {
                db = event.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    const objectStore = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
                    objectStore.createIndex('title', 'title', { unique: false }); // タイトルで検索できるようにインデックス作成
                    objectStore.createIndex('timestamp', 'timestamp', { unique: false }); // 保存日時でソートできるようにインデックス作成
                    console.log('オブジェクトストアを作成しました:', STORE_NAME);
                }
            };
        });
    }

    function addBookmark(text, wordIndex, title = '') {
        return new Promise(async (resolve, reject) => {
            if (!dbPromise) {
                 reject('データベース初期化プロミスが存在しません');
                 return;
            }
            try {
                await dbPromise; // DB初期化完了を待つ
            } catch (error) {
                 reject('データベース初期化待機中にエラー: ' + error);
                 return;
            }
            if (!db) {
                reject('データベースが初期化されていません');
                return;
            }
            const transaction = db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const timestamp = new Date().getTime();
            // タイトルが空の場合、テキストの最初の部分を使用
            const bookmarkTitle = title || text.substring(0, 30) + (text.length > 30 ? '...' : '');

            const bookmark = {
                title: bookmarkTitle,
                text: text,
                wordIndex: wordIndex,
                timestamp: timestamp
            };

            const request = store.add(bookmark);

            request.onsuccess = (event) => {
                console.log('しおりを追加しました:', event.target.result);
                resolve(event.target.result); // 追加されたアイテムのIDを返す
            };

            request.onerror = (event) => {
                console.error('しおりの追加に失敗しました:', event.target.error);
                reject('しおりの追加エラー: ' + event.target.error);
            };
        });
    }

    function getAllBookmarks() {
        return new Promise(async (resolve, reject) => {
            if (!dbPromise) {
                 reject('データベース初期化プロミスが存在しません');
                 return;
            }
             try {
                await dbPromise; // DB初期化完了を待つ
            } catch (error) {
                 reject('データベース初期化待機中にエラー: ' + error);
                 return;
            }
            if (!db) {
                reject('データベースが初期化されていません');
                return;
            }
            const transaction = db.transaction([STORE_NAME], 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const index = store.index('timestamp'); // 保存日時でソート
            const request = index.getAll(); // 新しい順に取得したい場合は direction: 'prev' が必要かも

            request.onsuccess = (event) => {
                // console.log('すべてのしおりを取得しました:', event.target.result);
                // 新しい順にソートする場合
                const bookmarks = event.target.result.sort((a, b) => b.timestamp - a.timestamp);
                resolve(bookmarks);
            };

            request.onerror = (event) => {
                console.error('しおりの取得に失敗しました:', event.target.error);
                reject('しおりの取得エラー: ' + event.target.error);
            };
        });
    }

    function getBookmark(id) {
        return new Promise(async (resolve, reject) => {
             if (!dbPromise) {
                 reject('データベース初期化プロミスが存在しません');
                 return;
            }
             try {
                await dbPromise; // DB初期化完了を待つ
            } catch (error) {
                 reject('データベース初期化待機中にエラー: ' + error);
                 return;
            }
             if (!db) {
                reject('データベースが初期化されていません');
                return;
            }
            const transaction = db.transaction([STORE_NAME], 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.get(id);

            request.onsuccess = (event) => {
                // console.log('しおりを取得しました:', event.target.result);
                resolve(event.target.result);
            };

            request.onerror = (event) => {
                console.error('しおりの取得に失敗しました:', event.target.error);
                reject('しおりの取得エラー: ' + event.target.error);
            };
        });
    }

    function deleteBookmark(id) {
        return new Promise(async (resolve, reject) => {
             if (!dbPromise) {
                 reject('データベース初期化プロミスが存在しません');
                 return;
            }
            try {
                await dbPromise; // DB初期化完了を待つ
            } catch (error) {
                 reject('データベース初期化待機中にエラー: ' + error);
                 return;
            }
             if (!db) {
                reject('データベースが初期化されていません');
                return;
            }
            const transaction = db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.delete(id);

            request.onsuccess = () => {
                console.log('しおりを削除しました:', id);
                resolve();
            };

            request.onerror = (event) => {
                console.error('しおりの削除に失敗しました:', event.target.error);
                reject('しおりの削除エラー: ' + event.target.error);
            };
        });
    }

    // アプリケーション初期化時にDBを初期化
    dbPromise = initDB();
    dbPromise.then(() => {
        console.log('データベースの準備完了');
        displayBookmarks(); // 起動時にリスト表示
    }).catch(error => {
        showError('データベースの初期化に失敗しました: ' + error);
    });

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
        startButton.disabled = true; // ★★★ 結果クリア時は開始ボタンを無効化 ★★★
        bookmarkButton.disabled = true; // ★★★ しおり保存ボタンも無効化 ★★★
        startButton.textContent = '開始';
        if (intervalId) stopDisplay(); // 表示中なら停止も行う
    }

    // 元の文章を行ごとに表示する関数
    function displayOriginalTextWithTokens(tokens) {
        originalTextContent.innerHTML = ''; // クリア
        if (!tokens || tokens.length === 0) return;

        let currentLineDiv = null;
        let currentLineNumber = -1;

        tokens.forEach((token, index) => {
            // 行が変わったら新しいdivを作成
            if (token.originalLineNumber !== currentLineNumber) {
                currentLineNumber = token.originalLineNumber;
                currentLineDiv = document.createElement('div');
                currentLineDiv.id = `line-${currentLineNumber}`;
                originalTextContent.appendChild(currentLineDiv);
            }

            // トークンをspanで囲む
            const tokenSpan = document.createElement('span');
            tokenSpan.textContent = token.surface_form;
            tokenSpan.dataset.tokenIndex = index; // トークンインデックスをデータ属性として保持
            tokenSpan.classList.add('clickable-word'); // クリック可能クラスを追加

            // 改行トークンはそのまま<br>として扱うか、divの区切りで表現
            // ここではspanでラップし、CSSで調整することを想定
            // if (token.surface_form === '\n') { ... }

            currentLineDiv.appendChild(tokenSpan);
        });
        console.log('元の文章をトークンベースで表示しました');
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

    // ファイル入力のイベントリスナーを追加
    fileInput.addEventListener('change', (event) => {
        const file = event.target.files[0];
        if (!file) {
            return; // ファイルが選択されなかった場合
        }

        // テキストファイルか簡易チェック
        if (!file.type.match('text/plain') && !file.name.endsWith('.txt')) {
             showError('テキストファイル (.txt) を選択してください。');
             fileInput.value = ''; // 入力をリセット
             return;
        }

        const reader = new FileReader();

        reader.onload = (e) => {
            const fileContent = e.target.result;
            textInput.value = fileContent; // テキストエリアに内容を設定
            console.log('ファイルの内容を読み込みました。');
            hideError(); // エラーがあれば消す
            clearResults(); // 既存の解析結果などをクリア (ここでも開始ボタンが無効化される)
            // ★★★ 自動で解析は開始しない ★★★
            // 例: analyzeButton.click(); // 必要なら解析ボタンを押すなど
        };

        reader.onerror = (e) => {
            console.error('ファイルの読み込み中にエラーが発生しました:', e);
            showError('ファイルの読み込みに失敗しました。');
        };

        reader.readAsText(file, 'UTF-8'); // UTF-8として読み込む
        // 同じファイルを連続で選択できるように値をリセット
        fileInput.value = ''; 
    });

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
            displayOriginalTextWithTokens(tokens); // 元のテキスト表示関数を呼び出し
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

            // 次のインデックスへ
            currentIndex++;

            // 最後まで表示したら停止
            if (currentIndex >= words.length) {
                stopDisplay();
                // wordDisplay.textContent = "完了"; // 完了メッセージは任意
                 startButton.textContent = '開始'; // 完了したら開始に戻す
                 currentIndex = 0; // 最初に戻す
            }
        } else {
            stopDisplay(); // インデックスがおかしい場合も停止
             startButton.textContent = '開始';
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

    // ★★★ 開始ボタンの処理: RSVPの開始/停止のみ ★★★
    startButton.addEventListener('click', () => {
        if (intervalId) {
            // 停止処理
            stopDisplay();
        } else {
            // 開始処理 (解析済みの場合のみ)
            if (analysisComplete && words.length > 0) {
                 startRsvpDisplay();
            } else {
                console.log('表示を開始できません。先に「解析」を実行してください。');
                showError('表示を開始できません。先に「解析」を実行してください。');
            }
        }
    });

    // ★★★ 解析ボタンの処理: Workerへテキスト送信 ★★★
    analyzeButton.addEventListener('click', () => {
        console.log('解析ボタンがクリックされました');
        const textToAnalyze = textInput.value.trim();
        const targetChunkSize = parseInt(chunkSizeInput.value);

        if (!textToAnalyze) {
            showError('テキストが入力されていません。');
            return;
        }
        if (isNaN(targetChunkSize) || targetChunkSize <= 0) {
             showError('表示文字数は1以上に設定してください');
            return;
        }
        if (!worker) {
             showError('形態素解析エンジンが準備できていません。');
            return;
        }
        if (analysisInProgress) {
            console.log('現在解析中です。');
            return; // 解析中は実行しない
        }

        // 前回の結果をクリアし、解析開始状態に
        clearResults();
        analysisInProgress = true;
        analysisComplete = false;
        startButton.disabled = true; // 解析中は開始不可
        showStatus('形態素解析を開始します...');
        hideError(); // 古いエラーは消す

        // Workerにテキストと設定を送信
        console.log('Workerにテキストを送信します...');
        worker.postMessage({ text: textToAnalyze, targetChunkSize: targetChunkSize });
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
                            // ★★★ 初期化完了時は解析ボタンを有効にする（必要なら）★★★
                            // analyzeButton.disabled = false; 
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
                            words = chunkData || []; // チャンクデータ配列を受け取る (start/endTokenIndexを含む)
                            analysisInProgress = false;
                            analysisComplete = true;
                            hideStatus();
                            // ★★★ 元のテキスト表示関数を呼び出すように変更 ★★★
                            displayOriginalTextWithTokens(originalTokens); 
                            // ★★★ 開始ボタンを有効化 ★★★
                            startButton.disabled = false;
                            startButton.textContent = '開始'; // テキストもリセット
                            bookmarkButton.disabled = false; // ★★★ ここでしおりボタンを有効化 ★★★
                            console.log('解析が完了し、開始ボタンで表示を開始できます。しおり保存も可能です。');
                            break;
                        case 'error':
                            console.error('Worker Error:', message);
                            showError(message || 'Workerでエラーが発生しました。');
                            analysisInProgress = false;
                            analysisComplete = false; // エラー時は完了としない
                            hideStatus();
                            // ★★★ 開始ボタンは無効のまま ★★★
                            startButton.disabled = true;
                            startButton.textContent = '開始';
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
                    // ★★★ 開始ボタンは無効のまま ★★★
                    startButton.disabled = true;
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
        if (!analysisComplete || words.length === 0) { // currentIndexのチェックは削除
             console.log('表示を開始できません。解析未完了またはチャンクがありません。');
             startButton.textContent = '開始'; 
             return; 
        }
        // currentIndex が範囲外なら0にリセット
        if (currentIndex < 0 || currentIndex >= words.length) {
            currentIndex = 0;
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
        // ★★★ 開始時に現在位置へスクロール ★★★
        if (autoScrollToggle.checked && words[currentIndex-1] && words[currentIndex-1].originalLineNumber !== undefined) { // displayNextWordが呼ばれた後なので index-1 を見る
            scrollToLine(words[currentIndex-1].originalLineNumber);
        }
    }

    // --- Worker連携 --- 
    // function sendNextUnitToWorker() { ... } // 不要
    // function updateProgress() { ... } // Workerメッセージハンドラ内で直接更新

    // ★★★ 元のテキストクリック時のジャンプ処理を追加 ★★★
    originalTextContent.addEventListener('click', (event) => {
        const clickedSpan = event.target.closest('span.clickable-word');
        if (!clickedSpan || !analysisComplete) {
            return; // クリック可能な単語以外、または解析完了前は無視
        }

        const clickedTokenIndex = parseInt(clickedSpan.dataset.tokenIndex, 10);
        if (isNaN(clickedTokenIndex)) {
            return;
        }

        console.log(`Clicked token index: ${clickedTokenIndex}`);

        // クリックされたトークンインデックスを含むチャンクを探す
        let targetWordIndex = -1;
        for (let i = 0; i < words.length; i++) {
            // chunkDataにstartTokenIndexとendTokenIndexが含まれている前提
            if (words[i].startTokenIndex <= clickedTokenIndex && words[i].endTokenIndex >= clickedTokenIndex) {
                targetWordIndex = i;
                break;
            }
        }

        if (targetWordIndex !== -1) {
            console.log(`Jumping to word index: ${targetWordIndex}`);
            if (intervalId) {
                stopDisplay(); // 表示中なら停止
            }
            currentIndex = targetWordIndex;
            displayNextWord(); // ジャンプ先の単語を表示
            startButton.textContent = '開始'; // ボタンは「開始」状態にする

            // (任意) クリックされた単語を一時的にハイライト
            if (currentClickedWordSpan) {
                currentClickedWordSpan.classList.remove('clicked-word'); // 前のハイライトを消す
            }
            clickedSpan.classList.add('clicked-word');
            currentClickedWordSpan = clickedSpan;
            // 一定時間後にハイライトを消す
            setTimeout(() => {
                if (clickedSpan.classList.contains('clicked-word')) {
                    clickedSpan.classList.remove('clicked-word');
                    if (currentClickedWordSpan === clickedSpan) {
                        currentClickedWordSpan = null;
                    }
                }
            }, 500); // 0.5秒後に消す

        } else {
            console.warn(`Could not find word chunk for token index: ${clickedTokenIndex}`);
        }
    });

    // しおりリストを表示/更新する関数
    async function displayBookmarks() {
        try {
            const bookmarks = await getAllBookmarks();
            bookmarkList.innerHTML = ''; // リストをクリア
            if (bookmarks.length === 0) {
                const li = document.createElement('li');
                li.textContent = '保存されているしおりはありません。';
                bookmarkList.appendChild(li);
                return;
            }

            bookmarks.forEach(bookmark => {
                const li = document.createElement('li');
                const loadButton = document.createElement('button');
                const deleteButton = document.createElement('button');
                const titleSpan = document.createElement('span');

                titleSpan.textContent = `${bookmark.title} (${new Date(bookmark.timestamp).toLocaleString()})`;
                titleSpan.style.cursor = 'pointer';
                titleSpan.title = 'クリックして読み込む';

                loadButton.textContent = '読込';
                loadButton.dataset.bookmarkId = bookmark.id;
                loadButton.classList.add('bookmark-load-button');

                deleteButton.textContent = '削除';
                deleteButton.dataset.bookmarkId = bookmark.id;
                deleteButton.classList.add('bookmark-delete-button');

                // 読込ボタンのイベントリスナー
                loadButton.addEventListener('click', async (event) => {
                    const id = parseInt(event.target.dataset.bookmarkId);
                    await loadBookmark(id);
                });

                // タイトルクリックでも読み込めるように
                titleSpan.addEventListener('click', async (event) => {
                    const button = li.querySelector('.bookmark-load-button'); // 対応するボタンを探す
                    if(button) {
                        const id = parseInt(button.dataset.bookmarkId);
                        await loadBookmark(id);
                    }
                });

                // 削除ボタンのイベントリスナー
                deleteButton.addEventListener('click', async (event) => {
                    const id = parseInt(event.target.dataset.bookmarkId);
                    if (confirm('このしおりを削除しますか？')) {
                        try {
                            await deleteBookmark(id);
                            await displayBookmarks(); // リストを再表示
                        } catch (error) {
                            showError('しおりの削除に失敗しました: ' + error);
                        }
                    }
                });

                li.appendChild(titleSpan);
                li.appendChild(loadButton);
                li.appendChild(deleteButton);
                bookmarkList.appendChild(li);
            });
        } catch (error) {
            showError('しおりリストの表示に失敗しました: ' + error);
            const li = document.createElement('li');
            li.textContent = 'しおりリストの読み込みに失敗しました。';
            bookmarkList.appendChild(li);
        }
    }

    // しおりを読み込んでRSVPを開始する関数
    async function loadBookmark(id) {
        try {
            const bookmark = await getBookmark(id);
            if (!bookmark) {
                showError('しおりが見つかりませんでした。');
                return;
            }
            console.log('しおりを読み込みました:', bookmark);
            stopDisplay(); // 既存の表示を停止
            clearResults(); // 表示をクリア

            textInput.value = bookmark.text;
            // テキストを設定したら解析を実行
            analyzeButton.click(); // 解析ボタンをクリックして解析を開始

            // 解析完了を待機 (ポーリングまたはPromise/Callbackで改善可能)
            // ここでは単純なsetTimeoutで待機するが、より堅牢な方法を推奨
            const checkAnalysisComplete = setInterval(() => {
                if (analysisComplete) {
                    clearInterval(checkAnalysisComplete);
                    bookmarkButton.disabled = false; // しおり読み込み後の解析完了時にも有効化
                    console.log(`解析完了、しおりの位置 (${bookmark.wordIndex}) から開始します`);
                    // 正しいチャンクインデックスを見つける (現状は近似値)
                    const approximateChunkIndex = Math.min(words.length - 1, Math.max(0, bookmark.wordIndex)); 
                    console.log("デバッグ: words=", words)
                    console.log("デバッグ: originalTokens=", originalTokens)
                    console.log("デバッグ: bookmark.wordIndex=", bookmark.wordIndex)
                    console.log("デバッグ: approximateChunkIndex=", approximateChunkIndex)

                    if (words.length > 0) {
                        currentIndex = approximateChunkIndex; // 保存された位置に近いチャンクから開始
                        startButton.disabled = false; // 開始(再開)ボタンを有効化
                        startButton.textContent = '再開'; // しおりから開始することを示す
                        console.log('しおりの位置を読み込みました。「再開」ボタンで開始してください。')
                    } else {
                         showError('解析後の単語リストが空です。');
                    }
                } else if (!analysisInProgress) {
                     // 解析が完了せず、進行中でもない場合（エラーなど）
                     clearInterval(checkAnalysisComplete);
                     showError('テキストの解析に失敗したため、しおりから再開できませんでした。');
                }
            }, 100); // 100msごとにチェック

        } catch (error) {
            showError('しおりの読み込みに失敗しました: ' + error);
        }
    }

    // しおり保存ボタンのイベントリスナー
    bookmarkButton.addEventListener('click', async () => {
        if (!analysisComplete || words.length === 0) {
            showError('しおりを保存するテキストが解析されていません。');
            return;
        }
        const currentText = textInput.value;
        // 現在表示されている単語の *次の* インデックスをしおり位置とするか、
        // 現在表示されている単語のインデックスとするか。ここでは現在表示中のインデックスを使う
        const currentWordIndex = Math.max(0, currentIndex -1); // 停止直前のインデックス

        try {
            // タイトルを入力させる場合はここでプロンプトなどを表示
            const title = prompt('しおりのタイトルを入力してください（任意）:');
            await addBookmark(currentText, currentWordIndex, title || '');
            showStatus('しおりを保存しました。');
            await displayBookmarks(); // リストを更新
            setTimeout(hideStatus, 3000); // 3秒後にステータスメッセージを消す
        } catch (error) {
            showError('しおりの保存に失敗しました: ' + error);
        }
    });

    // 解析ボタンのクリックイベントリスナー内でしおりボタンを有効化
    analyzeButton.addEventListener('click', async () => {
        // ... (既存の解析処理)
        // ...
        // 解析完了後のボタン有効化ロジックは worker.onmessage に移動したので削除
        // if (analysisComplete) {
        //     bookmarkButton.disabled = false; 
        // } else {
        //     bookmarkButton.disabled = true; 
        // }
        // ... (既存の処理)
    });

    // テキスト入力エリアの内容が変更されたら解析結果をクリアし、しおりボタンを無効化
    textInput.addEventListener('input', () => {
        clearResults(); // 既存の解析結果などをクリア
        // bookmarkButton.disabled = true; // clearResults内で無効化されるため不要
    });

}); 