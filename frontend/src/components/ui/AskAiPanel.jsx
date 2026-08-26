import { useState, useRef, useEffect, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { apiService } from "../../services/api";
import {
  AskAi,
  SendArrow,
  Square,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  FileText,
} from "../../icons";

/**
 * "Ask AI" for the document viewer page.
 *
 * The conversation lives here and nowhere else - it is sent back with each
 * question so follow-ups make sense, and it is gone on refresh. Nothing is
 * stored server-side.
 */

const SUGGESTIONS = [
  "Summarize this document",
  "What are the key points?",
  "Explain this in simple terms",
];

// Answers arrive as markdown, and models reach for tables constantly. Core
// react-markdown does not implement GitHub's table syntax, so without remark-gfm
// a comparison table renders as a wall of literal pipe characters.
const REMARK_PLUGINS = [remarkGfm];

// Explicit classes rather than @tailwindcss/typography: this project has no
// typography plugin, and adding one to style one panel is a poor trade.
const MARKDOWN_COMPONENTS = {
  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
  ul: ({ children }) => (
    <ul className="list-disc pl-5 mb-2 space-y-1">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="list-decimal pl-5 mb-2 space-y-1">{children}</ol>
  ),
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  strong: ({ children }) => (
    <strong className="font-semibold text-white">{children}</strong>
  ),
  h1: ({ children }) => (
    <h4 className="font-semibold text-white mt-3 mb-1 first:mt-0">
      {children}
    </h4>
  ),
  h2: ({ children }) => (
    <h4 className="font-semibold text-white mt-3 mb-1 first:mt-0">
      {children}
    </h4>
  ),
  h3: ({ children }) => (
    <h5 className="font-semibold text-white mt-2 mb-1 first:mt-0">
      {children}
    </h5>
  ),
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-blue-400 underline"
    >
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-dark-700 pl-3 text-dark-300 mb-2">
      {children}
    </blockquote>
  ),
  code: ({ children }) => (
    <code className="font-mono text-[0.85em] bg-dark-800 rounded px-1 py-0.5">
      {children}
    </code>
  ),
  // The nested <code> keeps its font but drops the inline chip styling.
  pre: ({ children }) => (
    <pre className="bg-dark-800 rounded-lg p-3 mb-2 overflow-x-auto text-xs [&>code]:bg-transparent [&>code]:p-0">
      {children}
    </pre>
  ),
  // A wide table scrolls inside its own box rather than stretching the panel.
  table: ({ children }) => (
    <div className="overflow-x-auto mb-2 rounded-lg border border-dark-800">
      <table className="text-xs border-collapse w-full">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-dark-800/60">{children}</thead>,
  th: ({ children }) => (
    <th className="border-b border-dark-800 px-2 py-1.5 text-left font-semibold text-dark-200 align-top">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border-b border-dark-800/60 px-2 py-1.5 align-top">
      {children}
    </td>
  ),
  hr: () => <hr className="border-dark-800 my-3" />,
};

// What to tell the user about how much of the document the answer could see.
// Silent in the normal cases: the whole document fit, or the passages shown in
// the sources list are the answer's basis.
function coverageNotice(meta) {
  if (!meta) return null;

  if (meta.indexing) {
    return `Still indexing this document (${meta.remaining} passages to go). Until that finishes, answers cover its opening section only.`;
  }

  if (meta.mode === "opening") {
    return "This document could not be indexed for search, so answers cover its opening section only.";
  }

  if (meta.truncated) {
    return "This document is very long - its final pages are not covered.";
  }

  return null;
}

/**
 * Waiting state. Nothing streams until the server has picked the relevant
 * passages, and on a document's first question it is also being indexed - which
 * can take seconds, so the wait shows how long it has been rather than leaving
 * the user with no idea whether anything is happening.
 */
const WaitingLine = ({ seconds }) => (
  <span
    className="text-xs text-dark-400 tabular-nums animate-pulse"
    role="status"
    aria-live="polite"
  >
    Reading the document
    <span className="text-dark-500"> · {seconds.toFixed(1)}s</span>
  </span>
);

const Sources = ({ sources }) => {
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-2">
      <button
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-1 text-xs text-dark-400 hover:text-dark-200 transition-colors"
      >
        <FileText size={12} />
        {sources.length} source{sources.length === 1 ? "" : "s"}
        {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      </button>

      {open && (
        <ul className="mt-2 space-y-2">
          {sources.map((source) => (
            <li
              key={source.index}
              className="border-l-2 border-dark-700 pl-3 text-xs text-dark-400"
            >
              {source.label && (
                <span className="block text-dark-300 font-medium mb-0.5">
                  {source.label}
                </span>
              )}
              <span className="whitespace-pre-wrap break-words">
                {source.snippet}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export const AskAiPanel = ({ document: doc, isLoggedIn }) => {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState(null);
  const [meta, setMeta] = useState(null);
  const [elapsed, setElapsed] = useState(0);

  const abortRef = useRef(null);
  const scrollRef = useRef(null);
  const startedAtRef = useRef(0);
  const preparedRef = useRef(null);
  const documentKey = doc?.slug || doc?._id;

  const last = messages[messages.length - 1];
  // The gap between sending and the first token: retrieval, and on a first
  // question, indexing.
  const waiting = streaming && last?.role === "assistant" && !last.content;

  // A different document is a different conversation.
  useEffect(() => {
    abortRef.current?.abort();
    setMessages([]);
    setDraft("");
    setStreaming(false);
    setError(null);
    setMeta(null);
  }, [documentKey]);

  useEffect(() => () => abortRef.current?.abort(), []);

  // Opening the panel warms the document's index, so the seconds of extraction,
  // embedding and vector loading are spent while the user is reading and typing
  // rather than added to their first question. Once per document; a failure is
  // silent because the question itself will report it properly.
  useEffect(() => {
    if (!open || !isLoggedIn || !documentKey) return;
    if (preparedRef.current === documentKey) return;

    preparedRef.current = documentKey;

    apiService
      .prepareDocumentAi(documentKey)
      .then((response) => {
        const { ready, remaining, mode } = response.data || {};
        // A long document on a rate-limited tier cannot be indexed in one pass.
        // Saying so beats letting the answers look inexplicably shallow.
        if (!ready && remaining > 0) {
          setMeta({ mode, indexing: true, remaining });
        }
      })
      .catch((err) => {
        // A document with no readable text is worth saying up front - the user
        // is about to type a question that cannot be answered.
        if (err.response?.status === 422) {
          setError(err.response.data?.message || null);
        }
      });
  }, [open, isLoggedIn, documentKey]);

  useEffect(() => {
    if (!waiting) return undefined;

    const id = setInterval(
      () => setElapsed((Date.now() - startedAtRef.current) / 1000),
      100,
    );
    return () => clearInterval(id);
  }, [waiting]);

  // Follow the answer as it is written, but only from the panel's own scroll
  // container so the page underneath does not jump.
  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages, streaming]);

  const ask = useCallback(
    async (question) => {
      const trimmed = question.trim();
      if (!trimmed || streaming) return;

      if (!isLoggedIn) {
        setError("Please sign in to ask questions about this document.");
        return;
      }

      // The history the model sees is what was on screen before this question.
      const history = messages.map(({ role, content }) => ({ role, content }));

      setDraft("");
      setError(null);
      setStreaming(true);
      startedAtRef.current = Date.now();
      setElapsed(0);
      setMessages((current) => [
        ...current,
        { role: "user", content: trimmed },
        { role: "assistant", content: "", sources: [] },
      ]);

      const controller = new AbortController();
      abortRef.current = controller;

      const updateAnswer = (change) =>
        setMessages((current) => {
          const next = [...current];
          const target = next[next.length - 1];
          next[next.length - 1] = { ...target, ...change(target) };
          return next;
        });

      try {
        await apiService.askDocumentAi(documentKey, {
          question: trimmed,
          history,
          signal: controller.signal,
          // An answer from the opening section while indexing is still running
          // keeps the "still indexing" wording rather than reverting to the
          // flat "could not be indexed".
          onMeta: (received) =>
            setMeta((current) =>
              received.mode === "opening" && current?.indexing
                ? { ...received, indexing: true, remaining: current.remaining }
                : received,
            ),
          onSources: (sources) => updateAnswer(() => ({ sources })),
          onToken: (token) =>
            updateAnswer((target) => ({ content: target.content + token })),
          onDone: ({ cut }) => updateAnswer(() => ({ cut: Boolean(cut) })),
        });
      } catch (err) {
        // A stop press aborts the fetch; the partial answer stays on screen.
        if (err.name !== "AbortError") {
          setError(err.message || "The AI assistant could not answer.");
        }
      } finally {
        abortRef.current = null;
        setStreaming(false);

        // An answer that never produced a token would otherwise leave an empty
        // bubble sitting there.
        setMessages((current) => {
          const target = current[current.length - 1];
          if (target?.role === "assistant" && !target.content) {
            return current.slice(0, -1);
          }
          return current;
        });
      }
    },
    [documentKey, isLoggedIn, messages, streaming],
  );

  const onKeyDown = (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      ask(draft);
    }
  };

  const notice = coverageNotice(meta);

  return (
    <div className="mt-4 bg-dark-900/50 backdrop-blur-sm rounded-xl border border-dark-800/50 overflow-hidden">
      <button
        onClick={() => setOpen((value) => !value)}
        className="w-full flex items-center justify-between gap-2 px-4 py-3 text-left hover:bg-dark-800/40 transition-colors"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2">
          <AskAi size={18} className="text-white" />
          <span className="text-sm font-semibold text-white">Ask AI</span>
          <span className="hidden sm:inline text-xs text-dark-400">
            Summarize or ask anything about this document
          </span>
        </span>
        {open ? (
          <ChevronUp size={18} className="text-dark-400" />
        ) : (
          <ChevronDown size={18} className="text-dark-400" />
        )}
      </button>

      {open && (
        <div className="border-t border-dark-800/50">
          <div
            ref={scrollRef}
            className="max-h-[22rem] overflow-y-auto px-4 py-4 space-y-3"
          >
            {messages.length === 0 && (
              <div className="space-y-3">
                <p className="text-sm text-dark-400">
                  Answers come from this document&apos;s text only.
                </p>
                <div className="flex flex-wrap gap-2">
                  {SUGGESTIONS.map((suggestion) => (
                    <button
                      key={suggestion}
                      onClick={() => ask(suggestion)}
                      disabled={streaming}
                      className="px-3 py-1.5 bg-dark-800 hover:bg-dark-700 disabled:opacity-40 text-dark-200 rounded-lg text-xs transition-colors"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((message, index) => {
              const isLast = index === messages.length - 1;

              if (message.role === "user") {
                return (
                  <div key={index} className="flex justify-end">
                    <div className="max-w-[85%] bg-blue-500/15 text-blue-100 rounded-xl rounded-br-sm px-3 py-2 text-sm whitespace-pre-wrap break-words">
                      {message.content}
                    </div>
                  </div>
                );
              }

              if (isLast && waiting) {
                return (
                  <div key={index} className="flex gap-2">
                    <AskAi
                      size={16}
                      className="text-white mt-0.5 flex-shrink-0"
                    />
                    <WaitingLine seconds={elapsed} />
                  </div>
                );
              }

              return (
                <div key={index} className="flex gap-2">
                  <AskAi
                    size={16}
                    className="text-white mt-1 flex-shrink-0"
                  />
                  <div className="min-w-0 flex-1 text-sm text-dark-100 leading-relaxed break-words">
                    <ReactMarkdown
                      remarkPlugins={REMARK_PLUGINS}
                      components={MARKDOWN_COMPONENTS}
                    >
                      {message.content}
                    </ReactMarkdown>

                    {isLast && streaming && (
                      <span className="inline-block w-1.5 h-4 ml-0.5 align-text-bottom bg-blue-400 animate-pulse" />
                    )}

                    {message.cut && !streaming && (
                      <p className="mt-1 text-xs text-dark-500">
                        This answer reached the length limit. Ask a narrower
                        question, or ask it to continue.
                      </p>
                    )}

                    {message.sources?.length > 0 && (
                      <Sources sources={message.sources} />
                    )}
                  </div>
                </div>
              );
            })}

            {notice && <p className="text-xs text-dark-500">{notice}</p>}

            {error && (
              <div className="flex items-start gap-2 text-xs text-red-400">
                <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </div>

          <div className="flex items-end gap-2 px-4 py-3 border-t border-dark-800/50">
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onKeyDown}
              rows={1}
              maxLength={1000}
              placeholder={
                isLoggedIn
                  ? "Ask a question about this document..."
                  : "Sign in to ask questions"
              }
              className="flex-1 resize-none bg-dark-800 text-white placeholder-dark-500 border border-white rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-white max-h-32"
            />
            {streaming ? (
              <button
                onClick={() => abortRef.current?.abort()}
                className="p-2 rounded-lg bg-dark-800 hover:bg-dark-700 text-dark-200 transition-colors"
                aria-label="Stop generating"
              >
                <Square size={18} />
              </button>
            ) : (
              <button
                onClick={() => ask(draft)}
                disabled={!draft.trim()}
                className="p-2 rounded-lg bg-white hover:bg-dark-200 disabled:opacity-40 disabled:hover:bg-white text-dark-950 transition-colors"
                aria-label="Send question"
              >
                <SendArrow size={18} />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
