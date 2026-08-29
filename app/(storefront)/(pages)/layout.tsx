/**
 * Shared shell for the static policy pages (privacy, terms, refund policy).
 *
 * One narrow prose column. These pages are plain server-rendered text with no
 * data reads, so they prerender fully static; each page brings its own <h1>
 * and metadata.
 */
export default function PolicyPagesLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="shell py-10 sm:py-16">
      <article className="policy-prose mx-auto flex max-w-[46rem] flex-col gap-6">
        {children}
      </article>
    </main>
  );
}
