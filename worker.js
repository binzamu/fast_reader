// worker.js

// Kuromoji.jsをインポート (ローカルファイルから)
try {
    // CDNのURLを指定 → ローカルパスに変更
    importScripts('kuromoji/kuromoji.js');
} catch (e) {
    // エラーをメインスレッドに通知
    self.postMessage({ type: 'error', message: 'Kuromoji.jsの読み込みに失敗しました: ' + e.message });
    throw e; // Workerを停止させる
}

let tokenizer = null;

// Kuromojiの初期化 (ローカル辞書から)
// CDNのパス → ローカルパスに変更
kuromoji.builder({ dicPath: 'kuromoji/dict/' }).build((err, _tokenizer) => {
    if (err) {
        self.postMessage({ type: 'error', message: '形態素解析エンジンの初期化(Worker)に失敗しました: ' + err.message + ' (辞書パスを確認: kuromoji/dict/)' });
        throw err;
    }
    tokenizer = _tokenizer;
    // 初期化完了をメインスレッドに通知 (任意)
    self.postMessage({ type: 'initialized' });
    console.log('Worker: Kuromoji initialized from local files');
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
        const chunkData = []; // { chunk: string, originalLineNumber: number } の配列
        let currentChunk = '';
        let currentChunkStartLine = -1; // 現在のチャンクが始まった行番号
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

            // 1. 区切り文字 (、。)
            if (tokenSurface === '、' || tokenSurface === '。') {
                if (currentChunk) pushCurrentChunk = true;
                nextChunkStartLine = -1; // 次は空から始まる
                nextChunkContent = '';
                prefixForNextToken = ''; 
            }
            // 2. 終わり括弧 (」) ）
            else if (tokenSurface === '」' || tokenSurface === '）') {
                if (currentChunk) {
                    currentChunk += tokenSurface; 
                    pushCurrentChunk = true;
                }
                nextChunkStartLine = -1;
                nextChunkContent = '';
                prefixForNextToken = '';
            }
            // 3. 始め括弧 (「) （
            else if (tokenSurface === '「' || tokenSurface === '（') {
                if (currentChunk) pushCurrentChunk = true;
                nextChunkStartLine = -1; // 次のトークンで開始行が決まる
                nextChunkContent = '';
                prefixForNextToken = tokenSurface; // 次のトークンにつける
            }
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
                     // 確定するチャンクの情報（現在のcurrentChunkとcurrentChunkStartLine）を保存
                     // currentChunkStartLine が -1 のままなら、現在のトークンの行を使う（括弧などが先行した場合）
                     const resolvedStartLine = (currentChunkStartLine !== -1) ? currentChunkStartLine : tokenLine;
                     chunkData.push({ chunk: currentChunk, originalLineNumber: resolvedStartLine });
                     // 進捗送信
                     if (i % 50 === 0 || i === tokens.length - 1) {
                        self.postMessage({ type: 'progress', processed: processedTokensCount, total: totalTokens });
                     }
                 } 
                 // --- 次のチャンクの準備 --- 
                 currentChunk = nextChunkContent; // 次のチャンクの初期内容を設定
                 currentLength = nextChunkContent.length; // 長さも設定
                 currentChunkStartLine = nextChunkStartLine; // 次のチャンクの開始行を設定 (-1の場合もある)
                 // nextChunkContentとnextChunkStartLineはこのループイテレーションの処理で決定されている
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
             chunkData.push({ chunk: currentChunk, originalLineNumber: resolvedStartLine });
        }

        // --- 3. 完了通知 --- 
        console.log('Worker: Chunk generation complete, sending done message');
        self.postMessage({
             type: 'done',
             tokens: tokens, 
             chunkData: chunkData, 
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