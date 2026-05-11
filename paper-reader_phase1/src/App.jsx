// ============================================================
// 論文リーダー - フェーズ1: PDFの読み取りと表示
// ============================================================
//
// 【ファイル構成】
//   index.html  ← ブラウザが最初に読み込むHTMLファイル
//   src/
//     main.jsx  ← ReactをHTMLに差し込むエントリーポイント
//     index.css ← 全体共通のスタイル
//     App.jsx   ← このファイル。アプリの本体
//
// 【使用ライブラリ】
//   PDF.js (ピーディーエフ ジェイエス)
//     - Mozilla（ファイアフォックスの開発元）が作ったPDF表示ライブラリ
//     - PDFファイルをCanvas（キャンバス）という描画領域に表示する
//     - CDN（コンテンツ デリバリー ネットワーク）経由で読み込む
//       CDN = インターネット上に置かれたファイル配布サーバー
//
//   React (リアクト)
//     - UIの状態管理と画面の更新を担当するライブラリ
//     - useState, useEffect, useRef, useCallback を使う
//
// ============================================================

import { useState, useRef, useEffect, useCallback } from "react";

// ── 定数 ────────────────────────────────────────────────────
// PDF.jsのバージョンとCDNのURL
// バージョンを変えたいときはここだけ変更すればOK
const PDFJS_VERSION = "3.11.174";
const PDFJS_CDN = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}`;

// ── カスタムフック: PDF.jsの読み込み ────────────────────────
// 【カスタムフックとは？】
//   Reactの機能（useState, useEffect など）をまとめた自作の関数。
//   "use" で始まる名前にするのがルール。
//
// 【この関数がやること】
//   1. PDF.jsのスクリプト（JavaScriptファイル）をCDNから読み込む
//   2. 読み込みが完了したら ready = true にする
//   3. ready の値を呼び出し元に返す
function usePdfJs() {
  // ready: PDF.jsの読み込みが完了したかどうかのフラグ（旗）
  // false = まだ読み込み中 / true = 使える状態
  const [ready, setReady] = useState(false);

  
useEffect(() => {
  if (window.pdfjsLib) { setReady(true); return; }

    // <script> タグをJavaScriptで動的に作成してページに追加する
  const script = document.createElement("script");
  script.src = `${PDFJS_CDN}/pdf.min.js`;

  script.onload = () => {
      // workerSrc（ワーカーソース）の設定
      // Worker（ワーカー）= 重い処理を「別スレッド」で実行する仕組み
      // これを設定することで、PDF解析中にUIがフリーズしなくなる
    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
      `${PDFJS_CDN}/pdf.worker.min.js`;
    setReady(true);
  };

    // <head> タグの中にscriptを追加する
    document.head.appendChild(script);
}, []); // [] = このeffectは最初の1回だけ実行する

  return ready;
}

// ── メインコンポーネント ─────────────────────────────────────
// 【コンポーネントとは？】
//   画面のパーツ（部品）を表す関数。
//   この関数が返すJSX（HTMLに似た書き方）が画面に表示される。
export default function App() {

  // PDF.jsが使える状態かどうかを取得
  const pdfJsReady = usePdfJs();

  // ──────────────────────────────────────────────────────────
  // 【状態管理 (useState)】
  // useState(初期値) を使って「変化する値」を管理する。
  // 値が変わると、Reactが自動で画面を再描画してくれる。
  // ──────────────────────────────────────────────────────────

  // 読み込んだPDFのオブジェクト（null = まだ読み込んでいない）
  const [pdfDoc, setPdfDoc] = useState(null);

  // 今表示しているページ番号（1始まり）
  const [currentPage, setCurrentPage] = useState(1);

  // PDFの総ページ数
  const [totalPages, setTotalPages] = useState(0);

  // 表示倍率（1.4 = 140%表示）
  // ← ここを変えると起動時のデフォルト倍率が変わる
  const [scale, setScale] = useState(1.4);

  // PDFを読み込み中かどうかのフラグ
  const [isLoading, setIsLoading] = useState(false);

  // 読み込んだファイルの名前（ヘッダーに表示する）
  const [fileName, setFileName] = useState("");

  // ファイルをドラッグ中かどうかのフラグ（ドロップゾーンの色変化に使う）
  const [isDragging, setIsDragging] = useState(false);

  // 描画エラーのメッセージ（エラーなし = null）
  const [renderError, setRenderError] = useState(null);

  // ──────────────────────────────────────────────────────────
  // 【DOM参照 (useRef)】
  // useRef は「DOMの要素」や「再描画をトリガーしたくない値」に使う。
  // useStateと違い、値が変わっても画面は再描画されない。
  // ──────────────────────────────────────────────────────────

  // PDFを描画するCanvas（キャンバス）要素への参照
  const canvasRef = useRef(null);

  // 実行中のPDF描画タスクへの参照（ページ切り替え時にキャンセルするため）
  const renderTaskRef = useRef(null);

  // ファイル選択ボタン（非表示のinput要素）への参照
  const fileInputRef = useRef(null);

  // 「開く」ボタン用のファイル選択input（PDF表示後に別のPDFを開くとき）
  const fileInputRef2 = useRef(null);

  // ──────────────────────────────────────────────────────────
  // 【PDFページの描画処理】
  // useCallback を使う理由:
  //   この関数は useEffect の依存配列に入れるため、
  //   毎回再生成されると無限ループになってしまう。
  //   useCallback で「依存配列が変わらない限り同じ関数を使い回す」
  // ──────────────────────────────────────────────────────────
  const renderPage = useCallback(async (doc, pageNum, pageScale) => {
    // docかcanvasがない場合は何もしない
    if (!doc || !canvasRef.current) return;

    // 前のページの描画がまだ終わっていればキャンセルする
    // （素早くページをめくったときに前の描画が残らないようにする）
    if (renderTaskRef.current) {
      renderTaskRef.current.cancel();
      renderTaskRef.current = null;
    }

    setRenderError(null);

    try {
      // PDF.jsで指定ページのオブジェクトを取得
      const page = await doc.getPage(pageNum);

      // viewport（ビューポート）= ページのサイズ情報
      // scale（倍率）を掛けた実際の表示サイズを計算してくれる
      const viewport = page.getViewport({ scale: pageScale });

      const canvas = canvasRef.current;
      const context = canvas.getContext("2d"); // 2D描画コンテキストを取得

      // CanvasのサイズをPDFページのサイズに合わせる
      canvas.height = viewport.height;
      canvas.width = viewport.width;

      // PDFをCanvasに描画するタスクを開始
      const renderTask = page.render({
        canvasContext: context,
        viewport: viewport,
      });

      // タスクを保存（次のページに切り替えるときキャンセルできるよう）
      renderTaskRef.current = renderTask;

      // 描画完了を待つ（awaitで非同期処理を同期的に書ける）
      await renderTask.promise;

    } catch (err) {
      // "RenderingCancelledException" は意図的なキャンセルなので無視
      // それ以外のエラーだけ画面に表示する
      if (err.name !== "RenderingCancelledException") {
        console.error("描画エラー:", err);
        setRenderError("ページの描画に失敗しました");
      }
    }
  }, []); // 依存配列が空 = 最初の1回だけ関数を作る

  // ──────────────────────────────────────────────────────────
  // 【再描画トリガー】
  // pdfDoc・currentPage・scale のどれかが変わったら再描画する
  // ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (pdfDoc) {
      renderPage(pdfDoc, currentPage, scale);
    }
  }, [pdfDoc, currentPage, scale, renderPage]);

  // ──────────────────────────────────────────────────────────
  // 【PDFファイルの読み込み処理】
  // FileReader API（ファイルリーダー エーピーアイ）を使う。
  // ブラウザのセキュリティ上、ローカルファイルはこのAPIでしか読めない。
  // ──────────────────────────────────────────────────────────
  const loadPdfFile = useCallback(async (file) => {
    // PDFファイル以外が渡された場合は弾く
    if (!file || file.type !== "application/pdf") {
      alert("PDFファイルを選択してください");
      return;
    }

    // PDF.jsがまだ読み込まれていない場合は待つよう伝える
    if (!pdfJsReady) {
      alert("PDF.jsがまだ読み込まれていません。少々お待ちください。");
      return;
    }

    // 状態をリセット（前のPDFの情報をクリア）
    setIsLoading(true);
    setFileName(file.name);
    setPdfDoc(null);
    setCurrentPage(1);
    setTotalPages(0);

    // FileReader でファイルをArrayBuffer（バイナリデータ）として読み込む
    const reader = new FileReader();

    reader.onload = async (e) => {
      try {
        // e.target.result にArrayBuffer形式のデータが入っている
        // Uint8Array（ユーイント8アレイ）= バイト配列。PDF.jsが要求する形式
        const typedArray = new Uint8Array(e.target.result);

        // PDF.jsでPDFを解析してドキュメントオブジェクトを取得
        const loadingTask = window.pdfjsLib.getDocument({ data: typedArray });
        const doc = await loadingTask.promise;

        // 状態を更新（これでReactが画面を再描画する）
        setPdfDoc(doc);
        setTotalPages(doc.numPages);

      } catch (err) {
        console.error("PDF読み込みエラー:", err);
        alert("PDFの読み込みに失敗しました");
      } finally {
        // エラーがあってもなくてもローディングを終了する
        setIsLoading(false);
      }
    };

    // ← ここが FileReader API の核心
    // readAsArrayBuffer = ファイルをバイナリとして読む（画像やPDFに使う）
    // 他にも readAsText（テキスト）、readAsDataURL（base64）などがある
    reader.readAsArrayBuffer(file);

  }, [pdfJsReady]); // pdfJsReady が変わったら関数を作り直す

  // ── ドラッグ&ドロップのイベント処理 ────────────────────────

  const handleDragOver = (e) => {
    e.preventDefault(); // ← 必須！これがないとdropイベントが発火しない
    setIsDragging(true);
  };

  const handleDragLeave = () => setIsDragging(false);

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    // e.dataTransfer.files = ドロップされたファイルの一覧
    // [0] で最初のファイルだけ取得
    const file = e.dataTransfer.files[0];
    loadPdfFile(file);
  };

  // ── ページナビゲーション ─────────────────────────────────

  // 前のページへ（最小は1ページ目）
  const goToPrevPage = () => setCurrentPage((p) => Math.max(1, p - 1));

  // 次のページへ（最大は最終ページ）
  const goToNextPage = () => setCurrentPage((p) => Math.min(totalPages, p + 1));

  // ページ番号を直接入力したとき
  const handlePageInput = (e) => {
    const val = parseInt(e.target.value);
    // 有効な数値かつ範囲内の場合のみ更新
    if (!isNaN(val) && val >= 1 && val <= totalPages) {
      setCurrentPage(val);
    }
  };

  // ──────────────────────────────────────────────────────────
  // 【スタイル定義】
  // CSSをJavaScriptのオブジェクトとして書く「CSS-in-JS」スタイル。
  // 通常のCSSと違い、キャメルケース（backgroundColor など）で書く。
  // ← ここを編集してデザインをカスタマイズできる！
  // ──────────────────────────────────────────────────────────

  // ▼▼▼ デザインのカスタマイズはここから ▼▼▼

  // アクセントカラー（ゴールド系）← ここを変えると全体の色が変わる
  const ACCENT = "#c8b89a";

  const styles = {
    // ── アプリ全体のラッパー ──
    app: {
      minHeight: "100vh",
      background: "#0f0f13",       // ← 背景色
      color: "#e8e6e0",             // ← 文字色
      fontFamily: "'Georgia', 'Times New Roman', serif",
      display: "flex",
      flexDirection: "column",
    },

    // ── ヘッダー ──
    header: {
      borderBottom: "1px solid #2a2a35",
      padding: "16px 24px",
      display: "flex",
      alignItems: "center",
      gap: "16px",
      background: "#13131a",        // ← ヘッダーの背景色
    },
    logo: {
      fontSize: "20px",
      fontWeight: "bold",
      color: ACCENT,                // ← ロゴの色
    },
    badge: {
      fontSize: "11px",
      background: "#2a2a35",
      color: "#7a7a9a",
      padding: "2px 8px",
      borderRadius: "10px",
      border: "1px solid #3a3a4a",
    },
    fileName: {
      marginLeft: "auto",
      fontSize: "13px",
      color: "#7a7a9a",
      maxWidth: "300px",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
    },

    // ── メインエリア ──
    body: {
      flex: 1,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      padding: "32px 24px",         // ← 余白（上下 左右）
      gap: "24px",                  // ← 要素間の隙間
    },

    // ── フェーズ説明ノート ──
    phaseNote: {
      maxWidth: "640px",
      background: "#13131a",
      border: "1px solid #2a2a35",
      borderLeft: `3px solid ${ACCENT}`, // ← 左の色ライン
      borderRadius: "6px",
      padding: "16px 20px",
      fontSize: "13px",
      color: "#7a7a9a",
      lineHeight: "1.7",
    },

    // ── ドロップゾーン ──
    // dragging引数でドラッグ中かどうかを受け取って見た目を変える
    dropzone: (dragging) => ({
      width: "100%",
      maxWidth: "600px",
      border: `2px dashed ${dragging ? ACCENT : "#3a3a4a"}`, // ← ドラッグ中は色が変わる
      borderRadius: "12px",
      padding: "64px 32px",         // ← 内側の余白（大きくすると縦幅が広がる）
      textAlign: "center",
      cursor: "pointer",
      transition: "all 0.2s",
      background: dragging ? "rgba(200,184,154,0.05)" : "transparent",
    }),
    dropIcon: {
      fontSize: "48px",             // ← アイコンサイズ
      marginBottom: "16px",
    },
    dropTitle: {
      fontSize: "18px",
      color: ACCENT,
      marginBottom: "8px",
    },
    dropSub: {
      fontSize: "13px",
      color: "#5a5a7a",
    },
    uploadBtn: {
      marginTop: "20px",
      padding: "10px 24px",
      background: ACCENT,           // ← ボタンの背景色
      color: "#0f0f13",             // ← ボタンの文字色
      border: "none",
      borderRadius: "6px",
      cursor: "pointer",
      fontSize: "14px",
      fontFamily: "inherit",
    },

    // ── ツールバー（PDF表示後に出るページ操作バー）──
    toolbar: {
      display: "flex",
      alignItems: "center",
      gap: "12px",
      background: "#13131a",
      border: "1px solid #2a2a35",
      borderRadius: "10px",
      padding: "10px 16px",
      flexWrap: "wrap",             // 画面が狭いときに折り返す
    },

    // ページ送りボタン（disabled = 無効状態かどうかで見た目を変える）
    navBtn: (disabled) => ({
      background: disabled ? "#1a1a22" : "#2a2a35",
      border: "1px solid #3a3a4a",
      color: disabled ? "#3a3a4a" : ACCENT,
      width: "36px",
      height: "36px",
      borderRadius: "6px",
      cursor: disabled ? "default" : "pointer",
      fontSize: "16px",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
    }),

    // ページ番号の入力欄
    pageInput: {
      background: "#1a1a22",
      border: "1px solid #3a3a4a",
      color: "#e8e6e0",
      width: "48px",
      padding: "6px",
      borderRadius: "4px",
      textAlign: "center",
      fontSize: "14px",
      fontFamily: "inherit",
    },
    pageTotal: {
      color: "#5a5a7a",
      fontSize: "14px",
    },

    // ツールバーの区切り線
    divider: {
      width: "1px",
      height: "24px",
      background: "#2a2a35",
    },

    // 倍率ボタン（active = 現在選択中かどうか）
    scaleBtn: (active) => ({
      background: active ? ACCENT : "#2a2a35", // ← 選択中はアクセント色
      border: "1px solid #3a3a4a",
      color: active ? "#0f0f13" : "#9a9aba",
      padding: "6px 12px",
      borderRadius: "4px",
      cursor: "pointer",
      fontSize: "12px",
    }),

    // ── PDF表示エリア ──
    canvasWrap: {
      background: "#1a1a22",
      border: "1px solid #2a2a35",
      borderRadius: "8px",
      padding: "24px",
      boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
      maxWidth: "100%",
      overflow: "auto",             // PDFが大きい場合にスクロール可能にする
    },

    // ── ローディング表示 ──
    loadingWrap: {
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: "16px",
      color: "#5a5a7a",
      padding: "64px",
    },
    spinner: {
      width: "40px",
      height: "40px",
      border: "3px solid #2a2a35",
      borderTop: `3px solid ${ACCENT}`, // ← スピナーの色
      borderRadius: "50%",
      animation: "spin 0.8s linear infinite",
    },
  };

  // ▲▲▲ デザインのカスタマイズはここまで ▲▲▲

  // ──────────────────────────────────────────────────────────
  // 【JSX（ジェイエスエックス）= 画面の構造】
  // HTMLに似ているが、JavaScriptの中に書ける特殊な構文。
  // {} の中には JavaScript の式を書ける。
  // ──────────────────────────────────────────────────────────
  return (
    <div style={styles.app}>

      {/* ── ヘッダー ── */}
      <header style={styles.header}>
        <span style={styles.logo}>📄 論文リーダー</span>
        <span style={styles.badge}>Phase 1</span>
        {/* fileName が空文字でなければ表示する */}
        {fileName && <span style={styles.fileName}>{fileName}</span>}
      </header>

      <main style={styles.body}>

        {/* ── フェーズ説明ノート ── */}
        <div style={styles.phaseNote}>
          <strong style={{ color: ACCENT }}>🔬 フェーズ1: PDF読み取りと表示</strong><br />
          PDF.js を使ってブラウザ上でPDFを表示します。<br />
          PDFファイルをドラッグ＆ドロップするか、ボタンからアップロードしてください。<br />
          次フェーズ: 和訳機能（Claude API連携）を追加予定。
        </div>

        {/* ── ドロップゾーン（PDFが未読み込みかつ読み込み中でないとき表示）── */}
        {!pdfDoc && !isLoading && (
          <div
            style={styles.dropzone(isDragging)}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            {/* 非表示のファイル選択input。ドロップゾーンクリックで間接的に起動 */}
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf"
              style={{ display: "none" }}
              onChange={(e) => loadPdfFile(e.target.files[0])}
            />
            <div style={styles.dropIcon}>📑</div>
            <div style={styles.dropTitle}>PDFをドラッグ＆ドロップ</div>
            <div style={styles.dropSub}>または</div>
            <button
              style={styles.uploadBtn}
              onClick={(e) => {
                // stopPropagation = クリックイベントが親要素にも伝わるのを防ぐ
                // （親のonClickも発火してしまうのを防ぐ）
                e.stopPropagation();
                fileInputRef.current?.click();
              }}
            >
              ファイルを選択
            </button>
          </div>
        )}

        {/* ── ローディング中 ── */}
        {isLoading && (
          <div style={styles.loadingWrap}>
            <div style={styles.spinner} />
            <span>PDFを読み込み中...</span>
          </div>
        )}

        {/* ── PDF表示エリア（PDFが読み込まれたら表示）── */}
        {pdfDoc && !isLoading && (
          <>
            {/* ツールバー */}
            <div style={styles.toolbar}>

              {/* 前のページボタン */}
              <button
                style={styles.navBtn(currentPage <= 1)}
                onClick={goToPrevPage}
                disabled={currentPage <= 1}
              >
                ‹
              </button>

              {/* ページ番号の直接入力 */}
              <input
                type="number"
                style={styles.pageInput}
                value={currentPage}
                min={1}
                max={totalPages}
                onChange={handlePageInput}
              />
              <span style={styles.pageTotal}>/ {totalPages}</span>

              {/* 次のページボタン */}
              <button
                style={styles.navBtn(currentPage >= totalPages)}
                onClick={goToNextPage}
                disabled={currentPage >= totalPages}
              >
                ›
              </button>

              <div style={styles.divider} />

              {/* 倍率ボタン（配列.map で繰り返し生成する）*/}
              {/* ← ここに数値を追加すると倍率ボタンが増える */}
              {[0.8, 1.0, 1.4, 1.8].map((s) => (
                <button
                  key={s}
                  style={styles.scaleBtn(scale === s)}
                  onClick={() => setScale(s)}
                >
                  {Math.round(s * 100)}%
                </button>
              ))}

              <div style={styles.divider} />

              {/* 別のPDFを開くボタン */}
              <button
                style={styles.scaleBtn(false)}
                onClick={() => fileInputRef2.current?.click()}
              >
                📂 開く
              </button>
              <input
                ref={fileInputRef2}
                type="file"
                accept=".pdf"
                style={{ display: "none" }}
                onChange={(e) => loadPdfFile(e.target.files[0])}
              />
            </div>

            {/* PDFのCanvas描画エリア */}
            <div style={styles.canvasWrap}>
              {renderError ? (
                <div style={{ color: "#aa6060", padding: "32px" }}>
                  {renderError}
                </div>
              ) : (
                // ref={canvasRef} でこのcanvas要素をJavaScriptから操作できるようにする
                <canvas ref={canvasRef} />
              )}
            </div>
          </>
        )}

      </main>
    </div>
  );
}
