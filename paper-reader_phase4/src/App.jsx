// ============================================================
// 論文リーダー - フェーズ3.5: 要約機能（行数オプション付き）
// ============================================================
//
// 【フェーズ2からの追加点】
//
//   🤖 AIタブ（新規）:
//     翻訳・用語説明の結果を履歴として積み上げて表示する。
//     各カードに「種別」「元テキスト」「AI結果」「ページ」を表示。
//
//   Claude API呼び出し:
//     fetch() で Anthropic の /v1/messages エンドポイントにPOSTする。
//     system promptで「翻訳者」「用語説明者」の役割を与える。
//     結果をaiResultsの配列に追加して履歴表示する。
//
//   右クリックメニュー:
//     「和訳する」「用語を説明」「要約する」が動作する。
//     要約は粒度（3行 / 5行 / 詳細）をサブメニューで選べる。
//
//   要約オプション:
//     3行  = ポイントだけを素早くつかむ
//     5行  = やや詳しく
//     詳細 = 背景・手法・結果・考察を網羅
//
// 【Claude APIの基本構造】
//   POST /v1/messages
//   {
//     model: "claude-sonnet-4-20250514",
//     max_tokens: 1000,
//     system: "役割の指示",       ← AIの振る舞いを決める
//     messages: [
//       { role: "user", content: "翻訳してください: ..." }
//     ]
//   }
// ============================================================

import { useState, useRef, useEffect, useCallback } from "react";

const PDFJS_VERSION = "3.11.174";
const PDFJS_CDN = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}`;

// ── Claude APIの設定 ─────────────────────────────────────────
// モデル名: 常にこのバージョンを使う
const CLAUDE_MODEL = "claude-sonnet-4-20250514";

// ── フェーズ3で追加: Claude APIを呼び出す関数 ────────────────
// 【引数】
//   systemPrompt: AIへの役割指示（「あなたは翻訳者です」など）
//   userMessage:  ユーザーからの入力テキスト
// 【戻り値】
//   AIの応答テキスト（文字列）
async function callClaudeAPI(systemPrompt, userMessage) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // ※ claude.ai の Artifact環境ではAPIキー不要（自動で付与される）
      // ※ StackBlitz など外部環境では APIキーが必要
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 1000,
      system: systemPrompt,  // ← AIの役割を決めるシステムプロンプト
      messages: [
        { role: "user", content: userMessage }
      ],
    }),
  });

  if (!response.ok) {
    // HTTPエラー（401, 429, 500 など）の場合
    throw new Error(`API エラー: ${response.status}`);
  }

  const data = await response.json();

  // data.content は配列。テキストブロックだけを結合して返す
  // 【data.contentの構造】
  // [
  //   { type: "text", text: "AIの応答テキスト" },
  //   ...
  // ]
  return data.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

// ── 翻訳用のシステムプロンプト ────────────────────────────────
// システムプロンプト = AIへの「役割の指示書」
// ここを変えるとAIの振る舞いが変わる
const TRANSLATE_SYSTEM = `あなたは学術論文の翻訳専門家です。
入力された英語テキストを自然な日本語に翻訳してください。
専門用語はそのまま使い、括弧内に原語を添えてください。
翻訳結果のみを出力し、説明や前置きは不要です。`;

// ── 用語説明用のシステムプロンプト ──────────────────────────
const EXPLAIN_SYSTEM = `あなたは学術論文の用語解説専門家です。
入力された専門用語・概念を、大学院生が理解できるレベルで日本語で説明してください。
以下の形式で出力してください:
【読み方】（わかる場合）
【意味】2〜3文で簡潔に
【例】具体例があれば1つ
説明のみを出力し、前置きは不要です。`;

// ── 要約用のシステムプロンプト ──────────────────────────────
// lines: "3" | "5" | "detail" を受け取ってプロンプトを動的に生成する関数
// 関数にすることで、行数に応じた指示を毎回生成できる
function buildSummarizeSystem(lines) {
  if (lines === "detail") {
    return `あなたは学術論文の要約専門家です。
入力されたテキストを以下の構成で日本語で要約してください:
【背景】研究の動機・背景を1〜2文
【手法】使われた手法・アプローチを1〜2文
【結果】主な結果・発見を1〜2文
【考察】意義・限界・展望を1文
各見出しと内容のみを出力し、前置きは不要です。`;
  }
  const n = lines === "5" ? "5" : "3";
  return `あなたは学術論文の要約専門家です。
入力されたテキストを${n}行以内の箇条書きで日本語で要約してください。
・ で始まる箇条書き形式で出力してください。
最も重要な情報を優先し、${n}行を超えないでください。
箇条書きのみを出力し、前置きは不要です。`;
}

// 要約オプションの表示名マッピング
// コード内では "3" | "5" | "detail" を使い、表示時にこのオブジェクトで変換する
const SUMMARIZE_LABELS = {
  "3":      "3行要約",
  "5":      "5行要約",
  "detail": "詳細要約",
};

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
  const [pdfDoc,       setPdfDoc]       = useState(null);
  const [currentPage,  setCurrentPage]  = useState(1);
  const [totalPages,   setTotalPages]   = useState(0);
  const [scale,        setScale]        = useState(1.4);
  const [isLoading,    setIsLoading]    = useState(false);
  const [fileName,     setFileName]     = useState("");
  const [isDragging,   setIsDragging]   = useState(false);
  const [renderError,  setRenderError]  = useState(null);
  const [selectedText, setSelectedText] = useState("");

  // 右クリックメニュー
  const [contextMenu,  setContextMenu]  = useState(null);

  // サイドバー
  const [sidebarOpen,  setSidebarOpen]  = useState(true);

  // activeTab: "comments" | "search" | "ai" ← フェーズ3で "ai" を追加
  const [activeTab,    setActiveTab]    = useState("comments");

  // コメント
  const [comments,      setComments]      = useState([]);
  const [commentInput,  setCommentInput]  = useState("");
  const [commentTarget, setCommentTarget] = useState(null);

  // ── フェーズ3で追加: AI解析結果の履歴 ───────────────────────
  // aiResults: AI解析結果の配列（新しいものが先頭に追加される）
  // 各要素の構造:
  // {
  //   id:        ユニークID（Date.now()）
  //   type:      "translate" | "explain"（種別）
  //   sourceText: 元の選択テキスト
  //   result:    AIの応答テキスト
  //   page:      ページ番号
  //   createdAt: 作成時刻
  // }
  const [aiResults,   setAiResults]   = useState([]);

  // aiLoading: API呼び出し中かどうか（スピナー表示に使う）
  const [aiLoading,   setAiLoading]   = useState(false);

  // aiError: API呼び出しエラーメッセージ（null = エラーなし）
  const [aiError,     setAiError]     = useState(null);

  // フェーズ3.5で追加: 要約の粒度オプション
  // "3" = 3行 / "5" = 5行 / "detail" = 詳細（見出し付き）
  const [summarizeLines, setSummarizeLines] = useState("3");

  // ── DOM参照 ──────────────────────────────────────────────
  const canvasRef       = useRef(null);
  const renderTaskRef   = useRef(null);
  const fileInputRef    = useRef(null);
  const fileInputRef2   = useRef(null);
  const textLayerRef    = useRef(null);
  const commentInputRef = useRef(null);

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
      if (textLayerRef.current) {
        textLayerRef.current.innerHTML = "";

        // fix(phase1.5): textLayer専用のviewportを生成する
        // renderTextLayer() に Canvas描画用の viewport をそのまま渡すと
        // PDF.js内部のtransform計算がずれて選択範囲が数文字分ずれる。
        // clone({ dontFlip: false }) で textLayer 用の変換行列を正しく生成する。
        const textViewport = viewport.clone({ dontFlip: false });

        textLayerRef.current.style.width  = `${textViewport.width}px`;
        textLayerRef.current.style.height = `${textViewport.height}px`;

        // textLayerにviewportの変換行列をCSSで適用する
        // PDF座標系（Y軸が下向き）をブラウザ座標系に合わせるために必要
        const { transform } = textViewport;
        textLayerRef.current.style.setProperty(
          "--scale-factor", transform[0]  // スケール係数を CSS変数として渡す
        );

        const textContent = await page.getTextContent();
        const tl = window.pdfjsLib.renderTextLayer({
          textContentSource: textContent,
          container: textLayerRef.current,
          viewport: textViewport,         // ← textLayer専用viewportを使う
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

  // ── マウスイベント ───────────────────────────────────────
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
  const handleMouseUp = () => {
    const text = window.getSelection()?.toString().trim();
    if (text) setSelectedText(text);
  };

  // ── 右クリックメニュー ───────────────────────────────────
  const handleContextMenu = (e) => {
    e.preventDefault();
    const text = window.getSelection()?.toString().trim();
    if (!text) return;
    setContextMenu({ x: e.clientX, y: e.clientY, text });
  };
  const closeContextMenu = () => setContextMenu(null);

  // Google検索
  const handleGoogleSearch = (text) => {
    window.open(`https://www.google.com/search?q=${encodeURIComponent(text)}`, "_blank");
    closeContextMenu();
    setSidebarOpen(true);
    setActiveTab("search");
  };

  // コメント追加
  const handleAddCommentStart = (text) => {
    setCommentTarget({ text, page: currentPage });
    setCommentInput("");
    closeContextMenu();
    setSidebarOpen(true);
    setActiveTab("comments");
    setTimeout(() => commentInputRef.current?.focus(), 100);
  };
  const handleSaveComment = () => {
    if (!commentTarget) return;
    setComments((prev) => [{
      id: Date.now(),
      text: commentTarget.text,
      note: commentInput,
      page: commentTarget.page,
      createdAt: new Date().toLocaleTimeString("ja-JP"),
    }, ...prev]);
    setCommentTarget(null);
    setCommentInput("");
  };
  const handleDeleteComment = (id) => {
    setComments((prev) => prev.filter((c) => c.id !== id));
  };

  // ── フェーズ3で追加: Claude APIを使った処理 ──────────────
  // 【共通処理】APIを呼び出して結果をaiResultsに追加する
  // type: "translate" または "explain"
  // optionは要約時の粒度（"3" | "5" | "detail"）、他の種別ではundefined
  const callAI = async (text, type, option) => {
    closeContextMenu();
    setSidebarOpen(true);
    setActiveTab("ai");          // AIタブに自動切り替え
    setAiLoading(true);
    setAiError(null);

    try {
      // typeによってシステムプロンプトとユーザーメッセージを切り替える
      // typeとoptionに応じてシステムプロンプトとユーザーメッセージを切り替える
      const systemPrompt =
        type === "translate" ? TRANSLATE_SYSTEM :
        type === "explain"   ? EXPLAIN_SYSTEM :
        buildSummarizeSystem(option);   // 要約は粒度に応じてプロンプトを生成

      const userMessage =
        type === "translate" ? `次のテキストを日本語に翻訳してください:\n\n${text}` :
        type === "explain"   ? `次の用語・概念を説明してください:\n\n${text}` :
        `次のテキストを要約してください:\n\n${text}`;

      // Claude APIを呼び出す（非同期・awaitで完了を待つ）
      const result = await callClaudeAPI(systemPrompt, userMessage);

      // 結果を配列の先頭に追加（履歴として積み上げ）
      // prev = 現在の配列 → [新しい結果, ...既存の結果]
      setAiResults((prev) => [{
        id:         Date.now(),
        type,                          // "translate" | "explain"
        sourceText: text,              // 元の選択テキスト
        result,                        // AIの応答
        page:       currentPage,       // ページ番号
        option,                        // 要約の場合の粒度オプション
        createdAt:  new Date().toLocaleTimeString("ja-JP"),
      }, ...prev]);

    } catch (err) {
      // エラーが発生した場合はエラーメッセージを表示
      setAiError(`エラーが発生しました: ${err.message}`);
    } finally {
      // 成功・失敗どちらでもローディングを終了
      setAiLoading(false);
    }
  };

  // 和訳する
  const handleTranslate   = (text) => callAI(text, "translate");

  // 用語を説明する
  const handleExplainTerm = (text) => callAI(text, "explain");


  // 要約する（粒度はsummarizeLinesの値を使う）
  const handleSummarize = (text, lines) => callAI(text, "summarize", lines);

  // AI結果の削除
  const handleDeleteAiResult = (id) => {
    setAiResults((prev) => prev.filter((r) => r.id !== id));
  };

  // ── スタイル定義 ─────────────────────────────────────────
  const ACCENT = "#c8b89a";

  const styles = {
    app: {
      minHeight: "100vh", background: "#0f0f13", color: "#e8e6e0",
      fontFamily: "'Georgia', 'Times New Roman', serif",
      display: "flex", flexDirection: "column",
    },
    header: {
      borderBottom: "1px solid #2a2a35", padding: "14px 24px",
      display: "flex", alignItems: "center", gap: "14px",
      background: "#13131a", flexShrink: 0,
    },
    logo:     { fontSize: "18px", fontWeight: "bold", color: ACCENT },
    badge:    { fontSize: "11px", background: "#2a2a35", color: "#7a7a9a", padding: "2px 8px", borderRadius: "10px", border: "1px solid #3a3a4a" },
    fileName: { fontSize: "12px", color: "#7a7a9a", maxWidth: "200px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
    sidebarToggle: {
      marginLeft: "auto",
      background: sidebarOpen ? ACCENT : "#2a2a35",
      border: "1px solid #3a3a4a",
      color: sidebarOpen ? "#0f0f13" : "#9a9aba",
      padding: "5px 12px", borderRadius: "6px",
      cursor: "pointer", fontSize: "12px",
    },
    main: { flex: 1, display: "flex", overflow: "hidden" },
    pdfArea: {
      flex: 1, display: "flex", flexDirection: "column",
      alignItems: "center", padding: "20px",
      gap: "14px", overflowY: "auto",
    },
    phaseNote: {
      maxWidth: "640px", width: "100%", background: "#13131a",
      border: "1px solid #2a2a35", borderLeft: `3px solid ${ACCENT}`,
      borderRadius: "6px", padding: "12px 16px",
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
      borderRadius: "8px",
      // fix(phase1.5): padding を 0 に変更
      // padding があると canvasWrap 内の座標原点がずれ、
      // textLayer（position:absolute, top:0, left:0）が
      // Canvas の描画開始点とずれてテキスト選択範囲がずれる原因になっていた。
      // 見た目の余白は canvasWrap 自体の margin で確保する。
      padding: "0",
      margin: "0 auto",
      boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
      maxWidth: "100%", overflow: "auto",
      display: "inline-block", // コンテンツ幅に合わせる
    },
    // pdfWrapper: CanvasとtextLayerを重ねる基準コンテナ
    // display:"block" にすることで inline-block 特有の
    // 下部余白（line-height由来）を排除する
    pdfWrapper: { position: "relative", display: "block" },
    loadingWrap: {
      display: "flex", flexDirection: "column",
      alignItems: "center", gap: "16px",
      color: "#5a5a7a", padding: "64px",
    },
    spinner: (size = 40) => ({
      width: size, height: size,
      border: `${size / 14}px solid #2a2a35`,
      borderTop: `${size / 14}px solid ${ACCENT}`,
      borderRadius: "50%",
      animation: "spin 0.8s linear infinite",
      flexShrink: 0,
    }),

    // ── サイドバー ──────────────────────────────────────────
    sidebar: {
      width: sidebarOpen ? "320px" : "0",
      minWidth: sidebarOpen ? "320px" : "0",
      background: "#13131a", borderLeft: "1px solid #2a2a35",
      display: "flex", flexDirection: "column",
      overflow: "hidden",
      transition: "width 0.25s ease, min-width 0.25s ease",
      flexShrink: 0,
    },
    sidebarHeader: {
      padding: "12px", borderBottom: "1px solid #2a2a35",
      display: "flex", gap: "6px", flexShrink: 0,
    },
    // フェーズ3: 3つのタブボタン
    tabBtn: (active) => ({
      flex: 1, padding: "6px 4px",
      background: active ? "#2a2a35" : "transparent",
      border: `1px solid ${active ? "#3a3a4a" : "transparent"}`,
      color: active ? ACCENT : "#5a5a7a",
      borderRadius: "6px", cursor: "pointer",
      fontSize: "11px", fontFamily: "inherit",
    }),
    sidebarBody: {
      flex: 1, overflowY: "auto", padding: "12px",
      display: "flex", flexDirection: "column", gap: "10px",
    },

    // コメント系スタイル
    commentForm: {
      background: "#1a1a22", border: `1px solid ${ACCENT}`,
      borderRadius: "8px", padding: "12px",
      display: "flex", flexDirection: "column", gap: "8px",
    },
    commentQuote: {
      fontSize: "11px", color: "#7a7a9a",
      borderLeft: `2px solid ${ACCENT}`,
      paddingLeft: "8px", lineHeight: "1.5",
    },
    commentTextarea: {
      background: "#0f0f13", border: "1px solid #3a3a4a",
      color: "#e8e6e0", borderRadius: "4px",
      padding: "8px", fontSize: "13px", fontFamily: "inherit",
      resize: "vertical", minHeight: "64px", outline: "none",
    },
    commentSaveBtn: {
      background: ACCENT, color: "#0f0f13",
      border: "none", borderRadius: "4px",
      padding: "6px 12px", cursor: "pointer",
      fontSize: "12px", fontFamily: "inherit",
    },
    commentCard: {
      background: "#1a1a22", border: "1px solid #2a2a35",
      borderRadius: "8px", padding: "10px",
    },
    commentCardQuote: {
      fontSize: "11px", color: "#7a7a9a",
      borderLeft: `2px solid ${ACCENT}`,
      paddingLeft: "8px", marginBottom: "6px", lineHeight: "1.5",
    },
    commentCardNote:  { fontSize: "13px", color: "#e8e6e0", lineHeight: "1.6", marginBottom: "6px" },
    commentCardMeta:  { fontSize: "11px", color: "#5a5a7a", display: "flex", justifyContent: "space-between" },
    commentDeleteBtn: { background: "none", border: "none", color: "#5a5a7a", cursor: "pointer", fontSize: "12px" },

    // ── フェーズ3で追加: AI結果カードのスタイル ─────────────
    // typeによって左ボーダーの色を変える
    aiCard: (type) => ({
      background: "#1a1a22",
      border: "1px solid #2a2a35",
      // 翻訳 = ゴールド系、用語説明 = 青緑系
      borderLeft: `3px solid ${
        type === "translate" ? ACCENT :
        type === "explain"   ? "#6a9aba" :
        "#7a9a6a"            // 要約 = 緑系
      }`,
      borderRadius: "8px",
      padding: "12px",
      display: "flex",
      flexDirection: "column",
      gap: "8px",
    }),
    aiCardType: (type) => ({
      fontSize: "10px",
      color: type === "translate" ? ACCENT : type === "explain" ? "#6a9aba" : "#7a9a6a",
      letterSpacing: "0.08em",
      fontFamily: "sans-serif",
    }),
    aiCardSource: {
      fontSize: "11px", color: "#7a7a9a",
      borderLeft: "2px solid #3a3a4a",
      paddingLeft: "8px", lineHeight: "1.5",
    },
    aiCardResult: {
      fontSize: "13px", color: "#e8e6e0",
      lineHeight: "1.8",
      // 改行を保持する（用語説明の【読み方】【意味】などの改行）
      whiteSpace: "pre-wrap",
    },
    aiCardMeta: {
      fontSize: "11px", color: "#5a5a7a",
      display: "flex", justifyContent: "space-between",
      alignItems: "center",
    },

    // ローディング表示（AIタブ用）
    aiLoadingBox: {
      background: "#1a1a22", border: "1px solid #2a2a35",
      borderRadius: "8px", padding: "20px",
      display: "flex", alignItems: "center", gap: "12px",
      fontSize: "13px", color: "#7a7a9a",
    },
    aiErrorBox: {
      background: "#1a1a22", border: "1px solid #aa4444",
      borderRadius: "8px", padding: "12px",
      fontSize: "12px", color: "#cc8888",
    },

    // 右クリックメニュー
    contextMenu: (x, y) => ({
      position: "fixed", top: y, left: x,
      background: "#1a1a22", border: "1px solid #3a3a4a",
      borderRadius: "8px", boxShadow: "0 8px 24px rgba(0,0,0,0.6)",
      zIndex: 1000, overflow: "hidden", minWidth: "200px",
    }),
    menuItem: (disabled) => ({
      padding: "10px 16px", cursor: disabled ? "default" : "pointer",
      fontSize: "13px", color: disabled ? "#3a3a4a" : "#e8e6e0",
      display: "flex", alignItems: "center", gap: "10px",
      borderBottom: "1px solid #2a2a35",
      background: "transparent", border: "none",
      width: "100%", textAlign: "left", fontFamily: "inherit",
    }),
    menuLabel: { padding: "6px 16px 4px", fontSize: "10px", color: "#5a5a7a", letterSpacing: "0.08em" },
    menuDivider: { borderTop: "1px solid #2a2a35", margin: "4px 0" },
  };

  // ── JSX ─────────────────────────────────────────────────
  return (
    <div style={styles.app} onClick={closeContextMenu}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        canvas { display: block; }
        /* fix(phase1.5): textLayerのspan座標ズレ修正
           PDF.jsが各spanに inline style で transform: scaleX() を付与する。
           transform-origin を 0% 0% にしないと基準点がずれる。
           font-size は --scale-factor を使ってPDF座標に合わせる。 */
        .textLayer {
          line-height: 1;
        }
        .textLayer span {
          color: transparent;
          position: absolute;
          white-space: pre;
          cursor: text;
          transform-origin: 0% 0%;
          /* PDF.jsが自動付与するtransformが正しく効くようにする */
        }
        .textLayer ::selection { background: rgba(210, 60, 60, 0.35); }
        .menu-item:hover { background: #2a2a35 !important; }
        .sidebar-body::-webkit-scrollbar { width: 4px; }
        .sidebar-body::-webkit-scrollbar-thumb { background: #2a2a35; border-radius: 4px; }
        .pdf-area::-webkit-scrollbar { width: 6px; }
        .pdf-area::-webkit-scrollbar-thumb { background: #2a2a35; border-radius: 4px; }
      `}</style>

      {/* ── ヘッダー ── */}
      <header style={styles.header}>
        <span style={styles.logo}>📄 論文リーダー</span>
        <span style={styles.badge}>Phase 3.5</span>
        {fileName && <span style={styles.fileName}>{fileName}</span>}
        <button
          style={styles.sidebarToggle}
          onClick={(e) => { e.stopPropagation(); setSidebarOpen(o => !o); }}
        >
          {sidebarOpen ? "▶ サイドバー" : "◀ サイドバー"}
        </button>
      </header>

      <div style={styles.main}>

        {/* ── 左: PDF表示エリア ── */}
        <div style={styles.pdfArea} className="pdf-area">
          <div style={styles.phaseNote}>
            <strong style={{ color: ACCENT }}>🤖 フェーズ3.5: 要約機能追加</strong><br />
            テキストを選択して右クリック → 「和訳」「用語説明」「要約」が使えます。<br />
            要約は 3行 / 5行 / 詳細 から粒度を選べます。
          </div>

          {!pdfDoc && !isLoading && (
            <div
              style={styles.dropzone(isDragging)}
              onDragOver={handleDragOver} onDragLeave={handleDragLeave}
              onDrop={handleDrop} onClick={() => fileInputRef.current?.click()}
            >
              <input ref={fileInputRef} type="file" accept=".pdf"
                style={{ display: "none" }} onChange={(e) => loadPdfFile(e.target.files[0])} />
              <div style={{ fontSize: "44px", marginBottom: "12px" }}>📑</div>
              <div style={{ fontSize: "18px", color: ACCENT, marginBottom: "8px" }}>PDFをドラッグ＆ドロップ</div>
              <div style={{ fontSize: "13px", color: "#5a5a7a" }}>または</div>
              <button style={styles.uploadBtn}
                onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}>
                ファイルを選択
              </button>
            </div>
          )}

          {isLoading && (
            <div style={styles.loadingWrap}>
              <div style={styles.spinner(40)} />
              <span>PDFを読み込み中...</span>
            </div>
          )}

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
                  <div style={styles.pdfWrapper} onMouseUp={handleMouseUp} onContextMenu={handleContextMenu}>
                    <canvas ref={canvasRef} />
                    <div ref={textLayerRef} className="textLayer"
                      style={{ position: "absolute", top: 0, left: 0, overflow: "hidden", opacity: 1, lineHeight: 1, userSelect: "text" }} />
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* ── 右: サイドバー ── */}
        <div style={styles.sidebar}>
          {/* タブ（3つ）*/}
          <div style={styles.sidebarHeader}>
            <button style={styles.tabBtn(activeTab === "comments")} onClick={() => setActiveTab("comments")}>
              💬 コメント{comments.length > 0 ? `(${comments.length})` : ""}
            </button>
            <button style={styles.tabBtn(activeTab === "search")} onClick={() => setActiveTab("search")}>
              🔍 検索
            </button>
            {/* フェーズ3で追加: AIタブ */}
            <button style={styles.tabBtn(activeTab === "ai")} onClick={() => setActiveTab("ai")}>
              🤖 AI{aiResults.length > 0 ? `(${aiResults.length})` : ""}
            </button>
          </div>

          <div style={styles.sidebarBody} className="sidebar-body">

            {/* ── コメントタブ ── */}
            {activeTab === "comments" && (
              <>
                {commentTarget && (
                  <div style={styles.commentForm}>
                    <div style={{ fontSize: "11px", color: ACCENT }}>p.{commentTarget.page} の選択テキスト</div>
                    <div style={styles.commentQuote}>
                      {commentTarget.text.length > 80 ? commentTarget.text.slice(0, 80) + "…" : commentTarget.text}
                    </div>
                    <textarea ref={commentInputRef} style={styles.commentTextarea}
                      placeholder="メモを入力... (Ctrl+Enter で保存)"
                      value={commentInput} onChange={(e) => setCommentInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) handleSaveComment(); }} />
                    <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
                      <button onClick={() => setCommentTarget(null)}
                        style={{ ...styles.commentSaveBtn, background: "#2a2a35", color: "#9a9aba" }}>
                        キャンセル
                      </button>
                      <button style={styles.commentSaveBtn} onClick={handleSaveComment}>保存</button>
                    </div>
                  </div>
                )}
                {comments.length === 0 && !commentTarget && (
                  <div style={{ color: "#3a3a4a", fontSize: "12px", textAlign: "center", padding: "32px 0" }}>
                    テキストを選択して右クリック<br />→「コメントを追加」
                  </div>
                )}
                {comments.map((c) => (
                  <div key={c.id} style={styles.commentCard}>
                    <div style={styles.commentCardQuote}>
                      {c.text.length > 60 ? c.text.slice(0, 60) + "…" : c.text}
                    </div>
                    {c.note && <div style={styles.commentCardNote}>{c.note}</div>}
                    <div style={styles.commentCardMeta}>
                      <span>p.{c.page} · {c.createdAt}</span>
                      <button style={styles.commentDeleteBtn} onClick={() => handleDeleteComment(c.id)}>削除</button>
                    </div>
                  </div>
                ))}
              </>
            )}

            {/* ── 検索タブ ── */}
            {activeTab === "search" && (
              <>
                {selectedText ? (
                  <>
                    <div style={{ fontSize: "12px", color: "#7a7a9a" }}>
                      選択中: <span style={{ color: ACCENT }}>「{selectedText.slice(0, 30)}{selectedText.length > 30 ? "…" : ""}」</span>
                    </div>
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
                      <span>Googleで検索</span>
                    </button>
                  </>
                ) : (
                  <div style={{ color: "#3a3a4a", fontSize: "12px", textAlign: "center", padding: "32px 0" }}>
                    テキストを選択すると<br />検索ボタンが表示されます
                  </div>
                )}
              </>
            )}

            {/* ── フェーズ3で追加: AI解析タブ ── */}
            {activeTab === "ai" && (
              <>
                {/* ローディング中のスピナー */}
                {aiLoading && (
                  <div style={styles.aiLoadingBox}>
                    <div style={styles.spinner(24)} />
                    <span>Claude APIに問い合わせ中...</span>
                  </div>
                )}

                {/* エラー表示 */}
                {aiError && (
                  <div style={styles.aiErrorBox}>
                    ⚠️ {aiError}
                  </div>
                )}

                {/* AI結果なし */}
                {aiResults.length === 0 && !aiLoading && (
                  <div style={{ color: "#3a3a4a", fontSize: "12px", textAlign: "center", padding: "32px 0" }}>
                    テキストを選択して右クリック<br />→「和訳する」「用語を説明」
                  </div>
                )}

                {/* AI結果カード（履歴として上から積み上がる）*/}
                {aiResults.map((r) => (
                  <div key={r.id} style={styles.aiCard(r.type)}>

                    {/* 種別バッジ */}
                    <div style={styles.aiCardType(r.type)}>
                      {r.type === "translate" ? "🌐 和訳" : r.type === "explain" ? "📖 用語説明" : `📝 ${SUMMARIZE_LABELS[r.option] ?? "要約"}`}
                    </div>

                    {/* 元テキスト */}
                    <div style={styles.aiCardSource}>
                      {r.sourceText.length > 80 ? r.sourceText.slice(0, 80) + "…" : r.sourceText}
                    </div>

                    {/* AIの応答テキスト */}
                    {/* whiteSpace: "pre-wrap" で改行・スペースを保持 */}
                    <div style={styles.aiCardResult}>{r.result}</div>

                    {/* メタ情報（ページ・時刻・削除ボタン）*/}
                    <div style={styles.aiCardMeta}>
                      <span>p.{r.page} · {r.createdAt}</span>
                      <button style={styles.commentDeleteBtn} onClick={() => handleDeleteAiResult(r.id)}>削除</button>
                    </div>
                  </div>
                ))}
              </>
            )}

          </div>
        </div>
      </div>

      {/* ── 右クリックメニュー ── */}
      {contextMenu && (
        <div style={styles.contextMenu(contextMenu.x, contextMenu.y)} onClick={(e) => e.stopPropagation()}>
          <div style={styles.menuLabel}>
            「{contextMenu.text.slice(0, 20)}{contextMenu.text.length > 20 ? "…" : ""}」
          </div>

          <button className="menu-item" style={styles.menuItem(false)} onClick={() => handleGoogleSearch(contextMenu.text)}>
            <span>🔍</span> Googleで検索
          </button>
          <button className="menu-item" style={styles.menuItem(false)} onClick={() => handleAddCommentStart(contextMenu.text)}>
            <span>💬</span> コメントを追加
          </button>

          <div style={styles.menuDivider} />

          {/* フェーズ3: 実際に動作するようになった */}
          <button className="menu-item" style={styles.menuItem(false)} onClick={() => handleTranslate(contextMenu.text)}>
            <span>🌐</span> 和訳する
          </button>
          <button className="menu-item" style={styles.menuItem(false)} onClick={() => handleExplainTerm(contextMenu.text)}>
            <span>📖</span> 用語を説明
          </button>

          {/* 要約サブメニュー: 粒度を3つのボタンで選ぶ */}
          <div style={{ ...styles.menuItem(false), cursor: "default", flexDirection: "column", alignItems: "flex-start", gap: "6px", borderBottom: "none" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", width: "100%" }}>
              <span>📝</span>
              <span style={{ flex: 1 }}>要約する</span>
            </div>
            {/* 粒度ボタン群: 選ぶとsummarizeLinesを更新してAPIを呼ぶ */}
            <div style={{ display: "flex", gap: "6px", paddingLeft: "22px" }}>
              {[
                { key: "3",      label: "3行" },
                { key: "5",      label: "5行" },
                { key: "detail", label: "詳細" },
              ].map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => {
                    setSummarizeLines(key);
                    handleSummarize(contextMenu.text, key);
                  }}
                  style={{
                    background: summarizeLines === key ? ACCENT : "#2a2a35",
                    color:      summarizeLines === key ? "#0f0f13" : "#9a9aba",
                    border: "1px solid #3a3a4a",
                    borderRadius: "4px",
                    padding: "4px 10px",
                    cursor: "pointer",
                    fontSize: "12px",
                    fontFamily: "inherit",
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
