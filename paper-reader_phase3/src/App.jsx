// ============================================================
// 論文リーダー - フェーズ2: 右サイドバー＋右クリックメニュー
// ============================================================
//
// 【フェーズ1.5からの追加点】
//
//   右クリックメニュー（コンテキストメニュー）:
//     ブラウザデフォルトの右クリックメニューを抑制し、
//     カスタムメニューを表示する。
//     onContextMenu イベントで制御する。
//
//   右サイドバー:
//     検索結果とコメントを表示するパネル。
//     画面右側に固定表示される。
//
//   コメント機能:
//     選択テキスト＋ページ番号＋メモをオブジェクトとして保存。
//     配列（useState）で管理する。
//
//   【API枠として確保済み】
//     翻訳ボタン   → フェーズ3でClaude API連携予定
//     用語説明ボタン → フェーズ3でClaude API連携予定
// ============================================================

import { useState, useRef, useEffect, useCallback } from "react";

const PDFJS_VERSION = "3.11.174";
const PDFJS_CDN = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}`;

// ── カスタムフック: PDF.jsの読み込み ────────────────────────
function usePdfJs() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (window.pdfjsLib) { setReady(true); return; }
    const script = document.createElement("script");
    script.src = `${PDFJS_CDN}/pdf.min.js`;
    script.onload = () => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc =
        `${PDFJS_CDN}/pdf.worker.min.js`;
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = `${PDFJS_CDN}/pdf_viewer.min.css`;
      document.head.appendChild(link);
      setReady(true);
    };
    document.head.appendChild(script);
  }, []);
  return ready;
}

// ── メインコンポーネント ─────────────────────────────────────
export default function App() {
  const pdfJsReady = usePdfJs();

  // ── 状態管理 ─────────────────────────────────────────────
  const [pdfDoc,      setPdfDoc]      = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages,  setTotalPages]  = useState(0);
  const [scale,       setScale]       = useState(1.4);
  const [isLoading,   setIsLoading]   = useState(false);
  const [fileName,    setFileName]    = useState("");
  const [isDragging,  setIsDragging]  = useState(false);
  const [renderError, setRenderError] = useState(null);
  const [selectedText, setSelectedText] = useState("");

  // ── フェーズ2で追加: 右クリックメニューの状態 ─────────────
  // contextMenu: メニューの表示位置と対象テキストを保持
  // null = 非表示 / { x, y, text } = 表示中
  const [contextMenu, setContextMenu] = useState(null);

  // ── フェーズ2で追加: サイドバーの状態 ──────────────────────
  // sidebarOpen: サイドバーの開閉フラグ
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // activeTab: サイドバーの表示タブ（"comments" | "search"）
  const [activeTab, setActiveTab] = useState("comments");

  // comments: コメントの配列
  // 各コメントの構造:
  // { id, text（選択テキスト）, note（メモ）, page（ページ番号）, createdAt }
  const [comments, setComments] = useState([]);

  // commentInput: コメント入力中のメモテキスト
  const [commentInput, setCommentInput] = useState("");

  // commentTarget: コメントを追加しようとしている選択テキスト情報
  const [commentTarget, setCommentTarget] = useState(null);

  // searchResults: 検索結果（将来のAPI連携時に使う）
  // 現在はGoogle検索を新タブで開くだけなので空配列
  const [searchResults] = useState([]);

  // ── DOM参照 ──────────────────────────────────────────────
  const canvasRef      = useRef(null);
  const renderTaskRef  = useRef(null);
  const fileInputRef   = useRef(null);
  const fileInputRef2  = useRef(null);
  const textLayerRef   = useRef(null);
  const commentInputRef = useRef(null); // コメント入力欄へのフォーカス用

  // ── PDFページの描画処理 ──────────────────────────────────
  const renderPage = useCallback(async (doc, pageNum, pageScale) => {
    if (!doc || !canvasRef.current) return;
    if (renderTaskRef.current) {
      renderTaskRef.current.cancel();
      renderTaskRef.current = null;
    }
    setRenderError(null);
    try {
      const page     = await doc.getPage(pageNum);
      const viewport = page.getViewport({ scale: pageScale });
      const canvas   = canvasRef.current;
      const context  = canvas.getContext("2d");
      canvas.height  = viewport.height;
      canvas.width   = viewport.width;
      const renderTask = page.render({ canvasContext: context, viewport });
      renderTaskRef.current = renderTask;
      await renderTask.promise;

      // テキストレイヤーの描画
      if (textLayerRef.current) {
        textLayerRef.current.innerHTML    = "";
        textLayerRef.current.style.width  = `${viewport.width}px`;
        textLayerRef.current.style.height = `${viewport.height}px`;
        const textContent = await page.getTextContent();
        const tl = window.pdfjsLib.renderTextLayer({
          textContentSource: textContent,
          container: textLayerRef.current,
          viewport,
        });
        await tl.promise;
      }
    } catch (err) {
      if (err.name !== "RenderingCancelledException") {
        setRenderError("ページの描画に失敗しました");
      }
    }
  }, []);

  useEffect(() => {
    if (pdfDoc) renderPage(pdfDoc, currentPage, scale);
  }, [pdfDoc, currentPage, scale, renderPage]);

  // ── PDFファイルの読み込み ────────────────────────────────
  const loadPdfFile = useCallback(async (file) => {
    if (!file || file.type !== "application/pdf") {
      alert("PDFファイルを選択してください"); return;
    }
    if (!pdfJsReady) {
      alert("PDF.jsがまだ読み込まれていません。"); return;
    }
    setIsLoading(true); setFileName(file.name);
    setPdfDoc(null); setCurrentPage(1); setTotalPages(0);
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const doc = await window.pdfjsLib
          .getDocument({ data: new Uint8Array(e.target.result) }).promise;
        setPdfDoc(doc); setTotalPages(doc.numPages);
      } catch { alert("PDFの読み込みに失敗しました"); }
      finally { setIsLoading(false); }
    };
    reader.readAsArrayBuffer(file);
  }, [pdfJsReady]);

  // ── 通常のマウスイベント ─────────────────────────────────
  const handleDragOver  = (e) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = () => setIsDragging(false);
  const handleDrop      = (e) => {
    e.preventDefault(); setIsDragging(false);
    loadPdfFile(e.dataTransfer.files[0]);
  };
  const goToPrevPage    = () => setCurrentPage((p) => Math.max(1, p - 1));
  const goToNextPage    = () => setCurrentPage((p) => Math.min(totalPages, p + 1));
  const handlePageInput = (e) => {
    const v = parseInt(e.target.value);
    if (!isNaN(v) && v >= 1 && v <= totalPages) setCurrentPage(v);
  };

  // マウスを離したとき: 選択テキストを取得
  const handleMouseUp = () => {
    const text = window.getSelection()?.toString().trim();
    if (text) setSelectedText(text);
  };

  // ── フェーズ2で追加: 右クリックメニューの処理 ─────────────
  // onContextMenu: 右クリック時に発火するイベント
  // e.preventDefault() でブラウザデフォルトメニューを抑制する
  const handleContextMenu = (e) => {
    e.preventDefault(); // ← ブラウザデフォルトの右クリックメニューを出さない

    // 右クリック時点での選択テキストを取得
    const text = window.getSelection()?.toString().trim();
    if (!text) return; // テキスト未選択なら何もしない

    // メニューの表示位置（マウスカーソルの位置）と対象テキストを保存
    setContextMenu({
      x: e.clientX, // 画面左端からの距離
      y: e.clientY, // 画面上端からの距離
      text,
    });
  };

  // 右クリックメニューを閉じる
  const closeContextMenu = () => setContextMenu(null);

  // 【Google検索】
  // encodeURIComponent: URLに使えない文字（スペースなど）をエンコードする
  // 例: "machine learning" → "machine%20learning"
  const handleGoogleSearch = (text) => {
    const url = `https://www.google.com/search?q=${encodeURIComponent(text)}`;
    window.open(url, "_blank"); // "_blank" = 新しいタブで開く
    closeContextMenu();
    // サイドバーを検索タブに切り替えて開く
    setSidebarOpen(true);
    setActiveTab("search");
  };

  // 【コメント追加の開始】
  // 右クリックメニューから「コメント追加」を選んだとき
  const handleAddCommentStart = (text) => {
    setCommentTarget({ text, page: currentPage });
    setCommentInput("");
    closeContextMenu();
    // サイドバーをコメントタブで開く
    setSidebarOpen(true);
    setActiveTab("comments");
    // 少し待ってから入力欄にフォーカス（DOMが更新されてから）
    setTimeout(() => commentInputRef.current?.focus(), 100);
  };

  // 【コメントの保存】
  const handleSaveComment = () => {
    if (!commentTarget) return;
    const newComment = {
      id: Date.now(), // ユニークなIDとして現在時刻のミリ秒を使う
      text: commentTarget.text,   // 選択テキスト
      note: commentInput,         // ユーザーが入力したメモ
      page: commentTarget.page,   // ページ番号
      createdAt: new Date().toLocaleTimeString("ja-JP"), // 作成時刻
    };
    // 配列の先頭に追加（最新が上に来る）
    setComments((prev) => [newComment, ...prev]);
    setCommentTarget(null);
    setCommentInput("");
  };

  // 【コメントの削除】
  const handleDeleteComment = (id) => {
    setComments((prev) => prev.filter((c) => c.id !== id));
  };

  // ── フェーズ3で実装予定のAPI連携関数（枠だけ確保） ────────
  // これらの関数は現在は何もしない。
  // フェーズ3でClaude APIを呼び出す処理に置き換える。
  const handleTranslate = (text) => {
    // TODO: Claude APIで翻訳する処理をここに書く
    console.log("翻訳予定:", text);
    closeContextMenu();
    setSidebarOpen(true);
  };
  const handleExplainTerm = (text) => {
    // TODO: Claude APIで用語説明する処理をここに書く
    console.log("用語説明予定:", text);
    closeContextMenu();
    setSidebarOpen(true);
  };

  // ── スタイル定義 ─────────────────────────────────────────
  // ▼▼▼ デザインのカスタマイズはここから ▼▼▼

  const ACCENT = "#c8b89a";

  const styles = {
    // アプリ全体: 横並びレイアウト（PDF + サイドバー）
    app: {
      minHeight: "100vh",
      background: "#0f0f13",
      color: "#e8e6e0",
      fontFamily: "'Georgia', 'Times New Roman', serif",
      display: "flex",
      flexDirection: "column",
    },
    header: {
      borderBottom: "1px solid #2a2a35",
      padding: "16px 24px",
      display: "flex", alignItems: "center", gap: "16px",
      background: "#13131a",
      flexShrink: 0, // ヘッダーは縮まない
    },
    logo:     { fontSize: "20px", fontWeight: "bold", color: ACCENT },
    badge:    { fontSize: "11px", background: "#2a2a35", color: "#7a7a9a", padding: "2px 8px", borderRadius: "10px", border: "1px solid #3a3a4a" },
    fileName: { fontSize: "13px", color: "#7a7a9a", maxWidth: "200px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
    sidebarToggle: {
      marginLeft: "auto",
      background: sidebarOpen ? ACCENT : "#2a2a35",
      border: "1px solid #3a3a4a",
      color: sidebarOpen ? "#0f0f13" : "#9a9aba",
      padding: "6px 14px",
      borderRadius: "6px",
      cursor: "pointer",
      fontSize: "13px",
    },

    // メインエリア: PDF部分とサイドバーを横並びに
    main: {
      flex: 1,
      display: "flex",
      overflow: "hidden", // 子要素のスクロールを独立させる
    },

    // PDF表示エリア（左側）
    pdfArea: {
      flex: 1,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      padding: "24px",
      gap: "16px",
      overflowY: "auto", // PDFが長い場合にスクロール
    },

    phaseNote: {
      maxWidth: "640px", width: "100%",
      background: "#13131a",
      border: "1px solid #2a2a35", borderLeft: `3px solid ${ACCENT}`,
      borderRadius: "6px", padding: "14px 18px",
      fontSize: "12px", color: "#7a7a9a", lineHeight: "1.7",
    },

    dropzone: (d) => ({
      width: "100%", maxWidth: "560px",
      border: `2px dashed ${d ? ACCENT : "#3a3a4a"}`,
      borderRadius: "12px", padding: "56px 32px",
      textAlign: "center", cursor: "pointer", transition: "all 0.2s",
      background: d ? "rgba(200,184,154,0.05)" : "transparent",
    }),
    uploadBtn: {
      marginTop: "16px", padding: "10px 24px",
      background: ACCENT, color: "#0f0f13",
      border: "none", borderRadius: "6px",
      cursor: "pointer", fontSize: "14px", fontFamily: "inherit",
    },
    toolbar: {
      display: "flex", alignItems: "center", gap: "10px",
      background: "#13131a", border: "1px solid #2a2a35",
      borderRadius: "10px", padding: "8px 14px", flexWrap: "wrap",
      width: "100%", maxWidth: "800px",
    },
    navBtn: (dis) => ({
      background: dis ? "#1a1a22" : "#2a2a35",
      border: "1px solid #3a3a4a",
      color: dis ? "#3a3a4a" : ACCENT,
      width: "34px", height: "34px", borderRadius: "6px",
      cursor: dis ? "default" : "pointer", fontSize: "16px",
      display: "flex", alignItems: "center", justifyContent: "center",
    }),
    pageInput: {
      background: "#1a1a22", border: "1px solid #3a3a4a",
      color: "#e8e6e0", width: "48px", padding: "5px",
      borderRadius: "4px", textAlign: "center",
      fontSize: "14px", fontFamily: "inherit",
    },
    pageTotal: { color: "#5a5a7a", fontSize: "14px" },
    divider:   { width: "1px", height: "22px", background: "#2a2a35" },
    scaleBtn: (a) => ({
      background: a ? ACCENT : "#2a2a35",
      border: "1px solid #3a3a4a",
      color: a ? "#0f0f13" : "#9a9aba",
      padding: "5px 10px", borderRadius: "4px",
      cursor: "pointer", fontSize: "12px",
    }),
    canvasWrap: {
      background: "#1a1a22", border: "1px solid #2a2a35",
      borderRadius: "8px", padding: "20px",
      boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
      maxWidth: "100%", overflow: "auto",
    },
    pdfWrapper: { position: "relative", display: "inline-block" },
    loadingWrap: {
      display: "flex", flexDirection: "column",
      alignItems: "center", gap: "16px",
      color: "#5a5a7a", padding: "64px",
    },
    spinner: {
      width: "40px", height: "40px",
      border: "3px solid #2a2a35",
      borderTop: `3px solid ${ACCENT}`,
      borderRadius: "50%",
      animation: "spin 0.8s linear infinite",
    },

    // ── フェーズ2で追加: 右サイドバー ──────────────────────
    sidebar: {
      width: sidebarOpen ? "320px" : "0",        // 開閉でwidthを変える
      minWidth: sidebarOpen ? "320px" : "0",
      background: "#13131a",
      borderLeft: "1px solid #2a2a35",
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
      transition: "width 0.25s ease, min-width 0.25s ease", // アニメーション
      flexShrink: 0,
    },
    sidebarHeader: {
      padding: "16px",
      borderBottom: "1px solid #2a2a35",
      display: "flex",
      gap: "8px",
      flexShrink: 0,
    },
    tabBtn: (active) => ({
      flex: 1,
      padding: "7px",
      background: active ? "#2a2a35" : "transparent",
      border: `1px solid ${active ? "#3a3a4a" : "transparent"}`,
      color: active ? ACCENT : "#5a5a7a",
      borderRadius: "6px",
      cursor: "pointer",
      fontSize: "12px",
      fontFamily: "inherit",
    }),
    sidebarBody: {
      flex: 1,
      overflowY: "auto",
      padding: "16px",
      display: "flex",
      flexDirection: "column",
      gap: "12px",
    },

    // コメント入力フォーム
    commentForm: {
      background: "#1a1a22",
      border: `1px solid ${ACCENT}`,
      borderRadius: "8px",
      padding: "12px",
      display: "flex",
      flexDirection: "column",
      gap: "8px",
    },
    commentQuote: {
      fontSize: "11px",
      color: "#7a7a9a",
      borderLeft: `2px solid ${ACCENT}`,
      paddingLeft: "8px",
      lineHeight: "1.5",
    },
    commentTextarea: {
      background: "#0f0f13",
      border: "1px solid #3a3a4a",
      color: "#e8e6e0",
      borderRadius: "4px",
      padding: "8px",
      fontSize: "13px",
      fontFamily: "inherit",
      resize: "vertical",
      minHeight: "72px",
      outline: "none",
    },
    commentSaveBtn: {
      background: ACCENT, color: "#0f0f13",
      border: "none", borderRadius: "4px",
      padding: "7px 12px", cursor: "pointer",
      fontSize: "12px", fontFamily: "inherit",
      alignSelf: "flex-end",
    },

    // コメントカード
    commentCard: {
      background: "#1a1a22",
      border: "1px solid #2a2a35",
      borderRadius: "8px",
      padding: "12px",
    },
    commentCardQuote: {
      fontSize: "11px", color: "#7a7a9a",
      borderLeft: `2px solid ${ACCENT}`,
      paddingLeft: "8px", marginBottom: "6px",
      lineHeight: "1.5",
    },
    commentCardNote: {
      fontSize: "13px", color: "#e8e6e0",
      lineHeight: "1.6", marginBottom: "8px",
    },
    commentCardMeta: {
      fontSize: "11px", color: "#5a5a7a",
      display: "flex", justifyContent: "space-between",
    },
    commentDeleteBtn: {
      background: "none", border: "none",
      color: "#5a5a7a", cursor: "pointer",
      fontSize: "12px",
    },

    // API枠カード（グレーアウト）
    apiPlaceholder: {
      background: "#1a1a22",
      border: "1px dashed #2a2a35",
      borderRadius: "8px",
      padding: "16px",
      textAlign: "center",
      color: "#3a3a4a",
      fontSize: "12px",
      lineHeight: "1.7",
    },

    // ── フェーズ2で追加: 右クリックメニュー ────────────────
    contextMenu: (x, y) => ({
      position: "fixed",
      top: y,
      left: x,
      background: "#1a1a22",
      border: "1px solid #3a3a4a",
      borderRadius: "8px",
      boxShadow: "0 8px 24px rgba(0,0,0,0.6)",
      zIndex: 1000, // 最前面に表示
      overflow: "hidden",
      minWidth: "180px",
    }),
    menuItem: (disabled) => ({
      padding: "10px 16px",
      cursor: disabled ? "default" : "pointer",
      fontSize: "13px",
      color: disabled ? "#3a3a4a" : "#e8e6e0",
      display: "flex", alignItems: "center", gap: "10px",
      borderBottom: "1px solid #2a2a35",
      background: "transparent",
      border: "none",
      width: "100%",
      textAlign: "left",
      fontFamily: "inherit",
    }),
    menuItemHover: {
      background: "#2a2a35",
    },
    menuDivider: {
      borderTop: "1px solid #2a2a35",
      margin: "4px 0",
    },
    menuLabel: {
      padding: "6px 16px 4px",
      fontSize: "10px",
      color: "#5a5a7a",
      letterSpacing: "0.08em",
    },
  };

  // ▲▲▲ デザインのカスタマイズはここまで ▲▲▲

  // ── JSX ─────────────────────────────────────────────────
  return (
    <div style={styles.app}
      // どこかをクリックしたら右クリックメニューを閉じる
      onClick={closeContextMenu}
    >
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        canvas { display: block; }
        .textLayer span {
          color: transparent; position: absolute;
          white-space: pre; cursor: text; transform-origin: 0% 0%;
        }
        .textLayer ::selection { background: rgba(210, 60, 60, 0.35); }
        .menu-item:hover { background: #2a2a35 !important; }
        .sidebar-body::-webkit-scrollbar { width: 4px; }
        .sidebar-body::-webkit-scrollbar-track { background: transparent; }
        .sidebar-body::-webkit-scrollbar-thumb { background: #2a2a35; border-radius: 4px; }
        .pdf-area::-webkit-scrollbar { width: 6px; }
        .pdf-area::-webkit-scrollbar-thumb { background: #2a2a35; border-radius: 4px; }
      `}</style>

      {/* ── ヘッダー ── */}
      <header style={styles.header}>
        <span style={styles.logo}>📄 論文リーダー</span>
        <span style={styles.badge}>Phase 2</span>
        {fileName && <span style={styles.fileName}>{fileName}</span>}
        {/* サイドバー開閉ボタン */}
        <button
          style={styles.sidebarToggle}
          onClick={(e) => { e.stopPropagation(); setSidebarOpen(o => !o); }}
        >
          {sidebarOpen ? "▶ サイドバーを閉じる" : "◀ サイドバーを開く"}
        </button>
      </header>

      {/* ── メインエリア（PDF + サイドバー横並び）── */}
      <div style={styles.main}>

        {/* ── 左: PDF表示エリア ── */}
        <div style={styles.pdfArea} className="pdf-area">

          <div style={styles.phaseNote}>
            <strong style={{ color: ACCENT }}>🔬 フェーズ2: 右クリックメニュー＋右サイドバー</strong><br />
            テキストを選択して右クリックすると、メニューが表示されます。<br />
            Google検索 → 新しいタブで開きます。<br />
            コメント追加 → 右サイドバーに保存されます。<br />
            翻訳・用語説明 → フェーズ3でClaude API連携予定。
          </div>

          {/* ドロップゾーン */}
          {!pdfDoc && !isLoading && (
            <div
              style={styles.dropzone(isDragging)}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <input ref={fileInputRef} type="file" accept=".pdf"
                style={{ display: "none" }}
                onChange={(e) => loadPdfFile(e.target.files[0])} />
              <div style={{ fontSize: "44px", marginBottom: "12px" }}>📑</div>
              <div style={{ fontSize: "18px", color: ACCENT, marginBottom: "8px" }}>PDFをドラッグ＆ドロップ</div>
              <div style={{ fontSize: "13px", color: "#5a5a7a" }}>または</div>
              <button style={styles.uploadBtn}
                onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}>
                ファイルを選択
              </button>
            </div>
          )}

          {/* ローディング */}
          {isLoading && (
            <div style={styles.loadingWrap}>
              <div style={styles.spinner} />
              <span>PDFを読み込み中...</span>
            </div>
          )}

          {/* PDF表示 */}
          {pdfDoc && !isLoading && (
            <>
              <div style={styles.toolbar}>
                <button style={styles.navBtn(currentPage <= 1)} onClick={goToPrevPage} disabled={currentPage <= 1}>‹</button>
                <input type="number" style={styles.pageInput} value={currentPage} min={1} max={totalPages} onChange={handlePageInput} />
                <span style={styles.pageTotal}>/ {totalPages}</span>
                <button style={styles.navBtn(currentPage >= totalPages)} onClick={goToNextPage} disabled={currentPage >= totalPages}>›</button>
                <div style={styles.divider} />
                {[0.8, 1.0, 1.4, 1.8].map((s) => (
                  <button key={s} style={styles.scaleBtn(scale === s)} onClick={() => setScale(s)}>
                    {Math.round(s * 100)}%
                  </button>
                ))}
                <div style={styles.divider} />
                <button style={styles.scaleBtn(false)} onClick={() => fileInputRef2.current?.click()}>📂 開く</button>
                <input ref={fileInputRef2} type="file" accept=".pdf" style={{ display: "none" }} onChange={(e) => loadPdfFile(e.target.files[0])} />
              </div>

              <div style={styles.canvasWrap}>
                {renderError ? (
                  <div style={{ color: "#aa6060", padding: "32px" }}>{renderError}</div>
                ) : (
                  <div
                    style={styles.pdfWrapper}
                    onMouseUp={handleMouseUp}
                    onContextMenu={handleContextMenu} // ← 右クリックイベント
                  >
                    <canvas ref={canvasRef} />
                    <div
                      ref={textLayerRef}
                      className="textLayer"
                      style={{ position: "absolute", top: 0, left: 0, overflow: "hidden", opacity: 1, lineHeight: 1, userSelect: "text" }}
                    />
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* ── 右: サイドバー ── */}
        <div style={styles.sidebar}>

          {/* タブ切り替え */}
          <div style={styles.sidebarHeader}>
            <button style={styles.tabBtn(activeTab === "comments")} onClick={() => setActiveTab("comments")}>
              💬 コメント {comments.length > 0 && `(${comments.length})`}
            </button>
            <button style={styles.tabBtn(activeTab === "search")} onClick={() => setActiveTab("search")}>
              🔍 検索
            </button>
          </div>

          <div style={styles.sidebarBody} className="sidebar-body">

            {/* ── コメントタブ ── */}
            {activeTab === "comments" && (
              <>
                {/* コメント入力フォーム（右クリック→コメント追加後に表示） */}
                {commentTarget && (
                  <div style={styles.commentForm}>
                    <div style={{ fontSize: "11px", color: ACCENT }}>選択テキスト（p.{commentTarget.page}）</div>
                    <div style={styles.commentQuote}>
                      {commentTarget.text.length > 80
                        ? commentTarget.text.slice(0, 80) + "…"
                        : commentTarget.text}
                    </div>
                    <textarea
                      ref={commentInputRef}
                      style={styles.commentTextarea}
                      placeholder="メモを入力..."
                      value={commentInput}
                      onChange={(e) => setCommentInput(e.target.value)}
                      onKeyDown={(e) => {
                        // Ctrl+Enter または Cmd+Enter で保存
                        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) handleSaveComment();
                      }}
                    />
                    <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
                      <button
                        onClick={() => setCommentTarget(null)}
                        style={{ ...styles.commentSaveBtn, background: "#2a2a35", color: "#9a9aba" }}
                      >
                        キャンセル
                      </button>
                      <button style={styles.commentSaveBtn} onClick={handleSaveComment}>
                        保存
                      </button>
                    </div>
                  </div>
                )}

                {/* コメントがない場合 */}
                {comments.length === 0 && !commentTarget && (
                  <div style={{ color: "#3a3a4a", fontSize: "13px", textAlign: "center", padding: "32px 0" }}>
                    テキストを選択して右クリック<br />→「コメントを追加」
                  </div>
                )}

                {/* コメント一覧 */}
                {comments.map((c) => (
                  <div key={c.id} style={styles.commentCard}>
                    <div style={styles.commentCardQuote}>
                      {c.text.length > 60 ? c.text.slice(0, 60) + "…" : c.text}
                    </div>
                    {c.note && <div style={styles.commentCardNote}>{c.note}</div>}
                    <div style={styles.commentCardMeta}>
                      <span>p.{c.page} · {c.createdAt}</span>
                      <button style={styles.commentDeleteBtn} onClick={() => handleDeleteComment(c.id)}>
                        削除
                      </button>
                    </div>
                  </div>
                ))}

                {/* フェーズ3のAPI連携枠（コメントタブ下部） */}
                <div style={styles.apiPlaceholder}>
                  🌐 翻訳結果<br />
                  <span style={{ fontSize: "10px" }}>フェーズ3 / Claude API連携予定</span>
                </div>
              </>
            )}

            {/* ── 検索タブ ── */}
            {activeTab === "search" && (
              <>
                {selectedText && (
                  <div style={{ fontSize: "12px", color: "#7a7a9a", marginBottom: "8px" }}>
                    選択中: <span style={{ color: ACCENT }}>「{selectedText.slice(0, 40)}{selectedText.length > 40 ? "…" : ""}」</span>
                  </div>
                )}
                {selectedText && (
                  <button
                    onClick={() => handleGoogleSearch(selectedText)}
                    style={{
                      background: "#2a2a35", border: "1px solid #3a3a4a",
                      color: "#e8e6e0", borderRadius: "6px",
                      padding: "10px 14px", cursor: "pointer",
                      fontSize: "13px", fontFamily: "inherit",
                      textAlign: "left", width: "100%",
                      display: "flex", alignItems: "center", gap: "10px",
                    }}
                  >
                    <span>🔍</span>
                    <span>Googleで「{selectedText.slice(0, 30)}{selectedText.length > 30 ? "…" : ""}」を検索</span>
                  </button>
                )}

                {/* フェーズ3のAPI連携枠（検索タブ） */}
                <div style={styles.apiPlaceholder}>
                  📖 用語説明<br />
                  <span style={{ fontSize: "10px" }}>フェーズ3 / Claude API連携予定</span>
                </div>
                <div style={styles.apiPlaceholder}>
                  🌐 DeepL翻訳<br />
                  <span style={{ fontSize: "10px" }}>フェーズ3 / API連携予定</span>
                </div>
              </>
            )}

          </div>
        </div>
      </div>

      {/* ── 右クリックメニュー ── */}
      {/* contextMenu が null でないとき（= 右クリックされたとき）だけ表示 */}
      {contextMenu && (
        <div
          style={styles.contextMenu(contextMenu.x, contextMenu.y)}
          onClick={(e) => e.stopPropagation()} // メニュー内クリックで閉じないように
        >
          {/* 選択テキストの表示（上部ラベル） */}
          <div style={styles.menuLabel}>
            「{contextMenu.text.slice(0, 20)}{contextMenu.text.length > 20 ? "…" : ""}」
          </div>

          {/* Google検索 */}
          <button
            className="menu-item"
            style={styles.menuItem(false)}
            onClick={() => handleGoogleSearch(contextMenu.text)}
          >
            <span>🔍</span> Googleで検索
          </button>

          {/* コメントを追加 */}
          <button
            className="menu-item"
            style={styles.menuItem(false)}
            onClick={() => handleAddCommentStart(contextMenu.text)}
          >
            <span>💬</span> コメントを追加
          </button>

          {/* 区切り線 */}
          <div style={styles.menuDivider} />

          {/* ── フェーズ3のAPI連携枠 ── */}
          {/* disabled: true にして見た目をグレーアウト */}
          <div style={styles.menuLabel}>API連携（フェーズ3予定）</div>

          <button
            className="menu-item"
            style={styles.menuItem(true)} // disabled
            onClick={() => handleTranslate(contextMenu.text)}
          >
            <span>🌐</span> 和訳する（準備中）
          </button>

          <button
            className="menu-item"
            style={{ ...styles.menuItem(true), borderBottom: "none" }} // disabled
            onClick={() => handleExplainTerm(contextMenu.text)}
          >
            <span>📖</span> 用語を説明（準備中）
          </button>
        </div>
      )}
    </div>
  );
}
