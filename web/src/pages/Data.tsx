import { Eyebrow } from "@/components/ui-bits";

const ISSUES_URL = "https://github.com/Timidan/resurgo/issues";

const SECTIONS: { title: string; body: string }[] = [
  {
    title: "What the App reads",
    body: "Public repos you pick, at a commit: Resurgo clones each one fresh, runs its install, build and test steps, and records what happened.",
  },
  {
    title: "What is public",
    body: "A run record: the repo, the commit, the commands that ran, their exit codes and the tail of their output, and the fix it proposed. Records are listed in the public gallery, so anyone can open them.",
  },
  {
    title: "What is never touched",
    body: "Private repos are not checked. Secrets are never read: when a project expects a .env file, Resurgo fills it with dummy values.",
  },
];

export default function Data() {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-24 pt-12 sm:px-6">
      <Eyebrow>Privacy</Eyebrow>
      <h1 className="text-5xl font-semibold tracking-tight sm:text-6xl">What Resurgo stores.</h1>
      <p className="mt-5 text-lg text-muted-foreground">
        What Resurgo reads, what it publishes and what it leaves alone.
      </p>
      <div className="mt-10 space-y-8">
        {SECTIONS.map((s) => (
          <section key={s.title}>
            <h2 className="text-2xl font-semibold">{s.title}</h2>
            <p className="mt-2 text-muted-foreground">{s.body}</p>
          </section>
        ))}
        <section>
          <h2 className="text-2xl font-semibold">How to remove records</h2>
          <p className="mt-2 text-muted-foreground">
            Uninstall the app on GitHub to stop further checks. To have a recorded run taken down, open an issue at{" "}
            <a href={ISSUES_URL} className="font-semibold text-accent-strong underline underline-offset-4">
              github.com/Timidan/resurgo
            </a>{" "}
            and name the repo.
          </p>
        </section>
      </div>
    </main>
  );
}
