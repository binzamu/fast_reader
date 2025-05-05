// worker.js

// Kuromoji.jsをインポート (ローカルファイルから・相対パス指定に戻す)
try {
    // CDNのURLを指定 → ローカルパスに変更 → 絶対パスに変更 → 相対パスに戻す
    importScripts('kuromoji/kuromoji.js');
} catch (e) {
    // エラーをメインスレッドに通知
    self.postMessage({ type: 'error', message: 'Kuromoji.jsの読み込みに失敗しました: ' + e.message });
    throw e; // Workerを停止させる
}

let tokenizer = null;

// Kuromojiの初期化 (ローカル辞書から・相対パス指定に戻す)
// CDNのパス → ローカルパスに変更 → 絶対パスに変更 → 相対パスに戻す
kuromoji.builder({ dicPath: 'kuromoji/dict/' }).build((err, _tokenizer) => {
    if (err) {
        self.postMessage({ type: 'error', message: '形態素解析エンジンの初期化(Worker)に失敗しました: ' + err.message + ' (辞書パスを確認: kuromoji/dict/)' });
        throw err;
    }
    tokenizer = _tokenizer;
    // 初期化完了をメインスレッドに通知 (任意)
    self.postMessage({ type: 'initialized' });
    console.log('Worker: Kuromoji initialized from local files (relative path)');
});

// メインスレッドからのメッセージを受信
self.onmessage = function(event) {
    // 全体テキストと目標チャンクサイズを受け取る
    const { text, targetChunkSize } = event.data;
    console.log(`Worker: Received full text, Target chunk size: ${targetChunkSize}`);
    console.log(`Worker: Text: ${text ? text.substring(0, 80) + '...' : ''}`);

    if (!tokenizer) {
        self.postMessage({ type: 'error', message: 'Worker: Tokenizer not ready yet.' });
        return;
    }
    if (!text) {
         self.postMessage({ type: 'error', message: 'Worker: No text received.' });
        return;
    }
    if (targetChunkSize <= 0) {
        self.postMessage({ type: 'error', message: 'Worker: Invalid chunk size.' });
       return;
   }

    try {
        // --- 1. テキスト全体の形態素解析 --- 
        console.log('Worker: Starting tokenization...');
        const tokens = tokenizer.tokenize(text);
        const totalTokens = tokens.length;
        console.log(`Worker: Tokenization complete (${totalTokens} tokens).`);

        // --- 1.5 トークンに行番号を付与 --- 
        let lineBreaks = [-1]; 
        for (let i = 0; i < text.length; i++) {
            if (text[i] === '\n') {
                lineBreaks.push(i);
            }
        }
        tokens.forEach(token => {
            let lineNumber = 0;
            for (let j = 0; j < lineBreaks.length; j++) {
                // token.word_position は 1-based index
                if (token.word_position - 1 > lineBreaks[j]) { 
                    lineNumber = j;
                } else {
                    break;
                }
            }
            token.originalLineNumber = lineNumber; // 0-based line number
        });
        console.log('Worker: Added line numbers to tokens.');

        // --- 2. チャンク生成と進捗送信 --- 
        console.log('Worker: Generating chunks...');
        const chunkData = []; // { chunk: string, originalLineNumber: number, startTokenIndex: number, endTokenIndex: number } の配列に変更
        let currentChunk = '';
        let currentChunkStartLine = -1; // 現在のチャンクが始まった行番号
        let currentChunkStartTokenIndex = 0; // ★★★ 現在のチャンクの開始トークンインデックスを追加 ★★★
        let currentLength = 0;
        let prefixForNextToken = '';
        let processedTokensCount = 0;

        for (let i = 0; i < tokens.length; i++) {
            const token = tokens[i];
            const tokenSurface = token.surface_form;
            const tokenLength = tokenSurface.length;
            const tokenPos = token.pos;
            const tokenLine = token.originalLineNumber;
            processedTokensCount = i + 1;

            let pushCurrentChunk = false;    // このループの最後に現在のチャンクを確定するか
            let nextChunkStartLine = -1;    // 次のチャンクの開始行番号（確定した場合）
            let nextChunkContent = '';     // 次のチャンクの初期内容（確定した場合）

            // --- 処理 --- 

            // 1. 区切り文字 (。) ※「、」では区切らないように変更
            if (tokenSurface === '。') {
                if (currentChunk) {
                    currentChunk += tokenSurface; // ★ 句読点を追加
                    currentLength += tokenSurface.length; // ★ 長さも更新
                    pushCurrentChunk = true;
                }
                nextChunkStartLine = -1; // 次は空から始まる
                nextChunkContent = '';
                prefixForNextToken = ''; 
            }
            // 2. 終わり括弧 (」) ） -> 通常トークンとして扱うため削除
            // 3. 始め括弧 (「) （ -> 通常トークンとして扱うため削除
            // 4. 助詞 (直前にチャンクあり)
            else if (tokenPos === '助詞' && currentChunk !== '') {
                const surfaceWithPrefix = prefixForNextToken + tokenSurface;
                const lengthWithPrefix = surfaceWithPrefix.length;
                prefixForNextToken = '';
                if (currentChunkStartLine === -1) currentChunkStartLine = tokenLine; // 開始行が未定なら設定

                if (currentLength + lengthWithPrefix <= targetChunkSize || currentLength < targetChunkSize / 2) {
                    currentChunk += surfaceWithPrefix;
                    currentLength += lengthWithPrefix;
                    // チャンク継続
                } else {
                    pushCurrentChunk = true;
                    nextChunkStartLine = tokenLine; // 助詞が新チャンクの開始
                    nextChunkContent = surfaceWithPrefix;
                }
            }
            // 5. 通常トークン
            else {
                const surfaceWithPrefix = prefixForNextToken + tokenSurface;
                const lengthWithPrefix = surfaceWithPrefix.length;
                prefixForNextToken = '';

                if (currentChunk !== '' && (currentLength + lengthWithPrefix > targetChunkSize || lengthWithPrefix > targetChunkSize)) {
                    pushCurrentChunk = true;
                    nextChunkStartLine = tokenLine; // このトークンが新チャンクの開始
                    nextChunkContent = surfaceWithPrefix;
                } else {
                    if (currentChunk === '') { // チャンク開始の場合
                        currentChunkStartLine = tokenLine; // 開始行を記録
                    }
                    currentChunk += surfaceWithPrefix;
                    currentLength += lengthWithPrefix;
                }
                 // 長すぎるトークン単体の処理
                 if (lengthWithPrefix > targetChunkSize && currentChunk === surfaceWithPrefix) {
                     pushCurrentChunk = true; // このチャンクを確定
                     nextChunkStartLine = -1; // 次は空から
                     nextChunkContent = '';
                 }
            }

            // --- チャンクの確定と次の準備 --- 
            if (pushCurrentChunk) { // まず、現在のチャンクを確定するかどうか
                if (currentChunk) { 
                     const resolvedStartLine = (currentChunkStartLine !== -1) ? currentChunkStartLine : tokenLine;
                     // ★★★ チャンクに対応するトークンインデックス範囲を追加 ★★★
                     const endTokenIndex = i -1; // 現在のループの直前のトークンまで
                     chunkData.push({
                         chunk: currentChunk,
                         originalLineNumber: resolvedStartLine,
                         startTokenIndex: currentChunkStartTokenIndex, // 開始インデックス
                         endTokenIndex: endTokenIndex >= currentChunkStartTokenIndex ? endTokenIndex : currentChunkStartTokenIndex // 終了インデックス (最低でも開始と同じ)
                     });
                     // 進捗送信
                     if (i % 50 === 0 || i === tokens.length - 1) {
                        self.postMessage({ type: 'progress', processed: processedTokensCount, total: totalTokens });
                     }
                 } 
                 // --- 次のチャンクの準備 --- 
                 currentChunk = nextChunkContent; // 次のチャンクの初期内容を設定
                 currentLength = nextChunkContent.length; // 長さも設定
                 currentChunkStartLine = nextChunkStartLine; // 次のチャンクの開始行を設定 (-1の場合もある)
                 // ★★★ 次のチャンクの開始トークンインデックスを記録 ★★★
                 currentChunkStartTokenIndex = i; // 現在のトークンが次の開始
            }
            
            // --- 進捗送信 (ループの最後など) --- 
            if (!pushCurrentChunk && (i % 100 === 0 || i === tokens.length - 1)) {
                // チャンクをpushしなかった場合でも進捗は送る
                self.postMessage({ type: 'progress', processed: processedTokensCount, total: totalTokens });
            }
        }

        // ループ終了後、最後のチャンクがあれば追加
        if (currentChunk) {
             const resolvedStartLine = (currentChunkStartLine !== -1) ? currentChunkStartLine : (tokens.length > 0 ? tokens[tokens.length-1].originalLineNumber : 0);
             // ★★★ 最後のチャンクのインデックス範囲 ★★★
             const endTokenIndex = tokens.length - 1;
             chunkData.push({
                 chunk: currentChunk,
                 originalLineNumber: resolvedStartLine,
                 startTokenIndex: currentChunkStartTokenIndex,
                 endTokenIndex: endTokenIndex >= currentChunkStartTokenIndex ? endTokenIndex : currentChunkStartTokenIndex
             });
        }

        // --- 3. 完了通知 --- 
        console.log('Worker: Chunk generation complete, sending done message with token indices'); // ログ変更
        self.postMessage({
             type: 'done',
             tokens: tokens, 
             chunkData: chunkData, // トークンインデックス情報が含まれたchunkData
             processed: totalTokens, 
             total: totalTokens 
        });

    } catch (e) {
        console.error(`Worker: Error during processing`, e);
        self.postMessage({ type: 'error', message: `処理中にエラー: ${e.message}` });
    }
};

// Worker自身の基本的なエラーハンドリング
self.onerror = function(event) {
    console.error('Worker: Uncaught error', event);
    // 必要ならメインスレッドに追加情報を送る
    self.postMessage({ type: 'error', message: 'Worker内で予期せぬエラーが発生しました。' });
}; 