// ============================================================
// 論文リーダー - フェーズ1.5: テキストの選択と取得
// ============================================================
//
// 【フェーズ1からの追加点】
//   テキストレイヤー:
//     Canvasの上に透明なdivを重ねて文字を選択可能にする
//     PDF.jsの getTextContent() でテキスト位置情報を取得し、
//     Canvas座標に合わせてdivを配置する
//
//   Selection API（セレクション エーピーアイ）:
//     ブラウザ標準の文字選択機能。
//     window.getSelection() で選択中の文字列を取得できる
//
//   選択テキストパネル:
//     選択した文字を画面下部に表示する
//
// 【ファイル構成】
//   index.html      ← ブラウザが最初に読み込むHTMLファイル
//   src/
//     main.jsx      ← ReactをHTMLに差し込むエントリーポイント
//     index.css     ← 全体共通のスタイル
//     App.jsx       ← このファイル。アプリの本体
//
// 【使用ライブラリ】
//   PDF.js (ピーディーエフ ジェイエス)
//     - Mozilla（ファイアフォックスの開発元）が作ったPDF表示ライブラリ
//     - PDFファイルをCanvas（キャンバス）という描画領域に表示する
//     - CDN（コンテンツ デリバリー ネットワーク）経由で読み込む
//
//   React (リアクト)
//     - UIの状態管理と画面の更新を担当するライブラリ
//     - useState, useEffect, useRef, useCallback を使う
// ============================================================

import { useState, useRef, useEffect, useCallback } from "react";

// ── 定数 ────────────────────────────────────────────────────
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

      // フェーズ1.5で追加: textLayer用CSSの読み込み
      const link = document.createElement("link");
      link.rel  = "stylesheet";
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
  const [pdfDoc,       setPdfDoc]       = useState(null);
  const [currentPage,  setCurrentPage]  = useState(1);
  const [totalPages,   setTotalPages]   = useState(0);
  const [scale,        setScale]        = useState(1.4);    // ← デフォルト倍率
  const [isLoading,    setIsLoading]    = useState(false);
  const [fileName,     setFileName]     = useState("");
  const [isDragging,   setIsDragging]   = useState(false);
  const [renderError,  setRenderError]  = useState(null);
  const [selectedText, setSelectedText] = useState("");     // フェーズ1.5で追加

  // ── DOM参照 ──────────────────────────────────────────────
  const canvasRef     = useRef(null);
  const renderTaskRef = useRef(null);
  const fileInputRef  = useRef(null);
  const fileInputRef2 = useRef(null);
  const textLayerRef  = useRef(null);  // フェーズ1.5で追加

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

      canvas.height = viewport.height;
      canvas.width  = viewport.width;

      const renderTask = page.render({ canvasContext: context, viewport });
      renderTaskRef.current = renderTask;
      await renderTask.promise;

      // ── フェーズ1.5で追加: テキストレイヤーの描画 ────────
      // Canvas（画像のPDF） ← 下層：見た目担当
      // textLayerRef（div） ← 上層：透明、文字選択担当
      if (textLayerRef.current) {
        textLayerRef.current.innerHTML    = "";
        textLayerRef.current.style.width  = `${viewport.width}px`;
        textLayerRef.current.style.height = `${viewport.height}px`;

        const textContent = await page.getTextContent();
        const textLayer = window.pdfjsLib.renderTextLayer({
          textContentSource: textContent,
          container: textLayerRef.current,
          viewport: viewport,
        });
        await textLayer.promise;
      }

    } catch (err) {
      if (err.name !== "RenderingCancelledException") {
        console.error("描画エラー:", err);
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
      alert("PDF.jsがまだ読み込まれていません。少々お待ちください。"); return;
    }

    setIsLoading(true); setFileName(file.name);
    setPdfDoc(null); setCurrentPage(1); setTotalPages(0);

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const doc = await window.pdfjsLib
          .getDocument({ data: new Uint8Array(e.target.result) }).promise;
        setPdfDoc(doc);
        setTotalPages(doc.numPages);
      } catch {
        alert("PDFの読み込みに失敗しました");
      } finally {
        setIsLoading(false);
      }
    };
    reader.readAsArrayBuffer(file);
  }, [pdfJsReady]);

  // ── イベントハンドラ ─────────────────────────────────────
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

  // フェーズ1.5で追加: Selection API でマウス離し時に選択テキストを取得
  const handleMouseUp = () => {
    const text = window.getSelection()?.toString().trim();
    if (text) setSelectedText(text);
  };

  // ── スタイル定義 ─────────────────────────────────────────
  // ▼▼▼ デザインのカスタマイズはここから ▼▼▼

  const ACCENT = "#c8b89a"; // ← アクセントカラー

  const styles = {
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
    },
    logo:     { fontSize: "20px", fontWeight: "bold", color: ACCENT },
    badge:    { fontSize: "11px", background: "#2a2a35", color: "#7a7a9a", padding: "2px 8px", borderRadius: "10px", border: "1px solid #3a3a4a" },
    fileName: { marginLeft: "auto", fontSize: "13px", color: "#7a7a9a", maxWidth: "300px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
    body: {
      flex: 1, display: "flex", flexDirection: "column", alignItems: "center",
      padding: "32px 24px 120px", gap: "24px",
    },
    phaseNote: {
      maxWidth: "640px", background: "#13131a",
      border: "1px solid #2a2a35", borderLeft: `3px solid ${ACCENT}`,
      borderRadius: "6px", padding: "16px 20px",
      fontSize: "13px", color: "#7a7a9a", lineHeight: "1.7",
    },
    dropzone: (d) => ({
      width: "100%", maxWidth: "600px",
      border: `2px dashed ${d ? ACCENT : "#3a3a4a"}`,
      borderRadius: "12px", padding: "64px 32px",
      textAlign: "center", cursor: "pointer", transition: "all 0.2s",
      background: d ? "rgba(200,184,154,0.05)" : "transparent",
    }),
    uploadBtn: {
      marginTop: "20px", padding: "10px 24px",
      background: ACCENT, color: "#0f0f13",
      border: "none", borderRadius: "6px",
      cursor: "pointer", fontSize: "14px", fontFamily: "inherit",
    },
    toolbar: {
      display: "flex", alignItems: "center", gap: "12px",
      background: "#13131a", border: "1px solid #2a2a35",
      borderRadius: "10px", padding: "10px 16px", flexWrap: "wrap",
    },
    navBtn: (dis) => ({
      background: dis ? "#1a1a22" : "#2a2a35",
      border: "1px solid #3a3a4a",
      color: dis ? "#3a3a4a" : ACCENT,
      width: "36px", height: "36px", borderRadius: "6px",
      cursor: dis ? "default" : "pointer", fontSize: "16px",
      display: "flex", alignItems: "center", justifyContent: "center",
    }),
    pageInput: {
      background: "#1a1a22", border: "1px solid #3a3a4a",
      color: "#e8e6e0", width: "48px", padding: "6px",
      borderRadius: "4px", textAlign: "center",
      fontSize: "14px", fontFamily: "inherit",
    },
    pageTotal: { color: "#5a5a7a", fontSize: "14px" },
    divider:   { width: "1px", height: "24px", background: "#2a2a35" },
    scaleBtn: (a) => ({
      background: a ? ACCENT : "#2a2a35",
      border: "1px solid #3a3a4a",
      color: a ? "#0f0f13" : "#9a9aba",
      padding: "6px 12px", borderRadius: "4px",
      cursor: "pointer", fontSize: "12px",
    }),
    canvasWrap: {
      background: "#1a1a22", border: "1px solid #2a2a35",
      borderRadius: "8px", padding: "24px",
      boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
      maxWidth: "100%", overflow: "auto",
    },
    // position: "relative" が必須（子要素のabsolute配置の基準になる）
    pdfWrapper: { position: "relative", display: "inline-block" },
    loadingWrap: {
      display: "flex", flexDirection: "column",
      alignItems: "center", gap: "16px",
      color: "#5a5a7a", padding: "64px",
    },
    spinner: {
      width: "40px", height: "40px",
      border: "3px solid #2a2a35",
      borderTop: `3px solid ${ACCENT}`,  // ← スピナーの色
      borderRadius: "50%",
      animation: "spin 0.8s linear infinite",
    },
  };

  // 選択テキストパネル: position: "fixed" で画面下部に固定
  const selectedPanel = {
    position: "fixed", bottom: 0, left: 0, right: 0,
    background: "#13131a", borderTop: `2px solid ${ACCENT}`,
    padding: "12px 24px",
    display: "flex", alignItems: "flex-start", gap: "12px",
    zIndex: 100, maxHeight: "160px", overflow: "auto",
  };

  // ▲▲▲ デザインのカスタマイズはここまで ▲▲▲

  return (
    <div style={styles.app}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        canvas { display: block; }

        /* テキストレイヤーのspan要素（普段は透明） */
        .textLayer span {
          color: transparent;
          position: absolute;
          white-space: pre;
          cursor: text;
          transform-origin: 0% 0%;
        }

        /* 選択ハイライトの色
           ::selection = ドラッグ選択した部分に適用されるCSS
           rgba(赤, 緑, 青, 透明度) で指定
           ← 数値を変えると色・濃さが変わる */
        .textLayer ::selection {
          background: rgba(210, 60, 60, 0.35);  /* 赤系・半透明 */
        }
      `}</style>

      {/* ── ヘッダー ── */}
      <header style={styles.header}>
        <span style={styles.logo}>📄 論文リーダー</span>
        <span style={styles.badge}>Phase 1.5</span>
        {fileName && <span style={styles.fileName}>{fileName}</span>}
      </header>

      <main style={styles.body}>

        {/* ── フェーズ説明ノート ── */}
        <div style={styles.phaseNote}>
          <strong style={{ color: ACCENT }}>🔬 フェーズ1.5: テキストの選択と取得</strong><br />
          PDFの文字をマウスでドラッグして選択できます。<br />
          選択を離すと画面下部に選択テキストが表示されます。<br />
          次フェーズ: 選択テキストの和訳・用語検索機能を追加予定。
        </div>

        {/* ── ドロップゾーン ── */}
        {!pdfDoc && !isLoading && (
          <div
            style={styles.dropzone(isDragging)}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef} type="file" accept=".pdf"
              style={{ display: "none" }}
              onChange={(e) => loadPdfFile(e.target.files[0])}
            />
            <div style={{ fontSize: "48px", marginBottom: "16px" }}>📑</div>
            <div style={{ fontSize: "18px", color: ACCENT, marginBottom: "8px" }}>PDFをドラッグ＆ドロップ</div>
            <div style={{ fontSize: "13px", color: "#5a5a7a" }}>または</div>
            <button
              style={styles.uploadBtn}
              onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
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

        {/* ── PDF表示エリア ── */}
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
                <div style={styles.pdfWrapper} onMouseUp={handleMouseUp}>
                  {/* 下層: PDFの見た目 */}
                  <canvas ref={canvasRef} />
                  {/* 上層: 文字選択担当（透明） */}
                  <div
                    ref={textLayerRef}
                    className="textLayer"
                    style={{
                      position: "absolute", top: 0, left: 0,
                      overflow: "hidden", opacity: 1,
                      lineHeight: 1, userSelect: "text",
                    }}
                  />
                </div>
              )}
            </div>
          </>
        )}

      </main>

      {/* ── 選択テキスト表示パネル ── */}
      {selectedText && (
        <div style={selectedPanel}>
          <span style={{ color: ACCENT, fontSize: "12px", whiteSpace: "nowrap", paddingTop: "2px" }}>
            選択中のテキスト
          </span>
          <span style={{ fontSize: "13px", color: "#e8e6e0", lineHeight: "1.6", flex: 1 }}>
            {selectedText}
          </span>
          <button
            onClick={() => setSelectedText("")}
            style={{ background: "none", border: "none", color: "#5a5a7a", cursor: "pointer", fontSize: "18px", padding: "0 4px", lineHeight: 1 }}
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
