import { useEffect, useState } from "react";
import { Spinner } from "./ui/Spinner";
import { getClient } from "@/lib/client";

function tinyMarkdown(src: string): string {
  const escape = (s: string) =>
    s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));

  return escape(src)
    .replace(/^## (.*)$/gm, "<h2>$1</h2>")
    .replace(/^# (.*)$/gm, "<h1>$1</h1>")
    .replace(/^### (.*)$/gm, "<h3>$1</h3>")
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.*?)\*/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/^\s*[-•] (.*)$/gm, "<li>$1</li>")
    .replace(/^\s*(\d+)\. (.*)$/gm, "<li>$2</li>")
    .replace(/(<li>[\s\S]*?<\/li>\s*)+/g, (m) => `<ul>${m}</ul>`)
    .replace(/\n{2,}/g, '<div style="height:8px"></div>')
    .replace(/\n/g, "<br/>");
}

export function DossierView({ path }: { path?: string | null }) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setContent(null);
    if (!path) { setLoading(false); return; }
    (async () => {
      const client = await getClient();
      try {
        const text = await client.files.read(path);
        if (!cancelled) setContent(text);
      } catch {
        if (!cancelled) setContent(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [path]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted text-sm py-8 justify-center">
        <Spinner size={12} /> Loading dossier…
      </div>
    );
  }
  if (!content) {
    return (
      <div className="text-muted text-sm py-8 text-center italic">
        No dossier file yet. The intake agent writes one on first triage.
      </div>
    );
  }
  return (
    <article
      className="prose-dark"
      dangerouslySetInnerHTML={{ __html: tinyMarkdown(content) }}
    />
  );
}
