import { useEffect, useMemo, useRef, useState } from "react";

type Question = {
  question: string;
  options: string[];
  optionKeys?: string[]; // e.g. ["A","B","C","D"] if source used a map
  answerIndex: number;
  domain?: string;
  hint?: string;
  rationaleCorrect?: string;
  rationaleIncorrect?: string;
};

type Phase = "setup" | "test" | "results";

const LS_JSON = "mcq.jsonInput";
const LS_TIME = "mcq.totalMinutes";
const LS_LAST = "mcq.lastResult";

function normalize(raw: unknown): { questions: Question[]; title?: string } {
  let data: any = raw;
  if (typeof raw === "string") data = JSON.parse(raw);
  let title: string | undefined;
  let list: any[];
  if (Array.isArray(data)) {
    list = data;
  } else if (data && Array.isArray(data.questions)) {
    list = data.questions;
    title = data.module_info?.title ?? data.title;
  } else {
    throw new Error("JSON must be an array of questions or have a 'questions' array");
  }

  const questions = list.map((item: any, i: number) => {
    const question: string | undefined =
      item.question ?? item.scenario ?? item.q ?? item.text;

    // options can be array or object map ({A:"...", B:"..."})
    let optionsArr: string[];
    let optionKeys: string[] | undefined;
    const rawOpts = item.options ?? item.choices;
    if (Array.isArray(rawOpts)) {
      optionsArr = rawOpts.map(String);
    } else if (rawOpts && typeof rawOpts === "object") {
      optionKeys = Object.keys(rawOpts);
      optionsArr = optionKeys.map((k) => String(rawOpts[k]));
    } else {
      throw new Error(`Question ${i + 1}: missing options`);
    }

    if (!question || optionsArr.length < 2) {
      throw new Error(`Question ${i + 1} is missing question/options`);
    }

    const ans = item.answer ?? item.correct ?? item.correctAnswer ?? item.correct_answer;
    let answerIndex: number;
    if (typeof ans === "number") {
      answerIndex = ans;
    } else if (typeof ans === "string") {
      // try option key match first (e.g. "A","B")
      if (optionKeys) {
        const ki = optionKeys.indexOf(ans);
        if (ki !== -1) answerIndex = ki;
        else {
          const vi = optionsArr.indexOf(ans);
          if (vi !== -1) answerIndex = vi;
          else {
            const asNum = Number(ans);
            if (!Number.isNaN(asNum)) answerIndex = asNum;
            else throw new Error(`Question ${i + 1}: answer "${ans}" not in options`);
          }
        }
      } else {
        const asNum = Number(ans);
        if (!Number.isNaN(asNum)) {
          answerIndex = asNum;
        } else {
          const vi = optionsArr.indexOf(ans);
          if (vi !== -1) answerIndex = vi;
          else {
            // letter like "A" mapped to index
            const upper = ans.trim().toUpperCase();
            if (/^[A-Z]$/.test(upper)) answerIndex = upper.charCodeAt(0) - 65;
            else throw new Error(`Question ${i + 1}: answer not found in options`);
          }
        }
      }
    } else {
      throw new Error(`Question ${i + 1} is missing an answer`);
    }

    if (answerIndex < 0 || answerIndex >= optionsArr.length)
      throw new Error(`Question ${i + 1}: answer index out of range`);

    return {
      question,
      options: optionsArr,
      optionKeys,
      answerIndex,
      domain: item.domain,
      hint: item.hint,
      rationaleCorrect: item.rationales?.correct,
      rationaleIncorrect: item.rationales?.incorrect,
    } as Question;
  });

  return { questions, title };
}

const SAMPLE = JSON.stringify(
  [
    {
      question: "What is 2 + 2?",
      options: ["3", "4", "5", "22"],
      answer: 1,
    },
    {
      question: "Capital of France?",
      options: ["Berlin", "Madrid", "Paris", "Rome"],
      answer: 2,
    },
  ],
  null,
  2
);

function fmt(secs: number) {
  const s = Math.max(0, Math.floor(secs));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

export function MCQApp() {
  const [phase, setPhase] = useState<Phase>("setup");
  const [jsonText, setJsonText] = useState("");
  const [minutes, setMinutes] = useState(10);
  const [error, setError] = useState<string | null>(null);

  const [questions, setQuestions] = useState<Question[]>([]);
  const [current, setCurrent] = useState(0);
  const [answers, setAnswers] = useState<(number | null)[]>([]);
  const [perQTime, setPerQTime] = useState<number[]>([]);
  const [remaining, setRemaining] = useState(0);
  const [showHint, setShowHint] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  const qStartRef = useRef<number>(0);
  const endAtRef = useRef<number>(0);

  const [lastResult, setLastResult] = useState<any>(null);
  const [moduleTitle, setModuleTitle] = useState<string | undefined>(undefined);

  useEffect(() => {
    setJsonText(localStorage.getItem(LS_JSON) ?? "");
    const t = localStorage.getItem(LS_TIME);
    if (t) setMinutes(Number(t) || 10);
    const last = localStorage.getItem(LS_LAST);
    if (last) {
      try {
        setLastResult(JSON.parse(last));
      } catch {}
    }
  }, []);

  useEffect(() => {
    if (phase !== "test") return;
    if (minutes === 0) {
      // untimed: count up
      const startedAt = Date.now() - elapsed * 1000;
      const tick = () => setElapsed(Math.floor((Date.now() - startedAt) / 1000));
      tick();
      const id = setInterval(tick, 500);
      return () => clearInterval(id);
    }
    const tick = () => {
      const left = Math.max(0, Math.ceil((endAtRef.current - Date.now()) / 1000));
      setRemaining(left);
      if (left <= 0) finishTest();
    };
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  function startTest() {
    setError(null);
    try {
      const { questions: qs, title } = normalize(jsonText);
      if (qs.length === 0) throw new Error("No questions found");
      localStorage.setItem(LS_JSON, jsonText);
      localStorage.setItem(LS_TIME, String(minutes));
      setModuleTitle(title);
      setQuestions(qs);
      setAnswers(Array(qs.length).fill(null));
      setPerQTime(Array(qs.length).fill(0));
      setCurrent(0);
      setElapsed(0);
      setShowHint(false);
      endAtRef.current = minutes > 0 ? Date.now() + minutes * 60 * 1000 : 0;
      qStartRef.current = Date.now();
      setPhase("test");
    } catch (e: any) {
      setError(e.message || "Invalid JSON");
    }
  }

  function recordTimeForCurrent() {
    const now = Date.now();
    const elapsed = (now - qStartRef.current) / 1000;
    qStartRef.current = now;
    setPerQTime((prev) => {
      const next = [...prev];
      next[current] = (next[current] || 0) + elapsed;
      return next;
    });
  }

  function selectAnswer(i: number) {
    setAnswers((prev) => {
      const next = [...prev];
      next[current] = i;
      return next;
    });
  }

  function goTo(idx: number) {
    if (idx < 0 || idx >= questions.length) return;
    recordTimeForCurrent();
    setCurrent(idx);
    setShowHint(false);
  }

  function finishTest() {
    recordTimeForCurrent();
    setPerQTime((prevTimes) => {
      const score = answers.reduce<number>(
        (acc, a, i) => acc + (a !== null && a === questions[i].answerIndex ? 1 : 0),
        0
      );
      const result = {
        at: new Date().toISOString(),
        score,
        total: questions.length,
        questions,
        answers,
        perQTime: prevTimes,
      };
      localStorage.setItem(LS_LAST, JSON.stringify(result));
      setLastResult(result);
      return prevTimes;
    });
    setPhase("results");
  }

  function resetAll() {
    setPhase("setup");
    setCurrent(0);
    setQuestions([]);
    setAnswers([]);
    setPerQTime([]);
  }

  async function onFile(file: File) {
    const text = await file.text();
    setJsonText(text);
  }

  const totalAnswered = useMemo(() => answers.filter((a) => a !== null).length, [answers]);

  if (phase === "setup") {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <div className="mx-auto max-w-3xl px-4 py-10">
          <h1 className="text-3xl font-bold tracking-tight">MCQ Test Runner</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Paste JSON or upload a .json file. Format: an array of{" "}
            <code className="rounded bg-muted px-1">{`{ question, options, answer }`}</code>.
          </p>

          <div className="mt-6 grid gap-4 rounded-lg border border-border bg-card p-5">
            <div className="flex flex-wrap items-center gap-3">
              <label className="inline-flex cursor-pointer items-center rounded-md border border-input bg-background px-3 py-2 text-sm font-medium hover:bg-accent">
                Upload JSON
                <input
                  type="file"
                  accept="application/json,.json"
                  className="hidden"
                  onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
                />
              </label>
              <button
                type="button"
                onClick={() => setJsonText(SAMPLE)}
                className="rounded-md border border-input bg-background px-3 py-2 text-sm font-medium hover:bg-accent"
              >
                Load sample
              </button>
              <button
                type="button"
                onClick={() => {
                  setJsonText("");
                  localStorage.removeItem(LS_JSON);
                }}
                className="rounded-md border border-input bg-background px-3 py-2 text-sm font-medium hover:bg-accent"
              >
                Clear
              </button>
            </div>

            <textarea
              value={jsonText}
              onChange={(e) => setJsonText(e.target.value)}
              placeholder="Paste your questions JSON here..."
              className="h-72 w-full rounded-md border border-input bg-background p-3 font-mono text-sm"
            />

            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="block text-sm font-medium">
                  Total time (minutes) <span className="text-xs text-muted-foreground">— 0 = unlimited</span>
                </label>
                <input
                  type="number"
                  min={0}
                  max={600}
                  value={minutes}
                  onChange={(e) => setMinutes(Math.max(0, Number(e.target.value) || 0))}
                  className="mt-1 w-32 rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
              </div>
              <button
                onClick={startTest}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                Start Test
              </button>
            </div>

            {error && (
              <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}
          </div>

          {lastResult && (
            <div className="mt-6 rounded-lg border border-border bg-card p-5">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">Last result</h2>
                <button
                  onClick={() => setPhase("results")}
                  className="text-sm font-medium text-primary hover:underline"
                >
                  View details →
                </button>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                Score: {lastResult.score}/{lastResult.total} ·{" "}
                {new Date(lastResult.at).toLocaleString()}
              </p>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (phase === "test") {
    const q = questions[current];
    return (
      <div className="min-h-screen bg-background text-foreground">
        <div className="mx-auto max-w-3xl px-4 py-6">
          <div className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3">
            <div className="text-sm text-muted-foreground">
              {moduleTitle && (
                <div className="font-medium text-foreground">{moduleTitle}</div>
              )}
              Question {current + 1} / {questions.length} · Answered {totalAnswered}
            </div>
            <div
              className={`font-mono text-lg font-semibold ${
                minutes > 0 && remaining < 60 ? "text-destructive" : ""
              }`}
            >
              {minutes === 0 ? `∞ ${fmt(elapsed)}` : fmt(remaining)}
            </div>
          </div>

          <div className="mt-4 rounded-lg border border-border bg-card p-6">
            {q.domain && (
              <div className="mb-2 inline-block rounded bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                {q.domain}
              </div>
            )}
            <h2 className="text-lg font-semibold leading-snug">{q.question}</h2>
            {q.hint && (
              <div className="mt-3">
                <button
                  type="button"
                  onClick={() => setShowHint((v) => !v)}
                  className="rounded-md border border-input bg-background px-3 py-1.5 text-xs font-medium hover:bg-accent"
                >
                  {showHint ? "Hide hint" : "Show hint"}
                </button>
                {showHint && (
                  <p className="mt-2 rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
                    💡 {q.hint}
                  </p>
                )}
              </div>
            )}
            <div className="mt-4 grid gap-2">
              {q.options.map((opt, i) => {
                const selected = answers[current] === i;
                const key = q.optionKeys?.[i] ?? String.fromCharCode(65 + i);
                return (
                  <button
                    key={i}
                    onClick={() => selectAnswer(i)}
                    className={`rounded-md border px-4 py-3 text-left text-sm transition-colors ${
                      selected
                        ? "border-primary bg-primary/10"
                        : "border-input bg-background hover:bg-accent"
                    }`}
                  >
                    <span className="mr-2 font-mono text-xs text-muted-foreground">
                      {key}.
                    </span>
                    {opt}
                  </button>
                );
              })}
            </div>

            <div className="mt-6 flex flex-wrap items-center justify-between gap-2">
              <button
                onClick={() => goTo(current - 1)}
                disabled={current === 0}
                className="rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
              >
                Previous
              </button>
              <div className="flex flex-wrap gap-1">
                {questions.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => goTo(i)}
                    className={`h-8 w-8 rounded text-xs font-medium ${
                      i === current
                        ? "bg-primary text-primary-foreground"
                        : answers[i] !== null
                          ? "bg-primary/20 text-foreground"
                          : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {i + 1}
                  </button>
                ))}
              </div>
              {current < questions.length - 1 ? (
                <button
                  onClick={() => goTo(current + 1)}
                  className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                >
                  Next
                </button>
              ) : (
                <button
                  onClick={finishTest}
                  className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                >
                  Submit
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // results
  const r = lastResult;
  if (!r) return null;
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-4 py-10">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Results</h1>
          <button
            onClick={resetAll}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            New test
          </button>
        </div>
        <p className="mt-2 text-lg">
          Score: <span className="font-semibold">{r.score}</span> / {r.total} ·{" "}
          <span className="text-muted-foreground">
            Total time:{" "}
            {fmt(r.perQTime.reduce((a: number, b: number) => a + b, 0))}
          </span>
        </p>

        <div className="mt-6 space-y-3">
          {r.questions.map((q: Question, i: number) => {
            const userAns = r.answers[i];
            const correct = userAns === q.answerIndex;
            const keyFor = (idx: number) =>
              q.optionKeys?.[idx] ?? String.fromCharCode(65 + idx);
            return (
              <div key={i} className="rounded-lg border border-border bg-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="text-sm font-medium">
                    {q.domain && (
                      <div className="mb-1 text-xs font-normal text-muted-foreground">
                        {q.domain}
                      </div>
                    )}
                    {i + 1}. {q.question}
                  </div>
                  <div className="shrink-0 text-xs text-muted-foreground">
                    ⏱ {fmt(r.perQTime[i] || 0)}
                  </div>
                </div>
                <div className="mt-2 text-sm">
                  <span
                    className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${
                      correct
                        ? "bg-primary/15 text-primary"
                        : userAns === null
                          ? "bg-muted text-muted-foreground"
                          : "bg-destructive/15 text-destructive"
                    }`}
                  >
                    {correct
                      ? "Correct"
                      : userAns === null
                        ? "Skipped"
                        : "Wrong"}
                  </span>
                  <div className="mt-2 text-muted-foreground">
                    Your answer:{" "}
                    <span className="text-foreground">
                      {userAns === null
                        ? "—"
                        : `${keyFor(userAns)}. ${q.options[userAns]}`}
                    </span>
                  </div>
                  {!correct && (
                    <div className="text-muted-foreground">
                      Correct answer:{" "}
                      <span className="text-foreground">
                        {keyFor(q.answerIndex)}. {q.options[q.answerIndex]}
                      </span>
                    </div>
                  )}
                  {(q.rationaleCorrect || q.rationaleIncorrect || q.hint) && (
                    <details className="mt-3 rounded-md border border-border bg-background p-3">
                      <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                        Explanation
                      </summary>
                      <div className="mt-2 space-y-2 text-xs">
                        {q.hint && (
                          <p>
                            <span className="font-semibold">Hint: </span>
                            <span className="text-muted-foreground">{q.hint}</span>
                          </p>
                        )}
                        {q.rationaleCorrect && (
                          <p>
                            <span className="font-semibold">Why correct: </span>
                            <span className="text-muted-foreground">
                              {q.rationaleCorrect}
                            </span>
                          </p>
                        )}
                        {q.rationaleIncorrect && (
                          <p>
                            <span className="font-semibold">Why others are wrong: </span>
                            <span className="text-muted-foreground">
                              {q.rationaleIncorrect}
                            </span>
                          </p>
                        )}
                      </div>
                    </details>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}